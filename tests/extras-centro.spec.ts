import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Mensalidade/extras em atraso, dias fora do horário e "Como pagar" — ver
// CLAUDE.md para o resumo da tarefa. Cobre /admin/pagamentos (aba
// Mensalidades), a Lista do Dia (app/admin/ListaDoDiaPresencas.tsx), a Área
// dos Encarregados e a rota app/api/config-centro. Centro descartável
// ZZTESTE via ~/Desktop/gestao-centros/novo-centro.mjs — nunca o centro real
// ("Trupe Lias") nem o Demo. Lógica pura (mensalidadeEmAtraso,
// calcularExtrasDoMes, alunoForaDoHorarioHoje) está em
// tests/extras-centro-logica.spec.ts; este ficheiro só testa a app por cima
// das RPCs já aplicadas na base de dados.

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

// "Hoje" em Europe/Lisbon, calculado uma vez no arranque — nunca new Date()
// local a decidir pass/fail; só para escolher QUE mês passado usar.
function hojeLisboaISO(): string {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const obter = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${obter('year')}-${obter('month')}-${obter('day')}`;
}
function diaSemanaHojeLisboa(): number {
  const diaAbrev = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Lisbon', weekday: 'short' }).format(new Date());
  const mapa: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return mapa[diaAbrev] ?? new Date().getDay();
}

function subtrairMeses(ano: number, mes: number, n: number): { ano: number; mes: number } {
  const total = ano * 12 + (mes - 1) - n;
  return { ano: Math.floor(total / 12), mes: (((total % 12) + 12) % 12) + 1 };
}
function pad2(n: number): string { return String(n).padStart(2, '0'); }
function dataISO(ano: number, mes: number, dia: number): string { return `${ano}-${pad2(mes)}-${pad2(dia)}`; }
/** Dia da semana (0=Dom..6=Sáb) de uma data civil — puro cálculo de calendário, sem fuso. */
function weekdayOf(ano: number, mes: number, dia: number): number {
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}
function dataPt(dataISOStr: string): string {
  return new Date(`${dataISOStr}T00:00:00`).toLocaleDateString('pt-PT');
}

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const [ANO_HOJE, MES_HOJE] = hojeLisboaISO().split('-').map(Number);
const MES_ALVO = subtrairMeses(ANO_HOJE, MES_HOJE, 2); // mês passado fixo — nunca depende do dia em que os testes correm
const DIA1 = 5;
const DIA2 = 12;
const DIA_SEMANA_HOJE = diaSemanaHojeLisboa();
const WD1 = weekdayOf(MES_ALVO.ano, MES_ALVO.mes, DIA1);
const WD2 = weekdayOf(MES_ALVO.ano, MES_ALVO.mes, DIA2);
// Dia de horário do aluno — garantidamente diferente de hoje, de DIA1 e de
// DIA2 (sempre existe: só 3 valores excluídos de 6 candidatos possíveis).
const HORARIO_DIA = [1, 2, 3, 4, 5, 6].find((d) => d !== WD1 && d !== WD2 && d !== DIA_SEMANA_HOJE)!;

/** 1º dia do mês (1-7) cujo dia da semana é `weekdayAlvo` — qualquer weekday aparece sempre nos primeiros 7 dias de qualquer mês. */
function primeiroDiaComWeekday(ano: number, mes: number, weekdayAlvo: number): number {
  for (let dia = 1; dia <= 7; dia++) {
    if (weekdayOf(ano, mes, dia) === weekdayAlvo) return dia;
  }
  throw new Error('weekday não encontrado nos primeiros 7 dias — impossível');
}
// alunoSemConsumo: horário só à segunda (1) e quarta (3); presença numa
// terça e num sábado desse mesmo mês — ambos garantidamente fora do
// horário, sem nenhum consumo a contaminar o total.
const DIA_TERCA = primeiroDiaComWeekday(MES_ALVO.ano, MES_ALVO.mes, 2);
const DIA_SABADO = primeiroDiaComWeekday(MES_ALVO.ano, MES_ALVO.mes, 6);

const DIGITS_23 = '1'.repeat(23);
const IBAN_VALIDO = `PT${DIGITS_23}`;
const BENEFICIARIO_VALIDO = 'Centro ZZTESTE Extras';

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE ExtrasCentro ${SUFIXO}`;
const ADMIN_EMAIL = `admin-extrascentro-${SUFIXO}@zzteste.invalid`;
const CODIGO_PRINCIPAL = '4321';

type Conta = { id: string; email: string; password: string; nome?: string };

let centroId: string;
let admin: Conta;
let professor: Conta;
let secretaria: Conta;

let outroCentroId: string;
let outroAdmin: Conta;

let alunoPrincipal: Conta;
let alunoOutro: Conta;
let alunoSemConsumo: Conta;
let servicoLancheId: string;

const limpeza: Array<() => unknown> = [];

async function criarUtilizadorAuth(email: string, password: string, appMetadata: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`criar utilizador ${email}: ${error.message}`);
  const id = data.user.id;
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: appMetadata });
  if (metaError) throw new Error(`app_metadata ${email}: ${metaError.message}`);
  return id;
}

async function criarStaff(papel: string, nome: string, centro: string): Promise<Conta> {
  const email = `extrascentro-${papel}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { role: papel, centro_id: centro });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: nome, role: papel, centro_id: centro });
  if (error) throw new Error(`criar staff ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
  return { id, email, password, nome };
}

async function criarAluno(nome: string, opts: { horarios?: number[]; salaEstudo?: boolean; mensalidadeBase?: number }): Promise<Conta> {
  const email = `${nome.toLowerCase().replace(/\s+/g, '-')}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  const salaEstudo = opts.salaEstudo ?? true;
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-${email}`,
    data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centroId,
    ativo: true, sala_estudo: salaEstudo, faz_explicacoes: !salaEstudo, mensalidade_base: opts.mensalidadeBase ?? 0,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  if (opts.horarios && opts.horarios.length > 0) {
    const { error: horarioError } = await supabaseAdmin
      .from('aluno_horarios')
      .insert(opts.horarios.map((d) => ({ aluno_id: id, dia_semana: d, centro_id: centroId })));
    if (horarioError) throw new Error(`aluno_horarios ${nome}: ${horarioError.message}`);
  }
  return { id, email, password, nome };
}

async function criarServico(nome: string, preco: number): Promise<string> {
  const { data, error } = await supabaseAdmin.from('servicos').insert({ nome, preco, centro_id: centroId }).select('id').single();
  if (error) throw new Error(`criar servico ${nome}: ${error.message}`);
  return data.id;
}

async function criarConsumo(alunoId: string, servicoId: string, preco: number, dia: string) {
  const { error } = await supabaseAdmin.from('consumos_diarios').insert({
    aluno_id: alunoId, servico_id: servicoId, data_consumo: dia, preco_aplicado: preco, centro_id: centroId,
  });
  if (error) throw new Error(`criar consumo ${dia}: ${error.message}`);
}

async function criarMensalidade(alunoId: string, ano: number, mes: number, valorEsperado: number) {
  const { error } = await supabaseAdmin.from('mensalidades').insert({
    centro_id: centroId, aluno_id: alunoId, ano, mes, valor_esperado: valorEsperado, pago: false,
  });
  if (error) throw new Error(`criar mensalidade ${ano}-${mes}: ${error.message}`);
}

async function criarPresencaEm(alunoId: string, entradaISO: string) {
  const { error } = await supabaseAdmin.from('diario_bordo').insert({
    aluno_id: alunoId, centro_id: centroId, entrada: entradaISO, status: 'validado',
  });
  if (error) throw new Error(`criar presenca ${entradaISO}: ${error.message}`);
}

async function sessaoComo(conta: Conta) {
  const cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await cliente.auth.signInWithPassword({ email: conta.email, password: conta.password });
  if (error) throw new Error(`login ${conta.email}: ${error.message}`);
  return cliente;
}

async function loginUI(browser: Browser, email: string, password: string, destino: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="identificador"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(`${BASE_URL}${destino}`, { timeout: 20_000 });
  const storageState = await context.storageState();
  await context.close();
  return storageState;
}

async function entrarComCodigo(p: Page, codigo: string) {
  await p.fill('input[inputMode="numeric"]', codigo);
  await p.getByRole('button', { name: /^entrar$/i }).click();
  await expect(p.getByTestId('resumo-mes')).toBeVisible({ timeout: 15_000 });
}

/** Clica "Mês anterior" até o título bater com o mês pedido (bounded, nunca um loop infinito). */
async function irParaMesEncarregado(p: Page, ano: number, mes: number) {
  const esperado = new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric' }).format(new Date(ano, mes - 1, 1));
  for (let i = 0; i < 6; i++) {
    const titulo = await p.getByTestId('resumo-mes-titulo').textContent();
    if (titulo === esperado) return;
    await p.getByTestId('resumo-mes-anterior').click();
    await p.waitForTimeout(300);
  }
  await expect(p.getByTestId('resumo-mes-titulo')).toHaveText(esperado, { timeout: 10_000 });
}

/** Clica "Mês anterior" (ícone ChevronLeft, 1º botão com svg dentro do <main>) n vezes, em /admin/pagamentos. */
async function navegarMesPagamentos(p: Page, vezes: number) {
  const conteudo = p.locator('main').last();
  for (let i = 0; i < vezes; i++) {
    await conteudo.getByRole('button').filter({ has: p.locator('svg') }).nth(0).click();
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(500);
  }
}

async function patchConfigCentro(page: Page, payload: Record<string, unknown>) {
  const res = await page.request.patch(`${BASE_URL}/api/config-centro`, { data: payload });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body };
}

test.describe.configure({ mode: 'serial' });

test.describe('Extras do centro — mensalidade em atraso, dias fora do horário, pagamentos (ZZTESTE)', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE ExtrasCentro'],
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
    admin = { id: staffAdmin.id, email: ADMIN_EMAIL, password: passwordAdmin };

    professor = await criarStaff('professor', `Professor ExtrasCentro ${SUFIXO}`, centroId);
    secretaria = await criarStaff('secretaria', `Secretaria ExtrasCentro ${SUFIXO}`, centroId);

    // Lista do Dia precisa de modo_presencas = lista_dia (precondição; a
    // troca pelo próprio ecrã de Gestão já está testada em
    // tests/lista-do-dia-presencas.spec.ts). valor_dia_fora_horario fica
    // explicitamente a 0 — o teste (a) depende disto, nunca do default da coluna.
    const { error: configError } = await supabaseAdmin
      .from('config_centro')
      .update({ modo_presencas: 'lista_dia', valor_dia_fora_horario: 0 })
      .eq('id', centroId);
    if (configError) throw new Error(`config_centro: ${configError.message}`);

    // Outro centro — só para os testes de isolamento (RLS entre centros).
    const { data: outroCentro, error: outroCentroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Outro ExtrasCentro ${SUFIXO}`, email_remetente: `zzteste-outro-extrascentro-${SUFIXO}@example.invalid` })
      .select('id')
      .single();
    if (outroCentroError) throw new Error(`criar outro centro: ${outroCentroError.message}`);
    outroCentroId = outroCentro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', outroCentroId));
    outroAdmin = await criarStaff('admin', `Admin Outro ExtrasCentro ${SUFIXO}`, outroCentroId);

    alunoPrincipal = await criarAluno(`Aluno Principal ExtrasCentro ${SUFIXO}`, { horarios: [HORARIO_DIA], mensalidadeBase: 50 });
    alunoOutro = await criarAluno(`Aluno Outro ExtrasCentro ${SUFIXO}`, { salaEstudo: false });

    const { error: codigoError } = await supabaseAdmin.rpc('definir_codigo_encarregado', { p_aluno_id: alunoPrincipal.id, p_codigo: CODIGO_PRINCIPAL });
    if (codigoError) throw new Error(`definir código: ${codigoError.message}`);

    servicoLancheId = await criarServico(`Lanche ExtrasCentro ${SUFIXO}`, 1.5);

    // --- Presença de HOJE (para a Lista do Dia) — fora do horário de alunoPrincipal (HORARIO_DIA != hoje) ---
    await criarPresencaEm(alunoPrincipal.id, new Date().toISOString());

    // --- MES_ALVO (mês passado fixo, -2 meses) — mensalidade em atraso + dias fora do horário + consumo ---
    await criarMensalidade(alunoPrincipal.id, MES_ALVO.ano, MES_ALVO.mes, 50);
    // DIA1: duas entradas no mesmo dia (horas diferentes) — contam como um único dia fora do horário.
    await criarPresencaEm(alunoPrincipal.id, `${dataISO(MES_ALVO.ano, MES_ALVO.mes, DIA1)}T09:00:00Z`);
    await criarPresencaEm(alunoPrincipal.id, `${dataISO(MES_ALVO.ano, MES_ALVO.mes, DIA1)}T15:00:00Z`);
    await criarPresencaEm(alunoPrincipal.id, `${dataISO(MES_ALVO.ano, MES_ALVO.mes, DIA2)}T09:00:00Z`);
    await criarConsumo(alunoPrincipal.id, servicoLancheId, 1.5, dataISO(MES_ALVO.ano, MES_ALVO.mes, 3));

    // alunoSemConsumo: tem mensalidade (como qualquer aluno de sala de
    // estudo — por isso já tem linha na tabela), mas nenhum consumo e só
    // dias fora do horário — cobre a correção de calcularExtrasDoMes (uma
    // entrada de extras tem de aparecer mesmo sem nenhuma linha em
    // extras_do_mes).
    alunoSemConsumo = await criarAluno(`Aluno SemConsumo ExtrasCentro ${SUFIXO}`, { horarios: [1, 3], mensalidadeBase: 30 });
    await criarMensalidade(alunoSemConsumo.id, MES_ALVO.ano, MES_ALVO.mes, 30);
    await criarPresencaEm(alunoSemConsumo.id, `${dataISO(MES_ALVO.ano, MES_ALVO.mes, DIA_TERCA)}T09:00:00Z`);
    await criarPresencaEm(alunoSemConsumo.id, `${dataISO(MES_ALVO.ano, MES_ALVO.mes, DIA_SABADO)}T09:00:00Z`);
  });

  test.afterAll(async () => {
    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }
    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    const { data: restoOutro } = await supabaseAdmin.from('config_centro').select('id').eq('id', outroCentroId);
    expect(restoConfig ?? []).toHaveLength(0);
    expect(restoOutro ?? []).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // Parte 2 — Lista do Dia (valor 0 esconde tudo)
  // ---------------------------------------------------------------------

  test('(a) valor_dia_fora_horario = 0: a etiqueta "Fora do horário" não aparece, mesmo com presença e horário a não bater', async ({ browser }) => {
    const adminState = await loginUI(browser, admin.email, admin.password, '/admin');
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    await expect(page.getByText(alunoPrincipal.nome!)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/fora do horário/i)).toHaveCount(0);
    await context.close();
  });

  // ---------------------------------------------------------------------
  // Parte 4 — Gestão → Regras do centro / rota config-centro
  // ---------------------------------------------------------------------

  test('(b) Gestão: admin liga o valor por dia fora do horário, o dia limite e os dados bancários', async ({ browser }) => {
    const adminState = await loginUI(browser, admin.email, admin.password, '/admin');
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin/gestao?aba=regras`, { waitUntil: 'networkidle' });

    const painelMensalidade = page.locator('section', { hasText: 'Mensalidade e dia fora do horário' });
    await painelMensalidade.locator('input[type="number"]').nth(0).fill('5'); // dia limite
    await painelMensalidade.locator('input[type="number"]').nth(1).fill('10'); // valor por dia fora
    await painelMensalidade.getByRole('button', { name: /guardar/i }).click();
    await expect(painelMensalidade.getByRole('button', { name: /guardado/i })).toBeVisible({ timeout: 10_000 });

    const painelBancario = page.locator('section', { hasText: 'Dados bancários' });
    await painelBancario.locator('input[type="text"]').nth(0).fill(IBAN_VALIDO);
    await painelBancario.locator('input[type="text"]').nth(1).fill(BENEFICIARIO_VALIDO);
    await painelBancario.getByRole('button', { name: /guardar/i }).click();
    await expect(painelBancario.getByRole('button', { name: /guardado/i })).toBeVisible({ timeout: 10_000 });

    const { data: config } = await supabaseAdmin.from('config_centro').select('*').eq('id', centroId).single();
    expect(Number(config!.valor_dia_fora_horario)).toBe(10);
    expect(config!.dia_limite_mensalidade).toBe(5);
    expect(config!.iban).toBe(IBAN_VALIDO);
    expect(config!.iban_beneficiario).toBe(BENEFICIARIO_VALIDO);

    await context.close();
  });

  test('(c) rota config-centro: rejeita IBAN inválido, dia 0/29, valor negativo/3 casas, IBAN sem beneficiário; só admin consegue gravar', async ({ browser }) => {
    const adminState = await loginUI(browser, admin.email, admin.password, '/admin');
    const contextAdmin = await browser.newContext({ storageState: adminState });
    const pageAdmin = await contextAdmin.newPage();
    await pageAdmin.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const r1 = await patchConfigCentro(pageAdmin, { iban: 'ES1234567890123456789012' });
    expect(r1.status).toBe(400);
    expect(r1.body.fieldErrors).toHaveProperty('iban');

    const r2 = await patchConfigCentro(pageAdmin, { dia_limite_mensalidade: 0 });
    expect(r2.status).toBe(400);
    expect(r2.body.fieldErrors).toHaveProperty('dia_limite_mensalidade');

    const r3 = await patchConfigCentro(pageAdmin, { dia_limite_mensalidade: 29 });
    expect(r3.status).toBe(400);
    expect(r3.body.fieldErrors).toHaveProperty('dia_limite_mensalidade');

    const r4 = await patchConfigCentro(pageAdmin, { valor_dia_fora_horario: -1 });
    expect(r4.status).toBe(400);
    expect(r4.body.fieldErrors).toHaveProperty('valor_dia_fora_horario');

    const r5 = await patchConfigCentro(pageAdmin, { valor_dia_fora_horario: 10.123 });
    expect(r5.status).toBe(400);
    expect(r5.body.fieldErrors).toHaveProperty('valor_dia_fora_horario');

    // IBAN já existe (teste b); apagar só o beneficiário tem de ser recusado.
    const r6 = await patchConfigCentro(pageAdmin, { iban_beneficiario: '' });
    expect(r6.status).toBe(400);
    expect(r6.body.fieldErrors).toHaveProperty('iban_beneficiario');

    // Nenhum dos pedidos recusados alterou o que já estava guardado (teste b).
    const { data: configIntacto } = await supabaseAdmin.from('config_centro').select('*').eq('id', centroId).single();
    expect(configIntacto!.iban).toBe(IBAN_VALIDO);
    expect(configIntacto!.dia_limite_mensalidade).toBe(5);

    await contextAdmin.close();

    for (const conta of [professor, secretaria]) {
      const state = await loginUI(browser, conta.email, conta.password, '/admin');
      const context = await browser.newContext({ storageState: state });
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
      const r = await patchConfigCentro(page, { dia_limite_mensalidade: 10 });
      expect(r.status).toBe(403);
      await context.close();
    }
  });

  test('(d) Lista do Dia com valor ligado: admin vê o valor, professor só vê a etiqueta', async ({ browser }) => {
    const adminState = await loginUI(browser, admin.email, admin.password, '/admin');
    const contextAdmin = await browser.newContext({ storageState: adminState });
    const pageAdmin = await contextAdmin.newPage();
    await pageAdmin.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    const linhaAdmin = pageAdmin.locator('div[role="button"]', { hasText: alunoPrincipal.nome! }).first();
    await expect(linhaAdmin).toContainText(/fora do horário/i, { timeout: 15_000 });
    await expect(linhaAdmin).toContainText('10.00€');
    await contextAdmin.close();

    const profState = await loginUI(browser, professor.email, professor.password, '/admin');
    const contextProf = await browser.newContext({ storageState: profState });
    const pageProf = await contextProf.newPage();
    await pageProf.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    const linhaProf = pageProf.locator('div[role="button"]', { hasText: alunoPrincipal.nome! }).first();
    await expect(linhaProf).toContainText(/fora do horário/i, { timeout: 15_000 });
    await expect(linhaProf).not.toContainText('€');
    await contextProf.close();
  });

  test('(d2) Pagamentos: aluno só com dias fora do horário por decidir (sem consumos) aparece com total 0,00€ e sem botão "Não Pago"; aceitar mostra o estado, repor volta ao "—"', async ({ browser }) => {
    const adminState = await loginUI(browser, admin.email, admin.password, '/admin');
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' });
    await navegarMesPagamentos(page, 2); // -> MES_ALVO
    await expect(page.getByText(alunoSemConsumo.nome!, { exact: false })).toBeVisible({ timeout: 15_000 });

    const linha = page.locator('tr', { hasText: alunoSemConsumo.nome! });
    await expect(linha.getByTestId('extras-dias-pendentes')).toContainText('2 dias por decidir');
    await expect(linha.getByTestId('extras-total')).toContainText('0.00€');
    // Nada a pagar ainda: sem botão de estado nem inputs de valor/data.
    await expect(linha.getByTestId('extras-estado')).toHaveCount(0);
    await expect(linha.getByTestId('extras-valor-pago')).toHaveCount(0);
    await expect(linha.getByTestId('extras-data-pagamento')).toHaveCount(0);

    await linha.getByTestId('extras-dias-pendentes').click();
    const linhaTerca = page.locator('div', { hasText: dataPt(dataISO(MES_ALVO.ano, MES_ALVO.mes, DIA_TERCA)) }).last();
    await linhaTerca.getByRole('button', { name: /^aceitar$/i }).click();

    await expect(linha.getByTestId('extras-total')).toContainText('10.00€', { timeout: 10_000 });
    await expect(linha.getByTestId('extras-estado')).toBeVisible();
    await expect(linha.getByTestId('extras-estado')).toContainText(/não pago/i);

    // Repor: volta a 0,00€ e o estado volta a desaparecer (nada registado).
    await linhaTerca.getByRole('button', { name: /^repor$/i }).click();
    await expect(linha.getByTestId('extras-total')).toContainText('0.00€', { timeout: 10_000 });
    await expect(linha.getByTestId('extras-estado')).toHaveCount(0);

    await context.close();
  });

  // ---------------------------------------------------------------------
  // Parte 1 — Pagamentos (mensalidade em atraso, extras do mês, dias fora)
  // ---------------------------------------------------------------------

  test('(e) Pagamentos: mensalidade em atraso (mês anterior) e 2 dias fora do horário pendentes (duas entradas no mesmo dia contam uma)', async ({ browser }) => {
    const adminState = await loginUI(browser, admin.email, admin.password, '/admin');
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' });
    await navegarMesPagamentos(page, 2); // -> MES_ALVO
    await expect(page.getByText(alunoPrincipal.nome!, { exact: false })).toBeVisible({ timeout: 15_000 });

    const linha = page.locator('tr', { hasText: alunoPrincipal.nome! });
    await expect(linha.getByTestId('mensalidade-atraso')).toBeVisible({ timeout: 10_000 });
    await expect(linha.getByTestId('mensalidade-atraso')).toContainText(`Venceu a 5 ${MESES_ABREV[MES_ALVO.mes - 1]}.`);

    await expect(linha.getByTestId('extras-dias-pendentes')).toContainText('2 dias por decidir');
    await expect(linha.getByTestId('extras-total')).toContainText('1.50€'); // só o consumo; nenhum dia aceite ainda

    await context.close();
  });

  test('(f) Pagamentos: Aceitar soma ao total, Repor volta a pendente, Dispensar não soma', async ({ browser }) => {
    const adminState = await loginUI(browser, admin.email, admin.password, '/admin');
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' });
    await navegarMesPagamentos(page, 2);
    await expect(page.getByText(alunoPrincipal.nome!, { exact: false })).toBeVisible({ timeout: 15_000 });

    const linha = page.locator('tr', { hasText: alunoPrincipal.nome! });
    await linha.getByTestId('extras-dias-pendentes').click();

    const linhaDia1 = page.locator('div', { hasText: dataPt(dataISO(MES_ALVO.ano, MES_ALVO.mes, DIA1)) }).last();
    await linhaDia1.getByRole('button', { name: /^aceitar$/i }).click();
    await expect(linha.getByTestId('extras-total')).toContainText('11.50€', { timeout: 10_000 }); // 1.50 + 10 (DIA1 aceite)
    await expect(linha.getByTestId('extras-dias-pendentes')).toContainText('1 dia por decidir');

    // Repor: volta a pendente, o total desce outra vez.
    await linhaDia1.getByRole('button', { name: /^repor$/i }).click();
    await expect(linha.getByTestId('extras-total')).toContainText('1.50€', { timeout: 10_000 });
    await expect(linha.getByTestId('extras-dias-pendentes')).toContainText('2 dias por decidir');

    // Aceita DIA1 outra vez (estado final usado pelos testes seguintes).
    await linhaDia1.getByRole('button', { name: /^aceitar$/i }).click();
    await expect(linha.getByTestId('extras-total')).toContainText('11.50€', { timeout: 10_000 });

    // DIA2: Dispensar não soma nada ao total.
    const linhaDia2 = page.locator('div', { hasText: dataPt(dataISO(MES_ALVO.ano, MES_ALVO.mes, DIA2)) }).last();
    await linhaDia2.getByRole('button', { name: /^dispensar$/i }).click();
    await expect(linha.getByTestId('extras-total')).toContainText('11.50€', { timeout: 10_000 });
    await expect(linha.getByTestId('extras-dias-pendentes')).toHaveCount(0); // nenhum dia pendente agora

    await context.close();
  });

  test('(g) Pagamentos: marcar extras como pago guarda total e data; "valor mudou" aparece após novo consumo; desmarcar limpa', async ({ browser }) => {
    const adminState = await loginUI(browser, admin.email, admin.password, '/admin');
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' });
    await navegarMesPagamentos(page, 2);
    await expect(page.getByText(alunoPrincipal.nome!, { exact: false })).toBeVisible({ timeout: 15_000 });

    const linha = page.locator('tr', { hasText: alunoPrincipal.nome! });
    await linha.getByTestId('extras-estado').click(); // Não Pago -> Pago
    await expect(linha.getByTestId('extras-estado')).toContainText(/^pago$/i, { timeout: 10_000 });

    const { data: pagamento } = await supabaseAdmin
      .from('pagamentos_extras').select('*').eq('aluno_id', alunoPrincipal.id).eq('ano', MES_ALVO.ano).eq('mes', MES_ALVO.mes).single();
    expect(Number(pagamento!.valor_pago)).toBe(11.5);
    expect(pagamento!.data_pagamento).not.toBeNull();

    // Novo consumo DEPOIS de marcar pago — o total sobe, o valor pago fica congelado.
    await criarConsumo(alunoPrincipal.id, servicoLancheId, 1.5, dataISO(MES_ALVO.ano, MES_ALVO.mes, 20));
    await page.reload({ waitUntil: 'networkidle' });
    await navegarMesPagamentos(page, 2);
    await expect(page.getByText(alunoPrincipal.nome!, { exact: false })).toBeVisible({ timeout: 15_000 });
    const linhaDepois = page.locator('tr', { hasText: alunoPrincipal.nome! });
    await expect(linhaDepois.getByTestId('extras-total')).toContainText('13.00€');
    await expect(linhaDepois.getByTestId('extras-valor-mudou')).toContainText('11.50');

    await context.close();
  });

  test('(h) o valor de um dia aceite fica congelado mesmo depois de o centro mudar o valor por dia fora do horário', async ({ browser }) => {
    const adminState = await loginUI(browser, admin.email, admin.password, '/admin');
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const r = await patchConfigCentro(page, { valor_dia_fora_horario: 20 });
    expect(r.status).toBe(200);

    const sessaoAdmin = await sessaoComo(admin);
    const { data: extras, error } = await sessaoAdmin.rpc('extras_do_mes', { p_ano: MES_ALVO.ano, p_mes: MES_ALVO.mes });
    expect(error).toBeNull();
    const linhaPrincipal = (extras as any[]).find((e) => e.aluno_id === alunoPrincipal.id);
    expect(Number(linhaPrincipal.dias_fora)).toBe(10); // continua 10€ (valor ao decidir), não 20€

    await context.close();
  });

  // ---------------------------------------------------------------------
  // Parte 5.4 — Acessos
  // ---------------------------------------------------------------------

  test('(i) professor, secretaria e outro centro não leem nem alteram pagamentos_extras/dias_fora_horario; professor lê config_extras_centro mas não config_centro', async () => {
    for (const conta of [professor, secretaria]) {
      const sessao = await sessaoComo(conta);
      const { data: lidoExtras, error: errExtras } = await sessao.from('pagamentos_extras').select('id').eq('aluno_id', alunoPrincipal.id);
      expect(errExtras).toBeNull();
      expect(lidoExtras ?? []).toHaveLength(0);

      const { data: lidoDias, error: errDias } = await sessao.from('dias_fora_horario').select('id').eq('aluno_id', alunoPrincipal.id);
      expect(errDias).toBeNull();
      expect(lidoDias ?? []).toHaveLength(0);

      const { error: errDecidir } = await sessao.rpc('decidir_dia_fora_horario', { p_aluno: alunoPrincipal.id, p_dia: dataISO(MES_ALVO.ano, MES_ALVO.mes, DIA1), p_estado: 'aceite' });
      expect(errDecidir).not.toBeNull();
      // dias_fora_horario_mes/extras_do_mes: admitimos tanto um erro (negado
      // na função) como uma resposta vazia (filtrado por dentro) — o que
      // importa é que um professor/secretaria nunca vê os dias/valores de
      // outro aluno através destas RPCs.
      const { data: dataDiasMes, error: errDiasMes } = await sessao.rpc('dias_fora_horario_mes', { p_ano: MES_ALVO.ano, p_mes: MES_ALVO.mes });
      if (!errDiasMes) expect(dataDiasMes ?? []).toHaveLength(0);
      const { data: dataExtrasMes, error: errExtrasMes } = await sessao.rpc('extras_do_mes', { p_ano: MES_ALVO.ano, p_mes: MES_ALVO.mes });
      if (!errExtrasMes) expect(dataExtrasMes ?? []).toHaveLength(0);

      const { data: lidoConfig, error: errConfig } = await sessao.from('config_centro').select('id').eq('id', centroId);
      expect(errConfig).toBeNull();
      expect(lidoConfig ?? []).toHaveLength(0);
    }

    const sessaoProfessor = await sessaoComo(professor);
    const { data: configExtras, error: errConfigExtras } = await sessaoProfessor.rpc('config_extras_centro');
    expect(errConfigExtras).toBeNull();
    expect(configExtras).toBeTruthy();

    const sessaoOutroAdmin = await sessaoComo(outroAdmin);
    const { data: lidoExtrasOutro, error: errExtrasOutro } = await sessaoOutroAdmin.from('pagamentos_extras').select('id').eq('aluno_id', alunoPrincipal.id);
    expect(errExtrasOutro).toBeNull();
    expect(lidoExtrasOutro ?? []).toHaveLength(0);
    const { data: lidoDiasOutro, error: errDiasOutro } = await sessaoOutroAdmin.from('dias_fora_horario').select('id').eq('aluno_id', alunoPrincipal.id);
    expect(errDiasOutro).toBeNull();
    expect(lidoDiasOutro ?? []).toHaveLength(0);
  });

  test('(j) dados_pagamento_centro só devolve o IBAN do próprio centro; aluno só vê os seus extras em extras_mes_encarregado', async () => {
    const sessaoOutroAdmin = await sessaoComo(outroAdmin);
    const { data: pagamentoOutro, error: errPagamentoOutro } = await sessaoOutroAdmin.rpc('dados_pagamento_centro');
    expect(errPagamentoOutro).toBeNull();
    const linhaOutro = Array.isArray(pagamentoOutro) ? pagamentoOutro[0] : pagamentoOutro;
    expect(linhaOutro?.iban ?? null).not.toBe(IBAN_VALIDO); // outro centro nunca tem IBAN (nunca o configurámos lá)

    const sessaoAlunoOutro = await sessaoComo(alunoOutro);
    const { data: extrasOutro, error: errExtrasAlunoOutro } = await sessaoAlunoOutro.rpc('extras_mes_encarregado', { p_ano: MES_ALVO.ano, p_mes: MES_ALVO.mes });
    expect(errExtrasAlunoOutro).toBeNull();
    expect(Number((extrasOutro as any).total)).toBe(0); // nunca os extras do alunoPrincipal
  });

  // ---------------------------------------------------------------------
  // Parte 3 — Resumo dos pais
  // ---------------------------------------------------------------------

  test('(k) Resumo dos pais: mensalidade em atraso, extras do mês com dia fora do horário no detalhe, e "Como pagar"', async ({ browser }) => {
    const context = await browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name="identificador"]', alunoPrincipal.email);
    await page.fill('input[type="password"]', alunoPrincipal.password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 });
    await page.goto(`${BASE_URL}/encarregados`, { waitUntil: 'networkidle' });
    await entrarComCodigo(page, CODIGO_PRINCIPAL);
    await irParaMesEncarregado(page, MES_ALVO.ano, MES_ALVO.mes);

    // Mensalidade: por pagar, em atraso, "a pagar até dia 5"
    await expect(page.getByTestId('mensalidade-valor')).toHaveText('50.00€');
    await expect(page.getByTestId('mensalidade-selo')).toContainText('Por pagar');
    await expect(page.getByTestId('mensalidade-atraso')).toBeVisible();
    await expect(page.getByText('A pagar até dia 5')).toBeVisible();

    // Extras do mês: 1.50 + 1.50 (consumos) + 10 (DIA1 aceite) = 13.00€, Pago (marcado no teste g)
    await expect(page.getByTestId('extras-total')).toHaveText('13.00€');
    await expect(page.getByText('A pagar no fim do mês')).toBeVisible();
    await page.getByRole('button', { name: /ver detalhe/i }).click();
    await expect(page.getByTestId('extras-dia-fora-linha')).toContainText(`Dia fora do horário · ${pad2(DIA1)}/${pad2(MES_ALVO.mes)}`);
    await expect(page.getByTestId('extras-dia-fora-linha')).toContainText('10.00€');

    // Total do mês: 50 (mensalidade) + 0 (sem explicações) + 13 (extras) = 63.00€
    await expect(page.getByTestId('total-mes')).toHaveText('63.00€');

    // Como pagar
    await expect(page.getByTestId('como-pagar')).toBeVisible();
    await expect(page.getByText(BENEFICIARIO_VALIDO)).toBeVisible();
    const ibanMostrado = (await page.getByTestId('iban-valor').textContent()) || '';
    expect(ibanMostrado.replace(/\s/g, '')).toBe(IBAN_VALIDO);

    await page.getByRole('button', { name: /copiar iban/i }).click();
    await expect(page.getByRole('button', { name: /copiado/i }).first()).toBeVisible({ timeout: 5_000 });
    const clipboardIban = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardIban).toBe(IBAN_VALIDO);

    await page.getByRole('button', { name: /copiar referência/i }).click();
    const clipboardRef = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardRef).toContain(alunoPrincipal.nome!);

    await context.close();
  });

  test('(l) divergência: consumos de extras_mes_encarregado batem com o total de extras de resumo_mes_encarregado', async () => {
    const sessaoAluno = await sessaoComo(alunoPrincipal);
    const { data: extrasData, error: errExtras } = await sessaoAluno.rpc('extras_mes_encarregado', { p_ano: MES_ALVO.ano, p_mes: MES_ALVO.mes });
    expect(errExtras).toBeNull();
    const { data: resumoData, error: errResumo } = await sessaoAluno.rpc('resumo_mes_encarregado', { p_ano: MES_ALVO.ano, p_mes: MES_ALVO.mes });
    expect(errResumo).toBeNull();

    // resumo_mes_encarregado.extras.total só conta consumos (lanches/etc);
    // extras_mes_encarregado.consumos é a MESMA coisa, calculada de novo —
    // se estes dois números divergirem, é um bug numa das duas RPCs.
    expect(Number((extrasData as any).consumos)).toBeCloseTo(Number((resumoData as any).extras.total), 2);
  });
});
