// Protocolo da Sala de Puzzles contra o servidor local (sem mocks).
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../chessworld/package.json', import.meta.url));
const { Client } = require('colyseus.js');
const { Chess } = require('chess.js');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anon || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Configure SUPABASE_URL, VITE_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.');
const auth = createClient(url, anon);
const service = process.env.SUPABASE_SERVICE_ROLE_KEY && createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
const rooms = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tracks = new Map();
function listen(room) {
  const messages = [];
  tracks.set(room, messages);
  for (const type of ['academy_daily_state', 'academy_puzzle_started', 'academy_puzzle_feedback',
    'academy_battle_state', 'academy_error']) room.onMessage(type, (data) => {
    messages.push({ type, data });
    console.log(type, JSON.stringify(data).slice(0, 300));
  });
}
async function next(room, type, predicate = () => true, after = 0, timeout = 18000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = tracks.get(room).slice(after).find((m) => m.type === type && predicate(m.data));
    if (found) return found.data;
    const error = tracks.get(room).slice(after).find((m) => m.type === 'academy_error');
    if (error) throw new Error(`Servidor: ${JSON.stringify(error.data)}`);
    await wait(80);
  }
  throw new Error(`Tempo esgotado aguardando ${type}.`);
}
async function account(number) {
  const email = process.env[`E2E_PUZZLE_EMAIL_${number}`] || `e2e-puzzle-${number}@chessworld.test`;
  const password = process.env[`E2E_PUZZLE_PASSWORD_${number}`] || 'E2ePuzzle2025!';
  if (service) {
    const { error } = await service.auth.admin.createUser({ email, password, email_confirm: true,
      user_metadata: { username: `Puzzle E2E ${number}` } });
    if (error && !/already|registered/i.test(error.message)) throw error;
  }
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { token: data.session.access_token, userId: data.user.id, name: `Puzzle E2E ${number}` };
}
async function enter(user) {
  const room = await new Client(process.env.E2E_WS || 'ws://localhost:8080')
    .joinOrCreate('academy', { token: user.token, username: user.name, region: 'academy', x: 1273, y: 926 });
  listen(room);
  rooms.push(room);
  return room;
}
async function wrongLegal(puzzle) {
  const chess = new Chess(puzzle.fen);
  const setup = puzzle.setupMove;
  chess.move({ from: setup.slice(0, 2), to: setup.slice(2, 4), promotion: setup[4] });
  const moves = chess.moves({ verbose: true });
  // Consulta privilegiada restrita ao E2E. Nunca transmite a solução ao cliente.
  const { data, error } = await service.from('lichess_puzzles').select('moves').eq('puzzle_id', puzzle.puzzleId).single();
  if (error) throw error;
  const wrong = moves.find((m) => `${m.from}${m.to}${m.promotion || ''}` !== data.moves[1] &&
    !(() => { const test = new Chess(chess.fen()); test.move(m); return test.isCheckmate(); })());
  if (!wrong) throw new Error(`Sem lance legal errado no puzzle ${puzzle.puzzleId}.`);
  return `${wrong.from}${wrong.to}${wrong.promotion || ''}`;
}
async function failPuzzle(room, started) {
  const uci = await wrongLegal(started);
  const cursor = tracks.get(room).length;
  room.send('academy_puzzle_move', { sessionId: started.sessionId, uci });
  const feedback = await next(room, 'academy_puzzle_feedback', (d) => d.sessionId === started.sessionId, cursor);
  if (feedback.ok !== false) throw new Error('Lance errado foi aceito.');
  return feedback;
}
try {
  const userA = await account(1);
  const userB = await account(2);
  const A = await enter(userA);
  const B = await enter(userB);
  const date = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const { error: cleanupError } = await service.from('academy_daily_attempts').delete()
    .eq('user_id', userA.userId).eq('puzzle_date', date).eq('slot', 1);
  if (cleanupError && !['42P01', 'PGRST205'].includes(cleanupError.code)) throw cleanupError;
  let cursor = tracks.get(A).length;
  A.send('academy_daily_open', {});
  const daily = await next(A, 'academy_daily_state', () => true, cursor);
  if (daily.schemaMissing) console.warn('⚠ Tabelas da fase 2 ausentes; ignorando teste diário.');
  else {
    cursor = tracks.get(A).length;
    A.send('academy_daily_start', { slot: 1 });
    const started = await next(A, 'academy_puzzle_started', (d) => d.context.kind === 'daily', cursor);
    cursor = tracks.get(A).length;
    const feedback = await failPuzzle(A, started);
    if (!feedback.restart || feedback.livesLeft !== 2) throw new Error('Diário: tentativa errada não reduziu vida para 2.');
    await next(A, 'academy_puzzle_started', (d) => d.context.kind === 'daily' && d.sessionId !== started.sessionId, cursor);
  }
  A.send('register_boards', { boards: [{ id: 'academy_challenge_1', name: 'Desafio 1', x: 0, y: 0 }] });
  await wait(600);
  A.send('academy_battle_create', { boardId: 'academy_challenge_1', mode: 'race', band: 'beginner', showThemes: false });
  const board = A.state.boards.get('academy_challenge_1');
  for (let i = 0; i < 30 && board?.status !== 'waiting'; i++) await wait(100);
  if (board?.status !== 'waiting') throw new Error('Mesa não ficou em espera.');
  cursor = tracks.get(A).length;
  const cursorB = tracks.get(B).length;
  B.send('academy_battle_accept', { boardId: 'academy_challenge_1' });
  const countdown = await next(A, 'academy_battle_state', (d) => d.phase === 'countdown', cursor);
  await next(B, 'academy_battle_state', (d) => d.phase === 'countdown', cursorB);
  const startedA = await next(A, 'academy_puzzle_started', (d) => d.context.kind === 'battle', cursor, 20000);
  const startedB = await next(B, 'academy_puzzle_started', (d) => d.context.kind === 'battle', cursorB, 20000);
  if (startedA.puzzleId !== startedB.puzzleId) throw new Error('Puzzles iniciais dos jogadores não coincidem.');
  const afterB = tracks.get(B).length;
  await failPuzzle(B, startedB);
  const afterA = tracks.get(A).length;
  await failPuzzle(A, startedA);
  await next(A, 'academy_battle_state', (d) => d.me.failed >= 1 && d.opponent.failed >= 1, afterA);
  await next(A, 'academy_puzzle_started', (d) => d.context.index === 1, afterA);
  await next(B, 'academy_puzzle_started', (d) => d.context.index === 1, afterB);
  const finishedAt = tracks.get(A).length;
  A.send('academy_battle_leave', { battleId: countdown.battleId });
  const finished = await next(A, 'academy_battle_state', (d) => d.phase === 'finished', finishedAt);
  if (finished.result?.winnerId !== finished.opponent.playerId) throw new Error('Desistência não deu vitória a B.');
  console.log('✅ Protocolo diário e batalha verificado.');
} catch (error) {
  console.error('❌ E2E Sala de Puzzles:', error);
  process.exitCode = 1;
} finally {
  for (const room of rooms) try { await room.leave(); } catch {}
}