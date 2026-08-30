import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import {
  createDatabase,
  organizations,
  type AppDatabase,
  users,
} from "../../../../packages/db/src";
import type { ManagedUser } from "../../../../packages/shared/src";
import type { AuthenticatedUser } from "../../../../packages/security/src";
import type { EdgeApiEnv } from "../app";
import { getAuthenticatedUserFromRequest } from "../auth/http";

export const userRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

userRoutes.get("/", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (user.role !== "system_admin") {
    return c.json({ ok: false, message: "Хэрэглэгч удирдах эрхгүй байна." }, 403);
  }

  const records = c.env.DATABASE_URL
    ? await listUsersFromDatabase(createDatabase(c.env.DATABASE_URL))
    : [currentUserAsManagedUser(user)];

  return c.json({ ok: true, data: records });
});

async function listUsersFromDatabase(db: AppDatabase): Promise<ManagedUser[]> {
  const records = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      status: users.status,
      organizationId: users.organizationId,
      organizationName: organizations.name,
      organizationType: organizations.type,
      mfaEnabled: users.mfaEnabled,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .innerJoin(organizations, eq(users.organizationId, organizations.id))
    .orderBy(desc(users.createdAt));

  return records.map((record) => ({
    ...record,
    lastLoginAt: record.lastLoginAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  }));
}

function currentUserAsManagedUser(user: AuthenticatedUser): ManagedUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role as ManagedUser["role"],
    status: "active",
    organizationId: user.organizationId,
    organizationName: user.organizationName,
    organizationType: "private_assay_center",
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: new Date(0).toISOString(),
  };
}
