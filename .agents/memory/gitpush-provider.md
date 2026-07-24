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
