import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { configFromEnv } from "../src/config.ts";
import { Log, type LogOptions } from "../src/log.ts";
import { Metrics } from "../src/metrics.ts";
import { Telemetry, type TestExporters } from "../src/telemetry.ts";

export interface TestApp {
  app: FastifyInstance;
  metrics: Metrics;
  telemetry: Telemetry;
  // Every line the log wrote, parsed.
  lines: () => Record<string, unknown>[];
}

// The app with a fresh registry, a log that writes to memory, and whichever
// test exporters the test hands in.
export function testApp(exporters: TestExporters = {}, logOptions: LogOptions = {}): TestApp {
  const written: string[] = [];
  const telemetry = new Telemetry(configFromEnv({}), exporters);
  const metrics = new Metrics();
  const otlp = telemetry.otlpLogger();
  const log = new Log({ level: "info", write: (line) => written.push(line), ...(otlp ? { otlp } : {}), ...logOptions });
  const app = buildApp({ log, metrics, telemetry });
  return {
    app,
    metrics,
    telemetry,
    lines: () => written.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
