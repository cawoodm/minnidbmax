# Plan: Column-definition editor dialog

> Status: planned, not yet implemented. Approved 2026-05-13.

## Context

Today the column mini-language `field:label:type:default:max:flags` is the only way to edit column metadata, surfaced in two cryptic spots:

- The `<input>` that appears when you **double-click a column header** in `src/data-table.js` — a single colon-delimited string.
- The `prompt()` triggered by clicking the **+ header** in `src/data-table.js`.

CSV-without-headers imports yield auto-generated names (`Column 1`, `Column 2`, …) with auto-detected types and zero constraints; the user has to discover the colon syntax to fix them. We want a structured dialog that:

1. **Auto-opens** after every new-table creation (CSV drop with or without headers, or empty table) so the user can review and adjust column metadata before continuing.
2. **Re-opens manually** for existing tables via two affordances: a **⚙ cog control in the jsPanel title bar** (added through `panel.addControl`) and a **"Columns" icon in the footer toolbar** (next to import/export).
3. Lets users edit every column field with proper form controls: field name, label, type select, default, max, unique/notnull checkboxes, and a per-row delete.
4. **Re-serializes existing data** through the existing `serializeToDB` when a column's type changes (unparseable values become null, matching existing behavior).
5. **Replaces the double-click rename** entirely — the cryptic single-input UX is removed.

## Approach

### 1. New method `openColumnEditor(opts)` on `DataEntryTable`

Add a method to `src/data-table.js` that builds and shows an HTML5 `<dialog>` modal — same idiom as `askImportMode` in `src/app.ts` (append to `document.body`, `dlg.showModal()`, Promise-style or callback close). The dialog is appended to `document.body` (not the Shadow DOM) so it's globally modal and styled independently.

`opts` shape:
```js
{ focusIndex?: number }   // optional column index to scroll into view
```

The dialog operates on a **working copy** of `this.columns` (shallow clones of each column object) so Cancel cleanly discards changes.

### 2. Dialog markup

Inside the `<dialog>`:

```
<h3>Edit columns — <tableName></h3>
<table class="column-editor">
  <thead>
    <tr>
      <th>Field</th><th>Label</th><th>Type</th>
      <th>Default</th><th>Max</th>
      <th title="Unique">U</th><th title="Not null">!</th>
      <th></th>
    </tr>
  </thead>
  <tbody>
    <!-- one <tr> per column, each row has:
         text input (field), text input (name),
         select (type: string/number/date/boolean),
         text input (default), number input (max),
         checkbox (isUnique), checkbox (isNotNull),
         delete button (×) -->
  </tbody>
</table>
<button class="add-column-row">+ Add column</button>
<div class="dialog-actions">
  <button value="cancel">Cancel</button>
  <button value="save">Save</button>
</div>
```

Built imperatively in JS (not innerHTML) so each row's working-copy column object is captured in input event closures. Styling is inline in the method (matching `askImportMode` precedent — no shared CSS file).

### 3. On Save — apply changes in this order

1. **Validate field names**: non-empty, valid identifier-like chars, no duplicates within the working copy. On failure, mark the offending row red and abort save.

2. **Diff against `this.columns`** by position:
   - **Deletions**: any working-copy row marked deleted (× button) → splice the column index out of `this.columns` and out of every `this.dataArray[i]`.
   - **Additions**: any working-copy row with no `_originalIndex` → push column object onto `this.columns`, push `null` (or the typed default) into every `this.dataArray[i]`.
   - **Modifications**: for rows that map to an existing column:
     - **Type change**: iterate `this.dataArray`, for each row run `row[colIdx] = this.serializeToDB(String(row[colIdx]), newCol)`. Unparseable values become `null` per current `serializeToDB` behavior. Coerce to string first to guard against `value.toLowerCase()` on non-strings in the boolean branch.
     - **Unique/notnull turning on**: run `this._scanConstraintViolations(colIdx, enableUnique, enableNotNull)`. If it returns a violation summary, abort the save with `showAlert` and mark the row red.
     - Then copy field/name/default/max/isUnique/isNotNull from working copy to `this.columns[colIdx]`.

3. **Save & re-render**: `this.saveToStorage(); this.renderTable();` once at the end.

4. **Close dialog** on success.

If any step fails (validation, constraint scan), the dialog stays open and the offending row is visually flagged.

### 4. Auto-open on new-table creation

Add a custom event from the element. In `establishColumns` in `src/data-table.js`, after the `this.columns` and `this.filters` assignment, dispatch:

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

In `createTable()` in `src/app.ts`, add a custom control via the existing `addControl` pattern:

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

Keep it. It's an inline shortcut for "add one column with this colon-string". Still useful. Optionally: change its click behavior to open the dialog with a fresh empty row pre-added. For v1 keep current prompt-based behavior unchanged.

## Files to change

- `src/data-table.js`
  - New method `openColumnEditor(opts)`.
  - Dispatch `columns-established` event at end of `establishColumns`.
  - Remove the `.column-name` `dblclick` listener in `addTableEventListeners`.
- `src/app.ts`
  - In `createTable` callback: attach one-shot `columns-established` listener; add the cog `addControl`; add the "Edit columns" button in `footerToolbar`.
- `index.html`
  - No changes (dialog styles are inline; Material Icons already loaded).
- `CLAUDE.md`
  - One-line note that the cryptic mini-language input is gone and the canonical column editor is `openColumnEditor()` / the cog control / the footer button.

## Verification

1. `npm run dev`. Drop a CSV with a header line onto the page → new panel appears, dialog auto-opens listing all columns with their parsed metadata. Adjust a name, change a type, toggle `unique`, click Save → table re-renders with the new metadata and the header indicators update.
2. Drop a CSV **without** headers → dialog auto-opens with `Column 1` / `Column 2` / … prefilled; rename, change types, Save → table shows updated headers.
3. Open an existing table → click the **⚙ cog** in the title bar → same dialog opens, no auto-open.
4. Open the same table → click the **Columns** icon in the footer → same dialog opens.
5. In the dialog, click × on a row → Save → the column is removed from both the header and every data row.
6. In the dialog, click "+ Add column" → fill in name + type → Save → new column appears with `null` values in every existing row.
7. Change a string column to `number` for a column whose values are partly numeric → on Save, numeric values convert, non-numeric become `null` (pink-highlighted cells per existing `.null` styling).
8. Toggle `unique` on a column whose existing data has duplicates → Save aborts, dialog stays open with an error hint and the row flagged. Clean the duplicates manually, re-open dialog, retry → succeeds.
9. Enter a duplicate `field` name across two rows → Save aborts with row flagged.
10. Cancel button → no changes persisted.
11. Double-clicking a column header no longer opens the rename input (regression check on removal).
12. `npm run build` clean.
