import { test, expect, dropFile, waitForPanel } from "./helpers";

test.describe("Data export", () => {
  test("footer Export CSV downloads the table as CSV", async ({ page }) => {
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");
    await page.locator("dialog:has-text('Edit columns') button.save").click();

    // Click the Export CSV footer icon. Two icons in the footer: file_upload (import) and
    // file_download (export). Match by title attribute to be precise.
    const exportBtn = page.locator(".jsPanel:has(#table-people) .jsPanel-ftr button[title='Export CSV']");
    await expect(exportBtn).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await exportBtn.click();
    const dl = await downloadPromise;
    expect(dl.suggestedFilename()).toBe("people.csv");

    // Read the downloaded contents and verify header + a known row.
    const path = await dl.path();
    const content = path
      ? await (await import("node:fs/promises")).readFile(path, "utf8")
      : await new Promise<string>((resolve) => {
          const r = dl.createReadStream();
          if (!r) return resolve("");
          let buf = "";
          r.on("data", (c) => (buf += c.toString()));
          r.on("end", () => resolve(buf));
        });
    const lines = content.trim().split("\n");
    expect(lines[0]).toBe("name,age,city");
    expect(lines).toContain("Alice,30,Zurich");
    expect(lines).toContain("Eve,29,Lausanne");
  });

  test("header 'Dump' downloads the entire workspace as <workspace>.db.json", async ({ page, workspace }) => {
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");
    await page.locator("dialog:has-text('Edit columns') button.save").click();
    await dropFile(page, "products.csv");
    await waitForPanel(page, "products");
    await page.locator("dialog:has-text('Edit columns') button.save").click();

    const downloadPromise = page.waitForEvent("download");
    await page.locator("#dataDump").click();
    const dl = await downloadPromise;
    expect(dl.suggestedFilename()).toBe(`${workspace}.db.json`);

    const path = await dl.path();
    const text = path
      ? await (await import("node:fs/promises")).readFile(path, "utf8")
      : "";
    const parsed = JSON.parse(text);
    expect(Object.keys(parsed).sort()).toEqual(["people.table.json", "products.table.json"]);
    expect(parsed["people.table.json"].dataArray).toHaveLength(5);
    expect(parsed["products.table.json"].dataArray).toHaveLength(4);
    expect(parsed["people.table.json"].columns[0].field).toBe("name");
  });

  test("export → re-import round-trip yields the same data", async ({ page, workspace }) => {
    // Build a 2-table workspace.
    await dropFile(page, "people.csv");
    await waitForPanel(page, "people");
    await page.locator("dialog:has-text('Edit columns') button.save").click();
    await dropFile(page, "products.csv");
    await waitForPanel(page, "products");
    await page.locator("dialog:has-text('Edit columns') button.save").click();

    // Dump it.
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#dataDump").click();
    const dl = await downloadPromise;
    const path = await dl.path();
    const content = path ? await (await import("node:fs/promises")).readFile(path, "utf8") : "";

    // Switch to a fresh workspace via URL so we start empty.
    const targetWs = workspace + "-replay";
    await page.goto(`/?space=${targetWs}`);
    await expect(page.locator("#empty-state")).toBeVisible();

    // Drop the dump and pick Replace.
    await page.evaluate((dump) => {
      const file = new File([dump], "dump.json", { type: "application/json" });
      const dt = new DataTransfer();
      dt.items.add(file);
      ["dragenter", "dragover", "drop"].forEach((type) => {
        document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      });
    }, content);
    await page.locator("dialog:has-text('Import database') button[value='replace']").click();

    await waitForPanel(page, "people");
    await waitForPanel(page, "products");

    // Clean up the replay workspace too.
    await page.evaluate((prefix) => {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) toRemove.push(k);
      }
      for (const k of toRemove) localStorage.removeItem(k);
    }, `/minnidbmax/${targetWs}/`);
  });
});
