// The HTTP contract, end to end through Fastify: the same requests the README
// documents, with the bodies it promises.

import assert from "node:assert/strict";
import { test } from "node:test";
import { testApp } from "./helpers.ts";

async function assertJson(status: number, body: string, url: string): Promise<void> {
  const { app } = testApp();
  const response = await app.inject({ method: "GET", url });
  assert.equal(response.statusCode, status, url);
  assert.equal(response.body, body, url);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8", url);
}

test("the worked example", async () => {
  await assertJson(200, '{"result":5}', "/api/sum?term_one=4&term_two=1");
  await assertJson(200, '{"result":3}', "/api/sub?term_one=4&term_two=1");
  await assertJson(200, '{"result":4}', "/api/mul?term_one=4&term_two=1");
  await assertJson(200, '{"result":3}', "/api/div?term_one=7&term_two=2");
});

test("division truncates toward zero", async () => {
  await assertJson(200, '{"result":-3}', "/api/div?term_one=-7&term_two=2");
  await assertJson(200, '{"result":-3}', "/api/div?term_one=7&term_two=-2");
});

test("64-bit results are written exactly", async () => {
  await assertJson(200, '{"result":9223372036854775807}', "/api/sum?term_one=9223372036854775806&term_two=1");
  await assertJson(200, '{"result":-9223372036854775808}', "/api/mul?term_one=-9223372036854775808&term_two=1");
});

test("errors are 400 with a reason", async () => {
  const cases: [string, string][] = [
    ["/api/div?term_one=1&term_two=0", '{"error":"division by zero"}'],
    ["/api/sum?term_one=abc&term_two=1", '{"error":"term_one must be an integer, got \\"abc\\""}'],
    ["/api/sum?term_one=1&term_two=1.5", '{"error":"term_two must be an integer, got \\"1.5\\""}'],
    ["/api/sum?term_one=1", '{"error":"term_two is required"}'],
    ["/api/mul", '{"error":"term_one is required"}'],
    ["/api/sum?term_one=9223372036854775807&term_two=1", '{"error":"result does not fit in a 64-bit integer"}'],
    ["/api/mul?term_one=-9223372036854775808&term_two=-1", '{"error":"result does not fit in a 64-bit integer"}'],
    ["/api/div?term_one=-9223372036854775808&term_two=-1", '{"error":"result does not fit in a 64-bit integer"}'],
    [
      "/api/sub?term_one=99999999999999999999&term_two=1",
      '{"error":"term_one does not fit in a 64-bit integer, got \\"99999999999999999999\\""}',
    ],
    ["/api/sum?term_one=%ff&term_two=1", '{"error":"term_one must be an integer, got \\"\uFFFD\\""}'],
  ];
  for (const [url, body] of cases) await assertJson(400, body, url);
});

test("healthz", async () => {
  await assertJson(200, '{"status":"ok"}', "/healthz");
});

test("unknown paths and methods are JSON too", async () => {
  await assertJson(404, '{"error":"not found"}', "/api/pow?term_one=2&term_two=3");
  await assertJson(404, '{"error":"not found"}', "/api/sum.json?term_one=2&term_two=3");

  const { app } = testApp();
  const response = await app.inject({ method: "POST", url: "/api/sum?term_one=1&term_two=2" });
  assert.equal(response.statusCode, 405);
  assert.equal(response.body, '{"error":"method not allowed"}');
});

test("HEAD answers like GET, without a body", async () => {
  const { app } = testApp();
  const response = await app.inject({ method: "HEAD", url: "/healthz" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "");
});

test("an exception that escapes a handler is a JSON 500", async () => {
  const { app } = testApp();
  app.get("/boom", () => {
    throw new Error("boom");
  });
  const response = await app.inject({ method: "GET", url: "/boom" });
  assert.equal(response.statusCode, 500);
  assert.equal(response.body, '{"error":"internal server error"}');
});

test("a URL Fastify refuses is a JSON 400", async () => {
  const { app } = testApp();
  const response = await app.inject({ method: "GET", url: "/api/%E0%A4%A" });
  assert.equal(response.statusCode, 400);
  assert.equal(response.body, '{"error":"bad request"}');
});
