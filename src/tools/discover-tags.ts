/**
 * xhs_discover_related_tags — extract related search tag chips from the search page.
 * These are the clickable filter chips below the search bar (e.g. "asamimi周边", "asamimi盲盒").
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { newPage } from '../browser/launcher.js';

const XHS_SEARCH = 'https://www.xiaohongshu.com/search_result';

export function registerDiscoverTagsTool(server: McpServer): void {
  server.tool(
    'xhs_discover_related_tags',
    'Extract related search tag chips for a keyword on XiaoHongShu. ' +
    'Returns the list of tag labels found below the search bar. ' +
    'Use this before xhs_capture_and_sync to discover additional sub-topics to cover.',
    {
      keyword: z.string().describe('Primary search keyword'),
      maxTags: z.number().optional().default(20).describe('Max number of tags to return (default: 20)'),
    },
    async ({ keyword, maxTags = 20 }) => {
      const page = await newPage();

      try {
        const url = `${XHS_SEARCH}?keyword=${encodeURIComponent(keyword)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Wait for page to settle
        await page.waitForTimeout(2000);

        // ── Tag extraction strategies (tried in order) ─────────────────────────
        // Strategy 1: common chip/filter patterns for related tags
        const TAG_SELECTORS = [
          // Horizontal scroll chip list (XHS uses this pattern heavily)
          '[class*="tag-chip"]',
          '[class*="filter-chip"]',
          '[class*="search-tag"]',
          '[class*="hot-tag"]',
          // Filter bar items
          '.filter-item',
          '[class*="filter-item"]',
          // Span-level tags in search bar area
          'span[class*="tag"]',
          'div[class*="tag"]:not([class*="note"])',
          // The related tags section often has a specific container
          '[class*="relative-tag"]',
          '[class*="relation-tag"]',
          // Hot search / trending tags
          '[class*="hot-search"] span',
          '[class*="trending"] span',
          // Discovery-style chips
          '.discovery-chip',
          '[class*="chip"]:not([class*="note"])',
        ];

        let tags: string[] = [];
        let found = false;

        for (const sel of TAG_SELECTORS) {
          if (found) break;
          const els = await page.$$(sel);
          if (els.length === 0) continue;

          const raw = await Promise.all(
            els.map((el) =>
              el.evaluate((node) => {
                const text = node.textContent?.trim() ?? '';
                // Must have content, reasonable length
                if (!text || text.length > 15 || text.length < 2) return null;
                if (/^\d+$/.test(text)) return null;
                // Exclude known navigation/footer/brand noise
                if ([
                  '全部', '图文', '视频', '用户', '筛选', '搜索', '确定', '取消', '关闭',
                  '创作中心', '业务合作', '发现', '直播', '发布', '通知',
                  '沪ICP备', '营业执照', '网上有害信息', '自营经营者',
                  '头像', '广州', '厦门', '上海', '原作者',
                ].some((kw) => text.includes(kw))) return null;
                // Exclude date patterns, pure numbers, and likely usernames
                if (/\d{4}-\d{2}-\d{2}/.test(text)) return null; // dates like 2025-10-30
                if (/^\d{2,}$/.test(text)) return null;          // pure multi-digit numbers like 742
                if (/^[小红薯瓜条]+$|^[\u4e00-\u9fa5]{1,3}(薯|瓜|条)/.test(text)) return null; // likely usernames
                return text;
              }),
            ),
          );

          const valid = raw.filter(Boolean) as string[];
          if (valid.length > 0) {
            tags = valid.slice(0, maxTags);
            found = true;
          }
        }

        // Strategy 2: look for a specific "related searches" section
        if (!found || tags.length === 0) {
          const sectionText = await page.evaluate(() => {
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates: string[] = [];
            for (const el of allEls) {
              const text = el.textContent?.trim() ?? '';
              if (text.length > 1 && text.length < 15 && !candidates.includes(text)) {
                // Look for elements near the search bar that look like tag chips
                const rect = el.getBoundingClientRect();
                if (rect.width > 30 && rect.width < 150 && rect.height < 50 && rect.height > 10) {
                  candidates.push(text);
                }
              }
            }
            return candidates;
          });

          tags = (sectionText ?? [])
            .filter((t) => {
              if (!t || t.length < 2 || t.length > 15) return false;
              return ![
                '全部', '图文', '视频', '用户', '筛选', '创作中心', '业务合作',
                '发现', '直播', '发布', '通知', '头像', '广州', '厦门', '上海',
                '沪ICP备', '营业执照', '网上有害', '自营', '原作者',
              ].some((kw) => t.includes(kw));
            })
            .slice(0, maxTags);
        }

        // Strategy 3: look for URLs that contain the keyword as a tag parameter
        if (tags.length === 0) {
          const tagUrls = await page.evaluate(
            (kw) => {
              const links = Array.from(document.querySelectorAll('a[href*="keyword"]'));
              return links
                .map((a) => {
                  const href = a.getAttribute('href') ?? '';
                  try {
                    const url = new URL(href.startsWith('http') ? href : 'https://www.xiaohongshu.com' + href);
                    const tag = url.searchParams.get('keyword') ?? url.searchParams.get('tag');
                    return tag;
                  } catch {
                    return null;
                  }
                })
                .filter(Boolean) as string[];
            },
            keyword,
          );
          tags = [...new Set(tagUrls)].slice(0, maxTags);
        }

        // Remove duplicates and empty
        tags = [...new Set(tags)].filter(Boolean);

        return {
          content: [{
            type: 'text' as const,
            text: tags.length > 0
              ? `发现 ${tags.length} 个相关标签：\n${tags.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n使用 xhs_capture_and_sync 对每个标签采集：xhs_capture_and_sync(type="keyword", target="标签名")`
              : `未在搜索结果页找到相关标签。可能需要先滚动加载页面，或该关键词无相关标签推荐。`,
          }],
        };
      } finally {
        await page.close();
      }
    },
  );
}
