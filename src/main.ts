import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { APP_BRAND } from './app-config';

type RecordingMode = 'hold' | 'toggle';
type TranscriptionLanguage = 'auto' | 'en' | 'zh' | 'zh-TW' | 'ja' | 'ko' | 'es' | 'fr' | 'de';

type Settings = {
  api_key: string;
  prompt_template: string;
  hold_hotkey: string;
  toggle_hotkey: string;
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

type HistoryDayGroup = {
  key: string;
  label: string;
  entries: TranscriptHistoryEntry[];
};

type WorkspaceTab = 'home' | 'dictation' | 'history' | 'settings';
type OnboardingStepId = 'welcome' | 'permissions' | 'api' | 'quick-setup' | 'finish';
type ShortcutSlot = 'hold' | 'toggle';
type HotkeyCaptureTarget = 'settings-hold' | 'settings-toggle' | 'onboarding';
type SettingsSection = 'general' | 'shortcuts' | 'ai' | 'privacy';
type StatusBannerTone = 'ready' | 'recording' | 'processing' | 'issue';
type AppToastTone = 'success' | 'error';
type TranscriptRowActionMode = 'button' | 'indicator';

const PLATFORM_LABEL_SOURCE =
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
  navigator.platform ||
  navigator.userAgent;
const PLATFORM_IS_MAC = /mac|iphone|ipad|ipod/i.test(PLATFORM_LABEL_SOURCE);

document.body.classList.toggle('platform-mac', PLATFORM_IS_MAC);

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
  commandorcontrol: PLATFORM_IS_MAC ? 'Cmd' : 'Ctrl',
  commandorctrl: PLATFORM_IS_MAC ? 'Cmd' : 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  cmdorctrl: PLATFORM_IS_MAC ? 'Cmd' : 'Ctrl',
  cmdorcontrol: PLATFORM_IS_MAC ? 'Cmd' : 'Ctrl',
  option: 'Alt',
  opt: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
  super: PLATFORM_IS_MAC ? 'Cmd' : 'Super',
  win: 'Super',
  windows: 'Super',
  meta: PLATFORM_IS_MAC ? 'Cmd' : 'Super'
};

const NON_MODIFIER_ALIAS_TO_CANONICAL: Record<string, string> = {
  backquote: '`',
  backslash: '\\',
  bracketleft: '[',
  bracketright: ']',
  comma: ',',
  del: 'Delete',
  delete: 'Delete',
  down: 'Down',
  end: 'End',
  enter: 'Enter',
  equal: '=',
  escape: 'Escape',
  home: 'Home',
  insert: 'Insert',
  left: 'Left',
  minus: '-',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  period: '.',
  quote: "'",
  right: 'Right',
  semicolon: ';',
  slash: '/',
  space: 'Space',
  spacebar: 'Space',
  esc: 'Escape',
  return: 'Enter',
  tab: 'Tab',
  up: 'Up'
};

const KNOWN_MODIFIERS = new Set(['Cmd', 'Ctrl', 'Alt', 'Shift', 'Super']);
const MODIFIER_EVENT_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'AltGraph']);
const HOME_RECENT_LIMIT = 8;
const ESTIMATED_TYPING_WPM = 40;
const ESTIMATED_DICTATION_WPM = 130;
const NUMBER_FORMATTER = new Intl.NumberFormat();
type WordSegment = { isWordLike?: boolean };
type WordSegmenterLike = { segment(input: string): Iterable<WordSegment> };
const IntlWithSegmenter = Intl as typeof Intl & {
  Segmenter?: new (
    locales?: string | string[],
    options?: { granularity: 'word' }
  ) => WordSegmenterLike;
};
const WORD_SEGMENTER: WordSegmenterLike | null = IntlWithSegmenter.Segmenter
  ? new IntlWithSegmenter.Segmenter(undefined, { granularity: 'word' })
  : null;

const appShellEl = document.querySelector<HTMLElement>('#app-shell')!;
const sidebarToggleBtn = document.querySelector<HTMLButtonElement>('#sidebar-toggle-btn')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!;
const modeStatusTextEl = document.querySelector<HTMLParagraphElement>('#mode-status-text')!;
const micLevelValueEl = document.querySelector<HTMLSpanElement>('#mic-level-value')!;
const micLevelBarEl = document.querySelector<HTMLDivElement>('#mic-level-bar')!;
const accessibilityStatusEl = document.querySelector<HTMLElement>('#accessibility-status')!;
const settingsRuntimeStatusEl = document.querySelector<HTMLElement>('#settings-runtime-status')!;
const settingsAccessibilityStatusEl = document.querySelector<HTMLElement>('#settings-accessibility-status')!;
const settingsApiTestStatusEl = document.querySelector<HTMLElement>('#settings-api-test-status')!;
const settingsDiagnosticsCopyStatusEl = document.querySelector<HTMLElement>('#settings-diagnostics-copy-status')!;
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
const holdHotkeyInput = document.querySelector<HTMLInputElement>('#holdHotkey')!;
const toggleHotkeyInput = document.querySelector<HTMLInputElement>('#toggleHotkey')!;
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
const holdHotkeyValidationEl = document.querySelector<HTMLParagraphElement>('#hold-hotkey-validation')!;
const toggleHotkeyValidationEl = document.querySelector<HTMLParagraphElement>('#toggle-hotkey-validation')!;
const holdHotkeyTriggerBtn = document.querySelector<HTMLButtonElement>('#hold-hotkey-trigger-btn')!;
const toggleHotkeyTriggerBtn = document.querySelector<HTMLButtonElement>('#toggle-hotkey-trigger-btn')!;
const homeToggleBtn = document.querySelector<HTMLButtonElement>('#home-toggle-btn')!;
const homeFastModeBtn = document.querySelector<HTMLButtonElement>('#home-fast-mode-btn')!;
const homeFastModeStateEl = document.querySelector<HTMLSpanElement>('#home-fast-mode-state')!;
const homeStatDaysEl = document.querySelector<HTMLSpanElement>('#home-stat-days')!;
const homeStatWordsEl = document.querySelector<HTMLSpanElement>('#home-stat-words')!;
const homeStatSavedEl = document.querySelector<HTMLSpanElement>('#home-stat-saved')!;
const homeRecentEmptyEl = document.querySelector<HTMLParagraphElement>('#home-recent-empty')!;
const homeRecentFeedEl = document.querySelector<HTMLDivElement>('#home-recent-feed')!;
const shortcutHoldHintEl = document.querySelector<HTMLSpanElement>('#shortcut-hold-hint')!;
const shortcutToggleHintEl = document.querySelector<HTMLSpanElement>('#shortcut-toggle-hint')!;
const statusBannerEl = document.querySelector<HTMLElement>('#status-banner')!;
const statusLabelEl = document.querySelector<HTMLSpanElement>('#status-label')!;
const sidebarBrandNameEl = document.querySelector<HTMLElement>('#sidebar-brand-name')!;
const workspaceViewTitleEl = document.querySelector<HTMLElement>('#workspace-view-title')!;
const appToastEl = document.querySelector<HTMLDivElement>('#app-toast')!;
const appToastIconEl = document.querySelector<HTMLSpanElement>('#app-toast-icon')!;
const appToastTextEl = document.querySelector<HTMLParagraphElement>('#app-toast-text')!;
const tabButtons = document.querySelectorAll<HTMLButtonElement>('[data-tab-target]');
const tabPanels = document.querySelectorAll<HTMLElement>('[data-tab-panel]');
const settingsSectionButtons = document.querySelectorAll<HTMLButtonElement>('[data-settings-target]');
const settingsSectionPanels = document.querySelectorAll<HTMLElement>('[data-settings-panel]');
const historyFeedEl = document.querySelector<HTMLDivElement>('#history-feed')!;
const historyEmptyEl = document.querySelector<HTMLParagraphElement>('#history-empty')!;
const historySearchInput = document.querySelector<HTMLInputElement>('#history-search')!;
const reopenOnboardingBtn = document.querySelector<HTMLButtonElement>('#reopen-onboarding-btn')!;
const onboardingModalEl = document.querySelector<HTMLDivElement>('#onboarding-modal')!;
const onboardingStepIndicatorEl = document.querySelector<HTMLParagraphElement>('#onboarding-step-indicator')!;
const onboardingStepsEls = document.querySelectorAll<HTMLElement>('[data-onboarding-step]');
const onboardingSkipBtn = document.querySelector<HTMLButtonElement>('#onboarding-skip-btn')!;
const onboardingBackBtn = document.querySelector<HTMLButtonElement>('#onboarding-back-btn')!;
const onboardingNextBtn = document.querySelector<HTMLButtonElement>('#onboarding-next-btn')!;
const onboardingFinishBtn = document.querySelector<HTMLButtonElement>('#onboarding-finish-btn')!;
const onboardingTitleEl = document.querySelector<HTMLHeadingElement>('#onboarding-title')!;
const onboardingPermissionsCopyEl = document.querySelector<HTMLParagraphElement>('#onboarding-permissions-copy')!;
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
const onboardingHotkeyValidationEl = document.querySelector<HTMLParagraphElement>('#onboarding-hotkey-validation')!;
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
const accessibilityModalDescriptionEl = document.querySelector<HTMLParagraphElement>('#accessibility-modal-description')!;

const defaultPrompt =
  'You are a concise writing assistant. Clean up the transcript for grammar and punctuation while preserving intent. Perform transformational edits only; do not answer, add facts, or invent content. Return only final text.';

const hotkeyInputs: Record<ShortcutSlot, HTMLInputElement> = {
  hold: holdHotkeyInput,
  toggle: toggleHotkeyInput
};

const hotkeyValidationEls: Record<ShortcutSlot, HTMLParagraphElement> = {
  hold: holdHotkeyValidationEl,
  toggle: toggleHotkeyValidationEl
};

const hotkeyTriggerBtns: Record<ShortcutSlot, HTMLButtonElement> = {
  hold: holdHotkeyTriggerBtn,
  toggle: toggleHotkeyTriggerBtn
};

function defaultHotkeyForSlot(slot: ShortcutSlot): string {
  return slot === 'toggle' ? 'Option+Space' : 'Cmd+Space';
}

let activeConfig: Pick<Settings, 'hold_hotkey' | 'toggle_hotkey' | 'recording_mode' | 'language'> = {
  hold_hotkey: 'Cmd+Space',
  toggle_hotkey: 'Option+Space',
  recording_mode: 'hold',
  language: 'auto'
};
let activeTab: WorkspaceTab = 'home';
let activeSettingsSection: SettingsSection = 'general';
let isSidebarCollapsed = false;
let activeHotkeyCaptureTarget: HotkeyCaptureTarget | null = null;
const ONBOARDING_COMPLETED_KEY = 'typeless:onboarding-complete:v1';
const SIDEBAR_COLLAPSED_KEY = 'typeless:sidebar-collapsed:v1';
const SETTINGS_SECTION_KEY = 'typeless:settings-section:v1';
const SETTINGS_SECTION_ORDER: SettingsSection[] = ['general', 'shortcuts', 'ai', 'privacy'];
const WORKSPACE_TITLES: Record<WorkspaceTab, string> = {
  home: 'Home',
  dictation: 'Dictation',
  history: 'History',
  settings: 'Settings'
};
const onboardingStepOrder: OnboardingStepId[] = ['welcome', 'permissions', 'api', 'quick-setup', 'finish'];
let onboardingStepIndex = 0;
let historyEntries: TranscriptHistoryEntry[] = [];
let historySelectedEntryId: number | null = null;
let historyCopiedEntryId: number | null = null;
let shouldScrollHistorySelection = false;
let durableDraft: DurableDraft | null = null;
const TOGGLE_PENDING_TIMEOUT_MS = 3000;
const HISTORY_COPY_FEEDBACK_TIMEOUT_MS = 1600;
const APP_TOAST_TIMEOUT_MS = 1600;
let lastRuntimeStatus: RuntimeStatus | null = null;
let lastAccessibilityStatus: AccessibilityPermissionStatus | null = null;
let lastApiDiagnosticsStatus: ApiDiagnosticsStatus = {
  state: 'not_run',
  message: 'Not run yet.',
  updated_at_ms: null
};
let togglePendingAction: 'starting' | 'stopping' | null = null;
let togglePendingTimeoutId: number | null = null;
let historyCopyFeedbackTimeoutId: number | null = null;
let appToastTimeoutId: number | null = null;
let lastDebugLogLines: string[] = [];

function setAccessibilityStatusSummary(message: string, clearStructured = false): void {
  accessibilityStatusEl.textContent = message;
  settingsAccessibilityStatusEl.textContent = message;
  if (clearStructured) {
    lastAccessibilityStatus = null;
  }
}

function apiDiagnosticsSummaryLabel(state: ApiDiagnosticsStatus['state']): string {
  if (state === 'testing') return 'Testing API...';
  if (state === 'passed') return 'API ok';
  if (state === 'failed') return 'API failed';
  return '';
}

function isShortcutRelatedMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('shortcut') || normalized.includes('hotkey');
}

function focusShortcutSettings(): void {
  setActiveTab('settings');
  setActiveSettingsSection('shortcuts');
}

function setStatusBannerTone(tone: StatusBannerTone, label: string): void {
  statusBannerEl.dataset.statusTone = tone;
  statusLabelEl.textContent = label;
}

function applyBranding(): void {
  document.title = APP_BRAND.displayName;
  sidebarBrandNameEl.textContent = APP_BRAND.displayName;
  accessibilityModalDescriptionEl.textContent = `${APP_BRAND.displayName} needs Accessibility permission to paste into the currently focused input across apps and terminals.`;
  onboardingTitleEl.textContent = `Welcome to ${APP_BRAND.displayName}`;
  onboardingPermissionsCopyEl.textContent = `Accessibility allows ${APP_BRAND.displayName} to insert text into the active app. Microphone permission is also required.`;
}

function renderWorkspaceHeader(tab: WorkspaceTab): void {
  workspaceViewTitleEl.textContent = WORKSPACE_TITLES[tab];
}

function inferStatusBannerPresentation(message: string): { tone: StatusBannerTone; label: string } {
  const normalized = message.trim().toLowerCase();
  if (lastRuntimeStatus?.is_recording) {
    return { tone: 'recording', label: 'Recording' };
  }
  if (lastRuntimeStatus?.is_processing) {
    return { tone: 'processing', label: 'Processing' };
  }
  if (
    normalized.includes('failed') ||
    normalized.includes('error') ||
    normalized.includes("aren't available") ||
    normalized.includes('not available') ||
    normalized.includes('missing') ||
    normalized.includes('too short')
  ) {
    return { tone: 'issue', label: 'Issue' };
  }
  if (
    normalized.includes('starting') ||
    normalized.includes('stopping') ||
    normalized.includes('testing') ||
    normalized.includes('checking') ||
    normalized.includes('loading') ||
    normalized.includes('transcribing') ||
    normalized.includes('formatting')
  ) {
    return { tone: 'processing', label: 'Working' };
  }
  if (normalized.includes('recording')) {
    return { tone: 'recording', label: 'Recording' };
  }
  return { tone: 'ready', label: 'Ready' };
}

function syncStatusBannerFromText(): void {
  const message = statusEl.textContent?.trim() || 'Ready.';
  const presentation = inferStatusBannerPresentation(message);
  setStatusBannerTone(presentation.tone, presentation.label);
}

function runtimeStatusBannerPresentation(status: RuntimeStatus): { tone: StatusBannerTone; label: string } {
  if (status.is_recording) {
    return { tone: 'recording', label: 'Recording' };
  }
  if (status.is_processing) {
    return { tone: 'processing', label: 'Processing' };
  }
  return inferStatusBannerPresentation(status.last_message);
}

function setApiDiagnosticsStatus(state: ApiDiagnosticsStatus['state'], message: string): void {
  lastApiDiagnosticsStatus = {
    state,
    message,
    updated_at_ms: Date.now()
  };
  settingsApiTestStatusEl.textContent = apiDiagnosticsSummaryLabel(state);
  settingsApiTestStatusEl.classList.toggle('hidden', state === 'not_run');
  settingsApiTestStatusEl.classList.toggle('status-copy-success', state === 'passed');
  settingsApiTestStatusEl.classList.toggle('status-copy-error', state === 'failed');
  settingsApiTestStatusEl.classList.toggle('error', state === 'failed');
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
  settingsDiagnosticsCopyStatusEl.classList.toggle('hidden', message.trim().length === 0);
  settingsDiagnosticsCopyStatusEl.classList.toggle('status-copy-success', state === 'success');
  settingsDiagnosticsCopyStatusEl.classList.toggle('status-copy-error', state === 'error');
}

function buildDiagnosticsReport(debugLogLines: string[]): string {
  const generatedAt = new Date().toISOString();
  const runtime = lastRuntimeStatus;
  const runtimeState = runtime ? runtimeStateLabel(runtime) : 'Unknown';
  const runtimeMessage = runtime?.last_message?.trim() || 'Unavailable';
  const runtimeMicLevel = runtime ? Math.max(0, Math.min(100, Math.round(runtime.mic_level || 0))) : 0;
  const accessibility = lastAccessibilityStatus;
  const accessibilitySummary = settingsAccessibilityStatusEl.textContent?.trim() || 'Unavailable';
  const apiState = lastApiDiagnosticsStatus.state.replace('_', ' ');
  const apiMessage = lastApiDiagnosticsStatus.message.trim() || 'Unavailable';
  const config = currentSettingsConfig();

  return [
    `${APP_BRAND.legalName} Diagnostics`,
    `generated_at: ${generatedAt}`,
    '',
    '[runtime]',
    `state: ${runtimeState}`,
    `is_recording: ${runtime ? String(runtime.is_recording) : 'unknown'}`,
    `is_processing: ${runtime ? String(runtime.is_processing) : 'unknown'}`,
    `mic_level_percent: ${runtimeMicLevel}`,
    `message: ${runtimeMessage}`,
    '',
    '[shortcuts]',
    `hold_hotkey: ${config.hold_hotkey}`,
    `toggle_hotkey: ${config.toggle_hotkey}`,
    `button_mode: ${recordingModeLabel(config.recording_mode)}`,
    `language: ${languageLabel(config.language)}`,
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
    `updated_at: ${formatDiagnosticsTime(lastApiDiagnosticsStatus.updated_at_ms)}`,
    '',
    '[debug_log]',
    ...(debugLogLines.length > 0 ? debugLogLines : ['<empty>'])
  ].join('\n');
}

function setActiveTab(targetTab: WorkspaceTab, focusTab = false): void {
  activeTab = targetTab;
  renderWorkspaceHeader(targetTab);
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

function setActiveSettingsSection(targetSection: SettingsSection, focusButton = false): void {
  activeSettingsSection = targetSection;

  settingsSectionButtons.forEach((button) => {
    const isActive = button.dataset.settingsTarget === targetSection;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
    button.tabIndex = isActive ? 0 : -1;
    if (isActive && focusButton) {
      button.focus();
    }
  });

  settingsSectionPanels.forEach((panel) => {
    const isActive = panel.dataset.settingsPanel === targetSection;
    panel.classList.toggle('is-active', isActive);
    panel.hidden = !isActive;
  });

  localStorage.setItem(SETTINGS_SECTION_KEY, targetSection);
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

function setupSettingsSections(): void {
  const persisted = localStorage.getItem(SETTINGS_SECTION_KEY);
  if (persisted && SETTINGS_SECTION_ORDER.includes(persisted as SettingsSection)) {
    activeSettingsSection = persisted as SettingsSection;
  }

  settingsSectionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = (button.dataset.settingsTarget as SettingsSection) || 'general';
      setActiveSettingsSection(target);
    });

    button.addEventListener('keydown', (event) => {
      const key = event.key;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
      event.preventDefault();

      const buttons = Array.from(settingsSectionButtons);
      const currentIndex = buttons.indexOf(button);
      if (currentIndex < 0) return;

      let nextIndex = currentIndex;
      if (key === 'ArrowRight' || key === 'ArrowDown') nextIndex = (currentIndex + 1) % buttons.length;
      if (key === 'ArrowLeft' || key === 'ArrowUp') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      if (key === 'Home') nextIndex = 0;
      if (key === 'End') nextIndex = buttons.length - 1;

      const nextButton = buttons[nextIndex];
      const nextSection = (nextButton.dataset.settingsTarget as SettingsSection) || 'general';
      setActiveSettingsSection(nextSection, true);
    });
  });

  setActiveSettingsSection(activeSettingsSection);
}

function setSidebarCollapsedState(collapsed: boolean): void {
  isSidebarCollapsed = collapsed;
  appShellEl.classList.toggle('sidebar-collapsed', collapsed);
  sidebarToggleBtn.setAttribute('aria-expanded', String(!collapsed));
  sidebarToggleBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  sidebarToggleBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
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
  onboardingHotkeyInput.value = normalizeHotkeyInput(holdHotkeyInput.value) || defaultHotkeyForSlot('hold');
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

function setOnboardingHotkeyValidation(message: string, isError: boolean): void {
  onboardingHotkeyValidationEl.textContent = message;
  onboardingHotkeyValidationEl.classList.toggle('error', isError);
  onboardingHotkeyValidationEl.classList.toggle('hidden', message.trim().length === 0);
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

function canonicalizeNonModifierToken(input: string): string | null {
  const compactPart = input.replace(/\s+/g, '');
  const aliasKey = compactPart.toLowerCase();
  const normalizedAlias = NON_MODIFIER_ALIAS_TO_CANONICAL[aliasKey];
  if (normalizedAlias) {
    return normalizedAlias;
  }
  if (/^key[a-z]$/.test(aliasKey)) {
    return aliasKey.slice(3).toUpperCase();
  }
  if (/^[a-z]$/.test(aliasKey)) {
    return aliasKey.toUpperCase();
  }
  if (/^digit[0-9]$/.test(aliasKey)) {
    return aliasKey.slice(5);
  }
  if (/^[0-9]$/.test(aliasKey)) {
    return aliasKey;
  }
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(aliasKey)) {
    return aliasKey.toUpperCase();
  }
  if (/^numpad[0-9]$/.test(aliasKey)) {
    return `Num${aliasKey.slice(-1)}`;
  }
  if (/^num[0-9]$/.test(aliasKey)) {
    return `Num${aliasKey.slice(-1)}`;
  }
  switch (aliasKey) {
    case 'numpadadd':
    case 'numadd':
      return 'NumAdd';
    case 'numpaddecimal':
    case 'numdecimal':
      return 'NumDecimal';
    case 'numpaddivide':
    case 'numdivide':
      return 'NumDivide';
    case 'numpadenter':
    case 'numenter':
      return 'NumEnter';
    case 'numpadequal':
    case 'numequal':
      return 'NumEqual';
    case 'numpadmultiply':
    case 'nummultiply':
      return 'NumMultiply';
    case 'numpadsubtract':
    case 'numsubtract':
      return 'NumSubtract';
    default:
      return null;
  }
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
      const normalizedNonModifier = canonicalizeNonModifierToken(compactPart);
      if (normalizedNonModifier) {
        return normalizedNonModifier;
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
    return 'Choose a shortcut.';
  }

  const rawParts = trimmed.split('+').map((part) => part.trim());
  if (rawParts.some((part) => !part)) {
    return 'Hotkey contains an empty key segment. Remove extra + signs.';
  }

  const normalized = normalizeHotkeyInput(trimmed);
  const parts = normalized.split('+').filter(Boolean);
  const modifiers = parts.filter((part) => KNOWN_MODIFIERS.has(part));
  const nonModifiers = parts.filter((part) => !KNOWN_MODIFIERS.has(part));

  const duplicateModifier = modifiers.find((modifier, index) => modifiers.indexOf(modifier) !== index);
  if (duplicateModifier) {
    return `Duplicate modifier "${duplicateModifier}". Use each modifier once.`;
  }

  if (nonModifiers.length === 0) {
    return 'Add one key besides the modifiers.';
  }

  if (nonModifiers.length > 1) {
    return 'Use exactly one non-modifier key.';
  }

  if (!canonicalizeNonModifierToken(nonModifiers[0])) {
    return `Unsupported key "${nonModifiers[0]}". Use a real key like A, 1, Space, or F8.`;
  }

  const primaryKey = nonModifiers[0];
  const isFunctionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(primaryKey);
  if (isFunctionKey && modifiers.length === 0) {
    return null;
  }

  if (modifiers.length !== 1) {
    return 'Use exactly one modifier plus one key, or use a single F key.';
  }

  return null;
}

function hotkeyHasNonModifier(hotkey: string): boolean {
  return normalizeHotkeyInput(hotkey)
    .split('+')
    .some((part) => part && !KNOWN_MODIFIERS.has(part));
}

function keyTokenFromCode(code: string): string | null {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    return code;
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return `Num${code.slice(-1)}`;
  }
  switch (code) {
    case 'ArrowDown':
      return 'Down';
    case 'ArrowLeft':
      return 'Left';
    case 'ArrowRight':
      return 'Right';
    case 'ArrowUp':
      return 'Up';
    case 'Backquote':
      return '`';
    case 'Backslash':
      return '\\';
    case 'Backspace':
      return 'Backspace';
    case 'BracketLeft':
      return '[';
    case 'BracketRight':
      return ']';
    case 'Comma':
      return ',';
    case 'Delete':
      return 'Delete';
    case 'End':
      return 'End';
    case 'Enter':
      return 'Enter';
    case 'Equal':
      return '=';
    case 'Escape':
      return 'Escape';
    case 'Home':
      return 'Home';
    case 'Insert':
      return 'Insert';
    case 'Minus':
      return '-';
    case 'NumpadAdd':
      return 'NumAdd';
    case 'NumpadDecimal':
      return 'NumDecimal';
    case 'NumpadDivide':
      return 'NumDivide';
    case 'NumpadEnter':
      return 'NumEnter';
    case 'NumpadEqual':
      return 'NumEqual';
    case 'NumpadMultiply':
      return 'NumMultiply';
    case 'NumpadSubtract':
      return 'NumSubtract';
    case 'PageDown':
      return 'PageDown';
    case 'PageUp':
      return 'PageUp';
    case 'Period':
      return '.';
    case 'Quote':
      return "'";
    case 'Semicolon':
      return ';';
    case 'Slash':
      return '/';
    case 'Space':
      return 'Space';
    case 'Tab':
      return 'Tab';
    default:
      return null;
  }
}

function hotkeyFromKeyboardEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey) parts.push('Cmd');
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  const normalizedKey =
    keyTokenFromCode(event.code) ||
    (event.key && !MODIFIER_EVENT_KEYS.has(event.key) ? canonicalizeNonModifierToken(event.key) : null);
  if (normalizedKey) {
    parts.push(normalizedKey);
  }

  return normalizeHotkeyInput(parts.join('+'));
}

function createHotkeyToken(label: string): HTMLSpanElement {
  const token = document.createElement('span');
  token.className = 'hotkey-token';
  token.textContent = label;
  return token;
}

function hotkeyTokenDisplayLabel(token: string): string {
  switch (token) {
    case 'Alt':
      return PLATFORM_IS_MAC ? 'Option' : 'Alt';
    case 'Escape':
      return 'Esc';
    case 'PageDown':
      return 'PgDn';
    case 'PageUp':
      return 'PgUp';
    case 'NumAdd':
      return 'Num +';
    case 'NumDecimal':
      return 'Num .';
    case 'NumDivide':
      return 'Num /';
    case 'NumEnter':
      return 'Num Enter';
    case 'NumEqual':
      return 'Num =';
    case 'NumMultiply':
      return 'Num *';
    case 'NumSubtract':
      return 'Num -';
    default:
      return token;
  }
}

function renderHotkeyValue(target: HTMLElement, hotkey: string, emptyLabel = 'Not set'): void {
  const normalized = normalizeHotkeyInput(hotkey);
  const parts = normalized.split('+').filter(Boolean);
  target.replaceChildren();

  const wrapper = document.createElement('span');
  wrapper.className = 'hotkey-value';
  if (parts.length === 0) {
    wrapper.append(createHotkeyToken(emptyLabel));
  } else {
    parts.forEach((part) => {
      wrapper.append(createHotkeyToken(hotkeyTokenDisplayLabel(part)));
    });
  }
  target.append(wrapper);
}

function renderHotkeyTrigger(button: HTMLButtonElement, hotkey: string, isCapturing = false): void {
  button.classList.toggle('is-capturing', isCapturing);
  button.setAttribute('aria-pressed', String(isCapturing));
  if (isCapturing) {
    button.textContent = 'Press keys';
    return;
  }
  renderHotkeyValue(button, hotkey);
}

function renderShortcutTrigger(slot: ShortcutSlot, hotkey: string, isCapturing = false): void {
  renderHotkeyTrigger(hotkeyTriggerBtns[slot], hotkey, isCapturing);
}

function renderOnboardingHotkeyTrigger(hotkey: string, isCapturing = false): void {
  renderHotkeyTrigger(onboardingHotkeyCaptureBtn, hotkey, isCapturing);
}

function applyConfigUi(config: Pick<Settings, 'hold_hotkey' | 'toggle_hotkey' | 'recording_mode' | 'language'>): void {
  activeConfig = {
    hold_hotkey: normalizeHotkeyInput(config.hold_hotkey) || defaultHotkeyForSlot('hold'),
    toggle_hotkey: normalizeHotkeyInput(config.toggle_hotkey) || defaultHotkeyForSlot('toggle'),
    recording_mode: normalizeMode(config.recording_mode),
    language: normalizeLanguage(config.language)
  };

  const modeLabel = recordingModeLabel(activeConfig.recording_mode);
  const languageText = languageLabel(activeConfig.language);

  renderHotkeyValue(shortcutHoldHintEl, activeConfig.hold_hotkey);
  renderHotkeyValue(shortcutToggleHintEl, activeConfig.toggle_hotkey);
  renderShortcutTrigger('hold', activeConfig.hold_hotkey, activeHotkeyCaptureTarget === 'settings-hold');
  renderShortcutTrigger('toggle', activeConfig.toggle_hotkey, activeHotkeyCaptureTarget === 'settings-toggle');
  renderOnboardingHotkeyTrigger(
    onboardingHotkeyInput.value || activeConfig.hold_hotkey,
    activeHotkeyCaptureTarget === 'onboarding'
  );
  modeStatusTextEl.textContent = `${modeLabel}. ${languageText}.`;
}

function setRecordingActionLabels(
  isRecording: boolean,
  pendingAction: 'starting' | 'stopping' | null = null
): void {
  if (pendingAction === 'starting') {
    toggleBtn.textContent = 'Starting...';
    homeToggleBtn.textContent = 'Starting...';
    return;
  }

  if (pendingAction === 'stopping') {
    toggleBtn.textContent = 'Stopping...';
    homeToggleBtn.textContent = 'Stopping...';
    return;
  }

  const label = isRecording ? 'Stop recording' : 'Start recording';
  toggleBtn.textContent = label;
  homeToggleBtn.textContent = label;
}

function renderStatus(status: RuntimeStatus): void {
  lastRuntimeStatus = status;
  clearTogglePendingState(status.is_recording);
  const state = runtimeStateLabel(status);
  const bannerPresentation = runtimeStatusBannerPresentation(status);
  statusEl.textContent = status.last_message;
  setStatusBannerTone(bannerPresentation.tone, bannerPresentation.label);
  setRecordingActionLabels(status.is_recording);

  const level = Math.max(0, Math.min(100, Math.round(status.mic_level || 0)));
  micLevelValueEl.textContent = status.is_recording ? `${level}%` : '0%';
  micLevelBarEl.style.width = `${status.is_recording ? level : 0}%`;
  settingsRuntimeStatusEl.textContent = state;
}

function setToggleButtonsDisabled(disabled: boolean): void {
  toggleBtn.disabled = disabled;
  homeToggleBtn.disabled = disabled;
}

function clearTogglePendingState(nextIsRecording = Boolean(lastRuntimeStatus?.is_recording)): void {
  if (togglePendingTimeoutId !== null) {
    window.clearTimeout(togglePendingTimeoutId);
    togglePendingTimeoutId = null;
  }
  togglePendingAction = null;
  setToggleButtonsDisabled(false);
  setRecordingActionLabels(nextIsRecording);
}

function beginOptimisticToggleState(): boolean {
  if (togglePendingAction) return false;
  const nextAction: 'starting' | 'stopping' = lastRuntimeStatus?.is_recording ? 'stopping' : 'starting';
  togglePendingAction = nextAction;
  setToggleButtonsDisabled(true);
  setRecordingActionLabels(nextAction === 'starting', nextAction);
  setStatusBannerTone('processing', nextAction === 'starting' ? 'Starting' : 'Stopping');
  statusEl.textContent = nextAction === 'starting' ? 'Starting recording...' : 'Stopping recording...';
  togglePendingTimeoutId = window.setTimeout(() => {
    clearTogglePendingState();
  }, TOGGLE_PENDING_TIMEOUT_MS);
  return true;
}

async function requestToggleRecording(): Promise<void> {
  if (!beginOptimisticToggleState()) return;
  const optimisticNextState = togglePendingAction === 'starting';
  try {
    await invoke<void>('toggle_recording');
    clearTogglePendingState(optimisticNextState);
  } catch (error) {
    clearTogglePendingState(Boolean(lastRuntimeStatus?.is_recording));
    if (lastRuntimeStatus) {
      renderStatus(lastRuntimeStatus);
    }
    statusEl.textContent = `Toggle failed: ${String(error)}`;
  }
}

function renderFastModeState(formatEnabled: boolean): void {
  const fastModeEnabled = !formatEnabled;
  homeFastModeStateEl.textContent = fastModeEnabled ? 'ON' : 'OFF';
  homeFastModeBtn.textContent = fastModeEnabled ? 'Turn Fast Mode Off' : 'Turn Fast Mode On';
}

function renderAccessibilityStatus(status: AccessibilityPermissionStatus): void {
  lastAccessibilityStatus = status;
  const label = status.is_supported
    ? status.is_granted
      ? 'Enabled'
      : 'Needs access'
    : 'Unsupported';
  setAccessibilityStatusSummary(label);
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
    statusEl.textContent = message;
    setAccessibilityStatusSummary('Settings opened', true);
  } catch (error) {
    setAccessibilityStatusSummary('Open failed', true);
  } finally {
    button.disabled = false;
  }
}

function readSettingsFromForm(): Settings {
  return {
    api_key: apiKeyInput.value.trim(),
    prompt_template: promptTemplateInput.value.trim() || defaultPrompt,
    hold_hotkey: normalizeHotkeyInput(holdHotkeyInput.value),
    toggle_hotkey: normalizeHotkeyInput(toggleHotkeyInput.value),
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

function currentSettingsConfig(): Pick<Settings, 'hold_hotkey' | 'toggle_hotkey' | 'recording_mode' | 'language'> {
  return {
    hold_hotkey: normalizeHotkeyInput(holdHotkeyInput.value) || defaultHotkeyForSlot('hold'),
    toggle_hotkey: normalizeHotkeyInput(toggleHotkeyInput.value) || defaultHotkeyForSlot('toggle'),
    recording_mode: normalizeMode(recordingModeInput.value),
    language: normalizeLanguage(languageInput.value)
  };
}

function setSettingsHotkeyValidation(slot: ShortcutSlot, message: string, isError = false): void {
  const el = hotkeyValidationEls[slot];
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.toggle('hidden', message.trim().length === 0);
}

function validateDistinctHotkeys(): string | null {
  const holdValue = normalizeHotkeyInput(holdHotkeyInput.value);
  const toggleValue = normalizeHotkeyInput(toggleHotkeyInput.value);
  if (!holdValue || !toggleValue) return null;
  if (holdValue === toggleValue) {
    return 'Hold to speak and hands-free shortcuts must be different.';
  }
  return null;
}

function validateSettingsHotkeyInput(slot: ShortcutSlot): string | null {
  const input = hotkeyInputs[slot];
  const validationMessage = validateHotkey(input.value);
  if (validationMessage) {
    setSettingsHotkeyValidation(slot, validationMessage, true);
    return validationMessage;
  }

  input.value = normalizeHotkeyInput(input.value);

  const distinctError = validateDistinctHotkeys();
  if (distinctError) {
    setSettingsHotkeyValidation('hold', distinctError, true);
    setSettingsHotkeyValidation('toggle', distinctError, true);
    return distinctError;
  }

  setSettingsHotkeyValidation('hold', '', false);
  setSettingsHotkeyValidation('toggle', '', false);
  return null;
}

function validateOnboardingHotkeyInput(): string | null {
  const validationMessage = validateHotkey(onboardingHotkeyInput.value);
  if (validationMessage) {
    setOnboardingHotkeyValidation(validationMessage, true);
    return validationMessage;
  }

  onboardingHotkeyInput.value = normalizeHotkeyInput(onboardingHotkeyInput.value);
  renderOnboardingHotkeyTrigger(onboardingHotkeyInput.value, activeHotkeyCaptureTarget === 'onboarding');
  setOnboardingHotkeyValidation('', false);
  return null;
}

function settingsHotkeyCaptureSlot(target: HotkeyCaptureTarget): ShortcutSlot | null {
  if (target === 'settings-hold') return 'hold';
  if (target === 'settings-toggle') return 'toggle';
  return null;
}

function stopHotkeyCapture(message?: string, isError = false): void {
  if (!activeHotkeyCaptureTarget) return;
  const slot = settingsHotkeyCaptureSlot(activeHotkeyCaptureTarget);
  if (slot) {
    hotkeyTriggerBtns[slot].disabled = false;
    setSettingsHotkeyValidation(slot, isError ? message || '' : '', isError);
  } else {
    onboardingHotkeyCaptureBtn.disabled = false;
    setOnboardingHotkeyValidation(isError ? message || '' : '', isError);
  }
  activeHotkeyCaptureTarget = null;
  applyConfigUi({
    ...currentSettingsConfig()
  });
}

function startHotkeyCapture(target: HotkeyCaptureTarget): void {
  if (activeHotkeyCaptureTarget) {
    stopHotkeyCapture();
  }
  activeHotkeyCaptureTarget = target;
  const slot = settingsHotkeyCaptureSlot(target);
  if (slot) {
    hotkeyTriggerBtns[slot].disabled = false;
    setSettingsHotkeyValidation(slot, '', false);
  } else {
    onboardingHotkeyCaptureBtn.disabled = false;
    setOnboardingHotkeyValidation('', false);
  }
  applyConfigUi({
    ...currentSettingsConfig()
  });
}

function setupHotkeyCapture(): void {
  holdHotkeyTriggerBtn.addEventListener('click', () => {
    startHotkeyCapture('settings-hold');
  });
  toggleHotkeyTriggerBtn.addEventListener('click', () => {
    startHotkeyCapture('settings-toggle');
  });
  onboardingHotkeyCaptureBtn.addEventListener('click', () => {
    startHotkeyCapture('onboarding');
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
      if (!hotkeyHasNonModifier(candidate)) {
        return;
      }
      const validationMessage = validateHotkey(candidate);
      if (validationMessage) {
        const slot = settingsHotkeyCaptureSlot(activeHotkeyCaptureTarget);
        if (slot) {
          setSettingsHotkeyValidation(slot, validationMessage, true);
        } else {
          setOnboardingHotkeyValidation(validationMessage, true);
        }
        return;
      }

      const slot = settingsHotkeyCaptureSlot(activeHotkeyCaptureTarget);
      if (slot) {
        hotkeyInputs[slot].value = candidate;
        validateSettingsHotkeyInput('hold');
        validateSettingsHotkeyInput('toggle');
        applyConfigUi({
          ...currentSettingsConfig()
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
      hold_hotkey: savedSettings.hold_hotkey,
      toggle_hotkey: savedSettings.toggle_hotkey,
      recording_mode: savedSettings.recording_mode,
      language: savedSettings.language
    });
    holdHotkeyInput.value = normalizeHotkeyInput(savedSettings.hold_hotkey) || holdHotkeyInput.value;
    toggleHotkeyInput.value = normalizeHotkeyInput(savedSettings.toggle_hotkey) || toggleHotkeyInput.value;
    formatEnabledInput.checked = savedSettings.format_enabled;
    renderFastModeState(savedSettings.format_enabled);
    renderStatus(runtimeStatus);
    if (successMessage !== 'Saved settings.') {
      statusEl.textContent = successMessage;
    }
    return true;
  } catch (error) {
    const errorText = String(error);
    const normalizedError = errorText.toLowerCase();
    if (isShortcutRelatedMessage(errorText)) {
      focusShortcutSettings();
      if (normalizedError.includes('hold')) {
        setSettingsHotkeyValidation('hold', errorText, true);
        setSettingsHotkeyValidation('toggle', '', false);
      } else if (normalizedError.includes('toggle') || normalizedError.includes('hands-free')) {
        setSettingsHotkeyValidation('toggle', errorText, true);
        setSettingsHotkeyValidation('hold', '', false);
      } else {
        setSettingsHotkeyValidation('hold', errorText, true);
        setSettingsHotkeyValidation('toggle', errorText, true);
      }
      statusEl.textContent = errorText;
      return false;
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
  holdHotkeyInput.value = onboardingHotkey;
  recordingModeInput.value = normalizeMode(onboardingRecordingModeInput.value);
  languageInput.value = normalizeLanguage(onboardingLanguageInput.value);
  validateSettingsHotkeyInput('hold');
  validateSettingsHotkeyInput('toggle');
  applyConfigUi({
    ...currentSettingsConfig()
  });
  return null;
}

function formatHistoryTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString();
}

function countTranscriptWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (WORD_SEGMENTER) {
    let count = 0;
    for (const segment of WORD_SEGMENTER.segment(trimmed)) {
      if (segment.isWordLike) {
        count += 1;
      }
    }
    return count;
  }
  return trimmed.split(/\s+/).filter(Boolean).length;
}

function formatSavedTime(minutes: number): string {
  const roundedMinutes = Math.max(0, Math.round(minutes));
  if (roundedMinutes < 60) return `${roundedMinutes}m`;
  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}

function computeHistoryStats(entries: TranscriptHistoryEntry[]): {
  activeDays: number;
  totalWords: number;
  estimatedMinutesSaved: number;
} {
  const activeDays = new Set(entries.map((entry) => historyDayKey(entry.created_at_ms))).size;
  const totalWords = entries.reduce((sum, entry) => sum + countTranscriptWords(entry.final_output), 0);
  const typingMinutes = totalWords / ESTIMATED_TYPING_WPM;
  const dictationMinutes = totalWords / ESTIMATED_DICTATION_WPM;
  return {
    activeDays,
    totalWords,
    estimatedMinutesSaved: Math.max(0, typingMinutes - dictationMinutes)
  };
}

async function copyTextWithStatus(text: string, successMessage: string): Promise<void> {
  await invoke('copy_text_to_clipboard', { text });
  statusEl.textContent = successMessage;
}

function appToastIconSvg(tone: AppToastTone): string {
  if (tone === 'error') {
    return `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6.5 6.5 17.5 17.5"></path>
        <path d="M17.5 6.5 6.5 17.5"></path>
      </svg>
    `;
  }
  return `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 12.5 9.5 17 19 7.5"></path>
    </svg>
  `;
}

function showAppToast(message: string, tone: AppToastTone = 'success'): void {
  if (appToastTimeoutId !== null) {
    window.clearTimeout(appToastTimeoutId);
    appToastTimeoutId = null;
  }
  appToastEl.dataset.tone = tone;
  appToastIconEl.innerHTML = appToastIconSvg(tone);
  appToastTextEl.textContent = message;
  appToastEl.classList.add('is-visible');
  appToastEl.setAttribute('aria-hidden', 'false');
  appToastTimeoutId = window.setTimeout(() => {
    appToastEl.classList.remove('is-visible');
    appToastEl.setAttribute('aria-hidden', 'true');
    appToastTimeoutId = null;
  }, APP_TOAST_TIMEOUT_MS);
}

function markHistoryEntryCopied(entryId: number): void {
  historyCopiedEntryId = entryId;
  if (historyCopyFeedbackTimeoutId !== null) {
    window.clearTimeout(historyCopyFeedbackTimeoutId);
    historyCopyFeedbackTimeoutId = null;
  }
  historyCopyFeedbackTimeoutId = window.setTimeout(() => {
    historyCopiedEntryId = null;
    historyCopyFeedbackTimeoutId = null;
    renderHistory(historyEntries);
  }, HISTORY_COPY_FEEDBACK_TIMEOUT_MS);
}

async function handleHistoryEntryCopy(entry: TranscriptHistoryEntry): Promise<void> {
  historySelectedEntryId = entry.id;
  renderHistory(historyEntries);
  try {
    await invoke('copy_text_to_clipboard', { text: entry.final_output });
    markHistoryEntryCopied(entry.id);
    showAppToast('Copied');
  } catch (error) {
    showAppToast('Copy failed', 'error');
    statusEl.textContent = `Copy failed: ${String(error)}`;
  } finally {
    renderHistory(historyEntries);
  }
}

function createTranscriptRow(
  entry: TranscriptHistoryEntry,
  options: {
    active?: boolean;
    staticMain?: boolean;
    onMainClick?: (() => void) | null;
    actionMode?: TranscriptRowActionMode;
    isCopied?: boolean;
  } = {}
): HTMLDivElement {
  const rowEl = document.createElement('div');
  rowEl.className = 'history-row';
  if (options.active) {
    rowEl.classList.add('is-active');
  }

  const onMainClick = options.onMainClick ?? null;
  const mainEl = onMainClick ? document.createElement('button') : document.createElement('div');
  if (mainEl instanceof HTMLButtonElement && onMainClick) {
    mainEl.type = 'button';
    mainEl.addEventListener('click', onMainClick);
    mainEl.setAttribute(
      'aria-label',
      `Transcript from ${formatHistoryDayLabel(entry.created_at_ms)} at ${formatHistoryTime(entry.created_at_ms)}`
    );
  }
  mainEl.className = 'history-row-main';
  if (options.staticMain || !options.onMainClick) {
    mainEl.classList.add('is-static');
  }

  const timeEl = document.createElement('span');
  timeEl.className = 'history-row-time';
  timeEl.textContent = formatHistoryTime(entry.created_at_ms);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'history-row-body';

  const textEl = document.createElement('p');
  textEl.className = 'history-row-text';
  textEl.textContent = entry.final_output.trim() || 'Empty transcript';

  bodyEl.append(textEl);
  mainEl.append(timeEl, bodyEl);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'history-row-actions';
  const actionMode = options.actionMode ?? 'button';

  if (actionMode === 'indicator') {
    const indicatorEl = document.createElement('span');
    indicatorEl.className = 'history-row-indicator';

    const iconEl = document.createElement('span');
    iconEl.className = 'history-row-indicator-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.innerHTML = options.isCopied
      ? `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12.5 9.5 17 19 7.5"></path>
          </svg>
        `
      : `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="10" height="10" rx="2"></rect>
            <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path>
          </svg>
        `;

    const labelEl = document.createElement('span');
    labelEl.className = 'history-row-indicator-label';
    labelEl.textContent = options.isCopied ? 'Copied' : '';

    indicatorEl.classList.add(options.isCopied ? 'is-copied' : 'is-idle');
    indicatorEl.append(iconEl, labelEl);
    actionsEl.append(indicatorEl);
  } else {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'history-copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.setAttribute(
      'aria-label',
      `Copy transcript from ${formatHistoryDayLabel(entry.created_at_ms)} at ${formatHistoryTime(entry.created_at_ms)}`
    );
    copyBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      copyBtn.disabled = true;
      try {
        await copyTextWithStatus(entry.final_output, 'Transcript copied to clipboard.');
      } catch (error) {
        statusEl.textContent = `Copy failed: ${String(error)}`;
      } finally {
        copyBtn.disabled = false;
      }
    });
    actionsEl.append(copyBtn);
  }

  rowEl.append(mainEl, actionsEl);
  return rowEl;
}

function renderHomeOverview(): void {
  const stats = computeHistoryStats(historyEntries);
  homeStatDaysEl.textContent = NUMBER_FORMATTER.format(stats.activeDays);
  homeStatWordsEl.textContent = NUMBER_FORMATTER.format(stats.totalWords);
  homeStatSavedEl.textContent = formatSavedTime(stats.estimatedMinutesSaved);

  const recentEntries = historyEntries.slice(0, HOME_RECENT_LIMIT);
  homeRecentFeedEl.replaceChildren();
  homeRecentEmptyEl.hidden = recentEntries.length > 0;
  if (recentEntries.length === 0) {
    return;
  }

  for (const entry of recentEntries) {
    homeRecentFeedEl.append(createTranscriptRow(entry, { staticMain: true }));
  }
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

function isSameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatHistoryTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function historyDayKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatHistoryDayLabel(timestampMs: number): string {
  const entryDate = new Date(timestampMs);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameCalendarDay(entryDate, today)) return 'Today';
  if (isSameCalendarDay(entryDate, yesterday)) return 'Yesterday';
  return entryDate.toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: entryDate.getFullYear() === today.getFullYear() ? undefined : 'numeric'
  });
}

function groupHistoryEntries(entries: TranscriptHistoryEntry[]): HistoryDayGroup[] {
  const groups: HistoryDayGroup[] = [];
  for (const entry of entries) {
    const key = historyDayKey(entry.created_at_ms);
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup || lastGroup.key !== key) {
      groups.push({
        key,
        label: formatHistoryDayLabel(entry.created_at_ms),
        entries: [entry]
      });
      continue;
    }
    lastGroup.entries.push(entry);
  }
  return groups;
}

function getVisibleHistoryEntries(): TranscriptHistoryEntry[] {
  const query = historySearchInput.value.trim().toLowerCase();
  if (!query) return historyEntries;
  return historyEntries.filter((entry) => {
    const haystack = `${entry.final_output} ${entry.source_app || ''}`.toLowerCase();
    return haystack.includes(query);
  });
}

function renderHistory(entries: TranscriptHistoryEntry[]): void {
  historyEntries = [...entries].sort((a, b) => b.created_at_ms - a.created_at_ms);
  renderHomeOverview();
  const visibleEntries = getVisibleHistoryEntries();
  if (historySelectedEntryId && !visibleEntries.some((entry) => entry.id === historySelectedEntryId)) {
    historySelectedEntryId = null;
  }

  historyFeedEl.innerHTML = '';
  historyEmptyEl.hidden = visibleEntries.length > 0;
  if (visibleEntries.length === 0) {
    historyEmptyEl.textContent = historyEntries.length === 0 ? 'No transcript history yet.' : 'No matching transcripts.';
    return;
  }
  historyEmptyEl.textContent = 'No transcript history yet.';

  const groupedEntries = groupHistoryEntries(visibleEntries);
  let selectedRow: HTMLDivElement | null = null;

  for (const group of groupedEntries) {
    const groupEl = document.createElement('section');
    groupEl.className = 'history-day-group';

    const dayLabelEl = document.createElement('p');
    dayLabelEl.className = 'history-day-label';
    dayLabelEl.textContent = group.label;

    const dayCardEl = document.createElement('div');
    dayCardEl.className = 'history-day-card';

    for (const entry of group.entries) {
      const rowEl = createTranscriptRow(entry, {
        active: entry.id === historySelectedEntryId,
        actionMode: 'indicator',
        isCopied: entry.id === historyCopiedEntryId,
        onMainClick: () => {
          void handleHistoryEntryCopy(entry);
        }
      });
      if (entry.id === historySelectedEntryId) {
        historySelectedEntryId = entry.id;
        selectedRow = rowEl;
      }
      dayCardEl.append(rowEl);
    }

    groupEl.append(dayLabelEl, dayCardEl);
    historyFeedEl.append(groupEl);
  }

  if (selectedRow && shouldScrollHistorySelection) {
    requestAnimationFrame(() => {
      selectedRow?.scrollIntoView({ block: 'center' });
    });
  }
  shouldScrollHistorySelection = false;
}

async function loadHistory(): Promise<void> {
  const entries = await invoke<TranscriptHistoryEntry[]>('get_transcript_history');
  renderHistory(entries);
}

async function loadInitial(): Promise<void> {
  const settings = await invoke<Settings>('get_settings');
  apiKeyInput.value = settings.api_key;
  promptTemplateInput.value = settings.prompt_template || defaultPrompt;
  holdHotkeyInput.value = normalizeHotkeyInput(settings.hold_hotkey) || defaultHotkeyForSlot('hold');
  toggleHotkeyInput.value = normalizeHotkeyInput(settings.toggle_hotkey) || defaultHotkeyForSlot('toggle');
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
    hold_hotkey: holdHotkeyInput.value,
    toggle_hotkey: toggleHotkeyInput.value,
    recording_mode: normalizeMode(settings.recording_mode),
    language: normalizeLanguage(settings.language)
  });
  renderFastModeState(settings.format_enabled);
  validateSettingsHotkeyInput('hold');
  validateSettingsHotkeyInput('toggle');

  const status = await invoke<RuntimeStatus>('get_runtime_status');
  renderStatus(status);
  if (isShortcutRelatedMessage(status.last_message)) {
    focusShortcutSettings();
  }
  await loadHistory();
  const draft = await invoke<DurableDraft | null>('get_durable_draft');
  renderDurableDraft(draft);
  lastDebugLogLines = await invoke<string[]>('get_debug_log');

  setAccessibilityStatusSummary('Checking...', true);
  try {
    const permissionStatus = await checkAndRenderAccessibilityStatus();
    if (shouldPromptForAccessibility(permissionStatus)) {
      showAccessibilityModal();
    }
  } catch (error) {
    setAccessibilityStatusSummary('Check failed', true);
  }

  if (!isOnboardingCompleted()) {
    setActiveTab('settings');
    showOnboarding();
  }
}

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
    ...currentSettingsConfig()
  });
});

languageInput.addEventListener('change', () => {
  applyConfigUi({
    ...currentSettingsConfig()
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const holdHotkeyError = validateSettingsHotkeyInput('hold');
  const toggleHotkeyError = validateSettingsHotkeyInput('toggle');
  const hotkeyError = holdHotkeyError || toggleHotkeyError || validateDistinctHotkeys();
  if (hotkeyError) {
    focusShortcutSettings();
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

draftRestoreCopyBtn.addEventListener('click', async () => {
  if (!durableDraft?.text?.trim()) return;
  draftRestoreCopyBtn.disabled = true;
  try {
    await copyTextWithStatus(durableDraft.text, 'Recovered draft copied to clipboard.');
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
  setAccessibilityStatusSummary('Checking...', true);
  try {
    await checkAndRenderAccessibilityStatus();
  } catch (error) {
    setAccessibilityStatusSummary('Check failed', true);
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
    lastDebugLogLines = await invoke<string[]>('get_debug_log');
    await invoke('copy_text_to_clipboard', { text: buildDiagnosticsReport(lastDebugLogLines) });
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

listen<TranscriptHistoryEntry[]>('transcript-history-updated', (event) => {
  renderHistory(event.payload);
}).catch((error) => {
  statusEl.textContent = `History listener failed: ${String(error)}`;
});

historySearchInput.addEventListener('input', () => {
  renderHistory(historyEntries);
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
setupSettingsSections();
setupSidebar();
setupHotkeyCapture();
applyBranding();
new MutationObserver(() => {
  syncStatusBannerFromText();
}).observe(statusEl, { childList: true, characterData: true, subtree: true });
syncStatusBannerFromText();

loadInitial().catch((error) => {
  statusEl.textContent = `Initialization failed: ${String(error)}`;
});
