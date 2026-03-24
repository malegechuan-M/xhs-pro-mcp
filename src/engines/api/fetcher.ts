import axios, { AxiosInstance } from 'axios';
import { Page } from 'playwright';

let apiClient: AxiosInstance | null = null;

export function createApiClient(cookies: string, xsToken: string): AxiosInstance {
  apiClient = axios.create({
    baseURL: 'https://edith.xiaohongshu.com',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookies,
      'X-S': xsToken,
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
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

export async function fetchNoteDetail(
  noteId: string,
): Promise<ApiNoteDetail | null> {
  if (!apiClient) throw new Error('API client not initialized');
  try {
    const res = await apiClient.get(`/api/sns/web/v1/feed`, {
      params: { source_note_id: noteId },
    });
    return res.data?.data?.items?.[0]?.note_card ?? null;
  } catch (err) {
    console.error('[api/fetcher] fetchNoteDetail error:', err);
    return null;
  }
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
