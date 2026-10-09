// One line per event on stdout, as JSON (the default) or as readable text,
// and the same record over OTLP when OTEL_LOGS_EXPORTER includes otlp.
//
//   {"time":"2026-10-09T12:00:00.123Z","level":"info","message":"request","status":200,...,"logger":"access"}
//   2026-10-09T12:00:00.123Z  INFO access: request status=200 ...

import type { Context } from "@opentelemetry/api";
import { SeverityNumber, type Logger as OtlpLogger } from "@opentelemetry/api-logs";
import type { LogFormat, LogLevel } from "./config.ts";

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

export type Fields = Record<string, string | number | boolean | undefined>;

export interface LogOptions {
  level?: LogLevel;
  format?: LogFormat;
  console?: boolean;
  write?: (line: string) => void;
  otlp?: OtlpLogger;
}

export class Log {
  readonly level: LogLevel;
  private readonly format: LogFormat;
  private readonly console: boolean;
  private readonly write: (line: string) => void;
  private readonly otlp: OtlpLogger | undefined;

  constructor(options: LogOptions = {}) {
    this.level = options.level ?? "info";
    this.format = options.format ?? "json";
    this.console = options.console ?? true;
    this.write = options.write ?? ((line) => process.stdout.write(line));
    this.otlp = options.otlp;
  }

  enabled(level: LogLevel): boolean {
    return RANK[level] >= RANK[this.level];
  }

  // `logger` names the part of the program speaking (access, server).
  // `context` carries the span the record belongs to.
  emit(level: LogLevel, message: string, fields: Fields = {}, logger = "arith", context?: Context): void {
    if (!this.enabled(level)) return;
    const present = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Record<
      string,
      string | number | boolean
    >;
    const time = new Date();
    if (this.console) this.write(this.line(time, level, message, present, logger) + "\n");
    this.otlp?.emit({
      timestamp: time,
      severityText: level.toUpperCase(),
      severityNumber: SEVERITY[level],
      body: message,
      attributes: { ...present, logger },
      ...(context ? { context } : {}),
    });
  }

  info(message: string, fields?: Fields): void {
    this.emit("info", message, fields);
  }

  warn(message: string, fields?: Fields): void {
    this.emit("warn", message, fields);
  }

  error(message: string, fields?: Fields): void {
    this.emit("error", message, fields);
  }

  private line(time: Date, level: LogLevel, message: string, fields: Record<string, unknown>, logger: string): string {
    const stamp = time.toISOString();
    if (this.format === "json") return JSON.stringify({ time: stamp, level, message, ...fields, logger });
    const pairs = Object.entries(fields).map(([k, v]) =>
      typeof v === "string" && (v === "" || /\s/.test(v)) ? `${k}=${JSON.stringify(v)}` : `${k}=${String(v)}`,
    );
    return `${stamp} ${level.toUpperCase().padStart(5)} ${logger}: ${[message, ...pairs].join(" ")}`;
  }
}
