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

test('reorders cards and filters recipients on the server before pagination', async ({ page }) => {
  const requestedUrls: URL[] = [];
  let delayedPageResolved = false;
  await page.route('**/api/status/job-filter*', async (route) => {
    const url = new URL(route.request().url());
    requestedUrls.push(url);
    const isFiltered = url.searchParams.has('recipient') || url.searchParams.has('status');
    const requestedPage = Number(url.searchParams.get('page') || '1');

    if (!isFiltered && requestedPage === 2) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      delayedPageResolved = true;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        jobId: 'job-filter',
        status: 'completed',
        total: 101,
        completed: 100,
        failed: 1,
        processing: 0,
        waiting: 0,
        progress: 100,
        timestamp: new Date().toISOString(),
        emails: isFiltered ? [] : [{
          messageId: requestedPage === 2 ? 'msg-stale' : 'msg-filter',
          recipient: requestedPage === 2 ? 'stale@example.com' : 'first@example.com',
          status: 'delivered',
          statusMessage: 'Entregue',
          sentAt: null,
          eventAt: null,
        }],
        pagination: isFiltered
          ? { page: 1, pageSize: 100, total: 0, totalPages: 0 }
          : { page: requestedPage, pageSize: 100, total: 101, totalPages: 2 },
      }),
    });
  });

  await page.goto('/status/job-filter');
  await expect(page.locator('main h2')).toHaveText([
    'Status do Envio',
    'Importar status do Mailgrid',
    'Filtros de destinatários',
    'Destinatários',
  ]);

  await page.getByRole('button', { name: 'Próxima' }).click();
  await expect.poll(() => requestedUrls.some((url) => url.searchParams.get('page') === '2')).toBe(true);

  await page.getByLabel('Endereço de e-mail').fill(' Target@Example.COM ');
  await page.getByLabel('Status').selectOption('hard_bounce');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();

  await expect.poll(() => requestedUrls.some((url) => (
    url.searchParams.get('page') === '1'
    && url.searchParams.get('recipient') === 'target@example.com'
    && url.searchParams.get('status') === 'hard_bounce'
  ))).toBe(true);
  await expect.poll(() => requestedUrls.filter((url) => (
    url.searchParams.get('page') === '1'
    && url.searchParams.get('recipient') === 'target@example.com'
    && url.searchParams.get('status') === 'hard_bounce'
  )).length, { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => delayedPageResolved).toBe(true);
  await expect(page.getByText('stale@example.com')).not.toBeVisible();
  await expect(page.getByText('Nenhum destinatário corresponde aos filtros.')).toBeVisible();
  await expect(page.getByText('0 endereços encontrados — 100 itens por página')).toBeVisible();

  await page.getByRole('button', { name: 'Limpar' }).click();
  await expect(page.getByText('first@example.com')).toBeVisible();
  await expect(page.getByLabel('Endereço de e-mail')).toHaveValue('');
  await expect(page.getByLabel('Status')).toHaveValue('');
});

test('imports existing delivery statuses from a CSV and refreshes the page', async ({ page }) => {
  await page.route('**/api/status/job-import/import', async (route) => {
    expect(route.request().method()).toBe('POST');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        jobId: 'job-import',
        campaignId: 'campaign-import',
        summary: {
          totalRows: 2,
          validRows: 2,
          updated: 1,
          unchanged: 0,
          ignoredStale: 0,
          notFound: 1,
          otherCampaign: 0,
          recipientMismatch: 0,
          duplicateRows: 0,
          invalidRows: 0,
          invalidRowNumbers: [],
          invalidRowNumbersTruncated: false,
        },
      }),
    });
  });

  await page.route('**/api/status/job-import*', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        jobId: 'job-import',
        status: 'processing',
        total: 1,
        completed: 1,
        failed: 0,
        processing: 0,
        waiting: 0,
        progress: 100,
        emails: [{
          messageId: 'msg-import',
          recipient: 'recipient@example.com',
          status: 'delivered',
          statusMessage: 'Entregue',
          sentAt: null,
          eventAt: null,
        }],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    });
  });

  await page.goto('/status/job-import');
  await expect(page.getByText('Importar status do Mailgrid')).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'status.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('ID Mensagem;Status\nmsg-import;Entregue\n'),
  });
  await page.getByRole('button', { name: 'Importar status' }).click();

  await expect(page.getByText(/Importação concluída: 2 linhas · 2 válidas · 1 atualizadas/)).toBeVisible();
});

test('shows the API validation error returned by the status import', async ({ page }) => {
  await page.route('**/api/status/job-error/import', (route) => route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ success: false, error: 'Cabeçalhos obrigatórios ausentes: Status' }),
  }));
  await page.route('**/api/status/job-error*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      jobId: 'job-error',
      status: 'processing',
      total: 0,
      completed: 0,
      failed: 0,
      processing: 0,
      waiting: 0,
      progress: 0,
      emails: [],
      pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
    }),
  }));

  await page.goto('/status/job-error');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'status.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('invalid'),
  });
  await page.getByRole('button', { name: 'Importar status' }).click();

  await expect(page.getByText('Cabeçalhos obrigatórios ausentes: Status')).toBeVisible();
});

test('preserves the successful import summary when refreshing the status panel fails', async ({ page }) => {
  let statusRequests = 0;
  await page.route('**/api/status/job-refresh/import', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      jobId: 'job-refresh',
      campaignId: 'campaign-refresh',
      summary: {
        totalRows: 1,
        validRows: 1,
        updated: 1,
        unchanged: 0,
        ignoredStale: 0,
        notFound: 0,
        otherCampaign: 0,
        recipientMismatch: 0,
        duplicateRows: 0,
        invalidRows: 0,
        invalidRowNumbers: [],
        invalidRowNumbersTruncated: false,
      },
    }),
  }));
  await page.route('**/api/status/job-refresh*', (route) => {
    statusRequests++;
    if (statusRequests > 1) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'refresh unavailable' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        jobId: 'job-refresh',
        status: 'completed',
        total: 1,
        completed: 1,
        failed: 0,
        processing: 0,
        waiting: 0,
        progress: 100,
        emails: [],
        pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
      }),
    });
  });

  await page.goto('/status/job-refresh');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'status.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('valid'),
  });
  await page.getByRole('button', { name: 'Importar status' }).click();

  await expect(page.getByText(/Importação concluída: 1 linhas · 1 válidas · 1 atualizadas/)).toBeVisible();
  await expect(page.getByText(/status foram importados, mas não foi possível atualizar o painel/)).toBeVisible();
});
