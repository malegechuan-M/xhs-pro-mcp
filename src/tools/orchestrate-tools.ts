/**
 * Orchestration tool — capture_and_sync.
 * One command: capture → download images → sync to Feishu → upload attachments.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { newPage } from '../browser/launcher.js';
import {
  captureNote,
  captureSearchResults,
  captureBloggerNotes,
  captureBloggerInfo,
} from '../engines/dom/capturer.js';
import {
  syncNoteToFeishu,
  batchSyncSearchResults,
  batchSyncBloggerNotes,
  syncBloggerInfoToFeishu,
} from '../feishu/syncer.js';
import { downloadAll, NoteFileMeta } from '../media/downloader.js';
import { feishuClient } from '../feishu/client.js';
import { config } from '../config/index.js';
import { formatBytes } from '../media/file-manager.js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';

export function registerOrchestrateTools(server: McpServer): void {
  server.tool(
    'xhs_capture_and_sync',
    'All-in-one: capture XiaoHongShu content → download images → sync to Feishu → upload attachments.',
    {
      type: z.enum(['keyword', 'blogger', 'blogger_info', 'note']).describe(
        '"keyword" = search by keyword | "blogger" = blogger feed | "blogger_info" = blogger profile card | "note" = single note URL',
      ),
      target: z.string().describe('Keyword string (for type=keyword) or full URL (for others)'),
      limit: z.number().optional().describe('Max items to capture (default: 20 for keyword, 0=all for blogger)'),
      sortMode: z.enum(['comprehensive', 'latest']).optional().describe('Sort mode for keyword search (default: comprehensive)'),
      downloadImages: z.boolean().optional().describe('Download images to local storage (default: true)'),
      syncToFeishu: z.boolean().optional().describe('Sync to Feishu tables (default: true)'),
      uploadAttachments: z.boolean().optional().describe('Upload downloaded images to Feishu attachment fields (default: false)'),
      downloadPath: z.string().optional().describe('Custom directory for downloaded images (absolute path)'),
      keyword: z.string().optional().describe('Keyword tag for notes — auto-set for type=keyword; default "未知" for type=note'),
    },
    async ({
      type,
      target,
      limit,
      sortMode = 'comprehensive',
      downloadImages = true,
      syncToFeishu = true,
      uploadAttachments = false,
      downloadPath,
      keyword,
    }) => {
      const report: string[] = [`## 一站式采集 [${type}]: ${target}\n`];
      const page = await newPage();

      try {
        // ── Step 1: Capture ──────────────────────────────────────────
        let capturedCount = 0;
        let syncResults: { success: boolean }[] = [];
        let downloadedImages: string[] = [];
        let noteId = '';

        if (type === 'keyword') {
          const results = await captureSearchResults(page, target, limit ?? 20, sortMode);
          capturedCount = results.length;
          report.push(`**采集**: 关键词"${target}" → ${results.length} 条结果`);

          if (downloadImages && results.length > 0) {
            let dlOk = 0, dlSize = 0;
            for (const r of results) {
              if (!r.coverImage) continue;
              const meta: NoteFileMeta = { title: r.title, noteId: r.noteId, imageCategory: '封面', likeCount: r.likes, keyword: target };
              const dl = await downloadAll([r.coverImage], target, 1, meta, downloadPath);
              if (dl[0]?.success) { dlOk++; dlSize += dl[0].size; }
            }
            report.push(`**图片下载**: ${dlOk}/${results.length} 封面图 (${formatBytes(dlSize)})`);
          }

          if (syncToFeishu && results.length > 0) {
            syncResults = await batchSyncSearchResults(results);
            const ok = syncResults.filter((r) => r.success).length;
            report.push(`**飞书同步** (关键词战情库): ${ok}/${results.length}`);
          }
        } else if (type === 'blogger') {
          const notes = await captureBloggerNotes(page, target, limit ?? 0);
          capturedCount = notes.length;
          report.push(`**采集**: 博主笔记 → ${notes.length} 篇`);

          if (downloadImages && notes.length > 0) {
            const bloggerIdMatch = target.match(/\/user\/profile\/([a-zA-Z0-9]+)/);
            const subDir = bloggerIdMatch?.[1] ?? 'blogger';
            let dlOk = 0, dlSize = 0;
            for (const n of notes) {
              if (!n.coverImage) continue;
              const meta: NoteFileMeta = { title: n.title, noteId: n.noteId, imageCategory: '封面', likeCount: n.likes };
              const dl = await downloadAll([n.coverImage], subDir, 1, meta, downloadPath);
              if (dl[0]?.success) { dlOk++; dlSize += dl[0].size; }
            }
            report.push(`**图片下载**: ${dlOk}/${notes.length} 封面图 (${formatBytes(dlSize)})`);
          }

          if (syncToFeishu && notes.length > 0) {
            syncResults = await batchSyncBloggerNotes(notes);
            const ok = syncResults.filter((r) => r.success).length;
            report.push(`**飞书同步** (博主笔记库): ${ok}/${notes.length}`);
          }
        } else if (type === 'blogger_info') {
          const info = await captureBloggerInfo(page, target);
          capturedCount = 1;
          report.push(`**采集**: 博主 ${info.bloggerName} (粉丝: ${info.followersCount.toLocaleString()})`);

          if (syncToFeishu) {
            const r = await syncBloggerInfoToFeishu(info);
            report.push(`**飞书同步** (博主库): ${r.action} (${r.success ? r.recordId : r.error})`);
          }
        } else if (type === 'note') {
          const note = await captureNote(page, target);
          capturedCount = 1;
          noteId = note.noteId;
          note.keyword = keyword ?? '未知';
          report.push(`**采集**: ${note.title}`);
          report.push(`  作者: ${note.author} | 赞${note.likeCount} 藏${note.collectCount} 评${note.commentCount}`);
          report.push(`  图片: ${note.images.length} 张 | 类型: ${note.noteType}`);

          // Download images for note type
          if (downloadImages && note.images.length > 0) {
            const meta: NoteFileMeta = { title: note.title, noteId: note.noteId, imageCategory: '详情', likeCount: note.likeCount };
            const dl = await downloadAll(note.images, noteId, 3, meta, downloadPath);
            const ok = dl.filter((d) => d.success);
            downloadedImages = ok.map((d) => d.localPath);
            const totalSize = ok.reduce((s, d) => s + d.size, 0);
            report.push(`**图片下载**: ${ok.length}/${note.images.length} 成功 (${formatBytes(totalSize)})`);
          }

          if (syncToFeishu) {
            const r = await syncNoteToFeishu(note);
            report.push(`**飞书同步** (采集库): ${r.action} (${r.success ? r.recordId : r.error})`);

            // Upload attachments
            if (uploadAttachments && downloadedImages.length > 0 && r.recordId) {
              const tableId = config.feishu.tables['采集库'];
              const appToken = config.feishu.appToken;
              const fieldId = '图片附件';

              if (tableId && appToken) {
                let uploaded = 0;
                for (const imgPath of downloadedImages) {
                  try {
                    const buf = readFileSync(imgPath);
                    const fileName = imgPath.split('/').pop() ?? 'img.jpg';
                    await feishuClient.uploadMedia(appToken, tableId, fieldId, r.recordId, fileName, buf, 'image/jpeg');
                    uploaded++;
                  } catch { /* ignore single upload failure */ }
                }
                report.push(`**飞书附件上传**: ${uploaded}/${downloadedImages.length} 成功`);
              }
            }
          }
        }

        report.push(`\n✅ 完成 | 采集: ${capturedCount} 条`);
      } finally {
        await page.close();
      }

      return { content: [{ type: 'text' as const, text: report.join('\n') }] };
    },
  );
}
