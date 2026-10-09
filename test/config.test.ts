import assert from "node:assert/strict";
import { test } from "node:test";
import { addr, ConfigError, configFromEnv } from "../src/config.ts";

test("defaults", () => {
  const c = configFromEnv({});
  assert.deepEqual(c, {
    host: "0.0.0.0",
    port: 8000,
    logLevel: "info",
    logFormat: "json",
    shutdownTimeout: 10,
    tracesOtlp: false,
    logsConsole: true,
    logsOtlp: false,
    otlpProtocol: "http/protobuf",
    serviceName: "arith",
  });
  assert.equal(addr(c), "0.0.0.0:8000");
});

test("everything set", () => {
  const c = configFromEnv({
    ARITH_ADDR: "127.0.0.1:9000",
    ARITH_LOG_LEVEL: "debug",
    ARITH_LOG_FORMAT: "text",
    ARITH_SHUTDOWN_TIMEOUT: "3",
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "console, otlp",
    OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
    OTEL_SERVICE_NAME: "calc",
  });
  assert.deepEqual(c, {
    host: "127.0.0.1",
    port: 9000,
    logLevel: "debug",
    logFormat: "text",
    shutdownTimeout: 3,
    tracesOtlp: true,
    logsConsole: true,
    logsOtlp: true,
    otlpProtocol: "grpc",
    serviceName: "calc",
  });
});

test("an IPv6 address keeps its brackets", () => {
  const c = configFromEnv({ ARITH_ADDR: "[::]:8000" });
  assert.equal(c.host, "::");
  assert.equal(addr(c), "[::]:8000");
});

test("empty values mean unset", () => {
  const c = configFromEnv({ ARITH_ADDR: "  ", OTEL_LOGS_EXPORTER: "" });
  assert.equal(c.port, 8000);
  assert.equal(c.logsConsole, true);
});

test("logs none turns everything off", () => {
  const c = configFromEnv({ OTEL_LOGS_EXPORTER: "none" });
  assert.equal(c.logsConsole, false);
  assert.equal(c.logsOtlp, false);
});

test("bad values name the variable", () => {
  const cases: [string, string, string][] = [
    ["ARITH_ADDR", "eight thousand", "host:port"],
    ["ARITH_ADDR", "0.0.0.0:99999", "host:port"],
    ["ARITH_LOG_LEVEL", "loud", "debug, info, warn or error"],
    ["ARITH_LOG_FORMAT", "yaml", "json or text"],
    ["ARITH_SHUTDOWN_TIMEOUT", "soon", "a number of seconds"],
    ["OTEL_TRACES_EXPORTER", "jaeger", "none or otlp"],
    ["OTEL_LOGS_EXPORTER", "syslog", "console, otlp, console,otlp or none"],
    ["OTEL_EXPORTER_OTLP_PROTOCOL", "http/json", "http/protobuf or grpc"],
  ];
  for (const [variable, value, expected] of cases) {
    assert.throws(
      () => configFromEnv({ [variable]: value }),
      (err) =>
        err instanceof ConfigError &&
        err.variable === variable &&
        err.value === value &&
        err.expected === expected &&
        err.message === `${variable}=${JSON.stringify(value)} is not valid: expected ${expected}`,
      `${variable}=${value}`,
    );
  }
});
