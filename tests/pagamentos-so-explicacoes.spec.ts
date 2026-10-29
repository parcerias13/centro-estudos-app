import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Correção de /admin/pagamentos (MensalidadesTab): um aluno "só explicações"
// (mensalidade_base <= 0, nunca ganha linha em `mensalidades`) deixa de ficar
// invisível — a tabela passa a mostrar a UNIÃO das linhas de mensalidade do
// mês com os alunos que têm sessões de explicações nesse mês. Uma linha
// sintética (sem mensalidade) mostra "—" nas colunas de mensalidade,
// desativadas, e a etiqueta roxa "Só explicações" junto ao nome; a coluna
// de Explicações funciona em tudo igual à de qualquer outra linha. Isolado
// num centro ZZTESTE próprio, apagado no fim.

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

let alunoSoExpAtual: { id: string; nome: string };
let alunoSoExpSemSessao: { id: string; nome: string };
let alunoAmbos: { id: string; nome: string };
let alunoInativoComExplicacoes: { id: string; nome: string };
let alunoSoExpPassado: { id: string; nome: string };

async function criarUtilizadorAuth(email: string, password: string, appMetadata: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`criar utilizador ${email}: ${error.message}`);
  const id = data.user.id;
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: appMetadata });
  if (metaError) throw new Error(`app_metadata ${email}: ${metaError.message}`);
  return id;
}

async function criarAlunoDireto(nome: string, sufixo: string, extra: Record<string, unknown>) {
  const email = `teste-pagexp-${sufixo}@example.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-pagexp-${sufixo}@example.invalid`,
    data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centroId, ativo: true,
    sala_estudo: false, faz_explicacoes: true, mensalidade_base: 0,
    ...extra,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return { id, nome };
}

// O trigger calcular_valores_explicacao (na BD) só escreve valor_calculado e
// valor_cobrado_familia quando `dado` passa a true por UPDATE — nunca num
// INSERT que já nasce com dado:true (confirmado contra o fluxo real da UI,
// em app/admin/explicacoes/page.tsx: a sessão nasce com dado:false e só
// depois é atualizada). Por isso aqui também: insere com dado:false,
// associa os alunos, e só então faz o UPDATE que dispara o gatilho.
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

function mesesAtras(n: number): { ano: number; mes: number } {
  const hoje = new Date();
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - n, 1);
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
}

async function irParaMesAnterior(p: Page) {
  const alvo = mesesAtras(1);
  const respostaFinal = p.waitForResponse(
    (r) => r.url().includes('/rest/v1/mensalidades') && r.url().includes(`ano=eq.${alvo.ano}`) && r.url().includes(`mes=eq.${alvo.mes}`) && r.url().includes('alunos'),
    { timeout: 15_000 }
  );
  await p.locator('button:has(svg.lucide-chevron-left)').click();
  await respostaFinal;
  return alvo;
}

function dataMesPassado(dia: string): string {
  const alvo = mesesAtras(1);
  return `${alvo.ano}-${String(alvo.mes).padStart(2, '0')}-${dia}`;
}

function linhaDoAluno(p: Page, nome: string) {
  return p.locator('tr', { hasText: nome });
}

test.describe.configure({ mode: 'serial' });

test.describe('Pagamentos — alunos "só explicações" ficam visíveis e pagáveis', () => {
  test.beforeAll(async ({ browser }) => {
    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Pagamentos SoExplicacoes ${SUFIXO}`, email_remetente: `zzteste-pagexp-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    const email = `zzteste-pagexp-admin-${SUFIXO}@example.invalid`;
    const password = gerarPasswordSegura();
    const adminId = await criarUtilizadorAuth(email, password, { role: 'admin', centro_id: centroId });
    const { error: staffError } = await supabaseAdmin.from('staff').insert({ id: adminId, email, name: 'ZZTESTE Admin Pagamentos SoExplicacoes', role: 'admin', centro_id: centroId });
    if (staffError) throw new Error(`criar staff admin: ${staffError.message}`);
    limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', adminId));
    admin = { email, password };

    const emailProfessor = `zzteste-pagexp-prof-${SUFIXO}@example.invalid`;
    professorId = await criarUtilizadorAuth(emailProfessor, gerarPasswordSegura(), { role: 'professor', centro_id: centroId });
    const { error: profError } = await supabaseAdmin.from('staff').insert({
      id: professorId, email: emailProfessor, name: 'ZZTESTE Professor Pagamentos SoExplicacoes', role: 'professor', centro_id: centroId,
      tarifa_tipo: 'fixo', tarifa_valor: 10,
    });
    if (profError) throw new Error(`criar staff professor: ${profError.message}`);
    limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', professorId));

    const nomeDisciplina = `Disciplina PagExp ${SUFIXO}`;
    const { data: disciplina, error: disciplinaError } = await supabaseAdmin.from('subjects').insert({ name: nomeDisciplina, centro_id: centroId }).select('id').single();
    if (disciplinaError) throw new Error(`criar disciplina: ${disciplinaError.message}`);
    disciplinaId = disciplina.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplinaId));

    const { error: precoError } = await supabaseAdmin.from('precos_explicacoes_familia').insert({
      centro_id: centroId, disciplina_id: disciplinaId, ano_escolar: 8, tipo: 'fixo', valor: 15,
    });
    if (precoError) throw new Error(`criar preço de explicações: ${precoError.message}`);
    limpeza.push(() => supabaseAdmin.from('precos_explicacoes_familia').delete().eq('centro_id', centroId));

    alunoSoExpAtual = await criarAlunoDireto(`PagExp SoExplicacoes Atual ${SUFIXO}`, `${SUFIXO}-atual`, {});
    alunoSoExpSemSessao = await criarAlunoDireto(`PagExp SoExplicacoes SemSessao ${SUFIXO}`, `${SUFIXO}-semsessao`, {});
    alunoAmbos = await criarAlunoDireto(`PagExp Ambos ${SUFIXO}`, `${SUFIXO}-ambos`, { sala_estudo: true, mensalidade_base: 50 });
    alunoInativoComExplicacoes = await criarAlunoDireto(`PagExp Inativo ${SUFIXO}`, `${SUFIXO}-inativo`, { ativo: false });
    alunoSoExpPassado = await criarAlunoDireto(`PagExp SoExplicacoes Passado ${SUFIXO}`, `${SUFIXO}-passado`, {});

    const hoje = new Date();
    const dataHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-10`;

    await criarExplicacaoDada(dataHoje, '15:00', alunoSoExpAtual.id);
    await criarExplicacaoDada(dataHoje, '16:00', alunoAmbos.id);
    await criarExplicacaoDada(dataHoje, '17:00', alunoInativoComExplicacoes.id);
    await criarExplicacaoDada(dataMesPassado('10'), '15:00', alunoSoExpPassado.id);

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

  test('"só explicações" com sessão este mês: aparece com "—", etiqueta roxa e valor certo; pode marcar como pago e persiste ao recarregar', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoSoExpAtual.nome);

    const linha = linhaDoAluno(page, alunoSoExpAtual.nome);
    await expect(linha).toBeVisible();
    await expect(linha.getByText('Só explicações', { exact: true })).toBeVisible();

    const celulas = linha.locator('td');
    await expect(celulas.nth(1)).toHaveText('—'); // Valor Esperado (mensalidade)
    await expect(celulas.nth(2)).toHaveText('—'); // Estado (mensalidade) — não é botão

    // Só um botão (não) pago na linha — o das Explicações. Nenhum controlo
    // de mensalidade (botão/inputs) pode disparar handlers de mensalidades.ts.
    await expect(linha.getByRole('button', { name: /pago|não pago/i })).toHaveCount(1);
    await expect(linha.locator('input[type="number"]')).toBeDisabled();
    await expect(linha.locator('input[type="date"]').first()).toBeDisabled();

    const valorEsperadoExplicacoes = Number(await celulas.nth(5).innerText().then((t) => t.replace('€', '').replace(',', '.').trim()));
    const { data: explicacaoRow } = await supabaseAdmin
      .from('explicacoes_alunos')
      .select('valor_cobrado_familia')
      .eq('aluno_id', alunoSoExpAtual.id)
      .single();
    expect(valorEsperadoExplicacoes).toBeCloseTo(Number(explicacaoRow?.valor_cobrado_familia), 2);

    await linha.getByRole('button', { name: /não pago/i }).click();
    await expect(page.getByText(/explicações marcadas como pagas/i)).toBeVisible({ timeout: 10_000 });
    await expect(linha.getByRole('button', { name: /^pago$/i })).toBeVisible();

    const { data: pagamentoDb } = await supabaseAdmin
      .from('pagamentos_explicacoes_familia')
      .select('pago')
      .eq('aluno_id', alunoSoExpAtual.id)
      .single();
    expect(pagamentoDb?.pago).toBe(true);

    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoSoExpAtual.nome);
    await expect(linhaDoAluno(page, alunoSoExpAtual.nome).getByRole('button', { name: /^pago$/i })).toBeVisible();
  });

  test('"só explicações" com sessão num mês passado: mesmo comportamento', async () => {
    await abrirPagamentos(page);
    await irParaMesAnterior(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoSoExpPassado.nome);

    const linha = linhaDoAluno(page, alunoSoExpPassado.nome);
    await expect(linha).toBeVisible();
    await expect(linha.getByText('Só explicações', { exact: true })).toBeVisible();
    await expect(linha.locator('td').nth(1)).toHaveText('—');
    await expect(linha.locator('td').nth(2)).toHaveText('—');

    await linha.getByRole('button', { name: /não pago/i }).click();
    await expect(page.getByText(/explicações marcadas como pagas/i)).toBeVisible({ timeout: 10_000 });

    const alvo = mesesAtras(1);
    const { data: pagamentoDb } = await supabaseAdmin
      .from('pagamentos_explicacoes_familia')
      .select('pago, ano, mes')
      .eq('aluno_id', alunoSoExpPassado.id)
      .single();
    expect(pagamentoDb?.pago).toBe(true);
    expect(pagamentoDb?.ano).toBe(alvo.ano);
    expect(pagamentoDb?.mes).toBe(alvo.mes);
  });

  test('"só explicações" sem sessões este mês: não aparece', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoSoExpSemSessao.nome);
    await expect(page.getByText(/nenhum aluno encontrado para a pesquisa/i)).toBeVisible();
  });

  test('aluno "ambos" continua a funcionar exatamente como antes', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoAmbos.nome);

    const linha = linhaDoAluno(page, alunoAmbos.nome);
    await expect(linha).toBeVisible();
    await expect(linha.getByText('Só explicações', { exact: true })).toHaveCount(0);
    await expect(linha.locator('td').nth(1)).toHaveText('50.00€');
    await expect(linha.getByRole('button', { name: /pago|não pago/i })).toHaveCount(2);
  });

  test('aluno inativo com explicações este mês: continua a aparecer (a dívida existe)', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoInativoComExplicacoes.nome);
    const linha = linhaDoAluno(page, alunoInativoComExplicacoes.nome);
    await expect(linha).toBeVisible();
    await expect(linha.getByText('Só explicações', { exact: true })).toBeVisible();
  });

  test('totais (Total Esperado, Total Pago, Em Falta, % Cobrança) refletem só a mensalidade, iguais com ou sem as linhas sintéticas', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(''); // tabela completa, com as linhas sintéticas

    const lerTotais = async () => ({
      esperado: await page.getByText('Total Esperado').locator('xpath=following-sibling::p').innerText(),
      pago: await page.getByText('Total Pago').locator('xpath=following-sibling::p').innerText(),
    });
    const comSinteticas = await lerTotais();

    const hoje = new Date();
    const { data: linhasReais } = await supabaseAdmin
      .from('mensalidades')
      .select('valor_esperado, pago, valor_pago')
      .eq('centro_id', centroId)
      .eq('ano', hoje.getFullYear())
      .eq('mes', hoje.getMonth() + 1);
    const totalEsperadoEsperado = (linhasReais || []).reduce((acc, r: any) => acc + (Number(r.valor_esperado) || 0), 0);
    const totalPagoEsperado = (linhasReais || []).reduce((acc, r: any) => acc + (r.pago ? (Number(r.valor_pago) || 0) : 0), 0);

    expect(comSinteticas.esperado).toBe(`${totalEsperadoEsperado.toFixed(2)}€`);
    expect(comSinteticas.pago).toBe(`${totalPagoEsperado.toFixed(2)}€`);
  });

  test('pesquisa por nome encontra as linhas sintéticas (só explicações)', async () => {
    await abrirPagamentos(page);
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill('PagExp SoExplicacoes Atual');
    await expect(linhaDoAluno(page, alunoSoExpAtual.nome)).toBeVisible();
    await expect(page.getByText(/nenhum aluno encontrado/i)).toHaveCount(0);
  });
});
