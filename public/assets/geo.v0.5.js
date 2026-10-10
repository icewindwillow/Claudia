/** Pure data and projection utilities. Coordinates always use [longitude, latitude]. */
export const MAP_BOUNDS = [105.2, 28.1, 110.3, 32.3];
export const REGIONS = {chongqing:'重庆'};
export function project([lng, lat]) {
  const y = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
  return [lng, -Math.log(Math.tan(Math.PI/4 + y/2))*180/Math.PI];
}
export function unproject([x, y]) { return [x, (2*Math.atan(Math.exp(-y*Math.PI/180))-Math.PI/2)*180/Math.PI]; }
export function validCoordinates(c) {
  return Array.isArray(c) && c.length===2 && c.every(Number.isFinite) && c[0]>=-180 && c[0]<=180 && c[1]>=-85 && c[1]<=85;
}
export function validateMemories(data, demos=false) {
  if (!data || data.schemaVersion!==1 || !Array.isArray(data.memories)) throw new Error('故事文件格式不正确，需要 schemaVersion: 1 与 memories 数组。');
  const ids = new Set();
  return data.memories.map(m => {
    if (!m || typeof m.id!=='string' || !m.id.trim() || ids.has(m.id) || typeof m.title!=='string' || !m.title.trim()) throw new Error('故事 id 必须唯一，id 和 title 不能为空。');
    ids.add(m.id);
    for (const key of ['place','placeEn','placeId','date','description','region','category','breed','photo','photoAlt','locationPrecision','locationLabel']) {
      if(m[key]!=null && typeof m[key]!=='string') throw new Error(`故事 ${m.id} 的 ${key} 必须是文字。`);
    }
    if(m.coordinates!=null && !validCoordinates(m.coordinates)) throw new Error(`故事 ${m.id} 的坐标格式错误，请使用 [经度, 纬度]。`);
    if(m.region && !Object.hasOwn(REGIONS,m.region)) throw new Error(`故事 ${m.id} 的 region 不正确。`);
    if(m.photo && !safePhotoPath(m.photo)) throw new Error(`故事 ${m.id} 的照片应保存在 ./assets/ 中。`);
    if(m.aliases!=null && (!Array.isArray(m.aliases)||!m.aliases.every(x=>typeof x==='string'))) throw new Error(`故事 ${m.id} 的别名应是文字数组。`);
    if(m.photos!=null){
      if(!Array.isArray(m.photos)) throw new Error(`故事 ${m.id} 的 photos 必须是数组。`);
      for(const p of m.photos){
        if(!p||typeof p!=='object'||!safePhotoPath(p.src)) throw new Error(`故事 ${m.id} 的相册图片地址不正确。`);
        for(const key of ['alt','caption']) if(p[key]!=null && typeof p[key]!=='string') throw new Error(`照片 ${key} 必须是文字。`);
        if(p.thumbnail && !safePhotoPath(p.thumbnail)) throw new Error('缩略图应保存在 ./assets/ 中。');
        for(const key of ['width','height']) if(p[key]!=null && (!Number.isInteger(p[key])||p[key]<=0)) throw new Error('照片尺寸必须为正整数。');
      }
    }
    if(m.review!=null){
      if(typeof m.review!=='object'||Array.isArray(m.review)) throw new Error('作者评价格式错误。');
      for(const key of ['author','comment']) if(m.review[key]!=null&&typeof m.review[key]!=='string') throw new Error(`评价 ${key} 必须是文字。`);
      if(m.review.rating!=null&&!validRating(m.review.rating)) throw new Error('评分必须为 0～5 的数值，步长为 0.5；未评分请用 null。');
    }
    return {...m, demo:!!demos};
  });
}
export function filterMemories(items, region='all', query='') {
  const q=query.trim().toLocaleLowerCase();
  return items.filter(m=>(region==='all'||m.region===region)&&(!q||[m.title,m.place,m.placeEn,m.description,m.category,m.breed,m.city,m.locationLabel,m.review?.comment,...(m.aliases||[]),REGIONS[m.region]].filter(Boolean).join(' ').toLocaleLowerCase().includes(q)));
}
/** Stable greedy clustering in screen pixels. Original coordinates are never altered. */
export function clusterPoints(items, screen, radius=31) {
  const groups=[];
  for(const m of items) {
    if(!m.coordinates) continue;
    const p=screen(m.coordinates);
    let g=groups.find(g=>Math.hypot(g.x-p[0],g.y-p[1])<radius);
    if(g){g.items.push(m);g.x+=(p[0]-g.x)/g.items.length;g.y+=(p[1]-g.y)/g.items.length;}
    else groups.push({x:p[0],y:p[1],items:[m]});
  }
  return groups;
}
export function featurePath(feature) {
  const line=(coords,close=false)=>coords.map((c,i)=>{const p=project(c);return `${i?'L':'M'}${p[0].toFixed(5)},${p[1].toFixed(5)}`;}).join('')+(close?'Z':'');
  const {type,coordinates}=feature.geometry;
  if(type==='Polygon') return coordinates.map(c=>line(c,true)).join('');
  if(type==='MultiPolygon') return coordinates.flatMap(p=>p.map(c=>line(c,true))).join('');
  if(type==='LineString') return line(coordinates);
  return '';
}

/** Do not coerce strings or round an invalid author rating. 0 is a real rating; null is unrated. */
export function validRating(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=5&&Number.isInteger(value*2);}
export function starFills(value){return Array.from({length:5},(_,i)=>validRating(value)?Math.max(0,Math.min(1,value-i)):0);}
export function safePhotoPath(value){
  if(typeof value!=='string')return false;
  if(/^\/api\/photos\/[a-f0-9-]{36}$/.test(value))return true;
  let decoded;try{decoded=decodeURIComponent(value);}catch{return false;}
  return /^\.\/assets\/[a-zA-Z0-9_./-]+\.(png|jpe?g|webp|avif)$/i.test(decoded)&&!decoded.includes('..')&&!decoded.includes('\\');
}
export function photosOf(memory){
  if(Array.isArray(memory.photos))return memory.photos;
  return memory.photo?[{src:memory.photo,alt:memory.photoAlt||`${memory.place||'这只猫咪'}的照片`,caption:''}]:[];
}
/** Explicitly edited records override the bundled first story; existing unrelated records remain intact. */
export function mergeMemories(seed, saved){const byId=new Map(seed.map(m=>[m.id,m]));for(const m of saved)byId.set(m.id,m);return [...byId.values()];}
export function publishableMemories(items){return {schemaVersion:1,memories:items.filter(m=>!m.demo).map(({demo,...m})=>m)};}
