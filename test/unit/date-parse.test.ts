import { describe, expect, it } from "vitest";
import { DEFAULT_DATE_FORMAT, detectDateType, inferColumnDateFormat, parseFlexibleDate, parseFlexibleDateTime } from "../../src/date-parse";

describe("parseFlexibleDate", () => {
  it("parses ISO YYYY-MM-DD", () => {
    expect(parseFlexibleDate("2024-03-15")).toBe("2024-03-15");
  });
  it("rejects invalid ISO", () => {
    expect(parseFlexibleDate("2024-13-40")).toBe(null);
  });
  it("parses DMY by default", () => {
    expect(parseFlexibleDate("15/3/2024")).toBe("2024-03-15");
  });
  it("parses MDY with hint", () => {
    expect(parseFlexibleDate("3/15/2024", "MDY")).toBe("2024-03-15");
  });
  it("ambiguous resolves DMY without hint", () => {
    expect(parseFlexibleDate("7/4/1996")).toBe("1996-04-07");
  });
  it("ambiguous resolves MDY with hint", () => {
    expect(parseFlexibleDate("7/4/1996", "MDY")).toBe("1996-07-04");
  });
  it("rejects when both > 12", () => {
    expect(parseFlexibleDate("13/14/2024")).toBe(null);
  });
  it("rejects Feb 31 (round-trip guard)", () => {
    expect(parseFlexibleDate("31/2/2024")).toBe(null);
  });
  it("accepts dot and dash separators", () => {
    expect(parseFlexibleDate("15.3.2024")).toBe("2024-03-15");
    expect(parseFlexibleDate("15-3-2024")).toBe("2024-03-15");
  });
  it("strips trailing time with AM/PM (DMY default)", () => {
    expect(parseFlexibleDate("7/4/1996 12:00:00 AM")).toBe("1996-04-07");
  });
  it("strips trailing time with MDY hint", () => {
    expect(parseFlexibleDate("7/4/1996 12:00:00 AM", "MDY")).toBe("1996-07-04");
  });
  it("strips trailing T-separator time", () => {
    expect(parseFlexibleDate("2024-03-15T14:30:00")).toBe("2024-03-15");
  });
});

describe("parseFlexibleDateTime", () => {
  it("parses ISO with T", () => {
    expect(parseFlexibleDateTime("2024-03-15T14:30:00")).toBe("2024-03-15 14:30:00");
  });
  it("parses ISO with space", () => {
    expect(parseFlexibleDateTime("2024-03-15 14:30:00")).toBe("2024-03-15 14:30:00");
  });
  it("parses ISO with Z (treated as local clock-time, no shift)", () => {
    expect(parseFlexibleDateTime("2024-03-15T14:30:00Z")).toBe("2024-03-15 14:30:00");
  });
  it("ignores milliseconds", () => {
    expect(parseFlexibleDateTime("2024-03-15T14:30:00.123")).toBe("2024-03-15 14:30:00");
  });
  it("parses AM midnight", () => {
    expect(parseFlexibleDateTime("7/4/1996 12:00:00 AM", "MDY")).toBe("1996-07-04 00:00:00");
  });
  it("parses PM afternoon", () => {
    expect(parseFlexibleDateTime("7/4/1996 1:30 PM", "MDY")).toBe("1996-07-04 13:30:00");
  });
  it("parses PM noon", () => {
    expect(parseFlexibleDateTime("7/4/1996 12:00:00 PM", "MDY")).toBe("1996-07-04 12:00:00");
  });
  it("date-only input becomes midnight", () => {
    expect(parseFlexibleDateTime("2024-03-15")).toBe("2024-03-15 00:00:00");
  });
  it("seconds default to 00", () => {
    expect(parseFlexibleDateTime("2024-03-15 14:30")).toBe("2024-03-15 14:30:00");
  });
  it("rejects out-of-range hour", () => {
    expect(parseFlexibleDateTime("2024-03-15 25:00:00")).toBe(null);
  });
  it("rejects out-of-range minute", () => {
    expect(parseFlexibleDateTime("2024-03-15 14:60:00")).toBe(null);
  });
  it("rejects garbage", () => {
    expect(parseFlexibleDateTime("hello")).toBe(null);
  });
});

describe("inferColumnDateFormat", () => {
  it("returns null when all rows are ambiguous", () => {
    const rows = [["7/4/1996"], ["1/2/2024"], ["3/5/2020"]];
    expect(inferColumnDateFormat(rows, 0)).toBe(null);
  });
  it("infers DMY from an unambiguous row", () => {
    const rows = [["7/4/1996"], ["15/3/2024"]];
    expect(inferColumnDateFormat(rows, 0)).toBe("DMY");
  });
  it("infers MDY from an unambiguous row", () => {
    const rows = [["7/4/1996"], ["3/15/2024"]];
    expect(inferColumnDateFormat(rows, 0)).toBe("MDY");
  });
  it("infers from datetime strings (leading date portion)", () => {
    const rows = [["3/15/2024 12:00:00 AM"], ["1/1/2024 1:00 PM"]];
    expect(inferColumnDateFormat(rows, 0)).toBe("MDY");
  });
  it("skips empty / non-string values without throwing", () => {
    const rows = [["", null as unknown as string], [undefined as unknown as string, ""], ["15/3/2024"]];
    expect(inferColumnDateFormat(rows, 0)).toBe("DMY");
  });
});

describe("detectDateType", () => {
  it("ISO date", () => {
    expect(detectDateType("2024-03-15")).toBe("date");
  });
  it("local date", () => {
    expect(detectDateType("15/3/2024")).toBe("date");
  });
  it("ISO datetime", () => {
    expect(detectDateType("2024-03-15T14:30:00")).toBe("datetime");
  });
  it("local datetime with AM/PM", () => {
    expect(detectDateType("7/4/1996 12:00:00 AM")).toBe("datetime");
  });
  it("plain string is null", () => {
    expect(detectDateType("hello")).toBe(null);
  });
  it("plain number is null", () => {
    expect(detectDateType("123")).toBe(null);
  });
  it("empty string is null", () => {
    expect(detectDateType("")).toBe(null);
  });
});

describe("DEFAULT_DATE_FORMAT", () => {
  it("is DMY", () => {
    expect(DEFAULT_DATE_FORMAT).toBe("DMY");
  });
});
