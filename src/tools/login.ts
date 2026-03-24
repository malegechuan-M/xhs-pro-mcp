import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { newPage, closeBrowser } from '../browser/launcher.js';

const XHS_HOME = 'https://www.xiaohongshu.com';

export function registerLoginTool(server: McpServer): void {
  server.tool(
    'xhs_login',
    'Open XiaoHongShu in a visible browser window and wait for manual login. ' +
    'The persistent Chrome profile saves the session automatically — no cookies file needed.',
    {
      timeoutSeconds: z
        .number()
        .optional()
        .describe('Seconds to wait for the user to complete login (default: 120)'),
    },
    async ({ timeoutSeconds = 120 }) => {
      // Close any existing headless session so Chrome opens visibly
      await closeBrowser();

      const page = await newPage(false /* headless = false */);
      await page.goto(`${XHS_HOME}/login`, { waitUntil: 'domcontentloaded' });

      try {
        await page.waitForURL((url) => !url.href.includes('/login'), {
          timeout: timeoutSeconds * 1000,
        });
      } catch {
        await page.close();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Login timed out after ${timeoutSeconds}s. Please try xhs_login again.`,
            },
          ],
        };
      }

      // Give XHS JS a moment to write all session data
      await page.waitForTimeout(2000);
      await page.close();

      return {
        content: [
          {
            type: 'text' as const,
            text: 'Login successful. Session saved in persistent Chrome profile (~/.xhs-pro-mcp/chrome-profile/).',
          },
        ],
      };
    },
  );

  server.tool(
    'xhs_logout',
    'Close the browser and clear the persistent Chrome profile (full logout).',
    {},
    async () => {
      await closeBrowser();
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Browser closed. Run xhs_login to start a fresh session.',
          },
        ],
      };
    },
  );
}
