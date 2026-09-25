// Stack sub-card for the Advanced LoRA section.
//
// A stack is a named LoRA set (name + strength per row) kept in the node's own
// saved settings. This module owns the stack picker, the Save as new / Save /
// Delete actions, the name entry and the confirmation dialog for replace and
// delete. It only ever rewrites the saved stacks object, so no LoRA file,
// folder or note on disk is read, written or removed here.

let _activeConfirm = null;

// opts: { mk, tx, theme, DD, helpers, stacks, setStacks, loras, items, apply, onCount }
// helpers: { loraStackNames, loraStackFindName, loraStackSafeName, loraStackSame,
//            loraStackRowsWithMissing, loraStackSave, loraStackLoad }
export function createLoraStacks(opts) {
  const { mk, tx, DD } = opts;
  const C = opts.theme;
  const H = opts.helpers || {};
  const PLACEHOLDER = "Select a stack...";

  let selected = "";
  let mode = "new";
  let updating = false;
  let statusTimer = 0;
  let busy = false;

  const wrap = mk("div", { display: "flex", flexDirection: "column", gap: "5px" });

  const pickRow = mk("div", { display: "flex", alignItems: "center", gap: "6px" });
  const dd = DD([PLACEHOLDER], PLACEHOLDER, (v) => {
    if (updating) return;
    if (v === PLACEHOLDER) { selected = ""; _sync(); return; }
    _load(v);
  });

  const miniBtn = (label, title, danger) => {
    const b = mk("button", {
      fontSize: "9px", fontWeight: "700",
      color: danger ? "#e05555" : C.muted,
      border: `1px solid ${danger ? "rgba(224,85,85,.45)" : C.border}`,
      background: "transparent", borderRadius: "6px", padding: "2px 8px",
      cursor: "pointer", outline: "none", flexShrink: "0",
    }, { type: "button", title: title || "" });
    tx(b, label);
    b.onmouseenter = () => { if (b.disabled) return; b.style.borderColor = danger ? "#e05555" : C.lime; b.style.color = danger ? "#ff8080" : C.lime; };
    b.onmouseleave = () => { b.style.borderColor = danger ? "rgba(224,85,85,.45)" : C.border; b.style.color = danger ? "#e05555" : C.muted; };
    return b;
  };

  const newBtn = miniBtn("+ Save as new", "Save the current LoRA set as a new stack");
  const saveBtn = miniBtn("Save", "Update or rename the selected stack");
  const delBtn = miniBtn("Delete", "Delete the selected stack", true);
  pickRow.append(dd.el, newBtn, saveBtn, delBtn);

  const nameRow = mk("div", { display: "none", alignItems: "center", gap: "6px" });
  const nameIn = mk("input", {
    flex: "1", minWidth: "0", height: "24px", background: C.bg2,
    border: `1px solid ${C.border}`, borderRadius: "6px", color: C.text,
    fontSize: "10px", padding: "0 8px", outline: "none", boxSizing: "border-box",
  }, { type: "text", placeholder: "Stack name", maxLength: 60 });
  const nameOk = miniBtn("Create", "Confirm the stack name");
  const nameCancel = miniBtn("Cancel", "Cancel");
  nameRow.append(nameIn, nameOk, nameCancel);

  const hint = mk("div", { fontSize: "9px", color: C.dim, lineHeight: "1.4" });
  wrap.append(pickRow, nameRow, hint);

  const _stacks = () => {
    const s = opts.stacks ? opts.stacks() : null;
    return s && typeof s === "object" ? s : {};
  };
  const _named = () => (opts.loras ? opts.loras() : []).filter((l) => l && typeof l.name === "string" && l.name);

  const _defaultHint = () => {
    if (!H.loraStackNames(_stacks()).length) {
      tx(hint, "No saved stacks yet. Set up your LoRAs, then hit Save as new.");
    } else if (!selected) {
      tx(hint, "Pick a stack to load it, or save the current set as a new one.");
    } else {
      tx(hint, "");
    }
    hint.style.color = C.dim;
  };

  const _setStatus = (text, warn) => {
    tx(hint, text);
    hint.style.color = warn ? C.warn : C.dim;
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = 0; }
    if (text) statusTimer = setTimeout(() => { statusTimer = 0; _defaultHint(); }, 4000);
  };

  const _sync = () => {
    const names = H.loraStackNames(_stacks());
    const exact = selected ? names.find((n) => n.toLowerCase() === selected.toLowerCase()) : null;
    selected = exact || "";
    updating = true;
    if (names.length) {
      dd.el.style.display = "";
      dd.updateItems([PLACEHOLDER].concat(names));
      dd.set(exact || PLACEHOLDER);
    } else {
      dd.el.style.display = "none";
      dd.updateItems([PLACEHOLDER]);
    }
    updating = false;
    saveBtn.style.display = selected ? "" : "none";
    delBtn.style.display = selected ? "" : "none";
    if (opts.onCount) opts.onCount(names.length);
    if (!statusTimer) _defaultHint();
  };

  const _load = (name) => {
    const rows = H.loraStackLoad(_stacks(), name);
    if (!rows || !rows.length) { _setStatus(`'${name}' is empty.`, true); return; }
    const check = H.loraStackRowsWithMissing(rows, opts.items ? opts.items() : []);
    if (!check.rows.length) { _setStatus(`'${name}' only holds LoRAs that are no longer installed.`, true); return; }
    if (opts.apply) opts.apply(check.rows);
    selected = name;
    _sync();
    if (check.missing.length) _setStatus(`Loaded '${name}'. Skipped ${check.missing.length} LoRA(s) that are no longer installed.`, true);
    else _setStatus(`Loaded '${name}'.`);
  };

  const _syncNameBtn = () => {
    const clean = H.loraStackSafeName(nameIn.value);
    const existing = clean ? H.loraStackFindName(_stacks(), clean) : null;
    let label = "Create";
    if (!clean) label = "Save";
    else if (selected && existing && existing.toLowerCase() === selected.toLowerCase()) label = "Update";
    else if (existing) label = "Replace";
    else if (mode === "save" && selected && clean.toLowerCase() !== selected.toLowerCase()) label = "Rename";
    else if (mode === "save" && selected) label = "Update";
    tx(nameOk, label);
    nameOk.disabled = !clean;
    nameOk.style.opacity = clean ? "1" : ".4";
    nameOk.style.cursor = clean ? "pointer" : "default";
  };

  const _openName = (value, m) => {
    mode = m || "new";
    nameRow.style.display = "flex";
    nameIn.value = value || "";
    _syncNameBtn();
    nameIn.focus();
    if (nameIn.select) nameIn.select();
  };

  const _closeName = () => { nameRow.style.display = "none"; nameIn.value = ""; };

  const _commitName = async () => {
    if (busy) return;
    const clean = H.loraStackSafeName(nameIn.value);
    if (!clean) { _setStatus("Enter a stack name first.", true); return; }
    const named = _named();
    if (!named.length) { _setStatus("Add at least one LoRA before saving a stack.", true); return; }
    const stacksNow = _stacks();
    const existing = H.loraStackFindName(stacksNow, clean);
    const isUpdate = mode === "save" && selected && clean.toLowerCase() === selected.toLowerCase();
    const sameRows = isUpdate && H.loraStackSame(H.loraStackLoad(stacksNow, selected) || [], named);
    if (isUpdate && clean === selected && sameRows) {
      _closeName();
      _setStatus("No changes to save.");
      return;
    }
    if (!existing && !isUpdate && H.loraStackNames(stacksNow).length >= 50) {
      _setStatus("Stack limit reached (50). Delete one first.", true);
      return;
    }
    busy = true;
    try {
      if (existing && !isUpdate) {
        const ok = await showStackConfirm({
          mk, tx, theme: C,
          title: "Replace stack",
          message: `A stack named '${existing}' already exists. Replace its saved LoRAs with the current set?`,
          okLabel: "Replace",
        });
        if (!ok) return;
      }
      const next = { ...stacksNow };
      if (mode === "save" && selected && selected !== clean && next[selected] !== undefined) delete next[selected];
      if (existing && existing !== clean && next[existing] !== undefined) delete next[existing];
      opts.setStacks(H.loraStackSave(next, clean, named));
      const verb = isUpdate ? (clean === selected ? "Updated" : "Renamed to") : (mode === "save" && selected ? "Renamed to" : "Saved");
      selected = clean;
      _closeName();
      _sync();
      _setStatus(`${verb} '${clean}'.`);
    } finally {
      busy = false;
    }
  };

  const _deleteSelected = async () => {
    const name = selected;
    if (!name || busy) return;
    busy = true;
    try {
      const ok = await showStackConfirm({
        mk, tx, theme: C,
        title: "Delete stack",
        message: `Delete the saved stack '${name}'?`,
        okLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const next = { ..._stacks() };
      if (next[name] !== undefined) delete next[name];
      opts.setStacks(next);
      selected = "";
      _closeName();
      _sync();
      _setStatus(`Deleted '${name}'.`);
    } finally {
      busy = false;
    }
  };

  newBtn.onclick = () => {
    if (nameRow.style.display === "flex" && mode === "new") { _closeName(); return; }
    _openName("", "new");
  };
  saveBtn.onclick = () => {
    if (!selected) return;
    if (nameRow.style.display === "flex" && mode === "save") { _closeName(); return; }
    _openName(selected, "save");
  };
  delBtn.onclick = () => { _deleteSelected(); };
  nameIn.oninput = _syncNameBtn;
  nameIn.onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); _commitName(); }
    else if (e.key === "Escape") { e.preventDefault(); _closeName(); }
  };
  nameCancel.onclick = () => _closeName();
  nameOk.onclick = () => _commitName();

  _sync();

  return { el: wrap, refresh: _sync, load: _load, openName: _openName };
}

// Themed confirmation dialog, so replace and delete never happen silently.
export function showStackConfirm(c) {
  return new Promise((resolve) => {
    const { mk, tx } = c;
    const C = c.theme;
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      if (_activeConfirm === finish) _activeConfirm = null;
      document.removeEventListener("keydown", onKey, true);
      if (dim.parentNode) dim.parentNode.removeChild(dim);
      if (card.parentNode) card.parentNode.removeChild(card);
      resolve(val);
    };
    if (_activeConfirm) _activeConfirm(false);
    _activeConfirm = finish;
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); finish(false); } };

    const danger = !!c.danger;
    const dim = mk("div", { position: "fixed", inset: "0", background: "rgba(0,0,0,.55)", zIndex: "2147483100" });
    const card = mk("div", {
      position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)",
      width: "min(92vw,420px)", display: "flex", flexDirection: "column",
      background: C.bg1, border: `1px solid ${C.borderH}`, borderRadius: "10px",
      boxShadow: "0 18px 60px rgba(0,0,0,.95)", overflow: "hidden", zIndex: "2147483150",
    });
    const head = mk("div", { padding: "11px 13px", fontSize: "12px", fontWeight: "700", color: C.text, borderBottom: `1px solid ${C.border}` });
    tx(head, c.title || "Confirm");
    const body = mk("div", { padding: "12px 13px", fontSize: "11px", lineHeight: "1.55", color: C.muted, whiteSpace: "pre-wrap" });
    tx(body, c.message || "");
    const row = mk("div", { display: "flex", justifyContent: "flex-end", gap: "7px", padding: "10px 13px", borderTop: `1px solid ${C.border}` });
    const no = mk("button", {
      fontSize: "10px", fontWeight: "700", color: C.muted, border: `1px solid ${C.border}`,
      background: "transparent", borderRadius: "6px", padding: "3px 11px", cursor: "pointer", outline: "none",
    }, { type: "button" });
    tx(no, "Cancel");
    const yes = mk("button", {
      fontSize: "10px", fontWeight: "700", color: danger ? "#ff8080" : C.lime,
      border: `1px solid ${danger ? "rgba(255,128,128,.55)" : C.borderH}`,
      background: "transparent", borderRadius: "6px", padding: "3px 11px", cursor: "pointer", outline: "none",
    }, { type: "button" });
    tx(yes, c.okLabel || "Confirm");
    row.append(no, yes);
    card.append(head, body, row);
    dim.onclick = () => finish(false);
    no.onclick = () => finish(false);
    yes.onclick = () => finish(true);
    document.addEventListener("keydown", onKey, true);
    document.body.append(dim, card);
    yes.focus();
  });
}
