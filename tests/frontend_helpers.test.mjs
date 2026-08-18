// Smoke tests for the One Node MiniMax H3 frontend bundle.
//
// The full web bundle (web/one_node_minimax_h3.js) runs in a browser inside
// ComfyUI; it can't be executed under plain Node. Future phases (Media
// Dimensions, Auto Aspect/Resolution) will extract pure helpers into
// web/h3_helpers.mjs which CAN run under Node - those tests land in
// Phase 3 and Phase 4.
//
// For Phase 1 this file only verifies the bundle still parses with
// `node --check` (run separately in CI) and that the bundle has the shape
// we expect (a non-trivial extension registration file).

import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const webDir = resolve(root, "web");
const bundlePath = resolve(webDir, "one_node_minimax_h3.js");

test("web directory contains the bundle", () => {
  const files = readdirSync(webDir);
  assert.ok(
    files.includes("one_node_minimax_h3.js"),
    `expected one_node_minimax_h3.js in ${webDir}, found ${JSON.stringify(files)}`,
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
