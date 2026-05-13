# Plan: Column-definition editor dialog (Tailwind-styled)

## Context

Today the column mini-language `field:label:type:default:max:flags` is the only way to edit column metadata, surfaced in two cryptic spots in `src/data-table.js`:

- The `<input>` that appears when you **double-click a column header** — a single colon-delimited string.
- The `prompt()` triggered by clicking the **+ header**.

CSV-without-headers imports yield auto-generated names (`Column 1`, `Column 2`, …) with auto-detected types and zero constraints; the user has to discover the colon syntax to fix them. We want a structured dialog that:

1. **Auto-opens** after every new-table creation (CSV drop with or without headers, or empty table) so the user can review and adjust column metadata before continuing.
2. **Re-opens manually** for existing tables via two affordances: a **⚙ cog control in the jsPanel title bar** (added through `panel.addControl`) and a **"Columns" icon in the footer toolbar** (next to import/export).
3. Lets users edit every column field with proper form controls: field name, label, type select, default, max, unique/notnull checkboxes, and a per-row delete.
4. **Re-serializes existing data** through the existing `serializeToDB` when a column's type changes (unparseable values become null, matching existing behavior).
5. **Replaces the double-click rename** entirely — the cryptic single-input UX is removed.

## Why Tailwind for the dialog

The dialog is appended to `document.body` (not the Shadow DOM that scopes the table styles). Anything in the main document tree sees the global Tailwind stylesheet imported by `src/app.ts → ./styles.css`. So utility classes like `bg-white`, `rounded-lg`, `flex`, `border`, etc., apply directly — no per-class inline `style.cssText` strings, no new CSS file. Tailwind v4's automatic source detection picks up class names from `.js`/`.ts`/`.html`, so classes assigned via `el.className = "..."` in `data-table.js` will be included in the build.

The existing `askImportMode` in `src/app.ts` still uses inline `style.cssText`. That's out of scope; it can be migrated in a follow-up.

## Approach

### 1. New method `openColumnEditor(opts)` on `DataEntryTable`

In `src/data-table.js`, add:

```js
openColumnEditor(opts = {}) {
  const dlg = document.createElement("dialog");
  dlg.className = "rounded-lg shadow-xl p-0 backdrop:bg-black/40 max-w-4xl w-[90vw]";
  // ... build content (see §2) ...
  document.body.appendChild(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal();
}
```

Notes:
- Uses HTML5 `<dialog>` and `showModal()` (same as `askImportMode` precedent).
- `backdrop:bg-black/40` styles the native `::backdrop` pseudo-element via Tailwind's variant.
- `close` event fires on Escape, on `<form method="dialog">` submit, and on programmatic `dlg.close()`. We auto-remove the element so successive opens don't leak detached `<dialog>`s.
- Operates on a **working copy** of `this.columns` (shallow clones) so Cancel cleanly discards changes.

`opts` shape:
```js
{ focusIndex?: number }   // optional column index to scroll into view
```

### 2. Dialog markup (Tailwind-styled, built imperatively)

```js
dlg.innerHTML = `
  <form method="dialog" class="flex flex-col">
    <header class="flex items-center justify-between px-6 py-4 border-b border-slate-200">
      <h3 class="text-lg font-semibold text-slate-800">Edit columns — ${this._escapeHTML(tableName)}</h3>
      <button type="button" class="close-x text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
    </header>
    <div class="px-6 py-4 max-h-[60vh] overflow-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-slate-600 border-b border-slate-200">
            <th class="pb-2 pr-2 font-medium">Field</th>
            <th class="pb-2 pr-2 font-medium">Label</th>
            <th class="pb-2 pr-2 font-medium">Type</th>
            <th class="pb-2 pr-2 font-medium">Default</th>
            <th class="pb-2 pr-2 font-medium w-16">Max</th>
            <th class="pb-2 pr-2 font-medium text-center w-10" title="Unique">U</th>
            <th class="pb-2 pr-2 font-medium text-center w-10" title="Not null">!</th>
            <th class="pb-2 w-8"></th>
          </tr>
        </thead>
        <tbody class="rows"></tbody>
      </table>
      <button type="button" class="add-row mt-3 text-sm text-blue-600 hover:text-blue-500">+ Add column</button>
    </div>
    <footer class="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 bg-slate-50">
      <button type="button" class="cancel rounded bg-slate-200 hover:bg-slate-300 px-4 py-1.5 text-sm">Cancel</button>
      <button type="button" class="save rounded bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 text-sm font-medium">Save</button>
    </footer>
  </form>
`;
```

Per-row markup built in a helper `_buildColumnEditorRow(workingCol)` returning a `<tr>` with:

```html
<tr class="border-b border-slate-100 last:border-b-0">
  <td class="py-2 pr-2"><input class="field w-full rounded border border-slate-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"></td>
  <td class="py-2 pr-2"><input class="name  w-full rounded border border-slate-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"></td>
  <td class="py-2 pr-2">
    <select class="type rounded border border-slate-300 px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
      <option>string</option><option>number</option><option>date</option><option>boolean</option>
    </select>
  </td>
  <td class="py-2 pr-2"><input class="default w-full rounded border border-slate-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"></td>
  <td class="py-2 pr-2"><input type="number" min="0" class="max w-full rounded border border-slate-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"></td>
  <td class="py-2 pr-2 text-center"><input type="checkbox" class="is-unique accent-blue-600"></td>
  <td class="py-2 pr-2 text-center"><input type="checkbox" class="is-notnull accent-blue-600"></td>
  <td class="py-2 text-right"><button type="button" class="del text-slate-400 hover:text-red-500" title="Delete column">×</button></td>
</tr>
```

When a row fails validation/constraint check on save, apply `row.classList.add("bg-red-50", "ring-1", "ring-red-300")` to flag it; clear those classes on the next save attempt.

### 3. On Save — apply changes in this order

1. **Validate field names**: non-empty, valid identifier-like chars, no duplicates within the working copy. On failure, flag the offending row red and abort save.

2. **Diff against `this.columns`** by stable `_originalIndex` stored on each working-copy row:
   - **Deletions**: any original column index not represented in the working copy → splice out of `this.columns` and every `this.dataArray[i]`.
   - **Additions**: any working-copy row with no `_originalIndex` → push new column object onto `this.columns`, push the serialized default (or `null`) into every `this.dataArray[i]`.
   - **Modifications**: for rows that map to an existing column:
     - **Type change**: iterate `this.dataArray`, for each row run `row[colIdx] = this.serializeToDB(String(row[colIdx]), newCol)`. Unparseable values become `null` per current `serializeToDB` behavior. Coerce to string first to guard against `value.toLowerCase()` on non-strings in the boolean branch (`src/data-table.js:348`).
     - **Unique/notnull turning on**: run the existing `this._scanConstraintViolations(colIdx, enableUnique, enableNotNull)` (`src/data-table.js:479`). If it returns a violation summary, abort the save with `showAlert` and flag the row.
     - Copy field/name/default/max/isUnique/isNotNull from working copy to `this.columns[colIdx]`.

3. **Save & re-render**: `this.saveToStorage(); this.renderTable();` once at the end.

4. **Close dialog** on success via `dlg.close()`.

If any step fails (validation, constraint scan), the dialog stays open and the offending row is visually flagged.

### 4. Auto-open on new-table creation

In `establishColumns` (`src/data-table.js:362`), after the `this.columns` and `this.filters` assignment, dispatch:

```js
this.dispatchEvent(new CustomEvent("columns-established", { bubbles: true, composed: true }));
```

This fires only when columns are first established (existing tables load via `loadFromStorage` and don't re-trigger this).

In `src/app.ts` `createTable()` callback, attach a one-shot listener to the new element:

```js
newTable.addEventListener("columns-established", () => newTable.openColumnEditor(), { once: true });
```

The dialog opens after `processInput` finishes its alert/render — user sees the new table behind the modal.

### 5. Cog control in jsPanel title bar

In `createTable()` in `src/app.ts`, alongside the existing `addControl` calls:

```js
panel.addControl({
  name: "columns",
  html: '<span class="material-icons" style="font-size:18px;vertical-align:middle;">settings</span>',
  position: 4,  // before close
  handler: () => newTable.openColumnEditor(),
});
```

Use Material Icon `settings` (cog) — already loaded.

### 6. Columns button in footer toolbar

Inside the existing `footerToolbar` function in `createTable()` (where Import/Export buttons live), add a third button:

```js
{ icon: "view_column", title: "Edit columns", onClick: () => newTable.openColumnEditor() }
```

Match the existing footer button style.

### 7. Remove the double-click rename

In `src/data-table.js` `addTableEventListeners`, remove the `.column-name` `dblclick` listener block (the one that builds the `<input>` with the colon-string default). `saveColumnName` stays as a private method but its caller is unwired. Leave `saveColumnName` in place for this PR; a follow-up can prune it.

### 8. The "+" add-column header

Keep current prompt-based behavior unchanged for v1. (Future: rewire to open the dialog with a fresh empty row pre-added.)

### 9. Tailwind source detection sanity check

Tailwind v4's Vite plugin scans project files for class names. Since the dialog markup lives inside a JS template literal in `src/data-table.js`, the scanner sees those classes in source form and emits the rules. No `safelist` config needed.

## Files to change

- `src/data-table.js`
  - New method `openColumnEditor(opts)` and helper `_buildColumnEditorRow(workingCol)`.
  - Dispatch `columns-established` event at end of `establishColumns`.
  - Remove the `.column-name` `dblclick` listener in `addTableEventListeners`.
- `src/app.ts`
  - In `createTable` callback: attach one-shot `columns-established` listener; add the cog `addControl`; add the "Edit columns" button in `footerToolbar`.
- `index.html`
  - No changes (the dialog is created in JS and styled via the existing Tailwind stylesheet).
- `CLAUDE.md`
  - One-line note that the cryptic mini-language input is gone; the canonical column editor is `openColumnEditor()` / the cog control / the footer button; mention the dialog is Tailwind-styled (lives outside Shadow DOM).

## Verification

1. `npm run dev`. Drop a CSV with a header line onto the page → new panel appears, **Tailwind-styled** dialog auto-opens listing all columns. Layout: white card with rounded corners, header row, scrollable column list, footer with Cancel + Save. Adjust a name, change a type, toggle `unique`, click Save → table re-renders with the new metadata and the header indicators update.
2. Drop a CSV **without** headers → dialog auto-opens with `Column 1` / `Column 2` / … prefilled.
3. Open an existing table → click the **⚙ cog** in the title bar → same dialog opens, no auto-open.
4. Click the **Columns** icon in the footer → same dialog opens.
5. Click × on a row → Save → the column is removed from header and every row.
6. Click "+ Add column" → fill in name + type → Save → new column appears with `null` values in every existing row.
7. Change a string column to `number` for a column whose values are partly numeric → on Save, numeric values convert, non-numeric become `null` (pink-highlighted cells per existing `.null` styling).
8. Toggle `unique` on a column whose existing data has duplicates → Save aborts, dialog stays open with the row visually flagged (`bg-red-50 ring-1 ring-red-300`) and an `showAlert` hint.
9. Enter a duplicate `field` name across two rows → Save aborts with row flagged.
10. Cancel button (or Escape, or the × in the dialog header) → no changes persisted, dialog removed from DOM.
11. Double-clicking a column header no longer opens the rename input (regression check on removal).
12. Open the dialog twice in succession → no detached `<dialog>` elements accumulate in `document.body` (Inspect → search `dialog` should show 0 between opens).
13. `npm run build` clean. CSS bundle size grows by ~1–2 kB (the dialog's Tailwind class additions are mostly already in use elsewhere).
