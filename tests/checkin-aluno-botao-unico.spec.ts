import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { gerarUsernameBase, emailFachada } from '@/lib/username';
import { getHojeLisboa, dataLisboaDe, janelaLarga, horaLisboaDe } from '@/lib/dataLisboa';

dotenv.config({ path: '.env.local' });

// Check-in do aluno por centro (~/Desktop/plano-checkin-aluno.md): seletor
// "Botão único" vs. "Com escolha de disciplina" em Gestão > Regras do
// centro, e o novo ecrã inicial do aluno (app/page.tsx). Centro descartável
// ZZTESTE (~/Desktop/gestao-centros/novo-centro.mjs), nunca o centro real
// (Trupe Lias) nem o Demo.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const GESTAO_DIR = path.join(os.homedir(), 'Desktop', 'gestao-centros');
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE CheckinAluno ${SUFIXO}`;
const ADMIN_EMAIL = `admin-checkinaluno-${SUFIXO}@zzteste.invalid`;

type Conta = { id: string; email: string; password: string };
type Aluno = { id: string; nome: string; email: string; password: string };

let centroId: string;
let salaId: string;
let disciplina: { id: number; name: string; sala_id: string };
let admin: Conta;
let professor: Conta;
let secretaria: Conta;
let adminState: any;
let professorState: any;
let secretariaState: any;
let valorInicialCheckinAluno: string | null = null;

const hoje = getHojeLisboa();

let alunos: Record<string, Aluno> = {};
const limpeza: Array<() => unknown> = [];

// Evita instabilidade perto da passagem de dia em Lisboa — "daqui a N dias"
// e os agregados "Hoje: X h Y min" ficam ambíguos nos primeiros minutos do
// dia civil.
const pertoDaMeiaNoiteLisboa = horaLisboaDe(new Date()) < '00:10';
test.skip(pertoDaMeiaNoiteLisboa, 'Perto da passagem de dia em Lisboa (primeiros 10 min) — instável para agregados "hoje".');

function somarDias(dataISOyyyyMMdd: string, dias: number): string {
  const [ano, mes, dia] = dataISOyyyyMMdd.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

async function criarStaff(papel: string): Promise<Conta> {
  const email = `checkinaluno-${papel}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`criar ${papel}: ${error.message}`);
  const id = data.user.id;
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { role: papel, centro_id: centroId } });
  if (metaError) throw new Error(metaError.message);
  const { error: staffError } = await supabaseAdmin.from('staff').insert({ id, email, name: `Staff ${papel} ${SUFIXO}`, role: papel, centro_id: centroId });
  if (staffError) throw new Error(`staff ${papel}: ${staffError.message}`);
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  return { id, email, password };
}

async function criarAluno(nomeCurto: string): Promise<Aluno> {
  const nome = `${nomeCurto} ZZTESTE${SUFIXO}`;
  const username = gerarUsernameBase(nome);
  const email = emailFachada(username);
  const password = gerarPasswordSegura();
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (authError) throw new Error(`criar aluno ${nome}: ${authError.message}`);
  const id = authData.user.id;
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { centro_id: centroId } });
  if (metaError) throw new Error(metaError.message);
  const { error: dbError } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, ano_escolar: 8, centro_id: centroId, sala_estudo: true, telefone_encarregado: '912345678',
  });
  if (dbError) throw new Error(`alunos ${nome}: ${dbError.message}`);
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  return { id, nome, email, password };
}

async function loginUI(browser: Browser, identificador: string, password: string, destino: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.locator('input[name="identificador"]').fill(identificador);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(`${BASE_URL}${destino}`, { timeout: 15_000 });
  const storageState = await context.storageState();
  await context.close();
  return storageState;
}

async function diarioHojeDoAluno(alunoId: string) {
  const { inicio, fim } = janelaLarga(hoje);
  const { data } = await supabaseAdmin
    .from('diario_bordo')
    .select('*')
    .eq('aluno_id', alunoId)
    .gte('entrada', inicio)
    .lte('entrada', fim)
    .order('entrada', { ascending: false });
  return (data || []).filter((d: any) => dataLisboaDe(d.entrada) === hoje);
}

function linhaDoAluno(page: Page, nome: string) {
  return page.locator('div[role="button"]', { hasText: nome }).first();
}

async function semScrollHorizontal(p: Page) {
  return p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

async function definirConfig(valores: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from('config_centro').update(valores).eq('id', centroId);
  if (error) throw new Error(`config_centro: ${error.message}`);
}

test.describe.configure({ mode: 'serial' });

test.describe('Check-in do aluno (botão único vs. disciplina) — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE CheckinAluno'],
      { cwd: GESTAO_DIR, encoding: 'utf8' }
    );
    const m = saida.match(/centro_id = ([0-9a-f-]+)/);
    if (!m) throw new Error('novo-centro.mjs não devolveu centro_id: ' + saida);
    centroId = m[1];

    const { data: staffAdmin, error: staffAdminError } = await supabaseAdmin
      .from('staff').select('id').eq('centro_id', centroId).eq('role', 'admin').single();
    if (staffAdminError || !staffAdmin) throw new Error('não encontrei o staff admin do novo-centro.mjs');
    const passwordAdmin = gerarPasswordSegura();
    const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(staffAdmin.id, { password: passwordAdmin });
    if (resetError) throw new Error(resetError.message);
    admin = { id: staffAdmin.id, email: ADMIN_EMAIL, password: passwordAdmin };

    professor = await criarStaff('professor');
    secretaria = await criarStaff('secretaria');

    const { data: sala, error: salaError } = await supabaseAdmin
      .from('salas').insert({ nome: `Sala ZZTESTE ${SUFIXO}`, capacidade: 10, centro_id: centroId }).select('id').single();
    if (salaError) throw new Error(`sala: ${salaError.message}`);
    salaId = sala!.id;

    const { data: disc, error: discError } = await supabaseAdmin
      .from('subjects').insert({ name: `Disciplina ZZTESTE ${SUFIXO}`, centro_id: centroId, sala_id: salaId })
      .select('id, name, sala_id').single();
    if (discError) throw new Error(`subjects: ${discError.message}`);
    disciplina = disc as any;

    // config_centro.checkin_aluno já vem da migração aplicada no Supabase —
    // guarda o valor com que o centro nasce, para o teste (a) confirmar que
    // é mesmo o default ('disciplina'), sem o próprio teste o ter definido.
    const { data: configInicial } = await supabaseAdmin
      .from('config_centro').select('checkin_aluno').eq('id', centroId).single();
    valorInicialCheckinAluno = configInicial?.checkin_aluno ?? null;

    // Lista do Dia ativa desde já — não interfere com o ecrã do aluno (que
    // só lê checkin_aluno), e é precisa para o teste (d) (professor a
    // validar entradas "por validar").
    await definirConfig({ modo_presencas: 'lista_dia' });

    alunos.disciplinaDefault = await criarAluno('DisciplinaDefault');
    alunos.botaoEntrada = await criarAluno('BotaoEntrada');
    alunos.botaoSaida = await criarAluno('BotaoSaida');
    alunos.validarProfessor = await criarAluno('ValidarProfessor');
    alunos.proximoTeste = await criarAluno('ProximoTeste');
    alunos.semTeste = await criarAluno('SemTeste');
  });

  test.afterAll(async () => {
    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }
    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: resto } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    expect(resto ?? []).toHaveLength(0);
  });

  test('sessões reais: login de admin, professor e secretaria', async ({ browser }) => {
    adminState = await loginUI(browser, admin.email, admin.password, '/admin');
    professorState = await loginUI(browser, professor.email, professor.password, '/admin');
    secretariaState = await loginUI(browser, secretaria.email, secretaria.password, '/admin');
    expect(adminState).toBeTruthy();
  });

  test('(a) centro por defeito: checkin_aluno = "disciplina"; ecrã do aluno mantém a lista e o fluxo atual', async ({ browser }) => {
    expect(valorInicialCheckinAluno === null || valorInicialCheckinAluno === 'disciplina').toBe(true);
    await definirConfig({ checkin_aluno: 'disciplina' });

    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(`${BASE_URL}/login`);
    await page.locator('input[name="identificador"]').fill(alunos.disciplinaDefault.email);
    await page.locator('input[type="password"]').fill(alunos.disciplinaDefault.password);
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page).toHaveURL(`${BASE_URL}/`, { timeout: 15_000 });

    await expect(page.getByText(/cheguei: escolhe a disciplina/i)).toBeVisible({ timeout: 15_000 });
    await page.getByText(disciplina.name).first().click();
    await expect(page.getByText(/bom estudo/i)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /trocar disciplina/i }).click();
    await page.getByRole('button', { name: /cancelar troca/i }).click();

    await page.getByRole('button', { name: /terminar sessão/i }).click();
    await expect(page.getByText(/bom estudo/i)).toHaveCount(0, { timeout: 15_000 });

    const linhas = await diarioHojeDoAluno(alunos.disciplinaDefault.id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].subject_name).toBe(disciplina.name);
    expect(linhas[0].saida).not.toBeNull();

    await context.close();
  });

  test('(b) modo "botao_unico": sem disciplinas, "Dar entrada" grava Estudo autónomo; duplo toque não duplica', async ({ browser }) => {
    await definirConfig({ checkin_aluno: 'botao_unico' });

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`);
    await page.locator('input[name="identificador"]').fill(alunos.botaoEntrada.email);
    await page.locator('input[type="password"]').fill(alunos.botaoEntrada.password);
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page).toHaveURL(`${BASE_URL}/`, { timeout: 15_000 });

    await expect(page.getByText(/ainda não deste entrada hoje/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(disciplina.name)).toHaveCount(0);
    await expect(page.locator('select')).toHaveCount(0);

    const botaoEntrada = page.getByRole('button', { name: /dar entrada/i });
    await Promise.allSettled([
      botaoEntrada.click({ force: true }).catch(() => {}),
      botaoEntrada.click({ force: true }).catch(() => {}),
    ]);

    await expect(page.getByText(/estás na sala/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/por validar/i)).toBeVisible();

    await expect(async () => {
      const linhas = await diarioHojeDoAluno(alunos.botaoEntrada.id);
      expect(linhas).toHaveLength(1);
    }).toPass({ timeout: 10_000 });

    const [linha] = await diarioHojeDoAluno(alunos.botaoEntrada.id);
    expect(linha.subject_name).toBe('Estudo autónomo');
    expect(linha.subject_id).toBeNull();
    expect(linha.sala_id).toBeNull();
    expect(linha.status).toBe('present');
    expect(linha.saida).toBeNull();

    await context.close();
  });

  test('(c) "Dar saída" pede confirmação; "Voltar" não grava; "Confirmar saída" grava; "Voltar a entrar" reabre', async ({ browser }) => {
    await definirConfig({ checkin_aluno: 'botao_unico' });

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`);
    await page.locator('input[name="identificador"]').fill(alunos.botaoSaida.email);
    await page.locator('input[type="password"]').fill(alunos.botaoSaida.password);
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page).toHaveURL(`${BASE_URL}/`, { timeout: 15_000 });

    await page.getByRole('button', { name: /dar entrada/i }).click();
    await expect(page.getByText(/estás na sala/i)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /dar saída/i }).click();
    await expect(page.getByText(/dar saída agora, às/i)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /^voltar$/i }).click();
    await expect(page.getByText(/dar saída agora, às/i)).toHaveCount(0);
    await expect(page.getByText(/estás na sala/i)).toBeVisible();
    const [aindaAberta] = await diarioHojeDoAluno(alunos.botaoSaida.id);
    expect(aindaAberta.saida).toBeNull();

    await page.getByRole('button', { name: /dar saída/i }).click();
    await page.getByRole('button', { name: /confirmar saída/i }).click();
    await expect(page.getByText(/saída registada às/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/hoje: .* na sala/i)).toBeVisible();

    const [fechada] = await diarioHojeDoAluno(alunos.botaoSaida.id);
    expect(fechada.saida).not.toBeNull();

    await page.getByRole('button', { name: /voltar a entrar/i }).click();
    await expect(page.getByText(/estás na sala/i)).toBeVisible({ timeout: 15_000 });

    await expect(async () => {
      const linhas = await diarioHojeDoAluno(alunos.botaoSaida.id);
      expect(linhas).toHaveLength(2);
      expect(linhas.filter((l: any) => !l.saida)).toHaveLength(1);
    }).toPass({ timeout: 10_000 });

    await context.close();
  });

  test('(d) o professor vê a entrada como "por validar" na Lista do Dia e consegue validá-la', async ({ browser }) => {
    await definirConfig({ checkin_aluno: 'botao_unico' });

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`);
    await page.locator('input[name="identificador"]').fill(alunos.validarProfessor.email);
    await page.locator('input[type="password"]').fill(alunos.validarProfessor.password);
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page).toHaveURL(`${BASE_URL}/`, { timeout: 15_000 });
    await page.getByRole('button', { name: /dar entrada/i }).click();
    await expect(page.getByText(/estás na sala/i)).toBeVisible({ timeout: 15_000 });
    await context.close();

    const contextProf = await browser.newContext({ storageState: professorState });
    const pageProf = await contextProf.newPage();
    pageProf.on('dialog', (d) => d.accept());
    await pageProf.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const linha = linhaDoAluno(pageProf, alunos.validarProfessor.nome);
    await expect(linha).toContainText(/por validar/i, { timeout: 15_000 });

    await linha.click();
    await expect(linha).toContainText(/chegou/i, { timeout: 15_000 });

    const [linhaDb] = await diarioHojeDoAluno(alunos.validarProfessor.id);
    expect(linhaDb.status).toBe('validado');
    expect(linhaDb.verified_by).toBe(professor.id);

    await contextProf.close();
  });

  test('(e) Gestão: o seletor "Check-in do aluno" grava e persiste; só o admin acede; valores inválidos são ignorados', async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin/gestao?aba=regras`, { waitUntil: 'networkidle' });

    await expect(page.getByText('Check-in do aluno')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^com escolha de disciplina$/i }).click();
    await expect(page.getByText(/^guardado\.$/i)).toBeVisible({ timeout: 10_000 });

    const { data: config1 } = await supabaseAdmin.from('config_centro').select('checkin_aluno').eq('id', centroId).single();
    expect(config1?.checkin_aluno).toBe('disciplina');

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: /^com escolha de disciplina$/i })).toHaveClass(/bg-accent/, { timeout: 15_000 });

    await page.getByRole('button', { name: /^botão único$/i }).click();
    await expect(page.getByText(/^guardado\.$/i)).toBeVisible({ timeout: 10_000 });
    const { data: config2 } = await supabaseAdmin.from('config_centro').select('checkin_aluno').eq('id', centroId).single();
    expect(config2?.checkin_aluno).toBe('botao_unico');

    // modo_presencas (já 'lista_dia', ver beforeAll) viaja no mesmo PATCH só
    // para o corpo nunca ficar vazio — o que importa aqui é que o valor
    // inválido de checkin_aluno é ignorado, não gravado.
    const resInvalido = await context.request.patch(`${BASE_URL}/api/config-centro`, {
      data: { checkin_aluno: 'qualquer-coisa-invalida', modo_presencas: 'lista_dia' },
    });
    expect(resInvalido.ok()).toBe(true);
    const { data: config3 } = await supabaseAdmin.from('config_centro').select('checkin_aluno').eq('id', centroId).single();
    expect(config3?.checkin_aluno).toBe('botao_unico');

    await context.close();

    for (const state of [professorState, secretariaState]) {
      const contextStaff = await browser.newContext({ storageState: state });
      const pageStaff = await contextStaff.newPage();
      await pageStaff.goto(`${BASE_URL}/admin/gestao?aba=regras`, { waitUntil: 'networkidle' });
      await expect(pageStaff).toHaveURL(`${BASE_URL}/admin`);
      await contextStaff.close();
    }
  });

  test('(f) "Próximo teste" abre /agenda com "daqui a N dias" e some sem testes; selo do Material; sem emoji nem degradê', async ({ browser }) => {
    await definirConfig({ checkin_aluno: 'disciplina' });

    const dataTeste = somarDias(hoje, 3);
    const { data: exame, error: errExame } = await supabaseAdmin.from('exams').insert({
      aluno_id: alunos.proximoTeste.id, centro_id: centroId, subject_name: disciplina.name, date: dataTeste,
      topics: `Teste checkin ${SUFIXO}`,
    }).select('id').single();
    if (errExame) throw new Error(`exams: ${errExame.message}`);

    const { error: errMaterial } = await supabaseAdmin.from('material_aluno').insert({
      centro_id: centroId, aluno_id: alunos.proximoTeste.id, professor_id: professor.id, categoria: 'resumo',
      titulo: `Material checkin ${SUFIXO}`, caminho: `${centroId}/${alunos.proximoTeste.id}/checkin-${SUFIXO}.pdf`,
      nome_original: 'checkin.pdf', tipo: 'application/pdf', tamanho: 10,
    });
    if (errMaterial) throw new Error(`material_aluno: ${errMaterial.message}`);

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`);
    await page.locator('input[name="identificador"]').fill(alunos.proximoTeste.email);
    await page.locator('input[type="password"]').fill(alunos.proximoTeste.password);
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page).toHaveURL(`${BASE_URL}/`, { timeout: 15_000 });

    const cartaoTeste = page.getByText(/daqui a 3 dias/i);
    await expect(cartaoTeste).toBeVisible({ timeout: 15_000 });
    await cartaoTeste.click();
    await expect(page).toHaveURL(`${BASE_URL}/agenda`, { timeout: 15_000 });
    await page.goBack({ waitUntil: 'networkidle' });

    await expect(page.getByText(/👋/)).toHaveCount(0);
    const temGradiente = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).some((el) => /\bfrom-|\bto-|gradient/i.test((el as HTMLElement).className || ''))
    );
    expect(temGradiente).toBe(false);

    const materialLink = page.getByRole('link', { name: /material/i });
    await expect(materialLink).toContainText('1');

    await supabaseAdmin.from('exams').delete().eq('id', exame!.id);
    await context.close();

    const contextSemTeste = await browser.newContext();
    const pageSemTeste = await contextSemTeste.newPage();
    await pageSemTeste.goto(`${BASE_URL}/login`);
    await pageSemTeste.locator('input[name="identificador"]').fill(alunos.semTeste.email);
    await pageSemTeste.locator('input[type="password"]').fill(alunos.semTeste.password);
    await pageSemTeste.getByRole('button', { name: /entrar/i }).click();
    await expect(pageSemTeste).toHaveURL(`${BASE_URL}/`, { timeout: 15_000 });
    await expect(pageSemTeste.getByText(/próximo teste/i)).toHaveCount(0);
    await contextSemTeste.close();
  });

  test('(g) 360/390/430px sem scroll horizontal, nos dois modos', async ({ browser }) => {
    for (const modo of ['disciplina', 'botao_unico'] as const) {
      await definirConfig({ checkin_aluno: modo });
      for (const largura of [360, 390, 430]) {
        const context = await browser.newContext({ viewport: { width: largura, height: 850 } });
        const page = await context.newPage();
        await page.goto(`${BASE_URL}/login`);
        await page.locator('input[name="identificador"]').fill(alunos.semTeste.email);
        await page.locator('input[type="password"]').fill(alunos.semTeste.password);
        await page.getByRole('button', { name: /entrar/i }).click();
        await expect(page).toHaveURL(`${BASE_URL}/`, { timeout: 15_000 });
        await page.waitForLoadState('networkidle');

        const semScroll = await semScrollHorizontal(page);
        expect(semScroll, `scrollWidth <= clientWidth falhou a ${largura}px (modo ${modo})`).toBe(true);

        await context.close();
      }
    }
  });
});
