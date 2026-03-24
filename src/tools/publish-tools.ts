/**
 * Publish tools — publish image/video notes via Playwright automation.
 * Uses the XHS creator center web interface (creator.xiaohongshu.com).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync } from 'fs';
import { newPage } from '../browser/launcher.js';
import { checkCaptcha } from '../engines/dom/capturer.js';

const CREATOR_URL = 'https://creator.xiaohongshu.com/publish/publish';

async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export function registerPublishTools(server: McpServer): void {
  // ── publish_note ─────────────────────────────────────────────────────────────
  server.tool(
    'xhs_publish_note',
    'Publish an image+text note to XiaoHongShu via the creator center. ' +
    'Requires images to be local file paths on this machine.',
    {
      title: z.string().max(20).describe('Note title (max 20 characters)'),
      content: z.string().max(1000).describe('Note body text (max 1000 characters)'),
      imagePaths: z.array(z.string()).min(1).max(9).describe('Local image file paths (1-9 images)'),
      tags: z.array(z.string()).optional().describe('Topic tags (without #)'),
      visibility: z.enum(['public', 'private']).optional().describe('public or private (default: public)'),
    },
    async ({ title, content, imagePaths, tags = [], visibility = 'public' }) => {
      // Validate files exist
      for (const p of imagePaths) {
        if (!existsSync(p)) throw new Error(`图片文件不存在: ${p}`);
      }

      const page = await newPage(false /* visible for file chooser */);
      try {
        await page.goto(CREATOR_URL, { waitUntil: 'networkidle', timeout: 30000 });
        await delay(2000);
        if (await checkCaptcha(page)) throw new Error('CAPTCHA_DETECTED');

        // Upload images
        const uploadInput = page.locator('input[type="file"][accept*="image"]').first();
        await uploadInput.setInputFiles(imagePaths);
        await delay(3000 + imagePaths.length * 1000); // wait for upload

        // Fill title
        const titleInput = page.locator(
          'input[placeholder*="标题"], .title-input input, [data-placeholder*="标题"]',
        ).first();
        await titleInput.click();
        await titleInput.fill(title);
        await delay(500);

        // Fill body content
        const bodyInput = page.locator(
          '.content-input, [contenteditable="true"], .desc-input, textarea[placeholder*="正文"]',
        ).first();
        await bodyInput.click();
        await bodyInput.fill(content);
        await delay(500);

        // Add tags
        for (const tag of tags) {
          await bodyInput.type(` #${tag}`);
          await delay(300);
          // Accept the topic suggestion if it appears
          const suggestion = page.locator('.topic-list .topic-item, [class*="topic"]').first();
          if (await suggestion.isVisible({ timeout: 1500 }).catch(() => false)) {
            await suggestion.click();
            await delay(300);
          }
        }

        // Set visibility to private if requested
        if (visibility === 'private') {
          const privacyBtn = page.locator(
            'button:has-text("私密"), [class*="privacy"]',
          ).first();
          if (await privacyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await privacyBtn.click();
            await delay(500);
          }
        }

        // Publish
        const publishBtn = page.locator(
          'button:has-text("发布"), .publish-btn, [class*="submit"]',
        ).first();
        await publishBtn.click();
        await delay(3000);

        // Check for success URL
        const currentUrl = page.url();
        const published = currentUrl.includes('success') || currentUrl.includes('explore');

        return {
          content: [{
            type: 'text' as const,
            text: published
              ? `✅ 笔记发布成功!\n标题: ${title}\n图片: ${imagePaths.length} 张\n标签: ${tags.map((t) => '#' + t).join(' ')}`
              : `⚠️ 发布操作已完成，请手动确认是否发布成功。\n当前页面: ${currentUrl}`,
          }],
        };
      } finally {
        await page.close();
      }
    },
  );

  // ── publish_video ────────────────────────────────────────────────────────────
  server.tool(
    'xhs_publish_video',
    'Publish a video note to XiaoHongShu via the creator center.',
    {
      videoPath: z.string().describe('Local video file path (.mp4 recommended)'),
      title: z.string().max(20).describe('Note title (max 20 characters)'),
      content: z.string().max(1000).optional().describe('Note body text'),
      tags: z.array(z.string()).optional().describe('Topic tags (without #)'),
      visibility: z.enum(['public', 'private']).optional().describe('public or private (default: public)'),
    },
    async ({ videoPath, title, content = '', tags = [], visibility = 'public' }) => {
      if (!existsSync(videoPath)) throw new Error(`视频文件不存在: ${videoPath}`);

      const page = await newPage(false);
      try {
        await page.goto(CREATOR_URL, { waitUntil: 'networkidle', timeout: 30000 });
        await delay(2000);
        if (await checkCaptcha(page)) throw new Error('CAPTCHA_DETECTED');

        // Switch to video tab if visible
        const videoTab = page.locator(
          'button:has-text("上传视频"), [class*="video-tab"], a:has-text("视频")',
        ).first();
        if (await videoTab.isVisible({ timeout: 2000 }).catch(() => false)) {
          await videoTab.click();
          await delay(1000);
        }

        // Upload video
        const uploadInput = page.locator('input[type="file"][accept*="video"]').first();
        await uploadInput.setInputFiles(videoPath);
        await delay(5000); // longer wait for video processing

        // Poll for upload completion (max 3 minutes)
        let uploaded = false;
        for (let i = 0; i < 36; i++) {
          const progress = page.locator('[class*="upload-progress"], .progress-bar');
          const done = await progress.isHidden({ timeout: 2000 }).catch(() => true);
          if (done) { uploaded = true; break; }
          await delay(5000);
        }
        if (!uploaded) throw new Error('视频上传超时（3分钟），请检查网络或文件大小');

        // Fill title
        const titleInput = page.locator(
          'input[placeholder*="标题"], .title-input input',
        ).first();
        await titleInput.click();
        await titleInput.fill(title);
        await delay(500);

        // Fill body
        if (content) {
          const bodyInput = page.locator(
            '.content-input, [contenteditable="true"], textarea[placeholder*="正文"]',
          ).first();
          await bodyInput.click();
          await bodyInput.fill(content);
          await delay(500);
        }

        // Tags
        for (const tag of tags) {
          const bodyInput = page.locator('[contenteditable="true"]').first();
          await bodyInput.type(` #${tag}`);
          await delay(300);
          const suggestion = page.locator('.topic-list .topic-item').first();
          if (await suggestion.isVisible({ timeout: 1500 }).catch(() => false)) {
            await suggestion.click();
            await delay(300);
          }
        }

        if (visibility === 'private') {
          const privacyBtn = page.locator('button:has-text("私密")').first();
          if (await privacyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await privacyBtn.click();
            await delay(500);
          }
        }

        const publishBtn = page.locator('button:has-text("发布"), .publish-btn').first();
        await publishBtn.click();
        await delay(3000);

        const currentUrl = page.url();
        const published = currentUrl.includes('success') || currentUrl.includes('explore');

        return {
          content: [{
            type: 'text' as const,
            text: published
              ? `✅ 视频笔记发布成功!\n标题: ${title}\n视频: ${videoPath}`
              : `⚠️ 发布操作已完成，请手动确认。\n当前页面: ${currentUrl}`,
          }],
        };
      } finally {
        await page.close();
      }
    },
  );
}
