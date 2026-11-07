import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { getHojeLisboa, dataLisboaDe, instanteLisboaParaUTC } from '@/lib/dataLisboa';

dotenv.config({ path: '.env.local' });

// Registo de horas de trabalho dos professores (registos_horas_professor) —
// substitui dias/meios-dias de trabalho. Cobre: Dashboard "Turno de Hoje"
// (registar_entrada/registar_saida), /admin/horas (professor, registar_
// horas_em_falta), /admin/equipa/horas-trabalho (direção: adicionar/corrigir/
// apagar), isolamento (RLS só leitura, escrita só por função), mês pago, e o
// impacto em A Pagar/Performance (lib/remuneracaoProfessores.ts, valor_hora).
// Centro descartável ZZTESTE (~/Desktop/gestao-centros/novo-centro.mjs),
// nunca o centro real ou o demo. periodos_valor_professor e registos_horas_
// professor ainda não constam da lista de tabelas de apagar-centro.mjs —
// limpas à mão no afterAll, antes de chamar o script.

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
const NOME_ZZTESTE = `ZZTESTE Horas ${SUFIXO}`;
const ADMIN_EMAIL = `admin-horas-${SUFIXO}@zzteste.invalid`;

type Conta = { email: string; password: string; id: string };

let centroId: string;
let outroCentroId: string;
let admin: Conta;
let outroAdmin: Conta;
let profVariavel: Conta; // valor_hora definido, perpétuo
let profSalario: Conta; // salário definido, perpétuo
let profSemValor: Conta; // variável, sem valor_hora nunca definido — usado no teste de "soma 0€"
let profParaEditor: Conta; // só para o teste do editor "Valor por Hora" — nunca entra em cálculos de A Pagar
let secretariaConta: Conta;

let context: BrowserContext;
let page: Page; // admin
let contextProfVariavel: BrowserContext;
let pageProfVariavel: Page;
let contextProfSalario: BrowserContext;
let pageProfSalario: Page;
let contextSecretaria: BrowserContext;
let pageSecretaria: Page;

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

async function criarStaff(papel: string, nome: string, centro: string, extra: Record<string, unknown> = {}): Promise<Conta> {
  const email = `${nome.toLowerCase().replace(/\s+/g, '-')}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { role: papel, centro_id: centro });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: nome, role: papel, centro_id: centro, ...extra });
  if (error) throw new Error(`criar staff ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
  return { email, password, id };
}

async function sessaoComo(conta: Conta) {
  const cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

// Insere um registo diretamente (chave de serviço) para fixar um instante
// exato de entrada/saída — a base de dados calcula `minutos` sozinha
// (coluna calculada, já arredondada por config_centro.arredondamento_horas_min).
async function inserirRegisto(professorId: string, entradaUTC: string, saidaUTC: string | null, origem: 'toque' | 'manual' | 'direcao' = 'manual') {
  const { data, error } = await supabaseAdmin
    .from('registos_horas_professor')
    .insert({ centro_id: centroId, professor_id: professorId, entrada: entradaUTC, saida: saidaUTC, origem })
    .select('id, minutos')
    .single();
  if (error) throw new Error(`inserir registo: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('registos_horas_professor').delete().eq('id', data.id));
  return data as { id: string; minutos: number | null };
}

async function limparRegistosDe(professorId: string) {
  await supabaseAdmin.from('registos_horas_professor').delete().eq('professor_id', professorId);
}

async function abrirAPagar(p: Page) {
  await p.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'A Pagar', exact: true }).click();
  await p.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});
}

function linhaDoProfessor(p: Page, nome: string) {
  return p.locator('tr', { hasText: nome });
}

test.describe.configure({ mode: 'serial' });

test.describe('Registo de horas de trabalho dos professores — centro descartável ZZTESTE', () => {
  test.beforeAll(async ({ browser }) => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE Horas'],
      { cwd: GESTAO_DIR, encoding: 'utf8' }
    );
    const m = saida.match(/centro_id = ([0-9a-f-]+)/);
    if (!m) throw new Error('novo-centro.mjs não devolveu centro_id: ' + saida);
    centroId = m[1];

    const { data: staffAdmin, error: staffAdminError } = await supabaseAdmin
      .from('staff')
      .select('id')
      .eq('centro_id', centroId)
      .eq('role', 'admin')
      .single();
    if (staffAdminError || !staffAdmin) throw new Error('não encontrei o staff admin criado pelo novo-centro.mjs');
    const passwordAdmin = gerarPasswordSegura();
    const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(staffAdmin.id, { password: passwordAdmin });
    if (resetError) throw new Error(`rodar password do admin: ${resetError.message}`);
    admin = { email: ADMIN_EMAIL, password: passwordAdmin, id: staffAdmin.id };

    profVariavel = await criarStaff('professor', 'Prof Variavel Horas', centroId, { tarifa_tipo: 'fixo', tarifa_valor: 20 });
    profSalario = await criarStaff('professor', 'Prof Salario Horas', centroId);
    profSemValor = await criarStaff('professor', 'Prof Sem Valor Horas', centroId, { tarifa_tipo: 'fixo', tarifa_valor: 20 });
    profParaEditor = await criarStaff('professor', 'Prof Editor Horas', centroId);

    const sessaoAdminSetup = await sessaoComo(admin);
    // Perpétuos (desde 2020, sem fim) — para os testes "hoje" nunca dependerem
    // de em que mês real o CI corre.
    let r = await sessaoAdminSetup.rpc('definir_periodo_professor', { p_professor: profVariavel.id, p_tipo: 'valor_hora', p_de: '2020-01-01', p_valor: 10 });
    if (r.error) throw new Error(`valor_hora profVariavel: ${r.error.message}`);
    r = await sessaoAdminSetup.rpc('definir_periodo_professor', { p_professor: profSalario.id, p_tipo: 'salario', p_de: '2020-01-01', p_valor: 1000 });
    if (r.error) throw new Error(`salario profSalario: ${r.error.message}`);

    // --- outro centro, só para o teste de isolamento da direção ---
    const { data: outroCentro, error: outroCentroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Horas Outro ${SUFIXO}`, email_remetente: `zzteste-horas-outro-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (outroCentroError) throw new Error(`criar outro centro: ${outroCentroError.message}`);
    outroCentroId = outroCentro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', outroCentroId));
    outroAdmin = await criarStaff('admin', 'Outro Admin Horas', outroCentroId);

    context = await browser.newContext();
    page = await context.newPage();
    await loginUI(page, admin.email, admin.password);

    contextProfVariavel = await browser.newContext();
    pageProfVariavel = await contextProfVariavel.newPage();
    await loginUI(pageProfVariavel, profVariavel.email, profVariavel.password);

    contextProfSalario = await browser.newContext();
    pageProfSalario = await contextProfSalario.newPage();
    await loginUI(pageProfSalario, profSalario.email, profSalario.password);

    secretariaConta = await criarStaff('secretaria', 'Secretaria Horas', centroId);
    contextSecretaria = await browser.newContext();
    pageSecretaria = await contextSecretaria.newPage();
    await loginUI(pageSecretaria, secretariaConta.email, secretariaConta.password);
  });

  test.afterAll(async () => {
    await context?.close();
    await contextProfVariavel?.close();
    await contextProfSalario?.close();
    await contextSecretaria?.close();

    if (centroId) {
      await supabaseAdmin.from('periodos_valor_professor').delete().eq('centro_id', centroId);
      await supabaseAdmin.from('registos_horas_professor').delete().eq('centro_id', centroId);
    }
    if (outroCentroId) {
      await supabaseAdmin.from('periodos_valor_professor').delete().eq('centro_id', outroCentroId);
    }

    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }

    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }

    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    const { data: restoRegistos } = await supabaseAdmin.from('registos_horas_professor').select('id').eq('centro_id', centroId);
    const { data: restoOutroCentro } = await supabaseAdmin.from('config_centro').select('id').eq('id', outroCentroId);
    expect(restoConfig ?? []).toHaveLength(0);
    expect(restoRegistos ?? []).toHaveLength(0);
    expect(restoOutroCentro ?? []).toHaveLength(0);
  });

  // --- Cenário 1: Dashboard — entrada e saída, variável e salário, segunda entrada recusada ---
  test('Dashboard: Prof Variavel regista entrada, vê o turno em curso, regista saída e o aviso mostra a duração', async () => {
    await pageProfVariavel.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    const cartao = pageProfVariavel.getByText('Turno de Hoje').locator('..');

    await expect(cartao.getByText('Ainda sem entrada registada')).toBeVisible();
    await cartao.getByRole('button', { name: 'Registar entrada' }).click();
    await expect(cartao.getByText('Turno em curso desde', { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(cartao).toContainText(/\d+ h \d{2} min até agora/);
    await expect(cartao).not.toContainText('€');

    await cartao.getByRole('button', { name: 'Registar saída' }).click();
    await expect(pageProfVariavel.getByText(/Turno registado: \d{2}:\d{2} às \d{2}:\d{2}\. Conta \d+ h \d{2} min\./)).toBeVisible({ timeout: 10_000 });
    await expect(cartao.getByText('Ainda sem entrada registada')).toBeVisible();
  });

  test('Dashboard: Prof Salario (de salário) também regista entrada e saída — o cartão aparece igual', async () => {
    await pageProfSalario.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    const cartao = pageProfSalario.getByText('Turno de Hoje').locator('..');
    await cartao.getByRole('button', { name: 'Registar entrada' }).click();
    await expect(cartao.getByText('Turno em curso desde', { exact: false })).toBeVisible({ timeout: 10_000 });
    await cartao.getByRole('button', { name: 'Registar saída' }).click();
    await expect(cartao.getByText('Ainda sem entrada registada')).toBeVisible({ timeout: 10_000 });
  });

  test('registar_entrada recusa uma segunda entrada enquanto houver turno em curso', async () => {
    const sessao = await sessaoComo(profVariavel);
    let r = await sessao.rpc('registar_entrada');
    expect(r.error).toBeNull();
    r = await sessao.rpc('registar_entrada');
    expect(r.error).not.toBeNull();
    expect(r.error!.message).toContain('Já tens um turno em curso');
    // fecha para não interferir com os testes seguintes
    await sessao.rpc('registar_saida');
  });

  // --- Cenário 2: turno aberto de um dia anterior ---
  test('Dashboard: turno aberto desde ontem mostra aviso âmbar e fecha com a hora escolhida', async () => {
    await limparRegistosDe(profVariavel.id);
    const hojeISO = getHojeLisboa();
    const ontemISO = dataLisboaDe(new Date(new Date(`${hojeISO}T12:00:00.000Z`).getTime() - 24 * 60 * 60 * 1000));
    const entradaOntem = instanteLisboaParaUTC(ontemISO, '09:00');
    await inserirRegisto(profVariavel.id, entradaOntem, null, 'toque');

    await pageProfVariavel.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    const cartao = pageProfVariavel.getByText('Turno de Hoje').locator('..');
    await expect(cartao.getByText('ficou aberto desde 09:00', { exact: false })).toBeVisible({ timeout: 10_000 });

    await cartao.locator('input[type="time"]').fill('18:00');
    await cartao.getByRole('button', { name: 'Registar saída' }).click();
    await expect(cartao.getByText('Ainda sem entrada registada')).toBeVisible({ timeout: 10_000 });

    const { data: registo } = await supabaseAdmin
      .from('registos_horas_professor')
      .select('entrada, saida, minutos')
      .eq('professor_id', profVariavel.id)
      .is('saida', null)
      .maybeSingle();
    expect(registo).toBeNull(); // já não há nenhum em aberto
  });

  // --- Cenário 3: página "Horas de Trabalho" do professor ---
  test('Horas de Trabalho (professor): lista o mês, soma o total, mostra etiquetas e um registo em aberto', async () => {
    await limparRegistosDe(profVariavel.id);
    const hojeISO = getHojeLisboa();

    // 1h fechada, vinda de "toque"
    await inserirRegisto(profVariavel.id, instanteLisboaParaUTC(hojeISO, '08:00'), instanteLisboaParaUTC(hojeISO, '09:00'), 'toque');

    await pageProfVariavel.goto(`${BASE_URL}/admin/horas`, { waitUntil: 'networkidle' });
    const totalCard = pageProfVariavel.getByText('Total do Mês').locator('..');
    await expect(totalCard).toBeVisible();
    await expect(totalCard.getByText('1 h 00 min', { exact: true })).toBeVisible();
    await expect(pageProfVariavel.locator('main').last()).not.toContainText('€');

    // "Registar horas em falta" — hoje, 10:00-10:30 (manual)
    await pageProfVariavel.locator('input[type="time"]').first().fill('10:00');
    await pageProfVariavel.locator('input[type="time"]').nth(1).fill('10:30');
    await pageProfVariavel.getByRole('button', { name: 'Registar' }).click();
    await expect(pageProfVariavel.getByText('Horas registadas.')).toBeVisible({ timeout: 10_000 });
    await expect(pageProfVariavel.getByText('manual', { exact: true })).toBeVisible();
    await expect(totalCard.getByText('1 h 30 min', { exact: true })).toBeVisible(); // novo total

    // registo em aberto (via toque) — aparece assinalado e não soma
    await inserirRegisto(profVariavel.id, instanteLisboaParaUTC(hojeISO, '20:00'), null, 'toque');
    await pageProfVariavel.reload({ waitUntil: 'networkidle' });
    await expect(pageProfVariavel.getByText('em aberto desde 20:00', { exact: false })).toBeVisible();
    await expect(totalCard.getByText('1 h 30 min', { exact: true })).toBeVisible(); // total não mudou
    await limparRegistosDe(profVariavel.id);
  });

  test('registar_horas_em_falta recusa sobreposição, hora no futuro e dias fora de hoje/ontem', async () => {
    const sessao = await sessaoComo(profVariavel);
    const hojeISO = getHojeLisboa();
    await inserirRegisto(profVariavel.id, instanteLisboaParaUTC(hojeISO, '08:00'), instanteLisboaParaUTC(hojeISO, '09:00'), 'manual');

    // sobreposição com o registo de 08:00-09:00 de hoje
    let r = await sessao.rpc('registar_horas_em_falta', { p_dia: hojeISO, p_entrada: '08:30', p_saida: '09:30' });
    expect(r.error).not.toBeNull();

    // hora de saída no futuro (1h a partir de agora, em Lisboa)
    const dentroDeUmaHora = new Date(Date.now() + 60 * 60 * 1000);
    const horaFutura = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hour12: false }).format(dentroDeUmaHora);
    r = await sessao.rpc('registar_horas_em_falta', { p_dia: hojeISO, p_entrada: '00:00', p_saida: horaFutura });
    expect(r.error).not.toBeNull();

    // há 2 dias — nem hoje nem ontem
    const ha2Dias = dataLisboaDe(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
    r = await sessao.rpc('registar_horas_em_falta', { p_dia: ha2Dias, p_entrada: '10:00', p_saida: '11:00' });
    expect(r.error).not.toBeNull();

    await limparRegistosDe(profVariavel.id);
  });

  test('Horas de Trabalho (professor): um mês anterior é só leitura (sem o formulário)', async () => {
    await pageProfVariavel.goto(`${BASE_URL}/admin/horas`, { waitUntil: 'networkidle' });
    await pageProfVariavel.locator('button:has(svg.lucide-chevron-left)').click();
    await pageProfVariavel.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 10_000 }).catch(() => {});
    await expect(pageProfVariavel.getByText('só leitura', { exact: false })).toBeVisible();
    await expect(pageProfVariavel.getByRole('button', { name: 'Registar', exact: true })).toHaveCount(0);
  });

  // --- Cenário 4: isolamento ---
  test('isolamento: um professor não lê os registos de outro; escrita direta na tabela é sempre recusada', async () => {
    await inserirRegisto(profSalario.id, instanteLisboaParaUTC(getHojeLisboa(), '08:00'), instanteLisboaParaUTC(getHojeLisboa(), '09:00'), 'toque');

    const sessaoVariavel = await sessaoComo(profVariavel);
    const { data: lidoOutro, error: errLido } = await sessaoVariavel.from('registos_horas_professor').select('id').eq('professor_id', profSalario.id);
    expect(errLido).toBeNull();
    expect(lidoOutro ?? []).toHaveLength(0);

    // escrita direta — mesmo nos seus próprios registos — é sempre recusada: só funções escrevem.
    const { error: errEscritaDireta } = await sessaoVariavel
      .from('registos_horas_professor')
      .insert({ centro_id: centroId, professor_id: profVariavel.id, entrada: new Date().toISOString(), origem: 'manual' });
    expect(errEscritaDireta).not.toBeNull();

    // secretaria não lê nada desta tabela
    const sessaoSecretaria = await sessaoComo(secretariaConta);
    const { data: lidoSecretaria, error: errLidoSecretaria } = await sessaoSecretaria.from('registos_horas_professor').select('id');
    expect(errLidoSecretaria).toBeNull();
    expect(lidoSecretaria ?? []).toHaveLength(0);

    await limparRegistosDe(profSalario.id);
  });

  test('menu e middleware: "Horas de Trabalho" só aparece e só é acessível ao professor', async () => {
    await pageSecretaria.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    await expect(pageSecretaria.getByRole('link', { name: 'Horas de Trabalho' })).toHaveCount(0);
    await pageSecretaria.goto(`${BASE_URL}/admin/horas`, { waitUntil: 'networkidle' });
    await expect(pageSecretaria).toHaveURL(`${BASE_URL}/admin`);

    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('link', { name: 'Horas de Trabalho', exact: true })).toHaveCount(0);

    await pageProfVariavel.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    await expect(pageProfVariavel.getByRole('link', { name: 'Horas de Trabalho' })).toBeVisible();
  });

  // --- Cenário 5: direção — adicionar, corrigir, apagar, turnos em aberto, mês pago ---
  test('Direção: adiciona horas, corrige um registo (incluindo fechar um turno em aberto) e apaga', async () => {
    const hojeISO = getHojeLisboa();
    const url = `${BASE_URL}/admin/equipa/horas-trabalho?professor=${profSemValor.id}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 10_000 }).catch(() => {});
    const totalCard = page.getByText('Total do Mês').locator('..');

    await page.getByRole('button', { name: 'Adicionar Horas' }).click();
    await page.locator('input[type="date"]').fill(hojeISO);
    await page.locator('input[type="time"]').first().fill('09:00');
    await page.locator('input[type="time"]').nth(1).fill('10:00');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Horas adicionadas.')).toBeVisible({ timeout: 10_000 });
    await expect(totalCard.getByText('1 h 00 min', { exact: true })).toBeVisible();

    // corrigir
    await page.getByRole('button').filter({ has: page.locator('svg.lucide-pencil') }).first().click();
    await page.locator('input[type="time"]').first().fill('09:00');
    await page.locator('input[type="time"]').nth(1).fill('11:00');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Registo corrigido.')).toBeVisible({ timeout: 10_000 });
    await expect(totalCard.getByText('2 h 00 min', { exact: true })).toBeVisible();

    // um turno em aberto (via toque) — a direção fecha-o corrigindo com a hora de saída
    await inserirRegisto(profSemValor.id, instanteLisboaParaUTC(hojeISO, '14:00'), null, 'toque');
    await page.goto(url, { waitUntil: 'networkidle' });
    await expect(page.getByText('em aberto desde 14:00', { exact: false })).toBeVisible();
    await page.getByRole('button').filter({ has: page.locator('svg.lucide-pencil') }).last().click();
    await page.locator('input[type="time"]').nth(1).fill('15:00');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Registo corrigido.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('em aberto desde', { exact: false })).toHaveCount(0);
    await expect(totalCard.getByText('3 h 00 min', { exact: true })).toBeVisible();

    // apagar um dos registos
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button').filter({ has: page.locator('svg.lucide-trash-2') }).first().click();
    await expect(page.getByText('Registo apagado.')).toBeVisible({ timeout: 10_000 });

    await limparRegistosDe(profSemValor.id);
  });

  test('Direção: mês pago desativa os controlos e a base de dados recusa escrever', async () => {
    const hojeISO = getHojeLisboa();
    const [anoStr, mesStr] = hojeISO.split('-');
    const ano = Number(anoStr);
    const mes = Number(mesStr);

    const { error: errPago } = await supabaseAdmin.from('pagamentos_professores').upsert(
      { centro_id: centroId, professor_id: profSemValor.id, ano, mes, pago: true, data_pagamento: hojeISO },
      { onConflict: 'professor_id,ano,mes' }
    );
    expect(errPago).toBeNull();

    const sessaoAdmin = await sessaoComo(admin);
    const { error: errAdicionar } = await sessaoAdmin.rpc('adicionar_horas_professor', {
      p_professor: profSemValor.id, p_dia: hojeISO, p_entrada: '09:00', p_saida: '10:00',
    });
    expect(errAdicionar).not.toBeNull();
    expect(errAdicionar!.message).toContain('já está marcado como pago');

    await page.goto(`${BASE_URL}/admin/equipa/horas-trabalho`, { waitUntil: 'networkidle' });
    await page.locator('select').selectOption(profSemValor.id);
    await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 10_000 }).catch(() => {});
    await expect(page.getByText('Mês pago', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adicionar Horas' })).toHaveCount(0);

    await supabaseAdmin.from('pagamentos_professores').update({ pago: false }).eq('centro_id', centroId).eq('professor_id', profSemValor.id).eq('ano', ano).eq('mes', mes);
  });

  test('Direção: admin de outro centro não adiciona horas a um professor deste centro', async () => {
    const sessaoOutroAdmin = await sessaoComo(outroAdmin);
    const { error } = await sessaoOutroAdmin.rpc('adicionar_horas_professor', {
      p_professor: profSemValor.id, p_dia: getHojeLisboa(), p_entrada: '09:00', p_saida: '10:00',
    });
    expect(error).not.toBeNull();
  });

  // --- Cenário 6: editor "Valor por Hora de Trabalho" em Equipa ---
  test('UI — Equipa: editor "Valor por Hora de Trabalho" define e mostra o valor ativo', async () => {
    await page.goto(`${BASE_URL}/admin/equipa`, { waitUntil: 'networkidle' });
    await page.getByTestId(`membro-${profParaEditor.id}`).getByRole('button', { name: 'Remuneração' }).click();
    await expect(page.getByText('Remuneração de Prof Editor Horas')).toBeVisible();
    await page.getByRole('button', { name: 'Variável', exact: true }).click();
    await expect(page.getByText('Valor por Hora de Trabalho')).toBeVisible();

    const bloco = page.getByText('Valor por Hora de Trabalho').locator('..');
    await bloco.getByRole('button', { name: 'Definir valor a partir de...' }).click();
    await bloco.locator('input[type="month"]').fill('2026-01');
    await bloco.locator('input[type="number"]').fill('12');
    await bloco.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Valor atualizado.')).toBeVisible({ timeout: 10_000 });
    await expect(bloco).toContainText('12.00€/hora');

    const { data: periodo } = await supabaseAdmin
      .from('periodos_valor_professor')
      .select('tipo, valor')
      .eq('professor_id', profParaEditor.id)
      .eq('tipo', 'valor_hora')
      .maybeSingle();
    expect(periodo).not.toBeNull();
    expect(Number(periodo!.valor)).toBe(12);
  });

  // --- Cenário 7: A Pagar — horas x valor, arredondamento, sem valor, turno aberto, salário com presença ---
  test('A Pagar: variável = horas x valor por hora (com um caso de 15 min arredondados vindos da base de dados)', async () => {
    await limparRegistosDe(profVariavel.id);
    const hojeISO = getHojeLisboa();
    // 52 minutos reais — a base de dados arredonda para o múltiplo de 15 mais próximo.
    const registo = await inserirRegisto(profVariavel.id, instanteLisboaParaUTC(hojeISO, '08:00'), instanteLisboaParaUTC(hojeISO, '08:52'), 'manual');
    const minutos = Number(registo.minutos);
    expect(minutos % 15).toBe(0);
    expect(Math.abs(minutos - 52)).toBeLessThanOrEqual(15);
    const valorEsperado = (minutos / 60) * 10;

    await abrirAPagar(page);
    const linha = linhaDoProfessor(page, 'Prof Variavel Horas');
    await linha.locator('button').first().click();
    await expect(page.getByText(`× 10.00€ / hora`, { exact: false })).toBeVisible();
    await expect(page.getByText(`${valorEsperado.toFixed(2)}€`, { exact: false }).first()).toBeVisible();
    await limparRegistosDe(profVariavel.id);
  });

  test('A Pagar: variável com horas e sem valor por hora definido avisa e soma 0€; turno em aberto avisa e não soma', async () => {
    const hojeISO = getHojeLisboa();
    await inserirRegisto(profSemValor.id, instanteLisboaParaUTC(hojeISO, '08:00'), instanteLisboaParaUTC(hojeISO, '09:00'), 'manual');
    await inserirRegisto(profSemValor.id, instanteLisboaParaUTC(hojeISO, '20:00'), null, 'toque');

    await abrirAPagar(page);
    const linha = linhaDoProfessor(page, 'Prof Sem Valor Horas');
    await linha.locator('button').first().click();
    await expect(page.getByText('Sem valor por hora definido — soma 0€')).toBeVisible();
    await expect(page.getByText('1 turno em aberto', { exact: false })).toBeVisible();

    await limparRegistosDe(profSemValor.id);
  });

  test('A Pagar: professor de salário mostra "Registo de presença" e as horas não entram no total', async () => {
    const hojeISO = getHojeLisboa();
    await inserirRegisto(profSalario.id, instanteLisboaParaUTC(hojeISO, '08:00'), instanteLisboaParaUTC(hojeISO, '09:00'), 'toque');

    await abrirAPagar(page);
    const linha = linhaDoProfessor(page, 'Prof Salario Horas');
    await expect(linha).toContainText('1000.00€'); // só o salário
    await linha.locator('button').first().click();
    await expect(page.getByText('Registo de presença: 1 h 00 min (não entra no pagamento)')).toBeVisible();

    await limparRegistosDe(profSalario.id);
  });

  test('Performance: o total dos professores coincide com o de A Pagar no mesmo mês', async () => {
    const hojeISO = getHojeLisboa();
    await inserirRegisto(profVariavel.id, instanteLisboaParaUTC(hojeISO, '08:00'), instanteLisboaParaUTC(hojeISO, '09:00'), 'manual');

    await abrirAPagar(page);
    const totalAPagarTexto = await page.getByText('Total Acordado').locator('..').locator('p').nth(1).textContent();

    await page.goto(`${BASE_URL}/admin/performance`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});
    const totalPerformanceTexto = await page.getByText('Professores:', { exact: false }).textContent();

    const numeroAPagar = parseFloat((totalAPagarTexto || '').replace(/[^\d.,-]/g, '').replace(',', '.'));
    const numeroPerformance = parseFloat((totalPerformanceTexto || '').match(/Professores:\s*([\d.,]+)/)?.[1]?.replace(',', '.') || 'NaN');
    expect(numeroPerformance).toBeCloseTo(numeroAPagar, 1);

    await limparRegistosDe(profVariavel.id);
  });

  // --- Cenário 8: mudança de hora de verão (Portugal: último domingo de outubro) ---
  test('horário de verão: um registo perto da mudança é atribuído ao dia e ao mês certos', async () => {
    const entradaOutubro = instanteLisboaParaUTC('2026-10-25', '23:30');
    const saidaOutubro = instanteLisboaParaUTC('2026-10-25', '23:45');
    expect(dataLisboaDe(entradaOutubro)).toBe('2026-10-25');

    const entradaNovembro = instanteLisboaParaUTC('2026-11-01', '00:15');
    const saidaNovembro = instanteLisboaParaUTC('2026-11-01', '00:30');
    expect(dataLisboaDe(entradaNovembro)).toBe('2026-11-01');

    await inserirRegisto(profVariavel.id, entradaOutubro, saidaOutubro, 'manual');
    await inserirRegisto(profVariavel.id, entradaNovembro, saidaNovembro, 'manual');

    // Navega direto para cada mês via URL (?professor=&mes=) em vez de clicar
    // nos chevrons — evita qualquer corrida entre o fetch disparado pela
    // troca de professor e o disparado pela troca de mês.
    await page.goto(`${BASE_URL}/admin/equipa/horas-trabalho?professor=${profVariavel.id}&mes=2026-10`, { waitUntil: 'networkidle' });
    await expect(page.getByText('25 de outubro', { exact: false })).toBeVisible();
    await expect(page.getByText('1 de novembro', { exact: false })).toHaveCount(0);

    await page.goto(`${BASE_URL}/admin/equipa/horas-trabalho?professor=${profVariavel.id}&mes=2026-11`, { waitUntil: 'networkidle' });
    await expect(page.getByText('1 de novembro', { exact: false })).toBeVisible();
    await expect(page.getByText('25 de outubro', { exact: false })).toHaveCount(0);

    await limparRegistosDe(profVariavel.id);
  });
});
