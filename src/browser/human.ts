/**
 * Human behavior simulator — makes browser interactions look natural.
 *
 * Provides humanMove, humanClick, humanType, humanScroll and timing helpers.
 * All tool code should call these instead of raw Playwright APIs.
 */

import { Page, Locator } from 'playwright';

// ─── Gaussian random ────────────────────────────────────────────────

/** Box-Muller transform: returns a sample from N(mean, stddev), clamped to [0, mean×3]. */
export function gaussian(mean: number, stddev?: number): number {
  const sd = stddev ?? mean * 0.3;
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.min(mean * 3, Math.max(0, mean + z * sd));
}

// ─── Semantic delays ────────────────────────────────────────────────

/** Short hesitation before an action (200-400ms center). */
export const HESITATE = () => gaussian(300, 80);
/** Quick glance at something (400-700ms center). */
export const GLANCE   = () => gaussian(550, 120);
/** Reading / thinking pause (1.5-2.5s center). */
export const THINK    = () => gaussian(2000, 400);
/** Rest between two items (4-7s center). */
export const REST     = () => gaussian(5500, 1200);

export async function wait(ms: number): Promise<void> {
  await new Promise(r => setTimeout(r, ms));
}

export async function semanticWait(fn: () => number): Promise<void> {
  await wait(fn());
}

// ─── Bézier mouse movement ─────────────────────────────────────────

interface Point { x: number; y: number }

/** Cubic Bézier interpolation. */
function bezierPoint(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Generate a human-like mouse path using a cubic Bézier curve. */
function generatePath(from: Point, to: Point, steps = 20): Point[] {
  // Two random control points that create a natural arc
  const cp1: Point = {
    x: from.x + (to.x - from.x) * (0.2 + Math.random() * 0.3),
    y: from.y + (to.y - from.y) * (0.1 + Math.random() * 0.4) + (Math.random() - 0.5) * 80,
  };
  const cp2: Point = {
    x: from.x + (to.x - from.x) * (0.5 + Math.random() * 0.3),
    y: from.y + (to.y - from.y) * (0.6 + Math.random() * 0.3) + (Math.random() - 0.5) * 80,
  };
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push(bezierPoint(i / steps, from, cp1, cp2, to));
  }
  return points;
}

/** Move mouse along a Bézier curve to (x, y). */
async function moveMouseTo(page: Page, x: number, y: number): Promise<void> {
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  // Start from a "last known" position (center-ish if unknown)
  const from: Point = { x: vp.width * (0.3 + Math.random() * 0.4), y: vp.height * (0.3 + Math.random() * 0.4) };
  const to: Point = { x, y };
  const path = generatePath(from, to, 15 + Math.floor(Math.random() * 10));

  for (const pt of path) {
    await page.mouse.move(pt.x, pt.y);
    await wait(5 + Math.random() * 12); // 5-17ms between steps
  }
}

// ─── Human click ────────────────────────────────────────────────────

/**
 * Move mouse to element with Bézier curve, hover briefly, then click
 * at a random offset within the element (not dead center).
 */
export async function humanClick(page: Page, selector: string): Promise<void> {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 10_000 });
  const box = await el.boundingBox();
  if (!box) throw new Error(`Element not visible: ${selector}`);

  // Random point inside the element (avoid edges)
  const padX = box.width * 0.15;
  const padY = box.height * 0.15;
  const targetX = box.x + padX + Math.random() * (box.width - 2 * padX);
  const targetY = box.y + padY + Math.random() * (box.height - 2 * padY);

  await moveMouseTo(page, targetX, targetY);
  await wait(gaussian(120, 40)); // brief hover before click
  await page.mouse.click(targetX, targetY);
}

/**
 * Same as humanClick but accepts a Locator directly.
 */
export async function humanClickLocator(page: Page, locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element not visible for click');

  const padX = box.width * 0.15;
  const padY = box.height * 0.15;
  const targetX = box.x + padX + Math.random() * (box.width - 2 * padX);
  const targetY = box.y + padY + Math.random() * (box.height - 2 * padY);

  await moveMouseTo(page, targetX, targetY);
  await wait(gaussian(120, 40));
  await page.mouse.click(targetX, targetY);
}

// ─── Human typing ───────────────────────────────────────────────────

/**
 * Type text character-by-character with human-like delays.
 * For Chinese text, uses insertText per character.
 */
export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 10_000 });
  await humanClickLocator(page, el); // focus by clicking

  for (const char of text) {
    // Use insertText for non-ASCII (Chinese etc.), press for ASCII
    if (char.charCodeAt(0) > 127) {
      await page.keyboard.insertText(char);
    } else {
      await page.keyboard.press(char === '\n' ? 'Enter' : char);
    }
    // Inter-keystroke delay: gaussian around 100ms
    await wait(gaussian(100, 35));
  }
}

/**
 * Type into a Locator with human-like delays.
 */
export async function humanTypeLocator(page: Page, locator: Locator, text: string): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  await humanClickLocator(page, locator);

  for (const char of text) {
    if (char.charCodeAt(0) > 127) {
      await page.keyboard.insertText(char);
    } else {
      await page.keyboard.press(char === '\n' ? 'Enter' : char);
    }
    await wait(gaussian(100, 35));
  }
}

// ─── Human scrolling ────────────────────────────────────────────────

/**
 * Scroll down by approximately `distance` pixels using mouse wheel events.
 * Uses variable-speed chunks with occasional micro-pauses.
 */
export async function humanScroll(page: Page, distance: number): Promise<void> {
  let scrolled = 0;
  while (scrolled < distance) {
    // Each wheel tick: 60-180px (gaussian)
    const chunk = Math.round(gaussian(120, 35));
    const remaining = distance - scrolled;
    const delta = Math.min(chunk, remaining);

    await page.mouse.wheel(0, delta);
    scrolled += delta;

    // Inter-scroll delay: 30-80ms (fast scrolling feel)
    await wait(gaussian(50, 15));

    // 10% chance of a micro-pause (human looking at something)
    if (Math.random() < 0.1) {
      await wait(gaussian(400, 150));
    }
  }

  // 8% chance of scrolling back up a tiny bit (overshoot correction)
  if (Math.random() < 0.08) {
    const backtrack = Math.round(gaussian(60, 20));
    await page.mouse.wheel(0, -backtrack);
  }
}

/**
 * Scroll down by one "page" worth (~viewport height × 0.6-0.9).
 * Good for paginating through search results.
 */
export async function humanScrollPage(page: Page): Promise<void> {
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  const distance = Math.round(vp.height * (0.6 + Math.random() * 0.3));
  await humanScroll(page, distance);
}
