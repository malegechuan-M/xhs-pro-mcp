import { mkdirSync, writeFileSync } from 'fs';
import { resolve, extname } from 'path';
import { config } from '../config/index.js';
import { getContext } from '../browser/launcher.js';
import { wait, gaussian } from '../browser/human.js';

export interface DownloadResult {
  url: string;
  localPath: string;
  fileName: string;
  size: number;
  success: boolean;
  error?: string;
}

export interface NoteFileMeta {
  title: string;
  noteId: string;
  imageCategory: '封面' | '详情' | '头像';
  likeCount: number;
  keyword?: string;
}

// ── File naming ───────────────────────────────────────────────────────────────

/** Sanitise a string for use in a file name */
function sanitise(s: string): string {
  return s
    .replace(/[/\\:*?"<>|]/g, '')   // forbidden chars on most OSes
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);                   // keep names manageable
}

/**
 * Build file name with note metadata.
 *
 * When keyword is present (keyword search):
 *   {关键词}_{标题}_{笔记ID}_封面_点赞数{likeCount}_{index:03d}.{ext}
 *
 * Otherwise:
 *   {标题}_{笔记ID}_{封面/详情/头像}_点赞数{likeCount}_{index:03d}.{ext}
 *
 * Falls back to the CDN filename when no metadata is provided.
 */
function buildFileName(url: string, meta?: NoteFileMeta, index?: number): string {
  const ext = guessExt(url);

  if (meta) {
    const title    = sanitise(meta.title) || '无标题';
    const idx      = String((index ?? 0) + 1).padStart(3, '0');
    if (meta.keyword) {
      const kw = sanitise(meta.keyword);
      return `${kw}_${title}_${meta.noteId}_封面_点赞数${meta.likeCount}_${idx}${ext}`;
    }
    return `${title}_${meta.noteId}_${meta.imageCategory}_点赞数${meta.likeCount}_${idx}${ext}`;
  }

  // Fallback: use the last segment of the CDN path
  const base = url.split('?')[0];
  const raw  = base.split('/').pop() || `file_${Date.now()}`;
  const name = raw.replace(extname(raw), '');
  return `${name}${ext}`;
}

function guessExt(url: string): string {
  const clean = url.split('?')[0];
  if (clean.endsWith('.mp4') || url.includes('video')) return '.mp4';
  if (clean.endsWith('.gif')) return '.gif';
  if (clean.endsWith('.png') && !url.includes('webp')) return '.png';
  // XHS CDN serves webp by default — we request jpg format, so always use .jpg
  return '.jpg';
}

/** Convert XHS CDN image URL to request jpg format instead of webp */
function toJpgUrl(url: string): string {
  // Replace format/webp with format/jpg in imageView2 params
  let out = url.replace(/format\/webp/gi, 'format/jpg');
  // If URL still has no format param but looks like an XHS CDN image, append one
  if (out === url && /xhscdn\.com/i.test(url) && !url.includes('format/')) {
    const sep = url.includes('?') ? '|' : '?';
    out = url + sep + 'imageView2/2/format/jpg';
  }
  return out;
}

// ── Core download (uses browser context for XHS CDN auth) ────────────────────

export async function downloadFile(
  url: string,
  subDir = '',
  customName?: string,
  outputDir?: string,
): Promise<DownloadResult> {
  const dir = outputDir
    ? (subDir ? resolve(outputDir, subDir) : outputDir)
    : (subDir ? resolve(config.downloadsDir, subDir) : config.downloadsDir);
  mkdirSync(dir, { recursive: true });

  const fileName  = customName ?? buildFileName(url);
  const localPath = resolve(dir, fileName);

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const ctx = await getContext(true);
      const downloadUrl = guessExt(url) === '.jpg' ? toJpgUrl(url) : url;
      const res = await ctx.request.get(downloadUrl, {
        headers: {
          Referer:  'https://www.xiaohongshu.com/',
          Accept:   'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
          'User-Agent': config.userAgent,
        },
        timeout: 30000,
      });

      // Retry on 429 / 5xx with exponential backoff
      if (res.status() === 429 || res.status() >= 500) {
        if (attempt < maxRetries - 1) {
          const backoff = Math.pow(2, attempt) * 1000 + gaussian(500, 200);
          await wait(backoff);
          continue;
        }
      }

      if (!res.ok()) throw new Error(`HTTP ${res.status()}: ${res.statusText()}`);

      const body = await res.body();
      writeFileSync(localPath, body);
      return { url, localPath, fileName, size: body.length, success: true };
    } catch (err) {
      if (attempt < maxRetries - 1) {
        const backoff = Math.pow(2, attempt) * 1000 + gaussian(500, 200);
        await wait(backoff);
        continue;
      }
      return {
        url, localPath, fileName, size: 0, success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { url, localPath, fileName, size: 0, success: false, error: 'Max retries exceeded' };
}

/**
 * Download a list of URLs concurrently.
 * When `meta` is provided every file is named with the note naming convention.
 */
export async function downloadAll(
  urls: string[],
  subDir = '',
  concurrency = 3,
  meta?: NoteFileMeta,
  outputDir?: string,
): Promise<DownloadResult[]> {
  const results: DownloadResult[] = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((url, batchIdx) => {
        const globalIdx = i + batchIdx;
        const name = buildFileName(url, meta, globalIdx);
        return downloadFile(url, subDir, name, outputDir);
      }),
    );
    results.push(...batchResults);
    if (i + concurrency < urls.length) {
      await wait(gaussian(800, 250));
    }
  }

  return results;
}
