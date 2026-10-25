import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Login por nome de utilizador para alunos/famílias (proteção de dados: o
// aluno nunca dá email). Staff (admin/professor/secretaria) continua a
// entrar com email, sem alteração. Tudo isolado num centro ZZTESTE próprio,
// apagado no fim.

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

let centroId: string;
let admin: { email: string; password: string; id: string };
let professor: { email: string; password: string; id: string };
let secretaria: { email: string; password: string; id: string };
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

interface DadosAluno {
  nome: string;
  data_nascimento?: string;
  ano_escolar?: number;
  mensalidade_base?: number;
  nome_utilizador_override?: string;
}

async function criarAlunoViaApi(dados: DadosAluno) {
  const res = await adminPage.request.post(`${BASE_URL}/api/admin/criar-aluno`, {
    data: {
      data_nascimento: '2012-05-01',
      ano_escolar: 7,
      mensalidade_base: 50,
      ...dados,
    },
  });
  const body = await res.json();
  if (body.alunoId) {
    // Ordem de limpeza (LIFO — o último "push" corre primeiro): o id do
    // aluno é também o id do utilizador de Auth, e encarregado_codigos /
    // aluno_horarios referenciam aluno_id — têm de sair antes da linha de
    // alunos, que tem de saír antes da conta de Auth e antes de
    // config_centro (ver apagar-centro.mjs, mesma ordem).
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(body.alunoId));
    limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', body.alunoId));
    limpeza.push(() => supabaseAdmin.from('aluno_horarios').delete().eq('aluno_id', body.alunoId));
    limpeza.push(() => supabaseAdmin.from('encarregado_codigos').delete().eq('aluno_id', body.alunoId));
  }
  return { status: res.status(), body: body as { ok?: boolean; alunoId?: string; nomeUtilizador?: string; password?: string; error?: string } };
}

// Simula um aluno criado ANTES desta funcionalidade (email real, criado
// diretamente na Auth e na tabela, sem passar por /api/admin/criar-aluno).
async function criarAlunoEmailReal(nome: string, email: string) {
  const password = gerarPasswordSegura();
  const { data: userData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (authError) throw new Error(`criar utilizador: ${authError.message}`);
  const id = userData.user.id;
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { centro_id: centroId } });
  const { error: dbError } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, data_nascimento: '2010-01-01', ano_escolar: 9, mensalidade_base: 60, centro_id: centroId,
  });
  if (dbError) throw new Error(`criar aluno: ${dbError.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return { id, email, password, nome };
}

test.describe('Login por nome de utilizador', () => {
  test.beforeAll(async ({ browser }) => {
    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Utilizador Login ${SUFIXO}`, email_remetente: `zzteste-utilizador-login-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    async function criarStaff(role: string) {
      const email = `zzteste-utilizador-${role}-${SUFIXO}@example.invalid`;
      const password = gerarPasswordSegura();
      const { data: userData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
      if (authError) throw new Error(`criar ${role}: ${authError.message}`);
      const id = userData.user.id;
      limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
      await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { role, centro_id: centroId } });
      const { error: staffError } = await supabaseAdmin.from('staff').insert({ id, email, name: `ZZTESTE ${role}`, role, centro_id: centroId });
      if (staffError) throw new Error(`criar staff ${role}: ${staffError.message}`);
      limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
      return { email, password, id };
    }

    admin = await criarStaff('admin');
    professor = await criarStaff('professor');
    secretaria = await criarStaff('secretaria');

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

  test('login com o nome de utilizador gerado automaticamente', async ({ browser }) => {
    const { body } = await criarAlunoViaApi({ nome: `Login Utilizador Base ${SUFIXO}` });
    expect(body.ok).toBe(true);
    expect(body.nomeUtilizador).toBeTruthy();

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, body.nomeUtilizador!, body.password!);
    expect(page.url(), 'devia ter entrado, sem ficar em /login').not.toContain('/login');
    await context.close();
  });

  test('login com o utilizador em maiúsculas e com espaços à volta', async ({ browser }) => {
    const { body } = await criarAlunoViaApi({ nome: `Login Maiusculas Espacos ${SUFIXO}` });
    expect(body.ok).toBe(true);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, `   ${body.nomeUtilizador!.toUpperCase()}   `, body.password!);
    expect(page.url(), 'maiúsculas/espaços deviam ser normalizados antes de decidir que não é email').not.toContain('/login');
    await context.close();
  });

  test('login com email antigo (conta criada antes desta funcionalidade) continua a funcionar', async ({ browser }) => {
    const antigo = await criarAlunoEmailReal(`ZZTESTE Antigo ${SUFIXO}`, `zzteste-aluno-antigo-${SUFIXO}@example.invalid`);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, antigo.email, antigo.password);
    expect(page.url(), 'conta com email real devia continuar a entrar normalmente').not.toContain('/login');
    await context.close();
  });

  test('utilizador inexistente e password errada mostram exatamente a mesma mensagem', async ({ browser }) => {
    const { body } = await criarAlunoViaApi({ nome: `Login Mensagem Erro ${SUFIXO}` });
    expect(body.ok).toBe(true);

    // Não usa loginUI() aqui: esse helper espera (até 20s) por uma navegação
    // fora de /login que, num login propositadamente falhado, nunca
    // acontece — só precisamos de preencher, submeter, e esperar pelo erro.
    async function tentarLoginEsperandoErro(page: Page, identificador: string, password: string) {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
      await page.fill('input[name="identificador"]', identificador);
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"]');
      const erro = page.locator('text=/Credenciais inválidas/i').first();
      await expect(erro).toBeVisible({ timeout: 10_000 });
      return (await erro.textContent())?.trim();
    }

    const contextInexistente = await browser.newContext();
    const pageInexistente = await contextInexistente.newPage();
    const textoInexistente = await tentarLoginEsperandoErro(pageInexistente, `utilizador.que.nao.existe.${SUFIXO}`, 'qualquercoisa123');
    await contextInexistente.close();

    const contextPasswordErrada = await browser.newContext();
    const pagePasswordErrada = await contextPasswordErrada.newPage();
    const textoPasswordErrada = await tentarLoginEsperandoErro(pagePasswordErrada, body.nomeUtilizador!, 'password-errada-de-certeza');
    await contextPasswordErrada.close();

    expect(textoInexistente).toBeTruthy();
    expect(textoInexistente).toBe(textoPasswordErrada);
  });

  test('irmãos com o mesmo nome recebem nomes de utilizador diferentes (sufixo automático)', async ({ browser }) => {
    const nomeComum = `Irmaos Zzteste ${SUFIXO}`;
    const irmao1 = await criarAlunoViaApi({ nome: nomeComum, data_nascimento: '2011-01-01' });
    const irmao2 = await criarAlunoViaApi({ nome: nomeComum, data_nascimento: '2013-06-15' });

    expect(irmao1.body.ok).toBe(true);
    expect(irmao2.body.ok).toBe(true);
    expect(irmao2.body.nomeUtilizador).not.toBe(irmao1.body.nomeUtilizador);
    expect(irmao2.body.nomeUtilizador!.startsWith(irmao1.body.nomeUtilizador!)).toBe(true);

    for (const irmao of [irmao1, irmao2]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginUI(page, irmao.body.nomeUtilizador!, irmao.body.password!);
      expect(page.url()).not.toContain('/login');
      await context.close();
    }
  });

  test('professor e secretaria continuam a entrar com email', async ({ browser }) => {
    for (const staff of [professor, secretaria]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginUI(page, staff.email, staff.password);
      expect(page.url(), `${staff.email} devia entrar com o email`).toContain('/admin');
      await context.close();
    }
  });

  test('aluno novo entra e só vê o seu perfil (não vê o nome do outro aluno)', async ({ browser }) => {
    const alunoA = await criarAlunoViaApi({ nome: `Isolamento A Zzteste ${SUFIXO}` });
    const alunoB = await criarAlunoViaApi({ nome: `Isolamento B Zzteste ${SUFIXO}` });
    expect(alunoA.body.ok).toBe(true);
    expect(alunoB.body.ok).toBe(true);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, alunoA.body.nomeUtilizador!, alunoA.body.password!);
    await page.goto(`${BASE_URL}/perfil`, { waitUntil: 'networkidle' });
    const texto = await page.evaluate(() => document.body.innerText);
    expect(texto).toContain('Isolamento A Zzteste');
    expect(texto).not.toContain('Isolamento B Zzteste');
    await context.close();
  });

  test('o email de fachada nunca aparece na lista, na ficha nem no perfil', async ({ browser }) => {
    const aluno = await criarAlunoViaApi({ nome: `Fachada Invisivel Zzteste ${SUFIXO}` });
    expect(aluno.body.ok).toBe(true);

    await adminPage.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });
    const corpoLista = await adminPage.evaluate(() => document.body.innerText);
    expect(corpoLista).not.toContain('@utilizador.invalid');

    await adminPage.goto(`${BASE_URL}/admin/alunos/ficha?id=${aluno.body.alunoId}`, { waitUntil: 'networkidle' });
    const corpoFicha = await adminPage.evaluate(() => document.body.innerText);
    expect(corpoFicha).not.toContain('@utilizador.invalid');

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, aluno.body.nomeUtilizador!, aluno.body.password!);
    await page.goto(`${BASE_URL}/perfil`, { waitUntil: 'networkidle' });
    const corpoPerfil = await page.evaluate(() => document.body.innerText);
    expect(corpoPerfil).not.toContain('@utilizador.invalid');
    expect(corpoPerfil).toContain(aluno.body.nomeUtilizador!);
    await context.close();
  });

  test('reset de password funciona para um aluno novo (utilizador) e para um aluno antigo (email)', async ({ browser }) => {
    const alunoNovo = await criarAlunoViaApi({ nome: `Reset Novo Zzteste ${SUFIXO}` });
    expect(alunoNovo.body.ok).toBe(true);

    const resetNovo = await adminPage.request.post(`${BASE_URL}/api/admin/reset-password`, {
      data: { alunoId: alunoNovo.body.alunoId },
    });
    const corpoResetNovo = await resetNovo.json();
    expect(corpoResetNovo.ok).toBe(true);

    const ctxNovo = await browser.newContext();
    const pageNovo = await ctxNovo.newPage();
    await loginUI(pageNovo, alunoNovo.body.nomeUtilizador!, corpoResetNovo.password);
    expect(pageNovo.url()).not.toContain('/login');
    await ctxNovo.close();

    const antigo = await criarAlunoEmailReal(`ZZTESTE Reset Antigo ${SUFIXO}`, `zzteste-reset-antigo-${SUFIXO}@example.invalid`);
    const resetAntigo = await adminPage.request.post(`${BASE_URL}/api/admin/reset-password`, {
      data: { alunoId: antigo.id },
    });
    const corpoResetAntigo = await resetAntigo.json();
    expect(corpoResetAntigo.ok).toBe(true);

    const ctxAntigo = await browser.newContext();
    const pageAntigo = await ctxAntigo.newPage();
    await loginUI(pageAntigo, antigo.email, corpoResetAntigo.password);
    expect(pageAntigo.url()).not.toContain('/login');
    await ctxAntigo.close();
  });
});
