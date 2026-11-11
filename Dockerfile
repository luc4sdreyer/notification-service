# syntax=docker/dockerfile:1

# Node 25+ no longer bundles corepack, so install a pinned one to get the pnpm
# version from package.json's packageManager field.
FROM node:26.13.0-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install --global corepack@0.36.0 && corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json openapi.yaml ./
COPY src ./src
RUN pnpm build

FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile

# Runtime image: compiled output, production dependencies and the spec only.
FROM node:26.13.0-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json openapi.yaml ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
