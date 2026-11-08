import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Filtro por modalidade na escolha de alunos para uma explicação: por
// defeito só "só explicações"/"ambos" (faz_explicacoes = true); "só sala
// de estudo" só entra com a caixa "Mostrar também os alunos de sala de
// estudo" ligada. Cobre os dois sítios partilhados — NovaExplicacaoModal
// (admin e professor, em /admin/explicacoes) e FormularioSerie (Fixas do
// admin e As Minhas Fixas do professor). Centro descartável ZZTESTE
// (~/Desktop/gestao-centros/novo-centro.mjs), nunca o centro real ou o
// demo — essa recusa já vem do próprio script.

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

function hojeLisboaISO(): string {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const obter = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${obter('year')}-${obter('month')}-${obter('day')}`;
}

function diaSemanaISODOW(iso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  return d.getDay() === 0 ? 7 : d.getDay();
}

const DIA_SEMANA_LABEL: Record<number, string> = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb', 7: 'Dom' };

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE FiltroModal ${SUFIXO}`;
const ADMIN_EMAIL = `admin-filtromodal-${SUFIXO}@zzteste.invalid`;
const HOJE = hojeLisboaISO();

const NOME_SALA = `FiltroModal Sala ${SUFIXO}`;
const NOME_EXP = `FiltroModal Exp ${SUFIXO}`;
const NOME_AMBOS = `FiltroModal Ambos ${SUFIXO}`;
const AVISO_SALA_ESTUDO = /está registado só como sala de estudo/;
const SEM_RESULTADOS = /Nenhum aluno de explicações encontrado/;

type Conta = { email: string; password: string; id: string };

let centroId: string;
let admin: Conta;
let professor: Conta;
let alunoSalaId: string;
let alunoExpId: string;
let alunoAmbosId: string;
let serieCriadaId: string | null = null;

const limpeza: Array<() => unknown> = [];

async function criarUtilizadorAuth(email: string, password: string, appMetadata: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`criar utilizador ${email}: ${error.message}`);
  const id = data.user.id;
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: appMetadata });
  if (metaError) throw new Error(`app_metadata ${email}: ${metaError.message}`);
  return id;
}

async function criarStaff(papel: string, nome: string): Promise<Conta> {
  const email = `${nome.toLowerCase().replace(/\s+/g, '-')}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { role: papel, centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: nome, role: papel, centro_id: centroId });
  if (error) throw new Error(`criar staff ${nome}: ${error.message}`);
  return { email, password, id };
}

async function criarAluno(nome: string, salaEstudo: boolean, fazExplicacoes: boolean): Promise<string> {
  const sufixo = `${SUFIXO}-${randomInt(100000, 999999)}`;
  const email = `aluno-filtromodal-${sufixo}@zzteste.invalid`;
  const id = await criarUtilizadorAuth(email, gerarPasswordSegura(), { centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-filtromodal-${sufixo}@zzteste.invalid`,
    data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centroId, ativo: true,
    sala_estudo: salaEstudo, faz_explicacoes: fazExplicacoes, mensalidade_base: 0,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return id;
}

async function loginUI(p: Page, email: string, password: string) {
  await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="identificador"]', email);
  await p.fill('input[type="password"]', password);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

test.describe.configure({ mode: 'serial' });

test.describe('Filtro por modalidade na escolha de alunos para explicações — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE FiltroModal'],
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

    professor = await criarStaff('professor', 'Prof FiltroModal');

    alunoSalaId = await criarAluno(NOME_SALA, true, false);
    alunoExpId = await criarAluno(NOME_EXP, false, true);
    alunoAmbosId = await criarAluno(NOME_AMBOS, true, true);
  });

  test.afterAll(async () => {
    if (centroId) {
      // apagar-centro.mjs ainda não conhece as tabelas de séries — apaga-as
      // primeiro, à mão, para a FK nunca bloquear o apagar do centro.
      if (serieCriadaId) {
        await supabaseAdmin.from('series_explicacoes_alunos').delete().eq('serie_id', serieCriadaId);
        await supabaseAdmin.from('explicacoes').delete().eq('serie_id', serieCriadaId);
        await supabaseAdmin.from('series_explicacoes').delete().eq('id', serieCriadaId);
      }
      await supabaseAdmin.from('explicacoes_alunos').delete().in('aluno_id', [alunoSalaId, alunoExpId, alunoAmbosId].filter(Boolean));
      const { data: expsDoCentro } = await supabaseAdmin.from('explicacoes').select('id').eq('centro_id', centroId);
      const idsExps = (expsDoCentro || []).map((e: any) => e.id);
      if (idsExps.length > 0) {
        await supabaseAdmin.from('explicacoes_alunos').delete().in('explicacao_id', idsExps);
        await supabaseAdmin.from('explicacoes').delete().in('id', idsExps);
      }
    }
    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }
    if (centroId) {
      const saida = execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
      expect(saida).toContain('Confirmado: não resta nada deste centro.');
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
  });

  test('Nova Explicação (admin): filtro por defeito, mensagem sem resultados, caixa liga sala de estudo, aviso, caixa off não remove escolhido, grava-se', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });

    const modal = page.locator('div.fixed.inset-0');
    await page.getByRole('button', { name: /nova explicação/i }).click();
    await expect(modal.getByRole('heading', { name: 'Nova Explicação' })).toBeVisible();

    const busca = modal.getByPlaceholder('Pesquisar aluno...');
    const checkbox = modal.getByLabel('Mostrar também os alunos de sala de estudo');

    // --- pesquisa que só um aluno de sala de estudo cumpriria: por defeito, nada ---
    await busca.fill(`Sala ${SUFIXO}`);
    await expect(modal.getByText(SEM_RESULTADOS)).toBeVisible();
    await expect(modal.getByRole('button', { name: NOME_SALA })).toHaveCount(0);

    // --- liga a caixa: o aluno de sala de estudo passa a aparecer ---
    await checkbox.check();
    await expect(modal.getByRole('button', { name: NOME_SALA })).toBeVisible();

    // --- escolhe-o: aviso discreto, sem bloquear ---
    await modal.getByRole('button', { name: NOME_SALA }).click();
    await expect(modal.getByText(AVISO_SALA_ESTUDO)).toBeVisible();

    // --- desliga a caixa: continua escolhido e visível ---
    await checkbox.uncheck();
    await expect(modal.getByRole('button', { name: NOME_SALA })).toBeVisible();
    await expect(modal.getByText(AVISO_SALA_ESTUDO)).toBeVisible();

    // --- pesquisa mais larga: por defeito (caixa off) mostra explicações/ambos, e o já escolhido de sala de estudo continua ---
    await busca.fill('FiltroModal');
    await expect(modal.getByRole('button', { name: NOME_EXP })).toBeVisible();
    await expect(modal.getByRole('button', { name: NOME_AMBOS })).toBeVisible();
    await expect(modal.getByRole('button', { name: NOME_SALA })).toBeVisible();

    // --- grava-se na mesma, com o aluno de sala de estudo ---
    await modal.locator('input[type="date"]').fill(HOJE);
    await modal.locator('input[type="time"]').fill('09:10');
    await modal.getByRole('button', { name: /marcar explicação/i }).click();
    await expect(page.getByText('Explicação marcada com sucesso.')).toBeVisible({ timeout: 15_000 });
    await expect(modal).toHaveCount(0, { timeout: 15_000 });

    await context.close();

    const { data: exp, error } = await supabaseAdmin
      .from('explicacoes').select('id, explicacoes_alunos(aluno_id)')
      .eq('centro_id', centroId).eq('data', HOJE).eq('hora_inicio', '09:10:00').maybeSingle();
    expect(error).toBeNull();
    expect((exp as any)?.explicacoes_alunos?.map((ea: any) => ea.aluno_id)).toContain(alunoSalaId);
  });

  test('Nova Explicação (professor): mesmo filtro por defeito que o admin', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, professor.email, professor.password);
    await page.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });

    const modal = page.locator('div.fixed.inset-0');
    await page.getByRole('button', { name: /nova explicação/i }).click();
    await expect(modal.getByRole('heading', { name: 'Nova Explicação' })).toBeVisible();

    const busca = modal.getByPlaceholder('Pesquisar aluno...');
    await busca.fill('FiltroModal');
    await expect(modal.getByRole('button', { name: NOME_EXP })).toBeVisible();
    await expect(modal.getByRole('button', { name: NOME_AMBOS })).toBeVisible();
    await expect(modal.getByRole('button', { name: NOME_SALA })).toHaveCount(0);

    await modal.getByLabel('Mostrar também os alunos de sala de estudo').check();
    await expect(modal.getByRole('button', { name: NOME_SALA })).toBeVisible();

    // Fecha sem criar nada (ainda na etapa 'nova' — fecha direto, sem confirmação).
    await modal.locator('h2', { hasText: 'Nova Explicação' }).locator('xpath=..').locator('button').click();
    await expect(modal).toHaveCount(0);
    await context.close();
  });

  test('Fixas (admin): filtro por defeito, mensagem sem resultados, caixa liga sala de estudo, aviso, caixa off não remove escolhido, grava-se', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/explicacoes/series`, { waitUntil: 'networkidle' });

    await page.getByLabel('Nova explicação fixa').click();
    await page.getByLabel('Professor').selectOption({ label: 'Prof FiltroModal' });

    const busca = page.getByPlaceholder('Pesquisar aluno...');
    const checkbox = page.getByLabel('Mostrar também os alunos de sala de estudo');

    await busca.fill(`Sala ${SUFIXO}`);
    await expect(page.getByText(SEM_RESULTADOS)).toBeVisible();
    await expect(page.getByRole('button', { name: NOME_SALA })).toHaveCount(0);

    await checkbox.check();
    await expect(page.getByRole('button', { name: NOME_SALA })).toBeVisible();
    await page.getByRole('button', { name: NOME_SALA }).click();
    await expect(page.getByText(AVISO_SALA_ESTUDO)).toBeVisible();

    await checkbox.uncheck();
    await expect(page.getByRole('button', { name: NOME_SALA })).toBeVisible();
    await expect(page.getByText(AVISO_SALA_ESTUDO)).toBeVisible();

    const diaLabel = DIA_SEMANA_LABEL[diaSemanaISODOW(HOJE)];
    await page.getByRole('button', { name: diaLabel, exact: true }).click();
    await page.getByLabel('Hora de início').fill('10:00');
    await page.getByLabel('Duração (horas)').fill('1');
    await page.getByLabel('Início', { exact: true }).fill(HOJE);
    await page.getByRole('button', { name: 'Criar Explicação Fixa' }).click();
    await expect(page.getByText('Explicação fixa criada.')).toBeVisible({ timeout: 15_000 });

    await context.close();

    const { data: series, error } = await supabaseAdmin
      .from('series_explicacoes').select('id, series_explicacoes_alunos(aluno_id)')
      .eq('centro_id', centroId).eq('professor_id', professor.id);
    expect(error).toBeNull();
    expect(series?.length).toBe(1);
    serieCriadaId = series![0].id;
    expect((series![0] as any).series_explicacoes_alunos.map((sa: any) => sa.aluno_id)).toContain(alunoSalaId);
  });

  test('As Minhas Fixas (professor): mesmo filtro por defeito que o admin', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, professor.email, professor.password);
    await page.goto(`${BASE_URL}/admin/explicacoes/minhas-fixas`, { waitUntil: 'networkidle' });

    await page.getByLabel('Nova explicação fixa').click();

    const busca = page.getByPlaceholder('Pesquisar aluno...');
    await busca.fill('FiltroModal');
    await expect(page.getByRole('button', { name: NOME_EXP })).toBeVisible();
    await expect(page.getByRole('button', { name: NOME_AMBOS })).toBeVisible();
    await expect(page.getByRole('button', { name: NOME_SALA })).toHaveCount(0);

    await page.getByLabel('Mostrar também os alunos de sala de estudo').check();
    await expect(page.getByRole('button', { name: NOME_SALA })).toBeVisible();

    await context.close();
  });
});
