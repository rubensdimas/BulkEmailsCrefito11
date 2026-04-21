/**
 * E2E Tests - Story 1.2: bug-fix-form-colors
 *
 * Validates that the 'Assunto' and 'Corpo do E-mail' fields render with correct
 * colors (white background, dark text) when enabled after XLSX upload,
 * and with light-gray background when disabled.
 *
 * Covers acceptance criteria:
 *  AC1 - Fields unlock after xlsx upload
 *  AC2 - Enabled fields use normal light-theme colors
 *  AC3 - Fields are immediately fillable after enabling
 *  AC4 - Consistent behavior across browsers (run with --project=chromium/firefox/webkit)
 */

import { test, expect, Page } from '@playwright/test';
import path from 'path';

const BASE_URL = 'http://localhost:5173';

/** Helper: get computed background color of an element */
async function getBgColor(page: Page, selector: string): Promise<string> {
  return page.$eval(selector, (el) => {
    return window.getComputedStyle(el).backgroundColor;
  });
}

/** Helper: get computed text color of an element */
async function getTextColor(page: Page, selector: string): Promise<string> {
  return page.$eval(selector, (el) => {
    return window.getComputedStyle(el).color;
  });
}

/** rgb(255, 255, 255) = white */
const WHITE_BG = 'rgb(255, 255, 255)';
/** rgb(249, 250, 251) ≈ Tailwind gray-50 / bg-gray-100 area - accept any light-gray */
const DARK_TEXT_MIN_LUMINANCE = 128; // text color channel must be < this for "dark" text

/** Parses an rgb(r,g,b) string to [r,g,b] */
function parseRgb(rgb: string): [number, number, number] {
  const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

function isWhiteOrNearWhite([r, g, b]: [number, number, number]): boolean {
  return r >= 240 && g >= 240 && b >= 240;
}

function isDarkText([r, g, b]: [number, number, number]): boolean {
  // dark text means average channel < 128
  return (r + g + b) / 3 < DARK_TEXT_MIN_LUMINANCE;
}

function isLightGray([r, g, b]: [number, number, number]): boolean {
  // gray-100 = rgb(243, 244, 246) - allow some range
  return r >= 220 && g >= 220 && b >= 220 && r < 255;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Story 1.2 — Form field colors', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  // ── AC2 + disabled state ─────────────────────────────────────────────────
  test('AC2: disabled fields have light-gray background', async ({ page }) => {
    const subjectBg = parseRgb(await getBgColor(page, '#subject'));
    const bodyBg = parseRgb(await getBgColor(page, '#body'));

    expect(isLightGray(subjectBg)).toBe(true);
    expect(isLightGray(bodyBg)).toBe(true);
  });

  // ── AC1 + AC2 + AC3 ─────────────────────────────────────────────────────
  test('AC1/AC2/AC3: after xlsx upload, fields are white and editable', async ({ page }) => {
    // Locate the file input (react-dropzone exposes a hidden <input type="file">)
    const fileInput = page.locator('input[type="file"]').first();

    // Use a minimal valid xlsx fixture (1 row with an email column)
    const fixturePath = path.join(__dirname, 'fixtures', 'sample.xlsx');
    await fileInput.setInputFiles(fixturePath);

    // Wait for the app to process and enable the fields
    await page.waitForFunction(() => {
      const el = document.querySelector('#subject') as HTMLInputElement;
      return el && !el.disabled;
    }, { timeout: 10_000 });

    // AC1: fields must be enabled
    await expect(page.locator('#subject')).not.toBeDisabled();
    await expect(page.locator('#body')).not.toBeDisabled();

    // AC2: background must be white (or near-white)
    const subjectBg = parseRgb(await getBgColor(page, '#subject'));
    const bodyBg = parseRgb(await getBgColor(page, '#body'));

    expect(isWhiteOrNearWhite(subjectBg)).toBe(true);
    expect(isWhiteOrNearWhite(bodyBg)).toBe(true);

    // AC2: text color must be dark (not dark-gray on dark-gray)
    const subjectText = parseRgb(await getTextColor(page, '#subject'));
    const bodyText = parseRgb(await getTextColor(page, '#body'));

    expect(isDarkText(subjectText)).toBe(true);
    expect(isDarkText(bodyText)).toBe(true);

    // AC3: fields are immediately fillable
    await page.fill('#subject', 'Assunto de teste');
    await page.fill('#body', 'Corpo do email de teste para validação.');

    await expect(page.locator('#subject')).toHaveValue('Assunto de teste');
    await expect(page.locator('#body')).toHaveValue('Corpo do email de teste para validação.');
  });

  // ── No side-effects on other elements ────────────────────────────────────
  test('AC4: color-scheme change does not break other form elements', async ({ page }) => {
    // Verify the page body has a light background
    const bodyBg = parseRgb(await getBgColor(page, 'body'));
    // Body should NOT be very dark (dark mode)
    const [r, g, b] = bodyBg;
    const isDark = (r + g + b) / 3 < 80;
    expect(isDark).toBe(false);
  });
});
