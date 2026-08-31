# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app

RUN npm install -g bun@1.1

# Cache de dependencias: copia manifests primeiro
COPY package.json bun.lock* bunfig.toml* ./

# Instala dependencias (frozen se lock existir)
RUN bun install --frozen-lockfile 2>&1 || bun install

# Args de build - EasyPanel injeta aqui no build (Tipo de construcao = Dockerfile)
# VITE_* precisa estar disponivel no build para o Vite embutir no bundle
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ARG SUPABASE_URL
ARG SUPABASE_PUBLISHABLE_KEY
ARG SUPABASE_PROJECT_ID
ARG SUPABASE_SERVICE_ROLE_KEY

# Expor ARGs como ENV para o `vite build` ler
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID \
    SUPABASE_URL=$SUPABASE_URL \
    SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY \
    SUPABASE_PROJECT_ID=$SUPABASE_PROJECT_ID \
    SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY

# Copia codigo e faz build (gera .output/ via Nitro preset node-server)
COPY . .
RUN bun run build

# ---- Runtime stage ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=build /app/.output ./.output
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
