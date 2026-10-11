/** Dependency-free, 2D Web Mercator street renderer.
 * Tiles are fetched ONLY for the current viewport, through /api/tiles.
 * No CDN scripts, WebGL, prefetch/offline downloads, or invented road geometry.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function worldPoint([lng,lat],zoom){const size=256*2**zoom,r=clamp(lat,-85.05112878,85.05112878)*Math.PI/180;return [(lng+180)/360*size,(1-Math.log(Math.tan(Math.PI/4+r/2))/Math.PI)/2*size];}
export function worldToGeo([x,y],zoom){const size=256*2**zoom;return [x/size*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/size)))*180/Math.PI];}
export class GeoBounds {
  constructor(){this.west=Infinity;this.south=Infinity;this.east=-Infinity;this.north=-Infinity;}
  extend(p){this.west=Math.min(this.west,p[0]);this.east=Math.max(this.east,p[0]);this.south=Math.min(this.south,p[1]);this.north=Math.max(this.north,p[1]);return this;}
  toArray(){return [[this.west,this.south],[this.east,this.north]];}
}
export async function readStreetConfig(){
  let r;try{r=await fetch('/api/maps',{cache:'no-store',signal:AbortSignal.timeout(10000),credentials:'omit'});}catch{throw new Error('MAP_API_UNREACHABLE：网站地图接口暂时不可达。');}
  if(!r.headers.get('Content-Type')?.includes('application/json'))throw new Error('FUNCTIONS_NOT_DEPLOYED：地图接口没有返回 JSON，请确认 functions 文件夹位于仓库根目录。');
  const data=await r.json();
  if(!r.ok||!data.ok)throw new Error(`${data.code||'MAP_CONFIG_ERROR'}：${data.message||'地图接口尚未就绪。'}`);
  if(data.tileTemplate!=='/api/tiles/{z}/{x}/{y}.png')throw new Error('MAP_CONFIG_ERROR：地图地址必须使用本站固定接口。');
  const local=window.__AMAP_CONFIG__&&typeof window.__AMAP_CONFIG__==='object'?window.__AMAP_CONFIG__:{};
  return {...data,amapKey:String(data.amapKey||local.key||'').trim(),amapStyle:String(data.amapStyle||local.style||'amap://styles/whitesmoke').trim(),amapSecurityCode:String(data.amapSecurityCode||local.securityCode||'').trim()};
}
export class StreetMap {
  constructor({container,center,zoom,config,onStatus=()=>{}}){
    this.container=container;this.center=[...center];this.zoom=clamp(zoom,config.minZoom,config.maxZoom);
    this.config=config;this.onStatus=onStatus;this.tiles=new Map();this.listeners=new Map();this.pointers=new Map();
    this.life=new AbortController();this.queue=[];this.active=0;this.destroyed=false;this.generation=0;this.firstShown=false;
    this.layer=document.createElement('div');this.layer.className='street-tile-layer';container.replaceChildren(this.layer);
    container.classList.add('street-map-2d');container.tabIndex=0;container.setAttribute('role','region');
    container.setAttribute('aria-label','街道地图。拖动移动，滚轮缩放；方向键移动，加减号缩放。');
    this.bind();this.resize();
  }
  on(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);return this;}
  off(type,fn){this.listeners.get(type)?.delete(fn);return this;}
  emit(type,data){for(const fn of this.listeners.get(type)||[])fn(data);}
  getCenter(){return {lng:this.center[0],lat:this.center[1]};}
  getZoom(){return this.zoom;}
  project(coords){const p=worldPoint(coords,this.zoom),c=worldPoint(this.center,this.zoom);return {x:p[0]-c[0]+this.width/2,y:p[1]-c[1]+this.height/2};}
  unproject([x,y]){const c=worldPoint(this.center,this.zoom);return worldToGeo([c[0]+x-this.width/2,c[1]+y-this.height/2],this.zoom);}
  setPadding(){}
  resize(){this.width=this.container.clientWidth;this.height=this.container.clientHeight;this.render();this.emit('resize');}
  constrain(){const b=this.config.bounds;this.center=[clamp(this.center[0],b[0],b[2]),clamp(this.center[1],b[1],b[3])];}
  flyTo({center=this.center,zoom=this.zoom}){this.center=[...center];this.zoom=clamp(zoom,this.config.minZoom,this.config.maxZoom);this.constrain();this.render();this.emit('move');return this;}
  fitBounds(bounds,{padding=60,maxZoom=16}={}){
    const b=bounds.toArray?bounds.toArray():bounds;
    const a=worldPoint(b[0],0),c=worldPoint(b[1],0);
    const p=typeof padding==='number'?{left:padding,right:padding,top:padding,bottom:padding}:{left:0,right:0,top:0,bottom:0,...padding};
    const zoom=clamp(Math.min(Math.log2(Math.max(30,this.width-p.left-p.right)/Math.max(.00001,Math.abs(a[0]-c[0]))),Math.log2(Math.max(30,this.height-p.top-p.bottom)/Math.max(.00001,Math.abs(a[1]-c[1])))),this.config.minZoom,Math.min(maxZoom,this.config.maxZoom));
    const mid=[(a[0]+c[0])/2-(p.left-p.right)/2/2**zoom,(a[1]+c[1])/2-(p.top-p.bottom)/2/2**zoom];
    return this.flyTo({center:worldToGeo(mid,0),zoom});
  }
  zoomBy(delta,anchor=[this.width/2,this.height/2]){
    const geo=this.unproject(anchor);this.zoom=clamp(this.zoom+delta,this.config.minZoom,this.config.maxZoom);
    const p=worldPoint(geo,this.zoom);this.center=worldToGeo([p[0]-(anchor[0]-this.width/2),p[1]-(anchor[1]-this.height/2)],this.zoom);
    this.constrain();this.render();this.emit('move');
  }
  zoomIn(){this.zoomBy(1);} zoomOut(){this.zoomBy(-1);}
  pan(dx,dy){const c=worldPoint(this.center,this.zoom);this.center=worldToGeo([c[0]-dx,c[1]-dy],this.zoom);this.constrain();this.render();this.emit('move');}
  bind(){
    const el=this.container,signal=this.life.signal,pos=e=>{const r=el.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];};
    el.addEventListener('pointerdown',e=>{if(e.button!==0)return;this.pointers.set(e.pointerId,pos(e));el.setPointerCapture(e.pointerId);el.classList.add('is-dragging');},{signal});
    el.addEventListener('pointermove',e=>{
      if(!this.pointers.has(e.pointerId))return;
      const before=[...this.pointers.values()],old=this.pointers.get(e.pointerId),now=pos(e);this.pointers.set(e.pointerId,now);
      if(this.pointers.size===2){const after=[...this.pointers.values()],d0=Math.hypot(before[0][0]-before[1][0],before[0][1]-before[1][1]),d1=Math.hypot(after[0][0]-after[1][0],after[0][1]-after[1][1]);if(d0>4&&d1>4)this.zoomBy(Math.log2(d1/d0),[(before[0][0]+before[1][0])/2,(before[0][1]+before[1][1])/2]);this.pan((now[0]-old[0])/2,(now[1]-old[1])/2);}
      else if(this.pointers.size===1)this.pan(now[0]-old[0],now[1]-old[1]);
    },{signal});
    const end=e=>{this.pointers.delete(e.pointerId);if(!this.pointers.size)el.classList.remove('is-dragging');};
    for(const type of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(type,end,{signal});
    el.addEventListener('wheel',e=>{e.preventDefault();this.zoomBy(-clamp(e.deltaY,-120,120)*.003,pos(e));},{passive:false,signal});
    el.addEventListener('dblclick',e=>this.zoomBy(1,pos(e)),{signal});
    el.addEventListener('keydown',e=>{const moves={ArrowLeft:[80,0],ArrowRight:[-80,0],ArrowUp:[0,80],ArrowDown:[0,-80]};if(moves[e.key]){e.preventDefault();this.pan(...moves[e.key]);}if(e.key==='+'||e.key==='='){e.preventDefault();this.zoomIn();}if(e.key==='-'){e.preventDefault();this.zoomOut();}},{signal});
  }
  render(){
    if(this.destroyed||!this.width||!this.height)return;
    const z=Math.floor(this.zoom),scale=2**(this.zoom-z),size=256*scale,n=2**z,c=worldPoint(this.center,this.zoom),left=c[0]-this.width/2,top=c[1]-this.height/2;
    const current=new Set(),limits=this.config.bounds;
    for(let y=Math.max(0,Math.floor(top/size));y<=Math.min(n-1,Math.floor((top+this.height-1)/size));y++){
      for(let x=Math.max(0,Math.floor(left/size));x<=Math.min(n-1,Math.floor((left+this.width-1)/size));x++){
        const nw=worldToGeo([x*256,y*256],z),se=worldToGeo([(x+1)*256,(y+1)*256],z);
        if(se[0]<limits[0]||nw[0]>limits[2]||nw[1]<limits[1]||se[1]>limits[3])continue;
        const key=`${z}/${x}/${y}`,px=x*size-left,py=y*size-top;current.add(key);let tile=this.tiles.get(key);
        if(!tile){
          const element=document.createElement('div');element.className='street-tile';element.setAttribute('aria-hidden','true');
          tile={key,z,x,y,element,state:'queued',controller:new AbortController(),objectURL:null};
          this.tiles.set(key,tile);this.layer.append(element);this.queue.push(tile);
        }
        tile.element.style.transform=`translate(${px}px,${py}px)`;tile.element.style.width=`${size+.3}px`;tile.element.style.height=`${size+.3}px`;
      }
    }
    for(const [key,tile]of this.tiles){if(!current.has(key)){tile.controller.abort();tile.element.remove();if(tile.objectURL)URL.revokeObjectURL(tile.objectURL);this.tiles.delete(key);}}
    this.queue=this.queue.filter(t=>this.tiles.get(t.key)===t&&t.state==='queued');
    this.queue.sort((a,b)=>Math.hypot((a.x+.5)*size-left-this.width/2,(a.y+.5)*size-top-this.height/2)-Math.hypot((b.x+.5)*size-left-this.width/2,(b.y+.5)*size-top-this.height/2));
    clearTimeout(this.loadTimer);this.loadTimer=setTimeout(()=>this.pump(),80);this.status();
  }
  pump(){
    if(this.destroyed)return;
    while(this.active<6&&this.queue.length){const tile=this.queue.shift();if(this.tiles.get(tile.key)!==tile)continue;this.active++;this.load(tile).finally(()=>{this.active--;this.pump();});}
  }
  async load(tile){
    tile.state='loading';const url=this.config.tileTemplate.replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y);
    const timeout=setTimeout(()=>tile.controller.abort('timeout'),16000);
    try{
      const r=await fetch(url,{signal:tile.controller.signal,credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});
      if(!r.ok){let data;try{data=await r.json();}catch{}throw new Error(`${data?.code||'TILE_HTTP_'+r.status}：${data?.message||'街道图片没有加载成功。'}`);}
      if(!r.headers.get('Content-Type')?.startsWith('image/png'))throw new Error('TILE_NOT_IMAGE：接口没有返回地图图片，检查 functions 部署和转发规则。');
      const blob=await r.blob();if(this.destroyed||this.tiles.get(tile.key)!==tile)return;
      tile.objectURL=URL.createObjectURL(blob);const image=new Image();image.alt='';image.draggable=false;image.className='street-tile-image';image.src=tile.objectURL;
      await image.decode();if(this.destroyed||this.tiles.get(tile.key)!==tile)return;
      tile.element.replaceChildren(image);tile.state='loaded';
    }catch(error){
      if(this.destroyed||this.tiles.get(tile.key)!==tile)return;
      tile.state='error';tile.error=tile.controller.signal.reason==='timeout'?'TILE_TIMEOUT：街道图片加载超时。':error.message;
      tile.element.classList.add('tile-error');this.lastError=tile.error;
    }finally{clearTimeout(timeout);if(!this.destroyed)this.status();}
  }
  status(){
    const all=[...this.tiles.values()],loaded=all.filter(t=>t.state==='loaded').length,failed=all.filter(t=>t.state==='error').length,pending=all.length-loaded-failed;
    this.diagnostics={total:all.length,loaded,failed,pending,error:this.lastError||null,zoom:this.zoom};
    this.onStatus(this.diagnostics);
    if(!this.firstShown&&loaded>=Math.max(1,Math.ceil(all.length*.6))){this.firstShown=true;this.emit('ready');}
    if(all.length&&pending===0&&loaded===0)this.emit('fatal',new Error(this.lastError||'街道图未能加载。'));
  }
  waitForReady(timeout=24000){
    if(this.firstShown)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      let done=false;const finish=(e)=>{if(done)return;done=true;clearTimeout(timer);this.off('ready',ok);this.off('fatal',bad);this.off('remove',cancel);e?reject(e):resolve();};
      const ok=()=>finish(),bad=e=>finish(e),cancel=()=>finish(new Error('已切回总览。'));
      const timer=setTimeout(()=>finish(new Error(this.lastError||'STREET_TIMEOUT：街道图未能在限定时间内完整显示。')),timeout);
      this.on('ready',ok);this.on('fatal',bad);this.on('remove',cancel);
    });
  }
  retry(){for(const [key,tile]of this.tiles)if(tile.state==='error'){tile.controller.abort();tile.element.remove();if(tile.objectURL)URL.revokeObjectURL(tile.objectURL);this.tiles.delete(key);}this.lastError=null;this.render();}
  remove(){this.destroyed=true;clearTimeout(this.loadTimer);this.life.abort();this.emit('remove');for(const tile of this.tiles.values()){tile.controller.abort();if(tile.objectURL)URL.revokeObjectURL(tile.objectURL);}this.tiles.clear();this.listeners.clear();this.container.replaceChildren();}
}
