import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, supabaseEnabled } from '../config.ts';
import { log } from '../utils/log.ts';

export interface Identity {
  playerId: string;
  isGuest: boolean;
  email?: string;
  displayName?: string;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (payload: string) => createHmac('sha256', config.guestTokenSecret).update(payload).digest('base64url');

/** Guest tokens are HMAC-signed so a client cannot impersonate another guest. */
export function issueGuestToken(playerId = randomUUID()): { token: string; playerId: string } {
  const payload = b64(JSON.stringify({ sub: playerId, iat: Date.now() }));
  return { token: `g1.${payload}.${sign(payload)}`, playerId };
}

function verifyGuestToken(token: string): Identity | null {
  const [v, payload, sig] = token.split('.');
  if (v !== 'g1' || !payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: string };
    if (typeof data.sub !== 'string' || data.sub.length < 8) return null;
    return { playerId: data.sub, isGuest: true };
  } catch {
    return null;
  }
}

let admin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient | null {
  if (!supabaseEnabled) return null;
  admin ??= createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/** Short cache so every room join does not round-trip to Supabase Auth. */
const sbCache = new Map<string, { id: Identity; until: number }>();

async function verifySupabaseToken(jwt: string): Promise<Identity | null> {
  const client = supabaseAdmin();
  if (!client) return null;
  const cached = sbCache.get(jwt);
  if (cached && cached.until > Date.now()) return cached.id;
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) {
    log.debug('supabase token rejected', { error: error?.message });
    return null;
  }
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const id: Identity = {
    playerId: data.user.id,
    isGuest: false,
    email: data.user.email ?? undefined,
    displayName: (meta.full_name as string) || (meta.name as string) || data.user.email?.split('@')[0],
  };
  sbCache.set(jwt, { id, until: Date.now() + 60_000 });
  if (sbCache.size > 5000) sbCache.clear();
  return id;
}

/**
 * Tokens are `g1.<payload>.<sig>` (guest) or `sb.<supabase access token>`.
 */
export async function verifyToken(token: unknown): Promise<Identity | null> {
  if (typeof token !== 'string' || token.length > 4096) return null;
  if (token.startsWith('g1.')) return verifyGuestToken(token);
  if (token.startsWith('sb.')) return verifySupabaseToken(token.slice(3));
  return null;
}

export function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m?.[1];
}
