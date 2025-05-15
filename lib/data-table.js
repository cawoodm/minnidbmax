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
    if (this.storageKey == "contacts") debugger;

    // DOM elements
    this.dataInput = /** @type {!HTMLInputElement} */ (this.shadowRoot.querySelector(".data-input"));
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

    // Initialize data
    this.loadFromStorage();

    if (this.dataArray.length > 0) {
      this.renderTable();
    }

    this.saveToStorage();
  }

  createdCallback(options) {
    return; // Doesn't work
    console.log(this.storageKey, "w=", options.width);
    options.width = this.elementRect.width;
    console.log(this.storageKey, "w=", options.width);
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
    let lineCount = 0;
    for (const line of inputLines) {
      lineCount++;
      if (!this.processLine(line.trim())) {
        this.showAlert(`Line ${lineCount} failed to add due to type mismatch.`, "error");
        return; // Stop processing further lines on error
      }
    }
    // Clear the input field only on successful addition
    this.dataInput.value = "";
    this.showAlert("Data added successfully!");
    this.renderTable();
  }

  processLine(inputValue) {
    const parsedValues = this.parseCSV(inputValue);
    if (parsedValues.length === 0) return false;

    // If this is the first entry, establish column structure
    if (this.dataArray.length === 0) this.establishColumns(parsedValues);

    // Validate the types match existing columns
    if (this.validateTypes(parsedValues)) {
      this.addDataRow(parsedValues);
      return true;
    } else {
      return false;
    }
  }

  // Parse CSV-like input
  parseCSV(text) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
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
  establishColumns(values) {
    this.columns = values.map((value, index) => ({
      field: `field_${index + 1}`,
      name: `Column ${index + 1}`,
      type: this.detectType(value),
    }));
    this.filters = new Array(this.columns.length).fill("");
  }

  // Validate types match established columns
  validateTypes(values) {
    // Check if the number of values matches column count
    if (values.length !== this.columns.length) {
      return false;
    }

    // Check each value against the established type
    for (let i = 0; i < values.length; i++) {
      const detectedType = this.detectType(values[i]);

      // Special case: anything can be accepted into string columns
      if (this.columns[i].type === "string") continue;

      if (detectedType !== this.columns[i].type) {
        return false;
      }
    }

    return true;
  }

  // Add data row to array
  addDataRow(values) {
    // Format values according to their types
    const formattedValues = values.map((val, index) => this.serializeToDB(val, this.columns[index].type));
    this.dataArray.push(formattedValues);
    this.saveToStorage();
  }

  renderTable(displayData) {
    displayData = displayData || [...this.dataArray];
    if (displayData.length === 0) {
      this.tableContainer.innerHTML = '<div class="empty-message">Enter your first data row to establish columns and data types.</div>';
      return;
    }

    let tableHTML = "<table>";

    // Header row with column names
    tableHTML += "<thead><tr>";
    this.columns.forEach((col, index) => {
      let name = col.name;
      const dataType = col.type;
      let classNames = [dataType];
      if (this.sortColumn === index) classNames.push(this.sortDirection);
      tableHTML += `<th data-index="${index}" class="${classNames.join(" ")}"><span class="column-name" data-index="${index}" title="${dataType}">${name}</span></th>`;
    });
    tableHTML += "<th class=actions>&nbsp;</th></tr></thead>";

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
        // Format display value based on type
        if (dataType === "boolean") {
          displayValue = `<input type='checkbox' ${cell && "checked"} dataIndex="${originalIndex}" fieldIndex="${cellIndex}">`;
        } else if (dataType === "date") {
          displayValue = new Date(cell).toLocaleDateString("de-CH");
        } else if (typeof displayValue === "string" && displayValue.match(/^#[0-9A-F]{6}$/i)) {
          displayValue = `<div style="width: 20px; height: 20px; border:1px solid silver; background-color: ${cell};"></div>`;
        }

        tableHTML += `<td class="${classNames.join(" ")}">${displayValue}</td>`;
      });
      tableHTML += `<td class=actions><button class="delete-btn" data-index="${originalIndex}">&nbsp;</button></td>`;
      tableHTML += "</tr>";
    });

    tableHTML += "</tbody></table>";

    this.tableContainer.innerHTML = tableHTML;

    // Add event listeners for sorting and deletion
    this.addTableEventListeners();
  }

  // Add event listeners to table elements
  addTableEventListeners() {
    // Filter fields
    const filterFields = this.shadowRoot.querySelectorAll("td input.filter-input");
    filterFields.forEach((field) => {
      field.addEventListener("keypress", (e) => {
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
    const checkboxFields = this.shadowRoot.querySelectorAll("td input[type=checkbox]");
    checkboxFields.forEach((field) => {
      field.addEventListener("change", (e) => {
        const fieldIndex = parseInt(field.getAttribute("fieldIndex"));
        const dataIndex = parseInt(field.getAttribute("dataIndex"));
        this.dataArray[dataIndex][fieldIndex] = field.checked;
        this.saveToStorage();
        this.renderTable();
      });
    });

    // Header click for sorting
    const headers = this.shadowRoot.querySelectorAll("th:not(:last-child)");
    headers.forEach((header) => {
      header.addEventListener("click", (e) => {
        // If clicked on the column name span, don't sort
        if (e.target.classList.contains("column-name")) {
          return;
        }

        const columnIndex = parseInt(header.getAttribute("data-index"));

        // Toggle sort direction if clicking the same column
        if (this.sortColumn === columnIndex) {
          this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
        } else {
          this.sortColumn = columnIndex;
          this.sortDirection = "asc";
        }

        this.renderTable();
      });
    });

    // Column name editing
    const columnNameSpans = this.shadowRoot.querySelectorAll(".column-name");
    columnNameSpans.forEach((span) => {
      span.addEventListener("dblclick", (e) => {
        e.stopPropagation(); // Prevent sorting when editing column name
        const columnIndex = parseInt(span.getAttribute("data-index"));
        const currentName = this.columns[columnIndex].name;

        // Create an editable input
        const input = document.createElement("input");
        input.type = "text";
        input.value = currentName;
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

  // Save updated column name
  saveColumnName(index, newName) {
    // Update column name
    this.columns[index].name = newName.trim() || `Column ${index + 1}`;
    if (this.columns[index].field.match(/field_\d+/)) {
      this.columns[index].field = newName.trim().replace(/\s+/g, "_").toLowerCase();
    }
    this.saveToStorage();
    this.renderTable();
  }

  // Delete a row from the data array
  deleteRow(index) {
    this.dataArray.splice(index, 1);
    this.saveToStorage();
    this.renderTable();
  }

  // Save data to localStorage
  saveToStorage() {
    const dataToSave = {
      dataArray: this.dataArray,
      columns: this.columns,
      elementRect: this.elementRect,
    };

    try {
      localStorage.setItem(this.storageKey, JSON.stringify(dataToSave));
    } catch (error) {
      console.error("Data could not be persisted: " + error.message);
    }
  }

  // Load data from localStorage
  loadFromStorage() {
    try {
      // Load saved data from localStorage
      const savedData = localStorage.getItem(this.storageKey);
      if (savedData) {
        const savedState = JSON.parse(savedData);
        this.dataArray = savedState.dataArray;
        this.columns = savedState.columns;
        this.elementRect = savedState.elementRect;
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

  downloadCSV(filename, content) {
    var element = document.createElement("a");
    element.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(content));
    element.setAttribute("download", filename);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
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
