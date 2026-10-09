// Prometheus metrics, served at /metrics in the text exposition format.
//
// Labels are kept to bounded sets: the route template rather than the path,
// and an outcome name rather than the error text.

import { Counter, Gauge, Histogram, Registry } from "prom-client";
import type { Operation, Outcome } from "./calc.ts";
import { VERSION } from "./version.ts";

// Half a millisecond to a few seconds. Arithmetic is fast; anything in the
// upper buckets is the network or the scheduler.
const BUCKETS = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

export class Metrics {
  private readonly registry = new Registry();
  private readonly requests: Counter<"method" | "route" | "status">;
  private readonly duration: Histogram<"method" | "route">;
  private readonly operations: Counter<"operation" | "outcome">;

  constructor(version = VERSION) {
    const registers = [this.registry];
    this.requests = new Counter({
      name: "http_requests_total",
      help: "HTTP requests served, by method, route template and status code",
      labelNames: ["method", "route", "status"],
      registers,
    });
    this.duration = new Histogram({
      name: "http_request_duration_seconds",
      help: "Time to serve an HTTP request",
      labelNames: ["method", "route"],
      buckets: BUCKETS,
      registers,
    });
    this.operations = new Counter({
      name: "arith_operations_total",
      help: "Arithmetic requests, by operation and outcome",
      labelNames: ["operation", "outcome"],
      registers,
    });
    new Gauge({ name: "arith_build_info", help: "Version of the running program", labelNames: ["version"], registers }).set(
      { version },
      1,
    );
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  observeRequest(method: string, route: string, status: number, seconds: number): void {
    this.requests.inc({ method, route, status: String(status) });
    this.duration.observe({ method, route }, seconds);
  }

  observeOperation(operation: Operation, outcome: Outcome): void {
    this.operations.inc({ operation, outcome });
  }

  // The whole registry in the Prometheus text format.
  render(): Promise<string> {
    return this.registry.metrics();
  }
}
