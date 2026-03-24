import axios, { AxiosInstance } from 'axios';
import { Page } from 'playwright';
import { config } from '../../config/index.js';
import { wait, gaussian } from '../../browser/human.js';

let apiClient: AxiosInstance | null = null;

export function createApiClient(cookies: string, xsToken: string): AxiosInstance {
  apiClient = axios.create({
    baseURL: 'https://edith.xiaohongshu.com',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookies,
      'X-S': xsToken,
      // Use the same desktop UA as the browser — iPhone UA mismatch is detectable
      'User-Agent': config.userAgent,
      'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      'Origin': 'https://www.xiaohongshu.com',
      'Referer': 'https://www.xiaohongshu.com/',
    },
    timeout: 15000,
  });
  return apiClient;
}

export interface ApiNoteDetail {
  id: string;
  title: string;
  desc: string;
  interact_info: {
    liked_count: string;
    collected_count: string;
    comment_count: string;
    share_count: string;
  };
  tag_list: { name: string }[];
  image_list: { url: string }[];
  video?: { media: { stream: { h264: { master_url: string }[] } } };
  time: number;
  user: { nickname: string; userid: string };
}

/**
 * Fetch note detail with exponential backoff on 429/5xx.
 * Retries up to 3 times: 1s → 2s → 4s.
 */
export async function fetchNoteDetail(
  noteId: string,
): Promise<ApiNoteDetail | null> {
  if (!apiClient) throw new Error('API client not initialized');

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await apiClient.get(`/api/sns/web/v1/feed`, {
        params: { source_note_id: noteId },
      });
      return res.data?.data?.items?.[0]?.note_card ?? null;
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      // Retry on rate-limit or server errors
      if (status && (status === 429 || status >= 500) && attempt < maxRetries - 1) {
        const backoff = Math.pow(2, attempt) * 1000 + gaussian(500, 200);
        console.error(`[api/fetcher] ${status} — retrying in ${Math.round(backoff)}ms (attempt ${attempt + 1}/${maxRetries})`);
        await wait(backoff);
        continue;
      }
      console.error('[api/fetcher] fetchNoteDetail error:', err);
      return null;
    }
  }
  return null;
}

export async function extractSessionFromPage(page: Page): Promise<{
  cookies: string;
  xsToken: string;
} | null> {
  try {
    const cookies = await page.context().cookies('https://www.xiaohongshu.com');
    const cookieStr = cookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    const xsToken = await page.evaluate(() => {
      return (
        (window as unknown as Record<string, unknown>)['_xs'] as string ?? ''
      );
    });

    return { cookies: cookieStr, xsToken };
  } catch {
    return null;
  }
}
