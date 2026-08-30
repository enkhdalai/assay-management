import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import {
  auditLogs,
  createDatabase,
  loginEvents,
  organizations,
  userInvitations,
  userSessions,
  users,
  type AppDatabase,
} from "../../../../packages/db/src";
import {
  assertAcceptablePassword,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  randomBase64Url,
  sessionExpiresAt,
  sha256Base64Url,
  timingSafeEqual,
  verifyPassword,
  type AuthenticatedUser,
} from "../../../../packages/security/src";
import type {
  AcceptInvitationInput,
  AuthStore,
  CreateFirstAdminInput,
  CreateInvitationInput,
  LoginResult,
  SetupStatus,
} from "./auth-types";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const INVITATION_TOKEN_BYTES = 32;
const DEFAULT_INVITATION_DAYS = 7;
const MAX_INVITATION_DAYS = 30;

type UserRole = typeof users.$inferInsert.role;

type UserWithOrganization = {
  id: string;
  organizationId: string;
  organizationName: string;
  role: string;
  status: "invited" | "active" | "locked" | "disabled";
  email: string;
  fullName: string;
  passwordHash: string | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
};

export class PostgresAuthStore implements AuthStore {
  private readonly db: AppDatabase;

  constructor(
    databaseUrl: string,
    private readonly setupTokenHash?: string,
  ) {
    this.db = createDatabase(databaseUrl);
  }

  async getSetupStatus(): Promise<SetupStatus> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);

    return {
      configured: true,
      needsFirstAdmin: (row?.count ?? 0) === 0,
    };
  }

  async createFirstAdmin(input: CreateFirstAdminInput): Promise<LoginResult> {
    const status = await this.getSetupStatus();
    if (!status.needsFirstAdmin || !this.setupTokenHash) {
      return { ok: false, reason: "disabled" };
    }

    const incomingTokenHash = await sha256Base64Url(input.setupToken);
    if (!timingSafeEqual(incomingTokenHash, this.setupTokenHash)) {
      return { ok: false, reason: "invalid_credentials" };
    }

    assertAcceptablePassword(input.password);

    const token = createSessionToken();
    const tokenHash = await hashSessionToken(token);
    const expiresAt = sessionExpiresAt();
    const passwordHash = await hashPassword(input.password);
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    const organizationName = input.organizationName.trim();
    const organizationCode = input.organizationCode.trim().toUpperCase();
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const auditCreatedAt = new Date();
    const previousHash = await this.getLatestAuditHash();
    const entryHash = await createAuditEntryHash(
      {
        actorUserId: userId,
        actorOrganizationId: organizationId,
        action: "first_admin.created",
        entityType: "users",
        entityId: userId,
        reason: "Initial secure system bootstrap",
      },
      previousHash,
      auditCreatedAt,
    );

    const result = await this.db.execute<{
      id: string;
      organizationId: string;
      organizationName: string;
      role: string;
      email: string;
      fullName: string;
    }>(sql`
      WITH created_organization AS (
        INSERT INTO organizations (id, type, status, code, name)
        VALUES (${organizationId}, 'system_operator', 'active', ${organizationCode}, ${organizationName})
        RETURNING id, name
      ),
      created_user AS (
        INSERT INTO users (
          id,
          organization_id,
          role,
          status,
          email,
          full_name,
          password_hash,
          password_updated_at,
          mfa_enabled
        )
        SELECT
          ${userId},
          id,
          'system_admin',
          'active',
          ${email},
          ${fullName},
          ${passwordHash},
          ${new Date()},
          false
        FROM created_organization
        RETURNING id, organization_id, role, email, full_name
      ),
      created_session AS (
        INSERT INTO user_sessions (user_id, status, session_token_hash, expires_at)
        SELECT id, 'active', ${tokenHash}, ${expiresAt}
        FROM created_user
        RETURNING user_id
      ),
      created_login AS (
        INSERT INTO login_events (user_id, email, outcome, reason)
        SELECT id, email, 'success', 'first_admin_created'
        FROM created_user
        RETURNING id
      ),
      created_audit AS (
        INSERT INTO audit_logs (
          actor_user_id,
          actor_organization_id,
          action,
          entity_type,
          entity_id,
          reason,
          previous_hash,
          entry_hash,
          created_at
        )
        VALUES (
          ${userId},
          ${organizationId},
          'first_admin.created',
          'users',
          ${userId},
          'Initial secure system bootstrap',
          ${previousHash},
          ${entryHash},
          ${auditCreatedAt}
        )
        RETURNING id
      )
      SELECT
        u.id,
        u.organization_id AS "organizationId",
        o.name AS "organizationName",
        u.role,
        u.email,
        u.full_name AS "fullName"
      FROM created_user u
      CROSS JOIN created_organization o
    `);
    const [user] = readRows(result);

    if (!user) {
      return { ok: false, reason: "invalid_credentials" };
    }

    return {
      ok: true,
      token,
      expiresAt,
      user: {
        id: user.id,
        organizationId: user.organizationId,
        organizationName: user.organizationName,
        role: user.role,
        email: user.email,
        fullName: user.fullName,
      },
    };
  }

  async createInvitation(input: CreateInvitationInput, actor: AuthenticatedUser) {
    assertCanInvite(actor, input);

    const token = randomBase64Url(INVITATION_TOKEN_BYTES);
    const tokenHash = await sha256Base64Url(token);
    const expiresInDays = Math.min(
      Math.max(1, input.expiresInDays ?? DEFAULT_INVITATION_DAYS),
      MAX_INVITATION_DAYS,
    );
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    const email = input.email.trim().toLowerCase();
    const role = parseRole(input.role);

    const [invitation] = await this.db
      .insert(userInvitations)
      .values({
        organizationId: input.organizationId,
        email,
        role,
        status: "pending",
        tokenHash,
        invitedByUserId: actor.id,
        expiresAt,
      })
      .returning({
        id: userInvitations.id,
        email: userInvitations.email,
        role: userInvitations.role,
        expiresAt: userInvitations.expiresAt,
      });

    await this.recordAuditEvent({
      actorUserId: actor.id,
      actorOrganizationId: actor.organizationId,
      action: "user_invitation.created",
      entityType: "user_invitations",
      entityId: invitation.id,
      reason: `Invited ${email} as ${role}`,
    });

    return {
      ...invitation,
      token,
    };
  }

  async acceptInvitation(input: AcceptInvitationInput): Promise<LoginResult> {
    assertAcceptablePassword(input.password);

    const tokenHash = await sha256Base64Url(input.token);
    const [invitation] = await this.db
      .select({
        id: userInvitations.id,
        organizationId: userInvitations.organizationId,
        organizationName: organizations.name,
        email: userInvitations.email,
        role: userInvitations.role,
        status: userInvitations.status,
        expiresAt: userInvitations.expiresAt,
      })
      .from(userInvitations)
      .innerJoin(organizations, eq(userInvitations.organizationId, organizations.id))
      .where(
        and(
          eq(userInvitations.tokenHash, tokenHash),
          eq(userInvitations.status, "pending"),
          gt(userInvitations.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!invitation) return { ok: false, reason: "invalid_credentials" };

    const existing = await this.findUserByEmail(invitation.email);
    if (existing) {
      return { ok: false, reason: "invalid_credentials" };
    }

    const passwordHash = await hashPassword(input.password);
    const sessionToken = createSessionToken();
    const sessionTokenHash = await hashSessionToken(sessionToken);
    const expiresAt = sessionExpiresAt();
    const fullName = input.fullName.trim();

    const userId = crypto.randomUUID();
    const acceptedAt = new Date();
    const previousHash = await this.getLatestAuditHash();
    const entryHash = await createAuditEntryHash(
      {
        actorUserId: userId,
        actorOrganizationId: invitation.organizationId,
        action: "user_invitation.accepted",
        entityType: "user_invitations",
        entityId: invitation.id,
        reason: "User accepted invitation and created password",
      },
      previousHash,
      acceptedAt,
    );

    const result = await this.db.execute<{
      id: string;
      organizationId: string;
      organizationName: string;
      role: string;
      email: string;
      fullName: string;
    }>(sql`
      WITH selected_invitation AS (
        SELECT
          i.id,
          i.organization_id,
          o.name AS organization_name,
          i.email,
          i.role
        FROM user_invitations i
        INNER JOIN organizations o ON i.organization_id = o.id
        WHERE
          i.id = ${invitation.id}
          AND i.status = 'pending'
          AND i.expires_at > now()
      ),
      created_user AS (
        INSERT INTO users (
          id,
          organization_id,
          role,
          status,
          email,
          full_name,
          password_hash,
          password_updated_at
        )
        SELECT
          ${userId},
          organization_id,
          role,
          'active',
          email,
          ${fullName},
          ${passwordHash},
          ${acceptedAt}
        FROM selected_invitation
        RETURNING id, organization_id, role, email, full_name
      ),
      updated_invitation AS (
        UPDATE user_invitations
        SET
          status = 'accepted',
          accepted_by_user_id = ${userId},
          accepted_at = ${acceptedAt}
        WHERE id IN (SELECT id FROM selected_invitation)
        RETURNING id
      ),
      created_session AS (
        INSERT INTO user_sessions (user_id, status, session_token_hash, expires_at)
        SELECT id, 'active', ${sessionTokenHash}, ${expiresAt}
        FROM created_user
        RETURNING user_id
      ),
      created_login AS (
        INSERT INTO login_events (user_id, email, outcome, reason)
        SELECT id, email, 'success', 'invitation_accepted'
        FROM created_user
        RETURNING id
      ),
      created_audit AS (
        INSERT INTO audit_logs (
          actor_user_id,
          actor_organization_id,
          action,
          entity_type,
          entity_id,
          reason,
          previous_hash,
          entry_hash,
          created_at
        )
        VALUES (
          ${userId},
          ${invitation.organizationId},
          'user_invitation.accepted',
          'user_invitations',
          ${invitation.id},
          'User accepted invitation and created password',
          ${previousHash},
          ${entryHash},
          ${acceptedAt}
        )
        RETURNING id
      )
      SELECT
        u.id,
        u.organization_id AS "organizationId",
        si.organization_name AS "organizationName",
        u.role,
        u.email,
        u.full_name AS "fullName"
      FROM created_user u
      CROSS JOIN selected_invitation si
    `);
    const [user] = readRows(result);

    if (!user) return { ok: false, reason: "invalid_credentials" };

    return {
      ok: true,
      token: sessionToken,
      expiresAt,
      user: {
        id: user.id,
        organizationId: user.organizationId,
        organizationName: user.organizationName,
        role: user.role,
        email: user.email,
        fullName: user.fullName,
      },
    };
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.findUserByEmail(normalizedEmail);

    if (!user) {
      await this.recordLoginEvent({
        email: normalizedEmail,
        outcome: "failed",
        reason: "unknown_email",
      });
      return { ok: false, reason: "invalid_credentials" };
    }

    if (user.status === "disabled") {
      await this.recordLoginEvent({
        userId: user.id,
        email: user.email,
        outcome: "failed",
        reason: "disabled_user",
      });
      return { ok: false, reason: "disabled" };
    }

    if (user.status === "invited") {
      await this.recordLoginEvent({
        userId: user.id,
        email: user.email,
        outcome: "failed",
        reason: "invitation_not_accepted",
      });
      return { ok: false, reason: "invalid_credentials" };
    }

    if (this.isLocked(user)) {
      await this.recordLoginEvent({
        userId: user.id,
        email: user.email,
        outcome: "locked",
        reason: "locked_user",
      });
      return { ok: false, reason: "locked" };
    }

    const validPassword =
      user.passwordHash !== null && (await verifyPassword(password, user.passwordHash));

    if (!validPassword) {
      const reason = await this.recordFailedLogin(user);
      await this.recordLoginEvent({
        userId: user.id,
        email: user.email,
        outcome: reason === "locked" ? "locked" : "failed",
        reason: "invalid_password",
      });
      return { ok: false, reason };
    }

    const token = createSessionToken();
    const tokenHash = await hashSessionToken(token);
    const expiresAt = sessionExpiresAt();

    await this.db.batch([
      this.db
        .update(users)
        .set({
          failedLoginCount: 0,
          status: "active",
          lockedUntil: null,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id)),

      this.db.insert(userSessions).values({
        userId: user.id,
        status: "active",
        sessionTokenHash: tokenHash,
        expiresAt,
      }),

      this.db.insert(loginEvents).values({
        userId: user.id,
        email: user.email,
        outcome: "success",
      }),
    ]);

    return {
      ok: true,
      token,
      expiresAt,
      user: toAuthenticatedUser(user),
    };
  }

  async getUserBySessionToken(token: string | undefined): Promise<AuthenticatedUser | null> {
    if (!token) return null;

    const tokenHash = await hashSessionToken(token);
    const [row] = await this.db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        organizationName: organizations.name,
        role: users.role,
        status: users.status,
        email: users.email,
        fullName: users.fullName,
      })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(
        and(
          eq(userSessions.sessionTokenHash, tokenHash),
          eq(userSessions.status, "active"),
          eq(users.status, "active"),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      role: row.role,
      email: row.email,
      fullName: row.fullName,
    };
  }

  async revokeSession(token: string | undefined): Promise<void> {
    if (!token) return;

    const tokenHash = await hashSessionToken(token);
    await this.db
      .update(userSessions)
      .set({
        status: "revoked",
        revokedAt: new Date(),
      })
      .where(eq(userSessions.sessionTokenHash, tokenHash));
  }

  private async findUserByEmail(email: string): Promise<UserWithOrganization | null> {
    const [row] = await this.db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        organizationName: organizations.name,
        role: users.role,
        status: users.status,
        email: users.email,
        fullName: users.fullName,
        passwordHash: users.passwordHash,
        failedLoginCount: users.failedLoginCount,
        lockedUntil: users.lockedUntil,
      })
      .from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    return row ?? null;
  }

  private isLocked(user: Pick<UserWithOrganization, "status" | "lockedUntil">): boolean {
    return user.status === "locked" && Boolean(user.lockedUntil && user.lockedUntil > new Date());
  }

  private async recordFailedLogin(
    user: Pick<UserWithOrganization, "id" | "failedLoginCount">,
  ): Promise<"invalid_credentials" | "locked"> {
    const failedLoginCount = user.failedLoginCount + 1;
    const shouldLock = failedLoginCount >= MAX_FAILED_LOGINS;
    const lockedUntil = shouldLock
      ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
      : null;

    await this.db
      .update(users)
      .set({
        failedLoginCount,
        status: shouldLock ? "locked" : "active",
        lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return shouldLock ? "locked" : "invalid_credentials";
  }

  private async recordLoginEvent(event: {
    userId?: string;
    email?: string;
    outcome: "success" | "failed" | "locked" | "mfa_required" | "mfa_failed";
    reason?: string;
  }): Promise<void> {
    await this.db.insert(loginEvents).values({
      userId: event.userId,
      email: event.email,
      outcome: event.outcome,
      reason: event.reason,
    });
  }

  async recordAuditEvent(event: {
    actorUserId?: string;
    actorOrganizationId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    reason?: string;
  }): Promise<void> {
    const previousHash = await this.getLatestAuditHash();
    const createdAt = new Date();
    const entryHash = await createAuditEntryHash(event, previousHash, createdAt);

    await this.db.insert(auditLogs).values({
      actorUserId: event.actorUserId,
      actorOrganizationId: event.actorOrganizationId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      reason: event.reason,
      previousHash,
      entryHash,
      createdAt,
    });
  }

  private async getLatestAuditHash(): Promise<string | null> {
    const previous = await this.db
      .select({ entryHash: auditLogs.entryHash })
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);

    return previous[0]?.entryHash ?? null;
  }
}

function toAuthenticatedUser(user: UserWithOrganization): AuthenticatedUser {
  return {
    id: user.id,
    organizationId: user.organizationId,
    organizationName: user.organizationName,
    role: user.role,
    email: user.email,
    fullName: user.fullName,
  };
}

const allowedRoles: UserRole[] = [
  "system_admin",
  "assay_admin",
  "intake_officer",
  "chemist",
  "lab_manager",
  "bom_officer",
  "commercial_bank_user",
  "auditor",
];

function parseRole(role: string): UserRole {
  if (allowedRoles.includes(role as UserRole)) return role as UserRole;
  throw new Error("Unsupported invitation role.");
}

function assertCanInvite(
  actor: AuthenticatedUser,
  input: CreateInvitationInput,
): void {
  if (actor.role === "system_admin") return;

  if (actor.role === "assay_admin") {
    const restrictedRoles = new Set(["system_admin", "bom_officer"]);
    if (
      input.organizationId === actor.organizationId &&
      !restrictedRoles.has(input.role)
    ) {
      return;
    }
  }

  throw new Error("Invitation permission denied.");
}

function readRows<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows;
}

async function createAuditEntryHash(
  event: {
    actorUserId?: string;
    actorOrganizationId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    reason?: string;
  },
  previousHash: string | null,
  createdAt: Date,
): Promise<string> {
  return sha256Base64Url(
    JSON.stringify({
      ...event,
      previousHash,
      createdAt: createdAt.toISOString(),
    }),
  );
}
