# LiquiTask Design System — "Liquid Glass"

The single source of truth for how LiquiTask looks, moves, and speaks. Distilled from the
design-system handoff (`LiquiTask Design System-handoff.zip`) and the app's own CSS layer.
**Any new or changed UI must follow this document.** The tokens live in `index.css`
(`--lt-*` custom properties) alongside the `.liquid-*` surface classes.

The aesthetic in one sentence: heavily-blurred translucent panels on a warm near-black
canvas, cool slate text, and a single crimson-red accent — premium tooling, fast, glassy,
a little cinematic.

## Palette

The canvas is warm near-black (`--lt-bg-primary: #030000` → `--lt-bg-secondary: #0a0505`)
while text is a cool slate ramp (`--lt-text-primary: #e2e8f0` → `--lt-text-muted: #64748b`).
That warm/cool contrast is core to the look — don't substitute neutral grays for either side.

There is exactly one accent: crimson red (`--lt-accent: #ff1f1f` for brand and glows,
`--lt-red-400: #ef4444` for interactive/focus, `#b91c1c → #7f1d1d` for gradients). Red means
**active, primary, or AI** — never decoration. Everything else uses the semantic status hues:
blue `#3b82f6` In Progress, amber `#f59e0b` Review, emerald `#10b981` Completed, violet
`#a855f7` Delivered, cyan `#22d3ee` multi-select; priority is red/yellow/emerald.

Never use Tailwind `slate-800`/`slate-900` fills for surfaces — they read blue-gray and break
the warm canvas. Raised fills are white-alpha (`bg-white/5`, hover `bg-white/10`) or the glass
classes below.

## Surfaces — the glass tiers

All chrome is translucent glass: an rgba fill over `backdrop-filter: blur(20–40px)`, a 1px
white-alpha hairline, a soft inner top highlight, and deep outer shadows. Three tiers, all
defined in `index.css`:

| Class             | Use                                        | Radius                          | Blur              |
| ----------------- | ------------------------------------------ | ------------------------------- | ----------------- |
| `.liquid-glass`   | Primary chrome: header, sidebar, wells     | 24px                            | 40 + saturate 1.1 |
| `.liquid-card`    | Interactive list items, task cards         | (set by component, target 32px) | 20                |
| `.liquid-surface` | Floating layers: popovers, docks, tooltips | 16px                            | 40 + saturate 1.2 |

Supporting classes: `.liquid-input` (recessed inset shadow, red focus ring), `.liquid-button`
(the red primary — gradient tint, hover lift, ripple sheen), `.liquid-badge` (frosted pill),
`.liquid-glow-red` / `.liquid-glow-cyan` (ambient emphasis). No flat or solid cards, ever.

Cards lift on hover (`translateY(-4px) scale(1.01)`) and gain a red edge glow
(`--lt-border-active` border + `0 0 30px rgba(220,30,30,0.15)` halo). Blocked cards get a 2px
red left edge; multi-selected cards get a cyan ring.

## Radii and spacing

Generous corners: 12px inputs and menu items, 16px buttons and popovers, 24px panels, 32px
modals and task cards, full pill for badges (`--lt-radius-*`). Spacing is a 4px base scale
(`--lt-space-*` in the handoff; Tailwind's default scale matches).

## Typography

Inter for all UI and body text; Outfit only for big display numerals (dashboard stats, with a
white→transparent gradient fill and `-0.03em` tracking); monospace for `kbd` chips, logs, and
quick-add tokens.

Casing rules carry the voice: **Title Case** for headings, buttons, and view names ("New Task",
"Quick Add"); **UPPERCASE with wide tracking** (`text-[10px] uppercase tracking-widest
text-slate-500`) for eyebrows and section/field labels ("ACTIVE TASKS", "TEAM ROLES");
sentence case for helper text and toasts.

## Buttons and interaction states

Primary = `.liquid-button` (red gradient + glow). Secondary = `bg-white/5 border-white/10`,
hover `bg-white/10`. Ghost = transparent. Danger = red tint. Hover lightens fills and lifts
(`translateY(-2px)`); press dips (`translateY(1px)`); icon buttons scale 1.12 on hover, 0.93
on press. Inputs feel recessed (inset shadow) and focus with a subtle red ring.

## Motion

Spring easing (`--lt-ease-spring`) for cards, glass easing (`--lt-ease-glass`) for chrome,
smooth (`--lt-ease-smooth`) for everything else. Modals spring in (scale 0.95→1.02→1); toasts
slide from the right; status dots ping. Glows and shimmer are for emphasis only, used
sparingly. All motion must respect `prefers-reduced-motion`.

## Iconography

One system: Lucide (`lucide-react`), 18–20px at 2px stroke with rounded caps. Neutral slate by
default; red tint marks active, AI, or important actions. Status is a small colored dot plus a
Lucide glyph. **No emoji, ever** — meaning is carried by icons and color.

## Voice and microcopy

Confident, technical, product-precise. The UI speaks in imperative to the user ("Add task or
paste an image…", "Requires attention"), rarely first-person. Copy is dense and
keyboard-forward: surface shortcuts inline ("Command Palette (Cmd+K)"), and treat the quick-add
syntax (`!high #project +tag ~2h @today >agent`) as its own little language.

## Floating layers (docks, popovers, palettes)

Floating UI (the agents dock, command palette, popovers) uses `.liquid-surface`, sits at
`z-40`–`z-[60]`, and should be quiet when idle: collapse to a compact frosted pill
(`.liquid-badge`) rather than parking a full-width panel over the board. Escalate attention
with a red glow (`.liquid-glow-red`) only when the user must act (e.g. a pending permission).

## Checklist for new UI

Before shipping a component, check: surfaces use a `.liquid-*` tier or white-alpha fills (no
slate/solid backgrounds); the only saturated accent is red, applied to at most the primary
action; labels follow the eyebrow/Title Case rules; inputs use `.liquid-input`; icons are
Lucide with no emoji; hover states lighten and lift; and anything floating collapses politely.
