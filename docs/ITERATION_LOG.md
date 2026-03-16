# Iteration Log

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
