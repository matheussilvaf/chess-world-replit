// E2E test: 3-player tournament against the LOCAL api-server (ws://localhost:8080)
// Reproduces the two production bugs fixed in this round:
//
//   Scenario "forcestart":  in round 2 NOBODY sends tournament_seat — the
//     coordinator must force-start the match on the arena room (~12s grace),
//     all 3 rounds are played and the tournament completes with a champion.
//
//   Scenario "fallback":    the round-1 bye player never joins the arena, so
//     round 2 ends in a W.O. (presence deadline, ~120s). bbpPairings then
//     refuses round 3 (FIDE C.04.1.d: everyone is blocked for the bye) and the
//     coordinator must build round 3 via the manual fallback pairing.
//
// Run: node artifacts/api-server/scripts/e2e-tournament-3p.mjs forcestart
//      node artifacts/api-server/scripts/e2e-tournament-3p.mjs fallback
import { createRequire } from 'module';
const req = createRequire('/home/runner/workspace/artifacts/chessworld/package.json');
const { Client } = req('colyseus.js');
const { createClient } = req('@supabase/supabase-js');

const scenario = process.argv[2] || 'forcestart';
const WS = process.env.E2E_WS || 'ws://localhost:8080';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

let failures = 0;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const ok = (cond, msg) => { if (cond) { log('  ✅', msg); } else { failures++; log('  ❌ FAIL:', msg); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const WATCHDOG_MS = scenario === 'fallback' ? 290000 : 235000;
setTimeout(() => { log('⏰ WATCHDOG: aborting'); console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} (watchdog, failures=${failures})`); process.exit(2); }, WATCHDOG_MS);

async function ensureUser(email, password, username) {
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } });
  if (error && !`${error.message}`.match(/already/i)) log('  createUser warn:', error.message);
  const anon = createClient(process.env.SUPABASE_URL, ANON_KEY);
  const { data: signed, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn ${email}: ${sErr.message}`);
  const userId = signed.user.id;
  await admin.from('profiles').upsert({ id: userId, user_id: userId, username }, { onConflict: 'id' }).then(({ error: pe }) => {
    if (pe) log('  profiles upsert warn:', pe.message);
  });
  return { userId, token: signed.session.access_token, username };
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
    room.onMessage(type, (data) => { seen.push({ type, data }); log(`  [${tag}] msg ${type}:`, JSON.stringify(data).slice(0, 120)); });
  }
  room.onMessage('*', () => {});
  return seen;
}
const waitMsg = (seen, type, pred = () => true, timeoutMs = 60000) =>
  pollFor(`msg ${type}`, async () => seen.find(m => m.type === type && pred(m.data)), timeoutMs, 300);

async function fastForwardRegistration(seconds) {
  const inst = await pollFor('registration_open instance', async () => {
    const { data } = await admin.from('tournament_instances').select('*').eq('status', 'registration_open').order('created_at', { ascending: false }).limit(1);
    return (data && data[0]) || null;
  }, 60000);
  await admin.from('tournament_instances').update({ starts_at: new Date(Date.now() + seconds * 1000).toISOString() }).eq('id', inst.id);
  log(`  instance ${inst.id.slice(0, 8)} fast-forwarded: starts in ${seconds}s`);
  return inst;
}

const pairingRow = (instId, round) => pollFor(`round-${round} pairing`, async () => {
  const { data } = await admin.from('tournament_pairings').select('*').eq('tournament_id', instId).eq('round_number', round).eq('is_bye', false);
  return data && data[0] && data[0].runtime_table_id ? data[0] : null;
}, 60000);

const byeRow = (instId, round) => pollFor(`round-${round} bye`, async () => {
  const { data } = await admin.from('tournament_pairings').select('*').eq('tournament_id', instId).eq('round_number', round).eq('is_bye', true);
  return data && data[0] ? data[0] : null;
}, 45000);
const byePlayerOf = (row) => row.bye_player_id || row.white_player_id || row.black_player_id;

let userList = [];
const nameOf = (id) => userList.find(u => u.userId === id)?.username || String(id).slice(0, 8);

async function joinArena(user) {
  const room = await new Client(WS).joinOrCreate('arena', {
    playerId: user.userId, username: user.username, rating: 1200,
    region: 'south_america', x: 719, y: 721,
  });
  return { room, seen: watchMessages(room, user.username), username: user.username };
}

// Plays a pairing to the end: white wins by black's resignation after 1.e4 e5.
// seat=false → nobody seats; we rely on the coordinator force-start.
async function playPairing(pairing, ctx, { seat, known }) {
  const W = ctx[pairing.white_player_id];
  const B = ctx[pairing.black_player_id];
  if (!W || !B) throw new Error(`missing arena ctx for pairing R${pairing.round_number}`);
  if (seat) {
    const payload = (color, opp) => ({
      boardId: pairing.runtime_table_id, baseTimeSeconds: 300, incrementSeconds: 0,
      timeCategory: 'blitz', timeLabel: '5+0', opponentId: opp, color,
    });
    W.room.send('tournament_seat', payload('w', pairing.black_player_id));
    await sleep(600);
    B.room.send('tournament_seat', payload('b', pairing.white_player_id));
  } else {
    log(`  R${pairing.round_number}: NOBODY seats — waiting for server force-start...`);
  }
  const tStart = Date.now();
  const msW = await waitMsg(W.seen, 'match_started', d => !known.has(d.matchId), 75000);
  const matchId = msW.data.matchId;
  await waitMsg(B.seen, 'match_started', d => d.matchId === matchId, 20000);
  known.add(matchId);
  if (!seat) log(`  force-start arrived ${(Date.now() - tStart) / 1000}s after wait began`);
  ok(msW.data.color === 'w', `R${pairing.round_number} match started, colors per pairing (white=${W.username})`);
  W.room.send('chess_move', { matchId, from: 'e2', to: 'e4' }); await sleep(600);
  B.room.send('chess_move', { matchId, from: 'e7', to: 'e5' }); await sleep(600);
  B.room.send('chess_resign', { matchId });
  const mf = await waitMsg(W.seen, 'match_finished', d => d.matchId === matchId, 30000);
  ok(mf.data.winnerId === pairing.white_player_id, `R${pairing.round_number}: ${W.username} wins by resignation`);
  // Mimic the real client teardown: free the seats after the game. Wait a
  // beat first — the server keeps the match in state until the tournament
  // advance completes, and rejects leave_seat during an "active" match.
  await new Promise(r => setTimeout(r, 2000));
  W.room.send('leave_seat', { boardId: pairing.runtime_table_id });
  B.room.send('leave_seat', { boardId: pairing.runtime_table_id });
  return matchId;
}

async function assertCompletion(instId, users) {
  await pollFor('completed', async () => {
    const { data } = await admin.from('tournament_instances').select('status').eq('id', instId).maybeSingle();
    return data && data.status === 'completed' ? data : null;
  }, 90000);
  log('  status: completed');

  const { data: pairs } = await admin.from('tournament_pairings').select('*').eq('tournament_id', instId).order('round_number');
  const rounds = [...new Set(pairs.map(p => p.round_number))].sort();
  ok(rounds.join(',') === '1,2,3', `all 3 rounds generated (${rounds.join(',')})`);

  const byeCount = {};
  for (const p of pairs) if (p.is_bye) byeCount[byePlayerOf(p)] = (byeCount[byePlayerOf(p)] || 0) + 1;
  for (const u of users) ok((byeCount[u.userId] || 0) === 1, `${u.username} got exactly 1 bye`);

  const { data: st } = await admin.from('tournament_standings').select('*').eq('tournament_id', instId).order('position');
  ok(st && st.length === 3, `standings saved (${st?.length} rows)`);
  if (st?.length === 3) {
    const pts = st.map(s => Number(s.points));
    ok(st[0].is_champion && pts[0] === Math.max(...pts), `champion = ${st[0].username} (${pts[0]} pts)`);
    ok(pts.reduce((a, b) => a + b, 0) === 6, `points sum to 6 (${pts.join('+')})`);
  }
  return pairs;
}

async function waitRoundActive(instId) {
  await pollFor('round_active', async () => {
    const { data } = await admin.from('tournament_instances').select('id,status').eq('id', instId).single();
    return data && data.status === 'round_active' ? data : null;
  }, 90000);
  log('  status: round_active');
}

async function registerAll(inst, users) {
  const trs = [];
  for (const u of users) trs.push(await new Client(WS).joinOrCreate('tournament', { accessToken: u.token }));
  await sleep(800);
  trs.forEach((tr, i) => tr.send('register', { username: users[i].username, rating: 1200 }));
  const regs = await pollFor('3 registrations', async () => {
    const { data } = await admin.from('tournament_registrations').select('player_id,username').eq('tournament_id', inst.id);
    return data && data.length === 3 ? data : null;
  }, 30000);
  ok(regs.length === 3, `3 players registered`);
  const expected = new Set(users.map(u => u.username));
  ok(regs.every(r => expected.has(r.username)), `registrations use real profile usernames (${regs.map(r => r.username).join(', ')})`);
  return trs;
}

async function runForceStart(users) {
  log('\n===== SCENARIO forcestart: R2 starts with nobody seating =====');
  const inst = await fastForwardRegistration(25);
  const trs = await registerAll(inst, users);
  await waitRoundActive(inst.id);

  const ctx = {};
  for (const u of users) ctx[u.userId] = await joinArena(u);
  const known = new Set();

  const p1 = await pairingRow(inst.id, 1);
  const b1 = await byeRow(inst.id, 1);
  log(`  R1: ${nameOf(p1.white_player_id)} vs ${nameOf(p1.black_player_id)}, bye=${nameOf(byePlayerOf(b1))}`);
  await playPairing(p1, ctx, { seat: true, known });

  const p2 = await pairingRow(inst.id, 2);
  await playPairing(p2, ctx, { seat: false, known }); // ← the fix under test
  const { data: p2after } = await admin.from('tournament_pairings').select('started_at').eq('id', p2.id).maybeSingle();
  ok(!!p2after?.started_at, 'R2 pairing has started_at (force-start marked it)');

  const p3 = await pairingRow(inst.id, 3);
  await playPairing(p3, ctx, { seat: true, known });

  const pairs = await assertCompletion(inst.id, users);
  ok(pairs.filter(p => !p.is_bye).every(p => p.result_reason !== 'forfeit'), 'no W.O. anywhere (force-start prevented it)');

  for (const u of users) { try { ctx[u.userId].room.leave(); } catch { } }
  for (const tr of trs) { try { tr.leave(); } catch { } }
}

async function runFallback(users) {
  log('\n===== SCENARIO fallback: W.O. in R2, engine refuses R3, manual pairing =====');
  const inst = await fastForwardRegistration(25);
  const trs = await registerAll(inst, users);
  await waitRoundActive(inst.id);

  const p1 = await pairingRow(inst.id, 1);
  const b1 = await byeRow(inst.id, 1);
  const X = users.find(u => u.userId === byePlayerOf(b1)); // R1 bye player — will be ABSENT in R2
  const present = users.filter(u => u.userId !== X.userId);
  log(`  R1 bye = ${X.username} (stays out of the arena on purpose)`);

  const ctx = {};
  for (const u of present) ctx[u.userId] = await joinArena(u);
  const known = new Set();
  await playPairing(p1, ctx, { seat: true, known });

  const p2 = await pairingRow(inst.id, 2);
  ok([p2.white_player_id, p2.black_player_id].includes(X.userId), 'R2 pairs the R1-bye player (who is absent)');
  const oppId = p2.white_player_id === X.userId ? p2.black_player_id : p2.white_player_id;
  log(`  R2: ${X.username} (ABSENT) vs ${nameOf(oppId)} — waiting for presence-deadline W.O. (~2min)...`);

  const wo = await pollFor('R2 W.O. result', async () => {
    const { data } = await admin.from('tournament_pairings').select('result,result_reason').eq('id', p2.id).maybeSingle();
    return data && data.result ? data : null;
  }, 175000, 3000);
  ok(wo.result_reason === 'forfeit', `R2 decided by W.O. (reason=${wo.result_reason})`);
  // Forfeits use chess forfeit notation: '+/-' = white wins by W.O., '-/+' = black wins.
  ok(wo.result === (p2.white_player_id === oppId ? '+/-' : '-/+'), `W.O. winner is the present player (${wo.result})`);

  const p3 = await pairingRow(inst.id, 3); // ← the fix under test: engine refuses, fallback must produce it
  const b3 = await byeRow(inst.id, 3);
  ok(!!p3, 'R3 was generated despite FIDE C.04.1.d refusal (fallback pairing)');
  ok(byePlayerOf(b3) === oppId, `R3 bye went to the forfeit-winner (least-blocked): ${users.find(u => u.userId === oppId)?.username}`);
  const thirdId = users.map(u => u.userId).find(id => id !== X.userId && id !== oppId);
  ok([p3.white_player_id, p3.black_player_id].sort().join() === [X.userId, thirdId].sort().join(), 'R3 pairs the two who have not met');

  ctx[X.userId] = await joinArena(X); // X finally shows up for R3
  await sleep(800);
  await playPairing(p3, ctx, { seat: true, known });

  await assertCompletion(inst.id, users);

  for (const id of Object.keys(ctx)) { try { ctx[id].room.leave(); } catch { } }
  for (const tr of trs) { try { tr.leave(); } catch { } }
}

(async () => {
  log(`scenario: ${scenario}`);
  const A = await ensureUser('e2e-bot-a@chessworld.test', 'E2eBotPass!123', 'E2E_Bot_A');
  const B = await ensureUser('e2e-bot-b@chessworld.test', 'E2eBotPass!123', 'E2E_Bot_B');
  const C = await ensureUser('e2e-bot-c@chessworld.test', 'E2eBotPass!123', 'E2E_Bot_C');
  userList = [A, B, C];
  log(`accounts: A=${A.userId.slice(0, 8)} B=${B.userId.slice(0, 8)} C=${C.userId.slice(0, 8)}`);

  if (scenario === 'fallback') await runFallback([A, B, C]);
  else await runForceStart([A, B, C]);

  console.log(`\nRESULT: ${failures === 0 ? 'PASS ✅' : `FAIL ❌ (${failures} failures)`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { log('FATAL:', e.message); console.log('RESULT: FAIL ❌ (fatal)'); process.exit(1); });
