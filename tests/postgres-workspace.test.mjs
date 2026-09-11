import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("examination numbering backfills existing samples without changing UUIDs", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE bullion_intake_items (id uuid PRIMARY KEY, analysis_no text)");
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) await db.query("INSERT INTO bullion_intake_items VALUES ($1::uuid, $2::text)", [id, id]);
    await db.exec(await readFile(new URL("../packages/db/drizzle/0003_outgoing_gabe_jones.sql", import.meta.url), "utf8"));
    const rows = (await db.query("SELECT * FROM bullion_intake_items ORDER BY examination_number")).rows;
    assert.deepEqual(rows.map((row) => row.examination_number), [1, 2]);
    assert.deepEqual(new Set(rows.map((row) => row.id)), new Set(ids));
    assert(rows.every((row) => row.analysis_no === row.id));
    const next = await db.query("INSERT INTO bullion_intake_items (id) VALUES ($1) RETURNING examination_number", [randomUUID()]);
    assert.equal(next.rows[0].examination_number, 3);
  } finally { await db.close(); }
});

test("batch registration migration formats legacy records per assay center", async () => {
  const db = new PGlite();
  try {
    for (const migration of ["0000_even_falcon.sql", "0001_flashy_william_stryker.sql", "0002_happy_glorian.sql", "0003_outgoing_gabe_jones.sql", "0004_request_certificates.sql", "0005_annual_certificate_numbers.sql"]) {
      await db.exec(await readFile(new URL(`../packages/db/drizzle/${migration}`, import.meta.url), "utf8"));
    }
    const [privateCenter, publicCenter, otherPublicCenter] = [randomUUID(), randomUUID(), randomUUID()];
    const [privateUser, publicUser, otherPublicUser] = [randomUUID(), randomUUID(), randomUUID()];
    const [privateCustomer, publicCustomer, otherPublicCustomer] = [randomUUID(), randomUUID(), randomUUID()];
    const batchIds = Array.from({ length: 4 }, randomUUID);
    await db.query("INSERT INTO organizations (id, code, name, type) VALUES ($1, 'PRIVATE', 'Private', 'private_assay_center'), ($2, 'PUBLIC', 'Public', 'government_assay_center'), ($3, 'PUBLIC2', 'Public 2', 'government_assay_center')", [privateCenter, publicCenter, otherPublicCenter]);
    await db.query("INSERT INTO users (id, organization_id, email, full_name, role) VALUES ($1, $2, 'private@test', 'Private user', 'intake_officer'), ($3, $4, 'public@test', 'Public user', 'intake_officer'), ($5, $6, 'public2@test', 'Public 2 user', 'intake_officer')", [privateUser, privateCenter, publicUser, publicCenter, otherPublicUser, otherPublicCenter]);
    await db.query("INSERT INTO customers (id, created_by_user_id, type, display_name) VALUES ($1, $2, 'individual', 'Private customer'), ($3, $4, 'individual', 'Public customer'), ($5, $6, 'individual', 'Public 2 customer')", [privateCustomer, privateUser, publicCustomer, publicUser, otherPublicCustomer, otherPublicUser]);
    await db.query("INSERT INTO bullion_intake_batches (id, public_id, assay_center_id, customer_id, received_by_user_id, metal, piece_count, created_at) VALUES ($1, 'BI-OLD-1', $2, $3, $4, 'gold', 1, '2026-01-01'), ($5, 'BI-OLD-2', $2, $3, $4, 'gold', 1, '2026-01-02'), ($6, 'BI-OLD-3', $7, $8, $9, 'gold', 1, '2026-01-01'), ($10, 'BI-OLD-4', $11, $12, $13, 'gold', 1, '2026-01-01')", [batchIds[0], privateCenter, privateCustomer, privateUser, batchIds[1], batchIds[2], publicCenter, publicCustomer, publicUser, batchIds[3], otherPublicCenter, otherPublicCustomer, otherPublicUser]);
    await db.exec(await readFile(new URL("../packages/db/drizzle/0006_batch_registration_numbers.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../packages/db/drizzle/0007_oval_domino.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../packages/db/drizzle/0008_customer_assay_center_ownership.sql", import.meta.url), "utf8"));
    const rows = (await db.query("SELECT assay_center_id, public_id FROM bullion_intake_batches ORDER BY created_at, id")).rows;
    assert.deepEqual(rows.filter(row => row.assay_center_id === privateCenter).map(row => row.public_id), ["550001", "550002"]);
    assert.deepEqual(rows.filter(row => row.assay_center_id === publicCenter).map(row => row.public_id), ["0001"]);
    assert.deepEqual(rows.filter(row => row.assay_center_id === otherPublicCenter).map(row => row.public_id), ["0001"]);
  } finally { await db.close(); }
});

test("PostgreSQL routes enforce tenant scope and persist staff and intake audits atomically", async () => {
  const database = new PGlite();
  const originalFetch = globalThis.fetch;
  const sqlErrors = [];
  try {
    for (const migration of ["0000_even_falcon.sql", "0001_flashy_william_stryker.sql", "0002_happy_glorian.sql", "0003_outgoing_gabe_jones.sql", "0004_request_certificates.sql", "0005_annual_certificate_numbers.sql", "0006_batch_registration_numbers.sql", "0007_oval_domino.sql", "0008_customer_assay_center_ownership.sql", "0009_bullion_examination_approval.sql", "0010_integration_publications.sql", "0011_unique_legal_entity_customer.sql", "0012_certificate_signature_evidence.sql"]) {
      await database.exec(await readFile(new URL(`../packages/db/drizzle/${migration}`, import.meta.url), "utf8"));
    }
    // Emulate Neon's HTTP wire format against a disposable PostgreSQL engine.
    globalThis.fetch = async (url, init) => {
      assert.equal(new URL(url).hostname, "api.example.test");
      const payload = JSON.parse(init.body);
      async function execute(client, query) {
        const result = await client.query(query.query, query.params);
        return { fields: result.fields, rowCount: result.affectedRows ?? result.rows.length,
          rows: result.rows.map((row) => result.fields.map((field) => {
            const value = row[field.name];
            if (value == null) return null;
            if (value instanceof Date) return value.toISOString();
            if (typeof value === "object") return JSON.stringify(value);
            if (typeof value === "boolean") return value ? "t" : "f";
            return String(value);
          })) };
      }
      try {
        const data = payload.queries
          ? { results: await database.transaction(async (transaction) => {
              const results = []; for (const query of payload.queries) results.push(await execute(transaction, query)); return results;
            }) }
          : await execute(database, payload);
        return Response.json(data);
      } catch (error) {
        sqlErrors.push(error.message);
        return Response.json({ message: error.message, code: error.code }, { status: 400 });
      }
    };
    const center = randomUUID(), foreignCenter = randomUUID();
    await database.query("INSERT INTO organizations (id, code, name, type) VALUES ($1, 'TEST-A', 'Test A', 'private_assay_center'), ($2, 'TEST-B', 'Test B', 'government_assay_center')", [center, foreignCenter]);
    async function user(role, organizationId = center) {
      const id = randomUUID(), token = randomUUID();
      await database.query("INSERT INTO users (id, organization_id, email, full_name, role, status) VALUES ($1, $2, $3, $4, $5, 'active')", [id, organizationId, `${id}@example.test`, `Test ${role}`, role]);
      await database.query("INSERT INTO user_sessions (user_id, session_token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')", [id, createHash("sha256").update(token).digest("base64url")]);
      return { id, cookie: `assay_session=${token}` };
    }
    const le = await user("lab_manager"), melter = await user("intake_officer"), chemist = await user("chemist"), foreign = await user("lab_manager", foreignCenter);
    const { default: worker } = await import(`../dist/server/index.js?postgres=${randomUUID()}`);
    const env = { DATABASE_URL: "postgresql://test:test@db.example.test/test", FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"), RATE_LIMITING_ENABLED: "false", ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
    async function request(path, actor, method = "GET", body) {
      const response = await worker.fetch(new Request(`http://localhost${path}`, { method, headers: { cookie: actor.cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {}, passThroughOnException() {} });
      assert.notEqual(response.status, 500, sqlErrors.join("\n"));
      return response;
    }
    const staff = (await (await request("/api/v1/users", le)).json()).data;
    assert.equal(staff.length, 3);
    assert(staff.every((record) => record.organizationId === center));
    const customerResponse = await request("/api/v1/customers", le, "POST", { type: "legal_entity", displayName: "SQL Mining Company", registrationNumber: "1234567" });
    assert.equal(customerResponse.status, 201);
    const customer = (await customerResponse.json()).record;
    assert.equal((await request("/api/v1/customers", le, "POST", { type: "legal_entity", displayName: "sql mining company", registrationNumber: "1234567" })).status, 409);
    const customerDetail = (await (await request(`/api/v1/customers/${customer.id}`, le)).json()).data;
    assert.equal(customerDetail.registrationNumber, "1234567");
    const customerUpdate = await request(`/api/v1/customers/${customer.id}`, le, "PATCH", {
      type: "legal_entity", displayName: "SQL Mining Company", registrationNumber: "1234567", phone: "99112233",
      organizationProfile: { depositName: "Test deposit", province: "Ulaanbaatar", district: "Khan-Uul" },
    });
    assert.equal(customerUpdate.status, 200);
    const updatedCustomer = (await customerUpdate.json()).data;
    assert.equal(updatedCustomer.phone, "99112233");
    assert.equal(updatedCustomer.organizationProfile.depositName, "Test deposit");
    const nextPath = `/api/v1/bullion/intakes/next-number?customerId=${customer.id}`;
    assert.equal((await (await request(nextPath, melter)).json()).nextNumber, "0001");
    assert.equal((await request(nextPath, foreign)).status, 404);
    assert.equal((await request(nextPath, chemist)).status, 403);
    const intake = await request("/api/v1/bullion/intakes", melter, "POST", { customerId: customer.id, metal: "gold", status: "draft", delta: -0.03125, items: [{ bullionNo: "1", grossWeightBeforeGrams: 100 }] });
    assert.equal(intake.status, 201);
    const batch = (await intake.json()).record;
    assert.equal(batch.publicId, "550001");
    assert.equal(batch.initialBullionNumber, "0001");
    assert.equal(batch.items[0].bullionNo, "0001");
    assert.equal((await (await request(nextPath, le)).json()).nextNumber, "0002");
    const item = batch.items[0];
    const weights = { status: "draft", items: [{ id: item.id, grossWeightAfterGrams: 99.5, slagWeightGrams: 999 }] };
    assert.equal((await request(`/api/v1/bullion/intakes/${batch.id}`, melter, "PATCH", { status: "ready_for_sampling", items: [{ id: item.id }] })).status, 400);
    assert.equal((await request(`/api/v1/bullion/intakes/${batch.id}`, melter, "PATCH", { status: "ready_for_sampling", items: [{ id: item.id, grossWeightAfterGrams: 0 }] })).status, 400);
    assert.equal((await request(`/api/v1/bullion/intakes/${batch.id}`, melter, "PATCH", { status: "ready_for_sampling", items: [{ id: item.id, grossWeightAfterGrams: 101 }] })).status, 409);
    assert.equal((await request(`/api/v1/bullion/intakes/${batch.id}`, foreign, "PATCH", weights)).status, 409);
    assert.equal((await request(`/api/v1/bullion/intakes/${batch.id}`, melter, "PATCH", weights)).status, 200);
    const savedSlag = (await database.query("SELECT slag_weight_grams::float AS slag FROM bullion_intake_items WHERE id = $1", [item.id])).rows[0];
    assert.equal(savedSlag.slag, 0.5);
    assert.equal((await request(`/api/v1/bullion/intakes/${batch.id}`, melter, "PATCH", { ...weights, status: "ready_for_sampling" })).status, 200);
    assert.equal((await request(`/api/v1/bullion/intakes/${batch.id}`, melter, "PATCH", weights)).status, 409);
    const sampling = { status: "sample_taken", items: [{ ...weights.items[0], sampleWeightMilligrams: 2000 }] };
    assert.equal((await request(`/api/v1/bullion/intakes/${batch.id}`, le, "PATCH", sampling)).status, 200);
    const samples = (await (await request("/api/v1/bullion/samples", chemist)).json()).data;
    assert.equal((await (await request("/api/auth/me", chemist)).json()).user.organizationType, "private_assay_center");
    assert.equal(samples.length, 1);
    assert.equal(samples[0].sampleWeightMilligrams, 2000);
    assert.doesNotMatch(JSON.stringify(samples), /SQL Mining|customerName|customerId/);
    assert.equal((await (await request("/api/v1/bullion/samples", foreign)).json()).data.length, 0);
    const exam = { bullionItemId: item.id, examinationNo: samples[0].analysisNo, sampleWeightGrams: 2, expectedRevision: 0, status: "draft", weightEntries: [], measurementEntries: [], goldResult: 792.04 };
    exam.weightEntries = Array.from({ length: 6 }, (_, index) => ({ receivedWeightGrams: 0.25, outputWeightGrams: 0.2, calculation: "yes", goldAssay: 790 + index }));
    for (const goldAssay of [-1, 1001]) {
      assert.equal((await request("/api/v1/bullion/examinations", chemist, "POST", { ...exam, weightEntries: [{ ...exam.weightEntries[0], goldAssay }] })).status, 400);
    }
    assert.equal((await request("/api/v1/bullion/examinations", chemist, "POST", exam)).status, 201);
    const savedExamination = (await (await request("/api/v1/bullion/samples", chemist)).json()).data[0].examination;
    assert.deepEqual(savedExamination.weightEntries, exam.weightEntries);
    await database.query("UPDATE bullion_intake_items SET bullion_no = '0015' WHERE id = $1", [item.id]);
    const managerDraft = (await (await request("/api/v1/bullion/samples", le)).json()).data.find(sample => sample.id === item.id);
    assert.equal(managerDraft.status, "draft");
    assert.equal(managerDraft.bullionNo, "0015");
    await database.query("UPDATE bullion_intake_items SET bullion_no = '0001' WHERE id = $1", [item.id]);
    assert(Number.isFinite(Date.parse(managerDraft.assignedAt)));
    assert.equal(managerDraft.completedAt, null);
    assert.deepEqual(managerDraft.examination.weightEntries, exam.weightEntries);
    assert.equal(managerDraft.examination.goldResult, exam.goldResult);
    assert.equal((await request("/api/v1/bullion/examinations", chemist, "POST", exam)).status, 409);
    const calculatedInput = { ...exam, expectedRevision: 1, calculationVersion: 'fire-assay-v1', goldResult: 1, silverResult: 1,
      weightEntries: [[248.27,196.64,'yes'],[248.99,197.27,'yes'],[249.85,246.23,'addition']].map(([a,b,calculation])=>({receivedWeightGrams:a/1000,outputWeightGrams:b/1000,calculation,goldAssay:1})),
      measurementEntries: [{label:'Чек мөнгө',reading:1500}] };
    assert.equal((await request("/api/v1/bullion/examinations", chemist, "POST", calculatedInput)).status, 201);
    const calculatedSaved = (await (await request("/api/v1/bullion/samples", le)).json()).data.find(sample=>sample.id===item.id).examination;
    assert.equal(calculatedSaved.goldResult.toFixed(2),'792.04');
    assert.equal(calculatedSaved.silverResult.toFixed(2),'193.35');
    assert.equal(calculatedSaved.measurementEntries[0].reading,1500);
    assert.equal(calculatedSaved.measurementEntries[1].reading.toFixed(2),'1252.89');
    assert.equal(calculatedSaved.measurementEntries[2].reading.toFixed(2),'106.97');
    const report = (await (await request("/api/v1/reports", le)).json()).data;
    assert.equal(report[0].bullionCount, 1);
    assert.equal(report[0].receivedGrams, 100);
    const summaryResponse = await request("/api/v1/reports/summary", le);
    assert.equal(summaryResponse.status, 200);
    const summary = (await summaryResponse.json()).data;
    assert.equal(summary.totalGoldGrams, 100);
    assert.equal(summary.companyCustomers, 1);
    assert.equal(summary.userCount, 3);
    assert.equal((await request("/api/v1/reports/summary?period=week", le)).status, 400);
    const monthlySummary = (await (await request("/api/v1/reports/summary?period=month", le)).json()).data;
    assert.equal(monthlySummary.totalGoldGrams, 100);
    assert.equal(monthlySummary.companyCustomers, 1);
    const update = { fullName: "Renamed Chemist", role: "chemist", status: "disabled", reason: "Account disabled for test" };
    assert.equal((await request(`/api/v1/users/${chemist.id}`, foreign, "PATCH", update)).status, 404);
    assert.equal((await request(`/api/v1/users/${chemist.id}`, le, "PATCH", update)).status, 200);
    assert.equal((await request("/api/auth/me", chemist)).status, 401);
    const audit = await database.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'staff.updated' AND entity_id = $1", [chemist.id]);
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].old_values.status, "active");
    assert.equal(audit.rows[0].new_values.status, "disabled");
    const history = await database.query("SELECT count(*)::int AS count FROM audit_logs WHERE action = 'bullion_intake.updated' AND entity_id = $1", [batch.id]);
    assert.equal(history.rows[0].count, 3);
    await database.query("INSERT INTO customer_organization_profiles (customer_id, mine_initial_number) VALUES ($1, '4829') ON CONFLICT (customer_id) DO UPDATE SET mine_initial_number = EXCLUDED.mine_initial_number", [customer.id]);
    assert.equal((await (await request(nextPath, melter)).json()).nextNumber, "0002");
    const concurrent = await Promise.all([1, 2].map(() => request("/api/v1/bullion/intakes", melter, "POST", {
      customerId: customer.id, metal: "silver", initialBullionNumber: "1",
      items: [{ bullionNo: "999", grossWeightBeforeGrams: 50 }, { bullionNo: "999", grossWeightBeforeGrams: 60 }],
    })));
    const allocated = await Promise.all(concurrent.map(async (response) => {
      assert.equal(response.status, 201); return (await response.json()).record;
    }));
    assert.deepEqual(allocated.flatMap((record) => record.items.map((item) => Number(item.bullionNo))).sort((a, b) => a - b), [2, 3, 4, 5]);
    assert.equal(new Set(allocated.map((record) => record.publicId)).size, 2);
    assert.deepEqual(allocated.map((record) => record.publicId).sort(), ["550002", "550003"]);
    assert.equal((await (await request(nextPath, melter)).json()).nextNumber, "0006");
    const listed = (await (await request("/api/v1/bullion/intakes", le)).json()).data;
    assert(listed.every((record) => record.customerId === customer.id));
    const personResponse = await request("/api/v1/customers", le, "POST", {
      type: "individual", displayName: "Location Test", province: "Darkhan", district: "Darkhan soum",
    });
    assert.equal(personResponse.status, 201);
    const person = (await personResponse.json()).record;
    assert.equal(person.province, "Darkhan");
    assert.equal(person.district, "Darkhan soum");
    const customers = (await (await request("/api/v1/customers", le)).json()).data;
    assert.equal(customers.find((row) => row.id === person.id).district, "Darkhan soum");
    assert.equal((await request("/api/v1/customers", le, "POST", { type: "individual", displayName: "No Location" })).status, 201);
    assert.equal((await request("/api/v1/customers", le, "POST", { type: "individual", displayName: "Long Location", province: "a".repeat(121) })).status, 400);
    const chemists = await Promise.all([1, 2, 3].map(() => user("chemist")));
    const eight = await request("/api/v1/bullion/intakes", le, "POST", {
      customerId: customer.id, metal: "gold", status: "sample_taken",
      items: Array.from({ length: 8 }, () => ({ bullionNo: "", grossWeightBeforeGrams: 100, grossWeightAfterGrams: 99, sampleWeightMilligrams: 1000 })),
    });
    assert.equal(eight.status, 201);
    const eightBatch = (await eight.json()).record;
    const assigned = (await database.query("SELECT assigned_chemist_id AS id, count(*)::int AS count FROM bullion_intake_items WHERE batch_id = $1 GROUP BY assigned_chemist_id", [eightBatch.id])).rows;
    assert.deepEqual(assigned.map((row) => row.count).sort(), [2, 3, 3]);
    assert(assigned.every((row) => chemists.some((c) => c.id === row.id)));
    for (const actor of chemists) {
      const own = (await (await request("/api/v1/bullion/samples", actor)).json()).data;
      assert.equal(own.length, assigned.find((row) => row.id === actor.id).count);
      const otherItem = (await database.query("SELECT id FROM bullion_intake_items WHERE batch_id = $1 AND assigned_chemist_id <> $2 LIMIT 1", [eightBatch.id, actor.id])).rows[0];
      assert.equal((await request("/api/v1/bullion/examinations", actor, "POST", { ...exam, bullionItemId: otherItem.id })).status, 404);
    }
    const auditAssignments = await database.query("SELECT count(*)::int AS count FROM audit_logs WHERE action = 'bullion_sample.assigned' AND entity_id IN (SELECT id FROM bullion_intake_items WHERE batch_id = $1)", [eightBatch.id]);
    assert.equal(auditAssignments.rows[0].count, 8);
    assert.equal((await request(`/api/v1/bullion/intakes/${eightBatch.id}/assign`, le, "POST")).status, 200);
    const afterRetry = await database.query("SELECT count(*)::int AS count FROM audit_logs WHERE action = 'bullion_sample.assigned' AND entity_id IN (SELECT id FROM bullion_intake_items WHERE batch_id = $1)", [eightBatch.id]);
    assert.equal(afterRetry.rows[0].count, 8);
    const choices = (await (await request(`/api/v1/bullion/intakes/${eightBatch.id}/chemists`, le)).json()).data;
    assert(chemists.every((actor) => choices.some((choice) => choice.id === actor.id)));
    assert.equal((await request(`/api/v1/bullion/intakes/${eightBatch.id}/chemists`, foreign)).status, 404);
    const first = (await database.query("SELECT id, assigned_chemist_id FROM bullion_intake_items WHERE batch_id = $1 LIMIT 1", [eightBatch.id])).rows[0];
    const replacement = chemists.find((actor) => actor.id !== first.assigned_chemist_id);
    const reassignment = { itemId: first.id, chemistId: replacement.id, expectedChemistId: first.assigned_chemist_id };
    const assignmentPath = `/api/v1/bullion/intakes/${eightBatch.id}/assignment`;
    assert.equal((await request(assignmentPath, melter, "PATCH", reassignment)).status, 403);
    assert.equal((await request(assignmentPath, foreign, "PATCH", reassignment)).status, 409);
    assert.equal((await request(assignmentPath, le, "PATCH", reassignment)).status, 200);
    assert.equal((await request(assignmentPath, le, "PATCH", reassignment)).status, 409);
    const auditChange = (await database.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'bullion_sample.reassigned' AND entity_id = $1", [first.id])).rows[0];
    assert.equal(auditChange.old_values.assignedChemistId, first.assigned_chemist_id);
    assert.equal(auditChange.new_values.assignedChemistId, replacement.id);
    const oldActor = chemists.find((actor) => actor.id === first.assigned_chemist_id);
    const managerSamples = (await (await request("/api/v1/bullion/samples", le)).json()).data;
    assert.equal(managerSamples.find((sample) => sample.id === first.id).assignedChemistId, replacement.id);
    assert.equal(managerSamples.find((sample) => sample.id === first.id).batchId, eightBatch.id);
    const substituteChoices = (await (await request(`/api/v1/bullion/samples/${first.id}/substitute-chemists`, replacement)).json()).data;
    assert(substituteChoices.some((chemist) => chemist.id === oldActor.id));
    assert.equal((await request(`/api/v1/bullion/samples/${first.id}/substitute`, replacement, "POST", { chemistId: oldActor.id })).status, 200);
    const substituted = (await database.query("SELECT assigned_chemist_id FROM bullion_intake_items WHERE id = $1", [first.id])).rows[0];
    assert.equal(substituted.assigned_chemist_id, oldActor.id);
    const substituteAudit = (await database.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'bullion_sample.substituted' AND entity_id = $1", [first.id])).rows[0];
    assert.equal(substituteAudit.old_values.assignedChemistId, replacement.id);
    assert.equal(substituteAudit.new_values.assignedChemistId, oldActor.id);
    assert(!(await (await request("/api/v1/bullion/samples", replacement)).json()).data.some((sample) => sample.id === first.id));
    const substituteQueueItem = (await (await request("/api/v1/bullion/samples", oldActor)).json()).data.find((sample) => sample.id === first.id);
    assert.equal(substituteQueueItem.substitutedByName, "Test chemist");
    assert(Number.isFinite(Date.parse(substituteQueueItem.substitutedAt)));
    const chemistSamples = (await (await request("/api/v1/bullion/samples", replacement)).json()).data;
    assert(chemistSamples.every((sample) => /^[1-9][0-9]*$/.test(sample.analysisNo)));
    assert.equal(new Set(managerSamples.map((sample) => sample.analysisNo)).size, managerSamples.length);
    const storedNumber = (await database.query("SELECT examination_number FROM bullion_intake_items WHERE id = $1", [first.id])).rows[0].examination_number;
    assert.equal(managerSamples.find((sample) => sample.id === first.id).analysisNo, String(storedNumber));
    assert(chemistSamples.every((sample) => !("batchId" in sample) && !("assignedChemistId" in sample)));
    assert.equal((await request(assignmentPath, le, "PATCH", { ...reassignment, chemistId: null, expectedChemistId: oldActor.id })).status, 200);
    const removed = (await database.query("SELECT assigned_chemist_id, assigned_at FROM bullion_intake_items WHERE id = $1", [first.id])).rows[0];
    assert.equal(removed.assigned_chemist_id, null);
    assert.equal(removed.assigned_at, null);
    const queue = (await (await request("/api/v1/bullion/samples", replacement)).json()).data;
    assert(!queue.some((sample) => sample.id === first.id));
    assert.equal((await request(assignmentPath, le, "PATCH", { ...reassignment, expectedChemistId: null })).status, 200);
    assert.equal((await request("/api/v1/bullion/examinations", oldActor, "POST", { ...exam, bullionItemId: first.id })).status, 404);
    exam.silverResult = 193.35;
    exam.measurementEntries = [1500, 250, 100, 650].map((reading, index) => ({ label: String(index), reading }));
    assert.equal((await request(`/api/v1/bullion/samples/${first.id}/print`, replacement, "POST", {})).status, 403);
    assert.equal((await request("/api/v1/bullion/examinations", replacement, "POST", { ...exam, bullionItemId: first.id, status: "submitted" })).status, 201);
    const chemistAfterSubmit = (await (await request("/api/v1/bullion/samples", replacement)).json()).data;
    assert(!chemistAfterSubmit.some((sample) => sample.id === first.id));
    const managerAfterSubmit = (await (await request("/api/v1/bullion/samples", le)).json()).data;
    assert.equal(managerAfterSubmit.find((sample) => sample.id === first.id).status, "submitted");
    const completedSample = managerAfterSubmit.find(sample => sample.id === first.id);
    assert(Number.isFinite(Date.parse(completedSample.assignedAt)));
    assert(Number.isFinite(Date.parse(completedSample.completedAt)));
    const storedTiming = (await database.query("SELECT i.assigned_at, e.submitted_at FROM bullion_intake_items i JOIN bullion_examination_revisions e ON e.bullion_item_id = i.id WHERE i.id = $1 ORDER BY e.revision_no DESC LIMIT 1", [first.id])).rows[0];
    assert.equal(Date.parse(completedSample.assignedAt), new Date(storedTiming.assigned_at).getTime());
    assert.equal(Date.parse(completedSample.completedAt), new Date(storedTiming.submitted_at).getTime());
    assert.deepEqual(managerAfterSubmit.find(sample => sample.id === first.id).examination.weightEntries, exam.weightEntries);
    assert.equal(managerAfterSubmit.find(sample => sample.id === first.id).examination.goldResult, exam.goldResult);
    assert.equal((await request(assignmentPath, le, "PATCH", { ...reassignment, chemistId: oldActor.id, expectedChemistId: replacement.id })).status, 409);
    assert.equal((await request("/api/v1/bullion/examinations", le, "POST", { ...exam, bullionItemId: first.id })).status, 403);
    assert.equal((await database.query("SELECT count(*)::int AS count FROM bullion_certificates")).rows[0].count, 0);
    const remainingSamples = (await database.query("SELECT id, assigned_chemist_id FROM bullion_intake_items WHERE batch_id = $1 AND id <> $2 ORDER BY sequence_no", [eightBatch.id, first.id])).rows;
    for (const row of remainingSamples) {
      const actor = chemists.find(actor => actor.id === row.assigned_chemist_id);
      assert.equal((await request("/api/v1/bullion/examinations", actor, "POST", { ...exam, bullionItemId: row.id, status: "submitted" })).status, 201);
    }
    const beforeApproval = await request(`/api/v1/bullion/batches/${eightBatch.id}/finalize`, le, "POST", {});
    assert.equal(beforeApproval.status, 409);
    const submittedSamples = (await (await request("/api/v1/bullion/samples", le)).json()).data.filter((sample) => sample.batchId === eightBatch.id);
    assert.equal(submittedSamples.length, 8);
    assert(submittedSamples[0].batchProgress.some((progress) => progress.completedCount === progress.assignedCount));
    for (const sample of submittedSamples) {
      assert.equal((await request(`/api/v1/bullion/samples/${sample.id}/approve`, le, "POST", {})).status, 200);
    }
    const finalized = await request(`/api/v1/bullion/batches/${eightBatch.id}/finalize`, le, "POST", {});
    assert.equal(finalized.status, 200);
    const certificate = (await finalized.json()).data;
    assert.equal(certificate.certificateNo, "0001");
    assert.equal(certificate.entries.length, 8);
    assert.match(certificate.documentHash, /^[0-9a-f]{64}$/);
    assert.equal(certificate.signatureStatus, "unsigned");
    assert.match(certificate.verificationId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(certificate.entries.map(entry => entry.bullionNo), eightBatch.items.map(item => item.bullionNo));
    assert.equal((await request(`/api/v1/bullion/batches/${eightBatch.id}/finalize`, replacement, "POST", {})).status, 403);
    const archive = await request(`/api/v1/bullion/batches/${eightBatch.id}/archive-print`, le, "POST", {});
    assert.equal(archive.status, 200);
    assert.match(archive.headers.get("cache-control"), /no-store/);
    const printReport = (await archive.json()).data;
    assert.equal(printReport.centerType, "private_assay_center");
    assert.equal(printReport.registrationNo, eightBatch.publicId);
    assert.equal(printReport.certificateNo, "0001");
    assert.equal(printReport.entries.length, 8);
    assert.equal((await request(`/api/v1/bullion/batches/${eightBatch.id}/archive-print`, replacement, "POST", {})).status, 403);
    assert.equal((await database.query("SELECT count(*)::int AS count FROM bullion_certificates")).rows[0].count, 1);
    const admin = await user("system_admin");
    const organizationPath = "/api/v1/organizations";
    const organizationInput = { name: "New assay center", code: "NEW-CENTER", type: "private_assay_center" };
    for (const actor of [le, melter, replacement, foreign]) {
      assert.equal((await request(organizationPath, actor)).status, 403);
      assert.equal((await request(organizationPath, actor, "POST", organizationInput)).status, 403);
      assert.equal((await request(`${organizationPath}/${center}`, actor, "PATCH", organizationInput)).status, 403);
    }
    assert.equal((await request(organizationPath, admin, "POST", { ...organizationInput, type: "unknown" })).status, 400);
    const createdOrganization = await request(organizationPath, admin, "POST", organizationInput);
    assert.equal(createdOrganization.status, 201);
    const newOrganization = (await createdOrganization.json()).record;
    assert.equal((await request(organizationPath, admin, "POST", organizationInput)).status, 409);
    assert.equal((await request(`${organizationPath}/${newOrganization.id}`, le, "DELETE")).status, 403);
    assert.equal((await request(`${organizationPath}/${center}`, admin, "DELETE")).status, 409);
    assert.equal((await request(`${organizationPath}/${newOrganization.id}`, admin, "DELETE")).status, 200);
    const organizationList = (await (await request(organizationPath, admin)).json()).data;
    assert(!organizationList.some(record => record.id === newOrganization.id));
    const existingOrganization = organizationList.find(record => record.id === center);
    assert.equal((await request(`${organizationPath}/${center}/connections`, le)).status, 403);
    const connections = (await (await request(`${organizationPath}/${center}/connections`, admin)).json()).data;
    assert(connections.staff.some((staff) => staff.id === chemist.id));
    assert(connections.customers.some((customer) => customer.id === customer.id && customer.displayName === "SQL Mining Company"));
    assert(connections.customers.every((customer) => !Object.hasOwn(customer, "registrationNumber")));
    const organizationEdit = { name: "Updated public center", code: existingOrganization.code, type: "government_assay_center", expectedUpdatedAt: existingOrganization.updatedAt };
    assert.equal((await request(`${organizationPath}/${center}`, admin, "PATCH", organizationEdit)).status, 200);
    assert.equal((await request(`${organizationPath}/${center}`, admin, "PATCH", organizationEdit)).status, 409);
    const updatedPrint = (await (await request(`/api/v1/bullion/batches/${eightBatch.id}/archive-print`, le, "POST", {})).json()).data;
    assert.equal(updatedPrint.centerType, "government_assay_center");
    assert.equal(updatedPrint.centerName, organizationEdit.name);
    assert.equal(updatedPrint.certificateNo, "0001");
    assert.equal((await (await request("/api/auth/me", replacement)).json()).user.organizationType, "government_assay_center");
    const organizationAudit = (await database.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'organization.updated' AND entity_id = $1", [center])).rows;
    assert.equal(organizationAudit.length, 1);
    assert.equal(organizationAudit[0].old_values.type, "private_assay_center");
    assert.equal(organizationAudit[0].new_values.type, "government_assay_center");
    assert.equal((await request(organizationPath, admin, "POST", { ...organizationInput, code: "BAD-PREFIX", bullionPrefix: "99" })).status, 400);
    for (const [prefix, type, suffix, firstRegistrationNo] of [[null, "government_assay_center", "default", "0001"], ["22", "government_assay_center", "22", "220001"], ["27", "government_assay_center", "27", "270001"], [null, "private_assay_center", "private", "550001"]]) {
      const expected = "0001";
      const created = await request(organizationPath, admin, "POST", { name: `Certificate center ${suffix}`, code: `CERT-${suffix}`, type, bullionPrefix: prefix });
      assert.equal(created.status, 201);
      const organization = (await created.json()).record;
      assert.equal(organization.bullionPrefix, prefix);
      const manager = await user("lab_manager", organization.id), analyst = await user("chemist", organization.id);
      const owner = (await (await request("/api/v1/customers", manager, "POST", { type: "individual", displayName: `Customer ${expected}` })).json()).record;
      assert.equal((await (await request(`/api/v1/bullion/intakes/next-number?customerId=${owner.id}`, manager)).json()).nextNumber, expected);
      async function completeRequest() {
        const intake = (await (await request("/api/v1/bullion/intakes", manager, "POST", { customerId: owner.id, metal: "gold", status: "sample_taken",
          items: [{ bullionNo: "", grossWeightBeforeGrams: 100, grossWeightAfterGrams: 99, sampleWeightMilligrams: 2000 }] })).json()).record;
        if (intake.items[0].bullionNo === "0001") assert.equal(intake.publicId, firstRegistrationNo);
        const id = intake.items[0].id;
        assert.equal((await request("/api/v1/bullion/examinations", analyst, "POST", { ...exam, bullionItemId: id, status: "submitted" })).status, 201);
        assert.equal((await request(`/api/v1/bullion/samples/${id}/approve`, manager, "POST", {})).status, 200);
        return { batchId: intake.id, itemId: id };
      }
      const historicalRequest = await completeRequest();
      const year = (await database.query("SELECT EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ulaanbaatar')::int AS year")).rows[0].year;
      await database.query("INSERT INTO bullion_certificates (batch_id, assay_center_id, issue_year, sequence_no, entries, issued_at) VALUES ($1::uuid, $2::uuid, $3::int, 924, '[]'::jsonb, make_timestamptz($3::int, 12, 31, 15, 59, 59, 'UTC'))", [historicalRequest.batchId, organization.id, year - 1]);
      const historical = (await (await request(`/api/v1/bullion/batches/${historicalRequest.batchId}/finalize`, manager, "POST", {})).json()).data;
      assert.equal(historical.certificateNo, "0924");
      assert.equal(historical.issueYear, year - 1);
      const requestForCertificate = await completeRequest();
      const response = await request(`/api/v1/bullion/batches/${requestForCertificate.batchId}/finalize`, manager, "POST", {});
      assert.equal(response.status, 200);
      const certificate = (await response.json()).data;
      assert.equal(certificate.certificateNo, "0001");
      assert.equal(certificate.issueYear, year);
      assert.equal(certificate.entries[0].bullionNo, expected.slice(0, -1) + "2");
      const repeated = (await (await request(`/api/v1/bullion/batches/${requestForCertificate.batchId}/finalize`, manager, "POST", {})).json()).data;
      assert.equal(repeated.certificateNo, "0001");
      assert.equal(repeated.issuedAt, certificate.issuedAt);
      assert.equal((await request(`/api/v1/bullion/batches/${requestForCertificate.batchId}/finalize`, replacement, "POST", {})).status, 403);
      const nextRequest = await completeRequest();
      const next = (await (await request(`/api/v1/bullion/batches/${nextRequest.batchId}/finalize`, manager, "POST", {})).json()).data;
      assert.equal(next.certificateNo, "0002");
      assert.equal(next.entries[0].bullionNo, expected.slice(0, -1) + "3");
    }
    // Simulate LE approval only in this disposable database.
    await database.query("UPDATE bullion_examination_revisions SET status = 'approved' WHERE bullion_item_id = $1", [first.id]);
    const chemistAfterApproval = (await (await request("/api/v1/bullion/samples", replacement)).json()).data;
    assert(!chemistAfterApproval.some((sample) => sample.id === first.id));
    const managerAfterApproval = (await (await request("/api/v1/bullion/samples", le)).json()).data;
    assert.equal(managerAfterApproval.find((sample) => sample.id === first.id).status, "approved");
    assert.deepEqual(sqlErrors, []);
  } finally {
    globalThis.fetch = originalFetch;
    await database.close();
  }
});
