import {showGuests} from './guests.v0.8.js';
import {normalizeCategory,categoryOf,categoryIcon,ratingTone,CATEGORIES} from './place-style.v0.8.js?v=0.9.2';
import {OVERVIEW_MAX_ZOOM,clusterBounds,coincident} from './cluster-view.v0.6.js';
import {StreetMap, GeoBounds, readStreetConfig} from './streets.v0.4.js';
import {MAP_BOUNDS,REGIONS,project,unproject,validateMemories,filterMemories,clusterPoints,featurePath,validRating,starFills,photosOf,mergeMemories,publishableMemories} from './geo.v0.5.js';
import {sortMemories} from './collection.v0.5.js';
import {breedIcon} from './cat-breeds.v0.1.js';

const $=id=>document.getElementById(id);
const svgNS='http://www.w3.org/2000/svg';
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const small=()=>matchMedia('(max-width: 760px)').matches;
// A slightly tighter opening composition keeps Chongqing and the cat clusters
// visually present without losing the atlas-style breathing room.
const DEFAULT_OVERVIEW_ZOOM=1.15;
const state={real:[],demos:[],items:[],filtered:[],region:'all',query:'',selected:null,online:false,loadingStreet:false};
const icon=name=>{const s=document.createElementNS(svgNS,'svg');s.setAttribute('class','icon');s.setAttribute('aria-hidden','true');const u=document.createElementNS(svgNS,'use');u.setAttribute('href',`#i-${name}`);s.append(u);return s;};
const text=(tag,className,value)=>{const el=document.createElement(tag);if(className)el.className=className;if(value!=null)el.textContent=value;return el;};
let toastTimer;
function notify(message,ms=4300){clearTimeout(toastTimer);$('map-status').textContent=message;if(ms)toastTimer=setTimeout(()=>$('map-status').textContent='',ms);}
async function readJson(path,key){
  const embedded=embeddedPayload();if(embedded)return embedded[key];
  const r=await fetch(path,{cache:'no-cache',signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error(`未能读取 ${path}（${r.status}）`);return r.json();
}

class OverviewMap{
  constructor(){
    this.surface=$('map-surface');this.svg=$('atlas-svg');this.group=$('geographic-layer');this.clip=$('chongqing-art-clip');this.camera={s:1,x:0,y:0};this.base=1;this.width=0;this.height=0;this.points=new Map();this.animation=0;
    this.surface.tabIndex=0;this.surface.setAttribute('role','region');this.surface.setAttribute('aria-label','互动地图。方向键移动，加减号缩放，Home 回到全览。');
    new ResizeObserver(()=>this.resize()).observe(this.surface);
    this.bind();
  }
  setGeography(data){
    if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))throw new Error('总览地理数据格式不正确。');
    const land=data.features.filter(f=>f.properties?.kind==='land');
    const clipFrag=document.createDocumentFragment();
    for(const f of land){const p=document.createElementNS(svgNS,'path');p.setAttribute('d',featurePath(f));clipFrag.append(p);}
    this.clip.replaceChildren(clipFrag);
    const [west,south,east,north]=MAP_BOUNDS;
    const top=project([west,north])[1],bottom=project([west,south])[1];
    const art=document.createElementNS(svgNS,'image');art.classList.add('map-art');art.setAttribute('href','./assets/maps/chongqing-handdrawn-map-v2.webp');art.setAttribute('x',String(west));art.setAttribute('y',String(top));art.setAttribute('width',String(east-west));art.setAttribute('height',String(bottom-top));art.setAttribute('preserveAspectRatio','none');art.setAttribute('clip-path','url(#chongqing-art-clip)');
    const frag=document.createDocumentFragment();
    frag.append(art);
    for(const f of data.features){const p=document.createElementNS(svgNS,'path');p.setAttribute('d',featurePath(f));p.setAttribute('class',`coast-${f.properties.kind}`);frag.append(p);}
    this.group.replaceChildren(frag);this.reset(false);
  }
  resize(){
    const w=this.surface.clientWidth,h=this.surface.clientHeight;if(!w||!h||w===this.width&&h===this.height)return;
    const previous=this.width?this.toGeo([this.width/2,this.height/2]):null;
    const relative=this.camera.s/this.base;this.width=w;this.height=h;
    const full=this.defaultCamera();this.base=full.s/DEFAULT_OVERVIEW_ZOOM;
    if(previous&&relative>1.12){const p=project(previous);this.camera={s:full.s*relative,x:w/2-p[0]*full.s*relative,y:h/2-p[1]*full.s*relative};}
    else this.camera=full;
    this.render();if(streetMap)streetMap.resize();
  }
  cameraFor(bounds,panel=false){
    const [west,south,east,north]=bounds;const a=project([west,north]),b=project([east,south]);
    const left=small()?29:68,right=panel&&!small()?365:(small()?29:78),top=small()?90:88,bottom=small()?62:67;
    const s=Math.min((this.width-left-right)/Math.max(.0001,b[0]-a[0]),(this.height-top-bottom)/Math.max(.0001,b[1]-a[1]));
    return {s,x:left+(this.width-left-right)/2-(a[0]+b[0])*s/2,y:top+(this.height-top-bottom)/2-(a[1]+b[1])*s/2};
  }
  defaultCamera(){
    const full=this.cameraFor(MAP_BOUNDS,false),zoom=DEFAULT_OVERVIEW_ZOOM;
    const left=small()?29:68,right=small()?29:78,top=small()?90:88,bottom=small()?62:67;
    const cx=left+(this.width-left-right)/2,cy=top+(this.height-top-bottom)/2;
    return {s:full.s*zoom,x:cx-(cx-full.x)*zoom,y:cy-(cy-full.y)*zoom};
  }
  screen(coords){const p=project(coords),c=this.camera;return [p[0]*c.s+c.x,p[1]*c.s+c.y];}
  toGeo([x,y]){const c=this.camera;return unproject([(x-c.x)/c.s,(y-c.y)/c.s]);}
  render(){const c=this.camera;this.group.setAttribute('transform',`translate(${c.x},${c.y}) scale(${c.s})`);if(!state.online)renderOverlays();}
  animate(target,animated=true){
    cancelAnimationFrame(this.animation);const from={...this.camera};
    if(!animated||reduced){this.camera=target;this.render();return;}
    const started=performance.now();
    const step=now=>{const t=Math.min(1,(now-started)/650),k=1-(1-t)**3;this.camera={s:from.s+(target.s-from.s)*k,x:from.x+(target.x-from.x)*k,y:from.y+(target.y-from.y)*k};this.render();if(t<1)this.animation=requestAnimationFrame(step);};
    this.animation=requestAnimationFrame(step);
  }
  reset(animated=true){const c=this.defaultCamera();this.base=c.s/DEFAULT_OVERVIEW_ZOOM;this.animate(c,animated);}
  focus(coords,multiplier=2.5){
    const p=project(coords);const s=Math.max(this.base,Math.min(this.base*18,this.base*multiplier));
    const reserve=0;
    this.animate({s,x:(this.width-reserve)/2-p[0]*s,y:this.height*.48-p[1]*s});
  }
  fit(items){
    const coords=items.filter(m=>m.coordinates).map(m=>m.coordinates);if(!coords.length)return;
    if(coords.length===1){this.focus(coords[0],3);return;}
    const bounds=clusterBounds(items);
    const c=this.cameraFor(bounds);const s=Math.max(this.base,Math.min(c.s,this.base*OVERVIEW_MAX_ZOOM));const a=project([bounds[0],bounds[3]]),b=project([bounds[2],bounds[1]]);c.x+=(a[0]+b[0])/2*(c.s-s);c.y+=(a[1]+b[1])/2*(c.s-s);c.s=s;
    this.animate(c);
  }
  zoom(factor,point=[this.width/2,this.height/2]){
    cancelAnimationFrame(this.animation);const c=this.camera;
    const s=Math.max(this.base*.82,Math.min(this.base*OVERVIEW_MAX_ZOOM,c.s*factor));
    if(s===c.s&&factor>1)notify('总览已经放大到上限。具体道路请切换「街道底图」。');
    const r=s/c.s;this.camera={s,x:point[0]-(point[0]-c.x)*r,y:point[1]-(point[1]-c.y)*r};this.render();
  }
  pan(dx,dy){cancelAnimationFrame(this.animation);this.camera.x+=dx;this.camera.y+=dy;this.constrain();this.render();}
  constrain(){
    // Keep the viewport anchored to Chongqing. The old implementation still
    // clamped the camera to the former UK extent, so a small drag on mobile
    // sent the Chongqing map to a blank area around Europe.
    const c=this.camera,p=this.toGeo([this.width/2,this.height/2]);
    const q=project([
      Math.max(MAP_BOUNDS[0],Math.min(MAP_BOUNDS[2],p[0])),
      Math.max(MAP_BOUNDS[1],Math.min(MAP_BOUNDS[3],p[1]))
    ]);
    c.x=this.width/2-q[0]*c.s;
    c.y=this.height/2-q[1]*c.s;
  }
  bind(){
    const pos=e=>{const r=this.surface.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];};
    this.surface.addEventListener('pointerdown',e=>{
      if(state.online||e.target.closest('button')||e.button!==0)return;
      cancelAnimationFrame(this.animation);this.points.set(e.pointerId,pos(e));this.surface.setPointerCapture(e.pointerId);this.surface.classList.add('is-dragging');
    });
    this.surface.addEventListener('pointermove',e=>{
      if(state.online||!this.points.has(e.pointerId))return;
      const before=[...this.points.values()],old=this.points.get(e.pointerId),now=pos(e);this.points.set(e.pointerId,now);
      if(this.points.size===2){const after=[...this.points.values()];const d0=Math.hypot(before[0][0]-before[1][0],before[0][1]-before[1][1]);const d1=Math.hypot(after[0][0]-after[1][0],after[0][1]-after[1][1]);if(d0>0)this.zoom(d1/d0,[(before[0][0]+before[1][0])/2,(before[0][1]+before[1][1])/2]);this.pan((now[0]-old[0])/2,(now[1]-old[1])/2);}
      else if(this.points.size===1)this.pan(now[0]-old[0],now[1]-old[1]);
    });
    const end=e=>{this.points.delete(e.pointerId);if(!this.points.size)this.surface.classList.remove('is-dragging');};
    this.surface.addEventListener('pointerup',end);this.surface.addEventListener('pointercancel',end);this.surface.addEventListener('lostpointercapture',end);
    this.surface.addEventListener('wheel',e=>{if(state.online)return;e.preventDefault();this.zoom(Math.exp(-Math.max(-150,Math.min(150,e.deltaY))*.002),pos(e));},{passive:false});
    this.surface.addEventListener('dblclick',e=>{if(state.online||e.target.closest('button'))return;this.zoom(1.7,pos(e));});
    this.surface.addEventListener('keydown',e=>{
      if(e.target.closest('button')||state.online)return;const moves={ArrowLeft:[60,0],ArrowRight:[-60,0],ArrowUp:[0,60],ArrowDown:[0,-60]};
      if(moves[e.key]){e.preventDefault();this.pan(...moves[e.key]);}
      if(e.key==='+'||e.key==='='){e.preventDefault();this.zoom(1.3);}
      if(e.key==='-'){e.preventDefault();this.zoom(1/1.3);}
      if(e.key==='Home'){e.preventDefault();resetView();}
    });
  }
}

const labelData=[{"point": [108.402235, 30.706367], "zh": "万州区", "en": "", "kind": "region"}, {"point": [107.329521, 29.661157], "zh": "涪陵区", "en": "", "kind": "region"}, {"point": [106.536639, 29.552124], "zh": "渝中区", "en": "", "kind": "region"}, {"point": [106.454674, 29.420225], "zh": "大渡口区", "en": "", "kind": "region"}, {"point": [106.703119, 29.616013], "zh": "江北区", "en": "", "kind": "region"}, {"point": [106.36427, 29.626999], "zh": "沙坪坝区", "en": "", "kind": "region"}, {"point": [106.360442, 29.43112], "zh": "九龙坡区", "en": "", "kind": "region"}, {"point": [106.65682, 29.538362], "zh": "南岸区", "en": "", "kind": "region"}, {"point": [106.510159, 29.863692], "zh": "北碚区", "en": "", "kind": "region"}, {"point": [106.718792, 28.88182], "zh": "綦江区", "en": "", "kind": "region"}, {"point": [105.739079, 29.652698], "zh": "大足区", "en": "", "kind": "region"}, {"point": [106.742921, 29.812866], "zh": "渝北区", "en": "", "kind": "region"}, {"point": [106.747747, 29.374647], "zh": "巴南区", "en": "", "kind": "region"}, {"point": [108.704294, 29.438304], "zh": "黔江区", "en": "", "kind": "region"}, {"point": [107.135534, 29.957136], "zh": "长寿区", "en": "", "kind": "region"}, {"point": [106.259476, 29.032656], "zh": "江津区", "en": "", "kind": "region"}, {"point": [106.307663, 30.115074], "zh": "合川区", "en": "", "kind": "region"}, {"point": [105.869379, 29.293206], "zh": "永川区", "en": "", "kind": "region"}, {"point": [107.167047, 29.13832], "zh": "南川区", "en": "", "kind": "region"}, {"point": [106.188127, 29.564023], "zh": "璧山区", "en": "", "kind": "region"}, {"point": [106.02937, 29.813671], "zh": "铜梁区", "en": "", "kind": "region"}, {"point": [105.811005, 30.146076], "zh": "潼南区", "en": "", "kind": "region"}, {"point": [105.503236, 29.467592], "zh": "荣昌区", "en": "", "kind": "region"}, {"point": [108.378047, 31.273036], "zh": "开州区", "en": "", "kind": "region"}, {"point": [107.714739, 30.660896], "zh": "梁平区", "en": "", "kind": "region"}, {"point": [107.705234, 29.375976], "zh": "武隆区", "en": "", "kind": "region"}, {"point": [108.730584, 31.884007], "zh": "城口县", "en": "", "kind": "region"}, {"point": [107.826542, 29.88748], "zh": "丰都县", "en": "", "kind": "region"}, {"point": [107.433154, 30.25578], "zh": "垫江县", "en": "", "kind": "region"}, {"point": [107.910542, 30.338525], "zh": "忠县", "en": "", "kind": "region"}, {"point": [108.852543, 31.038795], "zh": "云阳县", "en": "", "kind": "region"}, {"point": [109.344665, 30.954517], "zh": "奉节县", "en": "", "kind": "region"}, {"point": [109.896516, 31.117622], "zh": "巫山县", "en": "", "kind": "region"}, {"point": [109.348351, 31.505093], "zh": "巫溪县", "en": "", "kind": "region"}, {"point": [108.294118, 30.096269], "zh": "石柱土家族自治县", "en": "", "kind": "region"}, {"point": [109.013623, 28.495039], "zh": "秀山土家族苗族自治县", "en": "", "kind": "region"}, {"point": [108.796012, 28.903026], "zh": "酉阳土家族苗族自治县", "en": "", "kind": "region"}, {"point": [108.262014, 29.35674], "zh": "彭水苗族土家族自治县", "en": "", "kind": "region"}];
const labelEls=labelData.map(d=>{const el=text('div',`geo-label ${d.kind}`);el.append(text(d.kind==='region'?'strong':'span','',d.zh));if(d.en){if(d.kind!=='region')el.append(document.createElement('br'));el.append(text('small','',d.en));}$('labels-layer').append(el);return el;});
const markerEls=new Map();
let atlas;
function screenPoint(coords){if(state.online&&streetMap){const p=streetMap.project(coords);return [p.x,p.y];}return atlas.screen(coords);}
function renderOverlays(){
  if(!atlas?.width)return;
  const w=atlas.width,h=atlas.height,zoomRatio=atlas.camera.s/atlas.base;
  // Breed stickers stay visible on the Chongqing overview too, so a location
  // is recognisable as a cat at the first map level. Clusters still use their
  // count badge when several cats share the same nearby area.
  const breedZoom=true;
  const labelBoxes=[];labelData.forEach((d,i)=>{const el=labelEls[i],p=atlas.screen(d.point);const width=Math.min(120,d.zh.length*12),box={x:p[0]-width/2,y:p[1]-9,w:width,h:18};const overlap=labelBoxes.some(b=>box.x<b.x+b.w+6&&box.x+box.w+6>b.x&&box.y<b.y+b.h+4&&box.y+box.h+4>b.y);el.style.left=`${p[0]}px`;el.style.top=`${p[1]}px`;el.hidden=state.online||p[0]<0||p[0]>w||p[1]<10||p[1]>h-25||zoomRatio>10||overlap;if(!el.hidden)labelBoxes.push(box);el.style.opacity='1';});
  const groups=clusterPoints(state.filtered,screenPoint,small()?29:31);
  const allPins=groups.map(g=>({x:g.x-14,y:g.y-14,w:28,h:28}));
  const placed=[];const keep=new Set();
  const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
  for(const g of groups){
    if(g.x<-60||g.x>w+60||g.y<-60||g.y>h+60)continue;
    const ids=g.items.map(m=>m.id);const key=ids.join('|');keep.add(key);
    let el=markerEls.get(key);
    if(!el){
      el=text('button','map-marker');el.type='button';el.dataset.markerId=key;
      const hit=text('span','pin-hit');hit.append(text('span','pin-dot'));el.append(hit,text('span','pin-label'));
      el.addEventListener('click',()=>{const items=el._items;if(items.length===1)openStory(items[0],el);else expandCluster(items);});
      $('marker-layer').append(el);markerEls.set(key,el);
    }
    el._items=g.items;el.style.left=`${g.x}px`;el.style.top=`${g.y}px`;el.classList.toggle('cluster',ids.length>1);el.classList.toggle('is-selected',ids.includes(state.selected?.id));
    el.setAttribute('aria-label',ids.length>1?`展开 ${ids.length} 只猫咪：${g.items.map(m=>m.place).join('、')}`:`${g.items[0].place||g.items[0].title}，${g.items[0].demo?'演示猫咪':'查看猫咪记录'}`);
    const dot=el.querySelector('.pin-dot');dot.replaceChildren();dot.classList.remove('breed-pin');el.dataset.ratingTone=ids.length===1?ratingTone(g.items[0].review?.rating):'unrated';if(ids.length>1)dot.textContent=String(ids.length);else{const breed=breedZoom&&breedIcon(g.items[0].breed);if(breed){dot.classList.add('breed-pin');dot.append(breed);}else dot.append(categoryIcon(g.items[0].category));el.setAttribute('aria-label',`${g.items[0].place}，${g.items[0].breed||'品种未知'}，${categoryOf(g.items[0].category)}，${g.items[0].review?.rating==null?'尚未评分':g.items[0].review.rating+' 星'}，查看猫咪记录`);}
    const label=el.querySelector('.pin-label');label.replaceChildren(text('span','',ids.length>1?`${ids.length} 只猫咪`:(g.items[0].place||g.items[0].title)));
    if(ids.length===1&&g.items[0].placeEn)label.append(text('small','',g.items[0].placeEn));
    const labelW=label.offsetWidth||100,labelH=label.offsetHeight||28;
    let candidates=[[21,-labelH/2],[-labelW-21,-labelH/2],[-labelW/2,-labelH-22],[-labelW/2,23]];
    if(ids.includes('demo-oxford'))candidates=[candidates[2],...candidates];
    if(ids.includes('demo-cardiff'))candidates=[candidates[1],...candidates];
    let offset=null;
    for(const [x,y] of candidates){const box={x:g.x+x-3,y:g.y+y-3,w:labelW+6,h:labelH+6};if(box.x<8||box.x+box.w>w-8||box.y<83||box.y+box.h>h-35)continue;if(placed.some(b=>overlap(box,b))||allPins.some(b=>overlap(box,b)))continue;offset=[x,y];placed.push(box);break;}
    label.style.visibility=offset?'visible':'hidden';if(offset){label.style.left=`${offset[0]}px`;label.style.top=`${offset[1]}px`;}
  }
  for(const [key,el] of markerEls)if(!keep.has(key)){el.remove();markerEls.delete(key);}
  $('map-dedication').style.opacity=state.online||zoomRatio>1.5||$('story-panel').open?'0':'1';
  {
    const lat=state.online?streetMap.getCenter().lat:atlas.toGeo([w/2,h/2])[1];const kmPerPx=state.online?40075.016686*Math.cos(lat*Math.PI/180)/(256*2**streetMap.getZoom()):111.32*Math.cos(lat*Math.PI/180)/atlas.camera.s;
    const km=[.01,.02,.05,.1,.2,.5,1,2,5,10,20,50,100,200,500,1000].filter(k=>k/kmPerPx<=85).at(-1)||1;
    $('scale-text').textContent=km<1?`${Math.round(km*1000)} m`:`${km} km`;$('scale-line').style.width=`${km/kmPerPx}px`;
  }
}
function expandCluster(items){
  if(coincident(items)||(!state.online&&atlas.camera.s/atlas.base>=OVERVIEW_MAX_ZOOM*.99)||(state.online&&streetMap.getZoom()>=18)){showCluster(items);return;}
  if(state.online){const b=new GeoBounds();items.forEach(m=>b.extend(m.coordinates));streetMap.fitBounds(b,{padding:95,maxZoom:19,duration:reduced?0:650});}
  else atlas.fit(items);
}
const clusterDialog=document.createElement('dialog');clusterDialog.className='cluster-dialog';clusterDialog.setAttribute('aria-label','选择聚合猫咪');document.body.append(clusterDialog);
function showCluster(items){clusterDialog.replaceChildren();const heading=text('h2','',`${items.length} 只相邻或同址猫咪`),note=text('p','','这些猫咪保留各自的遇见位置。请选择要查看的记录。'),close=text('button','cluster-close','关闭');close.type='button';close.onclick=()=>clusterDialog.close();clusterDialog.append(heading,note,close);for(const m of items){const button=text('button','cluster-choice');button.type='button';button.append(categoryIcon(m.category),text('span','',m.place),text('small','',m.placeEn||''));button.onclick=()=>{clusterDialog.close();openStory(m);};clusterDialog.append(button);}clusterDialog.showModal();}
function resetView(){closeStory(false);$('map-context').replaceChildren(document.createTextNode('重庆全览 ／ 猫咪分布'));if(state.online)streetMap.fitBounds([[MAP_BOUNDS[0],MAP_BOUNDS[1]],[MAP_BOUNDS[2],MAP_BOUNDS[3]]],{padding:{top:90,bottom:65,left:40,right:50},duration:reduced?0:700});else atlas.reset();}
function refreshCollection(){
  state.items=[...state.real];
  const citySelection=$('city-filter').value;const cities=[...new Set(state.items.map(m=>m.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));$('city-filter').replaceChildren(new Option('全部城市','all'),...cities.map(c=>new Option(c,c)),new Option('城市待确认','pending'));$('city-filter').value=cities.includes(citySelection)||citySelection==='pending'?citySelection:'all';
  state.filtered=sortMemories(filterMemories(state.items,state.region,state.query).filter(m=>$('city-filter').value==='all'||($('city-filter').value==='pending'?!m.city:m.city===$('city-filter').value)).filter(m=>$('category-filter').value==='all'||categoryOf(m.category)===$('category-filter').value),$('rating-sort').value);
  const demoOnly=state.items.length>0&&state.items.every(m=>m.demo);
  const count=new Set(state.items.map(m=>m.place?.trim()).filter(Boolean)).size;
  $('place-count').textContent=String(count).padStart(2,'0');$('place-count').nextElementSibling.textContent=demoOnly?'演示猫咪':'收录猫咪';$('memory-count').textContent=String(state.real.length).padStart(2,'0');
  $('map-key-label').textContent=demoOnly?'演示猫咪':state.items.some(m=>m.demo)?'真实与演示猫咪':'猫咪分布';
  $('result-count').textContent=`${String(state.filtered.length).padStart(2,'0')} 个条目`;
  const f=document.createDocumentFragment();
  state.filtered.forEach((m,i)=>{
    const row=text('button','memory-row');row.type='button';row.dataset.id=m.id;row.dataset.category=categoryOf(m.category);row.dataset.ratingTone=ratingTone(m.review?.rating);row.setAttribute('aria-pressed',String(state.selected?.id===m.id));
    const photos=photosOf(m);
    if(photos.length){const thumb=document.createElement('img');thumb.className='row-photo';thumb.src=photoSrc(photos[0].thumbnail||photos[0].src);thumb.alt='';thumb.loading='lazy';row.append(thumb);}else {const mark=text('span','row-category-mark');mark.append(categoryIcon(m.category));row.append(mark);}
    const body=text('span','row-body');const title=text('span','row-title');title.append(text('strong','',m.place||'猫咪名字待补'));if(m.placeEn)title.append(text('small','',m.placeEn));body.append(title,text('span','row-sub',[m.breed||'品种未知',m.city||'',m.category,m.lifeStatus&&m.lifeStatus!=='在世'?m.lifeStatus:'',m.demo?'演示':m.date,!m.coordinates?'定位待补':''].filter(Boolean).join(' · ')));
    body.querySelector('.row-sub').prepend(categoryIcon(m.category));
    if(m.review||photos.length){const meta=text('span','row-review');if(m.review){const rating=text('span','rating-display');renderRating(rating,m.review.rating,{compact:true});meta.append(rating);}if(photos.length)meta.append(text('span','row-photo-count',`${photos.length} 张照片`));body.append(meta);}row.append(body);const arrow=icon('arrow');arrow.classList.add('row-arrow');row.append(arrow);row.addEventListener('click',()=>openStory(m,row));f.append(row);
  });
  if(!state.filtered.length){const e=text('div','empty-state');e.append(text('strong','',state.query?'还没找到这只猫。':'暂无猫咪'),document.createTextNode(state.query?'试试别的名字。这里只搜索已经收录的猫咪。':state.items.length?'这个地区暂时没有猫咪记录。':'作者登录后可添加猫咪记录。'));f.append(e);}
  document.querySelectorAll('#category-filters [data-category]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.category===($('category-filter').value||'all'))));
  document.querySelectorAll('#sort-buttons [data-sort]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.sort===$('rating-sort').value)));
  $('memory-list').replaceChildren(f);
  if(state.selected&&!state.filtered.some(m=>m.id===state.selected.id))closeStory(false);
  renderOverlays();
}
let lastFocus=null;
function openStory(m,trigger=null){
  state.selected=m;
  $('story-city').textContent=m.city||'所属城市待确认';
  const officialText=String(m.officialIntroduction||'').trim();
  const officialSection=$('official-section');
  const officialJump=$('read-official');
  const hasOfficial=Boolean(officialText);
  officialSection.hidden=!hasOfficial;
  officialJump.hidden=!hasOfficial;
  $('official-text').textContent=officialText;
  const source=$('official-link');source.hidden=true;try{const url=new URL(m.officialSource);if(hasOfficial&&url.protocol==='https:'){source.href=url.href;source.hidden=false;}}catch{}
  showGuests(m.id);
  const panel=$('story-panel');
  if(trigger)lastFocus=trigger;else if(!panel.open)lastFocus=document.activeElement;
  $('story-kind').textContent=m.demo?'DEMO POSTCARD / 演示卡片':'猫咪相册';
  $('story-category').replaceChildren(categoryIcon(m.category),document.createTextNode(categoryOf(m.category)));
  $('story-region').textContent=[m.breed||'品种未知',m.locationLabel||'遇见位置待补',m.category,m.lifeStatus&&m.lifeStatus!=='在世'?m.lifeStatus:'',(m.visitDates?.length?m.visitDates.join(' · '):m.date)].filter(Boolean).join(' · ');
  $('story-place').replaceChildren(document.createTextNode(m.place||'猫咪名字待补'));if(m.placeEn)$('story-place').append(text('small','',m.placeEn));
  $('story-writing').hidden=!m.description;$('read-long-review').hidden=!m.description;$('story-scroll').scrollTop=0;$('story-title').hidden=!m.title||m.title===m.place;
  $('story-title').textContent=m.title;$('story-description').textContent=m.description||'';
  $('review-author').textContent=m.review?.author||'';renderRating($('story-rating'),m.review?.rating);
  $('review-comment').textContent=m.review?.comment||'';$('review-comment').hidden=!m.review?.comment;$('review-empty').hidden=!!m.review?.comment;
  $('story-location').textContent=[m.locationLabel||m.address,m.coordinates?`${m.locationPrecision||'记录坐标'}\n${Math.abs(m.coordinates[1]).toFixed(4)}° ${m.coordinates[1]>=0?'N':'S'} · ${Math.abs(m.coordinates[0]).toFixed(4)}° ${m.coordinates[0]>=0?'E':'W'}`:'遇见位置待补充'].filter(Boolean).join('\n');
  $('story-location').style.whiteSpace='pre-line';$('story-disclaimer').hidden=!m.demo;$('story-street').hidden=!m.coordinates;$('story-author').hidden=!!m.demo;
  renderAlbum();
  const i=state.filtered.findIndex(x=>x.id===m.id);$('story-index').textContent=`${String(i+1).padStart(2,'0')} / ${String(state.filtered.length).padStart(2,'0')}`;$('previous-story').disabled=i<=0;$('next-story').disabled=i>=state.filtered.length-1;
  if(!panel.open)panel.showModal();panel.scrollTop=0;document.documentElement.classList.add('has-story');
  document.querySelectorAll('.memory-row').forEach(row=>row.setAttribute('aria-pressed',String(row.dataset.id===m.id)));
  $('map-context').textContent=[m.place,m.placeEn,m.demo?'演示猫咪':'猫咪记录'].filter(Boolean).join(' ／ ');
  try{history.replaceState(null,'',`#place=${encodeURIComponent(m.id)}`);}catch{/* sandboxed/file previews may restrict history */}
  if(m.coordinates){if(state.online)streetMap.flyTo({center:m.coordinates,zoom:11,padding:{top:30,bottom:20,left:0,right:0},duration:reduced?0:850});else atlas.focus(m.coordinates,2.8);}
  $('story-place').focus({preventScroll:true});renderOverlays();
}
function closeStory(restore=true){
  if(!$('story-panel').open)return;closeViewer();$('story-panel').close();document.documentElement.classList.remove('has-story');state.selected=null;
  try{history.replaceState(null,'',location.pathname+location.search);}catch{}
  document.querySelectorAll('.memory-row').forEach(row=>row.setAttribute('aria-pressed','false'));
  if(restore&&lastFocus?.isConnected)lastFocus.focus({preventScroll:true});
  if(state.online&&streetMap)streetMap.setPadding({top:0,bottom:0,left:0,right:0});renderOverlays();
}

/* Street tiles use a same-origin gateway, independent of the author database. */
let streetMap=null,streetToken=0;
async function enterStreet(focus=null){
  if(state.loadingStreet)return;
  if(state.online){if(focus)streetMap.flyTo({center:focus,zoom:16});return;}
  const token=++streetToken;state.loadingStreet=true;
  $('street-button').dataset.loading='true';$('street-button').setAttribute('aria-busy','true');
  $('street-retry').hidden=true;notify('正在读取本站街道接口…',0);
  try{
    const config=await readStreetConfig();if(token!==streetToken)return;
    const holder=$('online-map');holder.hidden=false;holder.style.opacity='0';holder.style.pointerEvents='none';
    const center=focus||atlas.toGeo([atlas.width/2,atlas.height/2]);
    const zoom=focus?16:Math.max(4,Math.log2(atlas.camera.s*360/256));
    const thisMap=streetMap=new StreetMap({container:holder,center,zoom,config,onStatus:d=>{
      if(token!==streetToken)return;
      if(state.loadingStreet)notify(`正在读取街道图片 ${d.loaded}/${d.total}…${d.failed?' 部分图片暂不可用。':''}`,0);
      if(state.online&&d.failed){$('street-retry').hidden=false;notify(`部分街道图片未加载（${d.failed} 张）。${d.error||''}`,0);}
      else if(state.online&&!d.pending){$('street-retry').hidden=true;if(d.loaded)notify('街道地图 · 拖动探索，放大可看道路与建筑。',2500);}
    }});
    await thisMap.waitForReady();if(token!==streetToken)return;
    state.online=true;$('atlas-svg').hidden=true;$('map-frame').classList.add('is-online');holder.style.opacity='1';holder.style.pointerEvents='auto';
    $('street-attribution').hidden=false;$('street-button').setAttribute('aria-pressed','true');$('overview-button').setAttribute('aria-pressed','false');
    thisMap.on('move',renderOverlays);thisMap.on('resize',renderOverlays);renderOverlays();
    notify('街道地图已显示。照片和故事标记保持原来的地理坐标。',3500);
  }catch(error){
    if(token!==streetToken)return;
    if(streetMap){streetMap.remove();streetMap=null;}
    $('online-map').hidden=true;state.online=false;$('street-retry').hidden=false;
    $('street-retry').dataset.focus=focus?JSON.stringify(focus):'';
    notify(`${error.message} 已保留区县总览。`,0);console.warn('[street]',error.message);
  }finally{if(token===streetToken){state.loadingStreet=false;delete $('street-button').dataset.loading;$('street-button').removeAttribute('aria-busy');}}
}
function enterOverview(){
  ++streetToken;state.loadingStreet=false;delete $('street-button').dataset.loading;$('street-button').removeAttribute('aria-busy');
  if(streetMap){
    if(state.online){const c=streetMap.getCenter(),s=Math.max(atlas.base,Math.min(atlas.base*18,256*2**streetMap.getZoom()/360)),p=project([c.lng,c.lat]);atlas.camera={s,x:atlas.width/2-p[0]*s,y:atlas.height/2-p[1]*s};}
    streetMap.remove();streetMap=null;
  }
  state.online=false;$('online-map').hidden=true;$('atlas-svg').hidden=false;$('map-frame').classList.remove('is-online');
  $('street-attribution').hidden=true;$('street-retry').hidden=true;$('overview-button').setAttribute('aria-pressed','true');$('street-button').setAttribute('aria-pressed','false');
  atlas.render();notify('重庆总览 · 区县边界，不包含街道细节。');
}
$('street-retry').addEventListener('click',()=>{if(state.online){streetMap.retry();return;}let focus=null;try{focus=JSON.parse($('street-retry').dataset.focus||'null');}catch{}enterStreet(focus);});

async function loadStories(first=false){
  $('data-error').hidden=true;$('retry-data').hidden=true;
  const failures=[];
  for(const [key,path] of [['firstMemory','./data/starter.json'],['memories','./data/memories.json?v=0.7']]){
    try{const data=await readJson(path,key);const validated=validateMemories(data);if(key==='firstMemory')state.seed=validated;else {state.saved=validated;savedRoot={...data};delete savedRoot.memories;}}
    catch(error){failures.push(error.message);}
  }
  state.real=mergeMemories(state.seed||[],state.saved||[]).map(normalizeCategory);
  if(failures.length){$('data-error').textContent=`部分故事未能读取：${failures.join('；')}。已保留可用记录与地图。`;$('data-error').hidden=false;$('retry-data').hidden=false;}
  refreshCollection();
  await refreshCloudReviews();
}
$('close-story').addEventListener('click',()=>closeStory());
$('story-panel').addEventListener('cancel',e=>{e.preventDefault();closeStory();});
$('previous-story').addEventListener('click',()=>{const i=state.filtered.findIndex(m=>m.id===state.selected?.id);if(i>0)openStory(state.filtered[i-1]);});
$('next-story').addEventListener('click',()=>{const i=state.filtered.findIndex(m=>m.id===state.selected?.id);if(i>=0&&i<state.filtered.length-1)openStory(state.filtered[i+1]);});
$('about-button').addEventListener('click',()=>$('about-dialog').showModal());$('sources-button').addEventListener('click',()=>$('about-dialog').showModal());$('close-about').addEventListener('click',()=>$('about-dialog').close());
$('about-dialog').addEventListener('click',e=>{const r=$('about-dialog').getBoundingClientRect();if(e.target===$('about-dialog')&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))$('about-dialog').close();});
$('legend-button').addEventListener('click',()=>$('legend-dialog').showModal());$('close-legend').addEventListener('click',()=>$('legend-dialog').close());$('legend-dialog').addEventListener('click',e=>{const r=$('legend-dialog').getBoundingClientRect();if(e.target===$('legend-dialog')&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))$('legend-dialog').close();});
$('place-search').addEventListener('input',e=>{state.query=e.target.value;refreshCollection();});
$('category-filter').addEventListener('change',refreshCollection);$('city-filter').addEventListener('change',refreshCollection);
document.querySelectorAll('#category-filters [data-category]').forEach(button=>button.addEventListener('click',()=>{$('category-filter').value=button.dataset.category;refreshCollection();}));
document.addEventListener('click',e=>{const button=e.target.closest?.('#category-filters [data-category]');if(!button)return;e.preventDefault();$('category-filter').value=button.dataset.category;refreshCollection();},true);
for(const [button,target]of [['read-official','official-section'],['read-guests','guest-section']])$(button).onclick=()=>$(target).scrollIntoView({behavior:'smooth',block:'start'});
for(const category of CATEGORIES){const span=text('span','');span.append(categoryIcon(category),document.createTextNode(category));$('legend-categories').append(span);}
$('rating-sort').addEventListener('change',()=>{refreshCollection();try{localStorage.setItem('atlas-sort',$('rating-sort').value);}catch{}});
document.querySelectorAll('#sort-buttons [data-sort]').forEach(button=>button.addEventListener('click',()=>{$('rating-sort').value=button.dataset.sort;refreshCollection();try{localStorage.setItem('atlas-sort',button.dataset.sort);}catch{}}));
try{const saved=localStorage.getItem('atlas-sort');if(['default','rating-desc','rating-asc'].includes(saved))$('rating-sort').value=saved;}catch{}
$('region-filter').addEventListener('change',()=>{state.region=$('region-filter').value;refreshCollection();closeStory(false);if(state.region==='all')resetView();else if(state.filtered.some(m=>m.coordinates)){if(state.online)expandCluster(state.filtered.filter(m=>m.coordinates));else atlas.fit(state.filtered);}});
$('retry-data').addEventListener('click',()=>loadStories());
$('zoom-in').addEventListener('click',()=>state.online?streetMap.zoomIn({duration:reduced?0:250}):atlas.zoom(1.35));$('zoom-out').addEventListener('click',()=>state.online?streetMap.zoomOut({duration:reduced?0:250}):atlas.zoom(1/1.35));$('reset-map').addEventListener('click',resetView);
$('street-button').addEventListener('click',()=>enterStreet());$('overview-button').addEventListener('click',()=>{if(state.online||state.loadingStreet)enterOverview();});$('story-street').addEventListener('click',()=>{const point=state.selected?.coordinates;if(point){closeStory(false);enterStreet(point);}});
document.addEventListener('keydown',e=>{
  if($('photo-viewer').open||$('about-dialog').open)return;
  if(e.key==='Escape'&&$('story-panel').open){e.preventDefault();closeStory();return;}
  if($('story-panel').open&&(e.key==='ArrowLeft'||e.key==='ArrowRight')&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){e.preventDefault();setPhoto(photoIndex+(e.key==='ArrowRight'?1:-1));return;}
  if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&!$('story-panel').open){e.preventDefault();$('place-search').focus();}
});

/* Albums and author reviews. No user content is inserted as HTML. */
let photoIndex=0;
let photoOrigin=null;
let savedRoot={schemaVersion:1};
let embeddedCache;
function embeddedPayload(){
  if(embeddedCache!==undefined)return embeddedCache;
  const el=$('atlas-embedded');embeddedCache=el?JSON.parse(el.textContent):null;return embeddedCache;
}
function photoSrc(src){return embeddedPayload()?.assets?.[src]||src;}
function renderRating(target,value,{compact=false}={}){
  target.replaceChildren();target.dataset.ratingTone=ratingTone(value);target.classList.toggle('compact-rating',compact);
  if(!validRating(value)){target.append(text('span','unrated-label','尚未评分'));return;}
  const stars=text('span','rating-stars');stars.setAttribute('role','img');stars.setAttribute('aria-label',`作者评分 ${value} 星，满分 5 星`);
  for(const fill of starFills(value)){
    const cell=text('span','rating-star');const outline=icon('star');outline.classList.add('star-outline');
    const filled=text('span','star-fill');filled.style.width=`${fill*100}%`;filled.append(icon('star'));cell.append(outline,filled);stars.append(cell);
  }
  const score=text('span','rating-number',value.toFixed(1));score.append(text('small','',' / 5'));target.append(stars,score);
}
function currentPhotos(){return state.selected?photosOf(state.selected):[];}
function renderAlbum(){
  const photos=currentPhotos();photoIndex=0;
  $('photo-thumbnails').replaceChildren();
  photos.forEach((photo,index)=>{
    const button=text('button','photo-thumb');button.type='button';button.dataset.photoIndex=String(index);
    button.setAttribute('aria-label',`查看第 ${index+1} 张照片${photo.caption?'：'+photo.caption:''}`);
    const image=document.createElement('img');image.src=photoSrc(photo.thumbnail||photo.src);image.alt='';image.loading='lazy';
    image.addEventListener('error',()=>{image.hidden=true;button.classList.add('thumb-unavailable');},{once:true});
    button.append(image,text('span','thumb-number',String(index+1).padStart(2,'0')));
    button.addEventListener('click',()=>setPhoto(index));$('photo-thumbnails').append(button);
  });
  $('story-art-en').textContent=state.selected?.placeEn||'暂无照片';
  $('photo-thumbnails').hidden=photos.length<2;
  $('photo-credit').textContent=state.selected?.demo?'演示卡片 · 尚无照片':'作者提供的照片';
  $('photo-credit').hidden=!photos.length;
  $('album-note').textContent=photos.length?`${photos.length} 张照片 · 原比例展示 · 点开可看大图`:'暂无照片';
  setPhoto(0);
}
function setPhoto(index){
  const photos=currentPhotos();const count=photos.length;photoIndex=count?Math.max(0,Math.min(count-1,index)):0;
  const current=photos[photoIndex];
  $('story-art').style.setProperty('--photo-ratio',current?.width&&current?.height?`${current.width}/${current.height}`:'4/3');
  $('photo-open').hidden=!current;$('photo-placeholder').hidden=!!current;
  $('photo-placeholder-note').textContent='这里留给下一张照片。';
  $('photo-counter').hidden=!count;$('photo-counter').textContent=count?`${String(photoIndex+1).padStart(2,'0')} / ${String(count).padStart(2,'0')}`:'';
  $('photo-caption').textContent=current?.caption|| (current?`第 ${photoIndex+1} 张照片`:'');
  for(const id of ['photo-prev','photo-next'])$(id).hidden=count<2;
  $('photo-prev').disabled=photoIndex===0;$('photo-next').disabled=photoIndex>=count-1;
  if(current){
    const image=$('story-photo');image.hidden=false;image.alt=current.alt||`${state.selected.place}的第 ${photoIndex+1} 张照片`;
    if(current.width)image.width=current.width;if(current.height)image.height=current.height;
    image.src=photoSrc(current.src);
    $('photo-open').setAttribute('aria-label',`放大查看第 ${photoIndex+1} 张照片：${current.caption||state.selected.place}`);
  }else $('story-photo').removeAttribute('src');
  for(const button of $('photo-thumbnails').children)button.setAttribute('aria-pressed',String(Number(button.dataset.photoIndex)===photoIndex));
  if($('photo-viewer').open)renderViewer();
}
function renderViewer(){
  const photos=currentPhotos(),photo=photos[photoIndex];if(!photo)return;
  $('viewer-title').textContent=state.selected.place||state.selected.title;
  $('viewer-image').hidden=false;$('viewer-error').hidden=true;
  $('viewer-image').src=photoSrc(photo.src);$('viewer-image').alt=photo.alt||`${state.selected.place}的照片`;
  $('viewer-index').textContent=`${photoIndex+1} / ${photos.length}`;$('viewer-caption').textContent=photo.caption||'';
  $('viewer-prev').hidden=$('viewer-next').hidden=photos.length<2;
  $('viewer-prev').disabled=photoIndex===0;$('viewer-next').disabled=photoIndex>=photos.length-1;
}
function openViewer(){if(!currentPhotos().length)return;photoOrigin=document.activeElement;renderViewer();$('photo-viewer').showModal();$('close-viewer').focus();}
function closeViewer(){if(!$('photo-viewer').open)return;$('photo-viewer').close();if(photoOrigin?.isConnected)photoOrigin.focus({preventScroll:true});}
function bindSwipe(element){
  let start=null;
  element.addEventListener('touchstart',e=>{if(e.touches.length!==1){start=null;return;}start=[e.touches[0].clientX,e.touches[0].clientY];},{passive:true});
  element.addEventListener('touchmove',e=>{if(e.touches.length!==1)start=null;},{passive:true});
  element.addEventListener('touchend',e=>{if(!start||!e.changedTouches.length)return;const dx=e.changedTouches[0].clientX-start[0],dy=e.changedTouches[0].clientY-start[1];start=null;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.4)setPhoto(photoIndex+(dx<0?1:-1));},{passive:true});
}
function backdropClose(dialog,close){dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))close();});}
$('story-photo').addEventListener('error',()=>{$('photo-open').hidden=true;$('photo-placeholder').hidden=false;$('photo-placeholder-note').textContent='这张照片暂时未能加载。请切换照片或重新点选重试。';});
$('viewer-image').addEventListener('error',()=>{$('viewer-image').hidden=true;$('viewer-error').hidden=false;});
$('photo-open').addEventListener('click',openViewer);$('close-viewer').addEventListener('click',closeViewer);
for(const id of ['photo-prev','viewer-prev'])$(id).addEventListener('click',()=>setPhoto(photoIndex-1));
for(const id of ['photo-next','viewer-next'])$(id).addEventListener('click',()=>setPhoto(photoIndex+1));
$('photo-viewer').addEventListener('cancel',e=>{e.preventDefault();closeViewer();});
$('photo-viewer').addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();setPhoto(photoIndex+(e.key==='ArrowRight'?1:-1));}});
bindSwipe($('story-art'));bindSwipe($('viewer-stage'));backdropClose($('story-panel'),()=>closeStory());

/* Public pages cannot publish. The protected author desk owns all writes. */
async function goToAuthor(){
  let origin=location.origin;
  try{const r=await fetch('/api/health',{cache:'no-store',signal:AbortSignal.timeout(5000)});const d=await r.json();if(d.author?.origin)origin=d.author.origin;}catch{}
  location.assign(`${origin}/author/${state.selected?'?place='+encodeURIComponent(state.selected.id):''}`);
}
$('story-author').addEventListener('click',goToAuthor);$('about-author').addEventListener('click',goToAuthor);$('header-author').addEventListener('click',goToAuthor);
let cloudBusy=false;
async function refreshCloudReviews(){
  if(cloudBusy||location.protocol==='file:')return;cloudBusy=true;
  try{
    const r=await fetch('/api/reviews',{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!r.headers.get('Content-Type')?.includes('application/json'))throw new Error('云端接口未部署');
    const data=await r.json();if(!r.ok||!data.ok||!Array.isArray(data.reviews))throw new Error(data.message||'云端评价暂不可用');
    const entries=new Map();for(const row of data.reviews){
      if(!row||typeof row.id!=='string'||!row.review)continue;
      const rating=row.review.rating;
      if(rating!==null&&!validRating(rating))continue;
      if(typeof row.review.author!=='string'||typeof row.review.comment!=='string')continue;
      entries.set(row.id,row);
    }
    const base=mergeMemories(state.seed||[],state.saved||[]).map(m=>entries.has(m.id)?{...m,review:entries.get(m.id).review}:m);
    const placesResponse=await fetch('/api/places',{cache:'no-store',signal:AbortSignal.timeout(10000)});
    const placesData=await placesResponse.json();
    if(!placesResponse.ok||!placesData.ok)throw new Error('云端猫咪记录暂不可用');
    state.real=mergeMemories(base,validateMemories(placesData)).map(normalizeCategory);
    const selected=state.selected?.id;
    refreshCollection();
    if(selected){const m=state.real.find(x=>x.id===selected);if(m)openStory(m);}
  }catch(error){/* cloud reviews are optional; keep the public page quiet when unavailable */}
  finally{cloudBusy=false;}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&document.documentElement.dataset.state==='ready')refreshCloudReviews();});
window.addEventListener('pageshow',e=>{if(e.persisted)refreshCloudReviews();});

async function boot(){
  atlas=new OverviewMap();atlas.resize();
  const results=await Promise.allSettled([readJson('./data/chongqing-overview.geojson','geography')]);
  if(results[0].status==='fulfilled'){try{atlas.setGeography(results[0].value);notify('暂无猫咪记录，作者登录后可以添加。',4800);}catch(e){notify(e.message,0);}}
  else notify('总览数据未能读取。请确认 public/data 已完整上传；直接打开请使用单文件预览版。',0);
  await loadStories(true);document.documentElement.dataset.state='ready';
  const match=location.hash.match(/^#place=(.+)$/);if(match){let id;try{id=decodeURIComponent(match[1]);}catch{}const m=state.items.find(m=>m.id===id);if(m)openStory(m);}
}
boot().catch(e=>{document.documentElement.dataset.state='error';notify('页面初始化失败。请检查文件是否完整上传。',0);console.error(e);});

$('read-long-review').onclick=()=>{$('story-writing').scrollIntoView({behavior:'smooth',block:'start'});$('story-writing').focus({preventScroll:true});};
