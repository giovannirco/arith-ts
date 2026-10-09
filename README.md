# arith-ts

arith does integer arithmetic over HTTP. Four endpoints, a page that calls them, Prometheus on `/metrics`. One Node.js process, TypeScript on Fastify, on port 8000. Traces and logs go over OTLP if you set the usual `OTEL_*` variables; otherwise they stay on stdout.

Helm and Kustomize both install a Deployment and a ClusterIP Service. The default install works on a cluster that has nothing else: no ingress controller, no special CNI, no operator.

I run one at <https://arith.giovanni.dev.br>. The values for that cluster are in `deploy/examples/arith.giovanni.dev.br.yaml`. The same contract is also implemented in Rust, <https://github.com/giovannirco/arith-rust>, and in Ruby, <https://github.com/giovannirco/arith-ruby>.

## API

| Request | Response |
|---|---|
| `GET /api/sum?term_one=4&term_two=1` | `200 {"result":5}` |
| `GET /api/sub?term_one=4&term_two=1` | `200 {"result":3}` |
| `GET /api/mul?term_one=4&term_two=1` | `200 {"result":4}` |
| `GET /api/div?term_one=7&term_two=2` | `200 {"result":3}` |
| `GET /api/div?term_one=1&term_two=0` | `400 {"error":"division by zero"}` |
| `GET /api/sum?term_one=abc&term_two=1` | `400 {"error":"term_one must be an integer, got \"abc\""}` |
| `GET /api/sum?term_one=1` | `400 {"error":"term_two is required"}` |
| `GET /api/sum?term_one=9223372036854775807&term_two=1` | `400 {"error":"result does not fit in a 64-bit integer"}` |
| `GET /healthz` | `200 {"status":"ok"}` |
| `GET /metrics` | `200`, Prometheus text format |
| `GET /` | `200`, the page |

### Decisions

- Terms and results are signed 64-bit integers. A JavaScript number is a double and loses integers past 2^53, so terms and results are `bigint`, and the range is checked on every term and every result. `1.5` is rejected, not rounded. A term that looks like an integer but does not fit gets its own message: `term_one does not fit in a 64-bit integer, got "..."`.
- A term is an optional sign and decimal digits, nothing else: `010` is ten, and `0x1f`, `1e3`, `1n` and ` 5` are rejected, although `Number()` or `BigInt()` would take some of them.
- Division truncates toward zero: `7/2 = 3`, `-7/2 = -3`, which is what `bigint` division does. Dividing by zero is a `400`.
- A result outside the 64-bit range is a `400`, not a bigger number. Results are written as plain JSON numbers, all 64 bits of them: `{"result":9223372036854775807}`.
- Every error is JSON, `{"error":"..."}`, and the text says what was wrong with which parameter. An unknown path is `404 {"error":"not found"}`. A method other than GET is `405 {"error":"method not allowed"}`. Bytes in the query that are not UTF-8 show up in the message as `\uFFFD`.
- In a query string `+` is a space, so `term_two=+2` is rejected. Send `%2B2`, or just `2`.
- `/healthz` is the only health URL. Liveness and readiness both use it.

## The page

`GET /` is one screen from the same process: two fields, four operations, the result, and the error text when the API refuses a call. No frontend build, no second container. The page asks the API for every result. It does not compute anything itself.

Locally that is <http://localhost:8000>. In a cluster the Service is ClusterIP, so a person opens it with `kubectl port-forward`. Other workloads call the Service directly.

## Run it here

You need Node.js 24 ([nodejs.org](https://nodejs.org/en/download)), or just Docker. `.node-version` names the exact Node CI and the image use.

```sh
npm ci
make test     # unit tests and the HTTP contract
make cover    # the same, with a line and branch coverage report (c8)
make run      # serve on :8000 with readable logs
make image    # docker build, tag 1
```

Node runs the TypeScript in `src/` and `test/` directly; there is no build step for tests or `make run`. The image runs JavaScript compiled by `tsc`. `make cover` prints a per-file table and writes `coverage/index.html`. The suite covers the worked example, truncation in both signs, division by zero, missing and non-integer terms, overflow in every operation, the error bodies, the page and its assets, the metrics, the access log, the spans, the exporter wiring for both OTLP transports, and the real process: it serves, drains on SIGTERM, gives up on a connection that never finishes, and refuses a bad setting.

## Configuration

Everything is an environment variable. `ARITH_*` belong to this program. `OTEL_*` are the [OpenTelemetry names](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/), so a collector's documentation applies as written. A value the program cannot use stops it at start, with a message naming the variable.

| Variable | Default | Meaning |
|---|---|---|
| `ARITH_ADDR` | `0.0.0.0:8000` | Listen address, `host:port` (`[::]:8000` for IPv6) |
| `ARITH_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `ARITH_LOG_FORMAT` | `json` | `json` or `text` |
| `ARITH_SHUTDOWN_TIMEOUT` | `10` | Seconds to let requests finish after SIGTERM |
| `OTEL_TRACES_EXPORTER` | `none` | `otlp` sends one span per request |
| `OTEL_LOGS_EXPORTER` | `console` | `console`, `otlp`, `console,otlp` or `none` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | or `grpc` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` (`:4317` for gRPC) | Where OTLP goes. `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` override it per signal |
| `OTEL_SERVICE_NAME` | `arith` | `service.name` on every span and log record |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` | `parentbased_always_on` | e.g. `parentbased_traceidratio` and `0.1` |
| `OTEL_EXPORTER_OTLP_HEADERS` | | `key=value,...`, for tenancy or auth headers |

The image sets `NODE_ENV=production`.

Metrics are pulled, not pushed: scrape `/metrics`. You get `http_requests_total` and `http_request_duration_seconds` by method, route template and status, `arith_operations_total` by operation and outcome (`ok`, `bad_input`, `division_by_zero`, `overflow`), and `arith_build_info`.

Two shapes that work:

```sh
# Through a collector (Alloy, the OpenTelemetry Collector) that fans out to Tempo and Loki.
OTEL_TRACES_EXPORTER=otlp OTEL_LOGS_EXPORTER=console,otlp \
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy.monitoring.svc:4318 make run

# Straight to the stores. Tempo takes OTLP on 4318. Loki takes OTLP logs on /otlp.
OTEL_TRACES_EXPORTER=otlp OTEL_LOGS_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://tempo:4318/v1/traces \
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://loki:3100/otlp/v1/logs make run
```

A request that arrives with a W3C `traceparent` header joins that trace, so a span from a gateway in front continues into the service. Each access-log line carries the trace id, as a field on stdout and in the record itself over OTLP.

If an agent already tails pod stdout into Loki, pick one of `console` and `otlp` for logs, or every line is stored twice.

## Deploy

You need `kubectl` pointed at a cluster, and `helm` 3.8 or newer for the Helm path. The default install is a Deployment and a ClusterIP Service in namespace `arith`. Helm and Kustomize produce the same objects.

### 1. Deploy the public image

```sh
git clone https://github.com/giovannirco/arith-ts && cd arith-ts
helm install arith deploy/helm/arith-ts --namespace arith --create-namespace --wait
```

The same with Kustomize, no Helm needed:

```sh
kubectl apply -k deploy/kustomize/base
kubectl -n arith rollout status deployment/arith
```

### 2. Request it from inside the cluster

```sh
kubectl -n arith run client --rm -i --restart=Never --image=curlimages/curl:8.22.0 \
  --command -- sh -c "sleep 2; curl -s 'http://arith:8000/api/sub?term_one=4&term_two=1'"
```

Prints `{"result":3}`. The pause lets kubectl attach before curl exits; without it a pod this quick often prints nothing. `helm test arith -n arith` runs the same check as a Helm test. For the page:

```sh
kubectl -n arith port-forward svc/arith 8000:8000
```

and open <http://localhost:8000>.

### 3. Change the API and redeploy

Any edit works. The one used for the dry run makes `sum` saturate at the 64-bit limits instead of refusing. In `src/calc.ts`:

```diff
-export const sum = (a: bigint, b: bigint): bigint => fit(a + b);
+export const sum = (a: bigint, b: bigint): bigint => (a + b > MAX ? MAX : a + b < MIN ? MIN : a + b);
```

`make test` now fails on the overflow expectations for `sum`. That is the suite doing its job. Three places disagree with the new behaviour:

- two rows in the table in `test/calc.test.ts`: change `["sum", MAX, 1n, OVERFLOW]` to `["sum", MAX, 1n, MAX]` and `["sum", MIN, -1n, OVERFLOW]` to `["sum", MIN, -1n, MIN]`;
- one case in `test/api.test.ts`, `/api/sum?term_one=9223372036854775807&term_two=1` in `errors are 400 with a reason`: move it into `the worked example` as `await assertJson(200, '{"result":9223372036854775807}', "/api/sum?term_one=9223372036854775807&term_two=1");`.

Run `make test` again until it passes, then build and roll out:

```sh
make test
make image TAG=2
```

Put the image where the cluster can pull it. For kind:

```sh
kind load docker-image ghcr.io/giovannirco/arith-ts:2 --name kind
```

For minikube, `minikube image load ghcr.io/giovannirco/arith-ts:2`. For a real cluster, push to a registry it trusts and add `--set image.repository=registry.example.com/arith` to the next command.

```sh
helm upgrade arith deploy/helm/arith-ts --namespace arith --set image.tag=2 --wait
```

With Kustomize: `kubectl -n arith set image deployment/arith arith=ghcr.io/giovannirco/arith-ts:2 && kubectl -n arith rollout status deployment/arith`, and write the new tag into `deploy/kustomize/base/kustomization.yaml` so the next apply keeps it.

Then ask again:

```sh
kubectl -n arith run client --rm -i --restart=Never --image=curlimages/curl:8.22.0 \
  --command -- sh -c "sleep 2; curl -s 'http://arith:8000/api/sum?term_one=9223372036854775807&term_two=1'"
```

Prints `{"result":9223372036854775807}` where tag 1 answered `400`.

### 4. Remove

```sh
helm uninstall arith --namespace arith
kubectl delete namespace arith
```

With Kustomize, `kubectl delete -k deploy/kustomize/base` removes the namespace too.

## Versions

Two numbers, and they move separately.

- The **image tag** is a plain integer: `ghcr.io/giovannirco/arith-ts:1`, `:2`. `--set image.tag=2` or `kubectl set image` rolls one out. `make image TAG=2` builds one locally.
- The **chart version** is semver, in `deploy/helm/arith-ts/Chart.yaml`. It goes up whenever a template or a default changes, and the chart's `appVersion` is the image tag it installs by default.

A release is a commit that bumps the chart version, then a numeric git tag: `git tag 2 && git push origin 2`. CI publishes the image as `:2` and `:latest`, and the chart at its new version with `appVersion` set to `2`. If that chart version is already on GHCR the chart job fails instead of overwriting it. `oras repo tags ghcr.io/giovannirco/charts/arith-ts` lists what is published, and

```sh
helm install arith oci://ghcr.io/giovannirco/charts/arith-ts --version <chart version> --namespace arith --create-namespace
```

installs a particular one. The chart in this repository keeps `appVersion: "1"`, so section 3 above always shows a rollout from 1 to 2. Follow the walkthrough with that chart, not a published one: a published chart defaults to the newest image, and `--set image.tag=2` may then change nothing.

## Optional pieces

Each one is a Helm toggle and a Kustomize component, off by default, because each needs something a cluster may not have.

| Piece | Helm value | Kustomize component | Needs |
|---|---|---|---|
| Ingress | `ingress.enabled` | `components/ingress` | an ingress controller |
| HTTPRoute | `httpRoute.enabled` | `components/httproute` | Gateway API and a Gateway to attach to |
| NetworkPolicy | `networkPolicy.enabled` | `components/networkpolicy` | a CNI that enforces policy |
| CiliumNetworkPolicy | `ciliumNetworkPolicy.enabled` | `components/cilium-networkpolicy` | Cilium |
| ServiceMonitor | `serviceMonitor.enabled` | `components/servicemonitor` | the Prometheus Operator CRDs |
| OTLP export | `env.OTEL_*` | `components/otlp` | a collector, Tempo or Loki to send to |

The two network policies default-deny and then allow: ingress on 8000 from pods in the cluster (or from the namespaces you list, such as your gateway's), probes from the nodes, egress to DNS and to whatever you name as a destination (your OTLP collector). `deploy/helm/arith-ts/values.yaml` documents every value. `deploy/kustomize/overlays/example` composes every component with placeholder names. `deploy/examples/arith.giovanni.dev.br.yaml` is a full set that actually runs.

## Layout

```
src/calc.ts                 sum, sub, mul, div on 64-bit bigints, and OPERATIONS
src/terms.ts                reading term_one and term_two from the query
src/app.ts                  the routes, 404 and 405, and the per-request span, metrics and log line
src/page.ts                 web/ read once at start
src/metrics.ts              the Prometheus registry
src/telemetry.ts            where logs and traces go
src/log.ts                  the log line format
src/config.ts               the environment variables
src/main.ts                 listen, drain on SIGTERM, exit code
web/                        index.html, style.css, app.js
test/                       the table of cases, the HTTP contract, the process
Dockerfile                  node:alpine build and runtime, npm removed, uid 65532
deploy/helm/arith-ts        the chart
deploy/kustomize            base, components, an example overlay
Makefile                    test, cover, lint, run, image, push, deploy, upgrade, remove
```

To add or change an operation: edit its function in `src/calc.ts` and list it in `OPERATIONS` (that gives it the route `/api/<name>`), add its rows to the table in `test/calc.test.ts`, and give the page a button in `web/index.html`. The error strings live in `src/calc.ts` and `src/terms.ts`, next to the tests that pin them.

## License

[MIT](LICENSE)
