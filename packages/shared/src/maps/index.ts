import { ASYLUM } from './asylum.ts';
import { BLACKWOOD } from './blackwood.ts';
import type { MapDef } from './types.ts';
import type { MapId } from '../types.ts';

export const MAPS: Record<MapId, MapDef> = { blackwood: BLACKWOOD, asylum: ASYLUM };
export const MAP_IDS = Object.keys(MAPS) as MapId[];
export function isMapId(id: string): id is MapId {
  return id in MAPS;
}
export * from './types.ts';
export { MapBuilder, mulberry32, validateMap } from './builder.ts';
