---
name: ChessWorld MMO port
description: Durable decisions and quirks from porting the Bolt.new ChessWorld MMO (Phaser + Colyseus + Supabase + LiveKit) into the Replit pnpm workspace.
---

# ChessWorld MMO port — decisions & quirks

## Colyseus version mismatch (0.15 code on 0.17 types)
Server code was written for Colyseus 0.15 but the workspace resolves 0.17 typings.
**Why:** downgrading broke other deps; runtime behavior is compatible, only types clash.
**How to apply:** keep the `@ts-ignore` pattern on `this.state.*.forEach(...)` and `setState`; `onLeave` uses the 0.17 signature `(client, code?: number)` — do not "fix" it back to `consented: boolean`.

## Client colyseus.js MUST stay pinned to ^0.15 (protocol match with user's cloud server)
The user's Colyseus Cloud server (br-sao, south_america) runs the ORIGINAL Bolt server code = Colyseus 0.15 / schema 2.x wire protocol. Bolt shipped the frontend with colyseus.js 0.16 (schema 3.x) — incompatible wire protocol → `"refId" not found` / `definition mismatch` decode errors, state never syncs ("Colyseus state invalid" overlay). Client is now pinned to colyseus.js ^0.15.28; client code was written for the 0.15 inline-callback API (`state.players.onAdd`) so no code changes were needed.
**Why:** schema 2.x (0.15) and 3.x (0.16) are wire-incompatible; the cloud server is outside this repo, so the client must match IT, not our api-server (0.17).
**How to apply:** never bump colyseus.js/@colyseus/schema in chessworld "to latest". If the user redeploys their cloud server from this repo's api-server (0.17/schema 4.x), the client must be upgraded in lockstep (colyseus.js 0.16+ uses `getStateCallbacks` API — code changes required). Diagnosis technique that settled it: temp-dir node scripts joining the live cloud server with candidate colyseus.js versions and checking whether `state.players` decodes (0.15 → clean, 0.16 → refId errors). Matchmake HTTP joins need no auth token.

## Multiplayer requires an external Colyseus server in dev
Colyseus websockets connect at the server root, but the Replit proxy routes `/` to the frontend artifact, so an in-repl Colyseus server is unreachable by WS in dev.
**Why:** path-based artifact routing owns `/`; WS upgrade at root can't be forwarded to the API artifact.
**How to apply:** `VITE_COLYSEUS_URL` (Replit Secret) must point at an external server (user runs Colyseus Cloud, br-sao region). Client config auto-normalizes `https://` → `wss://`.

## Supabase kept as the database/auth layer
**Why:** extensive existing migrations + RLS policies made replacement out of scope.
**How to apply:** do not migrate to a Replit database unless the user asks; auth flows and profiles live in Supabase.

## Dev-mode "white page / loads forever" — root cause was an optimizeDeps.exclude
The dominant cause: the Bolt template shipped `optimizeDeps: { exclude: ['lucide-react'] }`, forcing a cold dev load to fetch the icon barrel + ~1,640 individual icon modules. Near-instant inside the container (masked the bug for agent tests, ~8s) but minutes over a real connection → users saw "loading forever". Removing the exclude collapsed the load to ~26 requests, login in ~1.2s.
**Why:** Bolt/StackBlitz WebContainers exclude lucide-react because pre-bundling is slow *in-browser*; on a real server the exclude is purely harmful. Vite dev serves excluded deps unbundled, module by module.
**How to apply:** never carry `optimizeDeps.exclude` over from Bolt/StackBlitz imports; keep 'lucide-react' in `optimizeDeps.include`. Secondary mitigations kept: static boot splash in index.html (hidden via MutationObserver when React mounts) and `React.lazy(GameScene)` so Phaser (5.5MB)/Colyseus/LiveKit only load after sign-in + region select. Don't add eager imports of game/network modules to anything reachable from main.tsx. Watch for symptom: agent-side tests fast but user reports endless loading → count dev-mode network requests.

## Debugging lesson: localhost screenshots mask proxy-only symptoms
Agent appPreview screenshots hit localhost inside the container (near-zero latency) and rendered fine while the user saw white through the proxy domain.
**Why:** the user always loads via the proxied `$REPLIT_DEV_DOMAIN` iframe with real network latency.
**How to apply:** to reproduce what the user sees, screenshot the external URL (`https://$REPLIT_DEV_DOMAIN/...`) or use the testing subagent — it surfaces load-timing issues invisible from localhost.

## Phaser 4 typing quirks
Phaser 4 union types (`TilemapGPULayer`) break some 3.x-era code paths; `@ts-ignore` used at the few affected lines in WorldScene / ArenaModuleManager.
`setTintFill(color)` is a deprecated NO-OP in Phaser 4 (TS2554): use `setTint(color)` + `setTintMode(Phaser.TintModes.FILL)`, and restore `MULTIPLY` when clearing.

## Tournament results: DB CHECK vocabulary ≠ engine vocabulary; PostgREST errors are silent
`tournament_pairings.result_reason` has a CHECK allowing ONLY `checkmate, resignation, timeout, disconnect, forfeit, draw, stalemate`. The game engine produces `resign, abandon, repetition, insufficient, ...` — writing those violated the constraint and supabase-js returned the error in `{ error }` which nobody checked, so pairings stayed unresolved and tournaments hung in round_active forever (checkmate worked, resign never did — deterministic).
**Why:** the constraint was added in a migration applied directly on Supabase (not in the repo backup), so code and schema drifted; PostgREST never throws, it only fills `{ error }`.
**How to apply:** map reasons at the single write boundary (`toDbReason` in the coordinator) and ALWAYS capture `{ error }` on Supabase writes in lifecycle paths — log it, and throw before state transitions so the 5s tick retries (round/pairing creation is idempotent). To discover a CHECK's allowed values without DDL access: probe-insert candidates on a completed tournament's round and delete them.

## Exactly ONE coordinator may point at the Supabase DB (split-brain deadlock)
Two api-servers (old Bolt deploy on Colyseus Cloud + local) sharing the DB race each other: the foreign one has no TournamentRoom/WorldRoom instances, `isPlayerPresent` defaults to true, so it clears `presence_deadline` on pairings it can't see and reports nothing — tournaments deadlock; duplicate `swiss_tournaments` rows ms apart are the fingerprint.
**Why:** the coordinator assumes it owns the DB; presence checks default open.
**How to apply:** before debugging "stuck tournament", verify only one server is running (user's Colyseus Cloud dashboard). If redeploying to the cloud, ship this repo's api-server build and use the service-role key (the old deploy had the anon key), then stop the Replit one or vice versa. More fingerprints (confirmed July 2026 — foreign server still alive): `tournament_instances` rows created ms apart, or rows with NO matching "[Coordinator] Next tournament scheduled" line in the local log; rows with `config_snapshot=null` while randomize is ON are foreign (only current code snapshots at creation). Duplicate pending cycles also silently break registration (room and tests disagree on which instance is "current"). `ensureNextCycleExists` is serialized in-process with a duplicate-tolerant pending check — that guards ONE process; cross-process duplicates persist until the foreign server is shut down.
Current steady state (since July 2026): the cloud server is THE one server; `VITE_COLYSEUS_LOCAL` was removed from the dev env, so the dev preview (world + /admin coordinator REST) talks to the cloud too. Do not start the local `artifacts/api-server` workflow while the cloud runs — a stopped api-server is intentional, and a 502 on same-origin `/api/...` in dev means someone re-added the local flag without starting the server.
Worst confirmed damage: **inverted champion**. Each coordinator creates its own swiss engine and each rolls `initialColor` independently ('random' resolves per engine); whoever writes `swiss_tournament_id` last attaches THEIR engine, so a color-relative result ('0-1') applied to an engine whose colors differ from the published pairing row credits the LOSER. Fingerprint: two `swiss_tournaments` rows with the same `Tournament-<instanceId>` name, different `config.initialColor`. Hardened in coordinator: (1) engine attach is a CAS (`.is('swiss_tournament_id', null)`; claim loser deletes its engine and backs off), (2) before `setResult`, engine white (TPN→name) is compared against the pairing row's `white_username` — the PUBLISHED pairing is the source of truth for colors — and the result is flipped if the engine is inverted. Registration split fingerprint: two instances created in the same second, players' registrations land on one while tests/UI track the other → "timeout waiting for registrations" with bots visibly joined.
Related LOCAL gap (not intruder-only): presence sweep used to NULL the deadline when both players were present in the room — players who register, stay present, but never seat left the round stuck in round_active forever (queue frozen: only one tournament runs at a time, so no new cycles spawn). Fixed: deadline re-arms +120s until the board actually starts; only the actively-playing branch clears it. Zombie recovery recipe: set the open pairing to `-/-`/`forfeit` in DB — the tick completes the round and respawns the cycle within seconds.

## Split-brain part 2: stale cloud deploy, engine ownership, decoy trap (July 2026)
The Colyseus Cloud server was found running MONTHS-stale code: GitHub pushes "succeed" but the cloud never applies them (auto-deploy broken). Fingerprint that settled it: DB writes only explainable by code paths that NO LONGER EXIST locally (e.g. `presence_deadline` nulled while `started_at`/`result` stayed null — a branch long removed). When "impossible" rows appear, suspect a stale foreign deploy before doubting local code. User must redeploy from the Colyseus Cloud dashboard; until then the decoy (below) protects live data.
**Coordinator hardening (all in coordinator.ts):**
- **Engine ownership gate = real LEASE**: identity lives in `config_snapshot.engine_owner` (a per-process UUID), liveness in `transition_lock`. Split needed because atomicTransition refreshes transition_lock on every status change — CAS-ing the heartbeat on the lock VALUE would self-clobber. Heartbeat = conditional update (`config_snapshot->>engine_owner = me`); 0 rows → demote: drop from `ownedEngines` AND evict the in-memory engine (service.evictTournament) so a resumed stale owner can't resurrect as second owner. Takeover (heartbeat stale >60s, CAS) also evicts before adding — never trust a cached engine copy across ownership changes. Two owners = two engine copies + whole-JSON persist = last-write-wins that silently ate results/bye points.
- **Owner-path service entry points MUST load-on-miss** (getTournament fallback, not bare map.get): a takeover owner has an empty cache; 'Tournament not found' from a bare lookup matches the TERMINAL regex and finalizes the tournament early. Applied to generateNextRound/setResult/finalizeRound.
- **Claim follows players**: a coordinator hosting 0 registrants defers the engine claim ~15s. Presence/W.O./force-start are local knowledge of the hosting server; a player-less owner deadlocks W.O. (owner sees nobody → skips; host is gated out).
- **Presence = WORLD rooms only**, lobby does NOT count (a lobby-parked player can't be force-started). No world rooms → presence UNKNOWN (null) → sweep skips that pairing, never re-arms or decides.
- **Never null `presence_deadline` while unresolved** — the sweep filters `presence_deadline is null`, so null = invisible forever = stuck round. Playing/both-present branches RE-ARM +120s; match start (markPairingStarted) re-arms +180s instead of nulling, so a board that dies without reporting a result expires back into the sweep and W.O./presence rules recover it.
- **Round generation**: idempotency check ("round already exists unfinalized") must run BEFORE the 'not yet finalized' error; only TERMINAL errors (allowlist regex) finalize the tournament, transient ones retry next tick; final artifacts (standings/completed_at/teleport) are written only AFTER winning the status CAS.
- **Decoy trap**: inert `round_active` instance, `starts_at=2020-01-01`, `config_snapshot={decoy:true, note:"decoy-trap-for-stale-coordinator"}`. Stale coordinators (no filter) latch onto it as "oldest active" and idle harmlessly; current code filters `config_snapshot->decoy is null` in processTransitions AND getCurrentInstance (rooms/API resolve "current" through it — miss one and registration breaks). Row may stay after cloud redeploy (new code ignores it) or be deleted.
- **Postgres DESC sorts NULLS FIRST**: `getLatestCompleted/CancelledInstance` must exclude `completed_at is null` (manually-completed orphans otherwise shadow real results forever — burned as "standings=0" in the last-tournament panel).
- e2e: forfeit results use chess notation `+/-`/`-/+` (not `1-0`/`0-1`); engine standings count them as wins. 3p suite: `scripts/e2e-tournament-3p.mjs` (forcestart + fallback scenarios).

## game_settings is a hard singleton; new global settings need user-run SQL
`game_settings` has a CHECK constraint `singleton` (only id=1 allowed) — extra rows are impossible, and PostgREST has no DDL, so new global settings require the USER to run `ALTER TABLE ... ADD COLUMN` in the Supabase SQL editor.
**Why:** tried inserting rows id=2/3 to piggyback board-zoom config; blocked by the CHECK (23514).
**How to apply:** ship client code that works BEFORE the migration: `select('*')` (never enumerate maybe-missing columns — that fails the whole query), map with null-tolerant conditional spreads, keep code-side defaults, and omit missing columns from update payloads (AdminPage detects absence and shows the SQL + Re-check button). Board zoom columns: `board_zoom_desktop` (default 3) / `board_zoom_mobile` (default 2.5), consumed via WorldScene.setBoardZoom picked by viewport width < 768.

## Colyseus message-vs-state race: room messages beat schema patches
`match_started` (and likely other room messages) regularly arrives BEFORE the state patch that adds the match to `state.matches`, so lookups in state at message time come up empty (burned as timers showing the 'White'/'Black' fallbacks instead of nicks).
**Why:** messages and schema sync are independent channels; ordering is not guaranteed.
**How to apply:** any store hydrated from a room message must ALSO backfill from the schema later: call the sync handler immediately inside `matches.onAdd` (registering onChange alone waits for the NEXT field change, i.e. the first move) and make the sync handler update identity fields with truthy guards (Colyseus schema zero-values '' / 0 mean "unset" — never overwrite good data with them).

## Supabase/PostgREST + esbuild quirks (this DB specifically)
- `matches.colyseus_match_id` has NO unique constraint → `upsert(onConflict)` errors; use check-then-insert. Optional hardening: user can run `CREATE UNIQUE INDEX` in the SQL editor.
- uuid columns reject `.like()` filters → use `.eq()` (a `.like` once produced a false "row deleted" diagnosis).
- SELECTing a nonexistent column ALSO fails silently (`data=null`, error only in `{error}`) — burned twice: once produced a false "standings deleted" diagnosis. `tournament_standings` has `updated_at`, NOT `created_at`. Check `{error}` on READS too, not just writes.
- esbuild bundles to `dist/` so `__dirname`-relative binary paths break; `getBinaryPath()` tries candidates + `BBP_PAIRINGS_PATH` env. bbpPairings binary lives in `src/bin/`, needs chmod +x.
- `tournament_config.interval_seconds` is set to 120 for TESTING; production value ~10800 (3h). Restore before going live.
- Protocol-level E2E exists: `artifacts/api-server/scripts/e2e-tournament.mjs` (2 chained tournaments, checkmate + resign, teleport + standings asserts; test accounts e2e-bot-a/b@chessworld.test).

## Tournament tables are client-readable via RLS (authenticated only)
`tournament_pairings` and `tournament_instances` return rows for the `authenticated` role but 0 rows for bare `anon` — both HTTP 200, so an empty result is NOT proof of missing data. In-world users are always authenticated, so client features can read these tables directly (standings-modal player history does).
**Why:** anon-key curl probes falsely suggested "no access"; only a real user JWT (e2e bot login from the e2e script) revealed the rows.
**How to apply:** probe RLS with a bot-account JWT, never just the anon key. Historical per-round data must come from the DB anyway — the room clears `state.pairings` when the next registration opens (only standings survive), and during `registration_open` the displayed standings belong to the latest COMPLETED instance (`completed_at` not null), not `state.tournamentId`.

## Coordinator REST from the client: /api double-prefix hid the admin section
`getColyseusHttpUrl()` ends with `/api` in local-proxy mode but typically NOT in cloud mode (`VITE_COLYSEUS_URL`), so appending `/api/...` produced `/api/api/...` → 404; TournamentConfigSection then hit `if (!config) return null` and vanished — user reported the section "didn't exist".
**Why:** two URL shapes for the same server + silent null-render on fetch failure.
**How to apply:** normalize once (append `/api` only if the base doesn't already end with it) before `${apiBase}/coordinator/...`; admin sections must render a visible error + retry instead of returning null. Related decision: the tournament `randomize` flag persists INSIDE the `swiss_config` JSONB (no DDL access for a new column); loadConfig strips it before the swissConfig reaches the pairing engine, and each cycle's rolled settings freeze in `config_snapshot` at creation (instance snapshot beats live config everywhere downstream).

## Local api-server workflow runs a ONE-SHOT build (stale-dist trap)
The api-server dev script is `build && start` (esbuild → dist), NOT watch mode. Server source edits change nothing until the workflow restarts; meanwhile clients hit "missing" handlers that clearly exist in source.
**Why:** burned a debugging session on "draw decline exits the match" that was just a stale running dist — the old build lacked the draw handlers entirely. Giveaway in api-server logs: `onMessage for "chess_draw_decline" not registered`.
**How to apply:** after ANY edit under artifacts/api-server, restart the `artifacts/api-server: API Server` workflow (build runs on start). Treat `onMessage ... not registered` warnings as "stale running build", not missing code. Only the Vite client hot-reloads.

## Client: seat exit tween uses a {t} proxy target — killTweensOf(player) does NOT stop it
`unseatPlayer()` animates a plain `{t:0..1}` object whose onUpdate drags the physics body toward the table exit anchor, so a server teleport got overridden mid-flight.
**Why:** Phaser kill-by-target only matches the tween's target object, not what onUpdate mutates.
**How to apply:** any forced reposition must stop `this.seatTween` explicitly, clear `currentSeatInfo`/path targets, and restore physics (`teleportLocalPlayer` does this now — reuse it; don't call `unseatPlayer()` before it).

## Results are server-authoritative only
The Bolt-era `reportResult` client message (any authed user could falsify results) was removed from TournamentRoom and the client hook.
**Why:** WorldRoom already reports every end condition (checkmate/resign/timeout/disconnect) and the coordinator sweeps forfeits; a client path is purely a cheat vector.
**How to apply:** never reintroduce client-sent results; new end conditions belong in WorldRoom/coordinator.

## E2E testing subagent cannot load the game world (no WebGL)
The tester's headless browser has no WebGL context; Phaser 4 is WebGL-only (no Canvas fallback), so login/region-select works but "Enter World" crashes with "Cannot create WebGL context, aborting" — every in-world HUD feature (chat, voice, balloons, drag) is unreachable for it.
**Why:** burned a tester run on a chat-panel plan that died at world load; this is an environment limit, not an app bug.
**How to apply:** use the tester only for non-Phaser routes (/admin, login, region select); verify in-world UI via tsc + targeted logic review + real-device testing by the user. Related pattern: distinguishing live chat messages from history loads must use an explicit store signal (`liveChatMessage`, set only in addChatMessage, cleared in enterRegion) — length-diff heuristics ghost-fire on region re-entry because loadChat bulk-replaces the array.

## Colyseus folder standard (user-mandated, Jul 24 2026)
- `/server` is THE official Colyseus folder: standalone npm package, Colyseus Cloud app root (`/server/`), auto-deploys when commits land on GitHub (see replit.md push rule).
- `artifacts/api-server/src/src` is a byte-for-byte mirror of `server/src`, used only to run the server locally in the monorepo.
- RULE: every Colyseus server change must land in BOTH trees before commit — `diff -rq server/src artifacts/api-server/src/src` must be empty. Entry/outer layers (server/index.ts, api-server app.ts/routes) are layout-specific and stay separate.
- Jul 24 2026: synced ~1264 lines api-server→server (coordinator hardening, WorldRoom/TournamentRoom, draw handling, app.config /api rewrite — harmless on cloud); `npx tsc --noEmit` passes standalone in server/.

### Lições sessão 2026-07 (W.O./espectador/perf)
- Forfeit/W.O.: qualquer `await` entre pausar relógio e armar timer cria janela de reconexão — re-checar `hasActivePlayerById` depois de todo await E dentro do callback do timer; escrita de forfeit no banco exige CAS `.is('result',null).is('started_at',null)` + re-check `anyWorldRoomPlaying` imediatamente antes do write (markPairingStarted grava started_at no início da partida).
- worldAssets.ts agora lista SÓ tilesets usados (17 removidos ~4MB, verificados por GID-walk em todos os TMJs vivos): mapa novo/editado que referencie tileset removido perde tiles silenciosamente — rodar o GID-walk de novo e re-adicionar a entrada.
- Interações de módulos de arena NÃO vêm do loadFromTMJ (só mapa principal): ingerir via ArenaModuleManager feeds → InteractionSystem.addModuleChessInteractions, APENAS spectator_seat (player_seat/board abririam modal de amistoso em mesa de torneio), com remap localSlotId→runtimeTableId e ids sintéticos ≥1e6 (ids do Tiled colidem entre mapas).
- Jul 27 2026: reboot do workspace AUTO-LIGA o workflow api-server → coordenador intruso local churn-cancelava instâncias 1/min e as entradas no mundo fragmentavam (cada jogador sozinho em sala própria) até parar o workflow. Fingerprints: `cancelled_insufficient_players` a cada ~60s + instâncias duplicadas com ms de diferença + "players: 1" pra todo mundo. Blindagem: startCoordinator() se auto-bloqueia sob REPL_ID (override: FORCE_COORDINATOR=true p/ e2e local). Quando "o jogo deixou de ser multiplayer", checar o workflow local PRIMEIRO; sanidade rápida: `curl <cloud>/colyseus/api` (monitor aberto, sem auth — vale proteger) deve mostrar UMA sala world por região.

## Character system (Jul 2026): server-authoritative combat invariants
- Editor: o efeito "ensure grid" e o rebuild do working-copy rodam no MESMO flush ao trocar de personagem — o ensure PRECISA do guard `working.characterId !== entry.id → return` + update funcional com checagem de referência, senão ele enxerta o asset de um personagem no config do outro (bug do "zoom", já corrompeu dados salvos uma vez; buildWorkingConfig poda asset keys fora do manifest para curar linhas antigas). Não remover esses guards.
- Debug visuals (client) mostram caixas SEMPRE que há config salva; `combatBoxesEnabled` ("Ativas no jogo") gateia só o DANO no servidor (dois lados: atacante não agenda, alvo é pulado). Flag `character_switch_enabled` tem cache de 60s no servidor e toggle no /admin.
- Client must send `set_character` on EVERY join (even for the default character): the server resolves combat hurtboxes from `PlayerState.characterId` and SKIPS targets whose id is empty/unknown — a client that stays silent is unhittable. First announce is always accepted; later switches are gated (prod: `game_settings.character_switch_enabled`).
- Combat approximations are deliberate: server can't know the remote visual frame, so targets use union-of-hurtboxes (walk-if-moving else idle chain); attack timelines run at 12 fps via room clock.
- Movement (`move_to`) is client-driven by original design — server only sanitizes (finite numbers, string caps). Full server-side movement is a known open item, NOT a bug to "fix" casually; it would change game feel and the live cloud protocol.
- Any async gap in a message handler (e.g. cooldown set after `await getConfig`) is a burst-bypass: reserve cooldowns/locks synchronously before the first await, re-check seated/left state inside every scheduled callback.
- Characters auto-discovered from `public/assets/characters/character NN - 4/8 directions/<movement>/*.png` by a Vite plugin serving `assets/characters/manifest.json`; combat config JSON (schemaVersion 1) lives in Supabase `character_configs.config` jsonb (user must run the ALTER TABLE — editor shows the SQL banner until then) with legacy origin/body columns kept in sync for the old cloud server.

## Combat stats (HP/dano) — design decisions
- HP/damage live in the character config jsonb: root `maxHp` + per-asset `damageEnabled`/`damage`, all OPTIONAL with lenient validation — old saved configs stay valid, and the previously deployed server ignores the new fields (validators skip unknown keys). Read through the clamped helpers (`characterMaxHp`/`assetDamage`), never raw fields.
- **Why:** editor saves happen against the LIVE cloud server; a strict validator would brick combat for players until the next deploy.
- `set_character` has two awaits (switch flag + config fetch) → guarded by a per-session seq map (last-request-wins). Any new await added to that handler must re-check the seq before mutating state, or rapid switches let a stale request win (architect-found race).
- HP bar visibility is TEST-GATED to character01 (`HP_BAR_TEST_CHARACTER` in WorldScene) — deliberate temporary rule; flip it to always-on/config when the system is approved.
- Hurt anim: `hurtUntil` gates ONLY animation (local + remote), never movement; attack anims take priority over hurt. Stationary 'attack' blocks movement, walk/run-attack don't (`attackLocksMovement`).
