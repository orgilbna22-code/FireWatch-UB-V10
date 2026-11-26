import React, { useEffect, useRef, useState } from 'react';
import type { Language } from '../../types';
import {
  createGlowSprite,
  fillFlameVertices,
  traceSmoothFlamePath,
  type FlameLayerParams,
} from '../../utils/fireCanvas';

import {
  FIRE_BG_EVENT,
  type FireBackgroundMode,
  publishFireBgMode,
  readFireBgMode,
} from '../../utils/fireBgMode';
import { shouldReduceMotionOrData } from '../../utils/motionBudget';

export { FIRE_BG_EVENT, type FireBackgroundMode, publishFireBgMode, readFireBgMode };

interface GlobalFireBackgroundProps {
  initialMode?: FireBackgroundMode;
  language?: Language;
  hideRibbon?: boolean;
  hideControlPill?: boolean;
}

const LAYER_BACK: FlameLayerParams = {
  baseRatio: 0.28,
  ampRatio: 0.62,
  freq: 0.019,
  speed: 1.7,
  phase: 0.2,
  sharpness: 1.55,
};

const LAYER_MID: FlameLayerParams = {
  baseRatio: 0.2,
  ampRatio: 0.52,
  freq: 0.031,
  speed: 2.55,
  phase: 2.1,
  sharpness: 1.85,
};

const LAYER_CORE: FlameLayerParams = {
  baseRatio: 0.12,
  ampRatio: 0.34,
  freq: 0.044,
  speed: 3.35,
  phase: 4.3,
  sharpness: 2.1,
};

interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  decay: number;
  swirlPhase: number;
  swirlFreq: number;
  spriteIdx: number;
  isBokeh: boolean;
}

export const GlobalFireBackground: React.FC<GlobalFireBackgroundProps> = ({
  initialMode = 'soft',
  language = 'mn',
  hideRibbon = false,
  hideControlPill = false,
}) => {
  const isMn = language === 'mn';
  const [mode, setMode] = useState<FireBackgroundMode>(() => readFireBgMode(initialMode));

  const selectMode = (next: FireBackgroundMode) => {
    setMode(next);
    publishFireBgMode(next);
  };

  useEffect(() => {
    const onModeEvent = (e: Event) => {
      const next = (e as CustomEvent<FireBackgroundMode>).detail;
      if (next === 'vivid' || next === 'soft' || next === 'off') {
        setMode(next);
      }
    };
    window.addEventListener(FIRE_BG_EVENT, onModeEvent);
    return () => window.removeEventListener(FIRE_BG_EVENT, onModeEvent);
  }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [isCompactViewport, setIsCompactViewport] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => shouldReduceMotionOrData()
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setIsCompactViewport(e.matches);
    const onRmChange = () => setPrefersReducedMotion(shouldReduceMotionOrData());
    mq.addEventListener('change', onChange);
    rm.addEventListener('change', onRmChange);
    return () => {
      mq.removeEventListener('change', onChange);
      rm.removeEventListener('change', onRmChange);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('firewatch_bg_mode', mode);
    } catch {
      // ignore
    }
  }, [mode]);

  // Full-viewport rising embers + bottom volumetric Bezier flame waves (zero shadowBlur, 1x fill rate, 60fps locked)
  useEffect(() => {
    if (mode === 'off' || hideRibbon) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const isVivid = mode === 'vivid';
    const scale = 0.5;
    const flameRibbonHeight = (isCompactViewport ? (isVivid ? 128 : 88) : isVivid ? 196 : 132) * scale;
    const stepPx = (isCompactViewport ? 24 : 28) * scale;

    // Pre-rendered optical glow sprites (1x setup cost, hardware-accelerated blitting)
    const sprites = [
      createGlowSprite(24, 'rgba(255, 252, 220, 1)', 'rgba(255, 214, 102, 0.78)', 'rgba(255, 140, 40, 0)'),
      createGlowSprite(24, 'rgba(255, 220, 130, 0.96)', 'rgba(255, 130, 52, 0.68)', 'rgba(233, 59, 47, 0)'),
      createGlowSprite(24, 'rgba(255, 140, 70, 0.92)', 'rgba(233, 59, 47, 0.56)', 'rgba(180, 20, 20, 0)'),
      createGlowSprite(32, 'rgba(255, 185, 95, 0.42)', 'rgba(255, 99, 60, 0.16)', 'rgba(255, 99, 60, 0)'),
    ];

    let animId = 0;
    let width = 640;
    let height = 400;
    let flameMaxH = flameRibbonHeight;
    let xs = new Float32Array(128);
    let ys = new Float32Array(128);
    let gradBack!: CanvasGradient;
    let gradMid!: CanvasGradient;
    let gradCore!: CanvasGradient;

    const rebuildSize = () => {
      if (!canvas) return;
      width = Math.max(160, Math.round(window.innerWidth * scale));
      height = Math.max(180, Math.round(window.innerHeight * scale));
      // 0.5x CSS pixel grid reduces fill rate by 4x for zero-lag 60fps across all devices
      canvas.width = width;
      canvas.height = height;

      flameMaxH = Math.min(height * 0.42, flameRibbonHeight);
      const needed = Math.ceil(width / stepPx) + 4;
      if (xs.length < needed) {
        xs = new Float32Array(needed);
        ys = new Float32Array(needed);
      }

      // Feathered top stops fade smoothly into midnight-navy air without hard seams
      gradBack = ctx.createLinearGradient(0, height - flameMaxH, 0, height);
      gradBack.addColorStop(0, isVivid ? 'rgba(255, 88, 42, 0.08)' : 'rgba(255, 94, 50, 0.05)');
      gradBack.addColorStop(0.32, isVivid ? 'rgba(255, 76, 38, 0.58)' : 'rgba(240, 72, 42, 0.38)');
      gradBack.addColorStop(0.7, isVivid ? 'rgba(220, 38, 28, 0.84)' : 'rgba(198, 32, 26, 0.66)');
      gradBack.addColorStop(1, isVivid ? 'rgba(145, 16, 18, 0.94)' : 'rgba(120, 16, 22, 0.84)');

      gradMid = ctx.createLinearGradient(0, height - flameMaxH * 0.78, 0, height);
      gradMid.addColorStop(0, isVivid ? 'rgba(255, 196, 86, 0.18)' : 'rgba(255, 178, 74, 0.12)');
      gradMid.addColorStop(0.38, isVivid ? 'rgba(255, 128, 52, 0.76)' : 'rgba(255, 118, 52, 0.56)');
      gradMid.addColorStop(0.76, isVivid ? 'rgba(255, 82, 42, 0.88)' : 'rgba(235, 72, 40, 0.72)');
      gradMid.addColorStop(1, 'rgba(225, 42, 30, 0.92)');

      gradCore = ctx.createLinearGradient(0, height - flameMaxH * 0.5, 0, height);
      gradCore.addColorStop(0, isVivid ? 'rgba(255, 248, 200, 0.36)' : 'rgba(255, 236, 158, 0.22)');
      gradCore.addColorStop(0.45, isVivid ? 'rgba(255, 224, 122, 0.88)' : 'rgba(255, 204, 102, 0.68)');
      gradCore.addColorStop(1, 'rgba(255, 128, 48, 0.9)');
    };

    rebuildSize();
    window.addEventListener('resize', rebuildSize);

    const emberCount = isCompactViewport ? (isVivid ? 20 : 12) : isVivid ? 38 : 24;
    const resetEmber = (e: Ember, randomY: boolean) => {
      const isBokeh = Math.random() < 0.28;
      e.isBokeh = isBokeh;
      e.x = Math.random() * width;
      e.y = randomY ? Math.random() * height : height - Math.random() * 14;
      e.vx = (Math.random() - 0.5) * 8;
      e.vy = -(isBokeh ? 10 + Math.random() * 13 : 18 + Math.random() * 29) * (isVivid ? 1.15 : 0.92);
      e.size = (isBokeh ? 14 + Math.random() * 18 : 4 + Math.random() * 6.5) * scale;
      e.alpha = isBokeh ? 0.28 + Math.random() * 0.32 : 0.58 + Math.random() * 0.38;
      e.decay = isBokeh ? 0.06 + Math.random() * 0.06 : 0.09 + Math.random() * 0.11;
      e.swirlPhase = Math.random() * Math.PI * 2;
      e.swirlFreq = 1.6 + Math.random() * 2.2;
      e.spriteIdx = isBokeh ? 3 : Math.floor(Math.random() * 3);
    };

    const embers: Ember[] = Array.from({ length: emberCount }, () => {
      const e = {} as Ember;
      resetEmber(e, true);
      return e;
    });

    let timeSec = 0;
    let lastNow = performance.now();

    const drawFrame = (dt: number, animateEmbers: boolean) => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = 1;

      // 1. Back crimson-vermilion volumetric mantle along bottom hearth
      const c1 = fillFlameVertices(xs, ys, width, height, flameMaxH, stepPx, timeSec, LAYER_BACK);
      traceSmoothFlamePath(ctx, xs, ys, c1, width, height);
      ctx.fillStyle = gradBack;
      ctx.fill();

      // 2. Mid dynamic orange-amber flame tongues
      const c2 = fillFlameVertices(xs, ys, width, height, flameMaxH, stepPx, timeSec, LAYER_MID);
      traceSmoothFlamePath(ctx, xs, ys, c2, width, height);
      ctx.fillStyle = gradMid;
      ctx.fill();

      // 3. Incandescent gold-white inner hearth core
      ctx.globalAlpha = isVivid ? 0.85 : 0.68;
      const c3 = fillFlameVertices(xs, ys, width, height, flameMaxH, stepPx, timeSec, LAYER_CORE);
      traceSmoothFlamePath(ctx, xs, ys, c3, width, height);
      ctx.fillStyle = gradCore;
      ctx.fill();

      // 4. Full-viewport rising luminous embers + soft bokeh heat motes
      for (let i = 0; i < embers.length; i++) {
        const e = embers[i];
        if (animateEmbers) {
          e.swirlPhase += dt * e.swirlFreq;
          e.x += (e.vx + Math.sin(e.swirlPhase) * 7) * dt;
          e.y += e.vy * dt;
          e.alpha -= e.decay * dt;

          if (e.y < -e.size || e.alpha <= 0.02) {
            resetEmber(e, false);
          }
        }

        const clampedAlpha = Math.max(0, Math.min(1, e.alpha));
        if (clampedAlpha <= 0.02) continue;

        ctx.globalAlpha = clampedAlpha;
        const sprite = sprites[e.spriteIdx];
        const half = e.size;
        const stretchY = e.isBokeh ? half * 2 : half * 2.35;
        ctx.drawImage(sprite, e.x - half, e.y - stretchY * 0.5, half * 2, stretchY);
      }

      ctx.globalAlpha = 1;
    };

    if (prefersReducedMotion) {
      drawFrame(0, false);
      return () => {
        window.removeEventListener('resize', rebuildSize);
      };
    }

    const render = (now: number) => {
      animId = requestAnimationFrame(render);
      if (document.hidden) {
        lastNow = now;
        return;
      }
      const elapsedMs = now - lastNow;
      if (elapsedMs < 15) return; // cap nicely around 60fps on 120Hz displays without jitter
      const dt = Math.min(elapsedMs / 1000, 0.05);
      lastNow = now;
      timeSec += dt * (isVivid ? 1.15 : 0.9);
      drawFrame(dt, true);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', rebuildSize);
    };
  }, [mode, isCompactViewport, hideRibbon, prefersReducedMotion]);

  const isOff = mode === 'off';

  return (
    <>
      {/* Full-viewport atmospheric canvas backdrop (behind page cards at z-0, zero text occlusion) */}
      {hideRibbon ? null : isOff ? (
        <div
          data-bg-mode="off"
          className="fixed inset-0 z-0 pointer-events-none bg-[#EEF1F7] dark:bg-[#0D1220] transition-colors duration-300"
          aria-hidden="true"
        />
      ) : (
        <div
          data-bg-mode={mode}
          className="fire-ambient-bg fixed inset-0 z-0 print:hidden pointer-events-none overflow-hidden select-none"
          style={{
            background:
              mode === 'vivid'
                ? 'linear-gradient(175deg, #070B2A 0%, #12123B 38%, #281128 72%, #3D1418 100%)'
                : 'linear-gradient(175deg, #070B28 0%, #0D1442 44%, #1A1333 76%, #28121E 100%)',
          }}
          aria-hidden="true"
        >
          {/* Pure GPU-composited warm hearth radial glows (zero blur filters) */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                mode === 'vivid'
                  ? 'radial-gradient(ellipse 85% 48% at 50% 100%, rgba(255,99,60,0.42) 0%, rgba(233,59,47,0.18) 45%, rgba(11,18,77,0) 80%), radial-gradient(circle at 14% 22%, rgba(255,112,56,0.16) 0%, rgba(11,18,77,0) 48%), radial-gradient(circle at 86% 64%, rgba(233,59,47,0.14) 0%, rgba(11,18,77,0) 44%)'
                  : 'radial-gradient(ellipse 82% 44% at 50% 100%, rgba(255,99,60,0.28) 0%, rgba(233,59,47,0.11) 44%, rgba(11,18,77,0) 78%), radial-gradient(circle at 14% 22%, rgba(255,112,56,0.11) 0%, rgba(11,18,77,0) 46%)',
            }}
          />

          <canvas
            ref={canvasRef}
            data-decorative="true"
            className="absolute inset-0 w-full h-full pointer-events-none"
          />
        </div>
      )}

      {/* Bottom-right Fire Background Control Pill (Desktop only; mobile uses Header Settings) */}
      {!hideRibbon && !hideControlPill && (
        <div
          role="region"
          aria-label={isMn ? 'Арын галын тохиргоо' : 'Backdrop fire controls'}
          className="hidden lg:block fixed bottom-3 right-3 z-[45] print:hidden"
        >
          <div className="bg-white/98 dark:bg-[#0D1324]/96 px-3 py-1 rounded-full border border-black/[0.08] dark:border-white/15 shadow-lg flex items-center gap-2 text-xs font-sans transition-colors hover:bg-white dark:hover:bg-[#11192E]">
            <span className="flex items-center gap-1.5 font-bold text-[#0B124D] dark:text-slate-100 text-xs whitespace-nowrap">
              <span className={`w-2 h-2 rounded-full ${isOff ? 'bg-slate-300 dark:bg-slate-600' : 'bg-[#FF633C] animate-pulse'}`} />
              <span>{isMn ? '🔥 Арын гал:' : '🔥 Backdrop fire:'}</span>
            </span>

            <div className="flex items-center bg-[#F2F4F7] dark:bg-slate-800/80 p-0.5 rounded-full text-xs font-semibold">
              <button
                type="button"
                aria-pressed={mode === 'soft'}
                onClick={() => selectMode('soft')}
                className={`min-h-[44px] px-3 py-1 rounded-full transition-colors ${
                  mode === 'soft'
                    ? 'bg-[#0B124D] dark:bg-[#FF633C] text-white font-bold shadow-xs'
                    : 'text-[#5C6275] dark:text-slate-300 hover:text-black dark:hover:text-white'
                }`}
                title={isMn ? 'Зөөлөн, намуун галын дөл' : 'Soft, gentle flames'}
              >
                {isMn ? 'Зөөлөн' : 'Soft'}
              </button>
              <button
                type="button"
                aria-pressed={mode === 'vivid'}
                onClick={() => selectMode('vivid')}
                className={`min-h-[44px] px-3 py-1 rounded-full transition-colors ${
                  mode === 'vivid'
                    ? 'bg-[#FF633C] text-white font-bold shadow-xs'
                    : 'text-[#5C6275] dark:text-slate-300 hover:text-black dark:hover:text-white'
                }`}
                title={isMn ? 'Тод галын дөл' : 'Vivid flames'}
              >
                {isMn ? 'Тод' : 'Vivid'}
              </button>
              <button
                type="button"
                aria-pressed={mode === 'off'}
                onClick={() => selectMode('off')}
                className={`min-h-[44px] px-3 py-1 rounded-full transition-colors ${
                  mode === 'off'
                    ? 'bg-slate-700 text-white font-bold shadow-xs'
                    : 'text-[#5C6275] dark:text-slate-300 hover:text-black dark:hover:text-white'
                }`}
                title={isMn ? 'Галыг алга болгох / хаах' : 'Turn the backdrop off'}
              >
                {isMn ? 'Хаах' : 'Off'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
