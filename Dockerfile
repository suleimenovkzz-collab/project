# syntax=docker/dockerfile:1

# ---- 1. React client -> client/dist ----
FROM node:24-bookworm-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
# The client bundles the shared contact defaults from ../config.
COPY config/contacts.defaults.json /app/config/contacts.defaults.json
RUN npm run build

# ---- 2. Server production dependencies (better-sqlite3 is native) ----
FROM node:24-bookworm-slim AS deps
WORKDIR /app
# Toolchain only for the case when no prebuilt better-sqlite3 binary matches; it stays out of the final image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- 3. Runtime ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node config ./config
COPY --chown=node:node core ./core
COPY --chown=node:node db ./db
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
COPY --from=client --chown=node:node /app/client/dist ./client/dist

# Mount points must exist and belong to `node`, so fresh named volumes inherit the ownership
# (and the uploads volume gets the stock photos from the image on first start).
RUN mkdir -p data public/uploads && chown -R node:node data public/uploads

USER node
EXPOSE 3000
VOLUME ["/app/data", "/app/public/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
