# Change Log

Grouped by day, derived from full git history. Most recent first.

## 2026-05-13
- Tailwind header (v0.0.16)

## 2026-05-12

- Migrated the window manager from WinBox to **jsPanel** (v0.0.11).
- Added a **footer toolbar** on each table with CSV import / export icons.
- **Drag-and-drop CSV onto the page** to create a new table named after the file; drop onto an existing panel for a 3-way Append / Overwrite / Cancel prompt; dotted overlays highlight whether the drop will land on the document or a specific panel (v0.0.12).
- **Auto-detect alternative date formats** (`MM/DD/YYYY`, `DD/MM/YYYY`, with `/` `-` `.` separators) and canonicalize to `YYYY-MM-DD`; per-column DMY/MDY inference at import.
- **Dates render in the user's locale** short format; filter input matches what's displayed.
- **Sticky table headers** so column titles stay visible while rows scroll.
- Replaced inline alert boxes with **jsPanel `hint` notifications** (top-right, colour-coded).
- **Persisted window z-order** across reloads so the last-on-top window stays on top.
- **Per-row "⋯" ellipsis** appears on hover at the start of each row → opens a jsPanel context menu with "Delete row" (replaces the old per-row delete button column).
- Unique non-null fields (primary keys) (v0.0.14).

## 2026-05-10

- Sources moved from JS to **TypeScript** (in `app.ts`), bugfixes from typed call sites.
- **Virtualization** for tables with >1000 rows; row count shown in each panel title (v0.0.8).
- **Image columns** — cells containing `data:image/…` URLs render as inline thumbnails, `#RRGGBB` values render as colour swatches (v0.0.9).
- **Import-textarea toggle** so the CSV input area is hidden by default once a table has data (v0.0.10).

## 2025-05-26

- Better sorting (v0.0.5).
- Skip re-render on per-cell data changes to keep date inputs editable.
- Gist sync bug fixes (v0.0.6).
- Messaging improvements.

## 2025-05-22

- Basic workspaces

## 2025-05-21

- **Drag-and-drop CSV** onto a table's import textarea (initial implementation; later expanded in 2026-05-12).
- Custom CSV separators and null-value handling.
- Window close behavior wired up.
- v0.0.4 marker (Drag & Drop, Editing, Nulls, Defaults).

## 2025-05-20

- Persisted sort state per table.
- **Inline editing** of text, number, and date fields.
- Improved import: skip-on-error, parse type metadata from CSV headers, empty-table display.

## 2025-05-18

- Moved storage to a **virtual store** abstraction (v0.0.2).

## 2025-05-17

- Column defaults.

## 2025-05-16

- Header parsing and **CSV export**.
- Gist data dump and sync.

## 2025-05-15

- Initial v0.0.1 release.

## 2025-05-14

- Project creation
