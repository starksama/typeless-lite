1. Add hotkey conflict preflight in UI before save (hotkey UX). Success criteria: unavailable shortcuts show conflict guidance and one-click suggested fallback before backend save.
2. Add transcript history export to `.txt` and `.json` (history). Success criteria: one-click export for current filtered history; exported entry count matches visible filtered count.
3. Add bounded retry/backoff plus explicit restore CTA for draft-recovery failures (reliability hardening). Success criteria: simulated 429/5xx paths retry safely and keep single-paste behavior with recoverable draft still intact.
