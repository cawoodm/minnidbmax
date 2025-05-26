import { Gist } from "./gist.js";

export function SyncherGist(gistUsername, gistToken, gistStorageKey) {
  const gist = Gist(gistToken);

  function validate() {
    if (!gistUsername) throw new Error("Gist user name not found in browser store.");
    if (!gistToken) throw new Error("Gist token not found in browser store.");
    if (!gistStorageKey) throw new Error("Gist token not found in browser store.");
  }

  return {
    async save() {
      validate();
      let files = {};
      store.dir({ suffix: ".table.json" }).forEach(([key, data]) => {
        files[key] = {
          type: "application/json",
          filename: key,
          content: JSON.stringify(data, null, 2),
        };
      });
      await gist.update(gistStorageKey, {
        description: "MinniDBMax data",
        files,
      });
      console.debug("Data saved to Gist!");
    },
    async load() {
      validate();
      let res = await gist.getOne(gistStorageKey);
      let g1 = await res.json();
      Object.keys(g1.files)
        .filter((file) => file.endsWith(".table.json"))
        .forEach((file) => {
          const data = JSON.parse(g1.files[file].content);
          const table = file.replace(".table.json", "");
          if (!data) throw new Error("No data found for table: " + table);
          store.set(file, data);
          let el = document.querySelector("#table-" + table);
          if (!el) {
            try {
              createTable(table, data);
            } catch (e) {
              alert(`Error loading table (${table}) data:`, e.message);
            }
          } else {
            el.refresh();
            //el.importData(JSON.parse(table.data));
          }
        });
      console.debug("Data loaded from Gist!", `https://gist.github.com/${gistUsername}/${gistStorageKey}`);
    },
  };
}
