const backup = { tables: [] }; // Get from Gist backup
backup.tables.forEach(({ key, data }) => {
  var d = JSON.parse(data);
  d.columns = d.columnNames.map((c, i) => {
    return {
      field: c.toLowerCase(),
      name: c,
      type: d.columnTypes[i],
    };
  });
  delete d.columnNames;
  delete d.columnTypes;
  localStorage.setItem(key, JSON.stringify(d));
});

// List directory
Object.entries(localStorage).filter(([k, v]) => k.startsWith("/minnidbmax/default"));

// Clear directory
Object.entries(localStorage)
  .filter(([k, v]) => k.startsWith("/minnidbmax/default"))
  .forEach(([k, v]) => localStorage.removeItem(k));

// Move items to directory
Object.entries(localStorage)
  .filter(([k, v]) => k.endsWith("-list"))
  .forEach(([k, v]) => localStorage.setItem("/minnidbmax/default/" + k.replace("-list", "") + ".table.json", v));
