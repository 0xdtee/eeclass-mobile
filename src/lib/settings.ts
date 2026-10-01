/**
 * Local settings (localStorage) — AI default toggles / mic sensitivity / translation / class material / light-dark theme.
 * All pure front-end persistence, no backend involved.
 */

/* ---------------- AI processing default toggles ---------------- */
export const AI_DEFAULT_KEYS = {
  aiCorrect: 'eeclass_default_aiCorrect',
  smartSeg: 'eeclass_default_smartSeg',
  translateEn: 'eeclass_default_translateEn',
  autoSummary: 'eeclass_default_autoSummary',   // 结束录制后自动跳转并生成 AI 摘要
} as const;

export type AiDefaultKey = keyof typeof AI_DEFAULT_KEYS;

/** Read a given AI default toggle. Defaults to on (true) when unset. */
export function getAiDefault(key: AiDefaultKey): boolean {
  if (typeof window === 'undefined') return true;
  const v = localStorage.getItem(AI_DEFAULT_KEYS[key]);
  if (v == null) return true;
  return v === '1';
}

export function setAiDefault(key: AiDefaultKey, on: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(AI_DEFAULT_KEYS[key], on ? '1' : '0');
}

/* ---------------- Mic sensitivity (input gain) ---------------- */
// The capture chain is gain -> limiter -> makeup -> soft clip, so the top of the range lifts a distant
// lecturer instead of squaring off the waveform (plain clipping stopped helping past ~6x).
const MIC_GAIN_KEY = 'eeclass_mic_gain';
const MIC_GAIN_MIGRATION = 'eeclass_mic_gain_default_v3';
export const MIC_GAIN_MIN = 1;
export const MIC_GAIN_MAX = 12;
/** Classroom mics sit far from the lecturer, so full gain is the useful default. */
export const MIC_GAIN_DEFAULT = MIC_GAIN_MAX;

/** Read the mic gain, clamped to [1, 12]. Devices carrying the old 0.5–3 scale are lifted to the new default once. */
export function getMicGain(): number {
  if (typeof window === 'undefined') return MIC_GAIN_DEFAULT;
  try {
    if (localStorage.getItem(MIC_GAIN_MIGRATION) !== '1') {
      localStorage.setItem(MIC_GAIN_MIGRATION, '1');
      localStorage.setItem(MIC_GAIN_KEY, String(MIC_GAIN_DEFAULT));
      return MIC_GAIN_DEFAULT;
    }
    const raw = localStorage.getItem(MIC_GAIN_KEY);
    const n = raw == null ? MIC_GAIN_DEFAULT : parseFloat(raw);
    if (!Number.isFinite(n)) return MIC_GAIN_DEFAULT;
    return Math.max(MIC_GAIN_MIN, Math.min(MIC_GAIN_MAX, n));
  } catch {
    return MIC_GAIN_DEFAULT;
  }
}

export function setMicGain(n: number): void {
  if (typeof window === 'undefined') return;
  const clamped = Math.max(MIC_GAIN_MIN, Math.min(MIC_GAIN_MAX, n));
  try { localStorage.setItem(MIC_GAIN_KEY, String(clamped)); } catch { /* ignore */ }
}

/* ---------------- Live translation (source ⇄ target) ---------------- */
// Off by default (from === to means off): most classes are taught in one language, and the extra subtitle
// line only gets in the way until someone asks for it. The last choice is remembered on this device.
const TRANSLATE_KEY = 'eeclass_translate_pair';

export function getTranslatePair(): { from: string; to: string } {
  try {
    const v = JSON.parse(localStorage.getItem(TRANSLATE_KEY) || 'null') as { from?: string; to?: string } | null;
    if (v && typeof v.from === 'string' && typeof v.to === 'string') return { from: v.from, to: v.to };
  } catch { /* ignore */ }
  return { from: 'zh', to: 'zh' };
}

export function setTranslatePair(from: string, to: string): void {
  try { localStorage.setItem(TRANSLATE_KEY, JSON.stringify({ from, to })); } catch { /* ignore */ }
}

/* ---------------- Class material for summaries ---------------- */
// How files from the class file library are folded into a summary: 'manual' asks which files to use
// before generating; 'auto' lets the server match the library on its own.
const MATERIAL_KEY = 'eeclass_material_mode';
export type MaterialMode = 'manual' | 'auto';

export function getMaterialMode(): MaterialMode {
  try { return localStorage.getItem(MATERIAL_KEY) === 'auto' ? 'auto' : 'manual'; } catch { return 'manual'; }
}

export function setMaterialMode(m: MaterialMode): void {
  try { localStorage.setItem(MATERIAL_KEY, m); } catch { /* ignore */ }
}

/* ---------------- Light/dark theme ---------------- */
const THEME_KEY = 'eeclass_theme';
export type Theme = 'light' | 'dark' | 'auto';

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'auto';
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto';
}

function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'auto') {
    return typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return t;
}

/** Write the current (or specified) theme to <html data-theme>. */
export function applyTheme(t: Theme = getTheme()): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme(t));
}

export function setTheme(t: Theme): void {
  if (typeof window !== 'undefined') localStorage.setItem(THEME_KEY, t);
  applyTheme(t);
}

let mqlBound = false;
/** Call on startup: apply the saved theme and, when set to "follow system", listen for system light/dark changes. */
export function initTheme(): void {
  if (typeof window === 'undefined') return;
  applyTheme();
  if (!mqlBound) {
    mqlBound = true;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (getTheme() === 'auto') applyTheme('auto'); };
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else if (mql.addListener) mql.addListener(onChange);
  }
}
