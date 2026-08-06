import { expect, test } from '@playwright/test';

test.describe('Rota principal de novos envios', () => {
  test('ignora um job ativo legado e mantém o formulário disponível', async ({ page }) => {
    let statusRequestCount = 0;

    await page.addInitScript(() => {
      localStorage.setItem('last_bulk_email_job_id', 'legacy-active-job');
    });

    await page.route('**/api/status/legacy-active-job*', async (route) => {
      statusRequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          jobId: 'legacy-active-job',
          status: 'processing',
          total: 10,
          completed: 1,
          failed: 0,
          processing: 1,
          waiting: 8,
          progress: 10,
          emails: [],
        }),
      });
    });

    await page.goto('/');

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: '2. Configurar Email' })).toBeVisible();
    await expect(page.locator('#recipients')).toBeVisible();
    expect(statusRequestCount).toBe(0);
  });

  test('direciona para o status do novo job após um envio bem-sucedido', async ({ page }) => {
    await page.route('**/api/send', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, jobId: 'new-job' }),
      });
    });

    await page.route('**/api/status/new-job*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          jobId: 'new-job',
          status: 'pending',
          total: 1,
          completed: 0,
          failed: 0,
          processing: 0,
          waiting: 1,
          progress: 0,
          emails: [],
        }),
      });
    });

    await page.goto('/');
    await page.locator('#recipients').fill('recipient@example.com');
    await page.locator('#recipients').press('Enter');
    await page.locator('#subject').fill('Novo envio');
    await page.locator('.ql-editor').fill('Conteúdo válido para o novo envio.');
    await page.getByRole('button', { name: 'Enviar 1 email(s)' }).click();

    await expect(page).toHaveURL('/status/new-job');
    await expect(page.getByRole('heading', { level: 1, name: 'Status do Envio' })).toBeVisible();
  });
});
