/**
 * Shared Supabase JWT auth middleware.
 *
 * Validates the `Authorization: Bearer <jwt>` header against Supabase Auth
 * (service-role client) and sets `req.userId`. Used by every authenticated
 * HTTP surface (tournament admin, rig admin). No anonymous writes.
 */
import type { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';

export async function requireSupabaseAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }
  const token = authHeader.replace('Bearer ', '');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Server auth not configured' });
    return;
  }
  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    (req as Request & { userId?: string }).userId = data.user.id;
    next();
  } catch {
    res.status(401).json({ error: 'Auth verification failed' });
  }
}
