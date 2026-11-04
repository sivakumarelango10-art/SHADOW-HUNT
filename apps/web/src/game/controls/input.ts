import { useSettings, type Action } from '../../stores/settings';

export type OneShot =
  'attack' | 'ability' | 'roar' | 'flashlight' | 'item' | 'interactDown' | 'interactUp' | 'skill' | 'pause' | 'spectateNext';

/**
 * Unified input state for keyboard/mouse and touch. The game loop reads axes every
 * frame and drains one-shot actions; nothing here talks to the network directly.
 */
export const input = {
  held: new Set<Action>(),
  lookDX: 0,
  lookDY: 0,
  touchMove: { x: 0, y: 0 },
  touchSprint: false,
  touchCrouch: false,
  touchInteract: false,
  showStatus: false,
  queue: [] as OneShot[],
  enabled: false,
  pointerLocked: false,
  usingTouch: false,
  push(a: OneShot) {
    if (this.queue.length < 16) this.queue.push(a);
  },
  drain(): OneShot[] {
    const q = this.queue;
    this.queue = [];
    return q;
  },
  axes() {
    let mx = 0;
    let mz = 0;
    if (this.held.has('forward')) mz += 1;
    if (this.held.has('back')) mz -= 1;
    if (this.held.has('right')) mx += 1;
    if (this.held.has('left')) mx -= 1;
    mx += this.touchMove.x;
    mz += this.touchMove.y;
    return { mx: Math.max(-1, Math.min(1, mx)), mz: Math.max(-1, Math.min(1, mz)) };
  },
  sprinting() {
    return this.held.has('sprint') || this.touchSprint;
  },
  crouching() {
    return this.held.has('crouch') || this.touchCrouch;
  },
  interacting() {
    return this.held.has('interact') || this.touchInteract;
  },
  reset() {
    this.held.clear();
    this.lookDX = this.lookDY = 0;
    this.touchMove.x = this.touchMove.y = 0;
    this.touchSprint = this.touchCrouch = this.touchInteract = false;
    this.queue = [];
  },
};

function actionFor(code: string): Action | null {
  const keys = useSettings.getState().keys;
  for (const [a, codes] of Object.entries(keys) as [Action, string[]][]) if (codes.includes(code)) return a;
  return null;
}

const PREVENT = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft']);

export function attachDesktopInput(canvas: HTMLElement): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!input.enabled) return;
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (PREVENT.has(e.code)) e.preventDefault();
    if (e.code === 'Escape') {
      input.push('pause');
      return;
    }
    if (e.code === 'Space') {
      input.push('skill');
      return;
    }
    const a = actionFor(e.code);
    if (!a || e.repeat) return;
    input.held.add(a);
    switch (a) {
      case 'interact':
        input.push('interactDown');
        input.push('skill');
        break;
      case 'flashlight':
        input.push('flashlight');
        break;
      case 'ability':
        input.push('ability');
        break;
      case 'roar':
        input.push('roar');
        break;
      case 'item':
        input.push('item');
        break;
      case 'status':
        input.showStatus = true;
        break;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const a = actionFor(e.code);
    if (!a) return;
    input.held.delete(a);
    if (a === 'interact') input.push('interactUp');
    if (a === 'status') input.showStatus = false;
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!input.enabled || !input.pointerLocked) return;
    input.lookDX += e.movementX;
    input.lookDY += e.movementY;
  };
  const onMouseDown = (e: MouseEvent) => {
    if (!input.enabled) return;
    if (!input.pointerLocked) {
      if (e.target === canvas) canvas.requestPointerLock?.();
      return;
    }
    if (e.button === 0) {
      input.push('attack');
      input.push('skill');
      input.push('spectateNext');
    }
    if (e.button === 2) input.push('ability');
  };
  const onLockChange = () => {
    input.pointerLocked = document.pointerLockElement === canvas;
    if (!input.pointerLocked) input.held.clear();
  };
  const onBlur = () => input.held.clear();
  const onContext = (e: Event) => e.preventDefault();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('contextmenu', onContext);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('pointerlockchange', onLockChange);
    canvas.removeEventListener('contextmenu', onContext);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  };
}
