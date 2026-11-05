/** Browser stand-in for the server logger (artifact build only). */
const emit = (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => {
  if (level === 'info') return;
  console[level](`[shadow-hunt] ${msg}`, data ?? '');
};
export const log = {
  info: (m: string, d?: Record<string, unknown>) => emit('info', m, d),
  warn: (m: string, d?: Record<string, unknown>) => emit('warn', m, d),
  error: (m: string, d?: Record<string, unknown>) => emit('error', m, d),
  debug: (_m: string, _d?: Record<string, unknown>) => {},
};
