// Protocol E2E: cooperative hunting contracts against ws://localhost:8080.
import { createRequire } from 'module';
const req = createRequire('/home/runner/workspace/artifacts/chessworld/package.json');
const { Client } = req('colyseus.js');
const { createClient } = req('@supabase/supabase-js');

const WS = process.env.E2E_WS || 'ws://localhost:8080';
const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const PASSWORD = 'E2eBotPass!123';
const REGION = process.env.E2E_HUNT_REGION || 'craft:south_america';
if (!URL || !SERVICE_KEY || !ANON_KEY) throw new Error('Supabase environment is incomplete');
const admin = createClient(URL, SERVICE_KEY);
const started = Date.now();
const log = (...args) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...args);
const pass = (message) => log('PASS', message);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll(description, fn, timeout = 30000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await sleep(interval);
  }
  throw new Error(`timeout: ${description}`);
}

async function account(email, username) {
  const anon = createClient(URL, ANON_KEY);
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return { id: data.user.id, token: data.session.access_token, username };
}

async function cleanup(A, B) {
  if (!A || !B) return;
  const pair = `and(requester_id.eq.${A.id},receiver_id.eq.${B.id}),and(requester_id.eq.${B.id},receiver_id.eq.${A.id})`;
  const friends = await admin.from('friend_requests').delete().or(pair);
  if (friends.error) throw new Error(`friend cleanup: ${friends.error.message}`);
  const hunting = await admin.from('player_hunting').delete().in('user_id', [A.id, B.id]);
  if (hunting.error) throw new Error(`hunting cleanup: ${hunting.error.message}`);
}

function messages(room, tag, types) {
  const seen = [];
  for (const type of types) room.onMessage(type, (data) => {
    seen.push({ type, data, at: Date.now() });
    log(`MSG ${tag}/${type}`, JSON.stringify(data).slice(0, 220));
  });
  room.onMessage('*', () => {});
  return seen;
}
const waitMessage = (seen, type, predicate = () => true, timeout = 30000) =>
  poll(type, () => seen.find((message) => message.type === type && predicate(message.data, message)), timeout);

function entityById(room, userId) {
  let found;
  room.state.players?.forEach((player) => { if (player.id === userId) found = player; });
  return found;
}

async function walkTo(room, userId, x, y) {
  const player = await poll('authoritative player', () => entityById(room, userId));
  while (Math.hypot(x - player.x, y - player.y) > 35) {
    const distance = Math.hypot(x - player.x, y - player.y);
    const step = Math.min(50, distance);
    const nx = player.x + (x - player.x) / distance * step;
    const ny = player.y + (y - player.y) / distance * step;
    room.send('move_to', { x: nx, y: ny, targetX: nx, targetY: ny, direction: 'down', isMoving: true });
    await sleep(360);
  }
  room.send('move_to', { x, y, targetX: x, targetY: y, direction: 'down', isMoving: false });
  await poll('movement accepted', () => Math.hypot(player.x - x, player.y - y) < 45);
}

let A;
let B;
let roomA;
let roomB;
let failed = false;
const watchdog = setTimeout(() => {
  console.error('RESULT FAIL (watchdog)');
  process.exit(2);
}, 150000);

try {
  A = await account('e2e-bot-a@chessworld.test', 'E2E_Bot_A');
  B = await account('e2e-bot-b@chessworld.test', 'E2E_Bot_B');
  await cleanup(A, B);
  pass('service-role cleanup before test');

  const friendship = await admin.from('friend_requests').insert({
    requester_id: A.id, receiver_id: B.id, status: 'accepted',
  });
  if (friendship.error) throw new Error(`friendship insert: ${friendship.error.message}`);
  pass('accepted friendship created');

  const options = (accountData) => ({
    token: accountData.token, playerId: accountData.id, username: accountData.username,
    rating: 1200, region: REGION, x: 0, y: 0,
  });
  roomA = await new Client(WS).joinOrCreate('world', options(A));
  const seenA = messages(roomA, 'A', ['hunt_contracts', 'hunt_state', 'hunt_request_result', 'hunt_event']);
  roomB = await new Client(WS).joinOrCreate('world', options(B));
  const seenB = messages(roomB, 'B', ['hunt_state', 'hunt_request_result', 'hunt_event', 'hunt_coop_invite', 'hunt_teleport']);
  await poll('both players in same room', () => entityById(roomA, A.id) && entityById(roomA, B.id));
  pass(`A then B joined world/${REGION}`);

  const npc = await poll('Barbarian NPC', () => {
    let value;
    roomA.state.npcs?.forEach((candidate) => { value ??= candidate; });
    return value;
  });
  await walkTo(roomA, A.id, npc.x, npc.y);
  roomA.send('hunt_npc_talk');
  const contractsMessage = await waitMessage(seenA, 'hunt_contracts', (data) =>
    Array.isArray(data?.contracts) && data.contracts.some((contract) => contract.availability === 'available'));
  const contract = contractsMessage.data.contracts.find((item) => item.availability === 'available');
  const acceptId = crypto.randomUUID();
  roomA.send('hunt_contract_accept', { requestId: acceptId, contractId: contract.id });
  await waitMessage(seenA, 'hunt_request_result', (data) => data.requestId === acceptId && data.ok === true);
  const activeA = await waitMessage(seenA, 'hunt_state', (data) => data.active?.contractId === contract.id);
  if (!activeA.data.active) throw new Error('A did not receive active hunt state');
  pass(`A accepted contract ${contract.id}`);

  const inviteId = crypto.randomUUID();
  roomA.send('hunt_coop_invite', { requestId: inviteId, friendUserId: B.id });
  await waitMessage(seenA, 'hunt_request_result', (data) => data.requestId === inviteId && data.ok === true);
  const invitation = await waitMessage(seenB, 'hunt_coop_invite', (data) =>
    data.fromUserId === A.id && data.contract?.contractId === contract.id);
  pass('B received coop invite with contract snapshot');

  const respondId = crypto.randomUUID();
  roomB.send('hunt_coop_respond', { requestId: respondId, inviteId: invitation.data.inviteId, accept: true });
  await waitMessage(seenB, 'hunt_request_result', (data) => data.requestId === respondId && data.ok === true);
  const teleport = await waitMessage(seenB, 'hunt_teleport', () => true);
  const leader = entityById(roomA, A.id);
  const teleportDistance = Math.hypot(teleport.data.x - leader.x, teleport.data.y - leader.y);
  if (teleportDistance > 120) throw new Error(`teleport distance ${teleportDistance.toFixed(1)} > 120`);
  const groupedB = await waitMessage(seenB, 'hunt_state', (data) =>
    data.active?.partyId === A.id && data.active.partyMembers?.length === 2);
  const groupedA = await waitMessage(seenA, 'hunt_state', (data) =>
    data.active?.partyId === A.id && data.active.partyMembers?.length === 2);
  if (!groupedB || !groupedA) throw new Error('party state missing');
  pass(`B teleported ${teleportDistance.toFixed(1)}px from A; both states list two members`);

  const abandonB = crypto.randomUUID();
  const abandonBAt = Date.now();
  roomB.send('hunt_contract_abandon', { requestId: abandonB });
  await waitMessage(seenB, 'hunt_request_result', (data) => data.requestId === abandonB && data.ok === true);
  await waitMessage(seenB, 'hunt_state', (data, message) => message.at >= abandonBAt && data.active === null);
  await waitMessage(seenA, 'hunt_state', (data, message) =>
    message.at >= abandonBAt && data.active?.partyId === A.id && data.active.partyMembers?.length === 1);
  pass('B abandoned; B cleared and A remained as party of one');

  const abandonA = crypto.randomUUID();
  const abandonAAt = Date.now();
  roomA.send('hunt_contract_abandon', { requestId: abandonA });
  await waitMessage(seenA, 'hunt_request_result', (data) => data.requestId === abandonA && data.ok === true);
  await waitMessage(seenA, 'hunt_state', (data, message) => message.at >= abandonAAt && data.active === null);
  pass('A abandoned and active contract cleared');
} catch (error) {
  failed = true;
  log('FAIL', error instanceof Error ? error.stack || error.message : String(error));
} finally {
  try { roomA?.leave(); } catch {}
  try { roomB?.leave(); } catch {}
  try {
    await cleanup(A, B);
    pass('service-role cleanup after test');
  } catch (error) {
    failed = true;
    log('FAIL cleanup', error instanceof Error ? error.message : String(error));
  }
  clearTimeout(watchdog);
}

console.log(`RESULT ${failed ? 'FAIL' : 'PASS'}`);
process.exit(failed ? 1 : 0);