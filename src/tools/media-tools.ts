import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { downloadFile, downloadAll } from '../media/downloader.js';
import { formatBytes } from '../media/file-manager.js';

export function registerMediaTools(server: McpServer): void {
  // ── download_images ──────────────────────────────────────────────────────────
  server.tool(
    'xhs_download_images',
    'Download images from XiaoHongShu note to local storage.',
    {
      imageUrls: z.array(z.string()).describe('List of image URLs'),
      noteId: z.string().optional().describe('Note ID — used as sub-directory name'),
      noteTitle: z.string().optional().describe('Note title — used in file naming'),
    },
    async ({ imageUrls, noteId = '', noteTitle = '' }) => {
      if (imageUrls.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No URLs provided.' }] };
      }

      const subDir = noteId || undefined;
      const results = await downloadAll(imageUrls, subDir);

      const ok = results.filter((r) => r.success);
      const fail = results.filter((r) => !r.success);

      const lines = [
        `**图片下载**: ${ok.length}/${imageUrls.length} 成功`,
        ...(noteId ? [`**目录**: ~/.xhs-pro-mcp/downloads/${noteId}/`] : []),
        '',
        ...ok.map((r) => `✅ ${r.fileName} (${formatBytes(r.size)})`),
        ...fail.map((r) => `❌ ${r.fileName}: ${r.error}`),
      ];
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  // ── download_video ───────────────────────────────────────────────────────────
  server.tool(
    'xhs_download_video',
    'Download a video from a XiaoHongShu note to local storage.',
    {
      videoUrl: z.string().describe('Video URL'),
      noteId: z.string().optional().describe('Note ID — used as sub-directory name'),
    },
    async ({ videoUrl, noteId = '' }) => {
      const subDir = noteId || undefined;
      const result = await downloadFile(videoUrl, subDir);
      if (result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: `✅ 视频下载成功: ${result.fileName} (${formatBytes(result.size)})\n路径: ${result.localPath}`,
          }],
        };
      }
      return {
        content: [{ type: 'text' as const, text: `❌ 视频下载失败: ${result.error}` }],
      };
    },
  );
}
