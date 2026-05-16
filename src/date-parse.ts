// Pure date / datetime parsing and detection. No DOM, no class.
//
// Canonical formats:
//   date     → "YYYY-MM-DD"
//   datetime → "YYYY-MM-DD HH:MM:SS"   (24-hour, space-separated, no timezone)
//
// Note on the default: today the codebase passed "YYYY-MM-DD" as the default
// format hint, but the parser only branches on `=== "MDY"` else defaults to
// DMY — so the old default has always *acted as* DMY. We make that explicit
// here by typing DateFormat = "DMY" | "MDY" and setting DEFAULT to "DMY".

export type DateFormat = "DMY" | "MDY";
export const DEFAULT_DATE_FORMAT: DateFormat = "DMY";

const pad2 = (n: number | string): string => String(n).padStart(2, "0");

// Parse YYYY-MM-DD or D/M/YYYY (separators -, /, .). Trailing time component
// is tolerated and ignored. Returns canonical "YYYY-MM-DD" or null.
export function parseFlexibleDate(value: string, formatHint: DateFormat = DEFAULT_DATE_FORMAT): string | null {
  if (typeof value !== "string") value = String(value);
  // Discard any trailing time component — date columns ignore time by design.
  const dateOnly = value.trim().split(/[T\s]/)[0];

  // ISO YYYY-MM-DD
  let m = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(dateOnly);
    return isNaN(d.getTime()) ? null : dateOnly;
  }

  // Local D/M/YYYY
  m = dateOnly.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  const year = m[3];
  let day: number, month: number;
  if (a > 12 && b <= 12) {
    day = a;
    month = b;
  } else if (b > 12 && a <= 12) {
    day = b;
    month = a;
  } else if (a > 12 && b > 12) {
    return null;
  } else {
    if (formatHint === "MDY") {
      month = a;
      day = b;
    } else {
      day = a;
      month = b;
    }
  }
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const canonical = `${year}-${pad2(month)}-${pad2(day)}`;
  const d = new Date(canonical);
  if (isNaN(d.getTime())) return null;
  // Round-trip guard against silent rollover (e.g. Feb 31 → Mar 3)
  if (d.toISOString().split("T")[0] !== canonical) return null;
  return canonical;
}

// Parse a date+time string. Accepts ISO (T or space separator, optional Z and
// milliseconds), or local "D/M/YYYY HH:MM[:SS] [AM|PM]". Returns canonical
// "YYYY-MM-DD HH:MM:SS" or null. A pure date input (no time) is treated as
// midnight.
export function parseFlexibleDateTime(value: string, formatHint: DateFormat = DEFAULT_DATE_FORMAT): string | null {
  if (typeof value !== "string") value = String(value);
  const v = value.trim();
  const split = v.match(/^(\S+)[T\s]+(.+)$/);
  if (!split) {
    const date = parseFlexibleDate(v, formatHint);
    return date ? `${date} 00:00:00` : null;
  }
  const date = parseFlexibleDate(split[1], formatHint);
  if (!date) return null;
  const t = split[2].trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?\s*Z?$/);
  if (!t) return null;
  let h = parseInt(t[1], 10);
  const mn = parseInt(t[2], 10);
  const s = t[3] ? parseInt(t[3], 10) : 0;
  const ampm = t[4] ? t[4].toUpperCase() : null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === "AM") h = h % 12; // 12 AM → 0
    else h = h === 12 ? 12 : h + 12; // 12 PM → 12; 1 PM → 13
  }
  if (h < 0 || h > 23 || mn < 0 || mn > 59 || s < 0 || s > 59) return null;
  return `${date} ${pad2(h)}:${pad2(mn)}:${pad2(s)}`;
}

// Scan a column for an unambiguous DMY or MDY date; returns the inferred format
// or null if all rows are ambiguous. Inspects only the leading
// `\d{1,2}[-/.]\d{1,2}[-/.]\d{4}` portion of each value, so datetime strings
// that begin with a local-format date still contribute.
export function inferColumnDateFormat(parsedRows: any[][], columnIndex: number): DateFormat | null {
  for (const row of parsedRows) {
    const val = row?.[columnIndex];
    if (!val || typeof val !== "string") continue;
    const m = val.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}/);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a > 12 && b <= 12) return "DMY";
    if (b > 12 && a <= 12) return "MDY";
  }
  return null;
}

// Classify a string as a date / datetime / neither. datetime is checked first
// because those strings contain a date prefix and would otherwise match.
export function detectDateType(value: string): "date" | "datetime" | null {
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?Z?$/.test(value)) return "datetime";
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\s+\d{1,2}:\d{2}(:\d{2})?\s*([AaPp][Mm])?$/.test(value)) return "datetime";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return "date";
  }
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(value)) return "date";
  return null;
}
