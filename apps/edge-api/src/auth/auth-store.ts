import {
  assertAcceptablePassword,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  randomBase64Url,
  sessionExpiresAt,
  verifyPassword,
  type AuthenticatedUser,
} from "../../../../packages/security/src";
import { PostgresAuthStore } from "./postgres-auth-store";
import type {
  AcceptInvitationInput,
  AuthStore,
  AuthStoreEnv,
  CreateFirstAdminInput,
  CreateInvitationInput,
  LoginResult,
  SetupStatus,
} from "./auth-types";

type AuthUserRecord = AuthenticatedUser & {
  passwordHash: string;
  status: "active" | "locked" | "disabled";
  failedLoginCount: number;
  lockedUntil: Date | null;
};

type AuthSessionRecord = {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

type InvitationRecord = {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  token: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  invitedByUserId: string;
  expiresAt: Date;
};

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

let devStorePromise: Promise<InMemoryAuthStore> | null = null;
const postgresStores = new Map<string, PostgresAuthStore>();

export function getAuthStore(
  env?: AuthStoreEnv,
): Promise<AuthStore | null> {
  if (env?.DATABASE_URL) {
    const cacheKey = `${env.DATABASE_URL}:${env.AUTH_SETUP_TOKEN_HASH ?? ""}`;
    let store = postgresStores.get(cacheKey);
    if (!store) {
      store = new PostgresAuthStore(env.DATABASE_URL, env.AUTH_SETUP_TOKEN_HASH);
      postgresStores.set(cacheKey, store);
    }
    return Promise.resolve(store);
  }

  if (env?.AUTH_DEV_LOGIN_ENABLED !== "true") return Promise.resolve(null);
  if (!env.AUTH_DEV_SEED_EMAIL || !env.AUTH_DEV_SEED_PASSWORD) {
    return Promise.resolve(null);
  }

  devStorePromise ??= InMemoryAuthStore.createWithDevelopmentUser({
    email: env.AUTH_DEV_SEED_EMAIL,
    password: env.AUTH_DEV_SEED_PASSWORD,
  });

  return devStorePromise;
}

export class InMemoryAuthStore implements AuthStore {
  private constructor(
    private readonly usersByEmail: Map<string, AuthUserRecord>,
    private readonly usersById: Map<string, AuthUserRecord>,
    private readonly sessionsByHash: Map<string, AuthSessionRecord>,
    private readonly invitationsByToken: Map<string, InvitationRecord>,
  ) {}

  static async createWithDevelopmentUser(seed: {
    email: string;
    password: string;
  }): Promise<InMemoryAuthStore> {
    assertAcceptablePassword(seed.password);
    const email = seed.email.trim().toLowerCase();

    const admin: AuthUserRecord = {
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000101",
      organizationName: "Төв сорьцын лаборатори",
      role: "system_admin",
      email,
      fullName: "Системийн админ",
      passwordHash: await hashPassword(seed.password),
      status: "active",
      failedLoginCount: 0,
      lockedUntil: null,
    };

    return new InMemoryAuthStore(
      new Map([[admin.email, admin]]),
      new Map([[admin.id, admin]]),
      new Map(),
      new Map(),
    );
  }

  async getSetupStatus(): Promise<SetupStatus> {
    return {
      configured: true,
      needsFirstAdmin: this.usersById.size === 0,
    };
  }

  async createFirstAdmin(_input: CreateFirstAdminInput): Promise<LoginResult> {
    return { ok: false, reason: "disabled" };
  }

  async createInvitation(input: CreateInvitationInput, actor: AuthenticatedUser) {
    const token = randomBase64Url(32);
    const invitation: InvitationRecord = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      email: input.email.trim().toLowerCase(),
      role: input.role,
      token,
      status: "pending",
      invitedByUserId: actor.id,
      expiresAt: new Date(
        Date.now() + Math.max(1, input.expiresInDays ?? 7) * 24 * 60 * 60 * 1000,
      ),
    };

    this.invitationsByToken.set(token, invitation);

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      token,
    };
  }

  async acceptInvitation(input: AcceptInvitationInput): Promise<LoginResult> {
    const invitation = this.invitationsByToken.get(input.token);
    if (
      !invitation ||
      invitation.status !== "pending" ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      return { ok: false, reason: "invalid_credentials" };
    }

    const email = invitation.email.trim().toLowerCase();
    const user: AuthUserRecord = {
      id: crypto.randomUUID(),
      organizationId: invitation.organizationId,
      organizationName: "Уригдсан байгууллага",
      role: invitation.role,
      email,
      fullName: input.fullName.trim(),
      passwordHash: await hashPassword(input.password),
      status: "active",
      failedLoginCount: 0,
      lockedUntil: null,
    };

    invitation.status = "accepted";
    this.usersByEmail.set(email, user);
    this.usersById.set(user.id, user);

    return this.login(email, input.password);
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = this.usersByEmail.get(normalizedEmail);

    if (!user) return { ok: false, reason: "invalid_credentials" };
    if (user.status === "disabled") return { ok: false, reason: "disabled" };
    if (this.isLocked(user)) return { ok: false, reason: "locked" };

    const validPassword = await verifyPassword(password, user.passwordHash);
    if (!validPassword) {
      this.recordFailedLogin(user);
      return { ok: false, reason: this.isLocked(user) ? "locked" : "invalid_credentials" };
    }

    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.status = "active";

    const token = createSessionToken();
    const tokenHash = await hashSessionToken(token);
    const expiresAt = sessionExpiresAt();

    this.sessionsByHash.set(tokenHash, {
      tokenHash,
      userId: user.id,
      expiresAt,
      revokedAt: null,
    });

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
    const session = this.sessionsByHash.get(tokenHash);
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    const user = this.usersById.get(session.userId);
    if (!user || user.status !== "active") return null;

    return toAuthenticatedUser(user);
  }

  async revokeSession(token: string | undefined): Promise<void> {
    if (!token) return;

    const tokenHash = await hashSessionToken(token);
    const session = this.sessionsByHash.get(tokenHash);
    if (session) session.revokedAt = new Date();
  }

  private isLocked(user: AuthUserRecord): boolean {
    return Boolean(user.lockedUntil && user.lockedUntil.getTime() > Date.now());
  }

  private recordFailedLogin(user: AuthUserRecord): void {
    user.failedLoginCount += 1;
    if (user.failedLoginCount >= MAX_FAILED_LOGINS) {
      user.status = "locked";
      user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
    }
  }
}

function toAuthenticatedUser(user: AuthUserRecord): AuthenticatedUser {
  return {
    id: user.id,
    organizationId: user.organizationId,
    organizationName: user.organizationName,
    role: user.role,
    email: user.email,
    fullName: user.fullName,
  };
}
