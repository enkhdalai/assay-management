CREATE UNIQUE INDEX "customers_legal_entity_name_registration_uidx"
  ON "customers" USING btree ("assay_center_id", lower("display_name"), "registration_number_hash")
  WHERE "type" = 'legal_entity' AND "registration_number_hash" IS NOT NULL;
