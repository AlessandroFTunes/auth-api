FROM oven/bun:1-alpine
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000
USER bun

# aplica as migrations pendentes e sobe o servidor
CMD ["sh", "-c", "bun src/migrate.ts && bun src/repository/index.ts"]
