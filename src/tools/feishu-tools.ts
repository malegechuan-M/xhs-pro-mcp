import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync } from 'fs';
import { feishuClient } from '../feishu/client.js';
import { config } from '../config/index.js';

export function registerFeishuTools(server: McpServer): void {
  // ── test_feishu_connection ───────────────────────────────────────────────────
  server.tool(
    'xhs_test_feishu',
    'Test Feishu connection and verify all 4 table IDs are accessible.',
    {},
    async () => {
      const lines: string[] = ['## 飞书连接测试\n'];

      if (!config.feishu.appId || !config.feishu.appSecret) {
        lines.push('❌ appId / appSecret 未配置 — 请填写 config/feishu.json');
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      // Auth token
      try {
        await feishuClient.request('get', '/auth/v3/tenant_access_token/internal');
        lines.push(`✅ 认证成功 (appId: ${config.feishu.appId})`);
      } catch (err) {
        lines.push(`❌ 认证失败: ${err instanceof Error ? err.message : err}`);
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      if (!config.feishu.appToken) {
        lines.push('⚠️  appToken 未配置，跳过表格验证');
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      // Check each table
      const tableNames = ['采集库', '关键词战情库', '博主笔记库', '博主库'] as const;
      for (const name of tableNames) {
        const tId = config.feishu.tables[name];
        if (!tId) {
          lines.push(`⚠️  ${name}: 未配置 tableId`);
          continue;
        }
        try {
          await feishuClient.listRecords(config.feishu.appToken, tId);
          lines.push(`✅ ${name} (${tId}): 可访问`);
        } catch (err) {
          lines.push(`❌ ${name} (${tId}): ${err instanceof Error ? err.message : err}`);
        }
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );

  // ── upload_images_to_feishu ──────────────────────────────────────────────────
  server.tool(
    'xhs_upload_images_to_feishu',
    'Upload local image files to a Feishu Bitable attachment field.',
    {
      localFilePaths: z.array(z.string()).describe('Local file paths to upload'),
      tableId: z.string().describe('Target Feishu table ID'),
      recordId: z.string().describe('Target record ID'),
      fieldId: z.string().describe('Attachment field ID in the table'),
    },
    async ({ localFilePaths, tableId, recordId, fieldId }) => {
      const appToken = config.feishu.appToken;
      if (!appToken) {
        return {
          content: [{
            type: 'text' as const,
            text: '❌ appToken 未配置，请填写 config/feishu.json',
          }],
        };
      }

      const fileTokens: { localPath: string; fileToken: string; fileName: string }[] = [];
      const failedFiles: { localPath: string; error: string }[] = [];

      for (const filePath of localFilePaths) {
        try {
          const buf = readFileSync(filePath);
          const fileName = filePath.split('/').pop() ?? 'file';
          const mimeType = fileName.endsWith('.mp4') ? 'video/mp4'
                         : fileName.endsWith('.webp') ? 'image/webp'
                         : 'image/jpeg';

          const token = await feishuClient.uploadMedia(
            appToken, tableId, fieldId, recordId, fileName, buf, mimeType,
          );
          fileTokens.push({ localPath: filePath, fileToken: token, fileName });
        } catch (err) {
          failedFiles.push({
            localPath: filePath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const lines = [
        `**上传结果**: ${fileTokens.length}/${localFilePaths.length} 成功`,
        ...fileTokens.map((f) => `✅ ${f.fileName} → ${f.fileToken}`),
        ...failedFiles.map((f) => `❌ ${f.localPath}: ${f.error}`),
      ];
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
