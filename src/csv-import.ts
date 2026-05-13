import type { DataStore } from "./data-store";

export type CsvImportDeps = {
  store: DataStore;
  createTable: (code: string, data: any) => void;
};

// Probe a drop event for a .csv file. Returns true if the plugin handled the drop
// (in which case the caller should stop processing). Returns false if no .csv file
// was present and the caller should continue with its own handling.
export async function tryCsvDrop(e: DragEvent, deps: CsvImportDeps): Promise<boolean> {
  const file = Array.from(e.dataTransfer?.files ?? []).find((f) => /\.csv$/i.test(f.name));
  if (!file) return false;
  await handleCsvFile(e, file, deps);
  return true;
}

async function handleCsvFile(e: DragEvent, file: File, deps: CsvImportDeps) {
  // If the drop landed inside an existing panel, route the import into that panel's table.
  const composed = e.composedPath();
  const panelEl = composed.find((n) => (n as Element).classList?.contains("jsPanel")) as Element | undefined;
  if (panelEl) {
    const tableEl = panelEl.querySelector("data-entry-table") as any;
    if (!tableEl) return;
    const name = (tableEl.getAttribute("id") || "").replace(/^table-/, "") || "this table";
    const mode = await askImportMode(name);
    if (mode === null) return;
    if (mode === "overwrite") tableEl.initializeData();
    importCsvIntoTable(tableEl, file);
    return;
  }
  // Else: drop on empty page area → create (or overwrite) a table named after the file.
  const baseName = file.name.replace(/\.csv$/i, "");
  const code = baseName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
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
    importCsvIntoTable(newEl, file);
  }
}

function importCsvIntoTable(el: any, file: File) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    el.dataInput.value = ev.target!.result!.toString();
    el.processInput();
  };
  reader.readAsText(file, "UTF-8");
}

function askImportMode(tableName: string): Promise<"append" | "overwrite" | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.style.cssText = "padding:16px;border:1px solid #888;border-radius:6px;font-family:Arial,sans-serif;";
    dlg.innerHTML = `
      <p style="margin:0 0 12px 0;">Import CSV into <strong></strong>:</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" value="append">Append</button>
        <button type="button" value="overwrite">Overwrite</button>
        <button type="button" value="cancel">Cancel</button>
      </div>`;
    dlg.querySelector("strong")!.textContent = tableName;
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
  });
}
