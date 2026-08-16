import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

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

const NODE_W = 1200;
const NODE_H = 700;
const LS_KEY = "one_node_minimax_h3_state";

const MODES = [
  { key:"t2v",         label:"T2V" },
  { key:"i2v",         label:"I2V" },
  { key:"r2v",         label:"R2V" },
  { key:"audio_drive", label:"Audio Drive" },
  { key:"keyframes",   label:"Keyframes" },
  { key:"extend",      label:"Extend" },
  { key:"chain",       label:"Chain" },
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
  image:"Still images with MiniMax H3. Text to image, edit an image, or mix references.",
};

const TEMPLATES = {
  t2v:"t2v.json", i2v:"i2v.json", r2v:"r2v.json", audio_drive:"audio_drive.json",
  keyframes:"keyframes.json", extend:"video_extend.json", chain:"chain_section.json",
  image:"image.json",
};

const DEFAULT_MODELS = {
  unetT2V:"minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  unetR2V:"minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  clip:"qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  vaeVideo:"minimax_h3_video_vae_fp16.safetensors",
  vaeAudio:"minimax_h3_audio_vae_fp32.safetensors",
  tae:"taeh3.safetensors",
  upscaleDit:"none",
  upscaleVae:"none",
};

function snapFrames(seconds){
  const base = Math.max(5, Math.round(seconds * 24));
  return base + ((5 - (base % 17)) + 17) % 17;
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

function fmtDur(ms){
  const s=Math.round(Math.max(0,ms)/1000);
  const m=Math.floor(s/60), sec=s%60;
  if(m<1) return sec+"s";
  const h=Math.floor(m/60);
  if(h<1) return m+"m "+String(sec).padStart(2,"0")+"s";
  return h+"h "+String(m%60).padStart(2,"0")+"m "+String(sec).padStart(2,"0")+"s";
}

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

function DD(items,selected,onChange){
  let val=selected;
  const wrap=mk("div",{position:"relative",width:"100%",minWidth:"0",overflow:"hidden"});
  const trig=mk("div",{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:"7px",
    padding:"0 8px",height:"28px",display:"flex",alignItems:"center",
    justifyContent:"space-between",cursor:"pointer",boxSizing:"border-box",
    transition:"border-color .15s",userSelect:"none",overflow:"hidden"});
  const trigTxt=mk("span",{fontSize:"11px",color:C.text,overflow:"hidden",
    textOverflow:"ellipsis",whiteSpace:"nowrap",flex:"1",minWidth:"0"});
  tx(trigTxt,val); trigTxt.style.color=val?C.lime:C.muted;
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
    items.filter(i=>!q||i.toLowerCase().includes(q.toLowerCase())).forEach(item=>{
      const isSel=_norm(item)===_norm(val);
      const r=mk("div",{padding:"7px 12px",fontSize:"11px",cursor:"pointer",
        color:isSel?C.lime:C.text,background:isSel?C.bg2:"transparent",
        whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",transition:"background .1s"});
      tx(r,item);
      r.onmouseenter=()=>r.style.background=C.bg3;
      r.onmouseleave=()=>r.style.background=_norm(item)===_norm(val)?C.bg2:"transparent";
      r.onclick=()=>{val=item;tx(trigTxt,item);trigTxt.style.color=item?C.lime:C.muted;close();onChange(item);};
      list.appendChild(r);
    });
  };
  const reposition=()=>{
    const rect=trig.getBoundingClientRect();
    panel.style.left=rect.left+"px";
    panel.style.width=Math.max(rect.width,140)+"px";
    const ph=Math.min(items.length*28+44,220);
    panel.style.top=(rect.top-ph-4>8?rect.top-ph-4:rect.bottom+4)+"px";
  };
  const open=()=>{
    document.body.appendChild(panel);panel.style.display="flex";
    reposition();arr.style.transform="rotate(180deg)";
    trig.style.borderColor=C.lime;showDimmer();
    srch.value="";srch.focus();render("");
  };
  const close=()=>{
    panel.style.display="none";
    if(panel.parentNode)panel.parentNode.removeChild(panel);
    arr.style.transform="";trig.style.borderColor=C.border;hideDimmer();
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
    set(v){val=v;tx(trigTxt,v);trigTxt.style.color=v?C.lime:C.muted;render("");},
    updateItems(ni){items=ni;if(!ni.some(i=>_norm(i)===_norm(val))){val=ni[0]||val;tx(trigTxt,val);trigTxt.style.color=val?C.lime:C.muted;onChange(val);}render(srch.value||"");},
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
  inp.onblur=()=>{ inp.value=String(Math.max(min,Math.min(max,parseFloat(inp.value)||min))); wrap.style.borderColor=C.border; };
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

function ImgSlot(optional,onFile){
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
    objectFit:"cover",display:"none",borderRadius:"11px",
  });
  const rm=mkRmBtn();
  const inp=mk("input",{display:"none"},{type:"file",accept:"image/*"});
  wrap.append(icoWrap,prevEl,rm,inp);
  wrap.onmouseenter=()=>{wrap.style.borderColor=C.lime;};
  wrap.onmouseleave=()=>{wrap.style.borderColor=C.border;};
  wrap.onclick=()=>inp.click();
  let _dragDepth=0;
  wrap.addEventListener("dragenter",e=>{e.preventDefault();e.stopPropagation();_dragDepth++;wrap.style.borderColor=C.lime;wrap.style.background=C.bg1;});
  wrap.addEventListener("dragover",e=>{e.preventDefault();e.stopPropagation();});
  wrap.addEventListener("dragleave",()=>{ _dragDepth--;if(_dragDepth<=0){_dragDepth=0;wrap.style.borderColor=C.border;wrap.style.background=C.bg2;} });
  wrap.addEventListener("drop",e=>{
    e.preventDefault();e.stopPropagation();_dragDepth=0;wrap.style.borderColor=C.border;wrap.style.background=C.bg2;
    const f=e.dataTransfer.files[0];if(f&&f.type.startsWith("image/"))_load(f);
  });
  let _currentName=null;
  const _showLoaded=(src,fname)=>{
    prevEl.src=src;prevEl.style.display="block";
    icoWrap.style.display="none";rm.style.display="flex";
    wrap.style.borderColor=C.lime;
  };
  const _load=async(file)=>{
    const objUrl=URL.createObjectURL(file);
    _showLoaded(objUrl,file.name);
    const fd=new FormData();fd.append("image",file);fd.append("overwrite","true");
    try{
      const r=await api.fetchApi("/upload/image",{method:"POST",body:fd});
      const d=await r.json();_currentName=d.name||file.name;
      onFile(_currentName);
    }catch(err){console.warn("[H3One] upload:",err);_currentName=file.name;onFile(_currentName);}
  };
  inp.onchange=()=>{if(inp.files[0])_load(inp.files[0]);};
  rm.onclick=e=>{
    e.stopPropagation();
    prevEl.src="";prevEl.style.display="none";
    rm.style.display="none";icoWrap.style.display="flex";
    wrap.style.borderColor=C.border;inp.value="";_currentName=null;onFile(null);
  };
  const _restorePreview=(name)=>{
    if(!name) return;
    const src=api.apiURL(`/view?filename=${encodeURIComponent(name)}&type=input&subfolder=`);
    _currentName=name;
    _showLoaded(src,name);
  };
  return{el:wrap,get name(){return _currentName;},loadFile:(file)=>_load(file),_restorePreview};
}

function MediaSlot(type,onFile){
  const acceptMap={video:"video/*",audio:"audio/*"};
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
    objectFit:"cover",display:"none",borderRadius:"11px",pointerEvents:"none",
  }) : null;
  if(videoThumb){ videoThumb.muted=_videoMuted; videoThumb.preload="metadata"; }
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
  wrap.addEventListener("drop",e=>{ e.preventDefault();e.stopPropagation();_dragDepth=0;const f=e.dataTransfer.files[0];if(f)_load(f); });
  wrap._hasFile=false;wrap._filename=null;
  let _objUrl=null;
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
    icoWrap.style.display="flex";loadedName.style.display="none";rm.style.display="none";
    wrap.style.borderColor=C.border;wrap.style.background=C.bg2;
    wrap._hasFile=false;wrap._filename=null;
    if(videoThumb){videoThumb.style.display="none";videoThumb.src="";}
    if(audioGlow) audioGlow.style.display="none";
    if(playBtn) playBtn.style.display="none";
    if(spkBtn) spkBtn.style.display="none";
    _stopAudio();
    if(_objUrl){URL.revokeObjectURL(_objUrl);_objUrl=null;}
    onFile(null);
  };
  const _restorePreview=(name)=>{
    if(!name) return;
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
    if(_objUrl){URL.revokeObjectURL(_objUrl);_objUrl=null;}
    _objUrl=URL.createObjectURL(file);
    const fd=new FormData();fd.append("file",file,file.name);
    try{
      const res=await fetch("/h3one/upload",{method:"POST",body:fd});
      const data=await res.json();
      if(!data.ok){console.error("[H3One] upload failed:",data.error);return;}
      _showLoaded(data.filename,_objUrl);onFile(data.filename);
    }catch(e){console.error("[H3One] upload error:",e);}
  };
  fileInp.onchange=()=>{ const f=fileInp.files[0];if(f)_load(f);fileInp.value=""; };
  rm.onclick=e=>{ e.stopPropagation();_clearLoaded(); };
  wrap.clear=_clearLoaded;
  wrap._restorePreview=_restorePreview;
  return wrap;
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
let _listenersRegistered=false;
let _finishWatchTimer=null;
let _finishDone=false;

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
      if(h&&h[_activePromptId]){
        _stopFinishWatch();
        _batchDone=_batchIds.length;
        _finishRun();
      }
    }catch(e){}
  },2500);
};
const _finishRun=async()=>{
  if(_finishDone) return;
  if(!_activeNode) return;
  if(_activeNode._h3_S && _activeNode._h3_S.generating!==true) return;
  if(_batchIds.length){
    _batchDone++;
    if(_batchDone<_batchIds.length){
      _activeSetStage?.(`Done ${_batchDone}/${_batchIds.length}`,Math.round(_batchDone/_batchIds.length*100));
      return;
    }
  }
  _finishDone=true;
  _stopFinishWatch();
  _activeSetStage?.("Done",100);
  const _elapsed=Date.now()-_activeGenStartTs;
  _activeShowTime?.(_elapsed);
  let tries=0;
  while(tries<12&&!_activeShownFiles.length){
    await _activeShowLatest?.();
    if(_activeShownFiles.length) break;
    tries++;
    await new Promise(res=>setTimeout(res,1500));
  }
  _activeResetBtn?.();
  const S=_activeNode?._h3_S;
  if(S && S.soundEnabled!==false && S.sound!=="off") playDone(S.sound||"chime");
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
      const _QF={
        turbo:{sol:false,cache:false,sage:false},
        speed:{sol:true,cache:true,sage:false},
        balanced:{sol:true,cache:false,sage:false},
        high:{sol:false,cache:false,sage:true},
        native:{sol:false,cache:false,sage:false},
      };
      const _QL={balanced:"Balanced",speed:"Speed",high:"High Quality",turbo:"Turbo (Speed LoRA)",native:"Native",custom:"Custom"};
      const _matchQ=()=>{
        for(const k of ["speed","balanced","high","native"]){
          const p=_QF[k];
          if(!!S.optSol===p.sol&&!!S.optCache===p.cache&&!!S.optSage===p.sage) return k;
        }
        return "custom";
      };

      if(!self._h3_S){
        const _sq=(saved.quality==="custom"||(saved.quality&&_QF[saved.quality]))?saved.quality:"balanced";
        const _qf=_QF[_sq]||{sol:false,cache:false,sage:false};
        self._h3_S={
          mode:            saved.mode||"t2v",
          prompt:          saved.prompt!==undefined?saved.prompt:"",
          resolution:      saved.resolution!==undefined?saved.resolution:"960x544 (0.5MP Balanced)",
          duration:        saved.duration!==undefined?saved.duration:5,
          steps:           (saved.steps&&saved.steps!==30)?saved.steps:20,
          quality:         _sq,
          optSol:          (saved.quality==="custom")?(saved.optSol!==undefined?saved.optSol:false):_qf.sol,
          optCache:        (saved.quality==="custom")?(saved.optCache!==undefined?saved.optCache:false):_qf.cache,
          optSage:         (saved.quality==="custom")?(saved.optSage!==undefined?saved.optSage:false):_qf.sage,
          samplerName:     saved.samplerName||"res_multistep",
          schedulerName:   saved.schedulerName||"simple",
          seed:            (typeof saved.seed==="number")?saved.seed:0,
          randomizeSeed:   saved.randomizeSeed!==undefined?saved.randomizeSeed:true,
          batch:           saved.batch||1,
          loras:          (()=>{ const arr=Array.isArray(saved.loras)?saved.loras:[]; const named=arr.filter(l=>l&&l.name); return named.concat([{name:"",strength:1}]); })(),
          firstFrame:      saved.firstFrame||null,
          lastFrame:       saved.lastFrame||null,
          refImages:       Array.isArray(saved.refImages)?saved.refImages:[],
          refVideos:       (Array.isArray(saved.refVideos)?saved.refVideos:[]).map(v=>(typeof v==="string")?{name:v,useAudio:false}:{name:(v&&v.name)||"",useAudio:!!(v&&v.useAudio)}),
          refAudios:       Array.isArray(saved.refAudios)?saved.refAudios:[],
          audioFile:       saved.audioFile||null,
          extendVideo:     saved.extendVideo||null,
          kf:              (Array.isArray(saved.kf)&&saved.kf.length)?saved.kf.map(k=>({img:k.img||null,pos:k.pos||0})):[{img:null,pos:1},{img:null,pos:62},{img:null,pos:124}],
          chainClips:      Array.isArray(saved.chainClips)&&saved.chainClips.length? saved.chainClips : [{prompt:"",duration:5},{prompt:"",duration:5}],
          models:          Object.assign({}, DEFAULT_MODELS, saved.models||{}),
          speedLora:       saved.speedLora||"",
          audioOn:         saved.audioOn!==undefined?saved.audioOn:true,
          soundEnabled:    saved.soundEnabled!==undefined?saved.soundEnabled:true,
          sound:           saved.sound||"chime",
          accent:          (saved.accent&&saved.accent!=="#f0ff41"&&saved.accent.toLowerCase()!=="#00e5ff")?saved.accent:ACCENT_DEFAULT,
          mcLength:        saved.mcLength!==undefined?saved.mcLength:22,
          customW:         saved.customW||960,
          customH:         saved.customH||544,
          upscaleFactor:   saved.upscaleFactor||2,
          upscaleMethod:   saved.upscaleMethod||"seedvr",
          modeSettings:    (saved.modeSettings&&typeof saved.modeSettings==="object")?saved.modeSettings:{},
          autoSave:        saved.autoSave!==undefined?saved.autoSave:true,
          livePreview:     saved.livePreview===true,
          generating:      false,
          playOnFinish:    saved.playOnFinish!==undefined?saved.playOnFinish:true,
          folded:          (saved.folded&&typeof saved.folded==="object")?saved.folded:{},
          imgSub:          saved.imgSub||"t2i",
          imgAspect:       saved.imgAspect||"1:1",
          imgMP:           saved.imgMP!==undefined?saved.imgMP:1.0,
          imgW:            saved.imgW||1024,
          imgH:            saved.imgH||1024,
          imgProfile:      saved.imgProfile||"base_quality_20",
          imgRefs:         Array.isArray(saved.imgRefs)?saved.imgRefs:[],
        };
      }
      const S=self._h3_S;
      const _hexToRgb=(hex)=>{
        const h=String(hex||"").replace("#","");
        if(h.length===3) return h.split("").map(x=>parseInt(x+x,16)).join(",");
        const n=parseInt(h.slice(0,6),16);
        return isNaN(n)?"192,169,150":`${(n>>16)&255},${(n>>8)&255},${n&255}`;
      };
      let _updRecipeFn=null;
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
        S.modeSettings[S.mode]={prompt:S.prompt,steps:S.steps,quality:S.quality,resolution:S.resolution,duration:S.duration,loras:JSON.parse(JSON.stringify(S.loras||[])),optSol:S.optSol,optCache:S.optCache,optSage:S.optSage};
        if(_updRecipeFn){ try{ _updRecipeFn(); }catch(e){} }
        saveState({
          mode:S.mode,prompt:S.prompt,resolution:S.resolution,duration:S.duration,
          steps:S.steps,quality:S.quality,optSol:S.optSol,optCache:S.optCache,optSage:S.optSage,samplerName:S.samplerName,schedulerName:S.schedulerName,randomizeSeed:S.randomizeSeed,seed:S.seed,batch:S.batch,
          loras:S.loras,chainClips:S.chainClips.map(c=>({prompt:c.prompt,duration:c.duration})),
          firstFrame:S.firstFrame,lastFrame:S.lastFrame,
          refImages:S.refImages,refVideos:S.refVideos,refAudios:S.refAudios,
          audioFile:S.audioFile,extendVideo:S.extendVideo,
          kf:(S.kf||[]).map(k=>({img:k.img||null,pos:k.pos||0})),
          models:S.models,speedLora:S.speedLora,audioOn:S.audioOn,
          soundEnabled:S.soundEnabled,sound:S.sound,accent:S.accent,mcLength:S.mcLength,
          upscaleFactor:S.upscaleFactor,upscaleMethod:S.upscaleMethod,
          modeSettings:S.modeSettings,
          autoSave:S.autoSave,customW:S.customW,customH:S.customH,
          playOnFinish:S.playOnFinish,folded:S.folded,livePreview:S.livePreview,
          imgSub:S.imgSub,imgAspect:S.imgAspect,imgMP:S.imgMP,imgW:S.imgW,imgH:S.imgH,
          imgProfile:S.imgProfile,imgRefs:S.imgRefs,
        });
      }

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
          /* recipe line: pill chips in two visual groups (media | sampling) */
          .h3-recipe{display:flex;align-items:center;flex-wrap:wrap;gap:5px;font-variant-numeric:tabular-nums;}
          .h3-chip{display:inline-flex;align-items:center;gap:5px;background:var(--h3-field);border:1px solid var(--h3-line);border-radius:20px;padding:3px 9px;font-size:10px;line-height:1.4;flex-shrink:0;}
          .h3-chip .cl{font-size:8.5px;font-weight:700;letter-spacing:.04em;color:var(--h3-tx3);}
          .h3-chip .cv{font-weight:700;color:var(--h3-tx);}
          .h3-chip.media .cv{color:var(--h3accent);}
          .h3-gsep{width:1px;height:14px;background:var(--h3-line);margin:0 3px;align-self:center;flex-shrink:0;}
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
          @media (prefers-reduced-motion:reduce){ .h3-mode,.h3-topbtn,.h3-rmbtn,.h3-tgl,.h3-actbtn,.h3-seedbtn{transition:none;} .h3-livechip .lcdot{animation:none;} }
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
        image:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M6 17l4-4 3 3 2-2 3 3"/>',
      };
      const MODE_SHORT={t2v:"T2V",i2v:"I2V",r2v:"R2V",audio_drive:"Audio",keyframes:"Keys",extend:"Extend",chain:"Chain",image:"Image"};
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

      let _M={diffusion:[],text_encoders:[],vaes:[],loras:[]};
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
      tx(speedLoraHint,"Used by the Turbo quality preset.");
      speedLoraWrap.appendChild(speedLoraHint);
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
      settingsOverlay.append(settHdr,unetT2VRow,unetR2VRow,clipRow,vaeVRow,vaeARow,taeRow,upMethodWrap,upDitRow,upVaeRow,upHint,speedLoraWrap,audioToggle.el,soundToggle.el,playOnFinishToggle.el,sndWrap,accWrap,supWrap);

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
      const _HIST_MODE_COLORS={t2v:"#c0a996",i2v:"#5aa8ff",r2v:"#5fd08c",audio_drive:"#c07fff",keyframes:"#ffc266",extend:"#7ed491",chain:"#4dd0e1",image:"#f0a0c0"};
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
          tx(mTurbo,"⚡ Turbo LoRA");
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
          const vurl=api.apiURL(`/view?filename=${encodeURIComponent(it.video)}&type=output&subfolder=${encodeURIComponent(it.subfolder||"")}`);
          if(it.kind==="image"){
            const v=mk("img",{width:"100%",maxHeight:"100%",borderRadius:"8px",background:"#000",objectFit:"contain",outline:"none",flex:"1 1 0",minHeight:"0"},{src:vurl});
            secResult.appendChild(v);
          } else {
            const v=mk("video",{width:"100%",flex:"1 1 0",minHeight:"0",height:"0",borderRadius:"8px",background:"#000",objectFit:"contain",outline:"none"},{controls:true,src:vurl});
            secResult.appendChild(v);
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
            const thumb=mk("video",{width:"64px",height:"36px",borderRadius:"6px",background:"#000",objectFit:"cover",border:`1px solid ${C.border}`,flexShrink:"0",pointerEvents:"none",display:"block"},{muted:true,preload:"metadata",playsInline:true});
            thumb.src=api.apiURL(`/view?filename=${encodeURIComponent(it.video)}&type=output&subfolder=${encodeURIComponent(it.subfolder||"")}`);
            thumb.addEventListener("loadeddata",()=>{ try{ thumb.currentTime=0.1; }catch(e){} });
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
      const _LIB_MODE_LBL={t2v:"T2V",i2v:"I2V",r2v:"R2V",audio_drive:"Audio Drive",keyframes:"Keyframes",extend:"Extend",chain:"Chain",image:"Image"};
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
      const libClose=mk("button",{background:"transparent",border:`1px solid #e05555`,borderRadius:"6px",padding:"4px 14px",fontSize:"11px",color:"#e05555",cursor:"pointer",outline:"none"});
      tx(libClose,"Close");
      libClose.onclick=()=>closeOverlayFade(libraryOverlay);
      libActs.append(libFavOnly,libRefresh,libClose);
      libHdr.append(libTitle,libActs);
      const libGrid=mk("div",{flex:"1",minHeight:"0",overflowY:"auto",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:"8px",alignContent:"start",scrollbarWidth:"thin",scrollbarColor:`${C.border} transparent`});
      libGrid.addEventListener("wheel",e=>e.stopPropagation(),{passive:true});
      libraryOverlay.append(libHdr,libGrid);
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
          closeOverlayFade(libraryOverlay);
        }catch(e){
          showError("Could not load video into "+target+": "+fmtErr(e));
        }
      };
      const _renderLibrary=async()=>{
        libGrid.innerHTML="";
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
          const url=api.apiURL(`/view?filename=${encodeURIComponent(item.filename)}&type=output&subfolder=${encodeURIComponent(item.subfolder||"")}`);
          const isImg=item.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(item.filename||"");
          const v=isImg
            ? mk("img",{width:"100%",height:"78px",objectFit:"cover",display:"block",background:"#000",pointerEvents:"none"},{src:url})
            : mk("video",{width:"100%",height:"78px",objectFit:"cover",display:"block",background:"#000",pointerEvents:"none"},{muted:true,preload:"metadata"});
          if(!isImg) v.src=url;
          const name=mk("div",{fontSize:"8px",color:item.favorite?C.lime:C.muted,padding:"4px 6px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"});
          tx(name,(item.favorite?"★ ":"")+item.filename);
          card.append(v,name);
          card.onclick=()=>_libOpen(item);
          card.onmouseenter=()=>card.style.borderColor=C.lime;
          card.onmouseleave=()=>card.style.borderColor=C.border;
          libGrid.appendChild(card);
        });
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
        if(_seedByFile[item.filename]!==undefined){
          tx(lbSeedVal,String(_seedByFile[item.filename]));
        }
        if(_genTimeByFile[item.filename]){
          tx(lbTimeVal,fmtDur(_genTimeByFile[item.filename]));
        }
        try{
          const r=await fetch("/h3one/history");
          const d=await r.json();
          const hit=(d.items||[]).find(it=>it.video===item.filename);
          if(hit){
            if(hit.seed!==undefined&&hit.seed!==null){ _seedByFile[item.filename]=hit.seed; tx(lbSeedVal,String(hit.seed)); }
            if(hit.mode){ tx(lbModeVal,_LIB_MODE_LBL[hit.mode]||hit.mode); }
            if(hit.gen_time){ _genTimeByFile[item.filename]=hit.gen_time; tx(lbTimeVal,fmtDur(hit.gen_time)); }
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
        const lbUrl=api.apiURL(`/view?filename=${encodeURIComponent(item.filename)}&type=output&subfolder=${encodeURIComponent(item.subfolder||"")}`);
        const isImg=item.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(item.filename||"");
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
        await fetch("/h3one/favorite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:_libCur.filename,favorite:!_libCur.favorite})}).catch(()=>{});
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
        const MODE_LABELS={t2v:"T2V",i2v:"I2V",r2v:"R2V",audio_drive:"Audio Drive",keyframes:"Keyframes",extend:"Extend",chain:"Chain"};
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
      const exArea=mk("div",{display:"flex",gap:"10px"});
      const imgArea=mk("div",{display:"flex",flexDirection:"column",gap:"8px"});

      const _clearSections=()=>{
        [i2vArea,kfArea,refArea,chainArea,adArea,exArea,imgArea].forEach(a=>a.style.display="none");
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
      const imgAspectDD=DD(Object.keys(IMG_ASPECTS).concat(["Custom"]),S.imgAspect||"1:1",v=>{S.imgAspect=v;persist();_updImgCustom();});
      const imgMPNI=NI("",S.imgMP,0.2,4,0.05,v=>{S.imgMP=v;persist();},"62px");
      const imgMPLbl=mk("div",{fontSize:"9px",color:C.muted,flexShrink:"0"});tx(imgMPLbl,"MP");
      const imgCustom=mk("div",{display:"none",alignItems:"center",gap:"6px",width:"100%"});
      const imgCW=NI("",S.imgW,32,16384,32,v=>{S.imgW=Math.max(32,Math.round(v/32)*32);persist();},"62px");
      const imgCH=NI("",S.imgH,32,16384,32,v=>{S.imgH=Math.max(32,Math.round(v/32)*32);persist();},"62px");
      const imgX=mk("div",{fontSize:"10px",color:C.muted,flexShrink:"0"});tx(imgX,"x");
      imgCustom.append(imgCW,imgX,imgCH,mk("div",{fontSize:"9px",color:C.muted}, {textContent:"px (custom)"}));
      const _updImgCustom=()=>{ imgCustom.style.display=S.imgAspect==="Custom"?"flex":"none"; imgMPNI._inp.disabled=S.imgAspect==="Custom"; imgMPNI.style.opacity=S.imgAspect==="Custom"?"0.5":""; };
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
      const _renderImgRefs=()=>{
        imgRefsBox.innerHTML="";
        const sub=S.imgSub;
        if(sub==="t2i") return;
        const maxRefs=sub==="edit"?1:9;
        const capLbl=sub==="edit"?"Source image":"Reference images ("+S.imgRefs.length+"/"+maxRefs+")";
        const capE=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em"});
        tx(capE,capLbl);
        imgRefsBox.appendChild(capE);
        const row=mk("div",{display:"flex",gap:"8px",flexWrap:"wrap"});
        S.imgRefs.slice(0,maxRefs).forEach((name,idx)=>{
          const slot=ImgSlot(false,n=>{ if(n===null){S.imgRefs.splice(idx,1);} else { S.imgRefs[idx]=n; persist(); } _renderImgRefs(); });
          row.appendChild(slot.el);
          if(name) slot._restorePreview(name);
        });
        if(sub==="refmix"&&S.imgRefs.length<9){
          const addImg=mk("div",{width:"72px",height:"72px",borderRadius:"12px",border:"1.5px dashed rgba(90,168,255,.4)",background:"rgba(90,168,255,.05)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"rgba(90,168,255,.8)",fontSize:"18px",fontWeight:"700",flexShrink:"0"});
          tx(addImg,"+");
          const upImg=mk("input",{display:"none"},{type:"file",accept:"image/*"});
          row.append(addImg,upImg);
          addImg.onclick=()=>{
            if(S.imgRefs.length>=9) return;
            upImg.value="";
            upImg.onchange=async()=>{
              if(!upImg.files[0]) return;
              const fd=new FormData();fd.append("image",upImg.files[0]);fd.append("overwrite","true");
              try{
                const r=await api.fetchApi("/upload/image",{method:"POST",body:fd});
                const d=await r.json();
                S.imgRefs.push(d.name||upImg.files[0].name);
                persist();
              }catch(e){ console.warn(e); }
              _renderImgRefs();
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
          tx(hint,"The source image is the canvas - the prompt describes what changes.");
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
      const firstSlot=ImgSlot(true,n=>{S.firstFrame=n;persist();});
      const lastSlot=ImgSlot(true,n=>{S.lastFrame=n;persist();});
      i2vArea.append(_mkSlotCard("First frame",firstSlot.el),_mkSlotCard("Last frame",lastSlot.el));
      if(S.firstFrame) firstSlot._restorePreview(S.firstFrame);
      if(S.lastFrame) lastSlot._restorePreview(S.lastFrame);

      // R2V refs
      const _renderRefs=()=>{
        refArea.innerHTML="";
        const imgCap=mk("div",{fontSize:"9px",fontWeight:"700",color:C.muted,textTransform:"uppercase",letterSpacing:".07em"});
        tx(imgCap,`Reference images (${S.refImages.length}/9)`);
        refArea.appendChild(imgCap);
        const imgRow=mk("div",{display:"flex",gap:"8px",flexWrap:"wrap"});
        S.refImages.forEach((name,idx)=>{
          const slot=ImgSlot(false,n=>{ if(n===null){S.refImages.splice(idx,1);} else { S.refImages[idx]=n; persist(); } _renderRefs(); });
          imgRow.appendChild(slot.el);
          if(name) slot._restorePreview(name);
        });
        const addImg=mk("div",{width:"72px",height:"72px",borderRadius:"12px",border:`1.5px dashed rgba(90,168,255,.4)`,background:"rgba(90,168,255,.05)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"rgba(90,168,255,.8)",fontSize:"18px",fontWeight:"700",flexShrink:"0"});
        tx(addImg,"+");
        const upImg=mk("input",{display:"none"},{type:"file",accept:"image/*"});
        imgRow.append(addImg,upImg);
        refArea.appendChild(imgRow);
        addImg.onclick=async()=>{
          if(S.refImages.length>=9) return;
          upImg.value="";
          upImg.onchange=async()=>{
            if(!upImg.files[0]) return;
            const fd=new FormData();fd.append("image",upImg.files[0]);fd.append("overwrite","true");
            try{
              const r=await api.fetchApi("/upload/image",{method:"POST",body:fd});
              const d=await r.json();
              S.refImages.push(d.name||upImg.files[0].name);
              persist();
            }catch(e){ console.warn(e); }
            _renderRefs();
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
        tx(vidCap,`Reference videos (${S.refVideos.length}/3)`);
        refArea.appendChild(vidCap);
        const vidRow=mk("div",{display:"flex",gap:"8px",flexWrap:"wrap"});
        S.refVideos.forEach((entry,idx)=>{
          const name=(typeof entry==="string")?entry:entry.name;
          const useAudio=!!(entry&&entry.useAudio);
          const card=mk("div",{display:"flex",flexDirection:"column",gap:"3px",alignItems:"center"});
          const slot=MediaSlot("video",n=>{
            if(n===null){ S.refVideos.splice(idx,1); }
            else { S.refVideos[idx]={name:n,useAudio:!!(S.refVideos[idx]&&S.refVideos[idx].useAudio)}; persist(); }
            _renderRefs();
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
              const on=!(S.refVideos[idx]&&S.refVideos[idx].useAudio);
              S.refVideos[idx]={name:(S.refVideos[idx]&&S.refVideos[idx].name)||name,useAudio:on};
              if(on){ S.refAudios=[]; persist(); }
              _renderRefs();
            };
            card.appendChild(tgl);
          }
          vidRow.appendChild(card);
        });
        const anyVideoAudio=S.refVideos.some(v=>v&&v.useAudio);
        const addVid=mk("div",{width:"72px",height:"72px",borderRadius:"12px",border:`1.5px dashed rgba(95,208,140,.4)`,background:"rgba(95,208,140,.05)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"rgba(95,208,140,.8)",fontSize:"18px",fontWeight:"700",flexShrink:"0"});
        tx(addVid,"+");
        addVid.onclick=async()=>{
          if(S.refVideos.length>=3) return;
          const fi=mk("input",{display:"none"},{type:"file",accept:"video/*"});
          document.body.appendChild(fi);
          fi.onchange=async()=>{
            if(!fi.files[0]){fi.remove();return;}
            const fd=new FormData();fd.append("file",fi.files[0],fi.files[0].name);
            try{
              const res=await fetch("/h3one/upload",{method:"POST",body:fd});
              const d=await res.json();
              if(d.ok){ S.refVideos.push({name:d.filename,useAudio:false}); persist(); _renderRefs(); }
            }catch(e){ console.warn(e); }
            fi.remove();
          };
          fi.click();
        };
        vidRow.append(addVid);
        refArea.appendChild(vidRow);
        if(!isAudioDrive){
        const audCap=mk("div",{fontSize:"9px",fontWeight:"700",color:anyVideoAudio?C.dim:C.muted,textTransform:"uppercase",letterSpacing:".07em",marginTop:"4px"});
        tx(audCap,anyVideoAudio?"Reference audio (using video audio)":`Reference audio (${S.refAudios.length}/3)`);
        refArea.appendChild(audCap);
        if(anyVideoAudio){
          const note=mk("div",{fontSize:"8px",color:C.dim,lineHeight:"1.5"});
          tx(note,"Disabled: <Audio N> now refers to the reference video's own soundtrack. Turn off \"Use audio\" on the video to add your own audio track.");
          refArea.appendChild(note);
        } else {
          const audRow=mk("div",{display:"flex",gap:"8px",flexWrap:"wrap"});
          S.refAudios.forEach((name,idx)=>{
            const slot=MediaSlot("audio",n=>{ if(n===null){S.refAudios.splice(idx,1);} else { S.refAudios[idx]=n; persist(); } _renderRefs(); });
            audRow.appendChild(slot);
            if(name) slot._restorePreview(name);
          });
          const addAud=mk("div",{width:"72px",height:"72px",borderRadius:"12px",border:`1.5px dashed rgba(192,127,255,.4)`,background:"rgba(192,127,255,.05)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"rgba(192,127,255,.8)",fontSize:"18px",fontWeight:"700",flexShrink:"0"});
          tx(addAud,"+");
          addAud.onclick=async()=>{
            if(S.refAudios.length>=3) return;
            const fi=mk("input",{display:"none"},{type:"file",accept:"audio/*"});
            document.body.appendChild(fi);
            fi.onchange=async()=>{
              if(!fi.files[0]){fi.remove();return;}
              const fd=new FormData();fd.append("file",fi.files[0],fi.files[0].name);
              try{
                const res=await fetch("/h3one/upload",{method:"POST",body:fd});
                const d=await res.json();
                if(d.ok){ S.refAudios.push(d.filename); persist(); _renderRefs(); }
              }catch(e){ console.warn(e); }
              fi.remove();
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
          const slot=ImgSlot(false,n=>{k.img=n;persist();});
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
      const exSlot=MediaSlot("video",n=>{S.extendVideo=n;persist();});
      exArea.append(_mkSlotCard("Video to extend",exSlot));
      if(S.extendVideo) exSlot._restorePreview(S.extendVideo);

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
        if(S.mode==="chain"){
          durRow.style.display="none";
        } else if(S.mode==="image"){
          durRow.style.display="none";
        } else {
          durRow.style.display="flex";
          tx(durCap,"Duration (s)");
          durNI._inp.disabled=false;
          durNI.style.opacity="";
        }
        params.style.display=S.mode==="image"?"none":"grid";
        tx(modeDesc, MODE_DESC[S.mode]||"");
        if(S.mode==="i2v"){ modeHdr.style.display="flex"; modeTitle.textContent="Image to Video"; i2vArea.style.display="flex"; }
        else if(S.mode==="r2v"){ modeHdr.style.display="flex"; modeTitle.textContent="Reference to Video"; _renderRefs(); refArea.style.display="flex"; }
        else if(S.mode==="audio_drive"){ modeHdr.style.display="flex"; modeTitle.textContent="Audio Drive"; _renderRefs(); refArea.style.display="flex"; adArea.style.display="flex"; }
        else if(S.mode==="keyframes"){ modeHdr.style.display="flex"; modeTitle.textContent="Custom Keyframes"; _renderKf(); kfArea.style.display="flex"; }
        else if(S.mode==="extend"){ modeHdr.style.display="flex"; modeTitle.textContent="Extend Video"; exArea.style.display="flex"; }
        else if(S.mode==="chain"){ modeHdr.style.display="flex"; modeTitle.textContent="Motion Context Chain"; _renderChain(); chainArea.style.display="flex"; }
        else if(S.mode==="image"){ modeHdr.style.display="flex"; modeTitle.textContent="Image (H3 Studio)"; _renderImgRefs(); imgArea.style.display="flex"; if(_syncImgAdvRef) _syncImgAdvRef(); }
        else { modeHdr.style.display="none"; modeTitle.textContent="Text to Video"; }
        if(typeof _syncLiveToggle==="function") _syncLiveToggle();
      };

      // -- PARAMS ------------------------------------------------------------
      const paramsHdr=mk("div",{display:"flex",alignItems:"center",gap:"6px",cursor:"pointer",userSelect:"none"});
      paramsHdr.appendChild(cap("Tune"));
      paramsHdr.lastChild.style.marginBottom="0";
      const paramsChev=mk("span",{marginLeft:"auto",color:C.dim,fontSize:"10px",flexShrink:"0"});
      tx(paramsChev,"▾");
      paramsHdr.appendChild(paramsChev);
      const params=mk("div",{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"});
      let _resItems=[];
      const _resolveRes=()=>{
        if(S.resolution==="Custom"){
          const w=Math.max(32,Math.min(16384,Math.round(S.customW/32)*32));
          const h=Math.max(32,Math.min(16384,Math.round(S.customH/32)*32));
          return {width:w,height:h,label:`${w}x${h} (custom)`};
        }
        return _resItems.find(r=>r.label===S.resolution)||_resItems[0]||{width:960,height:544,label:S.resolution};
      };
      const resRow=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const resCapRow=mk("div",{display:"flex",alignItems:"center",gap:"4px"});
      const resCap=mk("div",{fontSize:"10px",color:C.text});tx(resCap,"Resolution");
      resCapRow.append(resCap,infoIcon("The output pixel grid (width x height).\nHigher = sharper detail and more VRAM + time.\nPick Custom to set any size - snapped to multiples of 32.\nMiniMax H3 recommends up to 1344x768 (short edge <= 768, long edge <= 1344). Above that the model may repeat content or distort."));
      const resDD=DD([],S.resolution,v=>{S.resolution=v;persist();_updateFramesLabel();_updResCustom();});
      resRow.append(resCapRow,resDD.el);
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
      const durRow=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const durCap=mk("div",{fontSize:"10px",color:C.text});tx(durCap,"Duration (s)");
      const durInner=mk("div",{display:"flex",alignItems:"center",gap:"8px"});
      const durNI=NI("",S.duration,1,30,0.5,v=>{S.duration=v;persist();_updateFramesLabel();},"60px");
      const framesLbl=mk("div",{fontSize:"9px",color:C.muted,flexShrink:"0"});
      durInner.append(durNI,framesLbl);
      durRow.append(durCap,durInner);
      const stepsRow=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const stepsCap=mk("div",{fontSize:"10px",color:C.text});tx(stepsCap,"Steps");
      const stepsNI=NI("",S.steps,1,60,1,v=>{S.steps=Math.round(v);persist();},"60px");
      stepsRow.append(stepsCap,stepsNI);
      const qualRow=mk("div",{display:"flex",flexDirection:"column",gap:"3px"});
      const qualCapRow=mk("div",{display:"flex",alignItems:"center",gap:"4px"});
      const qualCap=mk("div",{fontSize:"10px",color:C.text});tx(qualCap,"Quality");
      qualCapRow.append(qualCap,infoIcon("The sampling pipeline, not the pixel size. Use the chips below to switch each accelerator on or off - Quality follows, and any manual mix shows as Custom.\nTurbo: Turbo LoRA + 6-step distilled sampler. Fastest, visibly lower quality - needs the Turbo LoRA set in Settings.\nSpeed: SolAttn + H3 block cache. Fastest normal pipeline, tiny quality tradeoff.\nBalanced: SolAttn sparse attention only.\nHigh Quality: full SageAttention only - slowest, maximum fidelity.\nNative: core ComfyUI H3 pipeline, no accelerators - needs no extra packs."));
      const qualDD=DD(["Turbo (Speed LoRA)","Speed","Balanced","High Quality","Native","Custom"],_QL[S.quality]||"Custom",v=>{
        const key=Object.keys(_QL).find(k=>_QL[k]===v)||"custom";
        if(key!=="custom"){
          S.quality=key;
          const f=_QF[key]||{sol:false,cache:false,sage:false};
          S.optSol=f.sol;S.optCache=f.cache;S.optSage=f.sage;
          _syncOptChips();
        } else {
          S.quality="custom";
        }
        persist();
        if(S.quality==="turbo"){ stepsNI._inp.value="6"; S.steps=6; }
        if(typeof _syncLiveToggle==="function") _syncLiveToggle();
      });
      qualRow.append(qualCapRow,qualDD.el);
      const optRow=mk("div",{display:"flex",gap:"5px",flexWrap:"wrap"});
      const _optChipSyncs=[];
      const _mkOptChip=(key,label)=>{
        const chip=mk("button",{borderRadius:"6px",padding:"3px 9px",fontSize:"9px",fontWeight:"700",cursor:"pointer",outline:"none",transition:"background .15s,color .15s,border-color .15s"});
        const _sync=()=>{
          const on=!!S[key];
          chip.style.background=on?C.lime:C.bg2;
          chip.style.color=on?"#111":C.muted;
          chip.style.border=`1px solid ${on?C.lime:C.border}`;
          tx(chip,(on?"✓ ":"· ")+label);
          chip.title=(on?"Enabled":"Disabled")+" - click to "+(on?"disable":"enable");
        };
        chip.onclick=()=>{
          S[key]=!S[key];
          S.quality=_matchQ();
          qualDD.set(_QL[S.quality]);
          _sync();persist();
          if(typeof _syncLiveToggle==="function") _syncLiveToggle();
        };
        _sync();
        _optChipSyncs.push(_sync);
        return chip;
      };
      const _syncOptChips=()=>_optChipSyncs.forEach(f=>f());
      optRow.append(_mkOptChip("optSol","SolAttn"),_mkOptChip("optCache","H3 Cache"),_mkOptChip("optSage","SageAttn"));
      qualRow.appendChild(optRow);
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
      params.append(resRow,durRow,stepsRow,qualRow,samplerRow,schedRow);

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
          optSol:S.optSol,optCache:S.optCache,optSage:S.optSage,
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
            if(ms.optCache!==undefined) S.optCache=ms.optCache;
            if(ms.optSage!==undefined) S.optSage=ms.optSage;
          } else {
            const f=_QF[ms.quality]||{sol:false,cache:false,sage:false};
            S.optSol=f.sol;S.optCache=f.cache;S.optSage=f.sage;
          }
          _syncOptChips();
          qualDD.set(_QL[ms.quality]||"Custom");
        }
        if(typeof _syncLiveToggle==="function") _syncLiveToggle();
        if(ms.resolution!==undefined){ S.resolution=ms.resolution; resDD.set(ms.resolution); _updResCustom(); }
        if(ms.duration!==undefined){ S.duration=ms.duration; durNI._inp.value=String(ms.duration); _updateFramesLabel(); }
        if(Array.isArray(ms.loras)){ const named=ms.loras.filter(l=>l&&l.name); S.loras=named.concat([{name:"",strength:1}]); _renderLoras(); }
        if(Array.isArray(ms.refImages)) S.refImages=ms.refImages.slice();
        if(Array.isArray(ms.refVideos)) S.refVideos=ms.refVideos.map(v=>(typeof v==="string")?{name:v,useAudio:false}:{name:(v&&v.name)||"",useAudio:!!(v&&v.useAudio)});
        if(Array.isArray(ms.refAudios)) S.refAudios=ms.refAudios.slice();
      };
      const _switchMode=(m)=>{
        if(S.mode===m) return;
        _saveModeState();
        // Reference slots are per-mode (R2V and Audio Drive keep their own sets).
        const ms0=S.modeSettings[S.mode]||{};
        ms0.refImages=(S.refImages||[]).slice();
        ms0.refVideos=(S.refVideos||[]).map(v=>(typeof v==="string")?{name:v,useAudio:false}:{name:(v&&v.name)||"",useAudio:!!(v&&v.useAudio)});
        ms0.refAudios=(S.refAudios||[]).slice();
        S.modeSettings[S.mode]=ms0;
        S.mode=m;
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
      const loraSub=mk("div",{fontSize:"10px",color:C.muted,marginLeft:"auto",marginRight:"8px"});tx(loraSub,"LoRAs — none loaded");
      const loraChev=mk("span",{color:C.dim,fontSize:"10px",flexShrink:"0"});
      tx(loraChev,"▾");
      loraHdr.append(loraTitle,loraSub,loraChev);
      const loraBody=mk("div",{display:"flex",flexDirection:"column",gap:"5px"});
      const loraRowsWrap=mk("div",{display:"flex",flexDirection:"column",gap:"5px"});
      loraBody.appendChild(loraRowsWrap);
      const addLoraBtn=mk("button",{background:"transparent",border:`1px dashed rgba(var(--h3accent-rgb),.4)`,borderRadius:"6px",padding:"4px 12px",fontSize:"9px",fontWeight:"700",color:"rgba(var(--h3accent-rgb),.7)",cursor:"pointer",outline:"none",alignSelf:"flex-start"});
      tx(addLoraBtn,"+ Add LoRA");
      addLoraBtn.onmouseenter=()=>{addLoraBtn.style.borderColor=C.lime;addLoraBtn.style.color=C.lime;};
      addLoraBtn.onmouseleave=()=>{addLoraBtn.style.borderColor="rgba(var(--h3accent-rgb),.4)";addLoraBtn.style.color="rgba(var(--h3accent-rgb),.7)";};
      addLoraBtn.onclick=()=>{
        if(S.loras.length>=8) return;
        S.loras.push({name:"",strength:1});
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
          const dd=DD(_M.loras.length?_M.loras:["none"],lr.name||"none",async v=>{
            lr.name=v==="none"?"":v;persist();
            if(lr.name){
              try{
                const r=await fetch(`/h3one/lora_triggers?name=${encodeURIComponent(lr.name)}`);
                const d=await r.json();
                if(d.ok&&d.triggers&&d.triggers.length){
                  const tw=d.triggers.join(", ");
                  if(!(S.prompt||"").includes(tw)){
                    _setPrompt((S.prompt?S.prompt+" ":"")+tw);
                  }
                }
              }catch(e){ console.warn("[H3One] lora triggers:",e); }
            }
            _renderLoras();
          });
          const stNI=NI("",lr.strength,-3,3,0.1,v=>{lr.strength=Math.round(v*100)/100;persist();},"52px");
          const rm=mk("button",{flexShrink:"0"}, {type:"button",className:"h3-rmbtn",title:"Remove this LoRA","aria-label":"Remove this LoRA"});
          tx(rm,"x");
          rm.onclick=()=>{
            S.loras.splice(idx,1);
            if(!S.loras.length) S.loras=[{name:"",strength:1}];
            persist();
            _renderLoras();
          };
          if(!lr.name && S.loras.length<=1) rm.style.display="none";
          row.append(dd.el,stNI,rm);
          loraRowsWrap.appendChild(row);
          loraRows.push(row);
        });
        addLoraBtn.style.display=S.loras.length>=8?"none":"";
        const _n=S.loras.filter(l=>l&&l.name).length;
        tx(loraSub, _n?"LoRAs — "+_n+" loaded":"LoRAs — none loaded");
      };
      _renderLoras();

      // -- Seed row (inside the Tune card) ------------------------------------
      const seedBody=mk("div",{display:"flex",flexDirection:"column",gap:"5px"});
      const seedRow=mk("div",{}, {className:"h3-seedrow"});
      const seedLbl=mk("span",{}, {className:"h3-slbl",textContent:"Seed"});
      const seedNI=NI("",S.seed,0,9007199254740991,1,v=>{S.seed=Math.round(v);persist();},"110px");
      seedNI.style.height="34px";seedNI.style.borderRadius="9px";seedNI.style.background="var(--h3-panel)";
      seedNI.style.border="1px solid var(--h3-line)";seedNI.style.width="auto";seedNI.style.flex="1 1 0";
      seedNI.style.minWidth="0";seedNI.style.maxWidth="150px";
      const _rollSeed=()=>{ S.seed=Math.floor(Math.random()*9007199254740991); seedNI._inp.value=String(S.seed); persist(); };
      const randLbl=mk("span",{}, {className:"h3-slbl",textContent:"Random"});
      const randTgl=mk("button",{}, {type:"button",role:"switch",className:"h3-tgl","aria-label":"Randomize seed",title:"Randomize seed"});
      randTgl.appendChild(mk("span",{}, {className:"thumb"}));
      const _updSeedUI=()=>{
        randTgl.classList.toggle("on",S.randomizeSeed);
        randTgl.setAttribute("aria-checked",S.randomizeSeed?"true":"false");
        tx(randLbl,S.randomizeSeed?"Random":"Fixed");
        randLbl.style.color=S.randomizeSeed?"var(--h3accent)":"";
        seedNI._inp.style.color=S.randomizeSeed?C.dim:C.text;
      };
      _updSeedUI();
      randTgl.onclick=()=>{
        if(S.randomizeSeed){ S.randomizeSeed=false; _rollSeed(); }
        else { S.randomizeSeed=true; persist(); }
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
      placeholder.append(phIco,phLbl);
      const vidEl=mk("video",{position:"absolute",inset:"0",width:"100%",height:"100%",objectFit:"contain",display:"none",background:"#000"},{controls:true});
      const imgEl=mk("img",{position:"absolute",inset:"0",width:"100%",height:"100%",objectFit:"contain",display:"none",background:"#000"});
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
      self._h3_lpFrame=(d)=>{
        if(_cmpMode) _exitCompare();
        errorBox.style.display="none";
        vidEl.style.display="none";vidEl.pause();vidEl.src="";
        placeholder.style.display="none";
        imgEl.src=d.image||"";imgEl.style.display="block";
        const step=Number(d.step)||0, total=Number(d.total)||0;
        if(total>0){
          const pct=Math.min(97,Math.max(8,Math.round(step/total*90)));
          const eta=Number(d.eta_seconds)||0;
          setStage(`Sampling · step ${step}/${total}${eta>0?` · ETA ~${Math.round(eta)}s`:""}`,pct);
        }
        _showLiveChip(true,false);
      };
      self._h3_lpReset=()=>{ _showLiveChip(true,true); };
      self._h3_lpErr=(msg)=>{ _showLiveChip(false); showError(msg); };
      previewBox.append(placeholder,vidEl,errorBox,progWrap,seedChip,liveChip);
      const comparerWrap=mk("div",{position:"absolute",inset:"0",display:"none",cursor:"col-resize",userSelect:"none",borderRadius:"10px",overflow:"hidden",zIndex:"3"});
      const cmpBase=mk("video",{position:"absolute",inset:"0",width:"100%",height:"100%",objectFit:"contain",background:"#000"},{muted:true,loop:true,preload:"auto"});
      const cmpGen=mk("div",{position:"absolute",top:"0",left:"0",bottom:"0",overflow:"hidden",width:"50%"});
      const cmpGenVid=mk("video",{position:"absolute",top:"0",left:"0",height:"100%",objectFit:"contain",background:"#000"},{muted:true,loop:true,preload:"auto"});
      cmpGen.appendChild(cmpGenVid);
      const cmpLine=mk("div",{position:"absolute",top:"0",bottom:"0",width:"2px",background:C.lime,left:"calc(50% - 1px)",boxShadow:"0 0 8px rgba(var(--h3accent-rgb),.55)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:"4"});
      const cmpHandle=mk("div",{width:"30px",height:"30px",borderRadius:"50%",background:C.lime,border:"2px solid #111",flexShrink:"0",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 10px rgba(0,0,0,.7)",pointerEvents:"none"});
      cmpHandle.innerHTML=`<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round"><path d="M8 4l-4 8 4 8M16 4l4 8-4 8"/></svg>`;
      cmpLine.appendChild(cmpHandle);
      const cmpLbl1=mk("div",{position:"absolute",top:"8px",left:"8px",fontSize:"8px",fontWeight:"700",letterSpacing:".06em",color:"#111",background:C.lime,borderRadius:"4px",padding:"2px 6px",zIndex:"5",pointerEvents:"none"});
      tx(cmpLbl1,"UPSCALED");
      const cmpLbl2=mk("div",{position:"absolute",top:"8px",right:"8px",fontSize:"8px",fontWeight:"700",letterSpacing:".06em",color:"rgba(255,255,255,.85)",background:"rgba(0,0,0,.55)",borderRadius:"4px",padding:"2px 6px",zIndex:"5",pointerEvents:"none"});
      tx(cmpLbl2,"ORIGINAL");
      comparerWrap.append(cmpBase,cmpGen,cmpLine,cmpLbl1,cmpLbl2);
      previewBox.appendChild(comparerWrap);
      let _cmpDragging=false;
      const _cmpSetPct=(pct)=>{
        pct=Math.max(0,Math.min(100,pct));
        cmpGen.style.width=pct+"%";
        cmpLine.style.left=`calc(${pct}% - 1px)`;
        cmpGenVid.style.width=(comparerWrap.offsetWidth||600)+"px";
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
      let _cmpMode=false;
      let _upOrig=null;
      let _upResult=null;
      let _upscaleRun="";
      const _enterCompare=()=>{
        if(!_upOrig||!_curItem) return;
        const upUrl=api.apiURL(`/view?filename=${encodeURIComponent(_curItem.filename)}&type=output&subfolder=${encodeURIComponent(_curItem.subfolder||"")}`);
        const orUrl=api.apiURL(`/view?filename=${encodeURIComponent(_upOrig.filename)}&type=output&subfolder=${encodeURIComponent(_upOrig.subfolder||"")}`);
        cmpGenVid.src=upUrl;
        cmpBase.src=orUrl;
        cmpGenVid.load();cmpBase.load();
        _cmpMode=true;
        _cmpSetPct(50);
        vidEl.style.display="none";
        comparerWrap.style.display="block";
        tx(cmpBtn,"Exit compare");
        cmpGenVid.play().catch(()=>{});
        cmpBase.play().catch(()=>{});
      };
      const _exitCompare=()=>{
        _cmpMode=false;
        cmpGenVid.pause();cmpBase.pause();
        cmpGenVid.src="";cmpBase.src="";
        comparerWrap.style.display="none";
        vidEl.style.display="block";
        tx(cmpBtn,"Compare");
      };
      const setStage=(l,p)=>{
        tx(progStage,l);progFill.style.width=p+"%";tx(progPct,Math.round(p)+"%");
      };
      const timeBar=mk("div",{display:"none",alignItems:"center",justifyContent:"center",gap:"7px",background:C.bg1,border:`1px solid ${C.border}`,borderRadius:"8px",padding:"5px 10px"});
      const timeIco=mk("span",{fontSize:"10px",opacity:".7"});tx(timeIco,"⏱");
      const timeLbl=mk("span",{fontSize:"9px",fontWeight:"700",letterSpacing:".05em",textTransform:"uppercase",color:C.muted});tx(timeLbl,"Generation time");
      const timeVal=mk("span",{fontSize:"11px",fontWeight:"700",color:C.lime,fontVariantNumeric:"tabular-nums"});tx(timeVal,"0s");
      timeBar.append(timeIco,timeLbl,timeVal);
      const _updateTimeBar=(filename)=>{
        const t=_genTimeByFile[filename];
        if(t){
          tx(timeVal,fmtDur(t));
          timeBar.style.display="flex";
          return;
        }
        timeBar.style.display="none";
        _fetchTimeFromHistory(filename).then(t=>{
          if(t && _curItem && _curItem.filename===filename){
            _genTimeByFile[filename]=t;
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
        if(_curItem) _updateTimeBar(_curItem.filename);
      };
      const galleryBox=mk("div",{display:"flex",gap:"8px",overflowX:"auto",paddingBottom:"4px",scrollbarWidth:"thin"});
      const galleryHdr=mk("div",{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"6px",padding:"2px 0 5px"});
      const galleryTitle=mk("div",{fontSize:"9px",fontWeight:"700",letterSpacing:".1em",textTransform:"uppercase",color:C.muted});
      tx(galleryTitle,"Outputs");
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
      const liveTogWrap=mk("div",{display:"flex",gap:"4px",alignItems:"center",flexShrink:"0"});
      const liveTogBtn=mk("button",{}, {type:"button",className:"h3-actbtn"+(S.livePreview?" on":"")});
      liveTogBtn._lbl=mk("span",{}, {textContent:S.livePreview?"Preview On":"Preview Off"});
      liveTogBtn.appendChild(liveTogBtn._lbl);
      const liveInfo=infoIcon("Live Preview: watch the video appear while it samples. Each step is decoded with a tiny TAEH3 model on the CPU, so generation takes a little longer.\nNeeds taeh3.safetensors in a ComfyUI models/vae_approx folder - download it from huggingface.co/Kijai/MiniMax-H3-TAE. If your copy lives in a subfolder, pick it under Settings: Live Preview decoder.\nNot available with the Turbo preset or in Image mode.");
      const _syncLiveToggle=()=>{
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
      liveTogWrap.append(liveTogBtn,liveInfo);
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
      galleryHdr.append(galleryTitle,saveTogBtn,liveTogWrap,galleryRefresh,galleryActs);
      const galleryWrap=mk("div",{display:"flex",flexDirection:"column",gap:"7px"});
      galleryWrap.append(galleryHdr,galleryBox);
      rightPanel.append(previewBox,timeBar,galleryWrap);

      let _galItems=[];
      let _curItem=null;
      const _showVideo=(item,fromFinish)=>{
        _curItem=item;
        if(_cmpMode) _exitCompare();
        if(_upResult){
          cmpBtn.style.display=item.filename===_upResult.filename?"block":"none";
        }
        const vtype=item.type||"output";
        const url=api.apiURL(`/view?filename=${encodeURIComponent(item.filename)}&type=${vtype}&subfolder=${encodeURIComponent(item.subfolder||"")}`);
        if(item.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(item.filename||"")){
          vidEl.style.display="none";vidEl.pause();vidEl.src="";
          imgEl.src=url;imgEl.style.display="block";
          placeholder.style.display="none";errorBox.style.display="none";
          _updateSeedChip(item.filename);
          if(_seedByFile[item.filename]===undefined) _showSeedFromHistory(item.filename);
          _updateTimeBar(item.filename);
          return;
        }
        vidEl.src=url;vidEl.style.display="block";imgEl.style.display="none";
        placeholder.style.display="none";errorBox.style.display="none";
        _updateSeedChip(item.filename);
        if(_seedByFile[item.filename]===undefined) _showSeedFromHistory(item.filename);
        _updateTimeBar(item.filename);
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
      const _favCurrent=async()=>{
        if(!_curItem) return;
        const nf=!_curItem.favorite;
        await fetch("/h3one/favorite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:_curItem.filename,favorite:nf})}).catch(()=>{});
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
            wf["3"].inputs["resize_type.scale"]=S.upscaleFactor;
          }else{
            wf["3"].inputs.model=S.models.upscaleDit;
            wf["4"].inputs.model=S.models.upscaleVae;
            const resMap={2:1080,3:1440,4:2160};
            wf["5"].inputs.resolution=resMap[S.upscaleFactor]||1080;
          }
          _applyAutoSave(wf);
          const body={prompt:wf,client_id:api.clientId,extra_data:{enable_previews:true}};
          const res=await api.fetchApi("/prompt",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
          const data=await res.json();
          if(data.error||!data.prompt_id) throw new Error(data.error?.message||"Unknown error");
          _batchIds=[data.prompt_id];_batchDone=0;_activePromptId=data.prompt_id;
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
          const url=api.apiURL(`/view?filename=${encodeURIComponent(item.filename)}&type=output&subfolder=${encodeURIComponent(item.subfolder||"")}`);
          const isImg=item.kind==="image"||/\.(png|jpe?g|webp|bmp)$/i.test(item.filename||"");
          const v=isImg
            ? mk("img",{width:"100%",height:"54px",objectFit:"cover",display:"block",background:"#000",pointerEvents:"none"},{src:url})
            : mk("video",{width:"100%",height:"54px",objectFit:"cover",display:"block",background:"#000",pointerEvents:"none"},{muted:true,preload:"metadata"});
          if(!isImg) v.src=url;
          const name=mk("div",{fontSize:"8px",color:C.muted,padding:"3px 5px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"});
          tx(name,(item.favorite?"* ":"")+item.filename);
          if(item.favorite) name.style.color=C.lime;
          card.append(v,name);
          card.onclick=()=>_showVideo(item);
          card.onmouseenter=()=>card.style.borderColor=C.lime;
          card.onmouseleave=()=>card.style.borderColor=C.border;
          galleryBox.appendChild(card);
        });
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
      genRow.append(genBtn,stopBtn);

      const resetBtn=()=>{
        S.generating=false;
        _batchIds=[];_batchDone=0;
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
        const title=mk("div",{fontSize:"12px",fontWeight:"700",color:C.err,letterSpacing:".02em",marginBottom:"6px"});
        tx(title,"Something went wrong");
        const body=mk("div",{fontSize:"11px",color:C.text,lineHeight:"1.6",whiteSpace:"pre-wrap",wordBreak:"break-word",maxWidth:"100%"});
        tx(body,fmtErr(msg));
        errorBox.append(title,body);
        vidEl.style.display="none";imgEl.style.display="none";placeholder.style.display="none";
      };
      const showOutput=(item)=>{
        errorBox.style.display="none";
        if(S.seed!==undefined&&S.seed!==null&&S.seed!=="") _seedByFile[item.filename]=S.seed;
        const genMs=Date.now()-_activeGenStartTs;
        _genTimeByFile[item.filename]=genMs;
        const wasUpscale=_upscaleRun;
        if(_upscaleRun&&_upOrig){
          _upResult={filename:item.filename,subfolder:item.subfolder||""};
        }
        _showVideo(item,true);
        if(_upResult&&_upResult.filename===item.filename){
          cmpBtn.style.display="block";
        }
        _upscaleRun="";
        _activeShownFiles.push(item.filename);
        const isTemp=item.type==="temp";
        if(!isTemp){
          fetch("/h3one/set_output",{method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({node_id:self.id,info:{filename:item.filename,subfolder:item.subfolder||""}})}).catch(()=>{});
          const histMode=wasUpscale?("Upscale "+S.upscaleFactor+"x ("+(wasUpscale==="upscale-rtx"?"RTX VSR":"SeedVR2")+")"):S.mode;
          const histRes=wasUpscale?(S.upscaleFactor+"x upscale"):(S.mode==="image"?(S.imgLastW+"x"+S.imgLastH):S.resolution);
          fetch("/h3one/history",{method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
              mode:histMode,quality:wasUpscale?"":S.quality,prompt:(S.prompt||"").slice(0,2000),duration:wasUpscale?0:S.duration,
              resolution:histRes,seed:S.seed,gen_time:genMs,video:item.filename,subfolder:item.subfolder||"",
              kind:item.kind==="image"?"image":"video",
            })}).catch(()=>{});
        }
        _loadGallery();
      };
      const _genTimeByFile={};
      const _seedByFile={};
      const _updateSeedChip=(filename)=>{
        let seed=_seedByFile[filename];
        if(seed===undefined||seed===null||seed===""){
          seedChip.style.display="none";
          return;
        }
        tx(seedChipVal,String(seed));
        seedChip.style.display="flex";
      };
      const _showSeedFromHistory=async(filename)=>{
        try{
          const r=await fetch("/h3one/history");
          const d=await r.json();
          const hit=(d.items||[]).find(it=>it.video===filename);
          if(hit&&hit.seed!==undefined&&hit.seed!==null){
            _seedByFile[filename]=hit.seed;
            _updateSeedChip(filename);
          }
        }catch(e){}
      };
      const _fetchTimeFromHistory=async(filename)=>{
        try{
          const r=await fetch("/h3one/history");
          const d=await r.json();
          const hit=(d.items||[]).find(it=>it.video===filename);
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
          showOutput(items[0]);
        }catch(e){}
      };

      // -- WORKFLOW BUILDERS -------------------------------------------------
      const _fetchTpl=async(name)=>{
        const res=await fetch(`/h3one/workflow/${name}`);
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
        if(text.includes("integrated_multimodal_description")||text.includes("summary:")||text.includes("detailed_description:")){
          if(S.mode==="r2v"&&S.refAudios.length&&!text.includes("<Audio")){
            text=text.replace(/(retention_analysis:\s*)/i, "$1<Audio 1>: fully_copy - reused 1:1 as the target video's complete final audio track.\n");
            if(!/<Audio/.test(text.split("overall_soundscape:")[1]||"")){
              text=text.replace(/(overall_soundscape:\s*)/i, "$1The copied audio track <Audio 1> is the complete soundtrack. ");
            }
          }
          return text;
        }
        const mode=tplKey||S.mode;
        const tpl=_discTmpl[mode==="chain"?"chain":mode]||{};
        const wrap=tpl.wrap;
        if(!wrap) return text;
        return wrap.split("{USER}").join(text);
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
        const actives=S.loras.filter(l=>l.name);
        actives.forEach(lr=>{
          const id=newId();
          wf[id]={class_type:"LoraLoaderModelOnly",inputs:{model:modelSrc,lora_name:lr.name,strength_model:lr.strength},_meta:{title:"LoRA"}};
          modelSrc=[id,0];
        });
        const q=S.quality;
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
          const useSol=!!S.optSol, useCache=!!S.optCache, useSage=!!S.optSage;
          const insSol=()=>{
            const sol=newId();
            wf[sol]={class_type:"SolAttnPatch",inputs:{
              model:modelSrc,tau:1.3,start_percent:0.2,end_percent:0.9,min_tokens:4096,
              int8_qk:true,sink_conditioning:"exact_kv_and_rows",morton:false,
              morton_curve:"2d_frame",int8_pv:true,verbose:true,use_tma:false,dense_blocks:"",
            },_meta:{title:"Sol-Attn"}};
            modelSrc=[sol,0];
          };
          const insCache=()=>{
            const cache=newId();
            wf[cache]={class_type:"MiniMaxH3Cache",inputs:{
              model:modelSrc,resuse_threshold:0.1,start_percent:0.15,end_percent:0.9,
              max_steps:2,device:"auto",verbose:false,
            },_meta:{title:"H3 Cache"}};
            modelSrc=[cache,0];
          };
          const insSage=()=>{
            const sage=newId();
            wf[sage]={class_type:"MiniMaxH3MemoryEfficientSageAttentionPatch",inputs:{model:modelSrc},_meta:{title:"SageAttn"}};
            modelSrc=[sage,0];
          };
          if(useSage&&useSol){
            // Sol + Sage together: follow the tested ordering (cache -> sage -> sol)
            if(useCache) insCache();
            insSage();insSol();
          } else {
            // Preset combos keep their exact historical order (sol -> cache -> sage)
            if(useSol) insSol();
            if(useCache) insCache();
            if(useSage) insSage();
          }
          wf["9"].inputs.steps=S.steps;
        }
        wf["5"].inputs.model=modelSrc;
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
        wf["2"].inputs.unet_name= isR2V&&(S.mode==="r2v"||S.mode==="audio_drive")? S.models.unetR2V : S.models.unetT2V;
        wf["3"].inputs.vae_name=S.models.vaeVideo;
        wf["4"].inputs.vae_name=S.models.vaeAudio;
        const res=_resolveRes();
        let frames=snapFrames(S.duration);
        if(S.mode==="extend"){
          const EXT_CONTEXT=90;
          frames=snapFrames(S.duration+EXT_CONTEXT/24);
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
          wf["lp"]={class_type:"H3StudioTAEH3Preview",inputs:{
            model:wf["5"].inputs.model,
            enabled:true,
            tiny_vae:S.models.tae||"taeh3.safetensors",
            max_resolution:768,
            jpeg_quality:85,
            preview_every_n_steps:1,
          },_meta:{title:"Live Preview (TAEH3)"}};
          wf["5"].inputs.model=["lp",0];
        }
        _applyAutoSave(wf);
        _insertCacheBust(wf);
        return {frames,res};
      };

      const _buildImage=async()=>{
        const sub=S.imgSub;
        const refs=(S.imgRefs||[]).slice(0,sub==="edit"?1:9);
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
        let w,h;
        if(S.imgAspect==="Custom"){
          w=Math.max(32,Math.round((S.imgW||1024)/32)*32);
          h=Math.max(32,Math.round((S.imgH||1024)/32)*32);
        } else {
          const r=(IMG_ASPECTS[S.imgAspect]||1);
          const total=Math.max(0.2,Number(S.imgMP)||1)*1e6;
          w=Math.round(Math.sqrt(total*r));h=Math.round(Math.sqrt(total/r));
          w=Math.max(32,Math.round(w/32)*32);h=Math.max(32,Math.round(h/32)*32);
        }
        S.imgLastW=w;S.imgLastH=h;
        dir.width=w;dir.height=h;
        dir.aspect_ratio=S.imgAspect==="Custom"?"1:1":S.imgAspect;
        dir.megapixels=Number(S.imgMP)||1;
        dir.seed=S.seed||0;
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
          const totalFrames=snapFrames(S.duration);
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
          const frames=snapFrames(cl.duration);
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
        const actives=S.loras.filter(l=>l.name);
        actives.forEach(lr=>{
          const id=newId();
          wf[id]={class_type:"LoraLoaderModelOnly",inputs:{model:modelSrc,lora_name:lr.name,strength_model:lr.strength},_meta:{title:"LoRA"}};
          modelSrc=[id,0];
        });
        {
          const useSol=!!S.optSol, useCache=!!S.optCache, useSage=!!S.optSage;
          const insSol=()=>{
            const sol=newId();
            wf[sol]={class_type:"SolAttnPatch",inputs:{
              model:modelSrc,tau:1.3,start_percent:0.2,end_percent:0.9,min_tokens:4096,
              int8_qk:true,sink_conditioning:"exact_kv_and_rows",morton:false,
              morton_curve:"2d_frame",int8_pv:true,verbose:true,use_tma:false,dense_blocks:"",
            },_meta:{title:"Sol-Attn"}};
            modelSrc=[sol,0];
          };
          const insCache=()=>{
            const cache=newId();
            wf[cache]={class_type:"MiniMaxH3Cache",inputs:{
              model:modelSrc,resuse_threshold:0.1,start_percent:0.15,end_percent:0.9,
              max_steps:2,device:"auto",verbose:false,
            },_meta:{title:"H3 Cache"}};
            modelSrc=[cache,0];
          };
          const insSage=()=>{
            const sage=newId();
            wf[sage]={class_type:"MiniMaxH3MemoryEfficientSageAttentionPatch",inputs:{model:modelSrc},_meta:{title:"SageAttn"}};
            modelSrc=[sage,0];
          };
          if(useSage&&useSol){
            if(useCache) insCache();
            insSage();insSol();
          } else {
            if(useSol) insSol();
            if(useCache) insCache();
            if(useSage) insSage();
          }
        }
        wf["s:5"].inputs.model=modelSrc;
        if(S.livePreview){
          wf["s:lp"]={class_type:"H3StudioTAEH3Preview",inputs:{
            model:modelSrc,
            enabled:true,
            tiny_vae:S.models.tae||"taeh3.safetensors",
            max_resolution:768,
            jpeg_quality:85,
            preview_every_n_steps:1,
          },_meta:{title:"Live Preview (TAEH3)"}};
          wf["s:5"].inputs.model=["s:lp",0];
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
        return wf;
      };

      genBtn.onclick=async()=>{
        if(S.generating) return;
        _upOrig=null;_upResult=null;
        if(_cmpMode) _exitCompare();
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
        try{
          const n=Math.max(1,Math.min(4,S.batch||1));
          const ids=[];
          for(let i=0;i<n;i++){
            if(S.randomizeSeed){ S.seed=Math.floor(Math.random()*9007199254740991); seedNI._inp.value=String(S.seed); }
            const wf=await _buildWorkflow();
            const body={prompt:wf,client_id:api.clientId,extra_data:{enable_previews:true}};
            const res=await api.fetchApi("/prompt",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
            const data=await res.json();
            if(data.error||!data.prompt_id){
              throw new Error(data.error?.message||JSON.stringify(data.error)||"Unknown error");
            }
            ids.push(data.prompt_id);
          }
          _batchIds=ids;
          _batchDone=0;
          _activePromptId=ids[ids.length-1];
          _armFinishWatch();
          setStage(n>1?`Queued ${n} runs...`:"In queue...",6);
        }catch(e){
          resetBtn();showError(fmtErr(e));
        }
      };

      stopBtn.onclick=async()=>{
        try{await api.fetchApi("/interrupt",{method:"POST"});}catch(e){}
        if(_activePromptId){
          try{await api.fetchApi("/queue",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({delete:[_activePromptId]})});}catch(e){}
          _activePromptId=null;
        }
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
          _M={diffusion:d.diffusion_models||[],text_encoders:d.text_encoders||[],vaes:d.vaes||[],loras:d.loras||[]};
          const has=(arr,v)=>arr.some(m=>(m||"").toLowerCase()===(v||"").toLowerCase());
          if(!has(_M.text_encoders,S.models.clip)) S.models.clip=_pickModel(_M.text_encoders,"qwen3vl_32b_minimax_h3");
          if(!has(_M.diffusion,S.models.unetT2V)) S.models.unetT2V=_pickModel(_M.diffusion,"fl2va");
          if(!has(_M.diffusion,S.models.unetR2V)) S.models.unetR2V=_pickModel(_M.diffusion,"ref2va");
          if(!has(_M.vaes,S.models.vaeVideo)) S.models.vaeVideo=_pickModel(_M.vaes,"video_vae");
          if(!has(_M.vaes,S.models.vaeAudio)) S.models.vaeAudio=_pickModel(_M.vaes,"audio_vae");
          persist();
          modelDDs.unetT2V.updateItems(_M.diffusion);
          modelDDs.unetR2V.updateItems(_M.diffusion);
          modelDDs.clip.updateItems(_M.text_encoders);
          modelDDs.vaeVideo.updateItems(_M.vaes);
          modelDDs.vaeAudio.updateItems(_M.vaes);
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
      const _updateFramesLabel=()=>{ tx(framesLbl,`= ${snapFrames(S.duration)} frames @ 24fps`); };
      _updateFramesLabel();
      _loadModels();
      _loadConfig();
      _loadGallery();

      // -- Assemble ----------------------------------------------------------
      const mainRow=mk("div",{display:"flex",gap:"12px",alignItems:"stretch",flex:"1",minHeight:"0"});
      const leftPanel=mk("div",{display:"flex",flexDirection:"column",gap:"9px",width:"420px",flexShrink:"0",overflowY:"auto",minHeight:"0",paddingRight:"4px",boxSizing:"border-box",scrollbarWidth:"thin",scrollbarColor:`${C.border} transparent`});
      modeArea.append(i2vArea,refArea,kfArea,adArea,exArea,chainArea,imgArea);
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
        const chip=(label,value,media)=>{
          const c=mk("span",{}, {className:"h3-chip"+(media?" media":"")});
          if(label) c.appendChild(mk("span",{}, {className:"cl",textContent:label}));
          c.appendChild(mk("span",{}, {className:"cv",textContent:value}));
          recipeEl.appendChild(c);
        };
        if(S.mode==="image"){
          chip(null,_imgModeKey[S.imgSub]||"Text to Image",true);
          chip(null,S.imgAspect==="Custom"?`${S.imgW}×${S.imgH}`:`${S.imgAspect} · ${S.imgMP}MP`,true);
          recipeEl.appendChild(mk("span",{}, {className:"h3-gsep","aria-hidden":"true"}));
          chip(null,_imgProfLabel());
          chip("seed",S.randomizeSeed?"random":String(S.seed||0));
          chip(null,`×${S.batch||1}`);
          return;
        }
        const r=_resolveRes();
        chip(null,`${r.width}×${r.height}`,true);
        chip(null,S.mode==="chain"?`${S.chainClips.length} clips`:`${S.duration}s`,true);
        recipeEl.appendChild(mk("span",{}, {className:"h3-gsep","aria-hidden":"true"}));
        chip("steps",String(S.steps));
        chip(null,_q);
        chip(null,`${S.samplerName||"res_multistep"} · ${S.schedulerName||"simple"}`);
        chip("seed",S.randomizeSeed?"random":String(S.seed||0));
        chip(null,`×${S.batch||1}`);
      };
      _updRecipe();
      _updRecipeFn=_updRecipe;
      leftPanel.append(promptCard,modeCard,tuneCard,loraArea);
      _applyFold("prompt",promptHdr,promptWrap,promptChev);
      _applyFold("mode",modeHdr,modeArea,modeChev);
      _applyFold("params",paramsHdr,tuneBody,paramsChev);
      _applyFold("lora",loraHdr,loraBody,loraChev);
      mainRow.append(leftPanel,rightPanel);
      pad.append(navRow,mainRow,genRow);
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
        const tag=(document.activeElement||{}).tagName||"";
        if(tag==="INPUT"||tag==="TEXTAREA") return;
        if(settingsOverlay.style.display!=="none"||historyOverlay.style.display!=="none"||libraryOverlay.style.display!=="none"||discoverOverlay.style.display!=="none") return;
        e.preventDefault();e.stopPropagation();
        genBtn.click();
      });

      document.addEventListener("paste",async(e)=>{
        if(!_mouseOverRoot) return;
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
        if(S.mode==="i2v"){
          if(!S.firstFrame) firstSlot.loadFile(file);
          else lastSlot.loadFile(file);
        } else if(S.mode==="r2v"){
          if(S.refImages.length>=9) return;
          const fd=new FormData();fd.append("image",file);fd.append("overwrite","true");
          try{
            const r=await api.fetchApi("/upload/image",{method:"POST",body:fd});
            const d=await r.json();
            S.refImages.push(d.name||file.name);
            persist();
            _renderRefs();
          }catch(err){ console.warn("[H3One] paste upload:",err); }
        } else if(S.mode==="keyframes"){
          let empty=S.kf.find(k=>!k.img);
          if(!empty){
            if(S.kf.length>=32) return;
            empty={img:null,pos:Math.min(9999,(S.kf.length+1)*62)};
            S.kf.push(empty);
          }
          const fd=new FormData();fd.append("image",file);fd.append("overwrite","true");
          try{
            const r=await api.fetchApi("/upload/image",{method:"POST",body:fd});
            const d=await r.json();
            empty.img=d.name||file.name;
            persist();_renderKf();
          }catch(err){ console.warn("[H3One] paste upload:",err); }
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
    const {value,max}=evt.detail||{};
    if(max>0&&_activeSetStage) _activeSetStage("Sampling...",8+Math.round(value/max*86));
  });

  api.addEventListener("h3studio-preview",(evt)=>{
    const node=_activeNode;
    if(!node||!node._h3_lpOn) return;
    const d=evt.detail||{};
    if(d.node_id!==node._h3_lpId) return;
    if(d.error){ if(node._h3_lpErr) node._h3_lpErr(String(d.error)); return; }
    if(d.reset){ if(node._h3_lpReset) node._h3_lpReset(); return; }
    if(d.image){ if(node._h3_lpFrame) node._h3_lpFrame(d); }
  });

  api.addEventListener("executed",(evt)=>{
    if(!_activeNode) return;
    const d=evt.detail;
    if(!d||!_batchIds.includes(d.prompt_id)) return;
    const out=d.output;
    if(!out) return;
    const vids=out.videos||out.gifs||null;
    if(vids&&Array.isArray(vids)&&vids.length&&_activeShowOutput){
      _activeShowOutput(vids[vids.length-1]);
      _activeSetStage?.("Done",97);
    }
    const imgs=out.images||null;
    if(imgs&&Array.isArray(imgs)&&imgs.length&&_activeShowOutput){
      const im=imgs[imgs.length-1];
      _activeShowOutput({filename:im.filename,subfolder:im.subfolder||"",type:im.type||"output",kind:"image"});
      _activeSetStage?.("Done",97);
    }
  });

  api.addEventListener("execution_success",()=>{
    _finishRun();
  });

  api.addEventListener("execution_error",(evt)=>{
    if(!_activeNode) return;
    const d=evt.detail;
    if(d?.prompt_id&&_batchIds.length&&!_batchIds.includes(d.prompt_id)) return;
    const msg=fmtErr(d?.exception_message||d?.error||d||"Execution failed.");
    _activeShowError?.(msg);
    _activeResetBtn?.();
  });
})();
