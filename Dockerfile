# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Collateral — multi-stage image for Cloud Run / container deployment.
#
#   Build : installs deps with bun (bun.lock), builds the Vite frontend +
#           bundles server.ts
#   Runtime: node + python3 (yfinance) for live market prices + prod deps
#
# Build & run locally:
#   docker build -t collateral .
#   docker run --rm -p 3000:3000 -e GEMINI_API_KEY=... -e AUDIT_STORAGE=firestore collateral
# ---------------------------------------------------------------------------

# ---- Build stage -----------------------------------------------------------
FROM docker.io/oven/bun:1-slim AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# ---- Runtime stage ----------------------------------------------------------
FROM docker.io/node:24-slim AS runtime
ENV NODE_ENV=production

# Python + yfinance for live market prices (server.ts /api/portfolio/prices).
# The server shells out to `python3` (resolved via PATH below) for prices;
# without it, the app still runs but degrades to static fixture prices.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir yfinance \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/venv/bin:${PATH}"

# bun is not in node:24-slim — copy it from the build stage for the prod install
COPY --from=build /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock ./bun.lock
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.cjs"]
