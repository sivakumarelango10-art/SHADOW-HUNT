import {
  buildDynamicBlockers,
  buildStaticWorld,
  MAPS,
  type DynamicBlockers,
  type InteractPlayer,
  type InteractWorld,
  type MapId,
  type StaticWorld,
} from '@shadow-hunt/shared';

const statics = new Map<MapId, StaticWorld>();
export function staticWorld(mapId: MapId): StaticWorld {
  let w = statics.get(mapId);
  if (!w) statics.set(mapId, (w = buildStaticWorld(MAPS[mapId])));
  return w;
}

let dynKey = '';
let dynCache: DynamicBlockers = { boxes: [] };

/** Client copy of the dynamic blockers, rebuilt only when doors/pallets/gates change. */
export function dynamicBlockers(mapId: MapId, s: any): DynamicBlockers {
  let key = mapId;
  s.doors?.forEach((d: any, id: string) => (key += d.open ? '' : id));
  s.pallets?.forEach((v: string, id: string) => (key += v === 'down' ? `p${id}` : ''));
  s.exits?.forEach((e: any, id: string) => (key += e.open ? `e${id}` : ''));
  if (key !== dynKey) {
    dynKey = key;
    dynCache = buildDynamicBlockers(MAPS[mapId], {
      doorOpen: (id) => s.doors?.get(id)?.open ?? true,
      palletDown: (id) => s.pallets?.get(id) === 'down',
      exitOpen: (id) => s.exits?.get(id)?.open ?? false,
    });
  }
  return dynCache;
}

/** Adapts live replicated state to the shared interaction rules. */
export function interactWorld(mapId: MapId, s: any): InteractWorld {
  const keys: InteractWorld['keys'] = [];
  s.keys?.forEach((k: any, id: string) => keys.push({ id, x: k.x, z: k.z, carriedBy: k.carriedBy, deposited: k.deposited }));
  const players: InteractPlayer[] = [];
  s.players?.forEach((p: any) =>
    players.push({
      id: p.sessionId, role: p.role, characterId: p.characterId, condition: p.condition, x: p.x, z: p.z, yaw: p.yaw,
      hiddenIn: p.hiddenIn, carryingKey: p.carryingKey, item: p.item, cageId: p.cageId, busy: p.action !== 'none',
    }),
  );
  return {
    map: MAPS[mapId],
    powerOn: s.powerOn,
    keysDeposited: s.keysDeposited,
    keysRequired: s.keysRequired,
    generator: (id) => s.generators?.get(id),
    exit: (id) => s.exits?.get(id),
    keys,
    pallet: (id) => s.pallets?.get(id) ?? 'broken',
    door: (id) => s.doors?.get(id),
    pickupTaken: (id) => s.pickups?.get(id) === true,
    players,
    lockerOccupied: () => false,
  };
}
