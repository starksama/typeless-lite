# Typeless Lite

Open-source macOS voice-to-text assistant (Typeless / Flow-style alternative):
- global hotkey dictation,
- Whisper transcription,
- optional LLM cleanup,
- paste back into the app/terminal that was active when dictation started.

## Features

- Global hotkey recording with two modes:
  - **Hold**: hold key to record, release to stop
  - **Toggle**: press once to start, press again to stop
- Transcription via `/v1/audio/transcriptions`
- Optional formatting via `/v1/chat/completions`
- Context-aware formatting hints (terminal/chat/email)
- Optional clipboard context for formatter
- Optional fast mode (skip formatter)
- Paste back into the prior target app with clipboard restore
- Accessibility permission helper + startup prompt
- First-run onboarding wizard + reopen option
- Transcript history center (search/filter/copy/reuse/clear)
- Tabbed UI: Home, Dictation, History, Settings

## Quick Start

Prereqs:
- Node.js 20+
- Rust 1.77+
- macOS

```bash
yarn install
yarn tauri:dev
```

Build:
```bash
yarn tauri:build
```

## Required macOS Permissions

1. **Microphone**  
   System Settings -> Privacy & Security -> Microphone

2. **Accessibility** (for insert/paste automation)  
   System Settings -> Privacy & Security -> Accessibility

Typeless Lite checks Accessibility status and can open the correct settings page for you.

## Main Settings

- API Key / API Base URL
- Whisper model
- Formatter model + prompt
- Custom vocabulary
- Global hotkey
- Recording mode (hold/toggle)
- Transcription language (`auto`, `en`, `zh`, `zh-TW`, `ja`, `ko`, `es`, `fr`, `de`)

## Troubleshooting

- Intel macOS + stable Rust + `zerocopy` AVX512 `E0658`: this repo includes a root Cargo cfg override in `.cargo/config.toml`.

## Project Structure

- `src/` frontend (Vite + TypeScript)
- `src-tauri/src/main.rs` core desktop/runtime logic
- `ANDROID_LIGHTWEIGHT.md` Android path notes
- `docs/RESEARCH_NOTES.md` references and research links

## Security

- API key is user-provided and stored locally.
- No secrets are hardcoded.
- Clipboard context is optional and only sent when formatting is enabled.
