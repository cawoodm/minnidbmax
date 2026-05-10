/* global store */

// https://gist.github.com/cawoodm
// Create fine-grained token with gist scope: https://github.com/settings/apps

import { Gist } from "./gist.js";

export function SyncherGist(gistUsername, gistToken, gistId) {
  let gist = null;

  function validate() {
    gist = Gist(gistToken);
    if (!gistUsername) throw new Error("Gist user name missing.");
    if (!gistToken) throw new Error("Gist API Token missing.");
    if (!gistId) throw new Error("GistId missing.");
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
      await gist.update(gistId, {
        description: "MinniDBMax data",
        files,
      });
      console.debug("Data saved to Gist!");
    },
    async load() {
      validate();
      let res = await gist.getOne(gistId);
      let g1 = await res.json();
      Object.keys(g1.files)
        .filter((file) => file.endsWith(".table.json"))
        .forEach((file) => {
          const data = JSON.parse(g1.files[file].content);
          const table = file.replace(".table.json", "");
          if (!data) throw new Error("No data found for table: " + table);
          store.set(file, data);
        });
      console.debug("Data loaded from Gist!", `https://gist.github.com/${gistUsername}/${gistId}`);
    },
  };
}
