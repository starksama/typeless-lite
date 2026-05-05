# Design

## Style Summary

Verba uses a logo-led desktop utility system: clean white surfaces in light mode, clean black graphite surfaces in dark mode, and a controlled blue-to-mint accent language taken from the app mark. The product should feel precise and calm, with texture coming from material contrast, fine borders, and state indicators, not decorative backgrounds.

## Color

- Brand blue: `oklch(58% 0.18 255)`
- Brand mint: `oklch(66% 0.145 166)`
- Background: `oklch(96% 0.004 240)`
- Shell: `oklch(92.5% 0.005 240)`
- Canvas: `oklch(98.6% 0.003 240)`
- Panel: `oklch(98% 0.003 240 / 0.96)`
- Panel strong: `oklch(95.5% 0.004 240 / 0.98)`
- Text: `oklch(19% 0.01 240)`
- Muted text: `oklch(51% 0.012 240)`
- Accent: `oklch(54% 0.15 255)`
- Warning: `oklch(70% 0.116 72)`
- Danger: `oklch(65% 0.13 35)`
- Success: `oklch(60% 0.12 166)`

Use blue for primary actions, selected settings, focus, and processing. Use mint for recording, microphone-ready states, copied confirmations, and successful setup. Do not use dark green as the brand color, purple gradients, glass cards, decorative texture, or 3D button treatments.

Dark mode keeps the same logo palette on near-black graphite surfaces. The appearance control supports System, Light, and Dark; System follows macOS.

## Typography

Use the native system stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`. Keep headings small and medium weight. Do not use monospace for displayed shortcuts; shortcut tokens should feel like compact controls, not code.

## Layout

The app shell fills the native window. Sidebar stays narrow and calm. Main canvas is inset, scrolls internally, and uses full-width page bands rather than nested cards. Settings keep a left section rail and a single active panel. On smaller widths, navigation collapses structurally, not through fluid type.

## Components

- Buttons: compact height, 8px radius, clear disabled and focus states.
- Inputs: dense, dark, bordered, with direct labels.
- Shortcuts: separate sans-serif tokens inside clickable shortcut controls.
- Status: short labels plus exact next action when action is needed. Runtime indicators should be steady, not blinking, and mic-level updates must not re-render the full state surface.
- Desktop overlay: compact, non-activating, click-through, and small enough that a transparency failure cannot block the screen. It must use the logo's blue/mint meter language and must never focus Verba while the user is dictating into another app.
- Permission rows: show current state, OS action, and check again path.
- Meter: refined segmented bar with live sheen only while recording.
- Transcript rows: timeline style, click row to copy, subtle copied state.

## Motion

Use 150-240ms transitions with cubic-bezier `(0.22, 1, 0.36, 1)`. Animate opacity, transform, color, and background. Do not animate layout properties except the existing sidebar grid transition. Respect reduced motion.
