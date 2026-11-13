import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Gestão redesenhada em 3 separadores (Custos / Preços / Regras do centro),
// guardados em ?aba=custos|precos|regras. Este ficheiro testa só a
// navegação por separadores e a sua estrutura — a lógica de negócio de cada
// bloco (custos, preços por ciclo, cancelamento pelo aluno) já está coberta
// em custos-*.spec.ts, precos-explicacoes-ciclo.spec.ts e
// cancelamento-explicacoes-aluno.spec.ts; não se reimplementa aqui. Centro
// descartável ZZTESTE (~/Desktop/gestao-centros/novo-centro.mjs), nunca o
// centro real (Trupe Lias) nem o Demo.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const GESTAO_DIR = path.join(os.homedir(), 'Desktop', 'gestao-centros');
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE GestaoAbas ${SUFIXO}`;
const ADMIN_EMAIL = `admin-gestaoabas-${SUFIXO}@zzteste.invalid`;

type Conta = { email: string; password: string; id: string };

let centroId: string;
let admin: Conta;
let professor: Conta;
let secretaria: Conta;
let disciplinaId: number | null = null;
let precoExcecaoId: string | null = null;

const limpeza: Array<() => unknown> = [];

async function criarUtilizadorAuth(email: string, password: string, appMetadata: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`criar utilizador ${email}: ${error.message}`);
  const id = data.user.id;
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: appMetadata });
  if (metaError) {
    await supabaseAdmin.auth.admin.deleteUser(id);
    throw new Error(`app_metadata ${email}: ${metaError.message}`);
  }
  return id;
}

async function criarStaff(papel: string, nome: string): Promise<Conta> {
  const email = `${nome.toLowerCase().replace(/\s+/g, '-')}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { role: papel, centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: nome, role: papel, centro_id: centroId });
  if (error) throw new Error(`criar staff ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
  return { email, password, id };
}

async function loginUI(p: Page, email: string, password: string) {
  await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="identificador"]', email);
  await p.fill('input[type="password"]', password);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

async function abrirGestao(p: Page, aba?: 'custos' | 'precos' | 'regras' | string) {
  const url = aba ? `${BASE_URL}/admin/gestao?aba=${aba}` : `${BASE_URL}/admin/gestao`;
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});
}

function abaBotao(p: Page, nome: string) {
  return p.getByRole('tab', { name: nome });
}

async function definirConfig(valores: { aluno_cancela_explicacoes?: boolean; cancelamento_gratis_horas?: number }) {
  const { error } = await supabaseAdmin.from('config_centro').update(valores).eq('id', centroId);
  if (error) throw new Error(`config_centro: ${error.message}`);
}

async function semScrollHorizontal(p: Page) {
  return p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

test.describe.configure({ mode: 'serial' });

test.describe('Gestão — separadores (Custos / Preços / Regras do centro) — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE GestaoAbas'],
      { cwd: GESTAO_DIR, encoding: 'utf8' }
    );
    const m = saida.match(/centro_id = ([0-9a-f-]+)/);
    if (!m) throw new Error('novo-centro.mjs não devolveu centro_id: ' + saida);
    centroId = m[1];

    const { data: staffAdmin, error: staffAdminError } = await supabaseAdmin
      .from('staff').select('id').eq('centro_id', centroId).eq('role', 'admin').single();
    if (staffAdminError || !staffAdmin) throw new Error('não encontrei o staff admin criado pelo novo-centro.mjs');
    const passwordAdmin = gerarPasswordSegura();
    const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(staffAdmin.id, { password: passwordAdmin });
    if (resetError) throw new Error(`rodar password do admin: ${resetError.message}`);
    admin = { email: ADMIN_EMAIL, password: passwordAdmin, id: staffAdmin.id };

    professor = await criarStaff('professor', 'Prof GestaoAbas');
    secretaria = await criarStaff('secretaria', 'Secretaria GestaoAbas');

    // Começa sem exceção de preço por disciplina e com o cancelamento pelo
    // aluno desligado — estados de partida previsíveis para os testes do
    // bloco recolhível e do interruptor.
    await definirConfig({ aluno_cancela_explicacoes: false });
  });

  test.afterAll(async () => {
    if (precoExcecaoId) {
      await supabaseAdmin.from('precos_explicacoes_familia').delete().eq('id', precoExcecaoId);
    }
    if (disciplinaId) {
      await supabaseAdmin.from('subjects').delete().eq('id', disciplinaId);
    }
    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }
    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    const { data: restoPrecos } = await supabaseAdmin.from('precos_explicacoes_familia').select('id').eq('centro_id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
    expect(restoPrecos ?? []).toHaveLength(0);
  });

  test('sessão real: login do admin', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await expect(page).not.toHaveURL(`${BASE_URL}/login`);
    await context.close();
  });

  test('abrir /admin/gestao (sem ?aba=) mostra "Custos" ativo', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await abrirGestao(page);

    await expect(abaBotao(page, 'Custos')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Custos do Centro' })).toBeVisible({ timeout: 15_000 });
    await context.close();
  });

  test('?aba=precos e ?aba=regras mostram o conteúdo certo; um valor inválido cai em Custos', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);

    await abrirGestao(page, 'precos');
    await expect(abaBotao(page, 'Preços')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('precos-ciclo-secao').getByRole('heading', { name: 'Explicações' })).toBeVisible({ timeout: 15_000 });

    await abrirGestao(page, 'regras');
    await expect(abaBotao(page, 'Regras do centro')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Dados do centro' })).toBeVisible({ timeout: 15_000 });

    await abrirGestao(page, 'qualquer-coisa-invalida');
    await expect(abaBotao(page, 'Custos')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Custos do Centro' })).toBeVisible({ timeout: 15_000 });

    await context.close();
  });

  test('clicar num separador muda o endereço e o conteúdo; recarregar mantém-no', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await abrirGestao(page);

    await abaBotao(page, 'Preços').click();
    await expect(page).toHaveURL(/\?aba=precos/);
    await expect(page.getByRole('heading', { name: 'Explicações' })).toBeVisible({ timeout: 10_000 });

    await page.reload({ waitUntil: 'networkidle' });
    await expect(abaBotao(page, 'Preços')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Explicações' })).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('setas do teclado percorrem os separadores (com retrocesso e volta ao início)', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await abrirGestao(page);

    await abaBotao(page, 'Custos').focus();
    await page.keyboard.press('ArrowRight');
    await expect(abaBotao(page, 'Preços')).toHaveAttribute('aria-selected', 'true');
    await expect(abaBotao(page, 'Preços')).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(abaBotao(page, 'Regras do centro')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowRight');
    await expect(abaBotao(page, 'Custos')).toHaveAttribute('aria-selected', 'true'); // deu a volta

    await page.keyboard.press('ArrowLeft');
    await expect(abaBotao(page, 'Regras do centro')).toHaveAttribute('aria-selected', 'true'); // retrocede, dando a volta

    await context.close();
  });

  test('em "Preços" a ordem é Explicações, Extras, Exceções por disciplina (avançado)', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await abrirGestao(page, 'precos');

    const titulos = await page.locator('#painel-precos h3').allTextContents();
    expect(titulos).toEqual(['Explicações', 'Extras', 'Exceções por disciplina (avançado)']);

    await context.close();
  });

  test('Exceções por disciplina começam recolhidas (sem exceções) e abertas depois de criada uma', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await abrirGestao(page, 'precos');

    const botaoExcecoes = page.getByTestId('precos-disciplina-secao');
    await expect(botaoExcecoes).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Só se uma disciplina tiver um preço diferente')).toHaveCount(0);

    // Cria a exceção pela chave de serviço — só para montar o estado, nunca
    // para exercer a ação que o teste quer validar (essa é a UI de Preços).
    const { data: disciplina, error: errDisciplina } = await supabaseAdmin
      .from('subjects').insert({ name: `Disciplina GestaoAbas ${SUFIXO}`, centro_id: centroId }).select('id').single();
    if (errDisciplina) throw new Error(`criar disciplina: ${errDisciplina.message}`);
    disciplinaId = disciplina.id;

    const { data: preco, error: errPreco } = await supabaseAdmin
      .from('precos_explicacoes_familia')
      .insert({ centro_id: centroId, disciplina_id: disciplinaId, ano_escolar: null, tipo: 'fixo', valor: 25 })
      .select('id').single();
    if (errPreco) throw new Error(`criar exceção de preço: ${errPreco.message}`);
    precoExcecaoId = preco.id;

    await abrirGestao(page, 'precos');
    await expect(botaoExcecoes).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(`Disciplina GestaoAbas ${SUFIXO}`)).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('não existe nenhum título "Preços de Explicações" nem "Preços das Explicações"', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);

    for (const aba of ['custos', 'precos', 'regras'] as const) {
      await abrirGestao(page, aba);
      await expect(page.getByText('Preços de Explicações', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Preços das Explicações', { exact: true })).toHaveCount(0);
    }

    await context.close();
  });

  test('"Regras do centro": os cinco blocos aparecem; o interruptor mostra/esconde as horas', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);

    await definirConfig({ aluno_cancela_explicacoes: false });
    await abrirGestao(page, 'regras');

    await expect(page.getByRole('heading', { name: 'Dados do centro' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Presenças no Dashboard')).toBeVisible();
    await expect(page.getByText('Check-in do aluno')).toBeVisible();
    await expect(page.getByText('Avisar as famílias das alterações às explicações')).toBeVisible();
    await expect(page.getByText('Cancelamento de explicações pelos alunos')).toBeVisible();

    await expect(page.getByText('Cancelamento gratuito até (horas antes)')).toHaveCount(0);

    const toggle = page.getByText('Os alunos podem cancelar explicações', { exact: true }).locator('..').getByRole('button');
    await toggle.click();
    await expect(page.getByText('Cancelamento gratuito até (horas antes)')).toBeVisible({ timeout: 10_000 });

    await toggle.click();
    await expect(page.getByText('Cancelamento gratuito até (horas antes)')).toHaveCount(0, { timeout: 10_000 });

    await definirConfig({ aluno_cancela_explicacoes: true, cancelamento_gratis_horas: 24 });
    await context.close();
  });

  test('"Dados do centro": o nome grava com o botão "Guardar" ao lado do campo', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await abrirGestao(page, 'regras');

    const novoNome = `Centro GestaoAbas ${SUFIXO} (editado)`;
    const blocoNome = page.getByText('Nome da Instituição').locator('..');
    await blocoNome.locator('input[type="text"]').fill(novoNome);
    await blocoNome.getByRole('button', { name: /^guardar$/i }).click();
    await expect(blocoNome.getByRole('button', { name: /^guardado$/i })).toBeVisible({ timeout: 10_000 });

    const { data: config } = await supabaseAdmin.from('config_centro').select('nome_centro').eq('id', centroId).single();
    expect(config?.nome_centro).toBe(novoNome);

    await context.close();

    // apagar-centro.mjs recusa qualquer nome que não comece por "ZZTESTE" —
    // repõe o nome original para a limpeza no afterAll poder continuar.
    await supabaseAdmin.from('config_centro').update({ nome_centro: NOME_ZZTESTE }).eq('id', centroId);
  });

  test('professor e secretaria não acedem à Gestão (nenhum separador)', async ({ browser }) => {
    for (const conta of [professor, secretaria]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginUI(page, conta.email, conta.password);
      await page.goto(`${BASE_URL}/admin/gestao?aba=regras`, { waitUntil: 'networkidle' });
      await expect(page).toHaveURL(`${BASE_URL}/admin`);
      await context.close();
    }
  });

  test('360/390/430/1024px sem scroll horizontal em cada separador', async ({ browser }) => {
    test.setTimeout(90_000); // 4 larguras × 3 separadores × login novo — mais do que o default de 30s
    for (const largura of [360, 390, 430, 1024]) {
      const context = await browser.newContext({ viewport: { width: largura, height: 850 } });
      const page = await context.newPage();
      await loginUI(page, admin.email, admin.password);

      for (const aba of ['custos', 'precos', 'regras'] as const) {
        await abrirGestao(page, aba);
        const semScroll = await semScrollHorizontal(page);
        expect(semScroll, `scrollWidth <= clientWidth falhou a ${largura}px (aba ${aba})`).toBe(true);
      }

      await context.close();
    }
  });
});
