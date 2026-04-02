import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { registerLoginTool } from './tools/login.js';
import { registerCheckStatusTool } from './tools/check-status.js';
import { registerSetupTool } from './tools/setup.js';
import { registerMediaTools } from './tools/media-tools.js';
import { registerFeishuTools } from './tools/feishu-tools.js';
import { registerInteractTools } from './tools/interact-tools.js';
import { registerPublishTools } from './tools/publish-tools.js';
import { registerOrchestrateTools } from './tools/orchestrate-tools.js';
import { registerDiscoverTagsTool } from './tools/discover-tags.js';
import { newPage } from './browser/launcher.js';
import {
  captureNote,
  captureSearchResults,
  captureBloggerNotes,
  captureBloggerInfo,
  checkCaptcha,
} from './engines/dom/capturer.js';
import {
  syncNoteToFeishu,
  batchSyncNotesToFeishu,
  batchSyncSearchResults,
  batchSyncBloggerNotes,
  syncBloggerInfoToFeishu,
} from './feishu/syncer.js';
import { downloadAll, NoteFileMeta } from './media/downloader.js';
import { listDownloads, formatBytes, getTotalSize } from './media/file-manager.js';

const server = new McpServer({ name: 'xhs-pro-mcp', version: '2.0.0' });

registerLoginTool(server);
registerCheckStatusTool(server);
registerSetupTool(server);
registerMediaTools(server);
registerFeishuTools(server);
registerInteractTools(server);
registerPublishTools(server);
registerOrchestrateTools(server);
registerDiscoverTagsTool(server);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 1: xhs_capture_note
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'xhs_capture_note',
  'Capture a XiaoHongShu note by URL — title, body, author, stats, tags, images.',
  {
    url: z.string().url().describe('Full URL of the XiaoHongShu note'),
    syncToFeishu: z.boolean().optional().describe('Sync to Feishu 采集库 (default: false)'),
    downloadMedia: z.boolean().optional().describe('Download images locally (default: false)'),
    downloadPath: z.string().optional().describe('Custom directory for downloaded images (absolute path)'),
    keyword: z.string().optional().describe('Keyword tag for this note (default: "未知")'),
  },
  async ({ url, syncToFeishu = false, downloadMedia = false, downloadPath, keyword }) => {
    const page = await newPage();
    const note = await captureNote(page, url);
    await page.close();

    note.keyword = keyword ?? '未知';

    const lines = [
      `**标题**: ${note.title}`,
      `**作者**: ${note.author}`,
      note.authorUrl ? `**主页**: ${note.authorUrl}` : '',
      `**类型**: ${note.noteType}`,
      `**点赞**: ${note.likeCount}  **收藏**: ${note.collectCount}  **评论**: ${note.commentCount}`,
      `**标签**: ${note.tags.join(' ')}`,
      `**发布**: ${note.publishTime}`,
      `**图片**: ${note.images.length} 张`,
      note.videoUrl ? `**视频**: ${note.videoUrl}` : '',
      `\n**正文**:\n${note.content}`,
    ].filter(Boolean);

    const result: string[] = [lines.join('\n')];

    if (syncToFeishu) {
      const r = await syncNoteToFeishu(note);
      result.push(r.success
        ? `\n**飞书同步**: ${r.action} (recordId: ${r.recordId})`
        : `\n**飞书同步失败**: ${r.error}`);
    }

    if (downloadMedia && note.images.length > 0) {
      const meta: NoteFileMeta = { title: note.title, noteId: note.noteId, imageCategory: '详情', likeCount: note.likeCount };
      const dl = await downloadAll(note.images, note.noteId, 3, meta, downloadPath);
      result.push(`\n**媒体下载**: ${dl.filter((d) => d.success).length}/${note.images.length} 成功`);
    }

    return { content: [{ type: 'text' as const, text: result.join('') }] };
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 2: xhs_search_notes
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'xhs_search_notes',
  'Search XiaoHongShu notes by keyword. Returns ranked list with likes and type.',
  {
    keyword: z.string().describe('Search keyword'),
    maxResults: z.number().optional().describe('Max results to collect (default: 20)'),
    sortMode: z.enum(['comprehensive', 'latest']).optional().describe('Sort mode (default: comprehensive)'),
    captureDetails: z.boolean().optional().describe('Capture full note details for each result (slower)'),
    syncToFeishu: z.boolean().optional().describe('Sync results to Feishu 关键词战情库 / 采集库'),
  },
  async ({ keyword, maxResults = 20, sortMode = 'comprehensive', captureDetails = false, syncToFeishu = false }) => {
    const page = await newPage();
    const results = await captureSearchResults(page, keyword, maxResults, sortMode);

    if (!captureDetails) {
      await page.close();
      if (syncToFeishu) await batchSyncSearchResults(results);
      const text = results
        .map((r) => {
          let line = `${r.rank}. [${r.noteType}] ${r.title} — ${r.author} | 赞${r.likes}\n   ${r.tokenUrl || r.url}`;
          if (r.authorUrl) line += `\n   博主主页: ${r.authorUrl}`;
          return line;
        })
        .join('\n');
      return {
        content: [{
          type: 'text' as const,
          text: `搜索"${keyword}"共 ${results.length} 条${syncToFeishu ? '，已同步到飞书关键词战情库' : ''}:\n\n${text}`,
        }],
      };
    }

    // Full detail capture
    const notes = [];
    for (const r of results) {
      if (!r.url) continue;
      if (await checkCaptcha(page)) {
        notes.push(null);
        break;
      }
      const note = await captureNote(page, r.tokenUrl || r.url);
      note.keyword = keyword;
      notes.push(note);
    }
    await page.close();

    const validNotes = notes.filter(Boolean) as Awaited<ReturnType<typeof captureNote>>[];

    if (syncToFeishu) {
      await batchSyncSearchResults(results);
      if (validNotes.length > 0) await batchSyncNotesToFeishu(validNotes);
    }

    const summary = validNotes
      .map((n, i) => `${i + 1}. **${n.title}** — ${n.author} | 赞${n.likeCount} 藏${n.collectCount}`)
      .join('\n');

    return {
      content: [{
        type: 'text' as const,
        text: `搜索"${keyword}"采集 ${validNotes.length} 篇笔记${syncToFeishu ? '，已同步到飞书' : ''}:\n\n${summary}`,
      }],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 3: xhs_capture_blogger_notes — blogger feed (all notes on a profile)
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'xhs_capture_blogger_notes',
  'Capture all notes from a XiaoHongShu blogger profile page (scroll to load all).',
  {
    profileUrl: z.string().url().describe('Blogger profile URL (xiaohongshu.com/user/profile/...)'),
    limit: z.number().optional().describe('Max notes to collect (0 = all, default: 0)'),
    syncToFeishu: z.boolean().optional().describe('Sync to Feishu 博主笔记库 (default: false)'),
  },
  async ({ profileUrl, limit = 0, syncToFeishu = false }) => {
    const page = await newPage();
    const notes = await captureBloggerNotes(page, profileUrl, limit);
    await page.close();

    if (syncToFeishu && notes.length > 0) {
      await batchSyncBloggerNotes(notes);
    }

    const lines = notes.map(
      (n, i) => `${i + 1}. ${n.title} | 赞${n.likes} | ${n.url}`,
    );
    return {
      content: [{
        type: 'text' as const,
        text: `博主 ${profileUrl} 共采集 ${notes.length} 篇笔记${syncToFeishu ? '，已同步到飞书博主笔记库' : ''}:\n\n${lines.join('\n')}`,
      }],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 4: xhs_capture_blogger_info — blogger profile card
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'xhs_capture_blogger_info',
  'Capture blogger profile information (name, XHS ID, bio, follower count, avatar). ' +
  'Accepts either a full profile URL or just a userId.',
  {
    profileUrl: z.string().optional().describe('Blogger profile URL (full URL)'),
    userId: z.string().optional().describe('Blogger user ID (e.g. "679395cf000000000a03f550") — will construct profile URL automatically'),
    syncToFeishu: z.boolean().optional().describe('Sync to Feishu 博主库 (default: false)'),
  },
  async ({ profileUrl, userId, syncToFeishu = false }) => {
    const url = profileUrl || (userId ? `https://www.xiaohongshu.com/user/profile/${userId}` : '');
    if (!url) {
      return { content: [{ type: 'text' as const, text: '请提供 profileUrl 或 userId 参数。' }] };
    }
    const page = await newPage();
    const info = await captureBloggerInfo(page, url);
    await page.close();

    if (syncToFeishu) {
      await syncBloggerInfoToFeishu(info);
    }

    const lines = [
      `**博主名称**: ${info.bloggerName}`,
      `**小红书号**: ${info.bloggerId}`,
      `**简介**: ${info.description}`,
      `**粉丝数**: ${info.followersCount.toLocaleString()}`,
      `**头像**: ${info.avatarUrl}`,
      `**主页**: ${info.bloggerUrl}`,
    ];
    return {
      content: [{
        type: 'text' as const,
        text: lines.join('\n') + (syncToFeishu ? '\n\n已同步到飞书博主库' : ''),
      }],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 5: xhs_batch_capture_notes — bulk note capture from URL list
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'xhs_batch_capture_notes',
  'Capture multiple XiaoHongShu notes by a list of URLs.',
  {
    urls: z.array(z.string().url()).describe('List of note URLs'),
    syncToFeishu: z.boolean().optional().describe('Sync all to Feishu 采集库 (default: false)'),
    downloadMedia: z.boolean().optional().describe('Download images for each note (default: false)'),
    downloadPath: z.string().optional().describe('Custom directory for downloaded images (absolute path)'),
    keyword: z.string().optional().describe('Keyword tag for all notes (default: "未知")'),
  },
  async ({ urls, syncToFeishu = false, downloadMedia = false, downloadPath, keyword }) => {
    const page = await newPage();
    const notes = [];
    const errors: string[] = [];

    for (const url of urls) {
      if (await checkCaptcha(page)) {
        errors.push(`CAPTCHA at ${url} — stopping`);
        break;
      }
      try {
        const note = await captureNote(page, url);
        note.keyword = keyword ?? '未知';
        notes.push(note);
        if (downloadMedia && note.images.length > 0) {
          const meta: NoteFileMeta = { title: note.title, noteId: note.noteId, imageCategory: '详情', likeCount: note.likeCount };
          await downloadAll(note.images, note.noteId, 3, meta, downloadPath);
        }
      } catch (err) {
        errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await page.close();

    if (syncToFeishu && notes.length > 0) {
      await batchSyncNotesToFeishu(notes);
    }

    const lines = [
      `批量采集完成: ${notes.length}/${urls.length} 成功`,
      ...notes.map((n, i) => `${i + 1}. **${n.title}** — 赞${n.likeCount}`),
      ...(errors.length > 0 ? ['\n**错误**:', ...errors.map((e) => `- ${e}`)] : []),
    ];
    return {
      content: [{ type: 'text' as const, text: lines.join('\n') }],
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool 6: xhs_list_downloads
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'xhs_list_downloads',
  'List locally downloaded media files.',
  {
    subDir: z.string().optional().describe('Sub-directory under downloads/'),
  },
  async ({ subDir = '' }) => {
    const files = listDownloads(subDir);
    const total = getTotalSize(subDir);
    if (files.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No downloaded files found.' }] };
    }
    const lines = files.map(
      (f) => `- ${f.name} (${formatBytes(f.size)}) — ${f.createdAt.toLocaleString()}`,
    );
    lines.unshift(`Total: ${files.length} files, ${formatBytes(total)}\n`);
    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Tool: xhs_search_blogger — search by name/keyword and return blogger profile + follower count
// ─────────────────────────────────────────────────────────────────────────────
server.tool(
  'xhs_search_blogger',
  'Search for XiaoHongShu bloggers by name or keyword. Returns profile URL, follower count, and bio. ' +
  'This tool searches notes, extracts unique author profiles, then visits each profile to get follower data.',
  {
    keyword: z.string().describe('Blogger name or search keyword'),
    maxBloggers: z.number().optional().describe('Max bloggers to return (default: 5)'),
    maxSearchResults: z.number().optional().describe('Max search results to scan for authors (default: 20)'),
  },
  async ({ keyword, maxBloggers = 5, maxSearchResults = 20 }) => {
    const page = await newPage();
    try {
      // Step 1: search notes to find author profile URLs
      const results = await captureSearchResults(page, keyword, maxSearchResults);

      // Step 2: deduplicate authors by profile URL
      const seen = new Set<string>();
      const uniqueAuthors: Array<{ name: string; profileUrl: string }> = [];
      for (const r of results) {
        if (!r.authorUrl || seen.has(r.authorUrl)) continue;
        seen.add(r.authorUrl);
        uniqueAuthors.push({ name: r.author, profileUrl: r.authorUrl });
        if (uniqueAuthors.length >= maxBloggers) break;
      }

      if (uniqueAuthors.length === 0) {
        await page.close();
        return {
          content: [{ type: 'text' as const, text: `搜索"${keyword}"未找到博主主页链接。` }],
        };
      }

      // Step 3: visit each profile to get follower count
      const bloggerInfos: Array<{ name: string; profileUrl: string; followers: number; bio: string; bloggerId: string }> = [];
      for (const author of uniqueAuthors) {
        try {
          const info = await captureBloggerInfo(page, author.profileUrl);
          bloggerInfos.push({
            name: info.bloggerName || author.name,
            profileUrl: author.profileUrl,
            followers: info.followersCount,
            bio: info.description,
            bloggerId: info.bloggerId,
          });
        } catch {
          bloggerInfos.push({
            name: author.name,
            profileUrl: author.profileUrl,
            followers: -1,
            bio: '（获取失败）',
            bloggerId: '',
          });
        }
      }

      await page.close();

      const lines = bloggerInfos.map((b, i) => {
        const followStr = b.followers >= 0 ? `${b.followers}` : '未知';
        return `${i + 1}. **${b.name}**${b.bloggerId ? ` (${b.bloggerId})` : ''}\n   粉丝: ${followStr} | 简介: ${b.bio || '无'}\n   主页: ${b.profileUrl}`;
      });

      return {
        content: [{
          type: 'text' as const,
          text: `搜索"${keyword}"找到 ${bloggerInfos.length} 个博主:\n\n${lines.join('\n\n')}`,
        }],
      };
    } catch (err) {
      await page.close();
      throw err;
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[xhs-pro-mcp] Server started — 25 tools registered');
