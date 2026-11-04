import { useEffect, useRef, useState } from 'react';
import type { SkillCheckMsg } from '@shadow-hunt/shared';
import { bus } from '../../multiplayer/events';
import { send } from '../../multiplayer/net';
import { audio } from '../audio/audio';
import { skillCheckHook } from '../systems/skillHook';

/**
 * Server-issued skill check. The client only reports where the needle was when the
 * player pressed; the server validates timing and decides the outcome.
 */
export function SkillCheck() {
  const [check, setCheck] = useState<(SkillCheckMsg & { at: number }) | null>(null);
  const [result, setResult] = useState<'great' | 'good' | 'fail' | null>(null);
  const needle = useRef<SVGLineElement>(null);
  const answered = useRef(false);

  useEffect(() => {
    const off1 = bus.on('skillCheck', (m) => {
      answered.current = false;
      setResult(null);
      audio.play('skill_warn', 0.8);
      // Short warning beat before the needle starts, like the classic genre convention.
      setCheck({ ...m, at: performance.now() });
    });
    const off2 = bus.on('skillCheckResult', (m) => {
      setResult(m.result);
      if (m.result !== 'fail') audio.play(m.result === 'great' ? 'skill_great' : 'skill_good', 0.8);
      setTimeout(() => {
        setCheck(null);
        setResult(null);
      }, 450);
    });
    return () => {
      off1();
      off2();
    };
  }, []);

  useEffect(() => {
    skillCheckHook.handle = () => {
      if (!check || answered.current) return false;
      answered.current = true;
      const ratio = Math.min(1.05, (performance.now() - check.at) / 1000 / check.duration);
      send('skillCheck', { id: check.id, ratio });
      return true;
    };
    return () => {
      skillCheckHook.handle = () => false;
    };
  }, [check]);

  useEffect(() => {
    if (!check) return;
    let raf = 0;
    const tick = () => {
      const k = Math.min(1.05, (performance.now() - check.at) / 1000 / check.duration);
      if (needle.current && !answered.current) needle.current.setAttribute('transform', `rotate(${k * 360} 60 60)`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [check]);

  if (!check) return null;
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [60 + 46 * Math.sin(a * Math.PI * 2), 60 - 46 * Math.cos(a * Math.PI * 2)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M ${x0} ${y0} A 46 46 0 ${a1 - a0 > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const color = result === 'fail' ? '#ff3a3a' : result ? '#7dff9a' : '#e8e2d6';
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <svg width="150" height="150" viewBox="0 0 120 120" className="drop-shadow-[0_0_10px_rgba(0,0,0,0.9)]">
        <circle cx="60" cy="60" r="46" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="3" />
        <path d={arc(check.zoneStart, check.zoneEnd)} fill="none" stroke="rgba(232,226,214,0.65)" strokeWidth="9" />
        <path d={arc(check.zoneStart, check.greatEnd)} fill="none" stroke="#ffffff" strokeWidth="10" />
        <line ref={needle} x1="60" y1="60" x2="60" y2="8" stroke="#d1232f" strokeWidth="3" strokeLinecap="round" />
        <circle cx="60" cy="60" r="4" fill={color} />
      </svg>
      <div className="mt-1 text-center text-[11px] tracking-[0.3em] uppercase" style={{ color }}>
        {result ? (result === 'great' ? 'Great' : result === 'good' ? 'Good' : 'Failed') : 'Space · Click · Tap'}
      </div>
    </div>
  );
}
