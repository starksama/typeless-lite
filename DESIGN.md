# Design

## Style Summary

Keylesss uses a restrained desktop shell with paired dark and light appearances, compact controls, low-radius panels, and one muted green accent for active state and confirmation. Texture should feel like a native utility surface: fine grain, inset bands, precise borders, and subtle live indicators.

## Color

- Background: `oklch(18% 0.014 235)`
- Shell: `oklch(21% 0.012 232)`
- Canvas: `oklch(24% 0.011 228)`
- Panel: `oklch(27% 0.012 225 / 0.92)`
- Panel strong: `oklch(31% 0.014 222 / 0.96)`
- Text: `oklch(93% 0.009 225)`
- Muted text: `oklch(71% 0.016 225)`
- Accent: `oklch(66% 0.086 170)`
- Warning: `oklch(70% 0.116 72)`
- Danger: `oklch(65% 0.13 35)`
- Success: `oklch(70% 0.102 155)`

Use accent color for current navigation, primary actions, live recording state, and confirmed setup only. Do not use purple gradients, glass cards, or brown primary buttons.

Light mode keeps the same graphite-green material system but raises neutral lightness instead of changing the brand palette. The appearance control should support System, Light, and Dark; System follows macOS.

## Typography

Use the native system stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`. Keep headings small and medium weight. Use monospace only for keycaps, diagnostics, and exact configuration values.

## Layout

The app shell fills the native window. Sidebar stays narrow and calm. Main canvas is inset, scrolls internally, and uses full-width page bands rather than nested cards. Settings keep a left section rail and a single active panel. On smaller widths, navigation collapses structurally, not through fluid type.

## Components

- Buttons: compact height, 8px radius, clear disabled and focus states.
- Inputs: dense, dark, bordered, with direct labels.
- Keycaps: separate tokens inside clickable shortcut controls.
- Status: short labels plus exact next action when action is needed. Runtime indicators should be steady, not blinking, and mic-level updates must not re-render the full state surface.
- Permission rows: show current state, OS action, and check again path.
- Meter: refined segmented bar with live sheen only while recording.
- Transcript rows: timeline style, click row to copy, subtle copied state.

## Motion

Use 150-240ms transitions with cubic-bezier `(0.22, 1, 0.36, 1)`. Animate opacity, transform, color, and background. Do not animate layout properties except the existing sidebar grid transition. Respect reduced motion.
