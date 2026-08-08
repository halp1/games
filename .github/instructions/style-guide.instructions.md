# App Style Guide

A complete reference for replicating the design language of this application. Implementing every rule in this document should be sufficient to build a visually identical app from scratch.

---

## Part 1 — Design System

### 1.1 Fonts

Self-hosted from `static/fonts` so the app renders identically offline. The `@font-face`
blocks live at the top of `layout.css` and carry the same `unicode-range` splits Google
Fonts serves, so the `latin-ext` subsets are only fetched when a page needs them:

```css
@font-face {
	font-family: 'Anta';
	font-style: normal;
	font-weight: 400;
	font-display: swap;
	src: url('/fonts/anta-400-latin.woff2') format('woff2');
	unicode-range: /* latin */;
}
```

The two faces used on first paint are preloaded in `app.html`.

| Role              | Font                 | When to use                                              |
| ----------------- | -------------------- | -------------------------------------------------------- |
| Display / Heading | `Anta`, sans-serif   | App logo/name, page `<h1>` titles                        |
| Body / UI         | `DM Mono`, monospace | Everything else: labels, inputs, buttons, body copy, nav |

Apply heading font with `font-family: var(--font-heading)` or the `font-heading` Tailwind utility.  
The monospace body font is the **default** — `font-family: "DM Mono", monospace` is set on `body`.

---

### 1.2 Color Palette

```css
:root {
	--bg: #0e0e0e;
	--surface: #161616;
	--border: #2a2a2a;
	--accent: #c8f56a;
	--text: #f0ede6;
	--muted: #666666;
	--input-bg: #111111;
}
```

| Variable     | Hex       | Role                                                              |
| ------------ | --------- | ----------------------------------------------------------------- |
| `--bg`       | `#0e0e0e` | Page background                                                   |
| `--surface`  | `#161616` | Cards, panels, sidebars, any elevated surface                     |
| `--border`   | `#2a2a2a` | All borders and dividers                                          |
| `--accent`   | `#c8f56a` | Lime green — primary CTAs, active states, focus rings, highlights |
| `--text`     | `#f0ede6` | Primary text (warm off-white)                                     |
| `--muted`    | `#666666` | Secondary text, placeholders, inactive icons                      |
| `--input-bg` | `#111111` | Form input backgrounds                                            |

**Game tokens** — also in the `@theme` block, so they carry Tailwind utilities
(`text-suit-red`, `border-rival`, `hover:text-danger`) and never need a literal:

| Token              | Value     | Role                                                  |
| ------------------ | --------- | ----------------------------------------------------- |
| `--color-suit-red` | `#ff6b6b` | Hearts, diamonds, the red joker                       |
| `--color-rival`    | `#6ab4f5` | The opposing team                                     |
| `--color-danger`   | `#ff6b6b` | Destructive actions — remove, disconnect, a lost card |

`--suit-red` and `--danger` share a value but are separate ideas, so one can move without
dragging the other along.

**Team colour is relative, never absolute.** Your side is always `accent`, the opposition
always `rival`. A fixed A/B mapping makes every player stop and work out which one they are.

**Semantic one-off colors used in the codebase:**

| Purpose          | Value     |
| ---------------- | --------- |
| Error text/alert | `#ff8080` |
| Deploy / warning | `#f0a830` |

---

### 1.2b Safe Areas

`app.html` sets `viewport-fit=cover`. Anything docked to the bottom edge of the screen — a
game's action bar, a sheet's footer — must add the inset itself, or it sits under the iPhone
home indicator:

```html
<div style="padding-bottom: calc(0.75rem + env(safe-area-inset-bottom))"></div>
```

Ordinary pages that never read the inset are unaffected.

---

### 1.3 Global Background (`layout.css` baseline)

The baseline of `src/routes/layout.css`, imported once at the root layout. Illustrative rather
than literal — the live file is the source of truth and additionally carries the self-hosted
`@font-face` blocks, the game tokens above, `--color-text-inverted`, `dvh` heights, the
`.card` / `.divider` helpers and the mobile tap rules:

```css
@import 'tailwindcss';
@plugin '@tailwindcss/forms';
@plugin '@tailwindcss/typography';

@theme {
	--color-accent: #c8f56a;
	--color-bg: #0e0e0e;
	--color-surface: #161616;
	--color-border: #2a2a2a;
	--color-text: #f0ede6;
	--color-muted: #666666;
	--color-input-bg: #111111;
	/* Tailwind's namespace is --font-*: named --font-family-* these generate no
	   font-heading/font-mono utilities at all. */
	--font-heading: 'Anta', sans-serif;
	--font-mono: 'DM Mono', monospace;
}

:root {
	--bg: #0e0e0e;
	--surface: #161616;
	--border: #2a2a2a;
	--accent: #c8f56a;
	--text: #f0ede6;
	--muted: #666666;
	--input-bg: #111111;
}

.spin {
	animation: spin 1s linear infinite;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}

*,
*::before,
*::after {
	box-sizing: border-box;
}

body {
	background: var(--bg);
	color: var(--text);
	font-family: 'DM Mono', monospace;
	min-height: 100vh;
}

body::before {
	content: '';
	position: fixed;
	inset: 0;
	background-image:
		linear-gradient(rgba(200, 245, 106, 0.03) 1px, transparent 1px),
		linear-gradient(90deg, rgba(200, 245, 106, 0.03) 1px, transparent 1px);
	background-size: 40px 40px;
	pointer-events: none;
	z-index: 0;
}

@keyframes fadeUp {
	from {
		opacity: 0;
		transform: translateY(16px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}
```

All page content must have `position: relative; z-index: 1` (or Tailwind `relative z-1`) to sit above the grid overlay.

---

### 1.4 Shape Language

**No border-radius anywhere.** Every corner is sharp: `border-radius: 0`.  
Never use `rounded-*` Tailwind utilities except `rounded-none`.

Borders are always `1px solid var(--border)`.

---

### 1.5 Accent Corner

Cards and key panels get a top-right accent bracket using a `::before` pseudo-element:

```css
.card::before {
	content: '';
	position: absolute;
	top: -1px;
	right: -1px;
	width: 32px;
	height: 32px;
	border-top: 2px solid var(--accent);
	border-right: 2px solid var(--accent);
}
```

The corner color changes contextually:

- Default / confirmation panels: `var(--accent)` (`#c8f56a`)
- Danger / delete modals: `#ff6b6b`

---

### 1.6 Typography Scale

| Use                         | Size                   | Weight                         | Tracking          | Color                           |
| --------------------------- | ---------------------- | ------------------------------ | ----------------- | ------------------------------- |
| Page hero `<h1>`            | `text-5xl` (3rem)      | normal                         | default           | `--text`                        |
| App logo/name               | `text-lg`              | normal                         | `0.08em`          | `--accent`                      |
| Section label / panel title | `text-xs`              | normal                         | `0.16em`–`0.18em` | `--muted` or `--accent`         |
| Form label                  | `text-xs`              | normal                         | `0.14em`–`0.16em` | `--muted`                       |
| Body / list items           | `text-sm`              | normal                         | default           | `--text`                        |
| Secondary/metadata          | `text-xs`              | normal                         | default           | `--muted`                       |
| Button text                 | `text-sm` or `text-xs` | `font-medium` or `font-normal` | `0.12em`          | `--bg` (on accent) or `--muted` |

**Labels and panel headers are always uppercase** (`uppercase` + high letter-spacing).

---

### 1.7 Spacing Principles

- Header bar height: `h-10` (2.5rem / 40px)
- Panel sub-headers: `h-9` (2.25rem)
- File list row height: `h-7.5` (1.875rem)
- File list header row: `h-7` (1.75rem)
- Standard horizontal padding for panels/headers: `px-3`
- Standard card internal padding: `px-10 py-12` (large) or `p-6` (modal)
- Gap between form fields: `mb-5`
- Gap between label and input: `mb-1` to `mb-2`
- Gap between inline icon-button clusters: `gap-0.5`
- Dividers between button clusters: `mx-1 h-5 w-px bg-border`

---

### 1.8 Animations

Two named keyframes used throughout:

**`fadeUp`** — entrance animation for cards, rows, panels:

```css
@keyframes fadeUp {
	from {
		opacity: 0;
		transform: translateY(16px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}
```

Usage pattern: `animate-[fadeUp_0.5s_ease_both]` (page cards), `animate-[fadeUp_0.2s_ease_both]` (list rows), `animate-[fadeUp_0.15s_ease_both]` (inline form reveals), `animate-[fadeUp_0.12s_ease_both]` (context menus).

Rows have staggered delays: `animation-delay: ${Math.min(i, 30) * 15}ms`.

**`spin`** — loading spinner via `.spin` class:

```css
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
.spin {
	animation: spin 1s linear infinite;
}
```

**`slide-in`** — toast slide-in (defined locally in Toast component):

```css
@keyframes slide-in {
	from {
		opacity: 0;
		transform: translateX(1rem);
	}
	to {
		opacity: 1;
		transform: translateX(0);
	}
}
```

---

### 1.9 Scrollbars

Thin custom scrollbars wherever overflow-y is used:

```css
/* CSS */
scrollbar-width: thin;
scrollbar-color: var(--border) transparent;

/* Webkit */
::-webkit-scrollbar {
	width: 4px;
}
::-webkit-scrollbar-thumb {
	background: var(--border);
}
::-webkit-scrollbar-track {
	background: transparent;
}
```

---

## Part 2 — Component Patterns

### 2.1 Header Bar

The topmost bar spanning the full width. Height: `h-10`. Background: `bg-surface`. Bottom border: `border-b border-border`. `z-index: 10`, `position: relative`.

Layout: flex row, `items-center`, `gap-0`, `px-3`.

**Left section** (`flex-1`, `min-w-0`, `gap-3`):

- App name: `[font-family:var(--font-heading)]` `text-lg` `tracking-[0.08em]` `text-accent` (uppercase)
- Metadata (e.g., storage stats): `font-mono text-xs text-muted`
- Separator between stats: `font-mono text-xs text-muted` (`/` character, `-mx-1`)

**Center section** — search bar:

- Wrapping div: `relative shrink-0`
- Icon: `absolute top-1/2 left-2.5 -translate-y-1/2 text-muted pointer-events-none` at size 13
- Input: `w-70 cursor-pointer rounded-none border border-border bg-bg py-1.25 pr-2.5 pl-7.5 font-mono text-sm text-text ring-0 transition-[border-color,width] duration-200 outline-none placeholder:text-[#333] focus:border-accent`

**Right section** — icon button cluster (`ml-3 flex shrink-0 items-center gap-0.5`):

- Icon button: `flex cursor-pointer items-center justify-center border-none bg-transparent p-1.5 text-muted transition-colors hover:bg-white/4 hover:text-text`
- Active icon button: replace `text-muted` with `text-accent`
- Dividers between clusters: `mx-1 h-5 w-px bg-border`
- Icon size: 14px

---

### 2.2 Sidebar / Panel

Left sidebar and right panels share this structure.

Outer: `relative flex shrink-0 flex-col overflow-hidden border-l border-border bg-surface` (right panels get `border-l`, left sidebar gets `border-r`). Width is controlled by inline style (`width: {width}px`).

**Resize handle** (a full-height invisible strip on the inner edge):

```
absolute top-0 left-0 z-2 h-full w-1 cursor-col-resize border-none bg-transparent transition-colors hover:bg-accent/50
```

**Panel sub-header**:

```
flex h-9 shrink-0 items-center gap-2 border-b border-border px-3
```

- Title: `flex-1 text-xs tracking-[0.16em] text-muted uppercase`
- Close button: `flex cursor-pointer items-center border-0 bg-transparent p-1.25 text-muted transition-colors hover:text-text`

**Panel body** (scrollable):

```
flex-1 overflow-y-auto p-3
[&::-webkit-scrollbar]:w-1
[&::-webkit-scrollbar-thumb]:bg-border
[&::-webkit-scrollbar-track]:bg-transparent
```

---

### 2.3 File List

**Column header row** (`h-7 shrink-0 border-b border-border bg-surface`, CSS grid):

- Column header buttons: `flex cursor-pointer items-center border-0 bg-transparent px-1.5 font-mono text-xs tracking-[0.14em] text-muted uppercase transition-colors hover:text-text`

**Data rows** (`h-7.5`, CSS grid, `border-b border-border/50`):

- Default: `hover:bg-white/3`
- Selected: `bg-accent/[0.07]`
- Preview open: `bg-[#6ab4f5]/6`
- New rows animate in with `fadeUp` + staggered delay

**Empty state** (centered, uppercase, spaced):

```
flex h-50 flex-col items-center justify-center gap-3 text-sm tracking-widest text-border uppercase
```

---

### 2.4 Modals / Dialogs

**Backdrop**: `fixed inset-0 z-50 flex items-center justify-center bg-black/60`  
Click outside the panel to dismiss.

**Panel**:

```
relative w-80 border border-border bg-surface p-6
before:absolute before:-top-px before:-right-px before:h-8 before:w-8
before:border-t-2 before:border-r-2 before:border-accent
```

(Replace `before:border-accent` with `before:border-[#ff6b6b]` for danger modals.)

**Modal header** (icon + label row):

```
mb-3 flex items-center gap-2
```

- Icon: 14px, colored (`text-accent` or `text-[#ff6b6b]`)
- Label: `font-mono text-xs tracking-[0.16em] text-text uppercase`

**Modal body text**: `font-mono text-base text-muted` with `<span class="text-text">` for emphasis

**Footer button row**: `flex justify-end gap-2` with:

- Cancel button (ghost): `cursor-pointer border border-border bg-transparent px-4 py-1.5 font-mono text-sm tracking-[0.12em] text-muted uppercase transition-[color,border-color] hover:border-muted hover:text-text`
- Confirm button (filled accent): `cursor-pointer border border-accent bg-accent px-4 py-1.5 font-mono text-sm font-medium tracking-[0.12em] text-bg uppercase transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40`
- Danger confirm (filled red): same but `border-[#ff6b6b] bg-[#ff6b6b]` instead

**Search Modal** uses a wider panel (`max-w-2xl w-full`):

- Search input row: `flex items-center gap-3 border-b border-border px-5 py-4`
- Results list: `max-h-96 overflow-y-auto`
- Result row: `w-full border-b border-border px-5 py-3 text-left transition-colors hover:bg-[rgba(200,245,106,0.05)]`
- Active/highlighted result: `border-l-2 border-l-accent bg-[rgba(200,245,106,0.1)]`
- Empty state: `px-5 py-8 text-center text-sm text-muted`

---

### 2.5 Context Menu

```
fixed z-100 min-w-40 animate-[fadeUp_0.12s_ease_both]
border border-(--border) bg-(--surface) py-1
transition-opacity duration-75
```

Starts `opacity-0` until position is computed, then `opacity-100`.

**Menu item**:

```
flex w-full cursor-pointer items-center gap-2
border-0 bg-transparent px-3.5 py-1.75
text-left font-mono text-sm text-(--muted) transition-[color,background]
hover:bg-white/4
```

On hover, color transitions to the item's own `--hover-color` (default `var(--text)`, or a danger color like `#ff6b6b`).

**Separator**: `mx-0 my-1 h-px bg-(--border)`

---

### 2.6 Toast Notifications

Fixed position, bottom-right: `fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2`

**Toast item**:

```
flex max-w-sm min-w-72 items-start gap-3
border border-border bg-surface px-3.5 py-3 shadow-lg
```

Always has a left accent border (`border-left: 3px solid`):

- Default: `var(--border)` (`#2a2a2a`)
- Success: `var(--accent)` (`#c8f56a`)
- Error: `#ff8080`

Toast text: `font-mono text-xs leading-relaxed break-words text-text`  
Dismiss button: `mt-0.5 shrink-0 cursor-pointer border-none bg-transparent p-0 text-muted transition-colors hover:text-text` with a 13px X icon.

Entrance animation: `slide-in 0.15s ease-out` (slides in from the right).

---

### 2.7 Cards (Centered Page Layout)

Used on login/auth and public upload pages.

Outer wrapper: `relative z-1 flex min-h-screen items-center justify-center p-6`

Card: `card relative w-full max-w-95 animate-[fadeUp_0.5s_ease_both] border border-border bg-surface px-10 py-12`

Card gets the accent corner via the `.card::before` pseudo-element.

**Inside a card:**

- Eyebrow label: `mb-5 text-xs tracking-[0.18em] text-accent uppercase`
- Hero title: `font-heading mb-9 text-5xl leading-[1.1] text-text` (use `mb-6` if there are metadata fields below)
- Error banner: `mb-5 border border-[rgba(255,80,80,0.3)] bg-[rgba(255,80,80,0.1)] px-3 py-2.5 text-sm text-[#ff8080]`

---

### 2.8 Forms

**Label**: `mb-1 block font-mono text-xs tracking-[0.14em] text-muted uppercase` (or `mb-2` for large inputs)

**Text input** (standard size):

```
w-full rounded-none border border-border bg-input-bg
px-3 py-2 font-mono text-sm text-text
transition-[border-color] outline-none
placeholder:text-[#333]
focus:border-accent
```

**Text input** (large / auth page variant):

```
w-full appearance-none rounded-none border border-border bg-input-bg
px-3.5 py-3 font-mono text-lg text-text
transition-[border-color] outline-none
placeholder:text-[#333]
focus:border-accent
```

**Compact input** (used in panel forms):

```
w-full rounded-none border border-border bg-input-bg
px-2.25 py-1.75 font-mono text-sm text-text
transition-[border-color] outline-none
placeholder:text-[#333]
focus:border-accent
```

All inputs share: no border-radius, `bg-input-bg`, accent border on focus, muted placeholder (`#333`).

**Primary button** (filled accent, full-width):

```
w-full cursor-pointer border-none bg-accent
py-3.5 font-mono text-sm font-medium tracking-[0.12em] text-bg uppercase
transition-[opacity,transform] hover:opacity-[0.88] active:scale-[0.99]
```

**Primary button** (compact, panel):

```
cursor-pointer border-0 bg-accent
px-3 py-1.5 font-mono text-xs font-medium tracking-widest text-bg uppercase
transition-opacity hover:opacity-[0.88]
disabled:cursor-not-allowed disabled:opacity-40
```

**Ghost/outline button**:

```
cursor-pointer border border-border bg-transparent
px-4 py-1.5 font-mono text-sm tracking-[0.12em] text-muted uppercase
transition-[color,border-color] hover:border-muted hover:text-text
```

**Compact ghost button** (panel):

```
cursor-pointer border border-border bg-transparent
px-3 py-1.5 font-mono text-xs tracking-widest text-muted uppercase
transition-all hover:border-muted hover:text-text
```

**Outline hover-to-accent button** (e.g. "New link"):

```
flex w-full cursor-pointer items-center justify-center gap-1.5
border border-border bg-transparent
px-2.5 py-1.5 font-mono text-xs tracking-[0.08em] text-muted uppercase
transition-all hover:border-accent hover:text-accent
```

**Text link button** (inline):

```
cursor-pointer border-0 border-b border-border bg-transparent p-0
font-mono text-sm text-text transition-[color,border-color]
hover:border-accent hover:text-accent
```

**Checkbox**: appears with `input[type="checkbox"]` styled minimally (`w-auto p-0`) inside a label with `flex cursor-pointer items-center gap-1.5 font-mono text-sm text-muted`.

---

### 2.9 Badges / Tags / Pills

All tags are sharp-cornered (`border-radius: 0`).

**Neutral tag**:

```
border border-border px-1.25 py-px text-xs tracking-widest text-muted uppercase
```

**Accent tag** (e.g., expiry timer):

```
border border-accent/30 px-1.25 py-px text-xs tracking-widest text-accent uppercase
```

---

### 2.10 Drop Zone (File Upload Area)

```
flex cursor-pointer flex-col items-center justify-center gap-2.5
border border-dashed px-5 py-9 text-sm text-muted
transition-[border-color,background]
hover:border-accent hover:bg-accent/4
```

Active drag state: `border-accent bg-accent/4`  
File selected state: `border-solid border-accent`

---

### 2.11 Progress Bar

A 2px track with an accent fill:

```html
<div class="h-0.5 bg-border">
	<div class="h-full bg-accent transition-[width_0.1s_ease]" style="width: {progress}%"></div>
</div>
```

---

### 2.12 Icon Buttons (Toolbar / Panel Actions)

Bare icon buttons with no background, transitions on color only:

```
flex cursor-pointer items-center border-0 bg-transparent p-1.25 text-muted
transition-colors hover:text-text
```

Danger hover variant: `hover:text-[#ff6b6b]`  
Checked/copy feedback: swap icon to a `Check` icon momentarily.

---

### 2.13 Inline Form Reveal (Expand Section)

When a "New X" button is clicked, a form slides in below it using:

```
flex animate-[fadeUp_0.15s_ease_both] flex-col gap-2.5 border border-border bg-bg p-3
```

Note the background is `bg-bg` (darkest), sitting inside a `bg-surface` panel — this creates a subtle depth inset.

---

### 2.14 Metadata / Info Block

Used in cards to display key-value metadata in a horizontal strip:

```html
<div class="flex flex-wrap gap-3 border-b border-border pb-5">
	<span class="flex flex-col gap-0.75">
		<span class="text-xs tracking-[0.16em] text-muted uppercase">Label</span>
		<code class="font-mono text-sm text-text">value</code>
	</span>
</div>
```

Accented values use `text-accent` instead of `text-text`.

---

### 2.15 Divider with Text

Used between auth form sections:

```html
<div class="divider my-7 flex items-center gap-3 text-sm text-border">or</div>
```

```css
.divider::before,
.divider::after {
	content: '';
	flex: 1;
	height: 1px;
	background: var(--color-border);
}
```

---

### 2.16 New Key / Secret Reveal Banner

When a newly created secret (API key, token) is revealed once and must be copied:

```
animate-[fadeUp_0.15s_ease_both] border border-accent/20 bg-accent/6 px-3 py-2.5
```

- Notice text: `mb-2 text-xs tracking-[0.06em] text-accent`
- Secret value: `flex-1 overflow-hidden font-mono text-xs text-ellipsis whitespace-nowrap text-accent`

---

## Part 3 — Tailwind v4 Reference

### 3.1 Theme Setup

Use Tailwind v4's `@theme` block in the root CSS to register the color tokens and font families as Tailwind utilities:

```css
@theme {
	--color-accent: #c8f56a;
	--color-bg: #0e0e0e;
	--color-surface: #161616;
	--color-border: #2a2a2a;
	--color-text: #f0ede6;
	--color-muted: #666666;
	--color-input-bg: #111111;
	/* Tailwind's namespace is --font-*: named --font-family-* these generate no
	   font-heading/font-mono utilities at all. */
	--font-heading: 'Anta', sans-serif;
	--font-mono: 'DM Mono', monospace;
}
```

This makes the following utilities available:

- `bg-accent`, `bg-bg`, `bg-surface`, `bg-border`, `bg-text`, `bg-muted`, `bg-input-bg`
- `text-accent`, `text-bg`, `text-surface`, `text-border`, `text-text`, `text-muted`
- `border-accent`, `border-border`, `border-text`, `border-muted`
- `font-heading`, `font-mono`

---

### 3.2 Color Utility Examples

```html
<!-- Dark page background -->
<body class="bg-bg text-text">
	<!-- Card / panel -->
	<div class="border border-border bg-surface">
		<!-- Accent CTA button -->
		<button class="bg-accent font-mono font-medium text-bg">Submit</button>

		<!-- Muted secondary label -->
		<span class="text-xs tracking-widest text-muted uppercase">Modified</span>

		<!-- Accent text -->
		<span class="text-accent">Active</span>

		<!-- Input field -->
		<input class="border border-border bg-input-bg text-text focus:border-accent" />
	</div>
</body>
```

---

### 3.3 Header Bar Example

```html
<header
	class="relative z-10 flex h-10 shrink-0 items-center border-b border-border bg-surface px-3"
>
	<!-- Logo -->
	<span class="shrink-0 font-heading text-lg tracking-[0.08em] text-accent">APPNAME</span>

	<!-- Center search -->
	<div class="relative mx-auto">
		<SearchIcon
			class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
			size="{13}"
		/>
		<input
			class="w-70 cursor-pointer rounded-none border border-border bg-bg py-1.25 pr-2.5 pl-7.5 font-mono text-sm text-text outline-none placeholder:text-[#333] focus:border-accent"
			placeholder="Search... (Ctrl+K)"
			readonly
		/>
	</div>

	<!-- Right icon cluster -->
	<div class="ml-3 flex shrink-0 items-center gap-0.5">
		<button
			class="flex cursor-pointer items-center justify-center border-none bg-transparent p-1.5 text-muted transition-colors hover:bg-white/4 hover:text-text"
		>
			<UploadIcon size="{14}" />
		</button>
		<!-- Divider -->
		<div class="mx-1 h-5 w-px bg-border"></div>
		<!-- Active icon (accent color) -->
		<button
			class="flex cursor-pointer items-center justify-center border-none bg-transparent p-1.5 text-accent transition-colors hover:bg-white/4"
		>
			<KeyIcon size="{14}" />
		</button>
	</div>
</header>
```

---

### 3.4 Card (Centered Full-Page) Example

```html
<div class="relative z-1 flex min-h-screen items-center justify-center p-6">
	<div
		class="card relative w-full max-w-95 animate-[fadeUp_0.5s_ease_both] border border-border bg-surface px-10 py-12"
	>
		<p class="mb-5 text-xs tracking-[0.18em] text-accent uppercase">Welcome back</p>
		<h1 class="mb-9 font-heading text-5xl leading-[1.1] text-text">Sign in.</h1>

		<!-- Form content -->
		<label class="mb-2 block text-xs tracking-[0.14em] text-muted uppercase">Username</label>
		<input
			class="mb-5 w-full appearance-none rounded-none border border-border bg-input-bg px-3.5 py-3 font-mono text-lg text-text outline-none placeholder:text-[#333] focus:border-accent"
		/>

		<button
			class="mt-2 w-full cursor-pointer border-none bg-accent py-3.5 font-mono text-sm font-medium tracking-[0.12em] text-bg uppercase transition-[opacity,transform] hover:opacity-[0.88] active:scale-[0.99]"
		>
			Log in
		</button>
	</div>
</div>

<style>
	.card::before {
		content: '';
		position: absolute;
		top: -1px;
		right: -1px;
		width: 32px;
		height: 32px;
		border-top: 2px solid var(--color-accent);
		border-right: 2px solid var(--color-accent);
	}
</style>
```

---

### 3.5 Modal Dialog Example

```html
<!-- Backdrop -->
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
	<!-- Panel -->
	<div
		class="relative w-80 border border-border bg-surface p-6 before:absolute before:-top-px before:-right-px before:h-8 before:w-8 before:border-t-2 before:border-r-2 before:border-accent"
	>
		<!-- Header -->
		<div class="mb-4 flex items-center gap-2">
			<FolderIcon size="{14}" class="text-accent" />
			<span class="font-mono text-xs tracking-[0.16em] text-text uppercase">New Folder</span>
		</div>

		<!-- Input -->
		<label class="mb-1 block font-mono text-xs tracking-[0.16em] text-muted uppercase"
			>Folder name</label
		>
		<input
			class="mb-5 w-full border border-border bg-input-bg px-3 py-2 font-mono text-base text-text outline-none placeholder:text-muted focus:border-accent"
		/>

		<!-- Buttons -->
		<div class="flex justify-end gap-2">
			<button
				class="cursor-pointer border border-border bg-transparent px-4 py-1.5 font-mono text-sm tracking-[0.12em] text-muted uppercase transition-[color,border-color] hover:border-muted hover:text-text"
			>
				Cancel
			</button>
			<button
				class="cursor-pointer border border-accent bg-accent px-4 py-1.5 font-mono text-sm font-medium tracking-[0.12em] text-bg uppercase transition-opacity hover:opacity-80"
			>
				Create
			</button>
		</div>
	</div>
</div>
```

For a danger modal, replace `before:border-accent` and `border border-accent bg-accent` with `before:border-[#ff6b6b]` and `border border-[#ff6b6b] bg-[#ff6b6b]`.

---

### 3.6 Toast Example

```html
<div class="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
	<!-- Success toast -->
	<div
		class="flex max-w-sm min-w-72 items-start gap-3 border border-border bg-surface px-3.5 py-3 shadow-lg [border-left:3px_solid_var(--accent)]"
	>
		<span class="min-w-0 flex-1 font-mono text-xs leading-relaxed break-words text-text"
			>File uploaded successfully.</span
		>
		<button
			class="mt-0.5 shrink-0 cursor-pointer border-none bg-transparent p-0 text-muted transition-colors hover:text-text"
		>
			<XIcon size="{13}" />
		</button>
	</div>
</div>
```

Border-left colors: `var(--accent)` for success, `#ff8080` for error, `var(--border)` for default.

---

### 3.7 Context Menu Example

```html
<div
	class="fixed z-100 min-w-40 animate-[fadeUp_0.12s_ease_both] border border-border bg-surface py-1 opacity-100 transition-opacity duration-75"
	style="left: {x}px; top: {y}px"
>
	<button
		class="context-item flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3.5 py-1.75 text-left font-mono text-sm text-muted transition-[color,background] hover:bg-white/4"
		style="--hover-color: var(--text)"
	>
		<EditIcon size="{12}" />
		Rename
	</button>
	<div class="my-1 h-px bg-border"></div>
	<button
		class="context-item flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3.5 py-1.75 text-left font-mono text-sm text-muted transition-[color,background] hover:bg-white/4"
		style="--hover-color: #ff6b6b"
	>
		<TrashIcon size="{12}" />
		Delete
	</button>
</div>

<style>
	.context-item:hover {
		color: var(--hover-color, var(--text));
	}
</style>
```

---

### 3.8 Panel / Sidebar Example

```html
<aside
	class="relative flex shrink-0 flex-col overflow-hidden border-l border-border bg-surface"
	style="width: 280px"
>
	<!-- Resize handle -->
	<div
		class="absolute top-0 left-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-accent/50"
	></div>

	<!-- Sub-header -->
	<div class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
		<span class="flex-1 text-xs tracking-[0.16em] text-muted uppercase">Panel Title</span>
		<button
			class="flex cursor-pointer items-center border-0 bg-transparent p-1.25 text-muted transition-colors hover:text-text"
		>
			<XIcon size="{13}" />
		</button>
	</div>

	<!-- Scrollable body -->
	<div
		class="flex-1 overflow-y-auto p-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent"
	>
		<!-- Content -->
	</div>
</aside>
```

---

### 3.9 Drop Zone Example

```html
<div
  class="flex cursor-pointer flex-col items-center justify-center gap-2.5 border border-dashed border-border px-5 py-9 text-sm text-muted transition-[border-color,background] hover:border-accent hover:bg-accent/4"
  class:border-accent={isActive}
  class:bg-accent/4={isActive}
>
  <UploadIcon size={20} />
  <span>Drop file here or click to browse</span>
</div>
```

---

### 3.10 Badge / Tag Example

```html
<!-- Neutral -->
<span class="border border-border px-1.25 py-px text-xs tracking-widest text-muted uppercase"
	>read</span
>

<!-- Accent -->
<span class="border border-accent/30 px-1.25 py-px text-xs tracking-widest text-accent uppercase"
	>24h 30m</span
>
```

---

### 3.11 List/Item Card (Panel Data Row) Example

Individual records shown inside panels (e.g., an API key row):

```html
<div
	class="flex animate-[fadeUp_0.2s_ease_both] flex-col gap-1.5 border border-border bg-bg px-3 py-2.5"
>
	<div class="text-sm text-text">key-name</div>
	<code class="font-mono text-xs text-muted">sk-••••••••abcd</code>
	<div class="flex flex-wrap items-center gap-1">
		<span class="border border-border px-1.25 py-px text-xs tracking-widest text-muted uppercase"
			>read</span
		>
		<span class="border border-border px-1.25 py-px text-xs tracking-widest text-muted uppercase"
			>list</span
		>
	</div>
	<div class="flex justify-end">
		<button
			class="flex cursor-pointer items-center border-0 bg-transparent p-1.25 text-muted transition-colors hover:text-[#ff6b6b]"
		>
			<TrashIcon size="{12}" />
		</button>
	</div>
</div>
```

Note: background is `bg-bg` (not `bg-surface`) to show depth inside a `bg-surface` panel.

---

### 3.12 Outline "New Item" Button Example

```html
<button
	class="mb-1 flex w-full cursor-pointer items-center justify-center gap-1.5 border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs tracking-[0.08em] text-muted uppercase transition-all hover:border-accent hover:text-accent"
>
	<PlusIcon size="{12}" />
	New key
</button>
```

---

### 3.13 Inline Expandable Form Section Example

Appears beneath a trigger button with a `fadeUp` animation:

```html
<div class="flex animate-[fadeUp_0.15s_ease_both] flex-col gap-2.5 border border-border bg-bg p-3">
	<div class="flex flex-col gap-1.5">
		<label class="text-xs tracking-[0.14em] text-muted uppercase">Field label</label>
		<input
			class="w-full rounded-none border border-border bg-input-bg px-2.25 py-1.75 font-mono text-sm text-text outline-none placeholder:text-[#333] focus:border-accent"
		/>
	</div>
	<div class="flex justify-end gap-1.5">
		<button
			class="cursor-pointer border border-border bg-transparent px-3 py-1.5 font-mono text-xs tracking-widest text-muted uppercase transition-all hover:border-muted hover:text-text"
		>
			Cancel
		</button>
		<button
			class="cursor-pointer border-0 bg-accent px-3 py-1.5 font-mono text-xs font-medium tracking-widest text-bg uppercase transition-opacity hover:opacity-[0.88]"
		>
			Create
		</button>
	</div>
</div>
```

---

### 3.14 Error / Alert Banner Example

```html
<!-- Inline form error -->
<p
	class="mb-5 border border-[rgba(255,80,80,0.3)] bg-[rgba(255,80,80,0.1)] px-3 py-2.5 text-sm text-[#ff8080]"
>
	Invalid credentials.
</p>

<!-- With icon -->
<p
	class="mb-4 flex items-center gap-1.5 border border-[rgba(255,80,80,0.3)] bg-[rgba(255,80,80,0.1)] px-3 py-2 text-sm text-[#ff8080]"
>
	<XCircleIcon size="{13}" /> Upload failed.
</p>
```

---

### 3.15 Loading State

Use a spinning icon with the `.spin` class (defined in `layout.css`):

```html
<div class="flex justify-center p-4 text-muted">
	<RefreshCwIcon size="{12}" class="spin" />
</div>
```

Or inside a button during submission:

```html
<button class="..." disabled="{loading}">
	{#if loading}
	<LoaderIcon size="{13}" class="spin" /> Loading… {:else} Submit {/if}
</button>
```

---

### 3.16 Key Principles Summary (for Agent Prompts)

When instructing an agent to build UI matching this design system, include the following constraints:

1. **No border-radius** — every element is sharp-cornered. Never use `rounded-*`.
2. **Monospace everywhere** — `DM Mono` is the body font; `Anta` is only for hero headings and the app name.
3. **Sharp dark palette** — `#0e0e0e` background, `#161616` surfaces, `#2a2a2a` borders.
4. **Lime accent** — `#c8f56a` for all interactive highlights, active states, and CTAs.
5. **Uppercase labels** — all section labels, form labels, button text, and tags are uppercase with wide letter-spacing (`tracking-[0.12em]`–`tracking-[0.18em]`).
6. **Accent corner bracket** — cards and modals have a `32px × 32px` top-right corner accent in the lime color, created via a `::before` pseudo-element.
7. **Grid background texture** — the page body has a fixed, full-viewport dot-grid overlay made from lime-tinted lines at 3% opacity, `40px × 40px` spacing.
8. **`fadeUp` entrances** — new content always animates in from below using the `fadeUp` keyframe.
9. **`bg-bg` vs `bg-surface`** — use `bg-bg` for inputs and inset form areas; use `bg-surface` for panels, sidebars, and cards.
10. **Header is `h-10`** — the topmost bar is exactly 40px tall, `bg-surface`, with a `border-b border-border`.
