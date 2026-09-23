import {normalizeCategory} from '../public/assets/categories.v0.8.js';
import {HttpError, SECURITY_HEADERS} from './http.mjs';
import {dbOf} from './reviews.mjs';

// Additive schema: the original reviews and bundled stories are never deleted.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS map_places (id TEXT PRIMARY KEY, published TEXT, draft TEXT, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS map_photos (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL)`
];
async function ensure(db) { for (const sql of SCHEMA) await db.prepare(sql).run(); }
const missing = e => /no such table: (?:main\.)?map_(places|photos)/i.test(e.message || '');
export async function listPlaces(env, privateView = false) {
  try {
    const {results} = await dbOf(env).prepare(privateView ? 'SELECT * FROM map_places ORDER BY id' : 'SELECT published FROM map_places WHERE published IS NOT NULL ORDER BY id').all();
    return results.map(row => privateView ? record(row) : normalizeCategory(JSON.parse(row.published)));
  } catch (e) { if (missing(e)) return []; throw e; }
}
function record(row) { return {id:row.id, published:row.published ? normalizeCategory(JSON.parse(row.published)) : null, draft:row.draft ? normalizeCategory(JSON.parse(row.draft)) : null, revision:row.revision, updatedAt:row.updated_at}; }
const bad = message => { throw new HttpError(400, 'BAD_PLACE', message); };
const idOK = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id);
export const photoID = src => typeof src === 'string' && /^\/api\/photos\/([a-f0-9-]{36})$/.exec(src)?.[1];
const asset = src => typeof src === 'string' && /^(?:\.\/|\/)assets\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp|avif)$/i.test(src) && !src.includes('..');
export function validatePlace(input, id) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.id !== id || !idOK(id)) bad('地点标识不正确。');
  const out = {id, placeId:id};
  for (const [key,max] of Object.entries({place:160,placeEn:160,title:160,description:10000,officialIntroduction:10000,officialSource:2000,city:120,date:10,region:24,category:80,locationLabel:200,locationPrecision:200})) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > max) bad(`${key} 内容过长或格式不正确。`);
    out[key] = value.trim();
  }
  if(out.officialSource){let url;try{url=new URL(out.officialSource);}catch{bad('官方来源须为有效 HTTPS 链接。');}if(url.protocol!=='https:'||url.username||url.password)bad('官方来源须为 HTTPS 链接。');}
  if (!out.place) bad('请填写地点名称。');
  out.title ||= out.place;
  if (!['england','scotland','wales','northernIreland'].includes(out.region)) bad('请选择所属地区。');
  if (out.date && (!/^\d{4}-\d{2}-\d{2}$/.test(out.date) || !Number.isFinite(Date.parse(out.date)) || new Date(out.date).toISOString().slice(0,10) !== out.date)) bad('旅行日期不正确。');
  const c = input.coordinates;
  if (input.visitDates != null) {
    if (!Array.isArray(input.visitDates) || input.visitDates.length > 100 || !input.visitDates.every(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d)) bad('其他到访日期请使用 YYYY-MM-DD，用逗号分隔。');
    out.visitDates = [...new Set([out.date, ...input.visitDates].filter(Boolean))].sort();
  }
  if (!Array.isArray(c) || c.length !== 2 || !c.every(Number.isFinite) || c[0] < -15 || c[0] > 12 || c[1] < 46 || c[1] > 65) bad('请在英国及周边地图范围内选择坐标（经度 -15～12，纬度 46～65）。');
  out.coordinates = [...c];
  const r = input.review;
  if (!r || typeof r.author !== 'string' || r.author.length > 80 || typeof r.comment !== 'string' || r.comment.length > 10000 || !(r.rating === null || (typeof r.rating === 'number' && Number.isFinite(r.rating) && r.rating >= 0 && r.rating <= 5 && Number.isInteger(r.rating*2)))) bad('署名、评价或半星评分格式不正确。');
  out.review = {author:r.author.trim(),rating:r.rating,comment:r.comment};
  if (!Array.isArray(input.photos) || input.photos.length > 15) bad('每个地点最多 15 张照片。');
  out.photos = input.photos.map(p => {
    if (!p || !(asset(p.src) || photoID(p.src))) bad('照片必须来自本站相册。');
    const result = {src:p.src};
    for (const key of ['alt','caption']) { if (p[key] != null && (typeof p[key] !== 'string' || p[key].length > 500)) bad('照片说明最多 500 字。'); result[key] = p[key] || ''; }
    if (p.thumbnail && asset(p.thumbnail)) result.thumbnail = p.thumbnail;
    for (const key of ['width','height']) if (Number.isInteger(p[key]) && p[key] > 0 && p[key] <= 30000) result[key] = p[key];
    return result;
  });
  if (input.aliases != null) { if (!Array.isArray(input.aliases) || input.aliases.length > 30 || !input.aliases.every(v=>typeof v==='string' && v.length<=160)) bad('地点别名格式不正确。'); out.aliases = input.aliases; }
  // Preserve provenance of bundled locations as data, never executable markup.
  if (input.coordinateSource && typeof input.coordinateSource === 'object') {
    out.coordinateSource = {};
    for (const key of ['name','url','mapUrl']) if (typeof input.coordinateSource[key] === 'string' && input.coordinateSource[key].length <= 2000) out.coordinateSource[key] = input.coordinateSource[key];
  }
  return normalizeCategory(out);
}
export async function mutatePlace(env, body, author) {
  if (!body || !idOK(body.id) || !Number.isSafeInteger(body.revision) || body.revision < 0 || !['draft','publish','discard-draft'].includes(body.action)) bad('提交动作或版本号不正确。');
  const place = body.action === 'discard-draft' ? null : validatePlace(body.place, body.id);
  const db = dbOf(env); await ensure(db);
  for (const p of place?.photos || []) if (photoID(p.src) && !await db.prepare('SELECT id FROM map_photos WHERE id=?').bind(photoID(p.src)).first()) bad('照片上传尚未完成，请重试。');
  const payload = place ? JSON.stringify(place) : null, now = new Date().toISOString();
  let row;
  if (body.revision === 0 && place) {
    row = await db.prepare('INSERT INTO map_places (id,published,draft,revision,updated_at,updated_by) VALUES (?,?,?,1,?,?) ON CONFLICT(id) DO NOTHING RETURNING *').bind(body.id,body.action==='publish'?payload:null,body.action==='draft'?payload:null,now,author.email).first();
  } else {
    const change = body.action==='publish' ? 'published=?,draft=NULL' : 'draft=?';
    row = await db.prepare(`UPDATE map_places SET ${change},revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=? RETURNING *`).bind(payload,now,author.email,body.id,body.revision).first();
  }
  if (!row) throw new HttpError(409,'REVISION_CONFLICT','另一位作者已更新此地点。输入已保留，请先备份，再读取云端最新版。');
  return record(row);
}
export async function uploadPhoto(env, body) {
  if (!body || typeof body.data !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(body.data)) bad('请上传 JPEG 照片。');
  let raw; try { raw = atob(body.data.split(',')[1]); } catch { bad('图片编码错误。'); }
  if (raw.length > 200*1024 || raw.length < 4 || raw.charCodeAt(0)!==255 || raw.charCodeAt(1)!==216 || raw.charCodeAt(2)!==255) bad('照片须为 200 KB 以内的 JPEG，页面会自动压缩。');
  const db = dbOf(env); await ensure(db);
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO map_photos (id,data,created_at) VALUES (?,?,?)').bind(id,body.data.split(',')[1],new Date().toISOString()).run();
  return {src:`/api/photos/${id}`};
}
export async function readPhoto(env, id, privateView = false) {
  if (!photoID(`/api/photos/${id}`)) throw new HttpError(404,'NOT_FOUND','照片不存在。');
  try {
    const db = dbOf(env);
    if (!privateView && !await db.prepare("SELECT 1 FROM map_places,json_each(map_places.published,'$.photos') AS photo WHERE json_extract(photo.value,'$.src')=? LIMIT 1").bind(`/api/photos/${id}`).first()) throw new HttpError(404,'NOT_FOUND','照片尚未发布。');
    const row = await db.prepare('SELECT data FROM map_photos WHERE id=?').bind(id).first();
    if (!row) throw new HttpError(404,'NOT_FOUND','照片不存在。');
    return new Response(Uint8Array.from(atob(row.data),c=>c.charCodeAt(0)),{headers:{...SECURITY_HEADERS,'Content-Type':'image/jpeg','Cache-Control':'no-store','Cloudflare-CDN-Cache-Control':'no-store'}});
  } catch (e) { if (missing(e)) throw new HttpError(404,'NOT_FOUND','照片不存在。'); throw e; }
}
