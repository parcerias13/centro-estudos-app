import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { getHojeLisboa } from '@/lib/dataLisboa';

dotenv.config({ path: '.env.local' });

// Remuneração dos professores: salário implícito por mês (periodos_valor_professor,
// tipo 'salario' cobre o mês ou não), valor por dia de trabalho (tipo 'valor_dia'),
// ajustes em pagamentos_professores, e os gatilhos/RLS que os protegem. Centro
// descartável ZZTESTE (~/Desktop/gestao-centros/novo-centro.mjs), nunca o
// centro real ou o demo. periodos_valor_professor e dias_trabalho_professor
// ainda não constam da lista de tabelas de apagar-centro.mjs — limpas à mão
// no afterAll, antes de chamar o script (mesmo padrão de custos-rls.spec.ts
// para custos_fixos).

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
const NOME_ZZTESTE = `ZZTESTE Remuneracao ${SUFIXO}`;
const ADMIN_EMAIL = `admin-remun-${SUFIXO}@zzteste.invalid`;

type Conta = { email: string; password: string; id: string };

let centroId: string;
let outroCentroId: string;
let admin: Conta;
let outroAdmin: Conta;
let outroProfessor: Conta;
let profSalario: Conta;
let profVariavel: Conta;
let disciplinaId: number;
let alunoId: string;

// Páginas partilhadas e já autenticadas — uma vez no beforeAll, reutilizadas
// em todos os testes de UI (mesmo padrão de tests/pagamentos-so-explicacoes.spec.ts).
let context: BrowserContext;
let page: Page; // admin
let contextProf: BrowserContext;
let pageProf: Page; // Prof Salario
let contextProfVariavel: BrowserContext;
let pageProfVariavel: Page; // Prof Variavel

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

async function criarExplicacaoDada(professorId: string, data: string, hora: string): Promise<string> {
  const { data: exp, error } = await supabaseAdmin
    .from('explicacoes')
    .insert({
      centro_id: centroId, professor_id: professorId, disciplina_id: disciplinaId, data, hora_inicio: hora,
      created_by: professorId, dado: false, horas_dadas: null,
    })
    .select()
    .single();
  if (error) throw new Error(`criar explicacao ${data} ${hora}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('explicacoes_alunos').delete().eq('explicacao_id', exp.id));
  limpeza.push(() => supabaseAdmin.from('explicacoes').delete().eq('id', exp.id));
  const { error: errAlunos } = await supabaseAdmin.from('explicacoes_alunos').insert({ explicacao_id: exp.id, aluno_id: alunoId });
  if (errAlunos) throw new Error(`associar aluno ${exp.id}: ${errAlunos.message}`);
  const { error: errDado } = await supabaseAdmin.from('explicacoes').update({ dado: true, horas_dadas: 1 }).eq('id', exp.id);
  if (errDado) throw new Error(`marcar sessão dada ${exp.id}: ${errDado.message}`);
  return exp.id;
}

function mesAtualReal(): { ano: number; mes: number } {
  const d = new Date();
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
}

// Navega a página de Pagamentos/Performance pelo nº de cliques certo a
// partir do mês atualmente exibido — nunca assume o ponto de partida, lê-o
// do estado que o próprio teste já está a seguir.
async function irParaMes(page: Page, estadoAtual: { ano: number; mes: number }, anoAlvo: number, mesAlvo: number, labels: { anterior: string; seguinte: string } | null = null) {
  const delta = (anoAlvo - estadoAtual.ano) * 12 + (mesAlvo - estadoAtual.mes);
  const seletor = labels
    ? page.getByLabel(delta < 0 ? labels.anterior : labels.seguinte)
    : page.locator(`button:has(svg.lucide-chevron-${delta < 0 ? 'left' : 'right'})`).first();
  for (let i = 0; i < Math.abs(delta); i++) {
    await seletor.click();
    await page.waitForTimeout(150);
    await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 10_000 }).catch(() => {});
  }
  estadoAtual.ano = anoAlvo;
  estadoAtual.mes = mesAlvo;
}

async function abrirAPagar(page: Page) {
  await page.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'A Pagar', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});
}

async function abrirPerformance(page: Page) {
  await page.goto(`${BASE_URL}/admin/performance`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});
}

function linhaDoProfessor(page: Page, nome: string) {
  return page.locator('tr', { hasText: nome });
}

test.describe.configure({ mode: 'serial' });

test.describe('Remuneração dos professores — centro descartável ZZTESTE', () => {
  test.beforeAll(async ({ browser }) => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE Remuneracao'],
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

    profSalario = await criarStaff('professor', 'Prof Salario', centroId);
    profVariavel = await criarStaff('professor', 'Prof Variavel', centroId, { tarifa_tipo: 'fixo', tarifa_valor: 20 });

    const { data: disciplina, error: errDisciplina } = await supabaseAdmin
      .from('subjects')
      .insert({ name: `Disciplina ZZTESTE ${SUFIXO}`, centro_id: centroId })
      .select('id')
      .single();
    if (errDisciplina) throw new Error(`criar disciplina: ${errDisciplina.message}`);
    disciplinaId = disciplina.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplinaId));

    const alunoEmail = `aluno-remun-${SUFIXO}@zzteste.invalid`;
    const alunoAuthId = await criarUtilizadorAuth(alunoEmail, gerarPasswordSegura(), { centro_id: centroId });
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(alunoAuthId));
    const { error: errAluno } = await supabaseAdmin.from('alunos').insert({
      id: alunoAuthId, nome: 'Aluno ZZTESTE Remuneracao', email: alunoEmail, email_encarregado: `enc-remun-${SUFIXO}@zzteste.invalid`,
      data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centroId, ativo: true, sala_estudo: false, faz_explicacoes: true, mensalidade_base: 0,
    });
    if (errAluno) throw new Error(`criar aluno: ${errAluno.message}`);
    alunoId = alunoAuthId;
    limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', alunoId));

    // --- outro centro, só para os testes de isolamento ---
    const { data: outroCentro, error: outroCentroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Remuneracao Outro ${SUFIXO}`, email_remetente: `zzteste-remun-outro-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (outroCentroError) throw new Error(`criar outro centro: ${outroCentroError.message}`);
    outroCentroId = outroCentro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', outroCentroId));
    outroAdmin = await criarStaff('admin', 'Outro Admin', outroCentroId);
    outroProfessor = await criarStaff('professor', 'Outro Professor', outroCentroId);

    context = await browser.newContext();
    page = await context.newPage();
    await loginUI(page, admin.email, admin.password);

    contextProf = await browser.newContext();
    pageProf = await contextProf.newPage();
    await loginUI(pageProf, profSalario.email, profSalario.password);

    contextProfVariavel = await browser.newContext();
    pageProfVariavel = await contextProfVariavel.newPage();
    await loginUI(pageProfVariavel, profVariavel.email, profVariavel.password);
  });

  test.afterAll(async () => {
    await context?.close();
    await contextProf?.close();
    await contextProfVariavel?.close();

    if (centroId) {
      await supabaseAdmin.from('periodos_valor_professor').delete().eq('centro_id', centroId);
      await supabaseAdmin.from('dias_trabalho_professor').delete().eq('centro_id', centroId);
    }
    if (outroCentroId) {
      await supabaseAdmin.from('periodos_valor_professor').delete().eq('centro_id', outroCentroId);
      await supabaseAdmin.from('dias_trabalho_professor').delete().eq('centro_id', outroCentroId);
    }

    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }

    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }

    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    const { data: restoStaff } = await supabaseAdmin.from('staff').select('id').eq('centro_id', centroId);
    const { data: restoPeriodos } = await supabaseAdmin.from('periodos_valor_professor').select('id').eq('centro_id', centroId);
    const { data: restoDias } = await supabaseAdmin.from('dias_trabalho_professor').select('id').eq('centro_id', centroId);
    const { data: restoOutroCentro } = await supabaseAdmin.from('config_centro').select('id').eq('id', outroCentroId);
    expect(restoConfig ?? []).toHaveLength(0);
    expect(restoStaff ?? []).toHaveLength(0);
    expect(restoPeriodos ?? []).toHaveLength(0);
    expect(restoDias ?? []).toHaveLength(0);
    expect(restoOutroCentro ?? []).toHaveLength(0);
  });

  // --- Cenário 1: salário muda a meio do ano, o mês anterior mantém o valor antigo ---
  test('definir_periodo_professor: salário de Jan/2026 (1000), depois 1200 a partir de Jun/2026 — Jan-Mai mantêm 1000', async () => {
    const sessao = await sessaoComo(admin);
    let r = await sessao.rpc('definir_periodo_professor', { p_professor: profSalario.id, p_tipo: 'salario', p_de: '2026-01-01', p_valor: 1000 });
    expect(r.error).toBeNull();
    r = await sessao.rpc('definir_periodo_professor', { p_professor: profSalario.id, p_tipo: 'salario', p_de: '2026-06-01', p_valor: 1200 });
    expect(r.error).toBeNull();

    const { data: periodos } = await supabaseAdmin
      .from('periodos_valor_professor')
      .select('de, ate, valor')
      .eq('professor_id', profSalario.id)
      .eq('tipo', 'salario')
      .order('de');
    expect(periodos).toHaveLength(2);
    expect(Number(periodos![0].valor)).toBe(1000);
    expect(periodos![0].ate).toBe('2026-05-01');
    expect(Number(periodos![1].valor)).toBe(1200);
    expect(periodos![1].ate).toBeNull();
  });

  test('definir_periodo_professor: valor por dia de Prof Variavel, 10€/dia desde Jan/2026', async () => {
    const sessao = await sessaoComo(admin);
    const { error } = await sessao.rpc('definir_periodo_professor', { p_professor: profVariavel.id, p_tipo: 'valor_dia', p_de: '2026-01-01', p_valor: 10 });
    expect(error).toBeNull();
  });

  // --- Cenário 3 (parte 1 — dados): Prof Salario dá uma sessão em Mar/2026 sem ter tarifa nenhuma ---
  test('Prof Salario dá uma sessão em Mar/2026 sem tarifa definida', async () => {
    await criarExplicacaoDada(profSalario.id, '2026-03-10', '10:00');
  });

  // --- Cenários 2 e 4 (dados): Prof Variavel com 2 sessões e 1.5 dias em Mar/2026 ---
  test('Prof Variavel dá 2 sessões (20€ cada) e tem 1.5 dias de trabalho em Mar/2026', async () => {
    await criarExplicacaoDada(profVariavel.id, '2026-03-05', '10:00');
    await criarExplicacaoDada(profVariavel.id, '2026-03-12', '10:00');

    const sessaoAdmin = await sessaoComo(admin);
    let r = await sessaoAdmin
      .from('dias_trabalho_professor')
      .upsert({ centro_id: centroId, professor_id: profVariavel.id, data: '2026-03-06', fracao: 1 }, { onConflict: 'professor_id,data' });
    expect(r.error).toBeNull();
    r = await sessaoAdmin
      .from('dias_trabalho_professor')
      .upsert({ centro_id: centroId, professor_id: profVariavel.id, data: '2026-03-13', fracao: 0.5 }, { onConflict: 'professor_id,data' });
    expect(r.error).toBeNull();
  });

  // --- Cenário 5 (dados): ajuste negativo em Mar/2026 (não fica negativo) e maior em Jul/2026 (fica negativo) ---
  // Jul/2026 está dentro do período de 1200€ (desde Jun/2026) — serve também
  // para confirmar, na mesma verificação de UI, que o salário já subiu.
  test('Ajuste negativo em Mar/2026 e ajuste maior em Jul/2026', async () => {
    const sessaoAdmin = await sessaoComo(admin);
    let r = await sessaoAdmin.from('pagamentos_professores').upsert(
      { centro_id: centroId, professor_id: profVariavel.id, ano: 2026, mes: 3, ajuste_valor: -10, ajuste_nota: 'falta não justificada' },
      { onConflict: 'professor_id,ano,mes' }
    );
    expect(r.error).toBeNull();

    r = await sessaoAdmin.from('pagamentos_professores').upsert(
      { centro_id: centroId, professor_id: profVariavel.id, ano: 2026, mes: 7, ajuste_valor: -200, ajuste_nota: 'adiantamento a corrigir' },
      { onConflict: 'professor_id,ano,mes' }
    );
    expect(r.error).toBeNull();
  });

  test('ajuste diferente de zero sem nota é recusado pela base de dados', async () => {
    const sessaoAdmin = await sessaoComo(admin);
    const { error } = await sessaoAdmin.from('pagamentos_professores').upsert(
      { centro_id: centroId, professor_id: profVariavel.id, ano: 2026, mes: 5, ajuste_valor: -5, ajuste_nota: null },
      { onConflict: 'professor_id,ano,mes' }
    );
    expect(error).not.toBeNull();
  });

  // --- UI: A Pagar de Mar/2026 ---
  test('UI — A Pagar de Mar/2026: Prof Salario sem aviso de tarifa e sem somar a sessão; Prof Variavel com sessões+dias+ajuste', async () => {
    const estado = mesAtualReal();
    await abrirAPagar(page);
    await irParaMes(page, estado, 2026, 3);

    const linhaSalario = linhaDoProfessor(page, 'Prof Salario');
    await expect(linhaSalario).toContainText('Salário');
    await expect(linhaSalario).not.toContainText('Tarifa não definida');
    await expect(linhaSalario).toContainText('1000.00€'); // só o salário — a sessão sem tarifa não entra

    const linhaVariavel = linhaDoProfessor(page, 'Prof Variavel');
    await expect(linhaVariavel).toContainText('Variável');
    // 2 sessões x 20€ = 40 + 1.5 dias x 10€ = 15 - ajuste 10 = 45
    await expect(linhaVariavel).toContainText('45.00€');

    await linhaVariavel.locator('button').first().click();
    await expect(page.getByText('falta não justificada')).toBeVisible();
  });

  // --- Cenário 10 + 5: A Pagar de Jul/2026 ---
  test('UI — A Pagar de Jul/2026: Prof Salario aparece com 1200€ mesmo sem sessões; Prof Variavel fica negativo e avisa', async () => {
    const estado = mesAtualReal();
    await abrirAPagar(page);
    await irParaMes(page, estado, 2026, 7);

    const linhaSalario = linhaDoProfessor(page, 'Prof Salario');
    await expect(linhaSalario).toContainText('Salário');
    await expect(linhaSalario).toContainText('1200.00€');

    const linhaVariavel = linhaDoProfessor(page, 'Prof Variavel');
    await expect(linhaVariavel).toContainText('-200.00€');
    await expect(linhaVariavel).toContainText('Total negativo');
  });

  // --- Cenário 9 (mês antes de qualquer período começar): Dez/2025 ---
  test('UI — A Pagar de Dez/2025: nenhum dos dois professores aparece (período ainda não começou, sem sessões)', async () => {
    const estado = mesAtualReal();
    await abrirAPagar(page);
    await irParaMes(page, estado, 2025, 12);
    await expect(linhaDoProfessor(page, 'Prof Salario')).toHaveCount(0);
    await expect(linhaDoProfessor(page, 'Prof Variavel')).toHaveCount(0);
  });

  // --- Cenário 8: Performance de Jul/2026 ---
  test('UI — Performance de Jul/2026: inclui o salário sem sessões, sem duplicar, sem aviso de integridade', async () => {
    const estado = mesAtualReal();
    await abrirPerformance(page);
    await irParaMes(page, estado, 2026, 7, { anterior: 'Mês anterior', seguinte: 'Mês seguinte' });
    // 1200 (salário, sem sessões) + (-200) (ajuste do variável, sem sessões/dias esse mês) = 1000
    await expect(page.getByText('Professores: 1000.00€', { exact: false })).toBeVisible();
    await expect(page.getByText('Soma não bate com o total')).toHaveCount(0);
  });

  // --- Cenário 11: Prof Variavel passa a salário a partir de Set/2026 ---
  test('Prof Variavel passa a salário (900€) a partir de Set/2026', async () => {
    const sessao = await sessaoComo(admin);
    let r = await sessao.rpc('terminar_periodo_professor', { p_professor: profVariavel.id, p_tipo: 'valor_dia', p_a_partir_de: '2026-09-01' });
    expect(r.error).toBeNull();
    r = await sessao.rpc('definir_periodo_professor', { p_professor: profVariavel.id, p_tipo: 'salario', p_de: '2026-09-01', p_valor: 900 });
    expect(r.error).toBeNull();
  });

  test('UI — Mar/2026 de Prof Variavel continua igual depois da mudança de tipo em Set/2026', async () => {
    const estado = mesAtualReal();
    await abrirAPagar(page);
    await irParaMes(page, estado, 2026, 3);
    const linha = linhaDoProfessor(page, 'Prof Variavel');
    await expect(linha).toContainText('Variável');
    await expect(linha).toContainText('45.00€');
  });

  test('UI — Set/2026 de Prof Variavel já mostra Salário, 900€', async () => {
    const estado = mesAtualReal();
    await abrirAPagar(page);
    await irParaMes(page, estado, 2026, 9);
    const linha = linhaDoProfessor(page, 'Prof Variavel');
    await expect(linha).toContainText('Salário');
    await expect(linha).toContainText('900.00€');
  });

  // --- Prof Salario termina o salário em Set/2026 — por Out/2026 (mês real) volta a ser variável ---
  test('Prof Salario termina o salário a partir de Set/2026 (fica variável outra vez a partir daí)', async () => {
    const sessao = await sessaoComo(admin);
    const { error } = await sessao.rpc('terminar_periodo_professor', { p_professor: profSalario.id, p_tipo: 'salario', p_a_partir_de: '2026-09-01' });
    expect(error).toBeNull();
  });

  // --- Cenário 7: isolamento ---
  test('isolamento: outro admin não altera nem lê períodos deste centro; um professor não lê/escreve períodos e só marca os seus próprios dias, hoje ou ontem', async () => {
    const sessaoOutroAdmin = await sessaoComo(outroAdmin);
    let { error } = await sessaoOutroAdmin.rpc('definir_periodo_professor', { p_professor: profSalario.id, p_tipo: 'salario', p_de: '2030-01-01', p_valor: 1 });
    expect(error).not.toBeNull();

    const { data: lidoOutro } = await sessaoOutroAdmin.from('periodos_valor_professor').select('id').eq('professor_id', profSalario.id);
    expect(lidoOutro ?? []).toHaveLength(0);

    const sessaoProfVariavel = await sessaoComo(profVariavel);
    const { data: lidoProf, error: errLerProf } = await sessaoProfVariavel.from('periodos_valor_professor').select('id');
    expect(errLerProf).toBeNull();
    expect(lidoProf ?? []).toHaveLength(0);

    const { error: errEscritaProf } = await sessaoProfVariavel.rpc('definir_periodo_professor', { p_professor: profVariavel.id, p_tipo: 'salario', p_de: '2030-01-01', p_valor: 1 });
    expect(errEscritaProf).not.toBeNull();

    // profVariavel tenta marcar um dia de OUTRO professor do mesmo centro
    const { error: errDiaOutroProf } = await sessaoProfVariavel
      .from('dias_trabalho_professor')
      .insert({ centro_id: centroId, professor_id: profSalario.id, data: getHojeLisboa(), fracao: 1 });
    expect(errDiaOutroProf).not.toBeNull();

    // professor de OUTRO centro tenta marcar um dia de Prof Variavel
    const sessaoOutroProf = await sessaoComo(outroProfessor);
    const { error: errDiaOutroCentro } = await sessaoOutroProf
      .from('dias_trabalho_professor')
      .insert({ centro_id: centroId, professor_id: profVariavel.id, data: getHojeLisboa(), fracao: 1 });
    expect(errDiaOutroCentro).not.toBeNull();

    // profVariavel tenta marcar uma data que não é hoje nem ontem
    const { error: errDataAntiga } = await sessaoProfVariavel
      .from('dias_trabalho_professor')
      .insert({ centro_id: centroId, professor_id: profVariavel.id, data: '2026-01-15', fracao: 1 });
    expect(errDataAntiga).not.toBeNull();
  });

  // --- Cenário 6: mês pago bloqueia marcar/alterar/apagar dias, para admin E para o professor; desmarcar pago destranca ---
  test('mês pago bloqueia dias — admin e professor (sessão real); desmarcar o pago volta a permitir', async () => {
    const hojeISO = getHojeLisboa();
    const [anoAtualStr, mesAtualStr] = hojeISO.split('-');
    const anoAtual = Number(anoAtualStr);
    const mesAtual = Number(mesAtualStr);

    const sessaoAdmin = await sessaoComo(admin);
    let r = await sessaoAdmin.from('pagamentos_professores').upsert(
      { centro_id: centroId, professor_id: profSalario.id, ano: anoAtual, mes: mesAtual, pago: true, data_pagamento: hojeISO },
      { onConflict: 'professor_id,ano,mes' }
    );
    expect(r.error).toBeNull();

    const { error: errAdminBloqueado } = await sessaoAdmin
      .from('dias_trabalho_professor')
      .upsert({ centro_id: centroId, professor_id: profSalario.id, data: hojeISO, fracao: 1 }, { onConflict: 'professor_id,data' });
    expect(errAdminBloqueado).not.toBeNull();

    const sessaoProf = await sessaoComo(profSalario);
    const { error: errProfBloqueado } = await sessaoProf
      .from('dias_trabalho_professor')
      .upsert({ centro_id: centroId, professor_id: profSalario.id, data: hojeISO, fracao: 1 }, { onConflict: 'professor_id,data' });
    expect(errProfBloqueado).not.toBeNull();

    r = await sessaoAdmin
      .from('pagamentos_professores')
      .update({ pago: false })
      .eq('centro_id', centroId)
      .eq('professor_id', profSalario.id)
      .eq('ano', anoAtual)
      .eq('mes', mesAtual);
    expect(r.error).toBeNull();

    const { error: errDepoisDeDespagar } = await sessaoProf
      .from('dias_trabalho_professor')
      .upsert({ centro_id: centroId, professor_id: profSalario.id, data: hojeISO, fracao: 1 }, { onConflict: 'professor_id,data' });
    expect(errDepoisDeDespagar).toBeNull();

    // limpa o dia de hoje para não interferir com o teste de UI seguinte
    await supabaseAdmin.from('dias_trabalho_professor').delete().eq('professor_id', profSalario.id).eq('data', hojeISO);
  });

  // --- Cenário 12: a vista do professor nunca mostra euros ---
  test('UI — professor marca "Trabalhei hoje" e nunca vê nenhum valor em euros', async () => {
    await pageProf.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });

    const bloco = pageProf.getByTestId('meus-dias-trabalho');
    await expect(bloco).toBeVisible();
    await expect(bloco).not.toContainText('€');

    await bloco.getByRole('button', { name: 'Dia Inteiro' }).first().click();
    await pageProf.waitForTimeout(500);
    await expect(bloco).not.toContainText('€');
    await expect(bloco).toContainText('Dia inteiro');

    const { data: diaCriado } = await supabaseAdmin
      .from('dias_trabalho_professor')
      .select('fracao, marcado_por')
      .eq('professor_id', profSalario.id)
      .eq('data', getHojeLisboa())
      .maybeSingle();
    expect(diaCriado).not.toBeNull();
    expect(Number(diaCriado!.fracao)).toBe(1);
    expect(diaCriado!.marcado_por).toBe(profSalario.id);
  });

  // --- sou_salario_no_mes (RPC): esconder "Trabalhei Hoje"/"Os Meus Dias" e
  // "Último valor calculado" só para quem É de salário no mês corrente —
  // Prof Variavel passou a salário em Set/2026 (teste acima), por isso no
  // mês real de hoje já é de salário: cobre ao mesmo tempo o cenário "vê
  // escondido" e o cenário "muda a meio do ano, reflete o mês corrente".
  // Prof Salario terminou o salário em Set/2026 (teste acima), por isso no
  // mês real de hoje voltou a variável: cobre o cenário "variável vê ambos".
  test('UI — sou_salario_no_mes: Prof Variavel (salário desde Set/2026, logo de salário no mês atual) não vê "Trabalhei Hoje" nem "Último valor calculado"', async () => {
    const hojeISO = getHojeLisboa();
    await criarExplicacaoDada(profVariavel.id, hojeISO, '11:00');

    await pageProfVariavel.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    await expect(pageProfVariavel.getByTestId('meus-dias-trabalho')).toHaveCount(0);

    await pageProfVariavel.locator('[data-sessao-linha="1"]').first().click();
    await expect(pageProfVariavel.getByText('Último valor calculado', { exact: false })).toHaveCount(0);
  });

  test('UI — sou_salario_no_mes: Prof Salario (variável desde Set/2026) continua a ver "Trabalhei Hoje" e o "Último valor calculado"', async () => {
    const { error: errTarifa } = await supabaseAdmin
      .from('staff')
      .update({ tarifa_tipo: 'fixo', tarifa_valor: 15 })
      .eq('id', profSalario.id);
    expect(errTarifa).toBeNull();

    const hojeISO = getHojeLisboa();
    await criarExplicacaoDada(profSalario.id, hojeISO, '12:00');

    await pageProf.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    await expect(pageProf.getByTestId('meus-dias-trabalho')).toBeVisible();

    await pageProf.locator('[data-sessao-linha="1"]').first().click();
    await expect(pageProf.getByText('Último valor calculado', { exact: false })).toBeVisible();
  });

  // --- Fumo (não é um dos 12 cenários pedidos, mas são ecrãs novos): Equipa
  // e o calendário do admin abrem sem rebentar, e o modal de remuneração
  // mostra o período de salário com o histórico das duas alterações. ---
  test('UI — Equipa: modal de Remuneração mostra o histórico de salário de Prof Salario', async () => {
    await page.goto(`${BASE_URL}/admin/equipa`, { waitUntil: 'networkidle' });
    await page.getByTestId(`membro-${profSalario.id}`).getByRole('button', { name: 'Remuneração' }).click();
    await expect(page.getByText('Remuneração de Prof Salario')).toBeVisible();
    await page.getByRole('button', { name: 'Salário Mensal' }).click();
    await expect(page.getByText('1000.00€', { exact: false })).toBeVisible();
    await expect(page.getByText('1200.00€', { exact: false })).toBeVisible();
  });

  test('UI — Dias de Trabalho (admin): abre sem rebentar e mostra o calendário', async () => {
    await page.goto(`${BASE_URL}/admin/equipa/dias-trabalho`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Dias de Trabalho')).toBeVisible();
    await expect(page.getByText('Soma do mês', { exact: false })).toBeVisible();
  });
});
