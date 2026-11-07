FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 NOTESPRIG_VAULT=/data/vault TRUST_PROXY=1
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /data/vault && chown -R node:node /app /data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node branding.json ./branding.json
COPY --chown=node:node LICENSE ./LICENSE
COPY --chown=node:node server ./server
COPY --chown=node:node scripts/backup.mjs ./scripts/backup.mjs
USER node
EXPOSE 4317
CMD ["node", "server/index.mjs"]
