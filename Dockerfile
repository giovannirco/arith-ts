# syntax=docker/dockerfile:1

# Stage 1: compile src/*.ts to dist/*.js and keep only the production
# dependencies. Everything in node_modules is plain JavaScript.
FROM node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Stage 2: Node, the compiled app, its dependencies and the page. distroless
# has no shell and no package manager, and its nonroot user is uid 65532.
# Pinned by digest. Nothing is written at runtime, so the root filesystem can
# be read-only.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e
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
USER 65532:65532
# The image's entrypoint is node.
CMD ["dist/main.js"]
