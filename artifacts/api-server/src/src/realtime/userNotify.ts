import type { Client } from '@colyseus/core';

const clientsByUser = new Map<string, Set<Client>>();

export function registerClient(userId: string, client: Client): void {
  if (!userId || userId.startsWith('anon:')) return;
  const clients = clientsByUser.get(userId) ?? new Set<Client>();
  clients.add(client);
  clientsByUser.set(userId, clients);
}

export function unregisterClient(userId: string, client: Client): void {
  const clients = clientsByUser.get(userId);
  if (!clients) return;
  clients.delete(client);
  if (clients.size === 0) clientsByUser.delete(userId);
}

export function notifyUser(userId: string, type: string, payload: unknown): boolean {
  const clients = clientsByUser.get(userId);
  if (!clients?.size) return false;
  for (const client of clients) client.send(type, payload);
  return true;
}