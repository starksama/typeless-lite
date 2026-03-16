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

type ApiDiagnosticsStatus = {
  state: 'not_run' | 'testing' | 'passed' | 'failed';
  message: string;
  updated_at_ms: number | null;
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

type DurableDraft = {
  text: string;
  created_at_ms: number;
  recording_mode: RecordingMode;
  language: TranscriptionLanguage;
  source_app?: string | null;
};

type WorkspaceTab = 'home' | 'dictation' | 'history' | 'settings';
type OnboardingStepId = 'welcome' | 'permissions' | 'api' | 'quick-setup' | 'finish';
type HotkeyCaptureTarget = 'settings' | 'onboarding';

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

type HotkeyConflictInfo = {
  reason: string;
  fallback: string;
};

const DEFAULT_HOTKEY_CONFLICTS: Record<string, HotkeyConflictInfo> = {
  'Cmd+Space': {
    reason: 'Commonly reserved by macOS Spotlight.',
    fallback: 'Cmd+Shift+Space'
  },
  'Cmd+Tab': {
    reason: 'Commonly reserved by macOS App Switcher.',
    fallback: 'Cmd+Shift+Space'
  },
  'Cmd+Q': {
    reason: 'Commonly reserved by apps for Quit.',
    fallback: 'Cmd+Shift+Space'
  },
  'Cmd+W': {
    reason: 'Commonly reserved by apps for Close Window.',
    fallback: 'Cmd+Shift+Space'
  },
  'Cmd+H': {
    reason: 'Commonly reserved by apps for Hide.',
    fallback: 'Cmd+Shift+Space'
  },
  'Cmd+M': {
    reason: 'Commonly reserved by apps for Minimize.',
    fallback: 'Cmd+Option+Space'
  },
  'Cmd+Option+Escape': {
    reason: 'Reserved by macOS Force Quit dialog.',
    fallback: 'Cmd+Shift+Space'
  }
};

const appShellEl = document.querySelector<HTMLElement>('#app-shell')!;
const sidebarToggleBtn = document.querySelector<HTMLButtonElement>('#sidebar-toggle-btn')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const modeStatusTextEl = document.querySelector<HTMLParagraphElement>('#mode-status-text')!;
const micLevelValueEl = document.querySelector<HTMLSpanElement>('#mic-level-value')!;
const micLevelBarEl = document.querySelector<HTMLDivElement>('#mic-level-bar')!;
const accessibilityStatusEl = document.querySelector<HTMLParagraphElement>('#accessibility-status')!;
const settingsRuntimeStatusEl = document.querySelector<HTMLSpanElement>('#settings-runtime-status')!;
const settingsAccessibilityStatusEl = document.querySelector<HTMLSpanElement>('#settings-accessibility-status')!;
const settingsApiTestStatusEl = document.querySelector<HTMLSpanElement>('#settings-api-test-status')!;
const settingsDiagnosticsCopyStatusEl = document.querySelector<HTMLSpanElement>('#settings-diagnostics-copy-status')!;
const copyDiagnosticsBtn = document.querySelector<HTMLButtonElement>('#copy-diagnostics-btn')!;
const form = document.querySelector<HTMLFormElement>('#settings-form')!;
const toggleBtn = document.querySelector<HTMLButtonElement>('#toggle-btn')!;
const draftRestoreBannerEl = document.querySelector<HTMLDivElement>('#draft-restore-banner')!;
const draftRestorePreviewEl = document.querySelector<HTMLParagraphElement>('#draft-restore-preview')!;
const draftRestoreCopyBtn = document.querySelector<HTMLButtonElement>('#draft-restore-copy-btn')!;
const draftRestoreDismissBtn = document.querySelector<HTMLButtonElement>('#draft-restore-dismiss-btn')!;
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
const hotkeySuggestionBtn = document.querySelector<HTMLButtonElement>('#hotkey-suggestion-btn')!;
const hotkeyCaptureBtn = document.querySelector<HTMLButtonElement>('#hotkey-capture-btn')!;
const hotkeyCancelBtn = document.querySelector<HTMLButtonElement>('#hotkey-cancel-btn')!;
const hotkeyFallbackMappingsInput = document.querySelector<HTMLTextAreaElement>('#hotkey-fallback-mappings')!;
const hotkeyFallbackMappingsSaveBtn = document.querySelector<HTMLButtonElement>('#hotkey-fallback-mappings-save-btn')!;
const hotkeyFallbackMappingsResetBtn = document.querySelector<HTMLButtonElement>('#hotkey-fallback-mappings-reset-btn')!;
const hotkeyFallbackMappingsStatusEl = document.querySelector<HTMLParagraphElement>('#hotkey-fallback-mappings-status')!;
const quickPresetButtons = document.querySelectorAll<HTMLButtonElement>('[data-hotkey-preset]');
const onboardingHotkeyPresetButtons = document.querySelectorAll<HTMLButtonElement>('[data-onboarding-hotkey-preset]');
const activeHotkeyChipEl = document.querySelector<HTMLSpanElement>('#active-hotkey-chip')!;
const activeModeChipEl = document.querySelector<HTMLSpanElement>('#active-mode-chip')!;
const activeLanguageChipEl = document.querySelector<HTMLSpanElement>('#active-language-chip')!;
const activeStateChipEl = document.querySelector<HTMLSpanElement>('#active-state-chip')!;
const summaryHotkeyEl = document.querySelector<HTMLSpanElement>('#summary-hotkey')!;
const summaryModeEl = document.querySelector<HTMLSpanElement>('#summary-mode')!;
const summaryLanguageEl = document.querySelector<HTMLSpanElement>('#summary-language')!;
const homeToggleBtn = document.querySelector<HTMLButtonElement>('#home-toggle-btn')!;
const homeFastModeBtn = document.querySelector<HTMLButtonElement>('#home-fast-mode-btn')!;
const homeFastModeStateEl = document.querySelector<HTMLSpanElement>('#home-fast-mode-state')!;
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
const historyExportTxtBtn = document.querySelector<HTMLButtonElement>('#history-export-txt-btn')!;
const historyExportJsonBtn = document.querySelector<HTMLButtonElement>('#history-export-json-btn')!;
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
const onboardingApiBaseUrlInput = document.querySelector<HTMLInputElement>('#onboarding-api-base-url')!;
const onboardingApiKeyValidationEl = document.querySelector<HTMLParagraphElement>('#onboarding-api-key-validation')!;
const onboardingApiBaseUrlValidationEl = document.querySelector<HTMLParagraphElement>(
  '#onboarding-api-base-url-validation'
)!;
const onboardingApiBaseUrlFixBtn = document.querySelector<HTMLButtonElement>('#onboarding-api-base-url-fix-btn')!;
const onboardingRecordingModeInput = document.querySelector<HTMLSelectElement>('#onboarding-recording-mode')!;
const onboardingHotkeyInput = document.querySelector<HTMLInputElement>('#onboarding-hotkey')!;
const onboardingHotkeyCaptureBtn = document.querySelector<HTMLButtonElement>('#onboarding-hotkey-capture-btn')!;
const onboardingHotkeyCancelBtn = document.querySelector<HTMLButtonElement>('#onboarding-hotkey-cancel-btn')!;
const onboardingHotkeyValidationEl = document.querySelector<HTMLParagraphElement>('#onboarding-hotkey-validation')!;
const onboardingHotkeySuggestionBtn = document.querySelector<HTMLButtonElement>('#onboarding-hotkey-suggestion-btn')!;
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
let isSidebarCollapsed = false;
let activeHotkeyCaptureTarget: HotkeyCaptureTarget | null = null;
const ONBOARDING_COMPLETED_KEY = 'typeless:onboarding-complete:v1';
const SIDEBAR_COLLAPSED_KEY = 'typeless:sidebar-collapsed:v1';
const HOTKEY_CUSTOM_CONFLICTS_KEY = 'typeless:hotkey-custom-conflicts:v1';
const onboardingStepOrder: OnboardingStepId[] = ['welcome', 'permissions', 'api', 'quick-setup', 'finish'];
let onboardingStepIndex = 0;
let historyEntries: TranscriptHistoryEntry[] = [];
let historySelectedEntryId: number | null = null;
let durableDraft: DurableDraft | null = null;
const TOGGLE_PENDING_TIMEOUT_MS = 3000;
let lastRuntimeStatus: RuntimeStatus | null = null;
let lastAccessibilityStatus: AccessibilityPermissionStatus | null = null;
let lastApiDiagnosticsStatus: ApiDiagnosticsStatus = {
  state: 'not_run',
  message: 'Not run yet.',
  updated_at_ms: null
};
let togglePendingAction: 'starting' | 'stopping' | null = null;
let togglePendingTimeoutId: number | null = null;
let customHotkeyConflicts: Record<string, HotkeyConflictInfo> = {};
let effectiveHotkeyConflicts: Record<string, HotkeyConflictInfo> = { ...DEFAULT_HOTKEY_CONFLICTS };

function setAccessibilityStatusSummary(message: string, clearStructured = false): void {
  accessibilityStatusEl.textContent = message;
  settingsAccessibilityStatusEl.textContent = message;
  if (clearStructured) {
    lastAccessibilityStatus = null;
  }
}

function setApiDiagnosticsStatus(state: ApiDiagnosticsStatus['state'], message: string): void {
  lastApiDiagnosticsStatus = {
    state,
    message,
    updated_at_ms: Date.now()
  };
  settingsApiTestStatusEl.textContent = message;
}

function formatDiagnosticsTime(timestampMs: number | null): string {
  if (timestampMs === null) return 'never';
  return new Date(timestampMs).toISOString();
}

function setDiagnosticsCopyStatus(
  message: string,
  state: 'idle' | 'success' | 'error' = 'idle'
): void {
  settingsDiagnosticsCopyStatusEl.textContent = message;
  settingsDiagnosticsCopyStatusEl.classList.toggle('status-copy-success', state === 'success');
  settingsDiagnosticsCopyStatusEl.classList.toggle('status-copy-error', state === 'error');
}

function buildDiagnosticsReport(): string {
  const generatedAt = new Date().toISOString();
  const runtime = lastRuntimeStatus;
  const runtimeState = runtime ? runtimeStateLabel(runtime) : 'Unknown';
  const runtimeMessage = runtime?.last_message?.trim() || 'Unavailable';
  const runtimeMicLevel = runtime ? Math.max(0, Math.min(100, Math.round(runtime.mic_level || 0))) : 0;
  const accessibility = lastAccessibilityStatus;
  const accessibilitySummary = settingsAccessibilityStatusEl.textContent?.trim() || 'Unavailable';
  const apiState = lastApiDiagnosticsStatus.state.replace('_', ' ');
  const apiMessage = lastApiDiagnosticsStatus.message.trim() || 'Unavailable';

  return [
    'Typeless Lite Diagnostics',
    `generated_at: ${generatedAt}`,
    '',
    '[runtime]',
    `state: ${runtimeState}`,
    `is_recording: ${runtime ? String(runtime.is_recording) : 'unknown'}`,
    `is_processing: ${runtime ? String(runtime.is_processing) : 'unknown'}`,
    `mic_level_percent: ${runtimeMicLevel}`,
    `message: ${runtimeMessage}`,
    '',
    '[accessibility]',
    `summary: ${accessibilitySummary}`,
    `platform: ${accessibility ? accessibility.platform : 'unknown'}`,
    `is_supported: ${accessibility ? String(accessibility.is_supported) : 'unknown'}`,
    `is_granted: ${accessibility ? String(accessibility.is_granted) : 'unknown'}`,
    `status: ${accessibility ? accessibility.status : 'unknown'}`,
    `guidance: ${accessibility ? accessibility.guidance : 'unknown'}`,
    '',
    '[api_test]',
    `state: ${apiState}`,
    `message: ${apiMessage}`,
    `updated_at: ${formatDiagnosticsTime(lastApiDiagnosticsStatus.updated_at_ms)}`
  ].join('\n');
}

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
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
      event.preventDefault();

      const buttons = Array.from(tabButtons);
      const currentIndex = buttons.indexOf(button);
      if (currentIndex < 0) return;

      let nextIndex = currentIndex;
      if (key === 'ArrowRight' || key === 'ArrowDown') nextIndex = (currentIndex + 1) % buttons.length;
      if (key === 'ArrowLeft' || key === 'ArrowUp') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      if (key === 'Home') nextIndex = 0;
      if (key === 'End') nextIndex = buttons.length - 1;

      const nextButton = buttons[nextIndex];
      const nextTab = (nextButton.dataset.tabTarget as WorkspaceTab) || 'home';
      setActiveTab(nextTab, true);
    });
  });

  setActiveTab(activeTab);
}

function setSidebarCollapsedState(collapsed: boolean): void {
  isSidebarCollapsed = collapsed;
  appShellEl.classList.toggle('sidebar-collapsed', collapsed);
  sidebarToggleBtn.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggleBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
}

function setupSidebar(): void {
  const persisted = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
  setSidebarCollapsedState(persisted === 'true');
  sidebarToggleBtn.addEventListener('click', () => {
    const nextCollapsed = !isSidebarCollapsed;
    setSidebarCollapsedState(nextCollapsed);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, nextCollapsed ? 'true' : 'false');
  });
}

function isOnboardingCompleted(): boolean {
  return localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true';
}

function setOnboardingCompleted(value: boolean): void {
  localStorage.setItem(ONBOARDING_COMPLETED_KEY, value ? 'true' : 'false');
}

function syncOnboardingInputsFromSettings(): void {
  onboardingApiKeyInput.value = apiKeyInput.value.trim();
  onboardingApiBaseUrlInput.value = apiBaseUrlInput.value.trim() || 'https://api.openai.com/v1';
  onboardingRecordingModeInput.value = normalizeMode(recordingModeInput.value);
  onboardingHotkeyInput.value = normalizeHotkeyInput(hotkeyInput.value) || 'Cmd+Shift+Space';
  onboardingLanguageInput.value = normalizeLanguage(languageInput.value);
  validateOnboardingApiStep();
  validateOnboardingHotkeyInput();
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
  if (activeHotkeyCaptureTarget === 'onboarding') {
    stopHotkeyCapture();
  }
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

function setOnboardingHotkeyValidation(message: string, isError: boolean): void {
  onboardingHotkeyValidationEl.textContent = message;
  onboardingHotkeyValidationEl.classList.toggle('error', isError);
}

function setOnboardingApiKeyValidation(message: string, isError: boolean): void {
  onboardingApiKeyValidationEl.textContent = message;
  onboardingApiKeyValidationEl.classList.toggle('error', isError);
}

function setOnboardingApiBaseUrlValidation(message: string, isError: boolean): void {
  onboardingApiBaseUrlValidationEl.textContent = message;
  onboardingApiBaseUrlValidationEl.classList.toggle('error', isError);
}

function normalizeApiBaseUrlInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.hostname === 'api.openai.com' && (!parsed.pathname || parsed.pathname === '/')) {
      parsed.pathname = '/v1';
    } else {
      const pathWithoutTrailingSlash = parsed.pathname.replace(/\/+$/, '');
      parsed.pathname = pathWithoutTrailingSlash || '/';
    }
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed;
  }
}

function validateOnboardingApiKey(apiKey: string): string | null {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return 'API key is required.';
  }
  if (!trimmed.startsWith('sk-')) {
    return 'API key should start with "sk-".';
  }
  return null;
}

function validateOnboardingApiBaseUrl(baseUrl: string): { error: string | null; suggestion: string | null } {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return {
      error: 'API base URL is required.',
      suggestion: 'https://api.openai.com/v1'
    };
  }

  const suggested = normalizeApiBaseUrlInput(trimmed);
  const suggestion = suggested && suggested !== trimmed ? suggested : null;
  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return {
      error: 'Enter a valid URL like https://api.openai.com/v1.',
      suggestion
    };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return {
      error: 'URL must start with http:// or https://.',
      suggestion
    };
  }

  if (!parsed.hostname) {
    return {
      error: 'URL must include a host name.',
      suggestion
    };
  }

  return {
    error: null,
    suggestion
  };
}

function setOnboardingApiBaseUrlFixSuggestion(suggestion: string | null): void {
  if (!suggestion) {
    onboardingApiBaseUrlFixBtn.classList.add('hidden');
    onboardingApiBaseUrlFixBtn.dataset.normalizedBaseUrl = '';
    return;
  }
  onboardingApiBaseUrlFixBtn.classList.remove('hidden');
  onboardingApiBaseUrlFixBtn.dataset.normalizedBaseUrl = suggestion;
}

function normalizeBaseUrlForSettingsInput(baseUrl: string): string {
  return normalizeApiBaseUrlInput(baseUrl) || 'https://api.openai.com/v1';
}

function validateOnboardingApiStep(): string | null {
  const keyError = validateOnboardingApiKey(onboardingApiKeyInput.value);
  if (keyError) {
    setOnboardingApiKeyValidation(keyError, true);
  } else {
    setOnboardingApiKeyValidation('API key looks good.', false);
  }

  const baseUrlValidation = validateOnboardingApiBaseUrl(onboardingApiBaseUrlInput.value);
  setOnboardingApiBaseUrlFixSuggestion(baseUrlValidation.suggestion);
  if (baseUrlValidation.error) {
    setOnboardingApiBaseUrlValidation(baseUrlValidation.error, true);
  } else if (baseUrlValidation.suggestion) {
    setOnboardingApiBaseUrlValidation('URL works. Use "Fix URL format" to normalize.', false);
  } else {
    setOnboardingApiBaseUrlValidation('API base URL looks good.', false);
  }

  return keyError || baseUrlValidation.error;
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

function normalizeConflictReason(reason: string, hotkey: string): string {
  const trimmedReason = reason.trim();
  if (trimmedReason) return trimmedReason;
  return `Custom fallback mapping for ${hotkey}.`;
}

function sanitizeCustomHotkeyConflicts(
  input: unknown
): { normalized: Record<string, HotkeyConflictInfo>; removedCount: number } {
  const normalized: Record<string, HotkeyConflictInfo> = {};
  let removedCount = 0;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { normalized, removedCount };
  }

  for (const [requestedRaw, entry] of Object.entries(input as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      removedCount += 1;
      continue;
    }

    const fallbackRaw = (entry as { fallback?: unknown }).fallback;
    if (typeof fallbackRaw !== 'string') {
      removedCount += 1;
      continue;
    }

    const requested = normalizeHotkeyInput(requestedRaw);
    const fallback = normalizeHotkeyInput(fallbackRaw);
    if (!requested || !fallback || validateHotkey(requested) || validateHotkey(fallback)) {
      removedCount += 1;
      continue;
    }

    const reasonRaw = (entry as { reason?: unknown }).reason;
    const reason = typeof reasonRaw === 'string' ? normalizeConflictReason(reasonRaw, requested) : normalizeConflictReason('', requested);
    normalized[requested] = {
      reason,
      fallback
    };
  }

  return { normalized, removedCount };
}

function refreshEffectiveHotkeyConflicts(): void {
  effectiveHotkeyConflicts = {
    ...DEFAULT_HOTKEY_CONFLICTS,
    ...customHotkeyConflicts
  };
}

function loadCustomHotkeyConflicts(): void {
  const persisted = localStorage.getItem(HOTKEY_CUSTOM_CONFLICTS_KEY);
  if (!persisted) {
    customHotkeyConflicts = {};
    refreshEffectiveHotkeyConflicts();
    return;
  }

  try {
    const parsed = JSON.parse(persisted) as unknown;
    const { normalized, removedCount } = sanitizeCustomHotkeyConflicts(parsed);
    customHotkeyConflicts = normalized;
    refreshEffectiveHotkeyConflicts();
    if (removedCount > 0) {
      localStorage.setItem(HOTKEY_CUSTOM_CONFLICTS_KEY, JSON.stringify(customHotkeyConflicts));
    }
  } catch {
    customHotkeyConflicts = {};
    refreshEffectiveHotkeyConflicts();
    localStorage.removeItem(HOTKEY_CUSTOM_CONFLICTS_KEY);
  }
}

function persistCustomHotkeyConflicts(): void {
  if (Object.keys(customHotkeyConflicts).length === 0) {
    localStorage.removeItem(HOTKEY_CUSTOM_CONFLICTS_KEY);
    return;
  }
  localStorage.setItem(HOTKEY_CUSTOM_CONFLICTS_KEY, JSON.stringify(customHotkeyConflicts));
}

function formatCustomHotkeyConflictsForEditor(map: Record<string, HotkeyConflictInfo>): string {
  const lines = Object.entries(map)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([requested, info]) => {
      const defaultReason = normalizeConflictReason('', requested);
      const reasonPart = info.reason.trim() === defaultReason ? '' : ` | ${info.reason.trim()}`;
      return `${requested} => ${info.fallback}${reasonPart}`;
    });
  return lines.join('\n');
}

function parseCustomHotkeyConflictsEditorValue(
  value: string
): { conflicts: Record<string, HotkeyConflictInfo>; error: string | null } {
  const conflicts: Record<string, HotkeyConflictInfo> = {};
  const lines = value.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=>');
    if (separatorIndex <= 0) {
      return {
        conflicts: {},
        error: `Line ${index + 1} is invalid. Use "RequestedHotkey => FallbackHotkey | Optional reason".`
      };
    }

    const requestedRaw = line.slice(0, separatorIndex).trim();
    const rightSide = line.slice(separatorIndex + 2).trim();
    if (!requestedRaw || !rightSide) {
      return {
        conflicts: {},
        error: `Line ${index + 1} is missing a requested or fallback hotkey.`
      };
    }

    const reasonSeparatorIndex = rightSide.indexOf('|');
    const fallbackRaw = reasonSeparatorIndex >= 0 ? rightSide.slice(0, reasonSeparatorIndex).trim() : rightSide;
    const reasonRaw = reasonSeparatorIndex >= 0 ? rightSide.slice(reasonSeparatorIndex + 1).trim() : '';
    const requested = normalizeHotkeyInput(requestedRaw);
    const fallback = normalizeHotkeyInput(fallbackRaw);
    const requestedError = validateHotkey(requested);
    const fallbackError = validateHotkey(fallback);
    if (requestedError) {
      return {
        conflicts: {},
        error: `Line ${index + 1} requested hotkey is invalid: ${requestedError}`
      };
    }
    if (fallbackError) {
      return {
        conflicts: {},
        error: `Line ${index + 1} fallback hotkey is invalid: ${fallbackError}`
      };
    }

    conflicts[requested] = {
      fallback,
      reason: normalizeConflictReason(reasonRaw, requested)
    };
  }

  return { conflicts, error: null };
}

function setHotkeyFallbackMappingsStatus(message: string, isError = false): void {
  hotkeyFallbackMappingsStatusEl.textContent = message;
  hotkeyFallbackMappingsStatusEl.classList.toggle('error', isError);
}

function applyHotkeyConflictMappings(conflicts: Record<string, HotkeyConflictInfo>): void {
  customHotkeyConflicts = conflicts;
  refreshEffectiveHotkeyConflicts();
  hotkeyFallbackMappingsInput.value = formatCustomHotkeyConflictsForEditor(customHotkeyConflicts);
  validateHotkeyInput();
  validateOnboardingHotkeyInput();
}

function setupHotkeyFallbackMappingsEditor(): void {
  loadCustomHotkeyConflicts();
  hotkeyFallbackMappingsInput.value = formatCustomHotkeyConflictsForEditor(customHotkeyConflicts);
  setHotkeyFallbackMappingsStatus('No custom fallback mappings saved yet.', false);

  hotkeyFallbackMappingsSaveBtn.addEventListener('click', () => {
    const parsed = parseCustomHotkeyConflictsEditorValue(hotkeyFallbackMappingsInput.value);
    if (parsed.error) {
      setHotkeyFallbackMappingsStatus(parsed.error, true);
      return;
    }
    applyHotkeyConflictMappings(parsed.conflicts);
    persistCustomHotkeyConflicts();
    const count = Object.keys(parsed.conflicts).length;
    setHotkeyFallbackMappingsStatus(
      count > 0 ? `Saved ${count} custom fallback mapping${count === 1 ? '' : 's'}.` : 'Custom fallback mappings cleared.',
      false
    );
  });

  hotkeyFallbackMappingsResetBtn.addEventListener('click', () => {
    applyHotkeyConflictMappings({});
    persistCustomHotkeyConflicts();
    setHotkeyFallbackMappingsStatus('Reset custom mappings. Default fallback mappings are active.', false);
  });
}

function getHotkeyConflictInfo(hotkey: string): HotkeyConflictInfo | null {
  const normalized = normalizeHotkeyInput(hotkey);
  return effectiveHotkeyConflicts[normalized] ?? null;
}

function setHotkeySuggestion(button: HTMLButtonElement, conflictInfo: HotkeyConflictInfo | null): void {
  if (!conflictInfo) {
    button.classList.add('hidden');
    button.dataset.fallbackHotkey = '';
    return;
  }
  button.textContent = `Use suggested fallback: ${conflictInfo.fallback}`;
  button.dataset.fallbackHotkey = conflictInfo.fallback;
  button.classList.remove('hidden');
}

function hotkeyFromKeyboardEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey) parts.push('Cmd');
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  const key = event.key;
  if (key && !['Meta', 'Control', 'Alt', 'Shift', 'AltGraph'].includes(key)) {
    let normalizedKey = key;
    if (key === ' ') normalizedKey = 'Space';
    if (key.length === 1) normalizedKey = key.toUpperCase();
    if (key === 'Escape') normalizedKey = 'Escape';
    if (key === 'ArrowUp') normalizedKey = 'Up';
    if (key === 'ArrowDown') normalizedKey = 'Down';
    if (key === 'ArrowLeft') normalizedKey = 'Left';
    if (key === 'ArrowRight') normalizedKey = 'Right';
    parts.push(normalizedKey);
  }

  return normalizeHotkeyInput(parts.join('+'));
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
  lastRuntimeStatus = status;
  clearTogglePendingState();
  const state = runtimeStateLabel(status);
  statusEl.textContent = `${state}: ${status.last_message}`;
  activeStateChipEl.textContent = state;

  const level = Math.max(0, Math.min(100, Math.round(status.mic_level || 0)));
  micLevelValueEl.textContent = status.is_recording ? `${level}%` : '0%';
  micLevelBarEl.style.width = `${status.is_recording ? level : 0}%`;
  settingsRuntimeStatusEl.textContent = `${state} | mic ${status.is_recording ? `${level}%` : '0%'} | ${status.last_message}`;
}

function setToggleButtonsDisabled(disabled: boolean): void {
  toggleBtn.disabled = disabled;
  homeToggleBtn.disabled = disabled;
}

function clearTogglePendingState(): void {
  if (togglePendingTimeoutId !== null) {
    window.clearTimeout(togglePendingTimeoutId);
    togglePendingTimeoutId = null;
  }
  togglePendingAction = null;
  setToggleButtonsDisabled(false);
}

function beginOptimisticToggleState(): boolean {
  if (togglePendingAction) return false;
  const nextAction: 'starting' | 'stopping' = lastRuntimeStatus?.is_recording ? 'stopping' : 'starting';
  togglePendingAction = nextAction;
  setToggleButtonsDisabled(true);
  statusEl.textContent = nextAction === 'starting' ? 'Starting recording...' : 'Stopping recording...';
  activeStateChipEl.textContent = nextAction === 'starting' ? 'Starting...' : 'Stopping...';
  togglePendingTimeoutId = window.setTimeout(() => {
    clearTogglePendingState();
  }, TOGGLE_PENDING_TIMEOUT_MS);
  return true;
}

async function requestToggleRecording(): Promise<void> {
  if (!beginOptimisticToggleState()) return;
  try {
    await invoke<void>('toggle_recording');
    clearTogglePendingState();
  } catch (error) {
    clearTogglePendingState();
    if (lastRuntimeStatus) {
      renderStatus(lastRuntimeStatus);
    }
    statusEl.textContent = `Toggle failed: ${String(error)}`;
  }
}

function renderFastModeState(formatEnabled: boolean): void {
  const fastModeEnabled = !formatEnabled;
  homeFastModeStateEl.textContent = fastModeEnabled ? 'ON' : 'OFF';
}

function renderAccessibilityStatus(status: AccessibilityPermissionStatus): void {
  lastAccessibilityStatus = status;
  const label = status.is_supported
    ? status.is_granted
      ? 'Granted'
      : 'Not granted'
    : 'Unsupported';
  setAccessibilityStatusSummary(`[${label}] ${status.guidance}`);
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
    setAccessibilityStatusSummary(message, true);
  } catch (error) {
    setAccessibilityStatusSummary(`Failed to open settings: ${String(error)}`, true);
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
    api_base_url: normalizeBaseUrlForSettingsInput(apiBaseUrlInput.value),
    recording_mode: normalizeMode(recordingModeInput.value),
    language: normalizeLanguage(languageInput.value)
  };
}

function validateHotkeyInput(): string | null {
  const validationMessage = validateHotkey(hotkeyInput.value);
  if (validationMessage) {
    setHotkeySuggestion(hotkeySuggestionBtn, null);
    setHotkeyValidation(validationMessage, true);
    return validationMessage;
  }

  hotkeyInput.value = normalizeHotkeyInput(hotkeyInput.value);
  const conflictInfo = getHotkeyConflictInfo(hotkeyInput.value);
  setHotkeySuggestion(hotkeySuggestionBtn, conflictInfo);
  if (conflictInfo) {
    const conflictMessage = `Hotkey conflict preflight: ${conflictInfo.reason}`;
    setHotkeyValidation(conflictMessage, true);
    return conflictMessage;
  }

  setHotkeyValidation('Hotkey looks good.', false);
  return null;
}

function validateOnboardingHotkeyInput(): string | null {
  const validationMessage = validateHotkey(onboardingHotkeyInput.value);
  if (validationMessage) {
    setHotkeySuggestion(onboardingHotkeySuggestionBtn, null);
    setOnboardingHotkeyValidation(validationMessage, true);
    return validationMessage;
  }

  onboardingHotkeyInput.value = normalizeHotkeyInput(onboardingHotkeyInput.value);
  const conflictInfo = getHotkeyConflictInfo(onboardingHotkeyInput.value);
  setHotkeySuggestion(onboardingHotkeySuggestionBtn, conflictInfo);
  if (conflictInfo) {
    const conflictMessage = `Hotkey conflict preflight: ${conflictInfo.reason}`;
    setOnboardingHotkeyValidation(conflictMessage, true);
    return conflictMessage;
  }

  setOnboardingHotkeyValidation('Hotkey looks good.', false);
  return null;
}

function stopHotkeyCapture(message?: string, isError = false): void {
  if (!activeHotkeyCaptureTarget) return;
  if (activeHotkeyCaptureTarget === 'settings') {
    hotkeyCaptureBtn.textContent = 'Edit hotkey';
    hotkeyCaptureBtn.disabled = false;
    hotkeyCancelBtn.classList.add('hidden');
    if (message) setHotkeyValidation(message, isError);
  } else {
    onboardingHotkeyCaptureBtn.textContent = 'Edit hotkey';
    onboardingHotkeyCaptureBtn.disabled = false;
    onboardingHotkeyCancelBtn.classList.add('hidden');
    if (message) setOnboardingHotkeyValidation(message, isError);
  }
  activeHotkeyCaptureTarget = null;
}

function startHotkeyCapture(target: HotkeyCaptureTarget): void {
  if (activeHotkeyCaptureTarget) {
    stopHotkeyCapture();
  }
  activeHotkeyCaptureTarget = target;
  if (target === 'settings') {
    hotkeyCaptureBtn.textContent = 'Press shortcut...';
    hotkeyCaptureBtn.disabled = true;
    hotkeyCancelBtn.classList.remove('hidden');
    setHotkeyValidation('Listening for a shortcut. Press Esc to cancel.', false);
  } else {
    onboardingHotkeyCaptureBtn.textContent = 'Press shortcut...';
    onboardingHotkeyCaptureBtn.disabled = true;
    onboardingHotkeyCancelBtn.classList.remove('hidden');
    setOnboardingHotkeyValidation('Listening for a shortcut. Press Esc to cancel.', false);
  }
}

function setupHotkeyCapture(): void {
  hotkeyCaptureBtn.addEventListener('click', () => {
    startHotkeyCapture('settings');
  });
  onboardingHotkeyCaptureBtn.addEventListener('click', () => {
    startHotkeyCapture('onboarding');
  });

  hotkeyCancelBtn.addEventListener('click', () => {
    stopHotkeyCapture('Hotkey capture canceled.', false);
  });
  onboardingHotkeyCancelBtn.addEventListener('click', () => {
    stopHotkeyCapture('Hotkey capture canceled.', false);
  });

  window.addEventListener(
    'keydown',
    (event) => {
      if (!activeHotkeyCaptureTarget) return;
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        stopHotkeyCapture('Hotkey capture canceled.', false);
        return;
      }

      const candidate = hotkeyFromKeyboardEvent(event);
      const validationMessage = validateHotkey(candidate);
      if (validationMessage) {
        if (activeHotkeyCaptureTarget === 'settings') {
          setHotkeyValidation(validationMessage, true);
        } else {
          setOnboardingHotkeyValidation(validationMessage, true);
        }
        return;
      }

      if (activeHotkeyCaptureTarget === 'settings') {
        hotkeyInput.value = candidate;
        validateHotkeyInput();
        applyConfigUi({
          hotkey: candidate,
          recording_mode: normalizeMode(recordingModeInput.value),
          language: normalizeLanguage(languageInput.value)
        });
      } else {
        onboardingHotkeyInput.value = candidate;
        validateOnboardingHotkeyInput();
      }
      stopHotkeyCapture('Hotkey captured.', false);
    },
    true
  );
}

async function saveSettingsPayload(payload: Settings, successMessage = 'Saved settings.'): Promise<boolean> {
  try {
    await invoke('save_settings', { settings: payload });
    const [savedSettings, runtimeStatus] = await Promise.all([
      invoke<Settings>('get_settings'),
      invoke<RuntimeStatus>('get_runtime_status')
    ]);
    applyConfigUi({
      hotkey: savedSettings.hotkey,
      recording_mode: savedSettings.recording_mode,
      language: savedSettings.language
    });
    hotkeyInput.value = normalizeHotkeyInput(savedSettings.hotkey) || hotkeyInput.value;
    formatEnabledInput.checked = savedSettings.format_enabled;
    renderFastModeState(savedSettings.format_enabled);
    renderStatus(runtimeStatus);
    if (successMessage !== 'Saved settings.') {
      statusEl.textContent = successMessage;
    }
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
  const onboardingApiError = validateOnboardingApiStep();
  if (onboardingApiError) {
    statusEl.textContent = onboardingApiError;
    onboardingStepIndex = onboardingStepOrder.indexOf('api');
    updateOnboardingStep();
    if (validateOnboardingApiKey(onboardingApiKeyInput.value)) {
      onboardingApiKeyInput.focus();
    } else {
      onboardingApiBaseUrlInput.focus();
    }
    return onboardingApiError;
  }

  const onboardingHotkey = normalizeHotkeyInput(onboardingHotkeyInput.value);
  const onboardingHotkeyError = validateHotkey(onboardingHotkey);
  if (onboardingHotkeyError) {
    statusEl.textContent = onboardingHotkeyError;
    onboardingHotkeyInput.focus();
    return onboardingHotkeyError;
  }

  apiKeyInput.value = onboardingApiKeyInput.value.trim();
  apiBaseUrlInput.value = normalizeBaseUrlForSettingsInput(onboardingApiBaseUrlInput.value);
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

function renderDurableDraft(draft: DurableDraft | null): void {
  durableDraft = draft;
  const hasDraft = Boolean(draft && draft.text.trim());
  draftRestoreBannerEl.classList.toggle('hidden', !hasDraft);
  if (!hasDraft || !draft) {
    draftRestorePreviewEl.textContent = 'No saved draft.';
    return;
  }

  const preview = draft.text.trim();
  const previewText = preview.length > 220 ? `${preview.slice(0, 220).trimEnd()}...` : preview;
  const sourceApp = draft.source_app?.trim() || 'Unknown app';
  draftRestorePreviewEl.textContent = `${formatHistoryTimestamp(
    draft.created_at_ms
  )} | ${recordingModeLabel(draft.recording_mode)} | ${languageLabel(draft.language)} | ${sourceApp}\n${previewText}`;
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

function buildHistoryExportFilename(extension: 'txt' | 'json', count: number): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `typeless-history-${timestamp}-${count}-entries.${extension}`;
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function historyEntryExportHeader(entry: TranscriptHistoryEntry): string {
  const sourceApp = entry.source_app?.trim() || 'Unknown app';
  return `${formatHistoryTimestamp(entry.created_at_ms)} | ${recordingModeLabel(entry.recording_mode)} | ${languageLabel(
    entry.language
  )} | ${sourceApp} | ${formatLatency(entry.processing_latency_ms)}`;
}

function buildHistoryTxtExport(entries: TranscriptHistoryEntry[]): string {
  return entries
    .map(
      (entry, index) =>
        `${index + 1}. ${historyEntryExportHeader(entry)}\n${entry.final_output.trim()}\n`
    )
    .join('\n');
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
  renderFastModeState(settings.format_enabled);
  validateHotkeyInput();

  const status = await invoke<RuntimeStatus>('get_runtime_status');
  renderStatus(status);
  await loadHistory();
  const draft = await invoke<DurableDraft | null>('get_durable_draft');
  renderDurableDraft(draft);

  setAccessibilityStatusSummary('Checking Accessibility permission...', true);
  try {
    const permissionStatus = await checkAndRenderAccessibilityStatus();
    if (shouldPromptForAccessibility(permissionStatus)) {
      showAccessibilityModal();
    }
  } catch (error) {
    setAccessibilityStatusSummary(`Accessibility check failed: ${String(error)}`, true);
  }

  if (!isOnboardingCompleted()) {
    setActiveTab('settings');
    showOnboarding();
  }
}

hotkeyInput.addEventListener('click', () => {
  startHotkeyCapture('settings');
});

onboardingHotkeyInput.addEventListener('click', () => {
  startHotkeyCapture('onboarding');
});

quickPresetButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const preset = normalizeHotkeyInput(button.dataset.hotkeyPreset || '');
    hotkeyInput.value = preset;
    validateHotkeyInput();
    applyConfigUi({
      hotkey: preset,
      recording_mode: normalizeMode(recordingModeInput.value),
      language: normalizeLanguage(languageInput.value)
    });
    stopHotkeyCapture();
  });
});

onboardingHotkeyPresetButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const preset = normalizeHotkeyInput(button.dataset.onboardingHotkeyPreset || '');
    onboardingHotkeyInput.value = preset;
    validateOnboardingHotkeyInput();
    stopHotkeyCapture();
  });
});

hotkeySuggestionBtn.addEventListener('click', () => {
  const fallback = normalizeHotkeyInput(hotkeySuggestionBtn.dataset.fallbackHotkey || 'Cmd+Shift+Space');
  hotkeyInput.value = fallback;
  validateHotkeyInput();
  applyConfigUi({
    hotkey: fallback,
    recording_mode: normalizeMode(recordingModeInput.value),
    language: normalizeLanguage(languageInput.value)
  });
});

onboardingHotkeySuggestionBtn.addEventListener('click', () => {
  const fallback = normalizeHotkeyInput(onboardingHotkeySuggestionBtn.dataset.fallbackHotkey || 'Cmd+Shift+Space');
  onboardingHotkeyInput.value = fallback;
  validateOnboardingHotkeyInput();
});

onboardingApiKeyInput.addEventListener('input', () => {
  validateOnboardingApiStep();
});

onboardingApiBaseUrlInput.addEventListener('input', () => {
  validateOnboardingApiStep();
});

onboardingApiBaseUrlFixBtn.addEventListener('click', () => {
  const normalized = onboardingApiBaseUrlFixBtn.dataset.normalizedBaseUrl;
  if (!normalized) return;
  onboardingApiBaseUrlInput.value = normalized;
  validateOnboardingApiStep();
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

toggleBtn.addEventListener('click', () => {
  void requestToggleRecording();
});

homeToggleBtn.addEventListener('click', () => {
  void requestToggleRecording();
});

homeFastModeBtn.addEventListener('click', async () => {
  homeFastModeBtn.disabled = true;
  const currentSettings = readSettingsFromForm();
  const nextFormatEnabled = !currentSettings.format_enabled;
  const payload: Settings = {
    ...currentSettings,
    format_enabled: nextFormatEnabled
  };
  const successMessage = nextFormatEnabled
    ? 'Fast Mode OFF: formatter enabled for higher quality, with added latency.'
    : 'Fast Mode ON: formatter disabled for lower latency, with lower text cleanup quality.';
  const saved = await saveSettingsPayload(payload, successMessage);
  if (!saved) {
    renderFastModeState(formatEnabledInput.checked);
  }
  homeFastModeBtn.disabled = false;
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

draftRestoreCopyBtn.addEventListener('click', async () => {
  if (!durableDraft?.text?.trim()) return;
  draftRestoreCopyBtn.disabled = true;
  try {
    await invoke('copy_text_to_clipboard', { text: durableDraft.text });
    statusEl.textContent = 'Recovered draft copied to clipboard.';
  } catch (error) {
    statusEl.textContent = `Copy failed: ${String(error)}`;
  } finally {
    draftRestoreCopyBtn.disabled = false;
  }
});

draftRestoreDismissBtn.addEventListener('click', async () => {
  draftRestoreDismissBtn.disabled = true;
  try {
    await invoke('clear_durable_draft');
    statusEl.textContent = 'Saved draft discarded.';
  } catch (error) {
    statusEl.textContent = `Failed to discard draft: ${String(error)}`;
  } finally {
    draftRestoreDismissBtn.disabled = false;
  }
});

testApiBtn.addEventListener('click', async () => {
  testApiBtn.disabled = true;
  statusEl.textContent = 'Testing API connection...';
  setApiDiagnosticsStatus('testing', 'Running API connectivity test...');
  try {
    const result = await invoke<string>('test_api_connection');
    setApiDiagnosticsStatus('passed', result);
    statusEl.textContent = result;
  } catch (error) {
    const message = String(error);
    setApiDiagnosticsStatus('failed', message);
    statusEl.textContent = message;
  } finally {
    testApiBtn.disabled = false;
  }
});

checkAccessibilityBtn.addEventListener('click', async () => {
  checkAccessibilityBtn.disabled = true;
  setAccessibilityStatusSummary('Checking Accessibility permission...', true);
  try {
    await checkAndRenderAccessibilityStatus();
  } catch (error) {
    setAccessibilityStatusSummary(`Accessibility check failed: ${String(error)}`, true);
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
    const apiError = validateOnboardingApiStep();
    if (apiError) {
      statusEl.textContent = apiError;
      if (validateOnboardingApiKey(onboardingApiKeyInput.value)) {
        onboardingApiKeyInput.focus();
      } else {
        onboardingApiBaseUrlInput.focus();
      }
      return;
    }
    apiKeyInput.value = onboardingApiKeyInput.value.trim();
    apiBaseUrlInput.value = normalizeBaseUrlForSettingsInput(onboardingApiBaseUrlInput.value);
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
    setAccessibilityStatusSummary(message, true);
  } catch (error) {
    onboardingAccessibilityStatusEl.textContent = `Failed to open settings: ${String(error)}`;
  } finally {
    onboardingOpenAccessibilitySettingsBtn.disabled = false;
  }
});

copyDiagnosticsBtn.addEventListener('click', async () => {
  copyDiagnosticsBtn.disabled = true;
  setDiagnosticsCopyStatus('Copying diagnostics...');
  try {
    await invoke('copy_text_to_clipboard', { text: buildDiagnosticsReport() });
    const copiedAt = new Date().toLocaleTimeString();
    setDiagnosticsCopyStatus(`Copied at ${copiedAt}.`, 'success');
    statusEl.textContent = 'Diagnostics copied to clipboard.';
  } catch (error) {
    setDiagnosticsCopyStatus(`Copy failed: ${String(error)}`, 'error');
    statusEl.textContent = `Copy failed: ${String(error)}`;
  } finally {
    copyDiagnosticsBtn.disabled = false;
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

historyExportTxtBtn.addEventListener('click', () => {
  const filteredEntries = getFilteredHistoryEntries();
  if (filteredEntries.length === 0) {
    statusEl.textContent = 'No filtered transcript history to export.';
    return;
  }

  const filename = buildHistoryExportFilename('txt', filteredEntries.length);
  const content = buildHistoryTxtExport(filteredEntries);
  downloadTextFile(filename, content);
  statusEl.textContent = `Exported ${filteredEntries.length} history entries to ${filename}.`;
});

historyExportJsonBtn.addEventListener('click', () => {
  const filteredEntries = getFilteredHistoryEntries();
  if (filteredEntries.length === 0) {
    statusEl.textContent = 'No filtered transcript history to export.';
    return;
  }

  const filename = buildHistoryExportFilename('json', filteredEntries.length);
  const content = `${JSON.stringify(filteredEntries, null, 2)}\n`;
  downloadTextFile(filename, content);
  statusEl.textContent = `Exported ${filteredEntries.length} history entries to ${filename}.`;
});

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

listen<DurableDraft | null>('durable-draft-updated', (event) => {
  renderDurableDraft(event.payload);
}).catch((error) => {
  statusEl.textContent = `Draft listener failed: ${String(error)}`;
});

listen<RuntimeStatus>('runtime-status', (event) => {
  renderStatus(event.payload);
}).catch((error) => {
  statusEl.textContent = `Status listener failed: ${String(error)}`;
});

setupTabs();
setupSidebar();
setupHotkeyCapture();
setupHotkeyFallbackMappingsEditor();

loadInitial().catch((error) => {
  statusEl.textContent = `Initialization failed: ${String(error)}`;
});
