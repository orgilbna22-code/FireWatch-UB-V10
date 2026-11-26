export type FireBackgroundMode = 'vivid' | 'soft' | 'off';

export const FIRE_BG_EVENT = 'fw-bg-mode-change';

export function readFireBgMode(fallback: FireBackgroundMode = 'soft'): FireBackgroundMode {
  try {
    const saved = localStorage.getItem('firewatch_bg_mode');
    if (saved === 'vivid' || saved === 'soft' || saved === 'off') return saved;
  } catch {
    // ignore storage restriction
  }
  return fallback;
}

export function publishFireBgMode(mode: FireBackgroundMode): void {
  try {
    localStorage.setItem('firewatch_bg_mode', mode);
  } catch {
    // ignore storage restriction
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<FireBackgroundMode>(FIRE_BG_EVENT, { detail: mode }));
  }
}
