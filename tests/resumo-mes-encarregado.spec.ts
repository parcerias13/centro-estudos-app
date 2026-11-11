import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Cartão "Resumo do Mês" da Área dos Encarregados (app/encarregados/page.tsx),
// agora alimentado por resumo_mes_encarregado/meses_resumo_encarregado (RPCs
// já aplicadas na base de dados — este ficheiro só testa a app por cima
// delas, nunca reimplementa o cálculo). Cobre também a remoção do Relatório
// Mensal (rota e item de menu desaparecidos, mensagens antigas do tipo
// continuam a mostrar-se). Centro descartável ZZTESTE via
// ~/Desktop/gestao-centros/novo-centro.mjs — nunca o centro real ("Trupe
// Lias") nem o Demo.

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

// "Hoje" em Europe/Lisbon, calculado uma vez no arranque do processo de
// testes — nunca new Date() local, que pode discordar do fuso do servidor.
function hojeLisboaISO(): string {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const obter = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${obter('year')}-${obter('month')}-${obter('day')}`;
}

/** Aritmética pura de ano/mês (sem Date, sem fuso) — nunca escorrega de mês por causa de dias-do-mês diferentes. */
function subtrairMeses(ano: number, mes: number, n: number): { ano: number; mes: number } {
  const total = ano * 12 + (mes - 1) - n;
  return { ano: Math.floor(total / 12), mes: (((total % 12) + 12) % 12) + 1 };
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }
function dataISO(ano: number, mes: number, dia: number): string { return `${ano}-${pad2(mes)}-${pad2(dia)}`; }

/** Mesma função do cartão (app/encarregados/page.tsx) — replicada aqui só para construir a asserção, nunca para decidir o que preparar. */
function nomeMesPorExtenso(ano: number, mes: number): string {
  return new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric' }).format(new Date(ano, mes - 1, 1));
}

function diaDaSemanaPorExtenso(dataISOStr: string): string {
  const data = new Date(`${dataISOStr}T00:00:00`);
  return new Intl.DateTimeFormat('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' }).format(data);
}

const [ANO_HOJE, MES_HOJE] = hojeLisboaISO().split('-').map(Number);
const MES_ALVO = subtrairMeses(ANO_HOJE, MES_HOJE, 2);
const MES_SEM_MENSALIDADE = subtrairMeses(ANO_HOJE, MES_HOJE, 3);

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE ResumoMes ${SUFIXO}`;
const ADMIN_EMAIL = `admin-resmes-${SUFIXO}@zzteste.invalid`;
const CODIGO_PRINCIPAL = '1234';

type Conta = { email: string; password: string; id: string; nome?: string };

let centroId: string;
let admin: Conta;
let secretaria: Conta;
let professor: Conta;
let disciplinaId: number;
let servicoLancheId: string;
let servicoTransporteId: string;

let alunoPrincipal: Conta;
let alunoParceiro: Conta;
let alunoOutro: Conta;

const NOME_LANCHE = `Lanche ZZ ${SUFIXO}`;
const NOME_TRANSPORTE = `Transporte ZZ ${SUFIXO}`;
const DISCIPLINA_NOME = `Disciplina ResMes ${SUFIXO}`;

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
  const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: nome, role: papel, centro_id: centroId });
  if (error) throw new Error(`criar staff ${nome}: ${error.message}`);
  return { email, password, id, nome };
}

async function criarAluno(nome: string, mensalidadeBase: number): Promise<Conta> {
  const email = `${nome.toLowerCase().replace(/\s+/g, '-')}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-${email}`,
    data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centroId,
    ativo: true, sala_estudo: false, faz_explicacoes: true, mensalidade_base: mensalidadeBase,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  return { email, password, id, nome };
}

async function criarDisciplina(name: string): Promise<number> {
  const { data, error } = await supabaseAdmin.from('subjects').insert({ name, centro_id: centroId }).select('id').single();
  if (error) throw new Error(`criar disciplina ${name}: ${error.message}`);
  return data.id;
}

async function criarServico(nome: string, preco: number): Promise<string> {
  const { data, error } = await supabaseAdmin.from('servicos').insert({ nome, preco, centro_id: centroId }).select('id').single();
  if (error) throw new Error(`criar servico ${nome}: ${error.message}`);
  return data.id;
}

async function criarExplicacao(opts: {
  professorId: string; data: string; horaInicio: string; dado: boolean; estado?: string;
  alunos: Array<{ id: string; valor: number | null; cancelamentoTardio?: boolean; cancelado?: boolean }>;
}): Promise<string> {
  const { data: row, error } = await supabaseAdmin.from('explicacoes').insert({
    centro_id: centroId, professor_id: opts.professorId, disciplina_id: disciplinaId,
    data: opts.data, hora_inicio: opts.horaInicio, created_by: opts.professorId,
    dado: opts.dado, estado: opts.estado ?? 'ativa', duracao_prevista_horas: 1,
  }).select('id').single();
  if (error) throw new Error(`criar explicacao: ${error.message}`);
  for (const a of opts.alunos) {
    // check "explicacoes_alunos_tardio_coerente": cancelado_em tem de vir
    // preenchido sempre que cancelamento_tardio (ou qualquer cancelamento)
    // é true — mesma coerência que cancelar_explicacao_aluno garante.
    const cancelado = a.cancelado || a.cancelamentoTardio || false;
    const { error: errEa } = await supabaseAdmin.from('explicacoes_alunos').insert({
      explicacao_id: row.id, aluno_id: a.id, valor_cobrado_familia: a.valor,
      cancelamento_tardio: a.cancelamentoTardio ?? false,
      cancelado_em: cancelado ? new Date().toISOString() : null,
    });
    if (errEa) throw new Error(`associar aluno à explicacao: ${errEa.message}`);
  }
  return row.id;
}

async function criarPresenca(alunoId: string, dia: string) {
  const { error } = await supabaseAdmin.from('diario_bordo').insert({
    aluno_id: alunoId, centro_id: centroId, entrada: `${dia}T09:00:00`, saida: `${dia}T10:00:00`,
  });
  if (error) throw new Error(`criar presenca ${dia}: ${error.message}`);
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

async function entrarComCodigo(p: Page, codigo: string) {
  await p.fill('input[inputMode="numeric"]', codigo);
  await p.getByRole('button', { name: /^entrar$/i }).click();
  await expect(p.getByTestId('resumo-mes')).toBeVisible({ timeout: 15_000 });
}

/** Clica "Mês anterior"/"Mês seguinte" n vezes, esperando o título mudar a cada clique. */
async function navegarMes(p: Page, direcao: 'anterior' | 'seguinte', vezes: number) {
  const testId = direcao === 'anterior' ? 'resumo-mes-anterior' : 'resumo-mes-seguinte';
  for (let i = 0; i < vezes; i++) {
    const tituloAntes = await p.getByTestId('resumo-mes-titulo').textContent();
    await p.getByTestId(testId).click();
    await expect(p.getByTestId('resumo-mes-titulo')).not.toHaveText(tituloAntes || '', { timeout: 10_000 });
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('Resumo do Mês (Área dos Encarregados) — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE ResumoMes'],
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

    secretaria = await criarStaff('secretaria', `Secretaria ResMes ${SUFIXO}`);
    professor = await criarStaff('professor', `Professor ResMes ${SUFIXO}`);

    disciplinaId = await criarDisciplina(DISCIPLINA_NOME);
    servicoLancheId = await criarServico(NOME_LANCHE, 1.2);
    servicoTransporteId = await criarServico(NOME_TRANSPORTE, 3.5);

    // mensalidade_base (40) deliberadamente DIFERENTE da linha de Pagamentos
    // (55, criada abaixo) — testa que o cartão mostra a linha, nunca a ficha.
    alunoPrincipal = await criarAluno(`Aluno Principal ResMes ${SUFIXO}`, 40);
    alunoParceiro = await criarAluno(`Aluno Parceiro ResMes ${SUFIXO}`, 0);
    alunoOutro = await criarAluno(`Aluno Outro ResMes ${SUFIXO}`, 0);

    const { error: codigoError } = await supabaseAdmin.rpc('definir_codigo_encarregado', { p_aluno_id: alunoPrincipal.id, p_codigo: CODIGO_PRINCIPAL });
    if (codigoError) throw new Error(`definir código: ${codigoError.message}`);

    // --- MES_ALVO (mês passado fixo, -2 meses) — cenário completo ---
    await criarMensalidade(alunoPrincipal.id, MES_ALVO.ano, MES_ALVO.mes, 55);
    await criarMensalidade(alunoOutro.id, MES_ALVO.ano, MES_ALVO.mes, 99);

    await criarPresenca(alunoPrincipal.id, dataISO(MES_ALVO.ano, MES_ALVO.mes, 5));
    await criarPresenca(alunoPrincipal.id, dataISO(MES_ALVO.ano, MES_ALVO.mes, 10));
    await criarPresenca(alunoPrincipal.id, dataISO(MES_ALVO.ano, MES_ALVO.mes, 15));

    // O valor cobrado de cada sessão é calculado por um gatilho da base de
    // dados (calcular_valores_explicacao) a partir de precos_explicacoes_ciclo
    // (ciclo do aluno + nº de alunos na sessão) no momento em que a linha de
    // explicacoes_alunos é inserida — nunca aceita o valor que aqui se passa
    // para uma sessão "dada". Por isso esta sessão é criada ANTES de existir
    // qualquer preço para o ciclo (3_ciclo, ano_escolar 8): fica "sem preço"
    // de propósito, tal como aconteceria no centro real antes de o admin
    // configurar os preços.
    await criarExplicacao({
      professorId: professor.id, data: dataISO(MES_ALVO.ano, MES_ALVO.mes, 20), horaInicio: '16:00:00', dado: true,
      alunos: [{ id: alunoPrincipal.id, valor: null }],
    });

    // Preços do 3.º ciclo (7.º-9.º ano, o ciclo de todos os alunos deste
    // teste) — individual (1+) e grupo (2+). A partir de aqui, toda a sessão
    // "dada" e individual fica a 20€, e toda a de grupo a 12€ — mesmo motor
    // de preços do resto da app, nunca reimplementado aqui.
    const { error: errPreco1 } = await supabaseAdmin.from('precos_explicacoes_ciclo').insert({
      centro_id: centroId, ciclo: '3_ciclo', alunos_a_partir_de: 1, tipo: 'fixo', valor: 20,
    });
    if (errPreco1) throw new Error(`preco individual: ${errPreco1.message}`);
    const { error: errPreco2 } = await supabaseAdmin.from('precos_explicacoes_ciclo').insert({
      centro_id: centroId, ciclo: '3_ciclo', alunos_a_partir_de: 2, tipo: 'fixo', valor: 12,
    });
    if (errPreco2) throw new Error(`preco grupo: ${errPreco2.message}`);

    // individual, dado, com preço (20€, pelo gatilho)
    await criarExplicacao({
      professorId: professor.id, data: dataISO(MES_ALVO.ano, MES_ALVO.mes, 10), horaInicio: '09:00:00', dado: true,
      alunos: [{ id: alunoPrincipal.id, valor: null }],
    });
    // grupo (2 alunos), dado, com preço — alunoPrincipal paga o preço de grupo (12€)
    await criarExplicacao({
      professorId: professor.id, data: dataISO(MES_ALVO.ano, MES_ALVO.mes, 10), horaInicio: '11:00:00', dado: true,
      alunos: [{ id: alunoPrincipal.id, valor: null }, { id: alunoParceiro.id, valor: null }],
    });
    // individual, cancelada tarde — fica "dada" e cobrada ao preço individual (20€) na mesma
    await criarExplicacao({
      professorId: professor.id, data: dataISO(MES_ALVO.ano, MES_ALVO.mes, 12), horaInicio: '13:00:00', dado: true,
      alunos: [{ id: alunoPrincipal.id, valor: null, cancelamentoTardio: true }],
    });
    // individual, cancelada A TEMPO — tem de ficar escondida do resumo
    await criarExplicacao({
      professorId: professor.id, data: dataISO(MES_ALVO.ano, MES_ALVO.mes, 8), horaInicio: '08:00:00', dado: false, estado: 'cancelada',
      alunos: [{ id: alunoPrincipal.id, valor: 0, cancelado: true }],
    });
    // aluno isolado — preço individual (20€) do seu próprio ciclo, nunca pode aparecer no cartão do principal
    await criarExplicacao({
      professorId: professor.id, data: dataISO(MES_ALVO.ano, MES_ALVO.mes, 10), horaInicio: '09:30:00', dado: true,
      alunos: [{ id: alunoOutro.id, valor: null }],
    });

    await criarConsumo(alunoPrincipal.id, servicoLancheId, 1.2, dataISO(MES_ALVO.ano, MES_ALVO.mes, 10));
    await criarConsumo(alunoPrincipal.id, servicoLancheId, 1.2, dataISO(MES_ALVO.ano, MES_ALVO.mes, 12));
    await criarConsumo(alunoPrincipal.id, servicoTransporteId, 3.5, dataISO(MES_ALVO.ano, MES_ALVO.mes, 15));

    // --- MES_SEM_MENSALIDADE (-3 meses) — só uma explicação, sem linha de mensalidade ---
    await criarExplicacao({
      professorId: professor.id, data: dataISO(MES_SEM_MENSALIDADE.ano, MES_SEM_MENSALIDADE.mes, 10), horaInicio: '09:00:00', dado: true,
      alunos: [{ id: alunoPrincipal.id, valor: null }],
    });

    // --- Mês atual (hoje) — presença + explicação + extra, para testar o aviso "ainda não acabou" ---
    const hojeISO = hojeLisboaISO();
    await criarPresenca(alunoPrincipal.id, hojeISO);
    await criarExplicacao({
      professorId: professor.id, data: hojeISO, horaInicio: '08:00:00', dado: true,
      alunos: [{ id: alunoPrincipal.id, valor: null }],
    });
    await criarConsumo(alunoPrincipal.id, servicoLancheId, 1.2, hojeISO);

    // Mensagem antiga do tipo relatorio_mensal — tem de continuar a aparecer
    // nas Mensagens mesmo depois de a funcionalidade de envio ser removida.
    const { error: msgError } = await supabaseAdmin.from('mensagens').insert({
      aluno_id: alunoPrincipal.id, tipo: 'relatorio_mensal',
      payload: { ano: MES_ALVO.ano, mes: MES_ALVO.mes, horas: 3, sessoes: 2, disciplina_principal: `${DISCIPLINA_NOME} (2x)` },
      autor: 'centro', autor_id: admin.id,
    });
    if (msgError) throw new Error(`criar mensagem relatorio_mensal: ${msgError.message}`);
  });

  test.afterAll(async () => {
    execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    const { data: resto } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    expect(resto ?? []).toHaveLength(0);
  });

  test('(a)(b) cartão mostra presenças, explicações (grupo/tarde/escondida), extras e a mensalidade da linha de Pagamentos', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, alunoPrincipal.email, alunoPrincipal.password);
    await page.goto(`${BASE_URL}/encarregados`, { waitUntil: 'networkidle' });
    await entrarComCodigo(page, CODIGO_PRINCIPAL);

    // abre no mês atual
    await expect(page.getByTestId('resumo-mes-titulo')).toHaveText(nomeMesPorExtenso(ANO_HOJE, MES_HOJE));

    await navegarMes(page, 'anterior', 1); // -> MES_ALVO
    await expect(page.getByTestId('resumo-mes-titulo')).toHaveText(nomeMesPorExtenso(MES_ALVO.ano, MES_ALVO.mes));

    // Presenças
    await expect(page.getByTestId('presencas-dias')).toContainText('3');
    await expect(page.getByTestId('presencas-dias')).toContainText('dias de presença');
    await page.getByRole('button', { name: 'Ver dias' }).click();
    const lista = page.getByTestId('presencas-lista').locator('li');
    await expect(lista).toHaveCount(3);
    await expect(lista).toContainText([
      diaDaSemanaPorExtenso(dataISO(MES_ALVO.ano, MES_ALVO.mes, 5)),
      diaDaSemanaPorExtenso(dataISO(MES_ALVO.ano, MES_ALVO.mes, 10)),
      diaDaSemanaPorExtenso(dataISO(MES_ALVO.ano, MES_ALVO.mes, 15)),
    ]);

    // Explicações: 4 linhas visíveis (a cancelada a tempo, dia 8, fica escondida)
    const linhasExplicacao = page.getByTestId('explicacoes-linha');
    await expect(linhasExplicacao).toHaveCount(4);
    await expect(page.getByText(`${pad2(8)}/${pad2(MES_ALVO.mes)}`)).toHaveCount(0); // sessão cancelada a tempo nunca aparece
    await expect(linhasExplicacao.filter({ hasText: 'Grupo' })).toHaveCount(1);
    await expect(linhasExplicacao.filter({ hasText: 'Cancelada tarde (cobrada)' })).toHaveCount(1);
    await expect(page.getByTestId('explicacoes-total')).toContainText('52.00€');
    await expect(page.getByText('1 sessão ainda sem preço')).toBeVisible();

    // Selos iniciais: nada foi marcado pago ainda
    await expect(page.getByTestId('explicacoes-selo')).toContainText('Por pagar');
    await expect(page.getByTestId('mensalidade-selo')).toContainText('Por pagar');

    // Mensalidade: mostra a linha de Pagamentos (55€), nunca a ficha (40€)
    await expect(page.getByTestId('mensalidade-valor')).toHaveText('55.00€');

    // Extras agrupados + detalhe
    await expect(page.getByTestId('extras-total')).toHaveText('5.90€');
    await page.getByRole('button', { name: 'Ver detalhe' }).click();
    const extras = page.getByTestId('extras-lista').locator('li');
    await expect(extras).toHaveCount(2);
    await expect(extras.filter({ hasText: NOME_LANCHE })).toContainText('× 2');
    await expect(extras.filter({ hasText: NOME_LANCHE })).toContainText('2.40€');
    await expect(extras.filter({ hasText: NOME_TRANSPORTE })).toContainText('× 1');
    await expect(extras.filter({ hasText: NOME_TRANSPORTE })).toContainText('3.50€');

    // Total do mês: 55 (mensalidade) + 52 (explicações) + 5.90 (extras) = 112.90€
    await expect(page.getByTestId('total-mes')).toHaveText('112.90€');
    await expect(page.getByTestId('aviso-mes-atual')).toHaveCount(0); // não é o mês atual

    await context.close();
  });

  test('(c) selos Pago/Por pagar seguem o que o admin marca em Pagamentos, nos dois sentidos', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000); // a tabela de Pagamentos por vezes leva mais do que um ciclo de fetch a estabilizar após mudar de mês
    const contextAdmin = await browser.newContext();
    const pageAdmin = await contextAdmin.newPage();
    await loginUI(pageAdmin, admin.email, admin.password);
    await pageAdmin.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' });

    // navega para MES_ALVO (-2 meses a partir do mês atual, que é o que a página abre).
    // Escopado ao <main> da própria página (nunca a página toda): a barra
    // lateral do admin também tem botões com ícone (Menu, Terminar Sessão) —
    // sem este escopo, nth(0) podia acertar em "Terminar Sessão" e fazer
    // logout a meio do teste. ChevronLeft (voltar) é o 1.º botão com ícone
    // dentro do <main> antes da tabela carregar (os dois separadores
    // Mensalidades/A Pagar não têm ícone, só texto).
    const conteudoAdmin = pageAdmin.locator('main').last();
    for (let i = 0; i < 2; i++) {
      await conteudoAdmin.getByRole('button').filter({ has: pageAdmin.locator('svg') }).nth(0).click();
      await pageAdmin.waitForLoadState('networkidle');
      // Margem extra: fetchMes tem um ciclo de "reconciliação" (isFetchingRef/
      // fetchPendingRef) que pode disparar um 2.º pedido mesmo depois de a
      // rede estar "idle" — sem esta margem, o clique seguinte apanha a
      // tabela a meio dessa reconciliação (linhas trocadas sob o próprio
      // clique, nunca mais estabilizam a tempo do timeout do teste).
      await pageAdmin.waitForTimeout(800);
    }
    await expect(pageAdmin.getByText(alunoPrincipal.nome!, { exact: false })).toBeVisible({ timeout: 15_000 });

    const linha = pageAdmin.locator('tr', { hasText: alunoPrincipal.nome! });
    await linha.getByRole('button', { name: /não pago/i }).first().click(); // mensalidade -> Pago
    await expect(linha.getByRole('button', { name: /^pago$/i }).first()).toBeVisible({ timeout: 10_000 });
    const botaoExplicacoes = linha.getByRole('button', { name: /não pago/i }).first();
    await botaoExplicacoes.click(); // explicações -> Pago
    await expect(linha.getByRole('button', { name: /não pago/i })).toHaveCount(0, { timeout: 10_000 });

    const contextFamilia = await browser.newContext();
    const pageFamilia = await contextFamilia.newPage();
    await loginUI(pageFamilia, alunoPrincipal.email, alunoPrincipal.password);
    await pageFamilia.goto(`${BASE_URL}/encarregados`, { waitUntil: 'networkidle' });
    await entrarComCodigo(pageFamilia, CODIGO_PRINCIPAL);
    await navegarMes(pageFamilia, 'anterior', 1);
    await expect(pageFamilia.getByTestId('mensalidade-selo')).toContainText('Pago');
    await expect(pageFamilia.getByTestId('explicacoes-selo')).toContainText('Pago');
    await contextFamilia.close();

    // volta a marcar como não pago, nos dois sentidos
    await linha.getByRole('button', { name: /^pago$/i }).first().click();
    await expect(linha.getByRole('button', { name: /não pago/i }).first()).toBeVisible({ timeout: 10_000 });
    const botaoExplicacoesPago = linha.getByRole('button', { name: /^pago$/i }).first();
    await botaoExplicacoesPago.click();
    await expect(linha.getByRole('button', { name: /^pago$/i })).toHaveCount(0, { timeout: 10_000 });

    const contextFamilia2 = await browser.newContext();
    const pageFamilia2 = await contextFamilia2.newPage();
    await loginUI(pageFamilia2, alunoPrincipal.email, alunoPrincipal.password);
    await pageFamilia2.goto(`${BASE_URL}/encarregados`, { waitUntil: 'networkidle' });
    await entrarComCodigo(pageFamilia2, CODIGO_PRINCIPAL);
    await navegarMes(pageFamilia2, 'anterior', 1);
    await expect(pageFamilia2.getByTestId('mensalidade-selo')).toContainText('Por pagar');
    await expect(pageFamilia2.getByTestId('explicacoes-selo')).toContainText('Por pagar');
    await contextFamilia2.close();

    await contextAdmin.close();
  });

  test('(d) os valores do cartão batem com os de Pagamentos', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000); // ver comentário equivalente no teste (c)
    const contextAdmin = await browser.newContext();
    const pageAdmin = await contextAdmin.newPage();
    await loginUI(pageAdmin, admin.email, admin.password);
    await pageAdmin.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' });
    // Escopado ao <main> da página — ver comentário equivalente no teste (c).
    const conteudoAdmin = pageAdmin.locator('main').last();
    for (let i = 0; i < 2; i++) {
      await conteudoAdmin.getByRole('button').filter({ has: pageAdmin.locator('svg') }).nth(0).click();
      await pageAdmin.waitForLoadState('networkidle');
      await pageAdmin.waitForTimeout(800); // ver comentário equivalente no teste (c)
    }
    const linha = pageAdmin.locator('tr', { hasText: alunoPrincipal.nome! });
    await expect(linha).toContainText('55.00€'); // valor esperado da mensalidade — a mesma linha que o cartão mostra
    await expect(linha).toContainText('52.00€'); // valor esperado das explicações (já visível na célula, sem expandir)
    await contextAdmin.close();
  });

  test('(e) as setas só percorrem os meses com dados, abrem no mês atual, e um mês sem mensalidade não mostra o bloco', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, alunoPrincipal.email, alunoPrincipal.password);
    await page.goto(`${BASE_URL}/encarregados`, { waitUntil: 'networkidle' });
    await entrarComCodigo(page, CODIGO_PRINCIPAL);

    await expect(page.getByTestId('resumo-mes-titulo')).toHaveText(nomeMesPorExtenso(ANO_HOJE, MES_HOJE));
    await expect(page.getByTestId('resumo-mes-seguinte')).toBeDisabled();
    await expect(page.getByTestId('aviso-mes-atual')).toBeVisible();

    await navegarMes(page, 'anterior', 1);
    await expect(page.getByTestId('resumo-mes-titulo')).toHaveText(nomeMesPorExtenso(MES_ALVO.ano, MES_ALVO.mes));

    await navegarMes(page, 'anterior', 1);
    await expect(page.getByTestId('resumo-mes-titulo')).toHaveText(nomeMesPorExtenso(MES_SEM_MENSALIDADE.ano, MES_SEM_MENSALIDADE.mes));
    await expect(page.getByTestId('resumo-mes-anterior')).toBeDisabled(); // mês mais antigo com dados
    await expect(page.getByTestId('mensalidade-bloco')).toHaveCount(0); // sem linha de mensalidade neste mês

    await navegarMes(page, 'seguinte', 2);
    await expect(page.getByTestId('resumo-mes-titulo')).toHaveText(nomeMesPorExtenso(ANO_HOJE, MES_HOJE));
    await expect(page.getByTestId('resumo-mes-seguinte')).toBeDisabled();

    await context.close();
  });

  test('(f) isolamento entre alunos; admin/professor/secretaria chamando as RPCs recebem "Sem sessão."', async () => {
    const sessaoPrincipal = await sessaoComo(alunoPrincipal);
    const { data: resumoPrincipal, error: errPrincipal } = await sessaoPrincipal.rpc('resumo_mes_encarregado', { p_ano: MES_ALVO.ano, p_mes: MES_ALVO.mes });
    expect(errPrincipal).toBeNull();
    expect(Number(resumoPrincipal.total_mes)).toBeCloseTo(112.9, 2);

    const sessaoOutro = await sessaoComo(alunoOutro);
    const { data: resumoOutro, error: errOutro } = await sessaoOutro.rpc('resumo_mes_encarregado', { p_ano: MES_ALVO.ano, p_mes: MES_ALVO.mes });
    expect(errOutro).toBeNull();
    expect(Number(resumoOutro.mensalidade.valor)).toBe(99);
    expect(resumoOutro.explicacoes.linhas).toHaveLength(1);
    expect(Number(resumoOutro.total_mes)).toBeCloseTo(119, 2);

    // nunca os números um do outro
    expect(Number(resumoOutro.total_mes)).not.toBeCloseTo(Number(resumoPrincipal.total_mes), 2);
    expect(resumoOutro.explicacoes.linhas.length).not.toBe(resumoPrincipal.explicacoes.linhas.length);

    for (const conta of [admin, professor, secretaria]) {
      const sessao = await sessaoComo(conta);
      const { error: erroResumo } = await sessao.rpc('resumo_mes_encarregado', { p_ano: MES_ALVO.ano, p_mes: MES_ALVO.mes });
      expect(erroResumo?.message).toMatch(/sem sessão/i);
      const { error: erroMeses } = await sessao.rpc('meses_resumo_encarregado');
      expect(erroMeses?.message).toMatch(/sem sessão/i);
    }
  });

  test('(g) 360, 390 e 430 px — sem scroll horizontal', async ({ browser }: { browser: Browser }) => {
    for (const largura of [360, 390, 430]) {
      const context = await browser.newContext({ viewport: { width: largura, height: 800 } });
      const page = await context.newPage();
      await loginUI(page, alunoPrincipal.email, alunoPrincipal.password);
      await page.goto(`${BASE_URL}/encarregados`, { waitUntil: 'networkidle' });
      await entrarComCodigo(page, CODIGO_PRINCIPAL);
      await page.getByRole('button', { name: 'Ver dias' }).click();
      await page.getByRole('button', { name: 'Ver detalhe' }).click();

      const semScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(semScroll).toBe(true);
      await context.close();
    }
  });

  test('(h) Relatório Mensal: rota e item de menu desapareceram; mensagens antigas continuam a mostrar-se', async ({ browser }: { browser: Browser }) => {
    const contextAdmin = await browser.newContext();
    const pageAdmin = await contextAdmin.newPage();
    await loginUI(pageAdmin, admin.email, admin.password);
    await pageAdmin.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    await expect(pageAdmin.getByRole('link', { name: /relatório mensal/i })).toHaveCount(0);

    const respostaRota = await pageAdmin.goto(`${BASE_URL}/admin/relatorio-mensal`, { waitUntil: 'networkidle' });
    expect(respostaRota?.status()).toBe(404);
    await expect(pageAdmin.getByText(/relatório mensal/i)).toHaveCount(0);
    await contextAdmin.close();

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, alunoPrincipal.email, alunoPrincipal.password);
    await page.goto(`${BASE_URL}/encarregados`, { waitUntil: 'networkidle' });
    await entrarComCodigo(page, CODIGO_PRINCIPAL);
    await page.getByRole('link', { name: /mensagens/i }).click();
    await expect(page.getByText('Relatório Mensal')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`Período: ${pad2(MES_ALVO.mes)}/${MES_ALVO.ano}`)).toBeVisible();
    await expect(page.getByText('Horas: 3')).toBeVisible();
    await expect(page.getByText('Sessões: 2')).toBeVisible();
    await context.close();
  });
});
