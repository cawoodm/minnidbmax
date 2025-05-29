export function DataStore(prefix) {
  return {
    // List all items in a directory
    dir({ path = "/", suffix = "" } = {}) {
      return Object.entries(localStorage)
        .filter((k) => !prefix || k[0].startsWith(prefix))
        .filter((k) => k[0].startsWith(path))
        .filter((k) => !suffix || k[0].endsWith(suffix))
        .map(([key, value]) => [key.replace(prefix, ""), JSON.parse(value)]);
    },
    // Get contents of item
    get(key) {
      if (!key) throw new Error("Store.get failed: Key is required");
      let value = localStorage.getItem(prefix + key);
      try {
        value = JSON.parse(value);
      } catch {}
      if (typeof value === "undefined") value = defaultValue;
      return value;
    },
    // Write contents of item
    set(key, value) {
      if (!key) throw new Error("Store.set failed: Key is required");
      localStorage.setItem(prefix + key, JSON.stringify(value));
    },
    // Remove item
    delete(key) {
      localStorage.removeItem(prefix + key);
    },
  };
}
