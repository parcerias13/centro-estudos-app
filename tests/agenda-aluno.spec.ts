import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { getHojeLisboa } from '@/lib/dataLisboa';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, addMonths, addDays,
  differenceInCalendarMonths, format, parseISO,
} from 'date-fns';
import { pt } from 'date-fns/locale';

dotenv.config({ path: '.env.local' });

// Redesenho da Agenda do Aluno (app/agenda/page.tsx): calendário do mês,
// bottom sheets (dia / novo+editar teste), editar/apagar os próprios testes
// (sem nota, data de hoje em diante), "Próximos Testes" sempre em
// Europe/Lisbon (nunca new Date() do browser), tokens --color-agenda-accent
// / --color-on-agenda-accent, e o ícone decorativo removido. Centro
// descartável ZZTESTE via ~/Desktop/gestao-centros/novo-centro.mjs — nunca
// o centro real ("Trupe Lias") nem o demo. Nenhuma credencial impressa;
// password do admin rodada por script, nunca lida do ficheiro que o
// novo-centro.mjs escreve.

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

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE Agenda Aluno ${SUFIXO}`;
const ADMIN_EMAIL = `admin-agaluno-${SUFIXO}@zzteste.invalid`;
const HOJE = getHojeLisboa();

type Conta = { email: string; password: string; id: string };
type Subj = { id: number; name: string };

let centroId: string;
let admin: Conta;
let aluno1: Conta;
let aluno2: Conta;

let subjMatematica: Subj;
let subjIngles: Subj;
let subjNovo: Subj;
let subjDuploToque: Subj;
let subjEditar: Subj;
let subjApagar: Subj;
let subjIsolamento: Subj;

let idExamFechadoPassado: string;

const examIds: string[] = [];
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

async function criarAluno(sufixo: string, anoEscolar = 8): Promise<Conta> {
  const email = `aluno-agaluno-${sufixo}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome: `Aluno Agenda ${sufixo}`, email, email_encarregado: `enc-agaluno-${sufixo}@zzteste.invalid`,
    data_nascimento: '2012-01-01', ano_escolar: anoEscolar, centro_id: centroId, ativo: true,
    sala_estudo: true, faz_explicacoes: false, mensalidade_base: 0,
  });
  if (error) throw new Error(`criar aluno ${sufixo}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return { email, password, id };
}

async function criarDisciplina(nome: string): Promise<Subj> {
  const { data, error } = await supabaseAdmin
    .from('subjects').insert({ name: nome, centro_id: centroId, anos_aplicaveis: null }).select('id, name').single();
  if (error) throw new Error(`criar disciplina ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', data!.id));
  return data!;
}

async function sessaoComo(conta: Conta) {
  const cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await cliente.auth.signInWithPassword({ email: conta.email, password: conta.password });
  if (error) throw new Error(`login ${conta.email}: ${error.message}`);
  return cliente;
}

async function loginUI(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="identificador"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

async function abrirAgenda(page: Page) {
  await page.goto(`${BASE_URL}/agenda`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: /a minha agenda/i })).toBeVisible({ timeout: 15_000 });
}

function addDiasISO(dataISO: string, dias: number): string {
  return format(addDays(parseISO(dataISO), dias), 'yyyy-MM-dd');
}

// Mesmo texto que o componente calcula para o aria-label de cada dia da
// grelha — construído aqui de forma independente (não importado do
// componente) para o teste continuar a validar o resultado visível.
function labelDia(dataISO: string, disciplinas: string[]): string {
  const base = format(parseISO(dataISO), "d 'de' MMMM", { locale: pt });
  if (disciplinas.length === 0) return `${base}, sem testes`;
  return `${base}, ${disciplinas.length} ${disciplinas.length === 1 ? 'teste' : 'testes'}: ${disciplinas.join(', ')}`;
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Para um dia que pode acumular testes de outras disciplinas entre testes
// (ex.: HOJE, reutilizado em vários casos de teste) — confirma só o prefixo
// do dia/mês e que a disciplina aparece na lista, sem exigir a contagem ou a
// lista completa.
function labelDiaContendo(dataISO: string, subjectName: string): RegExp {
  const base = format(parseISO(dataISO), "d 'de' MMMM", { locale: pt });
  return new RegExp(`^${escaparRegex(base)}, \\d+ testes?: .*${escaparRegex(subjectName)}`);
}

// Dentro do bottom sheet do dia (que pode ter vários testes acumulados no
// mesmo dia, entre casos de teste), isola o cartão de UM teste específico
// pela disciplina — para o "Editar"/"Apagar" clicado ser sempre o certo.
function cartaoDoExameNoSheet(page: Page, subjectName: string) {
  return page.locator('div.rounded-t-3xl').locator('div.rounded-2xl', { hasText: subjectName });
}

// Navega o calendário (só /agenda, que tem aria-label nos chevrons) a
// partir do mês atualmente exibido — que começa sempre no mês real no
// momento em que a página carrega, sem persistência entre loads.
function criarNavegadorDeMes(page: Page) {
  let atual = startOfMonth(new Date());
  return async (dataISO: string) => {
    const alvo = startOfMonth(parseISO(dataISO));
    const diff = differenceInCalendarMonths(alvo, atual);
    if (diff !== 0) {
      const botao = page.getByRole('button', { name: diff > 0 ? 'Mês seguinte' : 'Mês anterior' });
      for (let i = 0; i < Math.abs(diff); i++) await botao.click();
    }
    atual = alvo;
  };
}

// Mês próximo (a partir de daqui a 1 mês) cuja grelha Seg-Dom tem overflow
// dos DOIS lados — para o teste do dia 1 / último dia / overflow nunca
// depender de em que mês real os testes correm.
function acharMesComOverflowNosDoisLados(): Date {
  let mes = startOfMonth(addMonths(new Date(), 1));
  for (let i = 0; i < 8; i++) {
    const inicio = startOfMonth(mes);
    const fim = endOfMonth(mes);
    const gridInicio = startOfWeek(inicio, { weekStartsOn: 1 });
    const gridFim = endOfWeek(fim, { weekStartsOn: 1 });
    if (gridInicio.getTime() < inicio.getTime() && gridFim.getTime() > fim.getTime()) return mes;
    mes = addMonths(mes, 1);
  }
  throw new Error('não encontrei, em 8 tentativas, um mês com overflow nos dois lados');
}

async function abrirNovoTesteViaBotao(page: Page) {
  await page.getByRole('button', { name: /^novo teste$/i }).click();
  await expect(page.getByRole('heading', { name: /marcar novo teste/i })).toBeVisible();
}

async function preencherEGuardar(page: Page, opts: { subject: string; date: string; topics?: string }) {
  await page.locator('select').selectOption({ label: opts.subject });
  await page.locator('input[type="date"]').fill(opts.date);
  if (opts.topics !== undefined) await page.locator('textarea').fill(opts.topics);
  await page.getByRole('button', { name: /^guardar$/i }).click();
}

test.describe.configure({ mode: 'serial' });

test.describe('Agenda do Aluno — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE Agenda Aluno'],
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

    subjMatematica = await criarDisciplina(`Matemática AgAluno ${SUFIXO}`);
    subjIngles = await criarDisciplina(`Inglês AgAluno ${SUFIXO}`);
    subjNovo = await criarDisciplina(`Nova AgAluno ${SUFIXO}`);
    subjDuploToque = await criarDisciplina(`DuploToque AgAluno ${SUFIXO}`);
    subjEditar = await criarDisciplina(`Editar AgAluno ${SUFIXO}`);
    subjApagar = await criarDisciplina(`Apagar AgAluno ${SUFIXO}`);
    subjIsolamento = await criarDisciplina(`Isolamento AgAluno ${SUFIXO}`);

    aluno1 = await criarAluno(`${SUFIXO}-1`);
    aluno2 = await criarAluno(`${SUFIXO}-2`);
  });

  test.afterAll(async () => {
    await supabaseAdmin.from('exams').delete().in('id', examIds);
    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }
    execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });

    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    const { data: restoExams } = await supabaseAdmin.from('exams').select('id').eq('centro_id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
    expect(restoExams ?? []).toHaveLength(0);
  });

  test('(a) grelha: dia 1, último dia e overflow mostram os testes certos; passados ficam esbatidos e "Fechado"/"Nota registada"', async ({ browser }: { browser: Browser }) => {
    const mesAlvo = acharMesComOverflowNosDoisLados();
    const inicio = startOfMonth(mesAlvo);
    const fim = endOfMonth(mesAlvo);
    const gridInicio = startOfWeek(inicio, { weekStartsOn: 1 });
    const gridFim = endOfWeek(fim, { weekStartsOn: 1 });
    const dia1ISO = format(inicio, 'yyyy-MM-dd');
    const diaUltimoISO = format(fim, 'yyyy-MM-dd');
    const overflowAnteriorISO = format(gridInicio, 'yyyy-MM-dd');
    const overflowSeguinteISO = format(gridFim, 'yyyy-MM-dd');
    const diaPassadoISO = addDiasISO(HOJE, -5);
    const diaPassadoComNotaISO = addDiasISO(HOJE, -10);

    const seeds = [
      { aluno_id: aluno1.id, centro_id: centroId, subject_name: subjMatematica.name, date: dia1ISO, topics: 'Dia 1 do mês', nota_confirmada: false },
      { aluno_id: aluno1.id, centro_id: centroId, subject_name: subjIngles.name, date: diaUltimoISO, topics: 'Último dia do mês', nota_confirmada: false },
      { aluno_id: aluno1.id, centro_id: centroId, subject_name: subjMatematica.name, date: overflowAnteriorISO, topics: 'Overflow mês anterior', nota_confirmada: false },
      { aluno_id: aluno1.id, centro_id: centroId, subject_name: subjIngles.name, date: overflowSeguinteISO, topics: 'Overflow mês seguinte', nota_confirmada: false },
      { aluno_id: aluno1.id, centro_id: centroId, subject_name: subjMatematica.name, date: diaPassadoISO, topics: 'Já passou, sem nota', nota_confirmada: false },
      { aluno_id: aluno1.id, centro_id: centroId, subject_name: subjIngles.name, date: diaPassadoComNotaISO, topics: 'Já passou, com nota', nota_valor: 70, nota_escala: '100', nota_confirmada: true },
    ];
    const { data: linhas, error } = await supabaseAdmin.from('exams').insert(seeds).select('id, topics, date');
    if (error) throw new Error(`seed grelha: ${error.message}`);
    for (const l of linhas!) examIds.push(l.id);
    idExamFechadoPassado = linhas!.find((l: any) => l.topics === 'Já passou, sem nota')!.id;

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, aluno1.email, aluno1.password);
    await abrirAgenda(page);
    const irPara = criarNavegadorDeMes(page);
    // O bottom sheet do dia (fixed, rounded-t-3xl) — scoped para não
    // confundir com o mesmo texto a aparecer também em "Próximos Testes".
    const sheet = page.locator('div.rounded-t-3xl');

    await irPara(dia1ISO);

    const celulaDia1 = page.getByRole('button', { name: labelDia(dia1ISO, [subjMatematica.name]), exact: true });
    await expect(celulaDia1).toBeVisible({ timeout: 15_000 });
    await celulaDia1.click();
    await expect(sheet.getByText('Dia 1 do mês')).toBeVisible();
    await page.keyboard.press('Escape');

    const celulaUltimo = page.getByRole('button', { name: labelDia(diaUltimoISO, [subjIngles.name]), exact: true });
    await expect(celulaUltimo).toBeVisible();
    await celulaUltimo.click();
    await expect(sheet.getByText('Último dia do mês')).toBeVisible();
    await page.keyboard.press('Escape');

    const celulaAnterior = page.getByRole('button', { name: labelDia(overflowAnteriorISO, [subjMatematica.name]), exact: true });
    await expect(celulaAnterior).toBeVisible();
    await celulaAnterior.click();
    await expect(sheet.getByText('Overflow mês anterior')).toBeVisible();
    await page.keyboard.press('Escape');

    const celulaSeguinte = page.getByRole('button', { name: labelDia(overflowSeguinteISO, [subjIngles.name]), exact: true });
    await expect(celulaSeguinte).toBeVisible();
    await celulaSeguinte.click();
    await expect(sheet.getByText('Overflow mês seguinte')).toBeVisible();
    await page.keyboard.press('Escape');

    await irPara(diaPassadoISO);
    const celulaPassado = page.getByRole('button', { name: labelDia(diaPassadoISO, [subjMatematica.name]), exact: true });
    const opacidadePassado = await celulaPassado.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacidadePassado)).toBeLessThan(1);
    await celulaPassado.click();
    await expect(sheet.getByText(/Fechado/)).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^editar$/i })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: /^apagar$/i })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await irPara(diaPassadoComNotaISO);
    const celulaPassadoComNota = page.getByRole('button', { name: labelDia(diaPassadoComNotaISO, [subjIngles.name]), exact: true });
    await celulaPassadoComNota.click();
    await expect(sheet.getByText(/Nota registada/)).toBeVisible();

    await context.close();
  });

  test('(b) "Próximos Testes" usa o dia de Lisboa, independentemente do fuso do browser', async ({ browser }: { browser: Browser }) => {
    const { data: eHoje, error } = await supabaseAdmin.from('exams').insert({
      aluno_id: aluno1.id, centro_id: centroId, subject_name: subjMatematica.name, date: HOJE, topics: 'Teste de hoje (fuso)',
    }).select('id').single();
    if (error) throw new Error(`seed fuso: ${error.message}`);
    examIds.push(eHoje!.id);

    for (const timezoneId of ['Pacific/Auckland', 'America/Los_Angeles']) {
      const context = await browser.newContext({ timezoneId });
      const page = await context.newPage();
      await loginUI(page, aluno1.email, aluno1.password);
      await abrirAgenda(page);

      const cartao = page.locator('div.rounded-2xl', { hasText: 'Teste de hoje (fuso)' });
      await expect(cartao).toBeVisible({ timeout: 15_000 });
      await expect(cartao.getByText(/^hoje$/i)).toBeVisible();

      await context.close();
    }
  });

  test('(c) marcar um teste novo grava as colunas certas e aparece na agenda do staff; duplicado é recusado; duplo toque não duplica', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, aluno1.email, aluno1.password);
    await abrirAgenda(page);

    await abrirNovoTesteViaBotao(page);
    await preencherEGuardar(page, { subject: subjNovo.name, date: HOJE, topics: 'Capítulo novo' });
    await expect(page.getByText(/teste agendado com sucesso/i)).toBeVisible({ timeout: 10_000 });

    const { data: linhaNova } = await supabaseAdmin
      .from('exams').select('*')
      .eq('aluno_id', aluno1.id).eq('subject_name', subjNovo.name).eq('date', HOJE).single();
    expect(linhaNova).not.toBeNull();
    examIds.push(linhaNova!.id);
    expect(linhaNova!.centro_id).toBe(centroId);
    expect(linhaNova!.topics).toBe('Capítulo novo');
    expect(linhaNova!.nota_valor).toBeNull();

    const contextAdmin = await browser.newContext();
    const pageAdmin = await contextAdmin.newPage();
    await loginUI(pageAdmin, admin.email, admin.password);
    await pageAdmin.goto(`${BASE_URL}/admin/agenda`, { waitUntil: 'networkidle' });
    await pageAdmin.locator('input[placeholder="Aluno..."]').fill(`Aluno Agenda ${SUFIXO}-1`);
    await expect(pageAdmin.getByRole('button', { name: new RegExp(`${subjNovo.name} · 8º`) })).toBeVisible({ timeout: 15_000 });
    await contextAdmin.close();

    // --- duplicado recusado (mesma disciplina + mesmo dia) ---
    await abrirNovoTesteViaBotao(page);
    await preencherEGuardar(page, { subject: subjNovo.name, date: HOJE, topics: 'Tentativa duplicada' });
    await expect(page.getByText(new RegExp(`já tens um teste de ${subjNovo.name} marcado para este dia`, 'i'))).toBeVisible({ timeout: 10_000 });
    const { data: contagemDuplicado } = await supabaseAdmin
      .from('exams').select('id').eq('aluno_id', aluno1.id).eq('subject_name', subjNovo.name).eq('date', HOJE);
    expect(contagemDuplicado ?? []).toHaveLength(1);
    await page.keyboard.press('Escape');

    // --- duplo toque não cria duas linhas ---
    // Toast anterior (duplicado de subjNovo) pode ainda estar visível —
    // espera que desapareça para não confundir com o toast desta secção.
    await expect(page.getByText(/já tens um teste de/i)).toHaveCount(0, { timeout: 6_000 });

    await abrirNovoTesteViaBotao(page);
    await page.locator('select').selectOption({ label: subjDuploToque.name });
    await page.locator('input[type="date"]').fill(HOJE);
    await page.locator('textarea').fill('Duplo toque');
    const botaoGuardar = page.getByRole('button', { name: /^guardar$/i });
    // force:true ignora a verificação de "disabled" do segundo toque — é
    // exatamente essa corrida (dois toques a disparar antes de qualquer
    // re-render) que este teste quer exercitar.
    await Promise.allSettled([
      botaoGuardar.click({ force: true }).catch(() => {}),
      botaoGuardar.click({ force: true }).catch(() => {}),
    ]);
    // O que importa é que só sobra UMA linha na BD, nunca duas — qualquer
    // que seja o toast que "ganhe" a corrida (sucesso ou duplicado).
    await expect(async () => {
      const { data } = await supabaseAdmin
        .from('exams').select('id').eq('aluno_id', aluno1.id).eq('subject_name', subjDuploToque.name).eq('date', HOJE);
      expect(data ?? []).toHaveLength(1);
    }).toPass({ timeout: 10_000 });
    const { data: contagemDuploToque } = await supabaseAdmin
      .from('exams').select('id').eq('aluno_id', aluno1.id).eq('subject_name', subjDuploToque.name).eq('date', HOJE);
    examIds.push(...(contagemDuploToque ?? []).map((r: any) => r.id));
    await page.keyboard.press('Escape');

    await context.close();
  });

  test('(d) editar um teste futuro muda disciplina, data e matéria; pôr a data no passado mostra a mensagem da base de dados', async ({ browser }: { browser: Browser }) => {
    const { data: eEditar, error } = await supabaseAdmin.from('exams').insert({
      aluno_id: aluno1.id, centro_id: centroId, subject_name: subjEditar.name, date: HOJE, topics: 'Antes de editar',
    }).select('id').single();
    if (error) throw new Error(`seed editar: ${error.message}`);
    examIds.push(eEditar!.id);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, aluno1.email, aluno1.password);
    await abrirAgenda(page);
    const irPara = criarNavegadorDeMes(page);

    await irPara(HOJE);
    await page.getByRole('button', { name: labelDiaContendo(HOJE, subjEditar.name) }).click();
    await cartaoDoExameNoSheet(page, subjEditar.name).getByRole('button', { name: /^editar$/i }).click();
    await expect(page.getByRole('heading', { name: /editar teste/i })).toBeVisible();

    const novaDataFutura = addDiasISO(HOJE, 3);
    await page.locator('select').selectOption({ label: subjIngles.name });
    await page.locator('input[type="date"]').fill(novaDataFutura);
    await page.locator('textarea').fill('Depois de editar');
    await page.getByRole('button', { name: /^guardar$/i }).click();
    await expect(page.getByText(/teste atualizado/i)).toBeVisible({ timeout: 10_000 });

    const { data: linhaDepois } = await supabaseAdmin.from('exams').select('*').eq('id', eEditar!.id).single();
    expect(linhaDepois!.subject_name).toBe(subjIngles.name);
    expect(linhaDepois!.date).toBe(novaDataFutura);
    expect(linhaDepois!.topics).toBe('Depois de editar');

    // Reabre o mesmo teste (agora na nova data) e tenta pôr a data no
    // passado — deve mostrar a mensagem do gatilho, sem alterar nada.
    await irPara(novaDataFutura);
    await page.getByRole('button', { name: labelDiaContendo(novaDataFutura, subjIngles.name) }).click();
    await cartaoDoExameNoSheet(page, subjIngles.name).getByRole('button', { name: /^editar$/i }).click();
    const dataPassadaInvalida = addDiasISO(HOJE, -2);
    await page.locator('input[type="date"]').fill(dataPassadaInvalida);
    await page.getByRole('button', { name: /^guardar$/i }).click();
    await expect(page.getByText('Só podes corrigir testes que ainda não aconteceram e ainda não têm nota.')).toBeVisible({ timeout: 10_000 });

    const { data: linhaInalterada } = await supabaseAdmin.from('exams').select('date').eq('id', eEditar!.id).single();
    expect(linhaInalterada!.date).toBe(novaDataFutura);

    await context.close();
  });

  test('(e) apagar um teste futuro sem nota remove a linha; um teste fechado não mostra "Apagar" e recusa a chamada direta', async ({ browser }: { browser: Browser }) => {
    const { data: eApagar, error } = await supabaseAdmin.from('exams').insert({
      aluno_id: aluno1.id, centro_id: centroId, subject_name: subjApagar.name, date: HOJE, topics: 'Para apagar',
    }).select('id').single();
    if (error) throw new Error(`seed apagar: ${error.message}`);
    examIds.push(eApagar!.id);

    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('dialog', (d) => d.accept());
    await loginUI(page, aluno1.email, aluno1.password);
    await abrirAgenda(page);
    const irPara = criarNavegadorDeMes(page);

    await irPara(HOJE);
    await page.getByRole('button', { name: labelDiaContendo(HOJE, subjApagar.name) }).click();
    await cartaoDoExameNoSheet(page, subjApagar.name).getByRole('button', { name: /^apagar$/i }).click();
    await expect(page.getByText(/^teste apagado\.$/i)).toBeVisible({ timeout: 10_000 });

    const { data: linhaDepois } = await supabaseAdmin.from('exams').select('id').eq('id', eApagar!.id);
    expect(linhaDepois ?? []).toHaveLength(0);

    // Teste fechado (passado, do teste (a)) — chamada direta recusada ou 0 linhas.
    const sessaoAluno1 = await sessaoComo(aluno1);
    const { data: tentativa, error: erroTentativa } = await sessaoAluno1
      .from('exams').delete().eq('id', idExamFechadoPassado).select();
    expect(erroTentativa !== null || (tentativa ?? []).length === 0).toBe(true);
    const { data: continuaLa } = await supabaseAdmin.from('exams').select('id').eq('id', idExamFechadoPassado);
    expect(continuaLa ?? []).toHaveLength(1);

    await context.close();
  });

  test('(f) o campo de data fica dentro do cartão e "Guardar" tem contraste legível, em várias larguras', async ({ browser }: { browser: Browser }) => {
    const larguras = [360, 375, 390, 430, 768];
    for (const width of larguras) {
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      const page = await context.newPage();
      await loginUI(page, aluno1.email, aluno1.password);
      await abrirAgenda(page);
      await abrirNovoTesteViaBotao(page);

      const input = page.locator('input[type="date"]');
      const cartao = page.locator('form');
      const boxInput = await input.boundingBox();
      const boxCartao = await cartao.boundingBox();
      expect(boxInput).not.toBeNull();
      expect(boxCartao).not.toBeNull();
      expect(boxInput!.x).toBeGreaterThanOrEqual(boxCartao!.x - 1);
      expect(boxInput!.x + boxInput!.width).toBeLessThanOrEqual(boxCartao!.x + boxCartao!.width + 1);

      const semScrollHorizontal = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
      );
      expect(semScrollHorizontal).toBe(true);

      const botao = page.getByRole('button', { name: /^guardar$/i });
      const estilo = await botao.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, backgroundColor: cs.backgroundColor };
      });
      expect(estilo.color).toBe('rgb(255, 255, 255)');
      expect(estilo.backgroundColor).toBe('rgb(126, 34, 206)');

      await context.close();
    }
  });

  test('(g) um aluno não vê nem altera os testes de outro aluno', async ({ browser }: { browser: Browser }) => {
    const { data: eAluno2, error } = await supabaseAdmin.from('exams').insert({
      aluno_id: aluno2.id, centro_id: centroId, subject_name: subjIsolamento.name, date: HOJE, topics: 'Exame do aluno 2',
    }).select('id').single();
    if (error) throw new Error(`seed isolamento: ${error.message}`);
    examIds.push(eAluno2!.id);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, aluno1.email, aluno1.password);
    await abrirAgenda(page);
    await expect(page.getByText('Exame do aluno 2')).toHaveCount(0);

    const sessaoAluno1 = await sessaoComo(aluno1);
    const { data: leituraDireta } = await sessaoAluno1.from('exams').select('id').eq('id', eAluno2!.id);
    expect(leituraDireta ?? []).toHaveLength(0);

    const { data: updateDireto, error: erroUpdate } = await sessaoAluno1
      .from('exams').update({ topics: 'Hackeado' }).eq('id', eAluno2!.id).select();
    expect(erroUpdate !== null || (updateDireto ?? []).length === 0).toBe(true);
    const { data: continuaIntacto } = await supabaseAdmin.from('exams').select('topics').eq('id', eAluno2!.id).single();
    expect(continuaIntacto!.topics).toBe('Exame do aluno 2');

    await context.close();
  });

  test('(h) o visto decorativo (CheckCircle2) já não existe nos cartões de "Próximos Testes"', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, aluno1.email, aluno1.password);
    await abrirAgenda(page);

    const secao = page.locator('section', { hasText: 'Próximos Testes' });
    await expect(secao).toBeVisible({ timeout: 15_000 });
    await expect(secao.locator('svg.lucide-circle-check')).toHaveCount(0);

    await context.close();
  });

  test('(i) o mês inicial do calendário é o de Lisboa, mesmo com o browser num fuso muito adiantado', async ({ browser }: { browser: Browser }) => {
    const mesEsperado = format(parseISO(HOJE), 'MMMM yyyy', { locale: pt });

    const context = await browser.newContext({ timezoneId: 'Pacific/Auckland' });
    const page = await context.newPage();
    await loginUI(page, aluno1.email, aluno1.password);
    await abrirAgenda(page);

    await expect(page.getByText(mesEsperado, { exact: true })).toBeVisible({ timeout: 15_000 });

    await context.close();
  });
});
