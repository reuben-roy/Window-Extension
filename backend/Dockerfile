FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Prisma client generation runs during npm's postinstall hook, so the schema
# must be present before dependencies are installed.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY data ./data
RUN npm run build

USER node
EXPOSE 8787

CMD ["npm", "start"]
