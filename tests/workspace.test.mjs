import assert from "node:assert/strict";
import test from "node:test";

const env = { AUTH_DEV_LOGIN_ENABLED: "true", AUTH_DEV_SEED_EMAIL: "workspace@assay.local", AUTH_DEV_SEED_PASSWORD: "WorkspaceAdmin2026", RATE_LIMITING_ENABLED: "false", ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
const password = "WorkspaceStaff2026";
const orgA = "00000000-0000-4000-8000-000000000101";
const orgB = "00000000-0000-4000-8000-000000000102";

async function setup() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("workspace-test", crypto.randomUUID());
  const { default: worker } = await import(url.href);
  async function request(path, cookie, method = "GET", body) {
    return worker.fetch(new Request(`http://localhost${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {}, passThroughOnException() {} });
  }
  const login = await request("/api/auth/login", null, "POST", { email: env.AUTH_DEV_SEED_EMAIL, password: env.AUTH_DEV_SEED_PASSWORD });
  assert.equal(login.status, 200);
  const admin = login.headers.get("set-cookie").split(";")[0];
  async function invite(actor, role, email, organizationId = orgA) {
    const response = await request("/api/auth/invitations", actor, "POST", { role, email, organizationId });
    assert.equal(response.status, 200);
    const { invitation } = await response.json();
    const accepted = await request("/api/auth/invitations/accept", null, "POST", { token: invitation.token, fullName: email.split("@")[0], password });
    assert.equal(accepted.status, 200);
    return { cookie: accepted.headers.get("set-cookie").split(";")[0], user: (await accepted.json()).user };
  }
  return { request, admin, invite };
}

test("LE manages only center staff; changes revoke sessions and cannot escalate privileges", async () => {
  const { request, admin, invite } = await setup();
  const le = await invite(admin, "lab_manager", "director-a@assay.local");
  const otherLe = await invite(admin, "lab_manager", "director-b@assay.local", orgB);
  const chemist = await invite(le.cookie, "chemist", "chemist-a@assay.local");
  const foreign = await invite(otherLe.cookie, "chemist", "chemist-b@assay.local", orgB);
  const list = await request("/api/v1/users", le.cookie);
  assert.equal(list.status, 200);
  const { data } = await list.json();
  assert(data.some((user) => user.id === chemist.user.id));
  assert(data.every((user) => user.organizationId === orgA));
  assert(!JSON.stringify(data).includes("passwordHash"));
  for (const payload of [{ role: "system_admin", organizationId: orgA }, { role: "lab_manager", organizationId: orgA }, { role: "commercial_bank_user", organizationId: orgA }, { role: "chemist", organizationId: orgB }]) {
    assert.equal((await request("/api/auth/invitations", le.cookie, "POST", { email: "attempt@assay.local", ...payload })).status, 403);
  }
  const update = { fullName: "Updated Chemist", role: "intake_officer", status: "disabled", reason: "Staff duties changed" };
  assert.equal((await request(`/api/v1/users/${foreign.user.id}`, le.cookie, "PATCH", update)).status, 404);
  assert.equal((await request(`/api/v1/users/${le.user.id}`, le.cookie, "PATCH", update)).status, 404);
  assert.equal((await request(`/api/v1/users/${chemist.user.id}`, le.cookie, "PATCH", { ...update, role: "system_admin" })).status, 400);
  assert.equal((await request(`/api/v1/users/${chemist.user.id}`, le.cookie, "PATCH", { ...update, organizationId: orgB })).status, 400);
  assert.equal((await request(`/api/v1/users/${chemist.user.id}`, le.cookie, "PATCH", update)).status, 200);
  assert.equal((await request("/api/auth/me", chemist.cookie)).status, 401);
  assert.equal((await request("/api/auth/login", null, "POST", { email: chemist.user.email, password })).status, 401);
  const updated = (await (await request("/api/v1/users", le.cookie)).json()).data.find((user) => user.id === chemist.user.id);
  assert.equal(updated.fullName, update.fullName);
  assert.equal(updated.role, "intake_officer");
  assert.equal(updated.status, "disabled");
});

test("melter intake, LE sampling, anonymous chemistry, and reports respect center boundaries", async () => {
  const { request, admin, invite } = await setup();
  const le = await invite(admin, "lab_manager", "director@assay.local");
  const melter = await invite(le.cookie, "intake_officer", "melter@assay.local");
  const chemist = await invite(le.cookie, "chemist", "chemist@assay.local");
  const other = await invite(admin, "lab_manager", "other@assay.local", orgB);
  const foreignChemist = await invite(other.cookie, "chemist", "foreign@assay.local", orgB);
  for (const path of ["/api/v1/users", "/api/v1/customers", "/api/v1/customers/lookup", "/api/v1/bullion/intakes", "/api/v1/assays", "/api/v1/assay-results", "/api/v1/banks", "/api/v1/reports"]) {
    assert.equal((await request(path, chemist.cookie)).status, 403, path);
  }
  for (const path of ["/api/v1/users", "/api/v1/customers", "/api/v1/bullion/samples", "/api/v1/assays", "/api/v1/assay-results", "/api/v1/banks", "/api/v1/reports"]) {
    assert.equal((await request(path, melter.cookie)).status, 403, path);
  }
  const created = await request("/api/v1/customers", melter.cookie, "POST", { type: "legal_entity", displayName: "Private Mining Company", registrationNumber: "1234567", email: "private@example.local", phone: "99112233" });
  assert.equal(created.status, 201);
  const customer = (await created.json()).record;
  const lookup = (await (await request("/api/v1/customers/lookup", melter.cookie)).json()).data;
  assert.deepEqual(Object.keys(lookup[0]).sort(), ["displayName", "district", "id", "origin", "province", "registrationNumber", "type"]);
  assert.equal((await (await request("/api/v1/customers/lookup", other.cookie)).json()).data.length, 0);
  const input = { customerId: customer.id, metal: "gold", delta: -0.03125, items: [{ bullionNo: "1", grossWeightBeforeGrams: 100 }] };
  assert.equal((await request("/api/v1/bullion/intakes", other.cookie, "POST", input)).status, 404);
  assert.equal((await request("/api/v1/bullion/intakes", melter.cookie, "POST", { ...input, items: [{ ...input.items[0], sampleWeightMilligrams: 2000 }] })).status, 403);
  const intake = await request("/api/v1/bullion/intakes", melter.cookie, "POST", input);
  assert.equal(intake.status, 201);
  const batch = (await intake.json()).record;
  const itemId = batch.items[0].id;
  const weights = { status: "draft", items: [{ id: itemId, grossWeightAfterGrams: 99.5, slagWeightGrams: 0.5 }] };
  assert.equal((await request(`/api/v1/bullion/intakes/${batch.id}`, melter.cookie, "PATCH", weights)).status, 200);
  assert.equal((await request(`/api/v1/bullion/intakes/${batch.id}`, other.cookie, "PATCH", weights)).status, 404);
  assert.equal((await (await request("/api/v1/bullion/intakes", other.cookie)).json()).data.length, 0);
  assert.equal((await (await request("/api/v1/bullion/samples", chemist.cookie)).json()).data.length, 0);
  const sampling = { status: "sample_taken", items: [{ ...weights.items[0], sampleWeightMilligrams: 2000 }] };
  assert.equal((await request(`/api/v1/bullion/intakes/${batch.id}`, melter.cookie, "PATCH", sampling)).status, 403);
  assert.equal((await request(`/api/v1/bullion/intakes/${batch.id}`, le.cookie, "PATCH", sampling)).status, 200);
  assert.equal((await request(`/api/v1/bullion/intakes/${batch.id}`, melter.cookie, "PATCH", weights)).status, 409);
  const samples = (await (await request("/api/v1/bullion/samples", chemist.cookie)).json()).data;
  assert.equal(samples.length, 1);
  assert.equal(samples[0].sampleWeightMilligrams, 2000);
  assert.doesNotMatch(JSON.stringify(samples), /Private Mining|customer|bullionNo|receivedBy|99112233|private@example/);
  assert.equal((await (await request("/api/v1/bullion/samples", foreignChemist.cookie)).json()).data.length, 0);
  const examination = { bullionItemId: itemId, examinationNo: samples[0].analysisNo, expectedRevision: 0, sampleWeightGrams: 2, delta: -0.03125, status: "draft", weightEntries: [], measurementEntries: [], goldResult: 792.04 };
  assert.equal((await request("/api/v1/bullion/examinations", foreignChemist.cookie, "POST", examination)).status, 404);
  const competing = await Promise.all([request("/api/v1/bullion/examinations", chemist.cookie, "POST", examination), request("/api/v1/bullion/examinations", chemist.cookie, "POST", examination)]);
  assert.deepEqual(competing.map((response) => response.status).sort(), [201, 409]);
  assert.equal((await request("/api/v1/bullion/examinations", chemist.cookie, "POST", { ...examination, expectedRevision: 1, status: "submitted" })).status, 201);
  assert.equal((await request("/api/v1/bullion/examinations", chemist.cookie, "POST", { ...examination, expectedRevision: 2 })).status, 409);
  const report = (await (await request("/api/v1/reports", le.cookie)).json()).data;
  assert.equal(report.find((row) => row.metal === "gold").bullionCount, 1);
  assert.equal(report.find((row) => row.metal === "gold").submittedCount, 1);
  assert.doesNotMatch(JSON.stringify(report), /Private Mining|customer|bank/);

  const substitute = await invite(le.cookie, "chemist", "substitute@assay.local");
  const substituteChoices = (await (await request(`/api/v1/bullion/samples/${itemId}/substitute-chemists`, chemist.cookie)).json()).data;
  assert(substituteChoices.some((choice) => choice.id === substitute.user.id));
  assert.equal((await request(`/api/v1/bullion/samples/${itemId}/substitute`, chemist.cookie, "POST", { chemistId: substitute.user.id })).status, 200);
  assert.equal((await (await request("/api/v1/bullion/samples", chemist.cookie)).json()).data.length, 0);
  assert.equal((await (await request("/api/v1/bullion/samples", substitute.cookie)).json()).data.length, 1);
  assert.equal((await request(`/api/v1/bullion/samples/${itemId}/print`, chemist.cookie, "POST", {})).status, 404);
});
