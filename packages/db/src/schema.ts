import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const organizationType = pgEnum("organization_type", [
  "private_assay_center",
  "government_assay_center",
  "bank_of_mongolia",
  "commercial_bank",
  "system_operator",
]);

export const organizationStatus = pgEnum("organization_status", [
  "active",
  "suspended",
  "archived",
]);

export const userRole = pgEnum("user_role", [
  "system_admin",
  "assay_admin",
  "intake_officer",
  "chemist",
  "lab_manager",
  "bom_officer",
  "commercial_bank_user",
  "auditor",
]);

export const userStatus = pgEnum("user_status", [
  "invited",
  "active",
  "locked",
  "disabled",
]);

export const customerType = pgEnum("customer_type", [
  "individual",
  "legal_entity",
]);

export const metalType = pgEnum("metal_type", ["gold", "silver"]);

export const assayStatus = pgEnum("assay_status", [
  "draft",
  "received",
  "in_analysis",
  "manager_review",
  "approved",
  "bom_submitted",
  "bom_confirmed",
  "bank_assigned",
  "settlement_pending",
  "settled",
  "closed",
  "cancelled",
]);

export const assayResultStatus = pgEnum("assay_result_status", [
  "draft",
  "submitted",
  "approved",
  "superseded",
  "rejected",
]);

export const allocationStatus = pgEnum("allocation_status", [
  "draft",
  "assigned",
  "visible_to_bank",
  "accepted_by_bank",
  "settlement_pending",
  "settled",
  "cancelled",
]);

export const bomSubmissionStatus = pgEnum("bom_submission_status", [
  "queued",
  "sent",
  "accepted",
  "rejected",
  "failed",
]);

export const bomConfirmationStatus = pgEnum("bom_confirmation_status", [
  "pending",
  "confirmed",
  "rejected",
  "corrected",
  "voided",
]);

export const correctionStatus = pgEnum("correction_status", [
  "requested",
  "approved",
  "rejected",
  "applied",
  "cancelled",
]);

export const apiClientStatus = pgEnum("api_client_status", [
  "active",
  "rotating",
  "suspended",
  "revoked",
]);

export const apiRequestDirection = pgEnum("api_request_direction", [
  "inbound",
  "outbound",
]);

export const certificateStatus = pgEnum("certificate_status", [
  "draft",
  "issued",
  "voided",
]);

export const sessionStatus = pgEnum("session_status", [
  "active",
  "revoked",
  "expired",
]);

export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "expired",
  "revoked",
]);

export const loginEventOutcome = pgEnum("login_event_outcome", [
  "success",
  "failed",
  "locked",
  "mfa_required",
  "mfa_failed",
]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: organizationType("type").notNull(),
    status: organizationStatus("status").default("active").notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    registrationNumber: varchar("registration_number", { length: 64 }),
    contactEmail: varchar("contact_email", { length: 255 }),
    contactPhoneEncrypted: text("contact_phone_encrypted"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("organizations_code_uidx").on(table.code),
    index("organizations_type_idx").on(table.type),
    index("organizations_status_idx").on(table.status),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "restrict" })
      .notNull(),
    role: userRole("role").notNull(),
    status: userStatus("status").default("invited").notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    passwordHash: text("password_hash"),
    passwordUpdatedAt: timestamp("password_updated_at", {
      withTimezone: true,
    }),
    mfaEnabled: boolean("mfa_enabled").default(false).notNull(),
    failedLoginCount: integer("failed_login_count").default(0).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_email_uidx").on(table.email),
    index("users_organization_idx").on(table.organizationId),
    index("users_role_idx").on(table.role),
    index("users_status_idx").on(table.status),
    check("users_failed_login_count_nonnegative", sql`${table.failedLoginCount} >= 0`),
  ],
);

export const userInvitations = pgTable(
  "user_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "restrict" })
      .notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    role: userRole("role").notNull(),
    status: invitationStatus("status").default("pending").notNull(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    invitedByUserId: uuid("invited_by_user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_invitations_token_hash_uidx").on(table.tokenHash),
    index("user_invitations_email_status_idx").on(table.email, table.status),
    index("user_invitations_organization_idx").on(table.organizationId),
    check(
      "user_invitations_maker_checker",
      sql`${table.acceptedByUserId} IS NULL OR ${table.acceptedByUserId} <> ${table.invitedByUserId}`,
    ),
  ],
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    status: sessionStatus("status").default("active").notNull(),
    sessionTokenHash: varchar("session_token_hash", { length: 128 }).notNull(),
    refreshTokenHash: varchar("refresh_token_hash", { length: 128 }),
    ipHash: varchar("ip_hash", { length: 128 }),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_sessions_session_token_uidx").on(table.sessionTokenHash),
    uniqueIndex("user_sessions_refresh_token_uidx").on(table.refreshTokenHash),
    index("user_sessions_user_status_idx").on(table.userId, table.status),
    index("user_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const loginEvents = pgTable(
  "login_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    email: varchar("email", { length: 255 }),
    outcome: loginEventOutcome("outcome").notNull(),
    ipHash: varchar("ip_hash", { length: 128 }),
    userAgent: text("user_agent"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("login_events_user_created_idx").on(table.userId, table.createdAt),
    index("login_events_email_created_idx").on(table.email, table.createdAt),
    index("login_events_outcome_idx").on(table.outcome),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: customerType("type").notNull(),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    registrationNumberEncrypted: text("registration_number_encrypted"),
    registrationNumberHash: varchar("registration_number_hash", {
      length: 128,
    }),
    phoneEncrypted: text("phone_encrypted"),
    phoneHash: varchar("phone_hash", { length: 128 }),
    emailEncrypted: text("email_encrypted"),
    addressEncrypted: text("address_encrypted"),
    createdByUserId: uuid("created_by_user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("customers_type_idx").on(table.type),
    index("customers_display_name_idx").on(table.displayName),
    index("customers_registration_hash_idx").on(table.registrationNumberHash),
    index("customers_phone_hash_idx").on(table.phoneHash),
  ],
);

export const customerOrganizationProfiles = pgTable(
  "customer_organization_profiles",
  {
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }).primaryKey(),
    depositName: varchar("deposit_name", { length: 255 }),
    branchName: varchar("branch_name", { length: 255 }),
    organizationKind: varchar("organization_kind", { length: 120 }),
    bankName: varchar("bank_name", { length: 255 }),
    bankAccountEncrypted: text("bank_account_encrypted"),
    province: varchar("province", { length: 120 }),
    district: varchar("district", { length: 120 }),
    bag: varchar("bag", { length: 120 }),
    mineInitialNumber: varchar("mine_initial_number", { length: 80 }),
    contactName: varchar("contact_name", { length: 255 }),
    contactPhoneEncrypted: text("contact_phone_encrypted"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("customer_org_profiles_deposit_idx").on(table.depositName)],
);

export const bullionIntakeBatches = pgTable(
  "bullion_intake_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: varchar("public_id", { length: 40 }).notNull(),
    assayCenterId: uuid("assay_center_id").references(() => organizations.id, { onDelete: "restrict" }).notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "restrict" }).notNull(),
    receivedByUserId: uuid("received_by_user_id").references(() => users.id, { onDelete: "restrict" }).notNull(),
    metal: metalType("metal").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    branchName: varchar("branch_name", { length: 255 }),
    province: varchar("province", { length: 120 }),
    district: varchar("district", { length: 120 }),
    dispatchReference: varchar("dispatch_reference", { length: 120 }),
    initialBullionNumber: varchar("initial_bullion_number", { length: 80 }),
    pieceCount: integer("piece_count").notNull(),
    delta: numeric("delta", { precision: 14, scale: 6 }).default("0").notNull(),
    status: varchar("status", { length: 32 }).default("draft").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("bullion_intake_batches_public_id_uidx").on(table.publicId),
    index("bullion_intake_batches_customer_received_idx").on(table.customerId, table.receivedAt),
    check("bullion_intake_batches_piece_count_positive", sql`${table.pieceCount} > 0`),
  ],
);

export const bullionIntakeItems = pgTable(
  "bullion_intake_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id").references(() => bullionIntakeBatches.id, { onDelete: "cascade" }).notNull(),
    sequenceNo: integer("sequence_no").notNull(),
    analysisNo: varchar("analysis_no", { length: 80 }),
    bullionNo: varchar("bullion_no", { length: 80 }).notNull(),
    grossWeightBeforeGrams: numeric("gross_weight_before_grams", { precision: 14, scale: 4 }).notNull(),
    grossWeightAfterGrams: numeric("gross_weight_after_grams", { precision: 14, scale: 4 }),
    slagWeightGrams: numeric("slag_weight_grams", { precision: 14, scale: 4 }),
    sampleWeightMilligrams: numeric("sample_weight_milligrams", { precision: 14, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("bullion_intake_items_batch_sequence_uidx").on(table.batchId, table.sequenceNo),
    index("bullion_intake_items_bullion_no_idx").on(table.bullionNo),
    check("bullion_intake_items_weight_positive", sql`${table.grossWeightBeforeGrams} > 0`),
  ],
);

export const bullionExaminationRevisions = pgTable(
  "bullion_examination_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bullionItemId: uuid("bullion_item_id").references(() => bullionIntakeItems.id, { onDelete: "cascade" }).notNull(),
    revisionNo: integer("revision_no").notNull(),
    examinationNo: varchar("examination_no", { length: 80 }).notNull(),
    enteredByUserId: uuid("entered_by_user_id").references(() => users.id, { onDelete: "restrict" }).notNull(),
    status: assayResultStatus("status").default("draft").notNull(),
    delta: numeric("delta", { precision: 14, scale: 6 }).default("0").notNull(),
    sampleWeightGrams: numeric("sample_weight_grams", { precision: 14, scale: 4 }).notNull(),
    weightEntries: jsonb("weight_entries").default([]).notNull(),
    measurementEntries: jsonb("measurement_entries").default([]).notNull(),
    goldResult: numeric("gold_result", { precision: 12, scale: 6 }),
    silverResult: numeric("silver_result", { precision: 12, scale: 6 }),
    reexaminationRequested: boolean("reexamination_requested").default(false).notNull(),
    notes: text("notes"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("bullion_examinations_item_revision_uidx").on(table.bullionItemId, table.revisionNo),
    index("bullion_examinations_status_idx").on(table.status),
    check("bullion_examinations_revision_positive", sql`${table.revisionNo} > 0`),
    check("bullion_examinations_sample_weight_positive", sql`${table.sampleWeightGrams} > 0`),
  ],
);

export const assayRecords = pgTable(
  "assay_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: varchar("public_id", { length: 32 }).notNull(),
    assayCenterId: uuid("assay_center_id")
      .references(() => organizations.id, { onDelete: "restrict" })
      .notNull(),
    customerId: uuid("customer_id")
      .references(() => customers.id, { onDelete: "restrict" })
      .notNull(),
    intakeOfficerId: uuid("intake_officer_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    metal: metalType("metal").notNull(),
    declaredGrossWeightGrams: numeric("declared_gross_weight_grams", {
      precision: 14,
      scale: 4,
    }).notNull(),
    receivedGrossWeightGrams: numeric("received_gross_weight_grams", {
      precision: 14,
      scale: 4,
    }).notNull(),
    status: assayStatus("status").default("draft").notNull(),
    customerInstruction: text("customer_instruction"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedByUserId: uuid("locked_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    lockReason: text("lock_reason"),
    currentResultRevision: integer("current_result_revision"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("assay_records_public_id_uidx").on(table.publicId),
    index("assay_records_center_status_idx").on(table.assayCenterId, table.status),
    index("assay_records_customer_idx").on(table.customerId),
    index("assay_records_received_at_idx").on(table.receivedAt),
    check(
      "assay_records_declared_weight_positive",
      sql`${table.declaredGrossWeightGrams} > 0`,
    ),
    check(
      "assay_records_received_weight_positive",
      sql`${table.receivedGrossWeightGrams} > 0`,
    ),
  ],
);

export const assaySamples = pgTable(
  "assay_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assayRecordId: uuid("assay_record_id")
      .references(() => assayRecords.id, { onDelete: "cascade" })
      .notNull(),
    sampleNo: integer("sample_no").notNull(),
    sealNumber: varchar("seal_number", { length: 80 }),
    containerLabel: varchar("container_label", { length: 120 }),
    sampleWeightGrams: numeric("sample_weight_grams", {
      precision: 14,
      scale: 4,
    }).notNull(),
    receivedByUserId: uuid("received_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    labReceivedAt: timestamp("lab_received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("assay_samples_record_no_uidx").on(
      table.assayRecordId,
      table.sampleNo,
    ),
    index("assay_samples_seal_number_idx").on(table.sealNumber),
    check("assay_samples_sample_no_positive", sql`${table.sampleNo} > 0`),
    check(
      "assay_samples_weight_positive",
      sql`${table.sampleWeightGrams} > 0`,
    ),
  ],
);

export const bankAllocations = pgTable(
  "bank_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assayRecordId: uuid("assay_record_id")
      .references(() => assayRecords.id, { onDelete: "cascade" })
      .notNull(),
    bankOrganizationId: uuid("bank_organization_id")
      .references(() => organizations.id, { onDelete: "restrict" })
      .notNull(),
    allocatedGrossWeightGrams: numeric("allocated_gross_weight_grams", {
      precision: 14,
      scale: 4,
    }).notNull(),
    customerInstructionNote: text("customer_instruction_note"),
    status: allocationStatus("status").default("draft").notNull(),
    visibleToBankAt: timestamp("visible_to_bank_at", { withTimezone: true }),
    acceptedByBankUserId: uuid("accepted_by_bank_user_id").references(
      () => users.id,
      { onDelete: "restrict" },
    ),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("bank_allocations_record_bank_uidx").on(
      table.assayRecordId,
      table.bankOrganizationId,
    ),
    index("bank_allocations_bank_status_idx").on(
      table.bankOrganizationId,
      table.status,
    ),
    check(
      "bank_allocations_weight_positive",
      sql`${table.allocatedGrossWeightGrams} > 0`,
    ),
  ],
);

export const assayResultRevisions = pgTable(
  "assay_result_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assayRecordId: uuid("assay_record_id")
      .references(() => assayRecords.id, { onDelete: "cascade" })
      .notNull(),
    revisionNo: integer("revision_no").notNull(),
    status: assayResultStatus("status").default("draft").notNull(),
    enteredByUserId: uuid("entered_by_user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    methodName: varchar("method_name", { length: 120 }).notNull(),
    instrumentName: varchar("instrument_name", { length: 120 }),
    grossWeightGrams: numeric("gross_weight_grams", {
      precision: 14,
      scale: 4,
    }).notNull(),
    purityPercent: numeric("purity_percent", {
      precision: 7,
      scale: 4,
    }).notNull(),
    fineWeightGrams: numeric("fine_weight_grams", {
      precision: 14,
      scale: 4,
    }).notNull(),
    silverContentPercent: numeric("silver_content_percent", {
      precision: 7,
      scale: 4,
    }),
    goldContentPercent: numeric("gold_content_percent", {
      precision: 7,
      scale: 4,
    }),
    resultNotes: text("result_notes"),
    correctionReason: text("correction_reason"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("assay_result_revisions_record_revision_uidx").on(
      table.assayRecordId,
      table.revisionNo,
    ),
    index("assay_result_revisions_record_status_idx").on(
      table.assayRecordId,
      table.status,
    ),
    check("assay_result_revisions_revision_positive", sql`${table.revisionNo} > 0`),
    check(
      "assay_result_revisions_gross_weight_positive",
      sql`${table.grossWeightGrams} > 0`,
    ),
    check(
      "assay_result_revisions_purity_range",
      sql`${table.purityPercent} >= 0 AND ${table.purityPercent} <= 100`,
    ),
    check(
      "assay_result_revisions_fine_weight_nonnegative",
      sql`${table.fineWeightGrams} >= 0`,
    ),
    check(
      "assay_result_revisions_maker_checker",
      sql`${table.approvedByUserId} IS NULL OR ${table.approvedByUserId} <> ${table.enteredByUserId}`,
    ),
  ],
);

export const bomSubmissions = pgTable(
  "bom_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assayRecordId: uuid("assay_record_id")
      .references(() => assayRecords.id, { onDelete: "cascade" })
      .notNull(),
    resultRevisionId: uuid("result_revision_id")
      .references(() => assayResultRevisions.id, { onDelete: "restrict" })
      .notNull(),
    status: bomSubmissionStatus("status").default("queued").notNull(),
    submittedByUserId: uuid("submitted_by_user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 128 }).notNull(),
    bomReference: varchar("bom_reference", { length: 120 }),
    responseCode: varchar("response_code", { length: 64 }),
    responseBodyHash: varchar("response_body_hash", { length: 128 }),
    errorMessage: text("error_message"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("bom_submissions_idempotency_uidx").on(table.idempotencyKey),
    index("bom_submissions_record_status_idx").on(
      table.assayRecordId,
      table.status,
    ),
  ],
);

export const bomConfirmations = pgTable(
  "bom_confirmations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assayRecordId: uuid("assay_record_id")
      .references(() => assayRecords.id, { onDelete: "cascade" })
      .notNull(),
    resultRevisionId: uuid("result_revision_id")
      .references(() => assayResultRevisions.id, { onDelete: "restrict" })
      .notNull(),
    confirmationNo: varchar("confirmation_no", { length: 80 }).notNull(),
    versionNo: integer("version_no").default(1).notNull(),
    status: bomConfirmationStatus("status").default("pending").notNull(),
    confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    pricePerGramMnt: numeric("price_per_gram_mnt", {
      precision: 18,
      scale: 4,
    }),
    calculatedGrossAmountMnt: numeric("calculated_gross_amount_mnt", {
      precision: 18,
      scale: 2,
    }),
    deductionAmountMnt: numeric("deduction_amount_mnt", {
      precision: 18,
      scale: 2,
    }).default("0").notNull(),
    netPayableAmountMnt: numeric("net_payable_amount_mnt", {
      precision: 18,
      scale: 2,
    }),
    calculationPayloadHash: varchar("calculation_payload_hash", {
      length: 128,
    }),
    confirmationNotes: text("confirmation_notes"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("bom_confirmations_no_version_uidx").on(
      table.confirmationNo,
      table.versionNo,
    ),
    index("bom_confirmations_record_status_idx").on(
      table.assayRecordId,
      table.status,
    ),
    check("bom_confirmations_version_positive", sql`${table.versionNo} > 0`),
    check(
      "bom_confirmations_price_positive_or_null",
      sql`${table.pricePerGramMnt} IS NULL OR ${table.pricePerGramMnt} > 0`,
    ),
    check(
      "bom_confirmations_deduction_nonnegative",
      sql`${table.deductionAmountMnt} >= 0`,
    ),
  ],
);

export const bomConfirmationAllocations = pgTable(
  "bom_confirmation_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bomConfirmationId: uuid("bom_confirmation_id")
      .references(() => bomConfirmations.id, { onDelete: "cascade" })
      .notNull(),
    bankAllocationId: uuid("bank_allocation_id")
      .references(() => bankAllocations.id, { onDelete: "restrict" })
      .notNull(),
    allocatedGrossWeightGrams: numeric("allocated_gross_weight_grams", {
      precision: 14,
      scale: 4,
    }).notNull(),
    allocatedFineWeightGrams: numeric("allocated_fine_weight_grams", {
      precision: 14,
      scale: 4,
    }).notNull(),
    pricePerGramMnt: numeric("price_per_gram_mnt", {
      precision: 18,
      scale: 4,
    }),
    calculatedGrossAmountMnt: numeric("calculated_gross_amount_mnt", {
      precision: 18,
      scale: 2,
    }),
    deductionAmountMnt: numeric("deduction_amount_mnt", {
      precision: 18,
      scale: 2,
    }).default("0").notNull(),
    netPayableAmountMnt: numeric("net_payable_amount_mnt", {
      precision: 18,
      scale: 2,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("bom_confirmation_allocations_confirmation_allocation_uidx").on(
      table.bomConfirmationId,
      table.bankAllocationId,
    ),
    index("bom_confirmation_allocations_allocation_idx").on(
      table.bankAllocationId,
    ),
    check(
      "bom_confirmation_allocations_gross_weight_positive",
      sql`${table.allocatedGrossWeightGrams} > 0`,
    ),
    check(
      "bom_confirmation_allocations_fine_weight_nonnegative",
      sql`${table.allocatedFineWeightGrams} >= 0`,
    ),
    check(
      "bom_confirmation_allocations_deduction_nonnegative",
      sql`${table.deductionAmountMnt} >= 0`,
    ),
  ],
);

export const bankSettlements = pgTable(
  "bank_settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bankAllocationId: uuid("bank_allocation_id")
      .references(() => bankAllocations.id, { onDelete: "restrict" })
      .notNull(),
    bomConfirmationAllocationId: uuid("bom_confirmation_allocation_id")
      .references(() => bomConfirmationAllocations.id, { onDelete: "restrict" })
      .notNull(),
    bankUserId: uuid("bank_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    settlementReference: varchar("settlement_reference", { length: 120 }),
    payableAmountMnt: numeric("payable_amount_mnt", {
      precision: 18,
      scale: 2,
    }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("bank_settlements_allocation_uidx").on(table.bankAllocationId),
    index("bank_settlements_confirmation_allocation_idx").on(
      table.bomConfirmationAllocationId,
    ),
    check(
      "bank_settlements_payable_nonnegative",
      sql`${table.payableAmountMnt} IS NULL OR ${table.payableAmountMnt} >= 0`,
    ),
  ],
);

export const correctionRequests = pgTable(
  "correction_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assayRecordId: uuid("assay_record_id")
      .references(() => assayRecords.id, { onDelete: "cascade" })
      .notNull(),
    requestedByUserId: uuid("requested_by_user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    status: correctionStatus("status").default("requested").notNull(),
    reason: text("reason").notNull(),
    targetEntityType: varchar("target_entity_type", { length: 80 }).notNull(),
    targetEntityId: uuid("target_entity_id").notNull(),
    proposedChanges: jsonb("proposed_changes").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("correction_requests_record_status_idx").on(
      table.assayRecordId,
      table.status,
    ),
    check(
      "correction_requests_maker_checker",
      sql`${table.reviewedByUserId} IS NULL OR ${table.reviewedByUserId} <> ${table.requestedByUserId}`,
    ),
  ],
);

export const assayCertificates = pgTable(
  "assay_certificates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assayRecordId: uuid("assay_record_id")
      .references(() => assayRecords.id, { onDelete: "cascade" })
      .notNull(),
    resultRevisionId: uuid("result_revision_id")
      .references(() => assayResultRevisions.id, { onDelete: "restrict" })
      .notNull(),
    certificateNo: varchar("certificate_no", { length: 80 }).notNull(),
    status: certificateStatus("status").default("draft").notNull(),
    issuedByUserId: uuid("issued_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    documentHash: varchar("document_hash", { length: 128 }),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("assay_certificates_no_uidx").on(table.certificateNo),
    index("assay_certificates_record_idx").on(table.assayRecordId),
  ],
);

export const apiClients = pgTable(
  "api_clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "restrict" })
      .notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    clientId: varchar("client_id", { length: 120 }).notNull(),
    secretHash: text("secret_hash").notNull(),
    status: apiClientStatus("status").default("active").notNull(),
    scopes: text("scopes").array().default([]).notNull(),
    allowedIpCidrs: text("allowed_ip_cidrs").array().default([]).notNull(),
    requireHmac: boolean("require_hmac").default(true).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("api_clients_client_id_uidx").on(table.clientId),
    index("api_clients_organization_idx").on(table.organizationId),
    index("api_clients_status_idx").on(table.status),
  ],
);

export const apiRequestLogs = pgTable(
  "api_request_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    apiClientId: uuid("api_client_id").references(() => apiClients.id, {
      onDelete: "set null",
    }),
    direction: apiRequestDirection("direction").notNull(),
    requestId: varchar("request_id", { length: 128 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    method: varchar("method", { length: 12 }).notNull(),
    path: text("path").notNull(),
    statusCode: integer("status_code"),
    requestHash: varchar("request_hash", { length: 128 }),
    responseHash: varchar("response_hash", { length: 128 }),
    ipHash: varchar("ip_hash", { length: 128 }),
    userAgent: text("user_agent"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("api_request_logs_request_id_uidx").on(table.requestId),
    index("api_request_logs_client_created_idx").on(
      table.apiClientId,
      table.createdAt,
    ),
    index("api_request_logs_idempotency_idx").on(table.idempotencyKey),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorOrganizationId: uuid("actor_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    action: varchar("action", { length: 120 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: uuid("entity_id"),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    reason: text("reason"),
    requestId: varchar("request_id", { length: 128 }),
    ipHash: varchar("ip_hash", { length: 128 }),
    userAgent: text("user_agent"),
    previousHash: varchar("previous_hash", { length: 128 }),
    entryHash: varchar("entry_hash", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("audit_logs_entry_hash_uidx").on(table.entryHash),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_actor_created_idx").on(table.actorUserId, table.createdAt),
    index("audit_logs_request_idx").on(table.requestId),
  ],
);

export const userOrganizationAccess = pgTable(
  "user_organization_access",
  {
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    organizationId: uuid("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.organizationId],
      name: "user_organization_access_pk",
    }),
  ],
);
