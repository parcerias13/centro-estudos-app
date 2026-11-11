import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Cancelamento de explicações pelo aluno + página "As minhas explicações":
// RPCs reais (minhas_explicacoes, cancelar_explicacao_aluno,
// marcar_avisos_professor_vistos, repor_participacao_aluno) já aplicadas na
// base de dados — este ficheiro só testa a app por cima delas, nunca
// reimplementa a lógica de negócio. Centro descartável ZZTESTE
// (~/Desktop/gestao-centros/novo-centro.mjs), nunca o centro real nem o
// Demo. As sessões usam sempre "agora mais X horas" em Europe/Lisbon — nunca
// horas fixas do dia — para os testes nunca dependerem da hora em que correm.

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
const NOME_ZZTESTE = `ZZTESTE Cancelamento Aluno ${SUFIXO}`;
const ADMIN_EMAIL = `admin-canc-${SUFIXO}@zzteste.invalid`;

type Conta = { email: string; password: string; id: string; nome?: string };

let centroId: string;
let admin: Conta;
let secretaria: Conta;
let prof1: Conta;
let prof2: Conta;
let disciplinaId: number;

let alunoA: Conta; // gratuito / widths
let alunoB: Conta; // tardio
let alunoC: Conta; // grupo (cancela a tempo)
let alunoD: Conta; // grupo (continua / depois cancela tarde)
let alunoE: Conta; // N=48 e N=0
let alunoF: Conta; // erros / isolamento entre alunos

const limpeza: Array<() => unknown> = [];
const explicacaoIds: string[] = [];

function isoDataHoraMaisHoras(horas: number): { data: string; hora: string } {
  const d = new Date(Date.now() + horas * 3600 * 1000);
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const obter = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return { data: `${obter('year')}-${obter('month')}-${obter('day')}`, hora: `${obter('hour')}:${obter('minute')}:00` };
}

async function criarUtilizadorAuth(email: string, password: string, appMetadata: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`criar utilizador ${email}: ${error.message}`);
  const id = data.user.id;
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: appMetadata });
  if (metaError) throw new Error(`app_metadata ${email}: ${metaError.message}`);
  return id;
}

async function criarStaff(papel: string, nome: string, extra: Record<string, unknown> = {}): Promise<Conta> {
  const email = `${nome.toLowerCase().replace(/\s+/g, '-')}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { role: papel, centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: nome, role: papel, centro_id: centroId, ...extra });
  if (error) throw new Error(`criar staff ${nome}: ${error.message}`);
  return { email, password, id, nome };
}

async function criarAluno(nome: string): Promise<Conta> {
  const email = `${nome.toLowerCase().replace(/\s+/g, '-')}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-${email}`,
    data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centroId,
    ativo: true, sala_estudo: false, faz_explicacoes: true, mensalidade_base: 0,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return { email, password, id, nome };
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

async function criarSessao(profId: string, alunoIds: string[], horasAFrente: number): Promise<string> {
  const { data, hora } = isoDataHoraMaisHoras(horasAFrente);
  const { data: exp, error } = await supabaseAdmin
    .from('explicacoes')
    .insert({
      centro_id: centroId, professor_id: profId, disciplina_id: disciplinaId, data, hora_inicio: hora,
      created_by: profId, dado: false, duracao_prevista_horas: 1,
    })
    .select()
    .single();
  if (error) throw new Error(`criar sessao: ${error.message}`);
  explicacaoIds.push(exp.id);
  for (const alunoId of alunoIds) {
    const { error: errAlunos } = await supabaseAdmin.from('explicacoes_alunos').insert({ explicacao_id: exp.id, aluno_id: alunoId });
    if (errAlunos) throw new Error(`associar aluno ${exp.id}: ${errAlunos.message}`);
  }
  return exp.id;
}

async function definirConfig(valores: { aluno_cancela_explicacoes?: boolean; cancelamento_gratis_horas?: number }) {
  const { error } = await supabaseAdmin.from('config_centro').update(valores).eq('id', centroId);
  if (error) throw new Error(`config_centro: ${error.message}`);
}

test.describe.configure({ mode: 'serial' });

test.describe('Cancelamento de explicações pelo aluno — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE Cancelamento'],
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

    secretaria = await criarStaff('secretaria', 'Secretaria Canc');
    prof1 = await criarStaff('professor', 'Prof Canc Um');
    prof2 = await criarStaff('professor', 'Prof Canc Dois');

    const { data: disciplina, error: errDisciplina } = await supabaseAdmin
      .from('subjects').insert({ name: `Disc Canc ${SUFIXO}`, centro_id: centroId }).select('id').single();
    if (errDisciplina) throw new Error(`criar disciplina: ${errDisciplina.message}`);
    disciplinaId = disciplina.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplinaId));

    // Preços por ciclo (3_ciclo = 7.º-9.º ano) — para o valor cobrado deixar
    // de ser 0/null quando uma sessão fica "dada" (mesmo motor de preços do
    // resto da app, nunca reimplementado aqui).
    const { error: errPreco1 } = await supabaseAdmin.from('precos_explicacoes_ciclo').insert({
      centro_id: centroId, ciclo: '3_ciclo', alunos_a_partir_de: 1, tipo: 'fixo', valor: 20,
    });
    if (errPreco1) throw new Error(`preco individual: ${errPreco1.message}`);
    const { error: errPreco2 } = await supabaseAdmin.from('precos_explicacoes_ciclo').insert({
      centro_id: centroId, ciclo: '3_ciclo', alunos_a_partir_de: 2, tipo: 'fixo', valor: 12,
    });
    if (errPreco2) throw new Error(`preco grupo: ${errPreco2.message}`);
    limpeza.push(() => supabaseAdmin.from('precos_explicacoes_ciclo').delete().eq('centro_id', centroId));

    alunoA = await criarAluno('Aluno Canc A');
    alunoB = await criarAluno('Aluno Canc B');
    alunoC = await criarAluno('Aluno Canc C');
    alunoD = await criarAluno('Aluno Canc D');
    alunoE = await criarAluno('Aluno Canc E');
    alunoF = await criarAluno('Aluno Canc F');

    await definirConfig({ aluno_cancela_explicacoes: true, cancelamento_gratis_horas: 24 });
  });

  test.afterAll(async () => {
    if (centroId) {
      await supabaseAdmin.from('explicacoes_alteracoes').delete().eq('centro_id', centroId);
      await supabaseAdmin.from('mensagens').delete().eq('centro_id', centroId);
    }
    if (explicacaoIds.length > 0) {
      await supabaseAdmin.from('explicacoes_alunos').delete().in('explicacao_id', explicacaoIds);
      await supabaseAdmin.from('explicacoes').delete().in('id', explicacaoIds);
    }
    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }
    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
  });

  // --- (a) opção desligada/ligada ---
  test('opção desligada: sem botão e aviso para falar com o centro; ligada: aparece o botão e o prazo gratuito', async ({ browser }: { browser: Browser }) => {
    await definirConfig({ aluno_cancela_explicacoes: false });
    const expOffId = await criarSessao(prof1.id, [alunoA.id], 60);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, alunoA.email, alunoA.password);
    await page.goto(`${BASE_URL}/minhas-explicacoes`, { waitUntil: 'networkidle' });

    const cartaoOff = page.locator('[data-sessao-aluno]', { hasText: `Disc Canc ${SUFIXO}` }).first();
    await expect(cartaoOff).toBeVisible({ timeout: 15_000 });
    await expect(cartaoOff).toContainText('Para cancelar uma explicação, fala com o centro.');
    await expect(cartaoOff.getByRole('button', { name: /cancelar esta sessão/i })).toHaveCount(0);

    await definirConfig({ aluno_cancela_explicacoes: true });
    await page.reload({ waitUntil: 'networkidle' });
    const cartaoOn = page.locator('[data-sessao-aluno]', { hasText: `Disc Canc ${SUFIXO}` }).first();
    await expect(cartaoOn.getByRole('button', { name: /cancelar esta sessão/i })).toBeVisible({ timeout: 15_000 });
    await expect(cartaoOn).toContainText('Cancelamento gratuito até');

    await context.close();

    // limpa esta sessão à parte (não entra nos outros cenários)
    await supabaseAdmin.from('explicacoes_alunos').delete().eq('explicacao_id', expOffId);
    await supabaseAdmin.from('explicacoes').delete().eq('id', expOffId);
  });

  // --- (b) cancelamento a tempo, individual ---
  test('cancelamento a tempo (individual): grátis, aviso ao professor certo, Alterações e mensagem sem "cobrada"', async ({ browser }: { browser: Browser }) => {
    const expId = await criarSessao(prof1.id, [alunoA.id], 60);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, alunoA.email, alunoA.password);
    await page.goto(`${BASE_URL}/minhas-explicacoes`, { waitUntil: 'networkidle' });

    const cartao = page.locator('[data-sessao-aluno]', { hasText: `Disc Canc ${SUFIXO}` }).first();
    await expect(cartao).toBeVisible({ timeout: 15_000 });
    await cartao.getByRole('button', { name: /cancelar esta sessão/i }).click();

    const sheet = page.getByText('Cancelar esta sessão?');
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('O professor, o centro e a tua família são avisados.')).toBeVisible();
    await page.fill('textarea', 'teste a tempo');
    await page.getByRole('button', { name: /confirmar cancelamento/i }).click();

    await expect(page.getByText('Sessão cancelada.')).toBeVisible({ timeout: 10_000 });
    await expect(cartao).toContainText('Cancelada por ti');
    await expect(cartao).not.toContainText('Será cobrada');

    await context.close();

    // DB: sem cobrança, estado cancelada
    const { data: expRow } = await supabaseAdmin.from('explicacoes').select('estado, dado').eq('id', expId).single();
    expect(expRow?.estado).toBe('cancelada');
    const { data: eaRow } = await supabaseAdmin.from('explicacoes_alunos').select('cancelamento_tardio, cancelado_em, valor_cobrado_familia').eq('explicacao_id', expId).single();
    expect(eaRow?.cancelamento_tardio).toBe(false);
    expect(eaRow?.cancelado_em).toBeTruthy();
    expect(Number(eaRow?.valor_cobrado_familia) || 0).toBe(0);

    const { data: alteracao } = await supabaseAdmin.from('explicacoes_alteracoes').select('*').eq('explicacao_id', expId).eq('tipo', 'cancelada_aluno').single();
    expect(alteracao?.contexto?.tardio).toBe(false);
    expect(alteracao?.contexto?.sessao_cancelada).toBe(true);

    const { data: msg } = await supabaseAdmin.from('mensagens').select('payload').eq('explicacao_id', expId).eq('tipo', 'alteracao_explicacao').single();
    expect(msg?.payload?.tipo_alteracao).toBe('cancelada_aluno');
    expect(msg?.payload?.tardio).toBe(false);

    // Professor 1 vê o aviso (não cobrada); professor 2 não.
    const contextProf1 = await browser.newContext();
    const pageProf1 = await contextProf1.newPage();
    await loginUI(pageProf1, prof1.email, prof1.password);
    await pageProf1.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    const bannerProf1 = pageProf1.getByText(/aviso.*de alunos por ler/i);
    await expect(bannerProf1).toBeVisible({ timeout: 15_000 });
    await bannerProf1.click();
    await expect(pageProf1.getByText('Aluno Canc A', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    await expect(pageProf1.getByText('Não cobrada', { exact: false }).first()).toBeVisible();
    await pageProf1.getByRole('button', { name: /marcar como lido/i }).click();
    await expect(pageProf1.getByText(/aviso.*de alunos por ler/i)).toHaveCount(0, { timeout: 10_000 });
    await contextProf1.close();

    const contextProf2 = await browser.newContext();
    const pageProf2 = await contextProf2.newPage();
    await loginUI(pageProf2, prof2.email, prof2.password);
    await pageProf2.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    await expect(pageProf2.getByText(/aviso.*de alunos por ler/i)).toHaveCount(0);
    await contextProf2.close();

    // Direção: Alterações mostra a linha.
    const contextAdmin = await browser.newContext();
    const pageAdmin = await contextAdmin.newPage();
    await loginUI(pageAdmin, admin.email, admin.password);
    await pageAdmin.goto(`${BASE_URL}/admin/alteracoes`, { waitUntil: 'networkidle' });
    await pageAdmin.getByRole('button', { name: /^todas$/i }).click();
    const linha = pageAdmin.locator('tr').filter({ hasText: 'Cancelada pelo aluno' }).filter({ hasText: 'Aluno Canc A' }).first();
    await expect(linha).toBeVisible({ timeout: 15_000 });
    await expect(linha).toContainText('Não cobrada');
    await expect(linha).toContainText('Sessão cancelada');
    await expect(linha.getByRole('button', { name: /reverter/i })).toHaveCount(0);
    await contextAdmin.close();
  });

  // --- (c) cancelamento tardio, individual ---
  test('cancelamento tardio (individual): fica "dada", cobrada, aparece nas contas, mensagem avisa cobrança', async ({ browser }: { browser: Browser }) => {
    const expId = await criarSessao(prof1.id, [alunoB.id], 4);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, alunoB.email, alunoB.password);
    await page.goto(`${BASE_URL}/minhas-explicacoes`, { waitUntil: 'networkidle' });

    const cartao = page.locator('[data-sessao-aluno]', { hasText: `Disc Canc ${SUFIXO}` }).first();
    await expect(cartao).toBeVisible({ timeout: 15_000 });
    await expect(cartao).toContainText('se cancelares, a sessão será cobrada à família');
    await cartao.getByRole('button', { name: /cancelar esta sessão/i }).click();

    await expect(page.getByText('Faltam menos de 24 horas: esta sessão será cobrada à família.')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /confirmar cancelamento/i }).click();

    await expect(page.getByText('Sessão cancelada. Será cobrada à família.')).toBeVisible({ timeout: 10_000 });
    await expect(cartao).toContainText('Cancelada por ti');
    await expect(cartao).toContainText('Será cobrada');
    await context.close();

    const { data: expRow } = await supabaseAdmin.from('explicacoes').select('estado, dado, horas_dadas').eq('id', expId).single();
    expect(expRow?.estado).toBe('ativa');
    expect(expRow?.dado).toBe(true);
    expect(Number(expRow?.horas_dadas)).toBe(1);

    const { data: eaRow } = await supabaseAdmin.from('explicacoes_alunos').select('cancelamento_tardio, valor_cobrado_familia').eq('explicacao_id', expId).single();
    expect(eaRow?.cancelamento_tardio).toBe(true);
    expect(Number(eaRow?.valor_cobrado_familia)).toBe(20); // preço individual do 3.º ciclo

    const { data: msg } = await supabaseAdmin.from('mensagens').select('payload').eq('explicacao_id', expId).eq('tipo', 'alteracao_explicacao').single();
    expect(msg?.payload?.tardio).toBe(true);
  });

  // --- (d) grupo de 2 ---
  test('grupo: quem cancela a tempo paga 0 e a sessão continua; quem fica paga o preço de grupo', async ({ browser }: { browser: Browser }) => {
    const expId = await criarSessao(prof1.id, [alunoC.id, alunoD.id], 60);

    const sessaoC = await sessaoComo(alunoC);
    const rCancelar = await sessaoC.rpc('cancelar_explicacao_aluno', { p_explicacao: expId, p_motivo: null });
    expect(rCancelar.error).toBeNull();
    expect(rCancelar.data).toMatchObject({ tardio: false, cobrada: false, sessao_cancelada: false });

    const { data: expAntes } = await supabaseAdmin.from('explicacoes').select('estado, dado').eq('id', expId).single();
    expect(expAntes?.estado).toBe('ativa');
    expect(expAntes?.dado).toBe(false);

    // professor dá a sessão normalmente (fluxo normal da app, não desta feature)
    const { error: errDar } = await supabaseAdmin.from('explicacoes').update({ dado: true, horas_dadas: 1 }).eq('id', expId);
    expect(errDar).toBeNull();

    const { data: linhasAlunos } = await supabaseAdmin
      .from('explicacoes_alunos').select('aluno_id, cancelamento_tardio, valor_cobrado_familia').eq('explicacao_id', expId);
    const linhaC = linhasAlunos!.find((l: any) => l.aluno_id === alunoC.id);
    const linhaD = linhasAlunos!.find((l: any) => l.aluno_id === alunoD.id);
    expect(Number(linhaC?.valor_cobrado_familia) || 0).toBe(0);
    expect(Number(linhaD?.valor_cobrado_familia)).toBe(12); // preço de grupo
  });

  test('grupo: quem cancela tarde paga o preço de grupo na mesma', async () => {
    const expId = await criarSessao(prof1.id, [alunoC.id, alunoD.id], 4);

    const sessaoC = await sessaoComo(alunoC);
    const rCancelar = await sessaoC.rpc('cancelar_explicacao_aluno', { p_explicacao: expId, p_motivo: null });
    expect(rCancelar.error).toBeNull();
    expect(rCancelar.data).toMatchObject({ tardio: true, cobrada: true });

    const { data: expAntes } = await supabaseAdmin.from('explicacoes').select('estado, dado').eq('id', expId).single();
    // sessão continua marcada para D — nunca é o cancelamento de um único
    // aluno em grupo a decidir que a sessão foi dada.
    expect(expAntes?.dado).toBe(false);

    const { error: errDar } = await supabaseAdmin.from('explicacoes').update({ dado: true, horas_dadas: 1 }).eq('id', expId);
    expect(errDar).toBeNull();

    const { data: linhaC } = await supabaseAdmin
      .from('explicacoes_alunos').select('valor_cobrado_familia, cancelamento_tardio').eq('explicacao_id', expId).eq('aluno_id', alunoC.id).single();
    expect(linhaC?.cancelamento_tardio).toBe(true);
    expect(Number(linhaC?.valor_cobrado_familia)).toBe(12); // preço de grupo, mesmo tendo cancelado
  });

  // --- (e) N=48 e N=0 ---
  test('N=48h: sessão a 30h é cobrada; N=0h: nunca é cobrada', async () => {
    await definirConfig({ cancelamento_gratis_horas: 48 });
    const exp30h = await criarSessao(prof1.id, [alunoE.id], 30);
    const sessaoE = await sessaoComo(alunoE);
    const r30 = await sessaoE.rpc('cancelar_explicacao_aluno', { p_explicacao: exp30h, p_motivo: null });
    expect(r30.data).toMatchObject({ tardio: true, cobrada: true });

    await definirConfig({ cancelamento_gratis_horas: 0 });
    const exp1h = await criarSessao(prof1.id, [alunoE.id], 1);
    const r1h = await sessaoE.rpc('cancelar_explicacao_aluno', { p_explicacao: exp1h, p_motivo: null });
    expect(r1h.data).toMatchObject({ tardio: false, cobrada: false });

    await definirConfig({ cancelamento_gratis_horas: 24 });
  });

  // --- (f) erros em português ---
  test('erros em português: já cancelada, sessão de outro aluno, sessão já começada, opção desligada', async () => {
    const expF = await criarSessao(prof1.id, [alunoF.id], 60);
    const sessaoF = await sessaoComo(alunoF);

    const primeira = await sessaoF.rpc('cancelar_explicacao_aluno', { p_explicacao: expF, p_motivo: null });
    expect(primeira.error).toBeNull();
    const segunda = await sessaoF.rpc('cancelar_explicacao_aluno', { p_explicacao: expF, p_motivo: null });
    expect(segunda.error?.message).toMatch(/já cancelaste/i);

    const expOutro = await criarSessao(prof1.id, [alunoA.id], 60);
    const sessaoA = await sessaoComo(alunoA);
    const rOutro = await sessaoF.rpc('cancelar_explicacao_aluno', { p_explicacao: expOutro, p_motivo: null });
    expect(rOutro.error?.message).toMatch(/não é tua/i);
    await supabaseAdmin.from('explicacoes_alunos').delete().eq('explicacao_id', expOutro);
    await supabaseAdmin.from('explicacoes').delete().eq('id', expOutro);

    const expPassada = await criarSessao(prof1.id, [alunoF.id], -2);
    const rPassada = await sessaoF.rpc('cancelar_explicacao_aluno', { p_explicacao: expPassada, p_motivo: null });
    expect(rPassada.error?.message).toMatch(/já começou/i);

    await definirConfig({ aluno_cancela_explicacoes: false });
    const expDesligado = await criarSessao(prof1.id, [alunoF.id], 60);
    const rDesligado = await sessaoF.rpc('cancelar_explicacao_aluno', { p_explicacao: expDesligado, p_motivo: null });
    expect(rDesligado.error?.message).toMatch(/não permite cancelar/i);
    await definirConfig({ aluno_cancela_explicacoes: true });
  });

  // --- (g) repor pela direção ---
  test('admin repõe o aluno antes de a sessão começar; recusado depois de começar', async ({ browser }: { browser: Browser }) => {
    const expFuturo = await criarSessao(prof1.id, [alunoA.id], 60);
    const sessaoA = await sessaoComo(alunoA);
    const rCancelar = await sessaoA.rpc('cancelar_explicacao_aluno', { p_explicacao: expFuturo, p_motivo: null });
    expect(rCancelar.error).toBeNull();

    const contextAdmin = await browser.newContext();
    const pageAdmin = await contextAdmin.newPage();
    await loginUI(pageAdmin, admin.email, admin.password);
    await pageAdmin.goto(`${BASE_URL}/admin/alteracoes`, { waitUntil: 'networkidle' });
    await pageAdmin.getByRole('button', { name: /^todas$/i }).click();
    const linha = pageAdmin.locator('tr').filter({ hasText: 'Cancelada pelo aluno' }).filter({ hasText: 'Aluno Canc A' }).first();
    await expect(linha).toBeVisible({ timeout: 15_000 });
    pageAdmin.once('dialog', (d) => d.accept());
    await linha.getByRole('button', { name: /repor aluno/i }).click();
    await expect(pageAdmin.getByText(/reposto nesta sessão/i)).toBeVisible({ timeout: 10_000 });
    await contextAdmin.close();

    const { data: eaRow } = await supabaseAdmin.from('explicacoes_alunos').select('cancelado_em').eq('explicacao_id', expFuturo).single();
    expect(eaRow?.cancelado_em).toBeNull();

    // depois de começar: simula uma sessão passada já cancelada (escrita
    // direta, chave de serviço, só para montar o estado — nunca contorna a
    // RPC em produção) e confirma que repor_participacao_aluno recusa.
    const expPassada = await criarSessao(prof1.id, [alunoA.id], -2);
    await supabaseAdmin.from('explicacoes_alunos').update({ cancelado_em: new Date().toISOString(), cancelamento_tardio: true }).eq('explicacao_id', expPassada).eq('aluno_id', alunoA.id);
    const sessaoAdmin = await sessaoComo(admin);
    const rRecusado = await sessaoAdmin.rpc('repor_participacao_aluno', { p_explicacao: expPassada, p_aluno: alunoA.id });
    expect(rRecusado.error?.message).toMatch(/já começou/i);
  });

  // --- (h) isolamento entre papéis e entre alunos ---
  test('isolamento: um aluno não vê/cancela sessões doutro; professor/secretaria não podem chamar cancelar_explicacao_aluno', async () => {
    const expIsolado = await criarSessao(prof1.id, [alunoB.id], 60);
    const sessaoA = await sessaoComo(alunoA);
    const lista = await sessaoA.rpc('minhas_explicacoes');
    expect((lista.data || []).some((s: any) => s.explicacao_id === expIsolado)).toBe(false);

    const rCancelarAlheia = await sessaoA.rpc('cancelar_explicacao_aluno', { p_explicacao: expIsolado, p_motivo: null });
    expect(rCancelarAlheia.error?.message).toMatch(/não é tua/i);

    const sessaoProf = await sessaoComo(prof1);
    const rProf = await sessaoProf.rpc('cancelar_explicacao_aluno', { p_explicacao: expIsolado, p_motivo: null });
    expect(rProf.error?.message).toMatch(/sem permissão/i);

    const sessaoSecretaria = await sessaoComo(secretaria);
    const rSecretaria = await sessaoSecretaria.rpc('cancelar_explicacao_aluno', { p_explicacao: expIsolado, p_motivo: null });
    expect(rSecretaria.error?.message).toMatch(/sem permissão/i);
  });

  // --- (i) interruptor da Gestão ---
  test('Gestão: o interruptor grava os dois valores; professor e secretaria não veem a secção', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });

    const secao = page.getByText('Cancelamento de explicações pelos alunos').locator('..').locator('..');
    await expect(secao).toBeVisible({ timeout: 15_000 });

    const toggle = page.getByText('Os alunos podem cancelar explicações', { exact: true }).locator('..').getByRole('button');
    await toggle.click();
    await expect(page.getByText(/cancelamento pelos alunos|cancelar explicações/i)).toBeVisible({ timeout: 10_000 });

    const inputHoras = page.getByText('Cancelamento gratuito até (horas antes)').locator('..').locator('input[type="number"]');
    await inputHoras.fill('10');
    await page.getByRole('button', { name: /^guardar$/i }).click();
    await expect(page.getByText('Prazo de cancelamento gratuito atualizado.')).toBeVisible({ timeout: 10_000 });
    await context.close();

    const { data: config } = await supabaseAdmin.from('config_centro').select('aluno_cancela_explicacoes, cancelamento_gratis_horas').eq('id', centroId).single();
    expect(config?.cancelamento_gratis_horas).toBe(10);
    // devolve ao valor usado no resto da suite
    await definirConfig({ aluno_cancela_explicacoes: true, cancelamento_gratis_horas: 24 });

    for (const conta of [prof1, secretaria]) {
      const context2 = await browser.newContext();
      const page2 = await context2.newPage();
      await loginUI(page2, conta.email, conta.password);
      await page2.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
      await expect(page2.getByText('Cancelamento de explicações pelos alunos')).toHaveCount(0);
      await context2.close();
    }
  });

  // --- (j) larguras sem scroll horizontal ---
  test('360/390/430px sem scroll horizontal em "As minhas explicações" e na folha de confirmação', async ({ browser }: { browser: Browser }) => {
    const expLargura = await criarSessao(prof1.id, [alunoA.id], 60);
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, alunoA.email, alunoA.password);

    for (const largura of [360, 390, 430]) {
      await page.setViewportSize({ width: largura, height: 850 });
      await page.goto(`${BASE_URL}/minhas-explicacoes`, { waitUntil: 'networkidle' });
      const semScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(semScroll, `scrollWidth <= clientWidth falhou a ${largura}px (lista)`).toBe(true);

      const cartao = page.locator('[data-sessao-aluno]').filter({ has: page.getByRole('button', { name: /cancelar esta sessão/i }) }).first();
      await cartao.getByRole('button', { name: /cancelar esta sessão/i }).click();
      await expect(page.getByText('Cancelar esta sessão?')).toBeVisible({ timeout: 10_000 });
      const semScrollSheet = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(semScrollSheet, `scrollWidth <= clientWidth falhou a ${largura}px (folha)`).toBe(true);
      await page.getByRole('button', { name: /^voltar$/i }).click();
    }

    await context.close();
    await supabaseAdmin.from('explicacoes_alunos').delete().eq('explicacao_id', expLargura);
    await supabaseAdmin.from('explicacoes').delete().eq('id', expLargura);
  });
});
