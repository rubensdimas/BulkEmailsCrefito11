import { test, expect, type Page, type Route } from '@playwright/test';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const admin = { userId: 'a', sub: 'local:a', name: 'admin', provider: 'local', role: 'admin', mustChangePassword: false };

type UserRow = { id: string; provider: string; username: string | null; name: string | null; email: string | null; role: string; disabled: boolean; mustChangePassword: boolean; lastLoginAt: string | null };
const users = (): UserRow[] => ([
  { id: '00000000-0000-4000-8000-000000000001', provider: 'local', username: 'admin', name: null, email: null, role: 'admin', disabled: false, mustChangePassword: false, lastLoginAt: '2026-10-10T12:00:00.000Z' },
  { id: '00000000-0000-4000-8000-000000000002', provider: 'oidc', username: null, name: 'Ana Souza', email: 'ana@crefito11.gov.br', role: 'operator', disabled: false, mustChangePassword: false, lastLoginAt: null },
]);

const mockAdmin = async (page: Page, session: Record<string, unknown> = admin) => {
  const state = { users: users(), session, passwordRequests: [] as Array<{ id: string; body: unknown }> };
  await page.route('**/api/auth/me', (route: Route) => route.fulfill(json({ success: true, data: state.session })));
  await page.route('**/api/auth/options', (route: Route) => route.fulfill(json({ success: true, data: { localLoginEnabled: true, oidcEnabled: true } })));
  await page.route('**/api/jobs*', (route: Route) => route.fulfill(json({ success: true, data: [], pagination: { total: 0, limit: 10, offset: 0, pages: 0 } })));
  await page.route('**/api/config/mailgrid', (route: Route) => route.fulfill(json({ success: true, data: { host: 'smtp.mailgrid.net.br', user: 'u', pass: '', from_address: 'no-reply@crefito11.gov.br', from_name: 'CREFITO11', webhook_token: '', webhook_token_configured: true } })));
  await page.route('**/api/admin/users', async (route: Route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { username: string; role: string };
      if (body.username === 'admin') {
        await route.fulfill(json({ success: false, error: 'username_taken', message: 'O usuário "admin" já existe.' }, 409));
        return;
      }
      const created = { id: '00000000-0000-4000-8000-000000000003', provider: 'local', username: body.username, name: null, email: null, role: body.role, disabled: false, mustChangePassword: true, lastLoginAt: null };
      state.users.push(created);
      await route.fulfill(json({ success: true, data: created }, 201));
      return;
    }
    await route.fulfill(json({ success: true, data: state.users }));
  });
  await page.route('**/api/admin/users/*/password', async (route: Route) => {
    const id = route.request().url().split('/').slice(-2)[0];
    const body = route.request().postDataJSON() as { password: string };
    state.passwordRequests.push({ id, body });
    if (body.password.length < 12) {
      await route.fulfill(json({ success: false, error: 'invalid_password', message: 'A senha deve ter pelo menos 12 caracteres.' }, 400));
      return;
    }
    await route.fulfill(json({ success: true }));
  });
  await page.route('**/api/admin/users/*', async (route: Route) => {
    if (route.request().method() !== 'PATCH') { await route.fallback(); return; }
    const id = route.request().url().split('/').pop();
    const change = route.request().postDataJSON() as { role?: string; disabled?: boolean };
    if (id === users()[0].id && state.session.userId === 'a') {
      await route.fulfill(json({ success: false, error: 'last_active_admin', message: 'Não é possível desativar ou rebaixar o último administrador ativo.' }, 409));
      return;
    }
    const target = state.users.find((user) => user.id === id)!;
    Object.assign(target, change);
    await route.fulfill(json({ success: true, data: target }));
  });
  return state;
};

test.describe('Settings', () => {
  test('opens Users from /settings with a side menu', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings\/users$/);
    const menu = page.getByRole('navigation', { name: 'Configurações' }).filter({ visible: true });
    await expect(menu.getByRole('link', { name: 'Usuários' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'E-mail' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Login intranet' })).toBeVisible();
  });

  test('lists local and intranet users', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings/users');
    const anaRow = page.getByRole('row', { name: /Ana Souza/ });
    await expect(anaRow).toContainText('Intranet');
    await expect(anaRow).toContainText('Operador');
    await expect(anaRow).toContainText('Nunca');
    await expect(page.getByRole('row', { name: /^admin\b/ })).toContainText('Administrador');
  });

  test('creates a local operator', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings/users');
    await page.getByLabel('Novo usuário').fill('joao.silva');
    await page.getByLabel('Senha inicial').fill('senha-inicial-123');
    await page.getByLabel('Perfil').selectOption('operator');
    await page.getByRole('button', { name: 'Criar usuário' }).click();
    await expect(page.getByRole('status')).toHaveText('Usuário "joao.silva" criado. A senha deverá ser trocada no primeiro acesso.');
    await expect(page.getByRole('row', { name: /joao\.silva/ })).toContainText('Operador');
  });

  test('defaults the new user profile to administrator', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings/users');
    await page.getByLabel('Novo usuário').fill('maria.lima');
    await page.getByLabel('Senha inicial').fill('senha-inicial-123');
    const request = page.waitForRequest((req) => req.method() === 'POST' && req.url().endsWith('/api/admin/users'));
    await page.getByRole('button', { name: 'Criar usuário' }).click();
    expect((await request).postDataJSON()).toMatchObject({ username: 'maria.lima', role: 'admin' });
  });

  test('clears the reset form on reopen and closes it when the user is disabled', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings/users');
    await page.getByLabel('Novo usuário').fill('joao.silva');
    await page.getByLabel('Senha inicial').fill('senha-inicial-123');
    await page.getByRole('button', { name: 'Criar usuário' }).click();
    const adminRow = page.getByRole('row', { name: /^admin\b/ });
    await adminRow.getByRole('button', { name: 'Definir senha' }).click();
    await page.getByLabel('Nova senha').fill('abc');
    const joaoRow = page.getByRole('row', { name: /^joao\.silva\b/ });
    await joaoRow.getByRole('button', { name: 'Definir senha' }).click();
    await expect(page.getByLabel('Nova senha')).toHaveCount(1);
    await expect(page.getByLabel('Nova senha')).toHaveValue('');
    await joaoRow.getByRole('button', { name: 'Desativar' }).click();
    await expect(joaoRow).toContainText('Desativado');
    await expect(page.getByLabel('Nova senha')).toHaveCount(0);
  });

  test('shows the backend message when the action is refused', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings/users');
    await page.getByRole('row', { name: /^admin\b/ }).getByRole('button', { name: 'Tornar operador' }).click();
    await expect(page.getByRole('alert')).toHaveText('Não é possível desativar ou rebaixar o último administrador ativo.');
  });

  test('promotes and disables other users', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings/users');
    const anaRow = page.getByRole('row', { name: /Ana Souza/ });
    await anaRow.getByRole('button', { name: 'Tornar administrador' }).click();
    await expect(anaRow).toContainText('Administrador');
    await anaRow.getByRole('button', { name: 'Desativar' }).click();
    await expect(anaRow).toContainText('Desativado');
  });

  test('keeps the Mailgrid form under E-mail', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings/email');
    await expect(page.locator('input[value="smtp.mailgrid.net.br"]')).toBeVisible();
  });

  test('resets a local user password and tells the admin it must be changed', async ({ page }) => {
    const state = await mockAdmin(page);
    await page.goto('/settings/users');
    const adminRow = page.getByRole('row', { name: /^admin\b/ });
    await expect(page.getByRole('row', { name: /Ana Souza/ }).getByRole('button', { name: 'Definir senha' })).toHaveCount(0);
    await adminRow.getByRole('button', { name: 'Definir senha' }).click();
    await page.getByLabel('Nova senha').fill('nova-senha-segura-1');
    await page.getByLabel('Confirmar senha').fill('outra-senha-diferente');
    await page.getByRole('button', { name: 'Salvar senha' }).click();
    await expect(page.getByRole('alert')).toHaveText('As senhas não conferem.');
    await page.getByLabel('Confirmar senha').fill('nova-senha-segura-1');
    await page.getByRole('button', { name: 'Salvar senha' }).click();
    await expect(page.getByRole('status')).toHaveText('Senha de "admin" redefinida. O usuário deverá trocá-la no próximo acesso.');
    expect(state.passwordRequests).toEqual([{ id: users()[0].id, body: { password: 'nova-senha-segura-1' } }]);
  });

  test('shows the backend message when the password is refused', async ({ page }) => {
    await mockAdmin(page);
    await page.goto('/settings/users');
    await page.getByRole('row', { name: /^admin\b/ }).getByRole('button', { name: 'Definir senha' }).click();
    await page.getByLabel('Nova senha').fill('curta');
    await page.getByLabel('Confirmar senha').fill('curta');
    await page.getByRole('button', { name: 'Salvar senha' }).click();
    await expect(page.getByRole('alert')).toHaveText('A senha deve ter pelo menos 12 caracteres.');
  });

  test('leaves settings when the admin demotes themselves', async ({ page }) => {
    const self = users()[0].id;
    const state = await mockAdmin(page, { ...admin, userId: self });
    await page.goto('/settings/users');
    await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Configurações' })).toBeVisible();
    state.session = { ...admin, userId: self, role: 'operator' };
    await page.getByRole('row', { name: /^admin\b/ }).getByRole('button', { name: 'Tornar operador' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Configurações' })).toHaveCount(0);
  });

  test('uses tabs instead of the side menu on mobile', async ({ page }) => {
    await mockAdmin(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/settings/users');
    const tabs = page.getByRole('navigation', { name: 'Configurações' }).filter({ visible: true });
    await expect(tabs).toHaveCount(1);
    await expect(tabs.getByRole('link', { name: 'Usuários' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'E-mail' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Login intranet' })).toBeVisible();
    await expect(page.locator('aside nav[aria-label="Configurações"]')).toBeHidden();
    await expect(page.locator('nav[data-settings-nav="tabs"]')).toBeVisible();
  });
});

const oidcConfig = {
  enabled: true, issuer: 'https://intranet.crefito11.gov.br', clientId: 'bulkmail', clientSecret: '',
  clientSecretConfigured: true, backchannelAllowed: true, backchannelOrigin: '', callbackUrl: 'http://127.0.0.1:5174/api/auth/oidc/callback',
};

test.describe('Intranet login settings', () => {
  test('shows the stored settings and the callback URL', async ({ page }) => {
    await mockAdmin(page);
    await page.route('**/api/config/oidc', (route: Route) => route.fulfill(json({ success: true, data: oidcConfig })));
    await page.goto('/settings/oidc');
    await expect(page.getByLabel('Ativar login pela intranet')).toBeChecked();
    await expect(page.getByLabel('Issuer')).toHaveValue('https://intranet.crefito11.gov.br');
    await expect(page.getByLabel('Client secret')).toHaveAttribute('placeholder', 'Configurado — deixe em branco para manter');
    await expect(page.getByLabel('URL de callback')).toHaveValue('http://127.0.0.1:5174/api/auth/oidc/callback');
  });

  test('tests the connection without saving', async ({ page }) => {
    await mockAdmin(page);
    let saved = false;
    await page.route('**/api/config/oidc', async (route: Route) => {
      if (route.request().method() === 'POST') saved = true;
      await route.fulfill(json({ success: true, data: oidcConfig }));
    });
    let testBody: unknown = null;
    await page.route('**/api/config/oidc/test', (route: Route) => {
      testBody = route.request().postDataJSON();
      return route.fulfill(json({ success: true, message: 'Conexão validada: discovery e chaves de assinatura encontrados.' }));
    });
    await page.goto('/settings/oidc');
    await page.getByRole('button', { name: 'Testar' }).click();
    await expect(page.getByRole('status')).toHaveText('Conexão validada: discovery e chaves de assinatura encontrados.');
    expect(saved).toBe(false);
    expect(testBody).toEqual({
      enabled: true, issuer: 'https://intranet.crefito11.gov.br', clientId: 'bulkmail', clientSecret: '', backchannelOrigin: '',
    });
  });

  test('saves and shows validation errors from the server', async ({ page }) => {
    await mockAdmin(page);
    await page.route('**/api/config/oidc', async (route: Route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as { issuer: string; clientSecret: string };
        expect(body.clientSecret).toBe('');
        if (body.issuer.startsWith('http://')) {
          await route.fulfill(json({ success: false, error: 'invalid_oidc_settings', message: 'O issuer precisa usar HTTPS fora do ambiente local.' }, 400));
          return;
        }
        await route.fulfill(json({ success: true, message: 'Configuração do login pela intranet salva.' }));
        return;
      }
      await route.fulfill(json({ success: true, data: oidcConfig }));
    });
    await page.goto('/settings/oidc');
    await page.getByLabel('Issuer').fill('http://intranet.crefito11.gov.br');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('alert')).toHaveText('O issuer precisa usar HTTPS fora do ambiente local.');
    await page.getByLabel('Issuer').fill('https://intranet.crefito11.gov.br');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('status')).toHaveText('Configuração do login pela intranet salva.');
  });

  test('hides backchannel origin and sends it empty when not allowed', async ({ page }) => {
    await mockAdmin(page);
    let posted: Record<string, unknown> | null = null;
    await page.route('**/api/config/oidc', async (route: Route) => {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill(json({ success: true, message: 'Salvo.' }));
        return;
      }
      await route.fulfill(json({ success: true, data: { ...oidcConfig, backchannelAllowed: false, backchannelOrigin: 'http://stale:9000' } }));
    });
    await page.goto('/settings/oidc');
    await expect(page.getByLabel('Issuer')).toBeVisible();
    await expect(page.getByLabel('Backchannel origin')).toHaveCount(0);
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('status')).toHaveText('Salvo.');
    expect(posted).toMatchObject({ backchannelOrigin: '' });
  });

  test('shows backchannel origin when allowed', async ({ page }) => {
    await mockAdmin(page);
    await page.route('**/api/config/oidc', (route: Route) => route.fulfill(json({ success: true, data: oidcConfig })));
    await page.goto('/settings/oidc');
    await expect(page.getByLabel('Backchannel origin')).toBeVisible();
  });

  test('shows a 400 for an invalid issuer even when disabled', async ({ page }) => {
    await mockAdmin(page);
    await page.route('**/api/config/oidc', async (route: Route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill(json({ success: false, error: 'invalid_oidc_settings', message: 'Issuer inválido.' }, 400));
        return;
      }
      await route.fulfill(json({ success: true, data: { ...oidcConfig, enabled: false } }));
    });
    await page.goto('/settings/oidc');
    await expect(page.getByLabel('Ativar login pela intranet')).not.toBeChecked();
    await page.getByLabel('Issuer').fill('not-a-url');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('alert')).toHaveText('Issuer inválido.');
  });

  test('clears the secret input after a successful save', async ({ page }) => {
    await mockAdmin(page);
    await page.route('**/api/config/oidc', async (route: Route) => {
      if (route.request().method() === 'POST') {
        expect((route.request().postDataJSON() as { clientSecret: string }).clientSecret).toBe('novo-segredo');
        await route.fulfill(json({ success: true, message: 'Salvo.' }));
        return;
      }
      await route.fulfill(json({ success: true, data: oidcConfig }));
    });
    await page.goto('/settings/oidc');
    await page.getByLabel('Client secret').fill('novo-segredo');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('status')).toHaveText('Salvo.');
    await expect(page.getByLabel('Client secret')).toHaveValue('');
  });

  test('copies the callback URL', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockAdmin(page);
    await page.route('**/api/config/oidc', (route: Route) => route.fulfill(json({ success: true, data: oidcConfig })));
    await page.goto('/settings/oidc');
    await page.getByRole('button', { name: 'Copiar' }).click();
    await expect(page.getByRole('status')).toHaveText('URL de callback copiada.');
  });

  test('blocks the form when loading fails and recovers on retry', async ({ page }) => {
    await mockAdmin(page);
    let posts = 0;
    let fail = true;
    await page.route('**/api/config/oidc', async (route: Route) => {
      if (route.request().method() === 'POST') { posts += 1; await route.fulfill(json({ success: true, message: 'Salvo.' })); return; }
      if (fail) { await route.fulfill(json({ success: false, error: 'internal', message: 'Falha ao carregar.' }, 500)); return; }
      await route.fulfill(json({ success: true, data: oidcConfig }));
    });
    await page.goto('/settings/oidc');
    await expect(page.getByRole('alert')).toHaveText('Falha ao carregar.');
    await expect(page.getByRole('button', { name: 'Salvar' })).toHaveCount(0);
    await expect(page.getByLabel('Issuer')).toHaveCount(0);
    fail = false;
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByLabel('Issuer')).toHaveValue('https://intranet.crefito11.gov.br');
    await expect(page.getByRole('button', { name: 'Salvar' })).toBeVisible();
    expect(posts).toBe(0);
  });

  test('saves an empty disabled configuration', async ({ page }) => {
    await mockAdmin(page);
    let posted: unknown = null;
    await page.route('**/api/config/oidc', async (route: Route) => {
      if (route.request().method() === 'POST') {
        posted = route.request().postDataJSON();
        await route.fulfill(json({ success: true, message: 'Configuração da intranet atualizada.' }));
        return;
      }
      await route.fulfill(json({ success: true, data: oidcConfig }));
    });
    await page.goto('/settings/oidc');
    await page.getByLabel('Ativar login pela intranet').uncheck();
    await page.getByLabel('Issuer').fill('');
    await page.getByLabel('Client ID').fill('');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByRole('status')).toHaveText('Configuração da intranet atualizada.');
    expect(posted).toEqual({ enabled: false, issuer: '', clientId: '', clientSecret: '', backchannelOrigin: '' });
  });
});
