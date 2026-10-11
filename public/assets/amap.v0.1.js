/* AMap JS API adapter for the cat map's existing street-map interface. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let loader;

function loadScript(config){
  if(window.AMap)return Promise.resolve(window.AMap);
  if(loader)return loader;
  const key=String(config.amapKey||'').trim();
  if(!key)throw new Error('AMAP_KEY_MISSING：尚未配置高德地图 JS API Key。');
  const securityCode=String(config.amapSecurityCode||'').trim();
  if(securityCode)window._AMapSecurityConfig={...(window._AMapSecurityConfig||{}),securityJsCode:securityCode};
  loader=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const params=new URLSearchParams({v:'2.0',key,plugin:'AMap.Scale'});
    script.src=`https://webapi.amap.com/maps?${params}`;
    script.async=true;
    script.onload=()=>window.AMap?resolve(window.AMap):reject(new Error('AMAP_LOAD_ERROR：高德地图脚本没有返回 API。'));
    script.onerror=()=>reject(new Error('AMAP_LOAD_ERROR：高德地图脚本加载失败，请检查域名白名单和网络。'));
    document.head.append(script);
  });
  return loader;
}

export class AMapStreetMap {
  constructor({container,center,zoom,config,onStatus=()=>{}}){
    this.container=container;this.center=[...center];this.zoom=clamp(zoom,config.minZoom||4,config.maxZoom||19);
    this.config=config;this.onStatus=onStatus;this.listeners=new Map();this.destroyed=false;this.map=null;
    this.life=new AbortController();this.container.replaceChildren();this.container.classList.add('amap-street-map');
    this.container.tabIndex=0;this.container.setAttribute('role','region');this.container.setAttribute('aria-label','高德街道地图。拖动移动，滚轮缩放；方向键移动，加减号缩放。');
    this.ready=this.init();
  }
  async init(){
    const AMap=await loadScript(this.config);if(this.destroyed)throw new Error('AMAP_CANCELLED：地图已切换。');
    // Use AMap's public standard style so a private or stale style ID cannot leave a blank canvas.
    this.map=new AMap.Map(this.container,{center:this.center,zoom:this.zoom,viewMode:'2D',mapStyle:'amap://styles/normal',resizeEnable:true,showLabel:true,dragEnable:true,zoomEnable:true,doubleClickZoom:true,keyboardEnable:true,rotateEnable:false,pitchEnable:false,animateEnable:true});
    this.map.on('complete',()=>this.emit('ready'));
    this.map.on('moveend',()=>{this.emit('move');this.emit('idle');});
    this.map.on('zoomend',()=>{this.emit('move');this.emit('idle');});
    this.map.on('resize',()=>this.emit('resize'));
    await new Promise((resolve,reject)=>{let done=false;const finish=(fn)=>{if(done)return;done=true;fn();};const timer=setTimeout(()=>finish(()=>reject(new Error('AMAP_TIMEOUT：高德地图加载超时，请检查 Key 的域名白名单和安全密钥配置。'))),20000);this.map.on('complete',()=>{clearTimeout(timer);finish(resolve);});this.map.on('error',e=>{clearTimeout(timer);finish(()=>reject(new Error(`AMAP_ERROR：${e?.type||'地图加载失败'}。`)));});});
    this.emit('ready');return this;
  }
  waitForReady(){return this.ready;}
  on(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);return this;}
  off(type,fn){this.listeners.get(type)?.delete(fn);return this;}
  emit(type,data){for(const fn of this.listeners.get(type)||[])fn(data);}
  getCenter(){const c=this.map?.getCenter();return c?{lng:c.getLng(),lat:c.getLat()}:{lng:this.center[0],lat:this.center[1]};}
  getZoom(){return this.map?.getZoom()||this.zoom;}
  project(coords){if(!this.map||!window.AMap)return {x:0,y:0};const p=this.map.lngLatToContainer(new window.AMap.LngLat(coords[0],coords[1]));return {x:p.getX(),y:p.getY()};}
  unproject([x,y]){if(!this.map||!window.AMap)return this.center;const p=this.map.containerToLngLat(new window.AMap.Pixel(x,y));return [p.getLng(),p.getLat()];}
  setPadding(p={}){if(!this.map||!this.map.setPadding)return;this.map.setPadding([p.top||0,p.right||0,p.bottom||0,p.left||0]);}
  resize(){this.map?.resize();this.emit('resize');}
  flyTo({center=this.center,zoom=this.zoom}={}){if(!this.map)return this;this.center=[...center];this.zoom=clamp(zoom,this.config.minZoom||4,this.config.maxZoom||19);this.map.setZoomAndCenter(this.zoom,this.center,true);return this;}
  fitBounds(bounds,{padding=60,maxZoom=16}={}){if(!this.map)return this;const b=bounds.toArray?bounds.toArray():bounds;const pad=typeof padding==='number'?[padding,padding,padding,padding]:[padding.top||0,padding.right||0,padding.bottom||0,padding.left||0];this.map.setFitView(null,false,pad,maxZoom);if(b?.length===2)this.map.setBounds(new window.AMap.Bounds(new window.AMap.LngLat(b[0][0],b[0][1]),new window.AMap.LngLat(b[1][0],b[1][1])));return this;}
  zoomIn(){this.map?.zoomIn();return this;}
  zoomOut(){this.map?.zoomOut();return this;}
  retry(){this.map?.render();}
  remove(){this.destroyed=true;this.life.abort();this.listeners.clear();this.map?.destroy();this.map=null;this.container.replaceChildren();this.container.classList.remove('amap-street-map');}
}
