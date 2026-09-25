// LoRA picker for the One Node MiniMax H3 Advanced card.
//
// A real LoRA folder is deep, mixed-model and long ("MiniMax H3\Speed Loras\
// Kijai\Ref2v\..." next to Wan and Flux packs), so the shared DD dropdown
// becomes an unreadable wall of paths where the filename is the part that gets
// truncated. This module owns the LoRA-specific browser instead: two-line rows
// (name on top, folder below), multi-token search with match highlighting,
// All / H3 only / Favorites / Recent / folder scopes, star toggles, and an
// inline viewer for the `<lora>.txt` info note saved beside the file.
//
// It draws with the bundle's own mk()/tx() helpers and theme object (passed in
// as opts) so it inherits the node styling without importing the bundle. The
// pure list math lives in h3_helpers.mjs and is injected through opts.helpers,
// the same pattern the other web/ feature modules use.

let _activePickerClose = null;

// Info notes are small text files, but caching keeps re-opening instant and
// avoids hammering the route while the user browses a folder.
const _infoCache = new Map();

function _partsOf(name) {
  const full = String(name == null ? "" : name).replace(/\\/g, "/");
  const i = full.lastIndexOf("/");
  const file = i >= 0 ? full.slice(i + 1) : full;
  const dir = i >= 0 ? full.slice(0, i) : "";
  const stem = file.replace(/\.(safetensors|ckpt|pt|pth|gguf)$/i, "");
  return { name: file, stem, dir, full };
}

function _norm(name) {
  return String(name == null ? "" : name).replace(/\\/g, "/").toLowerCase();
}

async function _copyText(text, btn, tx) {
  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (e) {
    ok = false;
  }
  if (!ok) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = !!document.execCommand && document.execCommand("copy");
      ta.remove();
    } catch (e) {
      ok = false;
    }
  }
  tx(btn, ok ? "Copied" : "Copy failed");
  setTimeout(() => { tx(btn, "Copy"); }, 1200);
}

function _writeHighlighted(mk, el, text, tokens, accent) {
  el.textContent = "";
  const low = String(text).toLowerCase();
  const hits = [];
  for (const t of tokens || []) {
    if (!t) continue;
    let from = 0;
    let idx = low.indexOf(t, from);
    while (idx !== -1) {
      hits.push([idx, idx + t.length]);
      from = idx + t.length;
      idx = low.indexOf(t, from);
    }
  }
  if (!hits.length) {
    el.textContent = text;
    return;
  }
  hits.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
    else merged.push([h[0], h[1]]);
  }
  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) el.appendChild(document.createTextNode(text.slice(pos, s)));
    const mark = mk("span", { color: accent, fontWeight: "700" });
    mark.textContent = text.slice(s, e);
    el.appendChild(mark);
    pos = e;
  }
  if (pos < text.length) el.appendChild(document.createTextNode(text.slice(pos)));
}

// opts: { mk, tx, theme, items, value, favorites, recents, hasTxt, loadInfo,
//         onChange, onToggleFavorite, pushRecent, helpers }
// onToggleFavorite(name) must return the next favorites array (sync), and
// pushRecent(name) the next recents array, so this panel keeps its snapshots
// without a second render pass from the bundle.
export function createLoraPicker(opts) {
  const { mk, tx } = opts;
  const C = opts.theme;
  const H = opts.helpers || {};
  const loraLabelParts = H.loraLabelParts || _partsOf;
  const loraFilterRank = H.loraFilterRank || ((items) => items.slice());
  const loraQueryTokens = H.loraQueryTokens || ((q) => String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean));
  const loraScopes = H.loraScopes || (() => [{ id: "all", label: "All", count: 0 }]);
  const loraScopeMatch = H.loraScopeMatch || (() => true);
  const loraFolders = H.loraFolders || (() => []);

  let items = (opts.items || []).slice();
  let value = opts.value || "";
  let favorites = (opts.favorites || []).slice();
  let recents = (opts.recents || []).slice();
  let scope = "all";
  let query = "";
  let hi = -1;
  let rowEls = [];
  let infoName = "";

  const isFav = (name) => favorites.some((f) => _norm(f) === _norm(name));

  const wrap = mk("div", { position: "relative", flex: "1 1 0", minWidth: "0", overflow: "hidden" });
  const trig = mk("div", {
    background: C.bg3, border: `1px solid ${C.border}`, borderRadius: "7px",
    padding: "0 8px", height: "28px", display: "flex", alignItems: "center",
    justifyContent: "space-between", cursor: "pointer", boxSizing: "border-box",
    transition: "border-color .15s", userSelect: "none", overflow: "hidden",
  });
  const trigTxt = mk("span", {
    fontSize: "12px", color: C.text, overflow: "hidden", textOverflow: "ellipsis",
    whiteSpace: "nowrap", flex: "1", minWidth: "0",
  });
  const arr = mk("span", { fontSize: "8px", color: C.muted, marginLeft: "5px", flexShrink: "0", transition: "transform .18s" });
  arr.textContent = "v";
  trig.append(trigTxt, arr);

  const _setTrigger = (name) => {
    const p = _partsOf(name);
    const label = p.stem || "Select LoRA...";
    tx(trigTxt, label);
    trigTxt.style.color = name ? C.lime : C.muted;
    trig.title = p.full || "Select a LoRA";
  };
  _setTrigger(value);

  const panel = mk("div", {
    display: "none", position: "fixed", background: C.bg1,
    border: `1px solid ${C.borderH}`, borderRadius: "10px",
    zIndex: "2147482000", flexDirection: "column",
    boxShadow: "0 12px 40px rgba(0,0,0,.95)", overflow: "hidden",
  });

  const srchRow = mk("div", { display: "flex", alignItems: "center", background: C.bg2, borderBottom: `1px solid ${C.border}` });
  const srch = mk("input", {
    background: "transparent", border: "none", padding: "10px 12px", color: C.text,
    fontSize: "13px", outline: "none", flex: "1", minWidth: "0", boxSizing: "border-box",
  }, { type: "text", placeholder: "Search LoRAs (e.g. ref2v 4step)" });
  const count = mk("span", { fontSize: "10px", color: C.muted, padding: "0 10px", flexShrink: "0", fontVariantNumeric: "tabular-nums" });
  srchRow.append(srch, count);

  const chipRow = mk("div", { display: "flex", gap: "4px", padding: "7px 8px", overflowX: "auto", whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` });

  const list = mk("div", { overflowY: "auto", maxHeight: "250px", minHeight: "46px" });

  const info = mk("div", { display: "none", flexDirection: "column", gap: "6px", padding: "9px 10px", borderTop: `1px solid ${C.border}`, background: C.bg2 });
  const infoHead = mk("div", { display: "flex", alignItems: "center", gap: "6px" });
  const infoTitle = mk("div", { fontSize: "11px", fontWeight: "700", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1", minWidth: "0" });
  const mkMiniBtn = (label) => {
    const b = mk("button", {
      fontSize: "9px", fontWeight: "700", color: C.muted, border: `1px solid ${C.border}`,
      background: "transparent", borderRadius: "6px", padding: "2px 8px", cursor: "pointer",
      outline: "none", flexShrink: "0",
    }, { type: "button" });
    tx(b, label);
    b.onmouseenter = () => { b.style.borderColor = C.borderH; b.style.color = C.text; };
    b.onmouseleave = () => { b.style.borderColor = C.border; b.style.color = C.muted; };
    return b;
  };
  const infoCopy = mkMiniBtn("Copy");
  const infoClose = mkMiniBtn("x");
  infoHead.append(infoTitle, infoCopy, infoClose);
  const infoBody = mk("div", {
    fontSize: "11px", lineHeight: "1.55", color: C.muted, whiteSpace: "pre-wrap",
    wordBreak: "break-word", overflowY: "auto", maxHeight: "190px",
    fontFamily: "ui-monospace,SFMono-Regular,Consolas,monospace",
  });
  info.append(infoHead, infoBody);

  const foot = mk("div", { fontSize: "10px", color: C.dim, padding: "6px 12px", borderTop: `1px solid ${C.border}` });

  panel.append(srchRow, chipRow, list, info, foot);
  wrap.appendChild(trig);

  const mkSection = (label, n) => {
    const h = mk("div", {
      fontSize: "9px", fontWeight: "700", letterSpacing: ".08em", textTransform: "uppercase",
      color: C.dim, padding: "8px 12px 4px",
    });
    tx(h, n ? `${label} (${n})` : label);
    return h;
  };

  const mkRow = (name, tokens) => {
    const p = loraLabelParts(name);
    const sel = _norm(name) === _norm(value);
    const row = mk("div", {
      display: "flex", alignItems: "center", gap: "7px", padding: "7px 11px",
      cursor: "pointer", borderRadius: "7px",
    });
    row.title = p.full;
    const star = mk("button", {
      width: "22px", height: "22px", flexShrink: "0", border: "none", background: "transparent",
      cursor: "pointer", padding: "0", fontSize: "14px", lineHeight: "22px", outline: "none",
      color: isFav(name) ? C.lime : C.dim,
    }, { type: "button" });
    tx(star, isFav(name) ? "\u2605" : "\u2606");
    star.title = isFav(name) ? "Remove from favorites" : "Add to favorites";
    star.onclick = (e) => {
      e.stopPropagation();
      const next = opts.onToggleFavorite ? opts.onToggleFavorite(name) : null;
      if (Array.isArray(next)) favorites = next;
      render();
    };
    const col = mk("div", { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0", flex: "1" });
    const nameEl = mk("div", { fontSize: "12px", color: sel ? C.lime : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
    _writeHighlighted(mk, nameEl, p.stem, tokens, C.lime);
    col.appendChild(nameEl);
    if (p.dir) {
      const dirEl = mk("div", { fontSize: "10px", color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
      tx(dirEl, p.dir);
      col.appendChild(dirEl);
    }
    row.append(star, col);
    if (opts.hasTxt && opts.hasTxt(name)) {
      const ib = mk("span", {
        width: "16px", height: "16px", borderRadius: "50%", border: `1px solid ${C.borderH}`,
        color: C.muted, fontSize: "9px", fontWeight: "700", display: "inline-flex",
        alignItems: "center", justifyContent: "center", cursor: "help", flexShrink: "0",
        fontStyle: "italic", fontFamily: "Georgia, serif",
      });
      tx(ib, "i");
      ib.title = "Show the saved info note for this LoRA";
      ib.onclick = (e) => {
        e.stopPropagation();
        openInfo(name);
      };
      row.appendChild(ib);
    }
    row.onmouseenter = () => { row.style.background = C.bg3; };
    row.onmouseleave = () => { row.style.background = ""; };
    row.onclick = () => select(name);
    return row;
  };

  const openInfo = async (name) => {
    const p = loraLabelParts(name);
    infoName = name;
    tx(infoTitle, p.stem);
    infoTitle.title = p.full;
    tx(infoBody, _infoCache.has(name) ? _infoCache.get(name) : "Loading...");
    info.style.display = "flex";
    if (_infoCache.has(name)) return;
    let text = null;
    try {
      text = await opts.loadInfo(name);
    } catch (e) {
      text = null;
    }
    const body = (typeof text === "string" && text.trim()) ? text : "No info note found for this LoRA.";
    _infoCache.set(name, body);
    if (infoName === name) tx(infoBody, body);
  };

  const select = (name) => {
    value = name;
    _setTrigger(value);
    if (opts.pushRecent) {
      const next = opts.pushRecent(name);
      if (Array.isArray(next)) recents = next;
    }
    close();
    render();
    if (opts.onChange) opts.onChange(name);
  };

  const render = () => {
    list.innerHTML = "";
    rowEls = [];
    const tokens = loraQueryTokens(query);
    const baseScopes = loraScopes(items, { favorites, recents });
    if (scope.startsWith("dir:")) {
      if (!items.some((n) => loraScopeMatch(n, scope, { favorites, recents }))) scope = "all";
    } else if (!baseScopes.some((s) => s.id === scope)) {
      scope = "all";
    }
    const inDir = scope.startsWith("dir:");
    const dirPath = inDir ? scope.slice(4) : "";
    const dirLow = dirPath.toLowerCase();
    const sectionFor = (name) => {
      const dir = loraLabelParts(name).dir;
      if (inDir) {
        const low = dir.toLowerCase();
        if (low === dirLow) return "(this folder)";
        if (low.startsWith(dirLow + "/")) return dir.slice(dirPath.length + 1).split("/")[0];
      }
      return dir ? dir.split("/")[0] : "(root)";
    };
    const ranked = loraFilterRank(items, query, { favorites, recents })
      .filter((n) => loraScopeMatch(n, scope, { favorites, recents }));
    const shown = new Set();

    const addRow = (name) => {
      if (shown.has(_norm(name))) return;
      shown.add(_norm(name));
      const row = mkRow(name, tokens);
      list.appendChild(row);
      rowEls.push(row);
    };

    if (query || (!inDir && scope !== "all")) {
      for (const name of ranked) addRow(name);
    } else {
      const sections = new Map();
      const push = (key, name) => {
        if (!sections.has(key)) sections.set(key, []);
        sections.get(key).push(name);
      };
      const isRecent = (name) => recents.some((r) => _norm(r) === _norm(name));
      if (!inDir) {
        for (const name of ranked) if (isFav(name)) push("Favorites", name);
        for (const name of ranked) if (!isFav(name) && isRecent(name)) push("Recent", name);
      }
      for (const name of ranked) {
        if (!inDir && (isFav(name) || isRecent(name))) continue;
        push(sectionFor(name), name);
      }
      const rankOf = (key) => (key === "Favorites" ? 0 : key === "Recent" ? 1 : key === "(this folder)" ? 2 : 3);
      const keys = Array.from(sections.keys()).sort((a, b) => (rankOf(a) - rankOf(b)) || a.localeCompare(b));
      for (const key of keys) {
        list.appendChild(mkSection(key, sections.get(key).length));
        for (const name of sections.get(key)) addRow(name);
      }
    }

    if (!rowEls.length) {
      const empty = mk("div", { fontSize: "11px", color: C.dim, padding: "16px 12px", textAlign: "center" });
      tx(empty, (items.length ? "No LoRAs match." : "No LoRAs found. Add some to your loras folder."));
      list.appendChild(empty);
    }

    hi = -1;
    count.textContent = `${shown.size} / ${items.length}`;

    const mkScopeChip = (label, active, onPick, title) => {
      const chip = mk("button", {
        fontSize: "10px", fontWeight: "700", borderRadius: "999px", padding: "4px 11px",
        cursor: "pointer", outline: "none", flexShrink: "0", whiteSpace: "nowrap",
        border: `1px solid ${active ? C.lime : C.border}`,
        background: active ? "rgba(var(--h3accent-rgb),.12)" : "transparent",
        color: active ? C.lime : C.muted,
      }, { type: "button" });
      tx(chip, label);
      chip.title = title || "";
      chip.onclick = (e) => {
        e.stopPropagation();
        onPick();
      };
      return chip;
    };

    chipRow.innerHTML = "";
    if (inDir) {
      const segments = dirPath.split("/");
      const up = segments.length > 1 ? "dir:" + segments.slice(0, -1).join("/") : "all";
      chipRow.appendChild(mkScopeChip("\u2039 Up", false, () => { scope = up; render(); }, "Go up one folder"));
      const crumbs = mk("span", {
        fontSize: "10px", color: C.muted, padding: "0 2px", alignSelf: "center",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "200px", flexShrink: "0",
      });
      tx(crumbs, dirPath);
      crumbs.title = dirPath;
      chipRow.appendChild(crumbs);
      for (const f of loraFolders(items, dirPath)) {
        chipRow.appendChild(mkScopeChip(`${f.name} ${f.count}`, false, () => { scope = "dir:" + dirPath + "/" + f.name; render(); }, "Open this folder"));
      }
    } else {
      for (const s of baseScopes) {
        const active = s.id === scope;
        chipRow.appendChild(mkScopeChip(`${s.label} ${s.count}`, active, () => { scope = active ? "all" : s.id; render(); }, s.id === "h3" ? "Show only MiniMax H3 LoRAs" : ""));
      }
      for (const f of loraFolders(items, "")) {
        chipRow.appendChild(mkScopeChip(`${f.name} ${f.count}`, false, () => { scope = "dir:" + f.name; render(); }, "Open this folder"));
      }
    }

    foot.textContent = inDir
      ? `Folder: ${dirPath} (${shown.size} shown)`
      : (items.length ? "Click a row to pick it. Star = favorite. i = saved info note." : "");
  };

  const _paintHi = () => {
    rowEls.forEach((el, i) => { el.style.background = i === hi ? C.bg3 : ""; });
    if (hi >= 0 && rowEls[hi] && rowEls[hi].scrollIntoView) {
      try { rowEls[hi].scrollIntoView({ block: "nearest" }); } catch (e) {}
    }
  };

  const _position = () => {
    const r = trig.getBoundingClientRect();
    const width = Math.max(r.width, 380);
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    panel.style.left = left + "px";
    panel.style.width = width + "px";
    panel.style.maxHeight = Math.max(200, Math.min(window.innerHeight - 24, 560)) + "px";
    const ph = Math.min(panel.offsetHeight || 400, window.innerHeight - 24);
    let top = r.bottom + 4;
    if (top + ph > window.innerHeight - 8 && r.top - ph - 4 > 8) top = r.top - ph - 4;
    panel.style.top = top + "px";
  };

  // The panel is position:fixed, so panning or dragging the node would leave it
  // behind. Track the trigger every frame while open; close if the node is gone.
  let _followRaf = 0;
  const _follow = () => {
    if (panel.style.display !== "flex") return;
    if (!trig.isConnected) { close(); return; }
    _position();
    _followRaf = requestAnimationFrame(_follow);
  };

  const _onDocClick = (e) => {
    if (!wrap.contains(e.target) && !panel.contains(e.target)) close();
  };

  const open = () => {
    if (_activePickerClose && _activePickerClose !== close) _activePickerClose();
    _activePickerClose = close;
    document.body.appendChild(panel);
    panel.style.display = "flex";
    query = "";
    srch.value = "";
    info.style.display = "none";
    infoName = "";
    render();
    _position();
    srch.focus();
    document.addEventListener("mousedown", _onDocClick, true);
    if (_followRaf) cancelAnimationFrame(_followRaf);
    _followRaf = requestAnimationFrame(_follow);
    arr.style.transform = "rotate(180deg)";
    trig.style.borderColor = C.lime;
  };

  const close = () => {
    panel.style.display = "none";
    if (_followRaf) { cancelAnimationFrame(_followRaf); _followRaf = 0; }
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    document.removeEventListener("mousedown", _onDocClick, true);
    arr.style.transform = "";
    trig.style.borderColor = C.border;
    if (_activePickerClose === close) _activePickerClose = null;
  };

  srch.oninput = () => { query = srch.value; render(); };
  srch.onkeydown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!rowEls.length) return;
      if (hi < 0) hi = e.key === "ArrowDown" ? 0 : rowEls.length - 1;
      else hi = (hi + (e.key === "ArrowDown" ? 1 : -1) + rowEls.length) % rowEls.length;
      _paintHi();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const el = rowEls[hi >= 0 ? hi : 0];
      if (el) el.click();
    }
  };
  infoCopy.onclick = (e) => {
    e.stopPropagation();
    _copyText(infoBody.textContent || "", infoCopy, tx);
  };
  infoClose.onclick = (e) => { e.stopPropagation(); info.style.display = "none"; infoName = ""; };
  trig.onclick = (e) => {
    e.stopPropagation();
    panel.style.display === "flex" ? close() : open();
  };
  trig.onmouseenter = () => { if (panel.style.display !== "flex") trig.style.background = C.bg2; };
  trig.onmouseleave = () => { if (panel.style.display !== "flex") trig.style.background = C.bg3; };

  return {
    el: wrap,
    get value() { return value; },
    set(v) { value = v || ""; _setTrigger(value); },
    updateItems(next) {
      if (next && Array.isArray(next.items)) items = next.items.slice();
      if (next && Array.isArray(next.favorites)) favorites = next.favorites.slice();
      if (next && Array.isArray(next.recents)) recents = next.recents.slice();
      if (panel.style.display === "flex") render();
    },
    open() { open(); },
  };
}

// Standalone modal that shows one LoRA's `<name>.txt` note. The picker has its
// own inline pane; this is for the per-row info badge in the Advanced card.
export function showLoraInfo(opts) {
  const { mk, tx } = opts;
  const C = opts.theme;
  const p = _partsOf(opts.name);

  const dim = mk("div", { position: "fixed", inset: "0", background: "rgba(0,0,0,.55)", zIndex: "2147482900" });
  const card = mk("div", {
    position: "fixed", left: "50%", top: "50%", transform: "translate(-50%,-50%)",
    width: "min(92vw, 560px)", maxHeight: "76vh", display: "flex", flexDirection: "column",
    background: C.bg1, border: `1px solid ${C.borderH}`, borderRadius: "10px",
    boxShadow: "0 18px 60px rgba(0,0,0,.95)", overflow: "hidden", zIndex: "2147482950",
  });
  const head = mk("div", { display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderBottom: `1px solid ${C.border}` });
  const titles = mk("div", { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0", flex: "1" });
  const t1 = mk("div", { fontSize: "12px", fontWeight: "700", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
  tx(t1, p.stem);
  const t2 = mk("div", { fontSize: "10px", color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
  tx(t2, p.dir || "");
  titles.append(t1, t2);
  const closeBtn = mk("button", {
    fontSize: "10px", fontWeight: "700", color: C.muted, border: `1px solid ${C.border}`,
    background: "transparent", borderRadius: "6px", padding: "2px 9px", cursor: "pointer", outline: "none",
  }, { type: "button" });
  tx(closeBtn, "Close");
  const copyBtn = mk("button", {
    fontSize: "10px", fontWeight: "700", color: C.muted, border: `1px solid ${C.border}`,
    background: "transparent", borderRadius: "6px", padding: "2px 9px", cursor: "pointer", outline: "none",
  }, { type: "button" });
  tx(copyBtn, "Copy");
  copyBtn.onclick = () => _copyText(body.textContent || "", copyBtn, tx);
  head.append(titles, copyBtn, closeBtn);
  const body = mk("div", {
    padding: "11px 13px", fontSize: "11px", lineHeight: "1.55", color: C.muted,
    whiteSpace: "pre-wrap", wordBreak: "break-word", overflowY: "auto",
    fontFamily: "ui-monospace,SFMono-Regular,Consolas,monospace",
  });
  tx(body, "Loading...");
  card.append(head, body);

  const remove = () => {
    document.removeEventListener("keydown", onKey, true);
    if (dim.parentNode) dim.parentNode.removeChild(dim);
    if (card.parentNode) card.parentNode.removeChild(card);
  };
  const onKey = (e) => { if (e.key === "Escape") remove(); };
  closeBtn.onclick = remove;
  dim.onclick = remove;
  document.addEventListener("keydown", onKey, true);
  document.body.append(dim, card);

  Promise.resolve()
    .then(() => opts.loadInfo(opts.name))
    .then((text) => tx(body, (typeof text === "string" && text.trim()) ? text : "No info note found for this LoRA."))
    .catch(() => tx(body, "Could not load the info note."));
}
