import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Explicações fixas criadas pelo professor, com validação da direção
// (estado_validacao: por_validar/validada/recusada) — criação, lista
// "As minhas fixas" do professor, secção "Por validar" + selo do admin, e as
// regras de acesso (middleware + RLS). Centro descartável ZZTESTE
// (~/Desktop/gestao-centros/novo-centro.mjs), nunca o centro real ou o demo
// — essa recusa já vem do próprio script.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
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
const NOME_ZZTESTE = `ZZTESTE Fixas Validacao ${SUFIXO}`;
const ADMIN_EMAIL = `admin-fixasval-${SUFIXO}@zzteste.invalid`;
const DISCIPLINA_NOME = `Disciplina FixasVal ${SUFIXO}`;
const HOJE = hojeLisboaISO();
const DIA_HOJE_LABEL = DIA_SEMANA_LABEL[diaSemanaISODOW(HOJE)];

type Conta = { email: string; password: string; id: string };

let centroId: string;
let admin: Conta;
let secretaria: Conta;
let prof1: Conta;
let prof2: Conta;
let disciplinaId: number;
let alunoProf1Id: string;
let alunoProf2Id: string;

let serieProf1Id: string;
let serieProf2Id: string;

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

async function criarAluno(nome: string): Promise<string> {
  const sufixo = `${SUFIXO}-${randomInt(100000, 999999)}`;
  const email = `aluno-fixasval-${sufixo}@zzteste.invalid`;
  const id = await criarUtilizadorAuth(email, gerarPasswordSegura(), { centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-fixasval-${sufixo}@zzteste.invalid`,
    data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centroId, ativo: true, sala_estudo: false, faz_explicacoes: true, mensalidade_base: 0,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return id;
}

async function sessaoComo(conta: Conta) {
  const cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await cliente.auth.signInWithPassword({ email: conta.email, password: conta.password });
  if (error) throw new Error(`login ${conta.email}: ${error.message}`);
  return cliente;
}

async function loginUI(p: Page, email: string, password: string) {
  await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="identificador"]', email);
  await p.fill('input[type="password"]', password);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

test.describe.configure({ mode: 'serial' });

test.describe('Explicações fixas criadas pelo professor — validação pela direção — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE FixasVal'],
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

    secretaria = await criarStaff('secretaria', 'Secretaria FixasVal');
    prof1 = await criarStaff('professor', 'Prof FixasVal Um');
    prof2 = await criarStaff('professor', 'Prof FixasVal Dois');

    const { data: disciplina, error: errDisciplina } = await supabaseAdmin
      .from('subjects').insert({ name: DISCIPLINA_NOME, centro_id: centroId }).select('id').single();
    if (errDisciplina) throw new Error(`criar disciplina: ${errDisciplina.message}`);
    disciplinaId = disciplina.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplinaId));

    alunoProf1Id = await criarAluno('Aluno FixasVal Prof1');
    alunoProf2Id = await criarAluno('Aluno FixasVal Prof2');
  });

  test.afterAll(async () => {
    if (centroId) {
      // apagar-centro.mjs ainda não conhece as tabelas de séries — apaga-as
      // primeiro, à mão, para a FK nunca bloquear o apagar do centro.
      const { data: seriesDoCentro } = await supabaseAdmin.from('series_explicacoes').select('id').eq('centro_id', centroId);
      const idsSeries = (seriesDoCentro || []).map((s: any) => s.id);
      if (idsSeries.length > 0) {
        await supabaseAdmin.from('series_explicacoes_alunos').delete().in('serie_id', idsSeries);
        await supabaseAdmin.from('series_explicacoes_pausas').delete().in('serie_id', idsSeries);
        await supabaseAdmin.from('explicacoes').delete().in('serie_id', idsSeries);
        await supabaseAdmin.from('series_explicacoes').delete().in('id', idsSeries);
      }
    }
    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }
    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
  });

  test('professor cria uma fixa para si pela interface — nasce "por_validar", sem escolha de professor, e só vê as suas', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/explicacoes/minhas-fixas`, { waitUntil: 'networkidle' });

    await page.getByLabel('Nova explicação fixa').click();
    await expect(page.getByLabel('Professor')).toHaveCount(0);

    await page.getByPlaceholder('Pesquisar aluno...').fill('Aluno FixasVal Prof1');
    await page.getByRole('button', { name: /Aluno FixasVal Prof1/ }).click();
    await page.getByRole('button', { name: DIA_HOJE_LABEL, exact: true }).click();
    await page.getByLabel('Disciplina (opcional)').selectOption({ label: DISCIPLINA_NOME });
    await page.getByLabel('Hora de início').fill('09:00');
    await page.getByLabel('Duração (horas)').fill('1');
    await page.getByRole('button', { name: 'Criar Explicação Fixa' }).click();

    await expect(page.getByText('Criada. Fica por validar pela direção; as sessões já estão na tua agenda.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Por validar', { exact: true })).toBeVisible();

    await context.close();

    const { data: seriesProf1, error } = await supabaseAdmin
      .from('series_explicacoes').select('id, estado_validacao').eq('centro_id', centroId).eq('professor_id', prof1.id);
    expect(error).toBeNull();
    expect(seriesProf1?.length).toBe(1);
    expect(seriesProf1![0].estado_validacao).toBe('por_validar');
    serieProf1Id = seriesProf1![0].id;

    // Material para o teste do admin e para a verificação de isolamento —
    // uma segunda série, de outro professor, criada diretamente pela RPC
    // (mais rápido do que repetir o fluxo da interface).
    const clienteProf2 = await sessaoComo(prof2);
    const { error: errCriarProf2 } = await clienteProf2.rpc('criar_serie_explicacao', {
      p_professor: prof2.id, p_disciplina: disciplinaId, p_dia: diaSemanaISODOW(HOJE), p_hora: '10:00:00',
      p_duracao: 1, p_alunos: [alunoProf2Id], p_inicio: HOJE, p_fim: null,
    });
    expect(errCriarProf2).toBeNull();
    const { data: seriesProf2 } = await supabaseAdmin
      .from('series_explicacoes').select('id').eq('centro_id', centroId).eq('professor_id', prof2.id);
    expect(seriesProf2?.length).toBe(1);
    serieProf2Id = seriesProf2![0].id;

    // As sessões da fixa de hoje já nascem na agenda do professor, com a
    // etiqueta "Fixa · por validar" (gerar_sessoes_series corre ao abrir
    // /admin/explicacoes).
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await loginUI(page2, prof1.email, prof1.password);
    await page2.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    const linhaHoje = page2.locator('[data-sessao-linha="1"]').filter({ hasText: DISCIPLINA_NOME });
    await expect(linhaHoje.first()).toContainText('Fixa · por validar', { timeout: 15_000 });
    await context2.close();

    // Isolamento: uma consulta direta de prof1 à tabela das séries (sem
    // filtro nenhum) só devolve as dele — o RLS trata do resto.
    const clienteProf1 = await sessaoComo(prof1);
    const { data: todasVisiveisProf1, error: errTodas } = await clienteProf1.from('series_explicacoes').select('id, professor_id');
    expect(errTodas).toBeNull();
    expect((todasVisiveisProf1 || []).every((s: any) => s.professor_id === prof1.id)).toBe(true);
    expect((todasVisiveisProf1 || []).some((s: any) => s.id === serieProf1Id)).toBe(true);
    expect((todasVisiveisProf1 || []).some((s: any) => s.id === serieProf2Id)).toBe(false);
  });

  test('admin: vê o selo e a secção "Por validar"; valida uma e recusa outra', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });

    const linkFixas = page.locator('a[href="/admin/explicacoes/series"]');
    await expect(linkFixas).toContainText('2', { timeout: 15_000 });

    await page.goto(`${BASE_URL}/admin/explicacoes/series`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Por validar · 2')).toBeVisible({ timeout: 15_000 });

    const linhaProf1 = page.locator(`[data-serie-porvalidar="${serieProf1Id}"]`);
    await expect(linhaProf1).toContainText('Prof FixasVal Um');
    await linhaProf1.getByRole('button', { name: 'Validar' }).click();
    await expect(page.getByText('Explicação fixa validada.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Por validar · 1')).toBeVisible({ timeout: 15_000 });

    const linhaProf2 = page.locator(`[data-serie-porvalidar="${serieProf2Id}"]`);
    await expect(linhaProf2).toContainText('Prof FixasVal Dois');
    page.once('dialog', (d) => {
      expect(d.message()).toContain('Recusar remove as sessões futuras ainda não dadas desta explicação fixa.');
      d.accept();
    });
    await linhaProf2.getByRole('button', { name: 'Recusar' }).click();
    await expect(page.getByText(/Explicação fixa recusada\./)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Por validar ·/)).toHaveCount(0, { timeout: 15_000 });

    // Validada: sai de "Por validar", entra na lista principal.
    await expect(page.getByText('Explicações fixas ativas')).toBeVisible();
    await expect(page.getByText('Prof FixasVal Um')).toBeVisible();

    // Recusada: só na secção recolhida.
    await page.getByRole('button', { name: /Recusadas · 1/ }).click();
    await expect(page.getByText('Prof FixasVal Dois')).toBeVisible();

    await context.close();

    const { count: futurasProf2 } = await supabaseAdmin
      .from('explicacoes').select('id', { count: 'exact', head: true })
      .eq('serie_id', serieProf2Id).eq('estado', 'ativa').eq('dado', false);
    expect(futurasProf2 ?? 0).toBe(0);

    const { data: estadosFinal } = await supabaseAdmin
      .from('series_explicacoes').select('id, estado_validacao').in('id', [serieProf1Id, serieProf2Id]);
    expect(estadosFinal?.find((s: any) => s.id === serieProf1Id)?.estado_validacao).toBe('validada');
    expect(estadosFinal?.find((s: any) => s.id === serieProf2Id)?.estado_validacao).toBe('recusada');

    // A etiqueta nas sessões de prof1 volta a "Fixa" (sem "· por validar")
    // e o selo do botão desaparece (0 por validar).
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await loginUI(page2, admin.email, admin.password);
    await page2.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    await page2.locator('select').first().selectOption({ label: 'Prof FixasVal Um' });
    const linhaHoje = page2.locator('[data-sessao-linha="1"]').filter({ hasText: DISCIPLINA_NOME });
    await expect(linhaHoje.first()).toContainText('Fixa', { timeout: 15_000 });
    await expect(linhaHoje.first()).not.toContainText('por validar');
    const linkFixas2 = page2.locator('a[href="/admin/explicacoes/series"]');
    await expect(linkFixas2.locator('span')).toHaveCount(0, { timeout: 15_000 });
    await context2.close();
  });

  test('professor: retira (recusa) uma sua "por validar"', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/explicacoes/minhas-fixas`, { waitUntil: 'networkidle' });

    await page.getByLabel('Nova explicação fixa').click();
    await page.getByPlaceholder('Pesquisar aluno...').fill('Aluno FixasVal Prof1');
    await page.getByRole('button', { name: /Aluno FixasVal Prof1/ }).click();
    await page.getByRole('button', { name: DIA_HOJE_LABEL, exact: true }).click();
    await page.getByLabel('Hora de início').fill('11:00');
    await page.getByLabel('Duração (horas)').fill('1');
    await page.getByRole('button', { name: 'Criar Explicação Fixa' }).click();
    await expect(page.getByText('Criada. Fica por validar pela direção; as sessões já estão na tua agenda.')).toBeVisible({ timeout: 15_000 });

    const { data: novaSerie } = await supabaseAdmin
      .from('series_explicacoes').select('id').eq('professor_id', prof1.id).eq('estado_validacao', 'por_validar').single();
    const serieNovaId = novaSerie!.id;

    const cartaoNova = page.locator(`[data-serie-fixa-professor="${serieNovaId}"]`);
    await expect(cartaoNova.getByRole('button', { name: 'Retirar' })).toBeVisible({ timeout: 15_000 });
    page.once('dialog', (d) => {
      expect(d.message()).toContain('Retirar remove as sessões futuras ainda não dadas.');
      d.accept();
    });
    await cartaoNova.getByRole('button', { name: 'Retirar' }).click();
    await expect(page.getByText(/Explicação fixa retirada\./)).toBeVisible({ timeout: 15_000 });

    await context.close();

    const { data: estadoFinal } = await supabaseAdmin
      .from('series_explicacoes').select('estado_validacao').eq('id', serieNovaId).single();
    expect(estadoFinal?.estado_validacao).toBe('recusada');

    const { count: futuras } = await supabaseAdmin
      .from('explicacoes').select('id', { count: 'exact', head: true })
      .eq('serie_id', serieNovaId).eq('estado', 'ativa').eq('dado', false);
    expect(futuras ?? 0).toBe(0);
  });

  test('professor: não vê "Retirar" nem "Terminar" numa validada; a base de dados recusa a tentativa pela API', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/explicacoes/minhas-fixas`, { waitUntil: 'networkidle' });

    const cartaoValidada = page.locator(`[data-serie-fixa-professor="${serieProf1Id}"]`);
    await expect(cartaoValidada).toBeVisible({ timeout: 15_000 });
    await expect(cartaoValidada).toContainText('Validada');
    await expect(cartaoValidada.getByText('Já tratada pela direção. Para alterar, fala com a direção.')).toBeVisible();
    await expect(cartaoValidada.getByRole('button', { name: 'Retirar' })).toHaveCount(0);
    await expect(cartaoValidada.getByRole('button', { name: /Terminar a partir de/ })).toHaveCount(0);

    await context.close();

    const clienteProf1 = await sessaoComo(prof1);
    const { error: erroRecusarValidada } = await clienteProf1.rpc('recusar_serie', { p_serie: serieProf1Id });
    expect(erroRecusarValidada).not.toBeNull();

    const { data: estadoInalterado } = await supabaseAdmin
      .from('series_explicacoes').select('estado_validacao').eq('id', serieProf1Id).single();
    expect(estadoInalterado?.estado_validacao).toBe('validada');
  });

  test('professor não acede a /admin/explicacoes/series; secretaria não acede a nenhuma das duas páginas', async ({ browser }: { browser: Browser }) => {
    const contextProf = await browser.newContext();
    const pageProf = await contextProf.newPage();
    await loginUI(pageProf, prof1.email, prof1.password);
    await pageProf.goto(`${BASE_URL}/admin/explicacoes/series`, { waitUntil: 'networkidle' });
    await expect(pageProf).not.toHaveURL(/\/admin\/explicacoes\/series/);
    await contextProf.close();

    const contextSec = await browser.newContext();
    const pageSec = await contextSec.newPage();
    await loginUI(pageSec, secretaria.email, secretaria.password);
    await pageSec.goto(`${BASE_URL}/admin/explicacoes/series`, { waitUntil: 'networkidle' });
    await expect(pageSec).not.toHaveURL(/\/admin\/explicacoes\/series/);
    await pageSec.goto(`${BASE_URL}/admin/explicacoes/minhas-fixas`, { waitUntil: 'networkidle' });
    await expect(pageSec).not.toHaveURL(/\/admin\/explicacoes\/minhas-fixas/);
    await contextSec.close();
  });

  test('professor chega ao limite de 30 "por validar" — a 31.ª mostra o erro', async ({ browser }: { browser: Browser }) => {
    const clienteProf2 = await sessaoComo(prof2);
    for (let i = 0; i < 30; i++) {
      const dia = (i % 7) + 1;
      const hora = `${String(6 + Math.floor(i / 7)).padStart(2, '0')}:00:00`;
      const { error } = await clienteProf2.rpc('criar_serie_explicacao', {
        p_professor: prof2.id, p_disciplina: null, p_dia: dia, p_hora: hora,
        p_duracao: 1, p_alunos: [alunoProf2Id], p_inicio: HOJE, p_fim: null,
      });
      expect(error, `série ${i + 1}/30 de prof2`).toBeNull();
    }

    const { count: contagemAntes } = await supabaseAdmin
      .from('series_explicacoes').select('id', { count: 'exact', head: true })
      .eq('professor_id', prof2.id).eq('estado_validacao', 'por_validar');
    expect(contagemAntes).toBe(30);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof2.email, prof2.password);
    await page.goto(`${BASE_URL}/admin/explicacoes/minhas-fixas`, { waitUntil: 'networkidle' });

    await page.getByLabel('Nova explicação fixa').click();
    await page.getByPlaceholder('Pesquisar aluno...').fill('Aluno FixasVal Prof2');
    await page.getByRole('button', { name: /Aluno FixasVal Prof2/ }).click();
    await page.getByRole('button', { name: 'Sáb', exact: true }).click();
    await page.getByLabel('Hora de início').fill('23:00');
    await page.getByLabel('Duração (horas)').fill('1');
    await page.getByRole('button', { name: 'Criar Explicação Fixa' }).click();

    const toastErro = page.locator('div[class*="z-[60]"]');
    await expect(toastErro).toBeVisible({ timeout: 15_000 });
    await expect(toastErro).not.toContainText('Criada.');
    // O formulário continua aberto — onCreated() nunca foi chamado.
    await expect(page.getByRole('button', { name: 'Criar Explicação Fixa' })).toBeVisible();

    await context.close();

    const { count: contagemDepois } = await supabaseAdmin
      .from('series_explicacoes').select('id', { count: 'exact', head: true })
      .eq('professor_id', prof2.id).eq('estado_validacao', 'por_validar');
    expect(contagemDepois).toBe(30);
  });
});
