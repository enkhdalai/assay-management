import type { AuthenticatedUser } from "../../../../packages/security/src";

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; user: AuthenticatedUser }
  | { ok: false; reason: "invalid_credentials" | "locked" | "disabled" };

export type SetupStatus = {
  configured: boolean;
  needsFirstAdmin: boolean;
};

export type CreateFirstAdminInput = {
  setupToken: string;
  organizationName: string;
  organizationCode: string;
  email: string;
  fullName: string;
  password: string;
};

export type CreateInvitationInput = {
  organizationId: string;
  email: string;
  role: string;
  expiresInDays?: number;
};

export type AcceptInvitationInput = {
  token: string;
  fullName: string;
  password: string;
};

export type AuthStore = {
  login(email: string, password: string): Promise<LoginResult>;
  getUserBySessionToken(token: string | undefined): Promise<AuthenticatedUser | null>;
  revokeSession(token: string | undefined): Promise<void>;
  getSetupStatus(): Promise<SetupStatus>;
  createFirstAdmin(input: CreateFirstAdminInput): Promise<LoginResult>;
  createInvitation(input: CreateInvitationInput, actor: AuthenticatedUser): Promise<{
    id: string;
    email: string;
    role: string;
    expiresAt: Date;
    token: string;
  }>;
  acceptInvitation(input: AcceptInvitationInput): Promise<LoginResult>;
};

export type AuthStoreEnv = {
  DATABASE_URL?: string;
  AUTH_SETUP_TOKEN_HASH?: string;
  AUTH_DEV_LOGIN_ENABLED?: string;
  AUTH_DEV_SEED_EMAIL?: string;
  AUTH_DEV_SEED_PASSWORD?: string;
};
