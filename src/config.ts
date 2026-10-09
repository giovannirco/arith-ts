// Settings. Everything comes from the environment; nothing is read from disk.
//
// ARITH_* variables are this program's own. The OTEL_* variables follow the
// OpenTelemetry specification, so a collector's documentation applies as is.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "json" | "text";
export type OtlpProtocol = "http/protobuf" | "grpc";

export interface Config {
  host: string;
  port: number;
  logLevel: LogLevel;
  logFormat: LogFormat;
  // Seconds to let in-flight requests finish after SIGTERM.
  shutdownTimeout: number;
  tracesOtlp: boolean;
  logsConsole: boolean;
  logsOtlp: boolean;
  otlpProtocol: OtlpProtocol;
  serviceName: string;
}

// A variable that is set but cannot be used.
export class ConfigError extends Error {
  readonly variable: string;
  readonly value: string;
  readonly expected: string;

  constructor(variable: string, value: string, expected: string) {
    super(`${variable}=${JSON.stringify(value)} is not valid: expected ${expected}`);
    this.variable = variable;
    this.value = value;
    this.expected = expected;
  }
}

type Env = Record<string, string | undefined>;

export function configFromEnv(env: Env = process.env): Config {
  // A value that is empty or only spaces counts as unset.
  const get = (name: string): string | undefined => {
    const value = env[name];
    return value === undefined || value.trim() === "" ? undefined : value;
  };
  const oneOf = <T extends string>(name: string, allowed: readonly T[], fallback: T, expected: string): T => {
    const value = get(name) ?? fallback;
    if ((allowed as readonly string[]).includes(value)) return value as T;
    throw new ConfigError(name, value, expected);
  };

  const [host, port] = parseAddr(get("ARITH_ADDR") ?? "0.0.0.0:8000");
  return {
    host,
    port,
    logLevel: oneOf("ARITH_LOG_LEVEL", ["debug", "info", "warn", "error"], "info", "debug, info, warn or error"),
    logFormat: oneOf("ARITH_LOG_FORMAT", ["json", "text"], "json", "json or text"),
    shutdownTimeout: seconds(get("ARITH_SHUTDOWN_TIMEOUT")),
    tracesOtlp: oneOf("OTEL_TRACES_EXPORTER", ["none", "otlp"], "none", "none or otlp") === "otlp",
    ...logsExporter(get("OTEL_LOGS_EXPORTER") ?? "console"),
    otlpProtocol: oneOf("OTEL_EXPORTER_OTLP_PROTOCOL", ["http/protobuf", "grpc"], "http/protobuf", "http/protobuf or grpc"),
    serviceName: get("OTEL_SERVICE_NAME") ?? "arith",
  };
}

// "host:port" for logs, with IPv6 hosts in brackets.
export function addr(config: Pick<Config, "host" | "port">): string {
  return config.host.includes(":") ? `[${config.host}]:${config.port}` : `${config.host}:${config.port}`;
}

function parseAddr(value: string): [string, number] {
  const match = /^(?:\[([^\]]+)\]|([^:[\]]+)):(\d{1,5})$/.exec(value);
  const port = match ? Number(match[3]) : 0;
  if (!match || port < 1 || port > 65535) throw new ConfigError("ARITH_ADDR", value, "host:port");
  const host = match[1] ?? match[2];
  if (host === undefined) throw new ConfigError("ARITH_ADDR", value, "host:port");
  return [host, port];
}

function seconds(value: string | undefined): number {
  if (value === undefined) return 10;
  if (/^\d+$/.test(value)) return Number(value);
  throw new ConfigError("ARITH_SHUTDOWN_TIMEOUT", value, "a number of seconds");
}

function logsExporter(value: string): { logsConsole: boolean; logsOtlp: boolean } {
  const items = value.split(",").map((item) => item.trim());
  if (!items.every((item) => ["console", "otlp", "none"].includes(item))) {
    throw new ConfigError("OTEL_LOGS_EXPORTER", value, "console, otlp, console,otlp or none");
  }
  return { logsConsole: items.includes("console"), logsOtlp: items.includes("otlp") };
}
