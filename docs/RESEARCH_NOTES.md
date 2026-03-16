# Research Notes

These notes are intentionally separated from `README.md`.

## Product Pattern (Typeless / Flow-style)

Core workflow:
1. Capture speech with a global shortcut.
2. Transcribe speech to text.
3. Optionally format/clean with an LLM.
4. Insert into the active input quickly.

## Key References

### Tauri: shortcuts, tray, distribution
- https://v2.tauri.app/plugin/global-shortcut/
- https://v2.tauri.app/learn/system-tray/
- https://v2.tauri.app/distribute/macos-application-bundle/
- https://tauri.app/distribute/sign/macos/

### macOS permissions
- Accessibility permission: https://support.apple.com/en-euro/guide/mac-help/mh43185/mac
- Microphone permission: https://support.apple.com/en-afri/guide/mac-help/mchla1b1e1fe/mac

### OpenAI speech + formatting APIs
- Speech-to-text guide: https://platform.openai.com/docs/guides/speech-to-text
- Whisper model reference: https://platform.openai.com/docs/models/whisper-1
- Chat completions: https://platform.openai.com/docs/api-reference/chat/create-chat-completion

### Lightweight Android path (no full Android Studio UI required)
- Android CLI tools: https://developer.android.com/tools
- sdkmanager: https://developer.android.com/tools/sdkmanager
- Tauri CLI reference: https://v2.tauri.app/reference/cli/

See also: `ANDROID_LIGHTWEIGHT.md`.
