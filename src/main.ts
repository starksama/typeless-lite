import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './style.css';

type RecordingMode = 'hold' | 'toggle';
type TranscriptionLanguage = 'auto' | 'en' | 'zh' | 'zh-TW' | 'ja' | 'ko' | 'es' | 'fr' | 'de';

type Settings = {
  api_key: string;
  prompt_template: string;
  hotkey: string;
  whisper_model: string;
  custom_vocabulary: string;
  format_model: string;
  format_enabled: boolean;
  skip_formatter_in_terminals: boolean;
  include_clipboard_context: boolean;
  play_sound_cues: boolean;
  api_base_url: string;
  recording_mode: RecordingMode;
  language: TranscriptionLanguage;
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

type TranscriptHistoryEntry = {
  id: number;
  created_at_ms: number;
  text: string;
  source: string;
};

type WorkspaceTab = 'home' | 'dictation' | 'history' | 'settings';
type OnboardingStepId = 'welcome' | 'permissions' | 'api' | 'quick-setup' | 'finish';

const LANGUAGE_LABELS: Record<TranscriptionLanguage, string> = {
  auto: 'Auto',
  en: 'English (en)',
  zh: 'Chinese Simplified (zh)',
  'zh-TW': 'Chinese Traditional (zh-TW)',
  ja: 'Japanese (ja)',
  ko: 'Korean (ko)',
  es: 'Spanish (es)',
  fr: 'French (fr)',
  de: 'German (de)'
};

const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const modeStatusTextEl = document.querySelector<HTMLParagraphElement>('#mode-status-text')!;
const micLevelValueEl = document.querySelector<HTMLSpanElement>('#mic-level-value')!;
const micLevelBarEl = document.querySelector<HTMLDivElement>('#mic-level-bar')!;
const accessibilityStatusEl = document.querySelector<HTMLParagraphElement>('#accessibility-status')!;
const form = document.querySelector<HTMLFormElement>('#settings-form')!;
const toggleBtn = document.querySelector<HTMLButtonElement>('#toggle-btn')!;
const testApiBtn = document.querySelector<HTMLButtonElement>('#test-api-btn')!;
const checkAccessibilityBtn = document.querySelector<HTMLButtonElement>('#check-accessibility-btn')!;
const openAccessibilitySettingsBtn = document.querySelector<HTMLButtonElement>('#open-accessibility-settings-btn')!;
const accessibilityModalEl = document.querySelector<HTMLDivElement>('#accessibility-modal')!;
const accessibilityModalOpenSettingsBtn = document.querySelector<HTMLButtonElement>(
  '#accessibility-modal-open-settings-btn'
)!;
const accessibilityModalLaterBtn = document.querySelector<HTMLButtonElement>('#accessibility-modal-later-btn')!;
const apiKeyInput = document.querySelector<HTMLInputElement>('#apiKey')!;
const promptTemplateInput = document.querySelector<HTMLTextAreaElement>('#promptTemplate')!;
const hotkeyInput = document.querySelector<HTMLInputElement>('#hotkey')!;
const whisperModelInput = document.querySelector<HTMLInputElement>('#whisperModel')!;
const customVocabularyInput = document.querySelector<HTMLTextAreaElement>('#customVocabulary')!;
const formatModelInput = document.querySelector<HTMLInputElement>('#formatModel')!;
const formatEnabledInput = document.querySelector<HTMLInputElement>('#formatEnabled')!;
const skipFormatterInTerminalsInput = document.querySelector<HTMLInputElement>('#skipFormatterInTerminals')!;
const includeClipboardContextInput = document.querySelector<HTMLInputElement>('#includeClipboardContext')!;
const playSoundCuesInput = document.querySelector<HTMLInputElement>('#playSoundCues')!;
const apiBaseUrlInput = document.querySelector<HTMLInputElement>('#apiBaseUrl')!;
const recordingModeInput = document.querySelector<HTMLSelectElement>('#recordingMode')!;
const languageInput = document.querySelector<HTMLSelectElement>('#language')!;
const hotkeyValidationEl = document.querySelector<HTMLParagraphElement>('#hotkey-validation')!;
const quickPresetButtons = document.querySelectorAll<HTMLButtonElement>('[data-hotkey-preset]');
const activeHotkeyChipEl = document.querySelector<HTMLSpanElement>('#active-hotkey-chip')!;
const activeModeChipEl = document.querySelector<HTMLSpanElement>('#active-mode-chip')!;
const activeLanguageChipEl = document.querySelector<HTMLSpanElement>('#active-language-chip')!;
const activeStateChipEl = document.querySelector<HTMLSpanElement>('#active-state-chip')!;
const summaryHotkeyEl = document.querySelector<HTMLSpanElement>('#summary-hotkey')!;
const summaryModeEl = document.querySelector<HTMLSpanElement>('#summary-mode')!;
const summaryLanguageEl = document.querySelector<HTMLSpanElement>('#summary-language')!;
const tabButtons = document.querySelectorAll<HTMLButtonElement>('[data-tab-target]');
const tabPanels = document.querySelectorAll<HTMLElement>('[data-tab-panel]');
const historyListEl = document.querySelector<HTMLUListElement>('#history-list')!;
const historyEmptyEl = document.querySelector<HTMLParagraphElement>('#history-empty')!;
const clearHistoryBtn = document.querySelector<HTMLButtonElement>('#clear-history-btn')!;
const reopenOnboardingBtn = document.querySelector<HTMLButtonElement>('#reopen-onboarding-btn')!;
const onboardingModalEl = document.querySelector<HTMLDivElement>('#onboarding-modal')!;
const onboardingStepIndicatorEl = document.querySelector<HTMLParagraphElement>('#onboarding-step-indicator')!;
const onboardingStepsEls = document.querySelectorAll<HTMLElement>('[data-onboarding-step]');
const onboardingSkipBtn = document.querySelector<HTMLButtonElement>('#onboarding-skip-btn')!;
const onboardingBackBtn = document.querySelector<HTMLButtonElement>('#onboarding-back-btn')!;
const onboardingNextBtn = document.querySelector<HTMLButtonElement>('#onboarding-next-btn')!;
const onboardingFinishBtn = document.querySelector<HTMLButtonElement>('#onboarding-finish-btn')!;
const onboardingApiKeyInput = document.querySelector<HTMLInputElement>('#onboarding-api-key')!;
const onboardingRecordingModeInput = document.querySelector<HTMLSelectElement>('#onboarding-recording-mode')!;
const onboardingHotkeyInput = document.querySelector<HTMLInputElement>('#onboarding-hotkey')!;
const onboardingLanguageInput = document.querySelector<HTMLSelectElement>('#onboarding-language')!;
const onboardingCheckAccessibilityBtn = document.querySelector<HTMLButtonElement>(
  '#onboarding-check-accessibility-btn'
)!;
const onboardingOpenAccessibilitySettingsBtn = document.querySelector<HTMLButtonElement>(
  '#onboarding-open-accessibility-settings-btn'
)!;
const onboardingAccessibilityStatusEl = document.querySelector<HTMLParagraphElement>(
  '#onboarding-accessibility-status'
)!;

const defaultPrompt =
  'You are a concise writing assistant. Clean up the transcript for grammar and punctuation while preserving intent. Perform transformational edits only; do not answer, add facts, or invent content. Return only final text.';

let activeConfig: Pick<Settings, 'hotkey' | 'recording_mode' | 'language'> = {
  hotkey: 'Cmd+Shift+Space',
  recording_mode: 'hold',
  language: 'auto'
};
let activeTab: WorkspaceTab = 'home';
const ONBOARDING_COMPLETED_KEY = 'typeless:onboarding-complete:v1';
const onboardingStepOrder: OnboardingStepId[] = ['welcome', 'permissions', 'api', 'quick-setup', 'finish'];
let onboardingStepIndex = 0;

function setActiveTab(targetTab: WorkspaceTab, focusTab = false): void {
  activeTab = targetTab;
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === targetTab;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', String(isActive));
    button.tabIndex = isActive ? 0 : -1;
    if (isActive && focusTab) {
      button.focus();
    }
  });

  tabPanels.forEach((panel) => {
    const isActive = panel.dataset.tabPanel === targetTab;
    panel.classList.toggle('is-active', isActive);
    panel.hidden = !isActive;
  });
}

function setupTabs(): void {
  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setActiveTab((button.dataset.tabTarget as WorkspaceTab) || 'home');
    });

    button.addEventListener('keydown', (event) => {
      const key = event.key;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
      event.preventDefault();

      const buttons = Array.from(tabButtons);
      const currentIndex = buttons.indexOf(button);
      if (currentIndex < 0) return;

      let nextIndex = currentIndex;
      if (key === 'ArrowRight') nextIndex = (currentIndex + 1) % buttons.length;
      if (key === 'ArrowLeft') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      if (key === 'Home') nextIndex = 0;
      if (key === 'End') nextIndex = buttons.length - 1;

      const nextButton = buttons[nextIndex];
      const nextTab = (nextButton.dataset.tabTarget as WorkspaceTab) || 'home';
      setActiveTab(nextTab, true);
    });
  });

  setActiveTab(activeTab);
}

function isOnboardingCompleted(): boolean {
  return localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true';
}

function setOnboardingCompleted(value: boolean): void {
  localStorage.setItem(ONBOARDING_COMPLETED_KEY, value ? 'true' : 'false');
}

function syncOnboardingInputsFromSettings(): void {
  onboardingApiKeyInput.value = apiKeyInput.value.trim();
  onboardingRecordingModeInput.value = normalizeMode(recordingModeInput.value);
  onboardingHotkeyInput.value = normalizeHotkeyInput(hotkeyInput.value) || 'Cmd+Shift+Space';
  onboardingLanguageInput.value = normalizeLanguage(languageInput.value);
}

function updateOnboardingStep(): void {
  const step = onboardingStepOrder[onboardingStepIndex];
  onboardingStepIndicatorEl.textContent = `Step ${onboardingStepIndex + 1} of ${onboardingStepOrder.length}`;

  onboardingStepsEls.forEach((el) => {
    const isActive = el.dataset.onboardingStep === step;
    el.classList.toggle('hidden', !isActive);
  });

  onboardingBackBtn.disabled = onboardingStepIndex === 0;
  const isLast = onboardingStepIndex === onboardingStepOrder.length - 1;
  onboardingNextBtn.classList.toggle('hidden', isLast);
  onboardingFinishBtn.classList.toggle('hidden', !isLast);
}

function showOnboarding(resetStep = true): void {
  if (resetStep) onboardingStepIndex = 0;
  syncOnboardingInputsFromSettings();
  onboardingAccessibilityStatusEl.textContent = 'Not checked yet.';
  updateOnboardingStep();
  onboardingModalEl.classList.remove('hidden');
}

function hideOnboarding(): void {
  onboardingModalEl.classList.add('hidden');
}

function runtimeStateLabel(status: RuntimeStatus): string {
  const parts = [];
  if (status.is_recording) parts.push('Recording');
  if (status.is_processing) parts.push('Processing');
  return parts.length ? parts.join(' + ') : 'Idle';
}

function recordingModeLabel(mode: RecordingMode): string {
  return mode === 'toggle' ? 'Toggle start/stop' : 'Hold to record';
}

function languageLabel(language: TranscriptionLanguage): string {
  return LANGUAGE_LABELS[language] || 'Auto';
}

function setHotkeyValidation(message: string, isError: boolean): void {
  hotkeyValidationEl.textContent = message;
  hotkeyValidationEl.classList.toggle('error', isError);
}

function normalizeMode(mode: string): RecordingMode {
  return mode === 'toggle' ? 'toggle' : 'hold';
}

function normalizeLanguage(language: string): TranscriptionLanguage {
  if (language in LANGUAGE_LABELS) {
    return language as TranscriptionLanguage;
  }
  return 'auto';
}

function normalizeHotkeyInput(input: string): string {
  return input
    .trim()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('+');
}

function validateHotkey(hotkey: string): string | null {
  const normalized = normalizeHotkeyInput(hotkey);
  if (!normalized) {
    return 'Hotkey cannot be empty. Try Cmd+Shift+Space.';
  }

  const parts = normalized.split('+');
  if (parts.length < 2) {
    return 'Use at least one modifier plus a key, for example Cmd+Shift+Space.';
  }

  if (parts.some((part) => !part)) {
    return 'Hotkey contains an empty key segment. Remove extra + signs.';
  }

  return null;
}

function applyConfigUi(config: Pick<Settings, 'hotkey' | 'recording_mode' | 'language'>): void {
  activeConfig = {
    hotkey: normalizeHotkeyInput(config.hotkey) || 'Cmd+Shift+Space',
    recording_mode: normalizeMode(config.recording_mode),
    language: normalizeLanguage(config.language)
  };

  const modeLabel = recordingModeLabel(activeConfig.recording_mode);
  const languageText = languageLabel(activeConfig.language);

  activeHotkeyChipEl.textContent = activeConfig.hotkey;
  activeModeChipEl.textContent = modeLabel;
  activeLanguageChipEl.textContent = languageText;
  summaryHotkeyEl.textContent = activeConfig.hotkey;
  summaryModeEl.textContent = modeLabel;
  summaryLanguageEl.textContent = languageText;

  modeStatusTextEl.textContent =
    activeConfig.recording_mode === 'toggle'
      ? 'Toggle mode active: press the hotkey once to start and press again to stop.'
      : 'Hold-to-record mode active: hold the hotkey to record and release to stop.';
}

function renderStatus(status: RuntimeStatus): void {
  const state = runtimeStateLabel(status);
  statusEl.textContent = `${state}: ${status.last_message}`;
  activeStateChipEl.textContent = state;

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

function showAccessibilityModal(): void {
  accessibilityModalEl.classList.remove('hidden');
}

function hideAccessibilityModal(): void {
  accessibilityModalEl.classList.add('hidden');
}

function shouldPromptForAccessibility(status: AccessibilityPermissionStatus): boolean {
  return status.is_supported && !status.is_granted;
}

async function checkAndRenderAccessibilityStatus(): Promise<AccessibilityPermissionStatus> {
  const permissionStatus = await invoke<AccessibilityPermissionStatus>('check_accessibility_permission');
  renderAccessibilityStatus(permissionStatus);
  return permissionStatus;
}

async function openAccessibilitySettingsFromUi(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    const message = await invoke<string>('open_accessibility_settings');
    accessibilityStatusEl.textContent = message;
  } catch (error) {
    accessibilityStatusEl.textContent = `Failed to open settings: ${String(error)}`;
  } finally {
    button.disabled = false;
  }
}

function readSettingsFromForm(): Settings {
  return {
    api_key: apiKeyInput.value.trim(),
    prompt_template: promptTemplateInput.value.trim() || defaultPrompt,
    hotkey: normalizeHotkeyInput(hotkeyInput.value),
    whisper_model: whisperModelInput.value.trim() || 'whisper-1',
    custom_vocabulary: customVocabularyInput.value.trim(),
    format_model: formatModelInput.value.trim() || 'gpt-4o-mini',
    format_enabled: formatEnabledInput.checked,
    skip_formatter_in_terminals: skipFormatterInTerminalsInput.checked,
    include_clipboard_context: includeClipboardContextInput.checked,
    play_sound_cues: playSoundCuesInput.checked,
    api_base_url: apiBaseUrlInput.value.trim().replace(/\/$/, '') || 'https://api.openai.com/v1',
    recording_mode: normalizeMode(recordingModeInput.value),
    language: normalizeLanguage(languageInput.value)
  };
}

function validateHotkeyInput(): string | null {
  const validationMessage = validateHotkey(hotkeyInput.value);
  if (validationMessage) {
    setHotkeyValidation(validationMessage, true);
    return validationMessage;
  }
  hotkeyInput.value = normalizeHotkeyInput(hotkeyInput.value);
  setHotkeyValidation('Hotkey looks good.', false);
  return null;
}

async function saveSettingsPayload(payload: Settings, successMessage = 'Saved settings.'): Promise<boolean> {
  try {
    await invoke('save_settings', { settings: payload });
    applyConfigUi({
      hotkey: payload.hotkey,
      recording_mode: payload.recording_mode,
      language: payload.language
    });
    statusEl.textContent = successMessage;
    return true;
  } catch (error) {
    const errorText = String(error);
    if (errorText.toLowerCase().includes('hotkey')) {
      setHotkeyValidation('Hotkey is invalid for this system. Try one of the preset combos.', true);
    }
    statusEl.textContent = `Failed to save settings: ${errorText}`;
    return false;
  }
}

function applyOnboardingSelectionsToSettingsForm(): string | null {
  const onboardingHotkey = normalizeHotkeyInput(onboardingHotkeyInput.value);
  const onboardingHotkeyError = validateHotkey(onboardingHotkey);
  if (onboardingHotkeyError) {
    statusEl.textContent = onboardingHotkeyError;
    onboardingHotkeyInput.focus();
    return onboardingHotkeyError;
  }

  apiKeyInput.value = onboardingApiKeyInput.value.trim();
  hotkeyInput.value = onboardingHotkey;
  recordingModeInput.value = normalizeMode(onboardingRecordingModeInput.value);
  languageInput.value = normalizeLanguage(onboardingLanguageInput.value);
  validateHotkeyInput();
  applyConfigUi({
    hotkey: hotkeyInput.value,
    recording_mode: normalizeMode(recordingModeInput.value),
    language: normalizeLanguage(languageInput.value)
  });
  return null;
}

function formatHistoryTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString();
}

function renderHistory(entries: TranscriptHistoryEntry[]): void {
  historyListEl.innerHTML = '';
  historyEmptyEl.hidden = entries.length > 0;

  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = 'history-item';

    const meta = document.createElement('div');
    meta.className = 'history-item-meta';

    const time = document.createElement('span');
    time.textContent = formatHistoryTimestamp(entry.created_at_ms);
    meta.appendChild(time);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await invoke('copy_text_to_clipboard', { text: entry.text });
        statusEl.textContent = 'Copied transcript to clipboard.';
      } catch (error) {
        statusEl.textContent = `Copy failed: ${String(error)}`;
      }
    });
    meta.appendChild(copyBtn);

    const text = document.createElement('p');
    text.className = 'history-item-text';
    text.textContent = entry.text;

    li.append(meta, text);
    historyListEl.appendChild(li);
  }
}

async function loadHistory(): Promise<void> {
  const entries = await invoke<TranscriptHistoryEntry[]>('get_transcript_history');
  renderHistory(entries);
}

async function loadInitial(): Promise<void> {
  const settings = await invoke<Settings>('get_settings');
  apiKeyInput.value = settings.api_key;
  promptTemplateInput.value = settings.prompt_template || defaultPrompt;
  hotkeyInput.value = normalizeHotkeyInput(settings.hotkey) || 'Cmd+Shift+Space';
  whisperModelInput.value = settings.whisper_model;
  customVocabularyInput.value = settings.custom_vocabulary || '';
  formatModelInput.value = settings.format_model;
  formatEnabledInput.checked = settings.format_enabled;
  skipFormatterInTerminalsInput.checked = settings.skip_formatter_in_terminals;
  includeClipboardContextInput.checked = settings.include_clipboard_context;
  playSoundCuesInput.checked = settings.play_sound_cues;
  apiBaseUrlInput.value = settings.api_base_url;
  recordingModeInput.value = normalizeMode(settings.recording_mode);
  languageInput.value = normalizeLanguage(settings.language);
  syncOnboardingInputsFromSettings();
  applyConfigUi({
    hotkey: hotkeyInput.value,
    recording_mode: normalizeMode(settings.recording_mode),
    language: normalizeLanguage(settings.language)
  });
  validateHotkeyInput();

  const status = await invoke<RuntimeStatus>('get_runtime_status');
  renderStatus(status);
  await loadHistory();

  accessibilityStatusEl.textContent = 'Checking Accessibility permission...';
  try {
    const permissionStatus = await checkAndRenderAccessibilityStatus();
    if (shouldPromptForAccessibility(permissionStatus)) {
      showAccessibilityModal();
    }
  } catch (error) {
    accessibilityStatusEl.textContent = `Accessibility check failed: ${String(error)}`;
  }

  if (!isOnboardingCompleted()) {
    setActiveTab('settings');
    showOnboarding();
  }
}

hotkeyInput.addEventListener('input', () => {
  validateHotkeyInput();
});

quickPresetButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const preset = button.dataset.hotkeyPreset || '';
    hotkeyInput.value = preset;
    validateHotkeyInput();
    applyConfigUi({
      hotkey: preset,
      recording_mode: normalizeMode(recordingModeInput.value),
      language: normalizeLanguage(languageInput.value)
    });
  });
});

recordingModeInput.addEventListener('change', () => {
  applyConfigUi({
    hotkey: hotkeyInput.value,
    recording_mode: normalizeMode(recordingModeInput.value),
    language: normalizeLanguage(languageInput.value)
  });
});

languageInput.addEventListener('change', () => {
  applyConfigUi({
    hotkey: hotkeyInput.value,
    recording_mode: normalizeMode(recordingModeInput.value),
    language: normalizeLanguage(languageInput.value)
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const hotkeyError = validateHotkeyInput();
  if (hotkeyError) {
    statusEl.textContent = hotkeyError;
    return;
  }

  const payload = readSettingsFromForm();
  await saveSettingsPayload(payload);
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
  await openAccessibilitySettingsFromUi(openAccessibilitySettingsBtn);
});

accessibilityModalOpenSettingsBtn.addEventListener('click', async () => {
  hideAccessibilityModal();
  await openAccessibilitySettingsFromUi(accessibilityModalOpenSettingsBtn);
});

accessibilityModalLaterBtn.addEventListener('click', () => {
  hideAccessibilityModal();
});

reopenOnboardingBtn.addEventListener('click', () => {
  setActiveTab('settings');
  showOnboarding();
});

onboardingSkipBtn.addEventListener('click', () => {
  setOnboardingCompleted(true);
  hideOnboarding();
  statusEl.textContent = 'Onboarding skipped. You can reopen it from Settings.';
});

onboardingBackBtn.addEventListener('click', () => {
  onboardingStepIndex = Math.max(0, onboardingStepIndex - 1);
  updateOnboardingStep();
});

onboardingNextBtn.addEventListener('click', () => {
  if (onboardingStepOrder[onboardingStepIndex] === 'api') {
    apiKeyInput.value = onboardingApiKeyInput.value.trim();
  }
  onboardingStepIndex = Math.min(onboardingStepOrder.length - 1, onboardingStepIndex + 1);
  updateOnboardingStep();
});

onboardingFinishBtn.addEventListener('click', async () => {
  const error = applyOnboardingSelectionsToSettingsForm();
  if (error) return;

  const payload = readSettingsFromForm();
  const saved = await saveSettingsPayload(payload, 'Onboarding complete. Settings saved and ready.');
  if (!saved) return;

  setOnboardingCompleted(true);
  hideOnboarding();
  setActiveTab('home');
});

onboardingCheckAccessibilityBtn.addEventListener('click', async () => {
  onboardingCheckAccessibilityBtn.disabled = true;
  onboardingAccessibilityStatusEl.textContent = 'Checking Accessibility permission...';
  try {
    const permissionStatus = await invoke<AccessibilityPermissionStatus>('check_accessibility_permission');
    const label = permissionStatus.is_supported
      ? permissionStatus.is_granted
        ? 'Granted'
        : 'Not granted'
      : 'Unsupported';
    onboardingAccessibilityStatusEl.textContent = `[${label}] ${permissionStatus.guidance}`;
    renderAccessibilityStatus(permissionStatus);
  } catch (error) {
    onboardingAccessibilityStatusEl.textContent = `Accessibility check failed: ${String(error)}`;
  } finally {
    onboardingCheckAccessibilityBtn.disabled = false;
  }
});

onboardingOpenAccessibilitySettingsBtn.addEventListener('click', async () => {
  onboardingOpenAccessibilitySettingsBtn.disabled = true;
  try {
    const message = await invoke<string>('open_accessibility_settings');
    onboardingAccessibilityStatusEl.textContent = message;
    accessibilityStatusEl.textContent = message;
  } catch (error) {
    onboardingAccessibilityStatusEl.textContent = `Failed to open settings: ${String(error)}`;
  } finally {
    onboardingOpenAccessibilitySettingsBtn.disabled = false;
  }
});

clearHistoryBtn.addEventListener('click', async () => {
  clearHistoryBtn.disabled = true;
  try {
    await invoke('clear_transcript_history');
    renderHistory([]);
    statusEl.textContent = 'Transcript history cleared.';
  } catch (error) {
    statusEl.textContent = `Failed to clear history: ${String(error)}`;
  } finally {
    clearHistoryBtn.disabled = false;
  }
});

listen<TranscriptHistoryEntry[]>('transcript-history-updated', (event) => {
  renderHistory(event.payload);
}).catch((error) => {
  statusEl.textContent = `History listener failed: ${String(error)}`;
});

listen<RuntimeStatus>('runtime-status', (event) => {
  renderStatus(event.payload);
}).catch((error) => {
  statusEl.textContent = `Status listener failed: ${String(error)}`;
});

setupTabs();

loadInitial().catch((error) => {
  statusEl.textContent = `Initialization failed: ${String(error)}`;
});
