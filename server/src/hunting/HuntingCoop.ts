import type { Client } from '@colyseus/core';
import { areFriends } from '../friends/friendshipService.js';
import { notifyUser } from '../realtime/userNotify.js';
import { HUNT_MSG } from '../shared/hunting/HuntingShapes.js';
import type { HuntingManager } from './HuntingManager.js';
import { HUNT_COOP_MAX_MEMBERS } from '../shared/hunting/HuntingCoopPolicy.js';

interface Invite {
  inviteId: string;
  partyId: string;
  fromUserId: string;
  fromUsername: string;
  toUserId: string;
  contract: NonNullable<ReturnType<HuntingManager['coopContractSnapshot']>>;
  region: string;
  expiresAt: number;
}

const managersByUser = new Map<string, HuntingManager>();
const invites = new Map<string, Invite>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sweepInvites(): void {
  const now = Date.now();
  for (const [inviteId, invite] of invites) if (invite.expiresAt <= now) invites.delete(inviteId);
}

export function registerHunter(userId: string, manager: HuntingManager): void {
  managersByUser.set(userId, manager);
}
export function unregisterHunter(userId: string, manager: HuntingManager): void {
  if (managersByUser.get(userId) === manager) managersByUser.delete(userId);
}
export function unregisterManager(manager: HuntingManager): void {
  for (const [userId, registered] of managersByUser) if (registered === manager) managersByUser.delete(userId);
}

const reply = (client: Client, requestId: string, ok: boolean, error?: string) =>
  client.send(HUNT_MSG.requestResult, { requestId, ok, ...(error ? { error } : {}) });

export async function inviteCoop(manager: HuntingManager, client: Client, data: unknown): Promise<void> {
  sweepInvites();
  const body = data as { requestId?: unknown; friendUserId?: unknown };
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  const friendUserId = typeof body.friendUserId === 'string' ? body.friendUserId : '';
  const sender = manager.coopPlayer(client.sessionId);
  const contract = sender ? manager.coopContractSnapshot(sender.id) : null;
  if (!sender || !contract || !friendUserId) return reply(client, requestId, false, 'Você precisa ter um contrato ativo');
  if (!UUID_RE.test(friendUserId)) return reply(client, requestId, false, 'Jogador inválido');
  const partyId = contract.partyId ?? sender.id;
  const members = manager.coopPartyMembers(partyId);
  if (members.some((member) => member.userId === friendUserId)) return reply(client, requestId, false, 'Este amigo já está no grupo');
  if (members.length >= HUNT_COOP_MAX_MEMBERS) return reply(client, requestId, false, 'O grupo já tem 4 caçadores');
  if (!(await areFriends(sender.id, friendUserId))) return reply(client, requestId, false, 'Vocês não são amigos');
  const invite: Invite = {
    inviteId: crypto.randomUUID(), partyId, fromUserId: sender.id, fromUsername: sender.username,
    toUserId: friendUserId, contract: { ...contract, partyId }, region: manager.coopRegion(),
    expiresAt: Date.now() + 120_000,
  };
  for (const [existingId, existing] of invites) {
    if (existing.fromUserId === sender.id && existing.toUserId === friendUserId) invites.delete(existingId);
  }
  const pendingForSender = [...invites.values()].filter((pending) => pending.fromUserId === sender.id).length;
  if (pendingForSender >= 3) return reply(client, requestId, false, 'Você já tem 3 convites pendentes');
  if (!notifyUser(friendUserId, 'hunt_coop_invite', invite)) return reply(client, requestId, false, 'Este amigo não está online');
  invites.set(invite.inviteId, invite);
  client.send(HUNT_MSG.event, { type: 'progress', message: `Convite enviado` });
  reply(client, requestId, true);
}

export async function respondCoop(manager: HuntingManager, client: Client, data: unknown): Promise<void> {
  sweepInvites();
  const body = data as { requestId?: unknown; inviteId?: unknown; accept?: unknown };
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  const invite = typeof body.inviteId === 'string' ? invites.get(body.inviteId) : undefined;
  const player = manager.coopPlayer(client.sessionId);
  if (!invite || !player || invite.toUserId !== player.id || invite.expiresAt < Date.now()) {
    return reply(client, requestId, false, 'O convite expirou');
  }
  invites.delete(invite.inviteId);
  if (body.accept !== true) {
    notifyUser(invite.fromUserId, HUNT_MSG.event, { type: 'progress', message: `${player.username} recusou o convite` });
    return reply(client, requestId, true);
  }
  const leaderManager = managersByUser.get(invite.partyId);
  if (!leaderManager || !leaderManager.coopContractSnapshot(invite.partyId)) {
    return reply(client, requestId, false, 'O contrato do líder não está mais ativo');
  }
  if (leaderManager !== manager) {
    return reply(client, requestId, false, `Viaje para ${invite.region} e peça um novo convite`);
  }
  const joined = await manager.joinCoopParty(client, invite);
  reply(client, requestId, joined.ok, joined.error);
}