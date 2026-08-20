import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

function createTestEnv() {
  return {
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

test("server-renders the assay management dashboard", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    createTestEnv(),
    testContext,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Сорьцын төвийн удирдлага/);
  assert.match(html, /Сорьцын бүртгэл/);
  assert.match(html, /Монголбанк API/);
  assert.match(html, /Аудит лог/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
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
