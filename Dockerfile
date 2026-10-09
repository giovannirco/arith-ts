# syntax=docker/dockerfile:1

# Stage 1: compile src/*.ts to dist/*.js and keep only the production
# dependencies. Everything in node_modules is plain JavaScript.
FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Stage 2: Node, the compiled app, its dependencies and the page, on the same
# Alpine base, pinned by digest.
#
# The base's npm, npx, corepack and yarn go: the app never runs them, and the
# packages bundled inside npm were most of what a vulnerability scan found.
# zlib comes up to 1.3.2-r1 (CVE-2026-85091). distroless/nodejs, the runtime
# before, has no shell, but its Debian 13 packages (libc6, the gcc 14 runtime,
# zlib1g) carry known vulnerabilities with no fixed version to move to.
FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
RUN apk add --no-cache --upgrade 'zlib>=1.3.2-r1' && \
    rm -rf /usr/local/lib/node_modules /opt/yarn-* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg
LABEL org.opencontainers.image.source="https://github.com/giovannirco/arith-ts" \
      org.opencontainers.image.description="Integer arithmetic over HTTP: four endpoints, a page, metrics, traces and logs." \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY web ./web
EXPOSE 8000
# By number, so `runAsNonRoot: true` can verify it. Nothing is written at
# runtime, so the root filesystem can be read-only.
USER 65532:65532
ENTRYPOINT ["node", "dist/main.js"]
