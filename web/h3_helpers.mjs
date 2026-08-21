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

export function fitResolutionToAspect(sourceWidth, sourceHeight, targetWidth, targetHeight, maxAspect = Infinity) {
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
      if (w / h > maxAspect) continue;
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

export function planMaskCrop(width, height) {
  // The H3 canvas follows the tracked mask instead of a fixed 16:9 frame.
  // MVEx SubjectCrop targets a pixel budget on the 32 grid, preserving the
  // mask's own aspect, so the budget must be H3-safe for ANY shape: a square
  // crop at 0.5 MP is 707x707, inside the 768 short-edge cap. Above that a
  // square or portrait crop breaks the cap, and the aspect is only known at
  // runtime, so 0.5 MP is the ceiling regardless of the preset.
  const w = Number(width) > 0 ? Number(width) : 960;
  const h = Number(height) > 0 ? Number(height) : 544;
  const preset = w * h / (1024 * 1024);
  const megapixels = Math.min(preset, 0.5);
  return {
    width: w,
    height: h,
    aspectRatio: w / h,
    megapixels: megapixels,
    masked: true,
  };
}

export function maskTrackingPlan(hasPaintedMask, textTarget) {
  const hasText = Boolean(String(textTarget || "").trim());
  // A text target makes SAM detect and track that object ("face" means the
  // face). The painted mask only seeds the tracker when there is no text;
  // combining both unions the painted region over the detected object and
  // swallows the text prompt, so the tracked region blows up (measured).
  return { maxObjects: 1, objectIndices: "0", seedPaint: Boolean(hasPaintedMask) && !hasText };
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

// Plan the target latent length and AV context window for Extend mode.
//
// Extend output is [source video] + [new content]. The new content is the
// generated latent minus the preserved AV context prefix, so the generation
// target must be context + requested extension. Both the target and the
// context have to stay on H3's 17-frame grid (5 + 17k), and the context must
// also land on a shared 24fps/40Hz video+audio boundary (39/90/141/192/...)
// or the fork's context node snaps it to a smaller boundary and the extension
// silently grows beyond the requested duration.
//
// Returns { contextLength, targetLength, newFrames } where newFrames is the
// closest achievable continuation to duration * fps (within one 17-frame
// block) and contextLength is the smallest AV-boundary window, which also
// keeps the lossy decode/re-encode round trip of the source tail as short as
// possible.
export function planExtend(duration, fps = 24, { maxTarget = 736 } = {}) {
  const wantNew = Math.max(1, Math.round(Number(duration) * fps));
  const maxBlocks = Math.max(1, Math.floor((maxTarget - 39) / 17));
  const blocks = Math.max(1, Math.min(Math.round(wantNew / 17) || 1, maxBlocks));
  const newFrames = blocks * 17;
  return { contextLength: 39, targetLength: 39 + newFrames, newFrames };
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

// Query string for the /h3one/thumb route, which serves a downscaled JPEG so
// the gallery and compare never decode a full-size image (an upscaled PNG can
// be over 150 MB). Mirrored in the bundle; the bundle uses it everywhere an
// image is shown as a preview.
export function thumbQuery(item, max = 512, type) {
  const src = item || {};
  const name = src.filename || src.video || "";
  const t = type || src.type || "output";
  return `filename=${encodeURIComponent(name)}&type=${encodeURIComponent(t)}&subfolder=${encodeURIComponent(src.subfolder || "")}&max=${max}`;
}

// Whether a media item is a still image (by kind or extension).
export function isImageItem(item) {
  return !!(item && (item.kind === "image" || /\.(png|jpe?g|webp|bmp)$/i.test(item.filename || "")));
}

// Whether a media file is present in a listing returned by /h3one/input_files.
// Compares basenames so a subfolder prefix on either side does not matter.
export function inputFileExists(files, name) {
  const base = String(name || "").replace(/\\/g, "/").split("/").pop();
  if (!base) return false;
  return (Array.isArray(files) ? files : []).some((f) => String(f).replace(/\\/g, "/").split("/").pop() === base);
}

// Quality preset flag table. Keys mirror config.json quality_presets; each
// entry says which accelerators that preset turns on. Turbo is not matchable
// by flags alone (it needs a speed LoRA), so it is excluded from matching.
export const QUALITY_PRESET_FLAGS = {
  turbo: { sol: false, sage: false, kitchen: false },
  speed: { sol: true, sage: false, kitchen: false },
  balanced: { sol: true, sage: false, kitchen: false },
  high: { sol: false, sage: true, kitchen: false },
  native: { sol: false, sage: false, kitchen: false },
};

export const QUALITY_PRESET_ORDER = ["speed", "balanced", "high", "native"];

// Comfy Kitchen attention replaces the whole attention function, same as
// SageAttention, so the two can never run together. SolAttn layers on top of
// either of them. When a request would pair kitchen with sage, sage is
// dropped, so the flag combo always stays valid.
export function resolveQualityFlags(sol, sage, kitchen) {
  const s = !!sol;
  let a = !!sage;
  const k = !!kitchen;
  if (a && k) a = false;
  return { sol: s, sage: a, kitchen: k };
}

// Match a (sol, sage, kitchen) combo against the quality preset table.
// Returns the preset key, or "custom" for any mix no preset matches.
export function matchQualityPreset(flags, table = QUALITY_PRESET_FLAGS, order = QUALITY_PRESET_ORDER) {
  const f = resolveQualityFlags(flags && flags.sol, flags && flags.sage, flags && flags.kitchen);
  for (const key of order) {
    const p = table[key];
    if (p && f.sol === !!p.sol && f.sage === !!p.sage && f.kitchen === !!p.kitchen) return key;
  }
  return "custom";
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

// Derive W/H for a custom (arbitrary) aspect ratio from a megapixel request,
// preserving the given ratio. Used by the Image Edit MP field when the user
// dropped a source image and the aspect is locked to "Custom": changing MP
// scales the canvas up or down instead of silently doing nothing. Same canvas
// grid alignment and 8.5 MP ceiling as planImageCanvas; a non-positive or
// non-finite ratio falls back to square.
export function planImageCanvasForRatio(megapixels, ratio) {
  const mp = clampImageMP(megapixels);
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  let w = Math.max(32, Math.round(Math.sqrt(mp * 1e6 * r) / 32) * 32);
  let h = Math.max(32, Math.round(Math.sqrt(mp * 1e6 / r) / 32) * 32);
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

// Plan an upscale output canvas so the native upscaler never has to handle an
// absurdly large frame. The RTX node's own engine caps around 16 MP (~4096 on
// the long edge) and aborts natively above that; SeedVR2's official 4K example
// caps max_resolution at 4096. We scale the source by the requested factor, then
// pull the long edge back to `maxLongEdge` (default 4096) preserving aspect.
// Returns { width, height, capped } with both dims rounded to a multiple of 8
// (the RTX node snaps internally anyway); capped is true when the pure factor
// output had to be shrunk. Invalid inputs return null.
export function planUpscaleTarget(srcW, srcH, factor, maxLongEdge = 4096) {
  const w = Number(srcW);
  const h = Number(srcH);
  const f = Number(factor);
  const cap = Number(maxLongEdge) > 0 ? Number(maxLongEdge) : 4096;
  if (!(w > 0) || !(h > 0) || !(f > 0)) return null;
  let tw = w * f;
  let th = h * f;
  const longEdge = Math.max(tw, th);
  const capped = longEdge > cap;
  if (capped) {
    const s = cap / longEdge;
    tw *= s;
    th *= s;
  }
  const snap8 = (v) => Math.max(8, Math.round(v / 8) * 8);
  return { width: snap8(tw), height: snap8(th), capped };
}

// POST body for /prompt when queueing a job behind the running one. Mirrored in
// the bundle (kept in sync). The bundle never imports this module; the mirror
// lives in web/one_node_minimax_h3.js so it stays unit-testable here.
export function queuePromptPayload(wf, clientId) {
  return {
    prompt: wf,
    client_id: clientId,
    extra_data: { enable_previews: true },
  };
}

// Bounded retry for the queued-output history fallback. ComfyUI commits a
// finished prompt to /history slightly after execution_success, so a single
// immediate lookup can miss the output and the queued result is lost from the
// preview. This polls /history a bounded number of times, stops the moment
// media appears or a failure is confirmed, and gives up after the deadline so
// no tracking leaks. Mirrored in the bundle (kept in sync).
//
// fetchHistory(pid) resolves the /history entry for that prompt (or null);
// readItem(entry) extracts the media item (or null). Returns
//   { item, failed, expired }
// where expired is true when the deadline passed with no media and no failure.
export async function settleQueuedOutput(pid, fetchHistory, readItem, { maxAttempts = 8, delayMs = 800, deadlineMs = 8000 } = {}) {
  const start = Date.now();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let entry = null;
    try {
      entry = await fetchHistory(pid);
    } catch (e) {
      entry = null;
    }
    const status = (entry && entry.status) || {};
    const statusStr = String(status.status_str || "");
    if (statusStr === "error" || statusStr === "interrupted") {
      return { item: null, failed: true, expired: false };
    }
    const item = readItem ? readItem(entry) : null;
    if (item) return { item, failed: false, expired: false };
    if (Date.now() - start >= deadlineMs) break;
    if (attempt + 1 < maxAttempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return { item: null, failed: false, expired: true };
}

// Inject a lip-sync directive into a Mask mode prompt that preserves the
// source soundtrack. The masked face region is regenerated from noise each
// frame, so the model has no motion signal for the mouth; pointing it at the
// preserved speech (<Audio 1>) is what gives the replacement talking lips.
// Idempotent: a prompt that already names <Audio 1> is left alone. Mirrored in
// the bundle (kept in sync).
export function maskSpeechSyncPrompt(prompt) {
  const text = String(prompt || "");
  if (!text || text.includes("<Audio 1>")) return text;
  const directive = "The replacement speaks the same words as the source speech heard in <Audio 1>, mouth moving in sync with it.";
  if (/detailed_description:/i.test(text)) {
    return text.replace(/(detailed_description:\s*)/i, `$1<Audio 1>: speech_drive - ${directive}\n`);
  }
  if (/overall_soundscape:/i.test(text)) {
    return text.replace(/(overall_soundscape:\s*)/i, `$1<Audio 1>: speech_drive - ${directive} `);
  }
  return `${text}\n\n<Audio 1>: speech_drive - ${directive}`;
}

export function h3SamCheckpoints(items) {
  return (Array.isArray(items) ? items : []).filter((name) => /sam3\.1.*multiplex.*\.safetensors$/i.test(String(name).replace(/\\/g, "/")));
}

export function mapMaskPoint(clientX, clientY, rect, width, height) {
  const rw = Number(rect && rect.width);
  const rh = Number(rect && rect.height);
  const w = Number(width);
  const h = Number(height);
  if (!(rw > 0) || !(rh > 0) || !(w > 0) || !(h > 0)) return null;
  const x = Math.max(0, Math.min(w - 1, (Number(clientX) - Number(rect.left || 0)) * w / rw));
  const y = Math.max(0, Math.min(h - 1, (Number(clientY) - Number(rect.top || 0)) * h / rh));
  return { x, y };
}
