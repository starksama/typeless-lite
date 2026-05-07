import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { APP_BRAND } from './app-config';

type RuntimeStatus = {
  is_recording: boolean;
  is_processing: boolean;
  mic_level: number;
  last_message: string;
};

type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';
type ThemeSyncPayload = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
};
type OverlayTone = 'idle' | 'recording' | 'processing';

const pillEl = document.querySelector<HTMLDivElement>('#overlay-pill')!;
const meterDots = Array.from(document.querySelectorAll<HTMLSpanElement>('.overlay-dot'));
const themeModeKey = `${APP_BRAND.storagePrefix}:theme-mode:v1`;
const themeSyncEvent = 'theme-preference-changed';
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: light)');
let currentTone: OverlayTone | null = null;
let visualLevel = 0;

document.title = `${APP_BRAND.displayName} Overlay`;

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readThemePreference(): ThemePreference {
  const stored = localStorage.getItem(themeModeKey);
  return isThemePreference(stored) ? stored : 'light';
}

function applyResolvedOverlayTheme(resolvedTheme: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
}

function applyOverlayTheme(preference = readThemePreference()): void {
  const resolvedTheme =
    preference === 'system' ? (systemThemeQuery.matches ? 'light' : 'dark') : preference;
  applyResolvedOverlayTheme(resolvedTheme);
}

function setMeter(level: number): void {
  const normalized = Math.sqrt(Math.max(0, Math.min(100, level)) / 100);
  visualLevel += (normalized - visualLevel) * 0.52;
  if (visualLevel < 0.025 && normalized < 0.025) {
    visualLevel = 0;
  }
  pillEl.style.setProperty('--overlay-level', visualLevel.toFixed(3));
  pillEl.classList.toggle('has-speech', visualLevel > 0.09);
  const shape = [0.25, 0.55, 0.86, 1, 0.82, 0.5, 0.28];
  meterDots.forEach((dot, index) => {
    const gain = shape[index % shape.length];
    const lift = Math.round(visualLevel * gain * 7);
    const scale = 0.78 + visualLevel * gain * 0.78;
    dot.style.opacity = `${0.38 + visualLevel * (0.42 + gain * 0.2)}`;
    dot.style.transform = `translate3d(0, ${-lift}px, 0) scale(${scale.toFixed(2)})`;
  });
}

function setOverlayTone(tone: OverlayTone): void {
  if (currentTone === tone) return;
  currentTone = tone;
  pillEl.dataset.tone = tone;
  pillEl.classList.toggle('is-visible', tone !== 'idle');
  pillEl.setAttribute('aria-hidden', tone === 'idle' ? 'true' : 'false');
  pillEl.setAttribute(
    'aria-label',
    tone === 'recording' ? 'Recording' : tone === 'processing' ? 'Processing' : 'Ready'
  );
}

function renderOverlay(status: RuntimeStatus): void {
  if (status.is_recording) {
    setOverlayTone('recording');
    setMeter(status.mic_level || 0);
    return;
  }
  if (status.is_processing) {
    setOverlayTone('processing');
    setMeter(0);
    return;
  }
  setMeter(0);
  setOverlayTone('idle');
}

async function boot(): Promise<void> {
  applyOverlayTheme();
  systemThemeQuery.addEventListener('change', () => applyOverlayTheme());
  window.addEventListener('storage', (event) => {
    if (event.key === themeModeKey) {
      applyOverlayTheme();
    }
  });
  const status = await invoke<RuntimeStatus>('get_runtime_status');
  renderOverlay(status);
  await listen<ThemeSyncPayload>(themeSyncEvent, (event) => {
    applyResolvedOverlayTheme(event.payload.resolvedTheme);
  });
  await listen<RuntimeStatus>('runtime-status', (event) => {
    renderOverlay(event.payload);
  });
}

void boot();
