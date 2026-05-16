import "jspanel4/dist/jspanel.min.css";
import "jspanel4/es6module/extensions/hint/jspanel.hint.js";
import { jsPanel } from "jspanel4/es6module/jspanel.js";
import "material-icons/iconfont/filled.css";
import { tryCsvDrop } from "./csv-import";
import { tryJsonDrop } from "./json-import";
import { showAlert } from "./show-alert";
import "./styles.css";

addEventListener("error", function (e) {
  showAlert(e.message, "error");
  // console.error(e.error.stack);
});

import { DataEntryTable } from "./data-table";
customElements.define("data-entry-table", DataEntryTable);

import { DataStore } from "./data-store";
import { initWorkspaceSelect, workspace } from "./workspace";

declare global {
  interface Window {
    store: DataStore;
  }
}

const store = DataStore(`/minnidbmax/${workspace}/`);
window.store = store; // Expose store globally for debugging

// Monotonic rank for window stacking. Higher = more recently fronted. Seeded
// from existing storage so a new session continues above prior values.
// jsPanel's resetZi() reshuffles style.zIndex behind our back, so we can't
// rely on reading it — this rank is our own source of truth for z-order.
let frontRank = (() => {
  let max = 0;
  for (const [, data] of store.dir({ suffix: ".table.json" })) {
    const z = (data as any)?.elementRect?.zIndex;
    if (typeof z === "number" && z > max) max = z;
  }
  return max;
})();

import { SyncherGist } from "./syncher-gist.js";
const gistUsername = store.get(".gist-user");
const gistToken = store.get(".gist-token");
const gistId = store.get(".gist-id");
const syncher = SyncherGist(gistUsername, gistToken, gistId, store);

function syncherValidate() {
  if (!gistUsername) {
    showAlert(`Please set your Git username in browser store with key '/minnidbmax/${workspace}/.gist-user'.`, "error", "Gist sync");
    return false;
  }
  if (!gistToken) {
    showAlert(`Please set your Gist token in browser store with key '/minnidbmax/${workspace}/.gist-token'.`, "error", "Gist sync");
    return false;
  }
  if (!gistId) {
    showAlert(`Please set your Gist id in browser store with key '/minnidbmax/${workspace}/.gist-id'.`, "error", "Gist sync");
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
      showAlert("Error loading data from Gist: " + e.message, "error", "Gist sync");
    }
    console.error(e);
  }
}

function dataDump() {
  const dump = {};
  store.dir({ suffix: ".table.json" }).forEach(([key, data]) => (dump[key] = data));
  downloadFile(workspace + ".db.json", JSON.stringify(dump, null, 2));
}

function addTable() {
  let title = prompt("Enter table title:");
  if (!title) return;
  let code = title.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  if (store.get(code + ".table.json")) {
    showAlert("Table with this name already exists. Please choose a different name.", "error");
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
      bar.appendChild(makeBtn("view_column", "Edit columns", () => newTable.openColumnEditor()));
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
  const onFronted = (e: Event) => {
    if ((e as any).panel !== panel) return;
    newTable.zIndexChangedCallback(++frontRank);
  };
  const onClosed = (e: Event) => {
    // jspanelclosed (unlike resize/drag/fronted) does NOT carry an `.panel` reference;
    // filter via detail (panel id) — see jspanel.js:2466-2481 for the bulk-assign list.
    if ((e as CustomEvent).detail !== panel.id) return;
    document.removeEventListener("jspanelresize", onResize);
    document.removeEventListener("jspaneldragstop", onDragStop);
    document.removeEventListener("jspanelfronted", onFronted);
    document.removeEventListener("jspanelclosed", onClosed);
    // jsPanel may still have the element in the DOM when this fires; defer past the current tick.
    setTimeout(updateEmptyState, 0);
  };
  document.addEventListener("jspanelresize", onResize);
  document.addEventListener("jspaneldragstop", onDragStop);
  document.addEventListener("jspanelfronted", onFronted);
  document.addEventListener("jspanelclosed", onClosed);
  // Seed an initial rank so newly created (unclicked) panels are still ordered above older ones on next reload.
  newTable.zIndexChangedCallback(++frontRank);
  updateEmptyState();

  if (rect?.minimized) panel.minimize();
  else if (rect?.maximized) panel.maximize();

  newTable.addEventListener("row-count-changed", (e: Event) => {
    const { count } = (e as CustomEvent).detail;
    panel.setHeaderTitle(`${baseTitle} (${count})`);
  });
  // Auto-open the column editor the first time columns are established (CSV import on a new table).
  newTable.addEventListener("columns-established", () => newTable.openColumnEditor(), { once: true });
  // Initial render fired before the listener was attached — sync the title now.
  panel.setHeaderTitle(`${baseTitle} (${newTable.dataArray.length})`);

  function toTitleCase(str) {
    return str.replace(/\w\S*/g, (text) => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase());
  }
}

function deleteTable(table): boolean {
  if (!confirm("Are you sure you want to delete this table?")) return false;
  let key = table.getAttribute("storage-key");
  table.delete();
  return true;
}

let dropPageOverlay: HTMLDivElement | null = null;
let dropPanelOverlay: HTMLDivElement | null = null;
let dropDragCounter = 0;

function ensureDropOverlays() {
  if (!dropPageOverlay) {
    dropPageOverlay = document.createElement("div");
    dropPageOverlay.style.cssText = "position:fixed;inset:0;border:6px dotted #1976d2;box-sizing:border-box;pointer-events:none;z-index:99998;display:none;";
    document.body.appendChild(dropPageOverlay);
  }
  if (!dropPanelOverlay) {
    dropPanelOverlay = document.createElement("div");
    dropPanelOverlay.style.cssText = "position:fixed;border:6px dotted #2e7d32;box-sizing:border-box;pointer-events:none;z-index:99999;display:none;";
    document.body.appendChild(dropPanelOverlay);
  }
}

function hideDropOverlays() {
  if (dropPageOverlay) dropPageOverlay.style.display = "none";
  if (dropPanelOverlay) dropPanelOverlay.style.display = "none";
  dropDragCounter = 0;
}

function onPageDragenter(e: DragEvent) {
  if (!e.dataTransfer?.types.includes("Files")) return;
  dropDragCounter++;
  ensureDropOverlays();
  dropPageOverlay!.style.display = "block";
}

function onPageDragleave(e: DragEvent) {
  if (dropDragCounter === 0) return;
  dropDragCounter--;
  if (dropDragCounter === 0) hideDropOverlays();
}

function onPageDragover(e: DragEvent) {
  // Only intercept file drags. Setting dropEffect="copy" on non-file drags (e.g.
  // column-header reorder, which sets effectAllowed="move") makes the browser
  // cancel the drop because move/copy don't match — the drop event never fires.
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  ensureDropOverlays();
  // Highlight the panel under the cursor (if any) instead of the whole page.
  const panelEl = e.composedPath().find((n) => (n as Element).classList?.contains("jsPanel")) as Element | undefined;
  if (panelEl) {
    const r = panelEl.getBoundingClientRect();
    dropPanelOverlay!.style.left = r.left + "px";
    dropPanelOverlay!.style.top = r.top + "px";
    dropPanelOverlay!.style.width = r.width + "px";
    dropPanelOverlay!.style.height = r.height + "px";
    dropPanelOverlay!.style.display = "block";
    dropPageOverlay!.style.display = "none";
  } else {
    dropPanelOverlay!.style.display = "none";
    dropPageOverlay!.style.display = "block";
  }
}

async function onPageDrop(e: DragEvent) {
  // Same gate as onPageDragover: ignore non-file drops so in-app drags (column
  // reorder, dialog row reorder) reach their own handlers untouched.
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  hideDropOverlays();
  if (await tryJsonDrop(e, { store, displayTables })) return;
  if (await tryCsvDrop(e, { store, createTable })) return;
}

function displayTables() {
  const entries = store.dir({ suffix: ".table.json" }) as [string, any][];
  // Restore stacking order: lowest persisted z-index gets created first so
  // jsPanel's incrementing zi.next() reproduces the user's last layering.
  entries.sort((a, b) => (a[1]?.elementRect?.zIndex ?? -Infinity) - (b[1]?.elementRect?.zIndex ?? -Infinity));
  entries.forEach(([key, data]) => {
    let table = key.replace(".table.json", "");
    let el: DataEntryTable = document.querySelector("#table-" + table);
    if (!el) {
      try {
        createTable(table, data);
      } catch (e) {
        console.error(e);
        if (e instanceof Error) showAlert(`Error loading table (${table}) data: ${e.message}`, "error");
      }
    } else {
      el.refresh();
    }
  });
  updateEmptyState();
}

function updateEmptyState() {
  const el = document.getElementById("empty-state");
  if (!el) return;
  const hasPanels = document.querySelectorAll(".jsPanel-standard").length > 0;
  el.classList.toggle("hide", hasPanels);
}
// Example of how to interact with the component programmatically
document.addEventListener("DOMContentLoaded", function () {
  //gistSynch();
  initWorkspaceSelect(document.getElementById("workspaceSelect") as HTMLSelectElement);
  displayTables();
  document.getElementById("dataPush").addEventListener("click", dataPush);
  document.getElementById("dataPull").addEventListener("click", dataPull);
  document.getElementById("dataDump").addEventListener("click", dataDump);
  document.getElementById("addTable").addEventListener("click", addTable);
  document.addEventListener("dragenter", onPageDragenter);
  document.addEventListener("dragleave", onPageDragleave);
  document.addEventListener("dragover", onPageDragover);
  document.addEventListener("drop", onPageDrop);
});
