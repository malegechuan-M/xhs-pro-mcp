import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '../../');

// ~/.xhs-pro-mcp/ is the runtime data directory (outside the project repo)
const DATA_DIR = resolve(homedir(), '.xhs-pro-mcp');

// ── Field name maps (configurable, loaded from feishu.json) ──────────────────

export interface FeishuFieldMaps {
  采集库: Record<string, string>;
  关键词战情库: Record<string, string>;
  博主笔记库: Record<string, string>;
  博主库: Record<string, string>;
}

// Default field names — used as fallback if feishu.json has no "fields" section
const DEFAULT_FIELDS: FeishuFieldMaps = {
  采集库: {
    noteId: '笔记ID', url: '原始链接', title: '标题', content: '正文',
    author: '作者', authorUrl: '作者主页', likeCount: '点赞数',
    collectCount: '收藏数', commentCount: '评论数', tags: '标签',
    noteType: '笔记类型', imageCount: '图片数量', videoUrl: '视频链接',
    publishTime: '发布时间', capturedAt: '采集时间',
  },
  关键词战情库: {
    keyword: '关键词', rank: '排名', noteId: '笔记ID', url: '原始链接',
    title: '标题', author: '作者', likeCount: '点赞数', noteType: '笔记类型',
    coverImage: '封面图', capturedAt: '采集时间',
  },
  博主笔记库: {
    noteId: '笔记ID', url: '原始链接', title: '标题', author: '作者',
    likeCount: '点赞数', coverImage: '封面图', capturedAt: '采集时间',
  },
  博主库: {
    bloggerUrl: '博主主页', bloggerName: '博主名称', bloggerId: '小红书号',
    description: '简介', avatarUrl: '头像链接', followersCount: '粉丝数',
    capturedAt: '采集时间',
  },
};

// ── Config interfaces ─────────────────────────────────────────────────────────

export interface FeishuTableConfig {
  appId: string;
  appSecret: string;
  appToken: string;
  tables: {
    采集库: string;
    关键词战情库: string;
    博主笔记库: string;
    博主库: string;
  };
  fields: FeishuFieldMaps;
}

export interface AppConfig {
  feishu: FeishuTableConfig;
  profileDir: string;
  downloadsDir: string;
  headless: boolean;
  userAgent: string;
  viewport: { width: number; height: number };
}

// ── Loader ────────────────────────────────────────────────────────────────────

function loadFeishuConfig(): FeishuTableConfig {
  const configPath = resolve(ROOT_DIR, 'config/feishu.json');
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    return {
      appId:     raw.appId     ?? process.env.FEISHU_APP_ID     ?? '',
      appSecret: raw.appSecret ?? process.env.FEISHU_APP_SECRET ?? '',
      appToken:  raw.appToken  ?? process.env.FEISHU_APP_TOKEN  ?? '',
      tables: {
        采集库:      raw.tables?.采集库      ?? raw.tableId ?? process.env.FEISHU_TABLE_CAIJI          ?? '',
        关键词战情库: raw.tables?.关键词战情库 ?? process.env.FEISHU_TABLE_KEYWORD        ?? '',
        博主笔记库:   raw.tables?.博主笔记库   ?? process.env.FEISHU_TABLE_BLOGGER_NOTES  ?? '',
        博主库:      raw.tables?.博主库      ?? process.env.FEISHU_TABLE_BLOGGER         ?? '',
      },
      // Merge config fields over defaults so partial configs still work
      fields: {
        采集库:      { ...DEFAULT_FIELDS.采集库,      ...(raw.fields?.采集库      ?? {}) },
        关键词战情库: { ...DEFAULT_FIELDS.关键词战情库, ...(raw.fields?.关键词战情库 ?? {}) },
        博主笔记库:   { ...DEFAULT_FIELDS.博主笔记库,   ...(raw.fields?.博主笔记库   ?? {}) },
        博主库:      { ...DEFAULT_FIELDS.博主库,      ...(raw.fields?.博主库      ?? {}) },
      },
    };
  }
  return {
    appId:     process.env.FEISHU_APP_ID     ?? '',
    appSecret: process.env.FEISHU_APP_SECRET ?? '',
    appToken:  process.env.FEISHU_APP_TOKEN  ?? '',
    tables: {
      采集库:      process.env.FEISHU_TABLE_CAIJI         ?? '',
      关键词战情库: process.env.FEISHU_TABLE_KEYWORD       ?? '',
      博主笔记库:   process.env.FEISHU_TABLE_BLOGGER_NOTES ?? '',
      博主库:      process.env.FEISHU_TABLE_BLOGGER        ?? '',
    },
    fields: DEFAULT_FIELDS,
  };
}

export const config: AppConfig = {
  feishu: loadFeishuConfig(),
  profileDir:   resolve(DATA_DIR, 'chrome-profile'),
  downloadsDir: resolve(DATA_DIR, 'downloads'),
  headless: process.env.HEADLESS !== 'false',
  userAgent: (() => {
    const versions = ['122.0.0.0', '123.0.0.0', '124.0.0.0', '125.0.0.0', '126.0.0.0'];
    const ver = versions[Math.floor(Math.random() * versions.length)];
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
  })(),
  viewport: { width: 1440, height: 900 },
};
