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

let globalSearchTerm = "";

// Vertical chrome heights, measured once at DOM ready. Panels are constrained
// to drag/resize within the space between header and (footer + minimized dock).
let headerHeight = 48;
let footerHeight = 48;
const dockHeight = 44; // reserved strip above the footer for minimized panels
function panelContainment(): [number, number, number, number] {
  return [headerHeight, 0, footerHeight + dockHeight, 0];
}

import { makeDialogDraggable } from "./draggable-dialog";
import { SyncherGist } from "./syncher-gist.js";

const GIST_CONN_KEY = ".synch/gist";

type GistConn = { user: string; gist_id: string; gist_token: string };

function parseGistConn(s: string | undefined | null): GistConn | null {
  if (!s) return null;
  const out: Record<string, string> = {};
  for (const pair of s.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  if (!out.user || !out.gist_id || !out.gist_token) return null;
  return { user: out.user, gist_id: out.gist_id, gist_token: out.gist_token };
}

function formatGistConn(c: GistConn): string {
  return `user=${c.user};gist_id=${c.gist_id};gist_token=${c.gist_token};`;
}

// Build a fresh SyncherGist each call so credentials updated via the settings dialog
// take effect immediately (the previous module-singleton captured stale values).
function makeSyncher() {
  const c = parseGistConn(store.get(GIST_CONN_KEY)) ?? { user: "", gist_id: "", gist_token: "" };
  return SyncherGist(c.user, c.gist_token, c.gist_id, store);
}

// Ensure Gist credentials are set. If the connection string is missing or incomplete,
// open the settings dialog. Resolves true if credentials are now present, false on Cancel.
async function ensureGistCredentials(): Promise<boolean> {
  if (parseGistConn(store.get(GIST_CONN_KEY))) return true;
  return openSyncSettingsDialog();
}

function openSyncSettingsDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "rounded-lg shadow-xl p-0 bg-white backdrop:bg-black/40 max-w-md w-[90vw]";
    dlg.innerHTML = `
      <header class="px-6 py-4 border-b border-slate-200">
        <h3 class="text-lg font-semibold text-slate-800">Gist sync settings</h3>
        <p class="text-sm text-slate-600 mt-1">Configure GitHub credentials so Push/Pull can read/write your Gist.</p>
      </header>
      <div class="px-6 py-4">
        <label class="block">
          <span class="text-sm font-medium text-slate-700">Connection string</span>
          <p class="text-xs text-slate-500 mb-1">
            Format: <code>user=&lt;github-user&gt;;gist_id=&lt;id&gt;;gist_token=&lt;pat&gt;;</code><br>
            Classic token <a href="https://github.com/settings/tokens" target="_blank" rel="noopener" class="text-blue-600 hover:underline">here</a>.
            Gist ID is visible in the URL of the gist from <code>https://gist.github.com/&lt;you&gt;/&lt;id&gt;</code>.
          </p>
          <textarea name="conn" rows="4" spellcheck="false" class="w-full rounded border border-slate-300 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-400"></textarea>
        </label>
      </div>
      <footer class="flex justify-end gap-2 px-6 py-3 border-t border-slate-200 bg-slate-50">
        <button type="button" class="cancel rounded bg-slate-200 hover:bg-slate-300 px-4 py-1.5 text-sm">Cancel</button>
        <button type="button" class="save rounded bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-sm text-white font-medium">Save</button>
      </footer>`;
    const connInput = dlg.querySelector("textarea[name='conn']") as HTMLTextAreaElement;
    connInput.value = store.get(GIST_CONN_KEY) || "";

    let saved = false;
    dlg.querySelector(".cancel").addEventListener("click", () => dlg.close());
    dlg.querySelector(".save").addEventListener("click", () => {
      const parsed = parseGistConn(connInput.value.trim());
      if (!parsed) {
        showAlert("Connection string must include user, gist_id, and gist_token.", "error", "Gist sync");
        return;
      }
      store.set(GIST_CONN_KEY, formatGistConn(parsed));
      saved = true;
      dlg.close();
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(saved);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    makeDialogDraggable(dlg, dlg.querySelector("header") as HTMLElement);
    connInput.focus();
  });
}

async function dataPush() {
  if (!(await ensureGistCredentials())) return;
  try {
    await makeSyncher().save();
    showAlert("Data pushed to Gist.", "success", "Gist sync");
  } catch (e) {
    if (e instanceof Error) showAlert("Error pushing to Gist: " + e.message, "error", "Gist sync");
    console.error(e);
  }
}

async function dataPull() {
  if (!(await ensureGistCredentials())) return;
  try {
    await makeSyncher().load();
    showAlert("Data pulled from Gist.", "success", "Gist sync");
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
  let code = title.replace(/[^a-zA-Z0-9]/g, "_");
  if (store.get(code + ".table.json")) {
    showAlert("Table with this name already exists. Please choose a different name.", "error");
    return;
  }
  generateTableInUI(code, null);
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

function generateTableInUI(code, data) {
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
    dragit: { containment: panelContainment() },
    resizeit: { containment: panelContainment() },
    maximizedMargin: panelContainment(),
    minimizeTo: "#minimizedDock",
    onbeforeclose: () => deleteTable(newTable),
    onminimized: newTable.minimizedCallback.bind(newTable),
    onmaximized: newTable.maximizedCallback.bind(newTable),
    onnormalized: newTable.restoredCallback.bind(newTable),
    onsmallified: newTable.smallifiedCallback.bind(newTable),
    onunsmallified: newTable.unsmallifiedCallback.bind(newTable),
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

  // Per-panel local search: collapsed by default to a magnifying-glass icon in the panel
  // controlbar (sibling of .jsPanel-titlebar, which is the drag handle). Click the icon to
  // expand to an input; the input collapses back to the icon on blur if empty.
  const localToggle = document.createElement("button");
  localToggle.type = "button";
  localToggle.className = "material-icons jsPanel-btn-localsearch";
  localToggle.title = "Search this table";
  localToggle.textContent = "search";
  localToggle.style.cssText = "background:none;border:0;cursor:pointer;padding:2px 4px;color:#666;font-size:18px;line-height:1;";
  const localSearch = document.createElement("input");
  localSearch.type = "search";
  localSearch.placeholder = "Search…";
  localSearch.title = "Search this table";
  localSearch.className = "jsPanel-local-search";
  localSearch.style.cssText = "display:none;margin:0 6px;padding:1px 6px;font-size:12px;width:130px;height:22px;border:1px solid #b0b0b0;border-radius:3px;outline:none;background:#fff;color:#222;";
  localToggle.addEventListener("click", () => {
    localToggle.style.display = "none";
    localSearch.style.display = "inline-block";
    localSearch.focus();
  });
  localSearch.addEventListener("blur", () => {
    if (!localSearch.value) {
      localSearch.style.display = "none";
      localToggle.style.display = "inline-flex";
    }
  });
  localSearch.addEventListener("input", () => newTable.setLocalFilter(localSearch.value));
  localSearch.addEventListener("pointerdown", (e) => e.stopPropagation());
  const controlbar = panel.querySelector(".jsPanel-controlbar") as HTMLElement | null;
  if (controlbar) {
    controlbar.prepend(localSearch);
    controlbar.prepend(localToggle);
  }

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
  else if (rect?.smallified) panel.smallify();

  newTable.addEventListener("row-count-changed", (e: Event) => {
    const { count } = (e as CustomEvent).detail;
    panel.setHeaderTitle(`${baseTitle} (${count})`);
  });
  // Initial render fired before the listener was attached — sync the title now.
  panel.setHeaderTitle(`${baseTitle} (${newTable.dataArray.length})`);
  if (globalSearchTerm) newTable.setGlobalFilter(globalSearchTerm);

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

  const composed = e.composedPath();
  const panelEl = composed.find((n) => (n as Element).classList?.contains("jsPanel")) as Element | undefined;
  const tableEl = panelEl?.querySelector("data-entry-table") as any;
  const table = (tableEl?.getAttribute("id") || "").replace(/^table-/, "");

  Array.from(e.dataTransfer.files).forEach(async (file) => {
    if (await tryJsonDrop(file, table, { store, displayTables })) return;
    if (await tryCsvDrop(file, table, { store, createTable: generateTableInUI })) return;
  });
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
        generateTableInUI(table, data);
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
  headerHeight = document.querySelector("header")?.getBoundingClientRect().height ?? headerHeight;
  footerHeight = document.querySelector("footer")?.getBoundingClientRect().height ?? footerHeight;
  document.documentElement.style.setProperty("--footer-height", `${footerHeight}px`);
  initWorkspaceSelect(document.getElementById("workspaceSelect") as HTMLSelectElement);
  displayTables();
  document.getElementById("dataPush").addEventListener("click", dataPush);
  document.getElementById("dataPull").addEventListener("click", dataPull);
  document.getElementById("dataDump").addEventListener("click", dataDump);
  document.getElementById("addTable").addEventListener("click", addTable);
  const searchToggle = document.getElementById("globalSearchToggle") as HTMLButtonElement;
  const searchBox = document.getElementById("globalSearchBox") as HTMLDivElement;
  const searchEl = document.getElementById("globalSearch") as HTMLInputElement;
  searchToggle.addEventListener("click", () => {
    searchToggle.classList.add("hidden");
    searchBox.classList.remove("hidden");
    searchEl.focus();
  });
  searchEl.addEventListener("blur", () => {
    if (!searchEl.value) {
      searchBox.classList.add("hidden");
      searchToggle.classList.remove("hidden");
    }
  });
  searchEl.addEventListener("input", () => {
    globalSearchTerm = searchEl.value;
    document.querySelectorAll<DataEntryTable>("data-entry-table").forEach((t) => t.setGlobalFilter(globalSearchTerm));
  });
  document.addEventListener("dragenter", onPageDragenter);
  document.addEventListener("dragleave", onPageDragleave);
  document.addEventListener("dragover", onPageDragover);
  document.addEventListener("drop", onPageDrop);
});
