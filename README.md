# MinniDBMax
Simple database with CSV import/export for viewing, managing structured data in a windowed-interface

Check it out at: http://cawoodm.github.io/minnidbmax/

Check out all features in the [Change Log](./CHANGELOG.md).

![Screenshot of MinniDBMax](./docs/screenshot1.png)

## How to Use
To begin, simply drag in a .csv file.
Alternatively create a new table, enter some CSV data and press Enter to import. 
You can press Shift+Enter to add more than one line

The first time you paste data the first row is used to infer data types (string, number, date, bool).    
![Import CSV](./docs/screenshot_import_csv.png)

You can however start with a header line the first time you import data (before any columns are defined):  
![Import Manually](./docs/screenshot-header.png)  
Note you can specify a different label for the column from the technical field name as well as the type, default and max length:
* `foo:Foo:number:1` Field name `foo` with label `Foo` of type `number` and default `1`

## Data Validation
Each field has attributes separated by `:` which are:
1. Field Name (technical name)
2. Field Label (displayed)
3. Field Type
4. Default value
5. Max length of field (for strings)
6. Flags:
  * unique: Ensure the value in this field is unique in the table
  * notnull: Ensure the value is never empty in this field in the table

By defining attributes on a field we can control what kind of data will appear in that field.
* `sales_id::string::12` Field name `sales_id` is of type `string` , and a max length of `12`
* `id::number:::unique,notnull` Field `id` is of type `number`, must be unique and may not be empty (a primary key)

Setting number explicitly aids with proper sorting and data validation:
![Sorting](./docs/screenshot_sorting.png)

Click filter to filter columns, enter a search term and press enter:  
![Filtering](./docs/screenshot_filter.png)

### Column Types
* Data identified as boolean will be rendered as a checkbox
* Data which looks like an HTML color (e.g. "#FF0000") will be rendered as a color swatch
* Data which looks like an HTML image (e.g. "data:image/png;base64,iVBO...") will be rendered as an image
* Data identified as numbers will be sorted numerically


### Other:

* Double click a column label to rename it.
  * When you first import data the fields: field_1, field_2 etc... are automatically created with labels "Column 1", "Column 2" etc.
  * The first time you rename a column, the label is converted to a field name
* Click delete icon to delete a row
* Click the window close icon to delete a table
* Switch workspaces in the top left or create a new workspace

## Data Storage
Every change is immediately stored in your browsers `localStorage`.
In order to Push/Pull data you need to [create](http://gist.github.com/) a (preferably Secret) Gist and supply the GistID and an [API token](https://docs.github.com/en/rest/gists/gists?apiVersion=2022-11-28#list-gists-for-the-authenticated-user) by entering them in your JS Console (press Ctrl+Shift+I or F12):
* `localStorage.setItem('minnidb-gist-token', 'github_pat_***')`
* `localStorage.setItem('minnidb-gist-id', 'c4c***')`
You will now be able to synch your data with this Gist for free on Github.

### Limitations
* Gist files are limited to 1MB [See API Reference](https://docs.github.com/en/rest/gists/gists?utm_source=chatgpt.com&apiVersion=2026-03-10#truncation) so tables above 1Mb won't be synched properly
