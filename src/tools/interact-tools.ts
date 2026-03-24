/**
 * Interaction tools — like, favorite, comment, reply, get_feeds.
 * All use Playwright DOM automation against the live XHS page.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { newPage } from '../browser/launcher.js';
import { checkCaptcha, captureSearchResults } from '../engines/dom/capturer.js';
import { humanClick, humanClickLocator, humanType, humanTypeLocator, wait, gaussian, THINK, GLANCE, HESITATE } from '../browser/human.js';

const XHS_HOME = 'https://www.xiaohongshu.com';
const NOTE_BASE = 'https://www.xiaohongshu.com/explore';

function noteUrl(noteId: string): string {
  return `${NOTE_BASE}/${noteId}`;
}

export function registerInteractTools(server: McpServer): void {
  // ── like_note ────────────────────────────────────────────────────────────────
  server.tool(
    'xhs_like_note',
    'Like or unlike a XiaoHongShu note.',
    {
      noteId: z.string().describe('Note ID'),
      cancel: z.boolean().optional().describe('true = unlike (default: false = like)'),
    },
    async ({ noteId, cancel = false }) => {
      const page = await newPage();
      try {
        await page.goto(noteUrl(noteId), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('.like-wrapper, .interaction-container', { timeout: 15000 }).catch(() => wait(2000));
        if (await checkCaptcha(page)) throw new Error('CAPTCHA_DETECTED');

        // Find the like button wrapper
        const likeBtn = page.locator('.like-wrapper, [class*="like-btn"]').first();
        const isLiked = await likeBtn.getAttribute('class').then((c) => c?.includes('active') ?? false);

        if (cancel && !isLiked) {
          return { content: [{ type: 'text' as const, text: '笔记本来就没有点赞，无需取消。' }] };
        }
        if (!cancel && isLiked) {
          return { content: [{ type: 'text' as const, text: '笔记已点赞，无需重复操作。' }] };
        }

        await humanClickLocator(page, likeBtn);
        await wait(THINK());
        const newCount = await page.locator('.like-wrapper .count').textContent();

        return {
          content: [{
            type: 'text' as const,
            text: `✅ ${cancel ? '取消点赞' : '点赞'}成功 | 当前点赞数: ${newCount?.trim() ?? '?'}`,
          }],
        };
      } finally {
        await page.close();
      }
    },
  );

  // ── favorite_note ────────────────────────────────────────────────────────────
  server.tool(
    'xhs_favorite_note',
    'Favorite or unfavorite a XiaoHongShu note.',
    {
      noteId: z.string().describe('Note ID'),
      cancel: z.boolean().optional().describe('true = unfavorite (default: false = favorite)'),
    },
    async ({ noteId, cancel = false }) => {
      const page = await newPage();
      try {
        await page.goto(noteUrl(noteId), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('.collect-wrapper, .interaction-container', { timeout: 15000 }).catch(() => wait(2000));
        if (await checkCaptcha(page)) throw new Error('CAPTCHA_DETECTED');

        const collectBtn = page.locator('.collect-wrapper, [class*="collect-btn"]').first();
        const isCollected = await collectBtn.getAttribute('class').then((c) => c?.includes('active') ?? false);

        if (cancel && !isCollected) {
          return { content: [{ type: 'text' as const, text: '笔记本来就没有收藏，无需取消。' }] };
        }
        if (!cancel && isCollected) {
          return { content: [{ type: 'text' as const, text: '笔记已收藏，无需重复操作。' }] };
        }

        await humanClickLocator(page, collectBtn);
        await wait(THINK());
        const newCount = await page.locator('.collect-wrapper .count').textContent();

        return {
          content: [{
            type: 'text' as const,
            text: `✅ ${cancel ? '取消收藏' : '收藏'}成功 | 当前收藏数: ${newCount?.trim() ?? '?'}`,
          }],
        };
      } finally {
        await page.close();
      }
    },
  );

  // ── comment_note ─────────────────────────────────────────────────────────────
  server.tool(
    'xhs_comment_note',
    'Post a comment on a XiaoHongShu note.',
    {
      noteId: z.string().describe('Note ID'),
      content: z.string().min(1).max(500).describe('Comment text (max 500 chars)'),
    },
    async ({ noteId, content }) => {
      const page = await newPage();
      try {
        await page.goto(noteUrl(noteId), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('.interaction-container, .note-detail', { timeout: 15000 }).catch(() => wait(2000));
        if (await checkCaptcha(page)) throw new Error('CAPTCHA_DETECTED');

        // Click the comment input area to focus it
        await humanClick(page, '.comment-input, [placeholder*="评论"], .input-box textarea, .chat-input');
        await wait(HESITATE());

        // Type comment character by character
        const commentInput = page.locator(
          '.comment-input, [placeholder*="评论"], .input-box textarea, .chat-input',
        ).first();
        await humanTypeLocator(page, commentInput, content);
        await wait(GLANCE());

        // Submit button
        await humanClick(page, '.submit-btn, button:has-text("发布"), .comment-submit, .send-btn');
        await wait(THINK());

        return {
          content: [{
            type: 'text' as const,
            text: `✅ 评论发送成功\n内容: ${content}`,
          }],
        };
      } finally {
        await page.close();
      }
    },
  );

  // ── reply_comment ────────────────────────────────────────────────────────────
  server.tool(
    'xhs_reply_comment',
    'Reply to a specific comment on a XiaoHongShu note.',
    {
      noteId: z.string().describe('Note ID'),
      commentIndex: z.number().int().min(0).optional().describe('0-based index of the comment to reply to (default: 0 = first comment)'),
      content: z.string().min(1).max(500).describe('Reply text (max 500 chars)'),
    },
    async ({ noteId, commentIndex = 0, content }) => {
      const page = await newPage();
      try {
        await page.goto(noteUrl(noteId), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('.interaction-container, .note-detail', { timeout: 15000 }).catch(() => wait(2000));
        if (await checkCaptcha(page)) throw new Error('CAPTCHA_DETECTED');

        // Find comment items and click the target reply button
        const replyBtns = page.locator('.reply-btn, .comment-item .reply, [class*="reply"]');
        const count = await replyBtns.count();
        if (count === 0) throw new Error('未找到任何评论回复按钮');
        if (commentIndex >= count) throw new Error(`评论下标 ${commentIndex} 超出范围（共 ${count} 条）`);

        await humanClickLocator(page, replyBtns.nth(commentIndex));
        await wait(GLANCE());

        const replyInput = page.locator(
          '.reply-input, .comment-input, [placeholder*="回复"], .chat-input',
        ).first();
        await humanTypeLocator(page, replyInput, content);
        await wait(HESITATE());

        await humanClick(page, '.submit-btn, button:has-text("发布"), .comment-submit, .send-btn');
        await wait(THINK());

        return {
          content: [{
            type: 'text' as const,
            text: `✅ 回复发送成功\n内容: ${content}`,
          }],
        };
      } finally {
        await page.close();
      }
    },
  );

  // ── get_feeds ────────────────────────────────────────────────────────────────
  server.tool(
    'xhs_get_feeds',
    'Get recommended notes from XiaoHongShu homepage feed.',
    {
      limit: z.number().optional().describe('Number of notes to collect (default: 20)'),
    },
    async ({ limit = 20 }) => {
      const page = await newPage();
      try {
        await page.goto(XHS_HOME, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('.note-item, section.note-item, [class*="NoteItem"]', { timeout: 15000 }).catch(() => wait(2500));
        if (await checkCaptcha(page)) throw new Error('CAPTCHA_DETECTED');

        const cards = await page.evaluate((maxItems) => {
          const results: { noteId: string; url: string; title: string; author: string; coverImage: string }[] = [];
          const seen = new Set<string>();

          const allCards = Array.from(document.querySelectorAll(
            '.note-item, section.note-item, [class*="NoteItem"], .feeds-container .note',
          )).slice(0, maxItems * 2);

          for (const card of allCards) {
            if (results.length >= maxItems) break;
            const link = card.querySelector('a[href*="/explore/"]') as HTMLAnchorElement | null;
            const href = link?.href ?? '';
            if (!href) continue;
            const idMatch = href.match(/\/explore\/([a-zA-Z0-9]+)/);
            const noteId = idMatch ? idMatch[1] : '';
            if (!noteId || seen.has(noteId)) continue;
            seen.add(noteId);

            const titleEl = card.querySelector('.title, .note-title, .desc');
            const authorEl = card.querySelector('.author, .user-name, .nickname');
            const imgEl = card.querySelector('img') as HTMLImageElement | null;

            results.push({
              noteId,
              url: href.split('?')[0],
              title: titleEl?.textContent?.trim() ?? '无标题',
              author: authorEl?.textContent?.trim() ?? '未知作者',
              coverImage: imgEl?.getAttribute('src') ?? '',
            });
          }
          return results;
        }, limit);

        const text = cards.length === 0
          ? '首页内容为空，请确认已登录'
          : cards.map((c, i) => `${i + 1}. **${c.title}** — ${c.author}\n   ${c.url}`).join('\n');

        return {
          content: [{
            type: 'text' as const,
            text: `首页推荐流 ${cards.length} 条:\n\n${text}`,
          }],
        };
      } finally {
        await page.close();
      }
    },
  );
}
