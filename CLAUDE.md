# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (entry is `index.html` at repo root).
- `npm run build` — production build to `dist/`.
- `npm run publish` — runs `publish.ps1`: builds with `--base /minnidbmax/`, copies `dist/*` into the sibling repo at `C:\projects\Marc\cawoodm.github.io\minnidbmax`, then commits and pushes that sibling repo. Requires PowerShell 7 (`pwsh`) and that the sibling working tree exists.

There are no tests and no lint script. TypeScript checks happen as part of Vite's build via `tsconfig.json` (`allowJs` + `checkJs` enabled, but `noImplicitAny` and `strictNullChecks` are off — don't tighten these without checking the rest of the codebase compiles).

## Architecture

Pure client-side static web app — no server, no backend. Three layers:

1. **`<data-entry-table>` custom element** (`src/data-table.ts`) — the heart of the app. One instance per table, rendered inside a WinBox window. Owns `dataArray`, `columns`, sort state, filter state, and the cached `elementRect` (window position/size). Re-renders the entire `<table>` HTML on every change; event listeners are re-attached after each render. The element's Shadow DOM is cloned from the `#data-entry-template` `<template>` declared inline in `index.html` — that template contains the component's CSS, so styles live in `index.html`, not in JS.

2. **`DataStore(prefix)`** (`src/data-store.ts`) — thin localStorage wrapper. Exports both the `DataStore` interface (canonical type for the store API) and the factory function of the same name — consumers `import { DataStore }` and use it in value position (call the factory) or type position (annotate `let s: DataStore`). The active workspace (resolved from `?space=<name>` or `localStorage['/minnidbmax/.currentStore']`, default `default`) lives in `src/workspace.ts`, which also owns the header `<select>` UI (`initWorkspaceSelect`). The app constructs one store per workspace with prefix `/minnidbmax/<workspace>/`, exposed as `window.store` so the custom element can reach it (see `saveToStorage`/`loadFromStorage` in `data-table.ts`). Workspaces come from `?space=<name>` or `localStorage['/minnidbmax/.currentStore']`, default `default`.

3. **Gist sync** (`src/syncher-gist.js` + `src/gist.js`) — optional push/pull of all `*.table.json` entries to a single GitHub Gist. Credentials are read from store keys `.gist-user`, `.gist-token`, `.gist-id` (must be set manually via the JS console — README has the snippet). 1 MB Gist file limit.

`src/app.ts` wires it all together: defines the custom element, builds the DataStore, creates a jsPanel per stored table, and binds the four toolbar buttons.

### jsPanel windowing

We use **jsPanel** (`jspanel4` npm package, https://jspanel.de/) — both JS and CSS are imported as ES modules at the top of `src/app.ts` (`import { jsPanel } from "jspanel4/es6module/jspanel.min.js"; import "jspanel4/dist/jspanel.min.css";`), so Vite bundles them. No script/link tag in `index.html`.

Wiring notes for `createTable()` in `src/app.ts`:
- The data-entry-table custom element is passed as `content` (jsPanel accepts an HTMLElement directly, appending it to `panel.content`).
- Three custom toolbar buttons (filter / download / data-input) are added inside the `callback` option via `panel.addControl({ name, html, handler })`. `handler(panel, control)` is bound to `pointerup` on the button, not `click` — relevant for synthetic event testing.
- jsPanel dispatches `jspanelresize` / `jspaneldragstop` / `jspanelclosed` on **`document`** (not on the panel element), each carrying `event.panel` pointing back to the instance — listeners filter by reference equality and are removed on `jspanelclosed`.
- Position is restored from `elementRect` via `{ my: 'left-top', at: 'left-top', offsetX, offsetY }`. The persisted `(x, y)` are viewport-relative pixels, read on dragstop from `panel.getBoundingClientRect()` (NOT `parseInt(panel.style.left)` — jsPanel writes `style.left: calc(...)` after a reposition, which doesn't parse).
- `onbeforeclose` returning truthy = proceed with close; falsy = abort. `deleteTable()` already returns the right shape (true on confirm, false on cancel).
- The maximize button is removed via `headerControls: { maximize: 'remove' }`. jsPanel also renders smallify/minimize/normalize/close by default — we keep all of those.

### Storage key conventions

Keys under the workspace prefix:
- `<code>.table.json` — one per table; value is `{ dataArray, columns, elementRect, sortColumn, sortDirection }`.
- `.gist-user`, `.gist-token`, `.gist-id` — sync credentials.
- `code` is derived from the table title via `title.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()`.

### Column metadata mini-language

Throughout the UI, columns are described by the colon-delimited string `field:label:type:default:max:flags` (e.g. `sales_id:Sales Identifier:string::12:unique,notnull`). This format appears in two places now: header-line CSV imports (`establishColumns` in `data-table.ts`) and the "+ new column" prompt. The double-click rename input was retired — the canonical UI for editing column metadata on an existing table is `openColumnEditor()` (also in `data-table.ts`), opened via the ⚙ cog control in the panel's jsPanel title bar or the "Edit columns" button in the footer toolbar. The same dialog auto-opens once on new-table creation, listening for the `columns-established` CustomEvent that `establishColumns` dispatches. The dialog is appended to `document.body` (not Shadow DOM) and styled with global Tailwind utility classes. `saveColumnName` is still in the file but no longer wired to any caller. Types: `string`, `number`, `date` (YYYY-MM-DD), `boolean`. `string` columns accept any value; other types are validated on import. The `flags` segment is a comma-separated list — recognized tokens are `unique` (values must be distinct; nulls allowed and treated as distinct per SQL standard) and `notnull` (empty/null forbidden); combining `unique,notnull` gives primary-key semantics on any number of columns. Constraint violations throw `ValidationError` and follow the existing per-row skip-with-alert behavior in `processInput`. Enabling a flag on an existing column (via the dialog) triggers a pre-flight scan that refuses the change if existing data would violate it.

### TS/JS mix

`src/app.ts`, `src/data-store.ts`, `src/show-alert.ts`, `src/json-import.ts`, `src/csv-import.ts`, `src/data-table.ts`, `src/workspace.ts` are TypeScript; `syncher-gist.js`, `gist.js` are JS with JSDoc type annotations. Vite handles both. The root `jsconfig.json` is legacy — `tsconfig.json` is the active config (now with `moduleResolution: "bundler"` so jspanel4's package exports map resolves under `tsc --noEmit`).

### Notifications

User-facing notifications go through the shared `showAlert(message, type, headerTitle?)` exported from `src/show-alert.ts` — a thin wrapper around `jsPanel.hint.create` (top-center toast, 5 s autoclose, themed by `type: "success" | "error" | "info"`). `DataEntryTable.showAlert` is a per-instance wrapper that auto-fills the header with the table name. Don't introduce raw `alert()` / `confirm()` calls for status messages — use `showAlert` (toast) or the existing `<dialog>` pattern (`askImportMode` in `src/app.ts`) for choices.

### Tailwind

Tailwind v4 is wired in via the `@tailwindcss/vite` plugin (configured in `vite.config.ts`) and `src/styles.css` (`@import "tailwindcss";`), which `src/app.ts` imports. Tailwind only styles the page-level `<header>` in `index.html` — Shadow DOM table styles (in `<template id="data-entry-template">`) and jsPanel chrome are unaffected. Tailwind classes won't reach inside Shadow DOM by design.

## Things not to break

- `index.html` lives at the repo root (Vite's default entry). The git status shows a deleted `src/index.html` from a recent reorganization — don't restore it.
- The `<template id="data-entry-template">` in `index.html` is required at element-connection time. Removing or renaming it breaks every table.
- `publish.ps1` writes to a sibling working tree and pushes from there. Don't run it without confirming the sibling repo path is intended.
