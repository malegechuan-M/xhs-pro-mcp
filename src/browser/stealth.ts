import { BrowserContext } from 'playwright';

/**
 * Additional stealth patches injected into every page.
 * System Chrome already avoids most headless tells, but we patch the
 * remaining automation-specific properties to be safe.
 */
export async function applyStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // ── Remove webdriver flag ──
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

    // ── Realistic plugins list ──
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin' },
        { name: 'Chrome PDF Viewer' },
        { name: 'Native Client' },
      ],
    });

    // ── Realistic language list ──
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
    });

    // ── chrome object expected by XHS JS ──
    if (!(window as unknown as Record<string, unknown>)['chrome']) {
      (window as unknown as Record<string, unknown>)['chrome'] = {
        runtime: {},
        loadTimes: () => ({}),
        csi: () => ({}),
        app: {},
      };
    }

    // ── Spoof notification permission query (common bot detection probe) ──
    const origQuery = window.navigator.permissions?.query?.bind(
      window.navigator.permissions,
    );
    if (origQuery) {
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: 'denied' } as PermissionStatus)
          : origQuery(params);
    }

    // ── Hide Playwright-specific globals ──
    delete (window as unknown as Record<string, unknown>)['__playwright'];
    delete (window as unknown as Record<string, unknown>)['__pw_manual'];

    // ── Canvas fingerprint noise ──
    // Inject tiny per-session noise into canvas readback so each session
    // produces a unique-but-consistent fingerprint.
    const seed = Math.floor(Math.random() * 0xFFFF);
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type?: string, quality?: unknown) {
      const ctx2d = this.getContext('2d');
      if (ctx2d && this.width > 0 && this.height > 0) {
        try {
          const imageData = ctx2d.getImageData(0, 0, this.width, this.height);
          const d = imageData.data;
          // Apply deterministic but subtle noise to a subset of pixels
          for (let i = 0; i < d.length; i += 4) {
            // Use a simple hash of index + seed for determinism within session
            const noise = ((i * 31 + seed) % 5) - 2; // -2 to +2
            d[i]     = Math.max(0, Math.min(255, d[i] + noise));     // R
            d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + noise)); // G
          }
          ctx2d.putImageData(imageData, 0, 0);
        } catch { /* CORS canvas — ignore */ }
      }
      return origToDataURL.call(this, type, quality as number);
    };

    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (
      cb: BlobCallback, type?: string, quality?: number,
    ) {
      // Trigger noise via toDataURL path first
      this.toDataURL(type, quality);
      return origToBlob.call(this, cb, type, quality);
    };

    // ── WebGL renderer/vendor spoofing ──
    const getParamOrig = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param: number) {
      // UNMASKED_VENDOR_WEBGL = 0x9245, UNMASKED_RENDERER_WEBGL = 0x9246
      if (param === 0x9245) return 'Google Inc. (Apple)';
      if (param === 0x9246) return 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)';
      return getParamOrig.call(this, param);
    };

    const getParam2Orig = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (param: number) {
      if (param === 0x9245) return 'Google Inc. (Apple)';
      if (param === 0x9246) return 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)';
      return getParam2Orig.call(this, param);
    };

    // ── Hide automation-related properties ──
    // Some detection scripts check window.callPhantom, _phantom, etc.
    for (const prop of [
      'callPhantom', '_phantom', '__nightmare', 'domAutomation',
      'domAutomationController', '_Selenium_IDE_Recorder',
    ]) {
      delete (window as unknown as Record<string, unknown>)[prop];
    }
  });
}
