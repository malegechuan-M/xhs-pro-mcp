/**
 * DOM engine — ported from extension content.js v2.3.1.
 * All scraping runs inside page.evaluate() so the DOM context is identical
 * to the extension environment.
 */

import { Page } from 'playwright';
import * as SEL from './selectors.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NoteData {
  noteId: string;
  url: string;
  title: string;
  content: string;
  author: string;
  authorUrl: string;
  likeCount: number;
  collectCount: number;
  commentCount: number;
  tags: string[];
  images: string[];
  videoUrl: string;
  noteType: '图文' | '视频';
  publishTime: string;
  capturedAt: string;
}

export interface SearchResult {
  keyword: string;
  rank: number;
  noteId: string;
  url: string;
  tokenUrl?: string;  // full URL with xsec_token, used for navigation
  title: string;
  author: string;
  likes: number;
  noteType: '图文' | '视频';
  coverImage: string;
  capturedAt: string;
}

export interface BloggerInfo {
  bloggerUrl: string;
  bloggerName: string;
  bloggerId: string;
  description: string;
  avatarUrl: string;
  followersCount: number;
  capturedAt: string;
}

export interface BloggerNote {
  noteId: string;
  url: string;
  title: string;
  author: string;
  likes: number;
  coverImage: string;
  capturedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Random delay between [min, max] ms — mirrors extension strategy */
async function randomDelay(page: Page, min = 1500, max = 3000): Promise<void> {
  const ms = min + Math.random() * (max - min);
  await page.waitForTimeout(ms);
}

/** Detect captcha overlay and pause until dismissed */
export async function checkCaptcha(page: Page): Promise<boolean> {
  const found = await page.evaluate((selectors) => {
    return selectors.some((s) => !!document.querySelector(s));
  }, SEL.CAPTCHA_OVERLAY);
  return found;
}

function extractNoteId(url: string): string {
  const m = url.match(/\/(?:search_result|explore|note|item)\/([a-zA-Z0-9]+)/);
  return m ? m[1] : url.split('/').pop()?.split('?')[0] ?? url;
}

/** Return canonical explore URL from any note URL */
function canonicalUrl(url: string): string {
  const id = extractNoteId(url);
  return `https://www.xiaohongshu.com/explore/${id}`;
}

function normaliseImageUrl(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('http')) return raw.replace(/^http:/, 'https:');
  if (raw.startsWith('//')) return 'https:' + raw;
  if (raw.startsWith('/')) return 'https://www.xiaohongshu.com' + raw;
  return 'https:' + raw;
}

// ─── Note detail capture ──────────────────────────────────────────────────────

/** Resolve a note URL to one that contains xsec_token (required for XHS SPA routing).
 *  Strategy (tried in order):
 *   1. URL already has xsec_token → return as-is
 *   2. xhslink.com short link → follow redirect (often lands on URL with token)
 *   3. Navigate to XHS homepage first, then do in-page navigation to the note —
 *      XHS may allow access from within the site without requiring xsec_token
 *   4. Search by noteId to find a tokenUrl in search result hrefs
 *   5. Fall back to resolved bare URL (caller will fast-fail on 404 with clear message) */
async function resolveTokenUrl(page: Page, url: string): Promise<string> {
  if (url.includes('xsec_token')) return url;

  // ── Step 1: resolve xhslink.com short links ──────────────────────────────
  let resolvedBase = url;
  if (url.includes('xhslink.com')) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    resolvedBase = page.url();
    if (resolvedBase.includes('xsec_token')) return resolvedBase;
  }

  const noteId = extractNoteId(resolvedBase);
  if (!noteId) return resolvedBase;

  // ── Step 2: in-page navigation via XHS homepage ───────────────────────────
  // Navigate to XHS homepage first to establish proper session context,
  // then use client-side navigation (simulates clicking a link within XHS).
  // XHS may skip the xsec_token check for in-site navigation with valid session.
  try {
    await page.goto('https://www.xiaohongshu.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // Use pushState-based navigation so XHS SPA handles the route transition internally
    await page.evaluate((targetUrl) => { window.location.href = targetUrl; }, canonicalUrl(noteId));
    await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const afterNav = page.url();
    if (!afterNav.includes('/404') && !afterNav.includes('error_code=') && afterNav.includes(noteId)) {
      return afterNav; // XHS allowed access without xsec_token
    }
  } catch { /* fall through */ }

  // ── Step 3: search by noteId to find tokenUrl in result hrefs ────────────
  const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(noteId)}&source=web_search_result_notes`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.note-item, .search-item', { timeout: 8000 }).catch(() => null);
  await randomDelay(page, 500, 800);

  const tokenUrl = await page.evaluate((id) => {
    const hrefRe = /\/(?:search_result|explore|note|item)\/[a-zA-Z0-9]+/;
    const cards = Array.from(document.querySelectorAll('[href]'));
    for (const el of cards) {
      const href = el.getAttribute('href') || '';
      if (!hrefRe.test(href) || href.includes('/user/profile/')) continue;
      if (!href.includes(id)) continue;
      if (!href.includes('xsec_token')) continue;
      const full = href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`;
      return full;
    }
    return null;
  }, noteId);

  if (tokenUrl) return tokenUrl;

  // ── Step 4: all strategies failed ────────────────────────────────────────
  // Return resolvedBase — captureNote will fast-fail with a clear actionable error
  return resolvedBase;
}

export async function captureNote(page: Page, url: string): Promise<NoteData> {
  // Auto-resolve xsec_token when not present — XHS SPA requires it for direct note navigation
  const resolvedUrl = await resolveTokenUrl(page, url);

  await page.goto(resolvedUrl, { waitUntil: 'load', timeout: 30000 });

  // Let XHS SPA finish any client-side routing triggered after initial load.
  // networkidle fires after ~500 ms of network quiet; cap at 5 s so we don't hang.
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // ── Fast-fail: detect XHS error pages BEFORE spending time on timeouts ──────
  // error_code=300031 = note deleted/private; the noteId appears URL-encoded in
  // redirectPath so finalUrl.includes(noteId) would incorrectly pass — check first.
  const landedUrl = page.url();
  if (landedUrl.includes('/404') || landedUrl.includes('error_code=')) {
    const codeMatch = landedUrl.match(/error_code=(\d+)/);
    const msgMatch  = landedUrl.match(/error_msg=([^&]+)/);
    const code = codeMatch ? codeMatch[1] : '';
    const msg  = msgMatch  ? decodeURIComponent(msgMatch[1]) : '笔记无法访问';
    throw new Error(
      `笔记无法访问（${code ? 'error_code=' + code + '，' : ''}${msg}）。\n` +
      `可能原因：①笔记已删除或被设为私密；②小红书需要 xsec_token 签名参数。\n` +
      `建议：在手机小红书 App 中打开该笔记 → 点击分享 → 复制链接，得到 xhslink.com 格式的 URL 再重试。`,
    );
  }

  // Wait for a note-specific element — NOT generic `main`/`article` which exist in the
  // HTML shell before React renders.  This ensures the note is actually mounted before evaluate.
  try {
    await page.waitForSelector(
      '#noteContainer, .note-scroller, .interaction-container, .note-detail',
      { timeout: 10000 },
    );
  } catch {
    // Selector not found (may have been redirected) — proceed and let evaluate surface the error.
  }

  // The engage bar (like/collect/comment counts) renders AFTER the note container.
  // Wait for it specifically so counts aren't all 0.
  try {
    await page.waitForSelector(
      '.interact-container .count, .engage-bar .count, .left .like-wrapper .count',
      { timeout: 8000 },
    );
  } catch {
    // engage bar not found — counts may be 0 but we can still capture other data
  }

  if (await checkCaptcha(page)) {
    throw new Error('CAPTCHA_DETECTED: manual verification required');
  }

  const noteId = extractNoteId(resolvedUrl);

  // Verify we actually landed on the right note.
  // resolveTokenUrl already tried to get xsec_token, but if it still failed we catch it here.
  const finalUrl = page.url();
  if (noteId && !finalUrl.includes(noteId)) {
    throw new Error(
      `笔记页面跳转失败（落地 URL: ${finalUrl}）。\n` +
      `自动获取 xsec_token 未成功，请尝试先用 xhs_search_notes 搜索，再用含 xsec_token 的完整 URL 调用此工具。`,
    );
  }

  // XHS SPA can trigger a second navigation after load, destroying the JS execution context.
  // Retry up to 3 times on that specific Playwright error.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      raw = await page.evaluate(
    ({ NOTE_CONTAINERS, NOTE_TITLE, NOTE_TEXT, NOTE_AUTHOR,
       INTERACTION_LEFT, LIKE_COUNT, COLLECT_COUNT, COMMENT_COUNT,
       NOTE_DATE, SWIPER_SLIDE, VIDEO_CONTAINER, VIDEO_POSTER }) => {

      // ── container ──────────────────────────────────────────────────
      let container: Element | null = null;
      for (const sel of NOTE_CONTAINERS) {
        container = document.querySelector(sel);
        if (container) break;
      }
      if (!container) throw new Error('Note container not found');

      // ── title ──────────────────────────────────────────────────────
      let title = '';
      for (const sel of NOTE_TITLE) {
        const el = document.querySelector(sel);
        if (el?.textContent?.trim()) { title = el.textContent.trim(); break; }
      }

      // ── body text ─────────────────────────────────────────────────
      let textEl: Element | null = null;
      for (const sel of NOTE_TEXT) {
        textEl = container.querySelector(sel);
        if (textEl) break;
      }

      let content = '';
      const tags: string[] = [];
      if (textEl) {
        const tagEls = textEl.querySelectorAll('.tag');
        tagEls.forEach((t) => {
          const txt = t.textContent?.trim();
          if (txt && txt !== '#') tags.push(txt);
        });

        // collect text nodes, skip .tag subtrees
        const collect = (node: Node): string[] => {
          if (node.nodeType === Node.TEXT_NODE) return [node.textContent?.trim() ?? ''];
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            if (el.classList.contains('tag')) return [];
            return Array.from(node.childNodes).flatMap(collect);
          }
          return [];
        };
        content = collect(textEl).join('').trim();
      }

      // ── author ────────────────────────────────────────────────────
      // Search in note-level author areas first (avoid matching comment authors).
      // DOM: #noteContainer > .author > .author-wrapper > .info > a.name > span.username
      let author = '';
      const noteAuthorRoots = [
        '#noteContainer > .author',
        '.author-container',
        '#noteContainer .author-wrapper',
      ];
      for (const rootSel of noteAuthorRoots) {
        const root = document.querySelector(rootSel);
        if (!root) continue;
        // Try specific child selectors inside the author area
        const nameEl =
          root.querySelector('span.username') ??
          root.querySelector('a.name') ??
          root.querySelector('.name');
        if (nameEl?.textContent?.trim()) {
          author = nameEl.textContent.trim();
          break;
        }
      }
      // Fallback: global search
      if (!author) {
        for (const sel of NOTE_AUTHOR) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) { author = el.textContent.trim(); break; }
        }
      }
      // Strip trailing "关注" / "已关注" from author name
      author = author.replace(/\s*(关注|已关注)$/, '');

      // Try to find author link for URL — search within note author area first
      let authorUrl = '';
      for (const rootSel of noteAuthorRoots) {
        const root = document.querySelector(rootSel);
        const link = root?.querySelector('a[href*="/user/profile/"]') as HTMLAnchorElement | null;
        if (link?.href) { authorUrl = link.href; break; }
      }
      if (!authorUrl) {
        const authorLinkEl = document.querySelector('a[href*="/user/profile/"]') as HTMLAnchorElement | null;
        authorUrl = authorLinkEl ? authorLinkEl.href : '';
      }

      // ── interaction counts ────────────────────────────────────────
      const convertCount = (text: string): number => {
        const clean = (text || '').replace(/\s+/g, '').toLowerCase();
        const match = clean.match(/([\d.]+)/);
        if (!match) return 0;
        const n = parseFloat(match[1]);
        if (clean.includes('w') || clean.includes('万')) return Math.round(n * 10000);
        if (clean.includes('k') || clean.includes('千')) return Math.round(n * 1000);
        return Math.round(n);
      };

      // Find the engage-bar's .left container (not comment-level .left).
      // The engage bar is inside .interact-container or .engage-bar, and its .left
      // has all three wrappers: .like-wrapper, .collect-wrapper, .chat-wrapper.
      let interactionRoot: Element | Document = document;
      // Prefer the most specific scope first
      const engageRoots = [
        '.interact-container .left',
        '.engage-bar .left',
        '.engage-bar-style .left',
      ];
      for (const sel of engageRoots) {
        const el = document.querySelector(sel);
        if (el && el.querySelector('.like-wrapper')) {
          interactionRoot = el;
          break;
        }
      }
      // Fallback: scan all .left elements (old logic)
      if (interactionRoot === document) {
        const lefts = Array.from(document.querySelectorAll('.left'));
        for (const left of lefts) {
          if (left.querySelector('.like-wrapper') &&
              left.querySelector('.collect-wrapper') &&
              left.querySelector('.chat-wrapper')) {
            interactionRoot = left;
            break;
          }
        }
      }

      const likeCount    = convertCount(interactionRoot.querySelector(LIKE_COUNT)?.textContent ?? '');
      const collectCount = convertCount(interactionRoot.querySelector(COLLECT_COUNT)?.textContent ?? '');
      const commentCount = convertCount(interactionRoot.querySelector(COMMENT_COUNT)?.textContent ?? '');

      // ── publish date ──────────────────────────────────────────────
      let publishTime = '';
      // Search inside .note-content first (more specific, avoids comment dates)
      const noteContentEl = document.querySelector('.note-content, .note-scroller');
      const dateSearchRoot = noteContentEl ?? document;
      for (const sel of NOTE_DATE) {
        const el = dateSearchRoot.querySelector(sel);
        if (el?.textContent?.trim()) {
          publishTime = el.textContent.trim()
            .replace(/^编辑于\s*/, '')   // strip "编辑于" prefix
            .replace(/^发布于\s*/, '');  // strip "发布于" prefix
          break;
        }
      }

      // ── images / video ────────────────────────────────────────────
      const images: string[] = [];
      let videoUrl = '';
      let noteType: '图文' | '视频' = '图文';

      const videoEl = document.querySelector(VIDEO_CONTAINER);
      if (videoEl) {
        noteType = '视频';
        const poster = document.querySelector(VIDEO_POSTER);
        if (poster) {
          const style = poster.getAttribute('style') ?? '';
          const m = style.match(/url\("([^"]+)"\)/);
          if (m) images.push(m[1].replace(/^http:/, 'https:'));
        }
        // Try <video> src
        const vEl = document.querySelector('video') as HTMLVideoElement | null;
        videoUrl = vEl?.src ?? vEl?.querySelector('source')?.getAttribute('src') ?? '';
      } else {
        const slides = document.querySelectorAll(SWIPER_SLIDE);
        if (slides.length > 0) {
          slides.forEach((slide) => {
            const img = slide.querySelector('img') as HTMLImageElement | null;
            if (!img?.src) return;
            if (/avatar|head|profile|placeholder|blank|spacer/i.test(img.src)) return;
            images.push(img.src.replace(/^http:/, 'https:'));
          });
        } else {
          const seen = new Set<string>();
          container.querySelectorAll('img').forEach((img) => {
            let src = img.getAttribute('data-src') || img.getAttribute('src') || '';
            if (!src || /avatar|head|profile|placeholder|blank|spacer/i.test(src)) return;
            if (!src.startsWith('http')) {
              src = src.startsWith('//') ? 'https:' + src
                : src.startsWith('/') ? 'https://www.xiaohongshu.com' + src
                : 'https:' + src;
            }
            if (!seen.has(src)) { seen.add(src); images.push(src); }
          });
        }
      }

      return { title, content, author, authorUrl, tags, likeCount, collectCount, commentCount, publishTime, images, videoUrl, noteType };
    },
    {
      NOTE_CONTAINERS: SEL.NOTE_CONTAINERS,
      NOTE_TITLE: SEL.NOTE_TITLE,
      NOTE_TEXT: SEL.NOTE_TEXT,
      NOTE_AUTHOR: SEL.NOTE_AUTHOR,
      INTERACTION_LEFT: SEL.INTERACTION_LEFT,
      LIKE_COUNT: SEL.LIKE_COUNT,
      COLLECT_COUNT: SEL.COLLECT_COUNT,
      COMMENT_COUNT: SEL.COMMENT_COUNT,
      NOTE_DATE: SEL.NOTE_DATE,
      SWIPER_SLIDE: SEL.SWIPER_SLIDE,
      VIDEO_CONTAINER: SEL.VIDEO_CONTAINER,
      VIDEO_POSTER: SEL.VIDEO_POSTER,
    },
      );
      break; // success
    } catch (err) {
      if (attempt === 2 || !String(err).includes('Execution context was destroyed')) throw err;
      // Wait for any pending navigation to settle, then retry
      await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  return {
    noteId,
    url: canonicalUrl(url),  // store clean URL (no xsec_token) for reliable dedup
    ...raw,
    capturedAt: new Date().toISOString(),
  };
}

// ─── Keyword search capture ───────────────────────────────────────────────────

export async function captureSearchResults(
  page: Page,
  keyword: string,
  limit = 20,
  sortMode: 'comprehensive' | 'latest' = 'comprehensive',
): Promise<SearchResult[]> {
  const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait for first card with a loaded like count (like-active = count data arrived)
  await page.waitForSelector('.note-item .like-wrapper.like-active, .note-item .like-wrapper .count', { timeout: 10000 }).catch(() => null);
  await randomDelay(page, 500, 1000);

  // Switch sort mode if needed
  if (sortMode === 'latest') {
    try {
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, span, div'))
          .find((el) => el.textContent?.trim() === '最新') as HTMLElement | null;
        btn?.click();
      });
      await randomDelay(page, 800, 1200);
    } catch { /* ignore */ }
  }

  const maxScrollSteps = Math.max(12, Math.ceil(limit / 5) * 3);
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  let noNewRounds = 0;

  for (let step = 0; step < maxScrollSteps; step++) {
    if (await checkCaptcha(page)) throw new Error('CAPTCHA_DETECTED');

    const batch = await page.evaluate(
      ({ SEARCH_CARD, SEARCH_CARD_HREF_PATTERN, SEARCH_CARD_TITLE,
         SEARCH_CARD_AUTHOR, SEARCH_CARD_LIKE, SEARCH_CARD_VIDEO_MARKER,
         SEARCH_CARD_IMG, keyword }) => {

        const hrefRe = new RegExp(SEARCH_CARD_HREF_PATTERN);
        const cards = Array.from(document.querySelectorAll(SEARCH_CARD));

        return cards.map((card) => {
          const hrefs = Array.from(card.querySelectorAll('[href]'))
            .map((el) => (el.getAttribute('href') || '').trim())
            .filter(Boolean);

          // Prefer URL with xsec_token (search_result path) for reliable navigation
          let hrefRaw =
            hrefs.find((h) => hrefRe.test(h) && !h.includes('/user/profile/') && h.includes('xsec_token')) ||
            hrefs.find((h) => hrefRe.test(h) && !h.includes('/user/profile/'));
          if (!hrefRaw) return null;
          if (!hrefRaw.startsWith('http')) {
            hrefRaw = hrefRaw.startsWith('/')
              ? `https://www.xiaohongshu.com${hrefRaw}`
              : `https://www.xiaohongshu.com/${hrefRaw}`;
          }

          const idMatch = hrefRaw.match(/\/(?:search_result|explore|note|item)\/([a-zA-Z0-9]+)/);
          const noteId = idMatch
            ? idMatch[1]
            : hrefRaw.split('?')[0].split('/').pop() ?? '';
          if (!noteId) return null;

          const titleEl = card.querySelector(SEARCH_CARD_TITLE);
          const authorEl = card.querySelector(SEARCH_CARD_AUTHOR);

          // Image: try candidates in order
          let imgUrl = '';
          for (const imgSel of SEARCH_CARD_IMG) {
            const img = card.querySelector(imgSel) as HTMLImageElement | null;
            if (img) {
              imgUrl = img.getAttribute('data-src') || img.getAttribute('src') || '';
              if (imgUrl) { if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl; break; }
            }
          }

          // Like count: prefer like-active state (data loaded), fall back to any count
          // Only accept if it contains a digit — "赞" means data not yet loaded
          const likeActiveEl = card.querySelector('.like-wrapper.like-active .count');
          const likeAnyEl    = card.querySelector('.like-wrapper .count, .count');
          const rawLikeText  = (likeActiveEl ?? likeAnyEl)?.textContent?.trim() ?? '';
          const likeText     = /\d/.test(rawLikeText) ? rawLikeText : '0';
          const cleanLike = likeText.replace(/\s+/g, '').toLowerCase();
          const lm = cleanLike.match(/([\d.]+)/);
          let likes = 0;
          if (lm) {
            const n = parseFloat(lm[1]);
            likes = cleanLike.includes('w') || cleanLike.includes('万') ? Math.round(n * 10000)
                  : cleanLike.includes('k') || cleanLike.includes('千') ? Math.round(n * 1000)
                  : Math.round(n);
          }

          // author: strip trailing date patterns (e.g. "5天前", "02-13", "2025-09-30")
          const stripDate = (s: string) =>
            s.replace(/\s*\d{4}-\d{2}-\d{2}\s*$/, '')
             .replace(/\s*\d{1,2}-\d{2}\s*$/, '')
             .replace(/\s*\d+[天小时分钟][前]?\s*$/, '')
             .trim();
          const authorText = stripDate(
            (() => {
              const span = card.querySelector('.author .user-name, .author .name-wrapper, .author span');
              if (span?.textContent?.trim()) return span.textContent.trim();
              return authorEl?.textContent?.trim() ?? '未知作者';
            })()
          );

          return {
            keyword,
            noteId,
            url: `https://www.xiaohongshu.com/explore/${noteId}`,
            tokenUrl: hrefRaw,  // full URL with xsec_token for navigation
            title: titleEl?.textContent?.trim() ?? '无标题',
            author: authorText,
            likes,
            noteType: (!!card.querySelector(SEARCH_CARD_VIDEO_MARKER) ? '视频' : '图文') as '图文' | '视频',
            coverImage: imgUrl,
          };
        }).filter(Boolean) as Array<{ keyword: string; noteId: string; url: string; tokenUrl: string; title: string; author: string; likes: number; noteType: '图文' | '视频'; coverImage: string }>;
      },
      {
        SEARCH_CARD: SEL.SEARCH_CARD,
        SEARCH_CARD_HREF_PATTERN: SEL.SEARCH_CARD_HREF_PATTERN.source,
        SEARCH_CARD_TITLE: SEL.SEARCH_CARD_TITLE,
        SEARCH_CARD_AUTHOR: SEL.SEARCH_CARD_AUTHOR,
        SEARCH_CARD_LIKE: SEL.SEARCH_CARD_LIKE,
        SEARCH_CARD_VIDEO_MARKER: SEL.SEARCH_CARD_VIDEO_MARKER,
        SEARCH_CARD_IMG: SEL.SEARCH_CARD_IMG,
        keyword,
      },
    );

    const now = new Date().toISOString();
    let addedThisRound = 0;
    for (const item of batch) {
      if (seen.has(item.noteId)) continue;
      seen.add(item.noteId);
      results.push({ ...item, rank: results.length + 1, capturedAt: now });
      addedThisRound++;
      if (results.length >= limit) break;
    }

    if (results.length >= limit) break;
    noNewRounds = addedThisRound === 0 ? noNewRounds + 1 : 0;
    if (noNewRounds >= 3) break;

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await randomDelay(page, 600, 1000);
  }

  return results;
}

// ─── Blogger note feed ────────────────────────────────────────────────────────

export async function captureBloggerNotes(
  page: Page,
  profileUrl: string,
  limit = 0,
): Promise<BloggerNote[]> {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.user-name, .nickname, .user-info', { timeout: 8000 }).catch(() => null);
  await randomDelay(page, 600, 1000);

  if (await checkCaptcha(page)) throw new Error('CAPTCHA_DETECTED');

  // Small scroll to trigger lazy-load
  await page.evaluate(() => { window.scrollTo(0, 100); });
  await randomDelay(page, 800, 1200);

  // Get default author name for fallback
  const authorName = await page.evaluate((selectors) => {
    const el = document.querySelector(selectors);
    return el?.textContent?.trim() ?? '未知博主';
  }, '.user-name, .nickname, .name, .user-info h1');

  const links: BloggerNote[] = [];
  const seen = new Set<string>();
  const maxSteps = limit > 0 ? Math.max(50, Math.ceil(limit / 5) * 6) : 300;
  const scrollIncrement = 500;
  let scrollPosition = 0;
  let attemptsWithoutNew = 0;

  for (let step = 0; step < maxSteps && attemptsWithoutNew < 5; step++) {
    if (await checkCaptcha(page)) throw new Error('CAPTCHA_DETECTED');

    const batch = await page.evaluate(
      ({ FEED_CARD, FEED_CARD_LINK, FEED_CARD_IMG, FEED_CARD_TITLE, FEED_CARD_AUTHOR, authorName }) => {
        const cards = Array.from(document.querySelectorAll(FEED_CARD));
        return cards.map((card) => {
          const linkEl = card.querySelector(FEED_CARD_LINK) as HTMLAnchorElement | null;
          if (!linkEl) return null;

          let href = linkEl.getAttribute('href') ?? '';
          // Remove /user/profile/xxx/ prefix
          href = href.replace(/\/user\/profile\/[^/]+\//, '/');
          const url = href.startsWith('http')
            ? href
            : `https://www.xiaohongshu.com/explore${href}`;

          const idMatch = url.match(/\/(?:explore|note|item)\/([a-zA-Z0-9]+)/);
          const noteId = idMatch ? idMatch[1] : url.split('?')[0].split('/').pop() ?? '';
          if (!noteId) return null;

          let imgUrl = '';
          for (const imgSel of FEED_CARD_IMG) {
            const img = card.querySelector(imgSel) as HTMLImageElement | null;
            if (img) {
              imgUrl = img.getAttribute('data-src') || img.getAttribute('src') || '';
              if (imgUrl) { if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl; break; }
            }
          }

          const titleEl = card.querySelector(FEED_CARD_TITLE);
          const authorEl = card.querySelector(FEED_CARD_AUTHOR);

          // Like count: prefer like-active (data loaded). Only accept if it contains a digit —
          // "赞" means intersection-observer lazy-load hasn't fired yet.
          const likeActiveEl = card.querySelector('.like-wrapper.like-active .count');
          const likeAnyEl    = card.querySelector('.like-wrapper .count, span.count, .count');
          const rawLike      = (likeActiveEl ?? likeAnyEl)?.textContent?.trim() ?? '';
          let likesText      = /\d/.test(rawLike) ? rawLike : '0';

          const clean = likesText.replace(/\s+/g, '').toLowerCase();
          const lm = clean.match(/([\d.]+)/);
          let likes = 0;
          if (lm) {
            const n = parseFloat(lm[1]);
            likes = clean.includes('w') || clean.includes('万') ? Math.round(n * 10000)
                  : clean.includes('k') || clean.includes('千') ? Math.round(n * 1000)
                  : Math.round(n);
          }

          return {
            noteId,
            url: url.split('?')[0],
            title: titleEl?.textContent?.trim() ?? '无标题',
            author: authorEl?.textContent?.trim() ?? authorName,
            likes,
            coverImage: imgUrl,
          };
        }).filter(Boolean);
      },
      {
        FEED_CARD: SEL.FEED_CARD,
        FEED_CARD_LINK: SEL.FEED_CARD_LINK,
        FEED_CARD_IMG: SEL.FEED_CARD_IMG,
        FEED_CARD_TITLE: SEL.FEED_CARD_TITLE,
        FEED_CARD_AUTHOR: SEL.FEED_CARD_AUTHOR,
        authorName,
      },
    ) as Array<{ noteId: string; url: string; title: string; author: string; likes: number; coverImage: string }>;

    let added = 0;
    for (const item of batch) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      links.push({ ...item, capturedAt: new Date().toISOString() });
      added++;
      if (limit > 0 && links.length >= limit) break;
    }
    if (limit > 0 && links.length >= limit) break;

    attemptsWithoutNew = added === 0 ? attemptsWithoutNew + 1 : 0;

    scrollPosition = Math.min(scrollPosition + scrollIncrement,
      await page.evaluate(() => document.body.scrollHeight - window.innerHeight));
    await page.evaluate((pos) => window.scrollTo(0, pos), scrollPosition);

    // Wait for at least one visible card to have a numeric like count loaded
    // (intersection-observer lazy-load on blogger profile pages)
    await page.waitForFunction(() => {
      const counts = Array.from(document.querySelectorAll('.note-item .like-wrapper .count, .note-item .count'));
      return counts.some(el => {
        const rect = el.getBoundingClientRect();
        const inView = rect.top < window.innerHeight && rect.bottom > 0;
        return inView && /\d/.test(el.textContent ?? '');
      });
    }, { timeout: 3000 }).catch(() => { /* accept whatever loaded */ });

    await randomDelay(page, 800, 1200);
  }

  // Final pass at the bottom — only when limit is not yet satisfied (or no limit)
  if (!(limit > 0 && links.length >= limit)) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await randomDelay(page, 800, 1200);

    const finalBatch = await page.evaluate(
      ({ FEED_CARD, FEED_CARD_LINK, FEED_CARD_IMG, FEED_CARD_TITLE, FEED_CARD_AUTHOR, authorName }) => {
        return Array.from(document.querySelectorAll(FEED_CARD)).map((card) => {
          const linkEl = card.querySelector(FEED_CARD_LINK) as HTMLAnchorElement | null;
          if (!linkEl) return null;
          let href = linkEl.getAttribute('href') ?? '';
          href = href.replace(/\/user\/profile\/[^/]+\//, '/');
          const url = href.startsWith('http') ? href : `https://www.xiaohongshu.com/explore${href}`;
          const idMatch = url.match(/\/(?:explore|note|item)\/([a-zA-Z0-9]+)/);
          const noteId = idMatch ? idMatch[1] : '';
          if (!noteId) return null;
          let imgUrl = '';
          for (const s of FEED_CARD_IMG) {
            const img = card.querySelector(s) as HTMLImageElement | null;
            if (img) { imgUrl = img.getAttribute('data-src') || img.getAttribute('src') || ''; if (imgUrl) break; }
          }
          // Read like count the same way as the main loop
          const likeActiveEl = card.querySelector('.like-wrapper.like-active .count');
          const likeAnyEl    = card.querySelector('.like-wrapper .count, span.count, .count');
          const rawLike      = (likeActiveEl ?? likeAnyEl)?.textContent?.trim() ?? '';
          const likesText    = /\d/.test(rawLike) ? rawLike : '0';
          const clean        = likesText.replace(/\s+/g, '').toLowerCase();
          const lm           = clean.match(/([\d.]+)/);
          let likes = 0;
          if (lm) {
            const n = parseFloat(lm[1]);
            likes = clean.includes('w') || clean.includes('万') ? Math.round(n * 10000)
                  : clean.includes('k') || clean.includes('千') ? Math.round(n * 1000)
                  : Math.round(n);
          }
          return { noteId, url: url.split('?')[0], title: card.querySelector(FEED_CARD_TITLE)?.textContent?.trim() ?? '', author: card.querySelector(FEED_CARD_AUTHOR)?.textContent?.trim() ?? authorName, likes, coverImage: imgUrl };
        }).filter(Boolean);
      },
      { FEED_CARD: SEL.FEED_CARD, FEED_CARD_LINK: SEL.FEED_CARD_LINK, FEED_CARD_IMG: SEL.FEED_CARD_IMG, FEED_CARD_TITLE: SEL.FEED_CARD_TITLE, FEED_CARD_AUTHOR: SEL.FEED_CARD_AUTHOR, authorName },
    ) as Array<{ noteId: string; url: string; title: string; author: string; likes: number; coverImage: string }>;

    for (const item of finalBatch) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      links.push({ ...item, capturedAt: new Date().toISOString() });
      if (limit > 0 && links.length >= limit) break;
    }
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  return links;
}

// ─── Blogger info ─────────────────────────────────────────────────────────────

export async function captureBloggerInfo(page: Page, profileUrl: string): Promise<BloggerInfo> {
  const isAlreadyHere = page.url().startsWith(profileUrl.split('?')[0]);
  if (!isAlreadyHere) {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.user-name, .nickname', { timeout: 8000 }).catch(() => null);
  }
  await randomDelay(page, 500, 800);

  if (await checkCaptcha(page)) throw new Error('CAPTCHA_DETECTED');

  const info = await page.evaluate(
    ({ BLOGGER_AVATAR, BLOGGER_NAME, BLOGGER_BIO, BLOGGER_XHS_ID, BLOGGER_FOLLOWERS }) => {
      const firstText = (selectors: string[]): string => {
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el?.textContent?.trim()) return el.textContent.trim();
        }
        return '';
      };

      // Avatar
      let avatarUrl = '';
      for (const s of BLOGGER_AVATAR) {
        const img = document.querySelector(s) as HTMLImageElement | null;
        if (img?.src) { avatarUrl = img.src.replace(/^http:/, 'https:'); break; }
      }

      const bloggerName = firstText(BLOGGER_NAME);
      const description = firstText(BLOGGER_BIO);

      // XHS ID — strip prefix
      let bloggerId = '';
      for (const s of BLOGGER_XHS_ID) {
        const el = document.querySelector(s);
        if (el?.textContent?.trim()) {
          bloggerId = el.textContent.trim().replace(/^(小红书号|小红书ID)[：:]?\s*/, '');
          if (bloggerId) break;
        }
      }
      // XPath fallback
      if (!bloggerId) {
        const r = document.evaluate("//span[contains(text(), '小红书号')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const node = r.singleNodeValue;
        if (node?.textContent) {
          bloggerId = node.textContent.replace(/^(小红书号|小红书ID)[：:]?\s*/, '').trim();
        }
      }

      // Followers
      let followersCount = 0;
      for (const s of BLOGGER_FOLLOWERS) {
        const el = document.querySelector(s);
        if (el) {
          const text = el.textContent?.trim() ?? '';
          // XPath fallback for 粉丝 label
          const m = text.match(/([\d.]+)/);
          if (m) {
            let n = parseFloat(m[1]);
            if (text.includes('万')) n *= 10000;
            else if (text.includes('k') || text.includes('K')) n *= 1000;
            followersCount = Math.floor(n);
            break;
          }
        }
      }
      // XPath fallback for 粉丝
      if (!followersCount) {
        const r = document.evaluate("//div[contains(text(), '粉丝')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const node = r.singleNodeValue;
        if (node?.textContent) {
          const m = node.textContent.match(/([\d.]+)/);
          if (m) {
            let n = parseFloat(m[1]);
            if (node.textContent.includes('万')) n *= 10000;
            followersCount = Math.floor(n);
          }
        }
      }

      return { bloggerName, description, bloggerId, avatarUrl, followersCount };
    },
    {
      BLOGGER_AVATAR: SEL.BLOGGER_AVATAR,
      BLOGGER_NAME: SEL.BLOGGER_NAME,
      BLOGGER_BIO: SEL.BLOGGER_BIO,
      BLOGGER_XHS_ID: SEL.BLOGGER_XHS_ID,
      BLOGGER_FOLLOWERS: SEL.BLOGGER_FOLLOWERS,
    },
  );

  return {
    bloggerUrl: profileUrl,
    ...info,
    capturedAt: new Date().toISOString(),
  };
}
