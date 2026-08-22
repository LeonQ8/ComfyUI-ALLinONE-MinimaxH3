import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { h3TextEncoderItems } from "./h3_model_features.js";
import { createOutputControls, normalizeOutputSettings, outputFrameLabel, patchOutputVideo } from "./h3_output_features.js";
import { attachOutputContextMenu } from "./h3_output_context.js";

const ACCENT_DEFAULT = "#c0a996";
const SUPPORT_URL = "https://ko-fi.com/leonq8";
const C = {
  lime:ACCENT_DEFAULT, bg0:"#080808", bg1:"#101010", bg2:"#1c1c1c",
  bg3:"#2a2a2a", border:"#4c4c4c", borderH:"#5f5f5f",
  text:"#ffffff", muted:"#b0b0b0", dim:"#4a4a4a",
  warn:"#ffc266", err:"#ff8080",
};
// The accent is a live CSS variable: every C.lime read resolves to
// var(--h3accent), which _applyAccent sets on <html> at runtime.
C.lime = "var(--h3accent)";

const MEDIA = {
  image: { rgb:"90,168,255",  solid:"#5aa8ff" },
  video: { rgb:"95,208,140",  solid:"#5fd08c" },
  audio: { rgb:"192,127,255", solid:"#c07fff" },
};
const mediaCol = (t, a=1) => `rgba(${(MEDIA[t]||{rgb:"200,200,200"}).rgb},${a})`;

// Global video hover-preview mute (persisted; applies to every video slot in every mode)
let _videoMuted=false;
try{ _videoMuted=localStorage.getItem("one_node_minimax_h3_video_muted")==="1"; }catch(e){}
const _videoMuteListeners=[];
const SPEAKER_SVG='<path d="M11 5 L6 9 L2 9 L2 15 L6 15 L11 19 Z" fill="currentColor" stroke="none"/><path d="M15.5 8.5 a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M18 6 a9 9 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
const SPEAKER_MUTED_SVG=SPEAKER_SVG+'<line x1="2.5" y1="2.5" x2="21.5" y2="21.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>';
function setVideoMuted(m){
  _videoMuted=!!m;
  try{ localStorage.setItem("one_node_minimax_h3_video_muted",_videoMuted?"1":"0"); }catch(e){}
  _videoMuteListeners.forEach(f=>{ try{ f(_videoMuted); }catch(e){} });
}

const NODE_W = 1240;
const NODE_H = 700;
const H3_SEED_MAX = 1125899906842623;
const LS_KEY = "one_node_minimax_h3_state";

const MODES = [
  { key:"t2v",         label:"T2V" },
  { key:"i2v",         label:"I2V" },
  { key:"r2v",         label:"R2V" },
  { key:"audio_drive", label:"Audio Drive" },
  { key:"keyframes",   label:"Keyframes" },
  { key:"extend",      label:"Extend" },
  { key:"chain",       label:"Chain" },
  { key:"mask",        label:"Mask" },
  { key:"image",       label:"Image" },
];

const MODE_HINTS = {
  t2v:"Text to Video - generate a video from a text prompt only. No images or audio needed.",
  i2v:"Image to Video - animate from a first frame, converge to a last frame, or morph between both.",
  r2v:"Reference to Video - reference image = identity, reference video = motion, reference audio = final soundtrack.",
  audio_drive:"Audio Drive - the audio track drives the mouth movements and timing. Add a photo of the speaker for identity.",
  keyframes:"Custom Keyframes - pin still images at chosen frames; the video morphs through them in order.",
  extend:"Extend - continue a source video seamlessly beyond its ending, keeping its look and sound.",
  chain:"Chain - multiple clips generated in sequence and stitched end-to-end with motion-context continuity.",
  mask:"Mask - paint the first frame or name a target, track it through a source video, and replace only that region.",
  image:"Image - still image generation with MiniMax H3. Text to image, edit an image, or mix multiple references.",
};

const MODE_DESC = {
  t2v:"Generate a video from a text prompt only.",
  i2v:"Animate from a first frame, converge to a last frame, or morph between both.",
  r2v:"Image = identity, video = motion, audio = final soundtrack.",
  audio_drive:"The audio track drives the mouth. Add a photo of the speaker for identity.",
  keyframes:"Pin still images at chosen frames; the video morphs through them in order.",
  extend:"Continue a source video seamlessly beyond its ending.",
  chain:"Clips generated in sequence, stitched with motion-context continuity.",
  mask:"Track a painted or text-selected region and replace it with H3 reference inpainting.",
  image:"Still images with MiniMax H3. Text to image, edit an image, or mix references.",
};

const TEMPLATES = {
  t2v:"t2v.json", i2v:"i2v.json", r2v:"r2v.json", audio_drive:"audio_drive.json",
  keyframes:"keyframes.json", extend:"video_extend.json", chain:"chain_section.json",
  mask:"mask.json", image:"image.json",
};

const DEFAULT_MODELS = {
  unetT2V:"minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  unetR2V:"minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  clip:"qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  vaeVideo:"minimax_h3_video_vae_fp16.safetensors",
  vaeAudio:"minimax_h3_audio_vae_fp32.safetensors",
  sam3:"",
  tae:"taeh3.safetensors",
  upscaleDit:"none",
  upscaleVae:"none",
};

const LP_PRESETS = {
  fast:{res:384,frames:6,label:"Fast"},
  balanced:{res:512,frames:10,label:"Balanced"},
  detailed:{res:768,frames:10,label:"Detailed"},
};
const IMAGE_FILE_EXTS=[".png",".jpg",".jpeg",".webp",".bmp"];
const VIDEO_FILE_EXTS=[".mp4",".m4v",".webm",".mkv",".avi",".mov"];
const AUDIO_FILE_EXTS=[".mp3",".wav",".flac",".ogg",".m4a",".aac"];
const _fileMatches=(file,exts)=>{
  const name=String(file&&file.name||"").toLowerCase();
  return exts.some(ext=>name.endsWith(ext));
};

function snapFrames(seconds, fps=24){
  const base = Math.max(5, Math.round(seconds * fps));
  return base + ((5 - (base % 17)) + 17) % 17;
}

// Plan the target latent length and AV context window for Extend mode. Output
// is [source video] + [new content], and the new content is the generated
// latent minus the preserved AV context prefix, so the target must be context
// + requested extension. Both the target and the context stay on H3's 17-frame
// grid (5 + 17k); the context also lands on a shared 24fps/40Hz video+audio
// boundary (39/90/141/192/...) or the fork's context node snaps it down and the
// extension silently grows. Kept in sync with planExtend in h3_helpers.mjs.
function planExtend(duration, fps=24){
  const wantNew = Math.max(1, Math.round(Number(duration) * fps));
  const maxTarget = 736;
  const maxBlocks = Math.max(1, Math.floor((maxTarget - 39) / 17));
  const blocks = Math.max(1, Math.min(Math.round(wantNew / 17) || 1, maxBlocks));
  const newFrames = blocks * 17;
  return { contextLength: 39, targetLength: 39 + newFrames, newFrames };
}

function mediaKey(item){
  if(!item) return "output||";
  const sub = String(item.subfolder || "").replace(/\\/g, "/");
  const typ = String(item.type || "output");
  const name = String(item.filename || item.video || "").split(/[\\/]/).pop();
  return `${typ}|${sub}|${name}`;
}

function aspect(width, height){
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return h > w ? "portrait" : "landscape";
}

function sizeOf(source){
  if (!source || typeof source !== "object") return null;
  const w = source.naturalWidth ?? source.videoWidth ?? source.width;
  const h = source.naturalHeight ?? source.videoHeight ?? source.height;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { width: Math.round(w), height: Math.round(h) };
}

function sameSize(a, b){
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.width === b.width && a.height === b.height;
}

function mapMaskPoint(clientX,clientY,rect,width,height){
  const rw=Number(rect&&rect.width),rh=Number(rect&&rect.height),w=Number(width),h=Number(height);
  if(!(rw>0)||!(rh>0)||!(w>0)||!(h>0)) return null;
  const x=Math.max(0,Math.min(w-1,(Number(clientX)-Number(rect.left||0))*w/rw));
  const y=Math.max(0,Math.min(h-1,(Number(clientY)-Number(rect.top||0))*h/rh));
  return {x,y};
}

function orientRes(res, orientation){
  if (!res || orientation !== "portrait" || res.width <= res.height) return res;
  const flipped = Object.assign({}, res, {
    width: res.height,
    height: res.width,
  });
  if (typeof res.label === "string") {
    const m = res.label.match(/^(\d+)x(\d+)(.*)$/);
    if (m) flipped.label = `${m[2]}x${m[1]}${m[3]}`;
  }
  return flipped;
}

function fitResolutionToAspect(sourceWidth, sourceHeight,targetWidth,targetHeight,maxAspect=Infinity){
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
      if(w/h>maxAspect) continue;
      if (w * h > targetPixels) continue;
      const aspectError = Math.abs(Math.log((w / h) / ratio));
      const areaError = Math.abs(Math.log((w * h) / targetPixels));
      const score = aspectError * 12 + areaError;
      if (!best || score < best.score) best = { width: w, height: h, score };
    }
  }
  if (!best) return { width: tw, height: th };
  return { width: best.width, height: best.height };
}

function planMaskCrop(width,height){
  const w=Number(width)>0?Number(width):960;
  const h=Number(height)>0?Number(height):544;
  const preset=w*h/(1024*1024);
  const megapixels=Math.min(preset,0.5);
  return {width:w,height:h,aspectRatio:w/h,megapixels:megapixels,masked:true};
}

function maskTrackingPlan(hasPaintedMask,textTarget){
  const hasText=!!String(textTarget||"").trim();
  return {maxObjects:1,objectIndices:"0",seedPaint:!!hasPaintedMask&&!hasText};
}

function cropFrameIndex(time,fps,frames){
  const n=Number(frames);
  if(!Number.isFinite(n)||n<=0) return 0;
  const f=Number(fps)>0?Number(fps):24;
  return Math.max(0,Math.min(n-1,Math.round(Number(time)*f)));
}

function cropBoxAt(boxes,index){
  if(!Array.isArray(boxes)||!boxes.length) return null;
  const idx=Math.max(0,Math.min(boxes.length-1,Math.floor(Number(index)||0)));
  const b=boxes[idx];
  if(!Array.isArray(b)||b.length!==4) return null;
  for(const v of b){ if(!Number.isFinite(Number(v))) return null; }
  return b.map(Number);
}

function cropReportText(report){
  const r=report||{};
  const frames=Number(r.frames)||0;
  const hasBoxes=Array.isArray(r.boxes)&&r.boxes.length>0;
  if(frames<1||!hasBoxes) return {verdict:"none",label:"No crop was measured for this track.",detail:"No crop boxes were measured.",tip:null};
  const pct=(v)=>`${Math.round((Number(v)||0)*100)}%`;
  const issues=[];
  const issuesSimple=[];
  const notes=[];
  const scores=Array.isArray(r.scores)?r.scores:[];
  const allSeeded=scores.length>0&&scores.every(s=>Number(s)>=0.999);
  if(r.low_confidence&&Number.isFinite(Number(r.min_score))){ issues.push(`low confidence ${pct(r.min_score)} (below ${pct(r.confidence_threshold)})`); issuesSimple.push(`the track is weak (${pct(r.min_score)} confidence)`); }
  const clip=r.crop_clip||{};
  if(Number(clip.frames)>0){
    if(clip.max_cut>=0.05){ issues.push(`crop cuts the subject (up to ${pct(clip.max_cut)})`); issuesSimple.push(`the box cuts off part of the subject (up to ${pct(clip.max_cut)})`); }
    else{ issues.push("crop clips the subject slightly"); issuesSimple.push("the box clips the subject slightly"); }
  }
  const st=r.stability||{};
  const jitterPct=Math.round((Number(st.jitter)||0)*100);
  if(Number(st.jitter)>0.06){ issues.push(`crop jumps ${Math.round(st.max_step||0)}px (~${jitterPct}% of crop) between frames`); issuesSimple.push(`the box jumps around (${Math.round(st.max_step||0)}px between frames)`); }
  const sa=r.subject_area||{};
  const tiny=Number.isFinite(Number(r.subject_share))&&Number(r.subject_share)<0.04&&Number(sa.min)>0;
  if(tiny){ issues.push(`subject is very small (${Math.round(Number(sa.min))} px)`); issuesSimple.push("the subject is very small in the frame"); }
  if(Number(r.edge_touch)>0) notes.push("crop is pinned at the frame edge");
  if(Number(r.subject_edge)>0) notes.push("subject touches the frame edge");
  if(issues.length){
    let tip=null;
    if(r.low_confidence&&Number.isFinite(Number(r.min_score))) tip="Raise the Detection slider or use a clearer Mask target, then Preview tracking again.";
    else if(Number(clip.frames)>0) tip="Increase Crop padding so the box holds the whole subject, then Preview tracking again.";
    else if(Number(st.jitter)>0.06) tip="Increase Crop padding (a bigger box moves less) or tighten Detection for a steadier mask.";
    else if(tiny) tip="Increase Crop padding for more pixels, or use a higher-resolution source video.";
    return {verdict:"flagged",label:`Crop flagged - ${issuesSimple.join("; ")}.`,detail:`Crop flagged: ${issues.join("; ")}.`,tip};
  }
  const conf=allSeeded?"seeded track (no detection score)":(Number.isFinite(Number(r.min_score))?`min confidence ${pct(r.min_score)}`:"no confidence data");
  const subject=Number.isFinite(Number(sa.min))?`, min ${Math.round(Number(sa.min))} px subject`:"";
  const note=notes.length?` (${notes.join(", ")})`:"";
  const detail=`Crop OK: ${conf}, steady (worst jump ${Math.round(Number(st.max_step)||0)}px, ~${jitterPct}% of crop), subject inside${subject}${note}.`;
  return {verdict:"ok",label:"Crop looks good - the box holds the subject steadily and nothing is cut off.",detail,tip:null};
}

// Inject a lip-sync directive into a Mask prompt that preserves the source
// soundtrack. The masked face is regenerated from noise each frame, so the
// model needs the preserved speech (<Audio 1>) to animate the mouth. Mirrored
// in h3_helpers.mjs (kept in sync).
function maskSpeechSyncPrompt(prompt){
  const text=String(prompt||"");
  if(!text||text.includes("<Audio 1>")) return text;
  const directive="The replacement speaks the same words as the source speech heard in <Audio 1>, mouth moving in sync with it.";
  if(/detailed_description:/i.test(text)) return text.replace(/(detailed_description:\s*)/i,`$1<Audio 1>: speech_drive - ${directive}\n`);
  if(/overall_soundscape:/i.test(text)) return text.replace(/(overall_soundscape:\s*)/i,`$1<Audio 1>: speech_drive - ${directive} `);
  return `${text}\n\n<Audio 1>: speech_drive - ${directive}`;
}

function resolveFitPrimary(cfg, slots){
  const list = Array.isArray(slots) ? slots.filter((s)=>s&&s.size&&s.size.width>0&&s.size.height>0) : [];
  if (!list.length) return null;
  const c = (cfg && typeof cfg==="object") ? cfg : {};
  let key = c.key || null;
  if (!key || !list.some((s)=>s.key===key)) key = list[0].key;
  const slot = list.find((s)=>s.key===key);
  if (c.mode==="custom" && c.custom && c.custom.width>0 && c.custom.height>0) {
    return { key, label: slot.label, mode: "custom", size: c.custom };
  }
  if (c.mode==="normal") {
    return { key, label: slot.label, mode: "normal", size: slot.size };
  }
  return { key, label: slot.label, mode: "fit", size: slot.size };
}

const QUALITY_PRESET_FLAGS={
  turbo:{sol:false,sage:false,kitchen:false,sla:false},
  speed:{sol:true,sage:false,kitchen:false,sla:false},
  balanced:{sol:true,sage:false,kitchen:false,sla:false},
  high:{sol:false,sage:true,kitchen:false,sla:false},
  native:{sol:false,sage:false,kitchen:false,sla:false},
  draft:{sol:false,sage:false,kitchen:true,sla:true},
};
const QUALITY_PRESET_ORDER=["speed","balanced","high","native","draft"];

function resolveQualityFlags(sol,sage,kitchen,sla){
  let s=!!sol;
  let a=!!sage;
  const k=!!kitchen;
  const sl=!!sla;
  if(sl){ s=false; a=false; }
  if(a&&k) a=false;
  return {sol:s,sage:a,kitchen:k,sla:sl};
}

function matchQualityPreset(flags,table,order){
  const t=table||QUALITY_PRESET_FLAGS;
  const f=resolveQualityFlags(flags&&flags.sol,flags&&flags.sage,flags&&flags.kitchen,flags&&flags.sla);
  for(const key of (order||QUALITY_PRESET_ORDER)){
    const p=t[key];
    if(p&&f.sol===!!p.sol&&f.sage===!!p.sage&&f.kitchen===!!p.kitchen&&f.sla===!!p.sla) return key;
  }
  return "custom";
}

function imgProfileShort(key){
  if(!key||key==="custom") return "Custom";
  const k=String(key);
  if(k.includes("ref2v")) return "REF2V";
  if(k.includes("fl2v_8")) return "FL2VA 8";
  if(k.includes("fl2v_4")) return "FL2VA 4";
  if(k.includes("sa_solver")) return "SA-Solver 4";
  if(k.includes("er_sde")) return "ER-SDE 4";
  if(k.includes("balanced")) return "Base 12";
  return "Base 20";
}

function imgAspectName(key){
  const names={"1:1":"Square","16:9":"Widescreen","9:16":"Portrait","4:3":"Standard","3:4":"Standard Portrait","3:2":"Wide","2:3":"Tall","21:9":"Cinematic"};
  return names[key]||key||"";
}

function viewQuery(item,type){
  const src=item||{};
  const name=src.filename||src.video||"";
  const t=type||src.type||"output";
  const m=src.mtime||Date.now();
  return `filename=${encodeURIComponent(name)}&type=${encodeURIComponent(t)}&subfolder=${encodeURIComponent(src.subfolder||"")}&m=${m}`;
}

function thumbQuery(item,max=512,type){
  const src=item||{};
  const name=src.filename||src.video||"";
  const t=type||src.type||"output";
  return `filename=${encodeURIComponent(name)}&type=${encodeURIComponent(t)}&subfolder=${encodeURIComponent(src.subfolder||"")}&max=${max}`;
}

function isImageItem(item){
  return !!(item&&(item.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(item.filename||"")));
}

function inputFileExists(files,name){
  const base=String(name||"").replace(/\\/g,"/").split("/").pop();
  if(!base) return false;
  return (Array.isArray(files)?files:[]).some(f=>String(f).replace(/\\/g,"/").split("/").pop()===base);
}

const IMG_MIN_MP=0.2;
const IMG_MAX_MP=8.5;
const IMG_ASPECT_RATIOS={"1:1":1,"16:9":16/9,"9:16":9/16,"4:3":4/3,"3:4":3/4,"3:2":3/2,"2:3":2/3,"21:9":21/9};
function _floor32(v){ return Math.max(32,Math.floor(v/32)*32); }
function clampImageMP(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return 1.0;
  return Math.min(IMG_MAX_MP,Math.max(IMG_MIN_MP,n));
}
function planImageCanvas({mode="custom",width=1024,height=1024,megapixels=1.0,aspect="1:1"}={}){
  const target=mode==="ratio"?clampImageMP(megapixels)*1e6:Math.max(32,Number(width)||1024)*Math.max(32,Number(height)||1024);
  const ratio=IMG_ASPECT_RATIOS[aspect]||1;
  let w,h;
  if(mode==="ratio"){
    w=Math.max(32,Math.round(Math.sqrt(target*ratio)/32)*32);
    h=Math.max(32,Math.round(Math.sqrt(target/ratio)/32)*32);
  }else{
    w=Math.max(32,Math.round((Number(width)||1024)/32)*32);
    h=Math.max(32,Math.round((Number(height)||1024)/32)*32);
  }
  let capped=w*h>IMG_MAX_MP*1e6;
  if(capped){
    const scale=Math.sqrt((IMG_MAX_MP*1e6)/(w*h));
    w=_floor32(w*scale);
    h=_floor32(h*scale);
    if(w*h>IMG_MAX_MP*1e6){
      const shrink=Math.sqrt((IMG_MAX_MP*1e6)/(w*h));
      w=_floor32(w*shrink);
      h=_floor32(h*shrink);
    }
  }
  return {width:w,height:h,megapixels:(w*h)/1e6,capped};
}
function planImageCanvasForRatio(megapixels,ratio){
  const mp=clampImageMP(megapixels);
  const r=Number.isFinite(ratio)&&ratio>0?ratio:1;
  let w=Math.max(32,Math.round(Math.sqrt(mp*1e6*r)/32)*32);
  let h=Math.max(32,Math.round(Math.sqrt(mp*1e6/r)/32)*32);
  let capped=w*h>IMG_MAX_MP*1e6;
  if(capped){
    const scale=Math.sqrt((IMG_MAX_MP*1e6)/(w*h));
    w=_floor32(w*scale);
    h=_floor32(h*scale);
    if(w*h>IMG_MAX_MP*1e6){
      const shrink=Math.sqrt((IMG_MAX_MP*1e6)/(w*h));
      w=_floor32(w*shrink);
      h=_floor32(h*shrink);
    }
  }
  return {width:w,height:h,megapixels:(w*h)/1e6,capped};
}
function planUpscaleTarget(srcW,srcH,factor,maxLongEdge=4096){
  const w=Number(srcW);
  const h=Number(srcH);
  const f=Number(factor);
  const cap=Number(maxLongEdge)>0?Number(maxLongEdge):4096;
  if(!(w>0)||!(h>0)||!(f>0)) return null;
  let tw=w*f;
  let th=h*f;
  const longEdge=Math.max(tw,th);
  const capped=longEdge>cap;
  if(capped){
    const s=cap/longEdge;
    tw*=s;
    th*=s;
  }
  const snap8=v=>Math.max(8,Math.round(v/8)*8);
  return {width:snap8(tw),height:snap8(th),capped};
}

function _captureFileSize(file){
  return new Promise((resolve)=>{
    if(!file||!file.type||!file.type.startsWith("image/")){ resolve(null); return; }
    const url=URL.createObjectURL(file);
    const img=new Image();
    const done=(sz)=>{ URL.revokeObjectURL(url); resolve(sz); };
    img.onload=()=>done(sizeOf(img));
    img.onerror=()=>done(null);
    img.src=url;
    setTimeout(()=>done(null), 10000);
  });
}

// -- DOM helpers (adapted from the One Node family) ----------------------------
const mk = (tag,css={},props={}) => { const e=document.createElement(tag); Object.assign(e.style,css); Object.assign(e,props); return e; };
const tx = (e,t) => { e.textContent=t; return e; };
const cap = (t) => tx(mk("div",{fontSize:"9px",fontWeight:"700",letterSpacing:".1em",
  textTransform:"uppercase",color:C.muted,marginBottom:"5px"}),t);

let _infoTipEl=null;
function infoIcon(txt){
  const ic=mk("span",{width:"13px",height:"13px",borderRadius:"50%",border:`1px solid ${C.borderH}`,color:C.muted,fontSize:"8px",fontWeight:"700",display:"inline-flex",alignItems:"center",justifyContent:"center",cursor:"help",flexShrink:"0",fontStyle:"italic",fontFamily:"Georgia, serif",transition:"border-color .15s, color .15s",userSelect:"none"});
  tx(ic,"i");
  const show=()=>{
    if(!_infoTipEl){
      _infoTipEl=mk("div",{position:"fixed",background:C.bg1,border:`1px solid ${C.borderH}`,borderRadius:"8px",padding:"9px 11px",fontSize:"10px",lineHeight:"1.55",color:C.text,maxWidth:"280px",zIndex:"999999",pointerEvents:"none",boxShadow:"0 10px 32px rgba(0,0,0,.95)",whiteSpace:"pre-line",wordBreak:"break-word",fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"});
      document.body.appendChild(_infoTipEl);
    }
    tx(_infoTipEl,txt);
    _infoTipEl.style.display="block";
    const r=ic.getBoundingClientRect();
    let left=r.right+8, top=r.top-6;
    const tw=_infoTipEl.offsetWidth, th=_infoTipEl.offsetHeight;
    if(left+tw>window.innerWidth-8) left=r.left-tw-8;
    if(top+th>window.innerHeight-8) top=window.innerHeight-th-8;
    if(top<8) top=8;
    _infoTipEl.style.left=left+"px";
    _infoTipEl.style.top=top+"px";
  };
  const hide=()=>{ if(_infoTipEl) _infoTipEl.style.display="none"; };
  ic.addEventListener("mouseenter",show);
  ic.addEventListener("mouseleave",hide);
  ic.addEventListener("mousedown",e=>e.stopPropagation());
  ic.addEventListener("pointerdown",e=>e.stopPropagation());
  return ic;
}

function attachTip(el,txt){
  el.addEventListener("mouseenter",()=>{
    if(!_infoTipEl){
      _infoTipEl=mk("div",{position:"fixed",background:C.bg1,border:`1px solid ${C.borderH}`,borderRadius:"8px",padding:"9px 11px",fontSize:"10px",lineHeight:"1.55",color:C.text,maxWidth:"280px",zIndex:"999999",pointerEvents:"none",boxShadow:"0 10px 32px rgba(0,0,0,.95)",whiteSpace:"pre-line",wordBreak:"break-word",fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"});
      document.body.appendChild(_infoTipEl);
    }
    tx(_infoTipEl,txt);
    _infoTipEl.style.display="block";
    _infoTipEl.style.fontWeight="700";
    const r=el.getBoundingClientRect();
    let left=r.right+8, top=r.top-6;
    const tw=_infoTipEl.offsetWidth, th=_infoTipEl.offsetHeight;
    if(left+tw>window.innerWidth-8) left=r.left-tw-8;
    if(top+th>window.innerHeight-8) top=window.innerHeight-th-8;
    if(top<8) top=8;
    _infoTipEl.style.left=left+"px";
    _infoTipEl.style.top=top+"px";
  });
  el.addEventListener("mouseleave",()=>{ if(_infoTipEl) _infoTipEl.style.display="none"; });
}

async function h3Copy(text){
  text=String(text==null?"":text);
  try{
    if(navigator.clipboard&&window.isSecureContext){ await navigator.clipboard.writeText(text); return true; }
  }catch(e){}
  try{
    const ta=document.createElement("textarea");
    ta.value=text; ta.style.cssText="position:fixed;top:-9999px;left:-9999px;opacity:0;";
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok=document.execCommand("copy"); document.body.removeChild(ta); return ok;
  }catch(e){ return false; }
}

function _isVueNodes(){
  try{
    const v=app?.ui?.settings?.getSettingValue?.("Comfy.VueNodes.Enabled");
    return v===true||v==="true";
  }catch(e){ return false; }
}

function playDone(kind){
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    const ctx=new AC();
    const sets={
      chime:[[660,0,0.09],[990,0.1,0.07]],
      soft:[[520,0,0.06],[780,0.08,0.05]],
      pop:[[440,0,0.12],[880,0.12,0.1],[1320,0.24,0.08]],
    };
    (sets[kind]||sets.chime).forEach(([freq,delay,vol])=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.connect(gain);gain.connect(ctx.destination);
      osc.type="sine";osc.frequency.value=freq;
      gain.gain.setValueAtTime(0,ctx.currentTime+delay);
      gain.gain.linearRampToValueAtTime(vol,ctx.currentTime+delay+0.03);
      gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+delay+0.55);
      osc.start(ctx.currentTime+delay);osc.stop(ctx.currentTime+delay+0.6);
    });
  }catch(e){}
}

function fmtErr(v){
  try{
    if(!v) return "Unknown error.";
    if(typeof v==="string") return v;
    if(v.message) return String(v.message);
    if(v.error){
      if(typeof v.error==="string") return v.error;
      if(v.error.message) return String(v.error.message);
    }
    return JSON.stringify(v);
  }catch(e){ return String(v); }
}

function maskDetectionHint(text, threshold){
  const target=String(text||"").trim();
  const th=Math.max(0,Math.min(1,Number(threshold)||0.5));
  if(target){
    const pct=Math.round(th*100);
    if(th>=0.9) return `SAM 3 found no '${target}' at Detection ${pct}%. That is a near-impossible bar; lower the Detection slider toward 50% and try again.`;
    return `SAM 3 found no '${target}' at Detection ${pct}%. Try a clearer Mask target (face, jacket, car) or lower the Detection slider, then try again.`;
  }
  return "SAM 3 found nothing to track. Enter a Mask target or paint a first-frame mask, then try again.";
}

function maskRunErrorHint(message,state){
  const msg=String(message||"");
  if((msg.includes("all masks are empty")||msg.includes("nothing to crop"))&&state) return maskDetectionHint(state.maskTarget,state.maskThreshold);
  return msg;
}

function fmtDur(ms){
  const s=Math.round(Math.max(0,ms)/1000);
  const m=Math.floor(s/60), sec=s%60;
  if(m<1) return sec+"s";
  const h=Math.floor(m/60);
  if(h<1) return m+"m "+String(sec).padStart(2,"0")+"s";
  return h+"h "+String(m%60).padStart(2,"0")+"m "+String(sec).padStart(2,"0")+"s";
}

// POST body for /prompt when queueing a job. Mirrored in h3_helpers.mjs (kept in sync).
const queuePromptPayload=(wf,clientId)=>({prompt:wf,client_id:clientId,extra_data:{enable_previews:true}});

let _dim=null;
const showDimmer=()=>{ if(!_dim){_dim=mk("div",{position:"fixed",inset:"0",background:"rgba(0,0,0,.7)",zIndex:"999990",display:"none",pointerEvents:"none"});document.body.appendChild(_dim);} _dim.style.display="block"; };
const hideDimmer=()=>{ if(_dim)_dim.style.display="none"; };

function Toggle(labelTxt,checked,onChange,infoTxt){
  const wrap=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",
    padding:"9px 0",borderBottom:`1px solid ${C.border}`});
  const lblRow=mk("div",{display:"flex",alignItems:"center",gap:"6px",minWidth:"0"});
  const lbl=mk("span",{fontSize:"12px",color:C.text});tx(lbl,labelTxt);
  lblRow.appendChild(lbl);
  if(infoTxt) lblRow.appendChild(infoIcon(infoTxt));
  const track=mk("div",{width:"34px",height:"18px",borderRadius:"9px",
    background:checked?C.lime:C.dim,cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:"0"});
  const thumb=mk("div",{position:"absolute",top:"2px",left:checked?"16px":"2px",
    width:"14px",height:"14px",borderRadius:"50%",
    background:checked?"#111":"#888",transition:"left .2s,background .2s"});
  track.appendChild(thumb);
  let val=checked;
  track.onclick=()=>{
    val=!val;track.style.background=val?C.lime:C.dim;
    thumb.style.left=val?"16px":"2px";thumb.style.background=val?"#111":"#888";onChange(val);
  };
  wrap.append(lblRow,track);
  const _setChecked=(v)=>{
    val=v;track.style.background=val?C.lime:C.dim;
    thumb.style.left=val?"16px":"2px";thumb.style.background=val?"#111":"#888";
  };
  return{el:wrap,get value(){return val;},_setChecked};
}

function MiniToggle(checked,onChange,label){
  const track=mk("button",{width:"26px",height:"14px",borderRadius:"7px",
    background:checked?C.lime:C.bg3,cursor:"pointer",position:"relative",padding:"0",
    border:`1px solid ${checked?"transparent":C.borderH}`,boxSizing:"border-box",
    transition:"background .2s,border-color .2s",flexShrink:"0",outline:"none",display:"block"},
    {type:"button",className:"h3-mtgl",title:label||"Toggle"});
  const thumb=mk("span",{position:"absolute",top:"2px",left:checked?"14px":"2px",
    width:"10px",height:"10px",borderRadius:"50%",
    background:checked?"#111":"#aaa",transition:"left .2s,background .2s",pointerEvents:"none"});
  track.appendChild(thumb);
  track.setAttribute("role","switch");
  track.setAttribute("aria-checked",String(!!checked));
  if(label) track.setAttribute("aria-label",label);
  let val=!!checked;
  const _render=()=>{
    track.style.background=val?C.lime:C.bg3;
    track.style.borderColor=val?"transparent":C.borderH;
    thumb.style.left=val?"14px":"2px";
    thumb.style.background=val?"#111":"#aaa";
    track.setAttribute("aria-checked",String(val));
  };
  const _toggle=()=>{ val=!val; _render(); onChange(val); };
  track.onclick=_toggle;
  track.onfocus=()=>{ track.style.boxShadow=`0 0 0 2px rgba(var(--h3accent-rgb),.35)`; };
  track.onblur=()=>{ track.style.boxShadow="none"; };
  track.onmouseenter=()=>{ track.style.boxShadow=`0 0 0 2px rgba(var(--h3accent-rgb),.2)`; };
  track.onmouseleave=()=>{ if(document.activeElement!==track) track.style.boxShadow="none"; };
  return{el:track,get value(){return val;},_setChecked(v){val=!!v;_render();}};
}

let _activeDDClose=null;
function DD(items,selected,onChange){
  let val=selected;
  const _lblOf=it=>{ if(it&&typeof it==="object") return it.label!=null?it.label:""; return it==null?"":it; };
  const _valOf=it=>{ if(it&&typeof it==="object") return it.value; return it; };
  const wrap=mk("div",{position:"relative",width:"100%",minWidth:"0",overflow:"hidden"});
  const trig=mk("div",{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:"7px",
    padding:"0 8px",height:"28px",display:"flex",alignItems:"center",
    justifyContent:"space-between",cursor:"pointer",boxSizing:"border-box",
    transition:"border-color .15s",userSelect:"none",overflow:"hidden"});
  const _setTitle=v=>{ const t=_lblOf(v); trig.title=t; trigTxt.title=t; };
  const trigTxt=mk("span",{fontSize:"11px",color:C.text,overflow:"hidden",
    textOverflow:"ellipsis",whiteSpace:"nowrap",flex:"1",minWidth:"0"});
  tx(trigTxt,_lblOf(val)); trigTxt.style.color=_lblOf(val)?C.lime:C.muted; _setTitle(val);
  const arr=mk("span",{fontSize:"8px",color:C.muted,marginLeft:"5px",flexShrink:"0",transition:"transform .18s"});
  tx(arr,"v");
  trig.append(trigTxt,arr);
  const panel=mk("div",{display:"none",position:"fixed",background:C.bg1,
    border:`1px solid ${C.borderH}`,borderRadius:"8px",zIndex:"999999",
    flexDirection:"column",boxShadow:"0 8px 28px rgba(0,0,0,.9)",
    overflow:"hidden",minWidth:"140px",maxWidth:"400px"});
  const srch=mk("input",{background:C.bg2,border:"none",borderBottom:`1px solid ${C.border}`,
      padding:"7px 10px",color:C.text,fontSize:"11px",outline:"none",
      width:"100%",boxSizing:"border-box"},{type:"text",placeholder:"Type to filter..."});
  const list=mk("div",{overflowY:"auto",maxHeight:"200px"});
  const _norm=(s)=>(s||"").replace(/\\/g,"/").toLowerCase();
  const render=q=>{
    list.innerHTML="";
    items.filter(i=>{ const l=_lblOf(i).toLowerCase(); return !q||l.includes(q.toLowerCase()); }).forEach(item=>{
      const lbl=_lblOf(item);
      const isSel=_norm(lbl)===_norm(_lblOf(val));
      const r=mk("div",{padding:"7px 12px",fontSize:"11px",cursor:"pointer",
        color:isSel?C.lime:C.text,background:isSel?C.bg2:"transparent",
        whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",transition:"background .1s"});
      tx(r,lbl);
      r.title=lbl;
      r.onmouseenter=()=>r.style.background=C.bg3;
      r.onmouseleave=()=>r.style.background=isSel?C.bg2:"transparent";
      r.onclick=()=>{val=item;tx(trigTxt,lbl);trigTxt.style.color=lbl?C.lime:C.muted;_setTitle(item);close();onChange(_valOf(item));};
      list.appendChild(r);
    });
  };
  const reposition=(anchorRect)=>{
    const rect=anchorRect||trig.getBoundingClientRect();
    panel.style.left=rect.left+"px";
    panel.style.width=Math.max(rect.width,140)+"px";
    const ph=Math.min(items.length*28+44,220);
    let top;
    if(anchorRect){
      top=rect.bottom+4;
      if(top+ph+8>window.innerHeight&&rect.top-ph-4>8) top=rect.top-ph-4;
    } else {
      top=(rect.top-ph-4>8?rect.top-ph-4:rect.bottom+4);
    }
    panel.style.top=top+"px";
  };
  const open=(anchorRect)=>{
    if(_activeDDClose&&_activeDDClose!==close) _activeDDClose();
    _activeDDClose=close;
    document.body.appendChild(panel);panel.style.display="flex";
    reposition(anchorRect);arr.style.transform="rotate(180deg)";
    trig.style.borderColor=C.lime;showDimmer();
    srch.value="";srch.focus();render("");
  };
  const close=()=>{
    panel.style.display="none";
    if(panel.parentNode)panel.parentNode.removeChild(panel);
    arr.style.transform="";trig.style.borderColor=C.border;hideDimmer();
    if(_activeDDClose===close) _activeDDClose=null;
  };
  srch.oninput=()=>render(srch.value);
  trig.onclick=e=>{e.stopPropagation();panel.style.display==="flex"?close():open();};
  document.addEventListener("click",e=>{if(!wrap.contains(e.target)&&!panel.contains(e.target))close();});
  trig.onmouseenter=()=>{if(panel.style.display!=="flex")trig.style.background=C.bg2;};
  trig.onmouseleave=()=>{if(panel.style.display!=="flex")trig.style.background=C.bg3;};
  panel.appendChild(srch);
  panel.appendChild(list);
  wrap.appendChild(trig);
  render("");
  return{
    el:wrap,get value(){return val;},
    set(v){val=v;tx(trigTxt,v);trigTxt.style.color=v?C.lime:C.muted;_setTitle(v);render("");},
    updateItems(ni){items=ni;if(!ni.some(i=>_norm(i)===_norm(val))){val=ni[0]||val;tx(trigTxt,val);trigTxt.style.color=val?C.lime:C.muted;_setTitle(val);onChange(val);}render(srch.value||"");},
    open(anchorRect){open(anchorRect);},
  };
}

function NI(_label,val,min,max,_step,onChange,width="72px"){
  const wrap=mk("div",{
    width,height:"28px",background:C.bg2,border:`1px solid ${C.border}`,
    borderRadius:"6px",boxSizing:"border-box",display:"flex",alignItems:"center",
    padding:"0 7px",transition:"border-color .15s",overflow:"hidden",
  });
  const inp=mk("input",{
    flex:"1 1 0",minWidth:"0",background:"transparent",border:"none",outline:"none",
    color:C.text,fontSize:"11px",padding:"0",textAlign:"left",
  },{type:"number",min:String(min),max:String(max),value:String(val),step:String(_step||1)});
  inp.oninput=()=>{ const v=Math.max(min,Math.min(max,parseFloat(inp.value)||min)); onChange(v); };
  inp.onfocus=()=>{ inp.select(); wrap.style.borderColor=C.lime; };
  inp.onblur=()=>{
    let v=parseFloat(inp.value);
    if(isNaN(v)) v=min;
    v=Math.max(min,Math.min(max,v));
    v=Math.round(v/(_step||1))*(_step||1);
    inp.value=String(v);
    wrap.style.borderColor=C.border;
    onChange(v);
  };
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter") inp.blur(); });
  inp.addEventListener("wheel",e=>{
    if(document.activeElement===inp){ e.stopPropagation(); }
    else { inp.blur(); e.preventDefault(); }
  },{passive:false});
  wrap.appendChild(inp);
  wrap.onclick=()=>inp.focus();
  wrap._inp=inp;
  wrap.setVal=(v)=>{inp.value=String(v);};
  Object.defineProperty(wrap,"numVal",{get(){return parseFloat(inp.value)||min;}});
  return wrap;
}

function mkRmBtn(){
  const b=mk("button",{
    position:"absolute",top:"4px",right:"4px",width:"18px",height:"18px",
    borderRadius:"50%",background:"rgba(0,0,0,.85)",border:`1px solid ${C.border}`,
    color:"rgba(255,255,255,.7)",fontSize:"9px",cursor:"pointer",display:"none",
    alignItems:"center",justifyContent:"center",padding:"0",
    transition:"background .15s, color .15s, border-color .15s",lineHeight:"1",zIndex:"2",
  });
  tx(b,"x");
  b.onmouseenter=()=>{ b.style.borderColor=C.lime; b.style.color=C.lime; };
  b.onmouseleave=()=>{ b.style.borderColor=C.border; b.style.color="rgba(255,255,255,.7)"; };
  return b;
}

function ImgSlot(optional,onFile,onDimensions,fixed){
  const PREVIEW_LONG=192;
  const resetSize=()=>{wrap.style.width="72px";wrap.style.height="72px";};
  const fitSize=(width,height)=>{
    if(fixed) return;
    if(!width||!height) return;
    const ratio=Number(width)/Number(height);
    if(!Number.isFinite(ratio)||ratio<=0) return;
    const w=ratio>=1?PREVIEW_LONG:Math.max(72,Math.round(PREVIEW_LONG*ratio));
    const h=ratio>=1?Math.max(72,Math.round(PREVIEW_LONG/ratio)):PREVIEW_LONG;
    wrap.style.width=`${w}px`;wrap.style.height=`${h}px`;
  };
  let _pendingSize=null;
  const wrap=mk("div",{
    width:"72px",height:"72px",borderRadius:"12px",
    border:`1.5px dashed ${C.border}`,background:C.bg2,
    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
    cursor:"pointer",position:"relative",
    transition:"border-color .18s, background .18s",
    overflow:"hidden",flexShrink:"0",boxSizing:"border-box",
  });
  const icoWrap=mk("div",{
    position:"absolute",inset:"0",
    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
    gap:"5px",pointerEvents:"none",
  });
  const ico=document.createElementNS("http://www.w3.org/2000/svg","svg");
  ico.setAttribute("viewBox","0 0 24 24");ico.setAttribute("width","22");ico.setAttribute("height","22");
  ico.setAttribute("fill","none");ico.setAttribute("stroke","currentColor");
  ico.setAttribute("stroke-width","1.4");ico.setAttribute("stroke-linecap","round");ico.setAttribute("stroke-linejoin","round");
  ico.style.color=C.muted;ico.style.transition="color .18s";ico.style.pointerEvents="none";
  ico.innerHTML=`<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`;
  const lbl=mk("div",{fontSize:"8px",color:C.muted,pointerEvents:"none",letterSpacing:".04em",fontWeight:"600",transition:"color .18s"});
  tx(lbl,"Add image");
  if(optional){
    const optPill=mk("div",{fontSize:"6px",color:C.muted,letterSpacing:".06em",fontWeight:"700",
      border:`1px solid ${C.border}`,borderRadius:"20px",padding:"1px 5px",pointerEvents:"none",
      textTransform:"uppercase",background:"transparent",lineHeight:"1.7"});
    tx(optPill,"Optional");icoWrap.append(ico,lbl,optPill);
  } else { icoWrap.append(ico,lbl); }
  const prevEl=mk("img",{
    position:"absolute",inset:"0",width:"100%",height:"100%",
    objectFit:"contain",display:"none",borderRadius:"11px",background:"#111",
  });
  const rm=mkRmBtn();
  const inp=mk("input",{display:"none"},{type:"file",accept:IMAGE_FILE_EXTS.join(",")});
  wrap.append(icoWrap,prevEl,rm,inp);
  wrap.onmouseenter=()=>{wrap.style.borderColor=C.lime;};
  wrap.onmouseleave=()=>{wrap.style.borderColor=C.border;};
  wrap.onclick=()=>{inp.value="";inp.click();};
  let _dragDepth=0;
  wrap.addEventListener("dragenter",e=>{e.preventDefault();e.stopPropagation();_dragDepth++;wrap.style.borderColor=C.lime;wrap.style.background=C.bg1;});
  wrap.addEventListener("dragover",e=>{e.preventDefault();e.stopPropagation();});
  wrap.addEventListener("dragleave",()=>{ _dragDepth--;if(_dragDepth<=0){_dragDepth=0;wrap.style.borderColor=C.border;wrap.style.background=C.bg2;} });
  wrap.addEventListener("drop",e=>{
    e.preventDefault();e.stopPropagation();_dragDepth=0;wrap.style.borderColor=C.border;wrap.style.background=C.bg2;
    const f=e.dataTransfer.files[0];if(f&&_fileMatches(f,IMAGE_FILE_EXTS))_load(f);
  });
  let _currentName=null;
  let _loadToken=0;
  let _objUrl=null;
  const _showLoaded=(src,fname)=>{
    prevEl.onload=()=>{
      const _sz=sizeOf(prevEl);
      _pendingSize=_sz;
      fitSize(prevEl.naturalWidth,prevEl.naturalHeight);
    };
    prevEl.src=src;prevEl.style.display="block";
    icoWrap.style.display="none";rm.style.display="flex";
    wrap.style.borderColor=C.lime;
  };
  const _load=async(file)=>{
    if(!_fileMatches(file,IMAGE_FILE_EXTS)){if(_h3ShowError)_h3ShowError("Unsupported image format. Use PNG, JPG, WEBP, or BMP.");return;}
    const token=++_loadToken;
    const objUrl=URL.createObjectURL(file);
    if(_objUrl) URL.revokeObjectURL(_objUrl);
    _objUrl=objUrl;
    _showLoaded(objUrl,file.name);
    const prev=_currentName;
    try{
      const uploaded=await _uploadImage(file);
      if(token!==_loadToken) return;
      _currentName=uploaded;
      onFile(_currentName);
      if(onDimensions) onDimensions(_currentName,_pendingSize);
    }catch(err){
      if(token!==_loadToken) return;
      console.warn("[H3One] upload:",err);
      if(prev){
        _currentName=prev;
        _restorePreview(prev);
      } else {
        _currentName=null;
        prevEl.src="";prevEl.style.display="none";
        icoWrap.style.display="flex";rm.style.display="none";
        wrap.style.borderColor=C.border;
      }
      if(_h3ShowError)_h3ShowError("Image upload failed: "+fmtErr(err)+"\nThe previous image was kept.");
    }finally{inp.value="";}
  };
  inp.onchange=()=>{if(inp.files[0])_load(inp.files[0]);};
  rm.onclick=e=>{
    e.stopPropagation();
    _loadToken++;
    if(_objUrl){URL.revokeObjectURL(_objUrl);_objUrl=null;}
    prevEl.src="";prevEl.style.display="none";
    rm.style.display="none";icoWrap.style.display="flex";
    resetSize();
    wrap.style.borderColor=C.border;inp.value="";_currentName=null;onFile(null);
    _pendingSize=null;
    if(onDimensions) onDimensions(null,null);
  };
  const _restorePreview=(name)=>{
    if(!name) return;
    _loadToken++;
    if(_objUrl){URL.revokeObjectURL(_objUrl);_objUrl=null;}
    const src=api.apiURL(`/view?filename=${encodeURIComponent(name)}&type=input&subfolder=&t=${Date.now()}`);
    _currentName=name;
    _showLoaded(src,name);
    if(onDimensions){
      prevEl.addEventListener("load",()=>{
        onDimensions(_currentName,_pendingSize);
      },{once:true});
    }
  };
  return{el:wrap,get name(){return _currentName;},loadFile:(file)=>_load(file),_restorePreview};
}

function MediaSlot(type,onFile,onDimensions){
  const PREVIEW_LONG=192;
  const resetSize=()=>{wrap.style.width="72px";wrap.style.height="72px";};
  const fitSize=(width,height)=>{
    if(!width||!height) return;
    const ratio=Number(width)/Number(height);
    if(!Number.isFinite(ratio)||ratio<=0) return;
    const w=ratio>=1?PREVIEW_LONG:Math.max(72,Math.round(PREVIEW_LONG*ratio));
    const h=ratio>=1?Math.max(72,Math.round(PREVIEW_LONG/ratio)):PREVIEW_LONG;
    wrap.style.width=`${w}px`;wrap.style.height=`${h}px`;
  };
  const typeExts=type==="video"?VIDEO_FILE_EXTS:AUDIO_FILE_EXTS;
  const acceptMap={video:VIDEO_FILE_EXTS.join(","),audio:AUDIO_FILE_EXTS.join(",")};
  const icons={
    video:`<rect x="2" y="2" width="20" height="20" rx="2.5"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/>`,
    audio:`<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`,
  };
  const labels={video:"Add video",audio:"Add audio"};
  const wrap=mk("div",{
    width:"72px",height:"72px",borderRadius:"12px",
    border:`1.5px dashed ${C.border}`,background:C.bg2,
    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
    cursor:"pointer",position:"relative",
    transition:"border-color .18s, background .18s",
    overflow:"hidden",flexShrink:"0",boxSizing:"border-box",
  });
  const icoWrap=mk("div",{position:"absolute",inset:"0",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"5px",pointerEvents:"none"});
  const ico=document.createElementNS("http://www.w3.org/2000/svg","svg");
  ico.setAttribute("viewBox","0 0 24 24");ico.setAttribute("width","22");ico.setAttribute("height","22");
  ico.setAttribute("fill","none");ico.setAttribute("stroke","currentColor");
  ico.setAttribute("stroke-width","1.4");ico.setAttribute("stroke-linecap","round");ico.setAttribute("stroke-linejoin","round");
  ico.style.color=C.muted;ico.style.transition="color .18s";ico.style.pointerEvents="none";
  ico.innerHTML=icons[type];
  const lbl=mk("div",{fontSize:"8px",color:C.muted,pointerEvents:"none",letterSpacing:".04em",fontWeight:"600",transition:"color .18s"});
  tx(lbl,labels[type]);
  icoWrap.append(ico,lbl);
  const videoThumb = type==="video" ? mk("video",{
    position:"absolute",inset:"0",width:"100%",height:"100%",
    objectFit:"contain",display:"none",borderRadius:"11px",pointerEvents:"none",background:"#111",
  }) : null;
  if(videoThumb){ videoThumb.muted=_videoMuted; videoThumb.preload="metadata"; }
  if(videoThumb) videoThumb.onloadedmetadata=()=>{
    fitSize(videoThumb.videoWidth,videoThumb.videoHeight);
    if(onDimensions) onDimensions(wrap._filename,sizeOf(videoThumb));
  };
  const audioGlow = type==="audio" ? mk("div",{
    position:"absolute",inset:"0",display:"none",
    flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none",
  }) : null;
  if(audioGlow){
    const glowSvg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    glowSvg.setAttribute("viewBox","0 0 24 24");glowSvg.setAttribute("width","28");glowSvg.setAttribute("height","28");
        glowSvg.setAttribute("fill","none");glowSvg.style.stroke=C.lime;glowSvg.setAttribute("stroke-width","1.5");
    glowSvg.setAttribute("stroke-linecap","round");    glowSvg.style.filter=`drop-shadow(0 0 6px rgba(var(--h3accent-rgb),.66))`;
    glowSvg.innerHTML=`<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`;
    audioGlow.appendChild(glowSvg);
  }
  const loadedName=mk("div",{
    position:"absolute",bottom:"0",left:"0",right:"0",
    fontSize:"6.5px",color:"rgba(255,255,255,.85)",textAlign:"center",
    padding:"3px 4px",background:"rgba(0,0,0,.6)",
    wordBreak:"break-all",lineHeight:"1.3",display:"none",
  });
  const rm=mkRmBtn();
  const playBtn = type==="audio" ? mk("button",{
    position:"absolute",top:"4px",left:"4px",width:"20px",height:"20px",
    borderRadius:"50%",background:"rgba(0,0,0,.85)",border:`1px solid ${C.border}`,
    color:"rgba(255,255,255,.8)",cursor:"pointer",display:"none",
    alignItems:"center",justifyContent:"center",padding:"0",zIndex:"2",
    transition:"border-color .15s, color .15s",lineHeight:"1",fontSize:"8px",
  }) : null;
  if(playBtn){
    tx(playBtn,"▶");
    playBtn.title="Play audio preview";
    playBtn.onmouseenter=()=>{playBtn.style.borderColor=C.lime;playBtn.style.color=C.lime;};
    playBtn.onmouseleave=()=>{playBtn.style.borderColor=C.border;playBtn.style.color="rgba(255,255,255,.8)";};
  }
  const spkBtn = type==="video" ? mk("button",{
    position:"absolute",top:"4px",left:"4px",width:"20px",height:"20px",
    borderRadius:"50%",background:"rgba(0,0,0,.85)",border:`1px solid ${C.border}`,
    color:"rgba(255,255,255,.8)",cursor:"pointer",display:"none",
    alignItems:"center",justifyContent:"center",padding:"0",zIndex:"2",
    transition:"border-color .15s, color .15s",lineHeight:"1",
  }) : null;
  if(spkBtn){
    const spkSvg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    spkSvg.setAttribute("viewBox","0 0 24 24");spkSvg.setAttribute("width","12");spkSvg.setAttribute("height","12");
    spkBtn.appendChild(spkSvg);
    spkBtn.title="Video preview sound: click to mute/unmute (applies everywhere)";
    const _applyMute=(m)=>{
      if(videoThumb) videoThumb.muted=m;
      spkSvg.innerHTML=m?SPEAKER_MUTED_SVG:SPEAKER_SVG;
      spkBtn.style.color=m?"#ff8080":C.lime;
    };
    _videoMuteListeners.push(_applyMute);
    _applyMute(_videoMuted);
    spkBtn.onmouseenter=()=>{spkBtn.style.borderColor=C.lime;};
    spkBtn.onmouseleave=()=>{spkBtn.style.borderColor=C.border;};
    spkBtn.onclick=(e)=>{ e.stopPropagation(); setVideoMuted(!_videoMuted); };
  }
  let _audioEl=null;
  const fileInp=mk("input",{display:"none"},{type:"file",accept:acceptMap[type]});
  if(videoThumb) wrap.append(icoWrap,videoThumb,loadedName,spkBtn,rm,fileInp);
  else wrap.append(icoWrap,audioGlow,loadedName,playBtn,rm,fileInp);
  wrap.onmouseenter=()=>{
    wrap.style.borderColor=C.lime;
    if(wrap._hasFile&&videoThumb&&videoThumb.src){try{videoThumb.play().catch(()=>{});}catch(e){}}
  };
  wrap.onmouseleave=()=>{
    wrap.style.borderColor=C.border;
    if(videoThumb){try{videoThumb.pause();videoThumb.currentTime=0;}catch(e){}}
  };
  wrap.onclick=e=>{
    if(e.target===rm||rm.contains(e.target)) return;
    fileInp.click();
  };
  let _dragDepth=0;
  wrap.addEventListener("dragenter",e=>{e.preventDefault();e.stopPropagation();_dragDepth++;wrap.style.borderColor=C.lime;});
  wrap.addEventListener("dragover",e=>{e.preventDefault();e.stopPropagation();});
  wrap.addEventListener("dragleave",()=>{ _dragDepth--;if(_dragDepth<=0){_dragDepth=0;wrap.style.borderColor=C.border;} });
  wrap.addEventListener("drop",e=>{ e.preventDefault();e.stopPropagation();_dragDepth=0;const f=e.dataTransfer.files[0];if(f&&_fileMatches(f,typeExts))_load(f); });
  wrap._hasFile=false;wrap._filename=null;
  let _objUrl=null;
  let _loadToken=0;
  const _showLoaded=(name,objectUrl)=>{
    icoWrap.style.display="none";
    tx(loadedName,name);loadedName.style.display="block";
    rm.style.display="flex";wrap.style.borderColor=C.lime;wrap._hasFile=true;wrap._filename=name;
    if(videoThumb&&objectUrl){
      videoThumb.src=objectUrl;videoThumb.style.display="block";videoThumb.load();
      videoThumb.addEventListener("loadedmetadata",()=>{videoThumb.currentTime=0.01;},{once:true});
    }
    if(audioGlow) audioGlow.style.display="flex";
    if(playBtn) playBtn.style.display="flex";
    if(spkBtn) spkBtn.style.display="flex";
  };
  const _stopAudio=()=>{
    if(_audioEl){
      try{_audioEl.pause();_audioEl.src="";}catch(e){}
      _audioEl=null;
    }
    if(playBtn){tx(playBtn,"▶");}
  };
  if(playBtn){
    playBtn.onclick=e=>{
      e.stopPropagation();
      if(!wrap._filename) return;
      if(_audioEl&&!_audioEl.paused){ _audioEl.pause(); tx(playBtn,"▶"); return; }
      if(!_audioEl){
        const src=api.apiURL(`/view?filename=${encodeURIComponent(wrap._filename)}&type=input&subfolder=`);
        _audioEl=new Audio(src);
        _audioEl.addEventListener("ended",()=>tx(playBtn,"▶"));
        _audioEl.addEventListener("error",()=>tx(playBtn,"▶"));
      }
      _audioEl.play().then(()=>tx(playBtn,"⏸")).catch(()=>{});
    };
  }
  const _clearLoaded=()=>{
    _loadToken++;
    icoWrap.style.display="flex";loadedName.style.display="none";rm.style.display="none";
    wrap.style.borderColor=C.border;wrap.style.background=C.bg2;
    resetSize();
    wrap._hasFile=false;wrap._filename=null;
    if(videoThumb){videoThumb.style.display="none";videoThumb.src="";}
    if(audioGlow) audioGlow.style.display="none";
    if(playBtn) playBtn.style.display="none";
    if(spkBtn) spkBtn.style.display="none";
    _stopAudio();
    if(_objUrl){URL.revokeObjectURL(_objUrl);_objUrl=null;}
    onFile(null);
    if(onDimensions) onDimensions(null,null);
  };
  const _restorePreview=(name)=>{
    if(!name) return;
    _loadToken++;
    if(_objUrl){URL.revokeObjectURL(_objUrl);_objUrl=null;}
    wrap._filename=name;
    tx(loadedName,name);loadedName.style.display="block";
    icoWrap.style.display="none";rm.style.display="flex";
    wrap.style.borderColor=C.lime;wrap._hasFile=true;
    if(videoThumb){
      const src=api.apiURL(`/view?filename=${encodeURIComponent(name)}&type=input&subfolder=`);
      videoThumb.src=src;videoThumb.style.display="block";videoThumb.load();
      videoThumb.addEventListener("loadedmetadata",()=>{videoThumb.currentTime=0.01;},{once:true});
    }
    if(audioGlow) audioGlow.style.display="flex";
    if(playBtn) playBtn.style.display="flex";
    if(spkBtn) spkBtn.style.display="flex";
  };
  const _load=async(file)=>{
    if(!_fileMatches(file,typeExts)){if(_h3ShowError)_h3ShowError(`Unsupported ${type} format.`);return;}
    const token=++_loadToken;
    const objectUrl=URL.createObjectURL(file);
    try{
      const filename=await _uploadMedia(file);
      if(token!==_loadToken){URL.revokeObjectURL(objectUrl);return;}
      if(_objUrl) URL.revokeObjectURL(_objUrl);
      _objUrl=objectUrl;
      _showLoaded(filename,objectUrl);onFile(filename);
    }catch(e){
      URL.revokeObjectURL(objectUrl);
      if(token===_loadToken&&_h3ShowError) _h3ShowError(`${type==="video"?"Video":"Audio"} upload failed: `+fmtErr(e));
    }
  };
  fileInp.onchange=()=>{ const f=fileInp.files[0];if(f)_load(f);fileInp.value=""; };
  rm.onclick=e=>{ e.stopPropagation();_clearLoaded(); };
  wrap.clear=_clearLoaded;
  wrap._restorePreview=_restorePreview;
  return wrap;
}

let _uploadsPending=0;
let _h3ShowError=null;
const _uploadImage=async(file)=>{
  _uploadsPending++;
  try{
    const fd=new FormData();fd.append("image",file);fd.append("overwrite","true");
    const r=await api.fetchApi("/upload/image",{method:"POST",body:fd});
    if(!r.ok) throw new Error("upload failed (HTTP "+r.status+")");
    const d=await r.json();
    if(!d||!d.name) throw new Error("upload returned no filename");
    return d.name;
  }finally{_uploadsPending--;}
};
const _uploadMedia=async(file)=>{
  _uploadsPending++;
  try{
    const fd=new FormData();fd.append("file",file,file.name);
    const res=await fetch("/h3one/upload",{method:"POST",body:fd});
    const data=await res.json();
    if(!res.ok||!data.ok||!data.filename) throw new Error(data.error||`upload failed (HTTP ${res.status})`);
    return data.filename;
  }finally{_uploadsPending--;}
};

function openVideoMaskEditor({videoName,maskName,startTime,onSave,sam3Ckpt}){
  return new Promise((resolve)=>{
    const overlay=mk("div",{position:"fixed",inset:"0",zIndex:"1000001",background:"rgba(0,0,0,.88)",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",boxSizing:"border-box"});
    const panel=mk("div",{width:"min(980px,94vw)",maxHeight:"94vh",overflowY:"auto",background:C.bg1,border:`1px solid ${C.borderH}`,borderRadius:"12px",boxShadow:"0 24px 80px rgba(0,0,0,.9)",padding:"14px",display:"flex",flexDirection:"column",gap:"10px",boxSizing:"border-box"});
    const head=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
    const title=mk("div",{fontSize:"13px",fontWeight:"800",color:C.text});tx(title,"Paint first-frame mask");
    const help=mk("div",{fontSize:"10px",color:C.muted,lineHeight:"1.5"});tx(help,"Paint the whole region to replace with room to spare. For a face, cover the head, hair and neck; a tight outline around the features gets clipped by the paste. SAM 3 tracks it through the clip.");
    head.append(title,help);
    const scrollBox=mk("div",{overflow:"auto",maxWidth:"min(920px,94vw)",maxHeight:"70vh",display:"flex",background:"#000",border:`1px solid ${C.border}`,borderRadius:"8px",padding:"4px",boxSizing:"border-box",touchAction:"pan-x pan-y"});
    const stage=mk("div",{position:"relative",margin:"auto",flexShrink:"0",background:"#000",overflow:"hidden",touchAction:"none"});
    const video=mk("video",{position:"absolute",inset:"0",width:"100%",height:"100%",objectFit:"contain",display:"block"},{muted:true,preload:"auto",playsInline:true});
    const canvas=mk("canvas",{position:"absolute",inset:"0",width:"100%",height:"100%",cursor:"crosshair",touchAction:"none"});
    const maskCanvas=document.createElement("canvas");
    const ctx=canvas.getContext("2d");
    const maskCtx=maskCanvas.getContext("2d",{willReadFrequently:true});
    stage.append(video,canvas);
    scrollBox.appendChild(stage);
    const tools=mk("div",{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"});
    const toolBtn=(label)=>{const b=mk("button",{height:"30px",padding:"0 12px",borderRadius:"7px",border:`1px solid ${C.border}`,background:C.bg2,color:C.text,fontSize:"10px",fontWeight:"700",cursor:"pointer",outline:"none"},{type:"button"});tx(b,label);return b;};
    const zoomOutBtn=toolBtn("−"),zoomInBtn=toolBtn("+"),zoomFitBtn=toolBtn("Fit");
    const zoomLabel=mk("span",{fontSize:"9px",color:C.muted,minWidth:"38px",textAlign:"center"});tx(zoomLabel,"100%");
    const drawBtn=toolBtn("Paint"),eraseBtn=toolBtn("Erase"),circleBtn=toolBtn("Circle"),squareBtn=toolBtn("Square"),smartBtn=toolBtn("Smart"),moveBtn=toolBtn("Move"),undoBtn=toolBtn("Undo"),redoBtn=toolBtn("Redo"),clearBtn=toolBtn("Clear");
    smartBtn.title="Left-click the character to add it to the mask (green marker). Right-click anything to keep it out, like a mic (blue marker). Each click re-segments with all your clicks together.";
    const sizeLabel=mk("label",{display:"flex",alignItems:"center",gap:"6px",fontSize:"10px",color:C.muted});
    const sizeText=mk("span",{});tx(sizeText,"Brush 48 px");
    const sizeInput=mk("input",{width:"150px",accentColor:C.lime},{type:"range",min:"4",max:"512",step:"2",value:"48"});
    sizeLabel.append(sizeText,sizeInput);
    const maskStats=mk("div",{fontSize:"9px",color:C.muted,marginLeft:"auto"});tx(maskStats,"");
    maskStats.title="What the numbers mean: painted pixels, their share of the whole frame, and the bounding box the region fits in. A small 1-5% face mask changes only that part of the shot and renders fast; a large mask touches more of the frame and takes longer.";
    const status=mk("div",{fontSize:"9px",color:C.muted,marginLeft:"auto"});tx(status,maskName?"Existing mask loaded":"No saved mask");
    const cancelBtn=toolBtn("Cancel"),saveBtn=toolBtn("Save mask");
    saveBtn.style.borderColor=C.lime;saveBtn.style.color=C.lime;
    tools.append(zoomOutBtn,zoomInBtn,zoomFitBtn,zoomLabel,drawBtn,eraseBtn,circleBtn,squareBtn,smartBtn,moveBtn,undoBtn,redoBtn,clearBtn,sizeLabel,maskStats,status,cancelBtn,saveBtn);
    panel.append(head,scrollBox,tools);overlay.appendChild(panel);document.body.appendChild(overlay);

    let mode="draw",drawing=false,last=null,activePointer=null,ready=false,closed=false,saving=false;
    let smart=false,smartBusy=false,posPts=[],negPts=[];
    let moving=false,moveStart=null,moveSnapshot=null,moved=false;
    let zoom=1;
    let undoStack=[],redoStack=[],beforeState=null;
    const snap=()=>maskCtx.getImageData(0,0,maskCanvas.width,maskCanvas.height);
    const updateUndo=()=>{undoBtn.disabled=!undoStack.length;redoBtn.disabled=!redoStack.length;};
    const pushUndo=()=>{undoStack.push(snap());if(undoStack.length>20)undoStack.shift();redoStack.length=0;updateUndo();};
    const undo=()=>{if(!undoStack.length)return;redoStack.push(snap());maskCtx.putImageData(undoStack.pop(),0,0);renderMask();updateUndo();};
    const redo=()=>{if(!redoStack.length)return;undoStack.push(snap());maskCtx.putImageData(redoStack.pop(),0,0);renderMask();updateUndo();};
    const applyZoom=()=>{
      zoom=Math.min(8,Math.max(1,zoom));
      stage.style.zoom=String(zoom);
      tx(zoomLabel,zoom===1?"100%":Math.round(zoom*100)+"%");
    };
    const renderMode=()=>{
      drawBtn.style.borderColor=mode==="draw"?C.lime:C.border;
      drawBtn.style.color=mode==="draw"?C.lime:C.text;
      eraseBtn.style.borderColor=mode==="erase"?C.err:C.border;
      eraseBtn.style.color=mode==="erase"?C.err:C.text;
      circleBtn.style.borderColor=mode==="circle"?C.lime:C.border;
      circleBtn.style.color=mode==="circle"?C.lime:C.text;
      squareBtn.style.borderColor=mode==="square"?C.lime:C.border;
      squareBtn.style.color=mode==="square"?C.lime:C.text;
      moveBtn.style.borderColor=mode==="move"?C.lime:C.border;
      moveBtn.style.color=mode==="move"?C.lime:C.text;
      smartBtn.style.borderColor=smart?C.lime:C.border;
      smartBtn.style.color=smart?C.lime:C.text;
      canvas.style.cursor=smart?"crosshair":(mode==="move"?"move":(mode==="draw"?"crosshair":"crosshair"));
    };
    const exitSmart=()=>{
      if(!smart) return;
      smart=false;posPts.length=0;negPts.length=0;renderMode();
      tx(status,"Smart off - painted mask kept");
      status.style.color=C.muted;
    };
    const runSmart=async()=>{
      if(smartBusy||!ready) return;
      const hasAny=posPts.length>0||negPts.length>0;
      if(!hasAny) return;
      if(!posPts.length){tx(status,"Left-click the character first - Smart needs a positive click");status.style.color=C.err;return;}
      if(!String(sam3Ckpt||"").trim()){tx(status,"Pick the SAM 3 checkpoint under Settings first");status.style.color=C.err;return;}
      smartBusy=true;canvas.style.cursor="progress";
      tx(status,`Segmenting ${posPts.length} in / ${negPts.length} out...`);
      status.style.color=C.muted;
      try{
        const r=await fetch("/h3one/smart_mask",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          source:videoName,ckpt_name:sam3Ckpt,start:Number(startTime)||0,
          positive:posPts.map(p=>({x:p.x,y:p.y})),negative:negPts.map(p=>({x:p.x,y:p.y})),
          refine_iterations:2,
        })});
        const d=await r.json();
        if(!r.ok||!d||!d.ok) throw new Error((d&&d.error)||("smart mask failed (HTTP "+r.status+")"));
        await applySmartMask(d.mask);
        if(closed) return;
        tx(status,`Smart mask merged - click again to refine (${posPts.length} in, ${negPts.length} out)`);
        status.style.color=C.lime;
      }catch(e){
        tx(status,"Smart segment failed: "+fmtErr(e));status.style.color=C.err;
      }finally{
        smartBusy=false;if(!closed) canvas.style.cursor="crosshair";
      }
    };
    const applySmartMask=async(name)=>{
      const img=new Image();
      await new Promise((res,rej)=>{img.onload=res;img.onerror=()=>rej(new Error("mask load failed"));img.src=api.apiURL(`/view?filename=${encodeURIComponent(name)}&type=input&subfolder=&t=${Date.now()}`);});
      if(closed) return;
      pushUndo();
      const tmp=document.createElement("canvas");tmp.width=maskCanvas.width;tmp.height=maskCanvas.height;
      const tc=tmp.getContext("2d",{willReadFrequently:true});
      tc.drawImage(img,0,0,tmp.width,tmp.height);
      const stencil=tc.getImageData(0,0,tmp.width,tmp.height);
      for(let i=0;i<stencil.data.length;i+=4){
        const v=Math.max(stencil.data[i],stencil.data[i+1],stencil.data[i+2]);
        stencil.data[i]=255;stencil.data[i+1]=255;stencil.data[i+2]=255;stencil.data[i+3]=v;
      }
      tc.putImageData(stencil,0,0);
      maskCtx.drawImage(tmp,0,0);
      renderMask();
    };
    const renderMask=()=>{
      if(!ready) return;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(maskCanvas,0,0);
      ctx.globalCompositeOperation="source-in";
      ctx.fillStyle="rgba(255,72,72,.68)";
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.globalCompositeOperation="source-over";
      drawSmartPoints();
      updateMaskStats();
    };
    const drawSmartPoints=()=>{
      if(!smart) return;
      const r=Math.max(5,Math.round(Math.min(canvas.width,canvas.height)*.01));
      const mark=(pts,color,neg)=>{
        ctx.save();
        ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;
        for(const p of pts){
          ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();
          const s=Math.max(3,Math.round(r*.55));
          ctx.beginPath();
          if(neg){
            ctx.moveTo(p.x-s,p.y-s);ctx.lineTo(p.x+s,p.y+s);ctx.moveTo(p.x+s,p.y-s);ctx.lineTo(p.x-s,p.y+s);
          }else{
            ctx.moveTo(p.x-s,p.y);ctx.lineTo(p.x+s,p.y);ctx.moveTo(p.x,p.y-s);ctx.lineTo(p.x,p.y+s);
          }
          ctx.stroke();
        }
        ctx.restore();
      };
      mark(posPts,"#3ddc84",false);
      mark(negPts,"#46a6ff",true);
    };
    const updateMaskStats=()=>{
      const w=maskCanvas.width,h=maskCanvas.height;
      if(!w||!h){tx(maskStats,"");return;}
      const data=maskCtx.getImageData(0,0,w,h).data;
      let count=0,minX=w,minY=h,maxX=-1,maxY=-1;
      for(let y=0;y<h;y++){
        for(let x=0;x<w;x++){
          if(data[(y*w+x)*4+3]>8){
            count++;
            if(x<minX)minX=x;if(x>maxX)maxX=x;
            if(y<minY)minY=y;if(y>maxY)maxY=y;
          }
        }
      }
      if(!count){tx(maskStats,"Mask: empty");return;}
      const pct=(100*count/(w*h)).toFixed(1);
      tx(maskStats,`Mask: ${count.toLocaleString()} px · ${pct}% of frame · ${maxX-minX+1}×${maxY-minY+1}px`);
      maskStats.style.color=C.lime;
    };
    const maskCentroid=()=>{
      const w=maskCanvas.width,h=maskCanvas.height;
      if(!w||!h) return null;
      const data=maskCtx.getImageData(0,0,w,h).data;
      let n=0,sx=0,sy=0;
      for(let y=0;y<h;y++){
        for(let x=0;x<w;x++){
          if(data[(y*w+x)*4+3]>8){n++;sx+=x;sy+=y;}
        }
      }
      if(!n) return null;
      return {x:Math.round(sx/n),y:Math.round(sy/n)};
    };
    const close=(value=null)=>{
      if(closed) return;
      closed=true;
      document.removeEventListener("keydown",smartEsc);
      video.pause();video.removeAttribute("src");video.load();overlay.remove();resolve(value);
    };
    const smartEsc=(e)=>{if(e.key==="Escape")exitSmart();};
    document.addEventListener("keydown",smartEsc);
    const loadMask=()=>{
      ready=false;
      undoStack.length=0;redoStack.length=0;updateUndo();
      if(!maskName){ready=true;renderMask();return;}
      const img=new Image();
      img.onload=()=>{
        if(closed) return;
        const tmp=document.createElement("canvas");tmp.width=canvas.width;tmp.height=canvas.height;
        const tc=tmp.getContext("2d",{willReadFrequently:true});tc.drawImage(img,0,0,tmp.width,tmp.height);
        const data=tc.getImageData(0,0,tmp.width,tmp.height);
        for(let i=0;i<data.data.length;i+=4){
          const v=Math.max(data.data[i],data.data[i+1],data.data[i+2]);
          data.data[i]=255;data.data[i+1]=255;data.data[i+2]=255;data.data[i+3]=v;
        }
        maskCtx.putImageData(data,0,0);ready=true;renderMask();
      };
      img.onerror=()=>{if(closed)return;tx(status,"Could not load old mask");ready=true;renderMask();};
      img.src=api.apiURL(`/view?filename=${encodeURIComponent(maskName)}&type=input&subfolder=&t=${Date.now()}`);
    };
    video.onloadedmetadata=()=>{
      const vw=video.videoWidth||640,vh=video.videoHeight||360;
      const maxW=Math.min(920,window.innerWidth*.86),maxH=Math.min(720,window.innerHeight*.7);
      const scale=Math.min(maxW/vw,maxH/vh);
      stage.style.width=Math.max(1,Math.round(vw*scale))+"px";
      stage.style.height=Math.max(1,Math.round(vh*scale))+"px";
      canvas.width=vw;canvas.height=vh;maskCanvas.width=vw;maskCanvas.height=vh;
      const brush=Math.max(8,Math.round(Math.min(vw,vh)*.05));
      sizeInput.max=String(Math.max(64,Math.round(Math.min(vw,vh)*.3)));
      sizeInput.value=String(brush);tx(sizeText,`Brush ${brush} px`);
      loadMask();
      try{video.currentTime=Math.min((Number(startTime)||0),Math.max(0,(video.duration||0)-.001));}catch(e){}
    };
    video.onerror=()=>{tx(status,"Source video could not be opened");status.style.color=C.err;};
    video.src=api.apiURL(`/view?filename=${encodeURIComponent(videoName)}&type=input&subfolder=&t=${Date.now()}`);

    const point=(e)=>mapMaskPoint(e.clientX,e.clientY,canvas.getBoundingClientRect(),canvas.width,canvas.height);
    const paintDot=(p)=>{
      const radius=Number(sizeInput.value)/2;
      maskCtx.save();
      maskCtx.globalCompositeOperation=mode==="erase"?"destination-out":"source-over";
      maskCtx.fillStyle="#fff";maskCtx.beginPath();maskCtx.arc(p.x,p.y,radius,0,Math.PI*2);maskCtx.fill();maskCtx.restore();
    };
    let shapeStart=null,shapeCurr=null,savedMask=null;
    const paintShape=()=>{
      if(!shapeStart||!shapeCurr) return;
      maskCtx.save();
      maskCtx.globalCompositeOperation=mode==="erase"?"destination-out":"source-over";
      maskCtx.fillStyle="#fff";
      if(mode==="circle"){
        const r=Math.max(1,Math.hypot(shapeCurr.x-shapeStart.x,shapeCurr.y-shapeStart.y));
        maskCtx.beginPath();maskCtx.arc(shapeStart.x,shapeStart.y,r,0,Math.PI*2);maskCtx.fill();
      } else {
        maskCtx.fillRect(Math.min(shapeStart.x,shapeCurr.x),Math.min(shapeStart.y,shapeCurr.y),Math.abs(shapeCurr.x-shapeStart.x),Math.abs(shapeCurr.y-shapeStart.y));
      }
      maskCtx.restore();
    };
    let panning=false,panPointer=null,panStartX=0,panStartY=0,panScrollLeft=0,panScrollTop=0;
    const endPan=()=>{panning=false;panPointer=null;canvas.style.cursor="crosshair";};
    canvas.onpointerdown=(e)=>{
      if(e.button===1){
        panning=true;panPointer=e.pointerId;canvas.setPointerCapture(e.pointerId);
        panStartX=e.clientX;panStartY=e.clientY;
        panScrollLeft=scrollBox.scrollLeft;panScrollTop=scrollBox.scrollTop;
        canvas.style.cursor="grabbing";
        e.preventDefault();
        return;
      }
      if(smart){
        e.preventDefault();
        if(!ready||smartBusy) return;
        const p=point(e);if(!p)return;
        if(e.button===2){
          if(!posPts.length){
            const c=maskCentroid();
            if(!c){tx(status,"Left-click the character first - Smart needs a positive click");status.style.color=C.err;return;}
            posPts.push(c);
          }
          negPts.push(p);
        }else posPts.push(p);
        runSmart();
        return;
      }
      if(mode==="move"){
        e.preventDefault();
        if(!ready||activePointer!==null) return;
        const p=point(e);if(!p)return;
        if(maskCtx.getImageData(p.x,p.y,1,1).data[3]<=8) return;
        activePointer=e.pointerId;canvas.setPointerCapture(e.pointerId);
        moveSnapshot=snap();beforeState=moveSnapshot;moveStart=p;moving=true;moved=false;
        return;
      }
      if(!ready||activePointer!==null) return;e.preventDefault();activePointer=e.pointerId;canvas.setPointerCapture(e.pointerId);drawing=true;beforeState=snap();
      const p=point(e);if(!p)return;
      if(mode==="circle"||mode==="square"){
        shapeStart=p;shapeCurr=p;
        savedMask=maskCtx.getImageData(0,0,maskCanvas.width,maskCanvas.height);
        paintShape();renderMask();
      } else {
        last=p;if(last){paintDot(last);renderMask();}
      }
    };
    canvas.onpointermove=(e)=>{
      if(panning&&e.pointerId===panPointer){
        e.preventDefault();
        scrollBox.scrollLeft=panScrollLeft-(e.clientX-panStartX);
        scrollBox.scrollTop=panScrollTop-(e.clientY-panStartY);
        return;
      }
      if(moving&&e.pointerId===activePointer){
        e.preventDefault();
        const p=point(e);if(!p)return;
        const dx=Math.max(-maskCanvas.width,Math.min(maskCanvas.width,p.x-moveStart.x));
        const dy=Math.max(-maskCanvas.height,Math.min(maskCanvas.height,p.y-moveStart.y));
        if(dx||dy) moved=true;
        maskCtx.clearRect(0,0,maskCanvas.width,maskCanvas.height);
        maskCtx.putImageData(moveSnapshot,dx,dy);
        renderMask();
        return;
      }
      if(!drawing||e.pointerId!==activePointer) return;e.preventDefault();
      const p=point(e);if(!p)return;
      if(savedMask&&shapeStart&&(mode==="circle"||mode==="square")){
        shapeCurr=p;
        maskCtx.putImageData(savedMask,0,0);
        paintShape();renderMask();
        return;
      }
      if(!last) return;
      maskCtx.save();maskCtx.globalCompositeOperation=mode==="erase"?"destination-out":"source-over";
      maskCtx.strokeStyle="#fff";maskCtx.lineWidth=Number(sizeInput.value);maskCtx.lineCap="round";maskCtx.lineJoin="round";
      maskCtx.beginPath();maskCtx.moveTo(last.x,last.y);maskCtx.lineTo(p.x,p.y);maskCtx.stroke();maskCtx.restore();last=p;renderMask();
    };
    const commitStroke=(e)=>{
      if(e.pointerId===panPointer){endPan();return;}
      if(e.pointerId!==activePointer)return;
      if(beforeState&&(mode!=="move"||moved)){undoStack.push(beforeState);if(undoStack.length>20)undoStack.shift();redoStack.length=0;}
      beforeState=null;
      moving=false;moveSnapshot=null;moveStart=null;moved=false;
      drawing=false;last=null;shapeStart=null;shapeCurr=null;savedMask=null;activePointer=null;
      updateUndo();
    };
    const cancelStroke=(e)=>{if(e.pointerId===panPointer){endPan();return;}if(e.pointerId!==activePointer)return;beforeState=null;moving=false;moveSnapshot=null;moveStart=null;moved=false;drawing=false;last=null;shapeStart=null;shapeCurr=null;savedMask=null;activePointer=null;};
    canvas.onpointerup=commitStroke;canvas.onpointercancel=cancelStroke;
    drawBtn.onclick=()=>{exitSmart();mode="draw";renderMode();};eraseBtn.onclick=()=>{exitSmart();mode="erase";renderMode();};
    circleBtn.onclick=()=>{exitSmart();mode="circle";renderMode();};squareBtn.onclick=()=>{exitSmart();mode="square";renderMode();};
    moveBtn.onclick=()=>{exitSmart();mode="move";renderMode();tx(status,"Move - drag the painted region into place");status.style.color=C.muted;};
    smartBtn.onclick=()=>{
      if(smart){exitSmart();return;}
      smart=true;mode="draw";renderMode();
      tx(status,`Smart on - left-click adds to the mask (green +), right-click keeps a spot out (blue x). Click again to refine.`);
      status.style.color=C.lime;
    };
    canvas.addEventListener("contextmenu",e=>{if(smart){e.preventDefault();}});
    zoomOutBtn.onclick=()=>{zoom=zoom/1.25;applyZoom();};
    zoomInBtn.onclick=()=>{zoom=zoom*1.25;applyZoom();};
    zoomFitBtn.onclick=()=>{zoom=1;applyZoom();};
    scrollBox.addEventListener("wheel",(e)=>{
      e.preventDefault();
      const rect=scrollBox.getBoundingClientRect();
      const px=e.clientX-rect.left,py=e.clientY-rect.top;
      const old=zoom;
      const next=Math.min(8,Math.max(1,old*Math.exp(-e.deltaY*0.0015)));
      if(next===old) return;
      zoom=next;
      applyZoom();
      const scale=zoom/old;
      scrollBox.scrollLeft=(scrollBox.scrollLeft+px)*scale-px;
      scrollBox.scrollTop=(scrollBox.scrollTop+py)*scale-py;
    },{passive:false});
    clearBtn.onclick=()=>{if(!ready)return;pushUndo();maskCtx.clearRect(0,0,maskCanvas.width,maskCanvas.height);posPts.length=0;negPts.length=0;renderMask();tx(status,"Mask cleared - smart clicks reset");};
    undoBtn.onclick=undo;redoBtn.onclick=redo;
    sizeInput.oninput=()=>tx(sizeText,`Brush ${sizeInput.value} px`);
    cancelBtn.onclick=()=>{if(!saving)close(null);};
    overlay.addEventListener("pointerdown",e=>e.stopPropagation());
    saveBtn.onclick=async()=>{
      if(!ready||saving) return;
      const pixels=maskCtx.getImageData(0,0,maskCanvas.width,maskCanvas.height).data;
      let painted=false;for(let i=3;i<pixels.length;i+=4){if(pixels[i]>8){painted=true;break;}}
      if(!painted){tx(status,"Paint an area first");status.style.color=C.err;return;}
      saving=true;saveBtn.disabled=true;cancelBtn.disabled=true;tx(status,"Uploading mask...");status.style.color=C.muted;
      try{
        const out=document.createElement("canvas");out.width=maskCanvas.width;out.height=maskCanvas.height;
        const oc=out.getContext("2d");oc.fillStyle="#000";oc.fillRect(0,0,out.width,out.height);oc.drawImage(maskCanvas,0,0);
        const blob=await new Promise((res,rej)=>out.toBlob(b=>b?res(b):rej(new Error("Mask encoding failed")),"image/png"));
        const file=new File([blob],`h3_mask_${Date.now()}.png`,{type:"image/png"});
        const name=await _uploadImage(file);if(closed)return;await onSave(name);close(name);
      }catch(e){saving=false;saveBtn.disabled=false;cancelBtn.disabled=false;tx(status,fmtErr(e));status.style.color=C.err;}
    };
    renderMode();
  });
}

function h3SamCheckpoints(items){
  return (Array.isArray(items)?items:[]).filter(m=>/sam3\.1.*multiplex.*\.safetensors$/i.test(String(m).replace(/\\/g,"/")));
}

function loadState(){ try{return JSON.parse(localStorage.getItem(LS_KEY)||"{}");}catch(e){return{};} }
function saveState(s){ try{localStorage.setItem(LS_KEY,JSON.stringify(s));}catch(e){} }

// -- Active refs + global API events ------------------------------------------
let _activeNode=null;
let _activeShowOutput=null;
let _activeResetBtn=null;
let _activeShowError=null;
let _activeSetStage=null;
let _activePromptId=null;
let _activeShowTime=null;
let _activeGenStartTs=0;
let _activeShowLatest=null;
let _activeShownFiles=[];
let _batchIds=[];
let _batchDone=0;
let _batchFailures=0;
let _settledBatchIds=new Set();
let _expectedBatchCount=0;
let _batchSubmissionOpen=false;
let _activeRunMetaByPrompt=new Map();
let _listenersRegistered=false;
let _finishWatchTimer=null;
let _finishDone=false;
let _queuedJobs=new Map();
let _activeQueueBtn=null;
let _activeQueueBadge=null;
let _queueReconcileTimer=null;
let _queueReconcilePending=false;

// -- Finish watch: polls prompt history so the end-of-run UI never depends
// on websocket events alone. The executed / execution_success listeners stay
// as the fast path; this covers the rest.
const _stopFinishWatch=()=>{
  if(_finishWatchTimer!==null){ clearInterval(_finishWatchTimer); _finishWatchTimer=null; }
};
const _armFinishWatch=()=>{
  _finishDone=false;
  _stopFinishWatch();
  _finishWatchTimer=setInterval(async()=>{
    const node=_activeNode;
    if(!node||!node._h3_S||node._h3_S.generating!==true||!_activePromptId){ _stopFinishWatch(); return; }
    try{
      const r=await api.fetchApi(`/history/${encodeURIComponent(_activePromptId)}`);
      const h=await r.json();
      const entry=h&&h[_activePromptId];
      const status=entry&&entry.status||{};
      const terminal=["success","error","interrupted"].includes(status.status_str);
      if(!terminal) return;
      const pending=[];
      for(const id of _batchIds){
        if(_settledBatchIds.has(id)) continue;
        let current=id===_activePromptId?entry:null;
        if(!current){const hr=await api.fetchApi(`/history/${encodeURIComponent(id)}`);const hd=await hr.json();current=hd&&hd[id];}
        const currentStatus=current&&current.status||{};
        if(!["success","error","interrupted"].includes(currentStatus.status_str)) return;
        pending.push([id,currentStatus]);
      }
      _stopFinishWatch();
      for(const [id,currentStatus] of pending){
        const messages=Array.isArray(currentStatus.messages)?currentStatus.messages:[];
        const failure=messages.find(message=>Array.isArray(message)&&["execution_error","execution_interrupted"].includes(message[0]));
        const failed=currentStatus.status_str!=="success"||!!failure;
        if(failed){const detail=failure&&failure[1]||{};_activeShowError?.(maskRunErrorHint(fmtErr(detail.exception_message||detail.error||"Execution failed."),_activeNode._h3_S));}
        await _finishRun(id,failed);
      }
      if(!pending.length) _finishRun(null,false);
    }catch(e){}
  },2500);
};
const _finishRun=async(pid=null,failed=false)=>{
  if(_finishDone) return;
  if(!_activeNode) return;
  if(_activeNode._h3_S && _activeNode._h3_S.generating!==true) return;
  if(_batchIds.length){
    if(pid){
      if(!_batchIds.includes(pid)||_settledBatchIds.has(pid)) return;
      _settledBatchIds.add(pid);
    }
    if(failed) _batchFailures++;
    _batchDone=_settledBatchIds.size;
    if(_batchSubmissionOpen) return;
    const expected=_expectedBatchCount||_batchIds.length;
    if(_batchDone<expected){
      if(pid) _activeSetStage?.(`Done ${_batchDone}/${expected}`,Math.round(_batchDone/expected*100));
      return;
    }
  }
  _finishDone=true;
  _stopFinishWatch();
  _activeSetStage?.("Done",100);
  const _elapsed=Date.now()-_activeGenStartTs;
  _activeShowTime?.(_elapsed);
  let tries=0;
  while(tries<12&&!_activeShownFiles.length&&_batchFailures<_batchIds.length){
    await _activeShowLatest?.();
    if(_activeShownFiles.length) break;
    tries++;
    await new Promise(res=>setTimeout(res,1500));
  }
  _activeResetBtn?.();
  const S=_activeNode?._h3_S;
  if(S && S.soundEnabled!==false && S.sound!=="off") playDone(S.sound||"chime");
};

// -- Queued-job counter: shows how many + Queue jobs are still waiting and in
// which modes. Tracked per prompt_id; reconciled against GET /queue so external
// clears (ComfyUI's own queue panel) are reflected instead of leaking.
const _QUEUE_MODE_SHORT={t2v:"T2V",i2v:"I2V",r2v:"R2V",audio_drive:"Audio",keyframes:"KF",extend:"Ext",chain:"Chain",mask:"Mask",image:"Img"};
const _mediaItemFromOutput=(out)=>{
  if(!out) return null;
  const vids=out.videos||out.gifs||null;
  if(Array.isArray(vids)&&vids.length) return vids[vids.length-1];
  const imgs=out.images||null;
  if(Array.isArray(imgs)&&imgs.length){
    const im=imgs[imgs.length-1];
    const animated=!!(out.animated&&out.animated.length);
    return {filename:im.filename,subfolder:im.subfolder||"",type:im.type||"output",kind:animated?"video":"image"};
  }
  return null;
};
const _mediaItemFromHistory=(entry)=>{
  const outputs=Object.values(entry&&entry.outputs||{}).reverse();
  for(const out of outputs){const item=_mediaItemFromOutput(out);if(item)return item;}
  return null;
};
// Bounded retry for the queued-output history fallback. ComfyUI commits a
// finished prompt to /history slightly after execution_success, so the old
// single lookup could miss the output and drop the queued result. This keeps
// the queue entry and badge while polling /history a bounded number of times,
// stops the moment media appears or a failure is confirmed, and cleans up
// after the deadline. Mirrored in h3_helpers.mjs (settleQueuedOutput).
const _settleQueuedJob=async(pid,qentry)=>{
  if(qentry._settling) return;
  qentry._settling=true;
  const MAX_ATTEMPTS=8;
  const DEADLINE_MS=8000;
  const start=Date.now();
  let failed=false;
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
    if(qentry.shown) break;
    let entry=null;
    try{
      const r=await api.fetchApi(`/history/${encodeURIComponent(pid)}`);
      const h=await r.json();
      entry=h&&h[pid]||null;
    }catch(e){entry=null;}
    const st=String(entry&&entry.status&&entry.status.status_str||"");
    if(st==="error"||st==="interrupted"){failed=true;break;}
    const item=_mediaItemFromHistory(entry);
    if(item&&qentry.node&&qentry.node._h3_showQueued){
      qentry.shown=true;
      qentry.node._h3_showQueued(item);
      break;
    }
    if(Date.now()-start>=DEADLINE_MS) break;
    if(attempt+1<MAX_ATTEMPTS) await new Promise(res=>setTimeout(res,800));
  }
  _queuedJobs.delete(pid);
  _renderQueueBadge();
  if(!_queuedJobs.size) _stopQueueSync();
  if(failed&&_activeQueueBtn){ _activeQueueBtn.title="Queued job failed."; _activeQueueBtn._flash("failed"); }
};
const _renderQueueBadge=()=>{
  const b=_activeQueueBadge;
  if(!b) return;
  const n=_queuedJobs.size;
  if(!n){ b.style.display="none"; return; }
  const modes=[...new Set([..._queuedJobs.values()].map(e=>e.mode))].map(m=>_QUEUE_MODE_SHORT[m]||m);
  let label=n+" queued";
  if(modes.length){
    label+=" - "+modes.slice(0,2).join(", ");
    if(modes.length>2) label+=" +"+(modes.length-2);
  }
  tx(b,label);
  b.title=label+" - running in ComfyUI's queue. Clear them from ComfyUI's queue panel if you want to cancel.";
  b.style.display="flex";
};
const _stopQueueSync=()=>{ if(_queueReconcileTimer!==null){ clearTimeout(_queueReconcileTimer); _queueReconcileTimer=null; } _queueReconcilePending=false; };
const _queueSync=async()=>{
  _queueReconcilePending=false;
  if(!_queuedJobs.size) return;
  try{
    const r=await api.fetchApi("/queue");
    const d=await r.json();
    const live=new Set();
    (d.queue_running||[]).forEach(e=>{ if(Array.isArray(e)&&e[1]) live.add(e[1]); });
    (d.queue_pending||[]).forEach(e=>{ if(Array.isArray(e)&&e[1]) live.add(e[1]); });
    let changed=false;
    for(const id of _queuedJobs.keys()){ if(!live.has(id)){ _queuedJobs.delete(id); changed=true; } }
    if(changed) _renderQueueBadge();
  }catch(e){}
};
// Reconcile once, shortly after the queue changes while we track jobs (catches
// jobs cleared from ComfyUI's own queue panel). Never a timer: /queue returns
// the full workflow JSON per job, so polling it on an interval would waste
// bandwidth and CPU. ComfyUI already broadcasts a cheap "status" event on every
// queue change; we just piggyback one /queue fetch on it, throttled.
const _armQueueSync=()=>{
  if(_queueReconcilePending) return;
  if(!_queuedJobs.size) return;
  _queueReconcilePending=true;
  _queueReconcileTimer=setTimeout(()=>{ _queueReconcileTimer=null; _queueSync(); },800);
};

app.registerExtension({
  name:"OneNode.MinimaxH3",
  async beforeRegisterNodeDef(nodeType,nodeData){
    if(nodeData.name!=="H3OneNode") return;

    nodeType.prototype.onNodeCreated=function(){
      try{
        this.color=C.bg0;this.bgcolor=C.bg0;this.resizable=false;
        if(this.widgets)this.widgets=[];
        this._buildUI();
      }catch(e){
        console.error("[OneNode.MinimaxH3] onNodeCreated failed:",e);
        console.error(e&&e.stack?e.stack:e);
        try{
          const errRoot=mk("div",{width:"100%",height:"560px",background:C.bg0,color:C.err,
            fontSize:"11px",padding:"16px",boxSizing:"border-box",overflow:"auto",
            fontFamily:"monospace",whiteSpace:"pre-wrap",lineHeight:"1.6"});
          tx(errRoot,"ALL in ONE MiniMaxH3 - UI build error:\n\n"+String(e&&e.stack?e.stack:e));
          this.addDOMWidget("h3_ui","div",errRoot,{
            getValue(){return null;},setValue(){},serialize:false,
            canvasOnly:!_isVueNodes(),
            computeSize(){const sh=(typeof LiteGraph!=="undefined"&&LiteGraph.NODE_SLOT_HEIGHT)||20;return[NODE_W,NODE_H+sh*3];},
          });
          {const sh=(typeof LiteGraph!=="undefined"&&LiteGraph.NODE_SLOT_HEIGHT)||20;this.setSize([NODE_W,NODE_H+sh*3]);}
        }catch(e2){ console.error("[OneNode.MinimaxH3] error display failed:",e2); }
      }
    };

    nodeType.prototype.onResize=function(){
      const slotH=(typeof LiteGraph!=="undefined"&&LiteGraph.NODE_SLOT_HEIGHT)||20;
      this.size=[NODE_W,NODE_H+slotH*3];
    };

    nodeType.prototype._buildUI=function(){
      const self=this;
      const saved=loadState();
      const _QF=QUALITY_PRESET_FLAGS;
      const _QL={balanced:"Balanced",speed:"Speed",high:"High Quality",turbo:"Turbo (Speed LoRA)",native:"Native",draft:"SLA Draft",custom:"Custom"};
      const _matchQ=()=>matchQualityPreset({sol:S.optSol,sage:S.optSage,kitchen:S.optKitchen,sla:S.optSla},_QF);

      if(!self._h3_S){
        const _sq=(saved.quality==="custom"||(saved.quality&&_QF[saved.quality]))?saved.quality:"balanced";
        const _qf=_QF[_sq]||{sol:false,sage:false,kitchen:false,sla:false};
        self._h3_S={
          mode:            saved.mode||"t2v",
          prompt:          saved.prompt!==undefined?saved.prompt:"",
          resolution:      saved.resolution!==undefined?saved.resolution:"960x544 (0.5MP Balanced)",
          duration:        saved.duration!==undefined?saved.duration:5,
          steps:           (saved.steps&&saved.steps!==30)?saved.steps:20,
          quality:         _sq,
          optSol:          (saved.quality==="custom")?(saved.optSol!==undefined?saved.optSol:false):_qf.sol,
          optSage:         (saved.quality==="custom")?(saved.optSage!==undefined?saved.optSage:false):_qf.sage,
          optKitchen:      (saved.quality==="custom")?(saved.optKitchen!==undefined?saved.optKitchen:false):_qf.kitchen,
          optSla:          (saved.quality==="custom")?(saved.optSla!==undefined?saved.optSla:false):_qf.sla,
          samplerName:     saved.samplerName||"res_multistep",
          schedulerName:   saved.schedulerName||"simple",
          seed:            (typeof saved.seed==="number")?Math.max(0,Math.min(H3_SEED_MAX,Math.round(saved.seed))):0,
          randomizeSeed:   saved.randomizeSeed!==undefined?saved.randomizeSeed:true,
          batch:           saved.batch||1,
          loras:          (()=>{ const arr=Array.isArray(saved.loras)?saved.loras:[]; const named=arr.filter(l=>l&&l.name); return named.concat([{name:"",strength:1,enabled:false}]); })(),
          firstFrame:      saved.firstFrame||null,
          lastFrame:       saved.lastFrame||null,
          firstFrameSize:  (saved.firstFrameSize&&saved.firstFrameSize.width>0&&saved.firstFrameSize.height>0)?{width:Number(saved.firstFrameSize.width),height:Number(saved.firstFrameSize.height)}:null,
          lastFrameSize:   (saved.lastFrameSize&&saved.lastFrameSize.width>0&&saved.lastFrameSize.height>0)?{width:Number(saved.lastFrameSize.width),height:Number(saved.lastFrameSize.height)}:null,
          firstFrameOrientation: ["landscape","portrait"].includes(saved.firstFrameOrientation)?saved.firstFrameOrientation:null,
          lastFrameOrientation:  ["landscape","portrait"].includes(saved.lastFrameOrientation)?saved.lastFrameOrientation:null,
          refImages:       (Array.isArray(saved.refImages)?saved.refImages:[]).filter(Boolean).slice(0,9),
          refImageSizes:   (saved.refImageSizes&&typeof saved.refImageSizes==="object"&&!Array.isArray(saved.refImageSizes))?saved.refImageSizes:{},
          refVideos:       (Array.isArray(saved.refVideos)?saved.refVideos:[]).map(v=>(typeof v==="string")?{name:v,useAudio:false}:{name:(v&&v.name)||"",useAudio:!!(v&&v.useAudio),width:(v&&Number(v.width))||null,height:(v&&Number(v.height))||null}).filter(v=>v.name).slice(0,3),
          refAudios:       (Array.isArray(saved.refAudios)?saved.refAudios:[]).filter(Boolean).slice(0,3),
          audioFile:       saved.audioFile||null,
          extendVideo:     saved.extendVideo||null,
          extendVideoSize: (saved.extendVideoSize&&saved.extendVideoSize.width>0&&saved.extendVideoSize.height>0)?{width:Number(saved.extendVideoSize.width),height:Number(saved.extendVideoSize.height)}:null,
          maskVideo:       saved.maskVideo||null,
          maskVideoSize:   (saved.maskVideoSize&&saved.maskVideoSize.width>0&&saved.maskVideoSize.height>0)?{width:Number(saved.maskVideoSize.width),height:Number(saved.maskVideoSize.height)}:null,
          maskStartTime:   Number.isFinite(Number(saved.maskStartTime))&&Number(saved.maskStartTime)>0?Number(saved.maskStartTime):0,
          maskSeed:        saved.maskSeed||null,
          maskTarget:      saved.maskTarget||"",
          maskThreshold:   Number.isFinite(Number(saved.maskThreshold))?Number(saved.maskThreshold):0.5,
          maskCropScale:   Number.isFinite(Number(saved.maskCropScale))?Number(saved.maskCropScale):1.5,
          maskAudioMode: ["preserve","preserve_no_lipsync","regenerate"].includes(saved.maskAudioMode)?saved.maskAudioMode:(saved.maskRegenerateAudio===true?"regenerate":"preserve"),
          kf:              (Array.isArray(saved.kf)&&saved.kf.length)?saved.kf.map(k=>({img:k.img||null,pos:k.pos||0,width:(k&&Number(k.width))||null,height:(k&&Number(k.height))||null})):[{img:null,pos:1,width:null,height:null},{img:null,pos:62,width:null,height:null},{img:null,pos:124,width:null,height:null}],
          chainClips:      Array.isArray(saved.chainClips)&&saved.chainClips.length? saved.chainClips : [{prompt:"",duration:5},{prompt:"",duration:5}],
          models:          Object.assign({}, DEFAULT_MODELS, saved.models||{}),
          speedLora:       saved.speedLora||"",
          speedLoraStrength: (typeof saved.speedLoraStrength==="number"&&isFinite(saved.speedLoraStrength))?saved.speedLoraStrength:0.8,
          shiftVideo:      (typeof saved.shiftVideo==="number"&&isFinite(saved.shiftVideo))?saved.shiftVideo:8,
          shiftAudio:      (typeof saved.shiftAudio==="number"&&isFinite(saved.shiftAudio))?saved.shiftAudio:3,
          audioOn:         saved.audioOn!==undefined?saved.audioOn:true,
          ...normalizeOutputSettings(saved),
          soundEnabled:    saved.soundEnabled!==undefined?saved.soundEnabled:true,
          sound:           saved.sound||"chime",
          accent:          (saved.accent&&saved.accent!=="#f0ff41"&&saved.accent.toLowerCase()!=="#00e5ff")?saved.accent:ACCENT_DEFAULT,
          mcLength:        saved.mcLength!==undefined?saved.mcLength:22,
          customW:         saved.customW||960,
          customH:         saved.customH||544,
          resDriveFrom:    (saved.resDriveFrom&&typeof saved.resDriveFrom==="object"&&!Array.isArray(saved.resDriveFrom))?saved.resDriveFrom:{},
          fitCfg:          (saved.fitCfg&&typeof saved.fitCfg==="object"&&!Array.isArray(saved.fitCfg))?saved.fitCfg:{},
          upscaleFactor:   saved.upscaleFactor||2,
          upscaleMethod:   saved.upscaleMethod||"seedvr",
          modeSettings:    (saved.modeSettings&&typeof saved.modeSettings==="object")?saved.modeSettings:{},
          autoSave:        saved.autoSave!==undefined?saved.autoSave:true,
          autoStage:       saved.autoStage!==undefined?saved.autoStage:true,
          livePreview:     saved.livePreview===true,
          livePreviewMode: (saved.livePreviewMode==="fast"||saved.livePreviewMode==="detailed")?saved.livePreviewMode:"balanced",
          generating:      false,
          playOnFinish:    saved.playOnFinish!==undefined?saved.playOnFinish:true,
          folded:          (saved.folded&&typeof saved.folded==="object")?saved.folded:{},
          imgSub:          saved.imgSub||"t2i",
          imgAspect:       saved.imgAspect||"1:1",
          imgMP:           clampImageMP(saved.imgMP),
          imgW:            planImageCanvas({mode:"custom",width:saved.imgW||1024,height:saved.imgH||1024}).width,
          imgH:            planImageCanvas({mode:"custom",width:saved.imgW||1024,height:saved.imgH||1024}).height,
          imgProfile:      saved.imgProfile||"base_quality_20",
          imgRefs:         (Array.isArray(saved.imgRefs)?saved.imgRefs:[]).filter(Boolean).slice(0,9),
          imgEditSrc:      typeof saved.imgEditSrc==="string"?saved.imgEditSrc:((saved.imgSub==="edit"&&saved.imgRefs&&saved.imgRefs[0])||null),
          imgRefsSize:     (saved.imgRefsSize&&typeof saved.imgRefsSize==="object"&&!Array.isArray(saved.imgRefsSize))?saved.imgRefsSize:{},
          resOrientation:  ["auto","landscape","portrait"].includes(saved.resOrientation)?saved.resOrientation:"auto",
        };
      }
      const S=self._h3_S;
      S.refImages=(Array.isArray(S.refImages)?S.refImages:[]).filter(Boolean).slice(0,9);
      S.refVideos=(Array.isArray(S.refVideos)?S.refVideos:[]).filter(v=>v&&(typeof v==="string"||v.name)).slice(0,3);
      S.refAudios=(Array.isArray(S.refAudios)?S.refAudios:[]).filter(Boolean).slice(0,3);
      S.imgRefs=(Array.isArray(S.imgRefs)?S.imgRefs:[]).filter(Boolean).slice(0,9);
      const _fitCfgFor=(state=S)=>{
        if(!state.fitCfg||typeof state.fitCfg!=="object") state.fitCfg={};
        if(!state.fitCfg[state.mode]||typeof state.fitCfg[state.mode]!=="object") state.fitCfg[state.mode]={key:null,mode:"fit",custom:null};
        const cfg=state.fitCfg[state.mode];
        if(!("key" in cfg)) cfg.key=null;
        if(!("mode" in cfg)) cfg.mode="fit";
        if(!("custom" in cfg)) cfg.custom=null;
        return cfg;
      };
      const _hexToRgb=(hex)=>{
        const h=String(hex||"").replace("#","");
        if(h.length===3) return h.split("").map(x=>parseInt(x+x,16)).join(",");
        const n=parseInt(h.slice(0,6),16);
        return isNaN(n)?"192,169,150":`${(n>>16)&255},${(n>>8)&255},${n&255}`;
      };
      let _updRecipeFn=null;
      let _syncFitRowFn=null;
      let _updPlaceholderLabelFn=null;
      let _updateFramesLabel=null;
      let _syncLiveToggle=null;
      let _workflowBuildBusy=false;
      const _applyAccent=(hex)=>{
        S.accent=hex;persist();
        document.documentElement.style.setProperty("--h3accent",hex);
        document.documentElement.style.setProperty("--h3accent-rgb",_hexToRgb(hex));
      };
      _applyAccent(S.accent||ACCENT_DEFAULT);

function persist(){
        // Keep the per-mode snapshot current on EVERY change, so steps/duration/
        // quality/resolution/loras survive workflow-tab switches (they used to be
        // captured only when switching mode tabs, so a stale snapshot overwrote
        // the just-changed value on rebuild).
        S.modeSettings[S.mode]={prompt:S.prompt,steps:S.steps,quality:S.quality,resolution:S.resolution,duration:S.duration,loras:JSON.parse(JSON.stringify(S.loras||[])),optSol:S.optSol,optSage:S.optSage,optKitchen:S.optKitchen,optSla:S.optSla};
        if(_updRecipeFn){ try{ _updRecipeFn(); }catch(e){} }
        saveState({
          mode:S.mode,prompt:S.prompt,resolution:S.resolution,duration:S.duration,
          steps:S.steps,quality:S.quality,optSol:S.optSol,optSage:S.optSage,optKitchen:S.optKitchen,optSla:S.optSla,samplerName:S.samplerName,schedulerName:S.schedulerName,randomizeSeed:S.randomizeSeed,seed:S.seed,batch:S.batch,
          loras:S.loras,chainClips:S.chainClips.map(c=>({prompt:c.prompt,duration:c.duration})),
          firstFrame:S.firstFrame,lastFrame:S.lastFrame,
          firstFrameSize:S.firstFrameSize,lastFrameSize:S.lastFrameSize,
          firstFrameOrientation:S.firstFrameOrientation,lastFrameOrientation:S.lastFrameOrientation,
          refImages:S.refImages,refImageSizes:S.refImageSizes,
          refVideos:S.refVideos,refAudios:S.refAudios,
          audioFile:S.audioFile,extendVideo:S.extendVideo,extendVideoSize:S.extendVideoSize,
          maskVideo:S.maskVideo,maskVideoSize:S.maskVideoSize,maskSeed:S.maskSeed,
          maskStartTime:S.maskStartTime,maskTarget:S.maskTarget,maskThreshold:S.maskThreshold,maskCropScale:S.maskCropScale,
          maskAudioMode:S.maskAudioMode,
          kf:(S.kf||[]).map(k=>({img:k.img||null,pos:k.pos||0,width:k.width||null,height:k.height||null})),
          models:S.models,speedLora:S.speedLora,speedLoraStrength:S.speedLoraStrength,shiftVideo:S.shiftVideo,shiftAudio:S.shiftAudio,audioOn:S.audioOn,fps:S.fps,
          soundEnabled:S.soundEnabled,sound:S.sound,accent:S.accent,mcLength:S.mcLength,
          upscaleFactor:S.upscaleFactor,upscaleMethod:S.upscaleMethod,
          modeSettings:S.modeSettings,
          autoSave:S.autoSave,customW:S.customW,customH:S.customH,
          autoStage:S.autoStage,
          resDriveFrom:S.resDriveFrom,fitCfg:S.fitCfg,
          playOnFinish:S.playOnFinish,folded:S.folded,livePreview:S.livePreview,
          livePreviewMode:S.livePreviewMode,
          imgSub:S.imgSub,imgAspect:S.imgAspect,imgMP:S.imgMP,imgW:S.imgW,imgH:S.imgH,
          imgProfile:S.imgProfile,imgRefs:S.imgRefs,imgEditSrc:S.imgEditSrc,imgRefsSize:S.imgRefsSize,
          resOrientation:S.resOrientation,
        });
        if(_syncFitRowFn){ try{ _syncFitRowFn(); }catch(e){} }
      }

      const _rememberFrameInfo=(orientKey,sizeKey,size)=>{
        const newOrient=orientKey?aspect(size&&size.width,size&&size.height):null;
        const prev=S[sizeKey];
        const prevOrient=orientKey?S[orientKey]:null;
        if(prevOrient===newOrient&&sameSize(prev,size)) return;
        if(orientKey) S[orientKey]=newOrient;
        S[sizeKey]=size||null;
        persist();
        if(_syncFitRowFn) _syncFitRowFn();
      };

      const _validSize=(size)=>!size||typeof size!=="object" ? false : (Number(size.width)>0 && Number(size.height)>0);
      const _labelSize=(size,label)=>Object.assign({}, size, {label});
      const _refImageSize=(state,idx)=>{
        const name=state.refImages&&state.refImages[idx];
        if(!name) return null;
        const sz=state.refImageSizes&&state.refImageSizes[name];
        return _validSize(sz) ? _labelSize(sz, `Reference ${idx+1}`) : null;
      };
      const _refVideoSize=(state,idx)=>{
        const v=state.refVideos&&state.refVideos[idx];
        if(!v||!v.width) return null;
        if(!_validSize({width:v.width,height:v.height})) return null;
        return _labelSize({width:v.width,height:v.height}, `Video ${idx+1}`);
      };
      const _kfSize=(state,idx)=>{
        const k=state.kf&&state.kf[idx];
        if(!k||!k.img) return null;
        if(!_validSize({width:k.width,height:k.height})) return null;
        return _labelSize({width:k.width,height:k.height}, `Keyframe ${k.pos}`);
      };
      const _imgRefSize=(state,idx)=>{
        const name=state.imgRefs&&state.imgRefs[idx];
        if(!name) return null;
        const sz=state.imgRefsSize&&state.imgRefsSize[name];
        return _validSize(sz) ? _labelSize(sz, `Image ref ${idx+1}`) : null;
      };

      const _fitSlots=(state=S)=>{
        const mode=state.mode;
        const out=[];
        const push=(key,label,size)=>{ if(_validSize(size)) out.push({key,label,size}); };
        if(mode==="i2v"){
          push("first","First Frame",state.firstFrameSize);
          push("last","Last Frame",state.lastFrameSize);
        } else if(mode==="r2v"||mode==="audio_drive"){
          (state.refImages||[]).forEach((n,i)=>{ const r=_refImageSize(state,i); if(r) push(`ref:${i}`,r.label,r); });
          (state.refVideos||[]).forEach((v,i)=>{ const r=_refVideoSize(state,i); if(r) push(`video:${i}`,r.label,r); });
        } else if(mode==="keyframes"){
          (state.kf||[]).forEach((k,i)=>{ const r=_kfSize(state,i); if(r) push(`kf:${i}`,r.label,r); });
        } else if(mode==="extend"){
          push("src","Source video",state.extendVideoSize);
        } else if(mode==="mask"){
          push("masksrc","Source video",state.maskVideoSize);
        }
        return out;
      };

      const _fitSlotSize=(state=S,key)=>{
        const s=_fitSlots(state).find(o=>o.key===key);
        return s? s.size : null;
      };

      const _fitPrimary=(state=S)=>{
        return resolveFitPrimary(_fitCfgFor(state), _fitSlots(state));
      };

      const _fitSourceSize=(state=S)=>{
        const p=_fitPrimary(state);
        if(!p) return null;
        return _labelSize(p.size,p.mode==="custom"?`${p.label} (custom)`:p.label);
      };

      const _effectiveResOrientation=(state=S)=>{
        if(state.resOrientation!=="auto") return state.resOrientation;
        if(state.mode==="mask") return "landscape";
        const src=_fitSourceSize(state);
        if(!src) return "landscape";
        return aspect(src.width,src.height)||"landscape";
      };

      const _setFitPrimary=(state=S,key,mode,custom)=>{
        const cfg=_fitCfgFor(state);
        cfg.key=key;
        cfg.mode=mode||"fit";
        cfg.custom=(mode==="custom"&&custom&&_validSize(custom))?{width:Math.max(32,Math.round(custom.width/32)*32),height:Math.max(32,Math.round(custom.height/32)*32)}:null;
      };

      let _fitChipRefreshes=[];
      const _mkFitChip=(slotKey,label)=>{
        const chip=mk("button",{background:"transparent",border:`1px solid ${C.border}`,borderRadius:"5px",padding:"1px 6px",fontSize:"8px",fontWeight:"700",color:C.muted,cursor:"pointer",outline:"none",transition:"all .15s",whiteSpace:"nowrap"},{type:"button"});
        tx(chip,"Fit");
        chip.title=`Set the video canvas from this ${label}. Click to cycle: Fit (auto aspect) -> Custom size -> Normal (native size).`;
        const wrap=mk("div",{display:"flex",flexDirection:"column",gap:"2px",alignItems:"center"});
        const sizeRow=mk("div",{display:"none",alignItems:"center",gap:"2px"});
        const cw=NI("",960,32,16384,32,v=>{ const p=_fitPrimary(S); if(p&&p.key===slotKey){ _setFitPrimary(S,slotKey,"custom",{width:v,height:(p.custom?p.custom.height:544)}); persist(); _syncFitRowFn(); } },"42px");
        const chh=NI("",544,32,16384,32,v=>{ const p=_fitPrimary(S); if(p&&p.key===slotKey){ _setFitPrimary(S,slotKey,"custom",{width:(p.custom?p.custom.width:960),height:v}); persist(); _syncFitRowFn(); } },"42px");
        const xsep=mk("div",{fontSize:"8px",color:C.muted});tx(xsep,"x");
        sizeRow.append(cw,xsep,chh);
        wrap.append(chip,sizeRow);
        const refresh=()=>{
          if(!wrap.isConnected) return;
          const p=_fitPrimary(S);
          const isPrimary=!!p&&p.key===slotKey;
          const mode=isPrimary?p.mode:"none";
          const isCustom=mode==="custom";
          chip.style.borderColor=isPrimary?C.lime:C.border;
          chip.style.color=isPrimary?C.lime:C.muted;
          chip.style.background=isPrimary?"rgba(var(--h3accent-rgb),.10)":"transparent";
          tx(chip,mode==="custom"?"Custom":(mode==="normal"?"Normal":(isPrimary?"Fit: ON":"Fit")));
          sizeRow.style.display=isCustom?"flex":"none";
          if(isCustom&&p.custom){
            cw._inp.value=String(Math.round(p.custom.width/32)*32);
            chh._inp.value=String(Math.round(p.custom.height/32)*32);
          }
        };
        chip.onclick=()=>{
          const p=_fitPrimary(S);
          if(p&&p.key===slotKey){
            if(p.mode==="fit"){ _setFitPrimary(S,slotKey,"custom",p.size); }
            else if(p.mode==="custom"){ _setFitPrimary(S,slotKey,"normal",p.size); }
            else { _setFitPrimary(S,slotKey,"fit",p.size); }
          } else {
            const sz=_fitSlotSize(S,slotKey);
            _setFitPrimary(S,slotKey,"fit",sz);
          }
          persist();
          _syncFitRowFn();
          _fitChipRefreshes.forEach(r=>{try{r();}catch(e){}});
          _updateFramesLabel&&_updateFramesLabel();
        };
        refresh();
        _fitChipRefreshes.push(refresh);
        return wrap;
      };

      const _foldState=S.folded||{};
      function _applyFold(key,hdr,body,chev){
        // Capture the body's inline display (flex/column etc.) BEFORE clearing it:
        // setting display="" on unfold used to wipe mk()'s display:flex, which
        // silently killed the container's gap (children then touched each other).
        const _dflt=body.style.display&&body.style.display!=="none"?body.style.display:"block";
        const _apply=f=>{ body.style.display=f?"none":_dflt; };
        _apply(!!_foldState[key]);
        tx(chev,_foldState[key]?"▸":"▾");
        hdr.onclick=()=>{
          _foldState[key]=!_foldState[key];
          _apply(_foldState[key]);
          tx(chev,_foldState[key]?"▸":"▾");
          persist();
        };
      }

      if(!document.getElementById("h3one-styles")){
        const styleEl=document.createElement("style");
        styleEl.id="h3one-styles";
        styleEl.textContent=`
          @keyframes h3-gradient { 0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%} }
          @keyframes h3-light-sweep { 0%{left:-80%;opacity:0}15%{opacity:1}85%{opacity:1}100%{left:120%;opacity:0} }
          @keyframes h3-pulse { 50%{opacity:.35;} }
          .h3one-root ~ .node_title, .h3one-root + .node_title { display:none !important; }
          input[type=number]::-webkit-inner-spin-button,
          input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
          input[type=number] { -moz-appearance:textfield; }
          .h3one-root{
            --h3-panel:#101010; --h3-card:#161616; --h3-field:#1d1d1d; --h3-hover:#242424;
            --h3-line:#2c2c2c; --h3-line2:#3d3d3d;
            --h3-tx:#f2f2f2; --h3-tx2:#9a9a9a; --h3-tx3:#5c5c5c;
            --h3-ok:#7ed491; --h3-warn:#ffc266; --h3-err:#ff8080;
          }
          /* nav row: compact mode chips + icon actions */
          .h3-nav{display:flex;align-items:center;gap:6px;padding:2px 2px 0 2px;}
          .h3-modes{display:flex;gap:3px;flex:1;min-width:0;flex-wrap:wrap;}
          .h3-mode{display:inline-flex;align-items:center;gap:4px;padding:5px 7px;background:var(--h3-card);border:1px solid var(--h3-line);border-radius:8px;cursor:pointer;color:var(--h3-tx2);font-family:inherit;transition:background-color .15s,border-color .15s,color .15s;}
          .h3-mode svg{width:12px;height:12px;flex-shrink:0;}
          .h3-mode span{font-size:8.5px;font-weight:700;letter-spacing:.02em;white-space:nowrap;}
          .h3-mode:hover{border-color:var(--h3-line2);color:var(--h3-tx);}
          .h3-mode:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(192,169,150,.35);}
          .h3-mode.on{background:linear-gradient(150deg,var(--h3accent),#e8d5c0);border-color:transparent;color:#141414;}
          .h3-mode.on span{color:#141414;}
          .h3-topbtn{width:26px;height:26px;border-radius:8px;background:transparent;border:1px solid transparent;color:var(--h3-tx2);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:border-color .15s,color .15s,background-color .15s;flex-shrink:0;}
          .h3-topbtn:hover{background:var(--h3-card);border-color:var(--h3-line2);color:var(--h3-tx);}
          .h3-topbtn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(192,169,150,.35);}
          .h3-topbtn svg{width:13px;height:13px;}
          /* cards */
          .h3-card{background:var(--h3-card);border:1px solid var(--h3-line);border-radius:13px;padding:11px 12px;display:flex;flex-direction:column;gap:8px;}
          .h3-ctitle{font-size:12.5px;font-weight:700;color:var(--h3-tx);}
          .h3-cdesc{font-size:10px;color:var(--h3-tx2);line-height:1.5;}
          /* recipe line: 2-line spec chips in a fixed 4-column grid with hairline dividers */
          .h3-recipe{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--h3-card);border:1px solid var(--h3-line);border-radius:10px;overflow:hidden;font-variant-numeric:tabular-nums;}
          .h3-chip{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:1px;background:var(--h3-field);border:none;border-radius:0;box-shadow:none;padding:5px 9px;min-width:0;overflow:hidden;text-align:left;position:relative;}
          .h3-chip:nth-child(n+2){border-left:1px solid var(--h3-line);}
          .h3-chip:nth-child(4n+1){border-left:none;}
          .h3-chip:nth-child(n+5){border-top:1px solid var(--h3-line);}
          .h3-chip .cl{font-size:7px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--h3-tx3);flex-shrink:0;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
          .h3-chip .cv{font-size:10px;font-weight:700;color:var(--h3-tx);width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
          .h3-chip.btn{cursor:pointer;font-family:inherit;outline:none;}
          .h3-chip.btn.hasdd{padding-right:16px;}
          .h3-chip.btn .chev{position:absolute;right:5px;top:50%;transform:translateY(-50%);font-size:7px;color:var(--h3-tx3);pointer-events:none;}
          .h3-chip.btn:hover{background:var(--h3-hover);}
          .h3-chip.btn:hover .cv{color:var(--h3accent);}
          .h3-chip.btn:focus-visible{box-shadow:0 0 0 2px rgba(var(--h3accent-rgb),.35);}
          /* ghost remove button (LoRA / keyframe / clip rows) */
          .h3-rmbtn{width:26px;height:26px;border-radius:9px;background:var(--h3-field);border:1px solid var(--h3-line);color:var(--h3-tx3);font-size:11px;font-weight:600;line-height:1;padding:0;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:border-color .15s,color .15s,background-color .15s;}
          .h3-rmbtn:hover{border-color:rgba(255,128,128,.55);color:var(--h3-err);background:rgba(255,128,128,.07);}
          .h3-rmbtn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(255,128,128,.3);}
          /* raised action buttons (under the preview) */
          .h3-actbtn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:8px;background:linear-gradient(180deg,#2b2b2b,#1e1e1e);border:1px solid var(--h3-line2);border-bottom-color:#141414;color:var(--h3-tx2);font-size:9.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;cursor:pointer;font-family:inherit;box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 1px 3px rgba(0,0,0,.45);transition:border-color .15s,color .15s,background .15s,box-shadow .15s,transform .1s;flex-shrink:0;}
          .h3-actbtn svg{width:11px;height:11px;flex-shrink:0;}
          .h3-actbtn:hover{border-color:var(--h3accent);color:var(--h3accent);background:linear-gradient(180deg,#313131,#232323);transform:translateY(-1px);box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 2px 6px rgba(0,0,0,.5);}
          .h3-actbtn:active{transform:translateY(0);background:linear-gradient(180deg,#1a1a1a,#212121);box-shadow:inset 0 1px 3px rgba(0,0,0,.5);}
          .h3-actbtn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(192,169,150,.35);}
          .h3-actbtn.on{background:linear-gradient(150deg,var(--h3accent),#e8d5c0);border-color:transparent;border-bottom-color:rgba(0,0,0,.25);color:#141414;box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 2px 8px rgba(192,169,150,.3);}
          .h3-actbtn.on:hover{color:#141414;filter:brightness(1.07);}
          .h3-actbtn.danger:hover{border-color:rgba(255,128,128,.55);color:var(--h3-err);}
          .h3-actbtn.warn{border-color:rgba(255,194,102,.4);}
          /* seed chip over the preview */
          .h3-previewmeta{position:absolute;top:8px;right:8px;display:flex;align-items:center;gap:6px;z-index:4;}
          .h3-previewmeta .h3-seedchip{position:static;}
          .h3-seedchip{position:absolute;top:8px;right:8px;display:none;align-items:center;gap:7px;background:rgba(12,12,12,.82);backdrop-filter:blur(6px);border:1px solid var(--h3-line2);border-radius:9px;padding:4px 5px 4px 10px;z-index:4;cursor:default;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 2px 8px rgba(0,0,0,.5);}
          .h3-seedchip .scl{font-size:8px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--h3-tx3);}
          .h3-seedchip .scv{font-size:10px;font-weight:700;color:var(--h3accent);font-variant-numeric:tabular-nums;}
          .h3-seedbtn{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:6px;background:linear-gradient(180deg,#2b2b2b,#1e1e1e);border:1px solid var(--h3-line2);border-bottom-color:#141414;color:var(--h3-tx2);font-size:8px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;font-family:inherit;box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 1px 2px rgba(0,0,0,.45);transition:border-color .15s,color .15s,background .15s,box-shadow .15s,transform .1s;flex-shrink:0;}
          .h3-seedbtn svg{width:9px;height:9px;flex-shrink:0;}
          .h3-seedbtn:hover{border-color:var(--h3accent);color:var(--h3accent);background:linear-gradient(180deg,#313131,#232323);transform:translateY(-1px);box-shadow:inset 0 1px 0 rgba(255,255,255,.09),0 2px 5px rgba(0,0,0,.5);}
          .h3-seedbtn:active{transform:translateY(0);box-shadow:inset 0 1px 3px rgba(0,0,0,.5);}
          .h3-seedbtn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(192,169,150,.35);}
          .h3-seedbtn.ok{border-color:var(--h3-ok);color:var(--h3-ok);}
          .h3-seedbtn.err{border-color:var(--h3-err);color:var(--h3-err);}
          /* live preview chip over the preview */
          @keyframes h3-livepulse {0%,100%{opacity:1;}50%{opacity:.25;}}
          .h3-livechip{position:absolute;top:8px;left:8px;display:none;align-items:center;gap:6px;background:rgba(12,12,12,.82);backdrop-filter:blur(6px);border:1px solid var(--h3-line2);border-radius:9px;padding:4px 9px 4px 7px;z-index:4;cursor:default;pointer-events:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 2px 8px rgba(0,0,0,.5);}
          .h3-livechip .lcdot{width:7px;height:7px;border-radius:50%;background:var(--h3accent);animation:h3-livepulse 1.6s ease-in-out infinite;}
          .h3-livechip .lctxt{font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--h3accent);}
          .h3-livechip.dim{border-color:rgba(255,194,102,.4);}
          .h3-livechip.dim .lcdot{background:var(--h3-warn);}
          .h3-livechip.dim .lctxt{color:var(--h3-warn);}
          /* seed pill row (Tune card) */
          .h3-seedrow{display:flex;align-items:center;gap:8px;background:var(--h3-field);border:1px solid var(--h3-line);border-radius:10px;padding:7px 10px;}
          .h3-slbl{font-size:10px;font-weight:600;color:var(--h3-tx2);flex-shrink:0;}
          .h3-tgl{width:38px;height:21px;border-radius:11px;background:var(--h3-tx3);cursor:pointer;position:relative;transition:background-color .2s;flex-shrink:0;border:none;padding:0;}
          .h3-tgl .thumb{position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;background:#cfcfcf;transition:left .2s,background-color .2s;}
          .h3-tgl.on{background:var(--h3accent);}
          .h3-tgl.on .thumb{left:19px;background:#141414;}
          .h3-tgl:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(192,169,150,.35);}
          @media (prefers-reduced-motion:reduce){ .h3-mode,.h3-topbtn,.h3-rmbtn,.h3-tgl,.h3-mtgl,.h3-actbtn,.h3-seedbtn{transition:none;} .h3-livechip .lcdot{animation:none;} }
        `;
        document.head.appendChild(styleEl);
      }

      const root=mk("div",{width:"100%",background:C.bg0,boxSizing:"border-box",
        fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        color:C.text,overflow:"hidden",position:"relative"});
      root.classList.add("h3one-root");

      const _syncNodeRadius=()=>{
        const wrapper=root.parentElement;
        if(!wrapper) return;
        const r=getComputedStyle(wrapper).borderRadius;
        root.style.borderRadius=(r&&r!=="0px")?r:"0px";
      };
      requestAnimationFrame(()=>{
        _syncNodeRadius();
        if(typeof ResizeObserver!=="undefined"){
          new ResizeObserver(_syncNodeRadius).observe(root.parentElement||root);
        }
      });

      const titleH=(typeof LiteGraph!=="undefined"&&LiteGraph.NODE_TITLE_HEIGHT)||30;
      const _slotH=(typeof LiteGraph!=="undefined"&&LiteGraph.NODE_SLOT_HEIGHT)||20;
      const _uiH=NODE_H-titleH-4;
      const scrollEl=mk("div",{width:"100%",height:_uiH+"px",overflowY:"hidden",overflowX:"hidden",boxSizing:"border-box",scrollbarWidth:"thin",scrollbarColor:`${C.border} transparent`});
      scrollEl.addEventListener("wheel",e=>{ if(document.activeElement&&(document.activeElement.tagName==="TEXTAREA"||document.activeElement.tagName==="INPUT")) return; e.stopPropagation(); },{passive:true});

      const pad=mk("div",{padding:"12px",display:"flex",flexDirection:"column",
        gap:"10px",boxSizing:"border-box",width:"100%",height:"100%"});

      const openOverlay=(el)=>{ el.style.display="flex";el.offsetHeight;el.style.opacity="1";el.style.transform="translateY(0)"; };
      const closeOverlayFade=(el)=>{ el.style.opacity="0";el.style.transform="translateY(6px)";setTimeout(()=>el.style.display="none",220); };

      // -- NAV ROW: compact mode chips + actions ------------------------------
      const topRight=mk("div",{display:"flex",gap:"4px",alignItems:"center",flexShrink:"0"});
      const MODE_ICONS={
        t2v:'<path d="M4 6h16M4 12h10M4 18h14"/>',
        i2v:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M6 17l4-4 3 3 2-2 3 3"/>',
        r2v:'<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13.5l9 5 9-5"/>',
        audio_drive:'<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>',
        keyframes:'<path d="M12 4l7 8-7 8-7-8 7-8z"/>',
        extend:'<path d="M4 12h14M13 6l6 6-6 6"/>',
        chain:'<path d="M10.5 13.5a4 4 0 005.7 0l2.8-2.8a4 4 0 00-5.7-5.7l-1.4 1.4"/><path d="M13.5 10.5a4 4 0 00-5.7 0L5 13.3a4 4 0 005.7 5.7l1.4-1.4"/>',
        mask:'<path d="M4 4h16v16H4z"/><path d="M8 15c2-5 5-7 9-8M7 17l3-1-2-2-1 3z"/>',
        image:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M6 17l4-4 3 3 2-2 3 3"/>',
      };
      const MODE_SHORT={t2v:"T2V",i2v:"I2V",r2v:"R2V",audio_drive:"Audio",keyframes:"Keys",extend:"Extend",chain:"Chain",mask:"Mask",image:"Image"};
      const modesWrap=mk("div",{}, {className:"h3-modes"});
      const modeEls={};
      const _updateTabs=()=>{
        MODES.forEach(m=>{
          const el=modeEls[m.key];
          if(!el) return;
          el.classList.toggle("on",S.mode===m.key);
        });
      };
      MODES.forEach(m=>{
        const b=mk("button",{}, {type:"button",className:"h3-mode",title:MODE_HINTS[m.key]||"","aria-pressed":"false"});
        b.innerHTML=`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MODE_ICONS[m.key]}</svg>`;
        b.appendChild(mk("span",{}, {textContent:MODE_SHORT[m.key]||m.label}));
        attachTip(b,MODE_HINTS[m.key]||"");
        b.onclick=()=>{ _switchMode(m.key); };
        modeEls[m.key]=b;modesWrap.appendChild(b);
      });
      const navRow=mk("div",{}, {className:"h3-nav"});
      navRow.append(modesWrap,topRight);
      const mkTopBtn=(svgPath,label,cb)=>{
        const b=mk("button",{}, {type:"button",className:"h3-topbtn",title:label,"aria-label":label});
        b.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svgPath}</svg>`;
        attachTip(b,label);
        b.onclick=cb;return b;
      };

      // -- SETTINGS OVERLAY --------------------------------------------------
      const settingsOverlay=mk("div",{
        position:"absolute",inset:"0",background:"#0a0a0a",
        display:"none",flexDirection:"column",padding:"16px",
        boxSizing:"border-box",zIndex:"50",borderRadius:"8px",overflowY:"auto",
        opacity:"0",transition:"opacity .22s ease, transform .22s ease",transform:"translateY(6px)",
      });
      const settHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"16px",flexShrink:"0"});
      const settTitle=mk("div",{fontSize:"13px",fontWeight:"700",letterSpacing:".06em",textTransform:"uppercase",color:C.text});
      tx(settTitle,"Settings");
      const settBtnRow=mk("div",{display:"flex",alignItems:"center",gap:"8px"});
      const settRefresh=mk("button",{background:"transparent",border:`1px solid ${C.border}`,borderRadius:"6px",padding:"4px 14px",fontSize:"11px",color:C.muted,cursor:"pointer",outline:"none"});
      tx(settRefresh,"Refresh models");
      settRefresh.onclick=()=>{ _loadModels().then(()=>tx(settRefresh,"Refresh models")); };
      const settClose=mk("button",{background:"transparent",border:`1px solid #e05555`,borderRadius:"6px",padding:"4px 14px",fontSize:"11px",color:"#e05555",cursor:"pointer",outline:"none"});
      tx(settClose,"Close");
      settClose.onclick=()=>closeOverlayFade(settingsOverlay);
      settBtnRow.append(settRefresh,settClose);
      settHdr.append(settTitle,settBtnRow);

      let _M={checkpoints:[],diffusion:[],text_encoders:[],vaes:[],loras:[]};
      const modelDDs={};
      const _mkModelRow=(key,label,items=[],onChange)=>{
        const w=mk("div",{marginBottom:"12px"});
        w.appendChild(cap(label));
        const dd=DD(items,S.models[key],v=>{S.models[key]=v;persist();onChange&&onChange(v);});
        w.appendChild(dd.el);
        modelDDs[key]=dd;
        return w;
      };
      const unetT2VRow=_mkModelRow("unetT2V","Diffusion model (T2V / I2V)");
      const unetR2VRow=_mkModelRow("unetR2V","Diffusion model (R2V / refs)");
      const clipRow=_mkModelRow("clip","Text encoder (CLIP)");
      const vaeVRow=_mkModelRow("vaeVideo","Video VAE");
      const vaeARow=_mkModelRow("vaeAudio","Audio VAE");
      const sam3Row=_mkModelRow("sam3","SAM 3 tracker checkpoint");
      sam3Row.firstChild.appendChild(infoIcon("Used only by Mask mode. Install sam3.1_multiplex_fp16.safetensors in a ComfyUI checkpoints model folder, then refresh models."));
      const taeRow=_mkModelRow("tae","Live Preview decoder (TAEH3)");
      taeRow.firstChild.appendChild(infoIcon("The tiny decoder used by the Live Preview toggle under the video. Every taeh3.safetensors found in a ComfyUI models/vae_approx folder is listed here. The node auto-picks one when your selection goes missing; change it here if you want a specific copy."));
      const upMethodWrap=mk("div",{marginBottom:"12px"});
      const upMethodCapRow=mk("div",{display:"flex",alignItems:"center",gap:"4px"});
      const upMethodCap=mk("div",{fontSize:"9px",fontWeight:"700",letterSpacing:".1em",textTransform:"uppercase",color:C.muted});
      tx(upMethodCap,"Upscale method");
      upMethodCapRow.append(upMethodCap,infoIcon("Two upscalers - switch any time:\nRTX VSR: driver-accelerated, very fast, up to 4x, needs no model.\nSeedVR2: AI diffusion restorer, richer detail, slower, uses the DiT + VAE below."));
      upMethodWrap.appendChild(upMethodCapRow);
      const upMethodDD=DD(["SeedVR2 (AI restore)","RTX VSR (fast)"],S.upscaleMethod==="rtx"?"RTX VSR (fast)":"SeedVR2 (AI restore)",v=>{
        S.upscaleMethod=v==="RTX VSR (fast)"?"rtx":"seedvr";
        persist();_updUpBtnTitle();
      });
      upMethodWrap.appendChild(upMethodDD.el);
      const upDitRow=_mkModelRow("upscaleDit","Upscale DiT model (SeedVR2)",["none"],()=>_updUpBtnTitle());
      upDitRow.firstChild.appendChild(infoIcon("Picking a model you don't have yet downloads it automatically on first use - the SeedVR2 pack handles the download. GGUF and safetensors variants both work."));
      const upVaeRow=_mkModelRow("upscaleVae","Upscale VAE (SeedVR2)",["none"],()=>_updUpBtnTitle());
      const upHint=mk("div",{fontSize:"9px",color:C.muted,marginTop:"4px",lineHeight:"1.4",marginBottom:"12px"});
      tx(upHint,"Used by the 2x button under the video. Pick 'none' on the DiT to disable SeedVR2 - then switch the method to RTX VSR.");
      const speedLoraWrap=mk("div",{marginBottom:"12px"});
      speedLoraWrap.appendChild(cap("Speed LoRA (Turbo preset)"));
      const speedLoraDD=DD(["none"],S.speedLora,v=>{S.speedLora=v==="none"?"":v;persist();});
      speedLoraWrap.appendChild(speedLoraDD.el);
      const speedLoraHint=mk("div",{fontSize:"9px",color:C.muted,marginTop:"4px",lineHeight:"1.4"});
      tx(speedLoraHint,"Used by the Turbo quality preset and the SLA Draft preset (the draft recipe uses a 4-step turbo LoRA at a reduced strength, not 1.0).");
      speedLoraWrap.appendChild(speedLoraHint);
      const slaWrap=mk("div",{marginBottom:"12px"});
      slaWrap.appendChild(cap("SLA Draft"));
      const slaHint=mk("div",{fontSize:"9px",color:C.muted,marginTop:"4px",lineHeight:"1.4"});
      tx(slaHint,"Settings for the SLA Draft quality preset and any SLA chip combo. Needs ComfyUI-PlagueKind-Nodes and a Speed LoRA above.");
      slaWrap.appendChild(slaHint);
      const _slaField=(labelTxt,ni,width="110px")=>{
        const row=mk("div",{display:"flex",alignItems:"center",gap:"8px",marginTop:"6px"});
        const lbl=mk("div",{fontSize:"10px",color:C.text,width,flexShrink:"0"});tx(lbl,labelTxt);
        row.append(lbl,ni);
        return row;
      };
      const slaLoraNI=NI("",S.speedLoraStrength,0.1,1.5,0.05,v=>{S.speedLoraStrength=Math.round(v*100)/100;persist();},"60px");
      const shiftVNI=NI("",S.shiftVideo,1,20,1,v=>{S.shiftVideo=Math.round(v);persist();},"60px");
      const shiftANI=NI("",S.shiftAudio,0,10,1,v=>{S.shiftAudio=Math.round(v);persist();},"60px");
      slaWrap.append(_slaField("Turbo/SLA LoRA strength",slaLoraNI),_slaField("Shift video",shiftVNI),_slaField("Shift audio",shiftANI));
      const audioToggle=Toggle("Generate native audio",S.audioOn,v=>{S.audioOn=v;persist();},"Audio Drive and R2V (with audio refs) always use the audio you provide - this toggle only controls the model's own generated soundtrack in T2V / I2V / Keyframes. You do not need to turn it off for audio modes.");
      const soundToggle=Toggle("Notification sound on complete",S.soundEnabled,v=>{S.soundEnabled=v;persist();});
      const playOnFinishToggle=Toggle("Play video on finish",S.playOnFinish,v=>{S.playOnFinish=v;persist();});
      const sndWrap=mk("div",{marginBottom:"12px"});
      sndWrap.appendChild(cap("Completion sound"));
      const sndNames={chime:"Chime",soft:"Soft",pop:"Pop"};
      const sndDD=DD(["Chime","Soft","Pop"],sndNames[S.sound]||"Chime",v=>{
        const map={Chime:"chime",Soft:"soft",Pop:"pop"};
        S.sound=map[v];persist();
      });
      sndWrap.appendChild(sndDD.el);
      const accWrap=mk("div",{marginBottom:"12px"});
      accWrap.appendChild(cap("Accent colour"));
      const accRow=mk("div",{display:"flex",gap:"6px",alignItems:"center"});
      const swatches=["#c0a996","#00e5ff","#a259ff","#ff6b6b","#4ade80","#ffb347"];
      const _syncSwatches=()=>{
        accRow.querySelectorAll(".h3-swatch").forEach(x=>{
          x.style.borderColor=(x.dataset.sw||"").toLowerCase()===(S.accent||"").toLowerCase()?"#fff":"transparent";
        });
      };
      swatches.forEach(sw=>{
        const b=mk("div",{width:"22px",height:"22px",borderRadius:"50%",background:sw,cursor:"pointer",border:"2px solid transparent",boxSizing:"border-box",flexShrink:"0"});
        b.className="h3-swatch";b.dataset.sw=sw;
        b.onclick=()=>{_applyAccent(sw);_syncSwatches();};
        accRow.appendChild(b);
      });
      const accInp=mk("input",{width:"32px",height:"26px",background:"transparent",border:"1px solid "+C.border,borderRadius:"6px",cursor:"pointer",padding:"2px"},{type:"color",value:S.accent||ACCENT_DEFAULT});
      accInp.oninput=()=>{_applyAccent(accInp.value);_syncSwatches();};
      accRow.appendChild(accInp);
      accWrap.append(accRow);
      const supWrap=mk("div",{marginTop:"20px",borderTop:`1px solid ${C.border}`,paddingTop:"14px"});
      const supCap=mk("div",{fontSize:"9px",fontWeight:"700",letterSpacing:".1em",textTransform:"uppercase",color:C.muted,marginBottom:"8px"});
      tx(supCap,"Support");
      const supBtn=mk("button",{background:"#FFDD00",border:"none",borderRadius:"6px",padding:"8px 16px",fontSize:"11px",fontWeight:"700",color:"#000",cursor:"pointer",outline:"none"});
      tx(supBtn,"Buy me a coffee");
      supBtn.onclick=()=>window.open(SUPPORT_URL,"_blank");
      supWrap.append(supCap,supBtn);
      settingsOverlay.append(settHdr,unetT2VRow,unetR2VRow,clipRow,vaeVRow,vaeARow,sam3Row,taeRow,upMethodWrap,upDitRow,upVaeRow,upHint,speedLoraWrap,slaWrap,audioToggle.el,soundToggle.el,playOnFinishToggle.el,sndWrap,accWrap,supWrap);

      // -- HISTORY OVERLAY ---------------------------------------------------
      const historyOverlay=mk("div",{
        position:"absolute",inset:"0",background:"#0a0a0a",
        display:"none",flexDirection:"column",padding:"16px",boxSizing:"border-box",zIndex:"50",
        borderRadius:"8px",overflowY:"auto",opacity:"0",transition:"opacity .22s ease",transform:"translateY(6px)",
      });
      const histHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"});
      const histTitle=mk("div",{fontSize:"13px",fontWeight:"700",letterSpacing:".06em",textTransform:"uppercase",color:C.text});
      tx(histTitle,"History");
      const histClose=mk("button",{background:"transparent",border:`1px solid #e05555`,borderRadius:"6px",padding:"4px 14px",fontSize:"11px",color:"#e05555",cursor:"pointer",outline:"none"});
      tx(histClose,"Close");histClose.onclick=()=>closeOverlayFade(historyOverlay);
      histHdr.append(histTitle,histClose);
      const histSearch=mk("input",{
        width:"100%",boxSizing:"border-box",background:C.bg2,border:`1px solid ${C.border}`,
        borderRadius:"8px",color:C.text,fontSize:"12px",padding:"7px 12px",outline:"none",
        transition:"border-color .15s",fontFamily:"inherit",marginBottom:"10px",
      },{type:"text",placeholder:"Search history..."});
      histSearch.onfocus=()=>histSearch.style.borderColor=C.lime;
      histSearch.onblur=()=>histSearch.style.borderColor=C.border;
      histSearch.oninput=()=>_renderHistory(histSearch.value);
      const histBody=mk("div",{flex:"1",minHeight:"0",display:"flex",gap:"0",overflow:"hidden"});
      const histList=mk("div",{width:"300px",flexShrink:"0",minHeight:"0",overflowY:"auto",padding:"4px 10px 12px",display:"flex",flexDirection:"column",gap:"5px",scrollbarWidth:"thin",scrollbarColor:`${C.border} transparent`,borderRight:`1px solid ${C.border}`});
      histList.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});
      const histDetail=mk("div",{flex:"1",minWidth:"0",minHeight:"0",overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:"12px",scrollbarWidth:"thin",scrollbarColor:`${C.border} transparent`});
      histDetail.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});
      histBody.append(histList,histDetail);
      historyOverlay.append(histHdr,histSearch,histBody);
      const _fmtTime=(ts)=>{
        const d=new Date(ts*1000);
        const pad=n=>String(n).padStart(2,"0");
        const now=new Date();
        if(d.toDateString()===now.toDateString()) return `Today ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        return `${d.getDate()}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      let _histItems=[];
      let _histOpenId=null;
      // History row mode metadata: per-mode icon+color, upscale methods, turbo
      const _HIST_MODE_COLORS={t2v:"#c0a996",i2v:"#5aa8ff",r2v:"#5fd08c",audio_drive:"#c07fff",keyframes:"#ffc266",extend:"#7ed491",chain:"#4dd0e1",mask:"#ff7f6e",image:"#f0a0c0"};
      const _HIST_UP_COLORS={rtx:"#5aa8ff",seedvr:"#c07fff"};
      const _histModeMeta=(mode)=>{
        const m=String(mode||"");
        const up=m.match(/^Upscale\s+(\d+)x\s+\(([^)]+)\)/i);
        if(up){
          const isRtx=/rtx/i.test(up[2]);
          return {kind:"upscale",label:up[1]+"x",method:up[2],color:_HIST_UP_COLORS[isRtx?"rtx":"seedvr"],
            icon:'<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'};
        }
        const c=_HIST_MODE_COLORS[m]||"#c0a996";
        return {kind:"mode",label:m||"t2v",color:c,icon:MODE_ICONS[m]||MODE_ICONS.t2v};
      };
      const _mkHistIcon=(meta,size)=>{
        const chip=mk("span",{width:size+"px",height:size+"px",borderRadius:"7px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:"0",border:`1px solid rgba(${_hexToRgb(meta.color)},.45)`,background:`rgba(${_hexToRgb(meta.color)},.09)`,color:meta.color});
        chip.innerHTML=`<svg viewBox="0 0 24 24" width="${Math.round(size*0.62)}" height="${Math.round(size*0.62)}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${meta.icon}</svg>`;
        return chip;
      };
      const _renderDetail=()=>{
        histDetail.innerHTML="";
        const it=_histItems.find(x=>x.id===_histOpenId);
        if(!it){
          const hint=mk("div",{flex:"1",display:"flex",alignItems:"center",justifyContent:"center",gap:"10px",color:C.muted,fontSize:"12px",textAlign:"center"});
          const hTxt=mk("div");tx(hTxt,_histItems.length?"Select an entry to view it":"Nothing here yet");
          hint.appendChild(hTxt);histDetail.appendChild(hint);return;
        }
        const meta=mk("div",{display:"flex",alignItems:"center",gap:"8px",flexShrink:"0",flexWrap:"wrap"});
        const mBadge=mk("span",{fontSize:"9px",fontWeight:"700",letterSpacing:".06em",color:C.lime,border:`1px solid rgba(var(--h3accent-rgb),.4)`,borderRadius:"5px",padding:"2px 8px",background:"rgba(var(--h3accent-rgb),.08)"});
        tx(mBadge,it.mode||"");
        const mTime=mk("span",{fontSize:"10px",color:C.muted});tx(mTime,_fmtTime(it.timestamp));
        const mInfo=mk("span",{fontSize:"9px",color:C.muted});
        tx(mInfo,`${it.resolution||""}${it.duration?(" - "+it.duration+"s"):""} - seed ${it.seed??"?"}`);
        const mGen=mk("span",{fontSize:"9px",color:C.text,fontWeight:"600"});
        if(it.gen_time){ tx(mGen,"⏱ "+fmtDur(it.gen_time)); } else { tx(mGen,""); }
        const mSeedCopy=mk("button",{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"5px",padding:"2px 8px",fontSize:"8px",fontWeight:"700",color:C.muted,cursor:"pointer",outline:"none",transition:"border-color .15s, color .15s"});
        tx(mSeedCopy,"Copy seed");
        mSeedCopy.onmouseenter=()=>{mSeedCopy.style.borderColor=C.lime;mSeedCopy.style.color=C.lime;};
        mSeedCopy.onmouseleave=()=>{mSeedCopy.style.borderColor=C.border;mSeedCopy.style.color=C.muted;};
        mSeedCopy.onclick=async()=>{
          if(it.seed===undefined||it.seed===null) return;
          const ok=await h3Copy(String(it.seed));
          tx(mSeedCopy,ok?"Copied":"Failed");
          setTimeout(()=>tx(mSeedCopy,"Copy seed"),1300);
        };
        meta.append(mBadge,mTime,mInfo,mGen,mSeedCopy);
        if(it.quality==="turbo"){
          const mTurbo=mk("span",{fontSize:"9px",fontWeight:"700",letterSpacing:".06em",color:"#ffc266",border:"1px solid rgba(255,194,102,.45)",borderRadius:"5px",padding:"2px 8px",background:"rgba(255,194,102,.1)"});
          tx(mTurbo,"Turbo LoRA");
          meta.insertBefore(mTurbo,mTime);
        }
        const secPrompt=mk("div",{display:"flex",flexDirection:"column",gap:"6px",flexShrink:"0"});
        const spLbl=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between"});
        const spTitle=mk("div",{fontSize:"9px",fontWeight:"700",letterSpacing:".08em",textTransform:"uppercase",color:C.lime});tx(spTitle,"Prompt");
        const reuseBtn=mk("button",{background:C.lime,color:"#111",border:"none",borderRadius:"6px",padding:"4px 12px",fontSize:"9px",fontWeight:"700",cursor:"pointer",outline:"none"});
        tx(reuseBtn,"Reuse prompt");
        reuseBtn.onclick=()=>{ _setPrompt(it.prompt||""); closeOverlayFade(historyOverlay); };
        spLbl.append(spTitle,reuseBtn);
        const promptBox=mk("div",{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"8px",color:C.text,fontSize:"12px",padding:"10px 12px",lineHeight:"1.6",userSelect:"text",wordBreak:"break-word",whiteSpace:"pre-wrap",maxHeight:"140px",overflowY:"auto",scrollbarWidth:"thin"});
        tx(promptBox,it.prompt&&it.prompt.trim()?it.prompt:"(no prompt)");
        promptBox.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});
        secPrompt.append(spLbl,promptBox);
        const secResult=mk("div",{display:"flex",flexDirection:"column",gap:"6px",flex:"1 1 0",minHeight:"0",overflow:"hidden"});
        const srTitle=mk("div",{fontSize:"9px",fontWeight:"700",letterSpacing:".08em",textTransform:"uppercase",color:C.muted,flexShrink:"0"});tx(srTitle,"Result");
        secResult.appendChild(srTitle);
        if(it.video){
          const fileType=it.type||(/^ComfyUI_temp_/i.test(it.video)?"temp":"output");
          const isImageHistory=it.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(it.video||"");
          const vurl=isImageHistory?api.apiURL(`/h3one/thumb?${thumbQuery(it,1600,fileType)}`):api.apiURL(`/view?${viewQuery(it,fileType)}`);
          if(isImageHistory){
            const v=mk("img",{width:"100%",height:"100%",maxHeight:"100%",borderRadius:"8px",background:"#000",objectFit:"contain",outline:"none",display:"block",flex:"1 1 0",minHeight:"180px"},{src:vurl,alt:"Generated image"});
            secResult.appendChild(v);
          } else {
            const wrapV=mk("div",{position:"relative",flex:"1 1 0",minHeight:"0",display:"flex",flexDirection:"column"});
            const v=mk("video",{width:"100%",flex:"1 1 0",minHeight:"0",height:"0",borderRadius:"8px",background:"#000",objectFit:"contain",outline:"none"},{controls:true,src:vurl});
            const exBtn=mk("button",{position:"absolute",top:"8px",right:"8px",background:"rgba(12,12,12,.82)",border:`1px solid rgba(192,169,150,.5)`,borderRadius:"7px",padding:"4px 10px",fontSize:"9px",fontWeight:"700",color:C.lime,cursor:"pointer",outline:"none",display:"flex",alignItems:"center",gap:"5px",backdropFilter:"blur(6px)",zIndex:"2",transition:"border-color .15s"});
            tx(exBtn,"Send to Extend");
            exBtn.onmouseenter=()=>{exBtn.style.borderColor=C.lime;};
            exBtn.onmouseleave=()=>{exBtn.style.borderColor="rgba(192,169,150,.5)";};
            exBtn.onclick=async()=>{
              exBtn.disabled=true;tx(exBtn,"Sending...");
              try{
                const stage=await fetch("/h3one/stage_input",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:it.video,subfolder:it.subfolder||"",type:fileType})});
                const sd=await stage.json();
                if(!sd.ok) throw new Error(sd.error||"Could not copy the video");
                S.extendVideo=sd.name;
                persist();
                exSlot._restorePreview(sd.name);
                closeOverlayFade(historyOverlay);
                _switchMode("extend");
              }catch(e){
                exBtn.disabled=false;
                tx(exBtn,"File missing");
                exBtn.style.borderColor="rgba(220,80,80,.6)";
                exBtn.style.color="#ff8a8a";
                setTimeout(()=>{tx(exBtn,"Send to Extend");exBtn.style.borderColor="rgba(192,169,150,.5)";exBtn.style.color=C.lime;},2600);
              }
            };
            wrapV.append(v,exBtn);
            secResult.appendChild(wrapV);
          }
        } else {
          const none=mk("div",{fontSize:"10px",color:C.muted});tx(none,"No video recorded.");
          secResult.appendChild(none);
        }
        const footer=mk("div",{display:"flex",justifyContent:"flex-end",flexShrink:"0",marginTop:"2px"});
        const delBtn=mk("button",{background:"transparent",border:`1px solid rgba(220,80,80,.3)`,borderRadius:"6px",padding:"4px 12px",fontSize:"9px",fontWeight:"700",color:"rgba(220,80,80,.7)",cursor:"pointer",outline:"none"});
        tx(delBtn,"Delete entry");
        delBtn.onclick=async()=>{
          await fetch(`/h3one/history/${it.id}`,{method:"DELETE"});
          _histItems=_histItems.filter(x=>x.id!==it.id);
          if(_histOpenId===it.id)_histOpenId=null;
          _renderHistory(histSearch.value||"");
        };
        footer.appendChild(delBtn);
        histDetail.append(meta,secPrompt,secResult,footer);
      };
      const _renderHistory=async(filter="")=>{
        histList.innerHTML="";
        let items=[];
        try{const r=await fetch("/h3one/history");const d=await r.json();items=d.items||[];}catch(e){}
        _histItems=items;
        const f=(filter||"").toLowerCase();
        const vis=items.filter(it=>!f||(it.prompt+" "+it.mode+" "+(it.video||"")).toLowerCase().includes(f));
        if(!vis.length){
          const empty=mk("div",{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"8px",paddingTop:"30px",color:C.muted,fontSize:"12px",textAlign:"center"});
          const emptyTxt=mk("div");tx(emptyTxt,f?"No results found":"No history yet. Generate something to see it here.");
          empty.append(emptyTxt);histList.appendChild(empty);
          _histOpenId=null;_renderDetail();return;
        }
        if(!vis.some(it=>it.id===_histOpenId)) _histOpenId=vis[0].id;
        vis.forEach(it=>{
          const isActive=it.id===_histOpenId;
          const row=mk("div",{
            background:isActive?"rgba(var(--h3accent-rgb),.06)":C.bg1,
            border:`1px solid ${isActive?C.lime:C.border}`,
            borderRadius:"9px",padding:"8px 10px",display:"flex",alignItems:"center",gap:"9px",
            cursor:"pointer",transition:"border-color .15s, background .15s",flexShrink:"0",
          });
          const dot=mk("span",{width:"7px",height:"7px",borderRadius:"50%",background:C.lime,flexShrink:"0"});
          const rowMain=mk("div",{flex:"1",minWidth:"0",display:"flex",flexDirection:"column",gap:"2px"});
          const rowPrompt=mk("div",{fontSize:"11.5px",color:C.text,lineHeight:"1.4",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:isActive?"600":"400"});
          tx(rowPrompt,it.prompt&&it.prompt.trim()?it.prompt.trim():"(no prompt)");
          const rowTime=mk("div",{fontSize:"9px",color:C.muted});tx(rowTime,`${_fmtTime(it.timestamp)} - ${it.mode||""}`);
          rowMain.append(rowPrompt,rowTime);
          const mmeta=_histModeMeta(it.mode);
          const mic=_mkHistIcon(mmeta,24);
          mic.title=mmeta.kind==="upscale"?("Upscale "+mmeta.label+" ("+mmeta.method+")"):(MODE_HINTS[mmeta.label]||mmeta.label);
          row.append(mic,rowMain);
          if(it.quality==="turbo"){
            const tChip=mk("span",{width:"18px",height:"18px",borderRadius:"5px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:"0",border:"1px solid rgba(255,194,102,.45)",background:"rgba(255,194,102,.1)",color:"#ffc266"});
            tChip.innerHTML='<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>';
            tChip.title="Turbo (Speed LoRA)";
            row.appendChild(tChip);
          }
          if(it.video){
            const isImg=it.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(it.video||"");
            const thumb=isImg
              ? mk("img",{width:"64px",height:"36px",borderRadius:"6px",background:"#000",objectFit:"cover",border:`1px solid ${C.border}`,flexShrink:"0",pointerEvents:"none",display:"block"},{src:api.apiURL(`/h3one/thumb?${thumbQuery(it,128)}`),alt:""})
              : mk("video",{width:"64px",height:"36px",borderRadius:"6px",background:"#000",objectFit:"cover",border:`1px solid ${C.border}`,flexShrink:"0",pointerEvents:"none",display:"block"},{muted:true,preload:"metadata",playsInline:true});
            if(!isImg){
              thumb.src=api.apiURL(`/view?${viewQuery(it)}`);
              thumb.addEventListener("loadeddata",()=>{ try{ thumb.currentTime=0.1; }catch(e){} });
            }
            thumb.title=it.video;
            row.appendChild(thumb);
          }
          row.onmouseenter=()=>{if(!isActive){row.style.borderColor="rgba(var(--h3accent-rgb),.3)";row.style.background=C.bg2;}};
          row.onmouseleave=()=>{if(!isActive){row.style.borderColor=C.border;row.style.background=C.bg1;}};
          row.onclick=()=>{_histOpenId=it.id;_renderHistory(histSearch.value||"");};
          histList.appendChild(row);
        });
        _renderDetail();
      };
      const historyBtn=mkTopBtn('<path d="M12 7v5l3.5 2"/><circle cx="12" cy="12" r="8.5"/>',"History",()=>{_renderHistory();openOverlay(historyOverlay);});
      const settingsBtn=mkTopBtn('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',"Settings",()=>openOverlay(settingsOverlay));

      // -- LIBRARY OVERLAY ---------------------------------------------------
      const libraryOverlay=mk("div",{
        position:"absolute",inset:"0",background:"#0a0a0a",
        display:"none",flexDirection:"column",padding:"16px",boxSizing:"border-box",zIndex:"50",
        borderRadius:"8px",overflow:"hidden",opacity:"0",transition:"opacity .22s ease",transform:"translateY(6px)",
      });
      const _LIB_MODE_LBL={t2v:"T2V",i2v:"I2V",r2v:"R2V",audio_drive:"Audio Drive",keyframes:"Keyframes",extend:"Extend",chain:"Chain",mask:"Mask",image:"Image"};
      const libHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"});
      const libTitle=mk("div",{fontSize:"13px",fontWeight:"700",letterSpacing:".06em",textTransform:"uppercase",color:C.text});
      tx(libTitle,"Library");
      const libActs=mk("div",{display:"flex",alignItems:"center",gap:"8px"});
      const libFavOnly=mk("button",{background:"transparent",border:`1px solid ${C.border}`,borderRadius:"6px",padding:"4px 12px",fontSize:"11px",color:C.muted,cursor:"pointer",outline:"none",transition:"background .15s, color .15s"});
      tx(libFavOnly,"Favorites");
      libFavOnly.onclick=()=>{_libFavOnly=!_libFavOnly;libFavOnly.style.background=_libFavOnly?C.lime:"transparent";libFavOnly.style.borderColor=_libFavOnly?C.lime:C.border;libFavOnly.style.color=_libFavOnly?"#111":C.muted;_renderLibrary();};
      const libRefresh=mk("button",{background:"transparent",border:`1px solid ${C.border}`,borderRadius:"6px",padding:"4px 12px",fontSize:"11px",color:C.muted,cursor:"pointer",outline:"none"});
      tx(libRefresh,"Refresh");
      libRefresh.onmouseenter=()=>{libRefresh.style.borderColor=C.lime;libRefresh.style.color=C.lime;};
      libRefresh.onmouseleave=()=>{libRefresh.style.borderColor=C.border;libRefresh.style.color=C.muted;};
      libRefresh.onclick=()=>_renderLibrary();
      const libZipBtn=mk("button",{background:"transparent",border:`1px solid ${C.border}`,borderRadius:"6px",padding:"4px 12px",fontSize:"11px",color:C.muted,cursor:"pointer",outline:"none",transition:"border-color .15s, color .15s"});
      tx(libZipBtn,"Download ZIP");
      libZipBtn.title="Download the ticked outputs as a ZIP. Use Select to tick them first.";
      libZipBtn.onmouseenter=()=>{libZipBtn.style.borderColor=C.lime;libZipBtn.style.color=C.lime;};
      libZipBtn.onmouseleave=()=>{libZipBtn.style.borderColor=C.border;libZipBtn.style.color=C.muted;};
      libZipBtn.onclick=async()=>{
        if(!_libSelMode||!_libSel.size){ showError("Tick the outputs you want, then Download ZIP."); return; }
        const items=[];
        (_libItems||[]).forEach(v=>{ if(_libSel.has(mediaKey(v))) items.push({subfolder:v.subfolder||"",filename:v.filename}); });
        try{
          const r=await fetch("/h3one/download",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"selected",items})});
          if(!r.ok){ let msg="Download failed"; try{ const d=await r.json(); msg=d.error||msg; }catch(_e){} showError(msg); return; }
          const blob=await r.blob();
          const a=mk("a",{}, {download:"h3_outputs.zip"});
          a.href=URL.createObjectURL(blob);
          document.body.appendChild(a);a.click();a.remove();
          setTimeout(()=>URL.revokeObjectURL(a.href),4000);
        }catch(e){ showError("Download failed: "+fmtErr(e)); }
      };
      const libSelBtn=mk("button",{background:"transparent",border:`1px solid ${C.border}`,borderRadius:"6px",padding:"4px 12px",fontSize:"11px",color:C.muted,cursor:"pointer",outline:"none",transition:"background .15s, color .15s, border-color .15s"});
      tx(libSelBtn,"Select");
      libSelBtn.title="Select multiple videos to delete in one go.";
      libSelBtn.onclick=()=>{
        if(_libSelMode){ _libExitSel(); _renderLibrary(); return; }
        _libSelMode=true;
        _libSel.clear();
        libSelBtn.style.background=C.lime;
        libSelBtn.style.borderColor=C.lime;
        libSelBtn.style.color="#111";
        libBulkBar.style.display="flex";
        _libBulkUpd();
        _renderLibrary();
      };
      const libClose=mk("button",{background:"transparent",border:`1px solid #e05555`,borderRadius:"6px",padding:"4px 14px",fontSize:"11px",color:"#e05555",cursor:"pointer",outline:"none"});
      tx(libClose,"Close");
      libClose.onclick=()=>{ _libExitSel(); closeOverlayFade(libraryOverlay); };
      libActs.append(libSelBtn,libZipBtn,libFavOnly,libRefresh,libClose);
      const libStats=mk("div",{fontSize:"10px",color:C.muted,flexShrink:"0",fontVariantNumeric:"tabular-nums"});
      libHdr.append(libTitle,libStats,libActs);
      const libBulkBar=mk("div",{display:"none",alignItems:"center",gap:"8px",marginBottom:"12px",flexWrap:"wrap"});
      const _libBulkBtn=(l,st)=>{
        const b=mk("button",{background:st&&st.danger?C.bg2:"transparent",border:`1px solid ${st&&st.danger?"rgba(220,80,80,.5)":C.border}`,borderRadius:"6px",padding:"4px 12px",fontSize:"11px",color:st&&st.danger?"#e05555":C.muted,cursor:"pointer",outline:"none",transition:"border-color .15s, color .15s, background .15s"});
        tx(b,l);
        b.onmouseenter=()=>{b.style.borderColor=C.lime;b.style.color=C.lime;};
        b.onmouseleave=()=>{b.style.borderColor=st&&st.danger?"rgba(220,80,80,.5)":C.border;b.style.color=st&&st.danger?"#e05555":C.muted;};
        return b;
      };
      const libSelAllBtn=_libBulkBtn("Select all");
      const libSelClrBtn=_libBulkBtn("Clear selection");
      libSelClrBtn.title="Deselect every ticked video without deleting anything.";
      const libDelSelBtn=_libBulkBtn("Delete selected",{danger:true});
      const libDelNonBtn=_libBulkBtn("Delete non-favorites");
      const libDelAllBtn=_libBulkBtn("Delete all",{danger:true});
      const libBulkMsg=mk("span",{fontSize:"10px",color:C.lime,flexShrink:"0"});
      libSelAllBtn.onclick=()=>{(_libItems||[]).forEach(v=>{ if(!_libFavOnly||v.favorite) _libSel.add(mediaKey(v)); });_libBulkUpd();_libSyncChips();};
      libSelClrBtn.onclick=()=>{_libSel.clear();_libBulkUpd();_libSyncChips();};
      libDelSelBtn.onclick=()=>_libBulkRun("selected");
      libDelNonBtn.onclick=()=>_libBulkRun("non_favorites");
      libDelAllBtn.onclick=()=>_libBulkRun("all");
      libBulkBar.append(libSelAllBtn,libSelClrBtn,libDelSelBtn,libDelNonBtn,libDelAllBtn,libBulkMsg);
      const libGrid=mk("div",{flex:"1",minHeight:"0",overflowY:"auto",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:"8px",alignContent:"start",scrollbarWidth:"thin",scrollbarColor:`${C.border} transparent`});
      libGrid.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});
      libraryOverlay.append(libHdr,libBulkBar,libGrid);
      const libLightbox=mk("div",{position:"absolute",inset:"0",background:"rgba(0,0,0,.96)",display:"none",flexDirection:"column",padding:"14px",boxSizing:"border-box",zIndex:"55"});
      const lbHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"});
      const lbName=mk("div",{fontSize:"11px",color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:"1",minWidth:"0"});
      tx(lbName,"");
      const lbActs=mk("div",{display:"flex",gap:"6px",flexShrink:"0"});
      const lbFav=mk("button",{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"6px",padding:"4px 10px",fontSize:"10px",fontWeight:"700",color:C.muted,cursor:"pointer",outline:"none"});
      tx(lbFav,"Favorite");
      const lbOpen=mk("button",{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"6px",padding:"4px 10px",fontSize:"10px",fontWeight:"700",color:C.muted,cursor:"pointer",outline:"none"});
      tx(lbOpen,"Open folder");
      lbOpen.onclick=()=>{
        if(_libCur)fetch("/h3one/open_folder",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:_libCur.filename,subfolder:_libCur.subfolder||""})}).catch(()=>{});
      };
      const lbDel=mk("button",{background:"transparent",border:`1px solid rgba(220,80,80,.4)`,borderRadius:"6px",padding:"4px 10px",fontSize:"10px",fontWeight:"700",color:"rgba(220,80,80,.8)",cursor:"pointer",outline:"none"});
      tx(lbDel,"Delete");
      const lbClose=mk("button",{background:"transparent",border:`1px solid ${C.borderH}`,borderRadius:"6px",padding:"4px 12px",fontSize:"10px",fontWeight:"700",color:C.muted,cursor:"pointer",outline:"none"});
      tx(lbClose,"Back");
      lbClose.onclick=()=>{lbVideo.pause();lbVideo.src="";lbImg.src="";libLightbox.style.display="none";_renderLibrary();};
      const lbSeedWrap=mk("div",{display:"flex",alignItems:"center",gap:"6px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"6px",padding:"2px 8px"});
      const lbSeedLbl=mk("span",{fontSize:"9px",color:C.muted});tx(lbSeedLbl,"seed -");
      const lbSeedVal=mk("span",{fontSize:"9px",color:C.text,fontWeight:"600"});tx(lbSeedVal,"?");
      const lbSeedCopy=mk("button",{background:"transparent",border:"none",fontSize:"9px",fontWeight:"700",color:C.lime,cursor:"pointer",outline:"none",padding:"0"});
      tx(lbSeedCopy,"copy");
      lbSeedCopy.onclick=async()=>{
        const ok=await h3Copy(lbSeedVal.textContent);
        tx(lbSeedCopy,ok?"copied":"failed");
        setTimeout(()=>tx(lbSeedCopy,"copy"),1300);
      };
      lbSeedWrap.append(lbSeedLbl,lbSeedVal,lbSeedCopy);
      const lbModeWrap=mk("div",{display:"flex",alignItems:"center",gap:"6px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"6px",padding:"2px 8px"});
      const lbModeLbl=mk("span",{fontSize:"9px",color:C.muted});tx(lbModeLbl,"mode ·");
      const lbModeVal=mk("span",{fontSize:"9px",color:C.text,fontWeight:"600"});tx(lbModeVal,"?");
      lbModeWrap.append(lbModeLbl,lbModeVal);
      const lbTimeWrap=mk("div",{display:"flex",alignItems:"center",gap:"6px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"6px",padding:"2px 8px"});
      const lbTimeIco=mk("span",{fontSize:"9px",opacity:".7"});tx(lbTimeIco,"⏱");
      const lbTimeLbl=mk("span",{fontSize:"9px",color:C.muted});tx(lbTimeLbl,"time ·");
      const lbTimeVal=mk("span",{fontSize:"9px",color:C.text,fontWeight:"600"});tx(lbTimeVal,"?");
      lbTimeWrap.append(lbTimeIco,lbTimeLbl,lbTimeVal);
      const lbUseDD=DD(["Use in...","R2V reference video","Extend source video"],"Use in...",v=>{
        lbUseDD.set("Use in...");
        if(v==="Use in...") return;
        _libUseIn(v);
      });
      const lbUseWrap=mk("div",{width:"150px",flexShrink:"0"});
      lbUseWrap.appendChild(lbUseDD.el);
      lbActs.append(lbSeedWrap,lbModeWrap,lbTimeWrap,lbUseWrap,lbFav,lbOpen,lbDel,lbClose);
      lbHdr.append(lbName,lbActs);
      const lbPromptWrap=mk("div",{display:"flex",flexDirection:"column",gap:"4px",marginBottom:"10px",flexShrink:"0"});
      const lbPromptHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between"});
      const lbPromptTitle=mk("div",{fontSize:"9px",fontWeight:"700",letterSpacing:".08em",textTransform:"uppercase",color:C.muted});tx(lbPromptTitle,"Prompt used");
      const lbPromptReuse=mk("button",{background:C.lime,color:"#111",border:"none",borderRadius:"5px",padding:"3px 10px",fontSize:"9px",fontWeight:"700",cursor:"pointer",outline:"none",display:"none"});
      tx(lbPromptReuse,"Load into prompt box");
      lbPromptReuse.onclick=()=>{
        if(!lbPromptBox.textContent)return;
        _setPrompt(lbPromptBox.textContent);
        tx(lbPromptReuse,"Loaded");
        setTimeout(()=>tx(lbPromptReuse,"Load into prompt box"),1400);
      };
      lbPromptHdr.append(lbPromptTitle,lbPromptReuse);
      const lbPromptBox=mk("div",{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"8px",color:C.text,fontSize:"11px",padding:"8px 10px",lineHeight:"1.55",userSelect:"text",wordBreak:"break-word",whiteSpace:"pre-wrap",maxHeight:"84px",overflowY:"auto",scrollbarWidth:"thin"});
      tx(lbPromptBox,"");
      lbPromptWrap.append(lbPromptHdr,lbPromptBox);
      const lbVideo=mk("video",{flex:"1",minHeight:"0",width:"100%",borderRadius:"8px",background:"#000",objectFit:"contain"},{controls:true});
      const lbImg=mk("img",{flex:"1",minHeight:"0",width:"100%",borderRadius:"8px",background:"#000",objectFit:"contain",display:"none"});
      libLightbox.append(lbHdr,lbPromptWrap,lbVideo,lbImg);
      libraryOverlay.appendChild(libLightbox);
      let _libFavOnly=false;
      let _libItems=[];
      let _libCur=null;
      let _libSelMode=false;
      let _libSel=new Set();
      let _libChips={};
      const _libSyncChips=()=>{
        Object.keys(_libChips).forEach(k=>{
          const el=_libChips[k];
          const on=_libSel.has(k);
          el.style.borderColor=on?C.lime:C.border;
          el.style.background=on?C.lime:"rgba(0,0,0,.55)";
          tx(el,on?"✓":"");
        });
      };
      const _libExitSel=()=>{
        if(!_libSelMode) return;
        _libSelMode=false;
        _libSel.clear();
        _libBulkUpd();
        libSelBtn.style.background="transparent";
        libSelBtn.style.borderColor=C.border;
        libSelBtn.style.color=C.muted;
        libBulkBar.style.display="none";
      };
      const _libBulkSay=(msg,isErr)=>{
        tx(libBulkMsg,msg);
        libBulkMsg.style.color=isErr?C.err:C.lime;
        if(!isErr) setTimeout(()=>{ if(libBulkMsg.textContent===msg) tx(libBulkMsg,""); },3000);
      };
      const _libStatsUpd=()=>{
        const all=_libItems||[];
        let vids=0, imgs=0;
        all.forEach(v=>{
          if(v.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(v.filename||"")) imgs++;
          else vids++;
        });
        const parts=[];
        if(vids) parts.push(`${vids} ${vids===1?"video":"videos"}`);
        if(imgs) parts.push(`${imgs} ${imgs===1?"image":"images"}`);
        let txt=parts.length?parts.join(" · "):"Empty";
        if(_libSelMode&&_libSel.size) txt+=` · ${_libSel.size} selected`;
        tx(libStats,txt);
      };
      const _libBulkUpd=()=>{ tx(libDelSelBtn,"Delete selected"+( _libSel.size?` (${_libSel.size})`:"")); _libStatsUpd(); };
      const _libToggleFav=async(item,starEl,nameEl)=>{
        const fav=!item.favorite;
        let ok=false;
        try{
          const r=await fetch("/h3one/favorite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:item.filename,subfolder:item.subfolder||"",type:item.type||"output",favorite:fav})});
          const d=await r.json();
          ok=!!(d&&d.ok);
        }catch(e){}
        if(!ok){ console.warn("[H3One] favorite toggle failed"); return; }
        item.favorite=fav;
        if(starEl){
          tx(starEl,fav?"★":"☆");
          starEl.title=fav?"Unfavorite":"Favorite";
          starEl.style.color=fav?C.lime:C.dim;
          starEl.style.borderColor=fav?C.lime:C.border;
        }
        if(nameEl){
          nameEl.style.color=fav?C.lime:C.muted;
          tx(nameEl,(fav?"★ ":"")+item.filename);
        }
        if(_libFavOnly&&!fav) _renderLibrary();
      };
      const _libBulkRun=async(mode)=>{
        if(mode==="selected"&&!_libSel.size) return;
        const labels={selected:`${_libSel.size} selected output${ _libSel.size>1?"s":""}`,non_favorites:"all non-favorite outputs",all:"every output in the library"};
        if(!confirm(`Delete ${labels[mode]}? This cannot be undone.`)) return;
        const body={mode};
        if(mode==="selected"){
          const items=[];
          (_libItems||[]).forEach(v=>{ if(_libSel.has(mediaKey(v))) items.push({subfolder:v.subfolder||"",filename:v.filename}); });
          body.items=items;
        }
        try{
          const r=await fetch("/h3one/delete_bulk",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
          if(!r.ok){
            let msg="Delete failed";
            try{ const d=await r.json(); msg=d.error||msg; }catch(_e){}
            throw new Error(msg);
          }
          const d=await r.json();
          if(!d.ok) throw new Error(d.error||"Delete failed");
          const failed=(d.errors&&d.errors.length)?` (${d.errors.length} failed)`:"";
          _libBulkSay(`Deleted ${d.deleted} video${d.deleted===1?"":"s"}${failed}`,d.errors&&d.errors.length>0);
          if(d.errors&&d.errors.length) console.warn("[H3One] bulk delete errors:",d.errors);
        }catch(e){ _libBulkSay(fmtErr(e),true); }
        _libSel.clear();
        _libBulkUpd();
        await _renderLibrary();
        _loadGallery();
      };
      const _libUseIn=async(target)=>{
        if(!_libCur) return;
        if(target!=="R2V reference video"&&target!=="Extend source video") return;
        try{
          const stage=await fetch("/h3one/stage_input",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:_libCur.filename,subfolder:_libCur.subfolder||""})});
          const sd=await stage.json();
          if(!sd.ok) throw new Error(sd.error||"Could not copy the video to the input folder");
          if(target==="R2V reference video"){
            if(S.refVideos.length>=3){ showError("R2V supports up to 3 reference videos. Remove one first."); return; }
            S.refVideos.push({name:sd.name,useAudio:false});
            _switchMode("r2v");
          }else if(target==="Extend source video"){
            S.extendVideo=sd.name;
            _switchMode("extend");
            exSlot._restorePreview(sd.name);
          }
          lbVideo.pause();lbVideo.src="";libLightbox.style.display="none";
          _libExitSel();
          closeOverlayFade(libraryOverlay);
        }catch(e){
          showError("Could not load video into "+target+": "+fmtErr(e));
        }
      };
      const _renderLibrary=async()=>{
        libGrid.innerHTML="";
        _libChips={};
        try{
          const r=await fetch("/h3one/gallery");
          const d=await r.json();
          _libItems=d.videos||[];
        }catch(e){ _libItems=[]; }
        const vis=_libItems.filter(v=>!_libFavOnly||v.favorite);
        if(!vis.length){
          const empty=mk("div",{fontSize:"11px",color:C.muted,padding:"20px 0",textAlign:"center",gridColumn:"1 / -1"});
          tx(empty,_libFavOnly?"No favorites yet. Favorite a video to collect it here.":"No videos yet. Generate something to see it here.");
          libGrid.appendChild(empty);
          return;
        }
        vis.forEach(item=>{
          const card=mk("div",{background:C.bg1,border:`1px solid ${C.border}`,borderRadius:"9px",overflow:"hidden",cursor:"pointer",display:"flex",flexDirection:"column",transition:"border-color .15s, background .15s"});
          card.style.position="relative";
          const url=api.apiURL(isImg?`/h3one/thumb?${thumbQuery(item,256)}`:`/view?${viewQuery(item)}`);
          const isImg=item.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(item.filename||"");
          const v=isImg
            ? mk("img",{width:"100%",height:"78px",objectFit:"cover",display:"block",background:"#000",pointerEvents:"none"},{src:url})
            : mk("video",{width:"100%",height:"78px",objectFit:"cover",display:"block",background:"#000",pointerEvents:"none"},{muted:true,preload:"metadata"});
          if(!isImg) v.src=url;
          const name=mk("div",{fontSize:"8px",color:item.favorite?C.lime:C.muted,padding:"4px 6px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"});
          tx(name,(item.favorite?"★ ":"")+item.filename);
          card.append(v,name);
          const star=mk("button",{position:"absolute",top:"4px",right:"4px",width:"18px",height:"18px",borderRadius:"5px",background:"rgba(0,0,0,.55)",border:`1px solid ${item.favorite?C.lime:C.border}`,color:item.favorite?C.lime:C.dim,fontSize:"11px",lineHeight:"1",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",zIndex:"4",padding:"0",transition:"border-color .15s, color .15s"},{type:"button",title:item.favorite?"Unfavorite":"Favorite","aria-label":item.favorite?"Unfavorite":"Favorite"});
          tx(star,item.favorite?"★":"☆");
          star.onclick=(e)=>{ e.stopPropagation(); e.preventDefault(); _libToggleFav(item,star,name); };
          card.append(star);
          if(_libSelMode){
            const sel=mediaKey(item);
            const chip=mk("div",{position:"absolute",top:"5px",left:"5px",width:"16px",height:"16px",borderRadius:"4px",border:`1px solid ${_libSel.has(sel)?C.lime:C.border}`,background:_libSel.has(sel)?C.lime:"rgba(0,0,0,.55)",color:"#111",fontSize:"11px",fontWeight:"700",display:"flex",alignItems:"center",justifyContent:"center",zIndex:"3",pointerEvents:"none"});
            tx(chip,_libSel.has(sel)?"✓":"");
            card.append(chip);
            _libChips[sel]=chip;
          }
          card.onclick=()=>{
            if(_libSelMode){
              const sel=mediaKey(item);
              if(_libSel.has(sel)) _libSel.delete(sel); else _libSel.add(sel);
              _libBulkUpd();
              _libSyncChips();
            } else {
              _libOpen(item);
            }
          };
          attachOutputContextMenu(card,item,{isVideo:!isImg,onExtend:_stageVideoForExtend});
          card.onmouseenter=()=>card.style.borderColor=C.lime;
          card.onmouseleave=()=>card.style.borderColor=C.border;
          libGrid.appendChild(card);
        });
        _libStatsUpd();
      };
      const _libOpen=async(item)=>{
        _libCur=item;
        tx(lbName,item.filename);
        tx(lbFav,item.favorite?"Unfavorite":"Favorite");
        tx(lbSeedVal,"?");
        tx(lbModeVal,"?");
        tx(lbTimeVal,"?");
        tx(lbPromptBox,"");
        lbPromptReuse.style.display="none";
        const _lbKey=mediaKey(item);
        if(_seedByFile[_lbKey]!==undefined){
          tx(lbSeedVal,String(_seedByFile[_lbKey]));
        }
        if(_genTimeByFile[_lbKey]){
          tx(lbTimeVal,fmtDur(_genTimeByFile[_lbKey]));
        }
        try{
          const r=await fetch("/h3one/history");
          const d=await r.json();
          const hit=(d.items||[]).find(it=>it.media_key&&it.media_key===_lbKey);
          if(hit){
            if(hit.seed!==undefined&&hit.seed!==null){ _seedByFile[_lbKey]=hit.seed; tx(lbSeedVal,String(hit.seed)); }
            if(hit.mode){ tx(lbModeVal,_LIB_MODE_LBL[hit.mode]||hit.mode); }
            if(hit.gen_time){ _genTimeByFile[_lbKey]=hit.gen_time; tx(lbTimeVal,fmtDur(hit.gen_time)); }
            if(hit.prompt&&hit.prompt.trim()){
              tx(lbPromptBox,hit.prompt);
              lbPromptReuse.style.display="inline-block";
            }else{
              tx(lbPromptBox,"No prompt recorded for this video.");
            }
          }else{
            tx(lbPromptBox,"No prompt recorded for this video.");
          }
        }catch(e){ tx(lbPromptBox,"No prompt recorded for this video."); }
        const isImg=item.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(item.filename||"");
        const lbUrl=api.apiURL(isImg?`/h3one/thumb?${thumbQuery(item,1600)}`:`/view?${viewQuery(item)}`);
        if(isImg){
          lbVideo.style.display="none";lbVideo.pause();lbVideo.src="";
          lbImg.style.display="block";lbImg.src=lbUrl;
        } else {
          lbImg.style.display="none";lbImg.src="";
          lbVideo.style.display="block";
          lbVideo.src=lbUrl;
          lbVideo.muted=false;
          lbVideo.play().catch(()=>{lbVideo.muted=true;lbVideo.play().catch(()=>{});});
        }
        libLightbox.style.display="flex";
      };
      lbFav.onclick=async()=>{
        if(!_libCur)return;
        await fetch("/h3one/favorite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:_libCur.filename,subfolder:_libCur.subfolder||"",type:_libCur.type||"output",favorite:!_libCur.favorite})}).catch(()=>{});
        _libCur.favorite=!_libCur.favorite;
        tx(lbFav,_libCur.favorite?"Unfavorite":"Favorite");
        _renderLibrary();
      };
      lbDel.onclick=async()=>{
        if(!_libCur)return;
        if(!confirm("Delete "+_libCur.filename+"?"))return;
        await fetch("/h3one/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:_libCur.filename,subfolder:_libCur.subfolder||""})}).catch(()=>{});
        lbVideo.pause();lbVideo.src="";libLightbox.style.display="none";
        _libCur=null;_renderLibrary();_loadGallery();
      };
      const libraryBtn=mkTopBtn('<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.5"/>',"Library",()=>{_renderLibrary();openOverlay(libraryOverlay);});

      const fsNodeBtn=mk("button",{}, {type:"button",className:"h3-topbtn",title:"Fullscreen","aria-label":"Fullscreen"});
      fsNodeBtn.innerHTML=`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
      let _inFullscreen=false,_fsNodeOverlay=null,_rootOrigParent=null,_rootOrigNextSibling=null;
      const _enterFullscreen=()=>{
        if(_inFullscreen) return;
        if(!_fsNodeOverlay){
          _fsNodeOverlay=mk("div",{position:"fixed",inset:"0",zIndex:"99990",background:"rgba(6,6,8,.97)",display:"none",flexDirection:"column",alignItems:"center",justifyContent:"center",boxSizing:"border-box",overflow:"hidden"});
          document.body.appendChild(_fsNodeOverlay);
        }
        _rootOrigParent=root.parentNode;_rootOrigNextSibling=root.nextSibling;
        root.style.width=NODE_W+"px";root.style.height=NODE_H+"px";root.style.overflow="hidden";
        root.style.borderRadius="0";root.style.position="absolute";root.style.top="0";root.style.left="0";root.style.margin="0";
        const _vw=window.innerWidth,_vh=window.innerHeight;
        const _scale=Math.min(_vw/NODE_W,_vh/NODE_H)*0.97;
        root.style.transformOrigin="top left";root.style.transform=`scale(${_scale})`;
        const _scW=Math.round(NODE_W*_scale),_scH=Math.round(NODE_H*_scale);
        const _scWrap=mk("div",{width:_scW+"px",height:_scH+"px",position:"relative",flexShrink:"0",overflow:"hidden"});
        _scWrap.appendChild(root);_fsNodeOverlay.appendChild(_scWrap);_fsNodeOverlay._scWrap=_scWrap;
        _fsNodeOverlay.style.display="flex";_fsNodeOverlay.setAttribute("tabindex","-1");_fsNodeOverlay.focus();
        fsNodeBtn.innerHTML=`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/></svg>`;
        _inFullscreen=true;
      };
      const _exitFullscreen=()=>{
        if(!_inFullscreen) return;
        if(_rootOrigParent){ if(_rootOrigNextSibling) _rootOrigParent.insertBefore(root,_rootOrigNextSibling);else _rootOrigParent.appendChild(root); }
        root.style.position="";root.style.inset="";root.style.width="100%";root.style.height="";
        root.style.borderRadius="";root.style.overflow="hidden";root.style.transform="";root.style.transformOrigin="";root.style.margin="";root.style.top="";root.style.left="";
        scrollEl.style.height=_uiH+"px";
        if(_fsNodeOverlay._scWrap) _fsNodeOverlay._scWrap.remove();
        _fsNodeOverlay._scWrap=null;_fsNodeOverlay.style.display="none";
        fsNodeBtn.innerHTML=`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
        _inFullscreen=false;
      };
      fsNodeBtn.onclick=()=>{ if(_inFullscreen) _exitFullscreen();else _enterFullscreen(); };

      topRight.append(historyBtn,libraryBtn,settingsBtn,fsNodeBtn);

      // -- PROMPT SECTION ----------------------------------------------------
      const promptWrap=mk("div",{display:"flex",flexDirection:"column",gap:"5px"});
      const promptHdr=mk("div",{display:"flex",alignItems:"center",gap:"6px",cursor:"pointer",userSelect:"none"});
      const promptCapEl=mk("div",{}, {className:"h3-ctitle",textContent:"Prompt"});
      promptHdr.appendChild(promptCapEl);
      const discoverBtn=mk("button",{background:"none",border:`1px solid ${C.border}`,cursor:"pointer",padding:"2px 8px",color:C.muted,outline:"none",borderRadius:"5px",fontSize:"9px",fontWeight:"700",transition:"color .15s,border-color .15s",flexShrink:"0"});
      tx(discoverBtn,"Discover");
      discoverBtn.onmouseenter=()=>{discoverBtn.style.color="#fff";discoverBtn.style.borderColor="#555";};
      discoverBtn.onmouseleave=()=>{discoverBtn.style.color=C.muted;discoverBtn.style.borderColor=C.border;};
      discoverBtn.onclick=(e)=>{e.stopPropagation();_renderDiscover();openOverlay(discoverOverlay);};
      promptHdr.append(discoverBtn);
      const promptChev=mk("span",{marginLeft:"auto",color:C.dim,fontSize:"10px",flexShrink:"0"});
      tx(promptChev,"▾");
      promptHdr.appendChild(promptChev);
      const promptTA=mk("textarea",{
        background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"8px",
        color:C.text,fontSize:"12px",padding:"8px 10px",
        resize:"vertical",outline:"none",fontFamily:"inherit",
        transition:"border-color .15s",lineHeight:"1.5",
        width:"100%",boxSizing:"border-box",minHeight:"70px",
        id:"h3one-prompt-textarea","data-pa-h3-prompt":"1",
      });
      promptTA.value=S.prompt;
      promptTA.onfocus=()=>promptTA.style.borderColor=C.lime;
      promptTA.onblur=()=>promptTA.style.borderColor=C.border;
      const pCharsEl=mk("div",{fontSize:"9px",color:C.dim,alignSelf:"flex-end",marginTop:"3px"});
      const _updChars=()=>{ tx(pCharsEl, `${promptTA.value.length} chars`); };
      promptTA.oninput=()=>{S.prompt=promptTA.value;persist();_updChars();};
      const _setPrompt=(t)=>{ S.prompt=t; promptTA.value=t; persist(); _updChars(); if(S.mode==="chain"&&S.chainClips.length){ S.chainClips[0].prompt=t; chainArea._render(); } };
      promptTA.addEventListener("wheel",e=>{ if(document.activeElement===promptTA) e.stopPropagation(); },{passive:true});
      promptWrap.appendChild(promptTA);
      promptWrap.appendChild(pCharsEl);
      _updChars();

      // -- DISCOVER OVERLAY --------------------------------------------------
      const discoverOverlay=mk("div",{
        position:"absolute",inset:"0",background:C.bg0,display:"none",flexDirection:"column",
        padding:"14px",boxSizing:"border-box",zIndex:"60",borderRadius:"8px",
        opacity:"0",transition:"opacity .15s ease",overflowY:"auto",
      });
      const discHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"});
      const discTitle=mk("div",{fontSize:"10px",fontWeight:"700",color:C.muted,letterSpacing:".07em",textTransform:"uppercase"});
      tx(discTitle,"Discover - prompt presets");
      const discClose=mk("button",{background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:"14px",lineHeight:"1",outline:"none"});
      tx(discClose,"x");
      discClose.onclick=()=>{discoverOverlay.style.opacity="0";setTimeout(()=>discoverOverlay.style.display="none",160);};
      discHdr.append(discTitle,discClose);
      const discBody=mk("div",{display:"flex",flexDirection:"column",gap:"8px"});
      discoverOverlay.append(discHdr,discBody);
      let _discTmpl={};
      let _discCustom={};
      let _presetEditName="";
      let _presetEditMode="";
      const _renderDiscover=async()=>{
        discBody.innerHTML="";
        try{const r=await fetch("/h3one/config");const d=await r.json();_discTmpl=d.prompt_templates||{};_discCustom=d.custom_presets||{};}catch(e){_discTmpl={};_discCustom={};}
        const t=_discTmpl[S.mode]||{presets:[]};
        const builtin=(t.presets||[]).filter(p=>!p.builtin_hidden);
        const note=mk("div",{fontSize:"9px",color:C.muted,lineHeight:"1.5",marginBottom:"2px"});
        tx(note,"Presets insert a complete structured H3 prompt. Your own plain text also works - it is wrapped with the required fields automatically when you generate, so you can type anything.");
        discBody.appendChild(note);

        // -- save new preset --
        const saveRow=mk("div",{background:C.bg1,border:`1px dashed rgba(var(--h3accent-rgb),.4)`,borderRadius:"8px",padding:"8px 10px",display:"flex",flexDirection:"column",gap:"6px"});
        const saveCapRow=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"6px"});
        const saveCap=mk("div",{fontSize:"9px",fontWeight:"700",letterSpacing:".07em",textTransform:"uppercase",color:C.muted});
        tx(saveCap,"Save a new preset (name + prompt)");
        const editTag=mk("span",{fontSize:"8px",fontWeight:"700",color:C.lime,border:`1px solid rgba(var(--h3accent-rgb),.4)`,borderRadius:"4px",padding:"1px 6px",display:"none"});
        const cancelEditBtn=mk("button",{background:"transparent",border:`1px solid ${C.borderH}`,borderRadius:"4px",padding:"1px 6px",fontSize:"8px",fontWeight:"700",color:C.muted,cursor:"pointer",outline:"none",display:"none"});
        tx(cancelEditBtn,"Cancel edit");
        cancelEditBtn.onclick=()=>{
          _presetEditName="";
          _presetEditMode="";
          nameInp.value="";
          presetTA.value=promptTA.value;
          tx(saveBtn,"Save preset");
          editTag.style.display="none";
          cancelEditBtn.style.display="none";
          saveCap.textContent="Save a new preset (name + prompt)";
        };
        saveCapRow.append(saveCap,editTag,cancelEditBtn);
        const nameInp=mk("input",{width:"100%",boxSizing:"border-box",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"6px",color:C.text,fontSize:"11px",padding:"5px 8px",outline:"none"},{type:"text",placeholder:"Preset name"});
        nameInp.onfocus=()=>nameInp.style.borderColor=C.lime;
        nameInp.onblur=()=>nameInp.style.borderColor=C.border;
        const presetTA=mk("textarea",{width:"100%",boxSizing:"border-box",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"6px",color:C.text,fontSize:"10px",padding:"6px 8px",outline:"none",resize:"vertical",fontFamily:"inherit",lineHeight:"1.5",minHeight:"64px"});
        presetTA.value=promptTA.value;
        presetTA.onfocus=()=>presetTA.style.borderColor=C.lime;
        presetTA.onblur=()=>presetTA.style.borderColor=C.border;
        const saveBtn=mk("button",{background:C.lime,color:"#111",border:"none",borderRadius:"6px",padding:"5px 10px",fontSize:"9px",fontWeight:"700",cursor:"pointer",outline:"none",alignSelf:"flex-start"});
        tx(saveBtn,"Save preset");
        const _enterEditMode=(pr)=>{
          _presetEditName=pr.name;
          _presetEditMode=pr.mode||S.mode;
          nameInp.value=pr.name;
          presetTA.value=pr.prompt;
          tx(saveBtn,"Update preset");
          tx(editTag,"Editing: "+pr.name);
          editTag.style.display="inline-block";
          cancelEditBtn.style.display="inline-block";
          saveCap.textContent="Update preset";
          nameInp.focus();
          saveRow.scrollIntoView({block:"nearest",behavior:"smooth"});
        };
        const _presetSave=async()=>{
          const name=nameInp.value.trim();
          const prompt=presetTA.value.trim();
          const saveMode=_presetEditMode||S.mode;
          if(!name){nameInp.style.borderColor=C.err;return;}
          if(!prompt){presetTA.style.borderColor=C.err;return;}
          const customs=Array.isArray(_discCustom[saveMode])?_discCustom[saveMode]:[];
          const sameName=customs.find(p=>String(p.name||"").trim().toLowerCase()===name.toLowerCase());
          if(sameName && (!_presetEditName || _presetEditName.toLowerCase()!==name.toLowerCase())){
            if(!confirm("A preset named \""+name+"\" already exists in that mode. Overwrite it?")) return;
          }
          saveBtn.disabled=true;tx(saveBtn,"Saving...");
          try{
            if(_presetEditName && _presetEditName.toLowerCase()!==name.toLowerCase()){
              await fetch("/h3one/presets",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:saveMode,name:_presetEditName})}).catch(()=>{});
            }
            const r=await fetch("/h3one/presets",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:saveMode,name,prompt,original_name:_presetEditName||undefined})});
            const d=await r.json();
            if(!d.ok) throw new Error(d.error||"save failed");
            const savedName=name;
            _presetEditName="";
            _presetEditMode="";
            _renderDiscover();
            const savedNote=mk("div",{fontSize:"9px",fontWeight:"700",color:C.lime,marginTop:"2px"});
            tx(savedNote,"Saved \""+savedName+"\" to Your presets");
            discBody.insertBefore(savedNote,discBody.firstChild);
            setTimeout(()=>savedNote.remove(),2600);
            return;
          }catch(e){
            console.warn("[H3One] preset save:",e);
            saveBtn.disabled=false;
            tx(saveBtn,"Failed - restart ComfyUI?");
            setTimeout(()=>tx(saveBtn,_presetEditName?"Update preset":"Save preset"),2600);
          }
        };
        saveBtn.onclick=_presetSave;
        nameInp.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();_presetSave();}};
        presetTA.onkeydown=e=>{if(e.key==="Enter"&&e.ctrlKey)_presetSave();};
        saveRow.append(saveCapRow,nameInp,presetTA,saveBtn);
        discBody.appendChild(saveRow);

        // -- custom presets (all modes, labeled) --
        const allCustom=[];
        const MODE_LABELS={t2v:"T2V",i2v:"I2V",r2v:"R2V",audio_drive:"Audio Drive",keyframes:"Keyframes",extend:"Extend",chain:"Chain",mask:"Mask"};
        Object.keys(_discCustom||{}).forEach(mode=>{
          (Array.isArray(_discCustom[mode])?_discCustom[mode]:[]).forEach(pr=>{
            allCustom.push({name:pr.name,prompt:pr.prompt,mode});
          });
        });
        if(allCustom.length){
          const capC=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em",marginTop:"4px"});
          tx(capC,"Your presets (all modes)");
          discBody.appendChild(capC);
          allCustom.forEach(pr=>{
            const row=mk("div",{background:C.bg1,border:`1px solid rgba(var(--h3accent-rgb),.3)`,borderRadius:"8px",padding:"8px 10px",display:"flex",alignItems:"center",gap:"8px"});
            const badge=mk("span",{fontSize:"7.5px",fontWeight:"700",letterSpacing:".05em",color:C.lime,border:`1px solid rgba(var(--h3accent-rgb),.35)`,borderRadius:"4px",padding:"1px 5px",flexShrink:"0",textTransform:"uppercase"});
            tx(badge,MODE_LABELS[pr.mode]||pr.mode);
            const name=mk("div",{flex:"1",minWidth:"0",fontSize:"11px",color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"});
            tx(name,pr.name);
            const use=mk("button",{background:C.lime,color:"#111",border:"none",borderRadius:"6px",padding:"4px 10px",fontSize:"9px",fontWeight:"700",cursor:"pointer",outline:"none"});
            tx(use,"Use");
            use.onclick=()=>{ _setPrompt(pr.prompt); discClose.onclick(); };
            const edit=mk("button",{background:"transparent",border:`1px solid ${C.borderH}`,borderRadius:"6px",padding:"4px 10px",fontSize:"9px",fontWeight:"700",color:C.muted,cursor:"pointer",outline:"none"});
            tx(edit,"Edit");
            edit.onclick=()=>{
              _enterEditMode({name:pr.name,prompt:pr.prompt,mode:pr.mode});
              if(pr.mode!==S.mode){
                tx(editTag,"Editing: "+pr.name+" ["+(MODE_LABELS[pr.mode]||pr.mode)+"]");
              }
            };
            const del=mk("button",{background:"transparent",border:`1px solid rgba(220,80,80,.4)`,borderRadius:"6px",padding:"4px 10px",fontSize:"9px",fontWeight:"700",color:"rgba(220,80,80,.8)",cursor:"pointer",outline:"none"});
            tx(del,"x");
            del.onclick=async()=>{
              if(!confirm("Delete preset \""+pr.name+"\" ("+(MODE_LABELS[pr.mode]||pr.mode)+")?"))return;
              try{
                await fetch("/h3one/presets",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:pr.mode,name:pr.name})});
              }catch(e){console.warn("[H3One] preset delete:",e);}
              _renderDiscover();
            };
            row.append(badge,name,use,edit,del);
            discBody.appendChild(row);
          });
        }

        // -- built-in presets --
        const capB=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em",marginTop:"4px"});
        tx(capB,"Built-in presets");
        discBody.appendChild(capB);
        builtin.forEach(pr=>{
          const row=mk("div",{background:C.bg1,border:`1px solid ${C.border}`,borderRadius:"8px",padding:"8px 10px",display:"flex",alignItems:"center",gap:"8px"});
          const name=mk("div",{flex:"1",minWidth:"0",fontSize:"11px",color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"});
          tx(name,pr.name);
          const use=mk("button",{background:C.lime,color:"#111",border:"none",borderRadius:"6px",padding:"4px 10px",fontSize:"9px",fontWeight:"700",cursor:"pointer",outline:"none"});
          tx(use,"Use");
          use.onclick=()=>{ _setPrompt(pr.prompt); discClose.onclick(); };
          const cpy=mk("button",{background:"transparent",border:`1px solid ${C.borderH}`,borderRadius:"6px",padding:"4px 10px",fontSize:"9px",fontWeight:"700",color:C.muted,cursor:"pointer",outline:"none"});
          tx(cpy,"Copy");
          cpy.onclick=async()=>{ const ok=await h3Copy(pr.prompt); tx(cpy,ok?"Copied":"Failed"); setTimeout(()=>tx(cpy,"Copy"),1500); };
          row.append(name,use,cpy);
          discBody.appendChild(row);
        });
      };

      // -- MODE-SPECIFIC SECTIONS --------------------------------------------
      const modeHdr=mk("div",{display:"flex",alignItems:"center",gap:"8px",cursor:"pointer",userSelect:"none"});
      const modeTitleBlock=mk("div",{flex:"1",minWidth:"0",display:"flex",flexDirection:"column",gap:"2px"});
      const modeTitle=mk("div",{}, {className:"h3-ctitle"});
      const modeDesc=mk("div",{}, {className:"h3-cdesc"});
      modeTitleBlock.append(modeTitle,modeDesc);
      const modeChev=mk("span",{marginLeft:"auto",color:C.dim,fontSize:"10px",flexShrink:"0"});
      tx(modeChev,"▾");
      modeHdr.append(modeTitleBlock,modeChev);
      const modeArea=mk("div",{display:"flex",flexDirection:"column",gap:"8px"});

      const i2vArea=mk("div",{display:"flex",gap:"10px"});
      const kfArea=mk("div",{display:"flex",flexDirection:"column",gap:"6px"});
      const refArea=mk("div",{display:"flex",flexDirection:"column",gap:"8px"});
      const chainArea=mk("div",{display:"flex",flexDirection:"column",gap:"6px"});
      const adArea=mk("div",{display:"flex",gap:"10px"});
      const exArea=mk("div",{display:"flex",flexDirection:"column",gap:"6px"});
      const maskArea=mk("div",{display:"flex",flexDirection:"column",gap:"8px"});
      const imgArea=mk("div",{display:"flex",flexDirection:"column",gap:"8px"});

      const _clearSections=()=>{
        [i2vArea,kfArea,refArea,chainArea,adArea,exArea,maskArea,imgArea].forEach(a=>a.style.display="none");
      };

      // -- Image mode (H3 Studio still images) --------------------------------
      const IMG_ASPECTS={"1:1":1,"16:9":16/9,"9:16":9/16,"4:3":4/3,"3:4":3/4,"3:2":3/2,"2:3":2/3,"21:9":21/9};
      const IMG_PROFILES=[
        ["base_quality_20","Base Quality - 20 steps"],
        ["base_balanced_12","Base Balanced - 12 steps"],
        ["lightx_v1_fl2v_8","LightX v1.0 - FL2VA 8 steps"],
        ["lightx_v1_fl2v_4_pruned","LightX v1.0 - FL2VA 4 steps"],
        ["lightx_er_sde_4","LightX v0.1 - ER-SDE 4 steps"],
        ["lightx_sa_solver_4","LightX v0.1 - SA-Solver 4 steps"],
        ["lightx_v01_ref2v_er_sde_4_pruned","LightX v0.1 - REF2V ER-SDE 4 steps"],
        ["lightx_v01_ref2v_sa_solver_4_pruned","LightX v0.1 - REF2V SA-Solver 4 steps"],
      ];
      const IMG_PROFILE_LORAS={
        "lightx_v1_fl2v_8":"minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
        "lightx_v1_fl2v_8_pruned":"minimax_h3_fl2v_lightx2v_turbo_8step_v1.0_resized_avg_rank_24_bf16.safetensors",
        "lightx_v1_fl2v_4_pruned":"minimax_h3_fl2v_lightx2v_turbo_4step_v1.0_768p_resized_avg_rank_31_bf16.safetensors",
        "lightx_er_sde_4":"minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy_resized_avg_rank_21_bf16.safetensors",
        "lightx_sa_solver_4":"minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy_resized_avg_rank_21_bf16.safetensors",
        "lightx_v01_ref2v_er_sde_4_pruned":"minimax_h3_ref2v_lightx2v_turbo_4step_v0.1_resized_avg_rank_20_bf16.safetensors",
        "lightx_v01_ref2v_sa_solver_4_pruned":"minimax_h3_ref2v_lightx2v_turbo_4step_v0.1_resized_avg_rank_20_bf16.safetensors",
      };
      const _imgModeKey={t2i:"Text to Image",edit:"Image Edit",refmix:"Reference Mix"};
      const imgSubRow=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const imgSubCapRow=mk("div",{display:"flex",alignItems:"center",gap:"4px"});
      const imgSubCap=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em"});
      tx(imgSubCap,"Image mode");
      imgSubCapRow.append(imgSubCap,infoIcon("Text to Image: prompt only, no references.\nImage Edit: one source image is the canvas, the prompt describes the edits.\nReference Mix: up to 9 reference images, each can own identity, pose, style, composition and more. Describe them in the prompt with @Image1, @Image2..."));
      const imgSubDD=DD(["Text to Image","Image Edit","Reference Mix"],_imgModeKey[S.imgSub]||"Text to Image",v=>{
        S.imgSub=Object.keys(_imgModeKey).find(k=>_imgModeKey[k]===v)||"t2i";
        persist();_renderImgRefs();
      });
      imgSubRow.append(imgSubCapRow,imgSubDD.el);
      const imgGeomRow=mk("div",{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"});
      const _aspectItems=Object.keys(IMG_ASPECTS).map(k=>({label:`${imgAspectName(k)} (${k})`,value:k})).concat([{label:"Custom",value:"Custom"}]);
      const _aspectSel=S.imgAspect==="Custom"?"Custom":`${imgAspectName(S.imgAspect)} (${S.imgAspect})`;
      const imgAspectDD=DD(_aspectItems,_aspectSel,v=>{S.imgAspect=v;persist();_updImgCustom();});
      let _applyImgCustomMP=null;
      const imgMPNI=NI("",S.imgMP,0.2,4,0.05,v=>{ if(_applyImgCustomMP) _applyImgCustomMP(v); },"62px");
      const imgMPLbl=mk("div",{fontSize:"9px",color:C.muted,flexShrink:"0"});tx(imgMPLbl,"MP");
      const imgCustom=mk("div",{display:"none",alignItems:"center",gap:"6px",width:"100%"});
      const _alignImgDimension=v=>Math.max(32,Math.round(v/32)*32);
      const _syncImgCustomMP=()=>{
        if(S.imgAspect!=="Custom") return;
        const p=planImageCanvas({mode:"custom",width:S.imgW||1024,height:S.imgH||1024});
        S.imgW=p.width;S.imgH=p.height;
        imgMPNI.setVal(p.megapixels.toFixed(2));
      };
      const imgCW=NI("",S.imgW,32,16384,32,v=>{const p=planImageCanvas({mode:"custom",width:_alignImgDimension(v),height:S.imgH});S.imgW=p.width;S.imgH=p.height;_syncImgCustomMP();persist();},"62px");
      const imgCH=NI("",S.imgH,32,16384,32,v=>{const p=planImageCanvas({mode:"custom",width:S.imgW,height:_alignImgDimension(v)});S.imgW=p.width;S.imgH=p.height;_syncImgCustomMP();persist();},"62px");
      const imgX=mk("div",{fontSize:"10px",color:C.muted,flexShrink:"0"});tx(imgX,"x");
      imgCustom.append(imgCW,imgX,imgCH,mk("div",{fontSize:"9px",color:C.muted}, {textContent:"px (custom)"}));
      const _updImgCustom=()=>{
        const custom=S.imgAspect==="Custom";
        imgCustom.style.display=custom?"flex":"none";
        imgMPNI._inp.disabled=false;
        imgMPNI.style.opacity="";
        if(custom) _syncImgCustomMP();
        else imgMPNI.setVal(Number(S.imgMP)||1);
      };
      _applyImgCustomMP=v=>{
        const mp=clampImageMP(v);
        S.imgMP=mp;
        if(S.imgAspect==="Custom"){
          const ratio=S.imgH>0?(S.imgW||1024)/(S.imgH||1024):1;
          const p=planImageCanvasForRatio(mp,ratio);
          S.imgW=p.width;S.imgH=p.height;
          imgCW.setVal(p.width);imgCH.setVal(p.height);
          _syncImgCustomMP();
        }
        persist();
      };
      _updImgCustom();
      imgGeomRow.append(imgAspectDD.el,imgMPNI,imgMPLbl);
      imgSubRow.appendChild(imgGeomRow);
      imgSubRow.appendChild(imgCustom);
      const imgProfRow=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const imgProfCapRow=mk("div",{display:"flex",alignItems:"center",gap:"4px"});
      const imgProfCap=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em"});
      tx(imgProfCap,"Sampling profile");
      imgProfCapRow.append(imgProfCap,infoIcon("Base profiles run native H3 with no acceleration files.\nLightX profiles need the matching LoRA in your loras folder (see the H3 Studio docs) - FL2VA profiles for T2I/Edit, REF2V profiles for Reference Mix.\nCustom settings lets you pick your own steps, sampler and scheduler."));
      let _syncImgAdvRef=null;
      const _imgProfLabel=()=>{ if(S.imgProfile==="custom") return "Custom settings"; const p=IMG_PROFILES.find(x=>x[0]===S.imgProfile); return p?p[1]:"Base Quality - 20 steps"; };
      const imgProfDD=DD(IMG_PROFILES.map(p=>p[1]).concat(["Custom settings"]),_imgProfLabel(),v=>{
        if(v==="Custom settings"){ S.imgProfile="custom"; }
        else { const p=IMG_PROFILES.find(x=>x[1]===v); S.imgProfile=p?p[0]:"base_quality_20"; }
        persist();
        if(_syncImgAdvRef) _syncImgAdvRef();
      });
      imgProfRow.append(imgProfCapRow,imgProfDD.el);
      imgArea.append(imgSubRow,imgProfRow);
      const imgRefsBox=mk("div",{display:"flex",flexDirection:"column",gap:"6px"});
      imgArea.appendChild(imgRefsBox);
      let _imgRefUploadsPending=0;
      const _renderImgRefs=()=>{
        imgRefsBox.innerHTML="";
        const sub=S.imgSub;
        if(sub==="t2i") return;
        const isEdit=sub==="edit";
        const maxRefs=isEdit?1:9;
        const capLbl=isEdit?"Source image":("Reference images ("+S.imgRefs.length+"/"+maxRefs+(_imgRefUploadsPending?", uploading":"")+")");
        const capE=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em"});
        tx(capE,capLbl);
        imgRefsBox.appendChild(capE);
        const row=mk("div",{display:"grid",gridTemplateColumns:"repeat(auto-fill, 76px)",gap:"8px",alignItems:"start",justifyContent:"start"});
        if(isEdit){
          const name=S.imgEditSrc||"";
          const slot=ImgSlot(false,n=>{ if(S.imgSub!=="edit")return;if(n===null){S.imgEditSrc=null;}else{S.imgEditSrc=n;persist();}_renderImgRefs(); },(name,size)=>{
            if(name&&size){ S.imgRefsSize[name]=size; persist(); }
            if(size&&size.width>0&&size.height>0){
              const fit=fitResolutionToAspect(size.width,size.height,1344,768);
              S.imgAspect="Custom"; S.imgW=fit.width; S.imgH=fit.height;
              _updImgCustom();
              persist();
            }
          },true);
          const card=mk("div",{display:"flex",flexDirection:"column",gap:"3px",alignItems:"center"});
          card.appendChild(slot.el);
          row.appendChild(card);
          if(name) slot._restorePreview(name);
        } else {
          S.imgRefs.slice(0,maxRefs).forEach((name,idx)=>{
            const slot=ImgSlot(false,n=>{const current=S.imgRefs.indexOf(name);if(current<0)return;if(n===null)S.imgRefs.splice(current,1);else S.imgRefs[current]=n;persist();_renderImgRefs();},(name,size)=>{
              if(name&&size){ S.imgRefsSize[name]=size; persist(); }
            },true);
            const card=mk("div",{display:"flex",flexDirection:"column",gap:"3px",alignItems:"center"});
            const num=mk("div",{fontSize:"8px",fontWeight:"700",color:C.muted});
            tx(num,`@Image${idx+1}`);
            card.appendChild(num);
            card.appendChild(slot.el);
            row.appendChild(card);
            if(name) slot._restorePreview(name);
          });
        }
        if(sub==="refmix"&&!_imgRefUploadsPending&&S.imgRefs.length<9){
          const addImg=mk("div",{width:"72px",height:"72px",borderRadius:"12px",border:"1.5px dashed rgba(90,168,255,.4)",background:"rgba(90,168,255,.05)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"rgba(90,168,255,.8)",fontSize:"18px",fontWeight:"700",flexShrink:"0"});
          tx(addImg,"+");
          const upImg=mk("input",{display:"none"},{type:"file",accept:IMAGE_FILE_EXTS.join(",")});
          row.append(addImg,upImg);
          addImg.onclick=()=>{
            if(_imgRefUploadsPending||S.imgRefs.length>=9) return;
            upImg.value="";
            upImg.onchange=async()=>{
              const file=upImg.files[0];
              if(!file||!_fileMatches(file,IMAGE_FILE_EXTS)||_imgRefUploadsPending||S.imgRefs.length>=9) return;
              _imgRefUploadsPending++;_renderImgRefs();
              try{
                const _nm=await _uploadImage(file);
                if(S.imgRefs.length<9){S.imgRefs.push(_nm);const _sz=await _captureFileSize(file);if(_sz)S.imgRefsSize[_nm]=_sz;persist();}
              }catch(e){
                console.warn(e);
                if(_h3ShowError)_h3ShowError("Image upload failed: "+fmtErr(e));
              }
              finally{_imgRefUploadsPending--;upImg.value="";_renderImgRefs();}
            };
            upImg.click();
          };
        }
        imgRefsBox.appendChild(row);
        if(sub==="refmix"){
          const hint=mk("div",{fontSize:"8px",color:C.muted,lineHeight:"1.5"});
          tx(hint,"Each image can own a part of the result - identity, pose, outfit, style, composition, lighting. Describe them in the prompt as @Image1, @Image2...");
          imgRefsBox.appendChild(hint);
        } else {
          const hint=mk("div",{fontSize:"8px",color:C.muted,lineHeight:"1.5"});
          tx(hint,"The source image is the canvas - the output size follows the source image automatically. The prompt describes what changes.");
          imgRefsBox.appendChild(hint);
        }
      };
      imgArea._render=_renderImgRefs;

      const _mkSlotCard=(labelTxt,slot)=>{
        const card=mk("div",{display:"flex",flexDirection:"column",gap:"3px",alignItems:"center"});
        const lbl=mk("div",{fontSize:"8px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em",textAlign:"center"});
        tx(lbl,labelTxt);
        card.append(slot,lbl);
        return card;
      };

      // I2V slots
      const firstSlot=ImgSlot(true,n=>{S.firstFrame=n;persist();},(name,size)=>_rememberFrameInfo("firstFrameOrientation","firstFrameSize",size));
      const lastSlot=ImgSlot(true,n=>{S.lastFrame=n;persist();},(name,size)=>_rememberFrameInfo("lastFrameOrientation","lastFrameSize",size));
      const _i2vCard=(labelTxt,slot)=>{
        const card=_mkSlotCard(labelTxt,slot);
        card.appendChild(_mkFitChip(labelTxt==="First frame"?"first":"last",labelTxt));
        return card;
      };
      i2vArea.append(_i2vCard("First frame",firstSlot.el),_i2vCard("Last frame",lastSlot.el));
      if(S.firstFrame) firstSlot._restorePreview(S.firstFrame);
      if(S.lastFrame) lastSlot._restorePreview(S.lastFrame);

      // R2V refs
      let _refImageUploadsPending=0;
      let _refVideoUploadsPending=0;
      let _refAudioUploadsPending=0;
      const _renderRefs=()=>{
        refArea.innerHTML="";
        const imgCap=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em"});
        tx(imgCap,`Reference images (${S.refImages.length}/9${_refImageUploadsPending?", uploading":""})`);
        refArea.appendChild(imgCap);
        const imgRow=mk("div",{display:"flex",gap:"8px",flexWrap:"wrap"});
        S.refImages.forEach((name,idx)=>{
          const slot=ImgSlot(false,n=>{const current=S.refImages.indexOf(name);if(current<0)return;if(n===null)S.refImages.splice(current,1);else S.refImages[current]=n;persist();_renderRefs();},(nm,size)=>{if(nm&&size){S.refImageSizes[nm]=size;persist();}});
          const card=mk("div",{display:"flex",flexDirection:"column",gap:"3px",alignItems:"center"});
          card.appendChild(slot.el);
          card.appendChild(_mkFitChip(`ref:${idx}`,`Reference ${idx+1}`));
          imgRow.appendChild(card);
          if(name) slot._restorePreview(name);
        });
        const addImg=mk("div",{width:"72px",height:"72px",borderRadius:"12px",border:`1.5px dashed rgba(90,168,255,.4)`,background:"rgba(90,168,255,.05)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"rgba(90,168,255,.8)",fontSize:"18px",fontWeight:"700",flexShrink:"0"});
        tx(addImg,"+");
        const upImg=mk("input",{display:"none"},{type:"file",accept:IMAGE_FILE_EXTS.join(",")});
        if(_refImageUploadsPending||S.refImages.length>=9) addImg.style.display="none";
        imgRow.append(addImg,upImg);
        refArea.appendChild(imgRow);
        const imgHint=mk("div",{fontSize:"8px",color:C.muted,lineHeight:"1.5",marginTop:"2px"});
        tx(imgHint,"The video starts from the first image. The other images guide the subject's identity and style, they do not appear as scenes in the video.");
        refArea.appendChild(imgHint);
        addImg.onclick=async()=>{
          if(_refImageUploadsPending||S.refImages.length>=9) return;
          upImg.value="";
          upImg.onchange=async()=>{
            const file=upImg.files[0];
            if(!file||!_fileMatches(file,IMAGE_FILE_EXTS)||_refImageUploadsPending||S.refImages.length>=9) return;
            _refImageUploadsPending++;
            _renderRefs();
            try{
              const _nm=await _uploadImage(file);
              if(S.refImages.length<9){
                S.refImages.push(_nm);
                const _sz=await _captureFileSize(file);
                if(_sz) S.refImageSizes[_nm]=_sz;
                persist();
              }
            }catch(e){
              console.warn(e);
              if(_h3ShowError)_h3ShowError("Image upload failed: "+fmtErr(e));
            }finally{
              _refImageUploadsPending--;
            }
            upImg.value="";
            if(S.mode==="mask") _renderMask({refreshPreview:false}); else _renderRefs();
          };
          upImg.click();
        };
        // simple remove: click slot preview removes? keep manual via re-render not needed; images removable via "clear" button row
        const isAudioDrive=S.mode==="audio_drive";
        if(isAudioDrive){
          const note=mk("div",{fontSize:"8px",color:C.muted,lineHeight:"1.5",marginTop:"2px"});
          tx(note,"The audio track drives the mouth movements. Add a reference image of the speaker for identity.");
          refArea.appendChild(note);
          return;
        }
        const vidCap=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em",marginTop:"4px"});
        tx(vidCap,`Reference videos (${S.refVideos.length}/3${_refVideoUploadsPending?", uploading":""})`);
        refArea.appendChild(vidCap);
        const vidRow=mk("div",{display:"flex",gap:"8px",flexWrap:"wrap"});
        S.refVideos.forEach((entry,idx)=>{
          const name=(typeof entry==="string")?entry:entry.name;
          const useAudio=!!(entry&&entry.useAudio);
          const card=mk("div",{display:"flex",flexDirection:"column",gap:"3px",alignItems:"center"});
          const slot=MediaSlot("video",n=>{
            const current=S.refVideos.findIndex(v=>((typeof v==="string")?v:v&&v.name)===name);
            if(current<0)return;
            if(n===null)S.refVideos.splice(current,1);
            else S.refVideos[current]={name:n,useAudio:!!(S.refVideos[current]&&S.refVideos[current].useAudio)};
            persist();
            _renderRefs();
          },(nm,size)=>{
            if(nm&&size){
              const e=S.refVideos.find(v=>v&&v.name===nm);
              if(e&&e.name===nm){ e.width=size.width; e.height=size.height; persist(); }
            }
          });
          card.appendChild(slot);
          if(name) slot._restorePreview(name);
          if(!isAudioDrive){
            const tgl=mk("div",{display:"flex",alignItems:"center",gap:"4px",cursor:"pointer",padding:"2px 4px",borderRadius:"5px",border:`1px solid ${useAudio?C.lime:C.border}`,background:useAudio?"rgba(var(--h3accent-rgb),.10)":"transparent",transition:"border-color .15s, background .15s"});
            const box=mk("div",{width:"10px",height:"10px",borderRadius:"3px",border:`1px solid ${C.borderH}`,background:useAudio?C.lime:C.bg2,transition:"background .15s",flexShrink:"0"});
            const tglLbl=mk("div",{fontSize:"7px",color:useAudio?C.lime:C.muted,fontWeight:"700",letterSpacing:".02em",whiteSpace:"nowrap"});
            tx(tglLbl,"Use audio");
            tgl.append(box,tglLbl);
            tgl.title="Include this video's own soundtrack as an audio reference (<Audio N>). While on, the standalone audio slots are disabled so audio labels stay unambiguous.";
            tgl.onclick=(e)=>{
              e.stopPropagation();
              const current=S.refVideos.findIndex(v=>((typeof v==="string")?v:v&&v.name)===name);
              if(current<0)return;
              const on=!(S.refVideos[current]&&S.refVideos[current].useAudio);
              if(on&&_refAudioUploadsPending){if(_h3ShowError)_h3ShowError("Wait for the reference audio upload to finish before enabling video audio.");return;}
              S.refVideos[current]={name:(S.refVideos[current]&&S.refVideos[current].name)||name,useAudio:on};
              if(on){ S.refAudios=[]; persist(); }
              _renderRefs();
            };
            card.appendChild(tgl);
          }
          card.appendChild(_mkFitChip(`video:${idx}`,`Video ${idx+1}`));
          vidRow.appendChild(card);
        });
        const anyVideoAudio=S.refVideos.some(v=>v&&v.useAudio);
        const addVid=mk("div",{width:"72px",height:"72px",borderRadius:"12px",border:`1.5px dashed rgba(95,208,140,.4)`,background:"rgba(95,208,140,.05)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"rgba(95,208,140,.8)",fontSize:"18px",fontWeight:"700",flexShrink:"0"});
        tx(addVid,"+");
        if(_refVideoUploadsPending||S.refVideos.length>=3) addVid.style.display="none";
        addVid.onclick=async()=>{
          if(_refVideoUploadsPending||S.refVideos.length>=3) return;
          const fi=mk("input",{display:"none"},{type:"file",accept:VIDEO_FILE_EXTS.join(",")});
          document.body.appendChild(fi);
          fi.onchange=async()=>{
            const file=fi.files[0];
            if(!file||!_fileMatches(file,VIDEO_FILE_EXTS)||_refVideoUploadsPending||S.refVideos.length>=3){fi.remove();return;}
            _refVideoUploadsPending++;_renderRefs();
            try{
              const name=await _uploadMedia(file);
              if(S.refVideos.length<3){S.refVideos.push({name,useAudio:false});persist();}
            }catch(e){console.warn(e);if(_h3ShowError)_h3ShowError("Video upload failed: "+fmtErr(e));}
            finally{_refVideoUploadsPending--;fi.remove();_renderRefs();}
          };
          fi.click();
        };
        vidRow.append(addVid);
        refArea.appendChild(vidRow);
        if(!isAudioDrive){
        const audCap=mk("div",{fontSize:"9px",fontWeight:"700",color:anyVideoAudio?C.dim:C.muted,textTransform:"uppercase",letterSpacing:".07em",marginTop:"4px"});
        tx(audCap,anyVideoAudio?"Reference audio (using video audio)":`Reference audio (${S.refAudios.length}/3${_refAudioUploadsPending?", uploading":""})`);
        refArea.appendChild(audCap);
        if(anyVideoAudio){
          const note=mk("div",{fontSize:"8px",color:C.dim,lineHeight:"1.5"});
          tx(note,"Disabled: <Audio N> now refers to the reference video's own soundtrack. Turn off \"Use audio\" on the video to add your own audio track.");
          refArea.appendChild(note);
        } else {
          const audRow=mk("div",{display:"flex",gap:"8px",flexWrap:"wrap"});
          S.refAudios.forEach((name,idx)=>{
            const slot=MediaSlot("audio",n=>{const current=S.refAudios.indexOf(name);if(current<0)return;if(n===null)S.refAudios.splice(current,1);else S.refAudios[current]=n;persist();_renderRefs();});
            audRow.appendChild(slot);
            if(name) slot._restorePreview(name);
          });
          const addAud=mk("div",{width:"72px",height:"72px",borderRadius:"12px",border:`1.5px dashed rgba(192,127,255,.4)`,background:"rgba(192,127,255,.05)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"rgba(192,127,255,.8)",fontSize:"18px",fontWeight:"700",flexShrink:"0"});
          tx(addAud,"+");
          if(_refAudioUploadsPending||S.refAudios.length>=3) addAud.style.display="none";
          addAud.onclick=async()=>{
            if(_refAudioUploadsPending||S.refAudios.length>=3) return;
            const fi=mk("input",{display:"none"},{type:"file",accept:AUDIO_FILE_EXTS.join(",")});
            document.body.appendChild(fi);
            fi.onchange=async()=>{
              const file=fi.files[0];
              if(!file||!_fileMatches(file,AUDIO_FILE_EXTS)||_refAudioUploadsPending||S.refAudios.length>=3){fi.remove();return;}
              _refAudioUploadsPending++;_renderRefs();
              try{
                const name=await _uploadMedia(file);
                if(S.refAudios.length<3){S.refAudios.push(name);persist();}
              }catch(e){console.warn(e);if(_h3ShowError)_h3ShowError("Audio upload failed: "+fmtErr(e));}
              finally{_refAudioUploadsPending--;fi.remove();_renderRefs();}
            };
            fi.click();
          };
          audRow.append(addAud);
          refArea.appendChild(audRow);
        }
        }
      };
      refArea._render=_renderRefs;

      // Keyframes
      const _renderKf=()=>{
        kfArea.innerHTML="";
        const hdr=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em"});
        tx(hdr,`Keyframes (${S.kf.length})`);
        kfArea.appendChild(hdr);
        S.kf.forEach((k,idx)=>{
          const row=mk("div",{display:"flex",alignItems:"center",gap:"8px"});
          const slot=ImgSlot(false,n=>{k.img=n;persist();},(name,size)=>{ if(name&&size){ k.width=size.width; k.height=size.height; persist(); } else if(name===null){ k.width=null; k.height=null; persist(); } });
          row.appendChild(slot.el);
          if(k.img) slot._restorePreview(k.img);
          const posCap=mk("div",{fontSize:"9px",color:C.muted});tx(posCap,"Frame");
          const posNI=NI("",k.pos,1,9999,1,v=>{k.pos=Math.round(v);persist();},"64px");
          posNI._inp.value=String(k.pos);
          const rm=mk("button",{}, {type:"button",className:"h3-rmbtn",title:"Remove this keyframe","aria-label":"Remove this keyframe"});
          tx(rm,"x");
          if(!k.img) rm.style.display="none";
          rm.onclick=()=>{ if(S.kf.length>1){ S.kf.splice(idx,1); persist(); _renderKf(); } };
          row.append(posCap,posNI,rm);
          row.appendChild(_mkFitChip(`kf:${idx}`,`Keyframe ${k.pos}`));
          kfArea.appendChild(row);
        });
        const addRow=mk("div",{display:"flex",gap:"6px"});
        const addKf=mk("button",{background:"transparent",border:`1px dashed rgba(var(--h3accent-rgb),.4)`,borderRadius:"6px",padding:"4px 12px",fontSize:"9px",fontWeight:"700",color:"rgba(var(--h3accent-rgb),.7)",cursor:"pointer",outline:"none"});
        tx(addKf,"+ Add keyframe (max 32)");
        addKf.onclick=()=>{ if(S.kf.length<32){ S.kf.push({img:null,pos:Math.min(9999, (S.kf.length+1)*62)}); persist(); _renderKf(); } };
        addRow.appendChild(addKf);
        kfArea.appendChild(addRow);
      };
      kfArea._render=_renderKf;

      // Audio drive slot
      const adSlot=MediaSlot("audio",n=>{S.audioFile=n;persist();});
      adArea.append(_mkSlotCard("Audio track",adSlot));
      if(S.audioFile) adSlot._restorePreview(S.audioFile);

      // Extend video slot
      const exSlot=MediaSlot("video",n=>{S.extendVideo=n;persist();},(name,size)=>_rememberFrameInfo(null,"extendVideoSize",size));
      const exCardRow=mk("div",{display:"flex",alignItems:"flex-start"});
      const exCard=_mkSlotCard("Video to extend",exSlot);
      exCard.appendChild(_mkFitChip("src","Source video"));
      exCardRow.appendChild(exCard);
      const exOptsRow=mk("div",{display:"flex",alignItems:"center",gap:"8px",background:C.bg1,border:`1px solid ${C.border}`,borderRadius:"8px",padding:"6px 8px"});
      const exOptsCapRow=mk("div",{display:"flex",alignItems:"center",gap:"4px",flexShrink:"0"});
      const exOptsCap=mk("div",{fontSize:"9px",color:C.text});tx(exOptsCap,"Auto stage result");
      const exOptsHint=mk("div",{fontSize:"8px",color:C.muted,marginLeft:"auto",flexShrink:"0"});
      tx(exOptsHint,"Off keeps the same source every time");
      const exToggle=MiniToggle(S.autoStage!==false,v=>{S.autoStage=v;persist();},"Send the finished extend back into the source slot so you can chain another extension. Turn off to always extend the same source video.");
      exOptsCapRow.append(exOptsCap,infoIcon("On: the finished extend is put back into the Video to extend slot, so the next Generate keeps growing the clip.\nOff: the source stays as it is, so every run adds the same amount to the same starting video. Off keeps the length predictable."));
      exOptsRow.append(exOptsCapRow,exOptsHint,exToggle.el);
      exArea.append(exCardRow);
      exArea.append(exOptsRow);
      if(S.extendVideo) exSlot._restorePreview(S.extendVideo);

      // Masked video inpainting
      const maskSrcSlot=MediaSlot("video",n=>{
        S.maskSeed=null;
        S.maskStartTime=0;
        S.maskVideo=n;
        if(!n) S.maskVideoSize=null;
        persist();
        if(_renderMask) _renderMask();
      },(name,size)=>{
        if(name===S.maskVideo) _rememberFrameInfo(null,"maskVideoSize",size);
      });
      const maskTop=mk("div",{display:"flex",alignItems:"flex-start",gap:"10px"});
      const maskSrcCard=_mkSlotCard("Source video",maskSrcSlot);
      maskSrcCard.appendChild(_mkFitChip("masksrc","Source video"));
      const maskActions=mk("div",{display:"flex",flexDirection:"column",gap:"6px",minWidth:"170px",paddingTop:"2px"});
      const maskPaintBtn=mk("button",{}, {type:"button",className:"h3-actbtn"});
      tx(maskPaintBtn,"Paint first-frame mask");
      const maskTrimBtn=mk("button",{}, {type:"button",className:"h3-actbtn",title:"Pick where in the source video to begin. Useful when the subject you want to replace appears later in the clip. The mask pipeline reads from this point onward; only up to the Source max (s) after it gets replaced."});
      tx(maskTrimBtn,"Trim start");
      const maskPreviewBtn=mk("button",{}, {type:"button",className:"h3-actbtn",title:"Run only the SAM 3 tracking on the current source video and show the overlay before you commit to a full generation. Best used while ComfyUI is idle; during a run the tracking overlay already appears live."});
      tx(maskPreviewBtn,"Preview tracking");
      const maskClearBtn=mk("button",{height:"28px",borderRadius:"7px",border:`1px solid ${C.border}`,background:C.bg2,color:C.muted,fontSize:"9px",fontWeight:"700",cursor:"pointer",outline:"none"},{type:"button"});
      tx(maskClearBtn,"Remove painted mask");
      maskActions.append(maskPaintBtn,maskTrimBtn,maskPreviewBtn,maskClearBtn);maskTop.append(maskSrcCard,maskActions);
      maskArea.appendChild(maskTop);
      const trimChipWrap=mk("div",{display:"flex",alignItems:"center",gap:"8px",marginTop:"0px"});
      const trimChip=mk("button",{display:"none",alignItems:"center",justifyContent:"center",textAlign:"center",height:"26px",padding:"0 12px",borderRadius:"7px",border:`1px solid ${C.lime}`,background:"rgba(88,224,111,.08)",color:C.lime,fontSize:"9px",fontWeight:"700",cursor:"pointer",outline:"none",lineHeight:"1"},{type:"button",title:"The source video starts at this point. Click to change or reset it."});
      maskArea.appendChild(trimChipWrap);trimChipWrap.appendChild(trimChip);
      const trimSlotBadge=mk("div",{position:"absolute",top:"2px",left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,.82)",border:`1px solid ${C.lime}`,color:C.lime,fontSize:"9px",fontWeight:"700",padding:"3px 8px",borderRadius:"999px",pointerEvents:"none",display:"none",whiteSpace:"nowrap",zIndex:"9",boxSizing:"border-box",lineHeight:"1.2"});
      maskSrcSlot.appendChild(trimSlotBadge);
      const fmtClock=(t)=>{const s=Math.max(0,Number(t)||0);const m=Math.floor(s/60),r=(s-m*60);return m>0?`${m}m ${r.toFixed(1)}s`:`${r.toFixed(1)}s`;};

      const maskPreviewRow=mk("div",{display:"flex",alignItems:"center",gap:"10px",background:C.bg1,border:`1px solid ${C.border}`,borderRadius:"8px",padding:"8px",boxSizing:"border-box",minHeight:"92px",cursor:"pointer"});
      const maskPreviewCol=mk("div",{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:"0",width:"150px"});
      const maskPreviewBox=mk("div",{width:"150px",height:"84px",flexShrink:"0",background:"#000",borderRadius:"6px",overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center",position:"relative"});
      const maskPaintState=mk("div",{fontSize:"8px",color:C.muted,lineHeight:"1.4",textAlign:"center",marginTop:"3px"});
      maskPreviewCol.append(maskPreviewBox,maskPaintState);
      const maskPreviewNote=mk("div",{fontSize:"9px",color:C.muted,lineHeight:"1.5"});
      const maskCropNote=mk("div",{fontSize:"9px",fontWeight:"700",lineHeight:"1.5"});
      const maskNoteCol=mk("div",{flex:"1",minWidth:"0",display:"flex",flexDirection:"column",gap:"4px"});
      maskNoteCol.append(maskPreviewNote,maskCropNote);
      maskPreviewRow.append(maskPreviewCol,maskNoteCol);
      maskPreviewRow.onclick=()=>{ if(_trackingPreviewUrl) _openTrackingLightbox(); else maskPaintBtn.onclick(); };
      maskArea.appendChild(maskPreviewRow);

      let _maskPrevToken=0;
      let _trackingPreviewUrl=null;
      let _trackingPreviewItem=null;
      const _setMaskNote=(text)=>{maskPreviewNote.style.color=C.muted;tx(maskPreviewNote,text);};
      const _setCropNote=(report)=>{
        let rtext=null;
        try{rtext=cropReportText(report||null);}catch(e){rtext=null;}
        if(rtext){
          maskCropNote.style.color=rtext.verdict==="flagged"?C.warn:(rtext.verdict==="ok"?C.lime:C.muted);
          tx(maskCropNote,rtext.label+(rtext.tip?"\n→ "+rtext.tip:""));
        }else{
          maskCropNote.textContent="";
        }
      };
      const _renderMaskPreview=async()=>{
        const token=++_maskPrevToken;
        _trackingPreviewUrl=null;
        _setCropNote(null);
        maskPreviewBox.innerHTML="";
        if(!S.maskVideo){
          _setMaskNote("Add a source video first. Once it is loaded, click here to paint the region to replace.");
          const ph=mk("div",{fontSize:"9px",color:C.muted,padding:"4px",textAlign:"center",lineHeight:"1.4"});tx(ph,"No source video");
          maskPreviewBox.appendChild(ph);
          return;
        }
        if(!S.maskSeed){
          _setMaskNote("No painted mask yet. Click here to paint the full region to replace, or enter a Mask target below and let SAM 3 detect it.");
          const ph=mk("div",{fontSize:"9px",color:C.muted,padding:"4px",textAlign:"center",lineHeight:"1.4"});tx(ph,"No mask\npainted");
          maskPreviewBox.appendChild(ph);
          return;
        }
        const spin=mk("div",{fontSize:"9px",color:C.muted,padding:"4px",textAlign:"center"});tx(spin,"Loading preview...");
        maskPreviewBox.appendChild(spin);
        _setMaskNote("Mask ready. Click the preview to adjust the painted region, then Generate.");
        const BOX_W=150,BOX_H=84;
        const canvas=mk("canvas",{display:"block"});
        const ctx=canvas.getContext("2d");
        const videoUrl=api.apiURL(`/view?filename=${encodeURIComponent(S.maskVideo)}&type=input&subfolder=&t=${Date.now()}`);
        const maskUrl=api.apiURL(`/view?filename=${encodeURIComponent(S.maskSeed)}&type=input&subfolder=&t=${Date.now()}`);
        await new Promise(resolve=>{
          const v=document.createElement("video");
          v.muted=true;v.playsInline=true;v.preload="auto";
          let finished=false;
          const finish=(good)=>{if(finished)return;finished=true;clearTimeout(timer);v.removeAttribute("src");resolve(good);};
          const timer=setTimeout(()=>finish(false),5000);
          v.onloadeddata=()=>{
            const vw=v.videoWidth||640,vh=v.videoHeight||360;
            const scale=Math.min(BOX_W/vw,BOX_H/vh);
            canvas.width=Math.max(1,Math.round(vw*scale));
            canvas.height=Math.max(1,Math.round(vh*scale));
            try{v.currentTime=Math.min((Number(S.maskStartTime)||0),Math.max(0,(v.duration||0)-.001));}catch(e){finish(false);}
          };
          v.onseeked=()=>{try{ctx.drawImage(v,0,0,canvas.width,canvas.height);finish(true);}catch(e){finish(false);}};
          v.onerror=()=>finish(false);
          v.src=videoUrl;
        });
        if(token!==_maskPrevToken) return;
        if(!canvas.width||!canvas.height){
          const vw=(S.maskVideoSize&&S.maskVideoSize.width)||640,vh=(S.maskVideoSize&&S.maskVideoSize.height)||360;
          const scale=Math.min(BOX_W/vw,BOX_H/vh);
          canvas.width=Math.max(1,Math.round(vw*scale));
          canvas.height=Math.max(1,Math.round(vh*scale));
          ctx.fillStyle="#111";ctx.fillRect(0,0,canvas.width,canvas.height);
        }
        await new Promise(resolve=>{
          const img=new Image();
          const timer=setTimeout(()=>resolve(false),5000);
          img.onload=()=>{
            clearTimeout(timer);
            try{
              const tmp=document.createElement("canvas");tmp.width=canvas.width;tmp.height=canvas.height;
              const tc=tmp.getContext("2d");tc.drawImage(img,0,0,tmp.width,tmp.height);
              const data=tc.getImageData(0,0,tmp.width,tmp.height);
              for(let i=0;i<data.data.length;i+=4){
                const v=Math.max(data.data[i],data.data[i+1],data.data[i+2]);
                data.data[i]=255;data.data[i+1]=72;data.data[i+2]=72;data.data[i+3]=Math.round(v*.78);
              }
              tc.putImageData(data,0,0);
              ctx.drawImage(tmp,0,0);
              resolve(true);
            }catch(e){resolve(false);}
          };
          img.onerror=()=>{clearTimeout(timer);resolve(false);};
          img.src=maskUrl;
        });
        if(token!==_maskPrevToken) return;
        maskPreviewBox.innerHTML="";
        maskPreviewBox.appendChild(canvas);
        const cap=mk("div",{position:"absolute",left:"0",right:"0",bottom:"0",background:"rgba(0,0,0,.55)",color:"#fff",fontSize:"8px",padding:"2px 6px",textAlign:"center",pointerEvents:"none"});tx(cap,"masked region"+(Number(S.maskStartTime)>0?` · starts ${fmtClock(S.maskStartTime)}`:""));
        maskPreviewBox.appendChild(cap);
      };

      let _trackingRafStop=null;
      let _trackingBaseNote="";
      let _trackingLivePid=null;
      const _drawCropOverlay=(canvas,vid,fps)=>{
        const rec=self._h3_cropCheck||null;
        const report=rec&&rec.crop?rec.crop:null;
        if(!report) return;
        const vw=vid.videoWidth||0,vh=vid.videoHeight||0;
        if(!(vw>0)||!(vh>0)) return;
        const rect=vid.getBoundingClientRect();
        const cw=Math.max(1,Math.round(rect.width||vw)),ch=Math.max(1,Math.round(rect.height||vh));
        if(canvas.width!==cw)canvas.width=cw;
        if(canvas.height!==ch)canvas.height=ch;
        const ctx=canvas.getContext("2d");
        ctx.clearRect(0,0,cw,ch);
        const idx=cropFrameIndex(vid.currentTime||0,fps,report.frames);
        const box=cropBoxAt(report.boxes,idx);
        if(!box) return;
        const sx=cw/vw,sy=ch/vh;
        const x=Math.round(box[0]*sx),y=Math.round(box[1]*sy),w=Math.max(1,Math.round(box[2]*sx)),h=Math.max(1,Math.round(box[3]*sy));
        const flagged=!!report.low_confidence||Number((report.crop_clip||{}).frames)>0||Number((report.stability||{}).jitter)>0.06;
        ctx.strokeStyle=flagged?"#ffb400":"#58e06f";
        ctx.lineWidth=Math.max(1,Math.round(Math.min(cw,ch)/220));
        ctx.strokeRect(x+.5,y+.5,Math.max(1,w-1),Math.max(1,h-1));
        const fontPx=Math.max(9,Math.round(Math.min(cw,ch)/55));
        ctx.font=`${fontPx}px ui-monospace,monospace`;
        const label=`#${idx}${Array.isArray(report.scores)&&report.scores.length?` · ${Math.round(Number(report.scores[0])*100)}%`:""}`;
        const tw=Math.ceil(ctx.measureText(label).width)+10,chipH=fontPx+8;
        const chipX=Math.max(0,x),chipY=Math.max(0,y-chipH);
        ctx.fillStyle="rgba(0,0,0,.6)";
        ctx.fillRect(chipX,chipY,tw,chipH);
        ctx.fillStyle=flagged?"#ffb400":"#58e06f";
        ctx.fillText(label,chipX+5,chipY+fontPx+2);
      };
      const _trackingRafStart=(canvas,vid,fps)=>{
        let running=false;
        const tick=()=>{ if(!running||!canvas.isConnected) return; _drawCropOverlay(canvas,vid,fps); if(vid.paused){running=false;return;} requestAnimationFrame(tick); };
        vid.addEventListener("play",()=>{ if(!running){running=true;requestAnimationFrame(tick);} });
        vid.addEventListener("seeked",()=>_drawCropOverlay(canvas,vid,fps));
        vid.addEventListener("loadeddata",()=>_drawCropOverlay(canvas,vid,fps));
        _drawCropOverlay(canvas,vid,fps);
        if(!vid.paused){running=true;requestAnimationFrame(tick);}
        return ()=>{running=false;};
      };
      const _setTrackingNote=(live,baseNote,report)=>{
        _trackingBaseNote=baseNote;
        _setMaskNote(baseNote);
        const rec=self._h3_cropCheck||null;
        _setCropNote(report||(rec&&rec.crop)||null);
      };
      self._h3_cropCheckChanged=(rec)=>{
        if(!rec||!rec.crop||typeof rec.crop!=="object") return;
        self._h3_cropCheck=rec;
        if(_trackingPreviewUrl&&_trackingBaseNote&&(!_trackingLivePid||rec.pid===_trackingLivePid)) _setCropNote(rec.crop);
      };
      const _openTrackingLightbox=()=>{
        if(!_trackingPreviewUrl) return;
        const overlay=mk("div",{position:"fixed",inset:"0",zIndex:"1000001",background:"rgba(0,0,0,.92)",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:"12px",padding:"24px",boxSizing:"border-box",cursor:"zoom-out"});
        const stage=mk("div",{position:"relative",display:"flex",alignItems:"center",justifyContent:"center",maxWidth:"94vw",maxHeight:"86vh"});
        const player=mk("video",{width:"100%",maxHeight:"82vh",background:"#000",border:`1px solid ${C.borderH}`,borderRadius:"8px",objectFit:"contain",boxShadow:"0 24px 80px rgba(0,0,0,.9)"},{muted:true,autoplay:true,loop:true,playsInline:true,controls:true,preload:"auto"});
        const canvas=mk("canvas",{position:"absolute",inset:"0",width:"100%",height:"100%",pointerEvents:"none"});
        player.src=_trackingPreviewUrl;
        stage.append(player,canvas);
        const rafStop=_trackingRafStart(canvas,player,24);
        const closeBtn=mk("button",{height:"32px",padding:"0 16px",borderRadius:"7px",border:`1px solid ${C.border}`,background:C.bg2,color:C.text,fontSize:"11px",fontWeight:"700",cursor:"pointer",outline:"none"},{type:"button"});
        tx(closeBtn,"Close");
        let rtext=null;
        const _rec=self._h3_cropCheck||null;
        try{rtext=cropReportText(_rec&&_rec.crop?_rec.crop:null);}catch(e){rtext=null;}
        const cap=mk("div",{fontSize:"10px",color:rtext&&rtext.verdict==="flagged"?C.warn:C.muted,textAlign:"center",lineHeight:"1.5"});
        tx(cap,rtext?`SAM3 tracking + crop box. ${rtext.detail}${rtext.tip?"\n→ "+rtext.tip:""}`:"SAM3 tracking preview - the numbered masks show what gets tracked");
        overlay.append(stage,closeBtn,cap);
        const onKey=(e)=>{if(e.key==="Escape")close();};
        const close=()=>{rafStop();player.pause();player.removeAttribute("src");overlay.remove();document.removeEventListener("keydown",onKey);};
        document.addEventListener("keydown",onKey);
        overlay.onclick=(e)=>{if(e.target===overlay)close();};
        closeBtn.onclick=close;
        document.body.appendChild(overlay);
      };
      const _showTrackingPreview=(item,live,pid)=>{
        if(_trackingRafStop){_trackingRafStop();_trackingRafStop=null;}
        _trackingLivePid=pid||null;
        _maskPrevToken++;
        _trackingPreviewItem=item;
        maskPreviewBox.innerHTML="";
        const report=(item&&item.crop)||null;
        if(report) self._h3_cropCheck={pid:null,crop:report};
        else if(live){
          const cur=self._h3_cropCheck||null;
          if(!cur||cur.pid!==pid) self._h3_cropCheck=null;
        }
        else self._h3_cropCheck=null;
        _trackingPreviewUrl=api.apiURL(`/view?filename=${encodeURIComponent(item.filename)}&type=${encodeURIComponent(item.type||"temp")}&subfolder=${encodeURIComponent(item.subfolder||"")}&t=${Date.now()}`);
        const wrap=mk("div",{position:"relative",width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"});
        const v=mk("video",{width:"100%",height:"100%",objectFit:"contain",display:"block",background:"#000"},{muted:true,autoplay:true,loop:true,playsInline:true,preload:"auto"});
        const canvas=mk("canvas",{position:"absolute",inset:"0",width:"100%",height:"100%",pointerEvents:"none"});
        v.src=_trackingPreviewUrl;
        const fail=()=>{
          if(v.parentNode!==wrap) return;
          maskPreviewBox.innerHTML="";
          _setCropNote(null);
          const ph=mk("div",{fontSize:"9px",color:C.err,padding:"4px",textAlign:"center",lineHeight:"1.4"});tx(ph,"Could not load the tracking preview");
          maskPreviewBox.appendChild(ph);
          _setMaskNote("The preview file could not be played. Try running Preview tracking again; if it persists, check the ComfyUI console.");
        };
        v.onerror=fail;
        wrap.append(v,canvas);
        maskPreviewBox.appendChild(wrap);
        const cap=mk("div",{position:"absolute",left:"0",right:"0",bottom:"0",background:"rgba(0,0,0,.55)",color:"#fff",fontSize:"8px",padding:"2px 6px",textAlign:"center",pointerEvents:"none"});
        tx(cap,"SAM3 tracking preview");
        maskPreviewBox.appendChild(cap);
        _trackingRafStop=_trackingRafStart(canvas,v,24);
        _setTrackingNote(live,live
          ? "SAM 3 is tracking this while the video generates. Click the preview to enlarge. If it caught the wrong thing, hit Stop to avoid wasting the run, then fix the Mask target or Detection."
          : "This is what SAM 3 tracks. Numbered colored masks mean the object was detected; click the preview to enlarge. If the wrong thing is tracked, change the Mask target or Detection and run Preview tracking again.",report);
      };
      self._h3_maskTrackingOverlay=(item,pid)=>_showTrackingPreview(item,true,pid);
      let _maskPreviewBusy=false;
      const _previewTracking=async()=>{
        if(_maskPreviewBusy) return;
        if(!S.maskVideo){if(_h3ShowError)_h3ShowError("Add a source video before previewing tracking.");return;}
        const hasText=!!String(S.maskTarget||"").trim();
        if(!S.maskSeed&&!hasText){if(_h3ShowError)_h3ShowError("Paint a first-frame mask or enter a Mask target before previewing tracking.");return;}
        if(hasText&&Number(S.maskThreshold)>=0.9){if(_h3ShowError)_h3ShowError(maskDetectionHint(S.maskTarget,S.maskThreshold));return;}
        if(!String(S.models.sam3||"").trim()){if(_h3ShowError)_h3ShowError("Pick the SAM 3.1 checkpoint under Settings before previewing tracking.");return;}
        const ownMaskBusy=(S.generating&&S.mode==="mask")||[..._queuedJobs.values()].some(q=>q.node===self&&q.mode==="mask");
        if(ownMaskBusy){
          if(_trackingPreviewItem){
            _showTrackingPreview(_trackingPreviewItem,false);
            _setMaskNote("Showing the last SAM 3 tracking preview, which is what this run is tracking. If you changed the Mask target, the painted mask or the Detection since it was made, click Preview tracking again after the run finishes to check the new settings.");
            return;
          }
          _maskPrevToken++;
          _trackingPreviewUrl=null;
          _setCropNote(null);
          maskPreviewBox.innerHTML="";
          const ph=mk("div",{fontSize:"9px",color:C.lime,padding:"4px",textAlign:"center",lineHeight:"1.5"});
          tx(ph,"Live tracking\nis already showing");
          maskPreviewBox.appendChild(ph);
          _setMaskNote("This mask run already shows the SAM 3 tracking overlay live as it goes, so a separate preview is not needed - watch the preview box. If you changed the Mask target or Detection after the run started, click Preview tracking again once it finishes to check the new settings.");
          return;
        }
        const tracking=maskTrackingPlan(S.maskSeed,S.maskTarget);
        _maskPreviewBusy=true;
        maskPreviewBtn.disabled=true;
        _maskPrevToken++;
        _trackingPreviewUrl=null;
        _setCropNote(null);
        maskPreviewBox.innerHTML="";
        const spin=mk("div",{fontSize:"9px",color:C.muted,padding:"4px",textAlign:"center",lineHeight:"1.5"});
        const spinMain=mk("div",{});tx(spinMain,"Tracking...");
        const spinSub=mk("div",{fontSize:"8px",color:C.muted,marginTop:"2px"});tx(spinSub,"SAM 3 only, no H3 generation");
        spin.append(spinMain,spinSub);
        maskPreviewBox.appendChild(spin);
        _setMaskNote("Preview tracking is running. On the first run the SAM 3 checkpoint has to load, which can take about a minute.");
        const noteToken=_maskPrevToken;
        fetch("/queue").then(r=>r.json()).then(q=>{
          if(_maskPrevToken!==noteToken) return;
          const running=(q&&Array.isArray(q.queue_running)&&q.queue_running.length)||0;
          _setMaskNote(running>0
            ? "ComfyUI is busy with another job, so the preview runs right after it finishes. The preview is cheap and jumps ahead of anything else waiting in the queue."
            : "Preview tracking is running and jumps ahead of queued jobs, so only a running generation can delay it. On the first run the SAM 3 checkpoint has to load, which can take about a minute.");
        }).catch(()=>{});
        const controller=new AbortController();
        const waitTimer=setTimeout(()=>controller.abort(),300000);
        const token=typeof crypto!=="undefined"&&crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+Date.now();
        let clock=null;
        try{
          const started=Date.now();
          const refresh=async()=>{
            if(_maskPrevToken!==noteToken) return;
            let p=null;
            try{p=await fetch(`/h3one/mask_preview_progress?token=${encodeURIComponent(token)}`).then(r=>r.json());}catch(e){p=null;}
            if(_maskPrevToken!==noteToken) return;
            const elapsed=Math.round((Date.now()-started)/1000);
            const max=Number(p&&p.max)||0;
            const value=Number(p&&p.value)||0;
            if(max>0){
              const rate=value/Math.max(.1,(Date.now()-started)/1000);
              const eta=rate>0?Math.max(0,Math.round((max-value)/rate)):0;
              tx(spinSub,`Tracking ${Math.min(value,max)}/${max} frames - about ${eta}s left`);
            }else{
              tx(spinSub,`SAM 3 only, no H3 generation - ${elapsed}s`);
            }
          };
          clock=setInterval(refresh,400);
          const r=await fetch("/h3one/mask_preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
            file:S.maskVideo,
            duration:Math.min(15,Math.max(.2,Number(S.duration)||5)),
            start_time:Math.max(0,Number(S.maskStartTime)||0),
            ckpt_name:S.models.sam3,
            text:S.maskTarget||"",
            detection_threshold:Math.max(0,Math.min(1,Number(S.maskThreshold)||0)),
            max_objects:tracking.maxObjects,
            object_indices:tracking.objectIndices,
            initial_mask:S.maskSeed||"",
            crop_scale:Math.max(1,Math.min(4,Number(S.maskCropScale)||1.5)),
            megapixels:_effectiveMaskCropMP(),
            token,
          }),signal:controller.signal});
          clearInterval(clock);
          clock=null;
          let d=null;
          try{d=await r.json();}catch(e){d=null;}
          if(!r.ok||!d||!d.ok) throw new Error((d&&d.error)||("preview failed (HTTP "+r.status+")"));
          if(d.filename) _showTrackingPreview(d,false);
          else throw new Error("SAM 3 finished but wrote no preview file.");
        }catch(e){
          if(clock) clearInterval(clock);
          const timedOut=e&&(e.name==="AbortError"||e.name==="TimeoutError");
          maskPreviewBox.innerHTML="";
          _setCropNote(null);
          const ph=mk("div",{fontSize:"9px",color:C.err,padding:"4px",textAlign:"center",lineHeight:"1.4"});
          tx(ph,timedOut?"Timed out waiting for the tracking preview. If a generation is running, it may have queued behind it; try again when the queue is idle.":"Tracking preview failed");
          maskPreviewBox.appendChild(ph);
          if(_h3ShowError)_h3ShowError("Tracking preview failed: "+fmtErr(e));
          _setMaskNote("Tracking preview failed. Adjust the Mask target or Detection and try again, or check the ComfyUI console.");
        }finally{
          if(clock) clearInterval(clock);
          clearInterval(waitTimer);
          _maskPreviewBusy=false;
          maskPreviewBtn.disabled=false;
        }
      };
      maskPreviewBtn.onclick=()=>_previewTracking();

      const maskTargetWrap=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const maskTargetCap=mk("div",{display:"flex",alignItems:"center",gap:"4px"});
      const maskTargetLbl=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em"});tx(maskTargetLbl,"Mask target");
      maskTargetCap.append(maskTargetLbl,infoIcon("Optional when you painted a mask. Describe an object such as face, jacket, car, or sign and SAM 3 will detect and track it. When you enter a target, SAM tracks that object - a painted mask is only used to seed the tracker when no target is given."));
      const maskTargetInput=mk("input",{height:"30px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"7px",color:C.text,fontSize:"11px",padding:"0 9px",outline:"none",boxSizing:"border-box",width:"100%"},{type:"text",value:S.maskTarget,placeholder:"e.g. face, red jacket, car"});
      maskTargetInput.oninput=()=>{S.maskTarget=maskTargetInput.value;persist();};
      maskTargetInput.onfocus=()=>maskTargetInput.style.borderColor=C.lime;maskTargetInput.onblur=()=>maskTargetInput.style.borderColor=C.border;
      maskTargetWrap.append(maskTargetCap,maskTargetInput);maskArea.appendChild(maskTargetWrap);

      const maskOpts=mk("div",{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px"});
      const maskField=(labelTxt,control,tip)=>{
        const w=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
        const h=mk("div",{display:"flex",alignItems:"center",gap:"4px"});
        const l=mk("div",{fontSize:"9px",color:C.muted});tx(l,labelTxt);h.appendChild(l);if(tip)h.appendChild(infoIcon(tip));w.append(h,control);return w;
      };
      const maskThresholdNI=NI("",S.maskThreshold,0,1,0.01,v=>{S.maskThreshold=v;persist();},"100%");
      const maskCropNI=NI("",S.maskCropScale,1,4,0.05,v=>{S.maskCropScale=v;persist();},"100%");
      const AUDIO_MODES=["Preserve + lip-sync","Preserve (no lip-sync)","Regenerate"];
      const AUDIO_KEY={"Preserve + lip-sync":"preserve","Preserve (no lip-sync)":"preserve_no_lipsync","Regenerate":"regenerate"};
      const AUDIO_LABEL={preserve:"Preserve + lip-sync",preserve_no_lipsync:"Preserve (no lip-sync)",regenerate:"Regenerate"};
      const maskAudioDD=DD(AUDIO_MODES,AUDIO_LABEL[S.maskAudioMode]||"Preserve + lip-sync",v=>{S.maskAudioMode=AUDIO_KEY[v]||"preserve";persist();});
      maskOpts.append(
        maskField("Detection",maskThresholdNI,"SAM 3 text-detection threshold. Lower finds more candidates; higher is stricter."),
        maskField("Crop padding",maskCropNI,"Crop size relative to the tracked subject. 1 is tight; 1.5 leaves useful context."),
        maskField("Audio",maskAudioDD.el,"Preserve + lip-sync keeps the source soundtrack and drives the replacement's mouth from the source speech, for talking-head edits. Preserve (no lip-sync) keeps the soundtrack identical and adds no speech, for music or non-speaking clips. Regenerate asks H3 to compose a new soundtrack for the edited crop.")
      );
      maskArea.appendChild(maskOpts);
      const maskRefsBox=mk("div",{display:"flex",flexDirection:"column",gap:"6px"});maskArea.appendChild(maskRefsBox);
      const _renderMask=(opts)=>{
        const trimOn=Number(S.maskStartTime)>0;
        tx(maskPaintState,(S.maskSeed?"Mask ready":"No mask yet")+(trimOn?` · starts at ${fmtClock(S.maskStartTime)}`:"")+" - click preview to paint or edit");
        maskPaintState.style.color=S.maskSeed?C.lime:C.muted;
        maskClearBtn.style.display=S.maskSeed?"block":"none";
        trimChip.style.display=trimOn?"inline-flex":"none";
        if(trimOn) tx(trimChip,`Start ${fmtClock(S.maskStartTime)}`);
        trimSlotBadge.style.display=(trimOn&&S.maskVideo)?"block":"none";
        if(trimOn&&S.maskVideo) tx(trimSlotBadge,`Start ${fmtClock(S.maskStartTime)}`);
        maskSrcSlot.style.boxShadow=trimOn&&S.maskVideo?`0 0 0 2px rgba(88,224,111,.5) inset`:"none";
        if(!opts||opts.refreshPreview!==false) _renderMaskPreview();
        maskRefsBox.innerHTML="";
        const h=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em"});
        tx(h,`Replacement references (${S.refImages.length}/9${_refImageUploadsPending?`, ${_refImageUploadsPending} uploading`:""})`);maskRefsBox.appendChild(h);
        const row=mk("div",{display:"grid",gridTemplateColumns:"repeat(auto-fill, 76px)",gap:"8px",alignItems:"start"});
        S.refImages.forEach((name,idx)=>{
          const slot=ImgSlot(false,n=>{const current=S.refImages.indexOf(name);if(current<0)return;if(n===null)S.refImages.splice(current,1);else S.refImages[current]=n;persist();_renderMask({refreshPreview:false});},(nm,size)=>{if(nm&&size){S.refImageSizes[nm]=size;persist();}},true);
          row.appendChild(slot.el);if(name)slot._restorePreview(name);
        });
        if(!_refImageUploadsPending&&S.refImages.length<9){
          const add=mk("button",{width:"72px",height:"72px",borderRadius:"12px",border:"1.5px dashed rgba(90,168,255,.4)",background:"rgba(90,168,255,.05)",color:"rgba(90,168,255,.8)",fontSize:"18px",fontWeight:"700",cursor:"pointer"},{type:"button",title:"Add replacement reference"});tx(add,"+");
          const input=mk("input",{display:"none"},{type:"file",accept:IMAGE_FILE_EXTS.join(",")});
          add.onclick=()=>{input.value="";input.click();};
          input.onchange=async()=>{const file=input.files&&input.files[0];if(!file||!_fileMatches(file,IMAGE_FILE_EXTS)||_refImageUploadsPending||S.refImages.length>=9)return;_refImageUploadsPending++;_renderMask({refreshPreview:false});try{const name=await _uploadImage(file);if(S.refImages.length<9){S.refImages.push(name);const size=await _captureFileSize(file);if(size)S.refImageSizes[name]=size;persist();}}catch(e){if(_h3ShowError)_h3ShowError("Reference upload failed: "+fmtErr(e));}finally{_refImageUploadsPending--;_renderMask({refreshPreview:false});}};
          row.append(add,input);
        }
        maskRefsBox.appendChild(row);
        const hint=mk("div",{fontSize:"8px",color:C.muted,lineHeight:"1.45"});tx(hint,"Add at least one image showing what should appear inside the mask. Describe it in the main prompt as <Picture 1>, <Picture 2>, and so on.");maskRefsBox.appendChild(hint);
      };
      maskArea._render=_renderMask;
      maskPaintBtn.onclick=async()=>{
        if(!S.maskVideo){if(_h3ShowError)_h3ShowError("Add a source video before painting a mask.");return;}
        await openVideoMaskEditor({videoName:S.maskVideo,maskName:S.maskSeed,startTime:S.maskStartTime||0,sam3Ckpt:S.models.sam3,onSave:async name=>{S.maskSeed=name;persist();_renderMask();}});
      };
      maskClearBtn.onclick=()=>{S.maskSeed=null;persist();_renderMask();};
      const openTrimEditor=()=>{
        if(!S.maskVideo){if(_h3ShowError)_h3ShowError("Add a source video before trimming.");return;}
        return new Promise((resolve)=>{
          const overlay=mk("div",{position:"fixed",inset:"0",zIndex:"1000001",background:"rgba(0,0,0,.88)",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",boxSizing:"border-box"});
          const panel=mk("div",{width:"min(860px,94vw)",background:C.bg1,border:`1px solid ${C.borderH}`,borderRadius:"12px",boxShadow:"0 24px 80px rgba(0,0,0,.9)",padding:"14px",display:"flex",flexDirection:"column",gap:"10px",boxSizing:"border-box"});
          const head=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
          const title=mk("div",{fontSize:"13px",fontWeight:"800",color:C.text});tx(title,"Choose where to start");
          const help=mk("div",{fontSize:"10px",color:C.muted,lineHeight:"1.5"});tx(help,"Scrub to the moment your subject appears. The green START badge on the video shows the exact frame the clip will begin on - the mask you paint later lands there. Hit Start here to set it. The source file stays unchanged; only up to the Source max (s) after this point gets replaced.");
          head.append(title,help);
          const box=mk("div",{overflow:"hidden",background:"#000",border:`1px solid ${C.border}`,borderRadius:"8px",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",height:"min(52vh,360px)"});
          const video=mk("video",{width:"100%",height:"100%",objectFit:"contain",display:"block",background:"#000"},{muted:true,preload:"auto",playsInline:true,controls:false});
          box.appendChild(video);
          const startLbl=mk("div",{position:"absolute",top:"8px",left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,.85)",border:`1px solid ${C.lime}`,color:C.lime,fontSize:"10px",fontWeight:"800",padding:"4px 12px",borderRadius:"999px",pointerEvents:"none",zIndex:"6",whiteSpace:"nowrap",lineHeight:"1.2",display:"none"});tx(startLbl,"START");
          box.appendChild(startLbl);
          const scrubRow=mk("div",{display:"flex",alignItems:"center",gap:"10px"});
          const scrub=mk("input",{flex:"1",accentColor:C.lime},{type:"range",min:"0",max:"1000",step:"1",value:"0"});
          const timeLbl=mk("div",{fontSize:"10px",color:C.muted,minWidth:"150px",textAlign:"right"});tx(timeLbl,"0.0s / 0.0s");
          const windowLbl=mk("div",{fontSize:"9px",color:C.muted,textAlign:"center"});tx(windowLbl,"");
          scrubRow.append(scrub,timeLbl);
          const actions=mk("div",{display:"flex",alignItems:"center",gap:"8px",justifyContent:"flex-end"});
          const mkBtn=(label,extra)=>tx(mk("button",{height:"30px",padding:"0 14px",borderRadius:"7px",border:`1px solid ${C.border}`,background:C.bg2,color:C.text,fontSize:"10px",fontWeight:"700",cursor:"pointer",outline:"none",...(extra||{})},{type:"button"}),label);
          const cancelBtn=mkBtn("Cancel");
          const resetBtn=mkBtn("Reset to 0");
          const startBtn=mkBtn("Start here",{borderColor:C.lime,color:C.lime});
          actions.append(resetBtn,cancelBtn,startBtn);
          panel.append(head,box,scrubRow,windowLbl,actions);
          overlay.appendChild(panel);document.body.appendChild(overlay);
          let closed=false,playing=false,ready=false,total=0;
          const close=(val)=>{if(closed)return;closed=true;video.pause();video.removeAttribute("src");overlay.remove();resolve(val);};
          const fmt=(t)=>fmtClock(t);
          const updateWindow=()=>{
            const start=Math.max(0,Number(scrub.value)/1000*total)||0;
            const cap=Math.min(15,Math.max(.2,Number(S.duration)||5));
            const end=Math.min(total,start+cap);
            tx(windowLbl,`Start ${fmt(start)} / ${fmt(total)}. Replaces up to ${cap.toFixed(1)}s after it${end<start+cap?` (only ${fmt(end-start)} remain in the source)`:""}.`);
          };
          const syncScrub=()=>{
            if(!ready||!total)return;
            scrub.value=String(Math.round((Math.min(video.currentTime||0,total))/total*1000));
            tx(timeLbl,`${fmt(video.currentTime||0)} / ${fmt(total)}`);
            updateWindow();
            const t=Math.min(video.currentTime||0,total);
            startLbl.style.display=ready&&t>=0?"block":"none";
            tx(startLbl,`START ${fmt(t)}`);
          };
          scrub.oninput=()=>{
            if(!ready||!total)return;
            const t=Math.min(total,(Number(scrub.value)/1000)*total);
            try{video.currentTime=t;}catch(e){}
            tx(timeLbl,`${fmt(t)} / ${fmt(total)}`);updateWindow();
          };
          video.addEventListener("timeupdate",syncScrub);
          video.addEventListener("seeked",syncScrub);
          video.onloadedmetadata=()=>{
            total=video.duration||0;ready=total>0;
            if(!ready){tx(timeLbl,"Could not read duration");return;}
            const cur=Math.min((S.maskStartTime||0),total);
            try{video.currentTime=cur;}catch(e){}
            syncScrub();
          };
          video.onerror=()=>{tx(timeLbl,"Source video could not be opened");};
          video.src=api.apiURL(`/view?filename=${encodeURIComponent(S.maskVideo)}&type=input&subfolder=&t=${Date.now()}`);
          cancelBtn.onclick=()=>close();
          resetBtn.onclick=()=>{S.maskStartTime=0;persist();_renderMask();close();};
          startBtn.onclick=()=>{
            if(!ready){return;}
            const start=Math.min(total,(video.currentTime||0));
            const trimChanged=Math.abs(start-(Number(S.maskStartTime)||0))>0.05;
            const hadMask=!!S.maskSeed;
            S.maskStartTime=Math.max(0,start);
            if(hadMask&&trimChanged){S.maskSeed=null;}
            persist();_renderMask();close();
          };
          overlay.addEventListener("pointerdown",e=>e.stopPropagation());
          const onKey=(e)=>{if(e.key==="Escape")close();};
          document.addEventListener("keydown",onKey);
          const origClose=close;
          close=(val)=>{document.removeEventListener("keydown",onKey);return origClose(val);};
        });
      };
      maskTrimBtn.onclick=()=>openTrimEditor();
      trimChip.onclick=()=>openTrimEditor();
      if(S.maskVideo) maskSrcSlot._restorePreview(S.maskVideo);
      _renderMask();

      // Chain clips
      const _renderChain=()=>{
        chainArea.innerHTML="";
        const hdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between"});
        const t=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em"});
        tx(t,`Clips (${S.chainClips.length})`);
        hdr.appendChild(t);
        const presBtn=mk("button",{background:"transparent",border:`1px solid ${C.border}`,cursor:"pointer",padding:"2px 8px",color:C.muted,outline:"none",borderRadius:"5px",fontSize:"9px",fontWeight:"700"});
        tx(presBtn,"Discover presets");
        presBtn.onmouseenter=()=>{presBtn.style.color=C.lime;presBtn.style.borderColor=C.lime;};
        presBtn.onmouseleave=()=>{presBtn.style.color=C.muted;presBtn.style.borderColor=C.border;};
        presBtn.onclick=(e)=>{e.stopPropagation();_renderDiscover();openOverlay(discoverOverlay);};
        hdr.appendChild(presBtn);
        chainArea.appendChild(hdr);
        S.chainClips.forEach((cl,idx)=>{
          const row=mk("div",{background:C.bg1,border:`1px solid ${C.border}`,borderRadius:"8px",padding:"6px 8px",display:"flex",flexDirection:"column",gap:"4px"});
          const head=mk("div",{display:"flex",alignItems:"center",gap:"8px"});
          const num=mk("div",{fontSize:"10px",fontWeight:"700",color:C.lime,flexShrink:"0"});
          tx(num,`Clip ${idx+1}`);
          const durNI=NI("",cl.duration,1,30,0.5,v=>{cl.duration=v;persist();},"56px");
          const durLbl=mk("div",{fontSize:"8px",color:C.muted,flexShrink:"0"});tx(durLbl,"sec");
          const rm=mk("button",{marginLeft:"auto"}, {type:"button",className:"h3-rmbtn",title:"Remove this clip","aria-label":"Remove this clip"});
          tx(rm,"x");
          rm.onclick=()=>{ if(S.chainClips.length>1){ S.chainClips.splice(idx,1); persist(); _renderChain(); } };
          head.append(num,durNI,durLbl,rm);
          const ta=mk("textarea",{
            background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"6px",
            color:C.text,fontSize:"11px",padding:"6px 8px",resize:"vertical",outline:"none",
            fontFamily:"inherit",lineHeight:"1.5",width:"100%",boxSizing:"border-box",minHeight:"44px",
          },{value:cl.prompt,placeholder:`Prompt for clip ${idx+1}`});
          ta.onfocus=()=>ta.style.borderColor=C.lime;
          ta.onblur=()=>ta.style.borderColor=C.border;
          ta.oninput=()=>{cl.prompt=ta.value;persist();};
          ta.addEventListener("wheel",e=>{ if(document.activeElement===ta) e.stopPropagation(); },{passive:true});
          row.append(head,ta);
          chainArea.appendChild(row);
        });
        const addCl=mk("button",{background:"transparent",border:`1px dashed rgba(var(--h3accent-rgb),.4)`,borderRadius:"6px",padding:"4px 12px",fontSize:"9px",fontWeight:"700",color:"rgba(var(--h3accent-rgb),.7)",cursor:"pointer",outline:"none",alignSelf:"flex-start"});
        tx(addCl,"+ Add clip");
        addCl.onclick=()=>{ S.chainClips.push({prompt:"",duration:S.duration}); persist(); _renderChain(); };
        chainArea.appendChild(addCl);
        const mcRow=mk("div",{display:"flex",alignItems:"center",gap:"8px",background:C.bg1,border:`1px solid ${C.border}`,borderRadius:"8px",padding:"6px 8px"});
        const mcCapRow=mk("div",{display:"flex",alignItems:"center",gap:"4px"});
        const mcCap=mk("div",{fontSize:"9px",color:C.text});tx(mcCap,"Context length (frames)");
        mcCapRow.append(mcCap,infoIcon("How many frames of the previous clip's tail (motion + audio) are pinned as context for the next clip.\nOnly H3-native clip lengths are valid: 1, 5, 22, 39, 56, 73, 90, 107, 124, 141.\nDefault 22 frames (~1s at 24fps). Higher = tighter continuity but less freedom."));
        const MC_GRID=[1,5,22,39,56,73,90,107,124,141];
        const _snapMC=v=>{ v=Math.round(Number(v)||22); return MC_GRID.reduce((a,b)=>Math.abs(b-v)<Math.abs(a-v)?b:a,22); };
        S.mcLength=_snapMC(S.mcLength);
        const mcDD=DD(MC_GRID.map(String),String(S.mcLength),v=>{S.mcLength=parseInt(v)||22;persist();});
        mcRow.append(mcCapRow,mcDD.el);
        chainArea.appendChild(mcRow);
        const hint=mk("div",{fontSize:"8px",color:C.muted,lineHeight:"1.5"});
        tx(hint,"Clips run sequentially in one queue entry. Each clip pins the previous clip's tail (motion + audio). Keep the same resolution across clips - the latent path cannot resize.");
        chainArea.appendChild(hint);
      };
      chainArea._render=_renderChain;

      const _updateModeSections=()=>{
        _clearSections();
        modeCard.style.display=S.mode==="t2v"?"none":"";
        promptCard.style.display=S.mode==="chain"?"none":"";
        if(S.mode==="chain"||S.mode==="image"){
          durHalf.style.display="none";
          dfSep.style.display="none";
          framesLbl.style.display="none";
        } else {
          durHalf.style.display="flex";
          dfSep.style.display="";
          framesLbl.style.display="";
          tx(durCap,S.mode==="mask"?"Source max (s)":"Duration (s)");
          durNI._inp.disabled=false;
          durNI.style.opacity="";
        }
        const maskFps=S.mode==="mask";
        if(maskFps&&S.duration>15){S.duration=15;durNI.setVal(15);persist();}
        durNI._inp.max=maskFps?"15":"30";
        fpsNI._inp.disabled=maskFps;
        fpsNI.style.opacity=maskFps?".5":"";
        fpsNI._inp.title=maskFps?"Locked to 24 fps. MiniMax H3 renders Mask mode at 24 fps; use Source max (s) to control how long the clip runs.":"";
        fpsNI.setVal(maskFps?24:S.fps);
        params.style.display=S.mode==="image"?"none":"grid";
        tx(modeDesc, MODE_DESC[S.mode]||"");
        if(S.mode==="i2v"){ modeHdr.style.display="flex"; modeTitle.textContent="Image to Video"; i2vArea.style.display="flex"; }
        else if(S.mode==="r2v"){ modeHdr.style.display="flex"; modeTitle.textContent="Reference to Video"; _renderRefs(); refArea.style.display="flex"; }
        else if(S.mode==="audio_drive"){ modeHdr.style.display="flex"; modeTitle.textContent="Audio Drive"; _renderRefs(); refArea.style.display="flex"; adArea.style.display="flex"; }
        else if(S.mode==="keyframes"){ modeHdr.style.display="flex"; modeTitle.textContent="Custom Keyframes"; _renderKf(); kfArea.style.display="flex"; }
        else if(S.mode==="extend"){ modeHdr.style.display="flex"; modeTitle.textContent="Extend Video"; exArea.style.display="flex"; }
        else if(S.mode==="chain"){ modeHdr.style.display="flex"; modeTitle.textContent="Motion Context Chain"; _renderChain(); chainArea.style.display="flex"; }
        else if(S.mode==="mask"){ modeHdr.style.display="flex"; modeTitle.textContent="Mask Inpaint"; _renderMask(); maskArea.style.display="flex"; }
        else if(S.mode==="image"){ modeHdr.style.display="flex"; modeTitle.textContent="Image (H3 Studio)"; _renderImgRefs(); imgArea.style.display="flex"; if(_syncImgAdvRef) _syncImgAdvRef(); }
        else { modeHdr.style.display="none"; modeTitle.textContent="Text to Video"; }
        if(typeof _syncLiveToggle==="function") _syncLiveToggle();
        if(_syncFitRowFn) _syncFitRowFn();
        if(_updPlaceholderLabelFn) _updPlaceholderLabelFn();
        if(_updateFramesLabel) _updateFramesLabel();
      };

      // -- PARAMS ------------------------------------------------------------
      const paramsHdr=mk("div",{display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",userSelect:"none"});
      const phLineL=mk("div",{flex:"1",height:"1px",background:C.border,flexShrink:"1",minWidth:"0"});
      const phTitle=mk("span",{fontSize:"10px",fontWeight:"700",letterSpacing:".14em",textTransform:"uppercase",color:C.lime,flexShrink:"0"});
      tx(phTitle,"Tune");
      const phLineR=mk("div",{flex:"1",height:"1px",background:C.border,flexShrink:"1",minWidth:"0"});
      const paramsChev=mk("span",{color:C.dim,fontSize:"10px",flexShrink:"0"});
      tx(paramsChev,"▾");
      paramsHdr.append(phLineL,phTitle,phLineR,paramsChev);
      const params=mk("div",{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"});
      let _resItems=[];
      const _resolveRes=()=>{
        let base;
        if(S.resolution==="Custom"){
          const w=Math.max(32,Math.min(16384,Math.round(S.customW/32)*32));
          const h=Math.max(32,Math.min(16384,Math.round(S.customH/32)*32));
          base={width:w,height:h,label:`${w}x${h} (custom)`};
        } else {
          base=_resItems.find(r=>r.label===S.resolution)||_resItems[0]||{width:960,height:544,label:S.resolution};
        }
        if(S.resolution!=="Custom"&&S.mode!=="mask"&&S.mode==="extend"&&S.extendVideoSize&&_validSize(S.extendVideoSize)){
          const p=_fitPrimary(S);
          if(!p||p.mode!=="custom"){
            const src=S.extendVideoSize;
            const fit=fitResolutionToAspect(src.width,src.height,src.width,src.height);
            return {width:fit.width,height:fit.height,label:`${fit.width}x${fit.height} (source)`};
          }
        }
        if(S.resolution!=="Custom"&&S.mode!=="mask"){
          const p=_fitPrimary(S);
          if(p){
            if(p.mode==="custom"){
              const w=Math.max(32,Math.min(16384,Math.round(p.size.width/32)*32));
              const h=Math.max(32,Math.min(16384,Math.round(p.size.height/32)*32));
              return {width:w,height:h,label:`${w}x${h} (Custom · ${p.label})`};
            }
            if(p.mode==="normal"){
              const fit=fitResolutionToAspect(p.size.width,p.size.height,1344,768);
              return {width:fit.width,height:fit.height,label:`${fit.width}x${fit.height} (Normal · ${p.label})`};
            }
            const fit=fitResolutionToAspect(p.size.width,p.size.height,base.width,base.height);
            return {width:fit.width,height:fit.height,label:`${fit.width}x${fit.height} (Fit · ${p.label})`};
          }
        }
        return orientRes(base, _effectiveResOrientation(S));
      };
      const _effectiveMaskCropPlan=()=>{
        const r=_resolveRes();
        return planMaskCrop(r.width,r.height);
      };
      const _effectiveMaskCropMP=()=>_effectiveMaskCropPlan().megapixels;
      const resRow=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const resCapRow=mk("div",{display:"flex",alignItems:"center",gap:"4px"});
      const resCap=mk("div",{fontSize:"10px",color:C.text});tx(resCap,"Resolution");
      resCapRow.append(resCap,infoIcon(S.mode==="mask"?
        "The pixel budget for the masked crop. 0.5MP Balanced is the sweet spot: big enough for a clean face, small enough for any crop shape within H3 limits. The crop hugs the tracked object, and this budget never changes with the source video.\nThe swap button flips landscape and portrait.\nPick Custom to set any size - snapped to multiples of 32.\nMiniMax H3 recommends up to 1344x768 (short edge <= 768, long edge <= 1344). Above that the model may repeat content or distort."
        :
        "The output pixel grid (width x height).\nHigher = sharper detail and more VRAM + time.\nThe swap button flips between landscape and portrait.\nPick Custom to set any size - snapped to multiples of 32.\nMiniMax H3 recommends up to 1344x768 (short edge <= 768, long edge <= 1344). Above that the model may repeat content or distort."));
      const resDD=DD([],S.resolution,v=>{S.resolution=v;persist();_updateFramesLabel();_updResCustom();});
      const swapBtn=mk("button",{width:"32px",height:"28px",flexShrink:"0",background:C.bg3,border:`1px solid ${C.border}`,borderRadius:"7px",color:C.muted,fontSize:"13px",lineHeight:"1",cursor:"pointer",outline:"none",transition:"border-color .15s,color .15s",boxSizing:"border-box"},{type:"button",title:"Swap width and height","aria-label":"Swap width and height"});
      tx(swapBtn,"\u21C4");
      swapBtn.onmouseenter=()=>{swapBtn.style.borderColor=C.lime;swapBtn.style.color=C.lime;};
      swapBtn.onmouseleave=()=>{swapBtn.style.borderColor=C.border;swapBtn.style.color=C.muted;};
      const resDDWrap=mk("div",{display:"flex",alignItems:"center",gap:"6px",width:"100%"});
      resDDWrap.append(resDD.el,swapBtn);
      resRow.append(resCapRow,resDDWrap);
      const resCustom=mk("div",{display:"none",alignItems:"center",gap:"6px"});
      const resCW=NI("",S.customW,32,16384,32,v=>{S.customW=Math.max(32,Math.min(16384,Math.round(v/32)*32));persist();_updResMP();},"58px");
      const resCH=NI("",S.customH,32,16384,32,v=>{S.customH=Math.max(32,Math.min(16384,Math.round(v/32)*32));persist();_updResMP();},"58px");
      const resX=mk("div",{fontSize:"10px",color:C.muted,flexShrink:"0"});tx(resX,"x");
      const resMPLbl=mk("div",{fontSize:"9px",color:C.muted,flexShrink:"0"});
      const _updResMP=()=>{
        const w=Math.max(32,Math.round(S.customW/32)*32), h=Math.max(32,Math.round(S.customH/32)*32);
        tx(resMPLbl,`${((w*h)/1000000).toFixed(2)}MP`);
        const over=Math.min(w,h)>768||Math.max(w,h)>1344;
        resMPLbl.style.color=over?C.warn:C.muted;
      };
      resCustom.append(resCW,resX,resCH,resMPLbl);
      resRow.appendChild(resCustom);
      const _updResCustom=()=>{ resCustom.style.display=S.resolution==="Custom"?"flex":"none"; _updResMP(); };

      const fitInfo=mk("div",{fontSize:"8px",color:C.muted,lineHeight:"1.4"});
      tx(fitInfo,"");
      const fitInfoRow=mk("div",{display:"none",alignItems:"center",gap:"6px",flexWrap:"wrap"});
      fitInfoRow.appendChild(fitInfo);
      resRow.appendChild(fitInfoRow);

      _syncFitRowFn=()=>{
        tx(resCap,S.mode==="mask"?"Crop canvas":"Resolution");
        const src=_fitSourceSize(S);
        const fitActive=!!(S.resolution!=="Custom"&&src);
        if(!fitActive){
          fitInfoRow.style.display="none";
          resDD.set(S.resolution);
          return;
        }
        const r=_resolveRes();
        resDD.set(r.label);
        fitInfoRow.style.display="flex";
        const mp=(S.mode==="mask"?_effectiveMaskCropMP():(r.width*r.height/1000000)).toFixed(2);
        tx(fitInfo, `${src.label} ${src.width}x${src.height} -> canvas ${r.width}x${r.height} (${mp}MP)`);
        const over=Math.min(r.width,r.height)>768||Math.max(r.width,r.height)>1344;
        fitInfo.style.color=over?C.warn:C.muted;
        _fitChipRefreshes.forEach(r=>{try{r();}catch(e){}});
      };
      const _swapRes=()=>{
        let base;
        if(S.resolution==="Custom"){
          base={width:Math.max(32,Math.round(S.customW/32)*32),height:Math.max(32,Math.round(S.customH/32)*32)};
        } else {
          base=_resItems.find(r=>r.label===S.resolution)||{width:960,height:544};
        }
        const flipped={width:base.height,height:base.width};
        const match=_resItems.find(p=>p.width===flipped.width&&p.height===flipped.height);
        if(match){
          S.resolution=match.label; resDD.set(match.label);
        } else {
          S.resolution="Custom";
          S.customW=Math.max(32,Math.min(16384,Math.round(flipped.width/32)*32));
          S.customH=Math.max(32,Math.min(16384,Math.round(flipped.height/32)*32));
          resDD.set("Custom");
          resCW._inp.value=String(S.customW);
          resCH._inp.value=String(S.customH);
        }
        persist();_updateFramesLabel();_updResCustom();
      };
      swapBtn.onclick=_swapRes;
      _syncFitRowFn();
      const durFpsCell=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const durCap=mk("div",{fontSize:"10px",color:C.text});tx(durCap,"Duration (s)");
      const durInner=mk("div",{display:"flex",alignItems:"center",gap:"8px"});
      const durNI=NI("",S.duration,1,30,0.5,v=>{S.duration=S.mode==="mask"?Math.min(15,v):v;durNI.setVal(S.duration);persist();_updateFramesLabel();},"60px");
      durInner.append(durNI);
      const durHalf=mk("div",{display:"flex",flexDirection:"column",gap:"3px",flex:"1",minWidth:"0"});
      durHalf.append(durCap,durInner);
      const dfSep=mk("div",{width:"1px",alignSelf:"stretch",background:C.border,margin:"0 10px",flexShrink:"0"});
      const {fpsCapRow,fpsNI}=createOutputControls({S,mk,tx,infoIcon,NI,persist,updateFramesLabel:()=>_updateFramesLabel()});
      const fpsHalf=mk("div",{display:"flex",flexDirection:"column",gap:"3px",flex:"1",minWidth:"0"});
      fpsHalf.append(fpsCapRow,fpsNI);
      const dfCols=mk("div",{display:"flex",alignItems:"stretch"});
      dfCols.append(durHalf,dfSep,fpsHalf);
      const framesLbl=mk("div",{fontSize:"9px",color:C.muted,flexShrink:"0"});
      durFpsCell.append(dfCols,framesLbl);
      const stepsRow=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const stepsCap=mk("div",{fontSize:"10px",color:C.text});tx(stepsCap,"Steps");
      const stepsNI=NI("",S.steps,1,60,1,v=>{S.steps=Math.round(v);persist();},"60px");
      stepsRow.append(stepsCap,stepsNI);
      const qualRow=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const qualCapRow=mk("div",{display:"flex",alignItems:"center",gap:"4px"});
      const qualCap=mk("div",{fontSize:"10px",color:C.text});tx(qualCap,"Quality");
      qualCapRow.append(qualCap,infoIcon("The sampling pipeline, not the pixel size. Use the chips below to switch each accelerator on or off - Quality follows, and any manual mix shows as Custom.\nTurbo: Turbo LoRA + 6-step distilled sampler. Fastest, visibly lower quality - needs the Turbo LoRA set in Settings.\nSpeed: SolAttn sparse attention only. Fastest normal pipeline, tiny quality tradeoff.\nBalanced: SolAttn sparse attention only.\nHigh Quality: full SageAttention only - slowest, maximum fidelity.\nKitchen: ComfyUI's built-in Comfy Kitchen attention (pip install comfy-kitchen) - can run alone or with SolAttn, never with SageAttention.\nSLA Draft: H3 SLA Attention (ComfyUI-PlagueKind-Nodes) + Kitchen + a 4-step turbo LoRA at reduced strength, euler/simple 8 steps. Fastest for prompt-tweak drafts, weaker prompt adherence - drafts only, not final quality.\nNative: core ComfyUI H3 pipeline, no accelerators - needs no extra packs."));
      const qualDD=DD(["Turbo (Speed LoRA)","Speed","Balanced","High Quality","Native","SLA Draft","Custom"],_QL[S.quality]||"Custom",v=>{
        const key=Object.keys(_QL).find(k=>_QL[k]===v)||"custom";
        if(key!=="custom"){
          S.quality=key;
          const f=_QF[key]||{sol:false,sage:false,kitchen:false,sla:false};
          S.optSol=f.sol;S.optSage=f.sage;S.optKitchen=f.kitchen;S.optSla=f.sla;
          _syncOptChips();
        } else {
          S.quality="custom";
        }
        persist();
        if(S.quality==="turbo"){ stepsNI._inp.value="6"; S.steps=6; }
        if(S.quality==="draft"){ stepsNI._inp.value="8"; S.steps=8; }
        if(typeof _syncLiveToggle==="function") _syncLiveToggle();
      });
      qualRow.append(qualCapRow,qualDD.el);
      const optRow=mk("div",{display:"flex",gap:"5px",flexWrap:"wrap"});
      const _optChipSyncs=[];
      const _mkOptChip=(key,label,opts)=>{
        const o=opts||{};
        const chip=mk("button",{borderRadius:"6px",padding:"3px 9px",fontSize:"9px",fontWeight:"700",cursor:"pointer",outline:"none",transition:"background .15s,color .15s,border-color .15s"});
        const _sync=()=>{
          const dis=!!(o.disabled&&o.disabled());
          const on=!!S[key];
          chip.style.background=dis?(on?C.bg3:C.bg2):(on?C.lime:C.bg2);
          chip.style.color=dis?C.muted:(on?"#111":C.muted);
          chip.style.border=`1px solid ${dis?(on?C.border:C.border):(on?C.lime:C.border)}`;
          chip.style.cursor=dis?"not-allowed":"pointer";
          tx(chip,(on?"✓ ":"· ")+label+(dis?" ⚠":""));
          chip.title=dis?(o.disabledTip||label+" is not available right now"):((on?"Enabled":"Disabled")+" - click to "+(on?"disable":"enable"));
        };
        chip.onclick=()=>{
          if(o.disabled&&o.disabled()) return;
          S[key]=!S[key];
          if(S[key]&&Array.isArray(o.excl)) o.excl.forEach(k=>{ S[k]=false; });
          S.quality=_matchQ();
          qualDD.set(_QL[S.quality]);
          _syncOptChips();persist();
          if(typeof _syncLiveToggle==="function") _syncLiveToggle();
        };
        _sync();
        _optChipSyncs.push(_sync);
        return chip;
      };
      const _syncOptChips=()=>_optChipSyncs.forEach(f=>f());
      let _kitchenAvail=null;
      const _checkKitchenAvail=async()=>{
        try{
          const r=await fetch("/object_info/ModelAttentionBackend");
          const d=await r.json();
          const n=d.ModelAttentionBackend;
          const combo=(n&&n.input&&n.input.required&&n.input.required.attention)?n.input.required.attention[0]:[];
          _kitchenAvail=Array.isArray(combo)&&combo.includes("comfy kitchen attention");
        }catch(e){ _kitchenAvail=false; }
        _syncOptChips();
      };
      _checkKitchenAvail();
      let _slaAvail=null;
      const _checkSlaAvail=async()=>{
        try{
          const r=await fetch("/h3one/sla_status");
          const d=await r.json();
          _slaAvail=!!(d&&d.found);
        }catch(e){ _slaAvail=false; }
        _syncOptChips();
      };
      _checkSlaAvail();
      optRow.append(
        _mkOptChip("optSol","SolAttn",{excl:["optSla"]}),
        _mkOptChip("optSage","SageAttn",{excl:["optKitchen","optSla"]}),
        _mkOptChip("optKitchen","Kitchen",{
          excl:["optSage"],
          disabled:()=>_kitchenAvail===false,
          disabledTip:"Comfy Kitchen attention is not available - install the comfy-kitchen pip package and restart ComfyUI.",
        }),
        _mkOptChip("optSla","SLA",{
          excl:["optSol","optSage"],
          disabled:()=>_slaAvail===false,
          disabledTip:"H3 SLA Attention is not available - install ComfyUI-PlagueKind-Nodes and restart ComfyUI.",
        })
      );
      const SAMPLERS=["euler","euler_cfg_pp","euler_ancestral","euler_ancestral_cfg_pp","heun","heunpp2","exp_heun_2_x0","exp_heun_2_x0_sde","dpm_2","dpm_2_ancestral","lms","dpm_fast","dpm_adaptive","dpmpp_2s_ancestral","dpmpp_2s_ancestral_cfg_pp","dpmpp_sde","dpmpp_sde_gpu","dpmpp_2m","dpmpp_2m_cfg_pp","dpmpp_2m_sde","dpmpp_2m_sde_gpu","dpmpp_2m_sde_heun","dpmpp_2m_sde_heun_gpu","dpmpp_3m_sde","dpmpp_3m_sde_gpu","ddpm","lcm","ipndm","ipndm_v","deis","res_multistep","res_multistep_cfg_pp","res_multistep_ancestral","res_multistep_ancestral_cfg_pp","gradient_estimation","gradient_estimation_cfg_pp","er_sde","seeds_2","seeds_3","sa_solver","sa_solver_pece","ddim","uni_pc","uni_pc_bh2","legacy_rk","rk","rk_beta","deis_3m_ode","deis_2m_ode","deis_3m","deis_2m","res_6s_ode","res_5s_ode","res_3s_ode","res_2s_ode","res_3m_ode","res_2m_ode","res_6s","res_5s","res_3s","res_2s","res_3m","res_2m"];
      const SCHEDULERS=["simple","sgm_uniform","karras","exponential","ddim_uniform","beta","normal","linear_quadratic","kl_optimal","bong_tangent","beta57"];
      const samplerRow=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const samplerCapRow=mk("div",{display:"flex",alignItems:"center",gap:"4px"});
      const samplerCap=mk("div",{fontSize:"10px",color:C.text});tx(samplerCap,"Sampler");
      samplerCapRow.append(samplerCap,infoIcon("The sampling algorithm. MiniMax H3's native workflows use res_multistep - keep it unless you know why you're changing it."));
      const samplerDD=DD(SAMPLERS,S.samplerName||"res_multistep",v=>{S.samplerName=v;persist();});
      samplerRow.append(samplerCapRow,samplerDD.el);
      const schedRow=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const schedCapRow=mk("div",{display:"flex",alignItems:"center",gap:"4px"});
      const schedCap=mk("div",{fontSize:"10px",color:C.text});tx(schedCap,"Scheduler");
      schedCapRow.append(schedCap,infoIcon("The noise schedule. MiniMax H3's native workflows use simple - keep it unless you know why you're changing it."));
      const schedDD=DD(SCHEDULERS,S.schedulerName||"simple",v=>{S.schedulerName=v;persist();});
      schedRow.append(schedCapRow,schedDD.el);
      optRow.style.gridColumn="1 / -1";
      params.append(resRow,qualRow,optRow,durFpsCell,stepsRow,samplerRow,schedRow);

      // Custom sampling controls for Image mode (shown when the profile is Custom)
      const imgAdvRow=mk("div",{display:"none",flexDirection:"column",gap:"7px"});
      const imgAdvCap=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em"});
      tx(imgAdvCap,"Custom sampling");
      const _imgAdvField=(labelTxt,el)=>{
        const f=mk("div",{display:"flex",alignItems:"center",gap:"8px"});
        const l=mk("div",{fontSize:"10px",color:C.text,width:"62px",flexShrink:"0"});tx(l,labelTxt);
        f.append(l,el);
        return f;
      };
      const imgAdvSteps=NI("",S.steps,1,10000,1,v=>{S.steps=Math.round(v);persist();},"60px");
      const imgAdvSampler=DD(SAMPLERS,S.samplerName||"res_multistep",v=>{S.samplerName=v;persist();});
      const imgAdvSched=DD(SCHEDULERS,S.schedulerName||"simple",v=>{S.schedulerName=v;persist();});
      imgAdvRow.append(imgAdvCap,_imgAdvField("Steps",imgAdvSteps),_imgAdvField("Sampler",imgAdvSampler.el),_imgAdvField("Scheduler",imgAdvSched.el));
      imgArea.appendChild(imgAdvRow);
      const _syncImgAdv=()=>{
        imgAdvRow.style.display=(S.mode==="image"&&S.imgProfile==="custom")?"flex":"none";
        imgAdvSteps.setVal(S.steps);
      };
      _syncImgAdvRef=_syncImgAdv;
      const _saveModeState=()=>{
        S.modeSettings[S.mode]={
          prompt:S.prompt,steps:S.steps,quality:S.quality,resolution:S.resolution,duration:S.duration,
          loras:JSON.parse(JSON.stringify(S.loras)),
          optSol:S.optSol,optSage:S.optSage,optKitchen:S.optKitchen,optSla:S.optSla,
        };
      };
      const _restoreModeState=()=>{
        const ms=S.modeSettings[S.mode];
        if(!ms) return;
        if(ms.prompt!==undefined){ S.prompt=ms.prompt; promptTA.value=ms.prompt; _updChars(); }
        if(ms.steps!==undefined){ S.steps=ms.steps; stepsNI._inp.value=String(ms.steps); }
        if(ms.quality!==undefined){
          S.quality=ms.quality;
          if(ms.quality==="custom"){
            if(ms.optSol!==undefined) S.optSol=ms.optSol;
            if(ms.optSage!==undefined) S.optSage=ms.optSage;
            if(ms.optKitchen!==undefined) S.optKitchen=ms.optKitchen;
            if(ms.optSla!==undefined) S.optSla=ms.optSla;
            const f=resolveQualityFlags(S.optSol,S.optSage,S.optKitchen,S.optSla);
            S.optSol=f.sol;S.optSage=f.sage;S.optKitchen=f.kitchen;S.optSla=f.sla;
          } else {
            const f=_QF[ms.quality]||{sol:false,sage:false,kitchen:false,sla:false};
            S.optSol=f.sol;S.optSage=f.sage;S.optKitchen=f.kitchen;S.optSla=f.sla;
          }
          _syncOptChips();
          qualDD.set(_QL[ms.quality]||"Custom");
        }
        if(typeof _syncLiveToggle==="function") _syncLiveToggle();
        if(ms.resolution!==undefined){ S.resolution=ms.resolution; resDD.set(ms.resolution); _updResCustom(); }
        if(ms.duration!==undefined){ S.duration=S.mode==="mask"?Math.min(15,ms.duration):ms.duration; durNI._inp.value=String(S.duration); _updateFramesLabel(); }
        if(Array.isArray(ms.loras)){ const named=ms.loras.filter(l=>l&&l.name); S.loras=named.concat([{name:"",strength:1,enabled:false}]); _renderLoras(); }
        if(Array.isArray(ms.refImages)) S.refImages=ms.refImages.slice();
        if(Array.isArray(ms.refVideos)) S.refVideos=ms.refVideos.map(v=>(typeof v==="string")?{name:v,useAudio:false}:{name:(v&&v.name)||"",useAudio:!!(v&&v.useAudio)});
        if(Array.isArray(ms.refAudios)) S.refAudios=ms.refAudios.slice();
      };
      const _switchMode=(m)=>{
        if(S.mode===m) return;
        if(_workflowBuildBusy||_uploadsPending>0) return;
        _saveModeState();
        // Reference slots are per-mode (R2V and Audio Drive keep their own sets).
        const ms0=S.modeSettings[S.mode]||{};
        ms0.refImages=(S.refImages||[]).slice();
        ms0.refVideos=(S.refVideos||[]).map(v=>(typeof v==="string")?{name:v,useAudio:false}:{name:(v&&v.name)||"",useAudio:!!(v&&v.useAudio)});
        ms0.refAudios=(S.refAudios||[]).slice();
        S.modeSettings[S.mode]=ms0;
        const targetState=S.modeSettings[m];
        S.mode=m;
        if(!targetState){S.refImages=[];S.refVideos=[];S.refAudios=[];}
        _restoreModeState();
        persist();
        _updateTabs();
        _updateModeSections();
      };

      // -- LoRA slots (Advanced) ----------------------------------------------
      const loraArea=mk("div",{}, {className:"h3-card"});
      const loraHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",userSelect:"none"});
      const loraTitle=mk("div",{fontSize:"9px",fontWeight:"700",letterSpacing:".1em",textTransform:"uppercase",color:C.muted});
      tx(loraTitle,"Advanced");
      const loraSub=mk("div",{fontSize:"10px",color:C.muted,marginLeft:"auto",marginRight:"6px"});tx(loraSub,"LoRAs — none loaded");
      const loraGlob=mk("button",{fontSize:"9px",fontWeight:"700",color:C.muted,border:`1px solid ${C.border}`,background:"transparent",borderRadius:"6px",padding:"2px 8px",cursor:"pointer",marginRight:"6px",outline:"none",transition:"color .15s,border-color .15s,opacity .15s"},{type:"button",title:"Toggle all LoRAs in the current mode"});
      tx(loraGlob,"Enable all");
      loraGlob.onmouseenter=()=>{ if(!loraGlob.disabled){ loraGlob.style.borderColor=C.lime; loraGlob.style.color=C.lime; } };
      loraGlob.onmouseleave=()=>{ loraGlob.style.borderColor=C.border; loraGlob.style.color=C.muted; };
      loraGlob.onfocus=()=>{ loraGlob.style.boxShadow=`0 0 0 2px rgba(var(--h3accent-rgb),.35)`; };
      loraGlob.onblur=()=>{ loraGlob.style.boxShadow="none"; };
      const loraChev=mk("span",{color:C.dim,fontSize:"10px",flexShrink:"0"});
      tx(loraChev,"▾");
      loraHdr.append(loraTitle,loraSub,loraGlob,loraChev);
      const loraBody=mk("div",{display:"flex",flexDirection:"column",gap:"5px"});
      const loraRowsWrap=mk("div",{display:"flex",flexDirection:"column",gap:"5px"});
      loraBody.appendChild(loraRowsWrap);
      const addLoraBtn=mk("button",{background:"transparent",border:`1px dashed rgba(var(--h3accent-rgb),.4)`,borderRadius:"6px",padding:"4px 12px",fontSize:"9px",fontWeight:"700",color:"rgba(var(--h3accent-rgb),.7)",cursor:"pointer",outline:"none",alignSelf:"flex-start",transition:"border-color .15s,color .15s,box-shadow .15s"},{type:"button",title:"Add a LoRA row"});
      tx(addLoraBtn,"+ Add LoRA");
      addLoraBtn.onfocus=()=>{ addLoraBtn.style.boxShadow=`0 0 0 2px rgba(var(--h3accent-rgb),.3)`; addLoraBtn.style.borderColor=C.lime; addLoraBtn.style.color=C.lime; };
      addLoraBtn.onblur=()=>{ addLoraBtn.style.boxShadow="none"; addLoraBtn.style.borderColor="rgba(var(--h3accent-rgb),.4)"; addLoraBtn.style.color="rgba(var(--h3accent-rgb),.7)"; };
      addLoraBtn.onmouseenter=()=>{addLoraBtn.style.borderColor=C.lime;addLoraBtn.style.color=C.lime;};
      addLoraBtn.onmouseleave=()=>{addLoraBtn.style.borderColor="rgba(var(--h3accent-rgb),.4)";addLoraBtn.style.color="rgba(var(--h3accent-rgb),.7)";};
      addLoraBtn.onclick=()=>{
        if(S.loras.filter(l=>l&&l.name).length>=10) return;
        S.loras.push({name:"",strength:1,enabled:false});
        persist();
        _renderLoras();
      };
      loraBody.appendChild(addLoraBtn);
      loraArea.append(loraHdr,loraBody);
      const loraRows=[];
      const _renderLoras=()=>{
        loraRows.forEach(r=>r.remove());
        loraRows.length=0;
        S.loras.forEach((lr,idx)=>{
          const row=mk("div",{display:"flex",alignItems:"center",gap:"6px"});
          const dd=DD(_M.loras.length?_M.loras:["none"],lr.name||"none",v=>{
            const wasEmpty=!lr.name;
            lr.name=v==="none"?"":v;
            if(wasEmpty&&lr.name) lr.enabled=true;
            persist();
            _renderLoras();
          });
          const stNI=NI("",lr.strength,-3,3,0.1,v=>{lr.strength=Math.round(v*100)/100;persist();},"52px");
          const tgl=MiniToggle(lr.enabled!==false,v=>{
            lr.enabled=v;persist();
            _renderLoras();
          },"Enable/disable "+(lr.name?lr.name.split("/").pop():"this LoRA"));
          const rm=mk("button",{flexShrink:"0"}, {type:"button",className:"h3-rmbtn",title:"Remove this LoRA","aria-label":"Remove this LoRA"});
          tx(rm,"x");
          rm.onclick=()=>{
            S.loras.splice(idx,1);
            if(!S.loras.length) S.loras=[{name:"",strength:1,enabled:false}];
            persist();
            _renderLoras();
          };
          if(!lr.name && S.loras.length<=1) rm.style.display="none";
          if(lr.name&&lr.enabled===false){ dd.el.style.opacity=".45"; stNI.style.opacity=".45"; }
          row.append(dd.el,stNI,tgl.el,rm);
          loraRowsWrap.appendChild(row);
          loraRows.push(row);
        });
        addLoraBtn.style.display=S.loras.filter(l=>l&&l.name).length>=10?"none":"";
        const named=S.loras.filter(l=>l&&l.name);
        const onCount=named.filter(l=>l.enabled!==false).length;
        tx(loraSub, named.length?named.length+" selected · "+onCount+" on":"LoRAs — none loaded");
        const allOn=named.length&&named.every(l=>l.enabled!==false);
        tx(loraGlob, named.length?(allOn?"Disable all":"Enable all"):"Enable all");
        loraGlob.disabled=!named.length;
        loraGlob.style.opacity=named.length?"1":".35";
        loraGlob.style.cursor=named.length?"pointer":"default";
        loraGlob.style.borderColor=C.border;loraGlob.style.color=C.muted;
      };
      loraGlob.onclick=e=>{
        e.stopPropagation();
        const named=S.loras.filter(l=>l&&l.name);
        if(!named.length) return;
        const allOn=named.every(l=>l.enabled!==false);
        named.forEach(l=>{l.enabled=!allOn;});
        persist();
        _renderLoras();
      };
      _renderLoras();

      // -- Seed row (inside the Tune card) ------------------------------------
      const seedBody=mk("div",{display:"flex",flexDirection:"column",gap:"5px"});
      const seedRow=mk("div",{}, {className:"h3-seedrow"});
      const seedLbl=mk("span",{}, {className:"h3-slbl",textContent:"Seed"});
      const seedNI=NI("",S.seed,0,H3_SEED_MAX,1,v=>{S.seed=Math.round(v);persist();},"110px");
      seedNI.style.height="34px";seedNI.style.borderRadius="9px";seedNI.style.background="var(--h3-panel)";
      seedNI.style.border="1px solid var(--h3-line)";seedNI.style.width="auto";seedNI.style.flex="1 1 0";
      seedNI.style.minWidth="0";seedNI.style.maxWidth="150px";
      const randLbl=mk("span",{}, {className:"h3-slbl",textContent:"Random"});
      const randTgl=mk("button",{}, {type:"button",role:"switch",className:"h3-tgl","aria-label":"Randomize seed",title:"Randomize seed"});
      randTgl.appendChild(mk("span",{}, {className:"thumb"}));
      const _updSeedUI=()=>{
        randTgl.classList.toggle("on",S.randomizeSeed);
        randTgl.setAttribute("aria-checked",S.randomizeSeed?"true":"false");
        tx(randLbl,S.randomizeSeed?"Random":"Fixed");
        randLbl.style.color=S.randomizeSeed?"var(--h3accent)":"";
        seedNI._inp.disabled=S.randomizeSeed;
        seedNI._inp.style.color=S.randomizeSeed?C.dim:C.text;
        seedNI._inp.style.cursor=S.randomizeSeed?"not-allowed":"text";
      };
      _updSeedUI();
      randTgl.onclick=()=>{
        S.randomizeSeed=!S.randomizeSeed;
        persist();
        _updSeedUI();
      };
      const batchLbl=mk("span",{}, {className:"h3-slbl",textContent:"Batch"});
      const batchNI=NI("",S.batch,1,4,1,v=>{S.batch=Math.round(v);persist();},"56px");
      batchNI.style.height="34px";batchNI.style.borderRadius="9px";batchNI.style.background="var(--h3-panel)";
      batchNI.style.border="1px solid var(--h3-line)";
      seedRow.append(seedLbl,seedNI,randLbl,randTgl,batchLbl,batchNI);
      seedBody.appendChild(seedRow);

      // -- RIGHT: preview + gallery ------------------------------------------
      const rightPanel=mk("div",{flex:"1",minWidth:"0",display:"flex",flexDirection:"column",gap:"8px",overflow:"hidden"});
      const previewBox=mk("div",{
        width:"100%",flex:"1",minHeight:"180px",background:"#000",
        borderRadius:"10px",border:`1px solid ${C.border}`,
        position:"relative",overflow:"hidden",
      });
      const placeholder=mk("div",{position:"absolute",inset:"0",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"8px"});
      const phIco=mk("div",{fontSize:"28px",opacity:".25"});tx(phIco,"video");
      const phLbl=mk("div",{fontSize:"11px",color:C.muted});tx(phLbl,"Generated videos appear here");
      const _updPlaceholderLabel=()=>{
        if(S.mode==="image"){
          tx(phIco,"image");
          tx(phLbl,"Generated images appear here");
        } else {
          tx(phIco,"video");
          tx(phLbl,"Generated videos appear here");
        }
      };
      _updPlaceholderLabelFn=_updPlaceholderLabel;
      placeholder.append(phIco,phLbl);
      const vidEl=mk("video",{position:"absolute",inset:"0",width:"100%",height:"100%",objectFit:"contain",display:"none",background:"#000"},{controls:true});
      const imgEl=mk("img",{position:"absolute",inset:"0",width:"100%",height:"100%",objectFit:"contain",display:"none",background:"#000"});
      const webpCanvas=mk("canvas",{position:"absolute",inset:"0",width:"100%",height:"100%",objectFit:"contain",display:"none",background:"#000"});
      const errorBox=mk("div",{position:"absolute",inset:"0",display:"none",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"16px",color:C.err,fontSize:"11px",lineHeight:"1.6",textAlign:"center",background:"rgba(0,0,0,.8)"});
      const progWrap=mk("div",{position:"absolute",bottom:"0",left:"0",right:"0",background:"linear-gradient(transparent,rgba(0,0,0,.88))",padding:"14px 14px 10px",display:"none",flexDirection:"column",gap:"4px",pointerEvents:"none"});
      const progTop=mk("div",{display:"flex",justifyContent:"space-between",alignItems:"center"});
      const progStage=mk("div",{fontSize:"11px",fontWeight:"600",color:C.text,flex:"1"});tx(progStage,"Generating...");
      const progPct=mk("div",{fontSize:"10px",color:C.muted,flexShrink:"0"});tx(progPct,"0%");
      progTop.append(progStage,progPct);
      const progBar=mk("div",{height:"3px",borderRadius:"2px",background:"rgba(255,255,255,.15)",overflow:"hidden",marginTop:"4px"});
      const progFill=mk("div",{height:"100%",background:C.lime,width:"0%",transition:"width .3s ease"});
      progBar.appendChild(progFill);
      progWrap.append(progTop,progBar);
      const seedChip=mk("div",{}, {className:"h3-seedchip"});
      const seedChipLbl=mk("span",{}, {className:"scl",textContent:"Seed"});
      const seedChipVal=mk("span",{}, {className:"scv",textContent:""});
      const seedChipCopy=mk("button",{}, {type:"button",className:"h3-seedbtn",title:"Copy seed value","aria-label":"Copy seed value"});
      seedChipCopy.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      seedChipCopy._lbl=mk("span",{}, {textContent:"Copy"});
      seedChipCopy.appendChild(seedChipCopy._lbl);
      seedChipCopy.onclick=async(e)=>{
        e.stopPropagation();
        const ok=await h3Copy(seedChipVal.textContent);
        tx(seedChipCopy._lbl,ok?"Copied":"Failed");
        seedChipCopy.classList.add(ok?"ok":"err");
        setTimeout(()=>{ tx(seedChipCopy._lbl,"Copy"); seedChipCopy.classList.remove("ok","err"); },1300);
      };
      seedChip.append(seedChipLbl,seedChipVal,seedChipCopy);
      const resolutionChip=mk("div",{}, {className:"h3-seedchip"});
      const resolutionChipLbl=mk("span",{}, {className:"scl",textContent:"Resolution"});
      const resolutionChipVal=mk("span",{}, {className:"scv",textContent:""});
      resolutionChip.append(resolutionChipLbl,resolutionChipVal);
      const previewMeta=mk("div",{}, {className:"h3-previewmeta"});
      previewMeta.append(resolutionChip,seedChip);
      const liveChip=mk("div",{}, {className:"h3-livechip"});
      const liveDot=mk("span",{}, {className:"lcdot"});
      const liveTxt=mk("span",{}, {className:"lctxt",textContent:"Live preview"});
      liveChip.append(liveDot,liveTxt);
      const _showLiveChip=(show,dim=false)=>{
        liveChip.classList.toggle("dim",!!dim);
        liveChip.style.display=show?"flex":"none";
        if(dim) tx(liveTxt,"Waiting for frame");
        else tx(liveTxt,"Live preview");
      };
      let _kjImgUrl=null, _kjMp4Url=null, _kjWebpFrames=null, _kjWebpTimer=null, _kjPlayStart=0, _kjWebpFps=12;
      const _kjB64Blob=(b64,mime)=>{
        const bin=atob(b64);
        const arr=new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
        return new Blob([arr],{type:mime});
      };
      const _kjStopWebp=()=>{
        if(_kjWebpTimer){ clearInterval(_kjWebpTimer); _kjWebpTimer=null; }
        _kjWebpFrames=null;
        webpCanvas.style.display="none";
        webpCanvas.getContext("2d").clearRect(0,0,webpCanvas.width,webpCanvas.height);
      };
      const _kjReset=()=>{
        _kjStopWebp();
        vidEl.pause();vidEl.removeAttribute("src");vidEl.style.display="none";
        imgEl.removeAttribute("src");imgEl.style.display="none";
        if(_kjImgUrl){ URL.revokeObjectURL(_kjImgUrl); _kjImgUrl=null; }
        if(_kjMp4Url){ URL.revokeObjectURL(_kjMp4Url); _kjMp4Url=null; }
      };
      const _kjPlayWebp=async(b64,fps)=>{
        _kjStopWebp();
        if(typeof ImageDecoder==="undefined") return;
        try{
          const blob=_kjB64Blob(b64,"image/webp");
          const dec=new ImageDecoder({data:blob.stream(),type:"image/webp"});
          await dec.completed;
          const track=dec.tracks.selectedTrack;
          if(!track||track.frameCount<=1){ dec.close?.(); return; }
          const frames=[];
          for(let i=0;i<track.frameCount;i++){
            const r=await dec.decode({frameIndex:i});
            frames.push(r.image);
          }
          dec.close?.();
          if(!frames.length) return;
          _kjWebpFrames=frames;
          _kjWebpFps=Number(fps)||12;
          _kjPlayStart=performance.now();
          vidEl.style.display="none";vidEl.pause();
          imgEl.style.display="none";
          webpCanvas.style.display="block";
          _kjWebpTimer=setInterval(()=>{
            if(!_kjWebpFrames) return;
            const n=_kjWebpFrames.length;
            const dur=1000/_kjWebpFps;
            const idx=Math.min(n-1,Math.floor(((performance.now()-_kjPlayStart)%(n*dur))/dur));
            const f=_kjWebpFrames[idx];
            if(webpCanvas.width!==f.displayWidth||webpCanvas.height!==f.displayHeight){
              webpCanvas.width=f.displayWidth;webpCanvas.height=f.displayHeight;
            }
            webpCanvas.getContext("2d").drawImage(f,0,0);
          },33);
        }catch(e){}
      };
      self._h3_lpFrame=(d)=>{
        if(_cmpMode) _exitCompare();
        errorBox.style.display="none";
        placeholder.style.display="none";
        const mime=typeof d.mime==="string"?d.mime:"image/jpeg";
        if(mime==="video/mp4"){
          _kjStopWebp();
          if(_kjMp4Url){ URL.revokeObjectURL(_kjMp4Url); _kjMp4Url=null; }
          _kjMp4Url=URL.createObjectURL(_kjB64Blob(d.image,mime));
          imgEl.style.display="none";
          vidEl.style.display="block";
          vidEl.muted=true;vidEl.loop=true;vidEl.controls=true;vidEl.playsInline=true;
          vidEl.src=_kjMp4Url;
          vidEl.play().catch(()=>{});
        } else if(mime==="image/webp"){
          _kjPlayWebp(d.image,Number(d.fps)||12);
        } else {
          _kjStopWebp();
          if(_kjImgUrl){ URL.revokeObjectURL(_kjImgUrl); _kjImgUrl=null; }
          _kjImgUrl=URL.createObjectURL(_kjB64Blob(d.image,mime));
          vidEl.style.display="none";vidEl.pause();
          imgEl.src=_kjImgUrl;imgEl.style.display="block";
        }
        const step=Number(d.step)||0, total=Number(d.total)||0;
        if(total>0){
          const pct=Math.min(97,Math.max(8,Math.round(step/total*90)));
          const avg=Number(d.avg_step_ms)||0;
          const eta=avg>0?Math.round((total-step)*avg/1000):0;
          setStage(`Sampling · step ${step}/${total}${eta>0?` · ETA ~${eta}s`:""}`,pct);
        }
        _showLiveChip(true,false);
      };
      self._h3_lpReset=()=>{ _kjReset(); _showLiveChip(true,true); };
      self._h3_lpErr=(msg)=>{ _kjReset(); _showLiveChip(false); showError(msg); };
      previewBox.append(placeholder,vidEl,imgEl,webpCanvas,errorBox,progWrap,previewMeta,liveChip);
      const comparerWrap=mk("div",{position:"absolute",inset:"0",display:"none",cursor:"col-resize",userSelect:"none",borderRadius:"10px",overflow:"hidden",zIndex:"3"},{tabIndex:"0",role:"slider","aria-label":"Image comparison position","aria-valuemin":"0","aria-valuemax":"100","aria-valuenow":"50"});
      const cmpBase=mk("video",{position:"absolute",inset:"0",width:"100%",height:"100%",objectFit:"contain",background:"#000",display:"none"},{muted:true,loop:true,preload:"auto"});
      const cmpBaseImg=mk("img",{position:"absolute",inset:"0",width:"100%",height:"100%",objectFit:"contain",background:"#000",display:"none"},{alt:"Comparison source"});
      const cmpGen=mk("div",{position:"absolute",top:"0",left:"0",bottom:"0",overflow:"hidden",width:"50%"});
      const cmpGenVid=mk("video",{position:"absolute",top:"0",left:"0",height:"100%",objectFit:"contain",background:"#000",display:"none"},{muted:true,loop:true,preload:"auto"});
      const cmpGenImg=mk("img",{position:"absolute",top:"0",left:"0",height:"100%",objectFit:"contain",background:"#000",display:"none"},{alt:"Generated image"});
      cmpGen.append(cmpGenVid,cmpGenImg);
      const cmpLine=mk("div",{position:"absolute",top:"0",bottom:"0",width:"2px",background:C.lime,left:"calc(50% - 1px)",boxShadow:"0 0 8px rgba(var(--h3accent-rgb),.55)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:"4"});
      const cmpHandle=mk("div",{width:"30px",height:"30px",borderRadius:"50%",background:C.lime,border:"2px solid #111",flexShrink:"0",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 10px rgba(0,0,0,.7)",pointerEvents:"none"});
      cmpHandle.innerHTML=`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round"><path d="M8 4l-4 8 4 8M16 4l4 8-4 8"/></svg>`;
      cmpLine.appendChild(cmpHandle);
      const cmpLbl1=mk("div",{position:"absolute",top:"8px",left:"8px",fontSize:"8px",fontWeight:"700",letterSpacing:".06em",color:"#111",background:C.lime,borderRadius:"4px",padding:"2px 6px",zIndex:"5",pointerEvents:"none"});
      tx(cmpLbl1,"UPSCALED");
      const cmpLbl2=mk("div",{position:"absolute",top:"8px",right:"8px",fontSize:"8px",fontWeight:"700",letterSpacing:".06em",color:"rgba(255,255,255,.85)",background:"rgba(0,0,0,.55)",borderRadius:"4px",padding:"2px 6px",zIndex:"5",pointerEvents:"none"});
      tx(cmpLbl2,"ORIGINAL");
      comparerWrap.append(cmpBase,cmpBaseImg,cmpGen,cmpLine,cmpLbl1,cmpLbl2);
      previewBox.appendChild(comparerWrap);
      let _cmpDragging=false;
      const _cmpSetPct=(pct)=>{
        pct=Math.max(0,Math.min(100,pct));
        cmpGen.style.width=pct+"%";
        cmpLine.style.left=`calc(${pct}% - 1px)`;
        cmpGenVid.style.width=(comparerWrap.offsetWidth||600)+"px";
        cmpGenImg.style.width=(comparerWrap.offsetWidth||600)+"px";
        comparerWrap.setAttribute("aria-valuenow",String(Math.round(pct)));
      };
      comparerWrap.addEventListener("mousedown",e=>{_cmpDragging=true;e.preventDefault();});
      document.addEventListener("mousemove",e=>{
        if(!_cmpDragging) return;
        const r=comparerWrap.getBoundingClientRect();
        _cmpSetPct((e.clientX-r.left)/r.width*100);
      });
      document.addEventListener("mouseup",()=>{_cmpDragging=false;});
      comparerWrap.addEventListener("touchstart",()=>{_cmpDragging=true;},{passive:true});
      comparerWrap.addEventListener("touchmove",e=>{
        if(!_cmpDragging) return;
        const r=comparerWrap.getBoundingClientRect();
        _cmpSetPct((e.touches[0].clientX-r.left)/r.width*100);
      },{passive:true});
      comparerWrap.addEventListener("touchend",()=>{_cmpDragging=false;});
      const cmpBtn=mk("button",{position:"absolute",top:"8px",left:"8px",display:"none",background:"rgba(0,0,0,.72)",border:`1px solid ${C.borderH}`,borderRadius:"6px",padding:"3px 10px",fontSize:"9px",fontWeight:"700",color:C.text,cursor:"pointer",outline:"none",zIndex:"6",letterSpacing:".04em"});
      tx(cmpBtn,"Compare");
      cmpBtn.onmouseenter=()=>{cmpBtn.style.borderColor=C.lime;cmpBtn.style.color=C.lime;};
      cmpBtn.onmouseleave=()=>{cmpBtn.style.borderColor=C.borderH;cmpBtn.style.color=C.text;};
      cmpBtn.onclick=()=>{ _cmpMode?_exitCompare():_enterCompare(); };
      previewBox.appendChild(cmpBtn);
      const cmpSourceSelect=mk("select",{position:"absolute",top:"8px",left:"96px",display:"none",height:"24px",maxWidth:"100px",background:"rgba(0,0,0,.72)",border:`1px solid ${C.borderH}`,borderRadius:"6px",padding:"0 5px",fontSize:"9px",fontWeight:"700",color:C.text,cursor:"pointer",outline:"none",zIndex:"6"},{"aria-label":"Comparison source"});
      previewBox.appendChild(cmpSourceSelect);
      let _cmpMode=false;
      let _cmpImageMode=false;
      let _cmpImageRefs=[];
      let _cmpImageRefIndex=0;
      let _upOrig=null;
      let _upResult=null;
      let _upscaleRun="";
      const _isImageItem=item=>!!(item&&(item.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(item.filename||"")));
      const _inputImageUrl=name=>api.apiURL(`/view?filename=${encodeURIComponent(name)}&type=input&subfolder=`);
      const _outputImageThumb=item=>api.apiURL(`/h3one/thumb?${thumbQuery(item,1600)}`);
      const _outputImageUrl=item=>api.apiURL(`/view?${viewQuery(item)}`);
      const _syncCompareSourceSelect=()=>{
        cmpSourceSelect.innerHTML="";
        _cmpImageRefs.forEach((name,index)=>{
          const option=document.createElement("option");
          option.value=String(index);
          option.textContent=`@Image${index+1}`;
          cmpSourceSelect.appendChild(option);
        });
        cmpSourceSelect.value=String(_cmpImageRefIndex);
        cmpSourceSelect.style.display=_cmpMode&&_cmpImageMode&&_cmpImageRefs.length>1?"block":"none";
      };
      const _loadImageCompare=()=>{
        const source=_cmpImageRefs[_cmpImageRefIndex];
        if(!source||!_curItem) return false;
        cmpBaseImg.src=_inputImageUrl(source);
        cmpGenImg.src=_outputImageThumb(_curItem);
        cmpBaseImg.alt=`Comparison source @Image${_cmpImageRefIndex+1}`;
        cmpGenImg.alt="Generated image";
        tx(cmpLbl2,_cmpImageRefs.length>1?`@Image${_cmpImageRefIndex+1}`:"SOURCE");
        return true;
      };
      const _setCompareMedia=(baseIsImage,genIsImage)=>{
        cmpBase.style.display=baseIsImage?"none":"block";
        cmpGenVid.style.display=genIsImage?"none":"block";
        cmpBaseImg.style.display=baseIsImage?"block":"none";
        cmpGenImg.style.display=genIsImage?"block":"none";
      };
      cmpSourceSelect.onchange=()=>{
        _cmpImageRefIndex=Math.max(0,Math.min(_cmpImageRefs.length-1,parseInt(cmpSourceSelect.value)||0));
        if(_cmpMode&&_cmpImageMode){ _loadImageCompare();_cmpSetPct(50); }
      };
      const _enterCompare=()=>{
        const isUpscaleCompare=!!(_upResult&&_upOrig&&_curItem&&_upResult.media_key===mediaKey(_curItem));
        const imageMode=!isUpscaleCompare&&S.mode==="image"&&["edit","refmix"].includes(S.imgSub)&&_cmpImageRefs.length&&_isImageItem(_curItem);
        let baseIsImage=false,genIsImage=false;
        if(imageMode){
          if(!_loadImageCompare()) return;
          baseIsImage=true;genIsImage=true;
          tx(cmpLbl1,"GENERATED");
        } else {
          if(!_upOrig||!_curItem) return;
          baseIsImage=_isImageItem(_upOrig);
          genIsImage=_isImageItem(_curItem);
          const orUrl=baseIsImage?api.apiURL(`/h3one/thumb?${thumbQuery(_upOrig,4096)}`):api.apiURL(`/view?${viewQuery(_upOrig)}`);
          const upUrl=genIsImage?api.apiURL(`/h3one/thumb?${thumbQuery(_curItem,4096)}`):api.apiURL(`/view?${viewQuery(_curItem)}`);
          if(baseIsImage) cmpBaseImg.src=orUrl;
          else { cmpBase.src=orUrl;cmpBase.load(); }
          if(genIsImage) cmpGenImg.src=upUrl;
          else { cmpGenVid.src=upUrl;cmpGenVid.load(); }
          const _dimsFor=it=>{
            if(!it) return null;
            if(it.width>0&&it.height>0) return {width:it.width,height:it.height};
            const g=_galItems.find(x=>mediaKey(x)===mediaKey(it));
            if(g&&g.width>0&&g.height>0) return {width:g.width,height:g.height};
            return null;
          };
          const upD=_dimsFor(_curItem), orD=_dimsFor(_upOrig);
          tx(cmpLbl1, upD?`UPSCALED ${upD.width}×${upD.height}`:"UPSCALED");
          tx(cmpLbl2, orD?`ORIGINAL ${orD.width}×${orD.height}`:"ORIGINAL");
        }
        _cmpImageMode=!!imageMode;
        _setCompareMedia(baseIsImage,genIsImage);
        _cmpMode=true;
        _cmpSetPct(50);
        vidEl.style.display="none";
        imgEl.style.display="none";
        comparerWrap.style.display="block";
        tx(cmpBtn,"Exit compare");
        _syncCompareSourceSelect();
        if(!baseIsImage) cmpBase.play().catch(()=>{});
        if(!genIsImage) cmpGenVid.play().catch(()=>{});
      };
      const _exitCompare=()=>{
        _cmpMode=false;
        _cmpImageMode=false;
        cmpGenVid.pause();cmpBase.pause();
        cmpGenVid.src="";cmpBase.src="";
        cmpGenImg.src="";cmpBaseImg.src="";
        _setCompareMedia(false,false);
        comparerWrap.style.display="none";
        cmpSourceSelect.style.display="none";
        const image=_isImageItem(_curItem);
        vidEl.style.display=image?"none":"block";
        imgEl.style.display=image?"block":"none";
        tx(cmpBtn,"Compare");
      };
      comparerWrap.addEventListener("keydown",e=>{
         if(!_cmpMode||!(["ArrowLeft","ArrowRight","Home","End"].includes(e.key))) return;
         e.preventDefault();
         const current=Number(comparerWrap.getAttribute("aria-valuenow"))||50;
         const next=e.key==="Home"?0:(e.key==="End"?100:current+(e.key==="ArrowRight"?5:-5));
         _cmpSetPct(next);
      });
      const setStage=(l,p)=>{
        tx(progStage,l);progFill.style.width=p+"%";tx(progPct,Math.round(p)+"%");
      };
      const timeBar=mk("div",{display:"none",alignItems:"center",justifyContent:"center",gap:"7px",background:C.bg1,border:`1px solid ${C.border}`,borderRadius:"8px",padding:"5px 10px"});
      const timeIco=mk("span",{fontSize:"10px",opacity:".7"});tx(timeIco,"⏱");
      const timeLbl=mk("span",{fontSize:"9px",fontWeight:"700",letterSpacing:".05em",textTransform:"uppercase",color:C.muted});tx(timeLbl,"Generation time");
      const timeVal=mk("span",{fontSize:"11px",fontWeight:"700",color:C.lime,fontVariantNumeric:"tabular-nums"});tx(timeVal,"0s");
      timeBar.append(timeIco,timeLbl,timeVal);
      const _updateTimeBar=(key)=>{
        const t=_genTimeByFile[key];
        if(t){
          tx(timeVal,fmtDur(t));
          timeBar.style.display="flex";
          return;
        }
        timeBar.style.display="none";
        _fetchTimeFromHistory(key).then(t=>{
          if(t && _curItem && mediaKey(_curItem)===key){
            _genTimeByFile[key]=t;
            tx(timeVal,fmtDur(t));
            timeBar.style.display="flex";
          }
        });
      };
      const showTime=(ms)=>{
        if(ms>0&&_activeShownFiles.length){
          const lastShown=_activeShownFiles[_activeShownFiles.length-1];
          _genTimeByFile[lastShown]=ms;
        }
        if(_curItem) _updateTimeBar(mediaKey(_curItem));
      };
      const galleryBox=mk("div",{display:"flex",gap:"8px",overflowX:"auto",paddingBottom:"4px",scrollbarWidth:"thin"});
      const galleryHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"6px",padding:"2px 0 5px"});
      const galleryFoldHdr=mk("div",{display:"flex",alignItems:"center",gap:"6px",cursor:"pointer",userSelect:"none"});
      const galleryTitle=mk("div",{fontSize:"9px",fontWeight:"700",letterSpacing:".1em",textTransform:"uppercase",color:C.muted});
      tx(galleryTitle,"Outputs");
      const outputsChev=mk("span",{fontSize:"9px",color:C.dim,flexShrink:"0"});
      tx(outputsChev,"▾");
      galleryFoldHdr.append(galleryTitle,outputsChev);
      galleryFoldHdr.title="Collapse the outputs strip to give the preview more room. Your choice is remembered.";
      const galleryRefresh=mk("button",{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"6px",padding:"0 10px",height:"22px",fontSize:"8px",fontWeight:"700",letterSpacing:".04em",textTransform:"uppercase",color:C.muted,cursor:"pointer",outline:"none",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"border-color .15s, color .15s"});
      tx(galleryRefresh,"Refresh");
      galleryRefresh.onmouseenter=()=>{galleryRefresh.style.borderColor=C.lime;galleryRefresh.style.color=C.lime;};
      galleryRefresh.onmouseleave=()=>{galleryRefresh.style.borderColor=C.border;galleryRefresh.style.color=C.muted;};
      galleryRefresh.onclick=()=>_loadGallery();
      const galleryActs=mk("div",{display:"flex",gap:"5px",alignItems:"center"});
      const actBtn=(l,cb,opts={})=>{
        const b=mk("button",{}, {type:"button",className:"h3-actbtn"+(opts.danger?" danger":"")+(opts.warn?" warn":"")+(opts.on?" on":"")});
        if(opts.icon) b.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${opts.icon}</svg>`;
        b._lbl=mk("span",{}, {textContent:l});
        b.appendChild(b._lbl);
        if(opts.title) b.title=opts.title;
        b.onclick=cb;
        return b;
      };
      const ICON_FAV='<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>';
      const ICON_OPEN='<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>';
      const ICON_UP='<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>';
      const ICON_DEL='<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>';
      const ICON_REFRESH='<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>';
      const upBtn=actBtn("2x Upscale",()=>_runUpscale(),{icon:ICON_UP});
      const upFactorWrap=mk("div",{width:"74px",flexShrink:"0"});
      const upFactorDD=DD(["2x","3x","4x"],S.upscaleFactor+"x",v=>{
        S.upscaleFactor=parseInt(v)||2;
        tx(upBtn._lbl,S.upscaleFactor+"x Upscale");
        persist();_updUpBtnTitle();
      });
      upFactorWrap.appendChild(upFactorDD.el);
      const upTrig=upFactorDD.el.firstChild;
      upTrig.style.width="74px";
      upTrig.style.height="26px";
      upTrig.style.borderRadius="8px";
      upTrig.style.background="linear-gradient(180deg,#2b2b2b,#1e1e1e)";
      upTrig.style.border="1px solid var(--h3-line2)";
      upTrig.style.borderBottomColor="#141414";
      upTrig.style.boxShadow="inset 0 1px 0 rgba(255,255,255,.07), 0 1px 3px rgba(0,0,0,.45)";
      upTrig.style.padding="0 8px";
      upTrig.style.justifyContent="center";
      upTrig.lastChild.style.marginLeft="3px";
      upTrig.onmouseenter=()=>{ upTrig.style.borderColor="var(--h3accent)"; };
      upTrig.onmouseleave=()=>{ if(upTrig.style.borderColor!=="var(--h3accent)") upTrig.style.borderColor="var(--h3-line2)"; };
      const _updUpMethodLbl=()=>{ tx(upTrig.firstChild,S.upscaleMethod==="rtx"?"RTX":"SeedVR2"); };
      const _updUpBtnTitle=()=>{
        _updUpMethodLbl();
        const rtx=S.upscaleMethod==="rtx";
        if(rtx){
          upBtn.title="Upscale "+S.upscaleFactor+"x via RTX VSR\nNo model needed - uses your GPU's super resolution";
          upBtn.classList.remove("warn");
          return;
        }
        const d=S.models.upscaleDit, v=S.models.upscaleVae;
        if(d&&d!=="none"&&v&&v!=="none"){
          upBtn.title="Upscale "+S.upscaleFactor+"x via SeedVR2\nDiT: "+d+"\nVAE: "+v;
          upBtn.classList.remove("warn");
        }else{
          upBtn.title="Upscale via SeedVR2\nNo upscale model selected - open Settings";
          upBtn.classList.add("warn");
        }
      };
      galleryActs.append(
        actBtn("Favorite",()=>_favCurrent(),{icon:ICON_FAV}),
        actBtn("Open",()=>_openCurrent(),{icon:ICON_OPEN}),
        upBtn,upFactorWrap,
        actBtn("Delete",()=>_delCurrent(),{icon:ICON_DEL,danger:true})
      );
      const saveTogBtn=mk("button",{}, {type:"button",className:"h3-actbtn"+(S.autoSave?" on":"")});
      saveTogBtn._lbl=mk("span",{}, {textContent:S.autoSave?"Save On":"Save Off"});
      saveTogBtn.appendChild(saveTogBtn._lbl);
      saveTogBtn.title="Auto-save videos to your ComfyUI output folder. Off = preview only (temp files, cleaned on restart).";
      saveTogBtn.onclick=()=>{
        S.autoSave=!S.autoSave;persist();
        saveTogBtn.classList.toggle("on",S.autoSave);
        tx(saveTogBtn._lbl,S.autoSave?"Save On":"Save Off");
      };
      let _taeFound=false;
      let _taeChecked=false;
      let _taeFiles=[];
      const _checkTae=async()=>{
        let files=[];
        try{
          const r=await fetch("/h3one/tae_status");
          const d=await r.json();
          files=Array.isArray(d.files)?d.files:[];
        }catch(e){ files=[]; }
        _taeFiles=files;
        if(files.length&&!files.includes(S.models.tae)){
          S.models.tae=files.includes("taeh3.safetensors")?"taeh3.safetensors":files[0];
          persist();
          if(modelDDs.tae) modelDDs.tae.set(S.models.tae);
        }
        _taeFound=files.includes(S.models.tae);
        _taeChecked=true;
        if(modelDDs.tae) modelDDs.tae.updateItems(files.length?files:["taeh3.safetensors"]);
        _syncLiveToggle();
      };
      const liveTogWrap=mk("div",{display:"flex",gap:"4px",alignItems:"center",flexShrink:"0",alignSelf:"center",marginLeft:"8px"});
      const liveTogBtn=mk("button",{}, {type:"button",className:"h3-actbtn"+(S.livePreview?" on":"")});
      liveTogBtn._lbl=mk("span",{}, {textContent:S.livePreview?"Preview On":"Preview Off"});
      liveTogBtn.appendChild(liveTogBtn._lbl);
      const liveInfo=infoIcon("Live Preview: the clip plays in the preview box while it samples, powered by KJNodes Model Preview Override with the tiny TAEH3 decoder.\nNeeds ComfyUI-KJNodes and taeh3.safetensors in a ComfyUI models/vae_approx folder - download it from huggingface.co/Kijai/MiniMax-H3-TAE. If your copy lives in a subfolder, pick it under Settings: Live Preview decoder.\nThe dropdown picks preview size and frame count. Fast is the lightest, Detailed looks best but slows generation the most.\nNot available with the Turbo preset or in Image mode.");
      const lpModeSel=mk("select",{height:"20px",borderRadius:"8px",background:"#1a1a1a",color:"#c9c9c9",border:"1px solid var(--h3-line2)",fontSize:"9px",padding:"0 4px",cursor:"pointer",outline:"none"});
      Object.keys(LP_PRESETS).forEach(k=>{
        const o=mk("option",{}, {value:k,textContent:LP_PRESETS[k].label});
        lpModeSel.appendChild(o);
      });
      lpModeSel.value=(S.livePreviewMode&&LP_PRESETS[S.livePreviewMode])?S.livePreviewMode:"balanced";
      lpModeSel.title="Live Preview quality. Fast: 384px, 6 frames, lightest. Balanced: 512px, 10 frames. Detailed: 768px, 10 frames, heaviest.";
      lpModeSel.onchange=()=>{ S.livePreviewMode=lpModeSel.value; persist(); };
      _syncLiveToggle=()=>{
        const hidden=S.mode==="image";
        liveTogWrap.style.display=hidden?"none":"flex";
        const blocked=(S.quality==="turbo"&&S.mode!=="chain"&&S.mode!=="image");
        if(blocked){
          liveTogBtn.classList.remove("on");
          liveTogBtn.style.opacity=".45";liveTogBtn.style.pointerEvents="none";
          liveTogBtn.title="Live Preview is not available with the Turbo preset. Pick another quality preset first.";
          return;
        }
        liveTogBtn.style.opacity="";liveTogBtn.style.pointerEvents="";
        liveTogBtn.classList.toggle("on",!!S.livePreview);
        tx(liveTogBtn._lbl,S.livePreview?"Preview On":"Preview Off");
        if(S.livePreview){
          if(!_taeChecked) liveTogBtn.title="Live Preview is on. Checking for the TAEH3 decoder...";
          else if(!_taeFound){
            liveTogBtn.classList.add("warn");
            liveTogBtn.title=`Live Preview is on but the decoder "${S.models.tae}" was not found in a ComfyUI models/vae_approx folder. Open Settings to pick a Live Preview decoder, download taeh3.safetensors from huggingface.co/Kijai/MiniMax-H3-TAE, or turn Live Preview off.`;
          } else {
            liveTogBtn.classList.remove("warn");
            liveTogBtn.title="Live Preview is on. Generation takes a little longer but you see the video while it samples.";
          }
        } else {
          liveTogBtn.classList.remove("warn");
          liveTogBtn.title="Approximate live preview while sampling. Slows generation a little. Needs taeh3.safetensors in models/vae_approx.";
        }
      };
      liveTogBtn.onclick=async()=>{
        if(!_taeChecked) await _checkTae();
        S.livePreview=!S.livePreview;
        persist();
        _syncLiveToggle();
      };
      liveTogWrap.append(liveTogBtn,lpModeSel,liveInfo);
      _syncLiveToggle();
      _checkTae();
      galleryRefresh.style.height="26px";
      galleryRefresh.style.borderRadius="8px";
      galleryRefresh.style.background="linear-gradient(180deg,#2b2b2b,#1e1e1e)";
      galleryRefresh.style.border="1px solid var(--h3-line2)";
      galleryRefresh.style.borderBottomColor="#141414";
      galleryRefresh.style.boxShadow="inset 0 1px 0 rgba(255,255,255,.07), 0 1px 3px rgba(0,0,0,.45)";
      galleryRefresh.style.fontSize="9.5px";
      galleryRefresh.innerHTML=`<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_REFRESH}</svg>`+`<span style="margin-left:5px;">Refresh</span>`;
      galleryHdr.append(galleryFoldHdr,saveTogBtn,galleryRefresh,galleryActs);
      const galleryWrap=mk("div",{display:"flex",flexDirection:"column",gap:"7px"});
      galleryWrap.append(galleryHdr,galleryBox);
      rightPanel.append(previewBox,timeBar,galleryWrap);

      let _galItems=[];
      let _curItem=null;
      const _showVideo=(item,fromFinish)=>{
        _curItem=item;
        if(_cmpMode) _exitCompare();
        const imageCompare=S.mode==="image"&&["edit","refmix"].includes(S.imgSub)&&_cmpImageRefs.length>0&&_isImageItem(item);
        const upscaleCompare=!!(_upResult&&mediaKey(item)===_upResult.media_key);
        cmpBtn.style.display=imageCompare||upscaleCompare?"block":"none";
        cmpSourceSelect.style.display="none";
        resolutionChip.style.display="none";
        const vtype=item.type||"output";
        const isImgPreview=item.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(item.filename||"");
        const url=isImgPreview?api.apiURL(`/h3one/thumb?${thumbQuery(item,1600,vtype)}`):api.apiURL(`/view?${viewQuery(item,vtype)}`);
        if(isImgPreview){
          vidEl.style.display="none";vidEl.pause();vidEl.src="";
          imgEl.onload=()=>_updateResolutionChip(item.width||imgEl.naturalWidth,item.height||imgEl.naturalHeight);
          imgEl.src=url;imgEl.style.display="block";
          placeholder.style.display="none";errorBox.style.display="none";
          const _pvKey=mediaKey(item);
          _updateSeedChip(_pvKey);
          if(_seedByFile[_pvKey]===undefined) _showSeedFromHistory(_pvKey);
          _updateTimeBar(_pvKey);
          return;
        }
        vidEl.onloadedmetadata=()=>_updateResolutionChip(vidEl.videoWidth,vidEl.videoHeight);
        vidEl.controls=true;vidEl.muted=false;vidEl.loop=false;
        vidEl.src=url;vidEl.style.display="block";imgEl.style.display="none";
        placeholder.style.display="none";errorBox.style.display="none";
        const _pvKey=mediaKey(item);
        _updateSeedChip(_pvKey);
        if(_seedByFile[_pvKey]===undefined) _showSeedFromHistory(_pvKey);
        _updateTimeBar(_pvKey);
        if(fromFinish&&S.playOnFinish===false){
          vidEl.muted=false;
          vidEl.load();
          vidEl.pause();
          const seek0=()=>{try{vidEl.currentTime=0;}catch(e){}};
          vidEl.addEventListener("loadedmetadata",seek0,{once:true});
          return;
        }
        vidEl.muted=false;
        vidEl.play().catch(()=>{ vidEl.muted=true; vidEl.play().catch(()=>{}); });
      };
      const _stageVideoForExtend=async(item,selectMode=true)=>{
        if(!item||item.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(item.filename||"")) return;
        try{
          const stage=await fetch("/h3one/stage_input",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:item.filename,subfolder:item.subfolder||""})});
          const sd=await stage.json();
          if(!sd.ok) throw new Error(sd.error||"Could not copy the video to the input folder");
          S.extendVideo=sd.name;
          persist();
          exSlot._restorePreview(sd.name);
          if(libraryOverlay.style.display!=="none"){ libLightbox.style.display="none"; closeOverlayFade(libraryOverlay); }
          if(selectMode) _switchMode("extend");
        }catch(e){
          showError("Could not send video to Extend: "+fmtErr(e));
        }
      };
      const _favCurrent=async()=>{
        if(!_curItem) return;
        const nf=!_curItem.favorite;
        await fetch("/h3one/favorite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:_curItem.filename,subfolder:_curItem.subfolder||"",type:_curItem.type||"output",favorite:nf})}).catch(()=>{});
        _loadGallery();
      };
      const _openCurrent=()=>{
        if(!_curItem) return;
        fetch("/h3one/open_folder",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:_curItem.filename,subfolder:_curItem.subfolder||""})}).catch(()=>{});
      };
      const _delCurrent=async()=>{
        if(!_curItem) return;
        if(!confirm("Delete "+_curItem.filename+"?")) return;
        await fetch("/h3one/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:_curItem.filename,subfolder:_curItem.subfolder||""})}).catch(()=>{});
        vidEl.src="";vidEl.style.display="none";imgEl.src="";imgEl.style.display="none";placeholder.style.display="flex";
        _curItem=null;
        _loadGallery();
      };
      const _runUpscale=async()=>{
        if(!_curItem||S.generating) return;
        const rtx=S.upscaleMethod==="rtx";
        if(!rtx && (!S.models.upscaleDit||S.models.upscaleDit==="none"||!S.models.upscaleVae||S.models.upscaleVae==="none")){
          resetBtn();
          showError("Upscale needs a SeedVR2 model. Open Settings, then pick an Upscale DiT model + Upscale VAE - or switch the Upscale method to RTX VSR, which needs no model.");
          return;
        }
        _upscaleRun=rtx?"upscale-rtx":"upscale-seedvr2";
        _upOrig=_curItem?{filename:_curItem.filename,subfolder:_curItem.subfolder||""}:null;
        S.generating=true;
        _activeGenStartTs=Date.now();
        _activeShowTime=showTime;
        _activeShowLatest=showLatest;
        _activeShownFiles=[];
        genBtn.disabled=true;tx(genBtnLbl,"Upscaling...");
        progWrap.style.display="flex";setStage("Preparing upscale...",3);
        try{
          const stage=await fetch("/h3one/stage_input",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:_curItem.filename,subfolder:_curItem.subfolder||""})});
          const sd=await stage.json();
          if(!sd.ok) throw new Error(sd.error||"Could not prepare the video for upscale");
          const wf=await _fetchTpl(rtx?"upscale_rtx.json":"upscale.json");
          wf["1"].inputs.file=sd.name;
          if(rtx){
            let srcW=0,srcH=0;
            if(_curItem.width>0&&_curItem.height>0){ srcW=_curItem.width;srcH=_curItem.height; }
            else{
              try{
                const dr=await fetch(`/h3one/dims?${viewQuery(_curItem)}`);
                const dd=await dr.json();
                if(dd&&dd.ok){ srcW=dd.width||0;srcH=dd.height||0; }
              }catch(e){}
            }
            const target=planUpscaleTarget(srcW,srcH,S.upscaleFactor);
            if(target){
              wf["3"].inputs["resize_type"]="target dimensions";
              wf["3"].inputs["resize_type.width"]=target.width;
              wf["3"].inputs["resize_type.height"]=target.height;
            }else{
              wf["3"].inputs["resize_type.scale"]=S.upscaleFactor;
            }
          }else{
            wf["3"].inputs.model=S.models.upscaleDit;
            wf["4"].inputs.model=S.models.upscaleVae;
            const resMap={2:1080,3:1440,4:2160};
            wf["5"].inputs.resolution=resMap[S.upscaleFactor]||1080;
            wf["5"].inputs.max_resolution=4096;
          }
          if(_isImageItem(_curItem)){
            const upId=rtx?"3":"5";
            const saveId=String(parseInt(upId)+100);
            delete wf[rtx?"4":"6"];
            delete wf[rtx?"5":"7"];
            wf[saveId]={class_type:"SaveImage",inputs:{images:[upId,0],filename_prefix:"one-node-minimax-h3/h3_upscaled"}};
          }
          _applyAutoSave(wf);
          const body={prompt:wf,client_id:api.clientId,extra_data:{enable_previews:true}};
          const res=await api.fetchApi("/prompt",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
          const data=await res.json();
          if(data.error||!data.prompt_id) throw new Error(data.error?.message||"Unknown error");
          _batchIds=[data.prompt_id];_batchDone=0;_batchFailures=0;_settledBatchIds.clear();_expectedBatchCount=1;_batchSubmissionOpen=false;_activePromptId=data.prompt_id;
          _armFinishWatch();
          setStage(rtx?("Upscaling "+S.upscaleFactor+"x with RTX VSR..."):("Upscaling "+S.upscaleFactor+"x with SeedVR2 ("+S.models.upscaleDit+")..."),8);
        }catch(e){
          resetBtn();showError(fmtErr(e));
        }
      };
      const _loadGallery=async()=>{
        galleryBox.innerHTML="";
        try{
          const r=await fetch("/h3one/gallery");
          const d=await r.json();
          _galItems=d.videos||[];
        }catch(e){ _galItems=[]; }
        if(!_galItems.length){
          const empty=mk("div",{fontSize:"9px",color:C.muted,padding:"6px 0"});
          tx(empty,"No outputs yet.");
          galleryBox.appendChild(empty);return;
        }
        _galItems.slice(0,30).forEach(item=>{
          const card=mk("div",{width:"96px",flexShrink:"0",cursor:"pointer",background:C.bg1,border:`1px solid ${C.border}`,borderRadius:"7px",overflow:"hidden"});
          const isImg=item.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(item.filename||"");
          const url=isImg?api.apiURL(`/h3one/thumb?${thumbQuery(item,256)}`):api.apiURL(`/view?${viewQuery(item)}`);
          const v=isImg
            ? mk("img",{width:"100%",height:"54px",objectFit:"cover",display:"block",background:"#000",pointerEvents:"none"},{src:url})
            : mk("video",{width:"100%",height:"54px",objectFit:"cover",display:"block",background:"#000",pointerEvents:"none"},{muted:true,preload:"metadata"});
          if(!isImg) v.src=url;
          const name=mk("div",{fontSize:"8px",color:C.muted,padding:"3px 5px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"});
          tx(name,(item.favorite?"* ":"")+item.filename);
          if(item.favorite) name.style.color=C.lime;
          card.append(v,name);
          card.onclick=()=>_showVideo(item);
          attachOutputContextMenu(card,item,{isVideo:!isImg,onExtend:_stageVideoForExtend});
          card.onmouseenter=()=>card.style.borderColor=C.lime;
          card.onmouseleave=()=>card.style.borderColor=C.border;
          galleryBox.appendChild(card);
        });
      };
      self._h3_showQueued=(item)=>{
        _showVideo(item,true);
        _loadGallery();
      };

      // -- GENERATE ROW ------------------------------------------------------
      const genRow=mk("div",{display:"flex",gap:"0",alignItems:"stretch",width:"100%",boxSizing:"border-box"});
      const genBtn=mk("button",{
        background:"linear-gradient(120deg,var(--h3accent),#e8d5c0)",color:"#141414",border:"none",borderRadius:"10px",
        padding:"0",height:"42px",fontSize:"13px",fontWeight:"800",
        cursor:"pointer",flex:"1",letterSpacing:".06em",
        display:"flex",alignItems:"center",justifyContent:"center",gap:"9px",
        transition:"filter .15s,background .3s,color .3s,transform .1s",
        outline:"none",position:"relative",overflow:"hidden",
      });
      genBtn.innerHTML=`<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
      const genBtnLbl=mk("span",{}, {textContent:"Generate"});
      const genKbd=mk("span",{fontSize:"9px",fontWeight:"700",opacity:".65",border:"1px solid rgba(0,0,0,.25)",borderRadius:"4px",padding:"1px 5px"}, {textContent:"Space"});
      genBtn.append(genBtnLbl,genKbd);
      const stopBtn=mk("button",{background:"transparent",border:`1px solid ${C.border}`,borderRadius:"8px",color:C.muted,fontSize:"12px",cursor:"pointer",maxWidth:"0",minWidth:"0",width:"0",opacity:"0",padding:"0",height:"42px",transition:"max-width .25s ease, opacity .25s ease, padding .25s ease",outline:"none",overflow:"hidden",flexShrink:"0",whiteSpace:"nowrap"});
      tx(stopBtn,"Stop");
      stopBtn.onmouseenter=()=>{stopBtn.style.borderColor=C.err;stopBtn.style.color=C.err;};
      stopBtn.onmouseleave=()=>{stopBtn.style.borderColor=C.border;stopBtn.style.color=C.muted;};
      genRow.append(genBtn,liveTogWrap,stopBtn);

      // -- QUEUE ROW: append a job without taking over the run state ----------
      const QUEUE_LABEL="+ Queue";
      const _qBorder="rgba(var(--h3accent-rgb), .4)";
      const _qBg="linear-gradient(180deg,#262626,#1a1a1a)";
      const _qBgH="linear-gradient(180deg,#2d2d2d,#1f1f1f)";
      const queueBtn=mk("button",{
        display:"inline-flex",alignItems:"center",justifyContent:"center",gap:"7px",
        background:_qBg,border:`1px solid ${_qBorder}`,borderRadius:"9px",
        color:C.lime,fontSize:"12px",fontWeight:"700",cursor:"pointer",height:"36px",
        padding:"0 12px",outline:"none",flex:"1",minWidth:"0",whiteSpace:"nowrap",
        boxSizing:"border-box",boxShadow:"inset 0 1px 0 rgba(255,255,255,.05)",
        transition:"border-color .15s, background .15s, box-shadow .15s, transform .1s",
      },{type:"button",title:"Add this job to ComfyUI's queue. If nothing is running it starts right away with progress here; when something is busy it stacks behind and the badge shows how many are left. Queued results land in the Library; queued jobs are not recorded in History and Stop does not cancel them."});
      const queueLbl=mk("span",{}, {textContent:QUEUE_LABEL});
      queueBtn.append(queueLbl);
      queueBtn.onmouseenter=()=>{
        queueBtn.style.borderColor=C.lime;
        queueBtn.style.background=_qBgH;
        queueBtn.style.boxShadow=`inset 0 1px 0 rgba(255,255,255,.07), 0 0 0 1px rgba(var(--h3accent-rgb),.25), 0 2px 10px rgba(var(--h3accent-rgb),.18)`;
        queueBtn.style.transform="translateY(-1px)";
      };
      queueBtn.onmouseleave=()=>{
        queueBtn.style.borderColor=_qBorder;
        queueBtn.style.background=_qBg;
        queueBtn.style.boxShadow="inset 0 1px 0 rgba(255,255,255,.05)";
        queueBtn.style.transform="";
      };
      let _queueBusy=false;
      let _queueFlashToken=0;
      const queueFlash=(t)=>{
        const tok=++_queueFlashToken;
        tx(queueLbl,t);
        queueLbl.style.color=(t==="failed")?C.err:C.lime;
        setTimeout(()=>{ if(_queueFlashToken===tok){ tx(queueLbl,QUEUE_LABEL); queueLbl.style.color=C.lime; } },1400);
      };
      queueBtn._flash=queueFlash;
      _activeQueueBtn=queueBtn;
      queueBtn.onclick=async()=>{
        if(_queueBusy||_workflowBuildBusy) return;
        if(!S.generating&&!_queuedJobs.size){ genBtn.click(); return; }
        _queueBusy=true;
        _workflowBuildBusy=true;
        root.style.pointerEvents="none";
        const queuedMode=S.mode;
        queueBtn.disabled=true;
        try{
          if(_uploadsPending>0){
            let _wait=0;
            while(_uploadsPending>0&&_wait<200){
              await new Promise(res=>setTimeout(res,100));
              _wait++;
            }
            if(_uploadsPending>0) throw new Error("An upload is still in progress. Wait for it to finish, then queue again.");
          }
          if(S.randomizeSeed){ S.seed=Math.floor(Math.random()*(H3_SEED_MAX+1)); seedNI._inp.value=String(S.seed); }
          const wf=await _buildWorkflow();
          const res=await api.fetchApi("/prompt",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(queuePromptPayload(wf,api.clientId))});
          if(!res.ok) throw new Error("queue failed (HTTP "+res.status+")");
          let data=null;
          try{ data=await res.json(); }catch(e){ data=null; }
          if(!data||data.error||!data.prompt_id){
            throw new Error(data&&data.error?fmtErr(data.error):"queue returned no prompt id");
          }
          _queuedJobs.set(data.prompt_id,{mode:queuedMode,node:self});
          _renderQueueBadge();
          _armQueueSync();
          queueBtn.title="Job queued. It runs after the current job; results land in the Library.";
          queueFlash("queued");
        }catch(e){
          queueBtn.title="Queue failed: "+fmtErr(e);
          console.warn("[H3One] queue:",e);
          queueFlash("failed");
        }finally{
          _queueBusy=false;
          _workflowBuildBusy=false;
          root.style.pointerEvents="";
          queueBtn.disabled=false;
        }
      };
      const queueBadge=mk("div",{
        display:"none",alignItems:"center",background:C.bg2,border:`1px solid rgba(var(--h3accent-rgb), .25)`,
        borderRadius:"8px",color:C.lime,fontSize:"10px",fontWeight:"700",height:"36px",
        padding:"0 10px",flexShrink:"0",boxSizing:"border-box",whiteSpace:"nowrap",
        maxWidth:"220px",overflow:"hidden",textOverflow:"ellipsis",
      });
      _activeQueueBadge=queueBadge;
      const queueRow=mk("div",{display:"flex",alignItems:"center",gap:"6px",width:"100%",boxSizing:"border-box"});
      queueRow.append(queueBtn,queueBadge);
      _renderQueueBadge();

      const resetBtn=()=>{
        S.generating=false;
        _batchIds=[];_batchDone=0;_batchFailures=0;_settledBatchIds.clear();_expectedBatchCount=0;_batchSubmissionOpen=false;
        _stopFinishWatch();
        _upscaleRun="";
        self._h3_lpOn=false;
        _showLiveChip(false);
        genBtn.disabled=false;
        tx(genBtnLbl,"Generate");
        genBtn.style.background="linear-gradient(120deg,var(--h3accent),#e8d5c0)";genBtn.style.backgroundSize="";
        genBtn.style.animation="none";genBtn.style.color="#141414";
        stopBtn.style.maxWidth="0";stopBtn.style.minWidth="0";stopBtn.style.width="0";stopBtn.style.opacity="0";stopBtn.style.padding="0";stopBtn.style.marginLeft="0";
        progWrap.style.display="none";progFill.style.width="0%";
      };
      const showError=(msg)=>{
        errorBox.style.display="flex";
        errorBox.innerHTML="";
        resolutionChip.style.display="none";
        const title=mk("div",{fontSize:"12px",fontWeight:"700",color:C.err,letterSpacing:".02em",marginBottom:"6px"});
        tx(title,"Something went wrong");
        const body=mk("div",{fontSize:"11px",color:C.text,lineHeight:"1.6",whiteSpace:"pre-wrap",wordBreak:"break-word",maxWidth:"100%"});
        tx(body,fmtErr(msg));
        errorBox.append(title,body);
        vidEl.style.display="none";imgEl.style.display="none";placeholder.style.display="none";
      };
      _h3ShowError=showError;
      const _captureRunMeta=()=>{
        const maskCrop=_effectiveMaskCropPlan();
        return {
          mode:S.mode,quality:S.quality,prompt:S.prompt,duration:S.duration,resolution:S.resolution,seed:S.seed,
          autoStage:S.autoStage,imgLastW:S.imgLastW,imgLastH:S.imgLastH,
          maskVideoSize:S.maskVideoSize?{width:S.maskVideoSize.width,height:S.maskVideoSize.height}:null,
          maskCrop,
        };
      };
      const showOutput=(item,runMeta=null)=>{
        errorBox.style.display="none";
        const _soKey=mediaKey(item);
        const genMs=Date.now()-_activeGenStartTs;
        _genTimeByFile[_soKey]=genMs;
        const wasUpscale=_upscaleRun;
        const run=wasUpscale?S:(runMeta||S);
        if(run.seed!==undefined&&run.seed!==null&&run.seed!=="") _seedByFile[_soKey]=run.seed;
        if(_upscaleRun&&_upOrig){
          _upResult={filename:item.filename,subfolder:item.subfolder||"",type:item.type||"output",media_key:_soKey};
        }
        _showVideo(item,true);
        if(_upResult&&_upResult.media_key===_soKey){
          cmpBtn.style.display="block";
        }
        _upscaleRun="";
        _activeShownFiles.push(_soKey);
        const isTemp=item.type==="temp";
        if(!isTemp){
          if(run.mode==="extend"&&!wasUpscale&&run.autoStage!==false) _stageVideoForExtend(item,false);
          fetch("/h3one/set_output",{method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({node_id:self.id,info:{filename:item.filename,subfolder:item.subfolder||"",type:item.type||"output"}})}).catch(()=>{});
          const histMode=wasUpscale?("Upscale "+S.upscaleFactor+"x ("+(wasUpscale==="upscale-rtx"?"RTX VSR":"SeedVR2")+")"):run.mode;
          const maskSource=run.maskVideoSize?`${run.maskVideoSize.width}x${run.maskVideoSize.height} source`:"source video";
          const maskCrop=run.maskCrop||{width:0,height:0,megapixels:.2};
          const histRes=wasUpscale?(S.upscaleFactor+"x upscale"):(run.mode==="image"?(run.imgLastW+"x"+run.imgLastH):(run.mode==="mask"?`${maskSource}, mask-shaped ${Number(maskCrop.megapixels).toFixed(2)}MP crop`:run.resolution));
           fetch("/h3one/history",{method:"POST",headers:{"Content-Type":"application/json"},
             body:JSON.stringify({
               mode:histMode,quality:wasUpscale?"":run.quality,prompt:(run.prompt||"").slice(0,2000),duration:wasUpscale?0:run.duration,
               resolution:histRes,seed:run.seed,gen_time:genMs,video:item.filename,subfolder:item.subfolder||"",type:item.type||"output",
               kind:item.kind==="image"?"image":"video",
             })}).catch(()=>{});
        }
        _loadGallery();
      };
      const _genTimeByFile={};
      const _seedByFile={};
      const _updateSeedChip=(key)=>{
        let seed=_seedByFile[key];
        if(seed===undefined||seed===null||seed===""){
          seedChip.style.display="none";
          return;
        }
        tx(seedChipVal,String(seed));
        seedChip.style.display="flex";
      };
      const _updateResolutionChip=(width,height)=>{
        if(!(width>0&&height>0)){
          resolutionChip.style.display="none";
          return;
        }
        tx(resolutionChipVal,`${width}×${height}`);
        resolutionChip.style.display="flex";
      };
      const _showSeedFromHistory=async(key)=>{
        try{
          const r=await fetch("/h3one/history");
          const d=await r.json();
          const hit=(d.items||[]).find(it=>it.media_key&&it.media_key===key);
          if(hit&&hit.seed!==undefined&&hit.seed!==null){
            _seedByFile[key]=hit.seed;
            _updateSeedChip(key);
          }
        }catch(e){}
      };
      const _fetchTimeFromHistory=async(key)=>{
        try{
          const r=await fetch("/h3one/history");
          const d=await r.json();
          const hit=(d.items||[]).find(it=>it.media_key&&it.media_key===key);
          return hit&&hit.gen_time? hit.gen_time : null;
        }catch(e){ return null; }
      };
      const showLatest=async()=>{
        if(_activeShownFiles.length) return;
        try{
          const r=await fetch("/h3one/gallery");
          const d=await r.json();
          const items=d.videos||[];
          if(!items.length) return;
          showOutput(items[0],_activeRunMetaByPrompt.get(_activePromptId));
        }catch(e){}
      };

      // -- WORKFLOW BUILDERS -------------------------------------------------
      const _fetchTimed=async(url,options={},timeout=15000)=>{
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),timeout);
        try{return await fetch(url,{...options,signal:controller.signal});}
        finally{clearTimeout(timer);}
      };
      const _fetchTpl=async(name)=>{
        const res=await _fetchTimed(`/h3one/workflow/${name}`);
        if(!res.ok) throw new Error("Failed to load workflow template: "+name);
        return await res.json();
      };

      const _finalPrompt=(userText,tplKey)=>{
        let text=(userText||"").trim();
        if(!text) return "";
        if(S.mode==="extend"){
          const airlock="Hold the exact closing framing of the source video for about 2 seconds - same camera, same subject position, same lighting and same motion - then continue seamlessly with no visible cut: ";
          if(text.includes("integrated_multimodal_description")){
            text=text.replace(/\[Shot 1\]\s*/i, "[Shot 1] "+airlock);
          }
        }
        let final;
        if(text.includes("integrated_multimodal_description")||text.includes("summary:")||text.includes("detailed_description:")){
          if(S.mode==="r2v"&&S.refAudios.length&&!text.includes("<Audio")){
            text=text.replace(/(retention_analysis:\s*)/i, "$1<Audio 1>: fully_copy - reused 1:1 as the target video's complete final audio track.\n");
            if(!/<Audio/.test(text.split("overall_soundscape:")[1]||"")){
              text=text.replace(/(overall_soundscape:\s*)/i, "$1The copied audio track <Audio 1> is the complete soundtrack. ");
            }
          }
          final=text;
        } else {
          const mode=tplKey||S.mode;
          const tpl=_discTmpl[mode==="chain"?"chain":mode]||{};
          const wrap=tpl.wrap;
          final=wrap?wrap.split("{USER}").join(text):text;
        }
        if(S.mode==="mask"&&S.maskAudioMode==="preserve") final=maskSpeechSyncPrompt(final);
        if(S.mode==="mask"&&S.maskAudioMode==="regenerate") final=final.replace(/Keep the source soundtrack unchanged\./gi,"Regenerate the soundtrack to match the replacement action inside the edited clip; do not copy the source soundtrack.");
        return final;
      };

      // -- Cache fingerprint + bust node -------------------------------------
      // ComfyUI's execution cache cannot see inside autogrow dicts
      // (ref_images / ref_audios ...), so a changed reference image/audio left
      // the cache signature unchanged and generation was served stale output.
      // H3CacheBust sits between the CLIP loader and the conditioning node and
      // invalidates everything downstream whenever any input that matters
      // (prompt, media names, media file CONTENT, seed, steps, geometry) changes.
      const _buildFingerprint=(extra)=>{
        const files=[];
        const add=(type,name)=>{ if(name) files.push({type,name}); };
        add("image",S.firstFrame); add("image",S.lastFrame);
        (S.refImages||[]).forEach(n=>add("image",n));
        (S.refVideos||[]).forEach(v=>{ const n=(typeof v==="string")?v:v&&v.name; add("video",n); });
        (S.refAudios||[]).forEach(n=>add("audio",n));
        add("audio",S.audioFile);
        add("video",S.extendVideo);
        add("video",S.maskVideo);
        add("image",S.maskSeed);
        (S.kf||[]).forEach(k=>add("image",k.img));
        if(Array.isArray(extra)) extra.forEach(f=>files.push(f));
        const res=_resolveRes();
        const fp={
          prompt:_finalPrompt(S.prompt),
          files,
          seed:S.seed||0,
          steps:S.steps,
          width:res.width,
          height:res.height,
          kf:(S.kf||[]).map(k=>({img:k.img||"",pos:Math.round(k.pos||0)})),
        };
        return JSON.stringify(fp);
      };

      const _insertCacheBust=(wf,fp)=>{
        const clipId=Object.keys(wf).find(id=>wf[id]&&wf[id].class_type==="CLIPLoader");
        if(!clipId) return;
        const bustId="499";
        wf[bustId]={class_type:"H3CacheBust",inputs:{clip:[clipId,0],fingerprint:fp||_buildFingerprint()},_meta:{title:"Cache Invalidation"}};
        Object.keys(wf).forEach(id=>{
          if(id===bustId) return;
          const n=wf[id];
          if(!n||!n.inputs) return;
          Object.keys(n.inputs).forEach(k=>{
            const v=n.inputs[k];
            if(Array.isArray(v)&&v.length===2&&v[0]===clipId&&v[1]===0) n.inputs[k]=[bustId,0];
          });
        });
      };

      const _insertModelPatches=(wf)=>{
        let modelSrc=["2",0];
        let nextId=100;
        const newId=()=>String(nextId++);
        const actives=S.loras.filter(l=>l.name&&l.enabled!==false);
        actives.forEach(lr=>{
          const id=newId();
          wf[id]={class_type:"LoraLoaderModelOnly",inputs:{model:modelSrc,lora_name:lr.name,strength_model:lr.strength},_meta:{title:"LoRA"}};
          modelSrc=[id,0];
        });
        const q=S.quality;
        let useSla=false;
        if(q==="turbo"){
          if(!S.speedLora) throw new Error("Turbo preset needs a Turbo LoRA - set one in Settings (Speed LoRA) or pick another quality.");
          {
            const tl=newId();
            wf[tl]={class_type:"MiniMaxH3TurboLoRA",inputs:{model:modelSrc,lora_name:S.speedLora,strength:1,low_vram:false},_meta:{title:"Turbo LoRA"}};
            modelSrc=[tl,0];
          }
          const ts=newId();
          wf[ts]={class_type:"MiniMaxH3TurboSampler",inputs:{},_meta:{title:"Turbo Sampler"}};
          wf["10"]=wf[ts];delete wf[ts];
          wf["9"].inputs.steps=S.steps||6;
        } else {
          const f=resolveQualityFlags(S.optSol,S.optSage,S.optKitchen,S.optSla);
          const useSol=f.sol, useSage=f.sage, useKitchen=f.kitchen;
          useSla=f.sla;
          const insSol=()=>{
            const sol=newId();
            wf[sol]={class_type:"SolAttnPatch",inputs:{
              model:modelSrc,tau:1.3,start_percent:0.2,end_percent:0.9,min_tokens:4096,
              int8_qk:true,sink_conditioning:"exact_kv_and_rows",morton:false,
              morton_curve:"2d_frame",int8_pv:true,verbose:true,use_tma:false,dense_blocks:"",
            },_meta:{title:"Sol-Attn"}};
            modelSrc=[sol,0];
          };
          const insSage=()=>{
            const sage=newId();
            wf[sage]={class_type:"MiniMaxH3MemoryEfficientSageAttentionPatch",inputs:{model:modelSrc},_meta:{title:"SageAttn"}};
            modelSrc=[sage,0];
          };
          const insKitchen=()=>{
            const kitchen=newId();
            wf[kitchen]={class_type:"ModelAttentionBackend",inputs:{model:modelSrc,attention:"comfy kitchen attention"},_meta:{title:"Kitchen"}};
            modelSrc=[kitchen,0];
          };
          if(useKitchen){
            // Kitchen replaces the attention function; Sol layers on top of it.
            if(useSage) insSage(); // defensive - UI never allows this pair
            insKitchen();
            if(useSol) insSol();
          } else if(useSage&&useSol){
            // Sol + Sage together: follow the tested ordering (sage -> sol)
            insSage();insSol();
          } else {
            // Preset combos keep their exact historical order (sol -> sage)
            if(useSol) insSol();
            if(useSage) insSage();
          }
          wf["9"].inputs.steps=S.steps;
        }
        wf["5"].inputs.model=modelSrc;
        if(useSla){
          // SLA Draft chain: pre-patches -> SigmaShift -> turbo LoRA -> AdaLN
          // LoRA Fix -> SLA, with SLA's output wired straight into the guider
          // and scheduler (nothing after it). The AdaLN fix ports dense LoRA
          // tensors (dareties etc.) onto the pruned base's curve form, so the
          // turbo LoRA actually applies. SLA needs a recent ComfyUI core
          // (comfy_api) and falls back to dense attention on kernel failure.
          if(!S.speedLora) throw new Error("SLA Draft needs a Turbo LoRA - set one in Settings (Speed LoRA) or pick another quality.");
          wf["5"].inputs.shift_video=(typeof S.shiftVideo==="number")?S.shiftVideo:8;
          wf["5"].inputs.shift_audio=(typeof S.shiftAudio==="number")?S.shiftAudio:3;
          const tl=newId();
          wf[tl]={class_type:"MiniMaxH3TurboLoRA",inputs:{model:["5",0],lora_name:S.speedLora,strength:(typeof S.speedLoraStrength==="number")?S.speedLoraStrength:0.8,low_vram:false},_meta:{title:"Turbo LoRA (SLA)"}};
          const fix=newId();
          wf[fix]={class_type:"H3AdaLNLoRAFix",inputs:{model:[tl,0],mode:"port"},_meta:{title:"AdaLN LoRA Fix"}};
          const sla=newId();
          wf[sla]={class_type:"H3SLAAttention",inputs:{
            model:[fix,0],sparsity_ratio:0.9,block_size:"64",min_seq_len:8192,
            dense_last_steps:0,protect_audio:true,enabled:true,
          },_meta:{title:"SLA Attention"}};
          wf["7"].inputs.model=[sla,0];
          wf["9"].inputs.model=[sla,0];
          if(q==="draft"){
            wf["9"].inputs.scheduler="simple";
            if(wf["10"]&&wf["10"].class_type==="KSamplerSelect") wf["10"].inputs.sampler_name="euler";
          }
        }
      };

      const _insertImageModelPatches=(wf)=>{
        let modelSrc=["3",0];
        let nextId=100;
        const newId=()=>String(nextId++);
        S.loras.filter(l=>l.name&&l.enabled!==false).forEach(lr=>{
          const id=newId();
          wf[id]={class_type:"LoraLoaderModelOnly",inputs:{model:modelSrc,lora_name:lr.name,strength_model:lr.strength},_meta:{title:"LoRA"}};
          modelSrc=[id,0];
        });
        wf["4"].inputs.model=modelSrc;
        wf["6"].inputs.model=["4",0];
      };

      const _applyAutoSave=(wf)=>{
        if(S.autoSave!==false) return;
        Object.keys(wf).forEach(id=>{
          const n=wf[id];
          if(n.class_type!=="SaveVideo") return;
          const src=(n.inputs.video||[])[0];
          const cv=src?wf[src]:null;
          if(cv&&cv.class_type==="CreateVideo"){
            wf[id]={class_type:"VHS_VideoCombine",inputs:{
              images:cv.inputs.images,
              frame_rate:(cv.inputs.fps!==undefined?cv.inputs.fps:24),
              loop_count:0,
              filename_prefix:"one-node-minimax-h3/preview",
              format:"video/h264-mp4",
              pingpong:false,
              save_output:false,
            },_meta:{title:"Preview (no save)"}};
            if(cv.inputs.audio!==undefined) wf[id].inputs.audio=cv.inputs.audio;
            delete wf[src];
          }
        });
      };

      const _patchCommon=(wf)=>{
        wf["1"].inputs.clip_name=S.models.clip;
        const condNode=wf["6"];
        const isR2V=condNode&&condNode.class_type==="MiniMaxH3ReferenceToVideo";
        wf["2"].inputs.unet_name= isR2V&&["r2v","audio_drive","mask"].includes(S.mode)? S.models.unetR2V : S.models.unetT2V;
        wf["3"].inputs.vae_name=S.models.vaeVideo;
        wf["4"].inputs.vae_name=S.models.vaeAudio;
        const res=_resolveRes();
        let frames=snapFrames(S.duration,S.fps);
        if(S.mode==="extend"){
          const plan=planExtend(S.duration,S.fps);
          frames=plan.targetLength;
          if(wf["18"]&&wf["18"].inputs&&wf["18"].class_type==="MiniMaxH3ExistingVideoMaskedContext"){
            wf["18"].inputs.context_length=plan.contextLength;
          }
        }
        condNode.inputs.prompt=_finalPrompt(S.prompt);
        condNode.inputs.width=res.width;
        condNode.inputs.height=res.height;
        condNode.inputs.length=frames;
        wf["8"].inputs.noise_seed=S.seed||0;
        wf["9"].inputs.steps=S.steps;
        wf["9"].inputs.scheduler=S.schedulerName||"simple";
        if(wf["10"]&&wf["10"].class_type==="KSamplerSelect") wf["10"].inputs.sampler_name=S.samplerName||"res_multistep";
        if(!S.audioOn && wf["14"] && ["t2v","i2v","r2v","keyframes"].includes(S.mode)){
          delete wf["14"].inputs.audio;
        }
        _insertModelPatches(wf);
        if(S.livePreview){
          const lpSet=(S.livePreviewMode&&LP_PRESETS[S.livePreviewMode])?LP_PRESETS[S.livePreviewMode]:LP_PRESETS.balanced;
          wf["lp"]={class_type:"ModelPreviewOverrideKJ",inputs:{
            model:wf["5"].inputs.model,
            max_resolution:lpSet.res,
            jpeg_quality:80,
            suppress_default_preview:true,
            preview_frames:lpSet.frames,
            preview_fps:12,
            tiny_vae:S.models.tae||"taeh3.safetensors",
          },_meta:{title:"Live Preview (Model Preview Override)"}};
          wf["5"].inputs.model=["lp",0];
        }
        _applyAutoSave(wf);
        _insertCacheBust(wf);
        patchOutputVideo(wf,S.fps);
        return {frames,res};
      };

      const _buildImage=async()=>{
        const sub=S.imgSub;
        const refs=sub==="t2i"?[]:(sub==="edit"?(S.imgEditSrc?[S.imgEditSrc]:[]):(S.imgRefs||[]).slice(0,9));
        if(sub==="edit"&&!refs.length) throw new Error("Image Edit needs a source image. Drop one into the source slot, or switch to Text to Image.");
        if(sub==="refmix"&&!refs.length) throw new Error("Reference Mix needs at least one reference image. Add images to the slots, or switch to Text to Image.");
        if(S.imgProfile!=="custom"&&IMG_PROFILE_LORAS[S.imgProfile]){
          const need=IMG_PROFILE_LORAS[S.imgProfile];
          if(!_M.loras.length){
            try{ const r=await fetch("/h3one/models"); const d=await r.json(); _M.loras=d.loras||[]; }catch(e){}
          }
          const have=(_M.loras||[]).some(n=>String(n).replace(/\\/g,"/").split("/").pop()===need);
          if(!have){
            throw new Error("This profile needs the LightX LoRA "+need+" inside ComfyUI/models/loras. Download it from the link in the README (Image mode section), then refresh - or pick a Base profile, those need no extra files.");
          }
        }
        if(!_M.text_encoders.length){
          try{ const r=await fetch("/h3one/models"); const d=await r.json(); _M.text_encoders=d.text_encoders||[]; }catch(e){}
        }
        const _imgNeedModels=[];
        for(const need of ["qwen3.5_2b_bf16.safetensors","qwen3.5_4b_bf16.safetensors"]){
          const have=(_M.text_encoders||[]).some(n=>String(n).replace(/\\/g,"/").split("/").pop()===need);
          if(!have) _imgNeedModels.push(need);
        }
        if(_imgNeedModels.length){
          throw new Error("Image mode needs the Qwen3.5 prompt models in ComfyUI/models/text_encoders: "+_imgNeedModels.join(" and ")+". Download links are in the README (Image mode section).");
        }
        const wf=await _fetchTpl(TEMPLATES.image);
        const _slash=s=>String(s||"").replace(/\\/g,"/");
        wf["1"].inputs.fl2va_model=_slash(S.models.unetT2V);
        wf["1"].inputs.ref2va_model=_slash(S.models.unetR2V);
        wf["1"].inputs.text_encoder=_slash(S.models.clip);
        wf["1"].inputs.video_vae=_slash(S.models.vaeVideo);
        const dir=wf["2"].inputs;
        dir.prompt=S.prompt||"";
        dir.mode=sub==="refmix"?"reference":"image";
        const customAspect=S.imgAspect==="Custom";
        const _imgPlan=customAspect
          ?planImageCanvas({mode:"custom",width:S.imgW,height:S.imgH})
          :planImageCanvas({mode:"ratio",aspect:S.imgAspect,megapixels:S.imgMP});
        const w=_imgPlan.width,h=_imgPlan.height;
        S.imgLastW=w;S.imgLastH=h;
        dir.width=w;dir.height=h;
        dir.aspect_ratio=customAspect?"custom":S.imgAspect;
        dir.megapixels=_imgPlan.megapixels;
        dir.seed=S.seed||0;
        wf["5"].inputs.noise_seed=["2",5];
        dir.sampling_profile=S.imgProfile==="custom"?"base_quality_20":(S.imgProfile||"base_quality_20");
        dir.frame_profile="recommended_5";
        dir.enhance_mode="off";
        dir.adherence=0.85;
        dir.route="auto";
        dir.studio_state="";
        if(S.imgProfile==="custom"){
          wf["4"]={class_type:"H3StudioSamplingSettings",inputs:{
            model:["3",0],sampler_name:S.samplerName||"res_multistep",scheduler:S.schedulerName||"simple",
            steps:S.steps||20,denoise:1.0,shift_video:12.0,shift_audio:3.0,beta_alpha:0.6,beta_beta:0.6,
          },_meta:{title:"Custom Sampling"}};
        }
        _insertImageModelPatches(wf);
        let nextId=200;
        const newId=()=>String(nextId++);
        refs.forEach((name,idx)=>{
          const n=idx+1;
          const id=newId();
          wf[id]={class_type:"LoadImage",inputs:{image:name},_meta:{title:"Ref Image "+n}};
          dir["media_"+n]=[id,0];
          dir["media_type_"+n]="image";
          dir["media_filename_"+n]=name;
          dir["role_"+n]="auto";
          dir["retention_"+n]="attribute_transfer";
        });
        return wf;
      };

      const _checkInputFile=async(type,name)=>{
        if(!name) return false;
        try{
          const r=await _fetchTimed(`/h3one/input_files?type=${type}`);
          if(!r.ok) throw new Error(`HTTP ${r.status}`);
          const d=await r.json();
          return inputFileExists(d.files,name);
        }catch(e){ throw new Error(`Could not verify the ${type} input "${name}": ${fmtErr(e)}`); }
      };
      const _checkInputFiles=async(type,names,label)=>{
        for(const name of names){
          const ok=await _checkInputFile(type,name);
          if(!ok) throw new Error(`The ${label} "${name}" is missing from ComfyUI's input folder. Drop it into the slot again to re-upload it.`);
        }
      };

      let _maskRuntimeReady=false;
      const _checkMaskRuntime=async()=>{
        if(!_maskRuntimeReady){
          const required=["H3MaskVideoPrepare","Video Slice","SAM3_VideoTrack","SAM3_TrackToMask","MVEx_MaskCleanup","MVEx_SubjectCrop","MVEx_MaskToLatentSpace","MVEx_LatentMaskToMask","MVEx_SubjectUncrop"];
          const checks=await Promise.all(required.map(async name=>{try{const r=await _fetchTimed(`/object_info/${encodeURIComponent(name)}`,{},8000);const d=await r.json();return !!(d&&d[name]);}catch(e){return false;}}));
          const missing=required.filter((_name,idx)=>!checks[idx]);
          if(missing.length) throw new Error("Mask mode is missing required nodes: "+missing.join(", ")+". Install MaskVidExperiments, restart ComfyUI, and hard refresh the browser.");
          _maskRuntimeReady=true;
        }
        if(!_M.checkpoints.length){
          try{const r=await _fetchTimed("/h3one/models");const d=await r.json();_M.checkpoints=d.checkpoints||[];}catch(e){}
        }
        const selected=String(S.models.sam3||"").replace(/\\/g,"/").toLowerCase();
        const exists=h3SamCheckpoints(_M.checkpoints).some(n=>String(n).replace(/\\/g,"/").toLowerCase()===selected);
        if(!exists) throw new Error("Mask mode needs a SAM 3.1 multiplex checkpoint. Install sam3.1_multiplex_fp16.safetensors in a ComfyUI checkpoints model folder, restart ComfyUI, then pick it under Settings.");
      };

      const _buildWorkflow=async()=>{
        const mode=S.mode;
        if(mode==="chain") return _buildChain();
        if(mode==="image") return _buildImage();
        const wf=await _fetchTpl(TEMPLATES[mode]);
        _patchCommon(wf);
        let nextId=200;
        const newId=()=>String(nextId++);
        if(mode==="i2v"){
          if(!S.firstFrame&&!S.lastFrame) throw new Error("I2V needs at least one image. Drop a First frame (animate from it), a Last frame (converge to it), or both (morph between them) - or switch to T2V mode.");
          if(S.firstFrame){
            const id=newId();
            wf[id]={class_type:"LoadImage",inputs:{image:S.firstFrame},_meta:{title:"First Frame"}};
            wf["6"].inputs.first_frame=[id,0];
          }
          if(S.lastFrame){
            const id2=newId();
            wf[id2]={class_type:"LoadImage",inputs:{image:S.lastFrame},_meta:{title:"Last Frame"}};
            wf["6"].inputs.last_frame=[id2,0];
          }
        } else if(mode==="r2v"){
          const hasRefs=S.refImages.length||S.refVideos.length||S.refAudios.length;
          if(!hasRefs) throw new Error("R2V needs at least one reference. Add a reference image, video or audio - or switch to T2V mode.");
          if(S.refImages.length){
            let firstImgId=null;
            S.refImages.forEach((name,idx)=>{
              const id=newId();
              wf[id]={class_type:"LoadImage",inputs:{image:name},_meta:{title:"Ref Image"}};
              wf["6"].inputs[`ref_images.ref_image_${idx}`]=[id,0];
              if(idx===0) firstImgId=id;
            });
            // Identity anchor: pin the first reference image as the frame-0
            // keyframe so the shot STARTS from it. Reference videos then provide
            // motion only - without this, a talking ref video outranks the still
            // image ~2:1 in the packed sequence and its face wins (verified).
            const kfId=newId();
            wf[kfId]={class_type:"H3IdentityAnchor",inputs:{
              conditioning:["6",0],
              vae:["3",0],
              latent:["6",1],
              frame_count:Number(wf["6"].inputs.length)||124,
              width:Number(wf["6"].inputs.width)||960,
              height:Number(wf["6"].inputs.height)||544,
              anchor:"first",
              image:[firstImgId,0],
            },_meta:{title:"Identity Anchor (frame 0)"}};
            wf["7"].inputs.conditioning=[kfId,0];
          }
          if(S.refVideos.length){
            S.refVideos.forEach((entry,idx)=>{
              const name=(typeof entry==="string")?entry:entry.name;
              const useAudio=!!(entry&&entry.useAudio);
              const lv=newId(),gc=newId();
              wf[lv]={class_type:"LoadVideo",inputs:{file:name,"video-preview":""},_meta:{title:"Ref Video"}};
              wf[gc]={class_type:"GetVideoComponents",inputs:{video:[lv,0]},_meta:{title:"Ref Video Components"}};
              wf["6"].inputs[`ref_videos.ref_video_${idx}`]=[gc,0];
              if(useAudio) wf["6"].inputs[`ref_video_audios.ref_video_audio_${idx}`]=[gc,1];
            });
          }
          if(S.refAudios.length){
            await _checkInputFiles("audio",S.refAudios,"reference audio");
            S.refAudios.forEach((name,idx)=>{
              const id=newId();
              wf[id]={class_type:"LoadAudio",inputs:{audio:name},_meta:{title:"Ref Audio"}};
              const trimId=newId();
              wf[trimId]={class_type:"H3AudioTrim",inputs:{audio:[id,0],trim_seconds:S.duration},_meta:{title:"Audio Trim"}};
              wf["6"].inputs[`ref_audios.ref_audio_${idx}`]=[trimId,0];
            });
          }
        } else if(mode==="audio_drive"){
          if(!S.audioFile) throw new Error("Audio Drive needs an audio track. Drop a file in the Audio track slot - the audio drives the mouth movements and timing.");
          await _checkInputFiles("audio",[S.audioFile],"audio track");
          wf["16"].inputs.audio=S.audioFile;
          {
            const trimId=newId();
            wf[trimId]={class_type:"H3AudioTrim",inputs:{audio:["16",0],trim_seconds:S.duration},_meta:{title:"Audio Trim"}};
            wf["6"].inputs["ref_audios.ref_audio_0"]=[trimId,0];
          }
          if(S.refImages.length){
            let firstImgId=null;
            S.refImages.forEach((name,idx)=>{
              const id=newId();
              wf[id]={class_type:"LoadImage",inputs:{image:name},_meta:{title:"Ref Image"}};
              wf["6"].inputs[`ref_images.ref_image_${idx}`]=[id,0];
              if(idx===0) firstImgId=id;
            });
            const kfId=newId();
            wf[kfId]={class_type:"H3IdentityAnchor",inputs:{
              conditioning:["6",0],
              vae:["3",0],
              latent:["6",1],
              frame_count:Number(wf["6"].inputs.length)||124,
              width:Number(wf["6"].inputs.width)||960,
              height:Number(wf["6"].inputs.height)||544,
              anchor:"first",
              image:[firstImgId,0],
            },_meta:{title:"Identity Anchor (frame 0)"}};
            wf["7"].inputs.conditioning=[kfId,0];
          }
        } else if(mode==="keyframes"){
          const totalFrames=snapFrames(S.duration,S.fps);
          const positions=[];
          let imgNum=0;
          S.kf.forEach((k)=>{
            if(!k.img) return;
            imgNum++;
            const id=newId();
            wf[id]={class_type:"LoadImage",inputs:{image:k.img},_meta:{title:`Keyframe ${imgNum}`}};
            wf["16"].inputs[`keyframe_image_${imgNum}`]=[id,0];
            positions.push(Math.max(1,Math.min(totalFrames,Math.round(k.pos))));
          });
          if(!positions.length) throw new Error("Keyframes mode needs at least one image. Drop an image into a keyframe slot, or switch to another mode.");
          const count=positions.length;
          wf["16"].inputs.keyframe_state=JSON.stringify({count,positions});
        } else if(mode==="extend"){
          if(!S.extendVideo) throw new Error("Extend needs a source video. Drop a file in the Video to extend slot, or switch to another mode.");
          wf["16"].inputs.file=S.extendVideo;
        } else if(mode==="mask"){
          if(!S.maskVideo) throw new Error("Mask mode needs a source video. Drop one into the Source video slot.");
          if(!S.maskSeed&&!String(S.maskTarget||"").trim()) throw new Error("Paint a first-frame mask or enter a Mask target for SAM 3 to track.");
          if(String(S.maskTarget||"").trim()&&Number(S.maskThreshold)>=0.9) throw new Error(maskDetectionHint(S.maskTarget,S.maskThreshold));
          if(!S.refImages.length) throw new Error("Mask mode needs at least one replacement reference image.");
          await _checkMaskRuntime();
          await _checkInputFiles("video",[S.maskVideo],"source video");
          if(S.maskSeed) await _checkInputFiles("image",[S.maskSeed],"painted mask");
          await _checkInputFiles("image",S.refImages,"replacement reference");
          wf["16"].inputs.file=S.maskVideo;
          const maskSeconds=Math.min(15,Math.max(.2,Number(S.duration)||5));
          wf["34"].inputs.duration=maskSeconds;
          wf["34"].inputs.start_time=Math.max(0,Number(S.maskStartTime)||0);
          wf["18"].inputs.max_seconds=maskSeconds;
          wf["18"].inputs.target_fps=24;
          wf["19"].inputs.ckpt_name=S.models.sam3;
          const maskTarget=String(S.maskTarget||"").trim();
          wf["20"].inputs.text=maskTarget;
          wf["21"].inputs.detection_threshold=Math.max(0,Math.min(1,Number(S.maskThreshold)||0));
          if(!maskTarget) delete wf["21"].inputs.conditioning;
          const tracking=maskTrackingPlan(S.maskSeed,maskTarget);
          wf["21"].inputs.max_objects=tracking.maxObjects;
          wf["22"].inputs.object_indices=tracking.objectIndices;
          let maskRegionId=null;
          if(S.maskSeed&&tracking.seedPaint){
            const loadMask=newId(),toMask=newId(),regionMask=newId();
            wf[loadMask]={class_type:"LoadImage",inputs:{image:S.maskSeed},_meta:{title:"Painted First-Frame Mask"}};
            wf[toMask]={class_type:"ImageToMask",inputs:{image:[loadMask,0],channel:"red"},_meta:{title:"Painted Mask To SAM"}};
            wf["21"].inputs.initial_mask=[toMask,0];
            wf[regionMask]={class_type:"H3PaintedRegion",inputs:{painted:[toMask,0],track:["23",0],grow:8},_meta:{title:"Painted + Tracked Region"}};
            wf["24"].inputs.masks=[regionMask,0];
            maskRegionId=regionMask;
          }
          let firstImgId=null;
          S.refImages.forEach((name,idx)=>{
            const id=newId();
            wf[id]={class_type:"LoadImage",inputs:{image:name},_meta:{title:`Replacement Reference ${idx+1}`}};
            wf["6"].inputs[`ref_images.ref_image_${idx}`]=[id,0];
            if(idx===0) firstImgId=id;
          });
          // The tracked source crop rides in as ref_video_0 so H3 re-enacts the
          // original movement instead of inventing new motion inside the mask.
          // Pin the replacement identity at frame 0 so that reference video's
          // original face cannot outrank <Picture 1> (same fix as R2V mode).
          if(firstImgId){
            const kfId=newId();
            wf[kfId]={class_type:"H3IdentityAnchor",inputs:{
              conditioning:["6",0],
              vae:["3",0],
              latent:["6",1],
              frame_count:["18",4],
              width:["25",0],
              height:["25",1],
              anchor:"first",
              image:[firstImgId,0],
            },_meta:{title:"Identity Anchor (frame 0)"}};
            wf["7"].inputs.conditioning=[kfId,0];
          }
          const maskCrop=_effectiveMaskCropPlan();
          wf["24"].inputs["mode.crop_scale"]=Math.max(1,Math.min(4,Number(S.maskCropScale)||1.5));
          wf["24"].inputs["mode.aspect_ratio"]=0;
          wf["24"].inputs.upscale_megapixels=-maskCrop.megapixels;
          wf["6"].inputs.width=["25",0];
          wf["6"].inputs.height=["25",1];
          wf["6"].inputs.length=["18",4];
          wf["6"].inputs["ref_videos.ref_video_0"]=["24",0];
          wf["30"].inputs.value=S.maskAudioMode==="regenerate"?1:0;
          wf["33"].inputs.feather=32;
          if(S.maskAudioMode==="regenerate") delete wf["6"].inputs["ref_audios.ref_audio_0"];
          const maskAudio=S.maskAudioMode==="regenerate"?["13",0]:["18",2];
          if(wf["14"]){wf["14"].inputs.fps=["18",3];wf["14"].inputs.audio=maskAudio;}
          else if(wf["15"]&&wf["15"].class_type==="VHS_VideoCombine"){wf["15"].inputs.frame_rate=["18",3];wf["15"].inputs.audio=maskAudio;}
          wf["500"]={class_type:"SAM3_TrackPreview",inputs:{track_data:["21",0],images:["18",0],opacity:0.5,fps:24},_meta:{title:"Tracking Overlay"}};
          wf["501"]={class_type:"H3OneSAM3CropCheck",inputs:{bboxes:["24",2],track_data:["21",0],masks:maskRegionId?[maskRegionId,0]:["23",0],confidence_threshold:0.4},_meta:{title:"Crop + Confidence Report"}};
        }
        return wf;
      };

      const _buildChain=async()=>{
        const section=await _fetchTpl(TEMPLATES.chain);
        const session=Date.now().toString(36);
        const clips=S.chainClips;
        const wf={};
        const sharedKeys=["s:1","s:2","s:3","s:4","s:5"];
        const res=_resolveRes();
        clips.forEach((cl,idx)=>{
          const clone=JSON.parse(JSON.stringify(section));
          const out={};
          Object.keys(clone).forEach(k=>{
            if(k.startsWith("s:")){
              if(idx===0) out[k]=clone[k];
              return;
            }
            const nk=k.replace("sec:","c"+idx+":");
            const node=clone[k];
            node.inputs=JSON.parse(JSON.stringify(node.inputs).split('"sec:').join('"c'+idx+':'));
            out[nk]=node;
          });
          const cond=out["c"+idx+":cond"];
          const guider=out["c"+idx+":guider"];
          const mc=out["c"+idx+":mc"];
          const trim=out["c"+idx+":trim"];
          const save=out["c"+idx+":save"];
          const frames=snapFrames(cl.duration,S.fps);
          cond.inputs.prompt=_finalPrompt(cl.prompt, idx===0?"t2v":undefined);
          cond.inputs.width=res.width;
          cond.inputs.height=res.height;
          cond.inputs.length=frames;
          const seed=S.seed||0;
          out["c"+idx+":noise"].inputs.noise_seed=seed;
          out["c"+idx+":sched"].inputs.steps=S.steps;
          out["c"+idx+":sched"].inputs.scheduler=S.schedulerName||"simple";
          if(out["c"+idx+":ksel"]&&out["c"+idx+":ksel"].class_type==="KSamplerSelect") out["c"+idx+":ksel"].inputs.sampler_name=S.samplerName||"res_multistep";
          save.inputs.filename_prefix="one-node-minimax-h3/chain/"+session;
          save.inputs.clip_index=idx+1;
          out["c"+idx+":savevid"].inputs.filename_prefix=`one-node-minimax-h3/chain/${session}/clip_${idx+1}`;
          if(idx===0){
            delete out["c0:mc"];
            guider.inputs.conditioning=["c0:cond",0];
            trim.inputs.trim_frames=0;
          } else {
            const loadId="c"+idx+":load";
            out[loadId]={class_type:"MiniMaxH3MotionContextLoadLatent",inputs:{latent_path:"one-node-minimax-h3/chain",clip_index:idx},_meta:{title:"Load Latent"}};
            mc.inputs.context_frames=["c"+(idx-1)+":trim",0];
            mc.inputs.context_latent=[loadId,0];
            mc.inputs.context_length=S.mcLength;
            mc.inputs.audio_context_length=S.mcLength;
            trim.inputs.trim_frames=["c"+idx+":mc",1];
            mc.inputs.crop="disabled";
          }
          Object.assign(wf,out);
        });
        // shared model chain + patches (inserted once, into clip 0's copy)
        let modelSrc=["s:2",0];
        let nextId=900;
        const newId=()=>String(nextId++);
        const actives=S.loras.filter(l=>l.name&&l.enabled!==false);
        actives.forEach(lr=>{
          const id=newId();
          wf[id]={class_type:"LoraLoaderModelOnly",inputs:{model:modelSrc,lora_name:lr.name,strength_model:lr.strength},_meta:{title:"LoRA"}};
          modelSrc=[id,0];
        });
        let useSla=false;
        {
          const f=resolveQualityFlags(S.optSol,S.optSage,S.optKitchen,S.optSla);
          const useSol=f.sol, useSage=f.sage, useKitchen=f.kitchen;
          useSla=f.sla;
          const insSol=()=>{
            const sol=newId();
            wf[sol]={class_type:"SolAttnPatch",inputs:{
              model:modelSrc,tau:1.3,start_percent:0.2,end_percent:0.9,min_tokens:4096,
              int8_qk:true,sink_conditioning:"exact_kv_and_rows",morton:false,
              morton_curve:"2d_frame",int8_pv:true,verbose:true,use_tma:false,dense_blocks:"",
            },_meta:{title:"Sol-Attn"}};
            modelSrc=[sol,0];
          };
          const insSage=()=>{
            const sage=newId();
            wf[sage]={class_type:"MiniMaxH3MemoryEfficientSageAttentionPatch",inputs:{model:modelSrc},_meta:{title:"SageAttn"}};
            modelSrc=[sage,0];
          };
          const insKitchen=()=>{
            const kitchen=newId();
            wf[kitchen]={class_type:"ModelAttentionBackend",inputs:{model:modelSrc,attention:"comfy kitchen attention"},_meta:{title:"Kitchen"}};
            modelSrc=[kitchen,0];
          };
          if(useKitchen){
            if(useSage) insSage(); // defensive - UI never allows this pair
            insKitchen();
            if(useSol) insSol();
          } else if(useSage&&useSol){
            insSage();insSol();
          } else {
            if(useSol) insSol();
            if(useSage) insSage();
          }
        }
        wf["s:5"].inputs.model=modelSrc;
        if(S.livePreview){
          const lpSet=(S.livePreviewMode&&LP_PRESETS[S.livePreviewMode])?LP_PRESETS[S.livePreviewMode]:LP_PRESETS.balanced;
          wf["s:lp"]={class_type:"ModelPreviewOverrideKJ",inputs:{
            model:modelSrc,
            max_resolution:lpSet.res,
            jpeg_quality:80,
            suppress_default_preview:true,
            preview_frames:lpSet.frames,
            preview_fps:12,
            tiny_vae:S.models.tae||"taeh3.safetensors",
          },_meta:{title:"Live Preview (Model Preview Override)"}};
          wf["s:5"].inputs.model=["s:lp",0];
        }
        if(useSla){
          // Same SLA Draft chain as the plain modes, shared across every clip.
          if(!S.speedLora) throw new Error("SLA Draft needs a Turbo LoRA - set one in Settings (Speed LoRA) or pick another quality.");
          wf["s:5"].inputs.shift_video=(typeof S.shiftVideo==="number")?S.shiftVideo:8;
          wf["s:5"].inputs.shift_audio=(typeof S.shiftAudio==="number")?S.shiftAudio:3;
          const tl=newId();
          wf[tl]={class_type:"MiniMaxH3TurboLoRA",inputs:{model:["s:5",0],lora_name:S.speedLora,strength:(typeof S.speedLoraStrength==="number")?S.speedLoraStrength:0.8,low_vram:false},_meta:{title:"Turbo LoRA (SLA)"}};
          const fix=newId();
          wf[fix]={class_type:"H3AdaLNLoRAFix",inputs:{model:[tl,0],mode:"port"},_meta:{title:"AdaLN LoRA Fix"}};
          const sla=newId();
          wf[sla]={class_type:"H3SLAAttention",inputs:{
            model:[fix,0],sparsity_ratio:0.9,block_size:"64",min_seq_len:8192,
            dense_last_steps:0,protect_audio:true,enabled:true,
          },_meta:{title:"SLA Attention"}};
          clips.forEach((_cl,idx)=>{
            const guider=wf["c"+idx+":guider"];
            const sched=wf["c"+idx+":sched"];
            if(guider) guider.inputs.model=[sla,0];
            if(sched){
              sched.inputs.model=[sla,0];
              if(S.quality==="draft"){
                sched.inputs.steps=8;
                sched.inputs.scheduler="simple";
                const ksel=wf["c"+idx+":ksel"];
                if(ksel&&ksel.class_type==="KSamplerSelect") ksel.inputs.sampler_name="euler";
              }
            }
          });
        }
        wf["s:1"].inputs.clip_name=S.models.clip;
        wf["s:2"].inputs.unet_name=S.models.unetT2V;
        wf["s:3"].inputs.vae_name=S.models.vaeVideo;
        wf["s:4"].inputs.vae_name=S.models.vaeAudio;
        {
          const fp=JSON.stringify({
            chain:clips.map(c=>({prompt:_finalPrompt(c.prompt),duration:c.duration})),
            seed:S.seed||0,steps:S.steps,width:res.width,height:res.height,files:[],
          });
          wf["s:bust"]={class_type:"H3CacheBust",inputs:{clip:["s:1",0],fingerprint:fp},_meta:{title:"Cache Invalidation"}};
          clips.forEach((_cl,idx)=>{
            const cond=wf["c"+idx+":cond"];
            if(cond&&cond.inputs&&Array.isArray(cond.inputs.clip)) cond.inputs.clip=["s:bust",0];
          });
        }
        _applyAutoSave(wf);
        patchOutputVideo(wf,S.fps);
        return wf;
      };

      genBtn.onclick=async()=>{
        if(S.generating||_workflowBuildBusy) return;
        _upOrig=null;_upResult=null;
        if(_cmpMode) _exitCompare();
        _cmpImageRefs=S.mode==="image"&&["edit","refmix"].includes(S.imgSub)?(S.imgSub==="edit"?(S.imgEditSrc?[S.imgEditSrc]:[]):(S.imgRefs||[]).filter(Boolean).slice(0,9)):[];
        _cmpImageRefIndex=0;
        _syncCompareSourceSelect();
        cmpBtn.style.display="none";
        _activeNode=self;
        _activeShowOutput=showOutput;
        _activeResetBtn=resetBtn;
        _activeShowError=showError;
        _activeSetStage=setStage;
        _activeShowTime=showTime;
        _activeShowLatest=showLatest;
        _activeShownFiles=[];
        _activeGenStartTs=Date.now();
        showTime(0);
        _activePromptId=null;
        S.generating=true;
        genBtn.disabled=true;tx(genBtnLbl,"Generating...");
        genBtn.style.background="linear-gradient(270deg,var(--h3accent),#e8d5c0,#a259ff,var(--h3accent))";
        genBtn.style.backgroundSize="300% 300%";
        genBtn.style.animation="h3-gradient 2.4s ease infinite";
        genBtn.style.color=C.lime;
        stopBtn.style.maxWidth="120px";stopBtn.style.minWidth="";stopBtn.style.width="";stopBtn.style.opacity="1";stopBtn.style.padding="0 14px";stopBtn.style.marginLeft="6px";
        progWrap.style.display="flex";setStage("Building workflow...",3);
        errorBox.style.display="none";
        _showLiveChip(false);
        self._h3_lpOn=!!S.livePreview&&S.mode!=="image";
        self._h3_lpId=S.mode==="chain"?"s:lp":"lp";
        if(self._h3_lpOn&&_taeChecked&&!_taeFound){
          resetBtn();
          showError(`Live Preview is on but the decoder "${S.models.tae}" was not found in a ComfyUI models/vae_approx folder.\nOpen Settings to pick the Live Preview decoder, download taeh3.safetensors from huggingface.co/Kijai/MiniMax-H3-TAE, or turn Live Preview off.`);
          return;
        }
        _workflowBuildBusy=true;
        root.style.pointerEvents="none";
        _activeRunMetaByPrompt.clear();
        try{
          if(_uploadsPending>0){
            let _wait=0;
            while(_uploadsPending>0&&_wait<200){
              setStage("Waiting for image upload...",4);
              await new Promise(res=>setTimeout(res,100));
              _wait++;
            }
            if(_uploadsPending>0) throw new Error("An upload is still in progress. Wait for it to finish, then generate again.");
          }
          const n=Math.max(1,Math.min(4,S.batch||1));
          _batchIds=[];
          _batchDone=0;
          _batchFailures=0;
          _settledBatchIds.clear();
          _expectedBatchCount=n;
          _batchSubmissionOpen=true;
          for(let i=0;i<n;i++){
            if(S.randomizeSeed){ S.seed=Math.floor(Math.random()*(H3_SEED_MAX+1)); seedNI._inp.value=String(S.seed); }
            const wf=await _buildWorkflow();
            const runMeta=_captureRunMeta();
            const body={prompt:wf,client_id:api.clientId,extra_data:{enable_previews:true}};
            const res=await api.fetchApi("/prompt",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
            if(!res.ok) throw new Error(`queue failed (HTTP ${res.status})`);
            let data=null;try{data=await res.json();}catch(e){}
            if(!data||data.error||!data.prompt_id){
              throw new Error(data?.error?.message||JSON.stringify(data&&data.error)||"Unknown error");
            }
            _activeRunMetaByPrompt.set(data.prompt_id,runMeta);
            _batchIds.push(data.prompt_id);
            _activePromptId=data.prompt_id;
          }
          _armFinishWatch();
          setStage(n>1?`Queued ${n} runs...`:"In queue...",6);
        }catch(e){
          if(_batchIds.length){
            _expectedBatchCount=_batchIds.length;
            _activePromptId=_batchIds[_batchIds.length-1];
            _armFinishWatch();
            setStage(`Queued ${_batchIds.length} run${_batchIds.length===1?"":"s"}; batch submission stopped`,6);
            showError(`The remaining batch could not be queued: ${fmtErr(e)}\n${_batchIds.length} submitted run${_batchIds.length===1?" is":"s are"} still active.`);
          }else{
            resetBtn();showError(fmtErr(e));
          }
        }finally{
          _batchSubmissionOpen=false;
          if(_batchIds.length&&_settledBatchIds.size>=(_expectedBatchCount||_batchIds.length)) _finishRun(null,false);
          _workflowBuildBusy=false;
          root.style.pointerEvents="";
        }
      };

      stopBtn.onclick=async()=>{
        const ids=[..._batchIds];
        S.generating=false;
        try{await api.fetchApi("/interrupt",{method:"POST"});}catch(e){}
        if(ids.length){
          try{await api.fetchApi("/queue",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({delete:ids})});}catch(e){}
        }
        _activePromptId=null;
        resetBtn();
      };

      // -- Models + config loading -------------------------------------------
      const _pickModel=(list,needle)=>{
        const norm=(s)=>(s||"").toLowerCase();
        const exact=list.find(m=>norm(m).includes(norm(needle)));
        if(exact) return exact;
        const heur=list.find(m=>norm(m).includes("h3")||norm(m).includes("minimax"));
        return heur||list[0]||"";
      };
      const _loadModels=async()=>{
        try{
          const r=await fetch("/h3one/models");
          const d=await r.json();
          _M={checkpoints:d.checkpoints||[],diffusion:d.diffusion_models||[],text_encoders:d.text_encoders||[],vaes:d.vaes||[],loras:d.loras||[]};
          const has=(arr,v)=>arr.some(m=>(m||"").toLowerCase()===(v||"").toLowerCase());
          const clipItems=h3TextEncoderItems(_M.text_encoders);
          const samItems=h3SamCheckpoints(_M.checkpoints);
          if(!has(clipItems,S.models.clip)) S.models.clip=_pickModel(clipItems,"qwen3vl_32b_minimax_h3");
          if(!has(_M.diffusion,S.models.unetT2V)) S.models.unetT2V=_pickModel(_M.diffusion,"fl2va");
          if(!has(_M.diffusion,S.models.unetR2V)) S.models.unetR2V=_pickModel(_M.diffusion,"ref2va");
          if(!has(_M.vaes,S.models.vaeVideo)) S.models.vaeVideo=_pickModel(_M.vaes,"video_vae");
          if(!has(_M.vaes,S.models.vaeAudio)) S.models.vaeAudio=_pickModel(_M.vaes,"audio_vae");
          if(!has(samItems,S.models.sam3)){
            S.models.sam3=samItems[0]||"";
          }
          persist();
          modelDDs.unetT2V.updateItems(_M.diffusion);
          modelDDs.unetR2V.updateItems(_M.diffusion);
          modelDDs.clip.updateItems(clipItems);
          modelDDs.vaeVideo.updateItems(_M.vaes);
          modelDDs.vaeAudio.updateItems(_M.vaes);
          modelDDs.sam3.updateItems(samItems.length?samItems:[""]);
          modelDDs.sam3.set(S.models.sam3);
          speedLoraDD.updateItems(["none"].concat(_M.loras));
          const loraItems=_M.loras.length?_M.loras:["none"];
          _renderLoras();
          _checkTae();
          try{
            const sr=await fetch("/h3one/seedvr2_models");
            const sd=await sr.json();
            const _D=sd.dit||[], _V=sd.vae||[];
            modelDDs.upscaleDit.updateItems(["none"].concat(_D));
            modelDDs.upscaleVae.updateItems(["none"].concat(_V));
            if(S.models.upscaleDit!=="none"&&!_D.some(m=>m===S.models.upscaleDit)&&_D.length){
              S.models.upscaleDit=_D[0];modelDDs.upscaleDit.set(_D[0]);persist();
            }
            if(S.models.upscaleVae!=="none"&&!_V.some(m=>m===S.models.upscaleVae)&&_V.length){
              S.models.upscaleVae=_V[0];modelDDs.upscaleVae.set(_V[0]);persist();
            }
          }catch(e){console.warn("[H3One] seedvr2 models:",e);}
          _updUpBtnTitle();
        }catch(e){console.warn("[H3One] load models:",e);}
      };
      const _loadConfig=async()=>{
        try{
          const r=await fetch("/h3one/config");
          const d=await r.json();
          if(Array.isArray(d.resolution_presets)){
            _resItems=d.resolution_presets;
            resDD.updateItems(_resItems.map(r=>r.label).concat("Custom"));
            if(S.resolution!=="Custom"&&!_resItems.some(r=>r.label===S.resolution)&&_resItems.length){
              S.resolution=_resItems[0].label;resDD.set(S.resolution);persist();
            }
          }
          _updResCustom();
          _discTmpl=d.prompt_templates||{};
        }catch(e){console.warn("[H3One] load config:",e);}
      };
      _updateFramesLabel=()=>{
        if(S.mode==="mask") tx(framesLbl,`= up to ${snapFrames(Math.min(15,S.duration),24)} source frames @ 24 fps (locked)`);
        else tx(framesLbl,outputFrameLabel(S.duration,S.fps,(seconds)=>snapFrames(seconds,S.fps)));
      };
      _updateFramesLabel();
      _loadModels();
      _loadConfig();
      _loadGallery();

      // -- Assemble ----------------------------------------------------------
      const mainRow=mk("div",{display:"flex",gap:"12px",alignItems:"stretch",flex:"1",minHeight:"0"});
      const leftPanel=mk("div",{display:"flex",flexDirection:"column",gap:"9px",width:"460px",flexShrink:"0",overflowY:"auto",minHeight:"0",paddingRight:"4px",boxSizing:"border-box",scrollbarWidth:"thin",scrollbarColor:`${C.border} transparent`});
      modeArea.append(i2vArea,refArea,kfArea,adArea,exArea,chainArea,maskArea,imgArea);
      // -- Card assembly -----------------------------------------------------
      const promptCard=mk("div",{}, {className:"h3-card"});
      promptCard.append(promptHdr,promptWrap);
      const modeCard=mk("div",{}, {className:"h3-card"});
      modeCard.append(modeHdr,modeArea);
      const recipeEl=mk("div",{}, {className:"h3-recipe"});
      const tuneBody=mk("div",{display:"flex",flexDirection:"column",gap:"9px"});
      tuneBody.append(params,seedBody);
      const tuneCard=mk("div",{}, {className:"h3-card"});
      tuneCard.append(paramsHdr,recipeEl,tuneBody);
      const _updRecipe=()=>{
        if(!recipeEl) return;
        recipeEl.innerHTML="";
        const _q=_QL[S.quality]||"Custom";
        const chip=(label,value,action,dd)=>{
          const isBtn=typeof action==="function";
          const c=mk(isBtn?"button":"span",{}, {className:"h3-chip"+(isBtn?" btn":"")+(isBtn&&dd?" hasdd":"")});
          c.title=`${label?label+": ":""}${value}`;
          if(label) c.appendChild(mk("span",{}, {className:"cl",textContent:label}));
          c.appendChild(mk("span",{}, {className:"cv",textContent:value}));
          if(isBtn&&dd) c.appendChild(mk("span",{}, {className:"chev","aria-hidden":"true",textContent:"▾"}));
          if(isBtn){ c.type="button"; c.onclick=(e)=>{ e.stopPropagation(); action(e.currentTarget.getBoundingClientRect()); }; }
          recipeEl.appendChild(c);
        };
        const focusNI=(ni)=>{ ni._inp.focus(); ni._inp.select(); };
        const _unfoldParams=()=>{
          if(!S.folded) S.folded={};
          if(S.folded.params){
            S.folded.params=false;
            tuneBody.style.display="flex";
            tx(paramsChev,"▾");
            persist();
          }
        };
        const editField=(ni)=>{ _unfoldParams(); focusNI(ni); };
        const editSeed=()=>{
          _unfoldParams();
          if(S.randomizeSeed) randTgl.click();
          else focusNI(seedNI);
        };
        if(S.mode==="image"){
          chip("Mode",_imgModeKey[S.imgSub]||"Text to Image",(r)=>imgSubDD.open(r),true);
          const _imgChipPlan=S.imgAspect==="Custom"
            ?planImageCanvas({mode:"custom",width:S.imgW,height:S.imgH})
            :planImageCanvas({mode:"ratio",aspect:S.imgAspect,megapixels:S.imgMP});
          chip("Aspect",`${_imgChipPlan.width}×${_imgChipPlan.height}${_imgChipPlan.capped?" · capped":""}`,(r)=>imgAspectDD.open(r),true);
          chip("Profile",imgProfileShort(S.imgProfile),(r)=>imgProfDD.open(r),true);
          chip("Seed",S.randomizeSeed?"random":String(S.seed||0),editSeed);
          chip("Batch",`×${S.batch||1}`,()=>editField(batchNI));
          return;
        }
        const r=_resolveRes();
        const p=_fitPrimary(S);
        const fitTag=p?(p.mode==="custom"?"Custom":(p.mode==="normal"?"Normal":"Fit")):"";
        if(S.mode==="mask"){const crop=_effectiveMaskCropPlan();chip("Crop",`mask-shaped · ${crop.megapixels.toFixed(2)} MP`,(rect)=>resDD.open(rect),true);}
        else chip(fitTag?`Res · ${fitTag}`:"Res",`${r.width}×${r.height}`,(rect)=>resDD.open(rect),true);
        if(S.mode==="chain") chip("Clips",String(S.chainClips.length));
        else chip(S.mode==="mask"?"Source":"Length",`${S.duration}s`,()=>editField(durNI));
        chip("Steps",String(S.steps),()=>editField(stepsNI));
        chip("Quality",_q,(rect)=>qualDD.open(rect),true);
        chip("Sampler",S.samplerName||"res_multistep",(rect)=>samplerDD.open(rect),true);
        chip("Sched",S.schedulerName||"simple",(rect)=>schedDD.open(rect),true);
        chip("Seed",S.randomizeSeed?"random":String(S.seed||0),editSeed);
        chip("Batch",`×${S.batch||1}`,()=>editField(batchNI));
      };
      _updRecipe();
      _updRecipeFn=_updRecipe;
      leftPanel.append(promptCard,modeCard,tuneCard,loraArea);
      _applyFold("prompt",promptHdr,promptWrap,promptChev);
      _applyFold("mode",modeHdr,modeArea,modeChev);
      _applyFold("params",paramsHdr,tuneBody,paramsChev);
      _applyFold("lora",loraHdr,loraBody,loraChev);
      _applyFold("outputs",galleryFoldHdr,galleryBox,outputsChev);
      mainRow.append(leftPanel,rightPanel);
      pad.append(navRow,mainRow,genRow,queueRow);
      scrollEl.appendChild(pad);
      root.append(scrollEl,settingsOverlay,historyOverlay,libraryOverlay,discoverOverlay);
      _updateTabs();
      _updateModeSections();
      _restoreModeState();

      // -- Keyboard shortcut: Space = Generate when hovering the node -------
      let _mouseOverRoot=false;
      root.addEventListener("mouseenter",()=>{ _mouseOverRoot=true; });
      root.addEventListener("mouseleave",()=>{ _mouseOverRoot=false; });
      document.addEventListener("keydown",(e)=>{
        if(e.code!=="Space") return;
        if(!_mouseOverRoot) return;
        if(_workflowBuildBusy) return;
        const tag=(document.activeElement||{}).tagName||"";
        if(tag==="INPUT"||tag==="TEXTAREA") return;
        if(settingsOverlay.style.display!=="none"||historyOverlay.style.display!=="none"||libraryOverlay.style.display!=="none"||discoverOverlay.style.display!=="none") return;
        e.preventDefault();e.stopPropagation();
        genBtn.click();
      });

      document.addEventListener("paste",async(e)=>{
        if(!_mouseOverRoot) return;
        if(_workflowBuildBusy) return;
        const tag=(document.activeElement||{}).tagName||"";
        if(tag==="INPUT"||tag==="TEXTAREA") return;
        const items=[...(e.clipboardData?.items||[])];
        const imgItem=items.find(i=>i.type.startsWith("image/"));
        if(!imgItem) return;
        e.preventDefault();e.stopPropagation();
        const raw=imgItem.getAsFile();
        if(!raw) return;
        const ext=(raw.type.split("/")[1]||"png").replace("jpeg","jpg");
        const uniqueName=`pasted_${Date.now()}_${Math.floor(Math.random()*1e4)}.${ext}`;
        let file;
        try{ file=new File([raw],uniqueName,{type:raw.type}); }
        catch(_){ file=raw; file.name=uniqueName; }
        if(!_fileMatches(file,IMAGE_FILE_EXTS)) return;
        if(S.mode==="i2v"){
          if(!S.firstFrame) firstSlot.loadFile(file);
          else lastSlot.loadFile(file);
        } else if(S.mode==="r2v"||S.mode==="mask"){
          if(_refImageUploadsPending||S.refImages.length>=9) return;
          _refImageUploadsPending++;
          if(S.mode==="mask") _renderMask({refreshPreview:false}); else _renderRefs();
          try{
            const _nm=await _uploadImage(file);
            if(S.refImages.length<9){
              S.refImages.push(_nm);
              const _sz=await _captureFileSize(file);
              if(_sz) S.refImageSizes[_nm]=_sz;
              persist();
            }
          }catch(err){ console.warn("[H3One] paste upload:",err); if(_h3ShowError)_h3ShowError("Pasted image upload failed: "+fmtErr(err)); }
          finally{_refImageUploadsPending--;if(S.mode==="mask") _renderMask({refreshPreview:false}); else _renderRefs();}
        } else if(S.mode==="keyframes"){
          let empty=S.kf.find(k=>!k.img);
          if(!empty){
            if(S.kf.length>=32) return;
            empty={img:null,pos:Math.min(9999,(S.kf.length+1)*62),width:null,height:null};
            S.kf.push(empty);
          }
          try{
            empty.img=await _uploadImage(file);
            const _sz=await _captureFileSize(file);
            if(_sz){ empty.width=_sz.width; empty.height=_sz.height; }
            persist();_renderKf();
          }catch(err){ console.warn("[H3One] paste upload:",err); if(_h3ShowError)_h3ShowError("Pasted image upload failed: "+fmtErr(err)); }
        }
      },{capture:true});

      // -- DOM widget --------------------------------------------------------
      self.addDOMWidget("h3_ui","div",root,{
        getValue(){return null;},setValue(){},serialize:false,
        canvasOnly:!_isVueNodes(),
        computeSize(){const sh=(typeof LiteGraph!=="undefined"&&LiteGraph.NODE_SLOT_HEIGHT)||20;return[NODE_W,NODE_H+sh*3];},
      });
      {const sh=(typeof LiteGraph!=="undefined"&&LiteGraph.NODE_SLOT_HEIGHT)||20;self.setSize([NODE_W,NODE_H+sh*3]);}

      if(!_isVueNodes()){
        requestAnimationFrame(()=>{
          let el=root;
          for(let i=0;i<6;i++){el=el?.parentElement;if(!el)break;el.querySelectorAll("[class*='bg-node-component-surface']").forEach(b=>b.style.display="none");}
        });
      }

      root.addEventListener("pointerdown",()=>{
        _activeNode=self;
        _activeShowOutput=showOutput;
        _activeResetBtn=resetBtn;
        _activeShowError=showError;
        _activeSetStage=setStage;
        _activeShowTime=showTime;
        _activeShowLatest=showLatest;
      });
    };
  },
});

// -- Global API event listeners (once) ----------------------------------------
(()=>{
  if(_listenersRegistered) return;
  _listenersRegistered=true;

  api.addEventListener("progress",(evt)=>{
    if(!_activeNode) return;
    if(_activeNode._h3_lpOn) return;
    if(_activeNode._h3_S&&_activeNode._h3_S.generating!==true) return;
    const {value,max}=evt.detail||{};
    if(max>0&&_activeSetStage) _activeSetStage("Sampling...",8+Math.round(value/max*86));
  });

  api.addEventListener("kj_preview_override",(evt)=>{
    const node=_activeNode;
    if(!node||!node._h3_lpOn) return;
    const d=evt.detail||{};
    if(d.node_id!==node._h3_lpId) return;
    if(Array.isArray(d.sigmas)&&d.sigmas.length>1){
      if(node._h3_lpReset) node._h3_lpReset();
    }
    if(typeof d.image==="string"){ if(node._h3_lpFrame) node._h3_lpFrame(d); }
  });

  api.addEventListener("status",()=>{
    if(_queuedJobs.size) _armQueueSync();
  });

  api.addEventListener("executed",(evt)=>{
    const d=evt.detail;
    const pid=d?.prompt_id;
    const out=d?.output||null;
    if(d&&d.node==="501"&&out&&Array.isArray(out.text)&&out.text.length){
      let crop=null;
      try{crop=JSON.parse(out.text[out.text.length-1]);}catch(e){crop=null;}
      if(crop&&typeof crop==="object"){
        const qj=pid?_queuedJobs.get(pid):null;
        const target=qj&&qj.node?qj.node:(_activeNode&&_batchIds.includes(pid)?_activeNode:null);
        if(target){
          target._h3_cropCheck={pid:pid,crop:crop};
          if(target._h3_cropCheckChanged) target._h3_cropCheckChanged(target._h3_cropCheck);
        }
      }
      return;
    }
    const overlay=d&&d.node==="500"&&out?(out.videos||out.images||out.gifs||null):null;
    if(Array.isArray(overlay)&&overlay.length){
      const it=overlay[overlay.length-1];
      const item={filename:it.filename,subfolder:it.subfolder||"",type:it.type||"temp",kind:"video"};
      const qj=pid?_queuedJobs.get(pid):null;
      if(qj&&qj.node&&qj.node._h3_maskTrackingOverlay) qj.node._h3_maskTrackingOverlay(item,pid);
      else if(_activeNode&&_batchIds.includes(pid)&&_activeNode._h3_maskTrackingOverlay) _activeNode._h3_maskTrackingOverlay(item,pid);
      return;
    }
    const qentry=pid?_queuedJobs.get(pid):null;
    if(qentry){
      const item=_mediaItemFromOutput(out);
      if(item&&!qentry.shown&&qentry.node&&qentry.node._h3_showQueued){qentry.shown=true;qentry.node._h3_showQueued(item);}
      return;
    }
    if(!_activeNode) return;
    if(!d||!_batchIds.includes(pid)) return;
    if(!out) return;
    const vids=out.videos||out.gifs||null;
    if(vids&&Array.isArray(vids)&&vids.length&&_activeShowOutput){
      _activeShowOutput(vids[vids.length-1],_activeRunMetaByPrompt.get(pid));
      _activeSetStage?.("Done",97);
    }
    const imgs=out.images||null;
    if(imgs&&Array.isArray(imgs)&&imgs.length&&_activeShowOutput){
      const im=imgs[imgs.length-1];
      const animated=!!(out.animated&&out.animated.length);
      _activeShowOutput({filename:im.filename,subfolder:im.subfolder||"",type:im.type||"output",kind:animated?"video":"image"},_activeRunMetaByPrompt.get(pid));
      _activeSetStage?.("Done",97);
    }
  });

  api.addEventListener("execution_success",(evt)=>{
    const pid=(evt?.detail||{}).prompt_id;
    const qentry=pid?_queuedJobs.get(pid):null;
    if(qentry){
      _settleQueuedJob(pid,qentry);
      return;
    }
    if(!pid||_batchIds.includes(pid)) _finishRun(pid,false);
  });

  api.addEventListener("execution_error",(evt)=>{
    const d=evt.detail;
    if(d?.prompt_id&&_queuedJobs.has(d.prompt_id)){
      _queuedJobs.delete(d.prompt_id);
      _renderQueueBadge();
      if(!_queuedJobs.size) _stopQueueSync();
      if(_activeQueueBtn){
        _activeQueueBtn.title="Queued job failed: "+fmtErr(d?.exception_message||d?.error||d||"Queued job failed.");
        _activeQueueBtn._flash("failed");
      }
      return;
    }
    if(!_activeNode) return;
    if(d?.prompt_id&&_batchIds.length&&!_batchIds.includes(d.prompt_id)) return;
    if(_activeNode._h3_S&&_activeNode._h3_S.generating!==true) return;
    const msg=maskRunErrorHint(fmtErr(d?.exception_message||d?.error||d||"Execution failed."),_activeNode._h3_S);
    _activeShowError?.(msg);
    _finishRun(d?.prompt_id||_activePromptId,true);
  });

  api.addEventListener("execution_interrupted",(evt)=>{
    const d=evt.detail||{};
    const pid=d.prompt_id;
    if(pid&&_queuedJobs.has(pid)){
      _queuedJobs.delete(pid);_renderQueueBadge();if(!_queuedJobs.size)_stopQueueSync();
      return;
    }
    if(!_activeNode||(_activeNode._h3_S&&_activeNode._h3_S.generating!==true)) return;
    if(pid&&_batchIds.length&&!_batchIds.includes(pid)) return;
    _activeShowError?.("Generation was interrupted.");
    _finishRun(pid||_activePromptId,true);
  });
})();
