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