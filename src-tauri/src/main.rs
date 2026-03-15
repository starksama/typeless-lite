#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::BufWriter,
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const APP_STATUS_EVENT: &str = "runtime-status";
const TRAY_ID: &str = "main-tray";
const PRE_PASTE_DELAY_MS: u64 = 60;
const PASTE_RETRY_BACKOFF_MS: u64 = 45;
const CLIPBOARD_RESTORE_DELAY_MS: u64 = 300;
const MIN_RECORDING_MS: u128 = 400;
const API_TEST_TIMEOUT_SECS: u64 = 6;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Settings {
    api_key: String,
    prompt_template: String,
    hotkey: String,
    whisper_model: String,
    format_model: String,
    #[serde(default = "default_format_enabled")]
    format_enabled: bool,
    api_base_url: String,
}

fn default_format_enabled() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            prompt_template: "You are a concise writing assistant. Clean up the transcript for grammar and punctuation while preserving intent. Return only final text.".to_string(),
            hotkey: "Cmd+Shift+Space".to_string(),
            whisper_model: "whisper-1".to_string(),
            format_model: "gpt-4o-mini".to_string(),
            format_enabled: true,
            api_base_url: "https://api.openai.com/v1".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
struct RuntimeStatus {
    is_recording: bool,
    is_processing: bool,
    last_message: String,
}

struct AppState {
    settings: Mutex<Settings>,
    runtime_status: Mutex<RuntimeStatus>,
    recorder: Mutex<Option<RecorderSession>>,
    current_shortcut: Mutex<Option<Shortcut>>,
}

struct RecorderSession {
    stream: cpal::Stream,
    writer: Arc<Mutex<Option<hound::WavWriter<BufWriter<std::fs::File>>>>>,
    path: PathBuf,
    started_at: Instant,
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
    fn stop(self) -> Result<(PathBuf, Duration), AppError> {
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
        Ok((self.path, elapsed))
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
            last_message: "State unavailable".to_string(),
        })
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> Result<(), String> {
    if settings.hotkey.trim().is_empty() {
        return Err("Hotkey cannot be empty".to_string());
    }

    {
        let mut lock = state
            .settings
            .lock()
            .map_err(|_| "Failed to lock settings".to_string())?;
        *lock = settings.clone();
    }

    persist_settings(&app, &settings).map_err(|e| e.to_string())?;
    register_shortcut(&app, &state, &settings.hotkey)?;
    set_status(
        &app,
        &state,
        None,
        None,
        format!("Settings saved. Hotkey: {}", settings.hotkey),
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
        return Err("API key is missing. Add your API key and save settings first.".to_string());
    }

    let base_url = settings.api_base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err(
            "API base URL is missing. Set it (example: https://api.openai.com/v1).".to_string(),
        );
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
        return Ok("API connection successful.".to_string());
    }

    let body = response
        .text()
        .await
        .unwrap_or_else(|_| "<no response body>".to_string());

    match status.as_u16() {
        401 => Err(
            "Connection failed (401 Unauthorized). Your API key looks invalid. Double-check it and save again."
                .to_string(),
        ),
        404 => Err(
            "Connection failed (404 Not Found). API base URL is likely incorrect. Check it includes the right version path (for OpenAI: https://api.openai.com/v1)."
                .to_string(),
        ),
        _ => Err(format!(
            "Connection failed ({status}). API response: {}",
            summarize_http_body(&body)
        )),
    }
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

fn map_test_connection_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        return format!(
            "Connection timed out after {API_TEST_TIMEOUT_SECS}s. Check your network, firewall/VPN settings, and API base URL."
        );
    }
    if error.is_connect() || error.is_request() {
        return "Could not reach the API host. Verify your internet connection and API base URL."
            .to_string();
    }
    format!("Connection test failed: {error}")
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

fn set_status(
    app: &AppHandle,
    state: &State<AppState>,
    is_recording: Option<bool>,
    is_processing: Option<bool>,
    message: String,
) {
    if let Ok(mut status) = state.runtime_status.lock() {
        if let Some(v) = is_recording {
            status.is_recording = v;
        }
        if let Some(v) = is_processing {
            status.is_processing = v;
        }
        status.last_message = message;
        update_tray_status(app, &status);
        let _ = app.emit(APP_STATUS_EVENT, status.clone());
    }
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
    let tooltip = format!("Typeless Lite - {state_label}");
    let _ = tray.set_tooltip(Some(tooltip));

    #[cfg(target_os = "macos")]
    {
        let _ = tray.set_title(Some(state_label));
    }
}

fn register_shortcut(app: &AppHandle, state: &State<AppState>, hotkey: &str) -> Result<(), String> {
    let shortcut = hotkey
        .parse::<Shortcut>()
        .map_err(|e| format!("Invalid hotkey '{hotkey}': {e}"))?;

    if let Ok(mut lock) = state.current_shortcut.lock() {
        if let Some(existing) = lock.take() {
            let _ = app.global_shortcut().unregister(existing);
        }
        app.global_shortcut()
            .register(shortcut)
            .map_err(|e| format!("Failed to register hotkey: {e}"))?;
        *lock = Some(shortcut);
        Ok(())
    } else {
        Err("Failed to lock shortcut state".to_string())
    }
}

fn toggle_recording_inner(app: &AppHandle, state: &State<AppState>) -> Result<(), String> {
    let maybe_session = {
        let mut lock = state
            .recorder
            .lock()
            .map_err(|_| "Recorder lock poisoned".to_string())?;
        if lock.is_some() {
            lock.take()
        } else {
            let session = start_recording().map_err(|e| e.to_string())?;
            *lock = Some(session);
            set_status(
                app,
                state,
                Some(true),
                Some(false),
                "Recording... release hotkey to stop (or toggle manually).".to_string(),
            );
            return Ok(());
        }
    };

    if let Some(session) = maybe_session {
        let (wav_path, elapsed) = session.stop().map_err(|e| e.to_string())?;
        if elapsed.as_millis() < MIN_RECORDING_MS {
            let _ = fs::remove_file(&wav_path);
            set_status(
                app,
                state,
                Some(false),
                Some(false),
                "Recording too short — hold hotkey and speak longer.".to_string(),
            );
            return Ok(());
        }

        set_status(
            app,
            state,
            Some(false),
            Some(true),
            "Transcribing and formatting...".to_string(),
        );

        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let app_state: State<AppState> = app_handle.state();
            if let Err(err) = process_audio_pipeline(&app_handle, &app_state, wav_path).await {
                set_status(
                    &app_handle,
                    &app_state,
                    Some(false),
                    Some(false),
                    format!("Failed: {err}"),
                );
            }
        });
    }

    Ok(())
}

fn start_recording() -> Result<RecorderSession, AppError> {
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
    let path = std::env::temp_dir().join(format!("typeless-lite-{epoch}.wav"));

    let spec = hound::WavSpec {
        channels: config.channels,
        sample_rate: config.sample_rate.0,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let writer = hound::WavWriter::create(&path, spec)
        .map_err(|e| AppError::Message(format!("Failed creating WAV file: {e}")))?;
    let writer = Arc::new(Mutex::new(Some(writer)));

    let err_fn = |err| {
        eprintln!("Audio stream error: {err}");
    };

    let writer_clone = writer.clone();
    let stream = match supported_config.sample_format() {
        cpal::SampleFormat::F32 => device
            .build_input_stream(
                &config,
                move |data: &[f32], _| write_samples_f32(data, &writer_clone),
                err_fn,
                None,
            )
            .map_err(|e| AppError::Message(format!("Failed building f32 stream: {e}")))?,
        cpal::SampleFormat::I16 => {
            let writer_clone = writer.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[i16], _| write_samples_i16(data, &writer_clone),
                    err_fn,
                    None,
                )
                .map_err(|e| AppError::Message(format!("Failed building i16 stream: {e}")))?
        }
        cpal::SampleFormat::U16 => {
            let writer_clone = writer.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[u16], _| write_samples_u16(data, &writer_clone),
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

    Ok(RecorderSession {
        stream,
        writer,
        path,
        started_at: Instant::now(),
    })
}

fn write_samples_f32(
    input: &[f32],
    writer: &Arc<Mutex<Option<hound::WavWriter<BufWriter<std::fs::File>>>>>,
) {
    if let Ok(mut lock) = writer.lock() {
        if let Some(w) = lock.as_mut() {
            for sample in input {
                let clamped = sample.clamp(-1.0, 1.0);
                let s = (clamped * i16::MAX as f32) as i16;
                let _ = w.write_sample(s);
            }
        }
    }
}

fn write_samples_i16(
    input: &[i16],
    writer: &Arc<Mutex<Option<hound::WavWriter<BufWriter<std::fs::File>>>>>,
) {
    if let Ok(mut lock) = writer.lock() {
        if let Some(w) = lock.as_mut() {
            for sample in input {
                let _ = w.write_sample(*sample);
            }
        }
    }
}

fn write_samples_u16(
    input: &[u16],
    writer: &Arc<Mutex<Option<hound::WavWriter<BufWriter<std::fs::File>>>>>,
) {
    if let Ok(mut lock) = writer.lock() {
        if let Some(w) = lock.as_mut() {
            for sample in input {
                let shifted = (*sample as i32 - 32768) as i16;
                let _ = w.write_sample(shifted);
            }
        }
    }
}

async fn process_audio_pipeline(
    app: &AppHandle,
    state: &State<'_, AppState>,
    wav_path: PathBuf,
) -> Result<(), AppError> {
    let pipeline_result = async {
        let settings = state
            .settings
            .lock()
            .map_err(|_| AppError::Message("Failed to lock settings".to_string()))?
            .clone();

        if settings.api_key.is_empty() {
            return Err(AppError::Message(
                "Missing API key. Save it in settings first.".to_string(),
            ));
        }

        let transcription = transcribe_audio(&settings, &wav_path).await?;
        let output_text = if settings.format_enabled {
            format_transcript(&settings, &transcription).await?
        } else {
            transcription
        };
        paste_text(&output_text)?;

        Ok::<(), AppError>(())
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

    result?;

    set_status(
        app,
        state,
        Some(false),
        Some(false),
        "Inserted text into focused app.".to_string(),
    );

    Ok(())
}

async fn transcribe_audio(settings: &Settings, wav_path: &PathBuf) -> Result<String, AppError> {
    let bytes = fs::read(wav_path)?;
    let url = format!("{}/audio/transcriptions", settings.api_base_url);
    let form = Form::new()
        .part(
            "file",
            Part::bytes(bytes)
                .file_name("recording.wav")
                .mime_str("audio/wav")
                .map_err(|e| AppError::Message(format!("MIME error: {e}")))?,
        )
        .text("model", settings.whisper_model.clone());

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .bearer_auth(&settings.api_key)
        .multipart(form)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<no body>".to_string());
        return Err(AppError::Message(format!(
            "Transcription failed ({status}): {body}"
        )));
    }

    let parsed: TranscriptionResponse = response.json().await?;
    Ok(parsed.text)
}

async fn format_transcript(settings: &Settings, transcript: &str) -> Result<String, AppError> {
    let url = format!("{}/chat/completions", settings.api_base_url);
    let request_body = serde_json::json!({
      "model": settings.format_model,
      "temperature": 0,
      "messages": [
        {"role":"system","content": settings.prompt_template},
        {"role":"user","content": transcript}
      ]
    });

    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .bearer_auth(&settings.api_key)
        .json(&request_body)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<no body>".to_string());
        return Err(AppError::Message(format!(
            "Formatting failed ({status}): {body}"
        )));
    }

    let parsed: ChatCompletionResponse = response.json().await?;
    let content = parsed
        .choices
        .first()
        .map(|c| c.message.content.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Message("No formatter output text received".to_string()))?;
    Ok(content)
}

fn paste_text(text: &str) -> Result<(), AppError> {
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

    thread::sleep(Duration::from_millis(PRE_PASTE_DELAY_MS));

    let run_paste_keystroke = || {
        Command::new("osascript")
            .arg("-e")
            .arg("tell application \"System Events\" to keystroke \"v\" using command down")
            .output()
            .map_err(|e| AppError::Message(format!("Failed to run osascript: {e}")))
    };

    let mut output = run_paste_keystroke();
    if match &output {
        Ok(paste_output) => !paste_output.status.success(),
        Err(_) => true,
    } {
        thread::sleep(Duration::from_millis(PASTE_RETRY_BACKOFF_MS));
        output = run_paste_keystroke();
    }
    let output = output?;

    restore_clipboard_after_delay(original_text);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(AppError::Message(format!(
            "Paste keystroke failed. Check Accessibility permissions. {stderr}"
        )));
    }

    Ok(())
}

fn restore_clipboard_after_delay(original_text: Option<String>) {
    let Some(original_text) = original_text else {
        return;
    };

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(CLIPBOARD_RESTORE_DELAY_MS));
        match arboard::Clipboard::new() {
            Ok(mut clipboard) => {
                if let Err(e) = clipboard.set_text(original_text) {
                    eprintln!("Clipboard restore failed: {e}");
                }
            }
            Err(e) => {
                eprintln!("Clipboard reopen failed during restore: {e}");
            }
        }
    });
}

fn default_hotkey() -> Shortcut {
    Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space)
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let state: State<AppState> = app.state();
                    let active_shortcut = state
                        .current_shortcut
                        .lock()
                        .ok()
                        .and_then(|s| *s)
                        .unwrap_or_else(default_hotkey);

                    if shortcut == &active_shortcut {
                        let is_recording = state.recorder.lock().ok().is_some_and(|r| r.is_some());
                        match event.state {
                            ShortcutState::Pressed if !is_recording => {
                                let _ = toggle_recording_inner(app, &state);
                            }
                            ShortcutState::Released if is_recording => {
                                let _ = toggle_recording_inner(app, &state);
                            }
                            _ => {}
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let settings = load_settings(app.handle());

            let state = AppState {
                settings: Mutex::new(settings.clone()),
                runtime_status: Mutex::new(RuntimeStatus {
                    is_recording: false,
                    is_processing: false,
                    last_message: "Ready".to_string(),
                }),
                recorder: Mutex::new(None),
                current_shortcut: Mutex::new(None),
            };
            app.manage(state);

            let app_state: State<AppState> = app.state();
            register_shortcut(app.handle(), &app_state, &settings.hotkey)
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;

            let open_item = MenuItem::with_id(app, "open", "Open Settings", true, None::<&str>)?;
            let toggle_item =
                MenuItem::with_id(app, "toggle", "Start / Stop Recording", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &toggle_item, &quit_item])?;

            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .menu(&menu)
                .tooltip("Typeless Lite")
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
            toggle_recording,
            test_api_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
