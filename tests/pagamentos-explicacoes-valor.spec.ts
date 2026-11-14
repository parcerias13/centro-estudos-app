import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Dinheiro das explicações passa a entrar nos totais de Pagamentos (aba
// Mensalidades) e na receita de Performance. Cobre: esperado/pago/em falta
// por aluno via lib/receitaExplicacoes.ts (sessão cancelada não conta),
// marcar/desmarcar pago grava/limpa valor_pago, "Pago, faltam X€" quando
// uma sessão é dada depois de marcar pago, linha antiga sem valor_pago
// conta o esperado atual, aviso de sessões sem preço, aluno "Ambos" sem
// contar duas vezes, Pagamentos e Performance iguais, e navegação entre
// meses. Isolado num centro ZZTESTE próprio, apagado no fim.

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
let admin: { email: string; password: string };
let professorId: string;
let disciplinaId: number;
let context: BrowserContext;
let page: Page;
const limpeza: Array<() => unknown> = [];

type Aluno = { id: string; nome: string };
let alunoDuasSessoes: Aluno;
let alunoMarcarPago: Aluno;
let alunoFaltam: Aluno;
let alunoLegado: Aluno;
let alunoAmbos: Aluno;
let alunoSemPreco: Aluno;
let alunoMesPassado: Aluno;

async function criarUtilizadorAuth(email: string, password: string, appMetadata: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`criar utilizador ${email}: ${error.message}`);
  const id = data.user.id;
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: appMetadata });
  if (metaError) throw new Error(`app_metadata ${email}: ${metaError.message}`);
  return id;
}

async function criarAlunoDireto(nome: string, sufixo: string, anoEscolar: number, extra: Record<string, unknown>) {
  const email = `teste-pagexpv-${sufixo}@example.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-pagexpv-${sufixo}@example.invalid`,
    data_nascimento: '2012-01-01', ano_escolar: anoEscolar, centro_id: centroId, ativo: true,
    sala_estudo: false, faz_explicacoes: true, mensalidade_base: 0,
    ...extra,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return { id, nome };
}

// Mesmo fluxo do app (nasce dado:false, só o UPDATE para dado:true dispara o
// gatilho calcular_valores_explicacao que escreve valor_cobrado_familia a
// partir de precos_explicacoes_familia).
async function criarExplicacaoDada(data: string, hora: string, alunoId: string): Promise<string> {
  const { data: exp, error } = await supabaseAdmin.from('explicacoes').insert({
    centro_id: centroId, professor_id: professorId, disciplina_id: disciplinaId, data, hora_inicio: hora,
    created_by: professorId, dado: false, horas_dadas: null,
  }).select().single();
  if (error) throw new Error(`criar explicacao ${data} ${hora}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('explicacoes_alunos').delete().eq('explicacao_id', exp.id));
  limpeza.push(() => supabaseAdmin.from('explicacoes').delete().eq('id', exp.id));
  const { error: errAlunos } = await supabaseAdmin.from('explicacoes_alunos').insert({ explicacao_id: exp.id, aluno_id: alunoId });
  if (errAlunos) throw new Error(`associar aluno ${exp.id}: ${errAlunos.message}`);

  const { error: errDado } = await supabaseAdmin.from('explicacoes').update({ dado: true, horas_dadas: 1 }).eq('id', exp.id);
  if (errDado) throw new Error(`marcar sessão dada ${exp.id}: ${errDado.message}`);
  return exp.id;
}

// Sessão cancelada ANTES de ser dada (o único caso possível — a própria BD
// tem um constraint que impede dado=true e estado='cancelada' ao mesmo
// tempo, confirmando o comentário em app/admin/explicacoes/page.tsx: "uma
// sessão dada nunca fica cancelada"). Nunca passa por dado:true, por isso o
// gatilho de preço nunca corre — não entra no esperado só por via de
// dado=true nunca ter sido verdade, o que já a exclui mesmo sem o filtro
// estado='ativa' da lib (que existe por desenho, à prova de futuro).
async function criarExplicacaoCancelada(data: string, hora: string, alunoId: string): Promise<string> {
  const { data: exp, error } = await supabaseAdmin.from('explicacoes').insert({
    centro_id: centroId, professor_id: professorId, disciplina_id: disciplinaId, data, hora_inicio: hora,
    created_by: professorId, dado: false, horas_dadas: null, estado: 'cancelada',
  }).select().single();
  if (error) throw new Error(`criar explicacao cancelada ${data} ${hora}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('explicacoes_alunos').delete().eq('explicacao_id', exp.id));
  limpeza.push(() => supabaseAdmin.from('explicacoes').delete().eq('id', exp.id));
  const { error: errAlunos } = await supabaseAdmin.from('explicacoes_alunos').insert({ explicacao_id: exp.id, aluno_id: alunoId });
  if (errAlunos) throw new Error(`associar aluno ${exp.id}: ${errAlunos.message}`);
  return exp.id;
}

async function loginUI(p: Page, identificador: string, password: string) {
  await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="identificador"]', identificador);
  await p.fill('input[type="password"]', password);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

async function abrirPagamentos(p: Page) {
  await p.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' });
  await expect(p.locator('table')).toBeVisible({ timeout: 15_000 });
  await p.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});
}

async function abrirPerformance(p: Page) {
  await p.goto(`${BASE_URL}/admin/performance`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});
}

function mesesAtras(n: number): { ano: number; mes: number } {
  const hoje = new Date();
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - n, 1);
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
}

function dataMesPassado(dia: string): string {
  const alvo = mesesAtras(1);
  return `${alvo.ano}-${String(alvo.mes).padStart(2, '0')}-${dia}`;
}

function linhaDoAluno(p: Page, nome: string) {
  return p.locator('tr', { hasText: nome });
}

// Lê o valor (próximo <p>) de um bloco "Esperado"/"Pago"/"Em Falta" dentro
// de um dos três grupos do resumo (data-testid), nunca pelo texto solto — os
// rótulos repetem-se entre grupos (Explicações e Total usam "Esperado",
// "Pago", "Em Falta" sem o prefixo "Total").
async function lerStatDoGrupo(p: Page, testId: string, rotulo: string): Promise<number> {
  const grupo = p.locator(`[data-testid="${testId}"]`);
  const texto = await grupo.getByText(rotulo, { exact: true }).locator('xpath=following-sibling::p[1]').innerText();
  return Number(texto.replace('€', '').replace('%', '').replace(',', '.').trim());
}

test.describe.configure({ mode: 'serial' });

test.describe('Pagamentos — dinheiro das explicações nos totais (Mensalidades + Explicações + Total)', () => {
  test.beforeAll(async ({ browser }) => {
    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Pagamentos ExplicacoesValor ${SUFIXO}`, email_remetente: `zzteste-pagexpv-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    const email = `zzteste-pagexpv-admin-${SUFIXO}@example.invalid`;
    const password = gerarPasswordSegura();
    const adminId = await criarUtilizadorAuth(email, password, { role: 'admin', centro_id: centroId });
    const { error: staffError } = await supabaseAdmin.from('staff').insert({ id: adminId, email, name: 'ZZTESTE Admin PagExpValor', role: 'admin', centro_id: centroId });
    if (staffError) throw new Error(`criar staff admin: ${staffError.message}`);
    limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', adminId));
    admin = { email, password };

    const emailProfessor = `zzteste-pagexpv-prof-${SUFIXO}@example.invalid`;
    professorId = await criarUtilizadorAuth(emailProfessor, gerarPasswordSegura(), { role: 'professor', centro_id: centroId });
    const { error: profError } = await supabaseAdmin.from('staff').insert({
      id: professorId, email: emailProfessor, name: 'ZZTESTE Professor PagExpValor', role: 'professor', centro_id: centroId,
      tarifa_tipo: 'fixo', tarifa_valor: 10,
    });
    if (profError) throw new Error(`criar staff professor: ${profError.message}`);
    limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', professorId));

    const nomeDisciplina = `Disciplina PagExpValor ${SUFIXO}`;
    const { data: disciplina, error: disciplinaError } = await supabaseAdmin.from('subjects').insert({ name: nomeDisciplina, centro_id: centroId }).select('id').single();
    if (disciplinaError) throw new Error(`criar disciplina: ${disciplinaError.message}`);
    disciplinaId = disciplina.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplinaId));

    // Preço só para o 8.º ano — alunoSemPreco é do 11.º de propósito, para
    // o gatilho não encontrar preço e deixar valor_cobrado_familia nulo.
    const { error: precoError } = await supabaseAdmin.from('precos_explicacoes_familia').insert({
      centro_id: centroId, disciplina_id: disciplinaId, ano_escolar: 8, tipo: 'fixo', valor: 15,
    });
    if (precoError) throw new Error(`criar preço de explicações: ${precoError.message}`);
    limpeza.push(() => supabaseAdmin.from('precos_explicacoes_familia').delete().eq('centro_id', centroId));

    alunoDuasSessoes = await criarAlunoDireto(`PagExpV DuasSessoes ${SUFIXO}`, `${SUFIXO}-duas`, 8, {});
    alunoMarcarPago = await criarAlunoDireto(`PagExpV MarcarPago ${SUFIXO}`, `${SUFIXO}-marcar`, 8, {});
    alunoFaltam = await criarAlunoDireto(`PagExpV Faltam ${SUFIXO}`, `${SUFIXO}-faltam`, 8, {});
    alunoLegado = await criarAlunoDireto(`PagExpV Legado ${SUFIXO}`, `${SUFIXO}-legado`, 8, {});
    alunoAmbos = await criarAlunoDireto(`PagExpV Ambos ${SUFIXO}`, `${SUFIXO}-ambos`, 8, { sala_estudo: true, mensalidade_base: 50 });
    alunoSemPreco = await criarAlunoDireto(`PagExpV SemPreco ${SUFIXO}`, `${SUFIXO}-sempreco`, 11, {});
    alunoMesPassado = await criarAlunoDireto(`PagExpV MesPassado ${SUFIXO}`, `${SUFIXO}-passado`, 8, {});

    const hoje = new Date();
    const dataHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-10`;

    // 2 sessões dadas (15€ cada = 30€) + 1 cancelada (nunca chega a dado=true
    // — não deve contar nem entrar no esperado).
    await criarExplicacaoDada(dataHoje, '14:00', alunoDuasSessoes.id);
    await criarExplicacaoDada(dataHoje, '15:00', alunoDuasSessoes.id);
    await criarExplicacaoCancelada(dataHoje, '16:00', alunoDuasSessoes.id);

    await criarExplicacaoDada(dataHoje, '17:00', alunoMarcarPago.id);
    await criarExplicacaoDada(dataHoje, '14:00', alunoFaltam.id);
    await criarExplicacaoDada(dataHoje, '18:00', alunoLegado.id);
    await criarExplicacaoDada(dataHoje, '19:00', alunoAmbos.id);
    await criarExplicacaoDada(dataHoje, '20:00', alunoSemPreco.id);
    await criarExplicacaoDada(dataMesPassado('05'), '15:00', alunoMesPassado.id);

    // Linha "antiga" (pré-coluna valor_pago): pago=true, valor_pago nunca
    // definido — simulado por update direto porque a UI de hoje já grava
    // sempre valor_pago ao marcar pago.
    const { error: errLegadoSeed } = await supabaseAdmin.from('pagamentos_explicacoes_familia').insert({
      aluno_id: alunoLegado.id, ano: hoje.getFullYear(), mes: hoje.getMonth() + 1, pago: true, valor_pago: null,
      data_pagamento: `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`,
    });
    if (errLegadoSeed) throw new Error(`seed linha legada: ${errLegadoSeed.message}`);

    context = await browser.newContext();
    page = await context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    await loginUI(page, admin.email, admin.password);
    expect(page.url()).toContain('/admin');
  });

  test.afterAll(async () => {
    const { data: alunosParaApagar } = await supabaseAdmin.from('alunos').select('id').eq('centro_id', centroId);
    const idsAlunos = (alunosParaApagar || []).map((a) => a.id);
    if (idsAlunos.length > 0) {
      await supabaseAdmin.from('pagamentos_explicacoes_familia').delete().in('aluno_id', idsAlunos);
    }
    await supabaseAdmin.from('mensalidades').delete().eq('centro_id', centroId);
    for (const id of idsAlunos) {
      await supabaseAdmin.auth.admin.deleteUser(id).catch(() => {});
    }
    await supabaseAdmin.from('alunos').delete().eq('centro_id', centroId);
    await context?.close();
    for (const passo of [...limpeza].reverse()) {
      try {
        const resultado: any = await Promise.resolve(passo());
        if (resultado?.error) console.warn('limpeza: passo com erro (não fatal):', resultado.error.message);
      } catch (err: any) {
        console.warn('limpeza: passo lançou (não fatal):', err?.message);
      }
    }
  });

  test('2 sessões dadas + 1 cancelada: esperado soma só as 2 ativas (30€), cancelada não conta', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoDuasSessoes.nome);
    const linha = linhaDoAluno(page, alunoDuasSessoes.nome);
    await expect(linha).toBeVisible();
    const celulas = linha.locator('td');
    await expect(celulas.nth(9)).toHaveText('30.00€');
  });

  test('marcar pago grava valor_pago (= esperado); desmarcar limpa-o', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoMarcarPago.nome);
    const linha = linhaDoAluno(page, alunoMarcarPago.nome);
    await linha.getByRole('button', { name: /não pago/i }).click();
    await expect(page.getByText(/explicações marcadas como pagas/i)).toBeVisible({ timeout: 10_000 });

    const { data: pagamentoDb } = await supabaseAdmin
      .from('pagamentos_explicacoes_familia')
      .select('pago, valor_pago')
      .eq('aluno_id', alunoMarcarPago.id)
      .single();
    expect(pagamentoDb?.pago).toBe(true);
    expect(Number(pagamentoDb?.valor_pago)).toBeCloseTo(15, 2);

    await linha.getByRole('button', { name: /^pago$/i }).click();
    await expect(page.getByText(/explicações marcadas como não pagas/i)).toBeVisible({ timeout: 10_000 });

    const { data: pagamentoDb2 } = await supabaseAdmin
      .from('pagamentos_explicacoes_familia')
      .select('pago, valor_pago')
      .eq('aluno_id', alunoMarcarPago.id)
      .single();
    expect(pagamentoDb2?.pago).toBe(false);
    expect(pagamentoDb2?.valor_pago).toBeNull();
  });

  test('sessão dada DEPOIS de marcar pago: mostra "Pago, faltam X€" e o Em Falta de Explicações sobe por esse valor', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoFaltam.nome);
    const linha = linhaDoAluno(page, alunoFaltam.nome);
    await linha.getByRole('button', { name: /não pago/i }).click();
    await expect(page.getByText(/explicações marcadas como pagas/i)).toBeVisible({ timeout: 10_000 });

    const emFaltaAntes = await lerStatDoGrupo(page, 'resumo-explicacoes', 'Em Falta');

    const hoje = new Date();
    await criarExplicacaoDada(`${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-11`, '09:00', alunoFaltam.id);

    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoFaltam.nome);
    const linhaDepois = linhaDoAluno(page, alunoFaltam.nome);
    await expect(linhaDepois.getByRole('button', { name: /pago, faltam 15[.,]00€/i })).toBeVisible();

    const emFaltaDepois = await lerStatDoGrupo(page, 'resumo-explicacoes', 'Em Falta');
    expect(emFaltaDepois - emFaltaAntes).toBeCloseTo(15, 2);
  });

  test('linha antiga (sem valor_pago): mostra "Pago" simples e conta o esperado atual', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoLegado.nome);
    const linha = linhaDoAluno(page, alunoLegado.nome);
    await expect(linha.getByRole('button', { name: /^pago$/i })).toBeVisible();
    const celulas = linha.locator('td');
    await expect(celulas.nth(9)).toHaveText('15.00€');
  });

  test('aluno "Ambos": mensalidade e explicações entram nos totais certos, sem contar duas vezes', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill('');
    await page.waitForTimeout(100);

    const esperadoMensalidade = await lerStatDoGrupo(page, 'resumo-mensalidades', 'Total Esperado');
    const esperadoExplicacoes = await lerStatDoGrupo(page, 'resumo-explicacoes', 'Esperado');
    const esperadoTotal = await lerStatDoGrupo(page, 'resumo-total', 'Esperado');
    expect(esperadoTotal).toBeCloseTo(esperadoMensalidade + esperadoExplicacoes, 2);

    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoAmbos.nome);
    const linha = linhaDoAluno(page, alunoAmbos.nome);
    await expect(linha.getByText('Só explicações', { exact: true })).toHaveCount(0);
    await expect(linha.locator('td').nth(1)).toContainText('50.00€'); // mensalidade (pode também mostrar "Em atraso", não é o que este teste cobre)
    await expect(linha.locator('td').nth(9)).toHaveText('15.00€'); // explicações
  });

  test('sessão dada sem preço às famílias: aviso no topo e a sessão não entra no esperado', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill('');
    await expect(page.getByText(/sessão dada sem preço às famílias: não está nos totais/i)).toBeVisible();

    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoSemPreco.nome);
    const linha = linhaDoAluno(page, alunoSemPreco.nome);
    await expect(linha.locator('td').nth(9)).toContainText('0.00€');
    await expect(linha.getByText(/preço não definido/i)).toBeVisible();
  });

  test('totais das Mensalidades (grupo "Mensalidades") são iguais aos de antes — só a mensalidade, nunca explicações', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill('');

    const esperadoMensalidade = await lerStatDoGrupo(page, 'resumo-mensalidades', 'Total Esperado');
    const pagoMensalidade = await lerStatDoGrupo(page, 'resumo-mensalidades', 'Total Pago');

    const hoje = new Date();
    const { data: linhasReais } = await supabaseAdmin
      .from('mensalidades')
      .select('valor_esperado, pago, valor_pago')
      .eq('centro_id', centroId)
      .eq('ano', hoje.getFullYear())
      .eq('mes', hoje.getMonth() + 1);
    const totalEsperadoEsperado = (linhasReais || []).reduce((acc, r: any) => acc + (Number(r.valor_esperado) || 0), 0);
    const totalPagoEsperado = (linhasReais || []).reduce((acc, r: any) => acc + (r.pago ? (Number(r.valor_pago) || 0) : 0), 0);

    expect(esperadoMensalidade).toBeCloseTo(totalEsperadoEsperado, 2);
    expect(pagoMensalidade).toBeCloseTo(totalPagoEsperado, 2);
  });

  test('Performance mostra a mesma receita de Explicações (pago) que Pagamentos, para o mesmo mês', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill('');
    const pagoExplicacoesPagamentos = await lerStatDoGrupo(page, 'resumo-explicacoes', 'Pago');

    await abrirPerformance(page);
    const texto = await page.evaluate(() => document.body.innerText);
    const match = texto.match(/explicações:\s*([\d.]+)\s*€/i);
    expect(match).toBeTruthy();
    const pagoExplicacoesPerformance = Number(match![1]);

    expect(pagoExplicacoesPerformance).toBeCloseTo(pagoExplicacoesPagamentos, 2);
  });

  test('mês passado: explicações desse mês aparecem lá e não no mês atual; mês seguinte volta ao atual', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoMesPassado.nome);
    await expect(page.getByText(/nenhum aluno encontrado para a pesquisa/i)).toBeVisible();

    await page.locator('input[placeholder="Pesquisar aluno..."]').fill('');
    await page.locator('button:has(svg.lucide-chevron-left)').click();
    await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});

    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoMesPassado.nome);
    const linhaPassado = linhaDoAluno(page, alunoMesPassado.nome);
    await expect(linhaPassado).toBeVisible();
    await expect(linhaPassado.getByText('Só explicações', { exact: true })).toBeVisible();

    await page.locator('input[placeholder="Pesquisar aluno..."]').fill('');
    await page.locator('button:has(svg.lucide-chevron-right)').click();
    await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});

    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoMesPassado.nome);
    await expect(page.getByText(/nenhum aluno encontrado para a pesquisa/i)).toBeVisible();
  });

  test('a 390px de largura: painel de resumo legível sem scroll horizontal', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrirPagamentos(page);
    const temScrollHorizontal = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(temScrollHorizontal).toBe(false);
    await page.setViewportSize({ width: 1280, height: 800 });
  });
});
