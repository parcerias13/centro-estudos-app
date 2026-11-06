import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { gerarUsernameBase, emailFachada } from '@/lib/username';
import { diaSemanaLisboa, getHojeLisboa, instanteLisboaParaUTC, dataLisboaDe, janelaLarga } from '@/lib/dataLisboa';

dotenv.config({ path: '.env.local' });

// Lista do Dia (~/Desktop/plano-presencas.md) — centro descartável ZZTESTE
// criado via ~/Desktop/gestao-centros/novo-centro.mjs (nunca o demo, nunca o
// real "Trupe Lias"). Sessões reais via signInWithPassword / login na UI;
// a chave de serviço só é usada para provisionar e verificar, nunca para
// exercer as ações que o teste quer validar.

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
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE ListaDoDia ${SUFIXO}`;
const ADMIN_EMAIL = `admin-listadodia-${SUFIXO}@zzteste.invalid`;

type Conta = { id: string; email: string; password: string };
type Aluno = { id: string; nome: string; email: string; password: string };

let centroId: string;
let sala1Id: string;
let disciplina: { id: number; name: string; sala_id: string };
let admin: Conta;
let professor: Conta;
let secretaria: Conta;

let adminState: any;
let professorState: any;
let secretariaState: any;

const diaSemanaHoje = diaSemanaLisboa();
const hoje = getHojeLisboa();
// aluno_horarios só aceita 1-6 (sem domingo) — um dia garantidamente
// diferente de hoje, para o cenário "fora de horário".
const outroDia = diaSemanaHoje === 0 ? 1 : diaSemanaHoje === 1 ? 2 : 1;

let alunos: Record<string, Aluno> = {};

const limpeza: Array<() => unknown> = [];

async function criarStaff(papel: string): Promise<Conta> {
  const email = `listadodia-${papel}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`criar ${papel}: ${error.message}`);
  const id = data.user.id;
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { role: papel, centro_id: centroId } });
  if (metaError) throw new Error(metaError.message);
  const { error: staffError } = await supabaseAdmin.from('staff').insert({ id, email, name: `Staff ${papel} ${SUFIXO}`, role: papel, centro_id: centroId });
  if (staffError) throw new Error(`staff ${papel}: ${staffError.message}`);
  return { id, email, password };
}

async function criarAluno(nomeCurto: string, opts: { horarios?: number[]; telefone?: string | null } = {}): Promise<Aluno> {
  // gerarUsernameBase só usa a 1ª e a última palavra do nome — "Aluno X
  // <sufixo>" colidia sempre em "aluno.<sufixo>" para todos os alunos do
  // teste. Pondo o nome curto primeiro garante um username distinto por aluno.
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
    id, nome, email, ano_escolar: 8, centro_id: centroId, sala_estudo: true,
    telefone_encarregado: opts.telefone === undefined ? '912345678' : opts.telefone,
  });
  if (dbError) throw new Error(`alunos ${nome}: ${dbError.message}`);
  if (opts.horarios && opts.horarios.length > 0) {
    const { error: horarioError } = await supabaseAdmin
      .from('aluno_horarios')
      .insert(opts.horarios.map((d) => ({ aluno_id: id, dia_semana: d, centro_id: centroId })));
    if (horarioError) throw new Error(`aluno_horarios ${nome}: ${horarioError.message}`);
  }
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

// Substitui window.open por um gravador — nenhum separador real abre, e
// conseguimos ler depois o URL final e se foi fechado (caso sem telefone).
async function prepararInterceptorWhatsApp(page: Page) {
  await page.addInitScript(() => {
    (window as any).__waChamadas = [];
    (window as any).open = (url?: string, target?: string) => {
      const win: any = { location: { href: '' }, closed: false, close() { win.closed = true; } };
      (window as any).__waChamadas.push({ url, target, win });
      return win;
    };
  });
}
async function chamadasWhatsApp(page: Page) {
  return page.evaluate(() =>
    ((window as any).__waChamadas || []).map((c: any) => ({ url: c.url, hrefFinal: c.win.location.href, closed: c.win.closed }))
  );
}

async function linhaDoAluno(page: Page, nome: string) {
  return page.locator('div[role="button"]', { hasText: nome }).first();
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

test.describe.configure({ mode: 'serial' });

test.describe('Lista do Dia — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE ListaDoDia'],
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
    sala1Id = sala!.id;

    const { data: disc, error: discError } = await supabaseAdmin
      .from('subjects').insert({ name: `Disciplina ZZTESTE ${SUFIXO}`, centro_id: centroId, sala_id: sala1Id })
      .select('id, name, sala_id').single();
    if (discError) throw new Error(`subjects: ${discError.message}`);
    disciplina = disc as any;

    alunos.esperado = await criarAluno('Esperado', { horarios: [diaSemanaHoje] });
    alunos.foraHorario = await criarAluno('ForaHorario', { horarios: [outroDia] });
    alunos.foraDaLista = await criarAluno('ForaDaLista', { horarios: [] });
    alunos.semTelefone = await criarAluno('SemTelefone', { horarios: [diaSemanaHoje], telefone: null });
    alunos.checkinProprio = await criarAluno('CheckinProprio', { horarios: [diaSemanaHoje] });
    alunos.sessaoAntiga = await criarAluno('SessaoAntiga', { horarios: [diaSemanaHoje] });
    alunos.tapSaida = await criarAluno('TapSaida', { horarios: [diaSemanaHoje] });
    alunos.tapNovaChegada = await criarAluno('TapNovaChegada', { horarios: [diaSemanaHoje] });
    alunos.desfazerChegou = await criarAluno('DesfazerChegou', { horarios: [diaSemanaHoje] });
    alunos.desfazerSaida = await criarAluno('DesfazerSaida', { horarios: [diaSemanaHoje] });
    alunos.desfazerValidado = await criarAluno('DesfazerValidado', { horarios: [diaSemanaHoje] });
    alunos.desfazerToqueAntigo = await criarAluno('DesfazerToqueAntigo', { horarios: [diaSemanaHoje] });
    alunos.realtime = await criarAluno('Realtime', { horarios: [diaSemanaHoje] });
    alunos.realtimeCanal = await criarAluno('RealtimeCanal', { horarios: [diaSemanaHoje] });
    alunos.protecao = await criarAluno('Protecao', { horarios: [diaSemanaHoje] });
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

  test('sessões reais: obter storageState de admin, professor e secretaria', async ({ browser }) => {
    adminState = await loginUI(browser, admin.email, admin.password, '/admin');
    professorState = await loginUI(browser, professor.email, professor.password, '/admin');
    secretariaState = await loginUI(browser, secretaria.email, secretaria.password, '/admin');
    expect(adminState).toBeTruthy();
  });

  test('modo individual (por omissão): ENTRADA MANUAL visível, sem Lista do Dia', async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: /entrada manual/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/na sala.*já saíram/i)).toHaveCount(0);
    await context.close();
  });

  test('Gestão: admin muda para Lista do Dia; professor não vê a Gestão', async ({ browser }) => {
    const contextAdmin = await browser.newContext({ storageState: adminState });
    const pageAdmin = await contextAdmin.newPage();
    await pageAdmin.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await expect(pageAdmin.getByRole('heading', { name: /gestão operacional/i })).toBeVisible({ timeout: 15_000 });
    await pageAdmin.getByRole('button', { name: /^lista do dia$/i }).click();
    await expect(pageAdmin.getByText(/dashboard a mostrar a lista do dia/i)).toBeVisible({ timeout: 10_000 });
    await contextAdmin.close();

    const { data: config } = await supabaseAdmin.from('config_centro').select('modo_presencas').eq('id', centroId).single();
    expect(config?.modo_presencas).toBe('lista_dia');

    const contextProf = await browser.newContext({ storageState: professorState });
    const pageProf = await contextProf.newPage();
    await pageProf.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await expect(pageProf.getByRole('heading', { name: /gestão operacional/i })).toHaveCount(0);
    await contextProf.close();
  });

  test('Dashboard em Lista do Dia: alunos de hoje aparecem como Esperado; sem ENTRADA MANUAL', async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: /entrada manual/i })).toHaveCount(0);
    await expect(page.getByText(/esperados.*na sala.*já saíram/i)).toBeVisible({ timeout: 15_000 });

    const linhaEsperado = await linhaDoAluno(page, alunos.esperado.nome);
    await expect(linhaEsperado).toContainText(/esperado/i);

    await expect(page.getByText(alunos.foraDaLista.nome)).toHaveCount(0);
    await context.close();
  });

  test('um professor e uma secretaria também veem a Lista do Dia', async ({ browser }) => {
    for (const state of [professorState, secretariaState]) {
      const context = await browser.newContext({ storageState: state });
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
      await expect(page.getByText(/esperados.*na sala.*já saíram/i)).toBeVisible({ timeout: 15_000 });
      await context.close();
    }
  });

  test('um toque em Esperado cria a chegada validada, com verified_by', async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const linha = await linhaDoAluno(page, alunos.esperado.nome);
    await linha.click();
    await expect(linha).toContainText(/chegou/i, { timeout: 15_000 });

    const linhasDb = await diarioHojeDoAluno(alunos.esperado.id);
    expect(linhasDb).toHaveLength(1);
    expect(linhasDb[0].status).toBe('validado');
    expect(linhasDb[0].verified_by).toBe(admin.id);
    expect(linhasDb[0].verified_at).not.toBeNull();
    expect(linhasDb[0].checkout_at).toBeNull();
    expect(linhasDb[0].saida).toBeNull();
    await context.close();
  });

  test('um toque em Chegou marca saída (sem checkout_at); outro toque cria nova chegada', async ({ browser }) => {
    // Fixture: já "chegou" hoje (seed direto, sem passar pelo toque anterior).
    const { data: seed, error } = await supabaseAdmin.from('diario_bordo').insert({
      aluno_id: alunos.tapSaida.id, entrada: new Date().toISOString(), status: 'validado', centro_id: centroId,
    }).select('id').single();
    expect(error).toBeNull();

    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const linha = await linhaDoAluno(page, alunos.tapSaida.nome);
    await expect(linha).toContainText(/chegou/i, { timeout: 15_000 });
    await linha.click();
    await expect(linha).toContainText(/saiu/i, { timeout: 15_000 });

    const { data: depoisSaida } = await supabaseAdmin.from('diario_bordo').select('*').eq('id', seed!.id).single();
    expect(depoisSaida!.saida).not.toBeNull();
    expect(depoisSaida!.checkout_at).toBeNull();

    // Terceiro toque (agora em "Saiu") cria uma NOVA linha.
    await linha.click();
    await expect(linha).toContainText(/chegou/i, { timeout: 15_000 });
    const todasHoje = await diarioHojeDoAluno(alunos.tapSaida.id);
    expect(todasHoje.length).toBeGreaterThanOrEqual(2);
    await context.close();
  });

  test('Desfazer: Chegou criado por toque apaga a linha; Saiu volta a pôr saida a nulo', async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const linhaChegou = await linhaDoAluno(page, alunos.desfazerChegou.nome);
    await linhaChegou.click();
    await expect(linhaChegou).toContainText(/chegou/i, { timeout: 15_000 });
    await linhaChegou.getByRole('button', { name: /desfazer/i }).click();
    await expect(linhaChegou).toContainText(/esperado/i, { timeout: 15_000 });
    const resto = await diarioHojeDoAluno(alunos.desfazerChegou.id);
    expect(resto).toHaveLength(0);

    const { error } = await supabaseAdmin.from('diario_bordo').insert({
      aluno_id: alunos.desfazerSaida.id,
      entrada: new Date(Date.now() - 2 * 3600_000).toISOString(),
      saida: new Date().toISOString(),
      status: 'validado', centro_id: centroId,
    });
    expect(error).toBeNull();
    await page.reload({ waitUntil: 'networkidle' });
    const linhaSaiu = await linhaDoAluno(page, alunos.desfazerSaida.nome);
    await expect(linhaSaiu).toContainText(/saiu/i, { timeout: 15_000 });
    await linhaSaiu.getByRole('button', { name: /desfazer/i }).click();
    await expect(linhaSaiu).toContainText(/chegou/i, { timeout: 15_000 });
    const [linhaDb] = await diarioHojeDoAluno(alunos.desfazerSaida.id);
    expect(linhaDb.saida).toBeNull();

    await context.close();
  });

  test('Desfazer em Chegou — chegada validada (não criada pelo toque) volta a "Por validar" e conserva a entrada', async ({ browser }) => {
    // Simula um check-in do próprio aluno, validado pelo staff 40s depois
    // (bem acima dos 30s que distinguem "validação" de "toque que criou").
    const entrada = new Date(Date.now() - 5 * 60_000).toISOString();
    const verified_at = new Date(Date.now() - 5 * 60_000 + 40_000).toISOString();
    const { data: seed, error } = await supabaseAdmin
      .from('diario_bordo')
      .insert({
        aluno_id: alunos.desfazerValidado.id, entrada, status: 'validado',
        verified_at, verified_by: admin.id, centro_id: centroId,
      })
      .select('id')
      .single();
    expect(error).toBeNull();

    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const linha = await linhaDoAluno(page, alunos.desfazerValidado.nome);
    await expect(linha).toContainText(/chegou/i, { timeout: 15_000 });
    await linha.getByRole('button', { name: /desfazer/i }).click();
    await expect(linha).toContainText(/por validar/i, { timeout: 15_000 });

    const { data: depois } = await supabaseAdmin.from('diario_bordo').select('*').eq('id', seed!.id).single();
    expect(depois!.status).not.toBe('validado');
    expect(depois!.verified_at).toBeNull();
    expect(depois!.verified_by).toBeNull();
    expect(new Date(depois!.entrada).toISOString()).toBe(new Date(entrada).toISOString()); // conserva a hora de entrada
    await context.close();
  });

  test('Desfazer em Chegou — toque do staff: apaga sem perguntar se recente, pede confirmação se >= 3 min', async ({ browser }) => {
    // Toque recente do staff (verified_at ~ entrada, há poucos segundos) —
    // apaga sem confirmar.
    const { data: seedRecente, error: erroRecente } = await supabaseAdmin
      .from('diario_bordo')
      .insert({
        aluno_id: alunos.desfazerChegou.id, entrada: new Date().toISOString(), status: 'validado',
        verified_at: new Date().toISOString(), verified_by: admin.id, centro_id: centroId,
      })
      .select('id')
      .single();
    expect(erroRecente).toBeNull();

    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    let dialogRecebido: string | null = null;
    page.on('dialog', (d) => { dialogRecebido = d.message(); d.dismiss(); });
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const linhaRecente = await linhaDoAluno(page, alunos.desfazerChegou.nome);
    await expect(linhaRecente).toContainText(/chegou/i, { timeout: 15_000 });
    await linhaRecente.getByRole('button', { name: /desfazer/i }).click();
    await expect(linhaRecente).toContainText(/esperado/i, { timeout: 15_000 });
    expect(dialogRecebido).toBeNull(); // nenhum confirm apareceu
    const { data: apagadaRecente } = await supabaseAdmin.from('diario_bordo').select('id').eq('id', seedRecente!.id);
    expect(apagadaRecente ?? []).toHaveLength(0);

    // Toque do staff há 4 minutos — pede confirmação; cancelar mantém a
    // linha, confirmar apaga.
    const entradaAntiga = new Date(Date.now() - 4 * 60_000).toISOString();
    const { data: seedAntigo, error: erroAntigo } = await supabaseAdmin
      .from('diario_bordo')
      .insert({
        aluno_id: alunos.desfazerToqueAntigo.id, entrada: entradaAntiga, status: 'validado',
        verified_at: entradaAntiga, verified_by: admin.id, centro_id: centroId,
      })
      .select('id')
      .single();
    expect(erroAntigo).toBeNull();

    await page.reload({ waitUntil: 'networkidle' });
    const linhaAntiga = await linhaDoAluno(page, alunos.desfazerToqueAntigo.nome);
    await expect(linhaAntiga).toContainText(/chegou/i, { timeout: 15_000 });

    dialogRecebido = null;
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => { dialogRecebido = d.message(); d.dismiss(); }); // 1ª vez: cancelar
    await linhaAntiga.getByRole('button', { name: /desfazer/i }).click();
    await page.waitForTimeout(500);
    expect(dialogRecebido).toContain(alunos.desfazerToqueAntigo.nome);
    expect(dialogRecebido).toMatch(/min de estudo/i);
    await expect(linhaAntiga).toContainText(/chegou/i); // continua lá — cancelou
    const { data: aindaLa } = await supabaseAdmin.from('diario_bordo').select('id').eq('id', seedAntigo!.id);
    expect(aindaLa ?? []).toHaveLength(1);

    page.removeAllListeners('dialog');
    page.on('dialog', (d) => d.accept()); // 2ª vez: confirmar
    await linhaAntiga.getByRole('button', { name: /desfazer/i }).click();
    await expect(linhaAntiga).toContainText(/esperado/i, { timeout: 15_000 });
    const { data: apagadaAntiga } = await supabaseAdmin.from('diario_bordo').select('id').eq('id', seedAntigo!.id);
    expect(apagadaAntiga ?? []).toHaveLength(0);

    await context.close();
  });

  test('check-in do próprio aluno aparece como Por validar; um toque valida (e Desfazer rejeita)', async ({ browser }) => {
    const clienteAluno = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error: loginError } = await clienteAluno.auth.signInWithPassword({ email: alunos.checkinProprio.email, password: alunos.checkinProprio.password });
    expect(loginError).toBeNull();
    const { error: insertError } = await clienteAluno.from('diario_bordo').insert({
      aluno_id: alunos.checkinProprio.id, subject_id: disciplina.id, subject_name: disciplina.name,
      sala_id: disciplina.sala_id, entrada: new Date().toISOString(), centro_id: centroId,
      status: 'validado', // o gatilho tem de ignorar isto e forçar 'present'
    });
    expect(insertError).toBeNull();

    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const linha = await linhaDoAluno(page, alunos.checkinProprio.nome);
    await expect(linha).toContainText(/por validar/i, { timeout: 15_000 });

    const [antes] = await diarioHojeDoAluno(alunos.checkinProprio.id);
    expect(antes.status).not.toBe('validado'); // forçado pelo gatilho ('present', nunca o que o aluno pediu)

    await linha.click();
    await expect(linha).toContainText(/chegou/i, { timeout: 15_000 });
    const [depois] = await diarioHojeDoAluno(alunos.checkinProprio.id);
    expect(depois.status).toBe('validado');
    expect(depois.verified_by).toBe(admin.id);

    await context.close();
  });

  test('Desfazer em Por validar rejeita (apaga, com o confirm já existente)', async ({ browser }) => {
    const clienteAluno = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await clienteAluno.auth.signInWithPassword({ email: alunos.realtime.email, password: alunos.realtime.password });
    const { error } = await clienteAluno.from('diario_bordo').insert({
      aluno_id: alunos.realtime.id, entrada: new Date().toISOString(), centro_id: centroId,
    });
    expect(error).toBeNull();

    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const linha = await linhaDoAluno(page, alunos.realtime.nome);
    await expect(linha).toContainText(/por validar/i, { timeout: 15_000 });
    await linha.getByRole('button', { name: /desfazer/i }).click();
    await expect(linha).toContainText(/esperado/i, { timeout: 15_000 });
    const resto = await diarioHojeDoAluno(alunos.realtime.id);
    expect(resto).toHaveLength(0);
    await context.close();
  });

  test('aluno fora do horário mostra o selo; "+ Aluno fora da lista" marca chegada', async ({ browser }) => {
    const { error } = await supabaseAdmin.from('diario_bordo').insert({
      aluno_id: alunos.foraHorario.id, entrada: new Date().toISOString(), status: 'validado', centro_id: centroId,
    });
    expect(error).toBeNull();

    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const linhaForaHorario = await linhaDoAluno(page, alunos.foraHorario.nome);
    await expect(linhaForaHorario).toContainText(/fora de horário/i, { timeout: 15_000 });

    await page.getByRole('button', { name: /aluno fora da lista/i }).click();
    await page.getByPlaceholder(/procurar aluno/i).fill(alunos.foraDaLista.nome);
    await page.getByRole('button', { name: /adicionar/i }).click();
    await expect(page.getByText(/chegada marcada/i)).toBeVisible({ timeout: 10_000 });

    await page.reload({ waitUntil: 'networkidle' });
    const linhaAdicionado = await linhaDoAluno(page, alunos.foraDaLista.nome);
    await expect(linhaAdicionado).toContainText(/chegou/i, { timeout: 15_000 });
    await context.close();
  });

  test('sessão aberta de dias anteriores: aviso e "Fechar sessão" com hora escolhida', async ({ browser }) => {
    const ontem = new Date(`${hoje}T12:00:00.000Z`);
    ontem.setUTCDate(ontem.getUTCDate() - 1);
    const entradaOntem = ontem.toISOString();
    const { data: seed, error } = await supabaseAdmin.from('diario_bordo').insert({
      aluno_id: alunos.sessaoAntiga.id, entrada: entradaOntem, status: 'validado', centro_id: centroId,
    }).select('id').single();
    expect(error).toBeNull();

    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    await expect(page.getByText(/ficou aberta desde/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /fechar sessão/i }).first().click();
    await page.locator('input[type="time"]').fill('18:30');
    await page.getByRole('button', { name: /confirmar/i }).click();
    await expect(page.getByText(/sessão fechada/i)).toBeVisible({ timeout: 10_000 });

    const { data: depois } = await supabaseAdmin.from('diario_bordo').select('saida').eq('id', seed!.id).single();
    expect(depois!.saida).not.toBeNull();
    const diaDaEntrada = dataLisboaDe(entradaOntem);
    const esperado = instanteLisboaParaUTC(diaDaEntrada, '18:30');
    expect(new Date(depois!.saida).toISOString()).toBe(new Date(esperado).toISOString());
    expect(new Date(depois!.saida).getTime()).toBeGreaterThan(new Date(entradaOntem).getTime());
    await context.close();
  });

  test('Msg In/Msg Out: só ativo nos estados certos, marca as flags (window.open intercetado)', async ({ browser }) => {
    const { data: seed, error } = await supabaseAdmin.from('diario_bordo').insert({
      aluno_id: alunos.tapNovaChegada.id, entrada: new Date().toISOString(), status: 'validado', centro_id: centroId,
    }).select('id').single();
    expect(error).toBeNull();

    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await prepararInterceptorWhatsApp(page);
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const linha = await linhaDoAluno(page, alunos.tapNovaChegada.nome);
    await expect(linha).toContainText(/chegou/i, { timeout: 15_000 });
    await expect(linha.getByRole('button', { name: /msg out/i })).toBeDisabled();
    await linha.getByRole('button', { name: /msg in/i }).click();
    await expect(linha.getByRole('button', { name: '✓' }).first()).toBeVisible({ timeout: 10_000 });

    const chamadas = await chamadasWhatsApp(page);
    expect(chamadas.length).toBe(1);
    expect(chamadas[0].url).toContain('wa.me');

    const { data: depois } = await supabaseAdmin.from('diario_bordo').select('msg_in_enviada').eq('id', seed!.id).single();
    expect(depois!.msg_in_enviada).toBe(true);
    await context.close();
  });

  test('Opção "Abrir o WhatsApp ao tocar" — com número abre e marca; sem número avisa e não abre', async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await prepararInterceptorWhatsApp(page);
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    await page.getByRole('checkbox', { name: /abrir o whatsapp ao tocar/i }).check();

    const linhaComTelefone = await linhaDoAluno(page, alunos.realtime.nome); // já ficou "Esperado" (desfeito no teste anterior)
    await linhaComTelefone.click();
    await expect(linhaComTelefone).toContainText(/chegou/i, { timeout: 15_000 });
    const chamadasCom = await chamadasWhatsApp(page);
    expect(chamadasCom.length).toBe(1);
    expect(chamadasCom[0].hrefFinal).toContain('wa.me');
    expect(chamadasCom[0].closed).toBe(false);

    const linhaSemTelefone = await linhaDoAluno(page, alunos.semTelefone.nome);
    await linhaSemTelefone.click();
    await expect(page.getByText(/não tem número de encarregado/i)).toBeVisible({ timeout: 10_000 });
    await expect(linhaSemTelefone).toContainText(/chegou/i, { timeout: 15_000 }); // a presença fica marcada na mesma
    const chamadasSem = await chamadasWhatsApp(page);
    expect(chamadasSem.length).toBe(1); // nenhuma chamada nova além da anterior

    await context.close();
  });

  test('Realtime: um check-in feito noutra sessão atualiza a Lista do Dia sem recarregar', async ({ browser }) => {
    const context = await browser.newContext({ storageState: adminState });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const linha = await linhaDoAluno(page, alunos.realtimeCanal.nome); // aluno dedicado, nunca tocado antes deste teste
    await expect(linha).toContainText(/esperado/i, { timeout: 15_000 });
    // Dá tempo ao canal Realtime (dashboard-realtime-master) de completar o
    // handshake websocket antes do insert — senão o evento pode nascer antes
    // da subscrição estar pronta.
    await page.waitForTimeout(3_000);

    const clienteAluno = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await clienteAluno.auth.signInWithPassword({ email: alunos.realtimeCanal.email, password: alunos.realtimeCanal.password });
    const { error } = await clienteAluno.from('diario_bordo').insert({
      aluno_id: alunos.realtimeCanal.id, entrada: new Date().toISOString(), centro_id: centroId,
    });
    expect(error).toBeNull();

    await expect(linha).toContainText(/por validar/i, { timeout: 30_000 });
    await context.close();
  });

  test('PROTEÇÃO (gatilho em diario_bordo): aluno fica sempre "present", não pode mudar status/entrada, regista saída uma vez', async ({ browser }) => {
    const clienteAluno = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error: loginError } = await clienteAluno.auth.signInWithPassword({ email: alunos.protecao.email, password: alunos.protecao.password });
    expect(loginError).toBeNull();

    const { data: inserted, error: insertError } = await clienteAluno.from('diario_bordo').insert({
      aluno_id: alunos.protecao.id, entrada: new Date().toISOString(), status: 'validado', centro_id: centroId,
    }).select('*').single();
    expect(insertError).toBeNull();
    expect(inserted!.status).not.toBe('validado');
    expect(inserted!.saida).toBeNull();
    expect(inserted!.checkout_at).toBeNull();

    const { error: tentaStatus } = await clienteAluno.from('diario_bordo').update({ status: 'validado' }).eq('id', inserted!.id);
    const { data: depoisStatus } = await supabaseAdmin.from('diario_bordo').select('status').eq('id', inserted!.id).single();
    expect(depoisStatus!.status).not.toBe('validado');
    void tentaStatus; // o gatilho pode recusar com erro OU aceitar sem efeito — o que importa é o valor final

    const entradaOriginal = inserted!.entrada;
    await clienteAluno.from('diario_bordo').update({ entrada: new Date(Date.now() - 999_000).toISOString() }).eq('id', inserted!.id);
    const { data: depoisEntrada } = await supabaseAdmin.from('diario_bordo').select('entrada').eq('id', inserted!.id).single();
    expect(new Date(depoisEntrada!.entrada).toISOString()).toBe(new Date(entradaOriginal).toISOString());

    const { error: erroSaida } = await clienteAluno.from('diario_bordo').update({ saida: new Date().toISOString() }).eq('id', inserted!.id);
    expect(erroSaida).toBeNull();
    const { data: depoisSaida } = await supabaseAdmin.from('diario_bordo').select('saida, checkout_at').eq('id', inserted!.id).single();
    expect(depoisSaida!.saida).not.toBeNull();
    expect(depoisSaida!.checkout_at).toBeNull();
  });

  test('PROTEÇÃO: o ecrã do próprio aluno continua a funcionar (check-in, trocar disciplina, terminar sessão)', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`);
    await page.locator('input[name="identificador"]').fill(alunos.protecao.email);
    await page.locator('input[type="password"]').fill(alunos.protecao.password);
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page).toHaveURL(`${BASE_URL}/`, { timeout: 15_000 });

    // Sessão do teste anterior ainda pode estar aberta (com saída já registada) — recarrega para refletir o estado atual.
    await page.reload({ waitUntil: 'networkidle' });

    if (await page.getByText(/bom estudo/i).count() === 0) {
      await page.getByText(disciplina.name).first().click();
      await expect(page.getByText(/bom estudo/i)).toBeVisible({ timeout: 15_000 });
    }

    await page.getByRole('button', { name: /trocar disciplina/i }).click();
    // Só há uma disciplina no centro ZZTESTE — sem outra para trocar, cancela.
    await page.getByRole('button', { name: /cancelar troca/i }).click();

    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /terminar sessão/i }).click();
    await expect(page.getByText(/bom estudo/i)).toHaveCount(0, { timeout: 15_000 });

    await context.close();
  });
});
