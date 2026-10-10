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
export async function searchPlaces(env,body,{fetcher=fetch}={}){
  const {query,upstreamQuery}=searchQuery(body?.query),db=dbOf(env);
  // Explicit authenticated searches only; never forward tokens, emails or story data.
  await db.prepare('CREATE TABLE IF NOT EXISTS place_search_cache (query TEXT PRIMARY KEY, results TEXT NOT NULL, fetched_at INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS place_search_gate (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, next_at INTEGER NOT NULL)').run();
  const key='photon-cq-v1:'+upstreamQuery.toLowerCase();
  const cached=await db.prepare("SELECT results FROM place_search_cache WHERE query=? AND fetched_at>CAST(strftime('%s','now') AS INTEGER)-604800").bind(key).first();
  if(cached)return {query,upstreamQuery,results:JSON.parse(cached.results),cached:true};
  const owner=crypto.randomUUID();
  const lease=await db.prepare("INSERT INTO place_search_gate (id,owner,next_at) VALUES (1,?,CAST(strftime('%s','now') AS INTEGER)+30) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,next_at=excluded.next_at WHERE place_search_gate.next_at<=CAST(strftime('%s','now') AS INTEGER) RETURNING id").bind(owner).first();
  if(!lease)throw new HttpError(429,'SEARCH_BUSY','搜索稍忙，请等待几秒后再点击搜索。');
  try{
    const url=new URL('https://photon.komoot.io/api/');url.search=new URLSearchParams({q:upstreamQuery,limit:'20',lang:'zh',bbox:'105.2,28.1,110.3,32.3'}).toString();
    let response;
    try{response=await fetcher(url.href,{headers:{Accept:'application/json','User-Agent':'ClaudiaCatMap/1.0 (+https://github.com/icewindwillow/Claudia)'},signal:AbortSignal.timeout(12000),redirect:'manual'});}catch{throw new HttpError(502,'SEARCH_UNAVAILABLE','地名服务暂时无法连接，输入已保留。请稍后重试，或用地图选点。');}
    if(!response.ok)throw new HttpError(response.status===429?429:502,'SEARCH_UNAVAILABLE','地名服务暂时繁忙，请稍后重试。');
    let data;try{data=await response.json();}catch{throw new HttpError(502,'SEARCH_BAD_RESPONSE','地名服务没有返回有效结果，请稍后重试。');}
    let results=normalizeResults(data);
    // Photon sometimes misses Chinese street addresses when the city suffix is added.
    if(!results.length&&upstreamQuery!==query){url.search=new URLSearchParams({q:query,limit:'20',lang:'zh',bbox:'105.2,28.1,110.3,32.3'}).toString();const retry=await fetcher(url.href,{headers:{Accept:'application/json','User-Agent':'ClaudiaCatMap/1.0'},signal:AbortSignal.timeout(12000),redirect:'manual'});if(retry.ok)results=normalizeResults(await retry.json());}
    if(!results.length){const nom=new URL('https://nominatim.openstreetmap.org/search');nom.search=new URLSearchParams({q:query+' 重庆',format:'jsonv2',limit:'10',countrycodes:'cn',viewbox:'105.2,32.3,110.3,28.1',bounded:'1','accept-language':'zh-CN'}).toString();try{const retry=await fetcher(nom.href,{headers:{Accept:'application/json','User-Agent':'ClaudiaCatMap/1.0 (+https://github.com/icewindwillow/Claudia)'},signal:AbortSignal.timeout(12000),redirect:'manual'});if(retry.ok)results=normalizeNominatim(await retry.json());}catch{}}
    await db.prepare("INSERT INTO place_search_cache (query,results,fetched_at) VALUES (?,?,CAST(strftime('%s','now') AS INTEGER)) ON CONFLICT(query) DO UPDATE SET results=excluded.results,fetched_at=excluded.fetched_at").bind(key,JSON.stringify(results)).run();
    return {query,upstreamQuery,results,cached:false};
  }finally{await db.prepare("UPDATE place_search_gate SET next_at=CAST(strftime('%s','now') AS INTEGER)+2 WHERE id=1 AND owner=?").bind(owner).run();}
}
