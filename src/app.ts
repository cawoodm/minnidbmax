import { jsPanel } from "jspanel4/es6module/jspanel.min.js";
import "jspanel4/dist/jspanel.min.css";

addEventListener("error", function (e) {
  alert(e.message);
  // console.error(e.error.stack);
});

import { DataEntryTable } from "./data-table.js";
customElements.define("data-entry-table", DataEntryTable);

import { DataStore } from "./data-store.js";

declare global {
  interface Window {
    store: ReturnType<typeof DataStore>;
  }
}

var qs = new URLSearchParams(location.search);
const workspace = (qs.has("space") && qs.get("space")) || localStorage.getItem("/minnidbmax/.currentStore") || "default";
const store = DataStore(`/minnidbmax/${workspace}/`);
window.store = store; // Expose store globally for debugging

import { SyncherGist } from "./syncher-gist.js";
const gistUsername = store.get(".gist-user");
const gistToken = store.get(".gist-token");
const gistId = store.get(".gist-id");
const syncher = SyncherGist(gistUsername, gistToken, gistId, store);

function syncherValidate() {
  if (!gistUsername) {
    alert(`Please set your Git username in browser store with key '/minnidbmax/${workspace}/.gist-user'.`);
    return false;
  }
  if (!gistToken) {
    alert(`Please set your Gist token in browser store with key '/minnidbmax/${workspace}/.gist-token'.`);
    return false;
  }
  if (!gistId) {
    alert(`Please set your Gist token in browser store with key '/minnidbmax/${workspace}/.gist-id'.`);
    return false;
  }
  return true;
}

async function dataPush() {
  if (!syncherValidate()) return false;
  await syncher.save();
}

async function dataPull() {
  if (!syncherValidate()) return false;
  syncherValidate();
  try {
    await syncher.load();
    displayTables();
  } catch (e) {
    if (e instanceof Error) {
      alert("Error loading data from Gist: " + e.message);
    }
    console.error(e);
  }
}

function dataDump() {
  const dump = {};
  store.dir({ suffix: ".table.json" }).forEach(([key, data]) => (dump[key] = data));
  downloadFile("minnidbmax.json", JSON.stringify(dump, null, 2));
}

function listWorkspaces(): string[] {
  const set = new Set<string>();
  const re = /^\/minnidbmax\/([^/]+)\/.+/;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const m = key && key.match(re);
    if (m) set.add(m[1]);
  }
  set.add(workspace);
  return [...set].sort();
}

function populateWorkspaceSelect() {
  const select = document.getElementById("workspaceSelect") as HTMLSelectElement;
  select.innerHTML = "";
  for (const ws of listWorkspaces()) {
    const opt = document.createElement("option");
    opt.value = ws;
    opt.textContent = ws;
    if (ws === workspace) opt.selected = true;
    select.appendChild(opt);
  }
  const newOpt = document.createElement("option");
  newOpt.value = "__new__";
  newOpt.textContent = "<new workspace>";
  select.appendChild(newOpt);
}

function switchWorkspace(name: string) {
  if (name === workspace) return;
  localStorage.setItem("/minnidbmax/.currentStore", name);
  const url = new URL(location.href);
  url.searchParams.delete("space");
  location.replace(url.toString());
}

function onWorkspaceChange(e: Event) {
  const select = e.target as HTMLSelectElement;
  if (select.value === "__new__") {
    const name = prompt("Enter new workspace name:");
    select.value = workspace;
    if (!name || !name.trim()) return;
    switchWorkspace(name.trim());
    return;
  }
  switchWorkspace(select.value);
}

function addTable() {
  let title = prompt("Enter table title:");
  if (!title) return;
  let code = title.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  if (store.get(code + ".table.json")) {
    alert("Table with this name already exists. Please choose a different name.");
    return;
  }
  createTable(code, null);
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
  const newTable = document.createElement("data-entry-table") as DataEntryTable;
  newTable.setAttribute("storage-key", `${code}.table.json`);
  newTable.setAttribute("id", "table-" + code);
  const baseTitle = toTitleCase(code);
  const rect = data?.elementRect;
  // https://jspanel.de/
  const panel: any = jsPanel.create({
    headerTitle: baseTitle,
    content: newTable,
    contentOverflow: "hidden",
    headerControls: { maximize: "remove" },
    panelSize:
      rect?.width && rect?.height ? { width: rect.width, height: rect.height } : { width: 600, height: 400 },
    position:
      rect?.x != null && rect?.y != null
        ? { my: "left-top", at: "left-top", offsetX: rect.x, offsetY: rect.y }
        : { my: "center", at: "center" },
    onbeforeclose: () => deleteTable(newTable),
    onminimized: newTable.minimizedCallback.bind(newTable),
    onmaximized: newTable.maximizedCallback.bind(newTable),
    onnormalized: newTable.restoredCallback.bind(newTable),
    callback: (p: any) => {
      // https://ionic.io/ionicons
      const iconStyle = "width:60%;height:60%;vertical-align:middle;";
      p.addControl({
        name: "filter",
        html: `<img src="icon-filter.svg" style="${iconStyle}"/>`,
        handler: () => {
          newTable.shadowRoot.querySelector(".filter-row").classList.toggle("hide");
        },
      });
      p.addControl({
        name: "download",
        html: `<img src="icon-download-outline.svg" style="${iconStyle}"/>`,
        handler: () => {
          const csvData = newTable.exportDataCSV();
          downloadFile(code + ".csv", csvData);
        },
      });
      p.addControl({
        name: "data-input",
        html: `<img src="icon-data-input.svg" style="${iconStyle}"/>`,
        handler: () => {
          newTable.shadowRoot.querySelector(".input-container").classList.toggle("hide");
          (newTable.shadowRoot.querySelector(".input-container textarea") as HTMLTextAreaElement).focus();
        },
      });
    },
  });

  // jsPanel dispatches resize/drag/close events on `document`; each event carries
  // a `.panel` reference, which we use to filter to this instance.
  const onResize = (e: Event) => {
    if ((e as any).panel !== panel) return;
    newTable.resizedCallback(panel.offsetWidth, panel.offsetHeight);
  };
  const onDragStop = (e: Event) => {
    if ((e as any).panel !== panel) return;
    const r = panel.getBoundingClientRect();
    newTable.movedCallback(Math.round(r.left), Math.round(r.top));
  };
  const onClosed = (e: Event) => {
    if ((e as any).panel !== panel) return;
    document.removeEventListener("jspanelresize", onResize);
    document.removeEventListener("jspaneldragstop", onDragStop);
    document.removeEventListener("jspanelclosed", onClosed);
  };
  document.addEventListener("jspanelresize", onResize);
  document.addEventListener("jspaneldragstop", onDragStop);
  document.addEventListener("jspanelclosed", onClosed);

  if (rect?.minimized) panel.minimize();
  else if (rect?.maximized) panel.maximize();

  newTable.addEventListener("row-count-changed", (e: Event) => {
    const { count } = (e as CustomEvent).detail;
    panel.setHeaderTitle(`${baseTitle} (${count})`);
  });
  // Initial render fired before the listener was attached — sync the title now.
  panel.setHeaderTitle(`${baseTitle} (${newTable.dataArray.length})`);

  function toTitleCase(str) {
    return str.replace(/\w\S*/g, (text) => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase());
  }
}

function deleteTable(table): boolean {
  if (!confirm("Are you sure you want to delete this table?")) return false;
  let key = table.getAttribute("storage-key");
  store.delete(key);
  return true;
}

function displayTables() {
  store.dir({ suffix: ".table.json" }).forEach(([key, data]) => {
    let table = key.replace(".table.json", "");
    let el: DataEntryTable = document.querySelector("#table-" + table);
    if (!el) {
      try {
        createTable(table, data);
      } catch (e) {
        console.error(e);
        if (e instanceof Error) alert(`Error loading table (${table}) data: ${e.message}`);
      }
    } else {
      el.refresh();
      //el.importData(JSON.parse(table.data));
    }
  });
}
// Example of how to interact with the component programmatically
document.addEventListener("DOMContentLoaded", function () {
  //gistSynch();
  populateWorkspaceSelect();
  displayTables();
  document.getElementById("dataPush").addEventListener("click", dataPush);
  document.getElementById("dataPull").addEventListener("click", dataPull);
  document.getElementById("dataDump").addEventListener("click", dataDump);
  document.getElementById("addTable").addEventListener("click", addTable);
  document.getElementById("workspaceSelect").addEventListener("change", onWorkspaceChange);
});
