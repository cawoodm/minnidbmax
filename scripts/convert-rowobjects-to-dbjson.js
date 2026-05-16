// Convert a "row-objects" dump into the app's db.json format.
//
// Source shape (one file, many tables):
//   { "<Name>.table.json": [ { Field: "value", ... }, ... ], ... }
//
// Target shape (per table):
//   { dataArray: [[...], ...], columns: [{field, name, type}], elementRect: {}, sortColumn: -1, sortDirection: "asc" }
//
// All columns are typed as "string". Field order is the union of keys across
// all rows in first-appearance order (so rows where a field is missing get "",
// and rows that introduce a new field don't lose it).
//
// Usage:
//   node scripts/convert-rowobjects-to-dbjson.js <path-to-db.json>
//
// The file is rewritten in place.

const fs = require("fs");

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/convert-rowobjects-to-dbjson.js <path>");
  process.exit(1);
}

let raw = fs.readFileSync(path, "utf8");
// Tolerate trailing commas before } or ] (some hand-written dumps include them).
raw = raw.replace(/,(\s*[}\]])/g, "$1");
const src = JSON.parse(raw);

const out = {};
for (const tableKey of Object.keys(src)) {
  const rows = src[tableKey];
  if (!Array.isArray(rows)) {
    console.error("Skipping non-array:", tableKey);
    continue;
  }
  const fields = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        fields.push(k);
      }
    }
  }
  const columns = fields.map((f) => ({ field: f, name: f, type: "string" }));
  const dataArray = rows.map((row) =>
    fields.map((f) => {
      const v = row[f];
      return v === undefined || v === null ? "" : v;
    }),
  );
  out[tableKey] = {
    dataArray,
    columns,
    elementRect: {},
    sortColumn: -1,
    sortDirection: "asc",
  };
}

fs.writeFileSync(path, JSON.stringify(out, null, 2));
console.log("Wrote", Object.keys(out).length, "tables to", path);
for (const k of Object.keys(out)) {
  console.log(" -", k, "|", out[k].columns.length, "cols,", out[k].dataArray.length, "rows");
}
