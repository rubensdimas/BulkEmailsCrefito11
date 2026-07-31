import { expect, test } from '@playwright/test';

test('shows Mailgrid delivery details and paginates 100 recipients per page', async ({ page }) => {
  await page.route('**/api/status/job-1*', async (route) => {
    const requestedPage = Number(new URL(route.request().url()).searchParams.get('page') || '1');
    const secondPage = requestedPage === 2;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        jobId: 'job-1',
        status: 'completed',
        total: 101,
        completed: 100,
        failed: 1,
        processing: 0,
        waiting: 0,
        progress: 100,
        timestamp: new Date().toISOString(),
        emails: [{
          messageId: secondPage ? 'msg-101' : 'msg-1',
          recipient: secondPage ? 'last@example.com' : 'first@example.com',
          status: secondPage ? 'hard_bounce' : 'delivered',
          statusMessage: secondPage ? 'Mailbox unavailable' : 'Entregue com sucesso',
          sentAt: null,
          eventAt: null,
        }],
        pagination: { page: requestedPage, pageSize: 100, total: 101, totalPages: 2 },
      }),
    });
  });

  await page.goto('/status/job-1');

  await expect(page.getByText('msg-1')).toBeVisible();
  await expect(page.getByText('first@example.com')).toBeVisible();
  await expect(page.getByText('Entregue com sucesso')).toBeVisible();

  await page.getByRole('button', { name: 'Próxima' }).click();

  await expect(page.getByText('msg-101')).toBeVisible();
  await expect(page.getByText('last@example.com')).toBeVisible();
  await expect(page.getByText('Mailbox unavailable')).toBeVisible();
  await expect(page.getByText('Página 2 de 2')).toBeVisible();
});
