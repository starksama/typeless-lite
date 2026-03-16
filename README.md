# Typeless Lite (Tauri MVP)

A tiny mac desktop app inspired by Typeless: hold a global hotkey, speak, transcribe with Whisper, run an LLM formatting pass, then paste into the currently focused app.

## What Typeless Does (Research Summary)

As of March 15, 2026, a Typeless-style workflow is:
- capture speech with a global shortcut,
- convert speech to text,
- clean/format the text with an LLM,
- insert into the active input quickly.

This MVP implements exactly that flow on macOS with Tauri and minimal UI.

## Brief Research Notes (Official/Reliable Sources)

1. Tauri global shortcuts + tray + mac build/distribution
- Tauri global-shortcut plugin supports macOS and Rust handlers; permissions must be explicitly enabled in capability files.
  - https://v2.tauri.app/plugin/global-shortcut/
- Tauri tray support in v2 uses the `tray-icon` feature and `TrayIconBuilder`.
  - https://v2.tauri.app/learn/system-tray/
- Tauri mac bundling uses `tauri build` on macOS and produces `.app`/`.dmg`; signing and notarization are documented separately.
  - https://v2.tauri.app/distribute/macos-application-bundle/
  - https://tauri.app/distribute/sign/macos/

2. macOS accessibility permissions for global text insertion
- Apple documents Accessibility permission as required when an app controls the Mac (synthetic keystrokes / UI control).
  - https://support.apple.com/en-euro/guide/mac-help/mh43185/mac
- Apple documents microphone permission controls in Privacy & Security.
  - https://support.apple.com/en-afri/guide/mac-help/mchla1b1e1fe/mac

3. OpenAI Whisper transcription API usage
- OpenAI speech-to-text guide: `transcriptions` endpoint supports `whisper-1` and newer transcribe models; common file formats include `wav`; file size limits apply.
  - https://platform.openai.com/docs/guides/speech-to-text
- Whisper model and endpoint compatibility:
  - https://platform.openai.com/docs/models/whisper-1
- Chat Completions endpoint used for formatting step:
  - https://platform.openai.com/docs/api-reference/chat/create-chat-completion

4. Lightweight Android path without Android Studio
- Android official docs support SDK setup via command-line tools + `sdkmanager` (no Android Studio required).
  - https://developer.android.com/tools
  - https://developer.android.com/tools/sdkmanager
- Tauri CLI supports `android init/dev/build/run` from CLI.
  - https://v2.tauri.app/reference/cli/
- Recommendation details are in `ANDROID_LIGHTWEIGHT.md`.

## MVP Scope Implemented

- mac desktop first (Tauri v2 scaffold)
- global hotkey hold-to-talk (press to start, release to stop)
- WAV recording from default input device
- transcription via `/v1/audio/transcriptions`
- LLM formatting pass via `/v1/chat/completions`
- formatter prompt is context-aware: it includes frontmost app style hints (Terminal/iTerm shell style, Slack/Discord/Telegram chat tone, Gmail/Outlook professional email tone, otherwise neutral)
- formatter prompt can include optional clipboard reference context (truncated to 500 chars) to reduce manual edits
- optional fast mode to skip LLM formatting and paste raw transcript
- paste into focused app using clipboard + `Cmd+V` fallback path
- paste is non-destructive for text clipboard contents (restored shortly after simulated `Cmd+V`)
- tray menu for open/toggle/quit
- minimal settings UI for API key, prompt template, hotkey, models, base URL
- settings persisted to app config dir JSON
- status events pushed to UI for user feedback
- live mic activity meter (0-100) in Settings status panel while recording

## Project Layout

- `src/`: minimal settings frontend (Vite + TypeScript)
- `src-tauri/src/main.rs`: hotkey, audio capture, API pipeline, paste logic, tray
- `src-tauri/capabilities/default.json`: global-shortcut permissions
- `.env.example`: environment template (no secrets committed)
- `ANDROID_LIGHTWEIGHT.md`: Android path comparison and recommendation

## Setup

Prereqs:
- Node.js 20+
- Rust 1.77+
- macOS

Install deps:
```bash
yarn install
```

Run in dev:
```bash
yarn tauri:dev
```

Build bundle:
```bash
yarn tauri:build
```

## Troubleshooting

- Intel macOS + stable Rust + `zerocopy` AVX512 `E0658`: this repo now includes a root Cargo cfg override at `.cargo/config.toml` so `yarn tauri:dev` from repo root picks up the workaround automatically.

## macOS Permissions (Required)

1. Microphone:
- System Settings -> Privacy & Security -> Microphone -> allow Typeless Lite.

2. Accessibility (for keystroke paste automation):
- System Settings -> Privacy & Security -> Accessibility -> allow Typeless Lite.
- In-app helper: use `Check Accessibility` to confirm current status and `Open Accessibility Settings` to jump directly to the right macOS settings pane.

If paste fails but transcript/formatting succeed, Accessibility permission is usually missing.

## Settings

Open the app window and configure:
- `API Key` (required)
- `API Base URL` (default `https://api.openai.com/v1`; supports compatible providers)
- `Whisper Model` (default `whisper-1`)
- `Custom Vocabulary` (optional; domain terms/names/acronyms sent as Whisper prompt guidance to improve transcription accuracy)
- `Formatter Model` (default `gpt-4o-mini`)
- `Run LLM formatting pass` (on by default; disable for lower latency/cost)
- `Include clipboard context for formatter` (on by default; when enabled, clipboard text may be sent as optional context during formatting)
- `Play subtle sound cues` (on by default; start/success/error earcons on macOS)
- `Global Hotkey` (default `Cmd+Shift+Space`)
- `Prompt Template` (base formatting instruction; runtime context hints are appended automatically)

Transcription prompt behavior:
- When `Custom Vocabulary` and/or clipboard reference context is available, the app sends a single concise deterministic Whisper `prompt` combining whichever sources exist.
- If both are empty, no transcription prompt guidance is sent.

## Security Notes

- API keys are user-provided and saved locally in app config.
- Optional clipboard reference context is used transiently for formatting only, is never stored by the app, and is only sent when both `Run LLM formatting pass` and `Include clipboard context for formatter` are enabled.
- Optional custom vocabulary is persisted in local settings and sent only as transcription guidance.
- No secrets are hardcoded.
- `.env.example` is provided only as a template.

## Known Gaps in This Environment

The current execution environment could not access package registries (DNS/network restricted), so dependency installation and full compile/run were blocked here. See final status summary for exact commands and failures.
