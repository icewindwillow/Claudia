import {HttpError} from './http.mjs';
import {dbOf} from './reviews.mjs';
const ALIASES={};
export function searchQuery(value){
  if(typeof value!=='string')throw new HttpError(400,'BAD_SEARCH','请输入地名。');
  const query=value.trim().replace(/\s+/g,' ');
  if(query.length<2||query.length>160||/[\u0000-\u001f]/.test(query))throw new HttpError(400,'BAD_SEARCH','地名请填写 2～160 个字符。');
  return {query,upstreamQuery:query.includes('重庆')||/chongqing/i.test(query)?query:query+' 重庆'};
}
const str=(v,n=200)=>typeof v==='string'?v.slice(0,n):'';
export function normalizeResults(data){
  if(!data||!Array.isArray(data.features))throw new HttpError(502,'SEARCH_BAD_RESPONSE','地名服务返回格式异常，请稍后重试。');
  const seen=new Set(),results=[];
  for(const feature of data.features.slice(0,30)){
    const p=feature?.properties||{},c=feature?.geometry?.coordinates;
    if(feature?.geometry?.type!=='Point'||!Array.isArray(c)||c.length!==2||!c.every(Number.isFinite)||c[0]<105.2||c[0]>110.3||c[1]<28.1||c[1]>32.3||String(p.countrycode).toUpperCase()!=='CN')continue;
    const name=str(p.name,160)||str(p.street,160);if(!name)continue;
    const key=`${name}|${c.map(x=>x.toFixed(4)).join(',')}`;if(seen.has(key))continue;seen.add(key);
    const region='chongqing';
    const address=[p.housenumber,p.street,p.city||p.town||p.district,p.county,p.state,p.postcode].filter(v=>typeof v==='string').filter((v,i,a)=>a.indexOf(v)===i).join(', ').slice(0,200);
    const osmType={N:'node',W:'way',R:'relation'}[p.osm_type],osmId=Number(p.osm_id);
    const sourceUrl=osmType&&Number.isSafeInteger(osmId)&&osmId>0?`https://www.openstreetmap.org/${osmType}/${osmId}`:'https://www.openstreetmap.org/copyright';
    results.push({name,address,city:str(p.city||p.town||p.village,120),region,coordinates:c,kind:str(p.osm_value,80),sourceUrl});
    if(results.length===8)break;
  }
  return results;
}
function normalizeNominatim(data){
  if(!Array.isArray(data))return [];
  return normalizeResults({features:data.map(x=>({geometry:{type:'Point',coordinates:[Number(x.lon),Number(x.lat)]},properties:{name:String(x.display_name||'').split(',')[0],street:'',city:'重庆',countrycode:'CN',osm_type:String(x.osm_type||'').slice(0,1).toUpperCase(),osm_id:Number(x.osm_id)}}))});
}
function normalizeAmap(data){
  if(!data||data.status!=='1'||!Array.isArray(data.geocodes))return [];
  return normalizeResults({features:data.geocodes.map(x=>{const [lon,lat]=String(x.location||'').split(',').map(Number);const name=(typeof x.building?.name==='string'&&x.building.name)||(typeof x.neighborhood?.name==='string'&&x.neighborhood.name)||String(x.formatted_address||'').split(/[，,]/)[0];return {geometry:{type:'Point',coordinates:[lon,lat]},properties:{name,address:x.formatted_address,city:x.city||'重庆',district:x.district,countrycode:'CN'}}})});
}

async function fetchJson(fetcher,url,options,code='SEARCH_UNAVAILABLE'){
  try{
    const response=await fetcher(url,options);
    if(!response.ok)return {response:null,data:null};
    try{return {response,data:await response.json()};}
    catch{return {response,data:null};}
  }catch(error){
    // Upstream outages are expected during a read-only search. Keep them
    // local to this provider so another provider can still answer.
    console.warn('[search-upstream]',code,error?.name||'error');
    return {response:null,data:null};
  }
}
export async function searchPlaces(env,body,{fetcher=fetch}={}){
  const {query,upstreamQuery}=searchQuery(body?.query),db=dbOf(env);
  // Explicit authenticated searches only; never forward tokens, emails or story data.
  await db.prepare('CREATE TABLE IF NOT EXISTS place_search_cache (query TEXT PRIMARY KEY, results TEXT NOT NULL, fetched_at INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS place_search_gate (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, next_at INTEGER NOT NULL)').run();
  // Version the cache when changing providers so stale empty Photon results cannot hide AMap hits.
  const key='amap-cq-v2:'+upstreamQuery.toLowerCase();
  const cached=await db.prepare("SELECT results FROM place_search_cache WHERE query=? AND fetched_at>CAST(strftime('%s','now') AS INTEGER)-604800").bind(key).first();
  if(cached)return {query,upstreamQuery,results:JSON.parse(cached.results),cached:true};
  const owner=crypto.randomUUID();
  const lease=await db.prepare("INSERT INTO place_search_gate (id,owner,next_at) VALUES (1,?,CAST(strftime('%s','now') AS INTEGER)+30) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,next_at=excluded.next_at WHERE place_search_gate.next_at<=CAST(strftime('%s','now') AS INTEGER) RETURNING id").bind(owner).first();
  if(!lease)throw new HttpError(429,'SEARCH_BUSY','搜索稍忙，请等待几秒后再点击搜索。');
  try{
    let results=[];
    // AMap is the primary Chinese address source when configured. Calling it
    // first also avoids spending the request budget on an empty Photon result.
    if(env.AMAP_KEY){
      const amap=new URL('https://restapi.amap.com/v3/geocode/geo');
      amap.search=new URLSearchParams({address:query,city:'重庆',output:'JSON',key:String(env.AMAP_KEY)}).toString();
      const {data}=await fetchJson(fetcher,amap.href,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000),redirect:'manual'},'amap');
      if(data)results=normalizeAmap(data);
    }
    const url=new URL('https://photon.komoot.io/api/');
    url.search=new URLSearchParams({q:upstreamQuery,limit:'20',lang:'zh',bbox:'105.2,28.1,110.3,32.3'}).toString();
    if(!results.length){
      const {data}=await fetchJson(fetcher,url.href,{headers:{Accept:'application/json','User-Agent':'ClaudiaCatMap/1.0 (+https://github.com/icewindwillow/Claudia)'},signal:AbortSignal.timeout(10000),redirect:'manual'},'photon');
      if(data)results=normalizeResults(data);
    }
    // Photon sometimes misses Chinese street addresses when the city suffix is added.
    if(!results.length&&upstreamQuery!==query){
      url.search=new URLSearchParams({q:query,limit:'20',lang:'zh',bbox:'105.2,28.1,110.3,32.3'}).toString();
      const {data}=await fetchJson(fetcher,url.href,{headers:{Accept:'application/json','User-Agent':'ClaudiaCatMap/1.0'},signal:AbortSignal.timeout(10000),redirect:'manual'},'photon-retry');
      if(data)results=normalizeResults(data);
    }
    if(!results.length){
      const nom=new URL('https://nominatim.openstreetmap.org/search');
      nom.search=new URLSearchParams({q:query+' 重庆',format:'jsonv2',limit:'10',countrycodes:'cn',viewbox:'105.2,32.3,110.3,28.1',bounded:'1','accept-language':'zh-CN'}).toString();
      const {data}=await fetchJson(fetcher,nom.href,{headers:{Accept:'application/json','User-Agent':'ClaudiaCatMap/1.0 (+https://github.com/icewindwillow/Claudia)'},signal:AbortSignal.timeout(10000),redirect:'manual'},'nominatim');
      if(data)results=normalizeNominatim(data);
    }
    await db.prepare("INSERT INTO place_search_cache (query,results,fetched_at) VALUES (?,?,CAST(strftime('%s','now') AS INTEGER)) ON CONFLICT(query) DO UPDATE SET results=excluded.results,fetched_at=excluded.fetched_at").bind(key,JSON.stringify(results)).run();
    return {query,upstreamQuery,results,cached:false};
  }finally{await db.prepare("UPDATE place_search_gate SET next_at=CAST(strftime('%s','now') AS INTEGER)+2 WHERE id=1 AND owner=?").bind(owner).run();}
}
