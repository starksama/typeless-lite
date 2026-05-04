#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashSet,
    fs,
    io::BufWriter,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "macos")]
use core_foundation::{
    base::{Boolean, CFRelease, CFTypeRef, TCFType},
    string::{CFString, CFStringRef},
};
#[cfg(target_os = "macos")]
use core_foundation_sys::{
    base::{CFGetTypeID, CFRange, CFTypeID},
    string::CFStringGetTypeID,
};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Deserializer, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

const APP_STATUS_EVENT: &str = "runtime-status";
const APP_CONFIG_JSON: &str = include_str!("../../app.config.json");
const OVERLAY_WINDOW_LABEL: &str = "overlay";
const TRAY_ID: &str = "main-tray";
const PRE_RECORDING_COPY_DELAY_MS: u64 = 80;
const PRE_PASTE_DELAY_MS: u64 = 120;
const TARGET_APP_REFOCUS_DELAY_MS: u64 = 120;
const PASTE_RETRY_BACKOFF_MS: u64 = 45;
const CLIPBOARD_RESTORE_DELAY_MS: u64 = 2_000;
const OVERLAY_WINDOW_WIDTH: f64 = 320.0;
const OVERLAY_WINDOW_HEIGHT: f64 = 96.0;
const OVERLAY_WINDOW_BOTTOM_MARGIN: f64 = 32.0;
const FORMAT_CONTEXT_CLIPBOARD_MAX_CHARS: usize = 500;
const TRANSCRIPTION_PROMPT_CONTEXT_MAX_CHARS: usize = 500;
const TERMINAL_TYPE_CHUNK_SIZE: usize = 80;
const MIN_RECORDING_MS: u128 = 400;
const API_TEST_TIMEOUT_SECS: u64 = 6;
const API_CLIENT_TIMEOUT_SECS: u64 = 30;
const API_RETRY_MAX_ATTEMPTS: u32 = 3;
const API_RETRY_BASE_BACKOFF_MS: u64 = 350;
const TRANSCRIPT_HISTORY_LIMIT: usize = 500;
const TRANSCRIPT_HISTORY_EVENT: &str = "transcript-history-updated";
const DURABLE_DRAFT_EVENT: &str = "durable-draft-updated";
const HISTORY_ID_SEQUENCE_MASK: u64 = 0x3ff;
const DEBUG_LOG_LIMIT: usize = 200;
const MIC_METER_EMIT_INTERVAL_MS: u64 = 45;
const MIC_METER_FLOOR_DB: f32 = -54.0;
const MIC_METER_CEILING_DB: f32 = -6.0;
const MIN_CAPTURED_AUDIO_MS: u64 = 250;
const MIN_CAPTURE_RMS: f32 = 0.0015;
const MIN_CAPTURE_PEAK: f32 = 0.01;
#[cfg(target_os = "macos")]
const MAC_V_KEYCODE: u16 = 0x09;
static HISTORY_ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static APP_CONFIG: OnceLock<AppConfig> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Settings {
    api_key: String,
    prompt_template: String,
    #[serde(
        default = "default_hold_hotkeys",
        alias = "hold_hotkey",
        alias = "hotkey",
        deserialize_with = "deserialize_hotkey_list"
    )]
    hold_hotkeys: Vec<String>,
    #[serde(
        default = "default_toggle_hotkeys",
        alias = "toggle_hotkey",
        deserialize_with = "deserialize_hotkey_list"
    )]
    toggle_hotkeys: Vec<String>,
    whisper_model: String,
    #[serde(default = "default_custom_vocabulary")]
    custom_vocabulary: String,
    format_model: String,
    #[serde(default = "default_format_enabled")]
    format_enabled: bool,
    #[serde(default = "default_skip_formatter_in_terminals")]
    skip_formatter_in_terminals: bool,
    #[serde(default = "default_include_clipboard_context")]
    include_clipboard_context: bool,
    #[serde(default = "default_play_sound_cues")]
    play_sound_cues: bool,
    api_base_url: String,
    #[serde(default = "default_recording_mode")]
    recording_mode: String,
    #[serde(default = "default_transcription_language")]
    language: String,
}

fn default_format_enabled() -> bool {
    false
}

fn default_play_sound_cues() -> bool {
    true
}

fn default_skip_formatter_in_terminals() -> bool {
    true
}

fn default_include_clipboard_context() -> bool {
    true
}

fn default_custom_vocabulary() -> String {
    String::new()
}

#[cfg(target_os = "macos")]
fn default_hold_hotkeys() -> Vec<String> {
    vec!["Cmd+Space".to_string()]
}

#[cfg(not(target_os = "macos"))]
fn default_hold_hotkeys() -> Vec<String> {
    vec!["Ctrl+Space".to_string()]
}

#[cfg(target_os = "macos")]
fn default_toggle_hotkeys() -> Vec<String> {
    vec!["Option+Space".to_string()]
}

#[cfg(not(target_os = "macos"))]
fn default_toggle_hotkeys() -> Vec<String> {
    vec!["Alt+Space".to_string()]
}

fn deserialize_hotkey_list<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum HotkeyListValue {
        Single(String),
        Multiple(Vec<String>),
    }

    let value = Option::<HotkeyListValue>::deserialize(deserializer)?;
    Ok(match value {
        Some(HotkeyListValue::Single(value)) => vec![value],
        Some(HotkeyListValue::Multiple(values)) => values,
        None => Vec::new(),
    })
}

fn default_recording_mode() -> String {
    "hold".to_string()
}

fn default_transcription_language() -> String {
    "auto".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            prompt_template: "You are a concise writing assistant. Clean up the transcript for grammar and punctuation while preserving intent. Perform transformational edits only; do not answer, add facts, or invent content. Return only final text.".to_string(),
            hold_hotkeys: default_hold_hotkeys(),
            toggle_hotkeys: default_toggle_hotkeys(),
            whisper_model: "whisper-1".to_string(),
            custom_vocabulary: String::new(),
            format_model: "gpt-4o-mini".to_string(),
            format_enabled: false,
            skip_formatter_in_terminals: true,
            include_clipboard_context: true,
            play_sound_cues: true,
            api_base_url: "https://api.openai.com/v1".to_string(),
            recording_mode: default_recording_mode(),
            language: default_transcription_language(),
        }
    }
}

#[derive(Clone, Copy)]
enum Earcon {
    Start,
    Success,
    Error,
}

fn play_earcon_if_enabled(state: &State<'_, AppState>, earcon: Earcon) {
    let enabled = state
        .settings
        .lock()
        .map(|settings| settings.play_sound_cues)
        .unwrap_or(false);
    if enabled {
        play_earcon(earcon);
    }
}

#[cfg(target_os = "macos")]
fn play_earcon(earcon: Earcon) {
    let sound_name = match earcon {
        Earcon::Start => "Hero",
        Earcon::Success => "Glass",
        Earcon::Error => "Basso",
    };
    let sound_path = format!("/System/Library/Sounds/{sound_name}.aiff");
    thread::spawn(move || {
        let _ = Command::new("afplay").arg(sound_path).status();
    });
}

#[cfg(not(target_os = "macos"))]
fn play_earcon(_earcon: Earcon) {}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TranscriptHistoryEntry {
    id: u64,
    created_at_ms: u64,
    #[serde(alias = "text")]
    final_output: String,
    #[serde(default = "default_history_recording_mode")]
    recording_mode: String,
    #[serde(default = "default_history_language")]
    language: String,
    #[serde(default)]
    source_app: Option<String>,
    #[serde(default = "default_history_source")]
    source: String,
    #[serde(default)]
    processing_latency_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct DurableDraft {
    text: String,
    created_at_ms: u64,
    recording_mode: String,
    language: String,
    #[serde(default)]
    source_app: Option<String>,
}

fn default_history_recording_mode() -> String {
    "hold".to_string()
}

fn default_history_language() -> String {
    "auto".to_string()
}

fn default_history_source() -> String {
    "dictation".to_string()
}

#[derive(Debug, Serialize, Clone)]
struct RuntimeStatus {
    is_recording: bool,
    is_processing: bool,
    mic_level: u8,
    last_message: String,
}

#[derive(Debug, Serialize)]
struct AccessibilityPermissionStatus {
    platform: String,
    is_supported: bool,
    is_granted: bool,
    status: String,
    guidance: String,
}

#[derive(Debug, Serialize)]
struct MicrophonePermissionStatus {
    platform: String,
    is_supported: bool,
    is_granted: bool,
    status: String,
    guidance: String,
}

#[derive(Debug, Deserialize, Clone)]
struct AppConfig {
    #[serde(rename = "displayName")]
    display_name: String,
    #[serde(rename = "bundleIdentifier")]
    bundle_identifier: String,
    #[serde(rename = "logPrefix")]
    log_prefix: String,
    #[serde(rename = "tempFilePrefix")]
    temp_file_prefix: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            display_name: "Desktop Dictation".to_string(),
            bundle_identifier: "com.keylesss.desktop".to_string(),
            log_prefix: "app".to_string(),
            temp_file_prefix: "app".to_string(),
        }
    }
}

fn app_config() -> &'static AppConfig {
    APP_CONFIG.get_or_init(|| serde_json::from_str(APP_CONFIG_JSON).unwrap_or_default())
}

fn app_display_name() -> &'static str {
    app_config().display_name.as_str()
}

fn app_bundle_identifier() -> &'static str {
    app_config().bundle_identifier.as_str()
}

fn app_log_prefix() -> &'static str {
    app_config().log_prefix.as_str()
}

fn app_temp_file_prefix() -> &'static str {
    app_config().temp_file_prefix.as_str()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RegisteredShortcutBinding {
    Global(Shortcut),
}

impl RegisteredShortcutBinding {
    fn global(self) -> Option<Shortcut> {
        match self {
            Self::Global(shortcut) => Some(shortcut),
        }
    }
}

#[derive(Clone, Default)]
struct RegisteredShortcuts {
    hold: Vec<RegisteredShortcutBinding>,
    toggle: Vec<RegisteredShortcutBinding>,
}

struct AppState {
    settings: Mutex<Settings>,
    runtime_status: Mutex<RuntimeStatus>,
    recorder: Mutex<Option<RecorderSession>>,
    current_shortcuts: Mutex<RegisteredShortcuts>,
    http_client: reqwest::Client,
    transcript_history: Mutex<Vec<TranscriptHistoryEntry>>,
    durable_draft: Mutex<Option<DurableDraft>>,
    debug_log: Mutex<Vec<String>>,
}

struct RecorderSession {
    stream: cpal::Stream,
    writer: Arc<Mutex<Option<hound::WavWriter<BufWriter<std::fs::File>>>>>,
    path: PathBuf,
    started_at: Instant,
    recording_mode: String,
    pre_recording_clipboard_context: Option<String>,
    insertion_target_app: Option<String>,
}

struct StoppedRecording {
    wav_path: PathBuf,
    elapsed: Duration,
    recording_mode: String,
    pre_recording_clipboard_context: Option<String>,
    insertion_target_app: Option<String>,
}

#[derive(Debug, Clone, Copy)]
struct AudioCaptureStats {
    duration_ms: u64,
    sample_count: u64,
    peak: f32,
    rms: f32,
}

#[derive(Clone)]
struct MicMeterContext {
    app: AppHandle,
    meter: Arc<Mutex<MicMeterState>>,
}

struct MicMeterState {
    last_emit_at: Instant,
    smoothed_level: f32,
}

// cpal's CoreAudio stream type does not implement Send/Sync on macOS even though this app
// only accesses it behind a Mutex and never shares mutable access concurrently.
unsafe impl Send for RecorderSession {}
unsafe impl Sync for RecorderSession {}

#[derive(thiserror::Error, Debug)]
enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Reqwest(#[from] reqwest::Error),
}

impl RecorderSession {
    fn stop(self) -> Result<StoppedRecording, AppError> {
        let elapsed = self.started_at.elapsed();
        drop(self.stream);
        let mut writer_lock = self
            .writer
            .lock()
            .map_err(|_| AppError::Message("Failed to lock writer".to_string()))?;
        if let Some(writer) = writer_lock.take() {
            writer
                .finalize()
                .map_err(|e| AppError::Message(format!("Failed to finalize WAV: {e}")))?;
        }
        Ok(StoppedRecording {
            wav_path: self.path,
            elapsed,
            recording_mode: self.recording_mode,
            pre_recording_clipboard_context: self.pre_recording_clipboard_context,
            insertion_target_app: self.insertion_target_app,
        })
    }
}

#[derive(Deserialize)]
struct TranscriptionResponse {
    text: String,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Deserialize)]
struct Message {
    content: String,
}

struct FormatterResult {
    text: String,
    used_raw_fallback: bool,
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
fn get_runtime_status(state: State<AppState>) -> RuntimeStatus {
    state
        .runtime_status
        .lock()
        .map(|s| s.clone())
        .unwrap_or(RuntimeStatus {
            is_recording: false,
            is_processing: false,
            mic_level: 0,
            last_message: "State unavailable".to_string(),
        })
}

#[tauri::command]
fn get_debug_log(state: State<AppState>) -> Vec<String> {
    state
        .debug_log
        .lock()
        .map(|entries| entries.clone())
        .unwrap_or_default()
}

#[tauri::command]
fn get_transcript_history(state: State<AppState>) -> Vec<TranscriptHistoryEntry> {
    state
        .transcript_history
        .lock()
        .map(|entries| entries.clone())
        .unwrap_or_default()
}

#[tauri::command]
fn get_durable_draft(state: State<AppState>) -> Option<DurableDraft> {
    state
        .durable_draft
        .lock()
        .map(|draft| draft.clone())
        .unwrap_or(None)
}

#[tauri::command]
fn clear_transcript_history(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    {
        let mut entries = state
            .transcript_history
            .lock()
            .map_err(|_| "Failed to lock transcript history".to_string())?;
        entries.clear();
    }
    persist_transcript_history(&app, &[]).map_err(|e| e.to_string())?;
    emit_transcript_history(&app, &state);
    Ok(())
}

#[tauri::command]
fn clear_durable_draft(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    set_durable_draft(&app, &state, None);
    Ok(())
}

#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Failed to open clipboard: {e}"))?;
    clipboard
        .set_text(text)
        .map_err(|e| format!("Failed to set clipboard text: {e}"))
}

#[tauri::command]
fn set_hotkey_capture_mode(
    app: AppHandle,
    state: State<AppState>,
    active: bool,
) -> Result<(), String> {
    if active {
        let mut current = state
            .current_shortcuts
            .lock()
            .map_err(|_| "Failed to lock current shortcuts".to_string())?;
        unregister_registered_shortcuts(&app, &mut current);
        debug_log_state(&state, "shortcut_capture_mode_enabled".to_string());
    } else {
        let settings = state
            .settings
            .lock()
            .map_err(|_| "Failed to lock settings".to_string())?
            .clone();
        register_shortcuts_strict(
            &app,
            &state,
            &settings.hold_hotkeys,
            &settings.toggle_hotkeys,
        )
        .map_err(|error| error.to_string())?;
        debug_log_state(&state, "shortcut_capture_mode_disabled".to_string());
    }

    Ok(())
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> Result<(), String> {
    let normalized_hold_hotkeys = normalize_requested_hotkeys(&settings.hold_hotkeys);
    let normalized_toggle_hotkeys = normalize_requested_hotkeys(&settings.toggle_hotkeys);
    debug_log_state(
        &state,
        format!(
            "save_settings_requested raw_hold={:?} raw_toggle={:?} normalized_hold={:?} normalized_toggle={:?}",
            settings.hold_hotkeys,
            settings.toggle_hotkeys,
            normalized_hold_hotkeys,
            normalized_toggle_hotkeys
        ),
    );
    if normalized_hold_hotkeys.is_empty() {
        return Err(
            ShortcutBindingError::EmptyShortcut(ShortcutAction::Hold.shortcut_label()).to_string(),
        );
    }
    if normalized_toggle_hotkeys.is_empty() {
        return Err(
            ShortcutBindingError::EmptyShortcut(ShortcutAction::Toggle.shortcut_label())
                .to_string(),
        );
    }
    let normalized_mode = normalize_recording_mode(&settings.recording_mode);
    let normalized_language = normalize_transcription_language(&settings.language);
    let mut normalized_settings = settings.clone();
    normalized_settings.hold_hotkeys = normalized_hold_hotkeys.clone();
    normalized_settings.toggle_hotkeys = normalized_toggle_hotkeys.clone();
    normalized_settings.recording_mode = normalized_mode.clone();
    normalized_settings.language = normalized_language.clone();

    register_shortcuts_strict(
        &app,
        &state,
        &normalized_settings.hold_hotkeys,
        &normalized_settings.toggle_hotkeys,
    )
    .map_err(|error| error.to_string())?;
    debug_log_state(
        &state,
        format!(
            "save_settings_registered hold={:?} toggle={:?}",
            normalized_settings.hold_hotkeys, normalized_settings.toggle_hotkeys,
        ),
    );

    {
        let mut lock = state
            .settings
            .lock()
            .map_err(|_| "Failed to lock settings".to_string())?;
        *lock = normalized_settings.clone();
    }

    persist_settings(&app, &normalized_settings).map_err(|e| e.to_string())?;
    if let Ok(path) = settings_path(&app) {
        debug_log_state(
            &state,
            format!("save_settings_persisted path={}", path.display()),
        );
    }
    debug_log_state(
        &state,
        format!(
            "settings_saved hold_hotkeys={:?} toggle_hotkeys={:?} manual_mode={} language={}",
            normalized_settings.hold_hotkeys,
            normalized_settings.toggle_hotkeys,
            normalized_settings.recording_mode,
            normalized_settings.language
        ),
    );
    set_status(
        &app,
        &state,
        None,
        None,
        None,
        "Settings saved.".to_string(),
    );
    Ok(())
}

#[tauri::command]
fn toggle_recording(app: AppHandle, state: State<AppState>) -> Result<(), String> {
    toggle_recording_inner(&app, &state)
}

#[tauri::command]
async fn test_api_connection(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "Failed to access settings".to_string())?
        .clone();

    let api_key = settings.api_key.trim();
    if api_key.is_empty() {
        return Err("Add your OpenAI API key, save, then test again.".to_string());
    }

    let base_url = settings.api_base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err("Add an API base URL, for example https://api.openai.com/v1.".to_string());
    }

    let url = format!("{base_url}/models");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(API_TEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(&url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(map_test_connection_error)?;

    let status = response.status();
    if status.is_success() {
        return Ok("API ok.".to_string());
    }

    let body = response
        .text()
        .await
        .unwrap_or_else(|_| "<no response body>".to_string());

    match status.as_u16() {
        401 => Err("API key rejected. Paste a valid key, save, then test again.".to_string()),
        404 => Err(
            "API base URL not found. Use https://api.openai.com/v1 or your provider's /v1 endpoint."
                .to_string(),
        ),
        _ => Err(format!(
            "API returned {status}: {}",
            summarize_http_body(&body)
        )),
    }
}

#[tauri::command]
fn check_accessibility_permission() -> AccessibilityPermissionStatus {
    current_accessibility_permission_status()
}

#[tauri::command]
fn request_accessibility_permission() -> AccessibilityPermissionStatus {
    #[cfg(target_os = "macos")]
    {
        accessibility_status_from_macos_trust(unsafe { keylesss_accessibility_is_trusted(true) })
    }

    #[cfg(not(target_os = "macos"))]
    {
        current_accessibility_permission_status()
    }
}

fn current_accessibility_permission_status() -> AccessibilityPermissionStatus {
    #[cfg(target_os = "macos")]
    {
        accessibility_status_from_macos_trust(unsafe { keylesss_accessibility_is_trusted(false) })
    }

    #[cfg(not(target_os = "macos"))]
    {
        AccessibilityPermissionStatus {
            platform: std::env::consts::OS.to_string(),
            is_supported: false,
            is_granted: false,
            status: "unsupported".to_string(),
            guidance: "Accessibility setup is available on macOS only.".to_string(),
        }
    }
}

#[cfg(target_os = "macos")]
fn accessibility_status_from_macos_trust(is_trusted: bool) -> AccessibilityPermissionStatus {
    if is_trusted {
        AccessibilityPermissionStatus {
            platform: "macOS".to_string(),
            is_supported: true,
            is_granted: true,
            status: "granted".to_string(),
            guidance: "Ready to insert text into the focused app.".to_string(),
        }
    } else {
        AccessibilityPermissionStatus {
            platform: "macOS".to_string(),
            is_supported: true,
            is_granted: false,
            status: "missing".to_string(),
            guidance: format!(
                "Open Accessibility, turn {} on, then click Check again.",
                app_display_name()
            ),
        }
    }
}

#[tauri::command]
fn open_accessibility_settings() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let app_name = app_display_name();
        let urls = [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            "x-apple.systempreferences:com.apple.preference.security?Privacy",
        ];

        for url in urls {
            match Command::new("open").arg(url).status() {
                Ok(status) if status.success() => {
                    return Ok(format!(
                        "Opened Accessibility. Turn {app_name} on, then return to Keylesss and click Check again."
                    ));
                }
                _ => {}
            }
        }

        Err("Could not open Accessibility. Open System Settings > Privacy & Security > Accessibility.".to_string())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Opening Accessibility settings is only supported on macOS in this app.".to_string())
    }
}

#[tauri::command]
fn reset_accessibility_permission() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("tccutil")
            .args(["reset", "Accessibility", app_bundle_identifier()])
            .output()
            .map_err(|e| format!("Failed to reset macOS Accessibility access: {e}"))?;

        if output.status.success() {
            return Ok(format!(
                "Accessibility reset. Turn {} on again in System Settings.",
                app_display_name()
            ));
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "macOS did not reset Accessibility access. Open Accessibility and turn Keylesss off and on manually.".to_string()
        } else {
            format!("macOS did not reset Accessibility access: {stderr}")
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Resetting Accessibility access is only supported on macOS in this app.".to_string())
    }
}

#[tauri::command]
fn check_microphone_permission(state: State<AppState>) -> MicrophonePermissionStatus {
    if state
        .recorder
        .lock()
        .map(|recorder| recorder.is_some())
        .unwrap_or(false)
    {
        return MicrophonePermissionStatus {
            platform: std::env::consts::OS.to_string(),
            is_supported: true,
            is_granted: true,
            status: "busy".to_string(),
            guidance: "Recording is active.".to_string(),
        };
    }

    current_microphone_permission_status()
}

#[tauri::command]
fn request_microphone_permission(state: State<AppState>) -> MicrophonePermissionStatus {
    if state
        .recorder
        .lock()
        .map(|recorder| recorder.is_some())
        .unwrap_or(false)
    {
        return MicrophonePermissionStatus {
            platform: std::env::consts::OS.to_string(),
            is_supported: true,
            is_granted: true,
            status: "busy".to_string(),
            guidance: "Recording is active.".to_string(),
        };
    }

    request_microphone_permission_status()
}

fn current_microphone_permission_status() -> MicrophonePermissionStatus {
    microphone_status_from_macos_authorization(unsafe {
        keylesss_microphone_authorization_status()
    })
}

fn request_microphone_permission_status() -> MicrophonePermissionStatus {
    let status = unsafe { keylesss_microphone_authorization_status() };
    if status == MACOS_AV_AUTHORIZATION_NOT_DETERMINED {
        let granted = unsafe { keylesss_request_microphone_access() };
        return if granted {
            microphone_status_from_macos_authorization(MACOS_AV_AUTHORIZATION_AUTHORIZED)
        } else {
            microphone_status_from_macos_authorization(unsafe {
                keylesss_microphone_authorization_status()
            })
        };
    }

    microphone_status_from_macos_authorization(status)
}

const MACOS_AV_AUTHORIZATION_NOT_DETERMINED: i32 = 0;
const MACOS_AV_AUTHORIZATION_RESTRICTED: i32 = 1;
const MACOS_AV_AUTHORIZATION_DENIED: i32 = 2;
const MACOS_AV_AUTHORIZATION_AUTHORIZED: i32 = 3;

fn microphone_status_from_macos_authorization(status: i32) -> MicrophonePermissionStatus {
    let app_name = app_display_name();
    match status {
        MACOS_AV_AUTHORIZATION_AUTHORIZED => MicrophonePermissionStatus {
            platform: "macOS".to_string(),
            is_supported: true,
            is_granted: true,
            status: "granted".to_string(),
            guidance: "Ready to record.".to_string(),
        },
        MACOS_AV_AUTHORIZATION_NOT_DETERMINED => MicrophonePermissionStatus {
            platform: "macOS".to_string(),
            is_supported: true,
            is_granted: false,
            status: "not_determined".to_string(),
            guidance: format!("Click Allow in the macOS prompt for {app_name}."),
        },
        MACOS_AV_AUTHORIZATION_DENIED => MicrophonePermissionStatus {
            platform: "macOS".to_string(),
            is_supported: true,
            is_granted: false,
            status: "denied".to_string(),
            guidance: format!("Open Microphone, turn {app_name} on, then click Check again."),
        },
        MACOS_AV_AUTHORIZATION_RESTRICTED => MicrophonePermissionStatus {
            platform: "macOS".to_string(),
            is_supported: true,
            is_granted: false,
            status: "restricted".to_string(),
            guidance: "Microphone is restricted by macOS policy.".to_string(),
        },
        _ => MicrophonePermissionStatus {
            platform: "macOS".to_string(),
            is_supported: true,
            is_granted: false,
            status: "unknown".to_string(),
            guidance: format!("macOS returned an unknown microphone permission status: {status}."),
        },
    }
}

unsafe extern "C" {
    fn keylesss_accessibility_is_trusted(prompt: bool) -> bool;
    fn keylesss_microphone_authorization_status() -> i32;
    fn keylesss_request_microphone_access() -> bool;
}

#[tauri::command]
fn open_microphone_settings() -> Result<String, String> {
    let app_name = app_display_name();
    let urls = [
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        "x-apple.systempreferences:com.apple.preference.security?Privacy",
    ];

    for url in urls {
        match Command::new("open").arg(url).status() {
            Ok(status) if status.success() => {
                return Ok(format!(
                    "Opened Microphone. Turn {app_name} on, then return to Keylesss and click Check again."
                ));
            }
            _ => {}
        }
    }

    Err(
        "Could not open Microphone. Open System Settings > Privacy & Security > Microphone."
            .to_string(),
    )
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Message(format!("Failed resolving config dir: {e}")))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    let Ok(path) = settings_path(app) else {
        return Settings::default();
    };
    if !path.exists() {
        return Settings::default();
    }
    let Ok(text) = fs::read_to_string(path) else {
        return Settings::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn persist_settings(app: &AppHandle, settings: &Settings) -> Result<(), AppError> {
    let path = settings_path(app)?;
    let data = serde_json::to_string_pretty(settings)?;
    fs::write(path, data)?;
    Ok(())
}

fn transcript_history_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Message(format!("Failed resolving config dir: {e}")))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("transcript_history.json"))
}

fn durable_draft_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Message(format!("Failed resolving config dir: {e}")))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("durable_draft.json"))
}

fn load_durable_draft(app: &AppHandle) -> Option<DurableDraft> {
    let Ok(path) = durable_draft_path(app) else {
        return None;
    };
    if !path.exists() {
        return None;
    }
    let Ok(text) = fs::read_to_string(path) else {
        return None;
    };
    serde_json::from_str(&text).ok()
}

fn load_transcript_history(app: &AppHandle) -> Vec<TranscriptHistoryEntry> {
    let Ok(path) = transcript_history_path(app) else {
        return Vec::new();
    };
    if !path.exists() {
        return Vec::new();
    }
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn persist_durable_draft(app: &AppHandle, draft: Option<&DurableDraft>) -> Result<(), AppError> {
    let path = durable_draft_path(app)?;
    if let Some(draft) = draft {
        let data = serde_json::to_string_pretty(draft)?;
        fs::write(path, data)?;
    } else if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn persist_transcript_history(
    app: &AppHandle,
    entries: &[TranscriptHistoryEntry],
) -> Result<(), AppError> {
    let path = transcript_history_path(app)?;
    let data = serde_json::to_string_pretty(entries)?;
    fs::write(path, data)?;
    Ok(())
}

fn emit_transcript_history(app: &AppHandle, state: &State<'_, AppState>) {
    let payload = state
        .transcript_history
        .lock()
        .map(|entries| entries.clone())
        .unwrap_or_default();
    let _ = app.emit(TRANSCRIPT_HISTORY_EVENT, payload);
}

fn emit_durable_draft(app: &AppHandle, state: &State<'_, AppState>) {
    let payload = state
        .durable_draft
        .lock()
        .map(|draft| draft.clone())
        .unwrap_or(None);
    let _ = app.emit(DURABLE_DRAFT_EVENT, payload);
}

fn set_durable_draft(app: &AppHandle, state: &State<'_, AppState>, draft: Option<DurableDraft>) {
    let snapshot = {
        let Ok(mut lock) = state.durable_draft.lock() else {
            return;
        };
        *lock = draft;
        lock.clone()
    };

    if let Err(error) = persist_durable_draft(app, snapshot.as_ref()) {
        eprintln!("Failed to persist durable draft: {error}");
    }
    emit_durable_draft(app, state);
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn debug_log_state(state: &State<'_, AppState>, message: impl Into<String>) {
    let line = format!("[{}] {}", now_epoch_ms(), message.into());
    eprintln!("[{}] {line}", app_log_prefix());
    if let Ok(mut entries) = state.debug_log.lock() {
        entries.push(line);
        if entries.len() > DEBUG_LOG_LIMIT {
            let overflow = entries.len() - DEBUG_LOG_LIMIT;
            entries.drain(0..overflow);
        }
    }
}

fn debug_log_handle(app: &AppHandle, message: impl Into<String>) {
    let state: State<AppState> = app.state();
    debug_log_state(&state, message);
}

struct TranscriptHistoryRecord<'a> {
    final_output: &'a str,
    source: &'a str,
    recording_mode: &'a str,
    language: &'a str,
    source_app: Option<&'a str>,
    processing_latency_ms: Option<u64>,
}

fn push_transcript_history_entry(
    app: &AppHandle,
    state: &State<'_, AppState>,
    record: TranscriptHistoryRecord<'_>,
) {
    let trimmed = record.final_output.trim();
    if trimmed.is_empty() {
        return;
    }

    let now_ms = now_epoch_ms();
    let sequence = HISTORY_ID_SEQUENCE.fetch_add(1, Ordering::Relaxed) & HISTORY_ID_SEQUENCE_MASK;
    let entry_id = (now_ms << 10) | sequence;

    let snapshot = {
        let Ok(mut entries) = state.transcript_history.lock() else {
            return;
        };
        entries.insert(
            0,
            TranscriptHistoryEntry {
                id: entry_id,
                created_at_ms: now_ms,
                final_output: trimmed.to_string(),
                recording_mode: normalize_recording_mode(record.recording_mode),
                language: normalize_transcription_language(record.language),
                source_app: record.source_app.map(|value| value.to_string()),
                source: record.source.to_string(),
                processing_latency_ms: record.processing_latency_ms,
            },
        );
        entries.truncate(TRANSCRIPT_HISTORY_LIMIT);
        entries.clone()
    };

    if let Err(error) = persist_transcript_history(app, &snapshot) {
        eprintln!("Failed to persist transcript history: {error}");
    }
    emit_transcript_history(app, state);
}

fn map_test_connection_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return format!(
            "API timed out after {API_TEST_TIMEOUT_SECS}s. Check network/VPN and the API base URL."
        );
    }
    if error.is_connect() || error.is_request() {
        return "Could not reach the API host. Check internet connection and API base URL."
            .to_string();
    }
    format!("API test could not finish: {error}")
}

fn summarize_http_body(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return "<empty body>".to_string();
    }
    const MAX_CHARS: usize = 240;
    if trimmed.chars().count() <= MAX_CHARS {
        return trimmed.to_string();
    }
    let snippet: String = trimmed.chars().take(MAX_CHARS).collect();
    format!("{snippet}...")
}

fn normalize_recording_mode(mode: &str) -> String {
    if mode.trim().eq_ignore_ascii_case("toggle") {
        "toggle".to_string()
    } else {
        "hold".to_string()
    }
}

fn normalize_transcription_language(language: &str) -> String {
    let normalized = language.trim();
    const ALLOWED_LANGUAGES: [&str; 9] =
        ["auto", "en", "zh", "zh-TW", "ja", "ko", "es", "fr", "de"];
    if ALLOWED_LANGUAGES
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(normalized))
    {
        if normalized.eq_ignore_ascii_case("zh-tw") {
            "zh-TW".to_string()
        } else {
            normalized.to_ascii_lowercase()
        }
    } else {
        "auto".to_string()
    }
}

fn is_toggle_mode(settings: &Settings) -> bool {
    settings.recording_mode.eq_ignore_ascii_case("toggle")
}

fn set_status(
    app: &AppHandle,
    state: &State<AppState>,
    is_recording: Option<bool>,
    is_processing: Option<bool>,
    mic_level: Option<u8>,
    message: String,
) {
    let status = if let Ok(mut status) = state.runtime_status.lock() {
        if let Some(v) = is_recording {
            status.is_recording = v;
        }
        if let Some(v) = is_processing {
            status.is_processing = v;
        }
        if let Some(v) = mic_level {
            status.mic_level = v.min(100);
        }
        status.last_message = message;
        status.clone()
    } else {
        return;
    };

    update_tray_status(app, &status);
    sync_overlay_window_visibility(app, &status);
    let _ = app.emit(APP_STATUS_EVENT, status);
}

fn emit_mic_level(app: &AppHandle, mic_level: u8) {
    let state: State<AppState> = app.state();
    let Ok(mut status) = state.runtime_status.lock() else {
        return;
    };
    if !status.is_recording {
        return;
    }
    status.mic_level = mic_level.min(100);
    let _ = app.emit(APP_STATUS_EVENT, status.clone());
}

fn tray_state_label(status: &RuntimeStatus) -> &'static str {
    if status.is_recording {
        "Recording"
    } else if status.is_processing {
        "Processing"
    } else {
        "Idle"
    }
}

fn update_tray_status(app: &AppHandle, status: &RuntimeStatus) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };

    let state_label = tray_state_label(status);
    let tooltip = format!("{} - {state_label}", app_display_name());
    let _ = tray.set_tooltip(Some(tooltip));

    #[cfg(target_os = "macos")]
    {
        let _ = tray.set_title(Some(state_label));
    }
}

fn ensure_overlay_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(OVERLAY_WINDOW_LABEL).is_some() {
        return Ok(());
    }

    let monitor = app
        .primary_monitor()
        .map_err(|e| format!("Failed to resolve primary monitor: {e}"))?
        .ok_or_else(|| "No primary monitor available".to_string())?;
    let work_area = monitor.work_area();
    let x =
        work_area.position.x as f64 + (work_area.size.width as f64 - OVERLAY_WINDOW_WIDTH) / 2.0;
    let y = work_area.position.y as f64 + work_area.size.height as f64
        - OVERLAY_WINDOW_HEIGHT
        - OVERLAY_WINDOW_BOTTOM_MARGIN;

    let window = WebviewWindowBuilder::new(
        app,
        OVERLAY_WINDOW_LABEL,
        WebviewUrl::App("overlay.html".into()),
    )
    .title(format!("{} Overlay", app_display_name()))
    .inner_size(OVERLAY_WINDOW_WIDTH, OVERLAY_WINDOW_HEIGHT)
    .position(x, y)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .focused(false)
    .focusable(false)
    .build()
    .map_err(|e| format!("Failed to create overlay window: {e}"))?;

    let _ = window.set_ignore_cursor_events(true);
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
    eprintln!(
        "[{}] overlay_window_ready x={x} y={y} width={OVERLAY_WINDOW_WIDTH} height={OVERLAY_WINDOW_HEIGHT}",
        app_log_prefix()
    );

    Ok(())
}

fn sync_overlay_window_visibility(app: &AppHandle, status: &RuntimeStatus) {
    if status.is_recording || status.is_processing {
        if let Err(error) = ensure_overlay_window(app) {
            eprintln!("[{}] overlay_window_failed error={error}", app_log_prefix());
            return;
        }
        if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
            let _ = window.set_always_on_top(true);
            let _ = window.set_visible_on_all_workspaces(true);
            let _ = window.show();
        }
        return;
    }

    if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RecordingModeKind {
    Hold,
    Toggle,
}

impl RecordingModeKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Hold => "hold",
            Self::Toggle => "toggle",
        }
    }

    fn start_hint(self) -> &'static str {
        match self {
            Self::Hold => "Recording. Release the hold shortcut or click stop.",
            Self::Toggle => "Recording. Press the hands-free shortcut again or click stop.",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShortcutAction {
    Hold,
    Toggle,
}

impl ShortcutAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::Hold => "hold",
            Self::Toggle => "toggle",
        }
    }

    fn shortcut_label(self) -> &'static str {
        match self {
            Self::Hold => "Hold to speak shortcut",
            Self::Toggle => "Hands-free shortcut",
        }
    }
}

#[derive(Clone)]
struct ShortcutBindingRegistration {
    requested_hotkey: String,
    binding: RegisteredShortcutBinding,
}

#[derive(thiserror::Error, Debug)]
enum ShortcutBindingError {
    #[error("{0} cannot be empty.")]
    EmptyShortcut(&'static str),
    #[error("Each shortcut must be unique across hold and hands-free actions.")]
    DuplicateBindings,
    #[error(
        "{label} is invalid. Use one regular key with one or two modifiers, or use a single F key."
    )]
    InvalidFormat { label: &'static str },
    #[error("{label} must use one regular key with one or two modifiers, or use a single F key.")]
    PolicyViolation { label: &'static str },
    #[error("{label} isn't available right now. Choose another shortcut.")]
    Unavailable { label: &'static str },
    #[error("Failed to lock shortcut state.")]
    ShortcutStateLock,
}

fn unregister_registered_shortcuts(app: &AppHandle, registered: &mut RegisteredShortcuts) {
    for shortcut in std::mem::take(&mut registered.hold)
        .into_iter()
        .filter_map(|binding| binding.global())
    {
        let _ = app.global_shortcut().unregister(shortcut);
    }
    for shortcut in std::mem::take(&mut registered.toggle)
        .into_iter()
        .filter_map(|binding| binding.global())
    {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

fn normalize_requested_hotkey(input: &str) -> String {
    input
        .trim()
        .split('+')
        .map(|part| {
            let trimmed = part.trim();
            trimmed.to_string()
        })
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("+")
}

fn normalize_requested_hotkeys(hotkeys: &[String]) -> Vec<String> {
    let mut normalized: Vec<String> = Vec::new();
    for hotkey in hotkeys {
        let value = normalize_requested_hotkey(hotkey);
        if !value.is_empty()
            && !normalized
                .iter()
                .any(|existing: &String| existing.eq_ignore_ascii_case(&value))
        {
            normalized.push(value);
        }
    }
    normalized
}

fn parse_shortcut_binding_value(
    requested_hotkey: &str,
    action: ShortcutAction,
) -> Result<RegisteredShortcutBinding, ShortcutBindingError> {
    if requested_hotkey
        .split('+')
        .any(|part| part.trim().eq_ignore_ascii_case("Fn"))
    {
        return Err(ShortcutBindingError::InvalidFormat {
            label: action.shortcut_label(),
        });
    }

    let shortcut =
        requested_hotkey
            .parse::<Shortcut>()
            .map_err(|_| ShortcutBindingError::InvalidFormat {
                label: action.shortcut_label(),
            })?;
    validate_shortcut_policy(&shortcut, action)?;
    Ok(RegisteredShortcutBinding::Global(shortcut))
}

fn parse_shortcut_binding(
    state: &State<AppState>,
    requested_hotkey: &str,
    action: ShortcutAction,
) -> Result<ShortcutBindingRegistration, ShortcutBindingError> {
    let trimmed = requested_hotkey.trim();
    match parse_shortcut_binding_value(trimmed, action) {
        Ok(binding) => Ok(ShortcutBindingRegistration {
            requested_hotkey: normalize_requested_hotkey(trimmed),
            binding,
        }),
        Err(error) => {
            debug_log_state(
                state,
                format!(
                    "shortcut_parse_failed mode={} requested={} error={}",
                    action.as_str(),
                    trimmed,
                    error
                ),
            );
            Err(error)
        }
    }
}

fn shortcut_modifier_count(shortcut: &Shortcut) -> usize {
    [
        Modifiers::SHIFT,
        Modifiers::CONTROL,
        Modifiers::ALT,
        Modifiers::SUPER,
    ]
    .into_iter()
    .filter(|modifier| shortcut.mods.contains(*modifier))
    .count()
}

fn is_function_key(code: Code) -> bool {
    matches!(
        code,
        Code::F1
            | Code::F2
            | Code::F3
            | Code::F4
            | Code::F5
            | Code::F6
            | Code::F7
            | Code::F8
            | Code::F9
            | Code::F10
            | Code::F11
            | Code::F12
            | Code::F13
            | Code::F14
            | Code::F15
            | Code::F16
            | Code::F17
            | Code::F18
            | Code::F19
            | Code::F20
            | Code::F21
            | Code::F22
            | Code::F23
            | Code::F24
    )
}

fn validate_shortcut_policy(
    shortcut: &Shortcut,
    action: ShortcutAction,
) -> Result<(), ShortcutBindingError> {
    let modifier_count = shortcut_modifier_count(shortcut);
    if is_function_key(shortcut.key) && modifier_count == 0 {
        return Ok(());
    }

    if (1..=2).contains(&modifier_count) {
        return Ok(());
    }

    Err(ShortcutBindingError::PolicyViolation {
        label: action.shortcut_label(),
    })
}

#[cfg(test)]
mod shortcut_policy_tests {
    use super::{parse_shortcut_binding_value, validate_shortcut_policy, ShortcutAction};
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn accepts_single_modifier_plus_key() {
        let shortcut = "Ctrl+Space"
            .parse::<Shortcut>()
            .expect("shortcut should parse");
        assert!(validate_shortcut_policy(&shortcut, ShortcutAction::Hold).is_ok());
    }

    #[test]
    fn accepts_two_modifiers_plus_key() {
        let shortcut = "Ctrl+Alt+Space"
            .parse::<Shortcut>()
            .expect("shortcut should parse");
        assert!(validate_shortcut_policy(&shortcut, ShortcutAction::Hold).is_ok());
    }

    #[test]
    fn accepts_single_function_key() {
        let shortcut = "F8".parse::<Shortcut>().expect("shortcut should parse");
        assert!(validate_shortcut_policy(&shortcut, ShortcutAction::Hold).is_ok());
    }

    #[test]
    fn rejects_plain_non_modifier_key() {
        let shortcut = "Space".parse::<Shortcut>().expect("shortcut should parse");
        assert!(validate_shortcut_policy(&shortcut, ShortcutAction::Hold).is_err());
    }

    #[test]
    fn rejects_three_modifiers_plus_key() {
        let shortcut = "Ctrl+Alt+Shift+Space"
            .parse::<Shortcut>()
            .expect("shortcut should parse");
        assert!(validate_shortcut_policy(&shortcut, ShortcutAction::Hold).is_err());
    }

    #[test]
    fn rejects_modifier_only_shortcuts_at_parse_time() {
        assert!("Ctrl+Alt".parse::<Shortcut>().is_err());
    }

    #[test]
    fn rejects_fn_shortcut_binding() {
        assert!(parse_shortcut_binding_value("Fn", ShortcutAction::Hold).is_err());
    }

    #[test]
    fn rejects_fn_plus_key_binding() {
        assert!(parse_shortcut_binding_value("Fn+Space", ShortcutAction::Toggle).is_err());
    }
}

#[cfg(test)]
mod transcription_prompt_tests {
    use super::build_transcription_prompt;

    #[test]
    fn prompt_always_primes_mixed_language_transcription() {
        let prompt = build_transcription_prompt("auto", "");
        assert!(prompt.contains("switch languages mid-sentence"));
        assert!(prompt.contains("Do not translate or transliterate English terms"));
        assert!(prompt.contains("remove only obviously redundant filler"));
    }

    #[test]
    fn prompt_includes_language_and_term_hints_without_losing_primer() {
        let prompt = build_transcription_prompt("zh-TW", "OpenAI Whisper, TypeScript, pnpm");
        assert!(prompt.contains("Primary language hint: zh-TW"));
        assert!(prompt.contains("Terminology that may appear in the audio"));
        assert!(prompt.contains("Preserve each term in the language actually spoken"));
    }

    #[test]
    fn transcription_prompt_does_not_include_clipboard_reference() {
        let prompt = build_transcription_prompt("auto", "Monarch, Envio");
        assert!(!prompt.contains("Reference text for terminology only"));
    }
}

#[cfg(test)]
mod audio_capture_tests {
    use super::{analyze_wav_capture, app_temp_file_prefix, validate_audio_capture};
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_wav_path(label: &str) -> PathBuf {
        let epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "{}-audio-capture-test-{label}-{}-{epoch}.wav",
            app_temp_file_prefix(),
            std::process::id()
        ))
    }

    fn write_test_wav(path: &Path, samples: &[i16]) {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec).expect("wav should be created");
        for sample in samples {
            writer.write_sample(*sample).expect("sample should write");
        }
        writer.finalize().expect("wav should finalize");
    }

    #[test]
    fn rejects_empty_capture() {
        let path = temp_wav_path("empty");
        write_test_wav(&path, &[]);

        let error = validate_audio_capture(&path).expect_err("empty audio should be rejected");

        assert!(error.to_string().contains("No microphone audio"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_silent_capture() {
        let path = temp_wav_path("silent");
        write_test_wav(&path, &vec![0; 16_000]);

        let error = validate_audio_capture(&path).expect_err("silent audio should be rejected");

        assert!(error.to_string().contains("No speech detected"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn accepts_audible_capture() {
        let path = temp_wav_path("audible");
        write_test_wav(&path, &vec![1_500; 16_000]);

        let stats = validate_audio_capture(&path).expect("audible audio should pass");

        assert_eq!(stats.duration_ms, 1_000);
        assert!(stats.rms > 0.04);
        assert!(analyze_wav_capture(&path).expect("stats should read").peak > 0.04);
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod settings_compat_tests {
    use super::Settings;

    #[test]
    fn loads_legacy_single_shortcut_fields_into_lists() {
        let settings: Settings = serde_json::from_str(
            r#"{
              "api_key": "",
              "prompt_template": "x",
              "hold_hotkey": "Alt+R",
              "toggle_hotkey": "Ctrl+Shift+1",
              "discard_hotkey": "Escape",
              "whisper_model": "whisper-1",
              "custom_vocabulary": "",
              "format_model": "gpt-4o-mini",
              "format_enabled": false,
              "skip_formatter_in_terminals": true,
              "include_clipboard_context": true,
              "play_sound_cues": true,
              "api_base_url": "https://api.openai.com/v1",
              "recording_mode": "toggle",
              "language": "auto"
            }"#,
        )
        .expect("settings should parse");

        assert_eq!(settings.hold_hotkeys, vec!["Alt+R"]);
        assert_eq!(settings.toggle_hotkeys, vec!["Ctrl+Shift+1"]);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod permission_status_tests {
    use super::{
        accessibility_status_from_macos_trust, microphone_status_from_macos_authorization,
        MACOS_AV_AUTHORIZATION_DENIED, MACOS_AV_AUTHORIZATION_NOT_DETERMINED,
    };

    #[test]
    fn accessibility_status_copy_stays_compact() {
        let granted = accessibility_status_from_macos_trust(true);
        assert!(granted.is_granted);
        assert_eq!(
            granted.guidance,
            "Ready to insert text into the focused app."
        );

        let missing = accessibility_status_from_macos_trust(false);
        assert!(!missing.is_granted);
        assert!(missing.guidance.contains("Open Accessibility"));
        assert!(missing.guidance.contains("Check again"));
    }

    #[test]
    fn microphone_status_copy_explains_prompt_before_settings() {
        let not_requested =
            microphone_status_from_macos_authorization(MACOS_AV_AUTHORIZATION_NOT_DETERMINED);
        assert!(!not_requested.is_granted);
        assert_eq!(not_requested.status, "not_determined");
        assert!(not_requested.guidance.contains("macOS prompt"));

        let denied = microphone_status_from_macos_authorization(MACOS_AV_AUTHORIZATION_DENIED);
        assert!(!denied.is_granted);
        assert_eq!(denied.status, "denied");
        assert!(denied.guidance.contains("turn"));
    }
}

fn register_shortcut_binding(
    app: &AppHandle,
    state: &State<AppState>,
    binding: ShortcutBindingRegistration,
    action: ShortcutAction,
) -> Result<ShortcutBindingRegistration, ShortcutBindingError> {
    let RegisteredShortcutBinding::Global(shortcut) = binding.binding;
    match app.global_shortcut().register(shortcut) {
        Ok(()) => {
            debug_log_state(
                state,
                format!(
                    "shortcut_register_succeeded mode={} requested={} registered={}",
                    action.as_str(),
                    binding.requested_hotkey,
                    shortcut
                ),
            );
            Ok(binding)
        }
        Err(error) => {
            debug_log_state(
                state,
                format!(
                    "shortcut_register_failed mode={} requested={} error={}",
                    action.as_str(),
                    binding.requested_hotkey,
                    error
                ),
            );
            Err(ShortcutBindingError::Unavailable {
                label: action.shortcut_label(),
            })
        }
    }
}

fn restore_registered_shortcuts(
    app: &AppHandle,
    state: &State<AppState>,
    previous: RegisteredShortcuts,
) -> RegisteredShortcuts {
    let mut restored = RegisteredShortcuts::default();

    for binding in previous.hold {
        if let Some(shortcut) = binding.global() {
            match app.global_shortcut().register(shortcut) {
                Ok(()) => restored.hold.push(binding),
                Err(error) => debug_log_state(
                    state,
                    format!("shortcut_restore_failed mode=hold shortcut={shortcut} error={error}"),
                ),
            }
        }
    }

    for binding in previous.toggle {
        if let Some(shortcut) = binding.global() {
            match app.global_shortcut().register(shortcut) {
                Ok(()) => restored.toggle.push(binding),
                Err(error) => debug_log_state(
                    state,
                    format!(
                        "shortcut_restore_failed mode=toggle shortcut={shortcut} error={error}"
                    ),
                ),
            }
        }
    }

    restored
}

fn registered_shortcut_matches(
    bindings: &[RegisteredShortcutBinding],
    shortcut: &Shortcut,
) -> bool {
    bindings
        .iter()
        .copied()
        .filter_map(RegisteredShortcutBinding::global)
        .any(|registered| registered == *shortcut)
}

fn parse_shortcut_bindings(
    state: &State<AppState>,
    hotkeys: &[String],
    action: ShortcutAction,
) -> Result<Vec<ShortcutBindingRegistration>, ShortcutBindingError> {
    if hotkeys.is_empty() {
        return Err(ShortcutBindingError::EmptyShortcut(action.shortcut_label()));
    }

    hotkeys
        .iter()
        .map(|hotkey| parse_shortcut_binding(state, hotkey, action))
        .collect()
}

fn unregister_registered_bindings(app: &AppHandle, bindings: &[ShortcutBindingRegistration]) {
    for shortcut in bindings
        .iter()
        .filter_map(|binding| binding.binding.global())
    {
        let _ = app.global_shortcut().unregister(shortcut);
    }
}

fn register_shortcuts_strict(
    app: &AppHandle,
    state: &State<AppState>,
    hold_hotkeys: &[String],
    toggle_hotkeys: &[String],
) -> Result<(), ShortcutBindingError> {
    let hold = parse_shortcut_bindings(state, hold_hotkeys, ShortcutAction::Hold)?;
    let toggle = parse_shortcut_bindings(state, toggle_hotkeys, ShortcutAction::Toggle)?;
    debug_log_state(
        state,
        format!(
            "register_shortcuts_strict parsed hold={:?} toggle={:?}",
            hold.iter()
                .map(|binding| binding.requested_hotkey.as_str())
                .collect::<Vec<_>>(),
            toggle
                .iter()
                .map(|binding| binding.requested_hotkey.as_str())
                .collect::<Vec<_>>(),
        ),
    );
    let mut seen_bindings = Vec::new();
    for binding in hold
        .iter()
        .chain(toggle.iter())
        .map(|binding| binding.binding)
    {
        if seen_bindings.contains(&binding) {
            return Err(ShortcutBindingError::DuplicateBindings);
        }
        seen_bindings.push(binding);
    }

    let mut lock = state
        .current_shortcuts
        .lock()
        .map_err(|_| ShortcutBindingError::ShortcutStateLock)?;
    let previous = lock.clone();
    unregister_registered_shortcuts(app, &mut lock);

    let mut registered_hold = Vec::new();
    let mut registered_toggle = Vec::new();

    for binding in hold.iter().cloned() {
        match register_shortcut_binding(app, state, binding, ShortcutAction::Hold) {
            Ok(binding) => registered_hold.push(binding),
            Err(error) => {
                unregister_registered_bindings(app, &registered_hold);
                *lock = restore_registered_shortcuts(app, state, previous);
                return Err(error);
            }
        }
    }
    for binding in toggle.iter().cloned() {
        match register_shortcut_binding(app, state, binding, ShortcutAction::Toggle) {
            Ok(binding) => registered_toggle.push(binding),
            Err(error) => {
                unregister_registered_bindings(app, &registered_hold);
                unregister_registered_bindings(app, &registered_toggle);
                *lock = restore_registered_shortcuts(app, state, previous);
                return Err(error);
            }
        }
    }

    *lock = RegisteredShortcuts {
        hold: registered_hold
            .iter()
            .map(|binding| binding.binding)
            .collect(),
        toggle: registered_toggle
            .iter()
            .map(|binding| binding.binding)
            .collect(),
    };

    Ok(())
}

fn recording_mode_from_settings(settings: &Settings) -> RecordingModeKind {
    if is_toggle_mode(settings) {
        RecordingModeKind::Toggle
    } else {
        RecordingModeKind::Hold
    }
}

fn active_recording_mode(state: &State<'_, AppState>) -> Option<RecordingModeKind> {
    let lock = state.recorder.lock().ok()?;
    let session = lock.as_ref()?;
    Some(if session.recording_mode.eq_ignore_ascii_case("toggle") {
        RecordingModeKind::Toggle
    } else {
        RecordingModeKind::Hold
    })
}

fn handle_shortcut_event(
    app: &AppHandle,
    state: &State<'_, AppState>,
    mode: RecordingModeKind,
    event_state: ShortcutState,
) {
    match active_recording_mode(state) {
        Some(active_mode) if active_mode != mode => {}
        Some(RecordingModeKind::Hold) if event_state == ShortcutState::Released => {
            let _ = toggle_recording_with_mode(app, state, RecordingModeKind::Hold);
        }
        Some(RecordingModeKind::Toggle) if event_state == ShortcutState::Pressed => {
            let _ = toggle_recording_with_mode(app, state, RecordingModeKind::Toggle);
        }
        None if mode == RecordingModeKind::Hold && event_state == ShortcutState::Pressed => {
            let _ = toggle_recording_with_mode(app, state, RecordingModeKind::Hold);
        }
        None if mode == RecordingModeKind::Toggle && event_state == ShortcutState::Pressed => {
            let _ = toggle_recording_with_mode(app, state, RecordingModeKind::Toggle);
        }
        _ => {}
    }
}

fn toggle_recording_inner(app: &AppHandle, state: &State<AppState>) -> Result<(), String> {
    let mode = state
        .settings
        .lock()
        .map(|settings| recording_mode_from_settings(&settings))
        .unwrap_or(RecordingModeKind::Hold);
    toggle_recording_with_mode(app, state, mode)
}

fn toggle_recording_with_mode(
    app: &AppHandle,
    state: &State<AppState>,
    mode: RecordingModeKind,
) -> Result<(), String> {
    let maybe_session = {
        let mut lock = state
            .recorder
            .lock()
            .map_err(|_| "Recorder lock poisoned".to_string())?;
        if lock.is_some() {
            lock.take()
        } else {
            let include_clipboard_context = state
                .settings
                .lock()
                .map(|settings| settings.include_clipboard_context)
                .unwrap_or(false);
            let pre_recording_clipboard_context = if include_clipboard_context {
                capture_selected_text_context_on_record_start()
            } else {
                None
            };
            let session = start_recording(app, mode, pre_recording_clipboard_context)
                .map_err(|e| e.to_string())?;
            *lock = Some(session);
            debug_log_handle(
                app,
                format!(
                    "recording_started mode={} target_app={}",
                    mode.as_str(),
                    lock.as_ref()
                        .and_then(|session| session.insertion_target_app.as_deref())
                        .unwrap_or("none")
                ),
            );
            set_status(
                app,
                state,
                Some(true),
                Some(false),
                Some(0),
                mode.start_hint().to_string(),
            );
            play_earcon_if_enabled(state, Earcon::Start);
            return Ok(());
        }
    };

    if let Some(session) = maybe_session {
        let stopped = session.stop().map_err(|e| e.to_string())?;
        if stopped.elapsed.as_millis() < MIN_RECORDING_MS {
            let _ = fs::remove_file(&stopped.wav_path);
            set_status(
                app,
                state,
                Some(false),
                Some(false),
                Some(0),
                "Recording too short. Hold the shortcut and speak longer.".to_string(),
            );
            play_earcon_if_enabled(state, Earcon::Error);
            return Ok(());
        }

        set_status(
            app,
            state,
            Some(false),
            Some(true),
            Some(0),
            "Transcribing and formatting...".to_string(),
        );

        let app_handle = app.clone();
        let processing_started_at = Instant::now();
        tauri::async_runtime::spawn(async move {
            let app_state: State<AppState> = app_handle.state();
            if let Err(err) = process_audio_pipeline(
                &app_handle,
                &app_state,
                stopped.wav_path,
                stopped.recording_mode,
                stopped.pre_recording_clipboard_context,
                stopped.insertion_target_app,
                processing_started_at,
            )
            .await
            {
                let draft_hint = app_state
                    .durable_draft
                    .lock()
                    .ok()
                    .and_then(|draft| draft.clone())
                    .map(|_| " Draft saved. In Dictation tab, click ‘Copy draft’ to restore.")
                    .unwrap_or("");
                set_status(
                    &app_handle,
                    &app_state,
                    Some(false),
                    Some(false),
                    Some(0),
                    format!("Dictation failed: {err}{draft_hint}"),
                );
                play_earcon_if_enabled(&app_state, Earcon::Error);
            }
        });
    }

    Ok(())
}

fn start_recording(
    app: &AppHandle,
    recording_mode: RecordingModeKind,
    pre_recording_clipboard_context: Option<String>,
) -> Result<RecorderSession, AppError> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| AppError::Message("No default input device found".to_string()))?;

    let supported_config = device
        .default_input_config()
        .map_err(|e| AppError::Message(format!("No default input config: {e}")))?;

    let config: cpal::StreamConfig = supported_config.clone().into();

    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| AppError::Message(format!("Clock error: {e}")))?
        .as_millis();
    let path = std::env::temp_dir().join(format!("{}-{epoch}.wav", app_temp_file_prefix()));

    let spec = hound::WavSpec {
        channels: config.channels,
        sample_rate: config.sample_rate.0,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let writer = hound::WavWriter::create(&path, spec)
        .map_err(|e| AppError::Message(format!("Failed creating WAV file: {e}")))?;
    let writer = Arc::new(Mutex::new(Some(writer)));
    let mic_meter = MicMeterContext {
        app: app.clone(),
        meter: Arc::new(Mutex::new(MicMeterState {
            last_emit_at: Instant::now(),
            smoothed_level: 0.0,
        })),
    };

    let err_fn = |err| {
        eprintln!("Audio stream error: {err}");
    };

    let writer_clone = writer.clone();
    let meter_clone = mic_meter.clone();
    let stream = match supported_config.sample_format() {
        cpal::SampleFormat::F32 => device
            .build_input_stream(
                &config,
                move |data: &[f32], _| write_samples_f32(data, &writer_clone, &meter_clone),
                err_fn,
                None,
            )
            .map_err(|e| AppError::Message(format!("Failed building f32 stream: {e}")))?,
        cpal::SampleFormat::I16 => {
            let writer_clone = writer.clone();
            let meter_clone = mic_meter.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _| write_samples_i16(data, &writer_clone, &meter_clone),
                    err_fn,
                    None,
                )
                .map_err(|e| AppError::Message(format!("Failed building i16 stream: {e}")))?
        }
        cpal::SampleFormat::U16 => {
            let writer_clone = writer.clone();
            let meter_clone = mic_meter.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[u16], _| write_samples_u16(data, &writer_clone, &meter_clone),
                    err_fn,
                    None,
                )
                .map_err(|e| AppError::Message(format!("Failed building u16 stream: {e}")))?
        }
        other => {
            return Err(AppError::Message(format!(
                "Unsupported sample format: {other:?}"
            )))
        }
    };

    stream
        .play()
        .map_err(|e| AppError::Message(format!("Failed starting input stream: {e}")))?;

    let insertion_target_app = capture_insertion_target_app(app);
    debug_log_handle(
        app,
        format!(
            "capture_target_app mode={} frontmost_target={}",
            recording_mode.as_str(),
            insertion_target_app.as_deref().unwrap_or("none")
        ),
    );

    Ok(RecorderSession {
        stream,
        writer,
        path,
        started_at: Instant::now(),
        recording_mode: recording_mode.as_str().to_string(),
        pre_recording_clipboard_context,
        insertion_target_app,
    })
}

fn write_samples_f32(
    input: &[f32],
    writer: &Arc<Mutex<Option<hound::WavWriter<BufWriter<std::fs::File>>>>>,
    mic_meter: &MicMeterContext,
) {
    let mut peak = 0.0_f32;
    let mut sum_sq = 0.0_f32;
    let mut count = 0_usize;
    if let Ok(mut lock) = writer.lock() {
        if let Some(w) = lock.as_mut() {
            for sample in input {
                let clamped = sample.clamp(-1.0, 1.0);
                let normalized = clamped.abs();
                peak = peak.max(normalized);
                sum_sq += clamped * clamped;
                count += 1;
                let s = (clamped * i16::MAX as f32) as i16;
                let _ = w.write_sample(s);
            }
        }
    }
    let rms = if count > 0 {
        (sum_sq / count as f32).sqrt()
    } else {
        0.0
    };
    maybe_emit_mic_level(meter_target_percent(peak, rms), mic_meter);
}

fn write_samples_i16(
    input: &[i16],
    writer: &Arc<Mutex<Option<hound::WavWriter<BufWriter<std::fs::File>>>>>,
    mic_meter: &MicMeterContext,
) {
    let mut peak = 0_i32;
    let mut sum_sq = 0.0_f32;
    let mut count = 0_usize;
    if let Ok(mut lock) = writer.lock() {
        if let Some(w) = lock.as_mut() {
            for sample in input {
                peak = peak.max((*sample as i32).unsigned_abs() as i32);
                let normalized = (*sample as f32 / i16::MAX as f32).clamp(-1.0, 1.0);
                sum_sq += normalized * normalized;
                count += 1;
                let _ = w.write_sample(*sample);
            }
        }
    }
    let rms = if count > 0 {
        (sum_sq / count as f32).sqrt()
    } else {
        0.0
    };
    let peak_normalized = (peak as f32 / i16::MAX as f32).clamp(0.0, 1.0);
    maybe_emit_mic_level(meter_target_percent(peak_normalized, rms), mic_meter);
}

fn write_samples_u16(
    input: &[u16],
    writer: &Arc<Mutex<Option<hound::WavWriter<BufWriter<std::fs::File>>>>>,
    mic_meter: &MicMeterContext,
) {
    let mut peak = 0_i32;
    let mut sum_sq = 0.0_f32;
    let mut count = 0_usize;
    if let Ok(mut lock) = writer.lock() {
        if let Some(w) = lock.as_mut() {
            for sample in input {
                let shifted = (*sample as i32 - 32768) as i16;
                peak = peak.max((shifted as i32).unsigned_abs() as i32);
                let normalized = (shifted as f32 / i16::MAX as f32).clamp(-1.0, 1.0);
                sum_sq += normalized * normalized;
                count += 1;
                let _ = w.write_sample(shifted);
            }
        }
    }
    let rms = if count > 0 {
        (sum_sq / count as f32).sqrt()
    } else {
        0.0
    };
    let peak_normalized = (peak as f32 / i16::MAX as f32).clamp(0.0, 1.0);
    maybe_emit_mic_level(meter_target_percent(peak_normalized, rms), mic_meter);
}

fn meter_target_percent(peak: f32, rms: f32) -> f32 {
    let blended = (rms.clamp(0.0, 1.0) * 0.82).max(peak.clamp(0.0, 1.0) * 0.45);
    if blended <= 0.000_1 {
        return 0.0;
    }

    let db = 20.0 * blended.max(0.000_1).log10();
    let normalized =
        ((db - MIC_METER_FLOOR_DB) / (MIC_METER_CEILING_DB - MIC_METER_FLOOR_DB)).clamp(0.0, 1.0);
    normalized.powf(0.72) * 100.0
}

fn maybe_emit_mic_level(level: f32, mic_meter: &MicMeterContext) {
    let Ok(mut state) = mic_meter.meter.lock() else {
        return;
    };

    let now = Instant::now();
    let target = level.clamp(0.0, 100.0);
    let smoothing = if target > state.smoothed_level {
        0.58
    } else {
        0.18
    };
    state.smoothed_level += (target - state.smoothed_level) * smoothing;
    if state.smoothed_level < 0.4 && target < 0.4 {
        state.smoothed_level = 0.0;
    }
    if now.duration_since(state.last_emit_at) < Duration::from_millis(MIC_METER_EMIT_INTERVAL_MS) {
        return;
    }
    state.last_emit_at = now;
    emit_mic_level(&mic_meter.app, state.smoothed_level.round() as u8);
}

fn analyze_wav_capture(wav_path: &Path) -> Result<AudioCaptureStats, AppError> {
    let mut reader = hound::WavReader::open(wav_path)
        .map_err(|e| AppError::Message(format!("Failed reading captured audio: {e}")))?;
    let spec = reader.spec();
    let channels = u64::from(spec.channels.max(1));
    let sample_rate = u64::from(spec.sample_rate.max(1));

    let mut sample_count = 0_u64;
    let mut peak = 0.0_f32;
    let mut sum_sq = 0.0_f64;
    for sample in reader.samples::<i16>() {
        let sample =
            sample.map_err(|e| AppError::Message(format!("Failed reading audio sample: {e}")))?;
        let normalized = (sample as f32 / i16::MAX as f32).clamp(-1.0, 1.0);
        peak = peak.max(normalized.abs());
        sum_sq += f64::from(normalized * normalized);
        sample_count += 1;
    }

    let frame_count = sample_count / channels;
    let duration_ms = frame_count.saturating_mul(1_000) / sample_rate;
    let rms = if sample_count == 0 {
        0.0
    } else {
        (sum_sq / sample_count as f64).sqrt() as f32
    };

    Ok(AudioCaptureStats {
        duration_ms,
        sample_count,
        peak,
        rms,
    })
}

fn validate_audio_capture(wav_path: &Path) -> Result<AudioCaptureStats, AppError> {
    let stats = analyze_wav_capture(wav_path)?;
    if stats.sample_count == 0 || stats.duration_ms < MIN_CAPTURED_AUDIO_MS {
        return Err(AppError::Message(
            format!(
                "No microphone audio was captured. Check macOS Microphone permission for {}, then try again.",
                app_display_name()
            ),
        ));
    }
    if stats.rms < MIN_CAPTURE_RMS && stats.peak < MIN_CAPTURE_PEAK {
        return Err(AppError::Message(
            "No speech detected. Check the selected microphone and macOS Microphone permission, then try again.".to_string(),
        ));
    }
    Ok(stats)
}

async fn process_audio_pipeline(
    app: &AppHandle,
    state: &State<'_, AppState>,
    wav_path: PathBuf,
    recording_mode: String,
    pre_recording_clipboard_context: Option<String>,
    insertion_target_app: Option<String>,
    processing_started_at: Instant,
) -> Result<(), AppError> {
    let pipeline_result = async {
        let settings = state
            .settings
            .lock()
            .map_err(|_| AppError::Message("Failed to lock settings".to_string()))?
            .clone();

        if settings.api_key.is_empty() {
            return Err(AppError::Message(
                "Add your OpenAI API key in Settings > AI, then save.".to_string(),
            ));
        }

        // Capture local context once before network calls to avoid drift.
        let active_app_name = insertion_target_app.clone();
        let clipboard_reference = if settings.include_clipboard_context {
            pre_recording_clipboard_context.or_else(capture_clipboard_reference_context)
        } else {
            None
        };
        debug_log_state(
            state,
            format!(
                "pipeline_started mode={} target_app={} clipboard_context={}",
                recording_mode,
                active_app_name.as_deref().unwrap_or("none"),
                clipboard_reference.is_some()
            ),
        );
        let audio_stats = validate_audio_capture(&wav_path)?;
        debug_log_state(
            state,
            format!(
                "audio_capture_validated duration_ms={} samples={} rms={:.5} peak={:.5}",
                audio_stats.duration_ms,
                audio_stats.sample_count,
                audio_stats.rms,
                audio_stats.peak
            ),
        );
        let transcription = transcribe_audio(&state.http_client, &settings, &wav_path).await?;
        set_durable_draft(
            app,
            state,
            Some(DurableDraft {
                text: transcription.clone(),
                created_at_ms: now_epoch_ms(),
                recording_mode: normalize_recording_mode(&recording_mode),
                language: normalize_transcription_language(&settings.language),
                source_app: active_app_name.clone(),
            }),
        );
        let insertion_destination = active_app_name
            .clone()
            .unwrap_or_else(|| "focused app".to_string());
        let terminal_raw_insert = active_app_name
            .as_deref()
            .map(is_terminal_like_app)
            .unwrap_or(false)
            && settings.skip_formatter_in_terminals;
        let (output_text, inserted_message) = if terminal_raw_insert {
            (
                transcription,
                format!(
                    "Inserted raw transcript into {insertion_destination} (LLM formatter skipped)."
                ),
            )
        } else if settings.format_enabled {
            let formatter_result = format_transcript(
                &state.http_client,
                &settings,
                &transcription,
                active_app_name.as_deref(),
                clipboard_reference.as_deref(),
            )
            .await?;
            if formatter_result.used_raw_fallback {
                (
                    formatter_result.text,
                    format!(
                        "Inserted raw transcript into {insertion_destination} (formatter output failed safety check)."
                    ),
                )
            } else {
                (
                    formatter_result.text,
                    format!("Inserted text into {insertion_destination}."),
                )
            }
        } else {
            (
                transcription,
                format!("Inserted raw transcript into {insertion_destination}."),
            )
        };
        paste_text(app, &output_text, insertion_target_app.as_deref())?;

        Ok::<(String, String, Option<String>, String, String), AppError>((
            inserted_message,
            output_text,
            active_app_name,
            recording_mode,
            settings.language.clone(),
        ))
    };
    let result = pipeline_result.await;
    if let Err(cleanup_error) = fs::remove_file(&wav_path) {
        if !wav_path.exists() {
            // Ignore if already removed by external factors.
        } else if result.is_ok() {
            return Err(AppError::Message(format!(
                "Finished processing, but failed to delete temp file: {cleanup_error}"
            )));
        }
    }

    let latency_ms = processing_started_at.elapsed().as_millis() as u64;
    let (inserted_message, output_text, source_app, recording_mode, language) = result?;
    set_durable_draft(app, state, None);
    push_transcript_history_entry(
        app,
        state,
        TranscriptHistoryRecord {
            final_output: &output_text,
            source: "dictation",
            recording_mode: &recording_mode,
            language: &language,
            source_app: source_app.as_deref(),
            processing_latency_ms: Some(latency_ms),
        },
    );

    set_status(
        app,
        state,
        Some(false),
        Some(false),
        Some(0),
        format!("{inserted_message} {latency_ms}ms"),
    );
    play_earcon_if_enabled(state, Earcon::Success);

    Ok(())
}

async fn transcribe_audio(
    client: &reqwest::Client,
    settings: &Settings,
    wav_path: &PathBuf,
) -> Result<String, AppError> {
    let bytes = fs::read(wav_path)?;
    let url = format!("{}/audio/transcriptions", settings.api_base_url);
    let transcription_language = normalize_transcription_language(&settings.language);
    let transcription_prompt =
        build_transcription_prompt(&transcription_language, settings.custom_vocabulary.as_str());

    for attempt in 0..API_RETRY_MAX_ATTEMPTS {
        let mut form = Form::new()
            .part(
                "file",
                Part::bytes(bytes.clone())
                    .file_name("recording.wav")
                    .mime_str("audio/wav")
                    .map_err(|e| AppError::Message(format!("MIME error: {e}")))?,
            )
            .text("model", settings.whisper_model.clone());
        if transcription_language != "auto" {
            form = form.text("language", transcription_language.clone());
        }
        form = form.text("prompt", transcription_prompt.clone());

        let response = client
            .post(&url)
            .bearer_auth(&settings.api_key)
            .multipart(form)
            .send()
            .await;

        match response {
            Ok(response) => {
                if response.status().is_success() {
                    let parsed: TranscriptionResponse = response.json().await?;
                    return Ok(parsed.text);
                }

                let status = response.status();
                let body = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "<no body>".to_string());
                let should_retry =
                    is_retryable_status(status) && attempt + 1 < API_RETRY_MAX_ATTEMPTS;
                if should_retry {
                    tokio::time::sleep(Duration::from_millis(retry_backoff_ms(attempt))).await;
                    continue;
                }

                return Err(AppError::Message(format!(
                    "Transcription API returned {status}: {}",
                    summarize_http_body(&body)
                )));
            }
            Err(error) => {
                let should_retry = (error.is_timeout() || error.is_connect())
                    && attempt + 1 < API_RETRY_MAX_ATTEMPTS;
                if should_retry {
                    tokio::time::sleep(Duration::from_millis(retry_backoff_ms(attempt))).await;
                    continue;
                }
                return Err(AppError::Reqwest(error));
            }
        }
    }

    Err(AppError::Message(
        "Transcription did not finish after retries. Check network and API settings.".to_string(),
    ))
}

fn build_transcription_prompt(transcription_language: &str, custom_vocabulary: &str) -> String {
    let custom = truncate_chars(
        custom_vocabulary.trim(),
        TRANSCRIPTION_PROMPT_CONTEXT_MAX_CHARS,
    );

    let mut parts = vec![
        "Transcribe the audio accurately. The speaker may switch languages mid-sentence and may mix Chinese with English technical terms, brand names, product names, acronyms, commands, filenames, APIs, and URLs. Preserve each term in the language actually spoken. Do not translate or transliterate English terms into Chinese characters, and do not normalize mixed-language wording into a single language. Prefer a clean transcript with punctuation and remove only obviously redundant filler, repeated fragments, or stutters when the wording is clearly accidental. Do not paraphrase."
            .to_string(),
    ];

    if transcription_language != "auto" {
        parts.push(format!(
            "Primary language hint: {transcription_language}. Treat this only as a hint and still preserve mixed-language segments exactly as spoken."
        ));
    }
    if !custom.is_empty() {
        parts.push(format!(
            "Terminology that may appear in the audio; preserve exact wording if spoken: {custom}"
        ));
    }

    parts.join("\n\n")
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

fn retry_backoff_ms(attempt: u32) -> u64 {
    API_RETRY_BASE_BACKOFF_MS.saturating_mul(1_u64 << attempt.min(5))
}

async fn format_transcript(
    client: &reqwest::Client,
    settings: &Settings,
    transcript: &str,
    active_app_name: Option<&str>,
    clipboard_reference: Option<&str>,
) -> Result<FormatterResult, AppError> {
    let url = format!("{}/chat/completions", settings.api_base_url);
    let system_prompt = build_formatter_system_prompt(
        &settings.prompt_template,
        active_app_name,
        clipboard_reference,
    );
    let request_body = serde_json::json!({
      "model": settings.format_model,
      "temperature": 0,
      "messages": [
        {"role":"system","content": system_prompt},
        {"role":"user","content": transcript}
      ]
    });

    for attempt in 0..API_RETRY_MAX_ATTEMPTS {
        let response = client
            .post(&url)
            .bearer_auth(&settings.api_key)
            .json(&request_body)
            .send()
            .await;

        match response {
            Ok(response) => {
                if !response.status().is_success() {
                    let status = response.status();
                    let body = response
                        .text()
                        .await
                        .unwrap_or_else(|_| "<no body>".to_string());
                    let should_retry =
                        is_retryable_status(status) && attempt + 1 < API_RETRY_MAX_ATTEMPTS;
                    if should_retry {
                        tokio::time::sleep(Duration::from_millis(retry_backoff_ms(attempt))).await;
                        continue;
                    }
                    return Err(AppError::Message(format!(
                        "Polishing API returned {status}: {}",
                        summarize_http_body(&body)
                    )));
                }

                let parsed: ChatCompletionResponse = response.json().await?;
                let content = parsed
                    .choices
                    .first()
                    .map(|c| c.message.content.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| {
                        AppError::Message(
                            "Polishing returned no text. Disable polishing and try again."
                                .to_string(),
                        )
                    })?;
                if formatter_output_passes_safety_check(transcript, &content) {
                    return Ok(FormatterResult {
                        text: content,
                        used_raw_fallback: false,
                    });
                }
                return Ok(FormatterResult {
                    text: transcript.to_string(),
                    used_raw_fallback: true,
                });
            }
            Err(error) => {
                let should_retry = (error.is_timeout() || error.is_connect())
                    && attempt + 1 < API_RETRY_MAX_ATTEMPTS;
                if should_retry {
                    tokio::time::sleep(Duration::from_millis(retry_backoff_ms(attempt))).await;
                    continue;
                }
                return Err(AppError::Reqwest(error));
            }
        }
    }

    Err(AppError::Message(
        "Polishing did not finish after retries. Disable polishing and try again.".to_string(),
    ))
}

fn build_formatter_system_prompt(
    base_prompt: &str,
    active_app_name: Option<&str>,
    clipboard_reference: Option<&str>,
) -> String {
    let mut prompt = base_prompt.to_string();

    let app_name = active_app_name
        .map(str::trim)
        .filter(|name| !name.is_empty());

    let style_hint = if let Some(name) = app_name {
        let lower_name = name.to_ascii_lowercase();
        if lower_name.contains("terminal") || lower_name.contains("iterm") {
            "Use raw shell/CLI style with minimal prose and no extra decoration."
        } else if lower_name.contains("slack")
            || lower_name.contains("discord")
            || lower_name.contains("telegram")
        {
            "Use concise chat tone with short lines and direct wording."
        } else if lower_name.contains("gmail") || lower_name.contains("outlook") {
            "Use professional email tone with clear and polished phrasing."
        } else {
            "Use a neutral tone suitable for general text input."
        }
    } else {
        "Use a neutral tone suitable for general text input."
    };

    if let Some(name) = app_name {
        prompt.push_str(&format!(
            "\n\nCurrent target app context: {name}. {style_hint}"
        ));
    } else {
        prompt.push_str(&format!("\n\nTarget app context unavailable. {style_hint}"));
    }
    prompt.push_str("\n\nStrict safety requirements: perform only transcript transformations (punctuation, capitalization, grammar, disfluency cleanup, and light wording cleanup). Do not answer user questions, do not add new facts, and do not introduce content not grounded in the provided transcript. If the transcript is ambiguous, keep it literal.");
    prompt.push_str(" Return only final text.");

    if let Some(reference) = clipboard_reference
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        prompt.push_str("\n\nOptional clipboard reference context (style only; do not copy verbatim unless requested):\n");
        prompt.push_str(reference);
    }

    prompt
}

fn formatter_output_passes_safety_check(transcript: &str, formatted: &str) -> bool {
    let transcript_trimmed = transcript.trim();
    let formatted_trimmed = formatted.trim();
    if transcript_trimmed.is_empty() || formatted_trimmed.is_empty() {
        return false;
    }
    if transcript_trimmed.eq_ignore_ascii_case(formatted_trimmed) {
        return true;
    }

    let transcript_len = transcript_trimmed.chars().count();
    let formatted_len = formatted_trimmed.chars().count();
    let (min_ratio, max_ratio) = if transcript_len >= 80 {
        (0.45_f32, 2.2_f32)
    } else {
        (0.30_f32, 3.0_f32)
    };
    let length_ratio = formatted_len as f32 / transcript_len as f32;
    if length_ratio < min_ratio || length_ratio > max_ratio {
        return false;
    }

    let transcript_tokens = tokenize_for_overlap(transcript_trimmed);
    let formatted_tokens = tokenize_for_overlap(formatted_trimmed);
    if transcript_tokens.is_empty() || formatted_tokens.is_empty() {
        return false;
    }
    if transcript_tokens.len() < 4 || formatted_tokens.len() < 4 {
        return true;
    }

    let shared = transcript_tokens.intersection(&formatted_tokens).count();
    let output_overlap = shared as f32 / formatted_tokens.len() as f32;
    let transcript_overlap = shared as f32 / transcript_tokens.len() as f32;
    output_overlap >= 0.35 && transcript_overlap >= 0.20
}

fn tokenize_for_overlap(text: &str) -> HashSet<String> {
    text.split_whitespace()
        .map(|token| {
            token
                .chars()
                .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '\'')
                .collect::<String>()
                .to_ascii_lowercase()
        })
        .filter(|token| !token.is_empty())
        .collect()
}

fn capture_clipboard_reference_context() -> Option<String> {
    let mut clipboard = arboard::Clipboard::new().ok()?;
    let text = clipboard.get_text().ok()?;
    clip_clipboard_context(&text)
}

fn clip_clipboard_context(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut clipped = String::new();
    for ch in trimmed.chars().take(FORMAT_CONTEXT_CLIPBOARD_MAX_CHARS) {
        clipped.push(ch);
    }

    Some(clipped)
}

#[cfg(target_os = "macos")]
fn capture_selected_text_context_on_record_start() -> Option<String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to keystroke \"c\" using command down")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    thread::sleep(Duration::from_millis(PRE_RECORDING_COPY_DELAY_MS));
    capture_clipboard_reference_context()
}

#[cfg(not(target_os = "macos"))]
fn capture_selected_text_context_on_record_start() -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
fn detect_frontmost_app_name() -> Option<String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(
            "tell application \"System Events\" to get name of first application process whose frontmost is true",
        )
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let app_name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if app_name.is_empty() {
        return None;
    }

    Some(app_name)
}

#[cfg(target_os = "macos")]
fn detect_frontmost_app_pid() -> Option<i32> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(
            "tell application \"System Events\" to get unix id of first application process whose frontmost is true",
        )
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<i32>()
        .ok()
}

#[cfg(target_os = "macos")]
fn detect_app_pid_by_name(app_name: &str) -> Option<i32> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(format!(
            "tell application \"System Events\" to get unix id of first application process whose name is \"{}\"",
            applescript_escape(app_name)
        ))
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<i32>()
        .ok()
}

#[cfg(not(target_os = "macos"))]
fn detect_frontmost_app_name() -> Option<String> {
    None
}

fn normalize_app_name_for_compare(app_name: &str) -> String {
    app_name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn app_names_match(left: &str, right: &str) -> bool {
    normalize_app_name_for_compare(left) == normalize_app_name_for_compare(right)
}

fn is_current_app_name(app: &AppHandle, candidate_app_name: &str) -> bool {
    app_names_match(candidate_app_name, &app.package_info().name)
}

#[cfg(target_os = "macos")]
fn capture_insertion_target_app(app: &AppHandle) -> Option<String> {
    let frontmost_app = detect_frontmost_app_name()?;
    if is_current_app_name(app, &frontmost_app) {
        return None;
    }
    Some(frontmost_app)
}

#[cfg(not(target_os = "macos"))]
fn capture_insertion_target_app(_app: &AppHandle) -> Option<String> {
    None
}

fn is_terminal_like_app(app_name: &str) -> bool {
    let lower = app_name.to_ascii_lowercase();
    [
        "terminal",
        "iterm",
        "warp",
        "wezterm",
        "alacritty",
        "kitty",
        "tmux",
        "cmux",
        "zellij",
        "screen",
        "nvim",
        "vim",
        "helix",
        "hx",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

#[cfg(target_os = "macos")]
fn applescript_escape(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "macos")]
type CGEventRef = *const std::ffi::c_void;
#[cfg(target_os = "macos")]
type CGEventFlags = u64;

#[cfg(target_os = "macos")]
#[repr(u32)]
#[allow(dead_code)]
#[derive(Clone, Copy, Debug)]
enum CGEventTapLocation {
    Hid = 0,
}

#[cfg(target_os = "macos")]
const CG_EVENT_FLAG_MASK_COMMAND: CGEventFlags = 0x0010_0000;

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventCreateKeyboardEvent(
        source: *const std::ffi::c_void,
        virtual_key: u16,
        key_down: bool,
    ) -> CGEventRef;
    fn CGEventSetFlags(event: CGEventRef, flags: CGEventFlags);
    fn CGEventPost(tap: CGEventTapLocation, event: CGEventRef);
    fn CGEventPostToPid(pid: i32, event: CGEventRef);
}

#[cfg(target_os = "macos")]
type AXUIElementRef = *const std::ffi::c_void;
#[cfg(target_os = "macos")]
type AXValueRef = *const std::ffi::c_void;
#[cfg(target_os = "macos")]
type AXError = i32;
#[cfg(target_os = "macos")]
type AXValueType = u32;

#[cfg(target_os = "macos")]
const K_AX_ERROR_SUCCESS: AXError = 0;
#[cfg(target_os = "macos")]
const K_AX_VALUE_ILLEGAL_TYPE: AXValueType = 0;
#[cfg(target_os = "macos")]
const K_AX_VALUE_CF_RANGE_TYPE: AXValueType = 4;

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementIsAttributeSettable(
        element: AXUIElementRef,
        attribute: CFStringRef,
        settable: *mut Boolean,
    ) -> AXError;
    fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> AXError;
    fn AXValueCreate(value_type: AXValueType, value_ptr: *const std::ffi::c_void) -> AXValueRef;
    fn AXValueGetTypeID() -> CFTypeID;
    fn AXValueGetType(value: AXValueRef) -> AXValueType;
    fn AXValueGetValue(
        value: AXValueRef,
        value_type: AXValueType,
        value_ptr: *mut std::ffi::c_void,
    ) -> Boolean;
}

#[cfg(target_os = "macos")]
fn ax_error_label(error: AXError) -> &'static str {
    match error {
        0 => "success",
        -25200 => "failure",
        -25201 => "illegal argument",
        -25202 => "invalid ui element",
        -25203 => "invalid ui element observer",
        -25204 => "cannot complete",
        -25205 => "attribute unsupported",
        -25206 => "action unsupported",
        -25207 => "notification unsupported",
        -25208 => "not implemented",
        -25209 => "notification already registered",
        -25210 => "notification not registered",
        -25211 => "api disabled",
        -25212 => "no value",
        -25213 => "parameterized attribute unsupported",
        -25214 => "not enough precision",
        _ => "unknown ax error",
    }
}

#[cfg(target_os = "macos")]
fn copy_ax_attribute(element: AXUIElementRef, attribute_name: &str) -> Result<CFTypeRef, String> {
    let attribute = CFString::new(attribute_name);
    let mut value: CFTypeRef = std::ptr::null();
    let error = unsafe {
        AXUIElementCopyAttributeValue(element, attribute.as_concrete_TypeRef(), &mut value)
    };
    if error != K_AX_ERROR_SUCCESS {
        return Err(format!(
            "{attribute_name} read failed: {} ({error})",
            ax_error_label(error)
        ));
    }
    if value.is_null() {
        return Err(format!("{attribute_name} returned null"));
    }
    Ok(value)
}

#[cfg(target_os = "macos")]
fn is_ax_attribute_settable(element: AXUIElementRef, attribute_name: &str) -> Result<bool, String> {
    let attribute = CFString::new(attribute_name);
    let mut settable: Boolean = 0;
    let error = unsafe {
        AXUIElementIsAttributeSettable(element, attribute.as_concrete_TypeRef(), &mut settable)
    };
    if error != K_AX_ERROR_SUCCESS {
        return Err(format!(
            "{attribute_name} settable check failed: {} ({error})",
            ax_error_label(error)
        ));
    }
    Ok(settable != 0)
}

#[cfg(target_os = "macos")]
fn cf_type_to_string(value: CFTypeRef) -> Result<String, String> {
    if unsafe { CFGetTypeID(value) } != unsafe { CFStringGetTypeID() } {
        unsafe {
            CFRelease(value);
        }
        return Err("AXValue was not a string".to_string());
    }
    let value = unsafe { CFString::wrap_under_create_rule(value as CFStringRef) };
    Ok(value.to_string())
}

#[cfg(target_os = "macos")]
fn cf_type_to_range(value: CFTypeRef) -> Result<CFRange, String> {
    let value_type_id = unsafe { CFGetTypeID(value) };
    let ax_value_type_id = unsafe { AXValueGetTypeID() };
    if value_type_id != ax_value_type_id {
        unsafe {
            CFRelease(value);
        }
        return Err("AXSelectedTextRange was not an AXValue".to_string());
    }

    let ax_value_type = unsafe { AXValueGetType(value as AXValueRef) };
    if ax_value_type == K_AX_VALUE_ILLEGAL_TYPE {
        unsafe {
            CFRelease(value);
        }
        return Err("AXSelectedTextRange used an illegal AXValue type".to_string());
    }
    if ax_value_type != K_AX_VALUE_CF_RANGE_TYPE {
        unsafe {
            CFRelease(value);
        }
        return Err(format!(
            "AXSelectedTextRange used AXValue type {ax_value_type} instead of CFRange"
        ));
    }

    let mut range = CFRange {
        location: 0,
        length: 0,
    };
    let ok = unsafe {
        AXValueGetValue(
            value as AXValueRef,
            K_AX_VALUE_CF_RANGE_TYPE,
            (&mut range as *mut CFRange).cast(),
        )
    };
    unsafe {
        CFRelease(value);
    }
    if ok == 0 {
        return Err("AXSelectedTextRange could not be decoded as CFRange".to_string());
    }
    Ok(range)
}

#[cfg(target_os = "macos")]
fn char_to_byte_index(text: &str, char_index: usize) -> usize {
    text.char_indices()
        .map(|(byte_index, _)| byte_index)
        .nth(char_index)
        .unwrap_or(text.len())
}

#[cfg(target_os = "macos")]
fn splice_text_at_range(text: &str, range: CFRange, inserted_text: &str) -> (String, isize) {
    let start = range.location.max(0) as usize;
    let length = range.length.max(0) as usize;
    let start_byte = char_to_byte_index(text, start);
    let end_byte = char_to_byte_index(text, start.saturating_add(length));
    let mut next_value = String::with_capacity(
        text.len()
            .saturating_add(inserted_text.len())
            .saturating_sub(end_byte - start_byte),
    );
    next_value.push_str(&text[..start_byte]);
    next_value.push_str(inserted_text);
    next_value.push_str(&text[end_byte..]);
    let next_cursor = start as isize + inserted_text.chars().count() as isize;
    (next_value, next_cursor)
}

#[cfg(target_os = "macos")]
fn copy_focused_ax_element(target_app_name: Option<&str>) -> Result<AXUIElementRef, String> {
    let system = unsafe { AXUIElementCreateSystemWide() };
    if system.is_null() {
        return Err("Failed to create system-wide AX element".to_string());
    }

    let system_result = copy_ax_attribute(system, "AXFocusedUIElement");
    unsafe {
        CFRelease(system as CFTypeRef);
    }
    match system_result {
        Ok(value) => Ok(value as AXUIElementRef),
        Err(system_error) => {
            let pid = target_app_name
                .and_then(detect_app_pid_by_name)
                .or_else(detect_frontmost_app_pid)
                .ok_or_else(|| {
                    format!("{system_error}; target app process could not be resolved")
                })?;
            let app_element = unsafe { AXUIElementCreateApplication(pid) };
            if app_element.is_null() {
                return Err(format!(
                    "{system_error}; failed to create target AX application for pid {pid}"
                ));
            }
            let app_result = copy_ax_attribute(app_element, "AXFocusedUIElement");
            unsafe {
                CFRelease(app_element as CFTypeRef);
            }
            app_result
                .map(|value| value as AXUIElementRef)
                .map_err(|app_error| {
                    format!(
                        "{system_error}; target app AXFocusedUIElement read failed for pid {pid}: {app_error}"
                    )
                })
        }
    }
}

#[cfg(target_os = "macos")]
fn insert_text_via_accessibility(text: &str, target_app_name: Option<&str>) -> Result<(), String> {
    let focused_element = copy_focused_ax_element(target_app_name)?;
    let result = (|| {
        if !is_ax_attribute_settable(focused_element, "AXValue")? {
            return Err("AXValue is not settable on the focused element".to_string());
        }

        let current_value_ref = copy_ax_attribute(focused_element, "AXValue")?;
        let current_value = cf_type_to_string(current_value_ref)?;
        let selected_range_ref = copy_ax_attribute(focused_element, "AXSelectedTextRange")?;
        let selected_range = cf_type_to_range(selected_range_ref)?;
        let (next_value, next_cursor) = splice_text_at_range(&current_value, selected_range, text);

        let next_value_cf = CFString::new(&next_value);
        let value_attr = CFString::new("AXValue");
        let set_value_error = unsafe {
            AXUIElementSetAttributeValue(
                focused_element,
                value_attr.as_concrete_TypeRef(),
                next_value_cf.as_CFTypeRef(),
            )
        };
        if set_value_error != K_AX_ERROR_SUCCESS {
            return Err(format!(
                "AXValue write failed: {} ({set_value_error})",
                ax_error_label(set_value_error)
            ));
        }

        if is_ax_attribute_settable(focused_element, "AXSelectedTextRange")? {
            let next_range = CFRange {
                location: next_cursor,
                length: 0,
            };
            let next_range_value = unsafe {
                AXValueCreate(
                    K_AX_VALUE_CF_RANGE_TYPE,
                    (&next_range as *const CFRange).cast(),
                )
            };
            if !next_range_value.is_null() {
                let range_attr = CFString::new("AXSelectedTextRange");
                let set_range_error = unsafe {
                    AXUIElementSetAttributeValue(
                        focused_element,
                        range_attr.as_concrete_TypeRef(),
                        next_range_value as CFTypeRef,
                    )
                };
                unsafe {
                    CFRelease(next_range_value as CFTypeRef);
                }
                if set_range_error != K_AX_ERROR_SUCCESS {
                    return Err(format!(
                        "AXSelectedTextRange write failed: {} ({set_range_error})",
                        ax_error_label(set_range_error)
                    ));
                }
            }
        }

        Ok(())
    })();

    unsafe {
        CFRelease(focused_element as CFTypeRef);
    }
    result
}

#[cfg(target_os = "macos")]
fn activate_target_app(app: &AppHandle, target_app_name: Option<&str>) -> Result<(), AppError> {
    let Some(target_app_name) = target_app_name else {
        debug_log_handle(
            app,
            "activate_target_app skipped: no captured target".to_string(),
        );
        return Ok(());
    };

    if is_current_app_name(app, target_app_name) {
        debug_log_handle(
            app,
            format!("activate_target_app skipped: target '{target_app_name}' is this app"),
        );
        return Ok(());
    }

    if detect_frontmost_app_name()
        .as_deref()
        .is_some_and(|frontmost| app_names_match(frontmost, target_app_name))
    {
        debug_log_handle(
            app,
            format!("activate_target_app skipped: '{target_app_name}' already frontmost"),
        );
        return Ok(());
    }

    debug_log_handle(
        app,
        format!(
            "activate_target_app requested target='{}' current_frontmost='{}'",
            target_app_name,
            detect_frontmost_app_name().as_deref().unwrap_or("unknown")
        ),
    );
    let output = Command::new("osascript")
        .arg("-e")
        .arg(format!(
            "tell application \"{}\" to activate",
            applescript_escape(target_app_name)
        ))
        .output()
        .map_err(|e| AppError::Message(format!("Failed to reactivate target app: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::Message(format!(
            "Failed to reactivate target app before paste. {}",
            if stderr.is_empty() {
                "Bring the destination app to the front and try again.".to_string()
            } else {
                stderr
            }
        )));
    }

    thread::sleep(Duration::from_millis(TARGET_APP_REFOCUS_DELAY_MS));
    debug_log_handle(
        app,
        format!(
            "activate_target_app completed target='{}' new_frontmost='{}'",
            target_app_name,
            detect_frontmost_app_name().as_deref().unwrap_or("unknown")
        ),
    );
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn activate_target_app(_app: &AppHandle, _target_app_name: Option<&str>) -> Result<(), AppError> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn type_text_via_applescript(text: &str) -> Result<(), AppError> {
    let mut script_lines = vec!["tell application \"System Events\"".to_string()];
    let lines: Vec<&str> = text.split('\n').collect();

    for (line_index, line) in lines.iter().enumerate() {
        let mut chunk = String::new();
        let mut chunk_len = 0usize;

        for ch in line.chars() {
            chunk.push(ch);
            chunk_len += 1;
            if chunk_len >= TERMINAL_TYPE_CHUNK_SIZE {
                script_lines.push(format!("keystroke \"{}\"", applescript_escape(&chunk)));
                chunk.clear();
                chunk_len = 0;
            }
        }

        if !chunk.is_empty() {
            script_lines.push(format!("keystroke \"{}\"", applescript_escape(&chunk)));
        }

        if line_index + 1 < lines.len() {
            script_lines.push("key code 36".to_string());
        }
    }

    script_lines.push("end tell".to_string());

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script_lines.join("\n"))
        .output()
        .map_err(|e| AppError::Message(format!("Failed to run osascript typing fallback: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(AppError::Message(format!(
            "Terminal typing fallback failed. Check Accessibility permissions. {stderr}"
        )));
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn post_command_v_event(target_pid: Option<i32>) -> Result<(), AppError> {
    let key_down = unsafe { CGEventCreateKeyboardEvent(std::ptr::null(), MAC_V_KEYCODE, true) };
    if key_down.is_null() {
        return Err(AppError::Message(
            "Failed to create paste key-down event.".to_string(),
        ));
    }

    let key_up = unsafe { CGEventCreateKeyboardEvent(std::ptr::null(), MAC_V_KEYCODE, false) };
    if key_up.is_null() {
        unsafe {
            CFRelease(key_down as CFTypeRef);
        }
        return Err(AppError::Message(
            "Failed to create paste key-up event.".to_string(),
        ));
    }

    unsafe {
        CGEventSetFlags(key_down, CG_EVENT_FLAG_MASK_COMMAND);
        CGEventSetFlags(key_up, CG_EVENT_FLAG_MASK_COMMAND);
        if let Some(pid) = target_pid {
            CGEventPostToPid(pid, key_down);
            CGEventPostToPid(pid, key_up);
        } else {
            CGEventPost(CGEventTapLocation::Hid, key_down);
            CGEventPost(CGEventTapLocation::Hid, key_up);
        }
        CFRelease(key_down as CFTypeRef);
        CFRelease(key_up as CFTypeRef);
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn send_paste_keystroke(
    app: &AppHandle,
    insertion_target_app: Option<&str>,
) -> Result<(), AppError> {
    let target_pid = insertion_target_app
        .and_then(detect_app_pid_by_name)
        .or_else(detect_frontmost_app_pid);
    debug_log_handle(
        app,
        format!(
            "clipboard paste fallback posting cmd_v target_pid={} frontmost={}",
            target_pid
                .map(|pid| pid.to_string())
                .unwrap_or_else(|| "none".to_string()),
            detect_frontmost_app_name().as_deref().unwrap_or("unknown")
        ),
    );
    post_command_v_event(target_pid)
}

#[cfg(not(target_os = "macos"))]
fn send_paste_keystroke(
    _app: &AppHandle,
    _insertion_target_app: Option<&str>,
) -> Result<(), AppError> {
    Err(AppError::Message(
        "Clipboard paste fallback is only implemented on macOS.".to_string(),
    ))
}

fn paste_text(
    app: &AppHandle,
    text: &str,
    insertion_target_app: Option<&str>,
) -> Result<(), AppError> {
    debug_log_handle(
        app,
        format!(
            "paste_text begin target_app={} frontmost_before={} chars={}",
            insertion_target_app.unwrap_or("none"),
            detect_frontmost_app_name().as_deref().unwrap_or("unknown"),
            text.chars().count()
        ),
    );
    activate_target_app(app, insertion_target_app)?;

    #[cfg(target_os = "macos")]
    {
        let target_is_terminal = insertion_target_app
            .map(is_terminal_like_app)
            .unwrap_or_else(|| {
                detect_frontmost_app_name()
                    .as_deref()
                    .is_some_and(is_terminal_like_app)
            });

        if target_is_terminal {
            debug_log_handle(app, "paste_text using terminal typing fallback".to_string());
            match type_text_via_applescript(text) {
                Ok(()) => {
                    debug_log_handle(app, "terminal typing fallback succeeded".to_string());
                    return Ok(());
                }
                Err(error) => {
                    debug_log_handle(app, format!("terminal typing fallback failed: {error}"));
                }
            }
        } else {
            match insert_text_via_accessibility(text, insertion_target_app) {
                Ok(()) => {
                    debug_log_handle(
                        app,
                        format!(
                            "accessibility text insertion succeeded frontmost_after={}",
                            detect_frontmost_app_name().as_deref().unwrap_or("unknown")
                        ),
                    );
                    return Ok(());
                }
                Err(error) => {
                    debug_log_handle(
                        app,
                        format!("accessibility text insertion unavailable: {error}"),
                    );
                }
            }
        }
    }

    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| AppError::Message(format!("Clipboard: {e}")))?;
    let original_text = match clipboard.get_text() {
        Ok(value) => Some(value),
        Err(e) => {
            eprintln!("Clipboard read failed before paste; skipping restore: {e}");
            None
        }
    };

    clipboard
        .set_text(text.to_string())
        .map_err(|e| AppError::Message(format!("Clipboard write failed: {e}")))?;
    debug_log_handle(
        app,
        "clipboard payload staged for paste fallback".to_string(),
    );

    thread::sleep(Duration::from_millis(PRE_PASTE_DELAY_MS));

    let mut paste_result = send_paste_keystroke(app, insertion_target_app);
    if paste_result.is_err() {
        debug_log_handle(app, "paste keystroke retry scheduled".to_string());
        thread::sleep(Duration::from_millis(PASTE_RETRY_BACKOFF_MS));
        paste_result = send_paste_keystroke(app, insertion_target_app);
    }

    if let Err(error) = paste_result {
        #[cfg(target_os = "macos")]
        {
            let accessibility_status = check_accessibility_permission();
            if accessibility_status.is_supported && !accessibility_status.is_granted {
                restore_clipboard_after_delay(original_text, text.to_string());
                return Err(AppError::Message(
                    format!(
                        "Paste failed because Accessibility permission is missing. Open System Settings > Privacy & Security > Accessibility and enable {}, then use the app's Open Accessibility Settings button to jump there.",
                        app_display_name()
                    ),
                ));
            }
        }

        debug_log_handle(app, format!("paste keystroke failed error={error}"));
        restore_clipboard_after_delay(original_text, text.to_string());
        return Err(error);
    }

    restore_clipboard_after_delay(original_text, text.to_string());

    debug_log_handle(
        app,
        format!(
            "clipboard paste fallback dispatched frontmost_after={}",
            detect_frontmost_app_name().as_deref().unwrap_or("unknown")
        ),
    );
    Ok(())
}

fn restore_clipboard_after_delay(original_text: Option<String>, temporary_text: String) {
    let Some(original_text) = original_text else {
        return;
    };

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(CLIPBOARD_RESTORE_DELAY_MS));
        match arboard::Clipboard::new() {
            Ok(mut clipboard) => {
                // Safety guard: only restore if our temporary dictation text is still present.
                // If the user copied something else after paste, leave their clipboard untouched.
                match clipboard.get_text() {
                    Ok(current_text) if current_text == temporary_text => {
                        if let Err(e) = clipboard.set_text(original_text) {
                            eprintln!("Clipboard restore failed: {e}");
                        }
                    }
                    Ok(_) => {}
                    Err(e) => {
                        eprintln!("Clipboard read failed during restore; leaving clipboard unchanged: {e}");
                    }
                }
            }
            Err(e) => {
                eprintln!("Clipboard reopen failed during restore: {e}");
            }
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let state: State<AppState> = app.state();
                    debug_log_state(
                        &state,
                        format!(
                            "global_shortcut_event shortcut={} state={:?}",
                            shortcut, event.state
                        ),
                    );
                    let shortcuts = state
                        .current_shortcuts
                        .lock()
                        .map(|lock| lock.clone())
                        .unwrap_or_default();

                    if registered_shortcut_matches(&shortcuts.hold, shortcut) {
                        handle_shortcut_event(app, &state, RecordingModeKind::Hold, event.state);
                    } else if registered_shortcut_matches(&shortcuts.toggle, shortcut) {
                        handle_shortcut_event(app, &state, RecordingModeKind::Toggle, event.state);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let settings = load_settings(app.handle());
            let http_client = reqwest::Client::builder()
                .timeout(Duration::from_secs(API_CLIENT_TIMEOUT_SECS))
                .build()
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;

            let transcript_history = load_transcript_history(app.handle());
            let durable_draft = load_durable_draft(app.handle());
            let state = AppState {
                settings: Mutex::new(settings.clone()),
                runtime_status: Mutex::new(RuntimeStatus {
                    is_recording: false,
                    is_processing: false,
                    mic_level: 0,
                    last_message: "Ready".to_string(),
                }),
                recorder: Mutex::new(None),
                current_shortcuts: Mutex::new(RegisteredShortcuts::default()),
                http_client,
                transcript_history: Mutex::new(transcript_history),
                durable_draft: Mutex::new(durable_draft),
                debug_log: Mutex::new(Vec::new()),
            };
            app.manage(state);

            let app_state: State<AppState> = app.state();
            match register_shortcuts_strict(
                app.handle(),
                &app_state,
                &settings.hold_hotkeys,
                &settings.toggle_hotkeys,
            ) {
                Ok(()) => debug_log_state(
                    &app_state,
                    format!(
                        "startup_shortcuts hold={:?} toggle={:?}",
                        settings.hold_hotkeys, settings.toggle_hotkeys
                    ),
                ),
                Err(error) => {
                    set_status(
                        app.handle(),
                        &app_state,
                        None,
                        None,
                        None,
                        "Saved shortcuts aren't available. Open Settings > Shortcuts.".to_string(),
                    );
                    debug_log_state(
                        &app_state,
                        format!(
                            "startup_shortcuts_failed hold={:?} toggle={:?} error={}",
                            settings.hold_hotkeys, settings.toggle_hotkeys, error
                        ),
                    );
                }
            }
            if let Ok(state_settings) = app_state.settings.lock() {
                debug_log_state(
                    &app_state,
                    format!(
                        "loaded_settings hold={:?} toggle={:?}",
                        state_settings.hold_hotkeys, state_settings.toggle_hotkeys,
                    ),
                );
            }
            emit_transcript_history(app.handle(), &app_state);
            emit_durable_draft(app.handle(), &app_state);

            let open_item = MenuItem::with_id(app, "open", "Open Settings", true, None::<&str>)?;
            let toggle_item =
                MenuItem::with_id(app, "toggle", "Start / Stop Recording", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &toggle_item, &quit_item])?;

            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .menu(&menu)
                .tooltip(app_display_name())
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "toggle" => {
                        let state: State<AppState> = app.state();
                        let _ = toggle_recording_inner(app, &state);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_runtime_status,
            get_debug_log,
            get_transcript_history,
            clear_transcript_history,
            get_durable_draft,
            clear_durable_draft,
            copy_text_to_clipboard,
            set_hotkey_capture_mode,
            toggle_recording,
            test_api_connection,
            check_accessibility_permission,
            request_accessibility_permission,
            open_accessibility_settings,
            reset_accessibility_permission,
            check_microphone_permission,
            request_microphone_permission,
            open_microphone_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
