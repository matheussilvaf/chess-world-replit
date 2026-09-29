---
name: Spawn/posição autoritativa
description: Por que o servidor resolve o spawn por whitelist (spawnId) e como isso se liga ao guard de movimento — bug do "jogador congelado".
---

# Spawn resolvido pelo servidor (set/2026)

**Regra:** o cliente nunca manda x/y de nascimento; manda só um `spawnId` da whitelist compartilhada (`shared/world/SpawnPoints.ts`, ×3) e o servidor resolve a coordenada (salas internas e regiões `craft:*` têm ponto único; desconhecido cai no padrão).

**Why:** o `onJoin` ignorava x/y e nascia todo mundo no spawn do mundo; quem entrava pela saída da Academia (~1900 px longe) tinha TODO `move_to` rejeitado pelo guard de distância (64 px + 180 px/s) — para os outros o personagem ficava congelado no ponto errado para sempre.

**How to apply:** ao mover um spawn no Tiled, atualizar a whitelist (as coordenadas são copiadas dos `.tmj`). Verificação rápida sem Phaser: script Node com dois clientes colyseus.js (join → `move_to` a 60 px → o outro vê a posição). Limite conhecido: qualquer `spawnId` da whitelist do mundo principal é aceito (teleporte só entre saídas públicas do mesmo mapa) — restringir por transição autorizada se isso virar problema.
