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
  final_output: string;
  recording_mode: RecordingMode;
  language: TranscriptionLanguage;
  source_app?: string | null;
  source: string;
  processing_latency_ms?: number | null;
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

const MODIFIER_ALIAS_TO_CANONICAL: Record<string, string> = {
  cmd: 'Cmd',
  command: 'Cmd',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  option: 'Alt',
  opt: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
  super: 'Super',
  win: 'Super',
  windows: 'Super',
  meta: 'Meta',
  fn: 'Fn',
  function: 'Fn'
};

const NON_MODIFIER_ALIAS_TO_CANONICAL: Record<string, string> = {
  spacebar: 'Space',
  esc: 'Escape',
  return: 'Enter'
};

const KNOWN_MODIFIERS = new Set(Object.values(MODIFIER_ALIAS_TO_CANONICAL));

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
const homeToggleBtn = document.querySelector<HTMLButtonElement>('#home-toggle-btn')!;
const homeCopyLastBtn = document.querySelector<HTMLButtonElement>('#home-copy-last-btn')!;
const homeOpenLastBtn = document.querySelector<HTMLButtonElement>('#home-open-last-btn')!;
const shortcutPrimaryHintEl = document.querySelector<HTMLSpanElement>('#shortcut-primary-hint')!;
const shortcutModeHintEl = document.querySelector<HTMLSpanElement>('#shortcut-mode-hint')!;
const homeLastOutputPreviewEl = document.querySelector<HTMLPreElement>('#home-last-output-preview')!;
const homeLastOutputMetaEl = document.querySelector<HTMLParagraphElement>('#home-last-output-meta')!;
const tabButtons = document.querySelectorAll<HTMLButtonElement>('[data-tab-target]');
const tabPanels = document.querySelectorAll<HTMLElement>('[data-tab-panel]');
const historyListEl = document.querySelector<HTMLUListElement>('#history-list')!;
const historyEmptyEl = document.querySelector<HTMLParagraphElement>('#history-empty')!;
const historySearchInput = document.querySelector<HTMLInputElement>('#history-search')!;
const historyFilterModeInput = document.querySelector<HTMLSelectElement>('#history-filter-mode')!;
const historyFilterLanguageInput = document.querySelector<HTMLSelectElement>('#history-filter-language')!;
const historyFilterDateInput = document.querySelector<HTMLSelectElement>('#history-filter-date')!;
const historyClearBtn = document.querySelector<HTMLButtonElement>('#history-clear-btn')!;
const historySummaryCountEl = document.querySelector<HTMLElement>('#history-summary-count')!;
const historySummaryMedianEl = document.querySelector<HTMLElement>('#history-summary-median')!;
const historySummarySlowEl = document.querySelector<HTMLElement>('#history-summary-slow')!;
const historyDetailMetaEl = document.querySelector<HTMLParagraphElement>('#history-detail-meta')!;
const historyDetailTextEl = document.querySelector<HTMLPreElement>('#history-detail-text')!;
const historyCopyBtn = document.querySelector<HTMLButtonElement>('#history-copy-btn')!;
const historyReuseBtn = document.querySelector<HTMLButtonElement>('#history-reuse-btn')!;
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
let historyEntries: TranscriptHistoryEntry[] = [];
let historySelectedEntryId: number | null = null;

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
  const normalizedParts = input
    .trim()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const compactPart = part.replace(/\s+/g, '');
      const aliasKey = compactPart.toLowerCase();
      const normalizedModifier = MODIFIER_ALIAS_TO_CANONICAL[aliasKey];
      if (normalizedModifier) {
        return normalizedModifier;
      }
      const normalizedNonModifier = NON_MODIFIER_ALIAS_TO_CANONICAL[aliasKey];
      if (normalizedNonModifier) {
        return normalizedNonModifier;
      }
      if (compactPart.length === 1) {
        return compactPart.toUpperCase();
      }
      return compactPart;
    });

  const modifierParts = normalizedParts.filter((part) => KNOWN_MODIFIERS.has(part));
  const nonModifierParts = normalizedParts.filter((part) => !KNOWN_MODIFIERS.has(part));
  return [...modifierParts, ...nonModifierParts].join('+');
}

function validateHotkey(hotkey: string): string | null {
  const trimmed = hotkey.trim();
  if (!trimmed) {
    return 'Hotkey cannot be empty. Try Cmd+Shift+Space.';
  }

  const rawParts = trimmed.split('+').map((part) => part.trim());
  if (rawParts.some((part) => !part)) {
    return 'Hotkey contains an empty key segment. Remove extra + signs.';
  }

  const normalized = normalizeHotkeyInput(trimmed);
  const parts = normalized.split('+').filter(Boolean);
  const modifiers = parts.filter((part) => KNOWN_MODIFIERS.has(part));
  const nonModifiers = parts.filter((part) => !KNOWN_MODIFIERS.has(part));

  if (modifiers.length === 0) {
    return 'Use at least one modifier (Cmd/Ctrl/Alt/Shift) plus one key.';
  }

  const duplicateModifier = modifiers.find((modifier, index) => modifiers.indexOf(modifier) !== index);
  if (duplicateModifier) {
    return `Duplicate modifier "${duplicateModifier}". Use each modifier once.`;
  }

  if (nonModifiers.length === 0) {
    return 'Hotkey needs one non-modifier key (for example Space).';
  }

  if (nonModifiers.length > 1) {
    return 'Use exactly one non-modifier key.';
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
  shortcutPrimaryHintEl.textContent = activeConfig.hotkey;
  shortcutModeHintEl.textContent = modeLabel;

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

function formatLatency(latencyMs?: number | null): string {
  if (latencyMs == null || latencyMs < 0) return 'n/a';
  return `${Math.round(latencyMs)}ms`;
}

function formatPercentage(value: number): string {
  return `${Math.round(value)}%`;
}

function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function getLatestHistoryEntry(): TranscriptHistoryEntry | null {
  if (historyEntries.length === 0) return null;
  return [...historyEntries].sort((a, b) => b.created_at_ms - a.created_at_ms)[0];
}

function refreshHomeLastOutputPreview(): void {
  const latestEntry = getLatestHistoryEntry();
  const hasEntry = Boolean(latestEntry);
  homeCopyLastBtn.disabled = !hasEntry;
  homeOpenLastBtn.disabled = !hasEntry;
  if (!latestEntry) {
    homeLastOutputPreviewEl.textContent = 'No recent transcript yet.';
    homeLastOutputMetaEl.textContent = 'No history metadata yet.';
    return;
  }

  const preview = latestEntry.final_output.trim();
  homeLastOutputPreviewEl.textContent =
    preview.length > 280 ? `${preview.slice(0, 280).trimEnd()}...` : preview;
  homeLastOutputMetaEl.textContent = `${formatHistoryTimestamp(latestEntry.created_at_ms)} | ${
    latestEntry.source_app || 'Unknown app'
  } | ${formatLatency(latestEntry.processing_latency_ms)}`;
}

function historyDateFilterMatch(entry: TranscriptHistoryEntry, filter: string): boolean {
  if (filter === 'all') return true;
  const now = Date.now();
  const ageMs = now - entry.created_at_ms;
  if (filter === 'today') {
    const today = new Date();
    const entryDate = new Date(entry.created_at_ms);
    return (
      today.getFullYear() === entryDate.getFullYear() &&
      today.getMonth() === entryDate.getMonth() &&
      today.getDate() === entryDate.getDate()
    );
  }
  if (filter === '7d') return ageMs <= 7 * 24 * 60 * 60 * 1000;
  if (filter === '30d') return ageMs <= 30 * 24 * 60 * 60 * 1000;
  return true;
}

function getFilteredHistoryEntries(): TranscriptHistoryEntry[] {
  const search = historySearchInput.value.trim().toLowerCase();
  const modeFilter = historyFilterModeInput.value;
  const languageFilter = historyFilterLanguageInput.value;
  const dateFilter = historyFilterDateInput.value;

  return historyEntries.filter((entry) => {
    const matchesMode = modeFilter === 'all' || entry.recording_mode === modeFilter;
    const matchesLanguage = languageFilter === 'all' || entry.language === languageFilter;
    const matchesDate = historyDateFilterMatch(entry, dateFilter);
    if (!matchesMode || !matchesLanguage || !matchesDate) return false;
    if (!search) return true;

    const searchable = `${entry.final_output} ${entry.language} ${entry.recording_mode} ${
      entry.source_app || ''
    } ${entry.source}`.toLowerCase();
    return searchable.includes(search);
  });
}

function renderHistoryDetail(entry: TranscriptHistoryEntry | null): void {
  const hasEntry = Boolean(entry);
  historyCopyBtn.disabled = !hasEntry;
  historyReuseBtn.disabled = !hasEntry;

  if (!entry) {
    historyDetailMetaEl.textContent = 'Select an entry from the list.';
    historyDetailTextEl.textContent = 'No transcript selected.';
    return;
  }

  const sourceApp = entry.source_app?.trim() ? entry.source_app : 'Unknown app';
  historyDetailMetaEl.textContent = `${formatHistoryTimestamp(entry.created_at_ms)} | ${recordingModeLabel(
    entry.recording_mode
  )} | ${languageLabel(entry.language)} | ${sourceApp} | ${formatLatency(entry.processing_latency_ms)}`;
  historyDetailTextEl.textContent = entry.final_output;
}

function renderHistoryPerformanceSummary(entries: TranscriptHistoryEntry[]): void {
  historySummaryCountEl.textContent = String(entries.length);

  const latencies = entries
    .map((entry) => entry.processing_latency_ms)
    .filter((latencyMs): latencyMs is number => latencyMs != null && latencyMs >= 0);
  const medianLatency = computeMedian(latencies);
  historySummaryMedianEl.textContent = formatLatency(medianLatency);

  const slowRuns = entries.filter((entry) => (entry.processing_latency_ms ?? -1) >= 4000).length;
  const slowPercentage = entries.length === 0 ? 0 : (slowRuns / entries.length) * 100;
  historySummarySlowEl.textContent = formatPercentage(slowPercentage);
}

function renderHistory(entries: TranscriptHistoryEntry[]): void {
  historyEntries = [...entries].sort((a, b) => b.created_at_ms - a.created_at_ms);
  const filteredEntries = getFilteredHistoryEntries();
  renderHistoryPerformanceSummary(filteredEntries);

  if (historySelectedEntryId && !filteredEntries.some((entry) => entry.id === historySelectedEntryId)) {
    historySelectedEntryId = null;
  }

  historyListEl.innerHTML = '';
  historyEmptyEl.hidden = filteredEntries.length > 0;

  for (const entry of filteredEntries) {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `History entry from ${formatHistoryTimestamp(entry.created_at_ms)}`);
    if (entry.id === historySelectedEntryId) {
      li.classList.add('is-active');
    }

    const meta = document.createElement('div');
    meta.className = 'history-item-meta';

    const time = document.createElement('span');
    time.textContent = formatHistoryTimestamp(entry.created_at_ms);
    meta.appendChild(time);

    const info = document.createElement('span');
    info.textContent = `${recordingModeLabel(entry.recording_mode)} | ${languageLabel(entry.language)} | ${
      entry.source_app || 'Unknown app'
    } | ${formatLatency(entry.processing_latency_ms)}`;
    meta.appendChild(info);

    const text = document.createElement('p');
    text.className = 'history-item-text';
    text.textContent = entry.final_output;

    li.append(meta, text);
    li.addEventListener('click', () => {
      historySelectedEntryId = entry.id;
      renderHistory(historyEntries);
    });
    li.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      historySelectedEntryId = entry.id;
      renderHistory(historyEntries);
    });
    historyListEl.appendChild(li);
  }

  const selectedEntry = filteredEntries.find((entry) => entry.id === historySelectedEntryId) || null;
  renderHistoryDetail(selectedEntry);
  refreshHomeLastOutputPreview();
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

homeToggleBtn.addEventListener('click', async () => {
  try {
    await invoke('toggle_recording');
  } catch (error) {
    statusEl.textContent = `Toggle failed: ${String(error)}`;
  }
});

homeCopyLastBtn.addEventListener('click', async () => {
  const latestEntry = getLatestHistoryEntry();
  if (!latestEntry) return;
  homeCopyLastBtn.disabled = true;
  try {
    await invoke('copy_text_to_clipboard', { text: latestEntry.final_output });
    statusEl.textContent = 'Copied last transcript to clipboard.';
  } catch (error) {
    statusEl.textContent = `Copy failed: ${String(error)}`;
  } finally {
    homeCopyLastBtn.disabled = false;
  }
});

homeOpenLastBtn.addEventListener('click', () => {
  const latestEntry = getLatestHistoryEntry();
  if (!latestEntry) return;
  historySelectedEntryId = latestEntry.id;
  renderHistory(historyEntries);
  setActiveTab('history');
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

historyCopyBtn.addEventListener('click', async () => {
  const entry = historyEntries.find((item) => item.id === historySelectedEntryId);
  if (!entry) return;
  historyCopyBtn.disabled = true;
  try {
    await invoke('copy_text_to_clipboard', { text: entry.final_output });
    statusEl.textContent = 'Copied transcript to clipboard.';
  } catch (error) {
    statusEl.textContent = `Copy failed: ${String(error)}`;
  } finally {
    historyCopyBtn.disabled = false;
  }
});

historyReuseBtn.addEventListener('click', () => {
  const entry = historyEntries.find((item) => item.id === historySelectedEntryId);
  if (!entry) return;
  statusEl.textContent = entry.final_output;
  setActiveTab('home');
});

const rerenderHistory = () => renderHistory(historyEntries);
historySearchInput.addEventListener('input', rerenderHistory);
historyFilterModeInput.addEventListener('change', rerenderHistory);
historyFilterLanguageInput.addEventListener('change', rerenderHistory);
historyFilterDateInput.addEventListener('change', rerenderHistory);

historyClearBtn.addEventListener('click', async () => {
  const shouldClear = window.confirm('Clear all transcript history? This cannot be undone.');
  if (!shouldClear) return;
  historyClearBtn.disabled = true;
  try {
    await invoke('clear_transcript_history');
    historySelectedEntryId = null;
    renderHistory([]);
    statusEl.textContent = 'Transcript history cleared.';
  } catch (error) {
    statusEl.textContent = `Failed to clear history: ${String(error)}`;
  } finally {
    historyClearBtn.disabled = false;
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
