/* AMap JS API adapter for the cat map's existing street-map interface. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let loader;

function loadScript(config){
  if(window.AMap?.Map)return Promise.resolve(window.AMap);
  if(loader)return loader;
  const key=String(config.amapKey||'').trim();
  if(!key)throw new Error('AMAP_KEY_MISSING：尚未配置高德地图 JS API Key。');
  const securityCode=String(config.amapSecurityCode||'').trim();
  if(securityCode)window._AMapSecurityConfig={...(window._AMapSecurityConfig||{}),securityJsCode:securityCode};
  loader=new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{
      script?.remove();
    };
    const succeed=(api)=>{if(settled)return;if(api?.Map||window.AMap?.Map){settled=true;clearTimeout(timer);cleanup();resolve(api||window.AMap);}else fail(new Error('AMAP_LOAD_ERROR：高德地图脚本没有返回 API。'));};
    const fail=(error)=>{if(settled)return;settled=true;clearTimeout(timer);cleanup();loader=null;reject(error);};
    const start=()=>{
      if(!window.AMapLoader?.load){fail(new Error('AMAP_LOAD_ERROR：高德地图加载器没有返回 API。'));return;}
      window.AMapLoader.load({key,version:'2.0',plugins:['AMap.Scale']}).then(succeed).catch(()=>fail(new Error('AMAP_LOAD_ERROR：高德地图初始化失败，请检查 Key 的域名白名单和安全密钥配置。')));
    };
    if(window.AMapLoader?.load){start();return;}
    const script=document.createElement('script');
    script.src='https://webapi.amap.com/loader.js';
    script.async=true;
    script.onload=start;
    script.onerror=()=>fail(new Error('AMAP_LOAD_ERROR：高德地图脚本加载失败，请检查域名白名单和网络。'));
    const timer=setTimeout(()=>fail(new Error('AMAP_LOAD_ERROR：高德地图脚本初始化超时，请检查 Key 的域名白名单和安全密钥配置。')),15000);
    document.head.append(script);
  });
  return loader;
}

export class AMapStreetMap {
  constructor({container,center,zoom,config,onStatus=()=>{}}){
    this.container=container;this.center=[...center];this.zoom=clamp(zoom,config.minZoom||4,config.maxZoom||19);
    this.config=config;this.onStatus=onStatus;this.listeners=new Map();this.destroyed=false;this.map=null;this.moveFrame=0;
    this.life=new AbortController();this.container.replaceChildren();this.container.classList.add('amap-street-map');
    this.container.tabIndex=0;this.container.setAttribute('role','region');this.container.setAttribute('aria-label','高德街道地图。拖动移动，滚轮缩放；方向键移动，加减号缩放。');
    this.ready=this.init();
  }
  async init(){
    const AMap=await loadScript(this.config);if(this.destroyed)throw new Error('AMAP_CANCELLED：地图已切换。');
    this.api=AMap;
    // Leave mapStyle unset so the API can use its built-in standard layer without
    // making an extra custom-style request (which can be blocked independently).
    this.map=new AMap.Map(this.container,{center:this.center,zoom:this.zoom,viewMode:'2D',resizeEnable:true,showLabel:true,dragEnable:true,zoomEnable:true,doubleClickZoom:true,keyboardEnable:true,rotateEnable:false,pitchEnable:false,animateEnable:true});
    this.map.on('complete',()=>this.emit('ready'));
    this.map.on('moveend',()=>{this.emit('move');this.emit('idle');});
    this.map.on('zoomend',()=>{this.emit('move');this.emit('idle');});
    // Keep external overlays (cat heads and labels) in step with AMap's
    // animated pan/zoom instead of waiting for the end events.
    const syncMove=()=>{
      if(this.moveFrame)return;
      this.moveFrame=requestAnimationFrame(()=>{this.moveFrame=0;if(!this.destroyed)this.emit('move');});
    };
    this.map.on('mapmove',syncMove);
    this.map.on('zoomchange',syncMove);
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
  project(coords){if(!this.map||!this.api)return {x:0,y:0};const p=this.map.lngLatToContainer(new this.api.LngLat(coords[0],coords[1]));return {x:p.getX(),y:p.getY()};}
  unproject([x,y]){if(!this.map||!this.api)return this.center;const p=this.map.containerToLngLat(new this.api.Pixel(x,y));return [p.getLng(),p.getLat()];}
  setPadding(p={}){if(!this.map||!this.map.setPadding)return;this.map.setPadding([p.top||0,p.right||0,p.bottom||0,p.left||0]);}
  resize(){this.map?.resize();this.emit('resize');}
  flyTo({center=this.center,zoom=this.zoom}={}){if(!this.map)return this;this.center=[...center];this.zoom=clamp(zoom,this.config.minZoom||4,this.config.maxZoom||19);this.map.setZoomAndCenter(this.zoom,this.center,true);return this;}
  fitBounds(bounds,{padding=60,maxZoom=16}={}){if(!this.map||!this.api)return this;const b=bounds.toArray?bounds.toArray():bounds;const pad=typeof padding==='number'?[padding,padding,padding,padding]:[padding.top||0,padding.right||0,padding.bottom||0,padding.left||0];this.map.setFitView(null,false,pad,maxZoom);if(b?.length===2)this.map.setBounds(new this.api.Bounds(new this.api.LngLat(b[0][0],b[0][1]),new this.api.LngLat(b[1][0],b[1][1])));return this;}
  zoomIn(){this.map?.zoomIn();return this;}
  zoomOut(){this.map?.zoomOut();return this;}
  retry(){this.map?.render();}
  remove(){this.destroyed=true;this.life.abort();if(this.moveFrame)cancelAnimationFrame(this.moveFrame);this.moveFrame=0;this.listeners.clear();this.map?.destroy();this.map=null;this.container.replaceChildren();this.container.classList.remove('amap-street-map');}
}
