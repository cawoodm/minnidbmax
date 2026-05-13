# TODO

## UI Features
* Use tailwindcss for a nice header above
* Simpler filtering
* Instead of a fixed column the delete icon should be implemented as an elipsis "..." which appears on hover at the start of each row. When clicked, display a jsPanel context menu with the option to delete the row

## DB Features
* Strict/tolerant mode for data entry
  * In tolerant mode, invalid data is displayed but not saved/persisted and can be cleaned
  * In strict mode, invalid data is not allowed (as today)
* Import
  * When importing data to existing table, prompt to append, overwrite or cancel
  * Dump database as <workspace-name>.db.json
  * Drag and drop of a .db.json file should automatically replace the database with a "are you sure" confirmation dialog
  * Import sqlite db?