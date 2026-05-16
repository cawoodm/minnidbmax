"use strict";

import { jsPanel } from "jspanel4/es6module/jspanel.js";
import { DEFAULT_DATE_FORMAT, detectDateType, inferColumnDateFormat, parseFlexibleDate, parseFlexibleDateTime } from "./date-parse";
import { showAlert as _showAlert } from "./show-alert.js";

export class DataEntryTable extends HTMLElement {
  // Instance state (declared so TS sees these fields)
  dataArray: any[] = [];
  columns: any[] = [];
  filters: string[] = [];
  elementRect: any = {};
  sortColumn: number = -1;
  sortDirection: "asc" | "desc" = "asc";
  // Display order: indices into `columns`. Determines render order; entries whose
  // column has hidden=true are filtered out. Defaults to identity [0..N-1] for
  // tables that pre-date this feature.
  displayOrder: number[] = [];
  storageKey: string;
  dataInput: HTMLTextAreaElement;
  tableContainer: HTMLElement;
  // Virtualization state
  _rowHeight: number = 40; // estimate; refined post-render
  _scrollAttached: boolean = false;
  _scrollRaf: number | null = null;
  _resizeRaf: number | null = null;
  _displayData: any[] | null = null;
  _originalIndexMap: Map<any, number> | null = null;

  static VIRTUALIZE_THRESHOLD = 1000;

  constructor() {
    super();

    // Initialize Shadow DOM
    this.attachShadow({ mode: "open" });

    const template = document.getElementById("data-entry-template") as HTMLTemplateElement;
    this.shadowRoot.appendChild(template.content.cloneNode(true));
  }

  // When component is added to the DOM
  connectedCallback() {
    // Get storage key from attribute or use default
    this.storageKey = this.getAttribute("storage-key");
    if (!this.storageKey) throw new Error("Data Table requires a storage-key attribute.");

    // DOM elements
    this.dataInput = this.shadowRoot.querySelector(".input-container textarea") as HTMLTextAreaElement;
    if (!this.dataInput) throw new Error("Data input element not found in template.");
    this.tableContainer = this.shadowRoot.querySelector(".table-container") as HTMLElement;

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
    this.displayOrder = [];
    this.sortColumn = -1;
    this.sortDirection = "asc";
    this.saveToStorage();
    this.renderTable();
  }

  // Render-order traversal of column indices: respects displayOrder and skips hidden columns.
  _visibleColumnIndices(): number[] {
    const order = this.displayOrder && this.displayOrder.length === this.columns.length ? this.displayOrder : this.columns.map((_, i) => i);
    return order.filter((i) => !this.columns[i]?.hidden);
  }

  resizedCallback(w, h) {
    if (h < 40) return; // Minimum height
    this.elementRect.width = w;
    this.elementRect.height = h;
    this.saveToStorage();
    // Re-render visible slice (rAF-throttled) — viewport height changed.
    // Use _renderBodyOnly so the filter row inputs keep focus if the user is typing.
    if (this._displayData && this._displayData.length > DataEntryTable.VIRTUALIZE_THRESHOLD && this.tableContainer) {
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = null;
        this._renderBodyOnly();
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

    // Infer DMY/MDY per date/datetime column from the data rows; persist on the column.
    this.columns.forEach((col, i) => {
      if ((col.type === "date" || col.type === "datetime") && !col.dateFormat) {
        col.dateFormat = inferColumnDateFormat(dataRows, i) || DEFAULT_DATE_FORMAT;
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

    // Date / datetime (datetime is matched first inside detectDateType).
    const dt = detectDateType(value);
    if (dt) return dt;

    // Check if number
    if (!isNaN(parseFloat(value)) && isFinite(value)) {
      return "number";
    }

    // Default to string
    return "string";
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
        const canonical = parseFlexibleDate(value, col.dateFormat || DEFAULT_DATE_FORMAT);
        if (canonical === null) console.warn(`Unparseable date "${value}" stored as null`);
        return canonical;
      }
      case "datetime": {
        const canonical = parseFlexibleDateTime(value, col.dateFormat || DEFAULT_DATE_FORMAT);
        if (canonical === null) console.warn(`Unparseable datetime "${value}" stored as null`);
        return canonical;
      }
      default:
        return value;
    }
  }

  // Establish column structure from first data row
  establishColumns(values, headers?) {
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
        hidden: false,
        width: null,
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
    this.displayOrder = this.columns.map((_, i) => i);
    // Tell listeners (e.g. app.ts) that columns just got auto-detected, so the editor dialog can auto-open.
    this.dispatchEvent(new CustomEvent("columns-established", { bubbles: true, composed: true }));
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

  // Build the filtered + sorted view of dataArray. Called by both full renderTable
  // and the partial _renderBodyOnly path so behavior stays consistent.
  _computeDisplayData() {
    let rows = this.dataArray;
    // AND all non-empty per-column filters; match against displayed text so
    // locale-formatted dates compare against what the user sees.
    const active = (this.filters || []).map((f, i) => ({ i, f: (f || "").toString().trim().toLowerCase() })).filter((x) => x.f);
    if (active.length) {
      rows = rows.filter((row) => active.every(({ i, f }) => this._formatCellText(row[i], this.columns[i].type).toLowerCase().includes(f)));
    }
    // Apply sort. Always copy so callers don't mutate dataArray.
    rows = [...rows];
    if (this.sortColumn !== -1) {
      const sortColumn = this.sortColumn;
      const sortDirection = this.sortDirection;
      const colType = this.columns[sortColumn].type;
      rows.sort((a, b) => {
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
    return rows;
  }

  renderTable() {
    // For large datasets, precompute a row→index map so the per-row originalIndex
    // lookup below is O(1) instead of O(n) with JSON.stringify (was O(n²) overall).
    // Filter/sort preserve row identity, so reference equality is safe here.
    this._originalIndexMap = new Map();
    for (let i = 0; i < this.dataArray.length; i++) this._originalIndexMap.set(this.dataArray[i], i);
    this._displayData = this._computeDisplayData();

    this.tableContainer.innerHTML = this._buildTableHTML();
    this.addTableEventListeners();
    this._ensureScrollHandler();

    // Refine row-height estimate from a real rendered row, then re-render once
    // if the actual height differs meaningfully from the estimate.
    if (this._displayData.length > 0) {
      const sample = this.tableContainer.querySelector("tbody tr.data-row") as HTMLElement;
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
        detail: { count: this._displayData.length, total: this.dataArray.length },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // Partial re-render: rebuild only tbody (data rows + virtual spacers) and re-attach
  // body-level listeners. Used by the live filter so the filter-row inputs keep focus
  // and caret position.
  _renderBodyOnly() {
    this._originalIndexMap = new Map();
    for (let i = 0; i < this.dataArray.length; i++) this._originalIndexMap.set(this.dataArray[i], i);
    this._displayData = this._computeDisplayData();

    const tbody = this.tableContainer.querySelector("tbody");
    if (!tbody) {
      // Table not rendered yet — fall through to a full render.
      this.renderTable();
      return;
    }
    tbody.innerHTML = this._buildBodyHTML();
    this._attachBodyListeners();
    this._refreshFilterDatalists();

    this.dispatchEvent(
      new CustomEvent("row-count-changed", {
        detail: { count: this._displayData.length, total: this.dataArray.length },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _buildTableHTML() {
    const visible = this._visibleColumnIndices();
    const anyWidth = visible.some((i) => this.columns[i].width);
    const tableStyle = anyWidth ? ' style="table-layout:fixed"' : "";
    return `<table${tableStyle}>${this._buildColGroupHTML()}${this._buildHeadHTML()}<tbody>${this._buildBodyHTML()}</tbody></table>`;
  }

  _buildColGroupHTML() {
    const visible = this._visibleColumnIndices();
    let html = "<colgroup><col>"; // first col = row-actions gutter (24px from CSS)
    visible.forEach((index) => {
      const w = this.columns[index].width;
      const style = w ? ` style="width:${w}px"` : "";
      html += `<col data-col-index="${index}"${style}>`;
    });
    html += "</colgroup>";
    return html;
  }

  _buildHeadHTML() {
    const visible = this._visibleColumnIndices();
    const anyFilter = (this.filters || []).some((f) => !!f);
    const activeCls = anyFilter ? " active" : "";
    let html =
      '<thead><tr><th class="row-actions">' +
      `<button type="button" class="filter-toggle${activeCls}" title="Filter/Search Data"><span class="material-icons" style="font-size:18px;vertical-align:middle;">filter_alt</span></button>` +
      "</th>";
    visible.forEach((index) => {
      const col = this.columns[index];
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
      html += `<th data-index="${index}" class="${classNames.join(" ")}"><span class="column-name" data-index="${index}" title="${col.field}:${dataType}">${col.name}</span>${keyIcon}<span class="col-resizer" data-resize-index="${index}"></span></th>`;
    });
    html += "</tr>";
    html +=
      `<tr class="filter-row ${this.filters.find((f) => !!f) ? "" : "hide"}"><td></td>` +
      visible.map((index) => `<td><input class="filter-input" fieldIndex="${index}" value="${this.filters[index] || ""}" placeholder="filter…" list="filter-list-${index}"/></td>`).join(" ") +
      "</tr></thead>";
    html += this._buildFilterDatalists();
    return html;
  }

  // Build one <datalist> per column with the column's unique displayed values
  // for autocomplete in the filter inputs. Each column's suggestions reflect rows
  // that pass every OTHER column's filter — i.e. faceted-search semantics — so
  // narrowing one column shrinks the other columns' dropdowns.
  _buildFilterDatalists() {
    let html = "";
    this._visibleColumnIndices().forEach((index) => {
      html += `<datalist id="filter-list-${index}">${this._buildFilterOptions(index)}</datalist>`;
    });
    return html;
  }

  // Inner <option> HTML for one column's datalist. Filters by every active filter
  // EXCEPT the one in `columnIndex` itself (so a column's own dropdown isn't
  // pre-narrowed by what the user has already typed in that column). Capped to
  // keep the payload bounded on very wide value sets.
  _buildFilterOptions(columnIndex) {
    const MAX = 500;
    const col = this.columns[columnIndex];
    const active = (this.filters || []).map((f, i) => ({ i, f: (f || "").toString().trim().toLowerCase() })).filter((x) => x.f && x.i !== columnIndex);

    const seen = new Set();
    for (let r = 0; r < this.dataArray.length && seen.size < MAX; r++) {
      const row = this.dataArray[r];
      let pass = true;
      for (const { i, f } of active) {
        if (!this._formatCellText(row[i], this.columns[i].type).toLowerCase().includes(f)) {
          pass = false;
          break;
        }
      }
      if (!pass) continue;
      const v = row[columnIndex];
      if (v === null || v === undefined || v === "") continue;
      const text = this._formatCellText(v, col.type);
      if (text === "") continue;
      seen.add(text);
    }
    const opts = [...seen].sort((a, b) => String(a).localeCompare(String(b)));
    return opts.map((v) => `<option value="${this._escapeHTML(v)}"></option>`).join("");
  }

  // Refresh existing <datalist> elements in place (replace their inner options).
  // Replacing innerHTML on the datalist rather than swapping the <datalist> element
  // itself avoids disturbing the input the user is currently typing in.
  _refreshFilterDatalists() {
    this._visibleColumnIndices().forEach((index) => {
      const dl = this.shadowRoot.getElementById(`filter-list-${index}`);
      if (!dl) return;
      dl.innerHTML = this._buildFilterOptions(index);
    });
  }

  _buildBodyHTML() {
    const total = this._displayData.length;
    const useVirtual = total > DataEntryTable.VIRTUALIZE_THRESHOLD;
    const colSpan = this._visibleColumnIndices().length + 1;

    let firstVisible = 0;
    let lastVisible = total;
    if (useVirtual) {
      const scrollTop = this.tableContainer.scrollTop;
      const viewportH = this.tableContainer.clientHeight || 400;
      const buffer = 10;
      firstVisible = Math.max(0, Math.floor(scrollTop / this._rowHeight) - buffer);
      lastVisible = Math.min(total, Math.ceil((scrollTop + viewportH) / this._rowHeight) + buffer);
    }

    let html = "";
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
    return html;
  }

  _buildRowHTML(row, originalIndex) {
    let html = `<tr class="data-row"><td class="row-actions"><button class="row-menu" data-index="${originalIndex}">⋯</button></td>`;
    this._visibleColumnIndices().forEach((cellIndex) => {
      const cell = row[cellIndex];
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
    html += "</tr>";
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
    if (dataType === "datetime" && typeof value === "string") {
      const m = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
      if (m) {
        const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        if (!isNaN(d.getTime())) return d.toLocaleString();
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
    } else if (column.type === "datetime") {
      input.type = "datetime-local";
      input.step = "1";
      if (value !== null) {
        // canonical is "YYYY-MM-DD HH:MM:SS" — convert space to T for the input
        input.value = String(value).replace(" ", "T");
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
        if (column.type === "date" && newValue !== "" && parseFlexibleDate(newValue, column.dateFormat || DEFAULT_DATE_FORMAT) === null) {
          done = false;
          alert("Invalid date");
          input.focus();
          return;
        }
        if (column.type === "datetime" && newValue !== "" && parseFlexibleDateTime(newValue, column.dateFormat || DEFAULT_DATE_FORMAT) === null) {
          done = false;
          alert("Invalid datetime");
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
        // Body-only rebuild keeps the filter row's inputs and their focus/caret intact.
        this._renderBodyOnly();
      });
    });
  }

  // Wire all listeners after a full table rebuild. Body-only re-renders call
  // _attachBodyListeners directly — head listeners stay attached because the
  // thead DOM doesn't change.
  addTableEventListeners() {
    this._attachHeadListeners();
    this._attachBodyListeners();
  }

  _attachHeadListeners() {
    // Filter toggle — small icon button in the row-actions gutter. Shows/hides
    // the filter row and tracks an "active" highlight when any filter is set.
    const filterToggle = this.shadowRoot.querySelector("button.filter-toggle") as HTMLButtonElement | null;
    if (filterToggle) {
      filterToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const filterRow = this.shadowRoot.querySelector(".filter-row");
        if (!filterRow) return;
        filterRow.classList.toggle("hide");
        const visibleNow = !filterRow.classList.contains("hide");
        filterToggle.classList.toggle("active", visibleNow || (this.filters || []).some((f) => !!f));
      });
    }

    // Filter fields — live filter on every keystroke. Calls _renderBodyOnly so
    // the filter-row input itself keeps focus and caret position.
    const filterFields = this.shadowRoot.querySelectorAll("td input.filter-input") as NodeListOf<HTMLInputElement>;
    filterFields.forEach((field) => {
      field.addEventListener("input", () => {
        const fieldIndex = parseInt(field.getAttribute("fieldIndex"));
        this.filters[fieldIndex] = field.value.trim();
        this._renderBodyOnly();
      });
    });

    // Header click for sorting (only data-column headers, not the row-actions gutter)
    const headers = this.shadowRoot.querySelectorAll("th[data-index]") as NodeListOf<HTMLElement>;
    headers.forEach((header) => {
      header.addEventListener("click", (e) => {
        // Suppress click on column name or dblclick event is not fired
        let el = e.target as HTMLElement;
        if (el.classList.contains("column-name")) return;
        // Resize handle clicks must never sort.
        if (el.classList.contains("col-resizer")) return;

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

    // Column resize — drag the .col-resizer to widen/narrow a column. Document-level
    // mousemove/mouseup so dragging past the table edge keeps tracking.
    this.shadowRoot.querySelectorAll(".col-resizer").forEach((handle) => {
      handle.addEventListener("mousedown", (e) => {
        const ev = e as MouseEvent;
        ev.preventDefault();
        ev.stopPropagation();
        const colIdx = parseInt((handle as HTMLElement).getAttribute("data-resize-index"));
        const th = (handle as HTMLElement).closest("th") as HTMLElement;
        const startX = ev.clientX;
        const startWidth = th.offsetWidth;

        // Capture current displayed widths of every visible column so flipping to
        // table-layout:fixed doesn't snap siblings to auto-distributed widths.
        const visible = this._visibleColumnIndices();
        const startWidths = new Map<number, number>();
        visible.forEach((i) => {
          const t = this.shadowRoot.querySelector(`th[data-index="${i}"]`) as HTMLElement | null;
          if (t) startWidths.set(i, t.offsetWidth);
        });

        const liveCol = this.shadowRoot.querySelector(`colgroup col[data-col-index="${colIdx}"]`) as HTMLElement | null;
        const onMove = (mv: MouseEvent) => {
          const newWidth = Math.max(40, startWidth + (mv.clientX - startX));
          if (liveCol) liveCol.style.width = newWidth + "px";
        };
        const onUp = (mu: MouseEvent) => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          const finalWidth = Math.max(40, startWidth + (mu.clientX - startX));
          // Commit widths: dragged column → final; others → their captured starting width
          // (so the first resize doesn't snap them).
          visible.forEach((i) => {
            this.columns[i].width = i === colIdx ? finalWidth : startWidths.get(i) || this.columns[i].width || null;
          });
          this.saveToStorage();
          this.renderTable();
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });

    // Column reorder — HTML5 drag on the column header. Resize handle takes precedence
    // (its mousedown.stopPropagation + the dragstart bail-out below).
    let dragSrcIdx: number | null = null;
    headers.forEach((th) => {
      th.setAttribute("draggable", "true");
      th.addEventListener("dragstart", (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains("col-resizer")) {
          e.preventDefault();
          return;
        }
        dragSrcIdx = parseInt(th.getAttribute("data-index"));
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(dragSrcIdx));
        }
        th.classList.add("col-dragging");
      });
      th.addEventListener("dragover", (e) => {
        if (dragSrcIdx === null) return;
        e.preventDefault();
        const rect = th.getBoundingClientRect();
        const before = (e as DragEvent).clientX < rect.left + rect.width / 2;
        th.classList.toggle("drop-before", before);
        th.classList.toggle("drop-after", !before);
      });
      th.addEventListener("dragleave", () => {
        th.classList.remove("drop-before", "drop-after");
      });
      th.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragSrcIdx === null) return;
        const dstIdx = parseInt(th.getAttribute("data-index"));
        const before = th.classList.contains("drop-before");
        th.classList.remove("drop-before", "drop-after");
        const src = dragSrcIdx;
        dragSrcIdx = null;
        this._reorderDisplayOrder(src, dstIdx, before);
      });
      th.addEventListener("dragend", () => {
        th.classList.remove("col-dragging");
        headers.forEach((h) => h.classList.remove("drop-before", "drop-after"));
        dragSrcIdx = null;
      });
    });
  }

  // Move physical column index src to a new position in displayOrder relative to
  // physical column index dst. Doesn't touch this.columns or this.dataArray —
  // reorder is display-only.
  _reorderDisplayOrder(src: number, dst: number, before: boolean) {
    if (src === dst) return;
    const order = (this.displayOrder && this.displayOrder.length === this.columns.length ? this.displayOrder : this.columns.map((_, i) => i)).slice();
    const srcPos = order.indexOf(src);
    if (srcPos < 0) return;
    order.splice(srcPos, 1);
    const dstPos = order.indexOf(dst);
    if (dstPos < 0) return;
    order.splice(before ? dstPos : dstPos + 1, 0, src);
    this.displayOrder = order;
    this.saveToStorage();
    this.renderTable();
  }

  _attachBodyListeners() {
    // Editable text/number/date cells — click swaps in an <input>
    const editableCells = /** @type {NodeListOf<HTMLElement>} */ this.shadowRoot.querySelectorAll("td.editable");
    editableCells.forEach((td) => {
      td.addEventListener("click", () => {
        if (td.querySelector("input")) return;
        this._activateCell(td);
      });
    });

    // Checkbox fields (and any always-rendered .dataInput, e.g. during active edit)
    const inputFields = this.shadowRoot.querySelectorAll("td input.dataInput") as NodeListOf<HTMLInputElement>;
    inputFields.forEach((field) => {
      field.addEventListener("change", (e) => {
        const el = e.target as HTMLInputElement;
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
          if (column.type === "date" && parseFlexibleDate(value, column.dateFormat || DEFAULT_DATE_FORMAT) === null) return alert("Invalid date");
          if (column.type === "datetime" && parseFlexibleDateTime(value, column.dateFormat || DEFAULT_DATE_FORMAT) === null) return alert("Invalid datetime");
          if (!this.dataArray[dataIndex]) return alert(`Missing row: ${dataIndex}`);
          this.dataArray[dataIndex][fieldIndex] = this.serializeToDB(value, column);
        }
        this.saveToStorage();
        // this.renderTable();
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
    document.querySelectorAll(".jsPanel-rowmenu").forEach((p) => (p as any).close());
    const items = [{ label: "Delete row", run: () => this.deleteRow(rowIndex) }];
    jsPanel.create({
      paneltype: "rowmenu",
      container: "body",
      position: false,
      dragit: false,
      resizeit: false,
      header: false,
      headerControls: "none",
      panelSize: { width: 160 },
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

  // Open the column-definition editor dialog. Lives in document.body (outside Shadow DOM)
  // so the global Tailwind stylesheet applies.
  openColumnEditor() {
    const tableName = (this.storageKey || "").replace(/\.table\.json$/, "") || "table";
    const dlg = document.createElement("dialog");
    dlg.className = "rounded-lg shadow-xl p-0 bg-white backdrop:bg-black/40 max-w-4xl w-[90vw]";
    dlg.innerHTML = `
      <form method="dialog" class="flex flex-col">
        <header class="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 class="text-lg font-semibold text-slate-800">Edit columns — <span class="title-name"></span></h3>
          <button type="button" class="close-x text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </header>
        <div class="px-6 py-4 max-h-[60vh] overflow-auto">
          <p class="text-xs text-slate-500 mb-2">Drag the ⠿ handle to reorder columns. Click the eye icon to hide a column from the table (data stays put).</p>
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-slate-600 border-b border-slate-200">
                <th class="pb-2 w-6"></th>
                <th class="pb-2 pr-2 font-medium text-center w-10"></th>
                <th class="pb-2 pr-2 font-medium">Field</th>
                <th class="pb-2 pr-2 font-medium">Label</th>
                <th class="pb-2 pr-2 font-medium">Type</th>
                <th class="pb-2 pr-2 font-medium">Default</th>
                <th class="pb-2 pr-2 font-medium w-20">Max</th>
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
    dlg.querySelector(".title-name").textContent = tableName;

    const tbody = dlg.querySelector(".rows") as HTMLElement;
    // Iterate displayOrder (all entries — hidden included so user can toggle them back on).
    const order = this.displayOrder && this.displayOrder.length === this.columns.length ? this.displayOrder : this.columns.map((_, i) => i);
    order.forEach((idx) => tbody.appendChild(this._buildColumnEditorRow(this.columns[idx], idx)));

    dlg.querySelector(".add-row").addEventListener("click", () => {
      tbody.appendChild(this._buildColumnEditorRow({ field: "", name: "", type: "string", default: "", max: 0, isUnique: false, isNotNull: false, hidden: false }, null));
    });

    // Delete row + toggle visibility (event delegation)
    tbody.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const delBtn = target.closest(".del");
      if (delBtn) {
        delBtn.closest("tr").remove();
        return;
      }
      const eyeBtn = target.closest(".is-visible") as HTMLElement | null;
      if (eyeBtn) {
        const tr = eyeBtn.closest("tr") as HTMLElement;
        const nowHidden = tr.dataset.hidden !== "true"; // toggle
        tr.dataset.hidden = nowHidden ? "true" : "false";
        const icon = eyeBtn.querySelector(".material-icons") as HTMLElement;
        icon.textContent = nowHidden ? "visibility_off" : "visibility";
        eyeBtn.setAttribute("title", nowHidden ? "Hidden — click to show in table" : "Visible — click to hide from table");
      }
    });

    // Drag-to-reorder rows via HTML5 native drag. The drag handle's mousedown sets
    // draggable on the parent <tr>; the <tr> handles the drag lifecycle.
    let dragSrc: HTMLElement | null = null;
    tbody.addEventListener("mousedown", (e) => {
      const handle = (e.target as HTMLElement).closest(".drag-handle") as HTMLElement | null;
      if (!handle) return;
      const tr = handle.closest("tr") as HTMLElement;
      if (tr) tr.setAttribute("draggable", "true");
    });
    tbody.addEventListener("dragstart", (e) => {
      const tr = (e.target as HTMLElement).closest("tr") as HTMLElement | null;
      if (!tr) return;
      dragSrc = tr;
      tr.style.opacity = "0.4";
      // Firefox needs setData to start a drag.
      e.dataTransfer?.setData("text/plain", "");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    tbody.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!dragSrc) return;
      const tr = (e.target as HTMLElement).closest("tr") as HTMLElement | null;
      if (!tr || tr === dragSrc || tr.parentElement !== tbody) return;
      const rect = tr.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      tbody.insertBefore(dragSrc, before ? tr : tr.nextSibling);
    });
    const endDrag = () => {
      if (dragSrc) dragSrc.style.opacity = "";
      dragSrc = null;
      tbody.querySelectorAll("tr[draggable]").forEach((tr) => tr.removeAttribute("draggable"));
    };
    tbody.addEventListener("dragend", endDrag);
    tbody.addEventListener("drop", (e) => {
      e.preventDefault();
      endDrag();
    });

    const closeDialog = () => dlg.close();
    dlg.querySelector(".cancel").addEventListener("click", closeDialog);
    dlg.querySelector(".close-x").addEventListener("click", closeDialog);

    dlg.querySelector(".save").addEventListener("click", () => this._applyColumnEditor(dlg, tbody));

    // Auto-cleanup so successive opens don't accumulate detached <dialog>s.
    dlg.addEventListener("close", () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  _buildColumnEditorRow(col, originalIndex) {
    const tr = document.createElement("tr");
    tr.className = "border-b border-slate-100 last:border-b-0 align-middle";
    if (originalIndex !== null && originalIndex !== undefined) tr.dataset.originalIndex = String(originalIndex);
    const hidden = !!col.hidden;
    tr.dataset.hidden = hidden ? "true" : "false";
    const inputCls = "w-full rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400";
    const eyeIcon = hidden ? "visibility_off" : "visibility";
    const eyeTitle = hidden ? "Hidden — click to show in table" : "Visible — click to hide from table";
    tr.innerHTML = `
      <td class="py-2 text-center text-slate-400 select-none drag-handle cursor-grab" title="Drag to reorder">⠿</td>
      <td class="py-2 pr-2 text-center">
        <button type="button" class="is-visible align-middle cursor-pointer" title="${eyeTitle}">
          <span class="material-icons text-lg leading-none">${eyeIcon}</span>
        </button>
      </td>
      <td class="py-2 pr-2"><input class="field ${inputCls}" value="${this._escapeHTML(col.field || "")}"></td>
      <td class="py-2 pr-2"><input class="name ${inputCls}" value="${this._escapeHTML(col.name || "")}"></td>
      <td class="py-2 pr-2">
        <select class="type rounded border border-slate-300 px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="date">date</option>
          <option value="datetime">datetime</option>
          <option value="boolean">boolean</option>
        </select>
      </td>
      <td class="py-2 pr-2"><input class="default ${inputCls}" value="${this._escapeHTML(col.default == null ? "" : String(col.default))}"></td>
      <td class="py-2 pr-2"><input type="number" min="0" class="max ${inputCls}" value="${col.max || 0}"></td>
      <td class="py-2 pr-2 text-center"><input type="checkbox" class="is-unique accent-blue-600" ${col.isUnique ? "checked" : ""}></td>
      <td class="py-2 pr-2 text-center"><input type="checkbox" class="is-notnull accent-blue-600" ${col.isNotNull ? "checked" : ""}></td>
      <td class="py-2 text-right"><button type="button" class="del text-slate-400 hover:text-red-500 text-xl leading-none" title="Delete column">×</button></td>
    `;
    (tr.querySelector(".type") as HTMLSelectElement).value = col.type || "string";
    return tr;
  }

  // Validate the working state, build new column + data arrays, run constraint checks,
  // and apply on success. Flags offending rows red and aborts on the first failure.
  _applyColumnEditor(dlg, tbody) {
    const flagRow = (tr) => tr.classList.add("bg-red-50", "ring-1", "ring-red-300");
    tbody.querySelectorAll("tr").forEach((tr) => tr.classList.remove("bg-red-50", "ring-1", "ring-red-300"));

    const rows = Array.from(tbody.querySelectorAll("tr")) as HTMLElement[];
    if (rows.length === 0) {
      this.showAlert("Table must have at least one column", "error");
      return;
    }

    // Working state in DIALOG order (= new display order).
    const working = rows.map((tr) => ({
      tr,
      _originalIndex: tr.dataset.originalIndex != null ? parseInt(tr.dataset.originalIndex, 10) : null,
      field: (tr.querySelector(".field") as HTMLInputElement).value.trim(),
      name: (tr.querySelector(".name") as HTMLInputElement).value.trim(),
      type: (tr.querySelector(".type") as HTMLSelectElement).value,
      default: (tr.querySelector(".default") as HTMLInputElement).value,
      max: parseInt((tr.querySelector(".max") as HTMLInputElement).value) || 0,
      isUnique: (tr.querySelector(".is-unique") as HTMLInputElement).checked,
      isNotNull: (tr.querySelector(".is-notnull") as HTMLInputElement).checked,
      hidden: tr.dataset.hidden === "true",
    }));

    // 1. Validate field names
    const fieldSet = new Set();
    for (const w of working) {
      if (!w.field) {
        flagRow(w.tr);
        this.showAlert("Field name cannot be empty", "error");
        return;
      }
      if (!/^[a-zA-Z_][\w]*$/.test(w.field)) {
        flagRow(w.tr);
        this.showAlert(`Invalid field name: "${w.field}" (use letters, digits, underscore; must start with a letter or underscore)`, "error");
        return;
      }
      if (fieldSet.has(w.field)) {
        flagRow(w.tr);
        this.showAlert(`Duplicate field name: "${w.field}"`, "error");
        return;
      }
      fieldSet.add(w.field);
    }

    // 2. Physical column array stays sorted by original order — reorder is DISPLAY only.
    //    Surviving original columns keep their slot in `columns` and `dataArray` (with shift
    //    on deletion). Newly-added working rows append at the end of the physical array.
    const survivingOld = new Set<number>();
    working.forEach((w) => {
      if (w._originalIndex !== null) survivingOld.add(w._originalIndex);
    });

    // Map old physical index → new physical index (accounts for deletions shifting everything down).
    const oldToNewIdx = new Map<number, number>();
    let nextNewIdx = 0;
    this.columns.forEach((_, oldIdx) => {
      if (survivingOld.has(oldIdx)) {
        oldToNewIdx.set(oldIdx, nextNewIdx++);
      }
    });
    const survivorCount = nextNewIdx;

    // Build newColumns. First fill surviving slots in original order with updated metadata
    // from the matching working row. Then append new columns (working rows with no original).
    const newColumns: any[] = new Array(survivorCount);
    const wIdxToNewIdx: number[] = new Array(working.length);
    working.forEach((w, wIdx) => {
      if (w._originalIndex !== null) {
        const newIdx = oldToNewIdx.get(w._originalIndex)!;
        wIdxToNewIdx[wIdx] = newIdx;
        const orig = this.columns[w._originalIndex];
        newColumns[newIdx] = {
          field: w.field,
          name: w.name || w.field,
          type: w.type,
          default: w.default === "" ? null : w.default,
          max: w.max,
          dateFormat: orig?.dateFormat ?? null,
          isUnique: w.isUnique,
          isNotNull: w.isNotNull,
          hidden: w.hidden,
          width: orig?.width ?? null,
        };
      }
    });
    working.forEach((w, wIdx) => {
      if (w._originalIndex === null) {
        const newIdx = newColumns.length;
        wIdxToNewIdx[wIdx] = newIdx;
        newColumns.push({
          field: w.field,
          name: w.name || w.field,
          type: w.type,
          default: w.default === "" ? null : w.default,
          max: w.max,
          dateFormat: null,
          isUnique: w.isUnique,
          isNotNull: w.isNotNull,
          hidden: w.hidden,
          width: null,
        });
      }
    });

    // Build newDataArray: each row laid out in newColumns physical order.
    const newDataArray = this.dataArray.map((oldRow) => {
      const newRow = new Array(newColumns.length);
      // Copy surviving columns from oldRow (re-serialize on type change).
      oldToNewIdx.forEach((newIdx, oldIdx) => {
        const newCol = newColumns[newIdx];
        const oldVal = oldRow[oldIdx];
        const origType = this.columns[oldIdx].type;
        if (origType !== newCol.type && oldVal !== null && oldVal !== undefined) {
          newRow[newIdx] = this.serializeToDB(String(oldVal), newCol);
        } else {
          newRow[newIdx] = oldVal === undefined ? null : oldVal;
        }
      });
      // Seed newly-appended columns with their default.
      for (let i = survivorCount; i < newColumns.length; i++) {
        const c = newColumns[i];
        newRow[i] = c.default === null || c.default === undefined ? null : this.serializeToDB(String(c.default), c);
      }
      return newRow;
    });

    // 3. Constraint validation on the new state.
    for (let colIdx = 0; colIdx < newColumns.length; colIdx++) {
      const col = newColumns[colIdx];
      if (!col.isUnique && !col.isNotNull) continue;
      let emptyCount = 0;
      let dupCount = 0;
      const seen = new Map();
      for (let i = 0; i < newDataArray.length; i++) {
        const v = newDataArray[i][colIdx];
        const isEmpty = v === null || v === undefined || v === "";
        if (col.isNotNull && isEmpty) emptyCount++;
        if (col.isUnique && !isEmpty) {
          const c = (seen.get(v) || 0) + 1;
          seen.set(v, c);
          if (c === 2) dupCount++;
        }
      }
      if (emptyCount || dupCount) {
        const parts = [];
        if (emptyCount) parts.push(`${emptyCount} empty value${emptyCount > 1 ? "s" : ""}`);
        if (dupCount) parts.push(`${dupCount} duplicate value${dupCount > 1 ? "s" : ""}`);
        // Find the dialog row whose new physical index is `colIdx` so we can flag it.
        const wIdx = wIdxToNewIdx.indexOf(colIdx);
        if (wIdx >= 0) flagRow(working[wIdx].tr);
        this.showAlert(`Cannot apply constraints to "${col.name}": ${parts.join(", ")}. Clean the data first.`, "error");
        return;
      }
    }

    // 4. displayOrder: dialog (working) row order, mapped to new physical indices.
    const newDisplayOrder = working.map((_, wIdx) => wIdxToNewIdx[wIdx]);

    // 5. Remap sortColumn (it stored an old physical index).
    let newSortColumn = -1;
    if (this.sortColumn !== -1 && oldToNewIdx.has(this.sortColumn)) {
      newSortColumn = oldToNewIdx.get(this.sortColumn)!;
    }

    // 6. Apply
    this.columns = newColumns;
    this.dataArray = newDataArray;
    this.displayOrder = newDisplayOrder;
    this.sortColumn = newSortColumn;
    if (newSortColumn === -1) this.sortDirection = "asc";
    this.filters = new Array(newColumns.length).fill("");
    this.saveToStorage();
    this.renderTable();
    dlg.close();
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
      displayOrder: this.displayOrder,
    };

    try {
      window.store.set(this.storageKey, dataToSave);
    } catch (e) {
      if (e instanceof Error) alert("Data could not be persisted: " + e.message);
    }
  }

  delete() {
    window.store.delete(this.storageKey);
  }

  // Load data
  loadFromStorage() {
    try {
      // Load saved data
      const savedData = window.store.get(this.storageKey) as any;
      if (savedData) {
        const savedState = savedData;
        this.dataArray = savedState.dataArray;
        this.columns = savedState.columns;
        this.elementRect = savedState.elementRect;
        this.sortColumn = savedState.sortColumn || -1;
        this.sortDirection = savedState.sortDirection || "asc";
        this.filters = new Array(this.columns.length).fill("");
        // Backward compat: older stored tables don't have displayOrder; default to identity.
        const saved = savedState.displayOrder;
        this.displayOrder = Array.isArray(saved) && saved.length === this.columns.length ? saved.slice() : this.columns.map((_, i) => i);
      }
    } catch (e) {
      if (e instanceof Error) console.error("Data could not be loaded: " + e.message);
    }
  }

  // Per-table wrapper around the shared toast primitive (src/show-alert.ts).
  // Adds the table name as the toast header so users can see which table fired the notification.
  showAlert(message: string, type: "success" | "error" | "info" = "success") {
    const tableName = (this.storageKey || "").replace(/\.table\.json$/, "");
    _showAlert(message, type, tableName || "Notice");
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
