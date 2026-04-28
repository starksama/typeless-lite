import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { APP_BRAND } from './app-config';

type RuntimeStatus = {
  is_recording: boolean;
  is_processing: boolean;
  mic_level: number;
  last_message: string;
};

const pillEl = document.querySelector<HTMLDivElement>('#overlay-pill')!;
const labelEl = document.querySelector<HTMLDivElement>('#overlay-label')!;
const meterBars = Array.from(document.querySelectorAll<HTMLSpanElement>('.overlay-bar'));

document.title = `${APP_BRAND.displayName} Overlay`;

function setMeter(level: number): void {
  const normalized = Math.max(0, Math.min(100, level)) / 100;
  meterBars.forEach((bar, index) => {
    const base = 4 + index * 2;
    const wave = base + normalized * (8 + index * 3);
    bar.style.height = `${Math.round(wave)}px`;
  });
}

function renderOverlay(status: RuntimeStatus): void {
  if (status.is_recording) {
    pillEl.dataset.tone = 'recording';
    pillEl.classList.add('is-visible');
    pillEl.setAttribute('aria-hidden', 'false');
    labelEl.textContent = 'Recording';
    setMeter(status.mic_level || 0);
    return;
  }

  if (status.is_processing) {
    pillEl.dataset.tone = 'processing';
    pillEl.classList.add('is-visible');
    pillEl.setAttribute('aria-hidden', 'false');
    labelEl.textContent = 'Processing';
    return;
  }

  pillEl.dataset.tone = 'idle';
  pillEl.classList.remove('is-visible');
  pillEl.setAttribute('aria-hidden', 'true');
  labelEl.textContent = 'Ready';
}

async function boot(): Promise<void> {
  const status = await invoke<RuntimeStatus>('get_runtime_status');
  renderOverlay(status);
  await listen<RuntimeStatus>('runtime-status', (event) => {
    renderOverlay(event.payload);
  });
}

void boot();
