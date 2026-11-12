import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Editor de preços das explicações por ciclo (precos_explicacoes_ciclo),
// Gestão → aba "Preços" → "Explicações" (redesenho em separadores;
// ?aba=precos abre direto nessa aba). lib/precosCiclo.ts tem a lógica (ver
// tests/precos-ciclo-logica.spec.ts); aqui só o ecrã, a gravação (upsert +
// delete) e o efeito real no gatilho calcular_valores_explicacao (nunca
// tocado, só observado). Centro descartável ZZTESTE
// (~/Desktop/gestao-centros/novo-centro.mjs), nunca o centro real (Trupe
// Lias) ou o demo. precos_explicacoes_ciclo ainda não consta da lista de
// tabelas de apagar-centro.mjs — limpa à mão no afterAll, antes de chamar o
// script.

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
const NOME_ZZTESTE = `ZZTESTE PrecosCiclo ${SUFIXO}`;
const ADMIN_EMAIL = `admin-precosciclo-${SUFIXO}@zzteste.invalid`;

type Conta = { email: string; password: string; id: string };

let centroId: string;
let admin: Conta;
let professor: Conta;
let secretaria: Conta;
let disciplinaId: number;
let aluno1Id: string;
let aluno2Id: string;
let explicacaoId: string;

let context: BrowserContext;
let page: Page; // admin
let contextProfessor: BrowserContext;
let pageProfessor: Page;
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

async function criarStaff(papel: string, nome: string, extra: Record<string, unknown> = {}): Promise<Conta> {
  const email = `${nome.toLowerCase().replace(/\s+/g, '-')}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { role: papel, centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: nome, role: papel, centro_id: centroId, ...extra });
  if (error) throw new Error(`criar staff ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
  return { email, password, id };
}

async function criarAluno(nome: string, anoEscolar: number): Promise<string> {
  const email = `${nome.toLowerCase().replace(/\s+/g, '-')}-${SUFIXO}@zzteste.invalid`;
  const id = await criarUtilizadorAuth(email, gerarPasswordSegura(), { centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-${id.slice(0, 8)}@zzteste.invalid`,
    data_nascimento: '2014-01-01', ano_escolar: anoEscolar, centro_id: centroId,
    ativo: true, sala_estudo: false, faz_explicacoes: true, mensalidade_base: 0,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return id;
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

async function abrirGestao(p: Page) {
  await p.goto(`${BASE_URL}/admin/gestao?aba=precos`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});
}

function linhaCiclo(p: Page, ciclo: string) {
  return p.getByTestId(`linha-ciclo-${ciclo}`);
}

async function preencherLinha(p: Page, ciclo: string, individual: string, grupo: string) {
  const linha = linhaCiclo(p, ciclo);
  await linha.getByTestId(`individual-${ciclo}`).fill(individual);
  await linha.getByTestId(`grupo-${ciclo}`).fill(grupo);
}

async function lerPrecosCicloDB() {
  const { data, error } = await supabaseAdmin
    .from('precos_explicacoes_ciclo')
    .select('ciclo, alunos_a_partir_de, tipo, valor')
    .eq('centro_id', centroId)
    .order('ciclo')
    .order('alunos_a_partir_de');
  if (error) throw new Error(`ler precos_explicacoes_ciclo: ${error.message}`);
  return data || [];
}

test.describe.configure({ mode: 'serial' });

test.describe('Preços das explicações por ciclo — centro descartável ZZTESTE', () => {
  test.beforeAll(async ({ browser }) => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE PrecosCiclo'],
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

    professor = await criarStaff('professor', 'Prof PrecosCiclo');
    secretaria = await criarStaff('secretaria', 'Secretaria PrecosCiclo');

    const { data: disciplina, error: errDisciplina } = await supabaseAdmin
      .from('subjects').insert({ name: `Disciplina ZZTESTE ${SUFIXO}`, centro_id: centroId }).select('id').single();
    if (errDisciplina) throw new Error(`criar disciplina: ${errDisciplina.message}`);
    disciplinaId = disciplina.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplinaId));

    aluno1Id = await criarAluno('Aluno Ciclo Um', 6);
    aluno2Id = await criarAluno('Aluno Ciclo Dois', 6);

    context = await browser.newContext();
    page = await context.newPage();
    await loginUI(page, admin.email, admin.password);

    contextProfessor = await browser.newContext();
    pageProfessor = await contextProfessor.newPage();
    await loginUI(pageProfessor, professor.email, professor.password);

    contextSecretaria = await browser.newContext();
    pageSecretaria = await contextSecretaria.newPage();
    await loginUI(pageSecretaria, secretaria.email, secretaria.password);
  });

  test.afterAll(async () => {
    await context?.close();
    await contextProfessor?.close();
    await contextSecretaria?.close();

    if (explicacaoId) {
      await supabaseAdmin.from('explicacoes_alunos').delete().eq('explicacao_id', explicacaoId);
      await supabaseAdmin.from('explicacoes').delete().eq('id', explicacaoId);
    }
    if (centroId) {
      await supabaseAdmin.from('precos_explicacoes_ciclo').delete().eq('centro_id', centroId);
    }

    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }

    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }

    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    const { data: restoPrecos } = await supabaseAdmin.from('precos_explicacoes_ciclo').select('id').eq('centro_id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
    expect(restoPrecos ?? []).toHaveLength(0);
  });

  // --- (b) centro sem preços: campos vazios + avisos ---
  test('Gestão: centro sem preços mostra campos vazios e o aviso de "sem preço individual" nos 4 ciclos', async () => {
    await abrirGestao(page);
    const secao = page.getByTestId('precos-ciclo-secao');
    await expect(secao).toBeVisible();
    for (const ciclo of ['1_ciclo', '2_ciclo', '3_ciclo', 'secundario']) {
      await expect(linhaCiclo(page, ciclo).getByTestId(`individual-${ciclo}`)).toHaveValue('');
      await expect(linhaCiclo(page, ciclo).getByTestId(`grupo-${ciclo}`)).toHaveValue('');
    }
    const avisos = page.getByTestId('avisos-ciclo');
    await expect(avisos).toContainText('sem preço individual');
    await expect(page.getByTestId('guardar-precos-ciclo')).toBeDisabled();
  });

  // --- (b)+(e): preenche os 4 ciclos (valores reais da Trupe Lias, só para este ZZTESTE), ---
  // o simulador já reflete antes de guardar, guarda, e continua certo depois.
  test('preenche os 4 ciclos com "Por hora", o simulador acerta antes e depois de guardar', async () => {
    await preencherLinha(page, '1_ciclo', '16', ''); // sem grupo — "igual ao individual"
    await preencherLinha(page, '2_ciclo', '16', '12');
    await preencherLinha(page, '3_ciclo', '16', '12');
    await preencherLinha(page, 'secundario', '18', '14');
    await page.getByRole('button', { name: 'Por hora' }).click();

    await expect(page.getByTestId('guardar-precos-ciclo')).toBeEnabled();

    // simulador ANTES de guardar
    await page.getByTestId('sim-ano').selectOption('6');
    await page.getByTestId('sim-alunos').selectOption('1');
    await expect(page.getByTestId('resultado-simulador-ciclo')).toHaveText('Cada aluno do 6.º ano paga 16,00 €.');
    await page.getByTestId('sim-alunos').selectOption('2');
    await expect(page.getByTestId('resultado-simulador-ciclo')).toContainText('Cada aluno do 6.º ano paga 12,00 €.');
    await expect(page.getByTestId('resultado-simulador-ciclo')).toContainText('o centro cobra 24,00 € no total');
    await page.getByTestId('sim-ano').selectOption('11');
    await expect(page.getByTestId('resultado-simulador-ciclo')).toContainText('Cada aluno do 11.º ano paga 14,00 €.');
    await page.getByTestId('sim-ano').selectOption('1');
    await page.getByTestId('sim-alunos').selectOption('2');
    await expect(page.getByTestId('resultado-simulador-ciclo')).toContainText('Cada aluno do 1.º ano paga 16,00 €.'); // 1º ciclo sem grupo = igual ao individual

    await page.getByTestId('guardar-precos-ciclo').click();
    await expect(page.getByText('Preços guardados.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('guardar-precos-ciclo')).toBeDisabled();
    await expect(page.getByTestId('avisos-ciclo')).toHaveCount(0);

    const linhasDB = await lerPrecosCicloDB();
    expect(linhasDB).toHaveLength(7);
    expect(linhasDB.every((l) => l.tipo === 'por_hora')).toBe(true);
    const por = (ciclo: string, n: number) => linhasDB.find((l) => l.ciclo === ciclo && l.alunos_a_partir_de === n);
    expect(Number(por('1_ciclo', 1)?.valor)).toBe(16);
    expect(por('1_ciclo', 2)).toBeUndefined();
    expect(Number(por('2_ciclo', 1)?.valor)).toBe(16);
    expect(Number(por('2_ciclo', 2)?.valor)).toBe(12);
    expect(Number(por('secundario', 2)?.valor)).toBe(14);

    // simulador DEPOIS de guardar — mesmos valores, agora persistidos
    await page.getByTestId('sim-ano').selectOption('6');
    await page.getByTestId('sim-alunos').selectOption('1');
    await expect(page.getByTestId('resultado-simulador-ciclo')).toHaveText('Cada aluno do 6.º ano paga 16,00 €.');
    await page.getByTestId('sim-alunos').selectOption('2');
    await expect(page.getByTestId('resultado-simulador-ciclo')).toContainText('Cada aluno do 6.º ano paga 12,00 €.');
  });

  // --- (f) ponta a ponta: sessão de 2 alunos do 6º ano, 1h dada, grava 12,00 cada; ---
  // alterar o preço de grupo depois NÃO recalcula a sessão já dada.
  test('sessão de 2 alunos do 6.º ano com 1h dada grava 12,00 cada; alterar o preço de grupo depois não recalcula', async () => {
    const { data: exp, error } = await supabaseAdmin.from('explicacoes').insert({
      centro_id: centroId, professor_id: professor.id, disciplina_id: disciplinaId,
      data: '2026-03-10', hora_inicio: '10:00', created_by: professor.id, dado: false, horas_dadas: null,
    }).select().single();
    if (error) throw new Error(`criar explicacao: ${error.message}`);
    explicacaoId = exp.id;

    const { error: errAlunos } = await supabaseAdmin
      .from('explicacoes_alunos')
      .insert([{ explicacao_id: explicacaoId, aluno_id: aluno1Id }, { explicacao_id: explicacaoId, aluno_id: aluno2Id }]);
    if (errAlunos) throw new Error(`associar alunos: ${errAlunos.message}`);

    const { error: errDado } = await supabaseAdmin.from('explicacoes').update({ dado: true, horas_dadas: 1 }).eq('id', explicacaoId);
    if (errDado) throw new Error(`marcar sessão dada: ${errDado.message}`);

    const lerValores = async () => {
      const { data } = await supabaseAdmin
        .from('explicacoes_alunos')
        .select('aluno_id, valor_cobrado_familia')
        .eq('explicacao_id', explicacaoId);
      return data || [];
    };

    let valores = await lerValores();
    expect(valores).toHaveLength(2);
    for (const v of valores) expect(Number(v.valor_cobrado_familia)).toBe(12);

    // altera o preço de grupo do 2º ciclo pela UI e guarda
    await abrirGestao(page);
    await linhaCiclo(page, '2_ciclo').getByTestId('grupo-2_ciclo').fill('99');
    await page.getByTestId('guardar-precos-ciclo').click();
    await expect(page.getByText('Preços guardados.')).toBeVisible({ timeout: 10_000 });

    const linhasDB = await lerPrecosCicloDB();
    expect(Number(linhasDB.find((l) => l.ciclo === '2_ciclo' && l.alunos_a_partir_de === 2)?.valor)).toBe(99);

    // a sessão já dada mantém 12,00 — nunca recalculada retroativamente
    valores = await lerValores();
    for (const v of valores) expect(Number(v.valor_cobrado_familia)).toBe(12);
  });

  // --- (c) validações (bloqueantes) e aviso de grupo > individual (não bloqueante) ---
  test('validações: texto inválido, negativo e acima de 999,99 bloqueiam; grupo > individual só avisa', async () => {
    await abrirGestao(page);

    await linhaCiclo(page, '1_ciclo').getByTestId('individual-1_ciclo').fill('abc');
    await page.getByTestId('guardar-precos-ciclo').click();
    await expect(page.getByText('Corrige os valores assinalados.')).toBeVisible({ timeout: 10_000 });
    await expect(linhaCiclo(page, '1_ciclo')).toContainText('Indica um valor válido');

    // "-5" nem chega a parecer um número válido (o sinal de menos não é
    // aceite neste campo) — mesma mensagem genérica do texto inválido.
    await linhaCiclo(page, '1_ciclo').getByTestId('individual-1_ciclo').fill('-5');
    await page.getByTestId('guardar-precos-ciclo').click();
    await expect(linhaCiclo(page, '1_ciclo')).toContainText('Indica um valor válido');

    await linhaCiclo(page, '1_ciclo').getByTestId('individual-1_ciclo').fill('1000');
    await page.getByTestId('guardar-precos-ciclo').click();
    await expect(linhaCiclo(page, '1_ciclo')).toContainText('entre 0 e 999,99');

    // nada destas tentativas gravou — o centro continua com 16 no 1º ciclo
    const linhasDB = await lerPrecosCicloDB();
    expect(Number(linhasDB.find((l) => l.ciclo === '1_ciclo' && l.alunos_a_partir_de === 1)?.valor)).toBe(16);

    // repõe um valor válido para não interferir nos testes seguintes
    await linhaCiclo(page, '1_ciclo').getByTestId('individual-1_ciclo').fill('16');

    // grupo > individual: aviso, não bloqueia
    await linhaCiclo(page, '3_ciclo').getByTestId('grupo-3_ciclo').fill('50');
    await expect(page.getByTestId('avisos-ciclo')).toContainText('o preço de grupo é superior ao individual');
    await linhaCiclo(page, '3_ciclo').getByTestId('grupo-3_ciclo').fill('12'); // repõe
  });

  test('o botão "Guardar Preços" fica desativado sem alterações', async () => {
    await abrirGestao(page);
    await expect(page.getByTestId('guardar-precos-ciclo')).toBeDisabled();
    await linhaCiclo(page, '3_ciclo').getByTestId('individual-3_ciclo').fill('17');
    await expect(page.getByTestId('guardar-precos-ciclo')).toBeEnabled();
  });

  // --- edição e esvaziamento (usa o 3º ciclo — já não é preciso aos outros testes) ---
  test('altera um valor e o de grupo; esvaziar o grupo apaga só o escalão 2; esvaziar o individual apaga os dois e avisa', async () => {
    // Reabre a Gestão entre cada gravação — garante um estado fresco (vindo
    // da base de dados) e um StatusToast novo em cada passo, em vez de
    // confiar num toast que podia já estar visível do passo anterior.
    await abrirGestao(page);
    await preencherLinha(page, '3_ciclo', '17', '13');
    await page.getByTestId('guardar-precos-ciclo').click();
    await expect(page.getByText('Preços guardados.')).toBeVisible({ timeout: 10_000 });
    let linhasDB = await lerPrecosCicloDB();
    expect(Number(linhasDB.find((l) => l.ciclo === '3_ciclo' && l.alunos_a_partir_de === 1)?.valor)).toBe(17);
    expect(Number(linhasDB.find((l) => l.ciclo === '3_ciclo' && l.alunos_a_partir_de === 2)?.valor)).toBe(13);

    await abrirGestao(page);
    await linhaCiclo(page, '3_ciclo').getByTestId('grupo-3_ciclo').fill('');
    await page.getByTestId('guardar-precos-ciclo').click();
    await expect(page.getByText('Preços guardados.')).toBeVisible({ timeout: 10_000 });
    linhasDB = await lerPrecosCicloDB();
    expect(linhasDB.find((l) => l.ciclo === '3_ciclo' && l.alunos_a_partir_de === 2)).toBeUndefined();
    expect(Number(linhasDB.find((l) => l.ciclo === '3_ciclo' && l.alunos_a_partir_de === 1)?.valor)).toBe(17);

    await abrirGestao(page);
    await linhaCiclo(page, '3_ciclo').getByTestId('individual-3_ciclo').fill('');
    await page.getByTestId('guardar-precos-ciclo').click();
    await expect(page.getByText('Preços guardados.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('avisos-ciclo')).toContainText('3.º Ciclo: sem preço individual');
    linhasDB = await lerPrecosCicloDB();
    expect(linhasDB.find((l) => l.ciclo === '3_ciclo')).toBeUndefined();
  });

  // --- (d) escalão adicional (>2 alunos), nunca editado aqui, só o tipo acompanha a escolha global ---
  test('um escalão a partir de 3 alunos (criado por fora) é preservado, listado no aviso, e só o tipo acompanha "Por sessão"', async () => {
    const { error } = await supabaseAdmin.from('precos_explicacoes_ciclo').insert({
      centro_id: centroId, ciclo: '1_ciclo', alunos_a_partir_de: 3, tipo: 'por_hora', valor: 10,
    });
    if (error) throw new Error(`criar escalão extra: ${error.message}`);

    await abrirGestao(page);
    await expect(page.getByTestId('aviso-escaloes-extra')).toContainText('3 alunos (1.º Ciclo)');
    // nunca um input próprio para o escalão 3 — só os dois de sempre por ciclo
    await expect(page.locator('[data-testid="individual-1_ciclo"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="grupo-1_ciclo"]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Por sessão' }).click();
    await page.getByTestId('guardar-precos-ciclo').click();
    await expect(page.getByText('Preços guardados.')).toBeVisible({ timeout: 10_000 });

    const linhasDB = await lerPrecosCicloDB();
    const extra = linhasDB.find((l) => l.ciclo === '1_ciclo' && l.alunos_a_partir_de === 3);
    expect(extra?.tipo).toBe('fixo');
    expect(Number(extra?.valor)).toBe(10); // valor preservado, só o tipo mudou
    expect(linhasDB.every((l) => l.tipo === 'fixo')).toBe(true); // propagou a todas as linhas
  });

  // --- (g) acesso ---
  test('professor e secretaria não acedem à Gestão; o professor não lê nenhuma linha de precos_explicacoes_ciclo', async () => {
    await pageProfessor.goto(`${BASE_URL}/admin/gestao?aba=precos`, { waitUntil: 'networkidle' });
    await expect(pageProfessor).toHaveURL(`${BASE_URL}/admin`);

    await pageSecretaria.goto(`${BASE_URL}/admin/gestao?aba=precos`, { waitUntil: 'networkidle' });
    await expect(pageSecretaria).toHaveURL(`${BASE_URL}/admin`);

    const sessaoProfessor = await sessaoComo(professor);
    const { data, error } = await sessaoProfessor.from('precos_explicacoes_ciclo').select('id');
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
