---
name: gitPush provider
description: gitPush sem provider empurra pro backup interno do Replit, não pro GitHub — sempre passar provider explícito.
---

# gitPush — sempre usar provider: "github"

**Regra:** toda chamada de `gitPush` deve ser `gitPush({ provider: "github" })`.

**Por quê:** sem o parâmetro, o callback auto-detecta o remote e escolhe o backup interno do Replit (gitsafe-backup), reportando "success" sem nunca tocar o repositório real em `https://github.com/matheussilvaf/chess-world-replit`. O Colyseus Cloud depende desse repo para deploy automático — sem push real, o servidor de produção não atualiza.

**Como aplicar:** em todo lugar que `gitPush` for chamado, incluir `{ provider: "github" }`:
```javascript
await gitPush({ provider: "github" });
```

## Quando `gitPush` não existe no sandbox
Sem a conexão GitHub anexada ao ambiente o callback nem aparece, e `git push` HTTPS falha (sem token). Caminho que funcionou (set/2026): propor a conexão GitHub (ProposeIntegration) e, com ela anexada, replicar os commits pela API Git Data via `listConnections('github')[0].proxyFetch` dentro de `"use impure"`: blobs (base64) → tree com `base_tree` (deleções com `sha: null`) → commit com autor/data originais → PATCH `git/refs/heads/main`. Conferir que o sha da tree remota == `git rev-parse <commit>^{tree}` (garante conteúdo idêntico). Os SHAs dos commits mudam, então depois `git fetch origin main && git reset --hard origin/main` (working tree limpa; verificar tree igual antes).
