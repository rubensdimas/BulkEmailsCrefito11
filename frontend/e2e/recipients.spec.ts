import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

test.describe('Entrada manual de destinatários', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  test('cria badges para emails válidos separados por vírgula', async ({ page }) => {
    const recipients = page.locator('#recipients');

    await recipients.fill('first@example.com, second@example.com');

    await expect(page.getByText('first@example.com', { exact: true })).toBeVisible();
    await expect(page.getByText('second@example.com', { exact: true })).toBeVisible();
    await expect(page.getByText('2 email(s) carregado(s) e pronto(s) para envio')).toBeVisible();
  });

  test('rejeita email inválido e aceita os válidos', async ({ page }) => {
    const recipients = page.locator('#recipients');

    await recipients.fill('valid@example.com, invalid-email');

    await expect(page.getByText('valid@example.com', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText('Email inválido: invalid-email');
    await expect(page.getByText('invalid-email', { exact: true })).toHaveCount(0);
  });

  test('remove um destinatário pelo badge', async ({ page }) => {
    const recipients = page.locator('#recipients');

    await recipients.fill('remove@example.com');
    await recipients.press('Enter');
    await expect(page.getByText('remove@example.com', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Remover remove@example.com' }).click();

    await expect(page.getByText('remove@example.com', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Adicione pelo menos um destinatário para continuar')).toBeVisible();
  });

  test('ignora destinatários duplicados', async ({ page }) => {
    const recipients = page.locator('#recipients');

    await recipients.fill('duplicate@example.com, DUPLICATE@example.com');

    await expect(page.getByText('duplicate@example.com', { exact: true })).toHaveCount(1);
    await expect(page.getByText('1 email(s) carregado(s) e pronto(s) para envio')).toBeVisible();
  });
});
