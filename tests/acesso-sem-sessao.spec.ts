import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Sem sessão nenhuma, toda a app tem de redirecionar para /login sem
// mostrar menu nem dados — e "Terminar Sessão" tem de apagar mesmo a
// sessão (não só navegar para /login deixando os cookies intactos).

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const PAGINAS = [
  '/admin', '/admin/alunos', '/admin/pagamentos', '/admin/mensagens', '/admin/relatorio-mensal',
  '/', '/notas', '/agenda', '/perfil', '/biblioteca', '/encarregados', '/encarregados/mensagens',
];

let centroId: string;
let admin: { email: string; password: string; id: string };
const limpeza: Array<() => unknown> = [];

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

test.describe('Acesso sem sessão', () => {
  test.beforeAll(async () => {
    const sufixo = String(Date.now());
    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `Teste Acesso Sem Sessão ${sufixo}`, email_remetente: `teste-acesso-sem-sessao-${sufixo}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    const email = `teste-acesso-sem-sessao-admin-${sufixo}@example.invalid`;
    const password = gerarPasswordSegura();
    const { data: userData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
    if (authError) throw new Error(`criar utilizador: ${authError.message}`);
    const id = userData.user.id;
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
    await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { role: 'admin', centro_id: centroId } });
    const { error: staffError } = await supabaseAdmin.from('staff').insert({ id, email, name: 'Admin Teste', role: 'admin', centro_id: centroId });
    if (staffError) throw new Error(`criar staff: ${staffError.message}`);
    limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
    admin = { email, password, id };
  });

  test.afterAll(async () => {
    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }
  });

  test('contexto sem cookies: todas as páginas redirecionam para /login', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const caminho of PAGINAS) {
      await page.goto(`${BASE_URL}${caminho}`, { waitUntil: 'networkidle' });
      expect(page.url(), `${caminho} devia redirecionar para /login`).toContain('/login');
      const texto = await page.evaluate(() => document.body.innerText);
      expect(texto, `${caminho} não devia mostrar o menu`).not.toMatch(/StudyCloud|CogniLab|Gerir Alunos|Dashboard/);
    }
    await context.close();
  });

  test('Terminar Sessão apaga mesmo os cookies — /admin/alunos e o botão Voltar deixam de mostrar nada', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, admin.email, admin.password);

    await page.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });
    expect(page.url()).toContain('/admin/alunos');
    await expect(page.getByText('Gerir Alunos')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /terminar sessão/i }).click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    const cookies = await context.cookies();
    const cookiesAuth = cookies.filter((c) => /^sb-.*-auth-token/.test(c.name) && c.value);
    expect(cookiesAuth, 'cookies de sessão deviam ter sido apagados por Terminar Sessão').toHaveLength(0);

    await page.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });
    expect(page.url()).toContain('/login');

    await page.goBack();
    expect(page.url()).toContain('/login');
    const textoVoltar = await page.evaluate(() => document.body.innerText);
    expect(textoVoltar).not.toMatch(/Gerir Alunos/);

    await context.close();
  });
});
