# arith-ts

Read [README.md](README.md) first. That file is the contract. If a command in it does not match the tree, fix the tree or the README in the same change. A documented command that does not run is a bug.

This repository is the open-source arithmetic service the README describes. Code, docs, commits, UI copy and issues stay on that subject.

## Shape

One Node.js 24 process: TypeScript on [Fastify](https://fastify.dev), nothing else on top. Port 8000 is fixed. The page and the API ship in the same image.

```
src/calc.ts               the four operations on 64-bit bigints, and OPERATIONS
src/terms.ts              term_one and term_two from the raw query string
src/app.ts                routes, 404 and 405, the JSON error shape, and the
                          per-request span, metrics and access log
src/page.ts               web/ read once at start
src/metrics.ts            Prometheus registry behind /metrics
src/telemetry.ts          OTLP exporters for logs and traces, http/protobuf or grpc
src/log.ts                the one log line format, JSON or text
src/config.ts             environment variables, parsed once
src/main.ts               environment in, signals in, exit code out
web/                      index.html, style.css, app.js; no build step
test/                     the table of cases, the HTTP contract, the process
Dockerfile                node build stage, distroless/nodejs runtime, uid 65532
deploy/helm/arith-ts      chart: Deployment, Service, optional Ingress, HTTPRoute,
                          NetworkPolicy, CiliumNetworkPolicy, ServiceMonitor, a helm test
deploy/kustomize          base (namespace, deployment, service), one component per
                          optional piece, an example overlay
.github/workflows         test, lint, coverage, multi-arch image and chart to ghcr
Makefile                  test, cover, lint, run, image, push, deploy, upgrade, remove
```

Operations live in `src/calc.ts`. Adding or changing one is a function there and its entry in `OPERATIONS` (which gives it its route), its rows in `test/calc.test.ts`, a button in `web/index.html`. The README's layout section points at these files. Keep that true.

Node runs `src/` and `test/` as TypeScript directly, so only syntax that erases cleanly is allowed (`erasableSyntaxOnly`): no enums, namespaces or parameter properties, and relative imports name the `.ts` file. `tsc` compiles `src/` to `dist/` for the image.

## API

Match the table in the README, including the error strings. Signed 64-bit integers only: a JavaScript number cannot hold them, so terms and results are `bigint` and every one is checked against the range. Division truncates toward zero. Results are written as JSON numbers by hand, because `JSON.stringify` cannot write a `bigint`. Division by zero, a missing or non-integer term, and a result that does not fit are all `400` with `{"error":"..."}`. Unknown path `404`, wrong method `405`, both JSON. Tests pin every string; change the test and the string together.

`/healthz` is the only health URL. Liveness and readiness both use it.

## Observability

Metrics are pulled from `/metrics` and always on. Traces and logs leave over OTLP only when the standard `OTEL_*` variables ask for it. Defaults are stdout logs and no traces. Do not invent `ARITH_*` names for things OpenTelemetry already names. Labels on metrics stay bounded: route template, not path; outcome enum, not error text.

The OpenTelemetry providers are built in `src/telemetry.ts` and handed to the app; nothing is registered globally, so tests bring their own in-memory exporters.

## Page

One screen. Two inputs, four operations, the result, the error text the API returned, and the request line that produced them. It calls the same endpoints the tests do and computes nothing itself.

Keep it quiet: system fonts, one accent, generous space, a result readable from across a desk, light and dark. No canvas, no chart, no dashboard, no traffic generator, no UI framework, no build step. It has to work at phone width and look finished at laptop width.

## Cluster

Both Helm and Kustomize must produce the same default objects: a Deployment with both probes on `/healthz`, non-root, read-only root filesystem, small requests, one replica, `maxUnavailable: 0`; a ClusterIP Service on 8000. The default install must succeed on a vanilla cluster with no ingress controller, no particular CNI, no operator.

Everything else is a toggle that is off by default: Ingress, HTTPRoute, NetworkPolicy, CiliumNetworkPolicy, ServiceMonitor, OTLP export. A toggle in `values.yaml` has a matching component under `deploy/kustomize/components`. When you add a knob to one, add it to the other.

The README has four pasteable sections, and they are the acceptance test: deploy the public image; request the worked example from a pod in the namespace; change `sum`, build tag `2`, roll it out, request again; delete the namespace. Run them on a clean kind cluster before calling a change done.

Image: `ghcr.io/giovannirco/arith-ts`. Tags are plain integers (`1`, `2`), so a rollout is `--set image.tag=2` or `kubectl set image` with one variable. CI publishes a multi-arch image and the chart from a git tag. The Makefile builds the operator's local tag. The process writes nothing to disk, so the root filesystem stays read-only without an `emptyDir`.

## Tests

`make test` is the suite, `make cover` the coverage report. Cover the worked example, truncation in both signs, division by zero, a missing term, a non-integer, a term outside 64 bits, overflow in every operation, the error bodies, the page and its assets, the metrics text, graceful shutdown and the exporter wiring. Keep `npm run lint` (ESLint with typescript-eslint's strict type-checked rules, and `tsc --noEmit`) clean. Do not add a coverage threshold whose only job is to print a number.

## Versions

Pin what you depend on and look the version up before pinning it: base images by tag and digest, the curl image for tests, npm package versions in `package-lock.json`, Node in `.node-version`. Never write a version from memory.

## Out of scope

A second service. A database. Authentication. A service mesh. An Ingress or a LoadBalancer in the default install. A UI framework or a frontend build step. Pushing metrics anywhere.

## Done

- `make lint`, `make test` and `make cover` pass.
- `make run`, then every row of the README's API table returns the documented body, and `/` renders.
- `make image` produces an image that serves on 8000 as uid 65532 with a read-only root.
- `helm lint`, `helm template` with every toggle on, and `kubectl kustomize deploy/kustomize/overlays/example` all render and dry-run apply.
- On a clean kind cluster, following only the README: deploy, request from a pod, change `sum`, redeploy, request again, delete; namespace gone.
