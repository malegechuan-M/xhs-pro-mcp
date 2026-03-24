import { BrowserContext } from 'playwright';

/**
 * Additional stealth patches injected into every page.
 * System Chrome already avoids most headless tells, but we patch the
 * remaining automation-specific properties to be safe.
 */
export async function applyStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // Remove webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // Realistic plugins list
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin' },
        { name: 'Chrome PDF Viewer' },
        { name: 'Native Client' },
      ],
    });

    // Realistic language list
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
    });

    // chrome object expected by XHS JS
    if (!(window as unknown as Record<string, unknown>)['chrome']) {
      (window as unknown as Record<string, unknown>)['chrome'] = {
        runtime: {},
        loadTimes: () => ({}),
        csi: () => ({}),
        app: {},
      };
    }

    // Spoof notification permission query (common bot detection probe)
    const origQuery = window.navigator.permissions?.query?.bind(
      window.navigator.permissions,
    );
    if (origQuery) {
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: 'denied' } as PermissionStatus)
          : origQuery(params);
    }

    // Hide Playwright-specific globals
    delete (window as unknown as Record<string, unknown>)['__playwright'];
    delete (window as unknown as Record<string, unknown>)['__pw_manual'];
  });
}
