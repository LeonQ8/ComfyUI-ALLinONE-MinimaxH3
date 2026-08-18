// Tests for pure helpers in web/h3_helpers.mjs plus a smoke check that the
// main bundle parses. Phase 4 (Auto Aspect/Resolution) will land more tests
// here.

import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import { aspect, sizeOf, sameSize } from "../web/h3_helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const webDir = resolve(root, "web");
const bundlePath = resolve(webDir, "one_node_minimax_h3.js");
const helpersPath = resolve(webDir, "h3_helpers.mjs");

test("web directory contains the bundle", () => {
  const files = readdirSync(webDir);
  assert.ok(
    files.includes("one_node_minimax_h3.js"),
    `expected one_node_minimax_h3.js in ${webDir}, found ${JSON.stringify(files)}`,
  );
  assert.ok(
    files.includes("h3_helpers.mjs"),
    "expected h3_helpers.mjs alongside the bundle",
  );
});

test("bundle is non-trivial and registers an extension", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.length > 1000, `bundle is suspiciously small (${bundle.length} bytes)`);
  assert.ok(
    bundle.includes("app.registerExtension") || bundle.includes("registerExtension"),
    "bundle is missing expected ComfyUI extension registration",
  );
});

test("helpers file is non-trivial and exports the three helpers", () => {
  const src = readFileSync(helpersPath, "utf8");
  assert.ok(src.includes("export function aspect"), "helpers must export aspect");
  assert.ok(src.includes("export function sizeOf"), "helpers must export sizeOf");
  assert.ok(src.includes("export function sameSize"), "helpers must export sameSize");
});

test("aspect: landscape and portrait", () => {
  assert.equal(aspect(1920, 1080), "landscape");
  assert.equal(aspect(1080, 1920), "portrait");
  assert.equal(aspect(1344, 768), "landscape");
  assert.equal(aspect(768, 1344), "portrait");
});

test("aspect: square is landscape (height is not strictly greater than width)", () => {
  assert.equal(aspect(1024, 1024), "landscape");
});

test("aspect: zero, negative, NaN return null", () => {
  assert.equal(aspect(0, 100), null);
  assert.equal(aspect(100, 0), null);
  assert.equal(aspect(-1, 100), null);
  assert.equal(aspect(100, -1), null);
  assert.equal(aspect(NaN, 100), null);
  assert.equal(aspect("x", 100), null);
});

test("sizeOf: image-like with naturalWidth/Height", () => {
  assert.deepEqual(sizeOf({ naturalWidth: 1920, naturalHeight: 1080 }), { width: 1920, height: 1080 });
});

test("sizeOf: video-like with videoWidth/Height", () => {
  assert.deepEqual(sizeOf({ videoWidth: 1280, videoHeight: 720 }), { width: 1280, height: 720 });
});

test("sizeOf: prefers natural over video when both present", () => {
  assert.deepEqual(
    sizeOf({ naturalWidth: 100, naturalHeight: 200, videoWidth: 999, videoHeight: 999 }),
    { width: 100, height: 200 },
  );
});

test("sizeOf: zero or missing dims return null", () => {
  assert.equal(sizeOf({ naturalWidth: 0, naturalHeight: 0 }), null);
  assert.equal(sizeOf({ naturalWidth: 0, naturalHeight: 100 }), null);
  assert.equal(sizeOf({}), null);
  assert.equal(sizeOf(null), null);
  assert.equal(sizeOf(undefined), null);
});

test("sizeOf: rounds to integer pixels", () => {
  assert.deepEqual(sizeOf({ naturalWidth: 1920.7, naturalHeight: 1080.3 }), { width: 1921, height: 1080 });
});

test("sameSize: equal, null/null, mixed", () => {
  assert.ok(sameSize(null, null));
  assert.ok(sameSize({ width: 1920, height: 1080 }, { width: 1920, height: 1080 }));
  assert.ok(!sameSize(null, { width: 1, height: 1 }));
  assert.ok(!sameSize({ width: 1, height: 1 }, null));
  assert.ok(!sameSize({ width: 1920, height: 1080 }, { width: 1280, height: 720 }));
});