import { test, expect, dropFile, panelCount, readHeaders, readTableRows, waitForPanel } from "./helpers";

test.describe("Data import", () => {
  test("drop a CSV onto the empty page creates a new table", async ({ page }) => {
    // Start: empty-state visible, no panels.
    await expect(page.locator("#empty-state")).toBeVisible();
    expect(await panelCount(page)).toBe(0);

    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");

    // Headers come from the CSV header line.
    const headers = await readHeaders(page, "people");
    expect(headers).toEqual(["name", "age", "city"]);

    // All five data rows landed in order.
    const rows = await readTableRows(page, "people");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual(["Alice", "30", "Zurich"]);
    expect(rows[4]).toEqual(["Eve", "29", "Lausanne"]);

    // Empty-state hides once a panel is open.
    await expect(page.locator("#empty-state")).toBeHidden();
  });

  test("drop a second CSV creates a second independent panel", async ({ page }) => {
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");
    await dropFile(page, "products.csv");
    await waitForPanel(page, "products");

    expect(await panelCount(page)).toBe(2);
    expect(await readHeaders(page, "people")).toEqual(["name", "age", "city"]);
    expect(await readHeaders(page, "products")).toEqual(["sku", "name", "price"]);
    expect(await readTableRows(page, "products")).toHaveLength(4);
  });

  test("drop a JSON dump and choose Replace → imports every table", async ({ page }) => {
    // Pre-seed a noise table so we can confirm Replace clears it.
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");
    expect(await panelCount(page)).toBe(1);

    await dropFile(page, "db-dump.json");
    // Modal dialog appears.
    const dialog = page.locator("dialog:has-text('Import database')");
    await expect(dialog).toBeVisible();
    await dialog.locator("button[value='replace']").click();

    // Both tables from the dump render; the pre-existing "people" table is gone.
    await waitForPanel(page, "fruits");
    await waitForPanel(page, "colors");
    expect(await page.locator(".jsPanel:has(#table-people)").count()).toBe(0);
    expect(await panelCount(page)).toBe(2);

    expect(await readHeaders(page, "fruits")).toEqual(["Name", "Price", "Added"]);
    expect(await readTableRows(page, "fruits")).toHaveLength(3);
    expect(await readHeaders(page, "colors")).toEqual(["Name", "Hex"]);
  });

  test("drop a JSON dump and choose Overwrite → keeps non-overlapping tables", async ({ page }) => {
    // Pre-seed a "people" table that is NOT in the dump.
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");

    await dropFile(page, "db-dump.json");
    await page.locator("dialog:has-text('Import database') button[value='overwrite']").click();

    // people survives; fruits + colors arrive from the dump.
    await waitForPanel(page, "people");
    await waitForPanel(page, "fruits");
    await waitForPanel(page, "colors");
    expect(await panelCount(page)).toBe(3);
  });

  test("drop a JSON dump and choose Cancel → no state change", async ({ page }) => {
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");

    await dropFile(page, "db-dump.json");
    await page.locator("dialog:has-text('Import database') button[value='cancel']").click();

    expect(await panelCount(page)).toBe(1);
    expect(await page.locator(".jsPanel:has(#table-fruits)").count()).toBe(0);
  });

  test("drop a malformed JSON file → error toast, no prompt", async ({ page }) => {
    await page.evaluate(() => {
      const file = new File(["not valid json {{{"], "broken.json", { type: "application/json" });
      const dt = new DataTransfer();
      dt.items.add(file);
      ["dragenter", "dragover", "drop"].forEach((type) => {
        document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      });
    });

    // No prompt opens; a hint toast appears with "not valid JSON".
    await expect(page.locator("dialog:has-text('Import database')")).toHaveCount(0);
    await expect(page.locator(".jsPanel-hint:has-text('not valid JSON')")).toBeVisible({ timeout: 3_000 });
  });
});
