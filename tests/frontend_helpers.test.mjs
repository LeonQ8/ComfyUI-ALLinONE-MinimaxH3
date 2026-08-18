// Tests for pure helpers in web/h3_helpers.mjs plus a smoke check that the
// main bundle parses. Phase 4 (Auto Aspect/Resolution) will land more tests
// here.

import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import { aspect, sizeOf, sameSize, orientRes, fitResolutionToAspect } from "../web/h3_helpers.mjs";

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

test("orientRes: flips landscape preset when portrait is requested", () => {
  const r = orientRes({ width: 1344, height: 768, label: "1344x768" }, "portrait");
  assert.equal(r.width, 768);
  assert.equal(r.height, 1344);
  assert.equal(r.label, "768x1344");
});

test("orientRes: leaves already-portrait preset alone", () => {
  const r = orientRes({ width: 768, height: 1344, label: "768x1344" }, "portrait");
  assert.equal(r.width, 768);
  assert.equal(r.height, 1344);
});

test("orientRes: landscape orientation never flips", () => {
  const r = orientRes({ width: 1344, height: 768, label: "1344x768" }, "landscape");
  assert.equal(r.width, 1344);
  assert.equal(r.height, 768);
});

test("orientRes: null or missing orientation returns the input unchanged", () => {
  const input = { width: 1344, height: 768, label: "1344x768" };
  assert.strictEqual(orientRes(input, null), input);
  const r = orientRes({ width: 1344, height: 768, label: "1344x768" });
  assert.equal(r.width, 1344);
  assert.equal(r.label, "1344x768");
});

test("orientRes: square preset is unchanged even with portrait request", () => {
  const r = orientRes({ width: 768, height: 768, label: "768x768" }, "portrait");
  assert.equal(r.width, 768);
  assert.equal(r.height, 768);
});

test("fitResolutionToAspect: 16:9 source into 1344x768 budget stays 16:9-ish", () => {
  const r = fitResolutionToAspect(1920, 1080, 1344, 768);
  assert.ok(r.width % 32 === 0);
  assert.ok(r.height % 32 === 0);
  assert.ok(Math.min(r.width, r.height) <= 768);
  assert.ok(Math.max(r.width, r.height) <= 1344);
  assert.ok(r.width * r.height <= 1344 * 768);
  const ratio = r.width / r.height;
  assert.ok(Math.abs(Math.log(ratio / (1920 / 1080))) < 0.05);
});

test("fitResolutionToAspect: 9:16 source flips into portrait fit", () => {
  const r = fitResolutionToAspect(1080, 1920, 1344, 768);
  assert.ok(r.width % 32 === 0);
  assert.ok(r.height % 32 === 0);
  assert.ok(Math.min(r.width, r.height) <= 768);
  assert.ok(Math.max(r.width, r.height) <= 1344);
  assert.ok(r.width * r.height <= 1344 * 768);
  assert.ok(r.height > r.width, "portrait source should produce taller result");
});

test("fitResolutionToAspect: 1:1 source lands on a square-ish fit", () => {
  const r = fitResolutionToAspect(1024, 1024, 1344, 768);
  assert.ok(r.width % 32 === 0 && r.height % 32 === 0);
  assert.ok(Math.abs(Math.log(r.width / r.height)) < 0.05);
  assert.ok(Math.min(r.width, r.height) <= 768);
  assert.ok(Math.max(r.width, r.height) <= 1344);
});

test("fitResolutionToAspect: extreme 5:1 panorama stays within caps", () => {
  const r = fitResolutionToAspect(5000, 1000, 1344, 768);
  assert.ok(r.width % 32 === 0);
  assert.ok(r.height % 32 === 0);
  assert.ok(Math.min(r.width, r.height) <= 768);
  assert.ok(Math.max(r.width, r.height) <= 1344);
  assert.ok(r.width > r.height);
});

test("fitResolutionToAspect: degenerate inputs return target unchanged", () => {
  assert.deepEqual(fitResolutionToAspect(0, 1080, 1344, 768), { width: 1344, height: 768 });
  assert.deepEqual(fitResolutionToAspect(1920, 0, 1344, 768), { width: 1344, height: 768 });
  assert.deepEqual(fitResolutionToAspect(1920, 1080, 0, 768), { width: 0, height: 768 });
  assert.deepEqual(fitResolutionToAspect(NaN, 1080, 1344, 768), { width: 1344, height: 768 });
});

test("fitResolutionToAspect: respects a smaller area budget", () => {
  const r = fitResolutionToAspect(1920, 1080, 800, 450);
  assert.ok(r.width * r.height <= 800 * 450 + 1);
  assert.ok(r.width % 32 === 0 && r.height % 32 === 0);
});

// -- Build-order regression guard --------------------------------------------
// The bundle builds its UI inside one _buildUI function. helpers that run
// during that build (persist, _syncFitRowFn, driveFromDD.onChange) must not
// reference consts declared later in the same scope: a `typeof _x === "function"`
// or `_x && _x()` guard on a TDZ const throws ReferenceError instead of
// returning undefined, because TDZ makes even a read of the identifier throw.
// Late-bound helpers must use the `let _x = null` holder pattern: declared
// early (before persist), assigned to the real function later. This invariant
// would have caught the _syncFitRow TDZ crash, the _updateFramesLabel crash
// via driveFromDD.updateItems, and the latent _syncLiveToggle hazard.

function collectLocalDecls(bundle) {
  const decls = new Map(); // name -> first declaration offset
  const re = /\b(?:const|let|function|var)\s+([A-Za-z_$][\w$]*)\b/g;
  let m;
  while ((m = re.exec(bundle))) {
    if (!decls.has(m[1])) decls.set(m[1], m.index);
  }
  return decls;
}

function guardOffenders(bundle) {
  const decls = collectLocalDecls(bundle);
  const offenders = [];
  const pushOff = (name, offset, reason) => {
    const declAt = decls.get(name);
    if (name.startsWith("_") && declAt !== undefined && declAt > offset) {
      offenders.push(`${name} (guarded at ${offset}, declared at ${declAt}: ${reason})`);
    }
  };
  const typeofRe = /typeof\s+([A-Za-z_$][\w$]*)\s*===/g;
  let m;
  while ((m = typeofRe.exec(bundle))) pushOff(m[1], m.index, "typeof guard");
  const andRe = /\b([A-Za-z_$][\w$]*)\s*&&\s*\1\s*\(/g;
  while ((m = andRe.exec(bundle))) pushOff(m[1], m.index, "&& short-circuit");
  return [...new Set(offenders)];
}

test("no guard may reference a helper declared later as const", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  const offenders = guardOffenders(bundle);
  assert.deepEqual(
    offenders,
    [],
    "typeof/&& guards on later-declared consts throw in the temporal dead zone during _buildUI; use the let _x = null holder pattern instead",
  );
});

test("every late-bound _xFn holder is declared before persist", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  const persistIdx = bundle.indexOf("function persist(){");
  assert.notEqual(persistIdx, -1);
  const holders = bundle.match(/\blet\s+(_\w+Fn)\s*=\s*null\s*;/g) || [];
  assert.ok(holders.length >= 1, "expected at least one late-bound holder");
  for (const h of holders) {
    const decl = `let ${h.replace("let ", "").trim()}`;
    const idx = bundle.indexOf(decl);
    assert.ok(idx !== -1 && idx < persistIdx, `${decl} must be declared before persist()`);
  }
  assert.ok(/_syncFitRowFn/.test(bundle), "_syncFitRowFn holder must exist");
});