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
