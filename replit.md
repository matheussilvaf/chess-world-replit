# ChessWorld MMO

Multiplayer chess world: players walk around a 2D world (Phaser), challenge each other, and play automated Swiss tournaments — real-time layer runs on a Colyseus server, persistent data on Supabase.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- **`server/` — A pasta oficial do servidor Colyseus.** Pacote npm standalone (npm puro, `package-lock.json`, `ecosystem.config.cjs`, binário bbpPairings). É o **app root do deploy no Colyseus Cloud** (`/server/`) — multiplayer em tempo real, salas (WorldRoom, TournamentRoom), torneio suíço, coordenador. Nunca apagar nem mover.
- `artifacts/api-server/src/src/` — espelho byte a byte de `server/src/` para rodar o servidor localmente dentro do monorepo. **Toda mudança de código Colyseus deve ser aplicada nas DUAS pastas** (`diff -rq server/src artifacts/api-server/src/src` deve sair vazio antes do commit).
- `artifacts/chessworld/` — cliente web (React + Phaser), conecta no Colyseus via `VITE_COLYSEUS_URL`.
- Dados persistentes (contas, ratings, histórico, config de torneio) — Supabase (Postgres), acessado pelo servidor Colyseus e pelo cliente.
- **Tactics Academy** (mapa interno `public/assets/world-v2/tactics-academy.tmj`, sala Colyseus `academy` = mesma `WorldRoom`): contrato em `server/src/shared/academy/AcademyShapes.ts` (espelhado ×3), servidor em `server/src/academy/` (`GET /api/academy/bots`, `PUT /api/admin/academy/bots`, `GET /api/academy/bot-games/me`) + `createBotMatch`/`bot_move` na `WorldRoom`; SQL das tabelas `academy_bots`/`bot_games` em `server/supabase/tactics_academy_phase1.sql`. Cliente: engine Stockfish em Web Worker (`src/game/bots/`, assets copiados para `public/engine/` pelo `scripts/copy-stockfish.mjs` no dev/build), bancada isolada em `/dev/bots`, admin em `/admin/academy`.
- **Academia — Sala de Puzzles (fase 2)**: contrato `server/src/shared/academy/PuzzleShapes.ts` (+ `puzzleSolver.ts` puro e `battleEngine.ts` = máquina de estados das batalhas, testes vitest no cliente), servidor em `server/src/academy/puzzles/` (`AcademyPuzzleManager` ligado à `WorldRoom` só na sala `academy`; mensagens `PUZZLE_MSG`), rotas `GET /api/academy/{puzzles/themes,daily/me,battles/me}` e admin `/api/admin/academy/puzzles/*` (config diária por data, pins, recompensas das batalhas, contagem, preview, lookup). Puzzles vêm de `public.lichess_puzzles` (sorteio por `random_key`, nunca `ORDER BY RANDOM`; lances futuros nunca saem do servidor). SQL: `server/supabase/tactics_academy_phase2.sql` (tabelas `academy_daily_puzzles`, `academy_daily_attempts`, `academy_daily_config`, `academy_daily_pins`, `academy_battle_config`, `academy_puzzle_battles`, tabela `academy_puzzle_themes` (contagem por tema, preenchida pelo SQL)). Cliente: `stores/{puzzleStore,battleStore}.ts`, `game/network/{puzzleHandlers,battleHandlers}.ts`, UI em `components/academy/puzzles/`, bancadas `/dev/puzzles` e `/dev/batalhas`, aba "Puzzles diários"/"Batalhas" em `/admin/academy`. E2E do protocolo contra o servidor local: `node artifacts/api-server/scripts/e2e-puzzles.mjs`.

## Architecture decisions

- **Tempo real = Colyseus, sempre.** Movimento de jogadores, partidas, torneio suíço e bbpPairings rodam no servidor Colyseus (produção: Colyseus Cloud). Supabase é só armazenamento persistente — nunca substituir o Colyseus por polling de banco.
- Duas cópias do código do servidor por necessidade de deploy: o Colyseus Cloud precisa de um pacote npm standalone na raiz (`server/`), o monorepo pnpm usa `workspace:*` que o npm da nuvem não resolve. Por isso o espelho.
- Colyseus Cloud faz deploy automático quando novos commits chegam ao GitHub (por isso a regra de sempre dar push).

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- **Sempre dar push para o GitHub após qualquer mudança no projeto.** Qualquer edição em qualquer pasta (incluindo `server/`, `artifacts/`, raiz) deve ser seguida imediatamente de `gitPush({ provider: "github" })`. **Sempre use `provider: "github"` explicitamente** — sem ele, o `gitPush` manda para o backup interno do Replit e não para o repositório real. O Colyseus Cloud monitora o repositório e faz deploy automático quando detecta novos commits — sem push, o servidor de produção não atualiza.

## Gotchas

- Academia: força dos bots SÓ via `UCI_LimitStrength`+`UCI_Elo` (`BOT_ENGINE_PARAMS`), nível sempre em barras (nunca rating numérico); o lance do bot é calculado no navegador do humano e validado no servidor; partidas contra bot não mexem em Glicko/Gambitos e vão para `bot_games` (não `matches`).
- O TMJ da academia usa tilesets externos (`.tsx`) e `tableId` duplicado por copiar/colar: `externalTilesets.ts` embute os tilesets em runtime e `WorldScene.switchMap` reescreve o `tableId` de cada mesa pelo nome da pasta do Tiled (`Bot_1` → `academy_bot_1`).
- Numa sala com um único humano (academia), a `WorldRoom` desliga o `autoDispose` enquanto houver janela de reconexão pendente (`syncGraceHold`) — senão o Colyseus descarta a sala na queda e a partida some.
- Sala de Puzzles: recompensas SÓ em Gambitos (sem XP, sem Coroas) via `awardGambitsAtomic` idempotente (`daily:<data>:<slot>` / `battle:<id>`); dia do puzzle diário fixo em UTC−3; desconexão numa batalha ≠ desistência (offline + rejoin reenvia estado; saída explícita = derrota; ambos offline 60 s → aborto); tabelas ausentes viram `schemaMissing` explícito (o usuário roda o SQL manualmente).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
