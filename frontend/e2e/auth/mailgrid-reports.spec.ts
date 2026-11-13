import { test, expect, type Page, type Route } from '@playwright/test';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const admin = { userId: 'a', sub: 'local:a', name: 'admin', provider: 'local', role: 'admin', mustChangePassword: false };
const operator = { ...admin, userId: 'o', sub: 'local:o', name: 'operador', role: 'operator' };

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: '1', msgid: '1xR8qI-00000006RnI-3lbQ', email_de: 'isencao@example.com', email_para: 'pessoa@example.com',
  status: 'Entregue com sucesso', tipo_status: 'Aceita', sender: 'isencao@example.com', sender_ip: '20.206.67.134',
  sender_host: 'prd-crefito-8', size: '7.29 KB', delivery_ip: '74.125.197.27', delivery_host: 'gmail-smtp-in.l.google.com',
  message_id: 'abc@example.com', assunto: 'Status - Isenção CREFITO', event_at: '2026-11-11T13:58:28.000Z',
  sent_at: '2026-11-11T13:58:27.000Z', collected_at: '2026-11-12T06:00:00.000Z', erro: null, ...overrides,
});

const mockSession = async (page: Page, session: Record<string, unknown>, tokenState = 'configured') => {
  const state = {
    tokenState, settings: { enabled: true, mode: 'daily', time: '03:00', intervalMinutes: 5, windowHours: 48 },
    settingsBodies: [] as unknown[], reportQueries: [] as URLSearchParams[], runQueries: [] as URLSearchParams[], backfillStatus: 202,
  };
  await page.route('**/api/auth/me', (route: Route) => route.fulfill(json({ success: true, data: session })));
  await page.route('**/api/auth/options', (route: Route) => route.fulfill(json({ success: true, data: { localLoginEnabled: true, oidcEnabled: false } })));
  await page.route('**/api/jobs*', (route: Route) => route.fulfill(json({ success: true, data: [], pagination: { total: 0, limit: 10, offset: 0, pages: 0 } })));
  await page.route('**/api/admin/mailgrid-reports/status', (route: Route) => route.fulfill(json({ success: true, data: { tokenState: state.tokenState } })));
  await page.route('**/api/admin/mailgrid-reports/settings', async (route: Route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as typeof state.settings;
      state.settingsBodies.push(body);
      state.settings = body;
    }
    await route.fulfill(json({ success: true, data: { ...state.settings, tokenState: state.tokenState } }));
  });
  await page.route(/\/api\/admin\/mailgrid-reports\/runs(\?.*)?$/, (route: Route) => {
    state.runQueries.push(new URL(route.request().url()).searchParams);
    return route.fulfill(json({ success: true, data: [{
    id: 'r1', type: 'scheduled', window_start: '2026-11-10T06:00:00.000Z', window_end: '2026-11-12T06:00:00.000Z',
    status: 'success', fetched: 162, inserted: 160, skipped: 2, error_code: null, error_message: null,
    started_at: '2026-11-12T06:00:00.000Z', finished_at: '2026-11-12T06:00:02.000Z', triggered_by: null,
  }] }));
  });
  await page.route('**/api/admin/mailgrid-reports/run', (route: Route) => route.fulfill(json({ success: true }, 202)));
  await page.route('**/api/admin/mailgrid-reports/backfill', (route: Route) => route.fulfill(state.backfillStatus === 409
    ? json({ success: false, error: 'backfill_running', message: 'Já existe uma carga inicial em andamento.' }, 409)
    : json({ success: true, data: { blocks: 13 } }, 202)));
  await page.route('**/api/reports/sender-hosts', (route: Route) => route.fulfill(json({ success: true, data: ['prd-crefito-8', 'vmi2925581.contaboserver.net'] })));
  await page.route(/\/api\/reports(\?.*)?$/, async (route: Route) => {
    const params = new URL(route.request().url()).searchParams;
    state.reportQueries.push(params);
    const page = Number(params.get('page') || '1');
    await route.fulfill(json({
      success: true, data: [entry({ id: String(page), assunto: `Assunto página ${page}` })],
      pagination: { total: 120, page, pageSize: 50, pages: 3 },
    }));
  });
  return state;
};

test.describe('Relatórios Mailgrid', () => {
  test('admin sees banner when tokenState is auth_failed and link opens settings section', async ({ page }) => {
    await mockSession(page, admin, 'auth_failed');
    await page.goto('/');
    const banner = page.getByRole('alert').filter({ hasText: 'Token do relatório Mailgrid inválido ou não configurado' });
    await expect(banner).toBeVisible();
    await banner.getByRole('link', { name: 'Ver configuração' }).click();
    await expect(page).toHaveURL(/\/settings\/mailgrid-reports$/);
    await expect(page.getByText('Falha de autenticação na última execução')).toBeVisible();
  });

  test('operator does not see banner nor Relatórios Mailgrid section', async ({ page }) => {
    await mockSession(page, operator, 'auth_failed');
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Relatórios', exact: true })).toBeVisible();
    await expect(page.getByText('Token do relatório Mailgrid inválido ou não configurado')).toHaveCount(0);
    await page.goto('/settings/mailgrid-reports');
    await expect(page).toHaveURL(/\/$/);
  });

  test('settings saves time 04:30 and windowHours 24 via PUT body', async ({ page }) => {
    const state = await mockSession(page, admin);
    await page.goto('/settings/mailgrid-reports');
    await expect(page.getByText('Configurado', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '160' })).toBeVisible();
    await page.getByLabel('Horário diário').fill('04:30');
    await page.getByLabel('Janela de busca (horas)').fill('24');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Configuração salva.')).toBeVisible();
    expect(state.settingsBodies).toEqual([{ enabled: true, mode: 'daily', time: '04:30', intervalMinutes: 5, windowHours: 24 }]);
  });

  test('interval mode every 5 minutes suggests a 2 hour window and saves mode and interval', async ({ page }) => {
    const state = await mockSession(page, admin);
    await page.goto('/settings/mailgrid-reports');
    await page.getByLabel('Frequência').selectOption('interval');
    await expect(page.getByLabel('Horário diário')).toHaveCount(0);
    await expect(page.getByLabel('Intervalo')).toHaveValue('5');
    await expect(page.getByLabel('Janela de busca (horas)')).toHaveValue('2');
    await page.getByLabel('Intervalo').selectOption('15');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Configuração salva.')).toBeVisible();
    expect(state.settingsBodies).toEqual([{ enabled: true, mode: 'interval', time: '03:00', intervalMinutes: 15, windowHours: 2 }]);
    await page.getByLabel('Frequência').selectOption('daily');
    await expect(page.getByLabel('Janela de busca (horas)')).toHaveValue('48');
  });

  test('run history hides empty scheduled runs by default and can show them', async ({ page }) => {
    const state = await mockSession(page, admin);
    await page.goto('/settings/mailgrid-reports');
    const toggle = page.getByLabel('Ocultar execuções agendadas sem novidade');
    await expect(toggle).toBeChecked();
    await expect.poll(() => state.runQueries.at(-1)?.get('hideEmptyScheduled')).toBe('true');
    await toggle.uncheck();
    await expect.poll(() => state.runQueries.at(-1)?.get('hideEmptyScheduled')).toBe('false');
  });

  test('backfill asks confirmation and shows conflict message on 409', async ({ page }) => {
    const state = await mockSession(page, admin);
    state.backfillStatus = 409;
    await page.goto('/settings/mailgrid-reports');
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('Isso vai buscar os últimos 90 dias na API Mailgrid em 13 blocos. Continuar?');
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Carga inicial (90 dias)' }).click();
    await expect(page.getByText('Já existe uma carga inicial em andamento.')).toBeVisible();
  });

  test('reports page sends tipoStatus and recipient filters and paginates', async ({ page }) => {
    const state = await mockSession(page, operator);
    await page.goto('/reports');
    await expect(page.getByRole('cell', { name: 'Assunto página 1' })).toBeVisible();
    await page.getByLabel('Destinatário').fill('pessoa@');
    await page.getByRole('checkbox', { name: 'Hard Bounce' }).check();
    await page.getByRole('checkbox', { name: 'Soft Bounce' }).check();
    await page.getByLabel('Servidor de origem').selectOption('prd-crefito-8');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect.poll(() => state.reportQueries.at(-1)?.get('recipient')).toBe('pessoa@');
    const last = state.reportQueries.at(-1)!;
    expect(last.get('tipoStatus')).toBe('Soft Bounce,Hard Bounce');
    expect(last.get('senderHost')).toBe('prd-crefito-8');
    expect(last.get('from')).toMatch(/-03:00$/);
    await page.getByRole('button', { name: 'Próxima' }).click();
    await expect(page.getByRole('cell', { name: 'Assunto página 2' })).toBeVisible();
    expect(state.reportQueries.at(-1)?.get('recipient')).toBe('pessoa@');
    await expect(page.getByText('Página 2 de 3')).toBeVisible();
  });

  test('Limpar filtros resets every field and reloads page 1', async ({ page }) => {
    const state = await mockSession(page, operator);
    await page.goto('/reports');
    await page.getByLabel('Destinatário').fill('pessoa@');
    await page.getByRole('checkbox', { name: 'Hard Bounce' }).check();
    await page.getByLabel('Servidor de origem').selectOption('prd-crefito-8');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await page.getByRole('button', { name: 'Próxima' }).click();
    await expect(page.getByText('Página 2 de 3')).toBeVisible();
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(page.getByLabel('Destinatário')).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: 'Hard Bounce' })).not.toBeChecked();
    await expect(page.getByLabel('Servidor de origem')).toHaveValue('');
    await expect.poll(() => state.reportQueries.at(-1)?.get('page')).toBe('1');
    const last = state.reportQueries.at(-1)!;
    expect(last.get('recipient')).toBeNull();
    expect(last.get('tipoStatus')).toBeNull();
    expect(last.get('senderHost')).toBeNull();
    expect(last.get('from')).toMatch(/-03:00$/);
  });

  test('clicking a row opens detail with msgid and delivery_host', async ({ page }) => {
    await mockSession(page, operator);
    await page.goto('/reports');
    await page.getByRole('button', { name: /Ver detalhes do envio para pessoa@example.com/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Detalhes do envio' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('1xR8qI-00000006RnI-3lbQ')).toBeVisible();
    await expect(dialog.getByText('gmail-smtp-in.l.google.com')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('bounce error message shows in the table and in the detail card', async ({ page }) => {
    const errorText = 'SMTP error from remote mail server after RCPT TO:<pessoa@example.com>: 550-5.1.1 The email account that you tried to reach does not exist.';
    const softText = 'SMTP error from remote mail server after RCPT TO:<x@example.com>: 452-4.2.2 Please direct the\\n452-4.2.2 recipient to';
    await mockSession(page, operator);
    await page.route(/\/api\/reports(\?.*)?$/, (route: Route) => route.fulfill(json({
      success: true, data: [entry({ tipo_status: 'Hard Bounce', status: 'Erro na entrega', erro: errorText }), entry({ id: '2', email_para: 'ok@example.com' }), entry({ id: '3', email_para: 'x@example.com', tipo_status: 'Soft Bounce', erro: softText })],
      pagination: { total: 3, page: 1, pageSize: 50, pages: 1 },
    })));
    await page.goto('/reports');
    const preview = page.getByTitle(errorText);
    await expect(preview).toBeVisible();
    await expect(page.getByTitle(/SMTP error/)).toHaveCount(2);
    await expect(page.getByTitle(/Please direct the/)).toHaveAttribute('title', /Please direct the\n452-4\.2\.2 recipient/);
    await page.getByRole('button', { name: /Ver detalhes do envio para pessoa@example.com/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Detalhes do envio' });
    await expect(dialog.getByRole('heading', { name: 'Mensagem de erro' })).toBeVisible();
    await expect(dialog.getByText(errorText)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Ver detalhes do envio para ok@example.com/ }).click();
    await expect(dialog.getByRole('heading', { name: 'Mensagem de erro' })).toHaveCount(0);
  });

  test('Exportar CSV link carries current filters', async ({ page }) => {
    await mockSession(page, operator);
    await page.goto('/reports');
    await page.getByLabel('Assunto').fill('Isenção');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    const href = await page.getByRole('link', { name: 'Exportar CSV' }).getAttribute('href');
    const url = new URL(href!, 'http://localhost');
    expect(url.pathname).toBe('/api/reports/export.csv');
    expect(url.searchParams.get('subject')).toBe('Isenção');
    expect(url.searchParams.get('page')).toBeNull();
  });
});
