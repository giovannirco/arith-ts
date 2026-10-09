import assert from "node:assert/strict";
import { test } from "node:test";
import { CalcError } from "../src/calc.ts";
import { Metrics } from "../src/metrics.ts";
import { VERSION } from "../src/version.ts";

test("renders requests, operations and build info", async () => {
  const m = new Metrics();
  m.observeRequest("GET", "/api/sum", 200, 0.002);
  m.observeRequest("GET", "/api/sum", 200, 0.003);
  m.observeRequest("GET", "/api/div", 400, 0.0003);
  m.observeOperation("sum", "ok");
  m.observeOperation("sum", "ok");
  m.observeOperation("div", new CalcError("division_by_zero").outcome);
  m.observeOperation("mul", new CalcError("overflow").outcome);
  m.observeOperation("sub", "bad_input");

  const text = await m.render();
  for (const line of [
    'http_requests_total{method="GET",route="/api/sum",status="200"} 2',
    'http_requests_total{method="GET",route="/api/div",status="400"} 1',
    'http_request_duration_seconds_count{method="GET",route="/api/sum"} 2',
    'http_request_duration_seconds_bucket{le="0.0005",method="GET",route="/api/div"} 1',
    'arith_operations_total{operation="sum",outcome="ok"} 2',
    'arith_operations_total{operation="div",outcome="division_by_zero"} 1',
    'arith_operations_total{operation="mul",outcome="overflow"} 1',
    'arith_operations_total{operation="sub",outcome="bad_input"} 1',
    `arith_build_info{version="${VERSION}"} 1`,
  ]) {
    assert.ok(text.includes(line), `missing ${line} in:\n${text}`);
  }
  assert.match(m.contentType, /^text\/plain; version=0\.0\.4/);
});

test("each registry is its own", async () => {
  const a = new Metrics();
  const b = new Metrics();
  a.observeOperation("sum", "ok");
  assert.ok(!(await b.render()).includes('outcome="ok"'));
});
