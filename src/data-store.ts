export interface DataStore {
  dir(opts?: { path?: string; suffix?: string }): [string, any][];
  get(key: string, defaultValue?: any): any;
  set(key: string, value: any): void;
  delete(key: string): void;
}

export function DataStore(prefix: string): DataStore {
  return {
    // List all items in a directory
    dir({ path = "/", suffix = "" } = {}): [string, any][] {
      return Object.entries(localStorage)
        .filter((k) => !prefix || k[0].startsWith(prefix))
        .filter((k) => k[0].startsWith(path))
        .filter((k) => !suffix || k[0].endsWith(suffix))
        .map(([key, value]) => [key.replace(prefix, ""), JSON.parse(value as string)] as [string, any]);
    },
    // Get contents of item
    get(key: string, defaultValue?: any): any {
      if (!key) throw new Error("Store.get failed: Key is required");
      let value: any = localStorage.getItem(prefix + key);
      try {
        value = JSON.parse(value);
      } catch {}
      if (typeof value === "undefined") value = defaultValue;
      return value;
    },
    // Write contents of item
    set(key: string, value: any): void {
      if (!key) throw new Error("Store.set failed: Key is required");
      localStorage.setItem(prefix + key, JSON.stringify(value));
    },
    // Remove item
    delete(key: string): void {
      localStorage.removeItem(prefix + key);
    },
  };
}
