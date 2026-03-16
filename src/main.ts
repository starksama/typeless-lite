import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './style.css';

type Settings = {
  api_key: string;
  prompt_template: string;
  hotkey: string;
  whisper_model: string;
  format_model: string;
  format_enabled: boolean;
  include_clipboard_context: boolean;
  play_sound_cues: boolean;
  api_base_url: string;
};

type RuntimeStatus = {
  is_recording: boolean;
  is_processing: boolean;
  mic_level: number;
  last_message: string;
};

type AccessibilityPermissionStatus = {
  platform: string;
  is_supported: boolean;
  is_granted: boolean;
  status: string;
  guidance: string;
};

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const micLevelValueEl = document.querySelector<HTMLSpanElement>('#mic-level-value')!;
const micLevelBarEl = document.querySelector<HTMLDivElement>('#mic-level-bar')!;
const accessibilityStatusEl = document.querySelector<HTMLParagraphElement>('#accessibility-status')!;
const form = document.querySelector<HTMLFormElement>('#settings-form')!;
const toggleBtn = document.querySelector<HTMLButtonElement>('#toggle-btn')!;
const testApiBtn = document.querySelector<HTMLButtonElement>('#test-api-btn')!;
const checkAccessibilityBtn = document.querySelector<HTMLButtonElement>('#check-accessibility-btn')!;
const openAccessibilitySettingsBtn = document.querySelector<HTMLButtonElement>('#open-accessibility-settings-btn')!;
const apiKeyInput = document.querySelector<HTMLInputElement>('#apiKey')!;
const promptTemplateInput = document.querySelector<HTMLTextAreaElement>('#promptTemplate')!;
const hotkeyInput = document.querySelector<HTMLInputElement>('#hotkey')!;
const whisperModelInput = document.querySelector<HTMLInputElement>('#whisperModel')!;
const formatModelInput = document.querySelector<HTMLInputElement>('#formatModel')!;
const formatEnabledInput = document.querySelector<HTMLInputElement>('#formatEnabled')!;
const includeClipboardContextInput = document.querySelector<HTMLInputElement>('#includeClipboardContext')!;
const playSoundCuesInput = document.querySelector<HTMLInputElement>('#playSoundCues')!;
const apiBaseUrlInput = document.querySelector<HTMLInputElement>('#apiBaseUrl')!;

const defaultPrompt =
  'You are a concise writing assistant. Clean up the transcript for grammar and punctuation while preserving intent. Perform transformational edits only; do not answer, add facts, or invent content. Return only final text.';

function renderStatus(status: RuntimeStatus): void {
  const parts = [];
  if (status.is_recording) parts.push('Recording');
  if (status.is_processing) parts.push('Processing');
  const state = parts.length ? parts.join(' + ') : 'Idle';
  statusEl.textContent = `${state}: ${status.last_message}`;

  const level = Math.max(0, Math.min(100, Math.round(status.mic_level || 0)));
  micLevelValueEl.textContent = status.is_recording ? `${level}%` : '0%';
  micLevelBarEl.style.width = `${status.is_recording ? level : 0}%`;
}

function renderAccessibilityStatus(status: AccessibilityPermissionStatus): void {
  const label = status.is_supported
    ? status.is_granted
      ? 'Granted'
      : 'Not granted'
    : 'Unsupported';
  accessibilityStatusEl.textContent = `[${label}] ${status.guidance}`;
}

async function checkAndRenderAccessibilityStatus(): Promise<void> {
  const permissionStatus = await invoke<AccessibilityPermissionStatus>('check_accessibility_permission');
  renderAccessibilityStatus(permissionStatus);
}

async function loadInitial(): Promise<void> {
  const settings = await invoke<Settings>('get_settings');
  apiKeyInput.value = settings.api_key;
  promptTemplateInput.value = settings.prompt_template || defaultPrompt;
  hotkeyInput.value = settings.hotkey;
  whisperModelInput.value = settings.whisper_model;
  formatModelInput.value = settings.format_model;
  formatEnabledInput.checked = settings.format_enabled;
  includeClipboardContextInput.checked = settings.include_clipboard_context;
  playSoundCuesInput.checked = settings.play_sound_cues;
  apiBaseUrlInput.value = settings.api_base_url;

  const status = await invoke<RuntimeStatus>('get_runtime_status');
  renderStatus(status);

  accessibilityStatusEl.textContent = 'Checking Accessibility permission...';
  try {
    await checkAndRenderAccessibilityStatus();
  } catch (error) {
    accessibilityStatusEl.textContent = `Accessibility check failed: ${String(error)}`;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload: Settings = {
    api_key: apiKeyInput.value.trim(),
    prompt_template: promptTemplateInput.value.trim() || defaultPrompt,
    hotkey: hotkeyInput.value.trim(),
    whisper_model: whisperModelInput.value.trim() || 'whisper-1',
    format_model: formatModelInput.value.trim() || 'gpt-4o-mini',
    format_enabled: formatEnabledInput.checked,
    include_clipboard_context: includeClipboardContextInput.checked,
    play_sound_cues: playSoundCuesInput.checked,
    api_base_url: apiBaseUrlInput.value.trim().replace(/\/$/, '') || 'https://api.openai.com/v1'
  };

  try {
    await invoke('save_settings', { settings: payload });
    statusEl.textContent = 'Saved settings.';
  } catch (error) {
    statusEl.textContent = `Failed to save settings: ${String(error)}`;
  }
});

toggleBtn.addEventListener('click', async () => {
  try {
    await invoke('toggle_recording');
  } catch (error) {
    statusEl.textContent = `Toggle failed: ${String(error)}`;
  }
});

testApiBtn.addEventListener('click', async () => {
  testApiBtn.disabled = true;
  statusEl.textContent = 'Testing API connection...';
  try {
    const result = await invoke<string>('test_api_connection');
    statusEl.textContent = result;
  } catch (error) {
    statusEl.textContent = String(error);
  } finally {
    testApiBtn.disabled = false;
  }
});

checkAccessibilityBtn.addEventListener('click', async () => {
  checkAccessibilityBtn.disabled = true;
  accessibilityStatusEl.textContent = 'Checking Accessibility permission...';
  try {
    await checkAndRenderAccessibilityStatus();
  } catch (error) {
    accessibilityStatusEl.textContent = `Accessibility check failed: ${String(error)}`;
  } finally {
    checkAccessibilityBtn.disabled = false;
  }
});

openAccessibilitySettingsBtn.addEventListener('click', async () => {
  openAccessibilitySettingsBtn.disabled = true;
  try {
    const message = await invoke<string>('open_accessibility_settings');
    accessibilityStatusEl.textContent = message;
  } catch (error) {
    accessibilityStatusEl.textContent = `Failed to open settings: ${String(error)}`;
  } finally {
    openAccessibilitySettingsBtn.disabled = false;
  }
});

listen<RuntimeStatus>('runtime-status', (event) => {
  renderStatus(event.payload);
}).catch((error) => {
  statusEl.textContent = `Status listener failed: ${String(error)}`;
});

loadInitial().catch((error) => {
  statusEl.textContent = `Initialization failed: ${String(error)}`;
});
