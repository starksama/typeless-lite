# Typeless Lite Agent Guide

This file is the UI/UX source of truth for agents working on Typeless Lite.

If a future task touches layout, styling, interaction design, copy, or information architecture, follow this document before introducing new UI.

## Product Posture

Typeless Lite should feel like a calm desktop app, not a busy SaaS dashboard.

The app exists to support one primary workflow:
1. Start dictation quickly.
2. Process speech into usable text.
3. Return the text to the app the user was already working in.

The UI should therefore feel:
- compact
- quiet
- operational
- polished
- professional

It should not feel:
- promotional
- cute
- oversized
- tutorial-like
- "feature dashboard" heavy

## Core Design Principles

### 1. Remove before adding

When uncertain, remove copy, labels, cards, badges, helper text, or status blocks instead of adding more.

Every visible element should earn its place by doing one of these jobs:
- helps the user act
- shows the current state
- prevents a mistake

If it does none of those, remove it.

### 2. Main workflow stays clean

Home and Dictation should stay focused on the active task.

Do not add:
- promo cards
- marketing-style statements
- self-referential UI copy
- decorative explanation blocks
- duplicate summaries of settings

### 3. Settings are separate and minimal

Settings live on their own page and must not spill into the main workflow.

Settings should be:
- segmented by task
- compact
- label-driven
- low-noise

Settings should not:
- explain obvious things repeatedly
- narrate system internals
- show placeholder statuses like "Not run yet" unless truly necessary
- repeat the same state in multiple places

## Information Architecture

### Top-level navigation

The top-level app structure is:
- Home
- Dictation
- History
- Settings

Do not expand this casually. New top-level sections should be rare.

### Sidebar rules

The sidebar is a compact utility rail.

Requirements:
- left-aligned
- full height on desktop
- narrow by default
- smooth expand/collapse animation
- compact collapsed state
- one-line labels only

Rules:
- no two-line tab descriptions
- active tab must not become materially taller than inactive tabs
- collapse/expand should animate smoothly, not snap
- avoid decorative icons or oversized icon containers
- trim sidebar edge padding aggressively; the rail should feel dense and space-efficient, especially in collapsed mode
- the collapsed state should hide copy without causing obvious layout jitter
- the sidebar bottom controls should stay pinned to the bottom in both expanded and collapsed states
- the sidebar collapse control should be compact and icon-led; avoid extra explanatory text there
- do not duplicate shortcuts, language, or runtime state inside a sidebar setup card; the workspace header is the right place for that information
- keep sidebar tab states flat and 2D; use calm borders and fills, not glass, sheen, or inset highlight effects

### Shell layout

The desktop app should use a framed shell layout:
- a soft outer app frame with a slightly darker neutral tone
- an inner main canvas that is lighter and clearly inset
- the sidebar should live in the outer shell area, not as a separate floating card
- the main canvas should carry generous padding and more whitespace than the shell
- typography inside the canvas should be smaller and calmer than a typical web app
- on macOS, prefer an overlay/embedded titlebar treatment so native window controls feel integrated into the shell instead of sitting above it
- the shell should fill the full native window with no extra inset wrapper around the app itself
- the root document should not scroll; only the intended inner workspace areas may scroll
- if the main workspace scrolls, hide the shell scrollbar chrome; do not leave a visible outer-window scrollbar on the right edge
- the macOS drag region should be generous enough to grab easily, not a thin strip that requires pixel hunting
- runtime status should read like a compact product control with a clear indicator, not a raw log line
- mic/input meters should be useful for speech: favor log-scaled, speech-readable motion over literal linear percentages
- shell branding should come from one shared app-name config, not ad hoc titles like "Voice Workspace" or "Desktop dictation"
- prefer the real app icon in the shell brand mark over placeholder symbols when the icon asset is available
- if the icon feels default, noisy, or low-quality, prefer a text-only shell brand until a deliberate app icon is ready
- the sidebar carries persistent app branding; the main content header should show the active area title instead of repeating the app name
- history should read like a simple transcript timeline, not an analytics/export dashboard
- prefer grouped day sections with time + transcript rows over split panes, export controls, or detail inspectors
- if history search exists, keep it to one plain search field; avoid extra dropdown filters or export tooling
- on Home, prefer a compact stats strip plus a recent transcript list over shortcut summary tiles or a single large "latest transcript" preview card
- home stats should use the standard app radius, not oversized pill shapes
- if transcript rows need actions, keep it to a direct copy action inside the row; avoid separate detail panes just for copy/open behavior
- for History specifically, row click may copy directly; confirm it with a subtle row-level state and a small bottom-right toast instead of adding another banner or modal

### Settings sections

Settings sections should stay short and practical:
- General
- Shortcuts
- AI
- Access

Avoid verbose labels like:
- "General shortcut behavior"
- "Permissions and operational diagnostics"
- "AI & Output configuration"

Prefer short section names and let the fields do the explaining.

## Visual System

### Density

The UI should be smaller and denser than a typical web dashboard.

Default direction:
- tighter spacing
- smaller controls
- smaller cards
- smaller gutters
- less vertical padding

When choosing between roomy and compact, choose compact unless it harms readability.

### Typography

Typography must stay restrained.

Rules:
- do not use bold as the default hierarchy tool
- prefer medium-to-regular weights
- headings should feel controlled, not loud
- labels should be readable but not heavy
- avoid large, dominant page titles unless truly needed

Practical guidance:
- bold should be exceptional, not baseline
- strong emphasis should be rare
- secondary copy should be minimal and often removable

### Shape language

Roundness must stay low.

Rules:
- use low corner radius across cards, buttons, inputs, panels, and modals
- avoid pill-heavy UI except where functionally necessary
- avoid soft, cute, bubbly shapes

The product should feel precise, not playful.

### Color and contrast

The app should stay light, restrained, and low-drama.

Rules:
- neutral surfaces
- subtle accent usage
- no loud gradients as the primary identity
- status colors only where they communicate state
- avoid "primary button from a React tutorial" styling

Accent color should support function, not dominate the screen.

### Shadows and elevation

Use shallow elevation.

Rules:
- subtle shadows only
- avoid deep floating-card aesthetics
- panels should feel settled, not hovering

## Motion and Interaction

Animation should exist, but it should be quiet and useful.

Rules:
- animate structural transitions like sidebar collapse
- use easing that feels smooth and controlled
- avoid abrupt jumps in width, opacity, or position
- avoid unnecessary micro-animations

Motion should communicate:
- state change
- layout transition
- reveal/hide behavior

It should not exist just to make the interface feel "fancy."

## Copy Rules

Copy should be short, direct, and operational.

Prefer:
- "Accessibility"
- "Enabled"
- "Needs access"
- "Test API"
- "Save settings"

Avoid:
- long descriptive subtitles
- explanatory filler under nav items
- generic UX-writing flourishes
- placeholder operational text like "API test not run yet"
- verbose diagnostics summaries in the default UI

### Status copy

Status text should be:
- short
- current
- actionable

Bad examples:
- "API test not run yet."
- "Accessibility permission is granted."
- "Use the button below to verify provider connectivity."

Better examples:
- "Enabled"
- "Needs access"
- "API ok"
- "API failed"
- "Checking..."

## Component Guidance

### Buttons

Buttons should feel modern and restrained.

Rules:
- compact height
- restrained contrast
- low radius
- no oversized padding
- no loud glossy primary treatment

Primary buttons should feel serious, not promotional.

### Inputs

Inputs should be compact and clean.

Rules:
- short height
- low radius
- minimal chrome
- clear labels
- minimal helper text

### Cards and panels

Cards are containers, not decorations.

Rules:
- only use a card when grouping matters
- avoid nested-card overload
- keep padding tight
- remove cards that only hold copy

### Status blocks

Status blocks should only exist when there is live value.

Rules:
- surface only important current state
- do not show "empty" states in permanent chrome unless necessary
- diagnostics should be available, but not loud

## Settings-Specific Rules

Settings must behave like a compact control surface.

Rules:
- titles should be short
- helper text should be rare
- section headers should be minimal
- most controls should be understandable from label + value alone
- diagnostics should be tucked into compact action blocks

Specific requirements:
- settings nav is title-only
- settings header should be minimal
- the runtime strip should stay compact
- accessibility should show just the key state plus actions
- API diagnostics should stay compact and only show result when relevant

## Shortcut System Rules

Shortcuts are part of the primary product interaction, so treat them like a first-class control, not a technical settings form.

Rules:
- show shortcuts as separate keycaps, not raw strings
- the shortcut itself should be the clickable editing surface
- keep the shortcut list to the real actions only:
  hold to speak
  hands-free
- global shortcuts should use two modifiers or a function key
- never allow common editing shortcuts like Cmd+C, Cmd+V, Cmd+X, or similar single-modifier chords
- remove preset rows, suggestion lists, fallback maps, and other "advanced" shortcut UI
- ignore modifier-only presses while capturing
- use physical key capture semantics so shifted punctuation saves as the underlying key combo, not the typed character
- never silently rewrite or replace a user shortcut during save
- if registration fails, keep the previously working shortcuts active and show a short actionable error
- do not persist fallback substitutions over the user's chosen shortcut
- keep shortcut copy minimal; avoid explanatory paragraphs when label + keycaps are enough
- avoid vague status copy like "needs attention"; say what is wrong and where to fix it

## What To Avoid

Never reintroduce these patterns without explicit user approval:
- dashboard-style filler cards
- oversized sidebars
- big rounded "cute" UI
- bold-heavy typography
- multi-line sidebar nav descriptions
- verbose settings headers
- operational text walls
- duplicate status summaries
- noisy diagnostics panels
- decorative copy that explains the obvious

## Decision Rules For Future UI Work

When making a UI decision, use this order:
1. Does this make the core workflow faster or clearer?
2. Can this be removed entirely?
3. Can the same idea be expressed with less copy?
4. Can the same UI be made smaller and calmer?
5. Will this still feel like a compact desktop app instead of a web dashboard?

If the answer to 5 is "no," redesign it.

## Implementation Checklist

Before shipping UI work, verify:
- sidebar remains narrow and smooth
- collapsed sidebar stays compact
- active nav item is not visually oversized
- no unnecessary descriptive text was added
- settings remain segmented and quiet
- typography does not rely on bold
- roundness stayed low
- controls and panels remained compact
- visible status text is short and relevant
- the app still feels like a polished desktop utility
