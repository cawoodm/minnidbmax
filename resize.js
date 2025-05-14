"use strict";

let resizeLastZIndex = 0;

function makeDraggableAndResizable(el, callback) {
  let draggedElement = null,
    dragOffsetX = 0,
    dragOffsetY = 0;

  el.style.zIndex = ++resizeLastZIndex;

  el.addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("resizer")) return; // ignore resizers
    if (e.target.tagName == "TEXTAREA") return; // ignore texarea
    el.style.zIndex = ++resizeLastZIndex;
    draggedElement = el;
    const rect = el.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
  });

  document.addEventListener("mousemove", (e) => {
    if (draggedElement != el) return;
    el.style.left = `${e.clientX - dragOffsetX}px`;
    el.style.top = `${e.clientY - dragOffsetY}px`;
  });

  document.addEventListener("mouseup", () => {
    if (draggedElement != el) return;
    draggedElement = null;
    callback(el.getBoundingClientRect());
  });

  // Resizing
  const resizers = el.querySelectorAll(".resizer");
  let currentResizer, startX, startY, startWidth, startHeight, startLeft, startTop;

  resizers.forEach((resizer) => {
    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      currentResizer = resizer;
      const rect = el.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startWidth = rect.width;
      startHeight = rect.height;
      startLeft = rect.left;
      startTop = rect.top;
      document.addEventListener("mousemove", resize);
      document.addEventListener("mouseup", stopResize);
    });
  });

  function resize(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (currentResizer.classList.contains("br")) {
      el.style.width = `${startWidth + dx}px`;
      el.style.height = `${startHeight + dy}px`;
    } else if (currentResizer.classList.contains("bl")) {
      el.style.width = `${startWidth - dx}px`;
      el.style.left = `${startLeft + dx}px`;
      el.style.height = `${startHeight + dy}px`;
    } else if (currentResizer.classList.contains("tr")) {
      el.style.width = `${startWidth + dx}px`;
      el.style.height = `${startHeight - dy}px`;
      el.style.top = `${startTop + dy}px`;
    } else if (currentResizer.classList.contains("tl")) {
      el.style.width = `${startWidth - dx}px`;
      el.style.left = `${startLeft + dx}px`;
      el.style.height = `${startHeight - dy}px`;
      el.style.top = `${startTop + dy}px`;
    }
  }

  function stopResize() {
    callback(el.getBoundingClientRect());
    document.removeEventListener("mousemove", resize);
    document.removeEventListener("mouseup", stopResize);
  }
}
