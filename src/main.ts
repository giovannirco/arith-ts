// Environment in, signals in, exit code out.
//
// On SIGTERM the server stops accepting, lets in-flight requests finish for
// up to ARITH_SHUTDOWN_TIMEOUT seconds, flushes traces and logs, and exits.
// Kubernetes waits terminationGracePeriodSeconds; keep the timeout below it.

import { buildApp } from "./app.ts";
import { addr, ConfigError, configFromEnv, type Config } from "./config.ts";
import { Log } from "./log.ts";
import { Metrics } from "./metrics.ts";
import { Telemetry } from "./telemetry.ts";
import { VERSION } from "./version.ts";

let config: Config;
try {
  config = configFromEnv();
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  process.stderr.write(`arith: ${err.message}\n`);
  process.exit(1);
}

const telemetry = new Telemetry(config);
const otlp = telemetry.otlpLogger();
const log = new Log({
  level: config.logLevel,
  format: config.logFormat,
  console: config.logsConsole,
  ...(otlp ? { otlp } : {}),
});
const app = buildApp({ log, metrics: new Metrics(), telemetry });

await app.listen({ host: config.host, port: config.port });
log.info("listening", {
  addr: addr(config),
  version: VERSION,
  traces: telemetry.exportsTraces,
  logs_otlp: telemetry.exportsLogs,
});

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info("shutdown signal received", { signal });
  // A connection that never finishes its request would keep close() waiting
  // forever; the grace period is the limit.
  const deadline = setTimeout(() => {
    log.warn("grace period over, exiting with connections still open", { grace_seconds: config.shutdownTimeout });
    void telemetry.shutdown().finally(() => process.exit(0));
  }, config.shutdownTimeout * 1000);
  log.info("draining connections");
  await app.close();
  clearTimeout(deadline);
  log.info("stopped");
  await telemetry.shutdown();
  process.exit(0);
}

process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGINT", () => void stop("SIGINT"));
