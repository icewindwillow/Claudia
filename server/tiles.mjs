import {HttpError, json, errorResponse} from './http.mjs';
const TILE_ORIGIN = 'https://tile.openstreetmap.org';
const CONTACT = 'https://github.com/icewindwillow/Claudia/';
export const STREET_CONFIG = {
  provider: 'osm-standard', tileTemplate: '/api/tiles/{z}/{x}/{y}.png',
  minZoom: 4, maxZoom: 19, bounds: [105.2, 28.1, 110.3, 32.3],
  attribution: '© OpenStreetMap contributors', attributionUrl: 'https://www.openstreetmap.org/copyright'
};
const latitude = (tileY, n) => Math.atan(Math.sinh(Math.PI*(1 - 2*tileY/n)))*180/Math.PI;
export function validateTilePath(path) {
  const m = /^(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.png$/.exec(path);
  if (!m) throw new HttpError(400, 'INVALID_TILE', '地图瓦片地址不正确。');
  const [z,x,y] = m.slice(1).map(Number), n = 2**z;
  if (z < 4 || z > 19 || x<0 || y<0 || x>=n || y>=n) throw new HttpError(400, 'INVALID_TILE', '地图缩放等级或坐标超出范围。');
  const west=x/n*360-180, east=(x+1)/n*360-180, north=latitude(y,n), south=latitude(y+1,n);
  const b=STREET_CONFIG.bounds;
  if (east<b[0] || west>b[2] || north<b[1] || south>b[3]) throw new HttpError(404, 'OUTSIDE_MAP', '这里只提供重庆区域地图。');
  return {z,x,y,path:`${z}/${x}/${y}.png`};
}
function cacheHeaders(upstream) {
  const headers = new Headers({'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
  for (const key of ['Cache-Control','ETag','Last-Modified','Expires','Age']) if(upstream.headers.has(key)) headers.set(key, upstream.headers.get(key));
  if (!headers.has('Cache-Control')) {
    const expires=Date.parse(headers.get('Expires')||'');
    headers.set('Cache-Control',`public, max-age=${Number.isFinite(expires)?Math.max(0,Math.floor((expires-Date.now())/1000)):604800}`);
  }
  return headers;
}
function clientResponse(response, request) {
  const etag = response.headers.get('ETag');
  if (etag && request.headers.get('If-None-Match')?.split(',').map(s=>s.trim()).includes(etag))
    return new Response(null,{status:304,headers:response.headers});
  return response;
}
/** Fixed Chongqing tile gateway: no URL parameter, no arbitrary upstream, no API keys in the browser. */
export async function serveTile(context, {fetcher=fetch, cache=globalThis.caches?.default}={}) {
  const {request}=context;
  try {
    if(request.method!=='GET') throw new HttpError(405,'METHOD_NOT_ALLOWED','只支持 GET。');
    const url=new URL(request.url);
    if(url.search) throw new HttpError(400,'TILE_QUERY_REJECTED','地图瓦片不接受查询参数。');
    const tile=validateTilePath(url.pathname.replace(/^\/api\/tiles\//,''));
    let referer;try{referer=new URL(request.headers.get('Referer')||'');}catch{throw new HttpError(403,'MAP_REFERER_REQUIRED','请从本站地图页面加载街道。');}
    if(referer.origin!==url.origin || request.headers.get('Sec-Fetch-Site')==='cross-site')
      throw new HttpError(403,'MAP_ORIGIN_REJECTED','地图接口仅供本站使用。');
    // Both website hosts share a cache key. Never include browser no-cache or user query strings.
    const cacheKey=new Request(`${CONTACT}api/tiles/${tile.path}`);
    if(cache){const hit=await cache.match(cacheKey);if(hit)return clientResponse(hit,request);}
    const upstreamHeaders={
      'User-Agent':`ClaudiaCatMap/1.0 (+${CONTACT}; source: https://github.com/icewindwillow/Claudia)`,
      // Preserve a real, nonblank site referer without sending private query strings.
      'Referer':`${referer.origin}/`, 'Accept':'image/png'
    };
    for(const h of ['If-None-Match','If-Modified-Since'])if(request.headers.has(h))upstreamHeaders[h]=request.headers.get(h);
    let upstream;
    // Do not follow redirects away from the fixed tile origin; reject 3xx below.
    try { upstream=await fetcher(`${TILE_ORIGIN}/${tile.path}`,{headers:upstreamHeaders,signal:AbortSignal.timeout(12000),redirect:'manual'}); }
    catch(e){throw new HttpError(e.name==='TimeoutError'?504:502,'MAP_UPSTREAM_UNREACHABLE','网站暂时无法连接街道图源。可保留手账总览，稍后重试。');}
    if(upstream.status===304)return new Response(null,{status:304,headers:cacheHeaders(upstream)});
    if(!upstream.ok){
      const code=upstream.status===429?'MAP_RATE_LIMITED':`MAP_UPSTREAM_${upstream.status}`;
      const status=upstream.status===429?429:502;
      return json({ok:false,code,message:upstream.status===429?'街道图源暂时限流，请稍后重试。':'街道图源暂时没有返回地图图片。'},status,{'Retry-After':upstream.headers.get('Retry-After')||'60'});
    }
    if(!/^image\/png(?:\s*;|$)/i.test(upstream.headers.get('Content-Type')||''))
      throw new HttpError(502,'MAP_BAD_RESPONSE','街道图源返回的不是 PNG 地图图片。');
    const bytes=await upstream.arrayBuffer();
    const signature=new Uint8Array(bytes,0,Math.min(8,bytes.byteLength));
    if(bytes.byteLength>1024*1024 || signature.length<8 || [137,80,78,71,13,10,26,10].some((n,i)=>signature[i]!==n))
      throw new HttpError(502,'MAP_BAD_IMAGE','地图图片数据无效。');
    const response=new Response(bytes,{headers:cacheHeaders(upstream)});
    if(cache && !/no-store|private/i.test(response.headers.get('Cache-Control')||''))
      context.waitUntil?.(cache.put(cacheKey,response.clone()).catch(()=>{}));
    return clientResponse(response,request);
  }catch(error){return errorResponse(error);}
}
