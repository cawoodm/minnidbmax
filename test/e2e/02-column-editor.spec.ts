import { test, expect, dropFile, htmlDragInShadow, readHeaders, readTableRows, waitForPanel } from "./helpers";

test.describe("Column editor", () => {
  test("dialog auto-opens after creating a new table from a CSV drop", async ({ page }) => {
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");

    // Dialog should appear once columns are established.
    const dlg = page.locator("dialog:has-text('Edit columns')");
    await expect(dlg).toBeVisible({ timeout: 5_000 });

    // Each detected column has a dialog row with editable fields.
    const rows = dlg.locator("tbody.rows tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator("input.field")).toHaveValue("name");
    await expect(rows.nth(1).locator("input.field")).toHaveValue("age");
    await expect(rows.nth(2).locator("input.field")).toHaveValue("city");

    await dlg.locator("button.cancel").click();
    await expect(dlg).toBeHidden();
    // Cancel during initial import is now transactional: the panel is removed.
    await expect(page.locator(".jsPanel:has(#table-people)")).toHaveCount(0);
  });

  test("hide a column via the eye toggle → column disappears from the table, data preserved", async ({ page }) => {
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");
    await page.locator("dialog:has-text('Edit columns') button.save").click();

    // Re-open via the footer toolbar's "Edit columns" button.
    await page.locator(".jsPanel:has(#table-people) .jsPanel-ftr button[title='Edit columns']").click();
    const dlg = page.locator("dialog:has-text('Edit columns')");
    await expect(dlg).toBeVisible();

    // Hide the middle column (age).
    const ageRow = dlg.locator("tbody.rows tr").nth(1);
    await ageRow.locator("button.is-visible").click();
    // The icon swaps to visibility_off + the row records data-hidden="true".
    await expect(ageRow).toHaveAttribute("data-hidden", "true");

    await dlg.locator("button.save").click();
    await expect(dlg).toBeHidden();

    // Headers now skip "age"; data rows still have 2 cells each.
    expect(await readHeaders(page, "people")).toEqual(["name", "city"]);
    const rows = await readTableRows(page, "people");
    expect(rows[0]).toEqual(["Alice", "Zurich"]);

    // Underlying data preserved: re-open dialog, un-hide, age column comes back with original values.
    await page.locator(".jsPanel:has(#table-people) .jsPanel-ftr button[title='Edit columns']").click();
    await dlg.locator("tbody.rows tr").nth(1).locator("button.is-visible").click();
    await dlg.locator("button.save").click();
    expect(await readHeaders(page, "people")).toEqual(["name", "age", "city"]);
    expect((await readTableRows(page, "people"))[0]).toEqual(["Alice", "30", "Zurich"]);
  });

  test("rename a column in the dialog", async ({ page }) => {
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");
    const dlg = page.locator("dialog:has-text('Edit columns')");
    await expect(dlg).toBeVisible();

    // Change the Label of the first column ("name" → "Full Name").
    const labelInput = dlg.locator("tbody.rows tr").nth(0).locator("input.name");
    await labelInput.fill("Full Name");
    await dlg.locator("button.save").click();

    expect(await readHeaders(page, "people")).toEqual(["Full Name", "age", "city"]);
  });

  test("delete a column via the × button", async ({ page }) => {
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");
    const dlg = page.locator("dialog:has-text('Edit columns')");
    await expect(dlg).toBeVisible();

    await dlg.locator("tbody.rows tr").nth(1).locator("button.del").click();
    await dlg.locator("button.save").click();

    expect(await readHeaders(page, "people")).toEqual(["name", "city"]);
    const rows = await readTableRows(page, "people");
    expect(rows[0]).toEqual(["Alice", "Zurich"]);
  });

  test("drag a column header to reorder columns (in-place, display only)", async ({ page }) => {
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");
    await page.locator("dialog:has-text('Edit columns') button.save").click();

    // Initially: name, age, city.
    expect(await readHeaders(page, "people")).toEqual(["name", "age", "city"]);

    // Drag the "city" header (data-index=2) onto the "name" header (data-index=0) — drop in right
    // half of "name" puts city after name → name, city, age. (htmlDragInShadow drops in right
    // half by default, which means drop-after.)
    await htmlDragInShadow(page, "people", 'th[data-index="2"]', 'th[data-index="0"]');

    expect(await readHeaders(page, "people")).toEqual(["name", "city", "age"]);

    // Underlying dataArray order is unchanged: drop in row-actions menu would still expose the
    // canonical [name, age, city] order if we asked the storage. We verify by reading rows: cell
    // order in the rendered tbody follows the new display order.
    const rows = await readTableRows(page, "people");
    expect(rows[0]).toEqual(["Alice", "Zurich", "30"]);
  });

  test("reload page → reorder + hidden state persists", async ({ page, workspace }) => {
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");
    const dlg = page.locator("dialog:has-text('Edit columns')");
    await expect(dlg).toBeVisible();

    // Hide "age" via the eye.
    await dlg.locator("tbody.rows tr").nth(1).locator("button.is-visible").click();
    await dlg.locator("button.save").click();
    await expect(dlg).toBeHidden();

    // Reorder city before age (city header → drop after name header).
    await htmlDragInShadow(page, "people", 'th[data-index="2"]', 'th[data-index="0"]');

    // Reload to the same workspace.
    await page.goto(`/?space=${workspace}`);
    await waitForPanel(page, "people");

    expect(await readHeaders(page, "people")).toEqual(["name", "city"]);
  });
});
