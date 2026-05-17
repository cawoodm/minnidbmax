import { test, expect, dropFile, readTableRows, waitForPanel } from "./helpers";

test.describe("Filtering", () => {
  test.beforeEach(async ({ page }) => {
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");
    // Close the auto-opened column editor.
    await page.locator("dialog:has-text('Edit columns') button.save").click();
  });

  // Helper: open a column's filter dropdown by clicking its ▾ trigger in the header.
  const openDropdown = async (page: any, fieldIndex: number) =>
    page.locator(`#table-people button.col-filter-trigger[data-index="${fieldIndex}"]`).click();

  test("typing in the dropdown filter narrows rows live", async ({ page }) => {
    await openDropdown(page, 2);
    const input = page.locator(".column-filter-dropdown input.cfd-input");
    await expect(input).toBeVisible();
    await input.fill("Zur");

    // Two rows match Zurich.
    const rows = await readTableRows(page, "people");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r[2].toLowerCase().includes("zur"))).toBe(true);
    await expect(input).toHaveValue("Zur");
  });

  test("clearing the filter restores all rows", async ({ page }) => {
    await openDropdown(page, 2);
    const input = page.locator(".column-filter-dropdown input.cfd-input");
    await input.fill("Zurich");
    expect(await readTableRows(page, "people")).toHaveLength(2);

    await input.fill("");
    expect(await readTableRows(page, "people")).toHaveLength(5);
  });

  test("filtering on multiple columns ANDs the conditions", async ({ page }) => {
    // City filter
    await openDropdown(page, 2);
    await page.locator(".column-filter-dropdown input.cfd-input").fill("Zurich");
    // Close dropdown by clicking outside (so the next one can open)
    await page.locator(".column-filter-dropdown button.cfd-close").click();
    expect(await readTableRows(page, "people")).toHaveLength(2);

    // Age filter — narrows to just Alice
    await openDropdown(page, 1);
    await page.locator(".column-filter-dropdown input.cfd-input").fill("30");
    const rows = await readTableRows(page, "people");
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("Alice");

    // Clearing the age filter widens via AND of the remaining filters.
    await page.locator(".column-filter-dropdown input.cfd-input").fill("");
    expect(await readTableRows(page, "people")).toHaveLength(2);
  });

  test("sort coexists with active filter", async ({ page }) => {
    await openDropdown(page, 2);
    await page.locator(".column-filter-dropdown input.cfd-input").fill("Zurich");
    await page.locator(".column-filter-dropdown button.cfd-close").click();
    expect(await readTableRows(page, "people")).toHaveLength(2);

    // Click the "age" header to sort ascending.
    await page.locator("#table-people th[data-index='1'] .column-name").click();
    let rows = await readTableRows(page, "people");
    expect(rows.map((r) => r[0])).toEqual(["Alice", "Dave"]); // 30 < 35

    // Click again → descending.
    await page.locator("#table-people th[data-index='1'] .column-name").click();
    rows = await readTableRows(page, "people");
    expect(rows.map((r) => r[0])).toEqual(["Dave", "Alice"]);
  });

  test("dropdown lists all unique column values (faceted by other filters)", async ({ page }) => {
    await openDropdown(page, 2);
    const optionTexts = await page
      .locator(".column-filter-dropdown ul.cfd-list li")
      .evaluateAll((opts) => opts.map((o) => (o as HTMLElement).textContent || "").sort());
    // people.csv has 4 distinct cities.
    expect(optionTexts).toEqual(["Bern", "Geneva", "Lausanne", "Zurich"]);
  });

  test("clicking an option in the dropdown sets the filter to that value", async ({ page }) => {
    await openDropdown(page, 2);
    await page.locator(".column-filter-dropdown ul.cfd-list li", { hasText: "Geneva" }).click();
    await expect(page.locator(".column-filter-dropdown input.cfd-input")).toHaveValue("Geneva");
    const rows = await readTableRows(page, "people");
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("Bob");
  });

  test("faceted dropdown: filtering one column narrows the others' option lists", async ({ page }) => {
    await openDropdown(page, 2);
    await page.locator(".column-filter-dropdown input.cfd-input").fill("Zurich"); // restricts to Alice + Dave
    await page.locator(".column-filter-dropdown button.cfd-close").click();

    await openDropdown(page, 1);
    const ageOptions = await page
      .locator(".column-filter-dropdown ul.cfd-list li")
      .evaluateAll((opts) => opts.map((o) => (o as HTMLElement).textContent || "").sort());
    expect(ageOptions).toEqual(["30", "35"]);
  });

  test("close × dismisses the dropdown", async ({ page }) => {
    await openDropdown(page, 2);
    const dropdown = page.locator(".column-filter-dropdown");
    await expect(dropdown).toBeVisible();
    await dropdown.locator("button.cfd-close").click();
    await expect(dropdown).toHaveCount(0);
  });
});
