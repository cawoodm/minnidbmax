import { showAlert } from "./show-alert";

type DataStoreLike = {
  dir(opts?: { path?: string; suffix?: string }): [string, any][];
  get(key: string, defaultValue?: any): any;
  set(key: string, value: any): void;
  delete(key: string): void;
};

export type JsonImportDeps = { store: DataStoreLike; displayTables: () => void };

// Probe a drop event for a .json file. Returns true if the plugin handled the drop
// (in which case the caller should stop processing). Returns false if no .json file
// was present and the caller should continue with its own handling.
export async function tryJsonDrop(e: DragEvent, deps: JsonImportDeps): Promise<boolean> {
  const file = Array.from(e.dataTransfer?.files ?? []).find((f) => /\.json$/i.test(f.name));
  if (!file) return false;
  await handleJsonFile(file, deps);
  return true;
}

async function handleJsonFile(file: File, deps: JsonImportDeps) {
  const text = await file.text();
  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(text);
  } catch {
    showAlert(`"${file.name}" is not valid JSON.`, "error", "Import");
    return;
  }
  const validKeys = Object.keys(parsed).filter(
    (k) => /\.table\.json$/.test(k) && parsed[k]?.dataArray && parsed[k]?.columns,
  );
  if (validKeys.length === 0) {
    showAlert(`No valid tables found in "${file.name}".`, "error", "Import");
    return;
  }
  const mode = await askDbImportMode(file.name, validKeys.length);
  if (mode === null) return;
  applyDbImport(parsed, validKeys, mode, deps);
}

function askDbImportMode(filename: string, tableCount: number): Promise<"overwrite" | "replace" | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "rounded-lg shadow-xl p-0 bg-white backdrop:bg-black/40 max-w-md w-[90vw]";
    dlg.innerHTML = `
      <div class="px-6 py-4 border-b border-slate-200">
        <h3 class="text-lg font-semibold text-slate-800">Import database</h3>
        <p class="text-sm text-slate-600 mt-1">Importing <strong></strong> (<span class="count"></span> tables).</p>
      </div>
      <div class="px-6 py-4 space-y-3">
        <button type="button" value="overwrite" class="w-full text-left rounded border border-slate-300 hover:bg-slate-50 px-4 py-3">
          <div class="font-medium text-slate-800">Overwrite</div>
          <div class="text-sm text-slate-600">Silently overwrite tables that already exist. Tables not in the file are kept.</div>
        </button>
        <button type="button" value="replace" class="w-full text-left rounded border border-slate-300 hover:bg-slate-50 px-4 py-3">
          <div class="font-medium text-slate-800">Replace entire database</div>
          <div class="text-sm text-red-700">Clears every existing table first, then imports.</div>
        </button>
      </div>
      <footer class="flex justify-end gap-2 px-6 py-3 border-t border-slate-200 bg-slate-50">
        <button type="button" value="cancel" class="rounded bg-slate-200 hover:bg-slate-300 px-4 py-1.5 text-sm">Cancel</button>
      </footer>
    `;
    dlg.querySelector("strong")!.textContent = filename;
    dlg.querySelector(".count")!.textContent = String(tableCount);
    const done = (v: string) => {
      dlg.close();
      dlg.remove();
      resolve(v === "cancel" ? null : (v as "overwrite" | "replace"));
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

function applyDbImport(
  parsed: Record<string, any>,
  keys: string[],
  mode: "overwrite" | "replace",
  deps: JsonImportDeps,
) {
  const { store, displayTables } = deps;

  // Close panels whose tables are about to be replaced — for "replace" that's every panel,
  // for "overwrite" only those matching incoming keys.
  const keysToClose =
    mode === "replace"
      ? store.dir({ suffix: ".table.json" }).map(([k]) => k)
      : keys.filter((k) => store.get(k));
  for (const k of keysToClose) {
    const code = k.replace(/\.table\.json$/, "");
    const el = document.getElementById("table-" + code);
    if (el) {
      const panel = el.closest(".jsPanel") as any;
      if (panel) {
        panel.options.onbeforeclose = null; // suppress the per-table "Are you sure?" confirm
        panel.close();
      }
    }
  }

  if (mode === "replace") {
    for (const [k] of store.dir({ suffix: ".table.json" })) store.delete(k);
  }

  for (const k of keys) store.set(k, parsed[k]);

  showAlert(`Imported ${keys.length} table${keys.length > 1 ? "s" : ""} from JSON.`, "success", "Import");
  displayTables();
}
