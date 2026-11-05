import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { log } from './utils/log.ts';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

/** True when guest tokens are signed with a per-process random key (they reset on restart). */
let guestSecretEphemeral = false;

function guestSecret(): string {
  if (env.GUEST_TOKEN_SECRET && env.GUEST_TOKEN_SECRET.length >= 32) return env.GUEST_TOKEN_SECRET;
  if (isProd) {
    // Keep the game playable on a fresh deploy instead of crashing: tokens stay unforgeable,
    // but every guest gets a new identity whenever this server process restarts.
    guestSecretEphemeral = true;
    log.error(
      'GUEST_TOKEN_SECRET (32+ chars) is not set — using a random per-process key; guest sessions reset on every restart.',
    );
    return randomBytes(32).toString('hex');
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
  get guestSecretEphemeral() {
    return guestSecretEphemeral;
  },
  supabaseUrl: env.SUPABASE_URL ?? '',
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  dataDir: env.DATA_DIR ?? path.resolve(process.cwd(), 'data'),
  /** Disable persistence completely (tests). */
  memoryStore: env.STORE === 'memory',
};

export const supabaseEnabled = Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
