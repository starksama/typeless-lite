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
type OverlayTone = 'idle' | 'recording' | 'processing';

const pillEl = document.querySelector<HTMLDivElement>('#overlay-pill')!;
const labelEl = document.querySelector<HTMLDivElement>('#overlay-label')!;
const meterBars = Array.from(document.querySelectorAll<HTMLSpanElement>('.overlay-bar'));
const themeModeKey = `${APP_BRAND.storagePrefix}:theme-mode:v1`;
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: light)');
let currentTone: OverlayTone | null = null;

document.title = `${APP_BRAND.displayName} Overlay`;

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readThemePreference(): ThemePreference {
  const stored = localStorage.getItem(themeModeKey);
  return isThemePreference(stored) ? stored : 'system';
}

function applyOverlayTheme(): void {
  const preference = readThemePreference();
  const resolvedTheme =
    preference === 'system' ? (systemThemeQuery.matches ? 'light' : 'dark') : preference;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
}

function setMeter(level: number): void {
  const normalized = Math.max(0, Math.min(100, level)) / 100;
  meterBars.forEach((bar, index) => {
    const base = 4 + index * 2;
    const wave = base + normalized * (8 + index * 3);
    bar.style.height = `${Math.round(wave)}px`;
  });
}

function setOverlayTone(tone: OverlayTone): void {
  if (currentTone === tone) return;
  currentTone = tone;
  pillEl.dataset.tone = tone;
  pillEl.classList.toggle('is-visible', tone !== 'idle');
  pillEl.setAttribute('aria-hidden', tone === 'idle' ? 'true' : 'false');
  labelEl.textContent = tone === 'recording' ? 'Recording' : tone === 'processing' ? 'Processing' : 'Ready';
}

function renderOverlay(status: RuntimeStatus): void {
  if (status.is_recording) {
    setOverlayTone('recording');
    setMeter(status.mic_level || 0);
    return;
  }
  if (status.is_processing) {
    setOverlayTone('processing');
    return;
  }
  setOverlayTone('idle');
}

async function boot(): Promise<void> {
  applyOverlayTheme();
  systemThemeQuery.addEventListener('change', applyOverlayTheme);
  window.addEventListener('storage', (event) => {
    if (event.key === themeModeKey) {
      applyOverlayTheme();
    }
  });
  const status = await invoke<RuntimeStatus>('get_runtime_status');
  renderOverlay(status);
  await listen<RuntimeStatus>('runtime-status', (event) => {
    renderOverlay(event.payload);
  });
}

void boot();
