export function normalizeOutputSettings(saved) {
  return {
    fps: Math.max(1, Math.min(240, Math.round(Number(saved.fps) || 24))),
  };
}

export function outputFrameLabel(duration, fps, snapFrames) {
  const baseFps = Math.max(1, Math.round(Number(fps) || 24));
  return `= ${snapFrames(duration)} native frames @ ${baseFps}fps`;
}

export function createOutputControls({ S, mk, tx, infoIcon, NI, persist, updateFramesLabel }) {
  const fpsCapRow = mk("div", { display: "flex", alignItems: "center", gap: "4px" });
  const fpsCap = mk("div", { fontSize: "10px", color: "var(--h3-tx)" });
  tx(fpsCap, "FPS");
  fpsCapRow.append(fpsCap, infoIcon("Playback frame rate of the saved video. H3 renders its native 24fps frame sequence; changing this changes how fast the video plays, not the render length."));
  const fpsNI = NI("", S.fps, 1, 240, 1, value => {
    S.fps = Math.round(value);
    persist();
    updateFramesLabel();
  }, "60px");
  return { fpsCapRow, fpsNI };
}

export function patchOutputVideo(workflow, fps) {
  const baseFps = Math.max(1, Math.min(240, Math.round(Number(fps) || 24)));
  Object.keys(workflow).forEach(id => {
    const node = workflow[id];
    if (!node || node.class_type !== "CreateVideo") return;
    node.inputs.fps = baseFps;
  });
}