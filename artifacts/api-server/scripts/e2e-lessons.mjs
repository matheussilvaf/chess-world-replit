// Protocolo real da Sala de Lições (requer API reiniciada e SQL da fase 3).
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../chessworld/package.json', import.meta.url));
const { Client } = require('colyseus.js');
const { Chess } = require('chess.js');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const role = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !role) throw new Error('Configure SUPABASE_URL, VITE_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.');
const auth = createClient(url, anon);
const service = createClient(url, role);
const rooms = [];
const events = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function account(number) {
  const email = process.env[`E2E_PUZZLE_EMAIL_${number}`] || `e2e-puzzle-${number}@chessworld.test`;
  const password = process.env[`E2E_PUZZLE_PASSWORD_${number}`] || 'E2ePuzzle2025!';
  const { error: createError } = await service.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `Puzzle E2E ${number}` },
  });
  if (createError && !/already|registered/i.test(createError.message)) throw createError;
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { token: data.session.access_token, id: data.user.id };
}
async function enter(user) {
  const room = await new Client(process.env.E2E_WS || 'ws://localhost:8080')
    .joinOrCreate('academy', { token: user.token, username: 'Puzzle E2E', region: 'academy' });
  const received = [];
  events.set(room, received);
  for (const type of ['academy_lesson_state', 'academy_lesson_seated', 'academy_lesson_session_end',
    'academy_puzzle_started', 'academy_puzzle_feedback', 'academy_error'])
    room.onMessage(type, (data) => { received.push({ type, data }); console.log(type, JSON.stringify(data).slice(0, 260)); });
  rooms.push(room);
  return room;
}
async function next(room, type, predicate = () => true, after = 0) {
  for (let i = 0; i < 250; i++) {
    const messages = events.get(room).slice(after);
    const found = messages.find((m) => m.type === type && predicate(m.data));
    if (found) return found.data;
    const error = messages.find((m) => m.type === 'academy_error');
    if (error) throw new Error(`Servidor: ${JSON.stringify(error.data)}`);
    await wait(80);
  }
  throw new Error(`Tempo esgotado aguardando ${type}.`);
}
async function solution(started) {
  // Acesso privilegiado SOMENTE no teste; a resposta nunca vem do socket.
  const { data, error } = await service.from('lichess_puzzles').select('moves')
    .eq('puzzle_id', started.puzzleId).single();
  if (error) throw error;
  return data.moves;
}
async function solve(room, started) {
  const moves = await solution(started);
  for (let k = 1; k < moves.length; k += 2) {
    const cursor = events.get(room).length;
    room.send('academy_puzzle_move', { sessionId: started.sessionId, uci: moves[k] });
    const feedback = await next(room, 'academy_puzzle_feedback', (f) => f.sessionId === started.sessionId && f.moveIndex === (k - 1) / 2, cursor);
    if (!feedback.ok || feedback.reply !== (moves[k + 1] ?? undefined) || feedback.solved !== (k + 1 >= moves.length))
      throw new Error(`Feedback de solução incorreto: ${JSON.stringify(feedback)}`);
  }
}
async function fail(room, started) {
  const moves = await solution(started);
  const chess = new Chess(started.fen);
  chess.move({ from: started.setupMove.slice(0, 2), to: started.setupMove.slice(2, 4), promotion: started.setupMove[4] });
  const alternative = chess.moves({ verbose: true }).find((m) => {
    const uci = `${m.from}${m.to}${m.promotion || ''}`;
    if (uci === moves[1]) return false;
    const test = new Chess(chess.fen());
    test.move(m);
    return !test.isCheckmate();
  });
  if (!alternative) throw new Error(`Nenhum lance errado disponível em ${started.puzzleId}.`);
  const cursor = events.get(room).length;
  room.send('academy_puzzle_move', { sessionId: started.sessionId,
    uci: `${alternative.from}${alternative.to}${alternative.promotion || ''}` });
  const feedback = await next(room, 'academy_puzzle_feedback', (f) => f.sessionId === started.sessionId, cursor);
  if (feedback.ok || feedback.solved || JSON.stringify(feedback.solutionMoves) !== JSON.stringify(moves.slice(1)))
    throw new Error(`Erro não revelou solução somente após falha: ${JSON.stringify(feedback)}`);
}
try {
  const a = await account(1);
  const b = await account(2);
  const A = await enter(a);
  const B = await enter(b);
  A.send('register_boards', { boards: [
    { id: 'academy_lesson_1', name: 'Mates', x: 0, y: 0 },
    { id: 'academy_lesson_2', name: 'Táticas fundamentais', x: 100, y: 0 },
  ] });
  await wait(500);
  let cursor = events.get(A).length;
  A.send('academy_lesson_sit', { boardId: 'academy_lesson_2' });
  const seat = await next(A, 'academy_lesson_seated', () => true, cursor);
  if (seat.seat !== 'bottom') throw new Error('Primeiro jogador não sentou embaixo.');
  cursor = events.get(B).length;
  B.send('academy_lesson_sit', { boardId: 'academy_lesson_2' });
  if ((await next(B, 'academy_lesson_seated', () => true, cursor)).seat !== 'top') throw new Error('Segundo jogador não sentou em cima.');
  cursor = events.get(A).length;
  A.send('academy_lesson_practice_start', { boardId: 'academy_lesson_2', theme: 'fork', difficulty: 'iniciante' });
  let started = await next(A, 'academy_puzzle_started', (d) => d.context.kind === 'lesson', cursor);
  if (started.context.index !== 0 || started.context.total !== 10 || started.boardId !== 'academy_lesson_2' ||
    'solutionMoves' in started || 'livesLeft' in started) throw new Error('Payload inicial da lição incorreto.');
  await solve(A, started);
  cursor = events.get(A).length;
  A.send('academy_lesson_next', { boardId: 'academy_lesson_2' });
  started = await next(A, 'academy_puzzle_started', (d) => d.context.kind === 'lesson' && d.context.index === 1, cursor);
  await fail(A, started);
  cursor = events.get(A).length;
  A.send('academy_lesson_stop', {});
  const ended = await next(A, 'academy_lesson_session_end', (d) => d.kind === 'lesson', cursor);
  if (ended.solved !== 1 || ended.attempted !== 2 || ended.reason !== 'stopped') throw new Error('Resumo incorreto.');
  cursor = events.get(A).length;
  A.send('academy_lesson_open', {});
  const state = await next(A, 'academy_lesson_state', () => true, cursor);
  if (state.schemaMissing) throw new Error('Execute tactics_academy_phase3.sql para o teste completo.');
  if (state.stats.attempted < 2) throw new Error('Histórico não refletiu os dois puzzles.');
  cursor = events.get(A).length;
  A.send('academy_lesson_problem_start', { boardId: 'academy_lesson_2',
    filters: { theme: 'fork', difficulty: 'easy', length: 'short', phase: 'any' } });
  const problem = await next(A, 'academy_puzzle_started', (d) => d.context.kind === 'problem', cursor);
  if (problem.context.index !== 0 || problem.boardId !== 'academy_lesson_2') throw new Error('Problema inicial inválido.');
  cursor = events.get(A).length;
  A.send('academy_lesson_stop', {});
  await next(A, 'academy_lesson_session_end', (d) => d.kind === 'problem' && d.reason === 'stopped', cursor);
  A.send('academy_lesson_leave', {});
  for (let i = 0; i < 30 && A.state.boards.get('academy_lesson_2')?.whitePlayerId; i++) await wait(100);
  if (A.state.boards.get('academy_lesson_2')?.whitePlayerId) throw new Error('Cadeira não foi liberada.');
  console.log('✅ Sala de Lições: cadeiras, prática, acerto, erro, progresso e problemas verificados.');
} catch (error) {
  console.error('❌ E2E Sala de Lições:', error);
  process.exitCode = 1;
} finally {
  for (const room of rooms) try { await room.leave(); } catch {}
}