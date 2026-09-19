import { Router, type Request, type Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireSupabaseAuth } from '../auth/supabaseAuth.js';
import { notifyUser } from '../realtime/userNotify.js';
import { progressService } from '../progress/progressService.js';
import { SKILL_LABELS, totalSkillLevel } from '../shared/progress/EnergySkillsShapes.js';

type FriendRow = {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: string;
  created_at: string;
};

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase não configurado');
  return createClient(url, key);
}

function userId(req: Request): string {
  return (req as Request & { userId?: string }).userId as string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro interno';
}

async function profileFor(id: string) {
  const db = serviceClient();
  const { data, error } = await db.from('profiles').select('user_id,username,chess_rating,rating,gambits,games_played,wins,losses,draws,current_region').eq('user_id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function levelsFor(ids: string[]): Promise<Map<string, number>> {
  const entries = await Promise.all([...new Set(ids)].map(async (id) => [id, totalSkillLevel((await progressService.getSnapshot(id)).skills)] as const));
  return new Map(entries);
}

// Ids vêm de filtros PostgREST montados por string (.or(...)): só aceitar UUIDs para não permitir injeção de filtro.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

export const friendsRouter = Router();
friendsRouter.use(requireSupabaseAuth);

friendsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const me = userId(req);
    const db = serviceClient();
    const { data: rows, error } = await db.from('friend_requests').select('id,requester_id,receiver_id,status,created_at').or(`requester_id.eq.${me},receiver_id.eq.${me}`);
    if (error) throw new Error(error.message);
    const all = (rows ?? []) as FriendRow[];
    const relevantIds = all.flatMap((r) => [r.requester_id, r.receiver_id]).filter((id) => id !== me);
    const uniqueIds = [...new Set(relevantIds)];
    const [{ data: profiles, error: profileError }, { data: presence, error: presenceError }, levels] = await Promise.all([
      uniqueIds.length ? db.from('profiles').select('user_id,username,chess_rating,rating,current_region').in('user_id', uniqueIds) : Promise.resolve({ data: [], error: null }),
      uniqueIds.length ? db.from('player_presence').select('user_id,region,status,updated_at').in('user_id', uniqueIds) : Promise.resolve({ data: [], error: null }),
      levelsFor(uniqueIds),
    ]);
    if (profileError) throw new Error(profileError.message);
    if (presenceError) throw new Error(presenceError.message);
    const profileMap = new Map<string, any>((profiles ?? []).map((p: any) => [p.user_id, p] as [string, any]));
    const presenceMap = new Map<string, any>((presence ?? []).map((p: any) => [p.user_id, p] as [string, any]));
    const summary = (id: string) => {
      const p: any = profileMap.get(id);
      const onlineRow: any = presenceMap.get(id);
      return {
        userId: id,
        username: p?.username ?? 'Jogador',
        chessRating: Math.round(p?.chess_rating ?? p?.rating ?? 1200),
        level: levels.get(id) ?? 9,
        online: Boolean(onlineRow?.status !== 'offline' && onlineRow?.updated_at && Date.now() - new Date(onlineRow.updated_at).getTime() <= 90_000),
        region: onlineRow?.region ?? p?.current_region ?? null,
      };
    };
    res.json({
      friends: all.filter((r) => r.status === 'accepted').map((r) => summary(r.requester_id === me ? r.receiver_id : r.requester_id)),
      incoming: all.filter((r) => r.status === 'pending' && r.receiver_id === me).map((r) => ({ id: r.id, createdAt: r.created_at, from: summary(r.requester_id) })),
      outgoing: all.filter((r) => r.status === 'pending' && r.requester_id === me).map((r) => ({ id: r.id, createdAt: r.created_at, to: summary(r.receiver_id) })),
    });
  } catch (error) {
    res.status(500).json({ error: message(error) });
  }
});

friendsRouter.post('/requests', async (req: Request, res: Response) => {
  try {
    const me = userId(req);
    const target = typeof req.body?.targetUserId === 'string' ? req.body.targetUserId : '';
    if (!isUuid(target)) return void res.status(400).json({ error: 'Jogador inválido' });
    if (target === me) return void res.status(400).json({ error: 'Você não pode adicionar a si mesmo' });
    const db = serviceClient();
    const targetProfile = await profileFor(target);
    if (!targetProfile) return void res.status(404).json({ error: 'Jogador não encontrado' });
    const { data, error } = await db.from('friend_requests').select('id,requester_id,receiver_id,status,created_at').or(`and(requester_id.eq.${me},receiver_id.eq.${target}),and(requester_id.eq.${target},receiver_id.eq.${me})`);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as FriendRow[];
    if (rows.some((r) => r.status === 'accepted')) return void res.status(400).json({ error: 'Este jogador já é seu amigo' });
    const reverse = rows.find((r) => r.status === 'pending' && r.requester_id === target);
    if (reverse) {
      const { error: updateError } = await db.from('friend_requests').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', reverse.id);
      if (updateError) throw new Error(updateError.message);
      const mine = await profileFor(me);
      notifyUser(target, 'friend_accepted', { userId: me, username: mine?.username ?? 'Jogador' });
      return void res.json({ accepted: true });
    }
    if (rows.some((r) => r.status === 'pending')) return void res.status(400).json({ error: 'Já existe uma solicitação pendente' });
    const rejected = rows.find((r) => r.status === 'rejected');
    const now = new Date().toISOString();
    const query = rejected
      ? db.from('friend_requests').update({ requester_id: me, receiver_id: target, status: 'pending', created_at: now, updated_at: now }).eq('id', rejected.id).select('id,created_at').single()
      : db.from('friend_requests').insert({ requester_id: me, receiver_id: target, status: 'pending' }).select('id,created_at').single();
    const { data: created, error: writeError } = await query;
    if (writeError) throw new Error(writeError.message);
    const mine = await profileFor(me);
    notifyUser(target, 'friend_request', { requestId: created.id, from: { userId: me, username: mine?.username ?? 'Jogador' }, createdAt: created.created_at });
    res.status(201).json({ accepted: false, requestId: created.id });
  } catch (error) {
    res.status(500).json({ error: message(error) });
  }
});

async function actOnRequest(req: Request, res: Response, status: 'accepted' | 'rejected') {
  try {
    const me = userId(req);
    const db = serviceClient();
    const { data: row, error } = await db.from('friend_requests').select('id,requester_id,receiver_id,status').eq('id', req.params.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return void res.status(404).json({ error: 'Solicitação não encontrada' });
    if (row.receiver_id !== me) return void res.status(403).json({ error: 'Somente o destinatário pode responder' });
    if (row.status !== 'pending') return void res.status(400).json({ error: 'Solicitação não está pendente' });
    const { error: updateError } = await db.from('friend_requests').update({ status, updated_at: new Date().toISOString() }).eq('id', row.id);
    if (updateError) throw new Error(updateError.message);
    if (status === 'accepted') {
      const mine = await profileFor(me);
      notifyUser(row.requester_id, 'friend_accepted', { userId: me, username: mine?.username ?? 'Jogador' });
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: message(error) });
  }
}

friendsRouter.post('/requests/:id/accept', (req, res) => void actOnRequest(req, res, 'accepted'));
friendsRouter.post('/requests/:id/reject', (req, res) => void actOnRequest(req, res, 'rejected'));

friendsRouter.delete('/:friendId', async (req: Request, res: Response) => {
  try {
    const me = userId(req);
    const other = req.params.friendId;
    if (!isUuid(other)) return void res.status(400).json({ error: 'Jogador inválido' });
    const db = serviceClient();
    const { data, error } = await db.from('friend_requests').select('id,status').eq('status', 'accepted').or(`and(requester_id.eq.${me},receiver_id.eq.${other}),and(requester_id.eq.${other},receiver_id.eq.${me})`).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return void res.status(404).json({ error: 'Amizade não encontrada' });
    const { error: updateError } = await db.from('friend_requests').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', data.id);
    if (updateError) throw new Error(updateError.message);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: message(error) });
  }
});

export const playersRouter = Router();
playersRouter.use(requireSupabaseAuth);
playersRouter.get('/:playerId/summary', async (req: Request, res: Response) => {
  try {
    const me = userId(req);
    const id = req.params.playerId;
    if (!isUuid(id)) return void res.status(400).json({ error: 'Jogador inválido' });
    const db = serviceClient();
    const profile = await profileFor(id);
    if (!profile) return void res.status(404).json({ error: 'Jogador não encontrado' });
    const [snapshot, walletResult, presenceResult, friendshipResult] = await Promise.all([
      progressService.getSnapshot(id),
      db.from('player_wallets').select('crowns').eq('user_id', id).maybeSingle(),
      db.from('player_presence').select('region,status,updated_at').eq('user_id', id).maybeSingle(),
      db.from('friend_requests').select('id,requester_id,receiver_id,status').or(`and(requester_id.eq.${me},receiver_id.eq.${id}),and(requester_id.eq.${id},receiver_id.eq.${me})`).in('status', ['accepted', 'pending']).maybeSingle(),
    ]);
    if (walletResult.error) throw new Error(walletResult.error.message);
    if (presenceResult.error) throw new Error(presenceResult.error.message);
    if (friendshipResult.error) throw new Error(friendshipResult.error.message);
    const relation: any = friendshipResult.data;
    const friendship = relation?.status === 'accepted' ? 'friends' : relation?.requester_id === me ? 'pending_out' : relation?.status === 'pending' ? 'pending_in' : 'none';
    res.json({
      userId: id,
      username: profile.username,
      level: totalSkillLevel(snapshot.skills),
      skills: Object.entries(snapshot.skills).map(([skillId, skill]) => ({ id: skillId, name: SKILL_LABELS[skillId as keyof typeof SKILL_LABELS], ...skill })),
      chessRating: Math.round(profile.chess_rating ?? profile.rating ?? 1200),
      gambits: profile.gambits ?? 0,
      crowns: walletResult.data?.crowns ?? 0,
      gamesPlayed: profile.games_played ?? 0,
      wins: profile.wins ?? 0,
      losses: profile.losses ?? 0,
      draws: profile.draws ?? 0,
      friendship,
      ...(friendship.startsWith('pending') ? { requestId: relation.id } : {}),
      online: Boolean(presenceResult.data?.status !== 'offline' && presenceResult.data?.updated_at && Date.now() - new Date(presenceResult.data.updated_at).getTime() <= 90_000),
      region: presenceResult.data?.region ?? profile.current_region ?? null,
    });
  } catch (error) {
    res.status(500).json({ error: message(error) });
  }
});