/** Tiny structured logger. JSON in production so log drains can parse it. */
const prod = process.env.NODE_ENV === 'production';
const quiet = process.env.LOG_LEVEL === 'silent';

function emit(level: 'info' | 'warn' | 'error' | 'debug', msg: string, data?: Record<string, unknown>) {
  if (quiet && level !== 'error') return;
  if (level === 'debug' && !process.env.DEBUG) return;
  if (prod) {
    console[level === 'debug' ? 'log' : level](JSON.stringify({ t: new Date().toISOString(), level, msg, ...data }));
  } else {
    const tag = { info: '\x1b[36minfo\x1b[0m', warn: '\x1b[33mwarn\x1b[0m', error: '\x1b[31merror\x1b[0m', debug: 'debug' }[level];
    console[level === 'debug' ? 'log' : level](`${tag} ${msg}`, data ? JSON.stringify(data) : '');
  }
}

export const log = {
  info: (m: string, d?: Record<string, unknown>) => emit('info', m, d),
  warn: (m: string, d?: Record<string, unknown>) => emit('warn', m, d),
  error: (m: string, d?: Record<string, unknown>) => emit('error', m, d),
  debug: (m: string, d?: Record<string, unknown>) => emit('debug', m, d),
};
