/**
 * Feishu syncer — routes each data type to its own table.
 * All field names are read from config/feishu.json via f().
 */

import { feishuClient } from './client.js';
import { f, tableId, appToken } from './tables.js';
import type { NoteData, SearchResult, BloggerInfo, BloggerNote } from '../engines/dom/capturer.js';

export interface SyncResult {
  success: boolean;
  recordId?: string;
  error?: string;
  action: 'created' | 'updated' | 'skipped';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAppToken(): string {
  const t = appToken();
  if (!t) throw new Error('Feishu appToken not configured');
  return t;
}

function getTableId(name: Parameters<typeof tableId>[0]): string {
  const id = tableId(name);
  if (!id) throw new Error(`Feishu table "${name}" not configured`);
  return id;
}

/** Convert ISO date string to Unix seconds (for Feishu Number date fields, matches plugin convention) */
function toUnixSec(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const ms = new Date(date).getTime();
  return isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

/** Build fields object, skipping any key whose mapped name is empty string */
function buildFields(pairs: [string, unknown][]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of pairs) {
    if (key) out[key] = val;
  }
  return out;
}

async function upsertRecord(
  baseId: string,
  tId: string,
  dedupeField: string,
  dedupeValue: string,
  fields: Record<string, unknown>,
): Promise<SyncResult> {
  try {
    const existing = await feishuClient.listRecords(
      baseId, tId,
      `CurrentValue.[${dedupeField}] = "${dedupeValue}"`,
    ) as { record_id: string }[];

    if (existing.length > 0) {
      await feishuClient.updateRecord(baseId, tId, existing[0].record_id, fields);
      return { success: true, recordId: existing[0].record_id, action: 'updated' };
    } else {
      const res = await feishuClient.createRecord(baseId, tId, fields) as { record: { record_id: string } };
      return { success: true, recordId: res.record.record_id, action: 'created' };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err), action: 'skipped' };
  }
}

/** Batch create, max 500 per call, 500ms gap between chunks */
async function batchCreate(
  baseId: string,
  tId: string,
  records: { fields: Record<string, unknown> }[],
): Promise<SyncResult[]> {
  const CHUNK = 500;
  const results: SyncResult[] = [];
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    try {
      await feishuClient.batchCreateRecords(baseId, tId, chunk);
      chunk.forEach(() => results.push({ success: true, action: 'created' }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      chunk.forEach(() => results.push({ success: false, error: msg, action: 'skipped' }));
    }
    if (i + CHUNK < records.length) await new Promise((r) => setTimeout(r, 500));
  }
  return results;
}

// ── 采集库 ────────────────────────────────────────────────────────────────────

export async function syncNoteToFeishu(note: NoteData): Promise<SyncResult> {
  const base = getAppToken();
  const tId = getTableId('采集库');
  const fields = buildFields([
    [f('采集库', 'noteId'),       note.noteId],
    [f('采集库', 'url'),          note.url],
    [f('采集库', 'title'),        note.title],
    [f('采集库', 'content'),      note.content],
    [f('采集库', 'author'),       note.author],
    [f('采集库', 'authorUrl'),    note.authorUrl],
    [f('采集库', 'likeCount'),    note.likeCount],
    [f('采集库', 'collectCount'), note.collectCount],
    [f('采集库', 'commentCount'), note.commentCount],
    [f('采集库', 'tags'),         note.tags.join(', ')],
    [f('采集库', 'noteType'),     note.noteType],
    [f('采集库', 'imageCount'),   note.images.length],
    [f('采集库', 'videoUrl'),     note.videoUrl],
    [f('采集库', 'publishTime'),  note.publishTime],
    [f('采集库', 'capturedAt'),   toUnixSec(note.capturedAt)],
  ]);
  // dedup on URL (always present), fall back to noteId field
  const dedupeField = f('采集库', 'url') || f('采集库', 'noteId');
  const dedupeValue = note.url || note.noteId;
  return upsertRecord(base, tId, dedupeField, dedupeValue, fields);
}

export async function batchSyncNotesToFeishu(notes: NoteData[]): Promise<SyncResult[]> {
  const base = getAppToken();
  const tId = getTableId('采集库');
  const records = notes.map((n) => ({
    fields: buildFields([
      [f('采集库', 'noteId'),       n.noteId],
      [f('采集库', 'url'),          n.url],
      [f('采集库', 'title'),        n.title],
      [f('采集库', 'content'),      n.content],
      [f('采集库', 'author'),       n.author],
      [f('采集库', 'authorUrl'),    n.authorUrl],
      [f('采集库', 'likeCount'),    n.likeCount],
      [f('采集库', 'collectCount'), n.collectCount],
      [f('采集库', 'commentCount'), n.commentCount],
      [f('采集库', 'tags'),         n.tags.join(', ')],
      [f('采集库', 'noteType'),     n.noteType],
      [f('采集库', 'imageCount'),   n.images.length],
      [f('采集库', 'videoUrl'),     n.videoUrl],
      [f('采集库', 'publishTime'),  n.publishTime],
      [f('采集库', 'capturedAt'),   toUnixSec(n.capturedAt)],
    ]),
  }));
  return batchCreate(base, tId, records);
}

// ── 关键词战情库 ──────────────────────────────────────────────────────────────

export async function batchSyncSearchResults(results: SearchResult[]): Promise<SyncResult[]> {
  const base = getAppToken();
  const tId = getTableId('关键词战情库');
  const records = results.map((r) => ({
    fields: {
      [f('关键词战情库', 'keyword')]:    r.keyword,
      [f('关键词战情库', 'rank')]:       r.rank,
      [f('关键词战情库', 'noteId')]:     r.noteId,
      [f('关键词战情库', 'url')]:        r.url,
      [f('关键词战情库', 'title')]:      r.title,
      [f('关键词战情库', 'author')]:     r.author,
      [f('关键词战情库', 'likeCount')]:  r.likes,
      [f('关键词战情库', 'noteType')]:   r.noteType,
      [f('关键词战情库', 'coverImage')]: r.coverImage,
      [f('关键词战情库', 'capturedAt')]: toUnixSec(r.capturedAt),
    } as Record<string, unknown>,
  }));
  return batchCreate(base, tId, records);
}

// ── 博主笔记库 ────────────────────────────────────────────────────────────────

export async function batchSyncBloggerNotes(notes: BloggerNote[]): Promise<SyncResult[]> {
  const base = getAppToken();
  const tId = getTableId('博主笔记库');
  const records = notes.map((n) => ({
    fields: buildFields([
      [f('博主笔记库', 'noteId'),     n.noteId],
      [f('博主笔记库', 'url'),        n.url],
      [f('博主笔记库', 'title'),      n.title],
      [f('博主笔记库', 'author'),     n.author],
      [f('博主笔记库', 'likeCount'),  n.likes],
      [f('博主笔记库', 'coverImage'), n.coverImage],
      [f('博主笔记库', 'capturedAt'), n.capturedAt],
    ]),
  }));
  return batchCreate(base, tId, records);
}

// ── 博主库 ────────────────────────────────────────────────────────────────────

export async function syncBloggerInfoToFeishu(info: BloggerInfo): Promise<SyncResult> {
  const base = getAppToken();
  const tId = getTableId('博主库');
  const fields = buildFields([
    [f('博主库', 'bloggerUrl'),     info.bloggerUrl],
    [f('博主库', 'bloggerName'),    info.bloggerName],
    [f('博主库', 'bloggerId'),      info.bloggerId],
    [f('博主库', 'description'),    info.description],
    [f('博主库', 'avatarUrl'),      info.avatarUrl],
    [f('博主库', 'followersCount'), info.followersCount],
    [f('博主库', 'capturedAt'),     toUnixSec(info.capturedAt)],
  ]);
  return upsertRecord(base, tId, f('博主库', 'bloggerUrl'), info.bloggerUrl, fields);
}
