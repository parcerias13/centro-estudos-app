import { test, expect } from '@playwright/test';

// Enquanto RECUPERAR_POR_EMAIL_ATIVO (lib/features.ts) estiver a false, a
// página de recuperação nunca pode pedir o email nem chamar o Supabase
// Auth — o serviço de email do projeto (sem SMTP próprio) nunca entrega a
// alunos/encarregados, e fingir que enviou era uma falha silenciosa.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test('recuperar: mostra a mensagem do centro, sem pedir email nem chamar o Auth', async ({ page }) => {
  const pedidosAuth: string[] = [];
  page.on('request', (req) => {
    if (/\/auth\/v1\//.test(req.url())) pedidosAuth.push(`${req.method()} ${req.url()}`);
  });

  await page.goto(`${BASE_URL}/recuperar`, { waitUntil: 'networkidle' });

  await expect(page.getByText('Peça ao centro que reponha a sua palavra-passe.')).toBeVisible();
  await expect(page.locator('input[type="email"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /enviar link de recuperação/i })).toHaveCount(0);

  // Dá tempo a qualquer pedido de rede que pudesse disparar sozinho.
  await page.waitForTimeout(1000);
  expect(pedidosAuth, `não devia haver chamadas à API de auth: ${pedidosAuth.join(', ')}`).toHaveLength(0);
});

test('login: a ligação "esqueci-me" mostra o texto novo e leva à mesma mensagem', async ({ page }) => {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });

  const ligacao = page.getByRole('button', { name: /peça ao centro que reponha a sua palavra-passe/i });
  await expect(ligacao).toBeVisible();
  await expect(page.getByText('Esqueci-me da password')).toHaveCount(0);

  const pedidosAuth: string[] = [];
  page.on('request', (req) => {
    if (/\/auth\/v1\//.test(req.url())) pedidosAuth.push(`${req.method()} ${req.url()}`);
  });

  await ligacao.click();
  await page.waitForURL(/\/recuperar/, { timeout: 10_000 });
  await expect(page.getByText('Peça ao centro que reponha a sua palavra-passe.')).toBeVisible();

  await page.waitForTimeout(1000);
  expect(pedidosAuth, `não devia haver chamadas à API de auth: ${pedidosAuth.join(', ')}`).toHaveLength(0);
});
