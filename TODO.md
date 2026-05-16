# TODO

## UI Features
* Dialogs should be centered not at the top left of the screen
* Edit raw data

## DB Features
* Shouldn't allow 2 tables of same name case-sensitive
* When importing a new table which exists prompt to overwrite, rename or cancel
  * Rename should prompt for a new name
* Column editor should preview first 100 columns below
  * It should warn about possible conversion issues when changing field types
* Strict/tolerant mode for data entry
  * In tolerant mode, invalid data is displayed but not saved/persisted and can be cleaned
  * In strict mode, invalid data is not allowed (as today)
* Import
  * Import sqlite db?

## Tech stuff
* Modularize more
* Hooks/Events for plugins
* Move to typescript completely