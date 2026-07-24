// E2E test: full tournament lifecycle against the LOCAL api-server (ws://localhost:8080)
// Two real Supabase accounts play two consecutive tournaments:
//   Tournament A ends by CHECKMATE (fool's mate), Tournament B ends by RESIGNATION.
// Also verifies: registrations, pairings, auto-seat handshake, teleport-to-reception
// at completion, standings persistence, and previous-results-during-registration.
//
// Run: node artifacts/api-server/scripts/e2e-tournament.mjs
import { createRequire } from 'module';
const req = createRequire('/home/runner/workspace/artifacts/chessworld/package.json');
const { Client } = req('colyseus.js');
const { createClient } = req('@supabase/supabase-js');

const WS = process.env.E2E_WS || 'ws://localhost:8080';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
let failures = 0;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const ok = (cond, msg) => { if (cond) { log('  ✅', msg); } else { failures++; log('  ❌ FAIL:', msg); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Watchdog: never exceed the shell timeout silently
setTimeout(() => { log('⏰ WATCHDOG: aborting'); console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} (watchdog, failures=${failures})`); process.exit(2); }, 265000);

async function ensureUser(email, password, username) {
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } });
  if (error && !`${error.message}`.match(/already/i)) log('  createUser warn:', error.message);
  const anon = createClient(SUPABASE_URL, ANON_KEY);
  const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn ${email}: ${sErr.message}`);
  const userId = signed.user.id;
  // Make sure a profile row exists (registration/stats may reference it)
  await admin.from('profiles').upsert({ id: userId, user_id: userId, username }, { onConflict: 'id' }).then(({ error: pe }) => {
    if (pe) log('  profiles upsert warn:', pe.message);
  });
  return { userId, token: signed.session.access_token, username };
}

async function currentInstance(statusFilter) {
  let q = admin.from('tournament_instances').select('*').order('created_at', { ascending: false }).limit(1);
  if (statusFilter) q = q.eq('status', statusFilter);
  const { data } = await q;
  return (data && data[0]) || null;
}

async function pollFor(desc, fn, timeoutMs = 90000, everyMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(everyMs);
  }
  throw new Error(`timeout waiting for: ${desc}`);
}

function watchMessages(room, tag) {
  const seen = [];
  for (const type of ['match_started', 'match_finished', 'tournament_seated', 'tournament_teleport', 'error', 'registerError']) {
    room.onMessage(type, (data) => { seen.push({ type, data }); log(`  [${tag}] msg ${type}:`, JSON.stringify(data).slice(0, 140)); });
  }
  room.onMessage('*', () => {});
  return seen;
}

const waitMsg = (seen, type, pred = () => true, timeoutMs = 60000) =>
  pollFor(`msg ${type}`, async () => seen.find(m => m.type === type && pred(m.data)), timeoutMs, 300);

async function fastForwardRegistration(seconds) {
  const inst = await pollFor('registration_open instance', () => currentInstance('registration_open'), 30000);
  const startsAt = new Date(Date.now() + seconds * 1000).toISOString();
  await admin.from('tournament_instances').update({ starts_at: startsAt }).eq('id', inst.id);
  log(`  instance ${inst.id.slice(0, 8)} fast-forwarded: starts in ${seconds}s`);
  return inst;
}

async function runTournament(label, A, B, endBy) {
  log(`\n===== TOURNAMENT ${label} (ends by ${endBy}) =====`);
  const inst = await fastForwardRegistration(25);

  // --- register both via tournament room ---
  const cliA = new Client(WS); const cliB = new Client(WS);
  const trA = await cliA.joinOrCreate('tournament', { accessToken: A.token });
  const trB = await cliB.joinOrCreate('tournament', { accessToken: B.token });
  const seenTrA = watchMessages(trA, 'trA');
  await sleep(800);
  trA.send('register', { username: A.username, rating: 1200 });
  trB.send('register', { username: B.username, rating: 1200 });

  const regs = await pollFor('2 registrations', async () => {
    const { data } = await admin.from('tournament_registrations').select('player_id').eq('tournament_id', inst.id);
    return data && data.length === 2 ? data : null;
  }, 30000);
  ok(regs.length === 2, `both players registered (${regs.length})`);

  // --- wait for round_active + pairing ---
  // Poll THIS instance by id ("newest created row" breaks when a foreign
  // coordinator inserts a duplicate instance out of order).
  await pollFor('round_active', async () => {
    const { data } = await admin.from('tournament_instances').select('id,status').eq('id', inst.id).single();
    return data && data.status === 'round_active' ? data : null;
  }, 90000);
  log('  status: round_active');

  const pairing = await pollFor('round-1 pairing', async () => {
    const { data } = await admin.from('tournament_pairings').select('*').eq('tournament_id', inst.id).eq('round_number', 1).eq('is_bye', false);
    return data && data[0] && data[0].runtime_table_id ? data[0] : null;
  }, 30000);
  const whiteAcc = pairing.white_player_id === A.userId ? A : B;
  const blackAcc = pairing.white_player_id === A.userId ? B : A;
  ok(!!pairing.runtime_table_id, `pairing has runtime table: ${pairing.runtime_table_id}`);
  log(`  white=${whiteAcc.username} black=${blackAcc.username}`);

  // --- join arena + seat ---
  const arenaW = await new Client(WS).joinOrCreate('arena', { playerId: whiteAcc.userId, username: whiteAcc.username, rating: 1200, region: 'south_america', x: 719, y: 721 });
  const arenaB = await new Client(WS).joinOrCreate('arena', { playerId: blackAcc.userId, username: blackAcc.username, rating: 1200, region: 'south_america', x: 719, y: 721 });
  const seenW = watchMessages(arenaW, 'white');
  const seenB = watchMessages(arenaB, 'black');

  const seatPayload = (color, opponentId) => ({
    boardId: pairing.runtime_table_id, baseTimeSeconds: 300, incrementSeconds: 0,
    timeCategory: 'blitz', timeLabel: '5+0', opponentId, color,
  });
  arenaW.send('tournament_seat', seatPayload('w', blackAcc.userId));
  await sleep(600);
  arenaB.send('tournament_seat', seatPayload('b', whiteAcc.userId));

  const msW = await waitMsg(seenW, 'match_started');
  const msB = await waitMsg(seenB, 'match_started');
  const matchId = msW.data.matchId;
  ok(!!matchId && msB.data.matchId === matchId, `match started for both (${matchId})`);
  ok(msW.data.color === 'w' && msB.data.color === 'b', `colors assigned per pairing (W=${msW.data.color}, B=${msB.data.color})`);

  // --- walk both players INTO the modules (y<0) so the teleport is exercised ---
  for (const r of [arenaW, arenaB]) r.send('move_to', { x: 720, y: -150, targetX: 720, targetY: -150, direction: 'up', isMoving: false });
  await sleep(400);

  // --- finish the match ---
  const mv = (room, from, to) => { room.send('chess_move', { matchId, from, to }); return sleep(500); };
  if (endBy === 'checkmate') {
    await mv(arenaW, 'f2', 'f3');
    await mv(arenaB, 'e7', 'e5');
    await mv(arenaW, 'g2', 'g4');
    await mv(arenaB, 'd8', 'h4'); // Qh4# — black mates
  } else {
    await mv(arenaW, 'e2', 'e4');
    await mv(arenaB, 'e7', 'e5');
    arenaW.send('chess_resign', { matchId }); // white resigns — black wins
  }

  const mfW = await waitMsg(seenW, 'match_finished', d => d.matchId === matchId);
  const expectedReason = endBy === 'checkmate' ? 'checkmate' : 'resign';
  ok(mfW.data.result === expectedReason, `match_finished result=${mfW.data.result} (expected ${expectedReason})`);
  ok(mfW.data.winnerId === blackAcc.userId, `winner is black (${blackAcc.username})`);

  // --- teleport on completion ---
  const tpW = await waitMsg(seenW, 'tournament_teleport', () => true, 60000);
  const tpB = await waitMsg(seenB, 'tournament_teleport', () => true, 60000);
  ok(tpW.data.y >= 600 && tpW.data.y <= 720 && tpW.data.x >= 580 && tpW.data.x <= 860, `white teleported near reception center (${tpW.data.x},${tpW.data.y})`);
  ok(tpB.data.y >= 600 && tpB.data.y <= 720, `black teleported near reception center (${tpB.data.x},${tpB.data.y})`);

  // --- completion + DB assertions ---
  await pollFor('completed', async () => {
    const { data } = await admin.from('tournament_instances').select('status').eq('id', inst.id).maybeSingle();
    return data && data.status === 'completed' ? data : null;
  }, 60000);
  log('  status: completed');

  const expectedDbReason = endBy === 'checkmate' ? 'checkmate' : 'resignation'; // DB CHECK vocabulary
  const { data: pairDone } = await admin.from('tournament_pairings').select('result,result_reason').eq('id', pairing.id).maybeSingle();
  ok(pairDone.result === '0-1', `pairing result recorded: ${pairDone.result}`);
  ok(pairDone.result_reason === expectedDbReason, `pairing reason: ${pairDone.result_reason}`);

  const { data: standings } = await admin.from('tournament_standings').select('*').eq('tournament_id', inst.id).order('position');
  ok(standings && standings.length === 2, `standings saved (${standings?.length} rows)`);
  if (standings?.length === 2) {
    ok(standings[0].player_id === blackAcc.userId && standings[0].is_champion, `champion = ${standings[0].username}`);
  }

  const matchRow = await pollFor('match row com score', async () => {
    const { data } = await admin.from('matches').select('tournament_score,result').eq('colyseus_match_id', matchId).maybeSingle();
    return data && data.tournament_score ? data : null;
  }, 15000, 1000).catch(() => null);
  ok(!!matchRow && matchRow.tournament_score === '0-1', `match persisted with score ${matchRow?.tournament_score}`);

  // --- previous-results-during-registration (tournament room state) ---
  await pollFor('next registration_open', () => currentInstance('registration_open'), 30000);
  await sleep(4000); // let TournamentRoom sync (3s interval)
  const st = trA.state;
  ok(st.status === 'registration_open', `tournament room back to registration_open (${st.status})`);
  ok(st.standings.length === 2 && st.lastStatus === 'completed', `previous results visible during registration (standings=${st.standings.length}, lastStatus=${st.lastStatus})`);

  for (const r of [arenaW, arenaB, trA, trB]) { try { r.leave(); } catch { } }
  await sleep(500);
  void seenTrA;
  return inst.id;
}

(async () => {
  log('creating/logging in test accounts...');
  const A = await ensureUser('e2e-bot-a@chessworld.test', 'E2eBotPass!123', 'E2E_Bot_A');
  const B = await ensureUser('e2e-bot-b@chessworld.test', 'E2eBotPass!123', 'E2E_Bot_B');
  log(`accounts ready: A=${A.userId.slice(0, 8)} B=${B.userId.slice(0, 8)}`);

  await runTournament('A', A, B, 'checkmate');
  await runTournament('B', A, B, 'resign');

  console.log(`\nRESULT: ${failures === 0 ? 'PASS ✅' : `FAIL ❌ (${failures} failures)`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { log('FATAL:', e.message); console.log('RESULT: FAIL ❌ (fatal)'); process.exit(1); });
