import {HttpError} from './http.mjs';
export const RECORD_ID = 'fountains-abbey';
export function dbOf(env) {
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new HttpError(503, 'DATABASE_NOT_BOUND', '尚未绑定 D1 数据库（绑定名必须为 DB）。');
  return env.DB;
}
async function dbRead(fn) {
  try { return await fn(); }
  catch (e) { if (/no such table|no such column/i.test(e.message || '')) throw new HttpError(503, 'DATABASE_NOT_INITIALIZED', '数据库尚未初始化，请执行 migrations/0001_reviews.sql。'); throw e; }
}
function review(row, prefix) { return {author: row[`${prefix}_author`], rating: row[`${prefix}_half_stars`] == null ? null : row[`${prefix}_half_stars`]/2, comment: row[`${prefix}_comment`]}; }
export function publicRecord(row) { return {id: row.id, review: review(row, 'published'), publishedAt: row.published_at, revision: row.published_revision}; }
function privateRecord(row) { return {...publicRecord(row), revision: row.revision, hasDraft: !!row.has_draft, draft: row.has_draft ? review(row, 'draft') : null, updatedAt: row.updated_at}; }
export async function getPublicReviews(env) {
  const result = await dbRead(() => dbOf(env).prepare('SELECT id,published_author,published_half_stars,published_comment,published_at,published_revision FROM author_reviews').all());
  return result.results.map(publicRecord);
}
export async function getAuthorRecord(env) {
  const row = await dbRead(() => dbOf(env).prepare('SELECT * FROM author_reviews WHERE id = ?').bind(RECORD_ID).first());
  if (!row) return {id:RECORD_ID,review:{author:'竹喵',rating:null,comment:''},revision:0,hasDraft:false,draft:null};
  return privateRecord(row);
}
export function validateMutation(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.id !== RECORD_ID)
    throw new HttpError(400, 'BAD_RECORD', '这一版只编辑现有的流水修道院记录。');
  if (!['draft', 'publish', 'discard-draft'].includes(data.action) || !Number.isSafeInteger(data.revision) || data.revision < 1)
    throw new HttpError(400, 'BAD_ACTION', '提交动作或版本号不正确。');
  if (data.action === 'discard-draft') return {id: data.id, action: data.action, revision: data.revision};
  const r = data.review;
  if (!r || typeof r.author !== 'string' || r.author.length > 80 || typeof r.comment !== 'string' || r.comment.length > 10000)
    throw new HttpError(400, 'BAD_REVIEW', '署名最多 80 字，评价最多 10000 字。');
  if (r.rating !== null && (typeof r.rating !== 'number' || !Number.isFinite(r.rating) || r.rating < 0 || r.rating > 5 || !Number.isInteger(r.rating*2)))
    throw new HttpError(400, 'BAD_RATING', '评分必须为 0～5 星、每次半星；未评分请使用 null。');
  return {...data, review: {author: r.author.trim(), rating: r.rating, comment: r.comment}, half: r.rating === null ? null : r.rating*2};
}
export async function mutateReview(env, body, author) {
  const data = validateMutation(body), db = dbOf(env), now = new Date().toISOString();
  const tail = ' WHERE id = ? AND revision = ? RETURNING *';
  let sql, values;
  if (data.action === 'draft') {
    sql = 'UPDATE author_reviews SET draft_author=?,draft_half_stars=?,draft_comment=?,has_draft=1,revision=revision+1,updated_at=?,updated_by=?' + tail;
    values = [data.review.author, data.half, data.review.comment, now, author.email, RECORD_ID, data.revision];
  } else if (data.action === 'publish') {
    sql = 'UPDATE author_reviews SET published_author=?,published_half_stars=?,published_comment=?,published_at=?,published_revision=revision+1,draft_author=NULL,draft_half_stars=NULL,draft_comment=NULL,has_draft=0,revision=revision+1,updated_at=?,updated_by=?' + tail;
    values = [data.review.author, data.half, data.review.comment, now, now, author.email, RECORD_ID, data.revision];
  } else {
    sql = 'UPDATE author_reviews SET draft_author=NULL,draft_half_stars=NULL,draft_comment=NULL,has_draft=0,revision=revision+1,updated_at=?,updated_by=?' + tail;
    values = [now, author.email, RECORD_ID, data.revision];
  }
  const row = await dbRead(() => db.prepare(sql).bind(...values).first());
  if (!row) throw new HttpError(409, 'REVISION_CONFLICT', '另一台设备已更新这条记录。你的输入已保留，请先备份文字，再读取云端最新版。');
  return privateRecord(row);
}
