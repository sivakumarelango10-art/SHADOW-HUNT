import type { Condition } from './types.ts';

/**
 * Survivor condition state machine. Every condition change on the server goes
 * through `transition()` so invalid jumps (e.g. captured → healthy) are impossible.
 *
 *   healthy ──hit──▶ injured ──hit──▶ downed ──capture──▶ captured ──rescue──▶ rescued ──▶ injured
 *      ▲               │  ▲             │  ▲                 │
 *      └────heal───────┘  └───revive────┘  └ (locker grab)    └──timer──▶ eliminated
 *   any standing state ──exit zone──▶ escaped
 */
export const TRANSITIONS: Record<Condition, readonly Condition[]> = {
  healthy: ['injured', 'downed', 'escaped', 'eliminated'],
  injured: ['healthy', 'downed', 'escaped', 'eliminated'],
  downed: ['injured', 'captured', 'eliminated'],
  captured: ['rescued', 'eliminated'],
  rescued: ['injured', 'downed', 'escaped', 'eliminated'],
  escaped: [],
  eliminated: [],
};

export function canTransition(from: Condition, to: Condition): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isAliveInMatch(c: Condition): boolean {
  return c !== 'escaped' && c !== 'eliminated';
}

export function isStanding(c: Condition): boolean {
  return c === 'healthy' || c === 'injured' || c === 'rescued';
}

export function healthFor(c: Condition): number {
  switch (c) {
    case 'healthy':
      return 2;
    case 'injured':
    case 'rescued':
      return 1;
    default:
      return 0;
  }
}
