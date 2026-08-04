/**
 * Shared Supabase JWT auth middleware.
 *
 * Validates the `Authorization: Bearer <jwt>` header against Supabase Auth
 * (service-role client) and sets `req.userId`. Used by every authenticated
 * HTTP surface (tournament admin, rig admin). No anonymous writes.
 */
import type { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

/**
 * Verifica um JWT do Supabase e devolve o userId (sub) — ou null se
 * inválido/expirado/não configurado. Compartilhado entre o middleware HTTP
 * e o onJoin das salas Colyseus (identidade NUNCA vem do cliente).
 */
export async function verifySupabaseToken(token: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !token) return null;
  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

export async function requireSupabaseAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }
  const token = authHeader.replace('Bearer ', '');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server auth not configured' });
    return;
  }
  const userId = await verifySupabaseToken(token);
  if (!userId) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  (req as Request & { userId?: string }).userId = userId;
  next();
}
