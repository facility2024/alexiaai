# ---- Build stage ----
FROM node:22.12-alpine AS build
WORKDIR /app

RUN npm install -g bun@1.1

COPY package.json bun.lockb* bunfig.toml* ./
RUN bun install --frozen-lockfile || bun install

# Variaveis VITE precisam estar disponiveis no build time
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ARG SUPABASE_URL
ARG SUPABASE_PUBLISHABLE_KEY
ARG SUPABASE_PROJECT_ID
ARG SUPABASE_SERVICE_ROLE_KEY

RUN echo "VITE_SUPABASE_URL=$VITE_SUPABASE_URL" > .env && \
    echo "VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY" >> .env && \
    echo "VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID" >> .env && \
    echo "SUPABASE_URL=$SUPABASE_URL" >> .env && \
    echo "SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY" >> .env && \
    echo "SUPABASE_PROJECT_ID=$SUPABASE_PROJECT_ID" >> .env && \
    echo "SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY" >> .env

COPY . .
RUN bun run build

# ---- Runtime stage ----
FROM node:22.12-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=build /app/.output ./.output
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
