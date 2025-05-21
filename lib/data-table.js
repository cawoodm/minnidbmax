"use strict";

// @ts-ignore: Object is possibly 'null'.

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
  }

  // When component is added to the DOM
  connectedCallback() {
    // Get storage key from attribute or use default
    this.storageKey = this.getAttribute("storage-key");
    if (!this.storageKey) throw new Error("Data Table requires a storage-key attribute.");

    // DOM elements
    this.dataInput = /** @type {!HTMLInputElement} */ (this.shadowRoot.querySelector(".input-container textarea"));
    if (!this.dataInput) throw new Error("Data input element not found in template.");
    this.tableContainer = this.shadowRoot.querySelector(".table-container");
    this.alertBox = this.shadowRoot.querySelector(".alert");

    //this.titleElement = this.shadowRoot.querySelector(".title");
    //if (!this.titleElement) throw new Error("Title element not found in template.");
    //this.titleElement.textContent = toTitleCase(this.getAttribute("title"));

    // Bind methods
    this.handleKeyPress = this.handleKeyPress.bind(this);

    // Set up event listeners
    this.dataInput.addEventListener("keypress", this.handleKeyPress);
    this.dataInput.addEventListener("drop", this.handleDataInputDrop.bind(this));

    // Initialize data
    this.loadFromStorage();

    this.renderTable();

    this.saveToStorage();
  }

  handleDataInputDrop(e) {
    e.preventDefault();
    if (!e.dataTransfer.files.length) return; // No files dropped
    var file = e.dataTransfer.files[0];
    var reader = new FileReader();
    const dataInput = this.dataInput;
    const processInput = this.processInput.bind(this);
    reader.onload = function (e) {
      dataInput.value = e.target.result;
      processInput();
    };
    reader.readAsText(file, "UTF-8");
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
    let lineCount = 0;
    let errorLines = 0;
    for (const line of inputLines) {
      lineCount++;
      const values = this.parseCSV(line.trim(), seperator);
      if (values.length === 0) continue; // Skip empty lines
      // If this is the first line of the first data entry
      if (this.dataArray.length === 0 && lineCount === 1 && typeof this.columns[0] === "undefined") {
        let fieldNames = null;
        // Is this a header line?
        if (values.every((cell) => this.detectType(cell) === "string")) {
          // Extract field names from the first row
          fieldNames = values;
          let line = inputLines.length > 1 ? this.parseCSV(inputLines[1], seperator) : values;
          this.establishColumns(line, fieldNames);
          continue; // Skip adding the header
        }
        // No header, establish columns from the first data row
        this.establishColumns(values);
      }
      try {
        this.processLine(values);
      } catch (e) {
        if (!(e instanceof ValidationError)) throw e;
        //if (e instanceof ReferenceError) throw e;
        if (errorLines == 0 && inputLines.length > 5) {
          alert(`Line ${lineCount} failed: ${e.message}`);
          if (confirm("Do you want to stop processing? Pressing no/cancel now will skip all invalid rows silently!")) return; // Stop processing further lines on error
          errorLines++;
        } else if (errorLines > 0) {
          errorLines++;
          console.warn(`Line ${lineCount} failed: ${e.message}`);
        } else {
          this.showAlert(`Line ${lineCount} failed: ${e.message}`, "error");
          return; // Stop processing further lines on error
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

    // Check if date (YYYY-MM-DD format)
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return "date";
      }
    }

    // Check if number
    if (!isNaN(parseFloat(value)) && isFinite(value)) {
      return "number";
    }

    // Default to string
    return "string";
  }

  // Format value based on detected type
  serializeToDB(value, type) {
    if (value === null) return null; // (non-strict)
    if (typeof value === "undefined") return null; // (non-strict)
    switch (type) {
      case "boolean":
        return value.toLowerCase() === "true";
      case "number":
        return parseFloat(value);
      case "date":
        return new Date(value).toISOString().split("T")[0];
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
      };
      if (headers) {
        const fieldMeta = (headers[index] + "::::").split(":");
        if (fieldMeta[0]) col.field = fieldMeta[0];
        if (fieldMeta[1]) col.name = fieldMeta[1];
        if (fieldMeta[2]) col.type = fieldMeta[2];
        if (fieldMeta[3]) col.default = fieldMeta[3];
        if (fieldMeta[4]) col.max = parseInt(fieldMeta[4]);
      }
      return col;
    });
    this.filters = new Array(this.columns.length).fill("");
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
      // Special case: anything can be accepted into string columns
      if (this.columns[i].type === "string") continue;
      if (detectedType !== this.columns[i].type) throw new ValidationError(`Column ${i} "${values[i]}" of wrong type (${detectedType}): should be ${this.columns[i].type}!`);
    }
  }

  // Add data row to array
  addDataRow(values) {
    // Format values according to their types
    const formattedValues = values.map((val, index) => this.serializeToDB(val, this.columns[index].type));
    this.dataArray.push(formattedValues);
    return true;
  }

  renderTable(displayData) {
    displayData = displayData || [...this.dataArray];

    let tableHTML = "<table>";

    // Header row with column names
    tableHTML += "<thead><tr>";
    this.columns.forEach((col, index) => {
      let name = col.name;
      const dataType = col.type;
      let classNames = [dataType];
      if (this.sortColumn === index) classNames.push(this.sortDirection);
      tableHTML += `<th data-index="${index}" class="${classNames.join(" ")}"><span class="column-name" data-index="${index}" title="${col.field}:${dataType}">${name}</span></th>`;
    });
    tableHTML += "<th class=actions>+</th></tr></thead>";

    // Table body
    tableHTML += "<tbody>";

    // Sort data if needed
    if (this.sortColumn !== -1) {
      displayData.sort((a, b) => {
        const valueA = a[this.sortColumn];
        const valueB = b[this.sortColumn];

        // Handle different types
        if (this.columns[this.sortColumn].type === "date") {
          const dateA = new Date(valueA);
          const dateB = new Date(valueB);
          return this.sortDirection === "asc" ? dateA.getTime() - dateB.getTime() : dateB.getTime() - dateA.getTime();
        } else if (this.columns[this.sortColumn].type === "number") {
          return this.sortDirection === "asc" ? valueA - valueB : valueB - valueA;
        } else {
          // String comparison
          const strA = String(valueA).toLowerCase();
          const strB = String(valueB).toLowerCase();
          if (this.sortDirection === "asc") {
            return strA.localeCompare(strB);
          } else {
            return strB.localeCompare(strA);
          }
        }
      });
    }

    tableHTML +=
      `<tr class="filter-row ${this.filters.find((f) => !!f) ? "" : "hide"}">` +
      this.columns.map((col, index) => `<td><input class="filter-input" fieldIndex="${index}" value="${this.filters[index]}"/></td>`).join(" ") +
      "<td></td></tr>"; // Display rows
    displayData.forEach((row, rowIndex) => {
      const originalIndex = this.dataArray.findIndex((r) => JSON.stringify(r) === JSON.stringify(row));
      tableHTML += "<tr>";
      row.forEach((cell, cellIndex) => {
        let displayValue = cell;
        const column = this.columns[cellIndex];
        const dataType = column.type;
        let classNames = [dataType];
        if (cell === null) {
          displayValue = ""; // (non-strict)
          classNames.push("null");
        }
        // Format display value based on type
        if (dataType === "boolean") {
          displayValue = `<input type='checkbox' ${cell && "checked"} dataIndex="${originalIndex}" fieldIndex="${cellIndex}">`;
        } else if (dataType === "date") {
          try {
            displayValue = new Date(cell).toISOString().split("T")[0];
          } catch (e) {
            // displayValue = new Date(cell).toLocaleDateString();
            console.warn("Invalid date", cell, "in row", rowIndex + 1, "column", cellIndex + 1, row.join(", "));
          }
          displayValue = `<input type="date" class="dataInput" dataIndex="${originalIndex}" fieldIndex="${cellIndex}" value="${displayValue}">`;
        } else if (dataType === "string" && displayValue.match(/^#[0-9A-F]{6}$/i)) {
          displayValue = `<div style="width: 20px; height: 20px; border:1px solid silver; background-color: ${cell};"></div>`;
        } else {
          displayValue = `<input class="dataInput" dataIndex="${originalIndex}" fieldIndex="${cellIndex}" value="${displayValue}">`;
        }

        tableHTML += `<td class="${classNames.join(" ")}">${displayValue}</td>`;
      });
      tableHTML += `<td class=actions><button class="delete-btn" data-index="${originalIndex}">&nbsp;</button></td>`;
      tableHTML += "</tr>";
    });

    if (displayData.length === 0) {
      tableHTML += '<tr><td colspan="50" id="emptyDrag">Enter your first data row to establish columns and data types.</td></tr>';
    }

    tableHTML += "</tbody></table>";

    this.tableContainer.innerHTML = tableHTML;

    // Add event listeners for sorting and deletion
    this.addTableEventListeners();
  }

  // Add event listeners to table elements
  addTableEventListeners() {
    // Filter fields
    //this.shadowRoot.querySelector(".container").addEventListener("drop", this.handleDataInputDrop.bind(this));
    const filterFields = this.shadowRoot.querySelectorAll("td input.filter-input");
    filterFields.forEach((field) => {
      field.addEventListener("keypress", (e) => {
        // Since we render the whole table we can't filter until enter is pressed
        if (e.key !== "Enter") return;
        e.preventDefault();
        const fieldIndex = parseInt(field.getAttribute("fieldIndex"));
        const filterValue = field.value.toLowerCase();
        this.filters[fieldIndex] = filterValue;

        // Filter the data array based on the input value
        const filteredData = this.dataArray.filter((row) => {
          return String(row[fieldIndex]).toLowerCase().includes(filterValue);
        });

        // Update the table with filtered data
        this.renderTable(filteredData);
      });
    });

    // Checkbox fields
    const inputFields = this.shadowRoot.querySelectorAll("td input");
    inputFields.forEach((field) => {
      field.addEventListener("change", (e) => {
        const el = e.target;
        const fieldIndex = parseInt(field.getAttribute("fieldIndex"));
        const dataIndex = parseInt(field.getAttribute("dataIndex"));
        const column = this.columns[fieldIndex];
        if (el.type === "checkbox") {
          this.dataArray[dataIndex][fieldIndex] = field.checked;
        } else {
          const value = field.value;
          if (column.type === "number" && isNaN(value)) return alert("Invalid number");
          if (column.type === "date" && !new Date(value)) return alert("Invalid date");
          this.dataArray[dataIndex][fieldIndex] = this.serializeToDB(value, column.type);
        }
        this.saveToStorage();
        this.renderTable();
      });
    });

    // Header click for sorting
    const headers = this.shadowRoot.querySelectorAll("th:not(:last-child)");
    headers.forEach((header) => {
      header.addEventListener("click", (e) => {
        // Suppress click on column name or dblclick event is not fired
        if (e.target.classList.contains("column-name")) return;

        const columnIndex = parseInt(header.getAttribute("data-index"));

        // Toggle sort direction if clicking the same column
        if (this.sortColumn === columnIndex) {
          this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
        } else {
          this.sortColumn = columnIndex;
          this.sortDirection = "asc";
        }
        this.saveToStorage();
        this.renderTable();
      });
    });
    this.shadowRoot.querySelector("th:last-child").addEventListener("click", (e) => {
      let f = prompt("Enter new column (field:name:type:default)");
      if (!f) return;
      let fieldMeta = (f + ":::").split(":");
      let field = fieldMeta[0];
      let name = fieldMeta[1] || this._toTitleCase(field);
      let defaultValue = fieldMeta[3];
      let type = fieldMeta[2] || this.detectType(defaultValue);
      defaultValue = this.serializeToDB(defaultValue, type);
      this.columns.push({ field, name, type });
      this.dataArray.forEach((row) => {
        row.push(defaultValue);
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
        input.placeholder = "Rename: field:name:type:default:maxlength";
        input.title = input.placeholder;
        input.value = column.field + ":" + column.name + ":" + column.type + ":" + (column.default || "") + ":" + (column.max || 0);
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

    // Delete buttons
    const deleteButtons = this.shadowRoot.querySelectorAll(".delete-btn");
    deleteButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const index = parseInt(button.getAttribute("data-index"));
        this.deleteRow(index);
      });
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
        this.saveToStorage();
        this.renderTable();
      }
      return;
    }
    this.columns[index].name = newName.trim() || `Column ${index + 1}`;
    const fieldMeta = newName.split(":");
    if (fieldMeta.length > 1) {
      //const fieldMeta = (newName+'::::').split(":");
      // If newName is entered as field:name, rename the field
      this.columns[index].field = fieldMeta[0];
      this.columns[index].name = fieldMeta[1];
      if (fieldMeta.length > 2) this.columns[index].type = fieldMeta[2];
      if (fieldMeta.length > 3) this.columns[index].default = fieldMeta[3];
      if (fieldMeta.length > 4) this.columns[index].max = parseInt(fieldMeta[4]);
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
    } catch (error) {
      alert("Data could not be persisted: " + error.message);
    }
  }

  // Load data
  loadFromStorage() {
    try {
      // Load saved data
      const savedData = window.store.get(this.storageKey);
      if (savedData) {
        const savedState = savedData;
        this.dataArray = savedState.dataArray;
        this.columns = savedState.columns;
        this.elementRect = savedState.elementRect;
        this.sortColumn = savedState.sortColumn || -1;
        this.sortDirection = savedState.sortDirection || "asc";
        this.filters = new Array(this.columns.length).fill("");
      }
    } catch (error) {
      console.error("Data could not be loaded: " + error.message);
    }
  }

  // Show alert message
  showAlert(message, type = "success") {
    this.alertBox.className = "alert " + type;
    this.alertBox.textContent = message;
    this.alertBox.style.display = "block";

    // Hide the alert after 5 seconds
    setTimeout(() => {
      this.alertBox.style.display = "none";
    }, 5000);
  }

  refresh() {
    this.loadFromStorage();
    this.renderTable();
  }

  // Clear all data
  clearData() {
    this.dataArray = [];
    this.columns = [];
    this.saveToStorage();
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
  constructor(message = "", ...args) {
    super(message, ...args);
    //this.message = message + " has not yet been implemented.";
  }
}
