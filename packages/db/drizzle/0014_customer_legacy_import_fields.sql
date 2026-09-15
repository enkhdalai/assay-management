ALTER TABLE "customer_organization_profiles"
  ADD COLUMN "postal_address_encrypted" text,
  ADD COLUMN "english_name" varchar(255),
  ADD COLUMN "legacy_type_code" varchar(32);
