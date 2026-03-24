/**
 * xhs_setup — First-run setup wizard.
 *
 * Checks Feishu config + XHS login status in one call.
 * - Feishu not configured → guides user to provide credentials, auto-discovers tables/fields
 * - XHS not logged in     → opens visible browser, waits for QR scan, verifies success
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import axios from 'axios';
import { newPage, closeBrowser } from '../browser/launcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '../../');
const CONFIG_PATH = resolve(ROOT_DIR, 'config/feishu.json');
const XHS_HOME = 'https://www.xiaohongshu.com';

// ── Feishu API helpers ────────────────────────────────────────────────────────

async function getTenantToken(appId: string, appSecret: string): Promise<string> {
  const res = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: appId, app_secret: appSecret },
    { timeout: 10000 },
  );
  if (res.data.code !== 0) throw new Error(`Auth failed: ${res.data.msg}`);
  return res.data.tenant_access_token;
}

async function feishuGet<T>(token: string, path: string): Promise<T> {
  const res = await axios.get(`https://open.feishu.cn/open-apis${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000,
  });
  if (res.data.code !== 0) throw new Error(`API error [${res.data.code}]: ${res.data.msg}`);
  return res.data.data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TABLE_KEY_MAP: Record<string, string> = {
  '采集库': '采集库',
  '关键词战情库': '关键词战情库',
  '博主笔记库': '博主笔记库',
  '博主库': '博主库',
};

/** Verify XHS session by headlessly navigating to homepage */
async function checkXhsSession(): Promise<'logged_in' | 'not_logged_in' | 'error'> {
  try {
    const page = await newPage(true);
    await page.goto(XHS_HOME, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    const url = page.url();
    await page.close();
    return url.includes('/login') ? 'not_logged_in' : 'logged_in';
  } catch {
    return 'error';
  }
}

/** Open visible browser, wait for user to scan QR and complete login */
async function doXhsLogin(timeoutSeconds: number): Promise<'success' | 'timeout' | 'error'> {
  try {
    await closeBrowser();
    const page = await newPage(false);
    await page.goto(`${XHS_HOME}/login`, { waitUntil: 'domcontentloaded' });

    try {
      await page.waitForURL((url) => !url.href.includes('/login'), {
        timeout: timeoutSeconds * 1000,
      });
      await page.waitForTimeout(2000);
      await page.close();
      return 'success';
    } catch {
      await page.close();
      return 'timeout';
    }
  } catch {
    return 'error';
  }
}

// ── Register ──────────────────────────────────────────────────────────────────

export function registerSetupTool(server: McpServer): void {
  server.tool(
    'xhs_setup',
    [
      'First-run setup wizard — checks and configures everything needed to start.',
      'Call with no arguments to run the full setup check (Feishu + XHS login).',
      'If XHS is not logged in, this tool will automatically open the browser for QR code scanning and wait.',
      'Provide Feishu credentials to auto-configure tables and field names.',
    ].join(' '),
    {
      feishu_app_id:       z.string().optional().describe('Feishu App ID'),
      feishu_app_secret:   z.string().optional().describe('Feishu App Secret'),
      feishu_app_token:    z.string().optional().describe('Feishu 多维表格 Base Token'),
      table_caiji:         z.string().optional().describe('Table ID for 采集库'),
      table_keyword:       z.string().optional().describe('Table ID for 关键词战情库'),
      table_blogger_notes: z.string().optional().describe('Table ID for 博主笔记库'),
      table_blogger:       z.string().optional().describe('Table ID for 博主库'),
      login_timeout:       z.number().optional().describe('Seconds to wait for QR scan (default: 120)'),
    },
    async ({
      feishu_app_id, feishu_app_secret, feishu_app_token,
      table_caiji, table_keyword, table_blogger_notes, table_blogger,
      login_timeout = 120,
    }) => {
      const lines: string[] = ['# XHS Pro MCP 初始化向导\n'];

      // ── Load / merge config ───────────────────────────────────────────────
      let cfg: Record<string, unknown> = {
        appId: '', appSecret: '', appToken: '',
        tables: { '采集库': '', '关键词战情库': '', '博主笔记库': '', '博主库': '' },
        fields: {},
      };
      if (existsSync(CONFIG_PATH)) {
        try { cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { /* ignore */ }
      }

      if (feishu_app_id)     cfg.appId     = feishu_app_id;
      if (feishu_app_secret) cfg.appSecret = feishu_app_secret;
      if (feishu_app_token)  cfg.appToken  = feishu_app_token;

      const tables = (cfg.tables ?? {}) as Record<string, string>;
      if (table_caiji)         tables['采集库']       = table_caiji;
      if (table_keyword)       tables['关键词战情库']  = table_keyword;
      if (table_blogger_notes) tables['博主笔记库']    = table_blogger_notes;
      if (table_blogger)       tables['博主库']        = table_blogger;
      cfg.tables = tables;

      const providingCredentials = !!(feishu_app_id || feishu_app_secret || feishu_app_token
        || table_caiji || table_keyword || table_blogger_notes || table_blogger);

      // ═══════════════════════════════════════════════════════════════════════
      // STEP 1: 飞书配置
      // ═══════════════════════════════════════════════════════════════════════
      lines.push('## 步骤 1/2 — 飞书配置\n');

      const hasAppCredentials = !!(cfg.appId && cfg.appSecret);
      const hasAppToken = !!cfg.appToken;

      if (!hasAppCredentials) {
        lines.push('❌ **appId / appSecret** 未配置');
        lines.push('   → 前往 https://open.feishu.cn → 创建应用 → 复制 App ID 和 App Secret');
        lines.push('   → 再次调用: `xhs_setup(feishu_app_id="cli_xxx", feishu_app_secret="xxx", feishu_app_token="xxx")`\n');
      } else if (!hasAppToken) {
        lines.push(`✅ appId: ${cfg.appId}`);
        lines.push('❌ **appToken** 未配置');
        lines.push('   → 打开飞书多维表格，URL 中 `/base/` 后面的字符串即为 appToken');
        lines.push('   → 例: https://xxx.feishu.cn/base/**IFS4wccxjij...**');
        lines.push('   → 再次调用: `xhs_setup(feishu_app_token="IFS4xxx")`\n');
      } else {
        lines.push(`✅ appId: ${cfg.appId}`);
        lines.push(`✅ appToken: ${cfg.appToken}\n`);

        // Verify API connection
        let tenantToken = '';
        try {
          tenantToken = await getTenantToken(String(cfg.appId), String(cfg.appSecret));
          lines.push('✅ 飞书 API 认证成功\n');
        } catch (e) {
          lines.push(`❌ 飞书 API 认证失败: ${e instanceof Error ? e.message : e}`);
          lines.push('   → 请检查 appId / appSecret 是否正确\n');
        }

        if (tenantToken) {
          // Auto-discover tables
          try {
            const data = await feishuGet<{ items: { table_id: string; name: string }[] }>(
              tenantToken, `/bitable/v1/apps/${cfg.appToken}/tables`,
            );
            const apiTables = data.items ?? [];
            lines.push(`发现 ${apiTables.length} 个表格:`);
            for (const t of apiTables) {
              const key = TABLE_KEY_MAP[t.name];
              if (key && !tables[key]) {
                tables[key] = t.table_id;
                lines.push(`  ✅ 自动匹配 **${t.name}** → ${t.table_id}`);
              } else if (key) {
                lines.push(`  ✅ **${t.name}**: ${tables[key]}`);
              } else {
                lines.push(`  ⚠️  **${t.name}** (${t.table_id}) — 未在配置中使用`);
              }
            }
            const missing = Object.entries(tables).filter(([, v]) => !v).map(([k]) => k);
            if (missing.length > 0) {
              lines.push(`\n⚠️  未找到: ${missing.join('、')} — 请在飞书中创建这些表格`);
            }
            lines.push('');
          } catch (e) {
            lines.push(`❌ 获取表格失败: ${e instanceof Error ? e.message : e}\n`);
          }

          // Show field info for each configured table
          const allTablesReady = Object.values(tables).every(Boolean);
          if (allTablesReady) {
            for (const [tableName, tableId] of Object.entries(tables)) {
              try {
                const fd = await feishuGet<{ items: { field_name: string; ui_type: string }[] }>(
                  tenantToken, `/bitable/v1/apps/${cfg.appToken}/tables/${tableId}/fields`,
                );
                const names = (fd.items ?? []).map((f) => `${f.field_name}(${f.ui_type})`).join(', ');
                lines.push(`📋 **${tableName}**: ${names}`);
              } catch { /* skip */ }
            }
            lines.push('');
          }
        }
      }

      // Save config if anything changed
      if (providingCredentials) {
        try {
          const existing = existsSync(CONFIG_PATH)
            ? JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) : {};
          writeFileSync(CONFIG_PATH, JSON.stringify({
            ...existing,
            appId: cfg.appId, appSecret: cfg.appSecret, appToken: cfg.appToken,
            tables: cfg.tables,
            _comment: existing._comment ?? 'fields 右边是飞书实际字段名，按需修改，左边不要动',
            fields: existing.fields ?? {},
          }, null, 2), 'utf-8');
          lines.push('💾 配置已保存 → config/feishu.json\n');
        } catch (e) {
          lines.push(`❌ 保存配置失败: ${e instanceof Error ? e.message : e}\n`);
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // STEP 2: 小红书登录
      // ═══════════════════════════════════════════════════════════════════════
      lines.push('## 步骤 2/2 — 小红书登录\n');

      lines.push('🔍 检查登录状态...');
      const sessionStatus = await checkXhsSession();

      if (sessionStatus === 'logged_in') {
        lines.push('✅ **已登录** — 会话有效\n');
      } else {
        if (sessionStatus === 'not_logged_in') {
          lines.push('❌ **未登录** — 即将打开浏览器扫码');
        } else {
          lines.push('⚠️  **会话检测失败** — 尝试重新登录');
        }
        lines.push(`\n📱 **正在打开浏览器，请在 ${login_timeout} 秒内扫描二维码...**\n`);

        const loginResult = await doXhsLogin(login_timeout);

        if (loginResult === 'success') {
          // Verify the session is actually valid after login
          const verify = await checkXhsSession();
          if (verify === 'logged_in') {
            lines.push('✅ **登录成功** — 会话已保存\n');
          } else {
            lines.push('⚠️  **登录后验证未通过** — 请重新调用 `xhs_setup` 再试\n');
          }
        } else if (loginResult === 'timeout') {
          lines.push(`❌ **扫码超时**（${login_timeout}秒内未完成）`);
          lines.push('   → 请重新调用 `xhs_setup` 再次尝试\n');
        } else {
          lines.push('❌ **打开浏览器失败**');
          lines.push('   → 请手动调用 `xhs_login` 再次尝试\n');
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // SUMMARY
      // ═══════════════════════════════════════════════════════════════════════
      const feishuReady = !!(cfg.appId && cfg.appSecret && cfg.appToken
        && Object.values(tables).every(Boolean));
      const xhsReady = sessionStatus === 'logged_in'
        || lines.some((l) => l.includes('登录成功'));

      lines.push('---');
      if (feishuReady && xhsReady) {
        lines.push('\n🎉 **全部配置完成，可以开始使用！**\n');
        lines.push('常用操作:');
        lines.push('- 关键词采集: `xhs_capture_and_sync(type="keyword", target="关键词")`');
        lines.push('- 博主采集:   `xhs_capture_and_sync(type="blogger", target="博主主页URL")`');
        lines.push('- 单篇笔记:   `xhs_capture_and_sync(type="note", target="笔记URL")`');
      } else {
        lines.push('\n⚠️  **配置未完成，请按提示处理后重新调用 `xhs_setup`**');
        if (!feishuReady) lines.push('- 飞书配置缺失');
        if (!xhsReady)    lines.push('- 小红书未登录');
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
