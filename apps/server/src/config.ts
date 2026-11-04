import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { log } from './utils/log.ts';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function guestSecret(): string {
  if (env.GUEST_TOKEN_SECRET && env.GUEST_TOKEN_SECRET.length >= 32) return env.GUEST_TOKEN_SECRET;
  if (isProd) {
    throw new Error('GUEST_TOKEN_SECRET (min 32 chars) must be set in production.');
  }
  // Development: persist a generated secret so guest sessions survive server restarts.
  const dir = env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
  const file = path.join(dir, '.dev-guest-secret');
  try {
    if (env.STORE !== 'memory') {
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
      fs.mkdirSync(dir, { recursive: true });
      const secret = randomBytes(32).toString('hex');
      fs.writeFileSync(file, secret, { mode: 0o600 });
      log.warn(`GUEST_TOKEN_SECRET not set — generated a development secret in ${file}`);
      return secret;
    }
  } catch {
    /* fall through to ephemeral */
  }
  return randomBytes(32).toString('hex');
}

export const config = {
  isProd,
  port: Number(env.PORT ?? 2567),
  /** Comma separated list of allowed browser origins, or * for any (dev only). */
  corsOrigins: (env.CORS_ORIGIN ?? (isProd ? '' : '*'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  guestTokenSecret: guestSecret(),
  supabaseUrl: env.SUPABASE_URL ?? '',
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  dataDir: env.DATA_DIR ?? path.resolve(process.cwd(), 'data'),
  /** Disable persistence completely (tests). */
  memoryStore: env.STORE === 'memory',
};

export const supabaseEnabled = Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
