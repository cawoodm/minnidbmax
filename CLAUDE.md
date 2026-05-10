# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server (entry is `index.html` at repo root).
- `npm run build` — production build to `dist/`.
- `npm run publish` — runs `publish.ps1`: builds with `--base /minnidbmax/`, copies `dist/*` into the sibling repo at `C:\projects\Marc\cawoodm.github.io\minnidbmax`, then commits and pushes that sibling repo. Requires PowerShell 7 (`pwsh`) and that the sibling working tree exists.

There are no tests and no lint script. TypeScript checks happen as part of Vite's build via `tsconfig.json` (`allowJs` + `checkJs` enabled, but `noImplicitAny` and `strictNullChecks` are off — don't tighten these without checking the rest of the codebase compiles).

## Architecture

Pure client-side static web app — no server, no backend. Three layers:

1. **`<data-entry-table>` custom element** (`src/data-table.js`) — the heart of the app. One instance per table, rendered inside a WinBox window. Owns `dataArray`, `columns`, sort state, filter state, and the cached `elementRect` (window position/size). Re-renders the entire `<table>` HTML on every change; event listeners are re-attached after each render. The element's Shadow DOM is cloned from the `#data-entry-template` `<template>` declared inline in `index.html` — that template contains the component's CSS, so styles live in `index.html`, not in JS.

2. **`DataStore(prefix)`** (`src/data-store.js`) — thin localStorage wrapper. The app constructs one store per workspace with prefix `/minnidbmax/<workspace>/`, exposed as `window.store` so the custom element can reach it (see `saveToStorage`/`loadFromStorage` in `data-table.js`). Workspaces come from `?space=<name>` or `localStorage['/minnidbmax/.currentStore']`, default `default`.

3. **Gist sync** (`src/syncher-gist.js` + `src/gist.js`) — optional push/pull of all `*.table.json` entries to a single GitHub Gist. Credentials are read from store keys `.gist-user`, `.gist-token`, `.gist-id` (must be set manually via the JS console — README has the snippet). 1 MB Gist file limit.

`src/app.ts` wires it all together: defines the custom element, builds the DataStore, creates a WinBox per stored table, and binds the four toolbar buttons.

### WinBox is a global, not a module

`public/winbox.bundle.min.js` is loaded via a plain `<script>` tag in `index.html` and `WinBox` is referenced as a global (`declare var WinBox: any` in `app.ts`). The `winbox` npm package is in `dependencies` but isn't imported — don't switch to `import WinBox from "winbox"` without also removing the script tag and verifying the bundled CSS still loads.

### Storage key conventions

Keys under the workspace prefix:
- `<code>.table.json` — one per table; value is `{ dataArray, columns, elementRect, sortColumn, sortDirection }`.
- `.gist-user`, `.gist-token`, `.gist-id` — sync credentials.
- `code` is derived from the table title via `title.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()`.

### Column metadata mini-language

Throughout the UI, columns are described by the colon-delimited string `field:label:type:default:max` (e.g. `sales_id:Sales Identifier:string::12`). This format appears in three places — header-line CSV imports (`establishColumns` in `data-table.js`), the rename-column input (`saveColumnName`), and the "+ new column" prompt. If you change the format, update all three. Types: `string`, `number`, `date` (YYYY-MM-DD), `boolean`. `string` columns accept any value; other types are validated on import.

### TS/JS mix

`src/app.ts` is TypeScript; `data-table.js`, `data-store.js`, `syncher-gist.js`, `gist.js` are JS with JSDoc type annotations. Vite handles both. The root `jsconfig.json` is legacy — `tsconfig.json` is the active config.

## Things not to break

- `index.html` lives at the repo root (Vite's default entry). The git status shows a deleted `src/index.html` from a recent reorganization — don't restore it.
- The `<template id="data-entry-template">` in `index.html` is required at element-connection time. Removing or renaming it breaks every table.
- `publish.ps1` writes to a sibling working tree and pushes from there. Don't run it without confirming the sibling repo path is intended.
