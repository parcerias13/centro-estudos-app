import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Correção de dinheiro em lib/mensalidades.ts (garantirMesGerado): as linhas
// em falta só são criadas para o MÊS CORRENTE (em Europe/Lisbon, via
// getHojeLisboa() — nunca new Date() local). Um mês passado nunca gera
// nada: devolve só as linhas que já existem, tal e qual, mesmo que haja
// alunos ativos elegíveis sem linha nesse mês. Um mês futuro continua a
// devolver [] sem criar nada. Nunca se altera uma linha já existente
// (valor_esperado/pago/valor_pago ficam intocados), e é idempotente/seguro
// a chamadas concorrentes. Isolado num centro ZZTESTE próprio, apagado no
// fim.

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
let context: BrowserContext;
let page: Page;
const limpeza: Array<() => unknown> = [];

async function loginUI(p: Page, identificador: string, password: string) {
  await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="identificador"]', identificador);
  await p.fill('input[type="password"]', password);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

async function criarAluno(nome: string, mensalidade_base: number | null) {
  const res = await page.request.post(`${BASE_URL}/api/admin/criar-aluno`, {
    data: {
      nome,
      ano_escolar: 8,
      mensalidade_base,
      telefone_encarregado: '912999000',
      email_encarregado: `mae.${Date.now()}.${randomInt(0, 1_000_000)}@example.invalid`,
    },
  });
  const body = await res.json();
  if (!body.alunoId) throw new Error(`criar aluno ${nome}: ${JSON.stringify(body)}`);
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(body.alunoId));
  limpeza.push(() => supabaseAdmin.from('aluno_horarios').delete().eq('aluno_id', body.alunoId));
  limpeza.push(() => supabaseAdmin.from('encarregado_codigos').delete().eq('aluno_id', body.alunoId));
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', body.alunoId));
  return { id: body.alunoId as string, nome };
}

// n meses antes de "hoje" (aritmética simples — mesma usada pelos próprios
// seletores de mês da app, new Date(ano, mes-1, 1)).
function mesesAtras(n: number): { ano: number; mes: number } {
  const hoje = new Date();
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - n, 1);
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
}

function passosAteAoMes(alvo: { ano: number; mes: number }): number {
  const hoje = new Date();
  return (hoje.getFullYear() - alvo.ano) * 12 + (hoje.getMonth() + 1 - alvo.mes);
}

// Cliques rápidos a mais fazem o fetchMes/processStats do mês seguinte
// colidir com o do anterior ainda em voo — o próprio guarda
// isFetchingRef/fetchPendingRef da página ignora esse pedido em vez de o
// repetir mais tarde para o mês certo, e a navegação "salta" meses (visto
// com a resposta de rede: em 6 cliques só chegavam pedidos para 4 meses
// diferentes, nunca para o mês final). Por isso cada clique espera sempre
// pela resposta de rede EXATA do mês a que esse clique leva, nunca por
// "sem spinner visível" (falso positivo quando o pedido ainda nem
// arrancou) nem por networkidle (pode nunca assentar, com ligações
// persistentes).
async function irParaMesPagamentos(p: Page, alvo: { ano: number; mes: number }) {
  await p.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' });
  const passos = passosAteAoMes(alvo);
  for (let i = 1; i <= passos; i++) {
    const intermedio = mesesAtras(i);
    const respostaFinal = p.waitForResponse(
      (r) => r.url().includes('/rest/v1/mensalidades') && r.url().includes(`ano=eq.${intermedio.ano}`) && r.url().includes(`mes=eq.${intermedio.mes}`) && r.url().includes('alunos'),
      { timeout: 15_000 }
    );
    await p.locator('button:has(svg.lucide-chevron-left)').click();
    await respostaFinal;
  }
}

async function irParaMesPerformance(p: Page, alvo: { ano: number; mes: number }) {
  await p.goto(`${BASE_URL}/admin/performance`, { waitUntil: 'networkidle' });
  const passos = passosAteAoMes(alvo);
  for (let i = 1; i <= passos; i++) {
    const intermedio = mesesAtras(i);
    const respostaFinal = p.waitForResponse(
      (r) => r.url().includes('/rest/v1/mensalidades') && r.url().includes(`ano=eq.${intermedio.ano}`) && r.url().includes(`mes=eq.${intermedio.mes}`),
      { timeout: 15_000 }
    );
    await p.getByRole('button', { name: 'Mês anterior' }).click();
    await respostaFinal;
  }
}

async function contarLinhas(alunoId: string, alvo: { ano: number; mes: number }): Promise<number> {
  const { count } = await supabaseAdmin
    .from('mensalidades')
    .select('id', { count: 'exact', head: true })
    .eq('aluno_id', alunoId)
    .eq('ano', alvo.ano)
    .eq('mes', alvo.mes);
  return count ?? 0;
}

async function contarTodasAsLinhasDoMes(alvo: { ano: number; mes: number }): Promise<number> {
  const { count } = await supabaseAdmin
    .from('mensalidades')
    .select('id', { count: 'exact', head: true })
    .eq('centro_id', centroId)
    .eq('ano', alvo.ano)
    .eq('mes', alvo.mes);
  return count ?? 0;
}

test.describe('Geração de mensalidades — só no mês corrente, nunca inventa meses passados', () => {
  test.beforeAll(async ({ browser }) => {
    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Mensalidades Geracao ${SUFIXO}`, email_remetente: `zzteste-mensalidades-geracao-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    const email = `zzteste-mensalidades-geracao-admin-${SUFIXO}@example.invalid`;
    const password = gerarPasswordSegura();
    const { data: userData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
    if (authError) throw new Error(`criar admin: ${authError.message}`);
    const id = userData.user.id;
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
    await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { role: 'admin', centro_id: centroId } });
    const { error: staffError } = await supabaseAdmin.from('staff').insert({ id, email, name: 'ZZTESTE Admin Mensalidades Geração', role: 'admin', centro_id: centroId });
    if (staffError) throw new Error(`criar staff: ${staffError.message}`);
    limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
    admin = { email, password };

    context = await browser.newContext();
    page = await context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    await loginUI(page, admin.email, admin.password);
    expect(page.url()).toContain('/admin');
  });

  test.afterAll(async () => {
    await supabaseAdmin.from('mensalidades').delete().eq('centro_id', centroId);
    const { data: alunosParaApagar } = await supabaseAdmin.from('alunos').select('id').eq('centro_id', centroId);
    for (const a of alunosParaApagar || []) {
      await supabaseAdmin.auth.admin.deleteUser(a.id).catch(() => {});
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

  // Mês corrente: aluno matriculado depois da 1ª abertura ganha linha na
  // abertura seguinte; o aviso só aparece nessa abertura.
  test('mês corrente: aluno criado depois da primeira geração aparece na abertura seguinte; o aviso só aparece nessa abertura', async () => {
    const alvo = mesesAtras(0);
    const alunoA = await criarAluno(`MesAtual A ${SUFIXO}`, 50);

    await irParaMesPagamentos(page, alvo);
    await expect(page.getByText(/foram criadas 1 mensalidade/i)).toBeVisible();
    await expect(page.getByText(alunoA.nome)).toBeVisible();

    const alunoB = await criarAluno(`MesAtual B ${SUFIXO}`, 60);

    await irParaMesPagamentos(page, alvo);
    await expect(page.getByText(/foram criadas 1 mensalidade/i)).toBeVisible();
    await expect(page.getByText(alunoB.nome)).toBeVisible();

    await irParaMesPagamentos(page, alvo);
    await expect(page.getByText(/foram criadas/i)).toHaveCount(0);

    expect(await contarLinhas(alunoA.id, alvo)).toBe(1);
    expect(await contarLinhas(alunoB.id, alvo)).toBe(1);
  });

  // Idempotência e segurança em concorrência — mês corrente, a única onde se gera.
  test('mês corrente: 5 aberturas em paralelo não duplicam linhas nem dão erro', async () => {
    const alvo = mesesAtras(0);
    // Sequencial de propósito: criar contas de Auth em paralelo é uma corrida
    // à parte (não é isto que este teste quer verificar) — a concorrência a
    // testar é a das 5 aberturas de Pagamentos a seguir.
    const alunos = [];
    for (let i = 1; i <= 3; i++) alunos.push(await criarAluno(`Concorrencia ${i} ${SUFIXO}`, 10 * i));

    const paginas = await Promise.all(Array.from({ length: 5 }, () => context.newPage()));
    try {
      await Promise.all(paginas.map((p) => irParaMesPagamentos(p, alvo)));
      for (const p of paginas) {
        await expect(p.getByText(/erro ao carregar mensalidades/i)).toHaveCount(0);
      }
    } finally {
      await Promise.all(paginas.map((p) => p.close()));
    }

    for (const a of alunos) {
      expect(await contarLinhas(a.id, alvo)).toBe(1);
    }
  });

  // Sem mensalidade (0/null) ou inativo: nunca geram linha, mesmo no mês corrente.
  test('mês corrente: aluno sem mensalidade (0 ou nula) e aluno inativo não geram linha', async () => {
    const alvo = mesesAtras(0);
    const alunoZero = await criarAluno(`SemMensalidadeZero ${SUFIXO}`, 0);
    const alunoNulo = await criarAluno(`SemMensalidadeNula ${SUFIXO}`, null);
    const alunoInativo = await criarAluno(`Inativo ${SUFIXO}`, 40);
    const { error: errInativo } = await supabaseAdmin.from('alunos').update({ ativo: false }).eq('id', alunoInativo.id);
    if (errInativo) throw new Error(`marcar inativo: ${errInativo.message}`);

    await irParaMesPagamentos(page, alvo);

    expect(await contarLinhas(alunoZero.id, alvo)).toBe(0);
    expect(await contarLinhas(alunoNulo.id, alvo)).toBe(0);
    expect(await contarLinhas(alunoInativo.id, alvo)).toBe(0);
  });

  // Mês passado sem nenhuma linha: não cria nada (lista vazia), sem aviso.
  test('mês passado sem linhas: não cria nada e não mostra o aviso', async () => {
    const alvo = mesesAtras(2);
    const aluno = await criarAluno(`PassadoVazio ${SUFIXO}`, 90); // elegível, mas o mês é passado

    await irParaMesPagamentos(page, alvo);

    await expect(page.getByText(/foram criadas/i)).toHaveCount(0);
    await expect(page.getByText(/sem alunos ativos para gerar mensalidades neste mês/i)).toBeVisible();
    expect(await contarLinhas(aluno.id, alvo)).toBe(0);
    expect(await contarTodasAsLinhasDoMes(alvo)).toBe(0);
  });

  // Mês passado com linhas já existentes: devolvido tal e qual, sem criar
  // mais nenhuma — mesmo havendo outro aluno ativo elegível sem linha.
  test('mês passado com linhas existentes: devolvido tal e qual, sem criar mais nenhuma', async () => {
    const alvo = mesesAtras(3);
    const aluno = await criarAluno(`PassadoComLinha ${SUFIXO}`, 65);
    const { error: errSeed } = await supabaseAdmin.from('mensalidades').insert({
      centro_id: centroId, aluno_id: aluno.id, ano: alvo.ano, mes: alvo.mes, valor_esperado: 65, pago: true,
      valor_pago: 65, data_pagamento: `${alvo.ano}-${String(alvo.mes).padStart(2, '0')}-05`,
    });
    if (errSeed) throw new Error(`seed: ${errSeed.message}`);

    const outroAluno = await criarAluno(`PassadoSemLinha ${SUFIXO}`, 70); // elegível, sem linha neste mês

    await irParaMesPagamentos(page, alvo);
    await expect(page.getByText(/foram criadas/i)).toHaveCount(0);

    const { data: linha } = await supabaseAdmin
      .from('mensalidades')
      .select('valor_esperado, pago, valor_pago, data_pagamento')
      .eq('aluno_id', aluno.id)
      .eq('ano', alvo.ano)
      .eq('mes', alvo.mes)
      .single();
    expect(Number(linha?.valor_esperado)).toBe(65);
    expect(linha?.pago).toBe(true);
    expect(Number(linha?.valor_pago)).toBe(65);
    expect(linha?.data_pagamento).toBe(`${alvo.ano}-${String(alvo.mes).padStart(2, '0')}-05`);

    expect(await contarLinhas(outroAluno.id, alvo)).toBe(0);
    expect(await contarTodasAsLinhasDoMes(alvo)).toBe(1); // só a que já existia
  });

  // Linha já existente (paga, com valor_pago), no mês corrente, fica intacta.
  test('mês corrente: linha existente (paga, com valor_pago) fica intacta numa segunda abertura', async () => {
    const alvo = mesesAtras(0);
    const aluno = await criarAluno(`Intacta ${SUFIXO}`, 80);

    await irParaMesPagamentos(page, alvo); // gera a linha (valor_esperado=80, pago=false)

    const { data: linha1 } = await supabaseAdmin.from('mensalidades').select('id').eq('aluno_id', aluno.id).eq('ano', alvo.ano).eq('mes', alvo.mes).single();
    expect(linha1).toBeTruthy();
    const { error: errUpdate } = await supabaseAdmin
      .from('mensalidades')
      .update({ pago: true, valor_pago: 55, data_pagamento: '2020-01-01' })
      .eq('id', linha1!.id);
    if (errUpdate) throw new Error(`seed pago: ${errUpdate.message}`);

    await irParaMesPagamentos(page, alvo);

    const { data: linha2 } = await supabaseAdmin
      .from('mensalidades')
      .select('valor_esperado, pago, valor_pago, data_pagamento')
      .eq('id', linha1!.id)
      .single();
    expect(Number(linha2?.valor_esperado)).toBe(80);
    expect(linha2?.pago).toBe(true);
    expect(Number(linha2?.valor_pago)).toBe(55);
    expect(linha2?.data_pagamento).toBe('2020-01-01');
  });

  // Pagamentos e Performance, para o mês corrente, batem certo — comparação
  // contra a verdade da BD (não um número fixo), porque este centro já tem
  // outros alunos/linhas do mês corrente criados pelos testes anteriores.
  test('mês corrente: totais de Pagamentos e Performance coincidem', async () => {
    const alvo = mesesAtras(0);
    const alunoX = await criarAluno(`Totais X ${SUFIXO}`, 45);
    const alunoY = await criarAluno(`Totais Y ${SUFIXO}`, 55);

    await irParaMesPagamentos(page, alvo); // gera as 2 linhas (e quaisquer outras em falta deste mês)

    await supabaseAdmin.from('mensalidades').update({ pago: true, valor_pago: 45 }).eq('aluno_id', alunoX.id).eq('ano', alvo.ano).eq('mes', alvo.mes);
    await supabaseAdmin.from('mensalidades').update({ pago: true, valor_pago: 55 }).eq('aluno_id', alunoY.id).eq('ano', alvo.ano).eq('mes', alvo.mes);

    const { data: todasAsLinhas } = await supabaseAdmin.from('mensalidades').select('valor_pago, pago').eq('centro_id', centroId).eq('ano', alvo.ano).eq('mes', alvo.mes);
    const totalPagoReal = (todasAsLinhas || []).reduce((acc, l: any) => acc + (l.pago ? Number(l.valor_pago) || 0 : 0), 0);

    await irParaMesPagamentos(page, alvo);
    const textoPagamentos = await page.evaluate(() => document.body.innerText);
    const totalPagoPagamentos = Number(textoPagamentos.match(/total pago\s*([\d.]+)\s*€/i)?.[1]);
    expect(totalPagoPagamentos).toBeCloseTo(totalPagoReal, 2);

    await irParaMesPerformance(page, alvo);
    const textoPerformance = await page.evaluate(() => document.body.innerText);
    const receitaReal = Number(textoPerformance.match(/receita real\s*—\s*([\d.]+)\s*€/i)?.[1]);
    // Receita Real = pago de mensalidades + extras (0 neste centro de teste).
    expect(receitaReal).toBeCloseTo(totalPagoReal, 2);
  });

  // Regressão: Pagamentos continua a esconder 0€ por pagar e a mostrar 0€ já
  // pago — num mês passado, onde a nova regra só devolve o que já existe.
  test('mês passado: Pagamentos esconde (sem apagar) linha de 0€ por pagar e mostra linha de 0€ já paga', async () => {
    const alvo = mesesAtras(6);
    const alunoNaoPago = await criarAluno(`ZeroNaoPago ${SUFIXO}`, 30);
    const alunoPago = await criarAluno(`ZeroPago ${SUFIXO}`, 30);

    const { error: err1 } = await supabaseAdmin.from('mensalidades').insert({
      centro_id: centroId, aluno_id: alunoNaoPago.id, ano: alvo.ano, mes: alvo.mes, valor_esperado: 0, pago: false,
    });
    if (err1) throw new Error(`seed não pago: ${err1.message}`);
    const { error: err2 } = await supabaseAdmin.from('mensalidades').insert({
      centro_id: centroId, aluno_id: alunoPago.id, ano: alvo.ano, mes: alvo.mes, valor_esperado: 0, pago: true,
      valor_pago: 0, data_pagamento: `${alvo.ano}-${String(alvo.mes).padStart(2, '0')}-01`,
    });
    if (err2) throw new Error(`seed pago: ${err2.message}`);

    await irParaMesPagamentos(page, alvo);

    await expect(page.getByText(alunoNaoPago.nome)).toHaveCount(0);
    await expect(page.getByText(alunoPago.nome)).toBeVisible();

    expect(await contarTodasAsLinhasDoMes(alvo)).toBe(2); // nada apagado, nada extra gerado (já tinham linha)
  });
});
