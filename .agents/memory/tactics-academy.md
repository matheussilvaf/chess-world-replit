---
name: Tactics Academy (bots/puzzles/lições)
description: Lições não óbvias da fase 1 da academia — Stockfish no browser, TMJ com tilesets externos, sala Colyseus solo, detecção de tabela ausente no PostgREST.
---

# Tactics Academy — lições da fase 1 (set/2026)

## Regras fixas da spec (confirmadas pelo usuário)
- Entrega em fases: 1) mapa + Sala dos Bots, 2) puzzles (`public.lichess_puzzles`, ~120k linhas com `random_key`), 3) lições. Primeiro uma bancada isolada (`/dev/bots`), depois a integração no Phaser.
- Bots: nome de pessoa, nível SÓ visual (barras), força SÓ via `UCI_LimitStrength`+`UCI_Elo`, movetime 800 para todos, Iniciante sorteia entre top-3 (MultiPV 3), sem oferta de empate, sem Glicko/Gambitos, PGN salvo em `bot_games`.
- Engine carregado ao entrar no mapa da academia, `terminate` ao sair.

## Stockfish no browser (pacote npm `stockfish@19`)
- Build usado: `stockfish-19-lite-single` (js+wasm, single-thread → não exige COOP/COEP). Copiado para `public/engine/` (gitignored) por script encadeado no `dev`/`build`.
- O worker lê a URL do WASM do **hash da URL do script** (`worker.js#<wasm-url>`); o nome interno do Emscripten é `stockfish.wasm`, então sem o hash ele 404a.
- Uma busca cancelada (`stop`) continua "pendente" até o `bestmove` chegar: nova busca deve ESPERAR o dreno em vez de falhar — o driver do jogo cancela/repede rápido quando a posição muda.
- **Why:** `vitest` não roda o worker; só a bancada/teste e2e provam a troca de lances. Testado e2e em 28/set/2026: respostas ~800 ms, MultiPV 3 no nível 1, 1 candidato nos demais.

## TMJ vindo do Tiled do usuário
- Vem com **tilesets externos (`.tsx`)** que o Phaser não carrega: embutir em runtime a partir de um registro (`externalTilesets.ts`) antes do parse.
- Props `tableId` **duplicadas por copiar/colar**: a fonte de verdade é o NOME DA PASTA (`Bot_1`, `challenge_2`, `puzzle_day`, `lesson_3`) → reescrever o `tableId` dos objetos por pasta.
- Layers com o mesmo nome em várias pastas: os helpers `findObjectLayer*` agora concatenam todas as ocorrências (main_world e recepção não têm nomes repetidos — sem regressão).
- `spawnId` do pin também veio copiado; buscar por `spawnId` e, no fallback, pelo `name` do objeto.

## Sala Colyseus com um único humano
- A janela de reconexão do jogo usa timers próprios (não `allowReconnection`), então dependia do adversário manter a sala viva. Com um só cliente, o `autoDispose` padrão fecha a sala na queda e perde partida + W.O. + persistência → desligar `autoDispose` enquanto houver grace timer pendente e religar (o setter agenda `_disposeIfEmpty`) quando zerar.

## Supabase/PostgREST
- `select(..., { head: true, count })` NÃO revela tabela ausente de forma confiável; testar existência com uma query real e tratar `42P01`/`PGRST205` como `schemaMissing` explícito (o usuário roda o SQL manualmente).

# Fase 2 — Sala de Puzzles (set/2026)
- Tabelas da fase 2 só existem depois que o usuário roda `server/supabase/tactics_academy_phase2.sql`; até lá o e2e `artifacts/api-server/scripts/e2e-puzzles.mjs` pula o diário (schemaMissing) mas a batalha roda inteira (recompensa/histórico viram `console.warn`, nunca travam o `resetBoard`).
- **Regra:** no diário, a transição condicional da tentativa (`status='in_progress'` → `solved`, RETURNING lives) vem ANTES do `awardGambitsAtomic`; o prêmio usa as vidas do banco. **Why:** duas sessões do mesmo usuário podiam pagar prêmio numa tentativa já reprovada — a idempotência por matchId evita duplo pagamento, não pagamento indevido.
- **Regra:** nas batalhas, aplicar `engine.tick(now)` (prazos de melhor-de-N/pressão/tempo) antes de aceitar um lance e passar o `index` da sessão ao `playerMove`; o engine descarta lance cujo índice mudou. Após qualquer `await` (carregar puzzle) revalidar fase/índice antes de abrir sessão. **Why:** lance atrasado pontuava no puzzle seguinte.
- Pin do admin não altera sorteio com tentativas registradas (400 explicando); cache do sorteio diário tem TTL 60 s por processo.
- Playwright não carrega o mundo Phaser (sem WebGL): validar UI pelas bancadas `/dev/puzzles` e `/dev/batalhas` (simulação local, sem servidor). Ao escrever plano de teste com lances, conferir a legalidade antes (um "erro" reportado era lance ilegal do plano, não bug).
