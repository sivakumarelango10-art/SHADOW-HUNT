import { useEffect, useRef, useState, type ReactNode } from 'react';
import { input, type OneShot } from '../controls/input';
import { useHud } from '../../stores/hud';

/**
 * Touch controls: a floating joystick on the left half, swipe-to-look on the right
 * half, and a thumb cluster of actions. Built for landscape phones; every surface
 * uses touch-action:none so the browser never scrolls, zooms or navigates back.
 */
export function MobileControls({ role, hasItem }: { role: 'survivor' | 'hunter'; hasItem: boolean }) {
  const [stick, setStick] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const moveId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  const [sprint, setSprint] = useState(false);
  const [crouch, setCrouch] = useState(false);

  useEffect(() => {
    input.usingTouch = true;
    const prevent = (e: TouchEvent) => e.preventDefault();
    document.addEventListener('touchmove', prevent, { passive: false });
    document.addEventListener('gesturestart', prevent as EventListener);
    return () => {
      input.usingTouch = false;
      document.removeEventListener('touchmove', prevent);
      document.removeEventListener('gesturestart', prevent as EventListener);
    };
  }, []);

  useEffect(() => {
    input.touchSprint = sprint;
    input.touchCrouch = crouch;
  }, [sprint, crouch]);

  const onStart = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      const left = t.clientX < window.innerWidth * 0.42;
      if (left && moveId.current === null) {
        moveId.current = t.identifier;
        setStick({ x: t.clientX, y: t.clientY, dx: 0, dy: 0 });
      } else if (!left && lookId.current === null) {
        lookId.current = t.identifier;
        lookLast.current = { x: t.clientX, y: t.clientY };
        input.push('skill');
        input.push('spectateNext');
      }
    }
  };
  const onMove = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === moveId.current && stick) {
        const max = 56;
        let dx = t.clientX - stick.x;
        let dy = t.clientY - stick.y;
        const len = Math.hypot(dx, dy);
        if (len > max) {
          dx = (dx / len) * max;
          dy = (dy / len) * max;
        }
        setStick({ ...stick, dx, dy });
        input.touchMove.x = dx / max;
        input.touchMove.y = -dy / max;
        // Pushing the stick to the rim sprints automatically.
        input.touchSprint = sprint || len > max * 1.25;
      } else if (t.identifier === lookId.current) {
        input.lookDX += (t.clientX - lookLast.current.x) * 1.4;
        input.lookDY += (t.clientY - lookLast.current.y) * 1.4;
        lookLast.current = { x: t.clientX, y: t.clientY };
      }
    }
  };
  const onEnd = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === moveId.current) {
        moveId.current = null;
        setStick(null);
        input.touchMove.x = input.touchMove.y = 0;
        input.touchSprint = sprint;
      }
      if (t.identifier === lookId.current) lookId.current = null;
    }
  };

  return (
    <div
      className="absolute inset-0 z-20 select-none"
      style={{ touchAction: 'none' }}
      onTouchStart={onStart}
      onTouchMove={onMove}
      onTouchEnd={onEnd}
      onTouchCancel={onEnd}
    >
      {stick && (
        <div className="pointer-events-none absolute" style={{ left: stick.x - 64, top: stick.y - 64 }}>
          <div className="h-32 w-32 rounded-full border border-white/20 bg-white/5" />
          <div
            className="absolute h-14 w-14 rounded-full border border-white/40 bg-white/15"
            style={{ left: 64 - 28 + stick.dx, top: 64 - 28 + stick.dy }}
          />
        </div>
      )}
      {!stick && (
        <div className="pointer-events-none absolute bottom-10 left-10 h-28 w-28 rounded-full border border-dashed border-white/10 text-center text-[10px] leading-[7rem] tracking-widest text-white/25 uppercase">
          Move
        </div>
      )}

      <div className="absolute right-4 bottom-4 flex items-end gap-3" onTouchStart={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-3">
          {role === 'hunter' ? (
            <>
              <Btn label="Roar" onPress={() => input.push('roar')} small />
              <Btn label="Power" onPress={() => input.push('ability')} small />
            </>
          ) : (
            <>
              <Btn label="Light" onPress={() => input.push('flashlight')} small />
              {hasItem && <Btn label="Item" onPress={() => input.push('item')} small />}
            </>
          )}
        </div>
        <div className="flex flex-col items-end gap-3">
          {role === 'survivor' && (
            <div className="flex gap-3">
              <Btn label="Crouch" active={crouch} onPress={() => setCrouch((c) => !c)} small />
              <Btn label="Sprint" active={sprint} onPress={() => setSprint((c) => !c)} small />
            </div>
          )}
          <div className="flex gap-3">
            <HoldBtn label="Use" />
            {role === 'hunter' && <Btn label="Attack" onPress={() => input.push('attack')} big danger />}
          </div>
        </div>
      </div>
      <button
        className="absolute top-3 right-3 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs tracking-widest text-white/70 uppercase"
        onTouchStart={(e) => {
          e.stopPropagation();
          useHud.getState().set({ paused: true });
        }}
      >
        Pause
      </button>
    </div>
  );
}

function Btn({
  label,
  onPress,
  small,
  big,
  active,
  danger,
}: {
  label: ReactNode;
  onPress: () => void;
  small?: boolean;
  big?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  const size = big ? 'h-20 w-20 text-sm' : small ? 'h-14 w-14 text-[10px]' : 'h-16 w-16 text-xs';
  return (
    <button
      className={`${size} rounded-full border font-semibold tracking-wider uppercase backdrop-blur-sm transition active:scale-95 ${
        danger
          ? 'border-blood/80 bg-blood/40 text-white'
          : active
            ? 'border-bone/70 bg-bone/25 text-white'
            : 'border-white/25 bg-black/35 text-white/80'
      }`}
      onTouchStart={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onPress();
      }}
    >
      {label}
    </button>
  );
}

function HoldBtn({ label }: { label: string }) {
  const push = (a: OneShot) => input.push(a);
  return (
    <button
      className="h-20 w-20 rounded-full border border-white/35 bg-black/40 text-sm font-semibold tracking-wider text-white uppercase backdrop-blur-sm active:scale-95 active:bg-white/20"
      onTouchStart={(e) => {
        e.stopPropagation();
        e.preventDefault();
        input.touchInteract = true;
        push('interactDown');
        push('skill');
      }}
      onTouchEnd={(e) => {
        e.stopPropagation();
        input.touchInteract = false;
        push('interactUp');
      }}
      onTouchCancel={() => {
        input.touchInteract = false;
        push('interactUp');
      }}
    >
      {label}
    </button>
  );
}
