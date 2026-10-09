// Every route the process serves, and the hooks that observe each request.
//
// GET /api/{sum,sub,mul,div}?term_one=<int>&term_two=<int> answers
// {"result": <int>}. A missing or non-integer term, division by zero and a
// result outside 64 bits are 400 {"error": "<why>"}. Unknown paths are 404,
// other methods on known paths 405, both JSON.

import { STATUS_CODES } from "node:http";
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, defaultTextMapGetter, isSpanContextValid, trace, type Span } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { CalcError, OPERATIONS, type Operation } from "./calc.ts";
import type { Log } from "./log.ts";
import type { Metrics } from "./metrics.ts";
import { CONTENT_SECURITY_POLICY, INDEX, SCRIPT, STYLE } from "./page.ts";
import type { Telemetry } from "./telemetry.ts";
import { InvalidTerm, parseTerms } from "./terms.ts";

export interface Deps {
  log: Log;
  metrics: Metrics;
  telemetry: Telemetry;
}

const JSON_TYPE = "application/json; charset=utf-8";
const OPERATION_NAMES = Object.keys(OPERATIONS) as Operation[];
const PATHS = new Set(["/", "/style.css", "/app.js", ...OPERATION_NAMES.map((op) => `/api/${op}`), "/healthz", "/metrics"]);
// Probes and scrapes arrive every few seconds; they are logged at debug so
// the default level shows the requests people made.
const QUIET_ROUTES = new Set(["/healthz", "/metrics"]);
const propagator = new W3CTraceContextPropagator();

interface InFlight {
  started: bigint;
  span: Span;
  // The route template for a request no route handler matched (a 405).
  route?: string;
  // The error text, for the access log.
  error?: string;
}

export function buildApp(deps: Deps): FastifyInstance {
  const app = Fastify({
    logger: false,
    // A URL Fastify cannot decode is refused before routing; it still
    // answers in JSON.
    frameworkErrors: (error, _request, reply) => {
      const status = error.statusCode ?? 400;
      void (reply as unknown as FastifyReply)
        .code(status)
        .type(JSON_TYPE)
        .send(JSON.stringify({ error: (STATUS_CODES[status] ?? "error").toLowerCase() }));
    },
  });
  const inFlight = new WeakMap<FastifyRequest, InFlight>();

  const sendJson = (reply: FastifyReply, status: number, body: string): FastifyReply =>
    reply.code(status).type(JSON_TYPE).send(body);

  const sendError = (request: FastifyRequest, reply: FastifyReply, status: number, message: string): FastifyReply => {
    const state = inFlight.get(request);
    if (state) state.error = message;
    return sendJson(reply, status, JSON.stringify({ error: message }));
  };

  // One span per request, joined to the caller's trace when a traceparent
  // header arrives with it.
  app.addHook("onRequest", (request, _reply, done) => {
    const parent = propagator.extract(ROOT_CONTEXT, request.headers, defaultTextMapGetter);
    const span = deps.telemetry.tracer().startSpan(
      `${request.method} unmatched`,
      { kind: SpanKind.SERVER, attributes: { "http.request.method": request.method, "url.path": pathOf(request.url) } },
      parent,
    );
    inFlight.set(request, { started: process.hrtime.bigint(), span });
    done();
  });

  app.addHook("onResponse", async (request, reply) => {
    const state = inFlight.get(request);
    if (!state) return;
    const seconds = Number(process.hrtime.bigint() - state.started) / 1e9;
    // The route template (/api/sum), not the path, keeps label cardinality
    // fixed. Requests that match no route share one label.
    const route = state.route ?? request.routeOptions.url ?? "unmatched";
    const status = reply.statusCode;

    const { span } = state;
    span.updateName(`${request.method} ${route}`);
    span.setAttributes({ "http.route": route, "http.response.status_code": status });
    if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();

    deps.metrics.observeRequest(request.method, route, status, seconds);
    const spanContext = span.spanContext();
    deps.log.emit(
      QUIET_ROUTES.has(route) ? "debug" : "info",
      "request",
      {
        method: request.method,
        path: pathOf(request.url),
        query: queryOf(request.url),
        route,
        status,
        duration_ms: Math.round(seconds * 1e6) / 1e3,
        error: state.error,
        trace_id: isSpanContextValid(spanContext) ? spanContext.traceId : undefined,
      },
      "access",
      trace.setSpan(ROOT_CONTEXT, span),
    );
  });

  app.get("/", async (_request, reply) =>
    reply
      .header("content-security-policy", CONTENT_SECURITY_POLICY)
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer")
      .type("text/html; charset=utf-8")
      .send(INDEX),
  );
  app.get("/style.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(STYLE));
  app.get("/app.js", async (_request, reply) => reply.type("text/javascript; charset=utf-8").send(SCRIPT));

  for (const operation of OPERATION_NAMES) {
    app.get(`/api/${operation}`, async (request, reply) => {
      let a: bigint, b: bigint, result: bigint;
      try {
        [a, b] = parseTerms(queryOf(request.url));
      } catch (err) {
        if (!(err instanceof InvalidTerm)) throw err;
        deps.metrics.observeOperation(operation, "bad_input");
        return sendError(request, reply, 400, err.message);
      }
      try {
        result = OPERATIONS[operation](a, b);
      } catch (err) {
        if (!(err instanceof CalcError)) throw err;
        deps.metrics.observeOperation(operation, err.outcome);
        return sendError(request, reply, 400, err.message);
      }
      deps.metrics.observeOperation(operation, "ok");
      // JSON.stringify cannot write a bigint; a 64-bit integer is written as
      // its digits, which is what JSON calls a number.
      return sendJson(reply, 200, `{"result":${result.toString()}}`);
    });
  }

  app.get("/healthz", async (_request, reply) => sendJson(reply, 200, '{"status":"ok"}'));
  app.get("/metrics", async (_request, reply) => reply.type(deps.metrics.contentType).send(await deps.metrics.render()));

  // Unknown paths are 404; a known path with another method is 405.
  app.setNotFoundHandler(async (request, reply) => {
    const path = pathOf(request.url);
    if (!PATHS.has(path)) return sendError(request, reply, 404, "not found");
    const state = inFlight.get(request);
    if (state) state.route = path;
    return sendError(request, reply, 405, "method not allowed");
  });

  // Anything that escapes a handler, and Fastify's own refusals (a malformed
  // URL), still answer in JSON. The text is the status, not the exception.
  app.setErrorHandler(async (error: Error & { statusCode?: number }, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    if (status >= 500) deps.log.error("unhandled error", { error: error.message, path: pathOf(request.url) });
    return sendError(request, reply, status, (STATUS_CODES[status] ?? "error").toLowerCase());
  });

  return app;
}

function pathOf(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function queryOf(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? "" : url.slice(q + 1);
}
