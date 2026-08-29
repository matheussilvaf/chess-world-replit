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

/**
 * Gate de administrador reutilizável — mesma convenção do coordinatorRoutes:
 * valida o JWT, resolve o e-mail do usuário e aplica a allowlist ADMIN_EMAILS
 * (e-mails separados por vírgula). Sem ADMIN_EMAILS definido: permite apenas
 * em NODE_ENV=development (com aviso alto), senão 403 — fail closed para o
 * deploy nunca ficar aberto a qualquer usuário autenticado.
 */
export async function requireSupabaseAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
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
  let userId: string | null = null;
  let email = '';
  try {
    const supabase = createClient(url, key);
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data.user) {
      userId = data.user.id;
      email = String(data.user.email || '').toLowerCase();
    }
  } catch {
    // tratado abaixo (userId continua null)
  }
  if (!userId) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  (req as Request & { userId?: string; userEmail?: string }).userId = userId;
  (req as Request & { userEmail?: string }).userEmail = email;

  const raw = (process.env.ADMIN_EMAILS || '').trim();
  if (raw) {
    const allowed = raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (email && allowed.includes(email)) {
      next();
      return;
    }
    res.status(403).json({ error: 'Acesso restrito a administradores' });
    return;
  }
  if (process.env.NODE_ENV === 'development') {
    console.warn('[Auth] ADMIN_EMAILS não definido — liberando escrita admin para qualquer usuário autenticado (apenas development). Defina ADMIN_EMAILS antes de ir ao ar.');
    next();
    return;
  }
  res.status(403).json({ error: 'ADMIN_EMAILS não configurado no servidor' });
}
