# arith-ts

Integer arithmetic over HTTP: `GET /api/{sum,sub,mul,div}?term_one=<int>&term_two=<int>` answers `{"result": <int>}`. One Node.js process (TypeScript on Fastify) listening on port 8000, with a health check at `/healthz`, Prometheus metrics at `/metrics` and a small page at `/`.

The default install is a Deployment and a **ClusterIP** Service: reachable only from inside the cluster, and it needs nothing else from the cluster (no ingress controller, no particular CNI, no operator). Exposing it publicly is an optional extra (see [Optional pieces](#optional-pieces)).

## Prerequisites

- A Kubernetes cluster and `kubectl` pointed at it.
- `helm` 3.8 or newer.
- For step 3 only: `git`, `make`, Docker, and Node.js 24 to run the tests. To get the image into the cluster you also need kind or minikube, or a registry the cluster can pull from.

## The API

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

Terms and results are signed 64-bit integers. Division truncates toward zero (`-7/2 = -3`). Bad input, division by zero and a result that does not fit are `400` with a JSON reason; an unknown path is `404` and another method `405`, both JSON. In a query string `+` means a space, so send `%2B2` (or just `2`) for a positive sign.

## 1. Deploy

```sh
git clone https://github.com/giovannirco/arith-ts && cd arith-ts
helm install arith deploy/helm/arith-ts --namespace arith --create-namespace --wait
```

This installs image `ghcr.io/giovannirco/arith-ts:1.1.0`, the release the chart belongs to. Without Helm: `kubectl apply -k deploy/kustomize/base && kubectl -n arith rollout status deployment/arith`.

## 2. Verify

From a pod inside the cluster:

```sh
kubectl -n arith run client --rm -i --restart=Never --image=curlimages/curl:8.22.0 \
  --command -- sh -c "sleep 2; curl -s 'http://arith:8000/api/sub?term_one=4&term_two=1'"
```

Prints `{"result":3}`. (The pause lets kubectl attach before curl exits.) `helm test arith -n arith` runs the same check. To see the page: `kubectl -n arith port-forward svc/arith 8000:8000` and open <http://localhost:8000>.

## 3. Change the API and redeploy

The example makes `sum` saturate at the 64-bit limits instead of refusing. In `src/calc.ts`:

```diff
-export const sum = (a: bigint, b: bigint): bigint => fit(a + b);
+export const sum = (a: bigint, b: bigint): bigint => (a + b > MAX ? MAX : a + b < MIN ? MIN : a + b);
```

The tests pin the old behaviour, so update them too:

- in `test/calc.test.ts`, change `["sum", MAX, 1n, OVERFLOW]` to `["sum", MAX, 1n, MAX]` and `["sum", MIN, -1n, OVERFLOW]` to `["sum", MIN, -1n, MIN]`;
- in `test/api.test.ts`, delete the `/api/sum?term_one=9223372036854775807&term_two=1` line from `errors are 400 with a reason`, and add `await assertJson(200, '{"result":9223372036854775807}', "/api/sum?term_one=9223372036854775807&term_two=1");` to `the worked example`.

Then test, build under the local tag `dev` (no release uses it, so the cluster cannot pull a different image by that name), load it into the cluster and roll it out:

```sh
npm ci && make test
make image TAG=dev
kind load docker-image ghcr.io/giovannirco/arith-ts:dev            # kind (add --name <cluster> if not "kind")
# minikube image load ghcr.io/giovannirco/arith-ts:dev             # or minikube
helm upgrade arith deploy/helm/arith-ts --namespace arith --set image.tag=dev --wait
```

On a cluster that pulls from a registry, build and push to yours instead: `make image push IMAGE=registry.example.com/arith-ts TAG=dev`, then add `--set image.repository=registry.example.com/arith-ts` to the `helm upgrade`.

Ask again:

```sh
kubectl -n arith run client --rm -i --restart=Never --image=curlimages/curl:8.22.0 \
  --command -- sh -c "sleep 2; curl -s 'http://arith:8000/api/sum?term_one=9223372036854775807&term_two=1'"
```

Prints `{"result":9223372036854775807}` where the release answered `400`.

## 4. Remove

```sh
helm uninstall arith --namespace arith
kubectl delete namespace arith
```

With Kustomize: `kubectl delete -k deploy/kustomize/base`.

## Tests and coverage

```sh
npm ci
make test     # node --test: the table of cases, the HTTP contract, metrics, spans, the real process
make cover    # the same with c8: line and branch coverage, report in coverage/index.html
make lint     # ESLint (typescript-eslint, strict type-checked) and tsc --noEmit
make run      # serve on :8000 with readable logs
```

Node runs the TypeScript directly; the image runs JavaScript compiled by `tsc`. CI runs lint, tests with coverage, the chart and Kustomize renders, and installs this commit's image with the chart on a kind cluster and runs `helm test`.

## Configuration

Environment variables; the chart sets them through `env` in `values.yaml`.

| Variable | Default | Meaning |
|---|---|---|
| `ARITH_ADDR` | `0.0.0.0:8000` | Listen address |
| `ARITH_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `ARITH_LOG_FORMAT` | `json` | `json` or `text` |
| `ARITH_SHUTDOWN_TIMEOUT` | `10` | Seconds to finish in-flight requests after SIGTERM |
| `OTEL_TRACES_EXPORTER` | `none` | `otlp` sends one span per request |
| `OTEL_LOGS_EXPORTER` | `console` | `console`, `otlp`, `console,otlp` or `none` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | or `grpc` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | The collector; the other standard `OTEL_*` variables apply too |

A value the program cannot use stops it at start with a message naming the variable.

## Optional pieces

Off by default; each is a Helm value and a matching Kustomize component, because each needs something a cluster may not have.

| Piece | Helm value | Needs |
|---|---|---|
| Ingress | `ingress.enabled` | an ingress controller |
| HTTPRoute (public access) | `httpRoute.enabled` | Gateway API and a Gateway |
| NetworkPolicy | `networkPolicy.enabled` | a CNI that enforces policy |
| CiliumNetworkPolicy | `ciliumNetworkPolicy.enabled` | Cilium |
| ServiceMonitor | `serviceMonitor.enabled` | the Prometheus Operator CRDs |
| OTLP export | `env.OTEL_*` | a collector |

The public instance at <https://arith-ts.giovanni.dev.br> is one such install: `deploy/examples/arith.giovanni.dev.br.yaml` turns on the HTTPRoute, network policy, ServiceMonitor and OTLP export for that cluster. None of it is needed for steps 1 to 4.

## Versions and releases

One version per release, semver, written in `package.json` and repeated in `Chart.yaml` (`version` and `appVersion`) and the Kustomize base; CI fails if they disagree. Pushing a tag `v1.1.0` makes CI publish the image `ghcr.io/giovannirco/arith-ts:1.1.0` and the chart `oci://ghcr.io/giovannirco/charts/arith-ts` version `1.1.0`, which installs that image by default. CI never republishes a version. Commits on master (and pull requests from this repository) also get an image `:sha-<commit>`. There is no `latest` and no bare-integer tag.

```sh
helm install arith oci://ghcr.io/giovannirco/charts/arith-ts --version 1.1.0 --namespace arith --create-namespace
```

## Layout

```
src/            calc.ts (the operations), terms.ts (query parsing), app.ts (routes),
                metrics.ts, telemetry.ts, log.ts, config.ts, main.ts
test/           node:test suites
web/            the page: index.html, style.css, app.js
deploy/helm/    the chart
deploy/kustomize/  base, one component per optional piece, an example overlay
Dockerfile      node:alpine build and runtime, npm removed, uid 65532, read-only root
```

To add an operation: write it in `src/calc.ts` and list it in `OPERATIONS` (that adds the route `/api/<name>`), add its rows to `test/calc.test.ts`, and give the page a button in `web/index.html`.

## License

[MIT](LICENSE)
