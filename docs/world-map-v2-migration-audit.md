# Chess World v2 - Map Migration Audit Report

**Date:** 2026-07-17
**Status:** Audit complete. Migration NOT yet started. Old map remains active.

---

## 1. Arquitetura Atual

### Framework e Versoes

| Tecnologia | Versao | Funcao |
|---|---|---|
| Phaser | ^4.2.0 | Game engine (Arcade Physics) |
| React | ^18.3.1 | UI layer |
| Colyseus | ^0.15.28 (client) / ^0.15.0 (server) | Multiplayer rooms |
| LiveKit | ^2.20.1 | Voice chat |
| Supabase | ^2.57.4 | Auth, presence, data |
| Zustand | ^5.0.14 | State management |
| Vite | ^5.4.2 | Build tool |

### Arquivos-Chave

| Funcao | Arquivo |
|---|---|
| Instancia Phaser | `src/game/PhaserGame.ts` |
| Scene principal | `src/game/scenes/WorldScene.ts` |
| Configuracao do mapa | `src/game/config/mapConfig.ts` |
| Config do jogador | `src/game/config/playerConfig.ts` |
| Layout legado (coords fixas) | `src/game/map/mapLayout.ts` |
| Decoracoes legado | `src/game/map/decorations.ts` |
| Colyseus client | `src/game/network/colyseusClient.ts` |
| Interpolacao | `src/game/network/interpolation.ts` |
| Server room | `server/src/rooms/WorldRoom.ts` |
| Server state | `server/src/schemas/WorldState.ts` |
| Voice client | `src/game/voice/livekitVoiceClient.ts` |
| Chat hook | `src/hooks/useRealtimeChat.ts` |
| Constantes do jogo | `src/config/game.ts` |

### Como o Mapa Antigo e Carregado

**Preload** (`WorldScene.preload`, linha 62-98):
- `this.load.tilemapTiledJSON('world', '/assets/ChessWorldMap/world.tmj')`
- 21 tilesets carregados individualmente de `/assets/ChessWorldMap/sprites/`
- Spritesheet do jogador carregado separadamente

**Create** (`WorldScene.create`, linha 100-155):
- `this.make.tilemap({ key: 'world' })` cria o tilemap
- `map.addTilesetImage(name, name)` para 21 tilesets (nome deve coincidir com o Tiled)
- Tile layers criadas via `map.createLayer(name, allTilesets)` — pula layers no `skipLayers`
- Objetos com GID renderizados via `map.createFromObjects()`
- Physics bounds = `map.widthInPixels x map.heightInPixels`

**Colisoes** (`setupCollision`, linha 256-274):
- Le object layer `'collision'` (case-insensitive)
- Cria **apenas retangulos** como Static Arcade Bodies
- `physics.add.collider(player, collisionGroup)`
- **NAO suporta poligonos**

**Spawn** (`findSpawnPoint`, linha 243-254):
- Le object layer `'spawn'`
- Busca objeto `player_spawn` ou type `spawn`
- Fallback: centro do mapa

**Camera** (linha 146-148):
- Bounds = dimensoes em pixels do mapa
- Segue jogador com lerp 0.08
- Zoom padrao: 2, zoom de tabuleiro: 3

**Interativos** (`setupInteractives`, linha 276-338):
- Escaneia objetos com type `chess_arena` ou nome contendo "chess"
- Fallback: escaneia layers com nome "chessboard"
- Cria zonas interativas para click-to-play

### Caminho do Mapa Antigo

```
public/assets/ChessWorldMap/world.tmj
```

Configurado em `src/game/config/mapConfig.ts`:
```ts
path: '/assets/ChessWorldMap/world.tmj'
basePath: '/assets/ChessWorldMap/'
tileSize: 16
```

### Multiplayer - Sincronizacao

- **Client -> Server:** A cada 50ms enquanto move, envia `move_to` com `{x, y, targetX, targetY, direction, isMoving}`
- **Server (WorldRoom):** Atualiza `PlayerState` diretamente; Colyseus auto-sync para todos
- **Posicao padrao join:** `x: 800, y: 640`
- **Jogadores remotos:** Interpolados via `RemotePlayerInterpolator`
- **Nenhum ID de mapa** e enviado junto com a posicao — todos compartilham o mesmo WorldRoom por regiao

### Chat e Voz

- **Chat de texto:** Via mensagens Colyseus (`'chat'` event). UI e overlay React (`PublicChat.tsx`). **Zero acoplamento** com coordenadas ou mapa.
- **Chat de voz:** LiveKit room nomeado `voice_world_{region}`. Colyseus notificado via `voice_joined`/`voice_left`. **Zero acoplamento** com geometria do mapa.

### Referencias Fixas ao Mapa Antigo

| Arquivo | Referencia | Valor |
|---|---|---|
| `src/config/game.ts` | `WORLD_WIDTH` / `WORLD_HEIGHT` | 1600 / 1280 |
| `src/game/map/mapLayout.ts` | `MAP_WIDTH` / `MAP_HEIGHT` | 2000 / 1500 |
| `src/game/map/mapLayout.ts` | `SPAWN_X` / `SPAWN_Y` | 1000 / 750 |
| `src/game/map/mapLayout.ts` | `ARENAS[]` | 10 arenas com coords absolutas |
| `src/game/map/mapLayout.ts` | `HOUSES[]` | 8 casas com coords absolutas |
| `src/game/scenes/WorldScene.ts` | `getPlayerPosition()` fallback | 800, 640 |
| `server/src/rooms/WorldRoom.ts` | posicao padrao onJoin | 800, 640 |
| `src/game/config/mapConfig.ts` | path, basePath, tileSize | ChessWorldMap, 16 |

---

## 2. Validacao dos Novos Mapas

### main_world.tmj

| Propriedade | Valor |
|---|---|
| JSON valido | SIM |
| Dimensoes | 80x300 tiles (2560x9600 px) |
| Tile size | 32x32 |
| Tilesets externos (source) | NENHUM |
| Tilesets declarados | 55 (26 atlas + 29 single-tile) |
| Imagens referenciadas | 55 (todas presentes no disco) |
| Camadas totais | 146 (10 groups, 67 tile, 69 object) |

**Propriedades do mapa:**
- `mapId` = main_world
- `mapType` = overworld
- `defaultSpawn` = main_player_spawn
- `tileSize` = 32
- `villageId` = main_village

**Camadas logicas confirmadas (grupo GAMEPLAY):**
- [OK] world_zones
- [OK] character_anchors
- [OK] camera_anchors
- [OK] ui_anchors
- [OK] portal_interactions
- [OK] village_interactions
- [OK] house_interactions
- [OK] spawns
- [OK] building_interactions
- [OK] collisions
- [OK] chess_tables_interactions

**Estruturas confirmadas:**
- [OK] 14 chessboard layers (tabuleiros visuais)
- [OK] 14 board interaction zones em `chess_tables_interactions`
- [OK] 36 house layers
- [OK] 28 player positions (2 por tabuleiro: top + bottom)
- [OK] 28 spectator positions (2 left + 2 right por tabuleiro)
- [OK] 140 character anchors (sit/exit positions)
- [OK] 15 board overlays em ui_anchors
- [OK] 12 camera_focus areas em ui_anchors + 2 em camera_anchors
- [OK] 43 spawns (main + exit spawns)
- [OK] 186 collisions (131 rect + 55 polygons)
- [OK] main_player_spawn em (1273, 926)

**Nomes duplicados (intencionais, em grupos diferentes):**
- Grass, Park Roads, Fence, Energy Pole Base, Trees, traffic signs, Lamp Base, Tacts Academy Trees

**Objetos fora dos limites (2 warnings):**
- House13 tile object em x:-51 (praticamente na borda, toleravel)
- world_zones objeto em x:3031 (fora da largura 2560 - precisa verificacao)

**Custom properties nos objetos:** action, anchorType, boardFiles, boardRanks, buildingId, collisionType, direction, fitMode, focusMode, houseCapacity, houseId, instanceMode, interaction, interactionType, interactive, lockCenter, objectId, obstacleType, overlayId, padding, part, portalId, position, requiresInput, role, seatIndex, side, sourceMap, spawnId, spawnType, tableCount, tableId, targetMap, targetSpawn, triggerMode, updateMode, villageId, zoneId, zoneType

---

### main_village_template.tmj

| Propriedade | Valor |
|---|---|
| JSON valido | SIM |
| Dimensoes | 80x180 tiles (2560x5760 px) |
| Tile size | 32x32 |
| Tilesets externos (source) | NENHUM |
| Tilesets declarados | 56 |
| Imagens referenciadas | 56 (55 encontradas, 1 faltando: Actor1.png) |

**Propriedades do mapa:**
- [OK] mapId = main_village_template
- [OK] mapType = village_template
- [OK] defaultSpawn = village_instance_entry
- [OK] templateId = main_village_template
- [OK] instanceMode = dynamic
- [OK] houseCapacity = 36
- [OK] tileSize = 32

**Estruturas confirmadas:**
- [OK] village_instance_entry_spawn presente
- [OK] village_instance_exit_gateway presente
- [OK] village_instance_zone presente
- [OK] Nenhum villageId fixo nas casas
- [OK] 36 house interaction entries
- [OK] 36 house exit spawns
- [OK] 4 collisoes de limite do mapa (map_boundary_left/right/top/bottom)
- [OK] 42 collisoes totais (4 rect + 38 polygons)

**Imagem faltando:** `Actor1.png` - provavelmente um spritesheet de character nao incluido nos assets (nao e bloqueante para a estrutura do mapa).

---

## 3. Suporte a Colisoes Poligonais

### Situacao Atual

O metodo `setupCollision` em `WorldScene.ts` (linha 256-274) **so suporta retangulos**:

```typescript
collisionLayer.objects.forEach(obj => {
  if (obj.x !== undefined && obj.y !== undefined && obj.width && obj.height) {
    const rect = this.add.rectangle(
      obj.x + obj.width / 2, obj.y + obj.height / 2,
      obj.width, obj.height
    );
    this.physics.add.existing(rect, true);
    this.collisionGroup.add(rect);
  }
});
```

### Novos Mapas

- **main_world:** 55 poligonos + 131 retangulos nas colisoes
- **village_template:** 38 poligonos + 4 retangulos nas colisoes
- **Total: 94 poligonos** que o sistema atual ignora completamente

### Opcoes para Implementacao

| Opcao | Complexidade | Performance | Precisao |
|---|---|---|---|
| **A. Matter.js** | ALTA (reescrever fisica) | Boa | Perfeita |
| **B. poly-decomp + Arcade** | MEDIA | Boa | Muito boa |
| **C. Raycasting manual** | MEDIA | Variavel | Boa |

**Recomendacao:** Opcao B - Decompor poligonos convexos e criar multiplos corpos Arcade por poligono. Evita reescrever todo o sistema de movimentacao (que ja funciona bem com Arcade) e mantem compatibilidade com o multiplayer existente.

**Mudancas necessarias:**
1. Adicionar logica em `setupCollision` para detectar `obj.polygon`
2. Para cada poligono, converter vertices relativos em absolutos
3. Decompor em partes convexas (ou usar bounding boxes apenas para poligonos simples)
4. Criar um body Arcade para cada parte convexa
5. Alternativa: usar `Phaser.Geom.Polygon` com overlap checks manuais

---

## 4. Arquivos que Precisarao Ser Modificados

| Arquivo | Mudanca |
|---|---|
| `src/game/config/mapConfig.ts` | Novo path, basePath, tileSize (32), novos skipLayers |
| `src/game/scenes/WorldScene.ts` | Nova lista de tilesets (55), logica de poligonos, novos nomes de layers interativas, spawns |
| `src/game/PhaserGame.ts` | Possivelmente config de fisica (se Matter.js) |
| `src/game/config/playerConfig.ts` | Body size/offset para novo tileSize |
| `src/config/game.ts` | WORLD_WIDTH=2560, WORLD_HEIGHT=9600 |
| `src/game/map/mapLayout.ts` | Remover ou substituir - coords legacy |
| `src/game/map/decorations.ts` | Remover ou substituir |
| `server/src/rooms/WorldRoom.ts` | Coords padrao de spawn (1273, 926) |
| `src/components/game/BoardModal.tsx` | Novos IDs de arena (table_01..table_14) |

---

## 5. Riscos de Regressao

| Risco | Severidade | Mitigacao |
|---|---|---|
| Troca de tile size (16->32) quebra body offsets | MEDIA | Ajustar body.setSize/setOffset |
| Novos IDs de tabuleiro quebram challenges existentes | ALTA | Mapear IDs antigos para novos |
| Mapa 6x maior (1600x1280 -> 2560x9600) afeta performance | MEDIA | Testar com camera culling |
| 55 tilesets vs 21 aumenta tempo de load | BAIXA | Phaser faz lazy rendering |
| Poligonos ignorados = jogador atravessa paredes | ALTA | Implementar antes de migrar |
| world_zones objeto fora dos limites (x:3031) | BAIXA | Verificar com designer |
| House13 em x:-51 (ligeiramente fora) | BAIXA | Toleravel |
| Actor1.png ausente no village_template | BAIXA | Nao bloqueia (tileset de character) |

---

## 6. Ordem Recomendada de Implementacao

1. **Implementar suporte a poligonos** no setupCollision (sem alterar mapa carregado)
2. **Criar MapConfigV2** paralelo ao config atual
3. **Criar WorldSceneV2** (ou adaptar WorldScene com feature flag)
4. **Carregar novo mapa** com 55 tilesets no preload
5. **Configurar layers** (skip patterns, createLayer, createFromObjects)
6. **Conectar interativos** (chess_tables_interactions com propriedades tableId)
7. **Conectar spawns** (main_player_spawn, exit spawns)
8. **Ajustar camera** (novo tamanho de mapa, camera_anchors)
9. **Testar multiplayer** com novas coordenadas
10. **Feature flag** para alternar entre mapas durante testes
11. **Remover mapa antigo** somente apos nova versao estavel

---

## 7. Estrategia para Preservar Chat, Voz e Multiplayer

- **Chat:** Nenhuma mudanca necessaria. Chat e message-based via Colyseus, desacoplado da geometria.
- **Voz:** Nenhuma mudanca necessaria. LiveKit room e nomeado por regiao, nao por mapa.
- **Multiplayer posicional:** Funciona com qualquer coordenada. O `move_to` envia x/y absolutos. Desde que todos carreguem o mesmo mapa, posicoes serao consistentes.
- **Registro de boards:** O `register_boards` ja registra dinamicamente a partir do Tiled. Basta enviar os novos dados ao conectar.

---

## 8. Estrategia para Remover o Mapa Antigo

1. Manter mapa antigo **100% funcional** durante desenvolvimento
2. Adicionar config switch (`MAP_VERSION: 'v1' | 'v2'`) em `mapConfig.ts`
3. Testar v2 com feature flag (env var ou URL param)
4. Apos v2 confirmado estavel:
   - Remover `public/assets/ChessWorldMap/` inteiro
   - Remover `src/game/map/mapLayout.ts` e `decorations.ts`
   - Atualizar `mapConfig.ts` para apontar exclusivamente para world-v2
   - Limpar qualquer branching v1/v2

---

## 9. Resultado da Validacao

```
npm run validate:world-maps

STATUS: PASSED WITH WARNINGS
Errors: 0 | Warnings: 6 | Polygons: 94

Warnings:
- [main_world] House13 tile object em x:-51 (borda)
- [main_world] world_zones objeto em x:3031 (fora do mapa)
- [main_world] 2 objetos fora dos limites
- [village_template] Actor1.png ausente
- [village_template] House13 em x:-51 (borda)
- [village_template] 1 objeto fora dos limites
```

Nenhum erro bloqueante. Mapas prontos para migracao.
