# EasyPanel — Deploy Automático

Este projeto está configurado para **deploy automático** no EasyPanel via GitHub.

## Configuração no EasyPanel

No serviço já criado no EasyPanel:

1. Abra **Github** (aba do serviço)
2. Configure:
   - **Repositório:** `facility2024/alexiaai`
   - **Branch:** `master` (não `main`)
   - **Tipo de construção:** `Dockerfile`
3. Salve

> O `Dockerfile` na raiz é multi-stage (build com `bun` + runtime `node:22-alpine`) e gera `.output/server/index.mjs` (Nitro `node-server` na porta `3000`).

## Variáveis de Ambiente

### Build Args (obrigatórias no build)

O Vite precisa das variáveis `VITE_*` **no momento do build**. Configure em EasyPanel > **Build Args** (ou **Variáveis** com opção de expor no build):

```
VITE_SUPABASE_URL=https://tweoiunfpawwwyzezlax.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
VITE_SUPABASE_PROJECT_ID=tweoiunfpawwwyzezlax
SUPABASE_URL=https://tweoiunfpawwwyzezlax.supabase.co
SUPABASE_PUBLISHABLE_KEY=eyJ...
SUPABASE_PROJECT_ID=tweoiunfpawwwyzezlax
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Runtime Env (serviço)

As mesmas variáveis acima devem estar em **Environment / Variáveis** do serviço para o runtime (`process.env` dentro de `*.server.ts`). O `Dockerfile` já expõe `PORT=3000` e `HOST=0.0.0.0`.

> Não commite `.env` — está no `.gitignore`.

## Fluxo de Deploy Automático

```bash
# 1. Altere o código
# 2. Commit + push no branch master
git add -A
git commit -m "feat: minha alteracao"
git push origin master
```

- Após o `push`, o EasyPanel detecta o novo commit no `master` e inicia o build automaticamente.
- Se não iniciar sozinho, clique em **Implantar** / **Deploy** no painel do serviço.
- O serviço roda com `node .output/server/index.mjs` na porta `3000` (já exposta no `Dockerfile`).

## Verificação Local (opcional)

```bash
bun run lint
bun run build
# Simula runtime do EasyPanel:
node .output/server/index.mjs
# -> http://localhost:3000
```

## Troubleshooting

- **Build falhou por `VITE_*` undefined:** confira se os Build Args estão preenchidos no EasyPanel (aba de build).
- **Branch errado:** confirme que está `master` no EasyPanel — este repositório usa `master` para deploy; `main` ainda existe mas não dispara deploy.
- **Deploy não dispara após push:** verifique se o repositório está conectado (aba Github) e clique em **Implantar** para forçar.
- **Arquivo `Dokerfile` (typo) removido:** use sempre `Dockerfile` (sem typo).

## Referência

- `Dockerfile:1` — build + runtime
- `vite.config.ts:8` — `@lovable.dev/vite-tanstack-config` + `nitro.preset = "node-server"`
- `src/server.ts:1` — wrapper SSR que evita h3 swallowed errors
