/**
 * Browser launcher — uses the system-installed Chrome with a persistent profile.
 *
 * Why persistent + system Chrome instead of headless Chromium:
 *  - Playwright's bundled Chromium is trivially detected (missing real-UA, no history,
 *    missing extensions baseline, and dozens of headless API leaks).
 *  - System Chrome + a persistent user-data-dir accumulates real cookies, localStorage
 *    and a fingerprint that looks identical to a normal human session.
 *  - We never need to export/import cookies manually; Playwright manages them inside
 *    the profile directory automatically.
 */

import { chromium, BrowserContext, Page } from 'playwright';
import { resolve } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { homedir } from 'os';
import { applyStealth } from './stealth.js';

// Persistent profile lives in ~/.xhs-pro-mcp/chrome-profile/
const PROFILE_DIR = resolve(homedir(), '.xhs-pro-mcp', 'chrome-profile');

// macOS Chrome path — Playwright will also check PATH if this doesn't exist
const CHROME_PATH_MACOS = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let contextInstance: BrowserContext | null = null;
// Pending launch promise — prevents concurrent calls from launching two Chrome instances
let pendingLaunch: Promise<BrowserContext> | null = null;

/** Remove stale lock files left by crashed Chrome processes */
function clearStaleLocks(): void {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const p = resolve(PROFILE_DIR, name);
    if (existsSync(p)) {
      try { rmSync(p); } catch { /* ignore */ }
    }
  }
}

export async function getContext(headless = true): Promise<BrowserContext> {
  if (contextInstance) return contextInstance;
  // Return the in-flight launch so concurrent callers don't each try to open Chrome
  if (pendingLaunch) return pendingLaunch;

  pendingLaunch = (async () => {
  mkdirSync(PROFILE_DIR, { recursive: true });
  clearStaleLocks();

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    // Use the real installed Chrome, not Playwright's bundled Chromium
    channel: 'chrome',
    executablePath: process.platform === 'darwin' ? CHROME_PATH_MACOS : undefined,

    headless,

    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-infobars',
      '--disable-notifications',
      '--disable-dev-shm-usage',
    ],

    // Slightly randomize viewport each launch to avoid fingerprint consistency
    viewport: {
      width:  1440 + Math.floor(Math.random() * 40) - 20,  // 1420-1460
      height:  900 + Math.floor(Math.random() * 40) - 20,  //  880-920
    },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',

    // Pick a recent Chrome version from a realistic pool
    userAgent: (() => {
      const versions = ['122.0.0.0', '123.0.0.0', '124.0.0.0', '125.0.0.0', '126.0.0.0'];
      const ver = versions[Math.floor(Math.random() * versions.length)];
      return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
    })(),

    // Ignore HTTPS errors from XHS CDN subdomains
    ignoreHTTPSErrors: true,
  });

  await applyStealth(ctx);

  // Inject __name helper — required by Vite-bundled pages (e.g. XHS signV2Init).
  // Without it, page.evaluate() may throw "ReferenceError: __name is not defined".
  await ctx.addInitScript(() => {
    if (typeof (window as unknown as Record<string, unknown>).__name !== 'function') {
      (window as unknown as Record<string, unknown>).__name =
        (fn: unknown, _name: string) => fn;
    }
  });

  contextInstance = ctx;
  pendingLaunch = null;
  return ctx;
  })();

  return pendingLaunch;
}

/**
 * Open a new tab in the shared persistent context.
 * Caller is responsible for calling page.close() when done.
 */
export async function newPage(headless = true): Promise<Page> {
  const ctx = await getContext(headless);
  return ctx.newPage();
}

/**
 * Close browser and reset singleton — call before re-login.
 */
export async function closeBrowser(): Promise<void> {
  pendingLaunch = null;
  if (contextInstance) {
    await contextInstance.close();
    contextInstance = null;
  }
}

export function isBrowserOpen(): boolean {
  return contextInstance !== null;
}
