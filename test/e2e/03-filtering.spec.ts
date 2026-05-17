import { test, expect, dropFile, readTableRows, waitForPanel } from "./helpers";

test.describe("Filtering", () => {
  test.beforeEach(async ({ page }) => {
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");
    // Close the auto-opened column editor.
    await page.locator("dialog:has-text('Edit columns') button.save").click();
    // Reveal the filter row via the in-table filter toggle (first column header).
    await page.locator("#table-people button.filter-toggle").click();
  });

  test("typing in a filter narrows rows live without rebuilding the input", async ({ page }) => {
    const cityFilter = page.locator("#table-people input.filter-input[fieldIndex='2']");
    await expect(cityFilter).toBeVisible();
    await cityFilter.focus();
    await cityFilter.type("Zur");

    // Two rows match Zurich.
    const rows = await readTableRows(page, "people");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r[2].toLowerCase().includes("zur"))).toBe(true);

    // Input keeps focus & value after the partial render.
    await expect(cityFilter).toBeFocused();
    await expect(cityFilter).toHaveValue("Zur");
  });

  test("clearing the filter restores all rows", async ({ page }) => {
    const cityFilter = page.locator("#table-people input.filter-input[fieldIndex='2']");
    await cityFilter.fill("Zurich");
    expect(await readTableRows(page, "people")).toHaveLength(2);

    await cityFilter.fill("");
    expect(await readTableRows(page, "people")).toHaveLength(5);
  });

  test("filtering on multiple columns ANDs the conditions", async ({ page }) => {
    const cityFilter = page.locator("#table-people input.filter-input[fieldIndex='2']");
    const ageFilter = page.locator("#table-people input.filter-input[fieldIndex='1']");

    await cityFilter.fill("Zurich"); // matches Alice (30) + Dave (35)
    expect(await readTableRows(page, "people")).toHaveLength(2);

    await ageFilter.fill("30"); // narrows to just Alice
    const rows = await readTableRows(page, "people");
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("Alice");

    // Clearing one filter widens via AND of the remaining filters.
    await ageFilter.fill("");
    expect(await readTableRows(page, "people")).toHaveLength(2);
  });

  test("sort coexists with active filter", async ({ page }) => {
    const cityFilter = page.locator("#table-people input.filter-input[fieldIndex='2']");
    await cityFilter.fill("Zurich");
    expect(await readTableRows(page, "people")).toHaveLength(2);

    // Click the "age" header to sort ascending.
    await page.locator("#table-people th[data-index='1']").click();
    let rows = await readTableRows(page, "people");
    expect(rows.map((r) => r[0])).toEqual(["Alice", "Dave"]); // 30 < 35

    // Click again → descending.
    await page.locator("#table-people th[data-index='1']").click();
    rows = await readTableRows(page, "people");
    expect(rows.map((r) => r[0])).toEqual(["Dave", "Alice"]);
  });

  test("autocomplete datalist exposes the column's unique values", async ({ page }) => {
    const cityFilter = page.locator("#table-people input.filter-input[fieldIndex='2']");
    await expect(cityFilter).toHaveAttribute("list", "filter-list-2");

    const optionTexts = await page
      .locator("#table-people datalist#filter-list-2 option")
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).sort());
    // people.csv has 4 distinct cities: Bern, Geneva, Lausanne, Zurich.
    expect(optionTexts).toEqual(["Bern", "Geneva", "Lausanne", "Zurich"]);
  });

  test("faceted datalist: filtering one column narrows the others' suggestions", async ({ page }) => {
    const cityFilter = page.locator("#table-people input.filter-input[fieldIndex='2']");
    await cityFilter.fill("Zurich"); // restricts to Alice + Dave

    const ageOptions = await page
      .locator("#table-people datalist#filter-list-1 option")
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).sort());
    // After narrowing by city=Zurich, age dropdown only sees 30 and 35.
    expect(ageOptions).toEqual(["30", "35"]);
  });
});
