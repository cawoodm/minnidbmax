# TODO

## UI Features
* Use tailwindcss for a nice header above
* Simpler filtering
* Instead of a fixed column the delete icon should be implemented as an elipsis "..." which appears on hover at the start of each row. When clicked, display a jsPanel context menu with the option to delete the row

## DB Features
* Implement primary/unique keys
* Persist z-order of windows
* Auto detect MM/DD/YYYY dates as well as DD/MM/YYYY. Convert the values to canonical YYYY-MM-DD on import/save.
* Import
  * When importing data to existing table, prompt to append, overwrite or cancel
  * Drag any csv file into window
  * Import sqlite db?