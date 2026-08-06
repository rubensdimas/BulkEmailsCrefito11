import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadFixture = path.join(__dirname, 'fixtures', 'sample.xlsx');

const mockedUploadResponse = {
  success: true,
  emails: {
    valid: ['valid@example.com'],
    invalid: [
      { email: 'invalid-email', error: 'Invalid email format' },
      { email: 'missing-domain@', error: 'Invalid email format' },
    ],
  },
};

test.describe('Validação de e-mails após upload XLSX', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/upload', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockedUploadResponse),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('exibe os inválidos, seus motivos e mantém os válidos disponíveis', async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(uploadFixture);

    await expect(page.getByRole('heading', { name: 'E-mails inválidos (2)' })).toBeVisible();
    await expect(page.getByText('invalid-email', { exact: true })).toBeVisible();
    await expect(page.getByText('missing-domain@', { exact: true })).toBeVisible();
    await expect(page.getByText('Invalid email format', { exact: true })).toHaveCount(2);
    await expect(page.getByText('valid@example.com', { exact: true })).toBeVisible();
  });

  test('exibe a seção mesmo quando a planilha não possui e-mails válidos', async ({ page }) => {
    await page.unroute('**/api/upload');
    await page.route('**/api/upload', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...mockedUploadResponse,
          emails: { valid: [], invalid: mockedUploadResponse.emails.invalid },
        }),
      });
    });

    await page.locator('input[type="file"]').setInputFiles(uploadFixture);

    await expect(page.getByRole('heading', { name: 'E-mails inválidos (2)' })).toBeVisible();
    await expect(page.getByText('Emails Encontrados', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Adicione pelo menos um destinatário para continuar')).toBeVisible();
  });

  test('substitui a lista de inválidos ao realizar um novo upload', async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(uploadFixture);
    await expect(page.getByText('invalid-email', { exact: true })).toBeVisible();

    await page.unroute('**/api/upload');
    await page.route('**/api/upload', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          emails: {
            valid: [],
            invalid: [{ email: 'new-invalid', error: 'Missing domain' }],
          },
        }),
      });
    });

    await page.locator('input[type="file"]').setInputFiles([]);
    await page.locator('input[type="file"]').setInputFiles(uploadFixture);

    await expect(page.getByRole('heading', { name: 'E-mails inválidos (1)' })).toBeVisible();
    await expect(page.getByText('new-invalid', { exact: true })).toBeVisible();
    await expect(page.getByText('Missing domain', { exact: true })).toBeVisible();
    await expect(page.getByText('invalid-email', { exact: true })).toHaveCount(0);
    await expect(page.getByText('missing-domain@', { exact: true })).toHaveCount(0);
  });
});
