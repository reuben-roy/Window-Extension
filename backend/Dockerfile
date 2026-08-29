FROM node:22-bookworm-slim AS build

WORKDIR /app

# Prisma client generation runs during npm's postinstall hook, so the schema
# must be present before dependencies are installed.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY data ./data
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/data ./data

USER node
EXPOSE 8787

CMD ["sh", "-c", "if [ \"$PROCESS_TYPE\" = \"worker\" ]; then exec npm run start:worker; else exec npm start; fi"]
