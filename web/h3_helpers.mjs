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