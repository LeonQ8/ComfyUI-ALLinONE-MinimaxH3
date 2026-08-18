// Pure helpers for the One Node MiniMax H3 frontend.
//
// Extracted from web/one_node_minimax_h3.js so they can be unit-tested under
// plain Node (see tests/frontend_helpers.test.mjs) and reused across the
// bundle. These helpers are intentionally DOM-light: they accept plain
// numbers or shape-only objects so they can run without a browser.

export function aspect(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return h > w ? "portrait" : "landscape";
}

export function sizeOf(source) {
  if (!source || typeof source !== "object") return null;
  const w = source.naturalWidth ?? source.videoWidth ?? source.width;
  const h = source.naturalHeight ?? source.videoHeight ?? source.height;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { width: Math.round(w), height: Math.round(h) };
}

export function sameSize(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.width === b.width && a.height === b.height;
}

export function orientRes(res, orientation) {
  if (!res || orientation !== "portrait" || res.width <= res.height) return res;
  const flipped = {
    ...res,
    width: res.height,
    height: res.width,
  };
  if (typeof res.label === "string") {
    const m = res.label.match(/^(\d+)x+(\d+)(.*)$/);
    if (m) flipped.label = `${m[2]}x${m[1]}${m[3]}`;
  }
  return flipped;
}

export function fitResolutionToAspect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sw = Number(sourceWidth);
  const sh = Number(sourceHeight);
  const tw = Number(targetWidth);
  const th = Number(targetHeight);
  if (!(sw > 0) || !(sh > 0) || !(tw > 0) || !(th > 0)) {
    return { width: tw, height: th };
  }
  const ratio = sw / sh;
  const targetPixels = tw * th;
  const capShort = 768;
  const capLong = 1344;
  let best = null;
  for (let w = 32; w <= capLong; w += 32) {
    for (let h = 32; h <= capLong; h += 32) {
      const shortEdge = Math.min(w, h);
      const longEdge = Math.max(w, h);
      if (shortEdge > capShort) continue;
      if (longEdge > capLong) continue;
      if (w * h > targetPixels) continue;
      const aspectError = Math.abs(Math.log(w / h / ratio));
      const areaError = Math.abs(Math.log((w * h) / targetPixels));
      const score = aspectError * 12 + areaError;
      if (!best || score < best.score) best = { width: w, height: h, score };
    }
  }
  if (!best) return { width: tw, height: th };
  return { width: best.width, height: best.height };
}

// Resolve which source slot drives the canvas fit for a mode.
//
// `cfg` is the per-mode object saved as state.fitCfg[mode]:
//   { key: "first"|"last"|"ref:0"|"video:0"|"kf:0"|"src"|null,
//     mode: "fit"|"custom"|"normal", custom: {width,height}|null }
// `slots` is the ordered list of available sources for that mode:
//   [{ key, label, size: {width,height} }, ...]
//
// Returns the effective primary { key, label, mode, size } or null when there
// is nothing to fit (no slots) or the mode has no fit source.
export function resolveFitPrimary(cfg, slots) {
  const list = Array.isArray(slots) ? slots.filter((s) => s && s.size && s.size.width > 0 && s.size.height > 0) : [];
  if (!list.length) return null;
  const c = cfg && typeof cfg === "object" ? cfg : {};
  let key = c.key || null;
  if (!key || !list.some((s) => s.key === key)) key = list[0].key;
  const slot = list.find((s) => s.key === key);
  if (c.mode === "custom" && c.custom && c.custom.width > 0 && c.custom.height > 0) {
    return { key, label: slot.label, mode: "custom", size: c.custom };
  }
  if (c.mode === "normal") {
    return { key, label: slot.label, mode: "normal", size: slot.size };
  }
  return { key, label: slot.label, mode: "fit", size: slot.size };
}

// Compact display name for an image sampling profile key so the recipe line
// stays short. "custom" and unknown keys fall back to a plain token.
export function imgProfileShort(key) {
  if (!key || key === "custom") return "Custom";
  const k = String(key);
  if (k.includes("ref2v")) return "REF2V";
  if (k.includes("fl2v_8")) return "FL2VA 8";
  if (k.includes("fl2v_4")) return "FL2VA 4";
  if (k.includes("sa_solver")) return "SA-Solver 4";
  if (k.includes("er_sde")) return "ER-SDE 4";
  if (k.includes("balanced")) return "Base 12";
  return "Base 20";
}

// Friendly name for an image aspect ratio key so dropdowns and the recipe
// line read "Widescreen" instead of "16:9". Unknown keys pass through.
export function imgAspectName(key) {
  const names = {
    "1:1": "Square",
    "16:9": "Widescreen",
    "9:16": "Portrait",
    "4:3": "Standard",
    "3:4": "Standard Portrait",
    "3:2": "Wide",
    "2:3": "Tall",
    "21:9": "Cinematic",
  };
  return names[key] || key || "";
}

// Query string for a /view URL. ComfyUI's save counter collapses when output
// files are deleted, so filenames get reused and /view can serve stale browser
// cached content. The m param is ignored by the server and only busts the
// cache: the item's mtime when known, otherwise the current time.
export function viewQuery(item, type) {  const src = item || {};
  const name = src.filename || src.video || "";
  const t = type || src.type || "output";
  const m = src.mtime || Date.now();
  return `filename=${encodeURIComponent(name)}&type=${encodeURIComponent(t)}&subfolder=${encodeURIComponent(src.subfolder || "")}&m=${m}`;
}

// Whether a media file is present in a listing returned by /h3one/input_files.
// Compares basenames so a subfolder prefix on either side does not matter.
export function inputFileExists(files, name) {
  const base = String(name || "").replace(/\\/g, "/").split("/").pop();
  if (!base) return false;
  return (Array.isArray(files) ? files : []).some((f) => String(f).replace(/\\/g, "/").split("/").pop() === base);
}

// H3 Studio image canvas limits. The H3StudioDirector node rejects megapixels
// outside 0.2..8.5 at queue time, so any request must be clamped before the
// workflow is submitted or generation fails validation with no render at all.
export const IMG_MIN_MP = 0.2;
export const IMG_MAX_MP = 8.5;
export const IMG_ASPECT_RATIOS = {
  "1:1": 1,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "3:2": 3 / 2,
  "2:3": 2 / 3,
  "21:9": 21 / 9,
};

// Round a dimension down to a multiple of 32 (H3 Studio canvas grid).
function floor32(v) {
  return Math.max(32, Math.floor(v / 32) * 32);
}

// Clamp a raw megapixel value into the H3 Studio input range. Non-finite or
// missing values fall back to 1.0 so a corrupt saved state can never push the
// workflow outside the accepted range; zero or negative values snap to the
// 0.2 MP floor instead of producing an invalid empty canvas.
export function clampImageMP(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1.0;
  return Math.min(IMG_MAX_MP, Math.max(IMG_MIN_MP, n));
}

// Compute a valid H3 Studio image canvas from a requested size.
//
// mode: "custom" uses width/height as exact pixel dims; "ratio" derives dims
// from megapixels + an aspect key in IMG_ASPECT_RATIOS.
// Returns { width, height, megapixels, capped } where capped is true when the
// requested size exceeded the 8.5 MP ceiling and had to be scaled down. Both
// dims are aligned to the 32-pixel canvas grid and the returned megapixels is
// the actual (post-clamp) value, never more than IMG_MAX_MP.
export function planImageCanvas({ mode = "custom", width = 1024, height = 1024, megapixels = 1.0, aspect = "1:1" } = {}) {
  const target = mode === "ratio" ? clampImageMP(megapixels) * 1e6 : Math.max(32, Number(width) || 1024) * Math.max(32, Number(height) || 1024);
  const ratio = IMG_ASPECT_RATIOS[aspect] || 1;
  let w;
  let h;
  if (mode === "ratio") {
    w = Math.max(32, Math.round(Math.sqrt(target * ratio) / 32) * 32);
    h = Math.max(32, Math.round(Math.sqrt(target / ratio) / 32) * 32);
  } else {
    w = Math.max(32, Math.round((Number(width) || 1024) / 32) * 32);
    h = Math.max(32, Math.round((Number(height) || 1024) / 32) * 32);
  }
  let capped = w * h > IMG_MAX_MP * 1e6;
  if (capped) {
    const scale = Math.sqrt((IMG_MAX_MP * 1e6) / (w * h));
    w = floor32(w * scale);
    h = floor32(h * scale);
    if (w * h > IMG_MAX_MP * 1e6) {
      const shrink = Math.sqrt((IMG_MAX_MP * 1e6) / (w * h));
      w = floor32(w * shrink);
      h = floor32(h * shrink);
    }
  }
  return { width: w, height: h, megapixels: (w * h) / 1e6, capped };
}