// Tests for pure helpers in web/h3_helpers.mjs plus a smoke check that the
// main bundle parses. Phase 4 (Auto Aspect/Resolution) will land more tests
// here.

import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import { aspect, sizeOf, sameSize, mapMaskPoint, orientRes, fitResolutionToAspect, planMaskCrop, maskTrackingPlan, resolveFitPrimary, imgProfileShort, imgAspectName, viewQuery, thumbQuery, isImageItem, inputFileExists, h3SamCheckpoints, clampImageMP, planImageCanvas, planImageCanvasForRatio, planUpscaleTarget, IMG_MAX_MP, IMG_MIN_MP, IMG_ASPECT_RATIOS, resolveQualityFlags, matchQualityPreset, QUALITY_PRESET_FLAGS, planExtend, queuePromptPayload, settleQueuedOutput, maskSpeechSyncPrompt, cropFrameIndex, cropBoxAt, cropReportText, lumaToAlpha, maskDetectionHint, maskRunErrorHint, clampTimecode, compareGridColumns, compareGridRows, compareWindow, syncTargets, formatTimecode, makeCompareSlots } from "../web/h3_helpers.mjs";

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

test("helpers file is non-trivial and exports the core helpers", () => {
  const src = readFileSync(helpersPath, "utf8");
  assert.ok(src.includes("export function aspect"), "helpers must export aspect");
  assert.ok(src.includes("export function sizeOf"), "helpers must export sizeOf");
  assert.ok(src.includes("export function sameSize"), "helpers must export sameSize");
  assert.ok(src.includes("export function mapMaskPoint"), "helpers must export mapMaskPoint");
  assert.ok(src.includes("export function imgProfileShort"), "helpers must export imgProfileShort");
  assert.ok(src.includes("export function imgAspectName"), "helpers must export imgAspectName");
  assert.ok(src.includes("export function viewQuery"), "helpers must export viewQuery");
  assert.ok(src.includes("export function thumbQuery"), "helpers must export thumbQuery");
  assert.ok(src.includes("export function isImageItem"), "helpers must export isImageItem");
  assert.ok(src.includes("export function inputFileExists"), "helpers must export inputFileExists");
  assert.ok(src.includes("export function h3SamCheckpoints"), "helpers must export h3SamCheckpoints");
  assert.ok(src.includes("export function planMaskCrop"), "helpers must export planMaskCrop");
  assert.ok(src.includes("export function maskTrackingPlan"), "helpers must export maskTrackingPlan");
  assert.ok(src.includes("export function clampImageMP"), "helpers must export clampImageMP");
  assert.ok(src.includes("export function planImageCanvas"), "helpers must export planImageCanvas");
  assert.ok(src.includes("export function planImageCanvasForRatio"), "helpers must export planImageCanvasForRatio");
  assert.ok(src.includes("export function planUpscaleTarget"), "helpers must export planUpscaleTarget");
  assert.ok(src.includes("export function planExtend"), "helpers must export planExtend");
  assert.ok(src.includes("export function queuePromptPayload"), "helpers must export queuePromptPayload");
  assert.ok(src.includes("export function cropFrameIndex"), "helpers must export cropFrameIndex");
  assert.ok(src.includes("export function cropBoxAt"), "helpers must export cropBoxAt");
  assert.ok(src.includes("export function cropReportText"), "helpers must export cropReportText");
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

test("planMaskCrop: caps the pixel budget so any mask shape stays H3-safe", () => {
  const crop = planMaskCrop(16384, 1024);
  assert.ok(crop.megapixels <= 0.5, "a mask-shaped crop must stay under the 768 short-edge H3 cap for any aspect");
  assert.equal(crop.masked, true, "mask crops hug the tracked object");
  assert.ok(crop.width > 0 && crop.height > 0);
});

test("planMaskCrop: a low preset keeps its own pixel budget", () => {
  const crop = planMaskCrop(864, 480);
  assert.ok(crop.megapixels <= 0.5);
  assert.equal(crop.aspectRatio, 864 / 480);
});

test("planMaskCrop: invalid input uses a safe H3 canvas", () => {
  const crop = planMaskCrop(0, NaN);
  assert.ok(crop.width > 0 && crop.height > 0);
  assert.ok(crop.megapixels <= 0.5);
});

test("maskTrackingPlan: a text target defines the tracked object; paint only seeds when no text", () => {
  assert.deepEqual(maskTrackingPlan(true, "person"), { maxObjects: 1, objectIndices: "0", seedPaint: false });
  assert.deepEqual(maskTrackingPlan(true, ""), { maxObjects: 1, objectIndices: "0", seedPaint: true });
  assert.deepEqual(maskTrackingPlan(false, "person"), { maxObjects: 1, objectIndices: "0", seedPaint: false });
});

test("maskSpeechSyncPrompt: adds the speech-drive directive under detailed_description", () => {
  const out = maskSpeechSyncPrompt("summary:\n[video editing] replace the face.\n\ndetailed_description:\n[Shot 1] The face changes.\n\noverall_soundscape:\nKeep the source soundtrack unchanged.");
  assert.ok(out.includes("<Audio 1>: speech_drive"), "must label the preserved speech as an audio reference");
  assert.ok(/detailed_description:\n<Audio 1>: speech_drive/i.test(out), "must be injected into detailed_description");
  assert.ok(out.includes("mouth moving in sync"), "must request lip sync");
});

test("maskSpeechSyncPrompt: falls back to overall_soundscape when there is no detailed_description", () => {
  const out = maskSpeechSyncPrompt("summary:\nswap the face.\n\noverall_soundscape:\nKeep the source soundtrack unchanged.");
  assert.ok(/overall_soundscape:\n<Audio 1>: speech_drive/i.test(out), "must inject under overall_soundscape");
});

test("maskSpeechSyncPrompt: appends when neither field exists", () => {
  const out = maskSpeechSyncPrompt("swap the face, keep everything else");
  assert.ok(out.endsWith("<Audio 1>: speech_drive - The replacement speaks the same words as the source speech heard in <Audio 1>, mouth moving in sync with it."));
});

test("maskSpeechSyncPrompt: is idempotent and ignores empty input", () => {
  const once = maskSpeechSyncPrompt("detailed_description:\nface swap");
  assert.equal(maskSpeechSyncPrompt(once), once, "a prompt that already names <Audio 1> must be untouched");
  assert.equal(maskSpeechSyncPrompt(""), "");
  assert.equal(maskSpeechSyncPrompt(null), "");
});

// -- Per-slot fit primary -----------------------------------------------------

const SLOTS = [
  { key: "first", label: "First Frame", size: { width: 1080, height: 1920 } },
  { key: "last", label: "Last Frame", size: { width: 720, height: 1280 } },
];

test("resolveFitPrimary: defaults to the first available slot", () => {
  const p = resolveFitPrimary(null, SLOTS);
  assert.deepEqual(p, { key: "first", label: "First Frame", mode: "fit", size: { width: 1080, height: 1920 } });
});

test("resolveFitPrimary: honors an explicit slot key", () => {
  const p = resolveFitPrimary({ key: "last", mode: "fit", custom: null }, SLOTS);
  assert.deepEqual(p, { key: "last", label: "Last Frame", mode: "fit", size: { width: 720, height: 1280 } });
});

test("resolveFitPrimary: custom mode returns the custom size", () => {
  const p = resolveFitPrimary({ key: "last", mode: "custom", custom: { width: 640, height: 640 } }, SLOTS);
  assert.deepEqual(p, { key: "last", label: "Last Frame", mode: "custom", size: { width: 640, height: 640 } });
});

test("resolveFitPrimary: stale key falls back to first slot", () => {
  const p = resolveFitPrimary({ key: "gone", mode: "fit", custom: null }, SLOTS);
  assert.deepEqual(p, { key: "first", label: "First Frame", mode: "fit", size: { width: 1080, height: 1920 } });
});

test("resolveFitPrimary: empty or all-unfit slots return null", () => {
  assert.equal(resolveFitPrimary({ key: "x", mode: "fit", custom: null }, []), null);
  assert.equal(resolveFitPrimary(null, [{ key: "a", label: "A", size: null }]), null);
  assert.equal(resolveFitPrimary(null, [{ key: "a", label: "A", size: { width: 0, height: 100 } }]), null);
});

test("resolveFitPrimary: custom mode with invalid custom falls back to fit", () => {
  const p = resolveFitPrimary({ key: "last", mode: "custom", custom: null }, SLOTS);
  assert.deepEqual(p, { key: "last", label: "Last Frame", mode: "fit", size: { width: 720, height: 1280 } });
});

test("resolveFitPrimary: normal mode returns the native slot size", () => {
  const p = resolveFitPrimary({ key: "first", mode: "normal", custom: null }, SLOTS);
  assert.deepEqual(p, { key: "first", label: "First Frame", mode: "normal", size: { width: 1080, height: 1920 } });
});

test("resolveFitPrimary: normal mode with no explicit key picks the first slot", () => {
  const p = resolveFitPrimary({ key: null, mode: "normal", custom: null }, SLOTS);
  assert.deepEqual(p, { key: "first", label: "First Frame", mode: "normal", size: { width: 1080, height: 1920 } });
});

test("imgProfileShort: base profiles get short tokens", () => {
  assert.equal(imgProfileShort("base_quality_20"), "Base 20");
  assert.equal(imgProfileShort("base_balanced_12"), "Base 12");
});

test("imgProfileShort: lightx profiles get step-coded tokens", () => {
  assert.equal(imgProfileShort("lightx_v1_fl2v_8"), "FL2VA 8");
  assert.equal(imgProfileShort("lightx_v1_fl2v_4_pruned"), "FL2VA 4");
  assert.equal(imgProfileShort("lightx_sa_solver_4"), "SA-Solver 4");
  assert.equal(imgProfileShort("lightx_er_sde_4"), "ER-SDE 4");
});

test("imgProfileShort: ref2v keys win over the sampler prefix", () => {
  assert.equal(imgProfileShort("lightx_v01_ref2v_er_sde_4_pruned"), "REF2V");
  assert.equal(imgProfileShort("lightx_v01_ref2v_sa_solver_4_pruned"), "REF2V");
});

test("imgProfileShort: custom and unknown keys fall back safely", () => {
  assert.equal(imgProfileShort("custom"), "Custom");
  assert.equal(imgProfileShort(null), "Custom");
  assert.equal(imgProfileShort(""), "Custom");
  assert.equal(imgProfileShort("not_a_real_profile"), "Base 20");
});

test("imgAspectName: every aspect key gets a friendly name", () => {
  assert.equal(imgAspectName("1:1"), "Square");
  assert.equal(imgAspectName("16:9"), "Widescreen");
  assert.equal(imgAspectName("9:16"), "Portrait");
  assert.equal(imgAspectName("4:3"), "Standard");
  assert.equal(imgAspectName("3:4"), "Standard Portrait");
  assert.equal(imgAspectName("3:2"), "Wide");
  assert.equal(imgAspectName("2:3"), "Tall");
  assert.equal(imgAspectName("21:9"), "Cinematic");
});

test("imgAspectName: custom and unknown keys pass through", () => {
  assert.equal(imgAspectName("Custom"), "Custom");
  assert.equal(imgAspectName("17:5"), "17:5");
  assert.equal(imgAspectName(null), "");
  assert.equal(imgAspectName(undefined), "");
});

test("viewQuery: builds a busted query from a gallery item", () => {
  const q = viewQuery({ filename: "img_00001_.png", subfolder: "one-node-minimax-h3", type: "output", mtime: 1234567890 });
  assert.equal(q, "filename=img_00001_.png&type=output&subfolder=one-node-minimax-h3&m=1234567890");
});

test("viewQuery: falls back to Date.now when no mtime is known", () => {
  const before = Date.now();
  const q = viewQuery({ filename: "img_00001_.png", subfolder: "" });
  assert.match(q, /^filename=img_00001_\.png&type=output&subfolder=&m=\d+$/);
  const m = Number(q.split("m=")[1]);
  assert.ok(m >= before && m <= Date.now() + 10, `m=${m} outside the timing window`);
});

test("viewQuery: honors an explicit type override and history-style items", () => {
  const q = viewQuery({ video: "h3_00001_.mp4", subfolder: "one-node-minimax-h3", type: "output" }, "temp");
  assert.match(q, /filename=h3_00001_\.mp4&type=temp&subfolder=one-node-minimax-h3/);
});

test("viewQuery: encodes special characters", () => {
  const q = viewQuery({ filename: "my image (2).png", subfolder: "a b", type: "output", mtime: 7 });
  assert.equal(q, "filename=my%20image%20(2).png&type=output&subfolder=a%20b&m=7");
});

test("viewQuery: empty item produces empty filename", () => {
  const q = viewQuery(null);
  assert.match(q, /^filename=&type=output&subfolder=&m=\d+$/);
});

test("thumbQuery: includes max and drops the cache-busting m param", () => {
  const q = thumbQuery({ filename: "pic.png", subfolder: "one-node-minimax-h3", type: "output" }, 256);
  assert.equal(q, "filename=pic.png&type=output&subfolder=one-node-minimax-h3&max=256");
});

test("thumbQuery: honors a type override and defaults max", () => {
  const q = thumbQuery({ video: "preview.mp4", subfolder: "", type: "temp" }, undefined, "temp");
  assert.match(q, /filename=preview\.mp4&type=temp&subfolder=&max=\d+/);
});

test("thumbQuery: encodes special characters", () => {
  const q = thumbQuery({ filename: "my image (2).png", subfolder: "a b", type: "output" }, 512);
  assert.equal(q, "filename=my%20image%20(2).png&type=output&subfolder=a%20b&max=512");
});

test("isImageItem: detects images by kind and extension", () => {
  assert.equal(isImageItem({ filename: "a.png", kind: "image" }), true);
  assert.equal(isImageItem({ filename: "a.jpeg" }), true);
  assert.equal(isImageItem({ filename: "a.webp" }), true);
  assert.equal(isImageItem({ filename: "a.mp4", kind: "video" }), false);
  assert.equal(isImageItem({ filename: "a.mp4" }), false);
  assert.equal(isImageItem(null), false);
});

test("inputFileExists: matches a file in the listing", () => {
  assert.equal(inputFileExists(["a.mp3", "b.mp3"], "b.mp3"), true);
  assert.equal(inputFileExists(["a.mp3", "b.mp3"], "c.mp3"), false);
});

test("inputFileExists: compares basenames, ignoring subfolder prefixes", () => {
  assert.equal(inputFileExists(["sub/a.mp3"], "a.mp3"), true);
  assert.equal(inputFileExists(["a.mp3"], "sub\\a.mp3"), true);
});

test("inputFileExists: empty or bad input returns false", () => {
  assert.equal(inputFileExists(["a.mp3"], ""), false);
  assert.equal(inputFileExists(["a.mp3"], null), false);
  assert.equal(inputFileExists(null, "a.mp3"), false);
  assert.equal(inputFileExists(undefined, "a.mp3"), false);
});

// -- H3 Studio image canvas clamp (Image mode) --------------------------------

test("clampImageMP: clamps above the 8.5 MP ceiling", () => {
  assert.equal(clampImageMP(24.92), IMG_MAX_MP);
  assert.equal(clampImageMP(100), IMG_MAX_MP);
  assert.equal(clampImageMP(8.51), IMG_MAX_MP);
});

test("clampImageMP: clamps below the 0.2 MP floor", () => {
  assert.equal(clampImageMP(0.1), IMG_MIN_MP);
  assert.equal(clampImageMP(0.0), IMG_MIN_MP);
  assert.equal(clampImageMP(-3), IMG_MIN_MP);
});

test("clampImageMP: keeps in-range values and falls back on garbage", () => {
  assert.equal(clampImageMP(1.5), 1.5);
  assert.equal(clampImageMP(0.2), 0.2);
  assert.equal(clampImageMP(8.5), 8.5);
  assert.equal(clampImageMP(NaN), 1.0);
  assert.equal(clampImageMP(undefined), 1.0);
  assert.equal(clampImageMP("oops"), 1.0);
});

test("planImageCanvas: custom dims over the ceiling are scaled down to 8.5 MP", () => {
  const p = planImageCanvas({ mode: "custom", width: 4992, height: 4992 });
  assert.ok(p.width * p.height <= IMG_MAX_MP * 1e6, "area must fit the ceiling");
  assert.ok(p.width % 32 === 0 && p.height % 32 === 0, "dims stay on the 32 grid");
  assert.equal(p.capped, true);
  assert.ok(p.megapixels > 8.0 && p.megapixels <= IMG_MAX_MP, `megapixels must land near the ceiling, got ${p.megapixels}`);
  assert.ok(Math.abs(Math.log(p.width / p.height)) < 0.001, "aspect ratio preserved");
});

test("planImageCanvas: custom dims under the ceiling pass through aligned", () => {
  const p = planImageCanvas({ mode: "custom", width: 1024, height: 1024 });
  assert.equal(p.width, 1024);
  assert.equal(p.height, 1024);
  assert.equal(p.capped, false);
  assert.equal(p.megapixels, 1024 * 1024 / 1e6);
});

test("planImageCanvas: ratio mode never exceeds the ceiling even at max MP", () => {
  for (const aspect of Object.keys(IMG_ASPECT_RATIOS)) {
    const p = planImageCanvas({ mode: "ratio", aspect, megapixels: 24.92 });
    assert.ok(p.width * p.height <= IMG_MAX_MP * 1e6, `${aspect} must fit the ceiling`);
    assert.ok(p.width % 32 === 0 && p.height % 32 === 0, `${aspect} stays on the 32 grid`);
    const drift = Math.abs(Math.log((p.width / p.height) / IMG_ASPECT_RATIOS[aspect]));
    assert.ok(drift < 0.05, `${aspect} keeps its ratio (drift ${drift})`);
  }
});

test("planImageCanvas: ratio mode honors an in-range megapixel request", () => {
  const p = planImageCanvas({ mode: "ratio", aspect: "1:1", megapixels: 1.0 });
  assert.ok(p.width >= 960 && p.width <= 1024, `1MP square lands near 1024 (got ${p.width})`);
  assert.equal(Math.abs(p.width - p.height) < 2, true);
  assert.equal(p.capped, false);
});

test("planImageCanvas: garbage inputs fall back to a sane 1024 canvas", () => {
  const p = planImageCanvas({ mode: "custom", width: NaN, height: undefined });
  assert.equal(p.width, 1024);
  assert.equal(p.height, 1024);
  assert.ok(p.megapixels <= IMG_MAX_MP);
  const q = planImageCanvas({ mode: "ratio", aspect: "nope", megapixels: "x" });
  assert.ok(q.width >= 32 && q.height >= 32);
  assert.ok(q.width * q.height <= IMG_MAX_MP * 1e6);
});

test("planImageCanvas: tiny custom dims snap up to 32", () => {
  const p = planImageCanvas({ mode: "custom", width: 10, height: 10 });
  assert.equal(p.width, 32);
  assert.equal(p.height, 32);
  assert.equal(p.capped, false);
});

test("planImageCanvas: extreme portrait custom dims keep ratio and cap", () => {
  const p = planImageCanvas({ mode: "custom", width: 1024, height: 12000 });
  assert.ok(p.width * p.height <= IMG_MAX_MP * 1e6);
  assert.ok(p.width < p.height, "stays portrait");
  const ratio = p.height / p.width;
  assert.ok(Math.abs(Math.log(ratio / (12000 / 1024))) < 0.05, "portrait ratio preserved");
});

test("planImageCanvasForRatio: scales a custom aspect up and down with MP", () => {
  const wide = planImageCanvasForRatio(1.0, 16 / 9);
  assert.ok(wide.width > wide.height, "wide stays wide");
  const drift = Math.abs(Math.log((wide.width / wide.height) / (16 / 9)));
  assert.ok(drift < 0.05, `ratio preserved (drift ${drift})`);
  assert.ok(wide.width % 32 === 0 && wide.height % 32 === 0, "stays on the 32 grid");
  const bigger = planImageCanvasForRatio(2.0, 16 / 9);
  assert.ok(bigger.width * bigger.height > wide.width * wide.height, "more MP gives a bigger canvas");
  assert.ok(bigger.width * bigger.height <= IMG_MAX_MP * 1e6, "never exceeds the ceiling");
});

test("planImageCanvasForRatio: clamps above the ceiling and floors invalid ratios", () => {
  const huge = planImageCanvasForRatio(24.92, 1);
  assert.ok(huge.width * huge.height <= IMG_MAX_MP * 1e6, "caps at the ceiling");
  assert.ok(huge.megapixels > 8.0 && huge.megapixels <= IMG_MAX_MP, `lands near ceiling (${huge.megapixels})`);
  const square = planImageCanvasForRatio(1.0, 0);
  assert.ok(Math.abs(square.width - square.height) < 2, "invalid ratio falls back to square");
  const nan = planImageCanvasForRatio(1.0, NaN);
  assert.ok(nan.width >= 32 && nan.height >= 32);
});

test("planImageCanvasForRatio: preserves a source image ratio when MP changes", () => {
  const fit = fitResolutionToAspect(1234, 680, 1344, 768);
  const sourceRatio = fit.width / fit.height;
  const p1 = planImageCanvasForRatio(1.0, sourceRatio);
  const p2 = planImageCanvasForRatio(1.5, sourceRatio);
  for (const p of [p1, p2]) {
    const drift = Math.abs(Math.log((p.width / p.height) / sourceRatio));
    assert.ok(drift < 0.05, `keeps the source ratio (drift ${drift})`);
  }
  assert.ok(p2.width * p2.height > p1.width * p1.height, "higher MP scales up");
});

test("planUpscaleTarget: a normal 2x upscale stays a true 2x", () => {
  const p = planUpscaleTarget(1024, 576, 2);
  assert.equal(p.width, 2048);
  assert.equal(p.height, 1152);
  assert.equal(p.capped, false);
});

test("planUpscaleTarget: 4x on a large source is capped to 4096 long edge", () => {
  const p = planUpscaleTarget(4032, 2520, 4);
  assert.ok(Math.max(p.width, p.height) <= 4096, `long edge must not exceed 4096 (got ${Math.max(p.width, p.height)})`);
  assert.equal(p.capped, true);
  assert.ok(p.width % 8 === 0 && p.height % 8 === 0, "dims stay on the 8 grid");
  const drift = Math.abs(Math.log((p.width / p.height) / (4032 / 2520)));
  assert.ok(drift < 0.05, `aspect preserved (drift ${drift})`);
});

test("planUpscaleTarget: a custom cap is honored", () => {
  const p = planUpscaleTarget(2000, 1000, 2, 2560);
  assert.ok(Math.max(p.width, p.height) <= 2560, "respects a smaller cap");
  assert.equal(p.capped, true);
});

test("planUpscaleTarget: invalid input returns null", () => {
  assert.equal(planUpscaleTarget(0, 100, 2), null);
  assert.equal(planUpscaleTarget(100, -5, 2), null);
  assert.equal(planUpscaleTarget(100, 100, 0), null);
  assert.equal(planUpscaleTarget(NaN, 100, 2), null);
});

// -- Extend mode length planning ---------------------------------------------

test("planExtend: 5s at 24fps plans ~5s of new content on a valid run", () => {
  const p = planExtend(5, 24);
  assert.equal(p.contextLength, 39);
  assert.equal(p.newFrames % 17, 0);
  assert.ok(Math.abs(p.newFrames - 120) <= 17, `newFrames ${p.newFrames} must be within one block of 120`);
  assert.equal(p.targetLength, p.contextLength + p.newFrames);
  assert.equal((p.targetLength - 5) % 17, 0, "target must be a valid H3 run");
});

test("planExtend: 10s at 24fps plans ~10s of new content", () => {
  const p = planExtend(10, 24);
  assert.equal(p.contextLength, 39);
  assert.equal(p.newFrames % 17, 0);
  assert.ok(Math.abs(p.newFrames - 240) <= 17, `newFrames ${p.newFrames} must be within one block of 240`);
  assert.equal((p.targetLength - 5) % 17, 0);
});

test("planExtend: output length is always [source] + [new content]", () => {
  const p = planExtend(5, 24);
  const source = 124;
  const total = source + p.newFrames;
  assert.ok(total / 24 >= 4.9 && total / 24 <= 10.2, `total ${total} frames should land near 10s`);
});

test("planExtend: never plans fewer than one 17-frame block", () => {
  const p = planExtend(0.5, 24);
  assert.equal(p.newFrames, 17);
  assert.equal(p.targetLength, 39 + 17);
});

test("planExtend: caps the target to the maxTarget budget", () => {
  const p = planExtend(120, 24, { maxTarget: 736 });
  assert.ok(p.targetLength <= 736, `target ${p.targetLength} must respect maxTarget`);
  assert.equal(p.targetLength, 736);
});

test("planExtend: garbage inputs fall back to one block", () => {
  for (const bad of [NaN, undefined, null, "", 0, -5]) {
    const p = planExtend(bad, 24);
    assert.equal(p.newFrames, 17, `bad input ${String(bad)}`);
    assert.equal(p.contextLength, 39);
  }
});

test("planExtend: honors a non-default fps", () => {
  const p = planExtend(5, 30);
  assert.ok(Math.abs(p.newFrames - 150) <= 17, `newFrames ${p.newFrames} must be within one block of 150`);
  assert.equal((p.targetLength - 5) % 17, 0);
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

test("resolveQualityFlags: preset flags stay valid for every combo", () => {
  assert.deepEqual(resolveQualityFlags(false, false, false, false), { sol: false, sage: false, kitchen: false, sla: false });
  assert.deepEqual(resolveQualityFlags(true, false, false, false), { sol: true, sage: false, kitchen: false, sla: false });
  assert.deepEqual(resolveQualityFlags(false, true, false, false), { sol: false, sage: true, kitchen: false, sla: false });
  assert.deepEqual(resolveQualityFlags(false, false, true, false), { sol: false, sage: false, kitchen: true, sla: false });
  assert.deepEqual(resolveQualityFlags(true, false, true, false), { sol: true, sage: false, kitchen: true, sla: false });
});

test("resolveQualityFlags: kitchen and sage can never run together", () => {
  assert.deepEqual(resolveQualityFlags(true, true, true, false), { sol: true, sage: false, kitchen: true, sla: false });
  assert.deepEqual(resolveQualityFlags(false, true, true, false), { sol: false, sage: false, kitchen: true, sla: false });
  assert.deepEqual(resolveQualityFlags(true, true, false, false), { sol: true, sage: true, kitchen: false, sla: false });
});

test("resolveQualityFlags: sla is exclusive with sol and sage, kitchen stays", () => {
  assert.deepEqual(resolveQualityFlags(true, true, false, true), { sol: false, sage: false, kitchen: false, sla: true });
  assert.deepEqual(resolveQualityFlags(true, true, true, true), { sol: false, sage: false, kitchen: true, sla: true });
  assert.deepEqual(resolveQualityFlags(false, true, true, true), { sol: false, sage: false, kitchen: true, sla: true });
  assert.deepEqual(resolveQualityFlags(false, false, true, true), { sol: false, sage: false, kitchen: true, sla: true });
  assert.deepEqual(resolveQualityFlags(false, false, false, true), { sol: false, sage: false, kitchen: false, sla: true });
});

test("matchQualityPreset: preset combos resolve to their keys", () => {
  assert.equal(matchQualityPreset({ sol: true, sage: false, kitchen: false }), "speed");
  assert.equal(matchQualityPreset({ sol: true, sage: false, kitchen: false }, QUALITY_PRESET_FLAGS, ["balanced"]), "balanced");
  assert.equal(matchQualityPreset({ sol: false, sage: true, kitchen: false }), "high");
  assert.equal(matchQualityPreset({ sol: false, sage: false, kitchen: false }), "native");
  assert.equal(matchQualityPreset({ sol: false, sage: false, kitchen: true, sla: true }), "draft");
});

test("matchQualityPreset: kitchen mixes resolve to custom", () => {
  assert.equal(matchQualityPreset({ sol: false, sage: false, kitchen: true }), "custom");
  assert.equal(matchQualityPreset({ sol: true, sage: false, kitchen: true }), "custom");
  assert.equal(matchQualityPreset({ sol: true, sage: true, kitchen: false }), "custom");
  assert.equal(matchQualityPreset({ sol: false, sage: false, kitchen: false, sla: true }), "custom");
});

test("matchQualityPreset: mutual exclusion normalizes before matching", () => {
  assert.equal(matchQualityPreset({ sol: false, sage: true, kitchen: true }), "custom");
  assert.equal(matchQualityPreset({ sol: false, sage: true, kitchen: true }, QUALITY_PRESET_FLAGS, ["high", "native"]), "custom");
  assert.equal(matchQualityPreset({ sol: true, sage: true, kitchen: true, sla: true }), "draft", "sla must drop sol and sage, so kitchen+sla still matches draft");
});

test("matchQualityPreset: nullish flags are treated as off", () => {
  assert.equal(matchQualityPreset(null), "native");
  assert.equal(matchQualityPreset({}), "native");
  assert.equal(matchQualityPreset({ sol: null, sage: undefined, kitchen: 0 }), "native");
  assert.equal(matchQualityPreset({ sol: false, sage: false, kitchen: true, sla: 0 }), "custom");
});

test("matchQualityPreset: every preset is matchable from its own flags", () => {
  for (const key of Object.keys(QUALITY_PRESET_FLAGS)) {
    if (key === "turbo") continue;
    const p = QUALITY_PRESET_FLAGS[key];
    const hit = matchQualityPreset({ sol: p.sol, sage: p.sage, kitchen: p.kitchen, sla: p.sla });
    const q = QUALITY_PRESET_FLAGS[hit];
    assert.ok(hit !== "custom", `${key} must match a preset`);
    assert.equal(q.sol, p.sol, key);
    assert.equal(q.sage, p.sage, key);
    assert.equal(q.kitchen, p.kitchen, key);
    assert.equal(q.sla, p.sla, key);
  }
});

test("bundle wires the SLA chip, availability probe, and SLA Draft chain", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes('_mkOptChip("optSla","SLA"'), "the quality row must expose an SLA chip");
  assert.ok(bundle.includes("_checkSlaAvail"), "the SLA chip must probe availability on load");
  assert.ok(bundle.includes("/h3one/sla_status"), "the SLA availability probe must call the backend route");
  assert.ok(bundle.includes("H3 SLA Attention is not available"), "the SLA chip must explain a missing pack");
  assert.ok(bundle.includes('class_type:"H3SLAAttention"'), "the SLA Draft build must insert the SLA node");
  assert.ok(bundle.includes('class_type:"H3AdaLNLoRAFix"'), "the SLA Draft build must port dense LoRA tensors onto the pruned base");
  assert.ok(bundle.includes('mode:"port"'), "the AdaLN fix must run in port mode");
  assert.ok(bundle.includes('block_size:"64"'), "the SLA node must use 64-wide blocks");
  assert.ok(bundle.includes("min_seq_len:8192"), "the SLA node must keep the packed-length threshold");
  assert.ok(bundle.includes('wf["7"].inputs.model=[sla,0]'), "the guider must take SLA's output directly");
  assert.ok(bundle.includes('wf["9"].inputs.model=[sla,0]'), "the scheduler must take SLA's output directly");
  assert.ok(bundle.includes('sampler_name="euler"'), "the draft preset must force the euler sampler");
  assert.ok(bundle.includes('_QL={balanced:"Balanced"'), "the quality label map must carry the draft label");
});

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

test("queuePromptPayload builds the expected /prompt body", () => {
  const wf = { "1": { class_type: "KSampler", inputs: {} } };
  const body = queuePromptPayload(wf, "client-abc");
  assert.deepEqual(body, {
    prompt: wf,
    client_id: "client-abc",
    extra_data: { enable_previews: true },
  });
});

test("queuePromptPayload keeps the workflow reference and never mutates it", () => {
  const wf = { "1": { class_type: "KSampler", inputs: {} } };
  const body = queuePromptPayload(wf, "client-abc");
  assert.equal(body.prompt, wf);
  assert.deepEqual(wf, { "1": { class_type: "KSampler", inputs: {} } });
  assert.notEqual(body, wf);
});

test("queuePromptPayload defaults previews on regardless of client id value", () => {
  const a = queuePromptPayload({}, undefined);
  assert.equal(a.client_id, undefined);
  assert.deepEqual(a.extra_data, { enable_previews: true });
});

test("bundle wires the + Queue button and its queued-job tracking", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("+ Queue"), "bundle must render the + Queue label");
  assert.ok(bundle.includes("queueBtn"), "bundle must create queueBtn");
  assert.ok(bundle.includes("_queuedJobs"), "bundle must track queued prompt ids by mode");
  assert.ok(bundle.includes("_QUEUE_MODE_SHORT"), "bundle must map modes to short labels for the badge");
  assert.ok(bundle.includes("_activeQueueBtn"), "bundle must expose the queue button for error feedback");
  assert.ok(bundle.includes("_activeQueueBadge"), "bundle must expose the queue counter badge");
  assert.ok(
    bundle.includes("!S.generating&&!_queuedJobs.size"),
    "bundle must route + Queue to Generate when the node is idle, and stack quietly when busy",
  );
  assert.ok(bundle.includes("_h3_showQueued"), "bundle must surface queued outputs into the preview and gallery");
  assert.ok(
    bundle.includes("if(!pid||_batchIds.includes(pid)) _finishRun(pid,false)"),
    "bundle must not let queued jobs advance the Generate run state",
  );
  assert.ok(bundle.includes("_mediaItemFromOutput"), "cached node events must not clear queued media tracking early");
  assert.ok(bundle.includes("_mediaItemFromHistory"), "queued output must have a history fallback");
  assert.ok(bundle.includes("_batchIds.push(data.prompt_id)"), "batch prompt ids must be published as each submission succeeds");
  assert.ok(bundle.includes("JSON.stringify({delete:ids})"), "Stop must remove every active batch prompt");
  assert.ok(bundle.includes("_settledBatchIds"), "batch completion events must be deduplicated by prompt id");
  assert.ok(bundle.includes("queuePromptPayload"), "bundle must build the queue payload");
  assert.ok(bundle.includes('api.fetchApi("/queue"'), "bundle must reconcile the queue counter against GET /queue");
  assert.ok(
    bundle.includes("api.fetchApi(\"/prompt\"") || bundle.includes('api.fetchApi("/prompt"'),
    "bundle must POST queued jobs to /prompt",
  );
  assert.ok(
    bundle.includes("pad.append(navRow,mainRow,genRow,queueRow)"),
    "bundle must mount the queue row below the generate row",
  );
});

test("h3SamCheckpoints: keeps only SAM 3.1 multiplex safetensors", () => {
  assert.deepEqual(
    h3SamCheckpoints([
      "SDXL/model.safetensors",
      "SAM/sam3.1_multiplex_fp16.safetensors",
      "sam3_multiplex_fp16.safetensors",
      "sam3.1_other.safetensors",
      "sam3.1_multiplex_fp16.ckpt",
    ]),
    ["SAM/sam3.1_multiplex_fp16.safetensors"],
  );
  assert.deepEqual(h3SamCheckpoints(null), []);
});

test("bundle wires the Mask mode, brush editor, and runtime preflight", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes('{ key:"mask",        label:"Mask" }'), "Mask must appear in the mode tabs");
  assert.ok(bundle.includes('mask:"mask.json"'), "Mask must load its own workflow template");
  assert.ok(bundle.includes("openVideoMaskEditor"), "Mask must provide a first-frame brush editor");
  assert.ok(bundle.includes("mapMaskPoint"), "the editor must map display coordinates to source pixels");
  assert.ok(bundle.includes("Paint first-frame mask"), "the Mask card must expose the editor action");
  assert.ok(bundle.includes("updateMaskStats"), "the editor must show the painted region size live");
  assert.ok(bundle.includes("Mask: empty"), "the size readout must cover the empty state");
  assert.ok(bundle.includes("zoomInBtn"), "the editor must offer zoom controls");
  assert.ok(bundle.includes("stage.style.zoom"), "the editor must zoom the painting stage");
  assert.ok(bundle.includes("scrollBox"), "the editor must wrap the stage in a scrollable viewport for zoomed panning");
  assert.ok(bundle.includes("Math.exp(-e.deltaY"), "the mouse wheel must zoom the stage");
  assert.ok(bundle.includes("e.button===1"), "the middle mouse button must not paint");
  assert.ok(bundle.includes("scrollBox.scrollLeft=panScrollLeft"), "the middle mouse button must drag-pan the zoomed stage");
  assert.ok(bundle.includes("panning"), "the editor must track the pan state");
  assert.ok(bundle.includes("Circle") && bundle.includes("Square"), "the editor must offer filled circle and square shape tools");
  assert.ok(bundle.includes("paintShape"), "shape tools must stamp filled circle/rectangle regions");
  assert.ok(bundle.includes("undoStack"), "the editor must keep an undo history");
  assert.ok(bundle.includes("redoStack"), "the editor must keep a redo history");
  assert.ok(bundle.includes("undoBtn.onclick=undo") && bundle.includes("redoBtn.onclick=redo"), "the editor must wire Undo and Redo buttons");
  assert.ok(bundle.includes("commitStroke"), "a finished stroke must commit to the undo history");
  assert.ok(bundle.includes("What the numbers mean"), "the mask stats readout must explain what the numbers mean");
  assert.ok(bundle.includes("_checkMaskRuntime"), "Mask must preflight its external node pack");
  assert.ok(bundle.includes("h3SamCheckpoints(_M.checkpoints)"), "Mask must reject non-SAM checkpoints");
  assert.ok(bundle.includes("MVEx_MaskToLatentSpace"), "Mask must require H3-aligned latent masking");
  assert.ok(bundle.includes("MVEx_LatentMaskToMask"), "Mask must paste the grown latent region back, not a tight outline");
  assert.ok(bundle.includes("maskAudioMode"), "Mask must expose the three-way audio mode control");
  assert.ok(
    bundle.includes("Preserve (no lip-sync)"),
    "Mask must offer keep-audio-without-lip-sync for music and non-speaking clips",
  );
  assert.ok(
    bundle.includes('S.maskAudioMode==="preserve") final=maskSpeechSyncPrompt(final)'),
    "the lip-sync directive must be applied to the final wrapped prompt, only in preserve-with-lip-sync mode",
  );
  assert.ok(
    bundle.includes('S.maskAudioMode==="regenerate") final=final.replace(/Keep the source soundtrack'),
    "regenerate must rewrite the soundscape line on the final prompt",
  );
  assert.ok(
    bundle.includes("modeArea.append(i2vArea,refArea,kfArea,adArea,exArea,chainArea,maskArea,imgArea)"),
    "the Mask card must be mounted in the mode area",
  );
  assert.ok(
    bundle.includes("if(_workflowBuildBusy||_uploadsPending>0) return"),
    "mode changes must not mutate an in-flight workflow build",
  );
  assert.ok(bundle.includes("_captureRunMeta"), "completed outputs must keep their submitted metadata");
  assert.ok(bundle.includes("_activeRunMetaByPrompt.set(data.prompt_id,runMeta)"), "batch metadata must be keyed by prompt id");
  assert.ok(bundle.includes("_effectiveMaskCropPlan"), "Mask must reuse one axis-safe crop plan");
  assert.ok(bundle.includes('wf["24"].inputs["mode.aspect_ratio"]=0'), "Mask must let the crop hug the tracked mask instead of forcing a fixed canvas");
  assert.ok(bundle.includes("maskTrackingPlan(S.maskSeed,maskTarget)"), "the SAM tracking plan must be applied from the tested helper");
  assert.ok(bundle.includes("tracking.seedPaint"), "a painted mask must only seed the tracker when no text target is given");
  assert.ok(bundle.includes("Regenerate the soundtrack to match the replacement action"), "regenerated audio must not request source-audio retention");
  assert.ok(bundle.includes("_renderMaskPreview"), "Mask must preview the painted region visually");
  assert.ok(bundle.includes("masked region"), "the mask preview must label the painted area");
  assert.ok(bundle.includes("Locked to 24 fps"), "Mask mode must explain why the FPS field is locked");
  assert.ok(bundle.includes("@ 24 fps (locked)"), "the frame label must communicate the locked rate");
  assert.ok(bundle.includes("ref_audios.ref_audio_0"), "Mask must feed the preserved source speech to H3");
  assert.ok(bundle.includes("maskSpeechSyncPrompt"), "Mask must ask H3 for lip sync with the preserved speech");
  assert.ok(
    bundle.includes('if(S.maskAudioMode==="regenerate") delete wf["6"].inputs["ref_audios.ref_audio_0"]'),
    "regenerated audio must not copy the source speech reference",
  );
});

test("bundle feeds the tracked source crop to H3 as a motion reference", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("ref_videos.ref_video_0"), "Mask must wire the source crop as a ref_video motion reference");
  assert.ok(
    bundle.includes("instead of inventing new motion"),
    "the motion-reference wiring must be documented as a motion fix",
  );
  assert.ok(bundle.includes('wf["7"].inputs.conditioning=[kfId,0]'), "the mask identity anchor must rewire the guider");
  assert.ok(bundle.includes('class_type:"H3IdentityAnchor"'), "Mask must pin the replacement identity at frame 0");
  assert.ok(bundle.includes("frame_count:[\"18\",4]"), "the mask identity anchor must use the prepared frame count");
});

test("bundle makes uploads stale-safe and part of the workflow build barrier", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("const token=++_loadToken"), "media slots must invalidate stale upload responses");
  assert.ok(bundle.includes("_uploadsPending++"), "media uploads must participate in the pending counter");
  assert.ok(bundle.includes("if(token!==_loadToken)"), "stale uploads must not replace newer selections");
  assert.ok(bundle.includes("An upload is still in progress"), "workflow build must fail safely after a stalled upload");
  assert.ok(bundle.includes("_uploadMedia"), "video and audio uploads must use the shared pending barrier");
  assert.ok(bundle.includes("_fileMatches"), "drop and paste must enforce supported extensions");
  assert.ok(bundle.includes("e.pointerId!==activePointer"), "the mask brush must isolate one active pointer");
});

test("bundle wires the SAM3 tracking preview button and route call", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("Preview tracking"), "the Mask card must expose the tracking preview action");
  assert.ok(bundle.includes("maskPreviewBtn"), "the bundle must create the preview button");
  assert.ok(bundle.includes("_previewTracking"), "the bundle must define the preview handler");
  assert.ok(bundle.includes("_showTrackingPreview"), "the bundle must render the returned overlay video");
  assert.ok(bundle.includes('fetch("/h3one/mask_preview"'), "the preview must POST to the tracking-only route");
  assert.ok(bundle.includes("maskTrackingPlan(S.maskSeed,S.maskTarget)"), "the preview must reuse the same tracking plan as the real run");
  assert.ok(bundle.includes("initial_mask:S.maskSeed||\"\""), "the painted mask must be sent to the preview route");
  assert.ok(bundle.includes("_maskPrevToken++"), "a tracking preview must invalidate any stale painted-mask render");
  assert.ok(bundle.includes("SAM3 tracking preview"), "the preview must label the overlay video");
  assert.ok(bundle.includes("no H3 generation"), "the preview note must make clear that no H3 run happens");
  assert.ok(bundle.includes("d.filename"), "the preview must only render when a preview file came back");
  assert.ok(bundle.includes("_openTrackingLightbox"), "the preview must enlarge into a lightbox instead of opening the paint editor");
  assert.ok(bundle.includes("if(_trackingPreviewUrl) _openTrackingLightbox(); else maskPaintBtn.onclick()"), "the mask preview row must only open paint when no tracking preview is showing");
  assert.ok(bundle.includes("_trackingPreviewUrl=null"), "a painted-mask render must clear the tracking preview state");
  assert.ok(bundle.includes("controller.abort()"), "the preview fetch must time out instead of hanging forever");
  assert.ok(bundle.includes("Timed out waiting for the tracking preview"), "a timeout must surface a clear in-box message");
  assert.ok(bundle.includes("Could not load the tracking preview"), "a broken preview file must surface an in-box error");
  assert.ok(bundle.includes("jumps ahead of queued jobs"), "the preview note must explain that the preview runs ahead of the queue");
  assert.ok(bundle.includes('fetch("/queue")'), "the preview must check the queue so it can explain a waiting generation");
  assert.ok(bundle.includes('title:"Run only the SAM 3 tracking'), "the preview button must carry a usage tooltip");
  assert.ok(bundle.includes("Live tracking"), "the button must say the live overlay is already showing when this node is running a mask job");
  assert.ok(bundle.includes("already shows the SAM 3 tracking overlay live"), "a running mask job must not queue a redundant standalone preview");
  assert.ok(bundle.includes("ComfyUI is busy with another job"), "an external busy queue must be worded as another job, not this generation");
  assert.ok(bundle.includes("Showing the last SAM 3 tracking preview"), "clicking preview again must re-show the last preview instead of dead-ending");
  assert.ok(bundle.includes("_trackingPreviewItem"), "the node must remember the last tracking preview to re-show it");
});

test("bundle shows live SAM3 tracking progress in the preview box", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("crypto.randomUUID"), "the preview must mint a fresh token per run");
  assert.ok(
    bundle.includes("/h3one/mask_preview_progress?token="),
    "the preview must poll the progress route with its token",
  );
  assert.ok(bundle.includes("about ${eta}s left"), "the preview box must show frames done and seconds left");
  assert.ok(bundle.includes("token,"), "the preview POST must carry the token so progress stays scoped to this run");
  assert.ok(
    bundle.includes("_activeNode._h3_S.generating!==true"),
    "standalone preview progress must not flip the main preview chip to Sampling",
  );
});

test("bundle rides the tracking overlay along with the real mask generation", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes('wf["500"]={class_type:"SAM3_TrackPreview"'), "the real mask workflow must carry the SAM3 overlay node");
  assert.ok(bundle.includes('track_data:["21",0]'), "the in-run overlay must reuse the run's own track_data");
  assert.ok(bundle.includes('d.node==="500"'), "the executed handler must recognize the overlay node");
  assert.ok(bundle.includes("_h3_maskTrackingOverlay"), "the node must expose an overlay sink for the executed event");
  assert.ok(bundle.includes("hit Stop to avoid wasting the run"), "the live overlay note must invite Stop when tracking is wrong");
  assert.ok(bundle.includes("_showTrackingPreview(d,false)"), "the standalone button must render the non-live note");
});

test("bundle follows the painted whole-head region with the SAM3 track for replacement", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("H3PaintedRegion"), "the mask branch must follow the painted region with the SAM3 track");
  assert.ok(
    bundle.includes('painted:[toMask,0],track:["23",0]'),
    "the region must combine the painted mask with the tracked mask",
  );
  assert.ok(bundle.includes('wf["24"].inputs.masks=[regionMask,0]'), "the subject crop must cover the region so the crop includes hair/hat");
  assert.ok(
    bundle.includes('masks:maskRegionId?[maskRegionId,0]:["23",0]'),
    "the crop report must inspect the region when it exists, else the plain track",
  );
});

test("bundle threads the trim start time through the real mask run", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(
    bundle.includes('wf["34"].inputs.start_time=Math.max(0,Number(S.maskStartTime)||0)'),
    "the real mask build must set the Video Slice start_time from the saved trim",
  );
  assert.ok(
    bundle.includes("start_time:Math.max(0,Number(S.maskStartTime)||0)"),
    "the tracking preview request must send the same trim start so preview matches the run",
  );
});

test("bundle passes the trim start to the mask editor so the paint lands on the trimmed first frame", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(
    bundle.includes("startTime:S.maskStartTime||0"),
    "the paint editor must open at the trim start so the mask aligns to the sliced first frame",
  );
  assert.ok(
    bundle.includes("openVideoMaskEditor({videoName,maskName,startTime,onSave,sam3Ckpt})"),
    "the editor must accept a startTime option and the SAM 3 checkpoint",
  );
  assert.ok(
    bundle.includes('video.currentTime=Math.min((Number(startTime)||0)'),
    "the editor must seek the source to the trim start",
  );
});

test("bundle wires the Smart click-to-segment tool in the mask editor", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("smartBtn=toolBtn(\"Smart\")"), "the paint editor must expose a Smart tool button");
  assert.ok(bundle.includes("Smart on - left-click adds to the mask"), "turning Smart on must explain the gesture");
  assert.ok(bundle.includes("posPts") && bundle.includes("negPts"), "Smart must accumulate positive and negative click points");
  assert.ok(bundle.includes('fetch("/h3one/smart_mask"'), "a Smart click must POST to the segmentation route");
  assert.ok(bundle.includes("positive:posPts.map"), "the route call must send the accumulated positive points");
  assert.ok(bundle.includes("negative:negPts.map"), "the route call must send the accumulated negative points");
  assert.ok(bundle.includes("e.button===2"), "a right-click must be treated as an exclude point");
  assert.ok(bundle.includes('contextmenu') && bundle.includes('e.preventDefault()'), "the right-click exclude must not open the browser menu");
  assert.ok(bundle.includes("smartBusy"), "Smart must guard against overlapping in-flight segments");
  assert.ok(bundle.includes("applySmartMask"), "the returned mask must be merged into the canvas");
  assert.ok(bundle.includes("maskCtx.drawImage(tmp,0,0)"), "the returned mask must be OR-drawn over the existing paint");
  assert.ok(bundle.includes("stencil.data[i+3]=v"), "the opaque black+white PNG must become a white mask on a transparent background before merging");
  assert.ok(bundle.includes("smartEsc"), "Escape must exit Smart mode");
  assert.ok(bundle.includes("exitSmart()"), "the editor must leave Smart mode when another tool is chosen");
  assert.ok(bundle.includes("ckpt_name:sam3Ckpt"), "Smart must send the configured SAM 3 checkpoint passed into the editor");
  assert.ok(bundle.includes("sam3Ckpt:S.models.sam3"), "the mask editor must receive the configured SAM 3 checkpoint from the Mask card");
  assert.ok(bundle.includes("refine_iterations:2"), "Smart must request decoder refinement for crisp edges");
  assert.ok(bundle.includes("Smart segment failed"), "a failed segment must surface an in-box error");
});

test("bundle guards an impossible Detection level before a mask run", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("Number(S.maskThreshold)>=0.9"), "the run and preview must refuse a near-100% Detection");
  assert.ok(bundle.includes("maskDetectionHint(S.maskTarget,S.maskThreshold)"), "the refusal must explain the Detection bar");
});

test("bundle translates an empty tracked mask on a real run", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("maskRunErrorHint"), "a real-run empty-mask failure must be translated to guidance");
  assert.ok(bundle.includes('msg.includes("nothing to crop")'), "the raw crop error must be recognized");
});

test("bundle marks smart clicks visibly and explains the gestures", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("smartBtn.title="), "the Smart button must explain left and right click on hover");
  assert.ok(bundle.includes("drawSmartPoints"), "smart clicks must draw visible markers");
  assert.ok(bundle.includes("mark(negPts,\"#46a6ff\""), "negative clicks must show as a distinct marker");
  assert.ok(bundle.includes("posPts.length=0;negPts.length=0"), "Clear must also reset the accumulated smart clicks");
});

test("bundle lets the user move the painted region into place", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("moveBtn=toolBtn(\"Move\")"), "the paint editor must expose a Move tool");
  assert.ok(bundle.includes("moveSnapshot"), "Move must grab the mask before dragging");
  assert.ok(bundle.includes("putImageData(moveSnapshot,dx,dy)"), "dragging must translate the grabbed mask");
  assert.ok(bundle.includes('mode!=="move"||moved'), "a Move with no actual movement must not add an undo step");
});

test("bundle seeds a smart positive from the painted mask on right-click", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("maskCentroid"), "Smart must find the painted mask's center to refine with");
  assert.ok(bundle.includes("Left-click the character first"), "a right-click with no mask must explain that a positive click is needed");
});

test("lumaToAlpha turns an opaque black+white mask into a white mask with alpha", () => {
  const data = new Uint8ClampedArray([
    255, 255, 255, 255,
    0, 0, 0, 255,
    128, 128, 128, 255,
    0, 255, 0, 128,
  ]);
  lumaToAlpha(data);
  assert.deepEqual(Array.from(data), [
    255, 255, 255, 255,
    255, 255, 255, 0,
    255, 255, 255, 128,
    255, 255, 255, 255,
  ]);
});

test("maskDetectionHint explains an impossible Detection level", () => {
  const msg = maskDetectionHint("person", 1.0);
  assert.ok(msg.includes("person"), "the hint must name the Mask target");
  assert.ok(msg.includes("100%"), "the hint must name the Detection level");
  assert.ok(msg.includes("near-impossible"), "a 100% Detection must be flagged as unusable");
  const normal = maskDetectionHint("person", 0.5);
  assert.ok(normal.includes("person"));
  assert.ok(normal.includes("clearer Mask target"), "a normal threshold points at the target instead");
});

test("maskDetectionHint guides an empty target to paint a mask", () => {
  const msg = maskDetectionHint("", 0.5);
  assert.ok(msg.includes("Mask target"));
  assert.ok(msg.includes("paint a first-frame mask"));
});

test("maskRunErrorHint translates an empty-crop failure and passes others through", () => {
  const state = { maskTarget: "person", maskThreshold: 1.0 };
  const msg = maskRunErrorHint("all masks are empty, nothing to crop", state);
  assert.ok(msg.includes("person"));
  assert.ok(msg.includes("100%"));
  const passthrough = maskRunErrorHint("some unrelated error", state);
  assert.equal(passthrough, "some unrelated error");
  const noState = maskRunErrorHint("all masks are empty, nothing to crop", null);
  assert.equal(noState, "all masks are empty, nothing to crop");
});

test("bundle clears a painted mask when the trim start changes", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(
    bundle.includes("if(hadMask&&trimChanged){S.maskSeed=null;}"),
    "moving the trim after painting must clear the now-misaligned mask",
  );
});

test("bundle exposes the trim controls and active-start chip", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("Trim start"), "the mask action column must offer a trim button");
  assert.ok(bundle.includes("Start here"), "the trim overlay must offer a Start here action");
  assert.ok(bundle.includes("fmtClock"), "the trim chip must format the active start time");
  assert.ok(bundle.includes("Reset to 0"), "the trim must be resettable");
  assert.ok(
    bundle.includes('justifyContent:"center",textAlign:"center"'),
    "the trim chip must center its label text",
  );
  assert.ok(
    bundle.includes("trimSlotBadge"),
    "the source video slot must carry a trim-start badge so the user sees where the clip begins",
  );
  assert.ok(
    bundle.includes('tx(trimSlotBadge,`Start ${fmtClock(S.maskStartTime)}`)'),
    "the source slot badge must mirror the active trim start",
  );
  assert.ok(
    bundle.includes('maskSrcSlot.style.boxShadow=trimOn&&S.maskVideo'),
    "a trim must draw a lime ring on the source slot so the start point is visible",
  );
  assert.ok(
    bundle.includes('"masked region"+(Number(S.maskStartTime)>0'),
    "the big preview caption must state the trim start so it is unmissable",
  );
  assert.ok(
    bundle.includes("startLbl"),
    "the trim overlay must show a live START marker on the video while scrubbing",
  );
  assert.ok(
    bundle.includes("`START ${fmt(t)}`"),
    "the START marker must update live with the scrub position",
  );
});

test("bundle keeps the tracking preview when a replacement reference image changes", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(
    bundle.includes("if(!opts||opts.refreshPreview!==false) _renderMaskPreview()"),
    "mask re-renders must only refresh the painted preview when asked to, so reference edits cannot wipe a live tracking preview",
  );
  assert.ok(
    bundle.includes("_renderMask({refreshPreview:false})"),
    "reference image operations must pass refreshPreview:false",
  );
  const count = bundle.split("_renderMask({refreshPreview:false})").length - 1;
  assert.ok(count >= 4, "the ref upload, ref slot replace, paste, and shared ref upload paths must all skip the preview refresh");
  assert.ok(
    bundle.includes("maskClearBtn.onclick=()=>{S.maskSeed=null;persist();_renderMask();}"),
    "clearing the painted mask must still refresh the preview",
  );
  assert.ok(
    bundle.includes("S.maskSeed=name;persist();_renderMask();"),
    "saving a new painted mask must still refresh the preview",
  );
});

test("cropFrameIndex: maps playback time to the tracked frame, clamped", () => {
  assert.equal(cropFrameIndex(0, 24, 120), 0);
  assert.equal(cropFrameIndex(0.5, 24, 120), 12);
  assert.equal(cropFrameIndex(1.0, 24, 120), 24);
  assert.equal(cropFrameIndex(5.5, 24, 120), 119);
  assert.equal(cropFrameIndex(999, 24, 10), 9);
  assert.equal(cropFrameIndex(-1, 24, 10), 0);
  assert.equal(cropFrameIndex(0.5, 0, 120), 12);
  assert.equal(cropFrameIndex(0.5, 24, 0), 0);
});

test("cropBoxAt: returns the box tuple or null for malformed input", () => {
  const boxes = [[0, 0, 100, 100], [10, 10, 90, 90]];
  assert.deepEqual(cropBoxAt(boxes, 0), [0, 0, 100, 100]);
  assert.deepEqual(cropBoxAt(boxes, 1.9), [10, 10, 90, 90]);
  assert.deepEqual(cropBoxAt(boxes, 99), [10, 10, 90, 90]);
  assert.equal(cropBoxAt([], 0), null);
  assert.equal(cropBoxAt(null, 0), null);
  assert.equal(cropBoxAt([[0, 0, 100]], 0), null);
  assert.equal(cropBoxAt([["a", "b", "c", "d"]], 0), null);
});

test("cropReportText: a clean report reads OK with the min confidence", () => {
  const r = cropReportText({
    frames: 2, boxes: [[0, 0, 100, 100], [0, 0, 100, 100]],
    min_score: 0.93, confidence_threshold: 0.4, low_confidence: false,
    crop_clip: { frames: 0, max_cut: 0 }, stability: { max_step: 2, jitter: 0.004 }, subject_area: { min: 9400 }, subject_share: 0.35,
  });
  assert.equal(r.verdict, "ok");
  assert.match(r.label, /Crop looks good/);
  assert.match(r.detail, /min confidence 93%/);
  assert.match(r.detail, /steady \(worst jump 2px, ~0% of crop\)/);
  assert.match(r.detail, /min 9400 px subject/);
});

test("cropReportText: a seeded painted-mask track reports no detection score", () => {
  const r = cropReportText({ frames: 1, boxes: [[0, 0, 100, 100]], scores: [1, 1], min_score: 1, low_confidence: false, crop_clip: { frames: 0 }, stability: {} });
  assert.equal(r.verdict, "ok");
  assert.match(r.detail, /seeded track/);
});

test("cropReportText: flags low confidence and a clipping crop", () => {
  const r = cropReportText({
    frames: 4, boxes: [[0, 0, 100, 100], [0, 0, 100, 100], [0, 0, 100, 100], [0, 0, 100, 100]],
    min_score: 0.31, confidence_threshold: 0.4, low_confidence: true,
    crop_clip: { frames: 4, max_cut: 0.22 }, stability: { jitter: 0.1, max_step: 30 },
  });
  assert.equal(r.verdict, "flagged");
  assert.match(r.label, /weak \(31% confidence\)/);
  assert.match(r.label, /cuts off part of the subject/);
  assert.match(r.label, /jumps around \(30px between frames\)/);
  assert.match(r.detail, /low confidence 31%/);
  assert.match(r.detail, /crop cuts the subject/);
  assert.match(r.detail, /crop jumps 30px \(~10% of crop\)/);
});

test("cropReportText: a slightly clipping crop is a mild flag", () => {
  const r = cropReportText({ frames: 1, boxes: [[0, 0, 100, 100]], crop_clip: { frames: 1, max_cut: 0.03 }, stability: {} });
  assert.equal(r.verdict, "flagged");
  assert.match(r.label, /clips the subject slightly/);
});
test("cropReportText: a flagged crop comes with an actionable tip", () => {
  const r = cropReportText({
    frames: 1, boxes: [[0, 0, 100, 100]],
    min_score: 0.31, confidence_threshold: 0.4, low_confidence: true,
    crop_clip: { frames: 0, max_cut: 0 }, stability: {},
  });
  assert.equal(r.verdict, "flagged");
  assert.ok(r.tip, "flagged readouts must suggest a next step");
  assert.match(r.tip, /Detection/);
  assert.match(r.tip, /Preview tracking again/);
});

test("cropReportText: a jittery crop suggests crop padding, not detection", () => {
  const r = cropReportText({ frames: 2, boxes: [[0, 0, 100, 100], [0, 0, 100, 100]], stability: { jitter: 0.12, max_step: 33 }, crop_clip: { frames: 0 } });
  assert.equal(r.verdict, "flagged");
  assert.match(r.tip, /Crop padding/);
});

test("cropReportText: a clipping crop suggests holding the subject", () => {
  const r = cropReportText({ frames: 5, boxes: [[0, 0, 100, 100], [0, 0, 100, 100], [0, 0, 100, 100], [0, 0, 100, 100], [0, 0, 100, 100]], crop_clip: { frames: 5, max_cut: 0.22 }, stability: {} });
  assert.equal(r.verdict, "flagged");
  assert.match(r.tip, /Crop padding/);
  assert.match(r.tip, /whole subject/);
});

test("cropReportText: a report with no boxes is neutral, not a good crop", () => {
  const r = cropReportText({ frames: 0, boxes: [], min_score: 1 });
  assert.equal(r.verdict, "none");
  assert.equal(r.tip, null);
  assert.match(r.label, /No crop was measured/);
  const r2 = cropReportText({ frames: 5 });
  assert.equal(r2.verdict, "none");
});

test("cropReportText: a clean crop has no tip", () => {
  const r = cropReportText({ frames: 1, boxes: [[0, 0, 100, 100]], min_score: 0.93, crop_clip: { frames: 0 }, stability: { max_step: 2 } });
  assert.equal(r.verdict, "ok");
  assert.equal(r.tip, null);
});

test("cropReportText: frame-edge contact is informational, not a flag", () => {
  const r = cropReportText({
    frames: 1, boxes: [[0, 0, 100, 100]],
    min_score: 0.95, low_confidence: false, crop_clip: { frames: 0 },
    stability: { max_step: 1 }, edge_touch: 22, subject_edge: 22,
  });
  assert.equal(r.verdict, "ok");
  assert.equal(r.tip, null);
  assert.match(r.label, /Crop looks good/);
  assert.match(r.detail, /frame edge/);
  assert.match(r.detail, /subject touches/);
});

test("bundle draws the crop box and confidence onto the tracking preview", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("cropReportText"), "the bundle must mirror the crop readout helper");
  assert.ok(bundle.includes("cropFrameIndex"), "the bundle must mirror the frame mapper");
  assert.ok(bundle.includes("cropBoxAt"), "the bundle must mirror the box lookup");
  assert.ok(bundle.includes("_drawCropOverlay"), "the bundle must draw the crop rectangle over the overlay video");
  assert.ok(bundle.includes("_trackingRafStart"), "the bundle must drive the overlay redraw while playing");
  assert.ok(bundle.includes("_h3_cropCheck"), "the node must hold the latest crop report");
  assert.ok(bundle.includes("_h3_cropCheckChanged"), "the node must accept a late-arriving crop report");
  assert.ok(bundle.includes('wf["501"]={class_type:"H3OneSAM3CropCheck"'), "the real mask workflow must add the crop report node");
  assert.ok(bundle.includes('d.node==="501"'), "the executed handler must route the crop report");
  assert.ok(bundle.includes('crop_scale:Math.max(1,Math.min(4,Number(S.maskCropScale)||1.5))'), "the preview POST must send the crop scale");
  assert.ok(bundle.includes("megapixels:_effectiveMaskCropMP()"), "the preview POST must send the crop megapixel budget");
  assert.ok(bundle.includes("SAM3 tracking + crop box"), "the lightbox must label the crop overlay");
  assert.ok(bundle.includes("Crop flagged:"), "the readout must surface flagged crops");
  assert.ok(bundle.includes("Crop OK:"), "the readout must confirm clean crops");
  assert.ok(bundle.includes("Crop looks good"), "the card note must use the plain green wording");
  assert.ok(bundle.includes("maskCropNote"), "the card must render the verdict in its own colored line");
  assert.ok(bundle.includes('"\\n→ "+rtext.tip'), "the readout must suggest a next step for flagged crops");
  assert.ok(bundle.includes("steady (worst jump"), "the lightbox detail must express jitter relative to the crop size");
  assert.ok(bundle.includes("px subject"), "the lightbox detail must label the subject pixel minimum");
  assert.ok(bundle.includes("canvas.isConnected"), "the redraw loop must stop when the preview is torn down");
});

test("mapMaskPoint: maps display coordinates to source pixels", () => {
  const p = mapMaskPoint(250, 150, { left: 50, top: 50, width: 400, height: 200 }, 1920, 1080);
  assert.deepEqual(p, { x: 960, y: 540 });
});

test("mapMaskPoint: clamps outside coordinates and rejects empty geometry", () => {
  assert.deepEqual(mapMaskPoint(-10, 999, { left: 0, top: 0, width: 100, height: 100 }, 1000, 500), { x: 0, y: 499 });
  assert.equal(mapMaskPoint(1, 1, { left: 0, top: 0, width: 0, height: 10 }, 100, 100), null);
});

test("bundle: compare in Image mode prefers the upscale original over the input source", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(
    bundle.includes("isUpscaleCompare=!!(_upResult&&_upOrig&&_curItem&&_upResult.media_key===mediaKey(_curItem))"),
    "bundle must detect an upscale compare by matching the current item to the upscale result",
  );
  assert.ok(
    bundle.includes("const imageMode=!isUpscaleCompare&&S.mode===\"image\""),
    "the source-vs-generated image compare must yield to an active upscale compare",
  );
  assert.ok(bundle.includes('tx(cmpLbl1,"UPSCALED")') || bundle.includes("UPSCALED ${upD.width}"), "the upscale branch must label the result UPSCALED");
  assert.ok(bundle.includes("ORIGINAL ${orD.width}×${orD.height}"), "the upscale branch must show the pre-upscale resolution on the ORIGINAL label");
  assert.ok(bundle.includes("_galItems.find(x=>mediaKey(x)===mediaKey(it))"), "compare dims must fall back to the gallery scan when the item lacks them");
});

// -- Queued-output history fallback retry -------------------------------------

const firstMedia = (entry) => {
  if (!entry) return null;
  const outputs = Object.values(entry.outputs || {});
  for (const out of outputs) {
    const videos = out.videos || out.gifs || null;
    if (Array.isArray(videos) && videos.length) return videos[videos.length - 1];
    const images = out.images || null;
    if (Array.isArray(images) && images.length) return images[images.length - 1];
  }
  return null;
};

test("settleQueuedOutput: returns media immediately on the first lookup", async () => {
  const item = { filename: "out.mp4" };
  let calls = 0;
  const result = await settleQueuedOutput(
    "p1",
    async () => { calls++; return { outputs: { "15": { videos: [item] } }, status: { status_str: "success" } }; },
    firstMedia,
    { maxAttempts: 4, delayMs: 0, deadlineMs: 100 },
  );
  assert.equal(result.item, item);
  assert.equal(result.failed, false);
  assert.equal(result.expired, false);
  assert.equal(calls, 1, "a visible result must stop the retry after one lookup");
});

test("settleQueuedOutput: retries until history commits the media", async () => {
  const item = { filename: "out.mp4" };
  let calls = 0;
  const result = await settleQueuedOutput(
    "p1",
    async () => { calls++; return calls === 1 ? { status: {} } : { outputs: { "15": { videos: [item] } }, status: { status_str: "success" } }; },
    firstMedia,
    { maxAttempts: 5, delayMs: 0, deadlineMs: 100 },
  );
  assert.equal(result.item, item);
  assert.equal(calls, 2, "an empty first lookup must be retried");
});

test("settleQueuedOutput: confirms failure instead of waiting for media", async () => {
  let calls = 0;
  const result = await settleQueuedOutput(
    "p1",
    async () => { calls++; return { status: { status_str: "error" } }; },
    firstMedia,
    { maxAttempts: 6, delayMs: 0, deadlineMs: 1000 },
  );
  assert.equal(result.item, null);
  assert.equal(result.failed, true);
  assert.equal(result.expired, false);
  assert.equal(calls, 1, "an error status must stop the retry immediately");
});

test("settleQueuedOutput: treats interrupted as a confirmed failure", async () => {
  const result = await settleQueuedOutput(
    "p1",
    async () => ({ status: { status_str: "interrupted" } }),
    firstMedia,
    { maxAttempts: 3, delayMs: 0, deadlineMs: 1000 },
  );
  assert.equal(result.failed, true);
  assert.equal(result.item, null);
});

test("settleQueuedOutput: expires when no media commits before the attempt bound", async () => {
  let calls = 0;
  const result = await settleQueuedOutput(
    "p1",
    async () => { calls++; return { status: { status_str: "success" } }; },
    firstMedia,
    { maxAttempts: 4, delayMs: 0, deadlineMs: 1000 },
  );
  assert.equal(result.item, null);
  assert.equal(result.failed, false);
  assert.equal(result.expired, true);
  assert.equal(calls, 4, "the retry must never exceed maxAttempts");
});

test("settleQueuedOutput: a throwing history fetch is treated as a retryable miss", async () => {
  let calls = 0;
  const result = await settleQueuedOutput(
    "p1",
    async () => { calls++; throw new Error("network"); },
    firstMedia,
    { maxAttempts: 3, delayMs: 0, deadlineMs: 1000 },
  );
  assert.equal(result.expired, true);
  assert.equal(result.failed, false);
  assert.equal(calls, 3);
});

test("settleQueuedOutput: honors the deadline even when attempts remain", async () => {
  const item = { filename: "late.mp4" };
  let calls = 0;
  const result = await settleQueuedOutput(
    "p1",
    async () => { calls++; return calls === 3 ? { outputs: { "1": { videos: [item] } } } : { status: {} }; },
    firstMedia,
    { maxAttempts: 8, delayMs: 0, deadlineMs: 0 },
  );
  assert.equal(result.expired, true, "zero deadline must expire before the third lookup");
  assert.ok(calls < 8, `calls=${calls} must be capped by the deadline`);
});

test("bundle retries the queued-output history fallback with a bounded deadline", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("const _settleQueuedJob=async(pid,qentry)"), "bundle must define the bounded queued-output settlement");
  assert.ok(bundle.includes("qentry._settling"), "concurrent settlement must be deduplicated per job");
  assert.ok(bundle.includes("DEADLINE_MS") && bundle.includes("MAX_ATTEMPTS"), "the retry must be bounded by attempts and a deadline");
  assert.ok(bundle.includes("Date.now()-start>=DEADLINE_MS"), "the retry must stop once its deadline passes");
  assert.ok(bundle.includes("_settleQueuedJob(pid,qentry)"), "execution_success must delegate to the bounded retry");
  assert.ok(
    !bundle.includes("const item=_mediaItemFromHistory(h&&h[pid]);"),
    "the old single-shot history lookup must be gone from execution_success",
  );
});

// -- Video Compare + Stitch helpers ------------------------------------------

test("clampTimecode: clamps to [0, duration]", () => {
  assert.equal(clampTimecode(0.5, 10), 0.5);
  assert.equal(clampTimecode(-2, 10), 0);
  assert.equal(clampTimecode(20, 10), 10);
  assert.equal(clampTimecode(5, 0), 0);
  assert.equal(clampTimecode(NaN, 10), 0);
  assert.equal(clampTimecode(5, NaN), 0);
});

test("compareGridColumns: auto is ceil(sqrt(n)); fixed overrides and clamps", () => {
  assert.equal(compareGridColumns(2), 2);
  assert.equal(compareGridColumns(3), 2);
  assert.equal(compareGridColumns(4), 2);
  assert.equal(compareGridColumns(1), 1);
  assert.equal(compareGridColumns(4, 4), 4);
  assert.equal(compareGridColumns(3, 1), 1);
  assert.equal(compareGridColumns(3, 9), 3, "fixed columns clamp to the clip count");
  assert.equal(compareGridColumns(0), 1);
});

test("compareGridRows: rows wrap per column count", () => {
  assert.equal(compareGridRows(3, 2), 2);
  assert.equal(compareGridRows(4, 2), 2);
  assert.equal(compareGridRows(4, 4), 1);
  assert.equal(compareGridRows(3, 1), 3);
  assert.equal(compareGridRows(0, 2), 1);
});

test("compareWindow: the shortest clip duration wins", () => {
  assert.equal(compareWindow([{ duration: 5 }, { duration: 3 }, { duration: 10 }]), 3);
  assert.equal(compareWindow([{ duration: 0 }, { duration: 6 }]), 6, "zero-duration clips are ignored");
  assert.equal(compareWindow([]), 0);
  assert.equal(compareWindow([{ duration: NaN }]), 0);
});

test("syncTargets: maps a shared timecode onto each clip's trim window", () => {
  const slots = [{ duration: 10, trimStart: 1 }, { duration: 10, trimStart: 4 }, { duration: 5, trimStart: 0 }];
  assert.deepEqual(syncTargets(0, slots, 5), [1, 4, 0]);
  assert.deepEqual(syncTargets(3, slots, 5), [4, 7, 3]);
  assert.deepEqual(syncTargets(5, slots, 5), [6, 9, 5]);
  assert.deepEqual(syncTargets(9, slots, 5), [6, 9, 5], "a shared time past the window clamps to the window first");
});

test("formatTimecode: m:ss.d label", () => {
  assert.equal(formatTimecode(0), "0:00.0");
  assert.equal(formatTimecode(1.5), "0:01.5");
  assert.equal(formatTimecode(61.2), "1:01.2");
  assert.equal(formatTimecode(-5), "0:00.0");
  assert.equal(formatTimecode(undefined), "0:00.0");
});

test("makeCompareSlots: 2-4 slots with stable ids and empty state", () => {
  const s = makeCompareSlots(3);
  assert.equal(s.length, 3);
  assert.deepEqual(s.map((x) => x.id), ["vc-0", "vc-1", "vc-2"]);
  s.forEach((x) => {
    assert.equal(x.item, null);
    assert.equal(x.duration, 0);
    assert.equal(x.trimStart, 0);
    assert.equal(x.trimEnd, 0);
  });
  assert.equal(makeCompareSlots(1).length, 2, "below the floor clamps to 2");
  assert.equal(makeCompareSlots(9).length, 4, "above the ceiling clamps to 4");
});

test("bundle wires the Video Compare + Stitch page", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("Compare & Stitch"), "the overlay must be titled Compare & Stitch");
  assert.ok(bundle.includes("vcOverlay"), "the bundle must build the compare overlay");
  assert.ok(bundle.includes("vcTabCompare") && bundle.includes("vcTabStitch"), "the overlay must offer Compare and Stitch tabs");
  assert.ok(bundle.includes("makeCompareSlots(2)"), "the overlay must seed 2 slots");
  assert.ok(bundle.includes("_openLibraryPick"), "slots must open the library picker");
  assert.ok(bundle.includes("/h3one/compare_workflow"), "the export must POST to the compare workflow route");
  assert.ok(bundle.includes('"Export stitch"'), "the Stitch tab must expose the export button");
  assert.ok(bundle.includes("compareGridColumns"), "the compare grid must use the auto-column helper");
  assert.ok(bundle.includes("syncTargets"), "the sync loop must use the timecode helper");
  assert.ok(bundle.includes('actBtn("Compare",()=>openCompare()'), "the outputs strip must mount a Compare button");
  assert.ok(bundle.includes("libCompareBtn"), "the library must mount a Compare button");
  assert.ok(bundle.includes('vcOverlay.style.display!=="none"'), "Space must not generate while the compare overlay is open");
  assert.ok(
    bundle.includes("vcOverlay.append(vcHdr,vcSlotBar,vcCompareBody,vcStitchBody)"),
    "the overlay must mount its header, slot bar and both tab bodies",
  );
});

test("bundle stages picked outputs through the compare route before queueing", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(
    bundle.includes("trim_start:Number(s.trimStart)||0"),
    "the export payload must send each slot's trim start",
  );
  assert.ok(
    bundle.includes("frame_match:S.compareFrameMatch||\"trim_to_shortest\""),
    "the export payload must carry the frame-match mode",
  );
  assert.ok(
    bundle.includes("filename_prefix:\"one-node-minimax-h3/compare/h3_compare\""),
    "the export must save into the compare output folder",
  );
  assert.ok(bundle.includes("_batchIds=[data.prompt_id]"), "the export must queue through the node's normal prompt path");
  assert.ok(bundle.includes("_armFinishWatch()"), "the export must arm the finish watch for progress and gallery refresh");
  assert.ok(bundle.includes("tx(genBtnLbl,\"Stitching...\")"), "the export must label the in-flight job Stitching");
});

test("compare overlay helpers are declared before their build-time use", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  const vcStart = bundle.indexOf("const vcOverlay=mk");
  const vcEnd = bundle.indexOf("const _openLibraryPick=");
  assert.ok(vcStart !== -1 && vcEnd !== -1 && vcStart < vcEnd, "the compare overlay block must exist");
  const vcBlock = bundle.slice(vcStart, vcEnd);
  const colsDecl = vcBlock.indexOf("const _vcColsLabel=");
  const colsUse = vcBlock.indexOf("vcColsDD=DD(");
  assert.ok(colsDecl !== -1 && colsUse !== -1 && colsDecl < colsUse, "vcColsDD must not call _vcColsLabel before it is declared");
  const matchDecl = vcBlock.indexOf("const _vcMatchLabel=");
  const matchUse = vcBlock.indexOf("vcMatchDD=DD(");
  assert.ok(matchDecl !== -1 && matchUse !== -1 && matchDecl < matchUse, "vcMatchDD must not call _vcMatchLabel before it is declared");
});

test("compare page auto-opens the library picker when all slots are empty", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(
    bundle.includes("if(!_vcSlots.some(s=>s.item)) _vcPickSlot(_vcSlots[0])"),
    "opening compare with no clips must open the library picker immediately",
  );
  assert.ok(bundle.includes("const _vcPickSlot=(slot)=>"), "slot picking must be a shared helper");
});

test("compare library picker filters to videos and offers favorites-only", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes("_libPickVideosOnly"), "pick mode must track the videos-only flag");
  assert.ok(
    bundle.includes("const pickingVideos=!!_libPickCallback&&_libPickVideosOnly"),
    "pick mode must filter images out of the grid so an image can never enter a video slot",
  );
  assert.ok(bundle.includes("libPickFav"), "the pick bar must offer a Favorites only toggle");
  assert.ok(bundle.includes("await _renderLibrary()"), "the picker must populate before the overlay opens");
});

test("library grid declares isImg before its use in the card url", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  const renderStart = bundle.indexOf("const _renderLibrary=async()=>{");
  const renderEnd = bundle.indexOf("const _libOpen=async(item)=>{");
  const body = bundle.slice(renderStart, renderEnd);
  const isImgDecl = body.indexOf("const isImg=item.kind===\"image\"");
  const urlUse = body.indexOf("const url=api.apiURL(isImg?");
  assert.ok(isImgDecl !== -1 && urlUse !== -1 && isImgDecl < urlUse,
    "the library card must declare isImg before building the url, or the first card throws in the temporal dead zone and the grid renders blank");
});

test("outputs strip uses compact icon-only actions on one line", () => {
  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.includes('actBtn("",()=>_favCurrent()'), "Favorite must be icon-only");
  assert.ok(bundle.includes('actBtn("",()=>_delCurrent()'), "Delete must be icon-only");
  assert.ok(bundle.includes("iconOnly:true"), "actBtn must support icon-only buttons");
  assert.ok(bundle.includes(".h3-actbtn.ico{padding:0 7px;}"), "icon-only buttons must be compact");
  assert.ok(!bundle.includes('margin-left:5px;">Refresh</span>'), "the refresh button must drop its text label");
  assert.ok(bundle.includes('galleryRefresh.title="Refresh outputs"'), "the refresh icon must carry a tooltip");
});
