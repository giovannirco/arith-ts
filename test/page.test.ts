import assert from "node:assert/strict";
import { test } from "node:test";
import { testApp } from "./helpers.ts";

test("the page", async () => {
  const { app } = testApp();
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
  assert.match(String(response.headers["content-security-policy"]), /default-src 'none'/);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.ok(response.body.includes("<title>arith</title>"));
  for (const op of ["sum", "sub", "mul", "div"]) {
    assert.ok(response.body.includes(`data-op="${op}"`), `${op} button`);
  }
});

test("its stylesheet and script", async () => {
  const { app } = testApp();
  const style = await app.inject({ method: "GET", url: "/style.css" });
  assert.equal(style.statusCode, 200);
  assert.equal(style.headers["content-type"], "text/css; charset=utf-8");
  assert.ok(style.body.includes("--accent"));

  const script = await app.inject({ method: "GET", url: "/app.js" });
  assert.equal(script.statusCode, 200);
  assert.equal(script.headers["content-type"], "text/javascript; charset=utf-8");
  assert.ok(script.body.includes("/api/${operation}"));
});
