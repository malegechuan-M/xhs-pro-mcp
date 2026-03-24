import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { newPage, isBrowserOpen } from '../browser/launcher.js';
import { feishuClient } from '../feishu/client.js';
import { config } from '../config/index.js';
import { listDownloads, getTotalSize, formatBytes } from '../media/file-manager.js';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const XHS_HOME = 'https://www.xiaohongshu.com';
const PROFILE_DIR = resolve(homedir(), '.xhs-pro-mcp', 'chrome-profile');

export function registerCheckStatusTool(server: McpServer): void {
  server.tool(
    'xhs_check_status',
    'Check XHS login status, Feishu connection, and local storage statistics.',
    {},
    async () => {
      const lines: string[] = ['## XHS Pro MCP Status\n'];

      // ── 1. Chrome profile ──────────────────────────────────────────
      const profileExists = existsSync(PROFILE_DIR);
      if (!profileExists) {
        lines.push('**Login**: No Chrome profile found — run xhs_login first');
      } else {
        lines.push(`**Chrome profile**: ${PROFILE_DIR}`);

        // Quick session verification
        try {
          const page = await newPage(true /* headless */);
          await page.goto(XHS_HOME, { waitUntil: 'domcontentloaded', timeout: 15000 });
          const url = page.url();
          const loggedIn = !url.includes('/login');
          lines.push(`**Session**: ${loggedIn ? 'Active (verified)' : 'Expired — run xhs_login to re-authenticate'}`);
          await page.close();
        } catch {
          lines.push('**Session**: Unable to verify (browser error)');
        }
      }

      lines.push(`**Browser**: ${isBrowserOpen() ? 'Running' : 'Not running'}`);

      // ── 2. Feishu ──────────────────────────────────────────────────
      if (!config.feishu.appId || !config.feishu.appSecret) {
        lines.push('\n**Feishu**: Not configured (missing appId/appSecret in config/feishu.json)');
      } else {
        try {
          // Use a real GET endpoint to verify connectivity (auth token test + table list)
          await feishuClient.listRecords(config.feishu.appToken, config.feishu.tables['采集库'], undefined);
          lines.push(`\n**Feishu**: Connected (appId: ${config.feishu.appId})`);
          const tables = config.feishu.tables;
          lines.push(`  - 采集库: ${tables['采集库'] || '(not set)'}`);
          lines.push(`  - 关键词战情库: ${tables['关键词战情库'] || '(not set)'}`);
          lines.push(`  - 博主笔记库: ${tables['博主笔记库'] || '(not set)'}`);
          lines.push(`  - 博主库: ${tables['博主库'] || '(not set)'}`);
        } catch (err) {
          lines.push(`\n**Feishu**: Connection failed — ${err instanceof Error ? err.message : err}`);
        }
      }

      // ── 3. Downloads ───────────────────────────────────────────────
      const files = listDownloads();
      lines.push(`\n**Downloads**: ${files.length} files, ${formatBytes(getTotalSize())}`);

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );
}
