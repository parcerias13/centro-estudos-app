import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { definirTarifaStaff } from './helpers/staffRemuneracao';

dotenv.config({ path: '.env.local' });

// staff.tarifa_tipo/tarifa_valor/tarifa_escala_aluno foram substituídas por
// staff_remuneracao (staff_id PK/FK para staff com ON DELETE CASCADE,
// centro_id, tarifa_tipo, tarifa_valor >= 0 ou null, tarifa_escala_aluno,
// updated_at), com RLS a restringir todas as operações ao admin do próprio
// centro — nem o próprio professor lê a sua linha. calcular_valores_explicacao
// passou a ler o fallback a partir daqui (depois das exceções em
// tarifas_professor_disciplina, nunca antes). As colunas antigas em staff já
// foram removidas da base de dados.
// Datas fixas no passado (nunca "hoje") para as sessões de explicações, para
// o resultado nunca depender de quando a suite corre. Centro descartável
// ZZTESTE (~/Desktop/gestao-centros/novo-centro.mjs), nunca o Trupe Lias nem
// o Demo.

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
const NOME_ZZTESTE = `ZZTESTE StaffRemuneracao ${SUFIXO}`;
const ADMIN_EMAIL = `admin-staffremun-${SUFIXO}@zzteste.invalid`;

// Mês fixo no passado para as sessões de cálculo (A Pagar/Performance) —
// perto o suficiente de hoje para a navegação por mês na UI não precisar de
// muitos cliques, mas sempre um mês que já passou.
const MES_CALC = { ano: 2026, mes: 9 };
const DIA_FIXO = '2026-09-05';
const DIA_HORA = '2026-09-06';
const DIA_ESCALA = '2026-09-07';
const DIA_EXCECAO = '2026-09-08';

type Conta = { email: string; password: string; id: string };
type Aluno = { id: string; nome: string };

let centroId: string;
let outroCentroId: string;
let admin: Conta;
let professor1: Conta; // UI de tarifa (editar/limpar/negativo)
let professorCalc: Conta; // cálculo + Pagamentos/Performance
let secretaria: Conta;
let outroAdmin: Conta;
let disciplinaCalcId: number;
let alunoCalcA: Aluno;
let alunoCalcB: Aluno;

const limpeza: Array<() => unknown> = [];

async function criarUtilizadorAuth(email: string, password: string, appMetadata: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`criar utilizador ${email}: ${error.message}`);
  const id = data.user.id;
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: appMetadata });
  if (metaError) throw new Error(`app_metadata ${email}: ${metaError.message}`);
  return id;
}

async function criarStaff(papel: string, nome: string, centro: string): Promise<Conta> {
  const email = `${nome.toLowerCase().replace(/\s+/g, '-')}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { role: papel, centro_id: centro });
  const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: nome, role: papel, centro_id: centro });
  if (error) throw new Error(`criar staff ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
  return { email, password, id };
}

async function criarAlunoDireto(nome: string, sufixo: string): Promise<Aluno> {
  const email = `aluno-${sufixo}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { role: 'aluno', centro_id: centroId });
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-${sufixo}-${SUFIXO}@zzteste.invalid`,
    data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centroId, ativo: true,
    sala_estudo: false, faz_explicacoes: true,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return { id, nome };
}

async function sessaoComo(conta: Conta) {
  const cliente = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
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

async function abrirEquipa(p: Page) {
  await p.goto(`${BASE_URL}/admin/equipa`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});
}

function linhaMembro(p: Page, staffId: string) {
  return p.locator(`[data-testid="membro-${staffId}"]`);
}

function modalTarifa(p: Page) {
  return p.locator('div.rounded-3xl.shadow-2xl').filter({ has: p.getByRole('heading', { name: /^Remuneração de/ }) });
}

async function abrirModalTarifa(p: Page, staffId: string) {
  await linhaMembro(p, staffId).getByRole('button', { name: 'Remuneração' }).click();
  await expect(modalTarifa(p).locator('select')).toBeVisible({ timeout: 10_000 });
}

// --- explicações: fluxo real (nasce dado:false, UPDATE para dado:true
// dispara o gatilho calcular_valores_explicacao) ---
async function criarExplicacaoBase(professorId: string, data: string, hora: string, alunoIds: string[]): Promise<string> {
  const { data: exp, error } = await supabaseAdmin.from('explicacoes').insert({
    centro_id: centroId, professor_id: professorId, disciplina_id: disciplinaCalcId, data, hora_inicio: hora,
    created_by: professorId, dado: false, horas_dadas: null,
  }).select().single();
  if (error) throw new Error(`criar explicacao ${data} ${hora}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('explicacoes_alunos').delete().eq('explicacao_id', exp.id));
  limpeza.push(() => supabaseAdmin.from('explicacoes').delete().eq('id', exp.id));
  for (const alunoId of alunoIds) {
    const { error: errAlunos } = await supabaseAdmin.from('explicacoes_alunos').insert({ explicacao_id: exp.id, aluno_id: alunoId });
    if (errAlunos) throw new Error(`associar aluno ${exp.id}: ${errAlunos.message}`);
  }
  return exp.id;
}

async function marcarDadoDireto(expId: string, horas: number): Promise<number> {
  const { error } = await supabaseAdmin.from('explicacoes').update({ dado: true, horas_dadas: horas }).eq('id', expId);
  if (error) throw new Error(`marcar sessão dada ${expId}: ${error.message}`);
  const { data } = await supabaseAdmin.from('explicacoes').select('valor_calculado').eq('id', expId).single();
  return Number(data!.valor_calculado);
}

async function abrirAPagar(p: Page) {
  await p.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'A Pagar', exact: true }).click();
  await p.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});
}

async function abrirPerformance(p: Page) {
  await p.goto(`${BASE_URL}/admin/performance`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});
}

function linhaDoProfessor(p: Page, nome: string) {
  return p.locator('tr', { hasText: nome });
}

// Navega da data real até ao mês fixo alvo, sempre pelo mesmo nº de cliques
// que faltarem — nunca assume o mês de partida.
async function irParaMes(p: Page, anoAlvo: number, mesAlvo: number) {
  const hoje = new Date();
  const delta = (anoAlvo - hoje.getFullYear()) * 12 + (mesAlvo - (hoje.getMonth() + 1));
  const seletor = p.locator(`button:has(svg.lucide-chevron-${delta < 0 ? 'left' : 'right'})`).first();
  for (let i = 0; i < Math.abs(delta); i++) {
    await seletor.click();
    // Um clique a mais sem esperar pelo fetch anterior perde o pedido mais
    // recente (isFetchingRef/fetchPendingRef de APagarTab repete o mês
    // antigo) — o mesmo intervalo que tests/remuneracao-professores.spec.ts
    // já usa antes de verificar o spinner.
    await p.waitForTimeout(150);
    await p.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 10_000 }).catch(() => {});
  }
}

function startOfWeekSegunda(d: Date): Date {
  const dia = d.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return r;
}

// Idem, para a agenda semanal de /admin/explicacoes.
async function irParaSemanaDe(p: Page, dataISOAlvo: string) {
  const hoje = new Date();
  const alvo = new Date(`${dataISOAlvo}T00:00:00`);
  const semanaHoje = startOfWeekSegunda(hoje).getTime();
  const semanaAlvo = startOfWeekSegunda(alvo).getTime();
  const deltaSemanas = Math.round((semanaAlvo - semanaHoje) / (7 * 24 * 3600 * 1000));
  const rotulo = deltaSemanas < 0 ? 'Semana anterior' : 'Semana seguinte';
  for (let i = 0; i < Math.abs(deltaSemanas); i++) {
    await p.getByLabel(rotulo).click();
    // Mesma corrida que o isFetchingRef/fetchPendingRef de A Pagar: um
    // clique a mais antes do fetch da semana anterior terminar faz
    // fetchSessoes repetir a semana errada — espera o spinner da própria
    // página (loading), não só um tempo fixo.
    await p.waitForTimeout(150);
    await p.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 10_000 }).catch(() => {});
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('Tarifas de professores em staff_remuneracao — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE StaffRemuneracao'],
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

    professor1 = await criarStaff('professor', 'Prof Tarifa UI', centroId);
    professorCalc = await criarStaff('professor', 'Prof Tarifa Calc', centroId);
    secretaria = await criarStaff('secretaria', 'Secretaria StaffRemun', centroId);

    const { data: outroCentro, error: outroCentroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Outro StaffRemun ${SUFIXO}`, email_remetente: `zzteste-outro-staffremun-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (outroCentroError) throw new Error(`criar outro centro: ${outroCentroError.message}`);
    outroCentroId = outroCentro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', outroCentroId));
    outroAdmin = await criarStaff('admin', 'Admin OutroCentro StaffRemun', outroCentroId);

    const { data: disciplina, error: disciplinaError } = await supabaseAdmin
      .from('subjects').insert({ name: `Disciplina StaffRemun ${SUFIXO}`, centro_id: centroId }).select('id').single();
    if (disciplinaError) throw new Error(`criar disciplina: ${disciplinaError.message}`);
    disciplinaCalcId = disciplina.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplinaCalcId));

    alunoCalcA = await criarAlunoDireto('Aluno Calc A StaffRemun', 'calc-a');
    alunoCalcB = await criarAlunoDireto('Aluno Calc B StaffRemun', 'calc-b');
  });

  test.afterAll(async () => {
    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }
    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    const { data: restoStaff } = await supabaseAdmin.from('staff').select('id').eq('centro_id', centroId);
    const { data: restoRemun } = await supabaseAdmin.from('staff_remuneracao').select('staff_id').eq('centro_id', centroId);
    const { data: restoOutroCentro } = await supabaseAdmin.from('config_centro').select('id').eq('id', outroCentroId);
    expect(restoConfig ?? []).toHaveLength(0);
    expect(restoStaff ?? []).toHaveLength(0);
    expect(restoRemun ?? []).toHaveLength(0);
    expect(restoOutroCentro ?? []).toHaveLength(0);
  });

  // --- 1. Admin edita a tarifa pela UI ---
  test('admin edita a tarifa de um professor pela UI: fica em staff_remuneracao com o centro certo; staff não é tocada', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await abrirEquipa(page);

    await abrirModalTarifa(page, professor1.id);
    await modalTarifa(page).locator('select').selectOption('fixo');
    await modalTarifa(page).getByPlaceholder('0.00').fill('25');
    await modalTarifa(page).getByRole('button', { name: 'Guardar Tarifa' }).click();
    await expect(page.getByText('Tarifa atualizada com sucesso.')).toBeVisible({ timeout: 10_000 });

    const { data: remun, error: errRemun } = await supabaseAdmin
      .from('staff_remuneracao').select('centro_id, tarifa_tipo, tarifa_valor, tarifa_escala_aluno').eq('staff_id', professor1.id).single();
    expect(errRemun).toBeNull();
    expect(remun!.centro_id).toBe(centroId);
    expect(remun!.tarifa_tipo).toBe('fixo');
    expect(Number(remun!.tarifa_valor)).toBe(25);
    expect(remun!.tarifa_escala_aluno).toBe(false);

    await context.close();
  });

  // --- 2. Admin limpa a tarifa ---
  test('admin limpa a tarifa pela UI: tarifa_tipo/tarifa_valor ficam null e tarifa_escala_aluno false', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await abrirEquipa(page); // recarrega do zero — confirma que o load também lê staff_remuneracao

    await abrirModalTarifa(page, professor1.id);
    await expect(modalTarifa(page).locator('select')).toHaveValue('fixo');
    await expect(modalTarifa(page).getByPlaceholder('0.00')).toHaveValue('25');

    await modalTarifa(page).locator('select').selectOption('');
    await modalTarifa(page).getByPlaceholder('0.00').fill('');
    await modalTarifa(page).getByRole('button', { name: 'Guardar Tarifa' }).click();
    await expect(page.getByText('Tarifa atualizada com sucesso.')).toBeVisible({ timeout: 10_000 });

    const { data: remun } = await supabaseAdmin
      .from('staff_remuneracao').select('tarifa_tipo, tarifa_valor, tarifa_escala_aluno').eq('staff_id', professor1.id).single();
    expect(remun?.tarifa_tipo).toBeNull();
    expect(remun?.tarifa_valor).toBeNull();
    expect(remun?.tarifa_escala_aluno).toBe(false);

    await context.close();
  });

  // --- 3. Tarifa negativa recusada ---
  test('tarifa negativa é recusada no formulário antes de chegar à BD', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await abrirEquipa(page);

    await abrirModalTarifa(page, professor1.id);
    await modalTarifa(page).locator('select').selectOption('fixo');
    await modalTarifa(page).getByPlaceholder('0.00').fill('-5');
    await modalTarifa(page).getByRole('button', { name: 'Guardar Tarifa' }).click();
    await expect(page.getByText('Indica um valor de tarifa válido (não negativo).')).toBeVisible({ timeout: 10_000 });

    const { data: remun } = await supabaseAdmin
      .from('staff_remuneracao').select('tarifa_tipo, tarifa_valor').eq('staff_id', professor1.id).maybeSingle();
    expect(remun?.tarifa_tipo ?? null).toBeNull();
    expect(remun?.tarifa_valor ?? null).toBeNull();

    await context.close();
  });

  test('tarifa negativa é recusada pela BD (check constraint)', async () => {
    const sessao = await sessaoComo(admin);
    const { error } = await sessao
      .from('staff_remuneracao')
      .upsert({ staff_id: professor1.id, centro_id: centroId, tarifa_tipo: 'fixo', tarifa_valor: -1, tarifa_escala_aluno: false }, { onConflict: 'staff_id' });
    expect(error).not.toBeNull();

    const { data: remun } = await supabaseAdmin
      .from('staff_remuneracao').select('tarifa_valor').eq('staff_id', professor1.id).maybeSingle();
    expect(remun?.tarifa_valor ?? null).toBeNull();
  });

  // --- 4. Cálculo: fixo, por hora, por aluno (com cancelamento a tempo), exceção por disciplina ---
  test('cálculo: tarifa fixa (só em staff_remuneracao) dá valor_calculado = tarifa_valor por sessão', async () => {
    await definirTarifaStaff(supabaseAdmin, professorCalc.id, centroId, { tipo: 'fixo', valor: 12 });
    const expId = await criarExplicacaoBase(professorCalc.id, DIA_FIXO, '10:00', [alunoCalcA.id]);
    const valor = await marcarDadoDireto(expId, 1);
    expect(valor).toBe(12);
  });

  test('cálculo: tarifa por hora (só em staff_remuneracao) dá valor_calculado = tarifa_valor × horas_dadas', async () => {
    await definirTarifaStaff(supabaseAdmin, professorCalc.id, centroId, { tipo: 'por_hora', valor: 6 });
    const expId = await criarExplicacaoBase(professorCalc.id, DIA_HORA, '11:00', [alunoCalcA.id]);
    const valor = await marcarDadoDireto(expId, 2.5);
    expect(valor).toBe(15);
  });

  test('cálculo: tarifa por aluno com um aluno cancelado a tempo conta só quem ficou; o professor faz o próprio checkout pela UI', async ({ browser }) => {
    await definirTarifaStaff(supabaseAdmin, professorCalc.id, centroId, { tipo: 'fixo', valor: 10, escalaAluno: true });
    const expId = await criarExplicacaoBase(professorCalc.id, DIA_ESCALA, '12:00', [alunoCalcA.id, alunoCalcB.id]);

    // Cancelamento a tempo do alunoCalcB — gravado diretamente (a janela de
    // antecedência da RPC cancelar_explicacao_aluno já tem cobertura própria
    // em tests/cancelamento-explicacoes-aluno.spec.ts; aqui só interessa o
    // efeito no valor_calculado do professor).
    const { error: errCancelar } = await supabaseAdmin
      .from('explicacoes_alunos')
      .update({ cancelado_em: '2026-09-01T10:00:00.000Z', cancelamento_tardio: false })
      .eq('explicacao_id', expId).eq('aluno_id', alunoCalcB.id);
    expect(errCancelar).toBeNull();

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, professorCalc.email, professorCalc.password);
    await page.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    await irParaSemanaDe(page, DIA_ESCALA);

    const linha = page.locator(`#dia-grupo-${DIA_ESCALA}`).locator('[data-sessao-linha="1"]');
    await expect(linha).toBeVisible({ timeout: 15_000 });
    await linha.click();
    await page.getByRole('button', { name: 'Não' }).click();
    await page.getByPlaceholder('Ex: 1.5').fill('1');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Sessão atualizada')).toBeVisible({ timeout: 10_000 }).catch(() => {});
    await context.close();

    const { data } = await supabaseAdmin.from('explicacoes').select('valor_calculado, dado').eq('id', expId).single();
    expect(data?.dado).toBe(true);
    expect(Number(data?.valor_calculado)).toBe(10); // só o alunoCalcA conta — 10 × 1, não 10 × 2
  });

  test('cálculo: exceção por disciplina continua a ter prioridade sobre staff_remuneracao', async () => {
    const { error: errExcecao } = await supabaseAdmin.from('tarifas_professor_disciplina').insert({
      professor_id: professorCalc.id, disciplina_id: disciplinaCalcId, ano_escolar: null,
      tarifa_tipo: 'fixo', tarifa_valor: 77, tarifa_escala_aluno: false,
    });
    expect(errExcecao).toBeNull();
    limpeza.push(() => supabaseAdmin.from('tarifas_professor_disciplina').delete().eq('professor_id', professorCalc.id).eq('disciplina_id', disciplinaCalcId));

    // staff_remuneracao continua com fixo=10 + escala (do teste anterior) —
    // a exceção tem de vencer, não o fallback.
    const expId = await criarExplicacaoBase(professorCalc.id, DIA_EXCECAO, '13:00', [alunoCalcA.id]);
    const valor = await marcarDadoDireto(expId, 1);
    expect(valor).toBe(77);
  });

  // --- 5. Pagamentos e Performance mostram os mesmos valores ---
  test('Pagamentos (A Pagar) e Performance mostram o mesmo total de remuneração do professorCalc', async ({ browser }) => {
    // 12 (fixo) + 15 (por hora) + 10 (por aluno, 1 de 2) + 77 (exceção) = 114
    const totalEsperado = 114;

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);

    await abrirAPagar(page);
    await irParaMes(page, MES_CALC.ano, MES_CALC.mes);
    await page.waitForTimeout(1000);
    const linhaAPagar = linhaDoProfessor(page, 'Prof Tarifa Calc');
    await expect(linhaAPagar).toContainText(`${totalEsperado.toFixed(2)}€`);

    await abrirPerformance(page);
    await irParaMes(page, MES_CALC.ano, MES_CALC.mes);
    const texto = await page.evaluate(() => document.body.innerText);
    const match = texto.match(/Professores:\s*([\d.,]+)\s*€/i);
    expect(match).toBeTruthy();
    const totalPerformance = Number(match![1].replace(',', '.'));
    expect(totalPerformance).toBeCloseTo(totalEsperado, 2);

    await context.close();
  });

  // --- 6. RLS ---
  test('professor e secretaria não leem nem escrevem staff_remuneracao', async () => {
    for (const conta of [professor1, secretaria]) {
      const sessao = await sessaoComo(conta);
      const { data: lido, error: errLeitura } = await sessao.from('staff_remuneracao').select('staff_id').eq('centro_id', centroId);
      expect(errLeitura).toBeNull();
      expect(lido ?? []).toHaveLength(0);

      const { error: errEscrita } = await sessao
        .from('staff_remuneracao')
        .upsert({ staff_id: professor1.id, centro_id: centroId, tarifa_tipo: 'fixo', tarifa_valor: 1, tarifa_escala_aluno: false }, { onConflict: 'staff_id' });
      expect(errEscrita).not.toBeNull();
    }
  });

  test('admin de outro centro não lê nem escreve staff_remuneracao do ZZTESTE, nem cria linha para um professor que não é do seu centro', async () => {
    const sessao = await sessaoComo(outroAdmin);
    const { data: lido, error: errLeitura } = await sessao.from('staff_remuneracao').select('staff_id').eq('centro_id', centroId);
    expect(errLeitura).toBeNull();
    expect(lido ?? []).toHaveLength(0);

    const { error: errEscritaCentroErrado } = await sessao
      .from('staff_remuneracao')
      .upsert({ staff_id: professor1.id, centro_id: centroId, tarifa_tipo: 'fixo', tarifa_valor: 9, tarifa_escala_aluno: false }, { onConflict: 'staff_id' });
    expect(errEscritaCentroErrado).not.toBeNull();

    // Mesmo gravando com o SEU PRÓPRIO centro_id, o professor não é dele.
    const { error: errEscritaProfErrado } = await sessao
      .from('staff_remuneracao')
      .upsert({ staff_id: professor1.id, centro_id: outroCentroId, tarifa_tipo: 'fixo', tarifa_valor: 9, tarifa_escala_aluno: false }, { onConflict: 'staff_id' });
    expect(errEscritaProfErrado).not.toBeNull();
  });
});
