# Design

## Style Summary

Verba uses a light-first desktop shell with paired light and dark appearances, compact controls, low-radius panels, and a restrained ink-blue accent for action and focus. Texture should feel like a native utility surface: disciplined material contrast, fine borders, quiet state indicators, and no decorative background patterns.

## Color

- Background: `oklch(95% 0.006 262)`
- Shell: `oklch(91.5% 0.008 262)`
- Canvas: `oklch(98.5% 0.004 262)`
- Panel: `oklch(98% 0.004 262 / 0.96)`
- Panel strong: `oklch(95.5% 0.006 262 / 0.98)`
- Text: `oklch(22% 0.014 262)`
- Muted text: `oklch(52% 0.016 262)`
- Accent: `oklch(47% 0.072 262)`
- Warning: `oklch(70% 0.116 72)`
- Danger: `oklch(65% 0.13 35)`
- Success: `oklch(50% 0.06 190)`

Use accent color for current navigation, primary actions, live recording state, and focused setup only. Do not use dark green as the brand color, purple gradients, glass cards, decorative texture, or 3D button treatments.

Dark mode keeps the same graphite-blue material system at lower lightness. The appearance control supports System, Light, and Dark; System follows macOS.

## Typography

Use the native system stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`. Keep headings small and medium weight. Do not use monospace for displayed shortcuts; shortcut tokens should feel like compact controls, not code.

## Layout

The app shell fills the native window. Sidebar stays narrow and calm. Main canvas is inset, scrolls internally, and uses full-width page bands rather than nested cards. Settings keep a left section rail and a single active panel. On smaller widths, navigation collapses structurally, not through fluid type.

## Components

- Buttons: compact height, 8px radius, clear disabled and focus states.
- Inputs: dense, dark, bordered, with direct labels.
- Shortcuts: separate sans-serif tokens inside clickable shortcut controls.
- Status: short labels plus exact next action when action is needed. Runtime indicators should be steady, not blinking, and mic-level updates must not re-render the full state surface.
- Permission rows: show current state, OS action, and check again path.
- Meter: refined segmented bar with live sheen only while recording.
- Transcript rows: timeline style, click row to copy, subtle copied state.

## Motion

Use 150-240ms transitions with cubic-bezier `(0.22, 1, 0.36, 1)`. Animate opacity, transform, color, and background. Do not animate layout properties except the existing sidebar grid transition. Respect reduced motion.
