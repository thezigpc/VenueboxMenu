# Menu module image. Multi-stage: build everything in one stage, then a runtime stage
# with production dependencies only and the three built dist folders.
# Runs as `node` on a read-only root filesystem: only DATA_DIR (/data) is written.

FROM node:22-slim AS build
WORKDIR /app
# Dependencies first, so `npm ci` stays cached unless a package.json changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
# The vendored Bar Games SDK and game kit tarballs (file: dependencies).
COPY vendor ./vendor
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
COPY vendor ./vendor
# Production dependencies only (sharp brings its own prebuilt libvips for linux-x64).
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

# chown note (integration guide step 8): the image runs as uid 1000. A ./data bind mount
# that root created on an existing host needs `sudo chown -R 1000:1000 ./data` first.
RUN mkdir -p /data && chown node:node /data
USER node

ENV PORT=3005
ENV DATA_DIR=/data
EXPOSE 3005

# The healthcheck lives in docker-compose.yml only, so the two can't drift.
CMD ["node", "server/dist/index.js"]
