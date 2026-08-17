export function attachOutputContextMenu(card, item, { isVideo, onExtend }) {
  card.addEventListener("contextmenu", event => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    document.querySelectorAll(".h3-output-context-menu").forEach(menu => menu.remove());

    const menu = document.createElement("div");
    menu.className = "h3-output-context-menu";
    Object.assign(menu.style, {
      position: "fixed",
      left: `${Math.min(event.clientX, window.innerWidth - 190)}px`,
      top: `${Math.min(event.clientY, window.innerHeight - 48)}px`,
      zIndex: "100000",
      minWidth: "178px",
      padding: "4px",
      background: "#181818",
      border: "1px solid var(--h3-line2)",
      borderRadius: "7px",
      boxShadow: "0 5px 18px rgba(0,0,0,.55)",
    });
    const action = document.createElement("button");
    action.type = "button";
    action.textContent = isVideo ? "Send to Extend" : "Only videos can be extended";
    Object.assign(action.style, {
      width: "100%",
      border: "0",
      borderRadius: "5px",
      padding: "7px 9px",
      background: "transparent",
      color: isVideo ? "var(--h3-tx)" : "var(--h3-tx3)",
      textAlign: "left",
      font: "inherit",
      fontSize: "10px",
      cursor: isVideo ? "pointer" : "default",
    });
    if (isVideo) {
      action.onmouseenter = () => { action.style.background = "var(--h3accent)"; action.style.color = "#141414"; };
      action.onmouseleave = () => { action.style.background = "transparent"; action.style.color = "var(--h3-tx)"; };
      action.onclick = async () => {
        close();
        await onExtend(item);
      };
    }
    menu.appendChild(action);
    document.body.appendChild(menu);
    const close = () => {
      menu.remove();
      document.removeEventListener("click", dismiss);
      document.removeEventListener("keydown", dismissKey);
    };
    const dismiss = event => {
      if (menu.contains(event.target)) return;
      close();
    };
    const dismissKey = event => {
      if (event.key === "Escape") close();
    };
    setTimeout(() => {
      document.addEventListener("click", dismiss);
      document.addEventListener("keydown", dismissKey);
    }, 0);
  });
}