import { test as base, expect, Page, Locator } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Each test runs in a unique workspace via `?space=e2e-<random>` so parallel
 * tests don't share localStorage state. We also `localStorage.clear()` on the
 * NEW workspace before the test runs, in case a previous run crashed mid-way.
 */
export const test = base.extend<{ workspace: string }>({
  workspace: async ({}, use, testInfo) => {
    const ws = `e2e-${testInfo.testId.slice(0, 8)}-${Date.now().toString(36)}`;
    await use(ws);
  },
  page: async ({ page, workspace }, use) => {
    await page.goto(`/?space=${workspace}`);
    // Wait for the empty-state to be present (boot complete).
    await page.locator("#empty-state").waitFor();
    await use(page);
    // Cleanup: remove this workspace's keys from localStorage.
    await page.evaluate((prefix) => {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) toRemove.push(k);
      }
      for (const k of toRemove) localStorage.removeItem(k);
    }, `/minnidbmax/${workspace}/`);
  },
});

export { expect };

const fixturesDir = resolve(__dirname, "fixtures");

/**
 * Drop a file from disk onto a DOM target. Constructs a `DataTransfer` inside
 * the page, dispatches the standard drag sequence on the target selector.
 *
 * The app's drop handler is wired on `document`, so dropping on `body` works
 * for "drop on empty page" → new table. Pass a panel selector to route into
 * an existing panel (CSV-on-panel flow).
 */
export async function dropFile(page: Page, fixtureName: string, targetSelector = "body"): Promise<void> {
  const buffer = readFileSync(resolve(fixturesDir, fixtureName));
  const mimeType = fixtureName.endsWith(".json") ? "application/json" : "text/csv";
  await page.evaluate(
    async ({ name, mimeType, bytes, targetSelector }) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
      const file = new File([blob], name, { type: mimeType });
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.querySelector(targetSelector) || document.body;
      ["dragenter", "dragover", "drop"].forEach((type) => {
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
        target.dispatchEvent(ev);
      });
    },
    { name: fixtureName, mimeType, bytes: Array.from(buffer), targetSelector },
  );
}

/** Drop a JSON string as a synthetic .json file. Used when we don't want to ship a fixture. */
export async function dropJsonContent(page: Page, filename: string, jsonObj: any, targetSelector = "body"): Promise<void> {
  const content = JSON.stringify(jsonObj);
  await page.evaluate(
    ({ filename, content, targetSelector }) => {
      const file = new File([content], filename, { type: "application/json" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.querySelector(targetSelector) || document.body;
      ["dragenter", "dragover", "drop"].forEach((type) => {
        const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
        target.dispatchEvent(ev);
      });
    },
    { filename, content, targetSelector },
  );
}

/** Locator for the (sole) data-entry-table custom element. */
export function table(page: Page): Locator {
  return page.locator("data-entry-table");
}

/** Locator for a panel whose embedded table has the given storage code. */
export function panel(page: Page, code: string): Locator {
  return page.locator(`.jsPanel:has(#table-${code})`);
}

/** Count of currently rendered jsPanel windows. */
export async function panelCount(page: Page): Promise<number> {
  return page.locator(".jsPanel-standard").count();
}

/** Wait for a panel for the given code to exist. */
export async function waitForPanel(page: Page, code: string): Promise<Locator> {
  const p = panel(page, code);
  await p.waitFor({ state: "visible" });
  return p;
}

/**
 * Read all visible data-row cell texts from a panel's table. Returns rows in
 * displayed order; each row is an array of cell text strings (skipping the
 * row-actions gutter cell).
 */
export async function readTableRows(page: Page, code: string): Promise<string[][]> {
  const trLocator = page.locator(`#table-${code}`).locator("tr.data-row");
  const count = await trLocator.count();
  const rows: string[][] = [];
  for (let i = 0; i < count; i++) {
    const cells = await trLocator
      .nth(i)
      .locator("td:not(.row-actions)")
      .allInnerTexts();
    rows.push(cells.map((c) => c.trim()));
  }
  return rows;
}

/** Read visible column header texts (skipping the row-actions gutter). */
export async function readHeaders(page: Page, code: string): Promise<string[]> {
  const labels = await page
    .locator(`#table-${code}`)
    .locator("th[data-index] .column-name")
    .allInnerTexts();
  return labels.map((s) => s.trim());
}

/**
 * Simulate an HTML5 drag-and-drop between two elements. Playwright's
 * built-in `dragTo` is unreliable for native HTML5 drag because Chromium needs
 * a real OS drag operation; dispatching events manually inside the page works.
 */
export async function htmlDrag(page: Page, sourceSelector: string, targetSelector: string): Promise<void> {
  await page.evaluate(
    ({ sourceSelector, targetSelector }) => {
      const src = document.querySelector(sourceSelector) as HTMLElement;
      const tgt = document.querySelector(targetSelector) as HTMLElement;
      if (!src || !tgt) throw new Error("htmlDrag source/target not found");
      const dt = new DataTransfer();
      const srcRect = src.getBoundingClientRect();
      const tgtRect = tgt.getBoundingClientRect();
      src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: srcRect.left + 5, clientY: srcRect.top + 5 }));
      tgt.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tgtRect.left + 5, clientY: tgtRect.top + 5 }));
      tgt.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tgtRect.left + 5, clientY: tgtRect.top + 5 }));
      tgt.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tgtRect.left + 5, clientY: tgtRect.top + 5 }));
      src.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { sourceSelector, targetSelector },
  );
}

/**
 * Drag-and-drop on shadow-DOM-piercing selectors inside a panel. Resolves the
 * elements via document.querySelector(`#table-${code}`)?.shadowRoot.querySelector(...).
 */
export async function htmlDragInShadow(page: Page, code: string, sourceSelector: string, targetSelector: string): Promise<void> {
  await page.evaluate(
    ({ code, sourceSelector, targetSelector }) => {
      const el = document.getElementById("table-" + code) as any;
      const root: ShadowRoot = el?.shadowRoot;
      if (!root) throw new Error("shadow root not found for " + code);
      const src = root.querySelector(sourceSelector) as HTMLElement;
      const tgt = root.querySelector(targetSelector) as HTMLElement;
      if (!src || !tgt) throw new Error("htmlDragInShadow source/target not found");
      const dt = new DataTransfer();
      const tgtRect = tgt.getBoundingClientRect();
      src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
      // dragover with clientX in the right half → drop after; left half → drop before.
      tgt.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tgtRect.left + tgtRect.width * 0.75, clientY: tgtRect.top + 5 }));
      tgt.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tgtRect.left + tgtRect.width * 0.75, clientY: tgtRect.top + 5 }));
      src.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { code, sourceSelector, targetSelector },
  );
}
