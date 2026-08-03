# syntax=docker/dockerfile:1

# ── Stage 1: build the React front-end ───────────────────────────────────────
FROM node:22-alpine AS web
WORKDIR /web
COPY web-react/package.json web-react/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web-react/ ./
RUN npm run build

# ── Stage 2: runtime — Express API + /sync + the built SPA ───────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/ ./
# The server serves ../../web-react/dist (see WEB_DIST in src/index.js).
COPY --from=web /web/dist /app/web-react/dist
EXPOSE 3000
CMD ["npm", "start"]
