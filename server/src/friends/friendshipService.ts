import { getServiceClient } from '../rigs/serviceSupabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function areFriends(firstUserId: string, secondUserId: string): Promise<boolean> {
  if (!UUID_RE.test(firstUserId) || !UUID_RE.test(secondUserId)) return false;
  const client = getServiceClient();
  if (!client) return false;
  const { data, error } = await client
    .from('friend_requests')
    .select('id')
    .eq('status', 'accepted')
    .or(`and(requester_id.eq.${firstUserId},receiver_id.eq.${secondUserId}),and(requester_id.eq.${secondUserId},receiver_id.eq.${firstUserId})`)
    .limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}