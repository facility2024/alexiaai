# ---- Build stage ----
FROM node:22.12-alpine AS build
WORKDIR /app

# Instala bun para usar como package manager/runtime
RUN npm install -g bun@1.1

# Instala dependências primeiro para aproveitar cache
COPY package.json bun.lockb* bunfig.toml* ./
RUN bun install --frozen-lockfile || bun install

# Copia o restante do código e faz o build
COPY . .
RUN bun run build

# ---- Runtime stage ----
FROM node:22.12-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copia artefato do build + node_modules + .env (server precisa de SUPABASE_URL/KEY)
COPY --from=build /app/.output ./.output
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
