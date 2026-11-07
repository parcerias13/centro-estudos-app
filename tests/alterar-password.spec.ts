import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Ciclo 1 de "alterar palavras-passe" — rota /api/conta/alterar-password,
// perfil de staff, Área dos Encarregados, remoção da password do perfil do
// aluno, e reposição de password de staff pela Direção. Tudo isolado em
// centros ZZTESTE próprios, apagados no fim (nunca o centro Trupe Lias).

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const SUFIXO = String(Date.now());

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Mesma construção de cookie que ~/Desktop/gestao-centros/lib.mjs usa para
// falar com a app Next.js com uma sessão real sem precisar de um browser —
// necessário no teste (b) para ter duas sessões independentes da MESMA
// conta e confirmar que mudar a password numa não derruba essa, só a outra.
const CHUNK_SIZE = 3180;
function construirCookieSessao(session: any): string {
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0];
  const nome = `sb-${ref}-auth-token`;
  const base64url = Buffer.from(JSON.stringify(session), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const valor = `base64-${base64url}`;
  if (valor.length <= CHUNK_SIZE) return `${nome}=${valor}`;
  const partes: string[] = [];
  for (let i = 0; i < valor.length; i += CHUNK_SIZE) partes.push(valor.slice(i, i + CHUNK_SIZE));
  return partes.map((p, i) => `${nome}.${i}=${p}`).join('; ');
}

type Conta = { email: string; password: string; id: string };

let centroId: string;
let centroOutroId: string;
let admin: Conta;
let adminContext: BrowserContext;
let adminPage: Page;
const limpeza: Array<() => unknown> = [];

async function loginUI(page: Page, identificador: string, password: string) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="identificador"]', identificador);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

async function criarStaff(role: 'admin' | 'professor' | 'secretaria', centro: string, prefixo: string): Promise<Conta> {
  const email = `zzteste-pass-${prefixo}-${role}-${Date.now()}-${randomInt(0, 999999)}@example.invalid`;
  const password = gerarPasswordSegura();
  const { data: userData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (authError) throw new Error(`criar ${role}: ${authError.message}`);
  const id = userData.user.id;
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { role, centro_id: centro } });
  const { error: staffError } = await supabaseAdmin.from('staff').insert({ id, email, name: `ZZTESTE ${role} ${prefixo}`, role, centro_id: centro });
  if (staffError) throw new Error(`criar staff ${role}: ${staffError.message}`);
  limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
  return { email, password, id };
}

// Aluno/família com email real (mais simples para login direto nestes
// testes — o fluxo de username está coberto noutros specs) e um código de
// 4 dígitos já definido, para a Área dos Encarregados.
async function criarAlunoComCodigo(centro: string, prefixo: string, codigo = '1234'): Promise<Conta> {
  const email = `zzteste-pass-${prefixo}-aluno-${Date.now()}-${randomInt(0, 999999)}@example.invalid`;
  const password = gerarPasswordSegura();
  const { data: userData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (authError) throw new Error(`criar aluno: ${authError.message}`);
  const id = userData.user.id;
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { centro_id: centro } });
  const { error: alunoError } = await supabaseAdmin.from('alunos').insert({
    id, nome: `ZZTESTE Aluno ${prefixo}`, email, data_nascimento: '2011-01-01', ano_escolar: 8, centro_id: centro,
  });
  if (alunoError) throw new Error(`criar aluno: ${alunoError.message}`);
  limpeza.push(() => supabaseAdmin.from('encarregado_codigos').delete().eq('aluno_id', id));
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));

  const { error: codigoError } = await supabaseAdmin.rpc('definir_codigo_encarregado', { p_aluno_id: id, p_codigo: codigo });
  if (codigoError) throw new Error(`definir código: ${codigoError.message}`);

  return { email, password, id };
}

test.describe('Ciclo 1 — Alterar palavras-passe', () => {
  test.beforeAll(async ({ browser }) => {
    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Passwords Ciclo1 ${SUFIXO}`, email_remetente: `zzteste-passwords-ciclo1-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    const { data: centroOutro, error: centroOutroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Passwords Ciclo1 Outro ${SUFIXO}`, email_remetente: `zzteste-passwords-ciclo1-outro-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroOutroError) throw new Error(`criar config_centro outro: ${centroOutroError.message}`);
    centroOutroId = centroOutro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroOutroId));

    admin = await criarStaff('admin', centroId, 'base');

    adminContext = await browser.newContext();
    adminPage = await adminContext.newPage();
    await loginUI(adminPage, admin.email, admin.password);
    expect(adminPage.url()).toContain('/admin');
  });

  test.afterAll(async () => {
    await adminContext?.close();
    for (const passo of [...limpeza].reverse()) {
      try {
        const resultado: any = await Promise.resolve(passo());
        if (resultado?.error) console.warn('limpeza: passo com erro (não fatal):', resultado.error.message);
      } catch (err: any) {
        console.warn('limpeza: passo lançou (não fatal):', err?.message);
      }
    }
  });

  // --- (a) a rota em si ---------------------------------------------------
  test.describe('(a) /api/conta/alterar-password', () => {
    test('atual correta e nova válida: muda, login com a nova funciona, com a antiga falha', async ({ browser }) => {
      const staff = await criarStaff('professor', centroId, 'a1');
      const context = await browser.newContext();
      await loginUI(await context.newPage(), staff.email, staff.password);

      const nova = gerarPasswordSegura();
      const res = await context.request.post(`${BASE_URL}/api/conta/alterar-password`, { data: { atual: staff.password, nova } });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      const ctxNova = await browser.newContext();
      await loginUI(await ctxNova.newPage(), staff.email, nova);
      expect((await ctxNova.pages())[0].url()).not.toContain('/login');
      await ctxNova.close();

      const ctxAntiga = await browser.newContext();
      const pageAntiga = await ctxAntiga.newPage();
      await pageAntiga.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
      await pageAntiga.fill('input[name="identificador"]', staff.email);
      await pageAntiga.fill('input[type="password"]', staff.password);
      await pageAntiga.click('button[type="submit"]');
      await expect(pageAntiga.getByText(/credenciais inválidas/i)).toBeVisible({ timeout: 10_000 });
      await ctxAntiga.close();
      await context.close();
    });

    test('atual errada: recusa e nada muda', async ({ browser }) => {
      const staff = await criarStaff('professor', centroId, 'a2');
      const context = await browser.newContext();
      await loginUI(await context.newPage(), staff.email, staff.password);

      const res = await context.request.post(`${BASE_URL}/api/conta/alterar-password`, {
        data: { atual: 'password-errada-de-certeza', nova: gerarPasswordSegura() },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('A palavra-passe atual está incorreta.');

      const ctxVerifica = await browser.newContext();
      await loginUI(await ctxVerifica.newPage(), staff.email, staff.password);
      expect((await ctxVerifica.pages())[0].url()).not.toContain('/login');
      await ctxVerifica.close();
      await context.close();
    });

    test('nova com menos de 6 caracteres: recusa', async ({ browser }) => {
      const staff = await criarStaff('professor', centroId, 'a3');
      const context = await browser.newContext();
      await loginUI(await context.newPage(), staff.email, staff.password);

      const res = await context.request.post(`${BASE_URL}/api/conta/alterar-password`, {
        data: { atual: staff.password, nova: 'ab12c' },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('A nova palavra-passe tem de ter pelo menos 6 caracteres.');
      await context.close();
    });

    test('nova igual à atual: recusa', async ({ browser }) => {
      const staff = await criarStaff('professor', centroId, 'a4');
      const context = await browser.newContext();
      await loginUI(await context.newPage(), staff.email, staff.password);

      const res = await context.request.post(`${BASE_URL}/api/conta/alterar-password`, {
        data: { atual: staff.password, nova: staff.password },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('A nova palavra-passe tem de ser diferente da atual.');
      await context.close();
    });

    test('sem sessão: recusa', async ({ browser }) => {
      const context = await browser.newContext();
      const res = await context.request.post(`${BASE_URL}/api/conta/alterar-password`, {
        data: { atual: 'qualquer', nova: 'qualquercoisa123' },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(401);
      await context.close();
    });
  });

  // --- (b) outras sessões revogadas, sessão atual sobrevive ---------------
  test.describe('(b) revogação de sessões', () => {
    async function duasSessoesMudancaNaPrimeira(email: string, passwordInicial: string) {
      const { data: d1, error: e1 } = await supabaseAnon.auth.signInWithPassword({ email, password: passwordInicial });
      if (e1) throw new Error(`login sessão1: ${e1.message}`);
      const { data: d2, error: e2 } = await supabaseAnon.auth.signInWithPassword({ email, password: passwordInicial });
      if (e2) throw new Error(`login sessão2: ${e2.message}`);

      const nova = gerarPasswordSegura();
      const res = await fetch(`${BASE_URL}/api/conta/alterar-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: construirCookieSessao(d1.session) },
        body: JSON.stringify({ atual: passwordInicial, nova }),
      });
      expect(res.status).toBe(200);

      return { sessao1: d1.session, sessao2: d2.session, nova };
    }

    test('conta de staff — sessão que mudou continua, a outra falha ao renovar', async () => {
      const staff = await criarStaff('secretaria', centroId, 'b1');
      const { sessao1, sessao2 } = await duasSessoesMudancaNaPrimeira(staff.email, staff.password);

      const { error: errRefresh2 } = await supabaseAnon.auth.refreshSession({ refresh_token: sessao2.refresh_token });
      expect(errRefresh2, 'a sessão que NÃO mudou a password devia ter sido revogada').toBeTruthy();

      const { error: errRefresh1 } = await supabaseAnon.auth.refreshSession({ refresh_token: sessao1.refresh_token });
      expect(errRefresh1, 'a sessão que mudou a password devia continuar viva').toBeFalsy();
    });

    test('conta de aluno — sessão que mudou continua, a outra falha ao renovar', async () => {
      const aluno = await criarAlunoComCodigo(centroId, 'b2');
      const { sessao1, sessao2 } = await duasSessoesMudancaNaPrimeira(aluno.email, aluno.password);

      const { error: errRefresh2 } = await supabaseAnon.auth.refreshSession({ refresh_token: sessao2.refresh_token });
      expect(errRefresh2, 'a sessão que NÃO mudou a password devia ter sido revogada').toBeTruthy();

      const { error: errRefresh1 } = await supabaseAnon.auth.refreshSession({ refresh_token: sessao1.refresh_token });
      expect(errRefresh1, 'a sessão que mudou a password devia continuar viva').toBeFalsy();
    });
  });

  // --- (c) perfil de staff -------------------------------------------------
  test.describe('(c) /admin/perfil', () => {
    for (const role of ['admin', 'professor', 'secretaria'] as const) {
      test(`${role} chega ao perfil, vê os dados e muda a palavra-passe pela interface`, async ({ browser }) => {
        const staff = await criarStaff(role, centroId, `c-${role}`);
        const context = await browser.newContext();
        const page = await context.newPage();
        await loginUI(page, staff.email, staff.password);

        await page.goto(`${BASE_URL}/admin/perfil`, { waitUntil: 'networkidle' });
        expect(page.url(), `${role} devia conseguir abrir /admin/perfil`).toContain('/admin/perfil');

        const texto = await page.evaluate(() => document.body.innerText);
        expect(texto).toContain(`ZZTESTE ${role} c-${role}`);
        expect(texto).toContain(staff.email);
        expect(texto.toLowerCase()).toContain(role);

        const nova = gerarPasswordSegura();
        const passwordInputs = page.locator('input[type="password"]');
        await passwordInputs.nth(0).fill(staff.password);
        await passwordInputs.nth(1).fill(nova);
        await passwordInputs.nth(2).fill(nova);
        await page.getByRole('button', { name: /gravar nova palavra-passe/i }).click();
        await expect(page.getByText(/alterada com sucesso/i)).toBeVisible({ timeout: 10_000 });
        await context.close();

        const ctxNova = await browser.newContext();
        await loginUI(await ctxNova.newPage(), staff.email, nova);
        expect((await ctxNova.pages())[0].url()).not.toContain('/login');
        await ctxNova.close();
      });
    }
  });

  // --- (d) Área dos Encarregados ------------------------------------------
  test.describe('(d) /encarregados/password', () => {
    test('só abre depois do código; sem desbloqueio volta ao ecrã do código; muda a password', async ({ browser }) => {
      const aluno = await criarAlunoComCodigo(centroId, 'd1', '4321');
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginUI(page, aluno.email, aluno.password);

      // Sem desbloquear ainda — tentar ir direto à página da password tem de voltar ao ecrã do código.
      await page.goto(`${BASE_URL}/encarregados/password`, { waitUntil: 'networkidle' });
      expect(page.url()).toContain('/encarregados');
      expect(page.url()).not.toContain('/encarregados/password');

      // Desbloquear com o código.
      await page.goto(`${BASE_URL}/encarregados`, { waitUntil: 'networkidle' });
      await page.fill('input[inputmode="numeric"]', '4321');
      await page.getByRole('button', { name: /entrar/i }).click();
      await expect(page.getByText(/Olá/i)).toBeVisible({ timeout: 10_000 });

      // Agora sim, a página da password abre — por navegação client-side
      // (clicar no link), nunca page.goto(): o desbloqueio vive só em
      // memória do módulo (lib/encarregadoUnlock.ts), que um reload
      // completo da página reinicia de propósito.
      await page.getByRole('link', { name: /alterar palavra-passe/i }).click();
      await page.waitForURL(/\/encarregados\/password/, { timeout: 10_000 });
      expect(page.url()).toContain('/encarregados/password');
      await expect(page.getByText(/também é a do seu educando/i)).toBeVisible({ timeout: 10_000 });

      const nova = gerarPasswordSegura();
      const passwordInputs = page.locator('input[type="password"]');
      await passwordInputs.nth(0).fill(aluno.password);
      await passwordInputs.nth(1).fill(nova);
      await passwordInputs.nth(2).fill(nova);
      await page.getByRole('button', { name: /guardar nova palavra-passe/i }).click();
      await expect(page.getByText(/palavra-passe alterada/i).first()).toBeVisible({ timeout: 10_000 });
      await context.close();

      const ctxNova = await browser.newContext();
      await loginUI(await ctxNova.newPage(), aluno.email, nova);
      expect((await ctxNova.pages())[0].url()).not.toContain('/login');
      await ctxNova.close();
    });
  });

  // --- (e) perfil do aluno sem a zona de segurança ------------------------
  test.describe('(e) /perfil (aluno) sem mudança de password', () => {
    test('não mostra nenhum campo de password, e a password não muda pela API antiga', async ({ browser }) => {
      const aluno = await criarAlunoComCodigo(centroId, 'e1');
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginUI(page, aluno.email, aluno.password);

      await page.goto(`${BASE_URL}/perfil`, { waitUntil: 'networkidle' });
      const campos = await page.locator('input[type="password"]').count();
      expect(campos, 'o perfil do aluno não devia ter nenhum campo de password').toBe(0);

      const texto = await page.evaluate(() => document.body.innerText);
      expect(texto).not.toMatch(/segurança da conta/i);
      await context.close();
    });
  });

  // --- (f) Direção repõe a de staff ---------------------------------------
  test.describe('(f) Direção repõe password de staff', () => {
    test('repõe a de um professor; recusa a de um admin; recusa a de outro centro', async ({ browser }) => {
      const professor = await criarStaff('professor', centroId, 'f1');
      const outroAdmin = await criarStaff('admin', centroId, 'f2');
      const professorOutroCentro = await criarStaff('professor', centroOutroId, 'f3');

      const resProfessor = await adminPage.request.post(`${BASE_URL}/api/admin/reset-password`, { data: { staffId: professor.id } });
      expect(resProfessor.status()).toBe(200);
      const corpoProfessor = await resProfessor.json();
      expect(corpoProfessor.ok).toBe(true);
      expect(typeof corpoProfessor.password).toBe('string');
      expect(corpoProfessor.password.length).toBeGreaterThanOrEqual(10);

      const ctxNova = await browser.newContext();
      await loginUI(await ctxNova.newPage(), professor.email, corpoProfessor.password);
      expect((await ctxNova.pages())[0].url()).not.toContain('/login');
      await ctxNova.close();

      const resAdmin = await adminPage.request.post(`${BASE_URL}/api/admin/reset-password`, { data: { staffId: outroAdmin.id }, failOnStatusCode: false });
      expect(resAdmin.status(), 'nunca se deve repor a password de um admin por esta rota').toBe(404);

      const resOutroCentro = await adminPage.request.post(`${BASE_URL}/api/admin/reset-password`, { data: { staffId: professorOutroCentro.id }, failOnStatusCode: false });
      expect(resOutroCentro.status(), 'nunca se deve repor a password de staff de outro centro').toBe(404);
    });
  });

  // --- (g) criar staff com menos de 6 caracteres --------------------------
  test.describe('(g) criar-staff exige mínimo de 6 caracteres', () => {
    test('recusa no formulário (cliente) e no servidor (API)', async () => {
      const emailCurto = `zzteste-pass-g-curta-${Date.now()}@example.invalid`;

      await adminPage.goto(`${BASE_URL}/admin/equipa`, { waitUntil: 'networkidle' });
      await adminPage.fill('input[placeholder="Ex: Maria Santos"]', 'ZZTESTE Password Curta');
      await adminPage.fill('input[placeholder="email@gmail.com"]', emailCurto);
      await adminPage.fill('input[placeholder="Mínimo 6 caracteres"]', 'abc12');
      await adminPage.getByRole('button', { name: /dar acesso/i }).click();
      await expect(adminPage.getByText(/pelo menos 6 caracteres/i)).toBeVisible({ timeout: 10_000 });

      const { data: staffCriado } = await supabaseAdmin.from('staff').select('id').eq('email', emailCurto).maybeSingle();
      expect(staffCriado, 'a conta não devia ter sido criada').toBeNull();

      const resApi = await adminPage.request.post(`${BASE_URL}/api/admin/criar-staff`, {
        data: { email: `zzteste-pass-g-servidor-${Date.now()}@example.invalid`, password: 'abc', name: 'ZZTESTE Servidor Curta', role: 'professor' },
        failOnStatusCode: false,
      });
      expect(resApi.status()).toBe(400);
      const corpoApi = await resApi.json();
      expect(corpoApi.error).toBe('A palavra-passe tem de ter pelo menos 6 caracteres.');
    });
  });
});
