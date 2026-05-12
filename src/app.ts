import "jspanel4/dist/jspanel.min.css";
import { jsPanel } from "jspanel4/es6module/jspanel.min.js";
import "material-icons/iconfont/filled.css";

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
    headerControls: {},
    iconfont: "material-icons",
    panelSize: rect?.width && rect?.height ? { width: rect.width, height: rect.height } : { width: 600, height: 400 },
    position: rect?.x != null && rect?.y != null ? { my: "left-top", at: "left-top", offsetX: rect.x, offsetY: rect.y } : { my: "center", at: "center" },
    onbeforeclose: () => deleteTable(newTable),
    onminimized: newTable.minimizedCallback.bind(newTable),
    onmaximized: newTable.maximizedCallback.bind(newTable),
    onnormalized: newTable.restoredCallback.bind(newTable),
    callback: (p: any) => {
      // https://ionic.io/ionicons
      p.addControl({
        name: "filter",
        html: `<span class="material-icons" style="font-size:18px;vertical-align:middle;">filter_list</span>`,
        handler: () => {
          newTable.shadowRoot.querySelector(".filter-row").classList.toggle("hide");
        },
      });
    },
    footerToolbar: () => {
      const bar = document.createElement("div");
      bar.style.cssText = "display:flex;gap:6px;padding:4px 8px;align-items:center;";
      const makeBtn = (icon: string, title: string, onClick: () => void) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = title;
        btn.style.cssText = "background:none;border:0;cursor:pointer;padding:2px;display:inline-flex;";
        btn.innerHTML = `<span class="material-icons" style="font-size:20px;">${icon}</span>`;
        btn.addEventListener("click", onClick);
        return btn;
      };
      bar.appendChild(
        makeBtn("file_upload", "Import CSV", () => {
          newTable.shadowRoot.querySelector(".input-container").classList.toggle("hide");
          (newTable.shadowRoot.querySelector(".input-container textarea") as HTMLTextAreaElement).focus();
        }),
      );
      bar.appendChild(
        makeBtn("file_download", "Export CSV", () => {
          const csvData = newTable.exportDataCSV();
          downloadFile(code + ".csv", csvData);
        }),
      );
      return bar;
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

function onPageDragover(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
}

function importCsvIntoTable(el: any, file: File) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    el.dataInput.value = ev.target!.result!.toString();
    el.processInput();
  };
  reader.readAsText(file, "UTF-8");
}

function onPageDrop(e: DragEvent) {
  e.preventDefault();
  const file = Array.from(e.dataTransfer?.files ?? []).find((f) => /\.csv$/i.test(f.name));
  if (!file) return;
  // If the drop landed inside an existing panel, route the import into that panel's table.
  const composed = e.composedPath();
  const panelEl = composed.find((n) => (n as Element).classList?.contains("jsPanel")) as Element | undefined;
  if (panelEl) {
    // The data-table textarea has its own drop handler; if the drop hit it, let that handler import.
    if (composed.some((n) => (n as Element).tagName === "TEXTAREA")) return;
    const tableEl = panelEl.querySelector("data-entry-table") as any;
    if (tableEl) importCsvIntoTable(tableEl, file);
    return;
  }
  // Else: drop on empty page area → create (or overwrite) a table named after the file.
  const baseName = file.name.replace(/\.csv$/i, "");
  const code = baseName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  if (store.get(code + ".table.json")) {
    if (!confirm(`Table '${baseName}' already exists. Overwrite?`)) return;
    const existing = document.getElementById("table-" + code);
    if (existing) {
      const oldPanel = existing.closest(".jsPanel") as any;
      if (oldPanel) {
        oldPanel.options.onbeforeclose = null;
        oldPanel.close();
      }
    }
    store.delete(code + ".table.json");
  }
  createTable(code, null);
  const newEl = document.getElementById("table-" + code) as any;
  if (newEl) {
    newEl.shadowRoot.querySelector(".input-container").classList.add("hide");
    importCsvIntoTable(newEl, file);
  }
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
  document.addEventListener("dragover", onPageDragover);
  document.addEventListener("drop", onPageDrop);
});
