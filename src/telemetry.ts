// Where traces and logs go. Off unless the OTEL_* variables ask for OTLP:
//
// | OTEL_TRACES_EXPORTER=otlp    | one span per request over OTLP            |
// | OTEL_LOGS_EXPORTER=otlp      | log records over OTLP, trace ids attached |
// | OTEL_EXPORTER_OTLP_PROTOCOL  | http/protobuf (default) or grpc           |
// | OTEL_EXPORTER_OTLP_ENDPOINT  | the collector, Tempo or Loki              |
//
// The exporters read the rest of the OTEL_EXPORTER_OTLP_* family (per-signal
// endpoints, headers, timeout) themselves, and the tracer provider reads
// OTEL_TRACES_SAMPLER.
//
// Nothing here is global: the app gets a Telemetry and asks it for a tracer,
// so tests can hand in their own exporters.

import { trace, type Tracer } from "@opentelemetry/api";
import type { Logger as OtlpLogger } from "@opentelemetry/api-logs";
import { OTLPLogExporter as GrpcLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { OTLPLogExporter as ProtoLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter as GrpcTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPTraceExporter as ProtoTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  SimpleLogRecordProcessor,
  type LogRecordExporter,
  type LogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { Config } from "./config.ts";
import { VERSION } from "./version.ts";

export interface TestExporters {
  spans?: SpanExporter;
  logs?: LogRecordExporter;
}

export class Telemetry {
  readonly tracerProvider: BasicTracerProvider | undefined;
  readonly loggerProvider: LoggerProvider | undefined;
  readonly spanProcessor: SpanProcessor | undefined;
  readonly logProcessor: LogRecordProcessor | undefined;

  // A test hands in in-memory exporters and gets synchronous processors.
  constructor(config: Config, testExporters: TestExporters = {}) {
    const resource = defaultResource().merge(
      resourceFromAttributes({ "service.name": config.serviceName, "service.version": VERSION }),
    );
    const grpc = config.otlpProtocol === "grpc";

    if (testExporters.spans) this.spanProcessor = new SimpleSpanProcessor(testExporters.spans);
    else if (config.tracesOtlp) {
      this.spanProcessor = new BatchSpanProcessor(grpc ? new GrpcTraceExporter() : new ProtoTraceExporter());
    }
    if (this.spanProcessor) {
      this.tracerProvider = new BasicTracerProvider({ resource, spanProcessors: [this.spanProcessor] });
    }

    if (testExporters.logs) this.logProcessor = new SimpleLogRecordProcessor({ exporter: testExporters.logs });
    else if (config.logsOtlp) {
      this.logProcessor = new BatchLogRecordProcessor({
        exporter: grpc ? new GrpcLogExporter() : new ProtoLogExporter(),
      });
    }
    if (this.logProcessor) this.loggerProvider = new LoggerProvider({ resource, processors: [this.logProcessor] });
  }

  get exportsTraces(): boolean {
    return this.tracerProvider !== undefined;
  }

  get exportsLogs(): boolean {
    return this.loggerProvider !== undefined;
  }

  // With traces off this is the API's no-op tracer: spans cost nothing, and
  // one started from an incoming traceparent still carries that trace id.
  tracer(): Tracer {
    return (this.tracerProvider ?? trace).getTracer("arith", VERSION);
  }

  otlpLogger(): OtlpLogger | undefined {
    return this.loggerProvider?.getLogger("arith", VERSION);
  }

  // Sends what is buffered. Called once, on the way out.
  async shutdown(): Promise<void> {
    await Promise.all([this.tracerProvider?.shutdown(), this.loggerProvider?.shutdown()]);
  }
}
