---
name: Hunting system (animais, contratos, NPC)
description: Decisões de arquitetura do sistema de caça (set/2026) — servidor autoritativo, rig de animal = RigConfig v2, geometria do mapa gerada, protocolo HUNT_MSG.
---

# Sistema de caça — decisões (set/2026)

- **Contrato congelado em `shared/hunting/HuntingShapes.ts`** (espelhado ×3): config doc único `hunting_config` (variants por `variantId = <hunts|residents>/<animal>/<arquivo>`, contracts, general), protocolo `HUNT_MSG`, spec do schema (`AnimalState`/`NpcState`), constantes de sheet (12 col × 8 linhas, só 4 usadas: S/W/E/N; idle 0-2, walk 3-5, run 6-8, attack 9-11; loop yoyo 0-1-2-1).
- **Rig de animal = `RigConfig` v2 normal** em `rig_configs` (`rigId = rigIdForAnimal(cat, animal)` = `animal-<cat>-<animal>`), uma por PASTA de animal (variantes compartilham). `RIG_DIRECTION_NAMES` já é `south/west/east/north` = ordem das linhas dos animais — não inventar shape nova. Hitbox do ataque do animal vive no próprio rig (anim `attack`), diferente dos humanoides (perfil de arma).
- **Servidor não tem TMJ**: `scripts/extract-hunting-map.mjs` (cliente) gera `shared/hunting/craftingWorldMapData.ts` (anchors resident/hunt/monster_tree, safe_zone, 314 retângulos de colisão COM rotação). Re-rodar o script sempre que o usuário subir um `crafting-world.tmj` novo e espelhar ×3. `HuntingMapGeometry` faz ponto-em-retângulo-rotacionado com grade de 256px.
  **Why:** IA dos animais roda no WorldRoom (regiões `craft:*`), precisa de paredes/safe zone/anchors sem depender de assets do cliente (Colyseus Cloud não tem `public/`).
- Pasta real é `resources/hunting_animals` (underscore; o usuário escreveu "hunting-animals") e a camada do Tiled é `monster_tree` (singular, 16 pontos). Barbarian: 32×32, idle 4 col / walk 6 col, linhas S,N,W,E (ordem DIFERENTE dos animais → `NPC_DIRECTION_ORDER`).
- Dano do jogador em animal: só `gen:weapon/*` (level 1, mesmo resolvedor do Big Chess) ou mão (`general.handDamage`); `gen:crafttools/*` não fere. Melee = hook no `resolveFrame` do CombatResolver testando rects do golpe × união de hurtboxes do rig do animal; flecha = cliente reporta `hunt_arrow_hit` validado pelo `lastSwingFor` (janela/alcance iguais ao Big Chess).
- Contratos: 1 ativo por jogador, persistido em `player_hunting` (active + locks por contrato); morte, expiração, abandono e resgate travam o contrato por `cooldownHours`. Animais de contrato levam `contractOwner`; morto por outro jogador → repõe em 5 s. XP de caça via ProgressService (skill `hunting` já existia) e crowns via `chessworld_add_crowns`.
- Níveis: `HUNTING_LEVEL_PROFILES` (agressão, reação, cooldown, esquiva, recuo, flanco) + velocidade por nível editável por variante (`speedByLevel`, run; wander = ×0.55).
