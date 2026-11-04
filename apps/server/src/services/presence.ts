/**
 * In-process presence: which player is in which room. Used for the friends list
 * ("online", "join their lobby") and unique room codes.
 * For multi-instance deployments swap this for Colyseus RedisPresence.
 */
interface Seat {
  roomCode: string;
  joinable: boolean;
  since: number;
}

const seats = new Map<string, Seat>();
const lastSeen = new Map<string, number>();
const codes = new Set<string>();

export const presence = {
  join(playerId: string, roomCode: string, joinable: boolean) {
    seats.set(playerId, { roomCode, joinable, since: Date.now() });
    lastSeen.set(playerId, Date.now());
  },
  leave(playerId: string, roomCode: string) {
    const s = seats.get(playerId);
    if (s && s.roomCode === roomCode) seats.delete(playerId);
    lastSeen.set(playerId, Date.now());
  },
  setJoinable(roomCode: string, joinable: boolean) {
    for (const s of seats.values()) if (s.roomCode === roomCode) s.joinable = joinable;
  },
  touch(playerId: string) {
    lastSeen.set(playerId, Date.now());
  },
  status(playerId: string): { online: boolean; roomCode: string | null } {
    const s = seats.get(playerId);
    const seen = lastSeen.get(playerId) ?? 0;
    return { online: !!s || Date.now() - seen < 90_000, roomCode: s && s.joinable ? s.roomCode : null };
  },
  claimCode(code: string): boolean {
    if (codes.has(code)) return false;
    codes.add(code);
    return true;
  },
  releaseCode(code: string) {
    codes.delete(code);
  },
};
