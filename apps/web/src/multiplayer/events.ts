import type { FxMsg, NoiseMsg, RevealMsg, SkillCheckMsg, SkillCheckResultMsg, TrackMsg } from '@shadow-hunt/shared';

type Events = {
  fx: FxMsg;
  noise: NoiseMsg;
  track: TrackMsg;
  reveal: RevealMsg;
  skillCheck: SkillCheckMsg;
  skillCheckResult: SkillCheckResultMsg;
};

type Handler<T> = (payload: T) => void;

/** Tiny typed event bus between the network layer, the 3D scene, HUD and audio. */
class Bus {
  private handlers = new Map<keyof Events, Set<Handler<any>>>();
  on<K extends keyof Events>(type: K, h: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(h);
    return () => set.delete(h);
  }
  emit<K extends keyof Events>(type: K, payload: Events[K]) {
    this.handlers.get(type)?.forEach((h) => h(payload));
  }
}

export const bus = new Bus();
