import assert from "node:assert/strict";
import { test } from "node:test";
import { OTLPLogExporter as GrpcLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { OTLPLogExporter as ProtoLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter as GrpcTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPTraceExporter as ProtoTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { configFromEnv } from "../src/config.ts";
import { Telemetry } from "../src/telemetry.ts";
import { VERSION } from "../src/version.ts";

// The processors keep their exporter in a private field; reading it is the
// only way to see which transport was chosen without a collector.
const exporterOf = (processor: unknown): unknown => (processor as { _exporter: unknown })._exporter;

test("console only exports nothing", () => {
  const t = new Telemetry(configFromEnv({}));
  assert.equal(t.exportsTraces, false);
  assert.equal(t.exportsLogs, false);
  assert.equal(t.otlpLogger(), undefined);
  // The no-op tracer still hands out spans.
  assert.equal(t.tracer().startSpan("x").isRecording(), false);
});

test("traces and logs over OTLP, http/protobuf", async () => {
  const t = new Telemetry(
    configFromEnv({ OTEL_TRACES_EXPORTER: "otlp", OTEL_LOGS_EXPORTER: "console,otlp", OTEL_SERVICE_NAME: "calc" }),
  );
  assert.equal(t.exportsTraces, true);
  assert.equal(t.exportsLogs, true);
  assert.ok(t.spanProcessor instanceof BatchSpanProcessor);
  assert.ok(exporterOf(t.spanProcessor) instanceof ProtoTraceExporter);
  assert.ok(t.logProcessor instanceof BatchLogRecordProcessor);
  assert.ok(exporterOf(t.logProcessor) instanceof ProtoLogExporter);
  const span = t.tracer().startSpan("x");
  assert.equal(span.isRecording(), true);
  const resource = (span as unknown as { resource: { attributes: Record<string, unknown> } }).resource;
  assert.equal(resource.attributes["service.name"], "calc");
  assert.equal(resource.attributes["service.version"], VERSION);
  // Not ended, so shutdown has nothing to send to a collector that is not there.
  await t.shutdown();
});

test("traces and logs over OTLP, grpc", async () => {
  const t = new Telemetry(
    configFromEnv({ OTEL_TRACES_EXPORTER: "otlp", OTEL_LOGS_EXPORTER: "otlp", OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" }),
  );
  assert.ok(exporterOf(t.spanProcessor) instanceof GrpcTraceExporter);
  assert.ok(exporterOf(t.logProcessor) instanceof GrpcLogExporter);
  await t.shutdown();
});
