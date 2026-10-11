import { test, expect, type Page, type Route } from '@playwright/test';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const mockSession = async (page: Page, user: Record<string, unknown>) => {
  const state = { user };
  await page.route('**/api/auth/me', (route: Route) => route.fulfill(json({ success: true, data: state.user })));
  await page.route('**/api/auth/options', (route: Route) => route.fulfill(json({ success: true, data: { localLoginEnabled: true, oidcEnabled: true } })));
  await page.route('**/api/jobs*', (route: Route) => route.fulfill(json({ success: true, data: [], pagination: { total: 0, limit: 10, offset: 0, pages: 0 } })));
  await page.route('**/api/config/mailgrid', (route: Route) => route.fulfill(json({ success: true, data: { host: '', user: '', pass: '', from_address: '', from_name: '', webhook_token: '', webhook_token_configured: false } })));
  return state;
};

const admin = { userId: 'a', sub: 'local:a', name: 'admin', provider: 'local', role: 'admin', mustChangePassword: false };
const operator = { userId: 'o', sub: 'oidc-o', name: 'Operadora', provider: 'oidc', role: 'operator', mustChangePassword: false };

test.describe('Navigation by role', () => {
  test('shows the settings link to admins', async ({ page }) => {
    await mockSession(page, admin);
    await page.goto('/dashboard');
    const nav = page.getByRole('navigation', { name: 'Principal' });
    await expect(nav.getByRole('link', { name: 'Novo Envio' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Configurações' })).toBeVisible();
  });

  test('hides settings from operators and sends them away from /settings', async ({ page }) => {
    await mockSession(page, operator);
    await page.goto('/dashboard');
    await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Configurações' })).toHaveCount(0);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/$/);
  });

  test('offers "Minha senha" only to local users', async ({ page }) => {
    await mockSession(page, admin);
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: 'Minha senha' })).toBeVisible();
  });

  test('forces a password change before anything else', async ({ page }) => {
    const state = await mockSession(page, { ...admin, mustChangePassword: true });
    await page.route('**/api/auth/password', async (route: Route) => {
      const body = route.request().postDataJSON() as { currentPassword: string; newPassword: string };
      if (body.currentPassword !== 'senha-inicial-123') {
        await route.fulfill(json({ success: false, error: 'invalid_current_password', message: 'A senha atual está incorreta.' }, 400));
        return;
      }
      state.user = { ...admin, mustChangePassword: false };
      await route.fulfill(json({ success: true }));
    });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/account\/password$/);
    await expect(page.getByText('Defina uma nova senha para continuar.')).toBeVisible();

    await page.getByLabel('Senha atual').fill('errada-errada-1');
    await page.getByLabel('Nova senha', { exact: true }).fill('nova-senha-1234');
    await page.getByLabel('Confirme a nova senha').fill('nova-senha-1234');
    await page.getByRole('button', { name: 'Salvar senha' }).click();
    await expect(page.getByRole('alert')).toHaveText('A senha atual está incorreta.');

    await page.getByLabel('Senha atual').fill('senha-inicial-123');
    await page.getByRole('button', { name: 'Salvar senha' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('checks that both new password fields match', async ({ page }) => {
    await mockSession(page, admin);
    await page.goto('/account/password');
    await page.getByLabel('Senha atual').fill('senha-inicial-123');
    await page.getByLabel('Nova senha', { exact: true }).fill('nova-senha-1234');
    await page.getByLabel('Confirme a nova senha').fill('outra-senha-1234');
    await page.getByRole('button', { name: 'Salvar senha' }).click();
    await expect(page.getByRole('alert')).toHaveText('As senhas não conferem.');
  });
});

test.describe('Login page options', () => {
  test('hides the intranet button when the intranet login is not configured', async ({ page }) => {
    await page.route('**/api/auth/me', (route: Route) => route.fulfill(json({ success: false }, 401)));
    await page.route('**/api/auth/options', (route: Route) => route.fulfill(json({ success: true, data: { localLoginEnabled: true, oidcEnabled: false } })));
    await page.goto('/login');
    await expect(page.getByLabel('Usuário')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Entrar no login intranet' })).toHaveCount(0);
  });

  test('explains when an intranet user is not authorized', async ({ page }) => {
    await page.route('**/api/auth/me', (route: Route) => route.fulfill(json({ success: false }, 401)));
    await page.route('**/api/auth/options', (route: Route) => route.fulfill(json({ success: true, data: { localLoginEnabled: true, oidcEnabled: true } })));
    await page.goto('/login?auth_error=unauthorized');
    await expect(page.getByRole('alert')).toHaveText('Acesso não autorizado. Procure um administrador do BulkMail.');
  });
});

test('clears a changed credential session and offers a new login', async ({ page }) => {
  await mockSession(page, admin);
  await page.route('**/api/auth/password', route => route.fulfill(json({ success: false, error: 'credentials_changed', message: 'Suas credenciais foram alteradas. Entre novamente.' }, 409)));
  await page.goto('/account/password');
  await page.getByLabel('Senha atual').fill('senha-inicial-123');
  await page.getByLabel('Nova senha', { exact: true }).fill('nova-senha-1234');
  await page.getByLabel('Confirme a nova senha').fill('nova-senha-1234');
  await page.getByRole('button', { name: 'Salvar senha' }).click();
  await expect(page.getByRole('alert')).toHaveText('Suas credenciais foram alteradas. Entre novamente.');
  await page.getByRole('link', { name: 'Entrar novamente' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('refreshes the role after a forbidden settings request', async ({ page }) => {
  const state = await mockSession(page, admin);
  await page.route('**/api/config/mailgrid', route => {
    state.user = { ...admin, role: 'operator' };
    return route.fulfill(json({ success: false, error: 'forbidden' }, 403));
  });
  await page.goto('/settings/email');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Configurações' })).toHaveCount(0);
});

test('does not offer a local password to an intranet account', async ({ page }) => {
  await mockSession(page, operator);
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'Minha senha' })).toHaveCount(0);
});

test('explains a configuration mismatch returned by the account endpoint', async ({ page }) => {
  await page.route('**/api/auth/me', route => route.fulfill(json({ success: false, error: 'not_configured' }, 401)));
  await page.route('**/api/auth/options', route => route.fulfill(json({ success: true, data: { localLoginEnabled: true, oidcEnabled: false } })));
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/auth_error=not_configured/);
  await expect(page.getByRole('alert')).toHaveText('O login pela intranet não está configurado.');
});

test('refreshes a forced password flag returned after an operational request', async ({ page }) => {
  const state = await mockSession(page, admin);
  await page.route('**/api/jobs*', route => {
    state.user = { ...admin, mustChangePassword: true };
    return route.fulfill(json({ success: false, error: 'password_change_required' }, 403));
  });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/account\/password$/);
  await expect(page.getByText('Defina uma nova senha para continuar.')).toBeVisible();
});

const requestJobs = async (page: Page) => {
  await page.evaluate("import('/src/services/api.ts').then(({ api }) => { void api.get('/jobs').catch(() => undefined); })");
};
const settleAccountResponse = async (page: Page, route: Route) => {
  const response = page.waitForResponse('**/api/auth/me');
  await route.fulfill(json({ success: true, data: admin }));
  await response;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
};

test('ignores a pending admin refresh after an operational 401 invalidates the account', async ({ page }) => {
  await mockSession(page, admin);
  await page.goto('/dashboard');
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
  let capture!: (route: Route) => void;
  const pending = new Promise<Route>(resolve => { capture = resolve; });
  await page.route('**/api/auth/me', route => { capture(route); });
  await page.route('**/api/jobs*', route => route.fulfill(json({ success: false, error: 'forbidden' }, 403)));
  await requestJobs(page);
  const oldRefresh = await pending;
  await page.route('**/api/jobs*', route => route.fulfill(json({ success: false, error: 'not_configured' }, 401)));
  await requestJobs(page);
  await expect(page.getByRole('alert')).toHaveText('O login pela intranet não está configurado.');
  await page.route('**/api/jobs*', route => route.fulfill(json({ success: true, data: [], pagination: { total: 0, limit: 10, offset: 0, pages: 0 } })));
  await settleAccountResponse(page, oldRefresh);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('alert')).toHaveText('O login pela intranet não está configurado.');
  await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(0);
});

test('keeps the latest operator role when an older admin refresh resolves last', async ({ page }) => {
  await mockSession(page, admin);
  await page.goto('/dashboard');
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
  let capture!: (route: Route) => void;
  const pending = new Promise<Route>(resolve => { capture = resolve; });
  let requests = 0;
  await page.route('**/api/auth/me', route => {
    if (++requests === 1) { capture(route); return; }
    return route.fulfill(json({ success: true, data: operator }));
  });
  await page.route('**/api/jobs*', route => route.fulfill(json({ success: false, error: 'forbidden' }, 403)));
  await requestJobs(page);
  const oldRefresh = await pending;
  await requestJobs(page);
  const settings = page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Configurações' });
  await expect(settings).toHaveCount(0);
  await settleAccountResponse(page, oldRefresh);
  await expect(settings).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Novo Envio' }).click();
  await expect(page).toHaveURL(/\/$/);
});
