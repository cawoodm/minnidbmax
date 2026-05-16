import type { DataStore } from "./data-store";
import { makeDialogDraggable } from "./draggable-dialog";

export type CsvImportDeps = {
  store: DataStore;
  createTable: (code: string, data: any) => void;
};

// Probe a drop event for a .csv file. Returns true if the plugin handled the drop
// (in which case the caller should stop processing). Returns false if no .csv file
// was present and the caller should continue with its own handling.
export async function tryCsvDrop(file: File, table: string, deps: CsvImportDeps): Promise<boolean> {
  if (!file || !/\.csv$/i.test(file.name)) return false;
  await handleCsvFile(file, table, deps);
  return true;
}

async function handleCsvFile(file: File, table: string, deps: CsvImportDeps) {
  // If the drop landed inside an existing panel, route the import into that panel's table.
  if (table) {
    const mode = await askImportMode(table);
    if (mode === null) return;
    const tableEl = document.getElementById("table-" + table) as any;
    if (mode === "overwrite") tableEl.initializeData();
    importCsvIntoTable(tableEl, file, mode);
    return;
  }
  // Else: drop on empty page area → create (or overwrite) a table named after the file.
  const baseName = file.name.replace(/\.csv$/i, "");
  const code = baseName.replace(/[^a-zA-Z0-9]/g, "_");
  if (deps.store.get(code + ".table.json")) {
    if (!confirm(`Table '${baseName}' already exists. Overwrite?`)) return;
    const existing = document.getElementById("table-" + code);
    if (existing) {
      const oldPanel = existing.closest(".jsPanel") as any;
      if (oldPanel) {
        oldPanel.options.onbeforeclose = null;
        oldPanel.close();
      }
    }
    deps.store.delete(code + ".table.json");
  }
  deps.createTable(code, null);
  const newEl = document.getElementById("table-" + code) as any;
  if (newEl) {
    newEl.shadowRoot.querySelector(".input-container").classList.add("hide");
    importCsvIntoTable(newEl, file, "new");
  }
}

function importCsvIntoTable(el: any, file: File, mode: string) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const inputLines = ev
      .target!.result!.toString()
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const seperator = inputLines[0].includes(";") ? ";" : inputLines[0].includes("\t") ? "\t" : ",";
    el.importDataLines(inputLines, seperator, mode);
  };
  reader.readAsText(file, "UTF-8");
}

function askImportMode(tableName: string): Promise<"append" | "overwrite" | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "rounded-lg shadow-xl p-0 bg-white backdrop:bg-black/40 max-w-md w-[90vw]";
    dlg.innerHTML = `
      <header class="px-6 py-4 border-b border-slate-200">
        <h3 class="text-lg font-semibold text-slate-800">Import CSV</h3>
        <p class="text-sm text-slate-600 mt-1">Importing into <strong class="table-name text-slate-800"></strong>.</p>
      </header>
      <div class="px-6 py-4 space-y-3">
        <button type="button" value="append" class="w-full text-left rounded border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 px-4 py-3">
          <div class="font-medium text-emerald-800">Append</div>
          <div class="text-sm text-emerald-700">Add the new rows to the existing data.</div>
        </button>
        <button type="button" value="overwrite" class="w-full text-left rounded border border-amber-300 bg-amber-50 hover:bg-amber-100 px-4 py-3">
          <div class="font-medium text-amber-800">Overwrite</div>
          <div class="text-sm text-red-700">Clear every existing row first, then import.</div>
        </button>
      </div>
      <footer class="flex justify-end gap-2 px-6 py-3 border-t border-slate-200 bg-slate-50">
        <button type="button" value="cancel" class="rounded bg-slate-200 hover:bg-slate-300 px-4 py-1.5 text-sm">Cancel</button>
      </footer>`;
    dlg.querySelector(".table-name")!.textContent = tableName;
    const done = (v: string) => {
      dlg.close();
      dlg.remove();
      resolve(v === "cancel" ? null : (v as "append" | "overwrite"));
    };
    dlg.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
      if (b) done(b.value);
    });
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      done("cancel");
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    makeDialogDraggable(dlg);
  });
}
