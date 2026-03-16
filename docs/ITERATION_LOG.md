# Iteration Log

## 2026-03-16T14:18:00Z
- Area worked: cross-app insertion reliability
- User value: Captures the destination app at record start and reactivates it before insertion, so processed dictation is pasted back into the intended app instead of whichever window is frontmost later.
- Files changed:
  - `src-tauri/src/main.rs`
  - `README.md`
  - `docs/ITERATION_LOG.md`
- Validation result:
  - `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
  - `npm run build` (pass)

## 2026-03-16T13:42:00Z
- Area worked: visual polish follow-up
- User value: Removes filler marketing cards, narrows the sidebar, reduces roundness, and tones down typography so the app feels more professional and less toy-like.
- Files changed:
  - `index.html`
  - `src/main.ts`
  - `src/style.css`
  - `docs/RESEARCH_NOTES.md`
  - `docs/ITERATION_LOG.md`
- Validation result:
  - `npm run build` (pass)

## 2026-03-16T13:09:39Z
- Area worked: settings diagnostics UX follow-up
- User value: Adds explicit in-panel feedback for `Copy diagnostics` (copying/success/failure) so users can confirm outcome without leaving Settings.
- Validation result:
  - `yarn build` (pass)

## 2026-03-16T12:38:53Z
- Area worked: settings diagnostics UX
- User value: Adds a concise Settings status panel with one-click `Copy diagnostics` to share runtime, accessibility, and API test state in bug reports.
- Files changed:
  - `index.html`
  - `src/main.ts`
  - `src/style.css`
  - `docs/ITERATION_LOG.md`
  - `docs/NEXT_ITERATION.md`
- Validation result:
  - `yarn build` (blocked: local dependencies unavailable and network to `registry.yarnpkg.com` is unreachable in this environment)

## 2026-03-16T11:40:20Z
- Area worked: reliability hardening
- User value: Retries transient 429/5xx API failures during transcription/formatting and gives explicit draft recovery CTA when failures occur after draft capture.
- Files changed:
  - `src-tauri/src/main.rs`
  - `docs/ITERATION_LOG.md`
  - `docs/NEXT_ITERATION.md`
- Validation result:
  - `yarn build` (pass)

## 2026-03-16T11:09:27Z
- Area worked: onboarding UX
- User value: Prevents incomplete first-run setup by validating API key and API base URL inline, with one-click base URL normalization before continuing.
- Files changed:
  - `src/main.ts`
  - `index.html`
  - `docs/ITERATION_LOG.md`
  - `docs/NEXT_ITERATION.md`
- Validation result:
  - `yarn build` (pass)

## 2026-03-16T10:09:34Z
- Area worked: hotkey UX
- User value: Adds editable custom conflict fallback mappings with local persistence so preflight suggestions remain one-click while allowing per-user overrides.
- Files changed:
  - `src/main.ts`
  - `index.html`
  - `src/style.css`
  - `docs/ITERATION_LOG.md`
  - `docs/NEXT_ITERATION.md`
- Validation result:
  - `yarn build` (pass)

## 2026-03-16T09:37:56Z
- Area worked: history export
- User value: Adds one-click export of currently filtered transcript history to `.txt` and `.json` with count-aware filenames.
- Files changed:
  - `index.html`
  - `src/main.ts`
  - `docs/ITERATION_LOG.md`
  - `docs/NEXT_ITERATION.md`
- Validation result:
  - `yarn build` (pass)

## 2026-03-16T09:08:13Z
- Area worked: hotkey UX
- User value: Prevents saving likely-conflicting shortcuts by warning early and offering one-click fallback presets in both Settings and onboarding.
- Files changed:
  - `src/main.ts`
  - `index.html`
  - `docs/ITERATION_LOG.md`
  - `docs/NEXT_ITERATION.md`
- Validation result:
  - `yarn build` (pass)

## 2026-03-16T08:07:41Z
- Area worked: reliability
- User value: Prevents transcript history selection glitches caused by duplicate entry IDs when multiple transcripts are created within the same millisecond.
- Discovery signals (new):
  - MDN notes `Date.now()` precision can be reduced and is millisecond-based, increasing collision risk for ID generation in fast paths: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/now
  - React docs require list keys to be unique and stable to avoid incorrect UI reconciliation, which mirrors our history-item identity needs: https://react.dev/learn/rendering-lists
  - Nano ID guidance highlights collision risk tradeoffs in ID strategies and recommends robust unique-ID generation for production data identity: https://github.com/ai/nanoid
- Files changed:
  - `src-tauri/src/main.rs`
  - `docs/ITERATION_LOG.md`
  - `docs/NEXT_ITERATION.md`
- Validation result:
  - `yarn build` (pass)

## 2026-03-16T08:39:00Z
- Area worked: dictation reliability
- User value: Prevents losing long dictations when formatting/paste/API steps fail by keeping a recoverable durable draft.
- Files changed:
  - `src-tauri/src/main.rs`
  - `src/main.ts`
  - `src/style.css`
  - `index.html`
  - `docs/ITERATION_LOG.md`
  - `docs/NEXT_ITERATION.md`
- Validation result:
  - `yarn build` (pass)
