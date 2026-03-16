# Android Lightweight Path (No Full Android Studio Required)

## Goal

Add Android later with the smallest practical toolchain while keeping this repo's desktop-first MVP intact.

## Options Compared

1. Tauri Mobile + Android command-line SDK tools (recommended)
- Keep existing Rust + web frontend architecture.
- Use Tauri CLI (`android init/dev/build/run`) for lifecycle commands.
- Use Android SDK command-line tools + `sdkmanager` to install SDK/NDK/build-tools.
- Android Studio is optional (useful for debugging, but not required in the baseline workflow).

2. Capacitor (WebView shell)
- Lightweight JS-centric option, but introduces a second native stack and migration cost from Tauri runtime assumptions.
- Easier if team is purely web-first, weaker fit if Rust core is central.

3. React Native / Flutter
- Mature mobile ecosystems but largest rewrite cost and largest conceptual/tooling delta from this codebase.

## Recommendation

Use Option 1: Tauri Mobile with command-line Android SDK tooling.

Why:
- minimal architectural drift from current MVP,
- reuses Rust pipeline logic,
- keeps desktop and Android under one Tauri stack,
- avoids requiring full Android Studio for baseline CI/dev flows.

## Minimal Command-Line Toolchain

1. Install JDK.
2. Install Android command-line tools.
3. Use `sdkmanager` to install required packages (`platform-tools`, platform SDK, build-tools, NDK).
4. Set `ANDROID_HOME` and `NDK_HOME`.
5. Run Tauri Android commands.

Example commands:
```bash
# inside project
yarn tauri android init
yarn tauri android dev
yarn tauri android build
```

## Sources

- Android command-line tools overview:
  - https://developer.android.com/tools
- `sdkmanager` official docs:
  - https://developer.android.com/tools/sdkmanager
- Tauri CLI Android commands:
  - https://v2.tauri.app/reference/cli/
