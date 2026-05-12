"use strict";

import { jsPanel } from "jspanel4/es6module/jspanel.js";

// Fallback when a column has no unambiguous date value to infer DMY vs MDY from.
// Switzerland/EU convention: day-month-year.
const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";

export class DataEntryTable extends HTMLElement {
  constructor() {
    super();

    // Initialize Shadow DOM
    this.attachShadow({ mode: "open" });

    //this.shadowRoot = /** @type {!ShadowRoot} */ (this.shadowRoot);

    const template = /** @type {!HTMLTemplateElement} */ (document.getElementById("data-entry-template"));
    this.shadowRoot.appendChild(template.content.cloneNode(true));

    // Instance variables
    this.dataArray = [];
    this.columns = [];
    this.filters = [];
    this.elementRect = {};
    this.sortColumn = -1;
    this.sortDirection = "asc";
    // Virtualization state
    this._rowHeight = 40; // estimate; refined post-render
    this._scrollAttached = false;
    this._scrollRaf = null;
    this._resizeRaf = null;
    this._displayData = null;
    this._originalIndexMap = null;
  }

  static VIRTUALIZE_THRESHOLD = 1000;

  // When component is added to the DOM
  connectedCallback() {
    // Get storage key from attribute or use default
    this.storageKey = this.getAttribute("storage-key");
    if (!this.storageKey) throw new Error("Data Table requires a storage-key attribute.");

    // DOM elements
    this.dataInput = /** @type {!HTMLInputElement} */ (this.shadowRoot.querySelector(".input-container textarea"));
    if (!this.dataInput) throw new Error("Data input element not found in template.");
    this.tableContainer = this.shadowRoot.querySelector(".table-container");

    //this.titleElement = this.shadowRoot.querySelector(".title");
    //if (!this.titleElement) throw new Error("Title element not found in template.");
    //this.titleElement.textContent = toTitleCase(this.getAttribute("title"));

    // Bind methods
    this.handleKeyPress = this.handleKeyPress.bind(this);

    // Set up event listeners
    this.dataInput.addEventListener("keypress", this.handleKeyPress);

    // Initialize data
    this.loadFromStorage();

    // Hide the import textarea by default once the table has data;
    // empty tables keep it visible so the user can populate the first row.
    if (this.dataArray.length > 0) {
      this.shadowRoot.querySelector(".input-container").classList.add("hide");
    }

    this.renderTable();

    this.saveToStorage();
  }

  initializeData() {
    this.dataArray = [];
    this.columns = []; // TODO: We may not always want to overwrite custom column definitions when we import with overwrite!
    this.filters = [];
    this.sortColumn = -1;
    this.sortDirection = "asc";
    this.saveToStorage();
    this.renderTable();
  }

  createdCallback(options) {
    return; // Doesn't work
    options.width = this.elementRect.width;
    options.height = this.elementRect.height;
    options.x = this.elementRect.x;
    options.y = this.elementRect.y;
  }
  resizedCallback(w, h) {
    if (h < 40) return; // Minimum height
    this.elementRect.width = w;
    this.elementRect.height = h;
    this.saveToStorage();
    // Re-render visible slice (rAF-throttled) — viewport height changed
    if (this._displayData && this._displayData.length > DataEntryTable.VIRTUALIZE_THRESHOLD && this.tableContainer) {
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = null;
        this.tableContainer.innerHTML = this._buildTableHTML();
        this.addTableEventListeners();
      });
    }
  }
  movedCallback(x, y) {
    this.elementRect.x = x;
    this.elementRect.y = y;
    this.saveToStorage();
  }
  minimizedCallback(x, y) {
    this.elementRect.minimized = true;
    this.saveToStorage();
  }
  maximizedCallback(x, y) {
    this.elementRect.maximized = true;
    this.saveToStorage();
  }
  restoredCallback(x, y) {
    this.elementRect.minimized = false;
    this.elementRect.maximized = false;
    this.saveToStorage();
  }
  zIndexChangedCallback(z) {
    if (!Number.isFinite(z)) return;
    if (this.elementRect.zIndex === z) return; // skip no-op writes
    this.elementRect.zIndex = z;
    this.saveToStorage();
  }

  // Handle input events
  handleKeyPress(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault(); // Prevent new line on Enter
      this.processInput();
    }
  }

  // Process input field value
  processInput() {
    if (!this.dataInput) throw new Error("Data input element not found in template.");
    const inputLines = this.dataInput.value
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (inputLines.length === 0) return; // No input to process
    const seperator = inputLines[0].includes(";") ? ";" : inputLines[0].includes("\t") ? "\t" : ",";

    // Pre-parse all lines once — needed for both header detection and per-column date-format inference.
    const parsedRows = inputLines.map((line) => this.parseCSV(line.trim(), seperator)).filter((r) => r.length > 0);
    if (parsedRows.length === 0) return;

    // Decide where data rows start (skip the header row if present).
    const isNewTable = this.dataArray.length === 0 && typeof this.columns[0] === "undefined";
    let dataStart = 0;
    if (isNewTable) {
      const firstRow = parsedRows[0];
      if (firstRow.every((cell) => this.detectType(cell) === "string")) {
        const sample = parsedRows.length > 1 ? parsedRows[1] : firstRow;
        this.establishColumns(sample, firstRow);
        dataStart = 1;
      } else {
        this.establishColumns(firstRow);
        dataStart = 0;
      }
    }
    const dataRows = parsedRows.slice(dataStart);

    // Infer DMY/MDY per date column from the data rows; persist on the column.
    this.columns.forEach((col, i) => {
      if (col.type === "date" && !col.dateFormat) {
        col.dateFormat = this.inferColumnDateFormat(dataRows, i) || DEFAULT_DATE_FORMAT;
      }
    });

    let lineCount = dataStart;
    let errorLines = 0;
    for (const values of dataRows) {
      lineCount++;
      try {
        this.processLine(values);
      } catch (e) {
        if (!(e instanceof ValidationError)) throw e;
        if (errorLines == 0 && inputLines.length > 5) {
          alert(`Line ${lineCount} failed: ${e.message}`);
          if (confirm("Do you want to stop processing? Pressing no/cancel now will skip all invalid rows silently!")) return;
          errorLines++;
        } else if (errorLines > 0) {
          errorLines++;
          console.warn(`Line ${lineCount} failed: ${e.message}`);
        } else {
          this.showAlert(`Line ${lineCount} failed: ${e.message}`, "error");
          return;
        }
      }
    }
    // Clear the input field only on successful addition
    this.dataInput.value = "";
    if (errorLines == 0) this.showAlert("Data added successfully!");
    else this.showAlert(`Data imported, ${errorLines} lines skipped!`);
    this.renderTable();
    this.saveToStorage();
  }

  processLine(parsedValues) {
    parsedValues = this.convertNulls(parsedValues);
    this.setDefaults(parsedValues);
    this.validateTypes(parsedValues);
    this.addDataRow(parsedValues);
  }

  convertNulls(values) {
    return values.map((value) => {
      if (value === "null" || value === "NULL" || value === "undefined" || value === "undefined") {
        return null;
      }
      return value;
    });
  }

  // Parse CSV-like input
  parseCSV(text, seperator) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === seperator && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    // Add the last value
    result.push(current.trim());

    // Remove quotes from quoted strings
    return result.map((val) => {
      if (val.startsWith('"') && val.endsWith('"')) {
        return val.slice(1, -1);
      }
      return val;
    });
  }

  // Detect data type of a value
  detectType(value) {
    // Check if boolean
    if (value.toLowerCase() === "true" || value.toLowerCase() === "false") {
      return "boolean";
    }

    // Check if date — canonical YYYY-MM-DD, or D/M/YYYY, D-M-YYYY, D.M.YYYY (DMY/MDY both accepted).
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return "date";
      }
    }
    if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(value)) {
      return "date";
    }

    // Check if number
    if (!isNaN(parseFloat(value)) && isFinite(value)) {
      return "number";
    }

    // Default to string
    return "string";
  }

  // Parse YYYY-MM-DD or D/M/YYYY (with separator -, /, or .) into canonical YYYY-MM-DD.
  // formatHint ("DMY" | "MDY") resolves ambiguous values (both segments ≤ 12).
  // Returns null on invalid input.
  parseFlexibleDate(value, formatHint) {
    if (typeof value !== "string") value = String(value);
    const pad = (n) => String(n).padStart(2, "0");
    let m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : value;
    }
    m = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (!m) return null;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const year = m[3];
    let day, month;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      day = b;
      month = a;
    } else if (a > 12 && b > 12) {
      return null; // both can't be month
    } else {
      // ambiguous — use hint
      if (formatHint === "MDY") {
        month = a;
        day = b;
      } else {
        // default DMY
        day = a;
        month = b;
      }
    }
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    const canonical = `${year}-${pad(month)}-${pad(day)}`;
    const d = new Date(canonical);
    if (isNaN(d.getTime())) return null;
    // Round-trip guard against e.g. 2024-02-31 → JS rolls over silently
    if (d.toISOString().split("T")[0] !== canonical) return null;
    return canonical;
  }

  // Scan a column for an unambiguous DMY or MDY date; null if none found.
  inferColumnDateFormat(parsedRows, columnIndex) {
    for (const row of parsedRows) {
      const val = row[columnIndex];
      if (!val || typeof val !== "string") continue;
      const m = val.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}$/);
      if (!m) continue;
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (a > 12 && b <= 12) return "DMY";
      if (b > 12 && a <= 12) return "MDY";
    }
    return null;
  }

  // Format value based on detected type
  serializeToDB(value, column) {
    if (value === null) return null; // (non-strict)
    if (typeof value === "undefined") return null; // (non-strict)
    // Back-compat: callers used to pass a bare type string.
    const col = typeof column === "string" ? { type: column } : column;
    switch (col.type) {
      case "boolean":
        return value.toLowerCase() === "true";
      case "number":
        return parseFloat(value);
      case "date": {
        const canonical = this.parseFlexibleDate(value, col.dateFormat || DEFAULT_DATE_FORMAT);
        if (canonical === null) console.warn(`Unparseable date "${value}" stored as null`);
        return canonical;
      }
      default:
        return value;
    }
  }

  // Establish column structure from first data row
  establishColumns(values, headers) {
    if (headers && headers.length !== values.length) throw new ValidationError("Header and 1st data row length mismatch!");
    this.columns = values.map((value, index) => {
      let col = {
        field: headers?.[index] || `field_${index + 1}`,
        name: headers?.[index] || `Column ${index + 1}`,
        type: this.detectType(value),
        default: null,
        max: 0,
        dateFormat: null,
        isUnique: false,
        isNotNull: false,
      };
      if (headers) {
        const fieldMeta = (headers[index] + ":::::").split(":");
        if (fieldMeta[0]) col.field = fieldMeta[0];
        if (fieldMeta[1]) col.name = fieldMeta[1];
        if (fieldMeta[2]) col.type = fieldMeta[2];
        if (fieldMeta[3]) col.default = fieldMeta[3];
        if (fieldMeta[4]) col.max = parseInt(fieldMeta[4]);
        if (fieldMeta[5]) {
          const flags = this._parseColumnFlags(fieldMeta[5]);
          col.isUnique = flags.isUnique;
          col.isNotNull = flags.isNotNull;
        }
      }
      return col;
    });
    this.filters = new Array(this.columns.length).fill("");
  }

  // Parse the comma-separated flags segment of the column mini-language.
  // Recognized tokens: "unique", "notnull". Unknown tokens warn and are ignored.
  _parseColumnFlags(segment) {
    const tokens = String(segment || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const recognized = new Set(["unique", "notnull"]);
    for (const t of tokens) {
      if (!recognized.has(t)) console.warn(`Unknown column flag: "${t}"`);
    }
    return {
      isUnique: tokens.includes("unique"),
      isNotNull: tokens.includes("notnull"),
    };
  }

  setDefaults(values) {
    this.columns.forEach((col, index) => {
      if (!values[index]) {
        let defaultValue = col.default;
        // TODO: Check if null is allowed
        if (typeof defaultValue !== "undefined") values[index] = defaultValue;
        values[index] = null; // (non-strict)
        /*
        else if (col.type === "boolean") values[index] = false;
        else if (col.type === "number") values[index] = 0;
        else if (col.type === "date") values[index] = new Date().toISOString().split("T")[0];
        else if (col.type === "string") values[index] = "";
        else throw new ValidationError(`No default for column ${index + 1} (${this.columns[index].field})!`);
        */
      }
    });
  }
  // Validate types match established columns
  validateTypes(values) {
    if (values.length > this.columns.length) throw new ValidationError(`Too many values (${values.length}) for a table of this column count (${this.columns.length})!`);

    // Check each value against the established type
    for (let i = 0; i < values.length; i++) {
      if (values[i] === null) continue; // Skip null values (non-strict)
      const detectedType = this.detectType(values[i]);
      // string columns accept any type but still enforce max-length below
      if (this.columns[i].type !== "string" && detectedType !== this.columns[i].type) {
        throw new ValidationError(`Column ${i} "${values[i]}" of wrong type (${detectedType}): should be ${this.columns[i].type}!`);
      }
      this.checkMaxLength(values[i], this.columns[i], i);
    }
  }

  checkMaxLength(value, column, index) {
    if (!column.max) return; // 0 / undefined = no limit
    if (column.type !== "string" && column.type !== "number") return; // skip date / boolean
    const len = String(value).length;
    if (len > column.max) throw new ValidationError(`Column ${column.name || column.field} "${value}" exceeds max length ${column.max} (was ${len})!`);
  }

  // Check unique/notnull constraints against the current dataArray.
  // values: serialized row to validate. excludeIndex: row to skip (the row being edited).
  // Throws ValidationError on first violation.
  _checkKeyConstraints(values, excludeIndex = -1) {
    for (let colIdx = 0; colIdx < this.columns.length; colIdx++) {
      const col = this.columns[colIdx];
      if (!col.isUnique && !col.isNotNull) continue;

      const v = values[colIdx];
      const isEmpty = v === null || v === undefined || v === "";

      if (col.isNotNull && isEmpty) {
        throw new ValidationError(`Column "${col.name}" cannot be empty`);
      }

      // SQL semantics: NULLs are distinct in unique constraints, so skip empty here.
      if (col.isUnique && !isEmpty) {
        for (let rowIdx = 0; rowIdx < this.dataArray.length; rowIdx++) {
          if (rowIdx === excludeIndex) continue;
          if (this.dataArray[rowIdx][colIdx] === v) {
            throw new ValidationError(`Column "${col.name}" duplicate value: ${v}`);
          }
        }
      }
    }
  }

  // Pre-flight scan when a constraint is being enabled on an existing column.
  // Returns a human-readable violation summary, or null if clean.
  _scanConstraintViolations(colIdx, checkUnique, checkNotNull) {
    let emptyCount = 0;
    let dupCount = 0;
    const seen = new Map();
    for (let i = 0; i < this.dataArray.length; i++) {
      const v = this.dataArray[i][colIdx];
      const isEmpty = v === null || v === undefined || v === "";
      if (checkNotNull && isEmpty) emptyCount++;
      if (checkUnique && !isEmpty) {
        const count = (seen.get(v) || 0) + 1;
        seen.set(v, count);
        if (count === 2) dupCount++; // distinct values that have at least one duplicate
      }
    }
    if (!emptyCount && !dupCount) return null;
    const parts = [];
    if (emptyCount) parts.push(`${emptyCount} empty value${emptyCount > 1 ? "s" : ""}`);
    if (dupCount) parts.push(`${dupCount} duplicate value${dupCount > 1 ? "s" : ""}`);
    return parts.join(", ");
  }

  // Add data row to array
  addDataRow(values) {
    // Format values according to their types
    const formattedValues = values.map((val, index) => this.serializeToDB(val, this.columns[index]));
    this._checkKeyConstraints(formattedValues, -1);
    this.dataArray.push(formattedValues);
    return true;
  }

  renderTable(displayData) {
    displayData = displayData || [...this.dataArray];

    // For large datasets, precompute a row→index map so the per-row originalIndex
    // lookup below is O(1) instead of O(n) with JSON.stringify (was O(n²) overall).
    // Filter/sort preserve row identity, so reference equality is safe here.
    let originalIndexMap = new Map();
    for (let i = 0; i < this.dataArray.length; i++) originalIndexMap.set(this.dataArray[i], i);

    // Sort full displayData (cheap relative to render; needed before slicing)
    if (this.sortColumn !== -1) {
      const sortColumn = this.sortColumn;
      const sortDirection = this.sortDirection;
      const colType = this.columns[sortColumn].type;
      displayData.sort((a, b) => {
        const valueA = a[sortColumn];
        const valueB = b[sortColumn];
        if (colType === "date") {
          const dateA = new Date(valueA);
          const dateB = new Date(valueB);
          return sortDirection === "asc" ? dateA.getTime() - dateB.getTime() : dateB.getTime() - dateA.getTime();
        } else if (colType === "number") {
          return sortDirection === "asc" ? valueA - valueB : valueB - valueA;
        } else {
          const strA = String(valueA).toLowerCase();
          const strB = String(valueB).toLowerCase();
          return sortDirection === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA);
        }
      });
    }

    // Cache for scroll/resize re-renders (avoid re-sorting)
    this._displayData = displayData;
    this._originalIndexMap = originalIndexMap;

    this.tableContainer.innerHTML = this._buildTableHTML();
    this.addTableEventListeners();
    this._ensureScrollHandler();

    // Refine row-height estimate from a real rendered row, then re-render once
    // if the actual height differs meaningfully from the estimate.
    if (displayData.length > 0) {
      /** @type {HTMLElement} */
      const sample = this.tableContainer.querySelector("tbody tr.data-row");
      if (sample && sample.offsetHeight > 0) {
        const measured = sample.offsetHeight;
        if (Math.abs(measured - this._rowHeight) > 2) {
          this._rowHeight = measured;
          this.tableContainer.innerHTML = this._buildTableHTML();
          this.addTableEventListeners();
        }
      }
    }

    this.dispatchEvent(
      new CustomEvent("row-count-changed", {
        detail: { count: displayData.length, total: this.dataArray.length },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _buildTableHTML() {
    const total = this._displayData.length;
    const useVirtual = total > DataEntryTable.VIRTUALIZE_THRESHOLD;
    const colSpan = this.columns.length + 2;

    let firstVisible = 0;
    let lastVisible = total;
    if (useVirtual) {
      const scrollTop = this.tableContainer.scrollTop;
      const viewportH = this.tableContainer.clientHeight || 400;
      const buffer = 10;
      firstVisible = Math.max(0, Math.floor(scrollTop / this._rowHeight) - buffer);
      lastVisible = Math.min(total, Math.ceil((scrollTop + viewportH) / this._rowHeight) + buffer);
    }

    let html = '<table><thead><tr><th class="row-actions"></th>';
    this.columns.forEach((col, index) => {
      const dataType = col.type;
      const classNames = [dataType];
      if (this.sortColumn === index) classNames.push(this.sortDirection);
      const flagSyms = [];
      const flagTitles = [];
      if (col.isUnique) {
        flagSyms.push("🔑");
        flagTitles.push("Unique");
      }
      if (col.isNotNull) {
        flagSyms.push("!");
        flagTitles.push("Not null");
      }
      const keyIcon = flagSyms.length ? `<span class="key-indicator" title="${flagTitles.join(", ")}">${flagSyms.join("")}</span>` : "";
      html += `<th data-index="${index}" class="${classNames.join(" ")}"><span class="column-name" data-index="${index}" title="${col.field}:${dataType}">${col.name}</span>${keyIcon}</th>`;
    });
    html += '<th class="add-column" title="Add new column">+</th></tr></thead><tbody>';

    html +=
      `<tr class="filter-row ${this.filters.find((f) => !!f) ? "" : "hide"}"><td></td>` +
      this.columns.map((col, index) => `<td><input class="filter-input" fieldIndex="${index}" value="${this.filters[index]}"/></td>`).join(" ") +
      "<td></td></tr>";

    if (firstVisible > 0) {
      html += `<tr class="virtual-spacer"><td colspan="${colSpan}" style="padding:0;border:0;height:${firstVisible * this._rowHeight}px"></td></tr>`;
    }

    for (let i = firstVisible; i < lastVisible; i++) {
      const row = this._displayData[i];
      const originalIndex = this._originalIndexMap ? (this._originalIndexMap.get(row) ?? -1) : this.dataArray.findIndex((r) => JSON.stringify(r) === JSON.stringify(row));
      html += this._buildRowHTML(row, originalIndex);
    }

    if (lastVisible < total) {
      html += `<tr class="virtual-spacer"><td colspan="${colSpan}" style="padding:0;border:0;height:${(total - lastVisible) * this._rowHeight}px"></td></tr>`;
    }

    html += "</tbody></table>";
    return html;
  }

  _buildRowHTML(row, originalIndex) {
    let html = `<tr class="data-row"><td class="row-actions"><button class="row-menu" data-index="${originalIndex}">⋯</button></td>`;
    row.forEach((cell, cellIndex) => {
      const column = this.columns[cellIndex];
      const dataType = column.type;
      const classNames = [dataType];
      const isNull = cell === null;
      if (isNull) classNames.push("null");

      let cellInner;
      if (dataType === "boolean") {
        cellInner = `<input type="checkbox" class="dataInput" ${cell ? "checked" : ""} dataIndex="${originalIndex}" fieldIndex="${cellIndex}">`;
      } else if (dataType === "string" && !isNull && typeof cell === "string" && cell.match(/^#[0-9A-F]{6}$/i)) {
        cellInner = `<div style="width: 20px; height: 20px; border:1px solid silver; background-color: ${this._escapeHTML(cell)};"></div>`;
      } else if (dataType === "string" && !isNull && typeof cell === "string" && cell.match(/^data:image\/.+$/i)) {
        cellInner = `<img src="${cell}"/>`;
      } else {
        // Click-to-edit text cell — input is created on demand in _activateCell
        classNames.push("editable");
        cellInner = this._escapeHTML(this._formatCellText(cell, dataType));
      }
      html += `<td class="${classNames.join(" ")}" dataIndex="${originalIndex}" fieldIndex="${cellIndex}">${cellInner}</td>`;
    });
    html += "<td></td></tr>";
    return html;
  }

  _escapeHTML(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  _formatCellText(value, dataType) {
    if (value === null || value === undefined) return "";
    if (dataType === "date" && typeof value === "string") {
      const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        // Build from parts (local midnight) — `new Date("2024-03-15")` parses as UTC,
        // which then shifts a day when toLocaleDateString converts to a UTC-west zone.
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        if (!isNaN(d.getTime())) return d.toLocaleDateString();
      }
      return String(value);
    }
    return String(value);
  }

  _activateCell(td) {
    if (td.querySelector("input")) return; // already editing
    const dataIndex = parseInt(td.getAttribute("dataIndex"));
    const fieldIndex = parseInt(td.getAttribute("fieldIndex"));
    if (isNaN(dataIndex) || isNaN(fieldIndex)) return;
    if (!this.dataArray[dataIndex]) return;
    const column = this.columns[fieldIndex];
    const value = this.dataArray[dataIndex][fieldIndex];

    const input = document.createElement("input");
    input.className = "dataInput";
    if (column.type === "date") {
      input.type = "date";
      if (value !== null) {
        try {
          input.value = new Date(value).toISOString().split("T")[0];
        } catch (e) {
          input.value = "";
        }
      }
    } else {
      input.type = "text";
      input.value = value === null ? "" : String(value);
    }
    input.setAttribute("dataIndex", String(dataIndex));
    input.setAttribute("fieldIndex", String(fieldIndex));

    td.textContent = "";
    td.appendChild(input);
    input.focus();
    if (typeof input.select === "function") input.select();

    let done = false;
    const finish = (cancel) => {
      if (done) return;
      done = true;
      if (!cancel) {
        const newValue = input.value;
        if (column.type === "number" && newValue !== "" && isNaN(parseFloat(newValue))) {
          done = false;
          alert("Invalid number");
          input.focus();
          return;
        }
        if (column.type === "date" && newValue !== "" && this.parseFlexibleDate(newValue, column.dateFormat || DEFAULT_DATE_FORMAT) === null) {
          done = false;
          alert("Invalid date");
          input.focus();
          return;
        }
        if (newValue !== "") {
          try {
            this.checkMaxLength(newValue, column, fieldIndex);
          } catch (e) {
            if (!(e instanceof ValidationError)) throw e;
            done = false;
            this.showAlert(e.message, "error");
            input.focus();
            return;
          }
        }
        const serializedValue = newValue === "" && column.type !== "string" ? null : this.serializeToDB(newValue, column);
        const candidate = [...this.dataArray[dataIndex]];
        candidate[fieldIndex] = serializedValue;
        try {
          this._checkKeyConstraints(candidate, dataIndex);
        } catch (e) {
          if (!(e instanceof ValidationError)) throw e;
          done = false;
          this.showAlert(e.message, "error");
          input.focus();
          return;
        }
        this.dataArray[dataIndex][fieldIndex] = serializedValue;
        this.saveToStorage();
      }
      this._deactivateCell(td, dataIndex, fieldIndex);
    };

    input.addEventListener("blur", () => finish(false));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(false);
      } else if (e.key === "Escape") {
        finish(true);
      }
    });
  }

  _deactivateCell(td, dataIndex, fieldIndex) {
    const value = this.dataArray[dataIndex][fieldIndex];
    const column = this.columns[fieldIndex];
    td.classList.toggle("null", value === null);
    td.textContent = this._formatCellText(value, column.type);
  }

  _ensureScrollHandler() {
    if (this._scrollAttached) return;
    this._scrollAttached = true;
    this.tableContainer.addEventListener("scroll", () => {
      if (this._scrollRaf) return;
      this._scrollRaf = requestAnimationFrame(() => {
        this._scrollRaf = null;
        if (!this._displayData || this._displayData.length <= DataEntryTable.VIRTUALIZE_THRESHOLD) return;
        // Commit any active cell edit before the rebuild so the user's value isn't lost.
        const active = this.shadowRoot.activeElement;
        if (active instanceof HTMLFormElement) {
          var input = active;
          if (input.tagName === "INPUT" && input.classList.contains("dataInput")) {
            input.blur();
          }
        }
        this.tableContainer.innerHTML = this._buildTableHTML();
        this.addTableEventListeners();
      });
    });
  }

  // Add event listeners to table elements
  addTableEventListeners() {
    // Filter fields
    //this.shadowRoot.querySelector(".container").addEventListener("drop", this.handleDataInputDrop.bind(this));
    const filterFields = /** @type {NodeListOf<HTMLInputElement>} */ (this.shadowRoot.querySelectorAll("td input.filter-input"));
    filterFields.forEach((field) => {
      field.addEventListener(
        "keypress",
        /**
         * @param {KeyboardEvent} e
         */
        (e) => {
          // Since we render the whole table we can't filter until enter is pressed
          if (e.key !== "Enter") return;
          e.preventDefault();
          const fieldIndex = parseInt(field.getAttribute("fieldIndex"));
          const filterValue = field.value.trim();
          this.filters[fieldIndex] = filterValue;

          // Filter on the displayed text so users can match what they see
          // (especially relevant for locale-formatted dates).
          const colType = this.columns[fieldIndex].type;
          const filteredData = this.dataArray.filter((row) => {
            return this._formatCellText(row[fieldIndex], colType).toLowerCase().includes(filterValue.toLowerCase());
          });

          // Update the table with filtered data
          this.renderTable(filteredData);
        },
      );
    });

    // Editable text/number/date cells — click swaps in an <input>
    const editableCells = /** @type {NodeListOf<HTMLElement>} */ (this.shadowRoot.querySelectorAll("td.editable"));
    editableCells.forEach((td) => {
      td.addEventListener("click", () => {
        if (td.querySelector("input")) return;
        this._activateCell(td);
      });
    });

    // Checkbox fields (and any always-rendered .dataInput, e.g. during active edit)
    const inputFields = /** @type {NodeListOf<HTMLInputElement>} */ (this.shadowRoot.querySelectorAll("td input.dataInput"));
    inputFields.forEach(
      /**
       * @param {HTMLInputElement} field
       */
      (field) => {
        field.addEventListener(
          "change",
          /**
           * @param {Event} e
           */
          (e) => {
            const el = /** @type {HTMLInputElement} */ (e.target);
            const fieldIndex = parseInt(field.getAttribute("fieldIndex"));
            const dataIndex = parseInt(field.getAttribute("dataIndex"));
            const column = this.columns[fieldIndex];
            if (el.type === "checkbox") {
              const newVal = field.checked;
              if (column.isUnique || column.isNotNull) {
                const candidate = [...this.dataArray[dataIndex]];
                candidate[fieldIndex] = newVal;
                try {
                  this._checkKeyConstraints(candidate, dataIndex);
                } catch (err) {
                  if (!(err instanceof ValidationError)) throw err;
                  field.checked = !newVal; // revert visual state
                  this.showAlert(err.message, "error");
                  return;
                }
              }
              this.dataArray[dataIndex][fieldIndex] = newVal;
            } else {
              const value = field.value;
              if (column.type === "number" && isNaN(parseFloat(value))) return alert("Invalid number");
              if (column.type === "date" && this.parseFlexibleDate(value, column.dateFormat || DEFAULT_DATE_FORMAT) === null) return alert("Invalid date");
              if (!this.dataArray[dataIndex]) return alert(`Missing row: ${dataIndex}`);
              this.dataArray[dataIndex][fieldIndex] = this.serializeToDB(value, column);
            }
            this.saveToStorage();
            // this.renderTable();
          },
        );
      },
    );

    // Header click for sorting (only data-column headers, not the row-actions gutter or the + add-column)
    const headers = this.shadowRoot.querySelectorAll("th[data-index]");
    headers.forEach((header) => {
      header.addEventListener("click", (e) => {
        // Suppress click on column name or dblclick event is not fired
        let el = /** @type {HTMLElement} */ (e.target);
        if (el.classList.contains("column-name")) return;

        const columnIndex = parseInt(header.getAttribute("data-index"));

        // Toggle sort direction if clicking the same column
        if (this.sortColumn === columnIndex) {
          if (this.sortDirection == "desc") {
            this.sortColumn = -1;
          } else {
            this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
          }
        } else {
          this.sortColumn = columnIndex;
          this.sortDirection = "asc";
        }
        this.saveToStorage();
        this.renderTable();
      });
    });
    this.shadowRoot.querySelector("th.add-column").addEventListener("click", (e) => {
      let f = prompt("Enter new column (field:name:type:default:max:flags)");
      if (!f) return;
      let fieldMeta = (f + ":::::").split(":");
      let field = fieldMeta[0];
      let name = fieldMeta[1] || this._toTitleCase(field);
      let defaultValue = fieldMeta[3];
      let type = fieldMeta[2] || this.detectType(defaultValue || "");
      let max = parseInt(fieldMeta[4]) || 0;
      const flags = this._parseColumnFlags(fieldMeta[5] || "");
      const serializedDefault = this.serializeToDB(defaultValue, { type, dateFormat: DEFAULT_DATE_FORMAT });
      // notnull on a new column with no default would instantly violate existing rows — refuse.
      if (flags.isNotNull && (serializedDefault === null || serializedDefault === "") && this.dataArray.length > 0) {
        this.showAlert(`Cannot add "${name}" as not-null: ${this.dataArray.length} existing rows would have empty values. Provide a non-null default.`, "error");
        return;
      }
      this.columns.push({ field, name, type, default: null, max, dateFormat: null, isUnique: flags.isUnique, isNotNull: flags.isNotNull });
      this.dataArray.forEach((row) => {
        row.push(serializedDefault);
      });
      this.saveToStorage();
      this.renderTable();
    });

    // Column name editing
    const columnNameSpans = this.shadowRoot.querySelectorAll(".column-name");
    columnNameSpans.forEach((span) => {
      span.addEventListener("dblclick", (e) => {
        e.stopPropagation(); // Prevent sorting when editing column name
        const columnIndex = parseInt(span.getAttribute("data-index"));
        const column = this.columns[columnIndex];
        const currentName = column.name;

        // Create an editable input
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Rename: field:name:type:default:maxlength:flags";
        input.title = input.placeholder;
        const flagTokens = [];
        if (column.isUnique) flagTokens.push("unique");
        if (column.isNotNull) flagTokens.push("notnull");
        input.value = column.field + ":" + column.name + ":" + column.type + ":" + (column.default || "") + ":" + (column.max || 0) + ":" + flagTokens.join(",");
        input.style.minWidth = Math.max(300, input.value.length * 5) + "px";
        input.style.width = "100%";
        input.style.padding = "2px";
        input.style.boxSizing = "border-box";

        // Replace span with input
        const th = span.parentNode;
        th.replaceChild(input, span);
        input.focus();

        input.addEventListener("click", (e) => {
          e.stopPropagation(); // Prevent sorting when clicking on input
        });
        input.addEventListener("keyup", (e) => {
          if (e.key === "Escape") {
            th.replaceChild(span, input);
          }
        });
        input.addEventListener("keypress", (e) => {
          if (e.key === "Enter") {
            this.saveColumnName(columnIndex, input.value);
          }
        });
      });
    });

    // Row-action ellipsis: opens an inline jsPanel context menu.
    this.shadowRoot.querySelectorAll(".row-menu").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const index = parseInt(btn.getAttribute("data-index"), 10);
        this._openRowContextMenu(e, index);
      });
    });
  }

  _openRowContextMenu(event, rowIndex) {
    document.querySelectorAll(".jsPanel-rowmenu").forEach((p) => p.close());
    const items = [{ label: "Delete row", run: () => this.deleteRow(rowIndex) }];
    jsPanel.create({
      paneltype: "rowmenu",
      container: "body",
      position: false,
      dragit: false,
      resizeit: false,
      header: false,
      headerControls: "none",
      panelSize: { width: 160, height: "auto" },
      contentOverflow: "visible",
      content: function (cm) {
        // jsPanel's function-style content option discards the return value — mutate cm.content directly.
        const wrap = document.createElement("div");
        wrap.style.cssText = "padding:4px 0;font-family:Arial,sans-serif;";
        for (const item of items) {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = item.label;
          b.style.cssText = "display:block;width:100%;text-align:left;background:none;border:0;padding:6px 12px;cursor:pointer;font:inherit;";
          b.addEventListener("mouseenter", () => (b.style.background = "#f0f0f0"));
          b.addEventListener("mouseleave", () => (b.style.background = "none"));
          b.addEventListener("click", () => {
            item.run();
            cm.close();
          });
          wrap.appendChild(b);
        }
        cm.content.appendChild(wrap);
      },
      callback: (cm) => {
        cm.classList.add("jsPanel-rowmenu");
        cm.style.position = "absolute";
        cm.style.left = event.pageX + "px";
        cm.style.top = event.pageY + "px";
        cm.style.zIndex = "99999";
        cm.addEventListener("mouseleave", () => cm.close());
      },
    });
  }

  _toTitleCase(str) {
    return str.replace(/\w\S*/g, (text) => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase());
  }

  // Save updated column name
  saveColumnName(index, newName) {
    // Update column name
    if (!newName) {
      if (confirm("Are you sure you want to delete this column?")) {
        this.columns.splice(index, 1);
        this.dataArray.forEach((row) => {
          row.splice(index, 1);
        });
        if (this.sortColumn === index) {
          this.sortColumn = -1;
          this.sortDirection = "asc";
        }
        this.saveToStorage();
        this.renderTable();
      }
      return;
    }
    this.columns[index].name = newName.trim() || `Column ${index + 1}`;
    const fieldMeta = newName.split(":");
    if (fieldMeta.length > 1) {
      const col = this.columns[index];
      const prevIsUnique = !!col.isUnique;
      const prevIsNotNull = !!col.isNotNull;
      let nextIsUnique = prevIsUnique;
      let nextIsNotNull = prevIsNotNull;
      if (fieldMeta.length > 5) {
        const flags = this._parseColumnFlags(fieldMeta[5]);
        nextIsUnique = flags.isUnique;
        nextIsNotNull = flags.isNotNull;
      }
      const enableUnique = !prevIsUnique && nextIsUnique;
      const enableNotNull = !prevIsNotNull && nextIsNotNull;
      if (enableUnique || enableNotNull) {
        const violation = this._scanConstraintViolations(index, enableUnique, enableNotNull);
        if (violation) {
          this.showAlert(`Cannot apply constraints to "${col.name}": ${violation}. Clean the data first.`, "error");
          return;
        }
      }
      col.field = fieldMeta[0];
      col.name = fieldMeta[1];
      if (fieldMeta.length > 2) col.type = fieldMeta[2];
      if (fieldMeta.length > 3) col.default = fieldMeta[3];
      if (fieldMeta.length > 4) col.max = parseInt(fieldMeta[4]);
      col.isUnique = nextIsUnique;
      col.isNotNull = nextIsNotNull;
    } else if (newName.startsWith("!")) {
      // If newName is entered as !newName, rename the field
      this.columns[index].field = newName.substring(1).trim().replace(/\s+/g, "_").toLowerCase();
      this.columns[index].name = newName.substring(1).trim();
    } else if (this.columns[index].field.match(/field_\d+/))
      // First time we set a name, rename the actual field (snake case)
      this.columns[index].field = newName.trim().replace(/\s+/g, "_").toLowerCase();

    this.saveToStorage();
    this.renderTable();
  }

  // Delete a row from the data array
  deleteRow(index) {
    this.dataArray.splice(index, 1);
    this.saveToStorage();
    this.renderTable();
  }

  // Save data
  saveToStorage() {
    if (!this.storageKey) return; // Window resize calls this before we are connected to DOM!
    const dataToSave = {
      dataArray: this.dataArray,
      columns: this.columns,
      elementRect: this.elementRect,
      sortColumn: this.sortColumn,
      sortDirection: this.sortDirection,
    };

    try {
      window.store.set(this.storageKey, dataToSave);
    } catch (e) {
      if (e instanceof Error) alert("Data could not be persisted: " + e.message);
    }
  }

  // Load data
  loadFromStorage() {
    try {
      // Load saved data
      const savedData = /** @type {any} */ (window.store.get(this.storageKey));
      if (savedData) {
        const savedState = savedData;
        this.dataArray = savedState.dataArray;
        this.columns = savedState.columns;
        this.elementRect = savedState.elementRect;
        this.sortColumn = savedState.sortColumn || -1;
        this.sortDirection = savedState.sortDirection || "asc";
        this.filters = new Array(this.columns.length).fill("");
      }
    } catch (e) {
      if (e instanceof Error) console.error("Data could not be loaded: " + e.message);
    }
  }

  // Show alert message via jsPanel's hint extension (top-right corner of viewport)
  showAlert(message, type = "success") {
    const themeMap = { success: "success", error: "danger" };
    const tableName = (this.storageKey || "").replace(/\.table\.json$/, "");
    jsPanel.hint.create({
      headerTitle: tableName || "Notice",
      content: `<div style="padding:10px 14px;">${message}</div>`,
      theme: themeMap[type] || "info",
      position: "center-top 0 15 down",
      //position: { my: "right-top", at: "right-top", offsetX: -20, offsetY: 20 },
      panelSize: { width: 320, height: "auto" },
      autoclose: 5000,
    });
  }

  refresh() {
    this.loadFromStorage();
    this.renderTable();
  }

  // Public method to export data as JSON
  exportData() {
    return {
      data: this.dataArray,
      columns: this.columns,
      elementRect: this.elementRect,
    };
  }

  exportDataCSV() {
    // TODO: Escape CSV values which contain commas using double quotes
    const headers = this.columns.map((c) => csvCell(c.field)).join(",");
    const rows = this.dataArray.map(csvRow).join("\n");
    return headers + "\n" + rows;
    function csvRow(row) {
      return row.map(csvCell);
    }
    function csvCell(cell) {
      if (typeof cell === "string" && cell.includes(",")) {
        return `"${cell}"`; // Escape CSV values with double quotes
      }
      return cell;
    }
  }

  // Public method to import data
  importData(jsonData) {
    if (jsonData && jsonData.data && jsonData.columns && jsonData.types) {
      this.dataArray = jsonData.data;
      this.columns = jsonData.columns;
      this.saveToStorage();
      this.renderTable();
      return true;
    }
    return false;
  }
}

class ValidationError extends Error {
  constructor(message = "") {
    super(message);
  }
}
