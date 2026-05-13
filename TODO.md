# TODO

## UI Features
* Dialogs should be centered not at the top left of the screen
* Move the filter icon to the header of the first column

## DB Features
* Strict/tolerant mode for data entry
  * In tolerant mode, invalid data is displayed but not saved/persisted and can be cleaned
  * In strict mode, invalid data is not allowed (as today)
* Import
  * Dump database as <workspace-name>.db.json
  * Drag and drop of a .db.json file should automatically replace the database with a "are you sure" confirmation dialog
  * Import sqlite db?