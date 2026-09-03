import assert from "node:assert/strict";
import test from "node:test";

const seedEmail = "admin.test@assay.local";
const seedPassword = "AssayAdmin2026";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

function createTestEnv() {
  return {
    AUTH_DEV_LOGIN_ENABLED: "true",
    AUTH_DEV_SEED_EMAIL: seedEmail,
    AUTH_DEV_SEED_PASSWORD: seedPassword,
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
    IMAGES: {
      input: () => ({
        transform: () => ({
          output: async () => ({
            response: () => new Response("image"),
          }),
        }),
      }),
    },
  };
}

const testContext = {
  waitUntil() {},
  passThroughOnException() {},
};

async function login(worker) {
  const loginResponse = await worker.fetch(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: seedEmail, password: seedPassword }),
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(loginResponse.status, 200);
  const setCookie = loginResponse.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /assay_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);

  return setCookie.split(";")[0];
}

async function createAssayRecord(worker, cookie, overrides = {}) {
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/assays", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        customerName: "Б. Энхбат",
        customerType: "individual",
        customerRegistrationNumber: "УА90010101",
        customerEmail: "customer@example.local",
        customerPhone: "99112233",
        metal: "gold",
        declaredWeightGrams: 126.45,
        receivedWeightGrams: 126.45,
        customerInstruction: "Хаан банк 70 гр, Голомт банк 56.45 гр",
        allocations: [
          { bankName: "Хаан банк", allocatedGrams: 70 },
          { bankName: "Голомт банк", allocatedGrams: 56.45 },
        ],
        ...overrides,
      }),
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 201);
  return response.json();
}

async function inviteAndAcceptUser(worker, adminCookie, user) {
  const invitationResponse = await worker.fetch(
    new Request("http://localhost/api/auth/invitations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({
        email: user.email,
        role: user.role,
        expiresInDays: 7,
      }),
    }),
    createTestEnv(),
    testContext,
  );
  assert.equal(invitationResponse.status, 200);
  const invitationBody = await invitationResponse.json();

  const acceptResponse = await worker.fetch(
    new Request("http://localhost/api/auth/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: invitationBody.invitation.token,
        fullName: user.fullName,
        password: user.password,
      }),
    }),
    createTestEnv(),
    testContext,
  );
  assert.equal(acceptResponse.status, 200);

  return (acceptResponse.headers.get("set-cookie") ?? "").split(";")[0];
}

test("redirects anonymous dashboard visitors to login", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
      redirect: "manual",
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 303);
  assert.match(response.headers.get("location") ?? "", /\/login\?return_to=%2F$/);
});

test("server-renders the first super admin setup page", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/setup", {
      headers: { accept: "text/html" },
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Эхний супер админ үүсгэх/);
  assert.match(html, /Setup token/);
});

test("reports local setup status", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/setup/status"),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    configured: true,
    needsFirstAdmin: false,
  });
});

test("rejects weak first-admin setup passwords with a clear message", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/setup/first-admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        setupToken: "irrelevant-for-password-validation",
        organizationName: "Ardni Labs",
        organizationCode: "01",
        fullName: "Erdenebat Enkhdalai",
        email: "enkhdalai@ardni.co",
        password: "short1A",
      }),
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.message, /Нууц үг дор хаяж 12 тэмдэгттэй/);
});

test("server-renders the Mongolian login page", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/login", {
      headers: { accept: "text/html" },
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Системд нэвтрэх/);
  assert.match(html, /Имэйл/);
  assert.match(html, /Нууц үг/);
});

test("logs in and server-renders the protected dashboard", async () => {
  const worker = await loadWorker();
  const cookie = await login(worker);
  const dashboardResponse = await worker.fetch(
    new Request("http://localhost/", {
      headers: {
        accept: "text/html",
        cookie,
      },
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(dashboardResponse.status, 200);
  const html = await dashboardResponse.text();
  assert.match(html, /Сорьцын төвийн удирдлага/);
  assert.match(html, /Сорьцын бүртгэл/);
  assert.doesNotMatch(html, /Монголбанк API/);
  assert.match(html, /Аудит лог/);
  assert.match(html, /Шинэ сорьц бүртгэх/);
  assert.match(html, /Ерөнхий тайлан/);
  assert.doesNotMatch(html, /Шүүлтүүр/);
  assert.doesNotMatch(html, /AC-260820-014/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("creates and lists real assay records for authenticated users", async () => {
  const worker = await loadWorker();
  const cookie = await login(worker);
  const initialResponse = await worker.fetch(
    new Request("http://localhost/api/v1/assays", {
      headers: { cookie },
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(initialResponse.status, 200);
  assert.deepEqual((await initialResponse.json()).data, []);

  const createBody = await createAssayRecord(worker, cookie);
  assert.equal(createBody.ok, true);
  assert.match(createBody.record.id, /^AC-\d{6}-\d{3}$/);
  assert.equal(createBody.record.customerName, "Б. Энхбат");
  assert.equal(createBody.record.status, "received");
  assert.equal(createBody.record.purityPercent, null);
  assert.equal(createBody.record.allocations.length, 2);

  const listResponse = await worker.fetch(
    new Request("http://localhost/api/v1/assays", {
      headers: { cookie },
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(listResponse.status, 200);
  const listBody = await listResponse.json();
  assert.equal(listBody.data.length, 1);
  assert.equal(listBody.data[0].id, createBody.record.id);
});

test("creates and lists customer registry records with masked contact fields", async () => {
  const worker = await loadWorker();
  const cookie = await login(worker);
  const createResponse = await worker.fetch(
    new Request("http://localhost/api/v1/customers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        type: "legal_entity",
        displayName: "Эрдэнэс Сорьц ХХК",
        registrationNumber: "9012345678",
        email: "contact@example.local",
        phone: "99112233",
      }),
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(createResponse.status, 201);
  const createBody = await createResponse.json();
  assert.equal(createBody.ok, true);
  assert.equal(createBody.record.displayName, "Эрдэнэс Сорьц ХХК");
  assert.equal(createBody.record.type, "legal_entity");
  assert.equal(createBody.record.registrationNumberMasked, "90******78");
  assert.equal(createBody.record.phoneMasked, "****2233");
  assert.equal(createBody.record.emailMasked, "co***@example.local");

  const listResponse = await worker.fetch(
    new Request("http://localhost/api/v1/customers", {
      headers: { cookie },
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(listResponse.status, 200);
  const listBody = await listResponse.json();
  assert.equal(listBody.ok, true);
  assert.equal(listBody.data[0].displayName, "Эрдэнэс Сорьц ХХК");
});

test("manages the commercial-bank directory for authenticated admins", async () => {
  const worker = await loadWorker();
  const cookie = await login(worker);
  const code = `TEST${Date.now()}`;
  const createResponse = await worker.fetch(
    new Request("http://localhost/api/v1/banks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ type: "commercial_bank", code, name: "Тест банк" }),
    }),
    createTestEnv(),
    testContext,
  );
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.record.status, "active");

  const suspendResponse = await worker.fetch(
    new Request(`http://localhost/api/v1/banks/${created.record.id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ status: "suspended" }),
    }),
    createTestEnv(),
    testContext,
  );
  assert.equal(suspendResponse.status, 200);
  assert.equal((await suspendResponse.json()).record.status, "suspended");
});

test("submits assay result and blocks the same user from approving it", async () => {
  const worker = await loadWorker();
  const cookie = await login(worker);
  const createBody = await createAssayRecord(worker, cookie, {
    customerName: "Д. Саруул",
  });

  const submitResponse = await worker.fetch(
    new Request(`http://localhost/api/v1/assay-results/${createBody.record.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        methodName: "XRF",
        instrumentName: "XRF-01",
        grossWeightGrams: 126.45,
        purityPercent: 89.72,
        resultNotes: "Анхны хэмжилт.",
      }),
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(submitResponse.status, 201);
  const submitBody = await submitResponse.json();
  assert.equal(submitBody.record.status, "manager_review");
  assert.equal(submitBody.record.latestResult.status, "submitted");
  assert.equal(submitBody.record.latestResult.fineWeightGrams, 113.4509);

  const editResponse = await worker.fetch(
    new Request(`http://localhost/api/v1/assay-results/${createBody.record.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        methodName: "XRF",
        instrumentName: "XRF-02",
        grossWeightGrams: 126.45,
        purityPercent: 90,
        resultNotes: "Эрхлэгчид илгээхээс өмнө засав.",
      }),
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(editResponse.status, 201);
  const editBody = await editResponse.json();
  assert.equal(editBody.record.latestResult.id, submitBody.record.latestResult.id);
  assert.equal(editBody.record.latestResult.purityPercent, 90);
  assert.equal(editBody.record.latestResult.fineWeightGrams, 113.805);

  const approveResponse = await worker.fetch(
    new Request(`http://localhost/api/v1/assay-results/${createBody.record.id}/approve`, {
      method: "POST",
      headers: { cookie },
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(approveResponse.status, 409);
  assert.match((await approveResponse.json()).message, /өөрөө батлах боломжгүй/);
});

test("allows a lab manager to approve a submitted assay result", async () => {
  const worker = await loadWorker();
  const adminCookie = await login(worker);
  const managerCookie = await inviteAndAcceptUser(worker, adminCookie, {
    email: `manager.${Date.now()}@assay.local`,
    role: "lab_manager",
    fullName: "Лабораторийн эрхлэгч",
    password: "ManagerPass2026",
  });
  const createBody = await createAssayRecord(worker, adminCookie, {
    customerName: "О. Эрдэнэ",
    receivedWeightGrams: 80,
    declaredWeightGrams: 80,
    allocations: [{ bankName: "Хаан банк", allocatedGrams: 80 }],
  });

  const submitResponse = await worker.fetch(
    new Request(`http://localhost/api/v1/assay-results/${createBody.record.id}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({
        methodName: "Fire assay",
        grossWeightGrams: 80,
        purityPercent: 91.25,
      }),
    }),
    createTestEnv(),
    testContext,
  );
  assert.equal(submitResponse.status, 201);

  const approveResponse = await worker.fetch(
    new Request(`http://localhost/api/v1/assay-results/${createBody.record.id}/approve`, {
      method: "POST",
      headers: { cookie: managerCookie },
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(approveResponse.status, 200);
  const approveBody = await approveResponse.json();
  assert.equal(approveBody.record.status, "approved");
  assert.equal(approveBody.record.latestResult.status, "approved");
  assert.equal(approveBody.record.latestResult.approvedByName, "Лабораторийн эрхлэгч");
});

test("rejects assay allocations that do not match received weight", async () => {
  const worker = await loadWorker();
  const cookie = await login(worker);
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/assays", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        customerName: "Д. Номин",
        customerType: "individual",
        metal: "silver",
        declaredWeightGrams: 100,
        receivedWeightGrams: 100,
        allocations: [{ bankName: "Хас банк", allocatedGrams: 90 }],
      }),
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /нийлбэр хүлээн авсан жинтэй тэнцүү/);
});

test("creates and accepts a user invitation", async () => {
  const worker = await loadWorker();
  const adminCookie = await login(worker);
  const invitationResponse = await worker.fetch(
    new Request("http://localhost/api/auth/invitations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({
        email: "chemist.test@assay.local",
        role: "chemist",
        expiresInDays: 7,
      }),
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(invitationResponse.status, 200);
  const invitationBody = await invitationResponse.json();
  assert.equal(invitationBody.ok, true);
  assert.match(invitationBody.invitation.token, /^[A-Za-z0-9_-]+$/);

  const acceptResponse = await worker.fetch(
    new Request("http://localhost/api/auth/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: invitationBody.invitation.token,
        fullName: "Туршилтын химич",
        password: "ChemistPass2026",
      }),
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(acceptResponse.status, 200);
  const acceptBody = await acceptResponse.json();
  assert.equal(acceptBody.ok, true);
  assert.equal(acceptBody.user.role, "chemist");
  assert.match(acceptResponse.headers.get("set-cookie") ?? "", /assay_session=/);
});

test("allows super admin to list managed users", async () => {
  const worker = await loadWorker();
  const cookie = await login(worker);
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/users", {
      headers: { cookie },
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].role, "system_admin");
  assert.equal(body.data[0].email, seedEmail);
});

test("blocks non-super admins from user management", async () => {
  const worker = await loadWorker();
  const adminCookie = await login(worker);
  const invitationResponse = await worker.fetch(
    new Request("http://localhost/api/auth/invitations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({
        email: "viewer.test@assay.local",
        role: "chemist",
        expiresInDays: 7,
      }),
    }),
    createTestEnv(),
    testContext,
  );
  const invitationBody = await invitationResponse.json();

  const acceptResponse = await worker.fetch(
    new Request("http://localhost/api/auth/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: invitationBody.invitation.token,
        fullName: "Энгийн хэрэглэгч",
        password: "ViewerPass2026",
      }),
    }),
    createTestEnv(),
    testContext,
  );
  const userCookie = (acceptResponse.headers.get("set-cookie") ?? "").split(";")[0];

  const response = await worker.fetch(
    new Request("http://localhost/api/v1/users", {
      headers: { cookie: userCookie },
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 403);
  assert.match((await response.json()).message, /Хэрэглэгч удирдах эрхгүй/);
});

test("server-renders protected user invitation page for admins", async () => {
  const worker = await loadWorker();
  const cookie = await login(worker);
  const response = await worker.fetch(
    new Request("http://localhost/users/invite", {
      headers: {
        accept: "text/html",
        cookie,
      },
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Хэрэглэгч урих/);
  assert.match(html, /Хяналтын самбар руу буцах/);
  assert.match(html, /Public signup байхгүй/);
});

test("protects assay API data from anonymous requests", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/assays"),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 401);
});

test("protects customer API data from anonymous requests", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/customers"),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 401);
});

test("serves the edge API health endpoint", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/health"),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "assay-management",
    mode: "private-admin",
  });
});

test("adds private API security headers and rejects cross-origin writes", async () => {
  const worker = await loadWorker();
  const cookie = await login(worker);
  const blocked = await worker.fetch(
    new Request("http://localhost/api/v1/customers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "https://attacker.example",
      },
      body: JSON.stringify({ type: "individual", displayName: "Blocked request" }),
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get("x-content-type-options"), "nosniff");
  assert.equal(blocked.headers.get("x-frame-options"), "DENY");
  assert.match(blocked.headers.get("x-request-id") ?? "", /./);
});

test("fails closed when production security configuration is incomplete", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("https://assay.example/api/health"),
    {
      ...createTestEnv(),
      APP_ENV: "production",
      DATABASE_URL: "postgresql://not-used-in-this-test",
      AUTH_DEV_LOGIN_ENABLED: "true",
      RATE_LIMITING_ENABLED: "false",
    },
    testContext,
  );

  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /хөгжүүлэлтийн нэвтрэх/);
});

test("keeps Bank of Mongolia endpoints closed until production credentials are configured", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/bom/v1/assays", {
      headers: {
        "x-assay-client-id": "bom-test-client",
        "x-assay-timestamp": String(Date.now()),
        "x-assay-nonce": "nonce-for-security-test-1234",
        "x-assay-request-id": "bom-request-security-test-1234",
        "x-assay-signature": "v1=not-a-real-signature",
      },
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store, private, max-age=0");
});
