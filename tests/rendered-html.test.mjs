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

test("server-renders the first-admin setup page", async () => {
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
  assert.match(html, /Эхний админ үүсгэх/);
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
  assert.match(html, /Монголбанк API/);
  assert.match(html, /Аудит лог/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
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
