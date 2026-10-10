import { test, expect, type Page, type Route } from '@playwright/test';

const admin = { sub: 'local:user-1', name: 'admin', provider: 'local' };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const mockApi = async (page: Page, { authenticated = false, localLoginEnabled = true } = {}) => {
  const state = { authenticated };
  await page.route('**/api/auth/me', (route: Route) => route.fulfill(
    state.authenticated
      ? json({ success: true, data: admin })
      : json({ success: false, error: 'Authentication required' }, 401),
  ));
  await page.route('**/api/auth/options', (route: Route) => route.fulfill(json({ success: true, data: { localLoginEnabled } })));
  await page.route('**/api/jobs*', (route: Route) => route.fulfill(json({
    success: true, data: [], pagination: { total: 0, limit: 10, offset: 0, pages: 0 },
  })));
  await page.route('**/api/auth/local/login', async (route: Route) => {
    const { username, password } = route.request().postDataJSON() as { username: string; password: string };
    if (username === 'admin' && password === 'senha-super-secreta') {
      state.authenticated = true;
      await route.fulfill(json({ success: true, data: admin }));
      return;
    }
    if (password === 'bloqueado-demais') {
      await route.fulfill(json({ success: false, error: 'too_many_attempts' }, 429));
      return;
    }
    await route.fulfill(json({ success: false, error: 'invalid_credentials' }, 401));
  });
  return state;
};

const fillAndSubmit = async (page: Page, username: string, password: string) => {
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
};

test.describe('Login page', () => {
  test('sends an unauthenticated visitor to /login with the requested path', async ({ page }) => {
    await mockApi(page);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
    await expect(page.getByRole('img', { name: 'CREFITO 11' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Entrar no login intranet' }))
      .toHaveAttribute('href', '/api/auth/oidc/login?next=%2Fdashboard');
    await expect(page.getByLabel('Usuário')).toBeVisible();
    await expect(page.getByLabel('Senha')).toBeVisible();
  });

  test('logs in with username and password and returns to the requested page', async ({ page }) => {
    await mockApi(page);
    await page.goto('/dashboard');
    await fillAndSubmit(page, 'admin', 'senha-super-secreta');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText('admin', { exact: true })).toBeVisible();
  });

  test('shows a generic message for invalid credentials', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login');
    await fillAndSubmit(page, 'admin', 'senha-errada-aqui');
    await expect(page.getByRole('alert')).toHaveText('Usuário ou senha inválidos.');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel('Senha')).toHaveValue('');
  });

  test('explains when too many attempts were made', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login');
    await fillAndSubmit(page, 'admin', 'bloqueado-demais');
    await expect(page.getByRole('alert')).toHaveText('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  });

  test('hides the password form when local login is disabled', async ({ page }) => {
    await mockApi(page, { localLoginEnabled: false });
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Entrar no login intranet' })).toBeVisible();
    await expect(page.getByLabel('Usuário')).toHaveCount(0);
  });

  test('shows the intranet error returned by the OIDC callback', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login?auth_error=authentication_failed');
    await expect(page.getByRole('alert')).toHaveText('Não foi possível concluir o login pela intranet. Tente novamente.');
  });

  test('ignores an external next parameter', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login?next=%2F%2Fevil.example');
    await expect(page.getByRole('link', { name: 'Entrar no login intranet' }))
      .toHaveAttribute('href', '/api/auth/oidc/login?next=%2F');
    await fillAndSubmit(page, 'admin', 'senha-super-secreta');
    await expect.poll(() => new URL(page.url()).host).toBe('127.0.0.1:5174');
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  });

  test('sends an already authenticated user away from /login', async ({ page }) => {
    await mockApi(page, { authenticated: true });
    await page.goto('/login?next=%2Fdashboard');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('returns to /login when the session expires during use', async ({ page }) => {
    const state = await mockApi(page, { authenticated: true });
    await page.route('**/api/jobs*', (route: Route) => {
      state.authenticated = false;
      return route.fulfill(json({ success: false, error: 'Session expired' }, 401));
    });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  });
});
