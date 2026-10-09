import assert from "node:assert/strict";
import { test } from "node:test";
import { ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { configFromEnv } from "../src/config.ts";
import { Log, type LogOptions } from "../src/log.ts";
import { Telemetry } from "../src/telemetry.ts";

function capture(options: LogOptions = {}): { log: Log; lines: string[] } {
  const lines: string[] = [];
  return { log: new Log({ write: (line) => lines.push(line), ...options }), lines };
}

test("one JSON object per line", () => {
  const { log, lines } = capture();
  log.emit("info", "request", { status: 200, error: undefined, path: "/api/sum" });
  const [line, ...rest] = lines;
  assert.equal(rest.length, 0);
  assert.ok(line !== undefined && line.endsWith("\n"));
  const record = JSON.parse(line) as Record<string, unknown>;
  assert.equal(record.level, "info");
  assert.equal(record.message, "request");
  assert.equal(record.status, 200);
  assert.equal(record.path, "/api/sum");
  assert.equal(record.logger, "arith");
  assert.ok(!("error" in record), "undefined fields are left out");
  assert.match(String(record.time), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});

test("text for people", () => {
  const { log, lines } = capture({ format: "text" });
  log.emit("info", "request", { query: "", status: 200, path: "/a b" }, "access");
  assert.match(lines[0] ?? "", /^\S+ {2}INFO access: request query="" status=200 path="\/a b"\n$/);
});

test("lines below the level are dropped", () => {
  const { log, lines } = capture({ level: "warn" });
  log.emit("debug", "quiet");
  log.info("quiet");
  log.warn("loud");
  log.error("louder");
  assert.deepEqual(
    lines.map((line) => (JSON.parse(line) as { message: string }).message),
    ["loud", "louder"],
  );
});

test("console off writes nothing", () => {
  const { log, lines } = capture({ console: false });
  log.info("request");
  assert.deepEqual(lines, []);
});

test("records over OTLP carry the span's trace id", () => {
  const exporter = new InMemoryLogRecordExporter();
  const telemetry = new Telemetry(configFromEnv({}), { logs: exporter });
  const otlp = telemetry.otlpLogger();
  assert.ok(otlp);
  const { log } = capture({ console: false, otlp });
  const span = trace.wrapSpanContext({
    traceId: "01".repeat(16),
    spanId: "02".repeat(8),
    traceFlags: TraceFlags.SAMPLED,
  });
  log.emit("warn", "request", { status: 400 }, "access", trace.setSpan(ROOT_CONTEXT, span));

  const [record] = exporter.getFinishedLogRecords();
  assert.ok(record);
  assert.equal(record.body, "request");
  assert.equal(record.severityText, "WARN");
  assert.equal(record.severityNumber, 13);
  assert.deepEqual(record.attributes, { status: 400, logger: "access" });
  assert.equal(record.spanContext?.traceId, "01".repeat(16));
});
