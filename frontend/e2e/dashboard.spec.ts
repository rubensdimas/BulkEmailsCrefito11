import { test, expect } from '@playwright/test';

test.describe('Dashboard Page', () => {
  test('should display empty state when no jobs are found', async ({ page }) => {
    // Mock the API response for an empty list
    await page.route('**/api/jobs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [],
          pagination: {
            total: 0,
            limit: 10,
            offset: 0,
            pages: 0
          }
        }),
      });
    });

    await page.goto('/dashboard');

    // Check for Empty State elements
    await expect(page.getByText('Nenhum envio realizado ainda')).toBeVisible();
    await expect(page.getByText('Inicie uma nova campanha para ver o progresso aqui.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Iniciar Novo Envio' })).toBeVisible();
  });

  test('should navigate back to home page from empty state', async ({ page }) => {
    await page.route('**/api/jobs*', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ success: true, data: [], pagination: { total: 0, limit: 10, offset: 0, pages: 0 } }),
      });
    });

    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Iniciar Novo Envio' }).click();
    
    await expect(page).toHaveURL('/');
  });
});
