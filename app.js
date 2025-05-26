addEventListener("error", function (e) {
  alert(e.message);
  // console.error(e.error.stack);
});
// https://gist.github.com/cawoodm
// Create fine-grained token with gist scope: https://github.com/settings/apps

import { DataEntryTable } from "./lib/data-table.js";
customElements.define("data-entry-table", DataEntryTable);

import { DataStore } from "./lib/data-store";
var qs = new URLSearchParams(location.search);
const storeKey = (qs.has("space") && qs.get("space")) || localStorage.getItem("/minnidbmax/.currentStore") || "default";
window.store = DataStore(`/minnidbmax/${storeKey}/`);

import { SyncherGist } from "./lib/syncher-gist.js";
const gistToken = store.get(".gist-token");
const gistId = store.get(".gist-id");
const gistUsername = store.get(".gist-user");
const syncher = SyncherGist(gistUsername, gistToken, gistId);

function syncherValidate() {
  if (!gistUsername) {
    alert("Please set your Git username in browser store with key '/minnidbmax/.gist-user'.");
    return false;
  }
  if (!gistToken) {
    alert("Please set your Gist token in browser store with key '/minnidbmax/.gist-token'.");
    return false;
  }
  if (!gistStorageKey) {
    alert("Please set your Gist token in browser store with key '/minnidbmax/.gist-id'.");
    return false;
  }
  return true;
}

function dataPush() {
  if (!syncherValidate()) return false;
  syncher.save();
}
function dataPull() {
  if (!syncherValidate()) return false;
  syncherValidate();
  syncher.load();
}
function dataDump() {
  const dump = {};
  store.dir().forEach(([key, data]) => (dump[key] = data));
  downloadFile("minnidbmax.json", JSON.stringify(dump, null, 2));
}
function addTable() {
  let title = prompt("Enter table title:");
  if (!title) return;
  let code = title.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  if (store.get(code + ".table.json")) {
    alert("Table with this name already exists. Please choose a different name.");
    return;
  }
  createTable(code);
}
function downloadFile(filename, content) {
  var element = document.createElement("a");
  element.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(content));
  element.setAttribute("download", filename);
  element.style.display = "none";
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}
function createTable(code, data) {
  const newTable = document.createElement("data-entry-table");
  newTable.setAttribute("storage-key", `${code}.table.json`);
  newTable.setAttribute("id", "table-" + code);
  // https://github.com/nextapps-de/winbox?tab=readme-ov-file
  let win = new WinBox(toTitleCase(code), {
    mount: newTable,
    onresize: newTable.resizedCallback.bind(newTable),
    onmove: newTable.movedCallback.bind(newTable),
    onminimize: newTable.minimizedCallback.bind(newTable),
    onmaximize: newTable.maximizedCallback.bind(newTable),
    onrestore: newTable.restoredCallback.bind(newTable),
    onclose: () => deleteTable(this, newTable),
  });
  win.removeControl("wb-full");
  // https://ionic.io/ionicons
  // https://github.com/ionic-team/ionicons
  win.addControl({
    class: "wb-full",
    image: "icon-filter.svg",
    click: function (event, winbox) {
      document
        .getElementById("table-" + code)
        .shadowRoot.querySelector(".filter-row")
        .classList.toggle("hide");
    },
  });
  win.addControl({
    class: "wb-full",
    image: "icon-data-input.svg",
    click: function (event, winbox) {
      newTable.shadowRoot.querySelector(".input-container").classList.toggle("hide");
      newTable.shadowRoot.querySelector(".input-container textarea").focus();
    },
  });
  win.addControl({
    class: "wb-full",
    image: "icon-download-outline.svg",
    click: function (event, winbox) {
      const csvData = newTable.exportDataCSV();
      downloadFile(code + ".csv", csvData);
      this.classList.toggle("active");
    },
  });
  if (data?.elementRect) {
    win.move(data.elementRect.x, data.elementRect.y);
    win.resize(data.elementRect.width, data.elementRect.height);
  }
  if (data?.elementRect?.minimized) win.minimize(true);
  else if (data?.elementRect?.maximized) win.maximize(true);
  // TODO: Remove data reading from data table class?
  function toTitleCase(str) {
    return str.replace(/\w\S*/g, (text) => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase());
  }
}

function deleteTable(win, table) {
  if (!confirm("Are you sure you want to delete this table?")) return;
  let key = table.getAttribute("storage-key");
  store.delete(key);
}

// Example of how to interact with the component programmatically
document.addEventListener("DOMContentLoaded", function () {
  //gistLoadData(); return;
  store.dir({ suffix: ".table.json" }).forEach(([key, data]) => createTable(key.replace(".table.json", ""), data));
  console.debug("Data loaded from browser store");
  document.getElementById("dataPush").addEventListener("click", dataPush);
  document.getElementById("dataPull").addEventListener("click", dataPull);
  document.getElementById("dataDump").addEventListener("click", dataDump);
  document.getElementById("addTable").addEventListener("click", addTable);
});
