const qs = new URLSearchParams(location.search);

export const workspace: string =
  (qs.has("space") && qs.get("space")) ||
  localStorage.getItem("/minnidbmax/.currentStore") ||
  "default";

export function initWorkspaceSelect(select: HTMLSelectElement): void {
  populate(select);
  select.addEventListener("change", onChange);
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

function populate(select: HTMLSelectElement): void {
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

function switchWorkspace(name: string): void {
  if (name === workspace) return;
  localStorage.setItem("/minnidbmax/.currentStore", name);
  const url = new URL(location.href);
  url.searchParams.delete("space");
  location.replace(url.toString());
}

function onChange(e: Event): void {
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
