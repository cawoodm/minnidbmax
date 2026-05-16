// Make a <dialog> draggable by its header (or by any non-interactive area when
// no handle is supplied). The dialog stays in the browser's top layer because
// it was opened via showModal(); switching to position:fixed during drag is
// safe and lets us place it freely.
//
// Returns a cleanup function. Cleanup also runs automatically on the dialog's
// `close` event so callers that always discard the dialog after close don't
// need to do anything.

const INTERACTIVE_SELECTOR = "input, button, select, textarea, label, a, [contenteditable], .close-x";

export function makeDialogDraggable(dlg: HTMLDialogElement, handle?: HTMLElement): () => void {
  const grip = handle ?? dlg;
  if (handle) grip.style.cursor = "move";

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return; // left button only
    const t = e.target as HTMLElement;
    if (t.closest(INTERACTIVE_SELECTOR)) return;

    const rect = dlg.getBoundingClientRect();
    // Switch to explicit positioning so subsequent left/top take effect.
    // Done lazily on first drag so initial centering (via `margin: auto`)
    // is preserved until the user actually moves it.
    dlg.style.position = "fixed";
    dlg.style.margin = "0";
    dlg.style.left = rect.left + "px";
    dlg.style.top = rect.top + "px";

    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    originX = rect.left;
    originY = rect.top;
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const nextLeft = originX + (e.clientX - startX);
    const nextTop = originY + (e.clientY - startY);
    // Keep at least a 40px sliver on-screen so the dialog can't be lost.
    const w = dlg.offsetWidth;
    const h = dlg.offsetHeight;
    const minX = 40 - w;
    const minY = 0;
    const maxX = window.innerWidth - 40;
    const maxY = window.innerHeight - 40;
    dlg.style.left = Math.max(minX, Math.min(maxX, nextLeft)) + "px";
    dlg.style.top = Math.max(minY, Math.min(maxY, nextTop)) + "px";
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try {
      grip.releasePointerCapture(e.pointerId);
    } catch {}
  };

  grip.addEventListener("pointerdown", onPointerDown);
  grip.addEventListener("pointermove", onPointerMove);
  grip.addEventListener("pointerup", onPointerUp);
  grip.addEventListener("pointercancel", onPointerUp);

  const cleanup = () => {
    grip.removeEventListener("pointerdown", onPointerDown);
    grip.removeEventListener("pointermove", onPointerMove);
    grip.removeEventListener("pointerup", onPointerUp);
    grip.removeEventListener("pointercancel", onPointerUp);
  };
  dlg.addEventListener("close", cleanup, { once: true });
  return cleanup;
}
