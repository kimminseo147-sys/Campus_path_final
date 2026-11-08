const B = Object.fromEntries(BUILDINGS.map(b=>[b.id,b]));
const DAYS = ["월","화","수","목","금"];
const START_H = 9, END_H = 18, PX = 1.05; // px per minute

const SAMPLE_COURSES = [
  {name:"생산관리",     cr:3, day:0, start:"10:30", end:"11:45", bld:"eng1"},
  {name:"확률과 통계",  cr:3, day:0, start:"12:00", end:"13:15", bld:"gachon"},
  {name:"데이터마이닝", cr:3, day:0, start:"13:30", end:"14:45", bld:"ai"},
  {name:"생산관리",     cr:3, day:2, start:"10:30", end:"11:45", bld:"eng1"},
  {name:"확률과 통계",  cr:3, day:2, start:"12:00", end:"13:15", bld:"gachon"},
  {name:"품질경영",     cr:3, day:2, start:"13:30", end:"14:45", bld:"eng2"},
  {name:"경영과학",     cr:3, day:3, start:"12:00", end:"13:15", bld:"vision"},
  {name:"인간공학",     cr:3, day:3, start:"13:30", end:"14:45", bld:"ai"},
  {name:"데이터마이닝", cr:3, day:3, start:"15:00", end:"16:15", bld:"ai"},
];

/* ---------- storage (per-browser convenience) ---------- */
const store = {
  get(k,d){try{const v=localStorage.getItem("cp:"+k);return v?JSON.parse(v):d}catch(e){return d}},
  set(k,v){try{localStorage.setItem("cp:"+k,JSON.stringify(v))}catch(e){}}
};

/* ---------- helpers ---------- */
const $ = s=>document.querySelector(s);
const esc = s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const toMin = t=>{const [h,m]=t.split(":").map(Number);return h*60+m};
function haversine(a,b){
  const R=6371000, r=x=>x*Math.PI/180;
  const dLat=r(b.lat-a.lat), dLng=r(b.lng-a.lng);
  const h=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
/* 핵심 연산: 두 건물 사이 도보 시간(분), 경로 길이, 오르막 */
/* ---------- 보행망 경로탐색 ----------  (그래프 데이터는 js/walknet.js) */
const BUF_MIN = 1;          // 건물 출입 시간(분)
const STEPS_FACTOR = 0.55;  // 계단 구간 속도 배율
const tobler = s => 6*Math.exp(-3.5*Math.abs(s+0.05)); // km/h
let NET=null;
function buildNet(){
  const n=WALKNET.n.length;
  // 노드 고도: 건물 고도로 역거리가중 보간 (BUILDINGS 고도를 바꾸면 자동 반영)
  const elev=WALKNET.n.map(([lat,lng])=>{
    let w=0,v=0;
    for(const b of BUILDINGS){const d=Math.max(5,haversine({lat,lng},b));const k=1/(d*d);w+=k;v+=k*b.elev}
    return v/w;
  });
  const adj=Array.from({length:n},()=>[]);
  WALKNET.e.forEach(([a,b,st])=>{
    const len=haversine({lat:WALKNET.n[a][0],lng:WALKNET.n[a][1]},{lat:WALKNET.n[b][0],lng:WALKNET.n[b][1]});
    if(len<0.01) return;
    adj[a].push([b,len,st]); adj[b].push([a,len,st]);
  });
  NET={elev,adj};
}
function edgeMin(u,v,len,st){
  const s=(NET.elev[v]-NET.elev[u])/len;
  return len/1000/(tobler(s)*(st?STEPS_FACTOR:1))*60;
}
const routeCache=new Map();
function findRoute(fromId,toId){
  const key=fromId+">"+toId; if(routeCache.has(key)) return routeCache.get(key);
  if(!NET) buildNet();
  const src=WALKNET.acc[fromId], dst=new Set(WALKNET.acc[toId]||[]);
  if(!src||!src.length||!dst.size){routeCache.set(key,null);return null}
  const n=WALKNET.n.length, dist=new Float64Array(n).fill(Infinity), prev=new Int32Array(n).fill(-1), pst=new Uint8Array(n);
  const heap=[]; const push=(d,v)=>{heap.push([d,v]);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p][0]<=heap[i][0])break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p}};
  const pop=()=>{const t=heap[0],l=heap.pop();if(heap.length){heap[0]=l;let i=0;for(;;){let a=2*i+1,b=a+1,m=i;if(a<heap.length&&heap[a][0]<heap[m][0])m=a;if(b<heap.length&&heap[b][0]<heap[m][0])m=b;if(m===i)break;[heap[m],heap[i]]=[heap[i],heap[m]];i=m}}return t};
  src.forEach(v=>{dist[v]=0;push(0,v)});
  let end=-1;
  while(heap.length){
    const [d,u]=pop(); if(d>dist[u]) continue;
    if(dst.has(u)){end=u;break}
    for(const [v,len,st] of NET.adj[u]){const nd=d+edgeMin(u,v,len,st); if(nd<dist[v]){dist[v]=nd;prev[v]=u;pst[v]=st;push(nd,v)}}
  }
  if(end<0){routeCache.set(key,null);return null}
  const path=[]; let len=0, climb=0, steps=false;
  for(let v=end;v>=0;v=prev[v]){
    path.push(WALKNET.n[v]);
    const u=prev[v]; if(u>=0){ const e=NET.adj[u].find(x=>x[0]===v); len+=e[1]; climb+=Math.max(0,NET.elev[v]-NET.elev[u]); if(pst[v]) steps=true; }
  }
  path.reverse();
  const r={min:dist[end]+BUF_MIN, dist:len, climb, dh:B[toId].elev-B[fromId].elev, steps, path};
  r.slope=r.dh/Math.max(len,1);
  routeCache.set(key,r); return r;
}
/* 두 건물 사이 도보 시간(분)·거리·오르막. 보행망이 없으면 직선거리×1.3으로 추정 */
function walk(fromId,toId){
  const a=B[fromId], b=B[toId];
  if(!a||!b) return null;
  if(fromId===toId) return {min:1, dist:0, climb:0, dh:0, slope:0, path:null};
  const r=findRoute(fromId,toId); if(r) return r;
  const dist = haversine(a,b)*1.3, dh=b.elev-a.elev, slope=dh/dist;
  return {min:dist/1000/tobler(slope)*60+1.5, dist, climb:Math.max(0,dh), dh, slope, path:null};
}
function judge(walkMin,gap,same){
  if(gap>=60) return {lv:"free", label:"공강"};
  if(same) return {lv:"same", label:"같은 건물"};
  const r = walkMin/Math.max(gap,1);
  if(r<0.6) return {lv:"safe", label:"여유", r};
  if(r<0.9) return {lv:"warn", label:"빠듯", r};
  return {lv:"danger", label:"위험", r};
}
function fatigue(w,gap){ // 0~100
  return Math.max(0,Math.min(100,Math.round(w.min/Math.max(gap,1)*80 + w.climb*0.4)));
}

/* ---------- state ---------- */
let courses = store.get("courses", SAMPLE_COURSES);
if(!Array.isArray(courses)||courses.some(c=>!B[c.bld])) courses = JSON.parse(JSON.stringify(SAMPLE_COURSES));
let mapDay = store.get("mapDay", 0);

function legsForDay(d){
  const list = courses.filter(c=>c.day===d).sort((a,b)=>toMin(a.start)-toMin(b.start));
  const legs=[];
  for(let i=0;i<list.length-1;i++){
    const p=list[i], n=list[i+1];
    const gap=toMin(n.start)-toMin(p.end);
    const w=walk(p.bld,n.bld);
    legs.push({from:p,to:n,gap,w,j:judge(w.min,gap,p.bld===n.bld),fat:fatigue(w,gap)});
  }
  return {list,legs};
}

/* ---------- timetable render ---------- */
const COLORS = 4;
function colorIdx(name){let h=0;for(const ch of name)h=(h*31+ch.charCodeAt(0))>>>0;return h%COLORS+1}
const runIcon = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 10 L5 4 L8 6 L10 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderTT(){
  const tt=$("#tt"); const H=(END_H-START_H)*60*PX;
  tt.style.setProperty("--hour",(60*PX)+"px");
  let html='<div class="tt-dayh"></div>'+DAYS.map((d,i)=>{
    const n=courses.filter(c=>c.day===i).length;
    return `<div class="tt-dayh">${d}<small>${n?n+"과목":"공강"}</small></div>`}).join("");
  html+=`<div class="tt-times" style="height:${H}px">`;
  for(let h=START_H;h<=END_H;h++) html+=`<span style="top:${(h-START_H)*60*PX}px">${String(h).padStart(2,"0")}:00</span>`;
  html+='</div>';
  DAYS.forEach((d,i)=>{
    const {list,legs}=legsForDay(i);
    html+=`<div class="tt-col${list.length?"":" off"}" style="height:${H}px">`;
    if(!list.length) html+='<div class="off-label">공강</div>';
    list.forEach(c=>{
      const idx=courses.indexOf(c), k=colorIdx(c.name);
      const top=(toMin(c.start)-START_H*60)*PX, h=(toMin(c.end)-toMin(c.start))*PX;
      html+=`<div class="blk" style="top:${top}px;height:${h}px;background:var(--b${k})">
        <b>${esc(c.name)}</b><div class="meta">${esc(B[c.bld]?.name||c.bld)}</div><div class="meta num">${c.start}–${c.end}</div>
        <button class="x" data-del="${idx}" aria-label="${esc(c.name)} 삭제">×</button></div>`;
    });
    legs.forEach(l=>{
      const mid=((toMin(l.from.end)+toMin(l.to.start))/2-START_H*60)*PX;
      const txt = l.j.lv==="same" ? "같은 건물" : l.j.lv==="free" ? `공강<span class="lg-pre"> · 이동 ${Math.round(l.w.min)}분</span>` :
        `<span class="lg-pre">이동 </span>${Math.round(l.w.min)}분 ${l.j.label}`;
      html+=`<button class="leg lv-${l.j.lv}" style="top:${mid}px" data-day="${i}" title="${esc(l.from.name)} → ${esc(l.to.name)} · 쉬는 시간 ${l.gap}분 · 피로도 ${l.fat}%">${runIcon}${txt}</button>`;
    });
    html+='</div>';
  });
  tt.innerHTML=html;
}

function ttCredits(){
  const seen=new Map(); courses.forEach(c=>{ if(!seen.has(c.name)) seen.set(c.name,+c.cr||0) });
  return [...seen.values()].reduce((a,b)=>a+b,0);
}
function renderStats(){
  let walkSum=0, climb=0, cnt={safe:0,warn:0,danger:0,free:0,same:0}, fats=[];
  DAYS.forEach((_,i)=>legsForDay(i).legs.forEach(l=>{
    if(l.j.lv!=="free"&&l.j.lv!=="same"){walkSum+=l.w.min;fats.push(l.fat)}
    climb+=l.w.climb; cnt[l.j.lv]++;
  }));
  const on=DAYS.filter((_,i)=>courses.some(c=>c.day===i));
  const off=DAYS.filter((_,i)=>!courses.some(c=>c.day===i));
  $("#st-walk").innerHTML=`${Math.round(walkSum)}<small>분</small>`;
  $("#st-risk").innerHTML=`${cnt.danger}<small>구간</small>`;
  $("#st-risk").style.color=cnt.danger?"var(--danger)":"";
  $("#st-risk-s").textContent=`빠듯 ${cnt.warn} · 여유 ${cnt.safe+cnt.same}`;
  $("#st-climb").innerHTML=`${Math.round(climb)}<small>m</small>`;
  const avg=fats.length?fats.reduce((a,b)=>a+b,0)/fats.length:0;
  $("#st-grade").textContent=!fats.length?"피로도 –":cnt.danger?"피로도 C · 개선 필요":avg>=45?"피로도 B · 보통":"피로도 A · 안전";
  // 졸업 연동
  const ev=evaluate(track), tc=ttCredits();
  const done=Math.max(0,ev.need-ev.totalRem), after=Math.max(0,ev.totalRem-tc);
  $("#sm-cr").textContent=tc;
  $("#sm-rem").textContent=after?after+"학점":"충족";
  $("#sm-rem").classList.toggle("ok",!after);
  $("#sm-done").textContent=done; $("#sm-now").textContent=Math.min(tc,ev.totalRem);
  $("#sm-p1").style.width=(done/ev.need*100)+"%";
  $("#sm-p2").style.width=(Math.min(tc,ev.totalRem)/ev.need*100)+"%";
  $("#sm-track").textContent=`${TRACKS[track]} 기준`;
  const chips=[`주 ${on.length}일 등교`];
  off.forEach(d=>chips.push(`${d}공강`));
  if(courses.length&&!courses.some(c=>toMin(c.start)<toMin("10:00"))) chips.push("1교시 없음");
  if(cnt.danger) chips.push(`위험 연강 ${cnt.danger}`);
  $("#chips").innerHTML=chips.map((c,i)=>`<span class="chip${/위험/.test(c)?" danger":""}">${c}</span>`).join("");
}

/* ---------- map ---------- */
let map, routeLayer, outlineLayer, satLayer;
function cssVar(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim()}
function initMap(){
  if(!window.L){ $("#map").innerHTML='<div style="padding:20px" class="muted">지도 라이브러리를 불러오지 못했습니다.</div>'; return; }
  map=L.map("map",{zoomControl:true,scrollWheelZoom:false}).setView([37.4525,127.1310],17);
  /* 지도 모드: 배경 없이 흰 바탕 + 건물 윤곽 / 위성 모드: Esri 위성사진 */
  satLayer=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:19,attribution:"Imagery © Esri"});
  noTiles();
  L.polyline(WALKNET.e.map(([a,b])=>[WALKNET.n[a],WALKNET.n[b]]),{color:cssVar("--line"),weight:2.5,opacity:1,interactive:false}).addTo(map);
  outlineLayer=L.geoJSON(OUTLINES,{
    style:()=>({color:cssVar("--accent"),weight:1.2,fillColor:cssVar("--accent-2"),fillOpacity:.35}),
    onEachFeature:(f,l)=>{const b=B[f.properties.id]; if(b) l.bindTooltip(`${b.name} · 해발 ${b.elev}m`,{sticky:true})}
  }).addTo(map);
  routeLayer=L.layerGroup().addTo(map);
}
function noTiles(){
  if($("#map").classList.contains("no-tiles")) return;
  $("#map").classList.add("no-tiles");
  // 모바일 화면에서는 전체 건물 이름 대신 동선에 포함된 건물 이름만 표시(renderRoute)
  if(!isMobile()) BUILDINGS.forEach(b=>L.tooltip({permanent:true,direction:"right",className:"bl",offset:[6,0]}).setLatLng([b.lat,b.lng]).setContent(b.name).addTo(map));
}
function isMobile(){return window.matchMedia("(max-width:640px)").matches}
const LVCOL={safe:"--safe",warn:"--warn",danger:"--danger",free:"--muted",same:"--safe"};
/* 경사를 쉬운 말로: 평지 / 완만한 오르막 / 오르막 / 가파른 오르막 (내리막도 동일) */
function hill(w){
  // 경로 전체에서 오르막 합과 내리막 합 중 큰 쪽 기준 (중간에 넘는 언덕도 반영)
  const down=Math.max(0,w.climb-w.dh), up=w.climb, d=Math.max(w.dist,1);
  const slope = up>=down ? up/d : -down/d;
  const a=Math.abs(slope)*100, dir=slope>=0?"오르막":"내리막";
  if(a<1.5) return "평지";
  if(a<5) return "완만한 "+dir;
  if(a<10) return dir;
  return "가파른 "+dir;
}

function setBase(b){
  document.querySelectorAll("#base-seg button").forEach(x=>x.setAttribute("aria-pressed",x.dataset.base===b));
  if(!map) return;
  if(b==="sat") satLayer.addTo(map); else map.removeLayer(satLayer);
}
document.addEventListener("click",e=>{const b=e.target.closest("[data-base]");if(b)setBase(b.dataset.base)});
function renderDayTabs(){
  $("#daytabs").innerHTML=DAYS.map((d,i)=>`<button data-mapday="${i}" aria-pressed="${i===mapDay}">${d}</button>`).join("");
}
function renderRoute(){
  const {list,legs}=legsForDay(mapDay);
  $("#map-title").textContent=`${DAYS[mapDay]}요일 이동 동선`;
  const el=$("#route");
  if(!list.length){ el.innerHTML=`<div class="muted" style="padding:20px 0">${DAYS[mapDay]}요일은 공강입니다.</div>`; }
  else{
    let h=""; let total=0;
    list.forEach((c,i)=>{
      h+=`<div class="stop"><div class="n">${i+1}</div><div><div class="t">${esc(c.name)}<small>${c.start}–${c.end}</small></div><div class="muted" style="font-size:12.5px">${esc(B[c.bld]?.name||"")} · 해발 ${B[c.bld]?.elev??"-"}m</div></div></div>`;
      const l=legs[i];
      if(l){
        total+=l.w.min;
        const col=`var(${LVCOL[l.j.lv]})`, soft=l.j.lv==="free"?"var(--sunk)":`var(${LVCOL[l.j.lv]}-soft)`;
        const same=l.from.bld===l.to.bld;
        h+=`<div class="hop"><div class="rail" style="background:${col}"></div><div class="info" style="background:${soft};color:${l.j.lv==="free"?"var(--muted)":col}">
          <div><b>${l.j.label}</b> · 도보 ${Math.round(l.w.min)}분 / 쉬는 시간 ${l.gap}분</div>
          ${same?"":`<div>거리 ${Math.round(l.w.dist/10)*10}m · 언덕경사 ${hill(l.w)}${l.w.steps?" · 계단 있음":""}</div>`}
        </div></div>`;
      }
    });
    h+=`<div class="muted" style="font-size:12px;margin-top:10px">${DAYS[mapDay]}요일 연강 도보 합계 약 ${Math.round(total)}분</div>`;
    el.innerHTML=h;
  }
  if(!map) return;
  routeLayer.clearLayers();
  const used=new Set(list.map(c=>c.bld));
  outlineLayer.setStyle(f=>used.has(f.properties.id)
    ?{color:cssVar("--accent"),weight:2,fillColor:cssVar("--accent"),fillOpacity:.55}
    :{color:cssVar("--accent"),weight:1.2,fillColor:cssVar("--accent-2"),fillOpacity:.3});
  const pts=[];
  if(isMobile()) [...used].forEach(id=>{const b=B[id]; if(b) L.tooltip({permanent:true,direction:"right",className:"bl",offset:[14,0]}).setLatLng([b.lat,b.lng]).setContent(b.name).addTo(routeLayer)});
  const byB=new Map();
  list.forEach((c,i)=>{ if(!B[c.bld]) return; if(!byB.has(c.bld)) byB.set(c.bld,[]); byB.get(c.bld).push([i+1,c]); });
  byB.forEach((arr,id)=>{
    const b=B[id]; pts.push([b.lat,b.lng]);
    const lab=arr.map(a=>a[0]).join("·"), w=Math.max(26,12+lab.length*8);
    L.marker([b.lat,b.lng],{icon:L.divIcon({className:"",html:`<div class="pin" style="width:${w}px;border-radius:13px">${lab}</div>`,iconSize:[w,26],iconAnchor:[w/2,13]}),zIndexOffset:1000})
      .bindTooltip(arr.map(([n,c])=>`${n}. ${esc(c.name)} (${c.start})`).join("<br>")+` · ${b.name}`).addTo(routeLayer);
  });
  legs.forEach(l=>{
    const a=B[l.from.bld], b=B[l.to.bld]; if(a.id===b.id) return;
    const line=l.w.path||[[a.lat,a.lng],[b.lat,b.lng]];
    L.polyline(line,{color:cssVar("--surface"),weight:9,opacity:.9}).addTo(routeLayer);
    L.polyline(line,{color:cssVar(LVCOL[l.j.lv]),weight:5,opacity:.95,dashArray:l.j.lv==="free"?"6 8":null}).addTo(routeLayer);
    line.forEach(p=>pts.push(p));
  });
  if(pts.length>1) map.fitBounds(pts,{padding:[50,50],maxZoom:18});
  else if(pts.length===1) map.setView(pts[0],17);
}

/* ---------- form ---------- */
function initForm(){
  $("#f-day").innerHTML=DAYS.map((d,i)=>`<option value="${i}">${d}요일</option>`).join("");
  $("#f-bld").innerHTML=BUILDINGS.filter(b=>b.type!=="dorm").map(b=>`<option value="${b.id}">${b.name}</option>`).join("");
  $("#f-course").addEventListener("submit",e=>{
    e.preventDefault();
    const c={name:$("#f-name").value.trim(),cr:Math.max(0,+$("#f-cr").value||0),day:+$("#f-day").value,start:$("#f-start").value,end:$("#f-end").value,bld:$("#f-bld").value};
    const err=$("#f-err");
    if(!c.name) return err.textContent="과목명을 입력하세요.";
    if(!c.start||!c.end||toMin(c.end)<=toMin(c.start)) return err.textContent="종료 시간이 시작 시간보다 늦어야 합니다.";
    if(toMin(c.start)<START_H*60||toMin(c.end)>END_H*60) return err.textContent=`${START_H}:00~${END_H}:00 사이로 입력하세요.`;
    const clash=courses.find(o=>o.day===c.day&&toMin(o.start)<toMin(c.end)&&toMin(c.start)<toMin(o.end));
    if(clash) return err.textContent=`‘${clash.name}’(${clash.start}–${clash.end})과 시간이 겹칩니다.`;
    err.textContent=""; courses.push(c); sheet(false); mapDay=c.day; $("#f-name").value="";
    saveAll();
  });
}
function saveAll(){store.set("courses",courses);store.set("mapDay",mapDay);renderTT();renderStats();renderDayTabs();renderRoute()}

document.addEventListener("click",e=>{
  const del=e.target.closest("[data-del]");
  if(del){courses.splice(+del.dataset.del,1);saveAll();return}
  const leg=e.target.closest(".leg");
  if(leg){mapDay=+leg.dataset.day;saveAll();$("#map").scrollIntoView({behavior:"smooth",block:"center"});return}
  const md=e.target.closest("[data-mapday]");
  if(md){mapDay=+md.dataset.mapday;saveAll();return}
});
const sheet=on=>document.body.classList.toggle("sheet-open",on);
$("#btn-open-add").onclick=()=>{sheet(true);setTimeout(()=>$("#f-name").focus(),250)};
$("#btn-close-add").onclick=()=>sheet(false);
$("#backdrop").onclick=()=>sheet(false);
$("#btn-sample").onclick=()=>{courses=JSON.parse(JSON.stringify(SAMPLE_COURSES));saveAll()};
$("#btn-clear").onclick=()=>{courses=[];saveAll()};

/* =====================================================================
   PAGE 2 — 졸업학점 계산기
   ===================================================================== */
const CATS = [
  {k:"core",  label:"기초교양(교필)",   grp:"교양"},
  {k:"bal",   label:"균형·핵심교양",    grp:"교양"},
  {k:"m1req", label:"주전공 전공필수",  grp:"주전공"},
  {k:"m1sel", label:"주전공 전공선택",  grp:"주전공"},
  {k:"m2req", label:"제2전공 전공필수", grp:"복수전공"},
  {k:"m2sel", label:"제2전공 전공선택", grp:"복수전공"},
  {k:"minor", label:"부전공 인정",      grp:"부전공"},
  {k:"free",  label:"일반선택",         grp:"기타"},
];
/* 예시 기준 — 실제 학과 요람으로 교체 필요 */
const DEFAULT_RULES = {
  total:{label:"졸업 총 학점", deep:130, double:130, minor:130},
  core: {label:"기초교양",     deep:17,  double:17,  minor:17},
  bal:  {label:"균형·핵심교양",deep:12,  double:12,  minor:12},
  m1req:{label:"주전공 전필",  deep:21,  double:15,  minor:18},
  m1:   {label:"주전공 합계",  deep:66,  double:39,  minor:48},
  m2req:{label:"제2전공 전필", deep:0,   double:15,  minor:0},
  m2:   {label:"제2전공 합계", deep:0,   double:39,  minor:0},
  mi:   {label:"부전공 합계",  deep:0,   double:0,   minor:21},
};
const TRACKS={deep:"전공심화",double:"복수전공",minor:"부전공"};
const SEM_LOAD=18;
const NONCREDIT=["졸업논문·종합설계","공인어학성적 제출","사회봉사 이수","평점평균 2.0 이상"];

let rules = store.get("rules", JSON.parse(JSON.stringify(DEFAULT_RULES)));
let credits = store.get("credits", {core:17,bal:9,m1req:15,m1sel:27,m2req:0,m2sel:0,minor:6,free:20});
let track = store.get("track","deep");
let checks = store.get("checks",[false,true,false,true]);

/* 트랙에 따라 같은 이수내역을 어떻게 셀지 결정 */
function evaluate(t){
  const r=k=>+rules[k][t]||0, c=credits;
  const sum=Object.values(c).reduce((a,b)=>a+(+b||0),0);
  let items=[
    {k:"total",label:"졸업 총 학점",have:sum,need:r("total")},
    {k:"core", label:"기초교양",have:c.core,need:r("core")},
    {k:"bal",  label:"균형·핵심교양",have:c.bal,need:r("bal")},
    {k:"m1req",label:"주전공 전공필수",have:c.m1req,need:r("m1req")},
    {k:"m1",   label:"주전공 합계(전필+전선)",have:c.m1req+c.m1sel,need:r("m1")},
  ];
  if(t==="double"){
    items.push({k:"m2req",label:"제2전공 전공필수",have:c.m2req,need:r("m2req")});
    items.push({k:"m2",label:"제2전공 합계",have:c.m2req+c.m2sel,need:r("m2")});
  }
  if(t==="minor") items.push({k:"mi",label:"부전공 합계",have:c.minor,need:r("mi")});
  items=items.filter(i=>i.need>0).map(i=>({...i,rem:Math.max(0,i.need-i.have),pct:Math.min(100,i.need?i.have/i.need*100:100)}));
  // 남은 학점 = 총학점 부족분과 영역별 부족분 합 중 큰 값 (영역 부족분은 총학점 안에서 채워야 하므로)
  const areaRem=items.filter(i=>i.k!=="total"&&i.k!=="m1req"&&i.k!=="m2req").reduce((a,i)=>a+i.rem,0)
    + Math.max(0, (items.find(i=>i.k==="m1req")?.rem||0) - (items.find(i=>i.k==="m1")?.rem||0))
    + Math.max(0, (items.find(i=>i.k==="m2req")?.rem||0) - (items.find(i=>i.k==="m2")?.rem||0));
  const totalRem=Math.max(items.find(i=>i.k==="total").rem, areaRem);
  return {items,sum,totalRem,need:r("total")};
}

function renderCreditInputs(){
  let h="", g="";
  CATS.forEach(c=>{
    if(c.grp!==g){g=c.grp;h+=`<div class="grp eyebrow">${g}</div>`}
    h+=`<label for="cr-${c.k}">${c.label}</label><input class="inp" type="number" min="0" max="200" id="cr-${c.k}" data-cr="${c.k}" value="${credits[c.k]||0}">`;
  });
  $("#credit-inputs").innerHTML=h;
}
function ring(pct){
  const R=62,C=2*Math.PI*R, off=C*(1-pct/100);
  return `<svg width="148" height="148" viewBox="0 0 148 148" aria-hidden="true"><circle cx="74" cy="74" r="${R}" fill="none" stroke="var(--sunk)" stroke-width="12"/><circle cx="74" cy="74" r="${R}" fill="none" stroke="${pct>=100?"var(--safe)":"var(--accent)"}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 74 74)"/></svg>`;
}
function renderCredits(){
  document.querySelectorAll("#track-seg button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.track===track));
  const ev=evaluate(track);
  const done=ev.need-ev.totalRem, pct=Math.max(0,Math.min(100,done/ev.need*100));
  $("#ring").innerHTML=ring(pct)+`<div class="c"><b>${Math.round(pct)}%</b><span>졸업 진척도</span></div>`;
  $("#rem-track").textContent=`${TRACKS[track]} 트랙`;
  $("#rem-big").innerHTML= ev.totalRem? `졸업까지 <span class="num">${ev.totalRem}</span>학점 남음` : "학점 요건 모두 충족";
  const sems=Math.ceil(ev.totalRem/SEM_LOAD);
  $("#rem-sub").textContent = `현재 ${ev.sum}학점 이수 / 기준 ${ev.need}학점` + (ev.totalRem?` · 학기당 ${SEM_LOAD}학점이면 약 ${sems}학기`:"");
  $("#reqs").innerHTML=ev.items.map(i=>`<div class="req"><div class="req-top"><b>${i.label}</b><span class="num">${i.have} / ${i.need}${i.rem?` <span class="pill" style="background:var(--danger-soft);color:var(--danger)">−${i.rem}</span>`:` <span class="pill" style="background:var(--safe-soft);color:var(--safe)">충족</span>`}</span></div><div class="bar"><i class="${i.rem?"":"done"}" style="width:${i.pct}%"></i></div></div>`).join("");
  const miss=ev.items.filter(i=>i.rem>0&&i.k!=="total");
  const nc=NONCREDIT.filter((_,i)=>!checks[i]);
  let al=miss.map(i=>`<li>${i.label} ${i.rem}학점 부족</li>`).concat(nc.map(n=>`<li>${n} 미완료</li>`));
  if(track!=="double"&&(credits.m2req+credits.m2sel)>0) al.push(`<li class="ok" style="background:var(--warn-soft);color:var(--warn)">제2전공 ${credits.m2req+credits.m2sel}학점은 이 트랙에서 졸업학점에만 포함됩니다</li>`);
  if(track!=="minor"&&credits.minor>0) al.push(`<li style="background:var(--warn-soft);color:var(--warn)">부전공 ${credits.minor}학점은 이 트랙에서 졸업학점에만 포함됩니다</li>`);
  $("#alerts").innerHTML=al.length?al.join(""):`<li class="ok">모든 졸업 요건을 충족했습니다</li>`;
  // compare
  const keys=["deep","double","minor"];
  const evs=keys.map(evaluate);
  const rowsDef=[["남은 학점",e=>e.totalRem],["예상 잔여 학기",e=>Math.ceil(e.totalRem/SEM_LOAD)],["미충족 요건 수",e=>e.items.filter(i=>i.rem>0&&i.k!=="total").length]];
  $("#cmp").innerHTML=`<thead><tr><th>트랙</th>${rowsDef.map(r=>`<th>${r[0]}</th>`).join("")}</tr></thead><tbody>`+
    keys.map((k,i)=>`<tr class="${k===track?"sel":""}"><td>${TRACKS[k]}</td>${rowsDef.map(r=>`<td class="num">${r[1](evs[i])}</td>`).join("")}</tr>`).join("")+"</tbody>";
  $("#checks").innerHTML=NONCREDIT.map((n,i)=>`<label><input type="checkbox" data-chk="${i}" ${checks[i]?"checked":""}> ${n}</label>`).join("");
}
function renderRules(){
  const keys=Object.keys(rules);
  $("#rules").innerHTML=`<thead><tr><th>항목</th><th>전공심화</th><th>복수전공</th><th>부전공</th></tr></thead><tbody>`+
    keys.map(k=>`<tr><td>${rules[k].label}</td>${["deep","double","minor"].map(t=>`<td><input type="number" min="0" aria-label="${rules[k].label} ${TRACKS[t]}" data-rule="${k}" data-t="${t}" value="${rules[k][t]}"></td>`).join("")}</tr>`).join("")+"</tbody>";
}
function saveCr(){store.set("credits",credits);store.set("track",track);store.set("checks",checks);store.set("rules",rules);renderCredits();renderStats()}

document.addEventListener("input",e=>{
  if(e.target.dataset.cr){credits[e.target.dataset.cr]=Math.max(0,+e.target.value||0);saveCr()}
  if(e.target.dataset.rule){rules[e.target.dataset.rule][e.target.dataset.t]=Math.max(0,+e.target.value||0);saveCr()}
});
document.addEventListener("change",e=>{ if(e.target.dataset.chk){checks[+e.target.dataset.chk]=e.target.checked;saveCr()} });
$("#track-seg").addEventListener("click",e=>{const b=e.target.closest("button");if(b){track=b.dataset.track;saveCr()}});
$("#btn-rules-reset").onclick=()=>{rules=JSON.parse(JSON.stringify(DEFAULT_RULES));renderRules();saveCr()};

/* ---------- 성적표 파싱 ---------- */
function classify(div){
  const s=String(div||"").replace(/\s/g,"");
  if(/복수|복필|복선|제2전공|다전공/.test(s)) return /필/.test(s)?"m2req":"m2sel";
  if(/부전/.test(s)) return "minor";
  if(/전필|전공필수|전공기초/.test(s)) return "m1req";
  if(/전선|전공선택|전공/.test(s)) return "m1sel";
  if(/교필|기초|필수교양|교양필수/.test(s)) return "core";
  if(/교선|균형|핵심|교양/.test(s)) return "bal";
  return "free";
}
function fromRows(rows){
  if(!rows.length) throw new Error("데이터가 없습니다.");
  const hi=rows.findIndex(r=>r.some(c=>/학점/.test(String(c)))&&r.some(c=>/구분/.test(String(c))));
  if(hi<0) throw new Error("‘이수구분’과 ‘학점’ 열을 찾지 못했습니다. 첫 줄에 열 이름이 있는지 확인하세요.");
  const hdr=rows[hi].map(c=>String(c).replace(/\s/g,""));
  const ci=re=>hdr.findIndex(h=>re.test(h));
  const iDiv=ci(/이수구분|구분/), iCr=ci(/^학점$|학점/), iGr=ci(/성적|등급/), iName=ci(/과목명|교과목명|과목/);
  const out={core:0,bal:0,m1req:0,m1sel:0,m2req:0,m2sel:0,minor:0,free:0};
  let n=0, skip=0;
  rows.slice(hi+1).forEach(r=>{
    const cr=parseFloat(r[iCr]); if(!cr) return;
    const g=iGr>=0?String(r[iGr]||"").trim().toUpperCase():"";
    if(/^F$|NP|^FA$|^U$/.test(g)){skip++;return}
    out[classify(r[iDiv])]+=cr; n++;
  });
  if(!n) throw new Error("인식된 과목이 없습니다.");
  return {out,n,skip};
}
function applyParsed(res,src){
  credits=res.out; renderCreditInputs(); saveCr();
  $("#parse-msg").textContent=`${src}: ${res.n}과목 반영${res.skip?`, F/NP ${res.skip}과목 제외`:""}`;
}
function parseText(t){
  const rows=t.trim().split(/\r?\n/).map(l=>l.split(l.includes("\t")?"\t":","));
  return fromRows(rows);
}
$("#btn-parse").onclick=()=>{try{applyParsed(parseText($("#paste").value),"붙여넣기")}catch(e){$("#parse-msg").textContent=e.message}};
const SAMPLE_CSV=`과목명,이수구분,학점,성적
글쓰기와 소통,교필,3,A0
English Communication,교필,3,B+
대학수학,교필,3,A+
컴퓨터프로그래밍,교필,3,A0
가천인성,교필,2,P
진로탐색,교필,3,A0
심리학의 이해,균형교양,3,B+
현대사회와 윤리,균형교양,3,A0
과학기술과 사회,균형교양,3,B0
산업공학개론,전필,3,A+
확률과 통계,전필,3,A0
경영과학1,전필,3,B+
생산관리,전필,3,A0
공학경제,전필,3,B+
인간공학,전선,3,A0
품질경영,전선,3,B+
데이터마이닝,전선,3,A+
시뮬레이션,전선,3,A0
물류관리,전선,3,B0
산업안전공학,전선,3,A0
SCM,전선,3,B+
최적화이론,전선,3,F
경영정보시스템,전선,3,A0
공업수학,전선,3,B0
경영학원론,부전공,3,A0
마케팅원론,부전공,3,B+
테니스,일반선택,2,P
교양중국어,일반선택,3,A0`;
$("#btn-sample-cr").onclick=()=>{$("#paste").value=SAMPLE_CSV;try{applyParsed(parseText(SAMPLE_CSV),"예시 성적표")}catch(e){$("#parse-msg").textContent=e.message}};

function handleFile(f){
  if(!f) return;
  const rd=new FileReader();
  if(/\.csv$/i.test(f.name)){
    rd.onload=()=>{try{applyParsed(parseText(rd.result),f.name)}catch(e){$("#parse-msg").textContent=e.message}};
    rd.readAsText(f,"utf-8");
  } else {
    if(!window.XLSX){
      $("#parse-msg").textContent="엑셀 파일을 읽을 준비를 하는 중…";
      const sc=document.createElement("script");
      sc.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      sc.onload=()=>handleFile(f);
      sc.onerror=()=>{$("#parse-msg").textContent="엑셀 라이브러리를 불러오지 못했습니다. CSV로 저장해 올려주세요."};
      document.head.appendChild(sc); return;
    }
    rd.onload=()=>{try{const wb=XLSX.read(rd.result,{type:"array"});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:""});applyParsed(fromRows(rows),f.name)}catch(e){$("#parse-msg").textContent=e.message}};
    rd.readAsArrayBuffer(f);
  }
}
$("#file").onchange=e=>handleFile(e.target.files[0]);
const drop=$("#drop");
["dragenter","dragover"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add("over")}));
["dragleave","drop"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove("over")}));
drop.addEventListener("drop",e=>handleFile(e.dataTransfer.files[0]));

/* ---------- routing ---------- */
function route(){
  const r=location.hash==="#credits"?"credits":"timetable";
  $("#page-timetable").hidden=r!=="timetable";
  $("#page-credits").hidden=r!=="credits";
  document.querySelectorAll("[data-route]").forEach(a=>a.setAttribute("aria-current",a.dataset.route===r?"page":"false"));
  if(r==="timetable"&&map) setTimeout(()=>{map.invalidateSize();renderRoute()},0);
}
window.addEventListener("hashchange",route);

/* ---------- boot ---------- */
initForm(); renderTT(); renderStats(); renderDayTabs(); initMap(); renderRoute();
renderCreditInputs(); renderRules(); renderCredits(); route();
