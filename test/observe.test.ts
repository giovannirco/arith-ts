// What one request leaves behind: counters, an access-log line, a span.

import assert from "node:assert/strict";
import { test } from "node:test";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { testApp } from "./helpers.ts";

const TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

const accessLines = (lines: Record<string, unknown>[]) => lines.filter((line) => line.logger === "access");

test("metrics count what was served", async () => {
  const { app } = testApp();
  for (const url of [
    "/api/sum?term_one=4&term_two=1",
    "/api/sum?term_one=4&term_two=1",
    "/api/div?term_one=1&term_two=0",
    "/api/mul?term_one=x&term_two=1",
    "/nope",
  ]) {
    await app.inject({ method: "GET", url });
  }
  await app.inject({ method: "POST", url: "/api/sum" });

  const response = await app.inject({ method: "GET", url: "/metrics" });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["content-type"]), /^text\/plain; version=0\.0\.4/);
  for (const line of [
    'http_requests_total{method="GET",route="/api/sum",status="200"} 2',
    'http_requests_total{method="GET",route="/api/div",status="400"} 1',
    'http_requests_total{method="GET",route="unmatched",status="404"} 1',
    'http_requests_total{method="POST",route="/api/sum",status="405"} 1',
    'http_request_duration_seconds_count{method="GET",route="/api/sum"} 2',
    'arith_operations_total{operation="sum",outcome="ok"} 2',
    'arith_operations_total{operation="div",outcome="division_by_zero"} 1',
    'arith_operations_total{operation="mul",outcome="bad_input"} 1',
    "arith_build_info{version=",
  ]) {
    assert.ok(response.body.includes(line), `missing ${line} in:\n${response.body}`);
  }
});

test("one access line per request, with the error text and the route", async () => {
  const { app, lines } = testApp();
  await app.inject({ method: "GET", url: "/api/div?term_one=1&term_two=0" });
  const [line, ...rest] = accessLines(lines());
  assert.equal(rest.length, 0);
  assert.ok(line);
  assert.equal(line.level, "info");
  assert.deepEqual(
    [line.method, line.path, line.query, line.route, line.status, line.error],
    ["GET", "/api/div", "term_one=1&term_two=0", "/api/div", 400, "division by zero"],
  );
  assert.equal(typeof line.duration_ms, "number");
  assert.ok(!("trace_id" in line), "no trace, no trace id");
});

test("probes and scrapes are logged at debug", async () => {
  const { app, lines } = testApp();
  await app.inject({ method: "GET", url: "/healthz" });
  await app.inject({ method: "GET", url: "/metrics" });
  assert.deepEqual(accessLines(lines()), []);

  const debug = testApp({}, { level: "debug" });
  await debug.app.inject({ method: "GET", url: "/healthz" });
  assert.equal(accessLines(debug.lines())[0]?.level, "debug");
});

test("a caller's traceparent puts its trace id on the line", async () => {
  const { app, lines } = testApp();
  await app.inject({ method: "GET", url: "/api/sum?term_one=4&term_two=1", headers: { traceparent: TRACEPARENT } });
  assert.equal(accessLines(lines())[0]?.trace_id, "0af7651916cd43dd8448eb211c80319c");
});

test("one span per request, joined to the caller's trace", async () => {
  const exporter = new InMemorySpanExporter();
  const { app } = testApp({ spans: exporter });
  await app.inject({ method: "GET", url: "/api/sum?term_one=4&term_two=1", headers: { traceparent: TRACEPARENT } });
  await app.inject({ method: "GET", url: "/api/div?term_one=1&term_two=0" });
  await app.inject({ method: "GET", url: "/nope" });

  const spans = exporter.getFinishedSpans();
  assert.deepEqual(
    spans.map((s) => s.name),
    ["GET /api/sum", "GET /api/div", "GET unmatched"],
  );
  const [sum, div] = spans;
  assert.ok(sum && div);
  assert.equal(sum.spanContext().traceId, "0af7651916cd43dd8448eb211c80319c", "continues the caller's trace");
  assert.equal(sum.parentSpanContext?.spanId, "b7ad6b7169203331");
  assert.equal(sum.kind, SpanKind.SERVER);
  assert.equal(sum.attributes["http.route"], "/api/sum");
  assert.equal(sum.attributes["http.request.method"], "GET");
  assert.equal(sum.attributes["url.path"], "/api/sum");
  assert.equal(sum.attributes["http.response.status_code"], 200);
  assert.notEqual(div.spanContext().traceId, sum.spanContext().traceId, "starts its own trace");
  assert.equal(div.attributes["http.response.status_code"], 400);
});

test("a 5xx marks the span as an error", async () => {
  const exporter = new InMemorySpanExporter();
  const { app } = testApp({ spans: exporter });
  app.get("/boom", () => {
    throw new Error("boom");
  });
  await app.inject({ method: "GET", url: "/boom" });
  assert.equal(exporter.getFinishedSpans()[0]?.status.code, SpanStatusCode.ERROR);
});
