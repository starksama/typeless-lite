1. Validate API key/base URL on Settings save and before `test_api_connection` runs (consistency hardening). Success criteria: the same onboarding checks block invalid values in Settings with inline guidance.
2. Add import/export for custom hotkey conflict mappings (hotkey UX). Success criteria: users can back up and restore custom fallback mappings across machines without editing local storage.
3. Include app + environment metadata in copied diagnostics (supportability). Success criteria: diagnostics payload includes app version, platform, and active capture mode without exposing secrets.
