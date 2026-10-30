import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Explicações fixas (séries) + ações sobre sessões (cancelar/mudar/trocar/
// repor via alterar_sessao, pela interface) e "Marcar as de hoje como
// dadas". Centro descartável ZZTESTE (~/Desktop/gestao-centros/novo-
// centro.mjs), nunca o centro real ou o demo — essa recusa já vem do
// próprio script.

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

function hojeLisboaISO(): string {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const obter = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${obter('year')}-${obter('month')}-${obter('day')}`;
}

// Nunca toISOString() aqui — converte para UTC e em DST perde um dia.
function addDiasISO(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + dias);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function diaSemanaISODOW(iso: string): number {
  const d = new Date(`${iso}T00:00:00`);
  return d.getDay() === 0 ? 7 : d.getDay();
}

// Segunda-feira da semana corrente (Europe/Lisbon) — a mesma semana que
// /admin/explicacoes mostra por omissão ao abrir. As sessões manuais dos
// testes de ações (cancelar/mudar/trocar, sessão dada) usam datas DENTRO
// desta semana (nunca HOJE + N dias, que pode cair na semana seguinte) —
// para a página mostrar a sessão sem ser preciso navegar de semana.
function segundaDaSemanaAtual(hojeISO: string): string {
  const diaSemana = diaSemanaISODOW(hojeISO);
  return addDiasISO(hojeISO, -(diaSemana - 1));
}

const DIA_SEMANA_LABEL: Record<number, string> = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb', 7: 'Dom' };

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE Series ${SUFIXO}`;
const ADMIN_EMAIL = `admin-series-${SUFIXO}@zzteste.invalid`;
const DISCIPLINA_NOME = `Disciplina Series ${SUFIXO}`;
const HOJE = hojeLisboaISO();
const SEGUNDA = segundaDaSemanaAtual(HOJE);
// Semana seguinte à de hoje — garante datas sempre no futuro (alterar_sessao
// recusa repor/cancelar/mudar uma sessão no passado) e sempre dentro da
// MESMA semana entre si, para só ser preciso navegar uma vez na UI.
const PROXIMA_SEGUNDA = addDiasISO(SEGUNDA, 7);

type Conta = { email: string; password: string; id: string };

let centroId: string;
let admin: Conta;
let secretaria: Conta;
let prof1: Conta;
let prof2: Conta;
let prof3: Conta;
let disciplinaId: number;
let alunoM1Id: string;
let alunoM2Id: string;
let alunoHojeId: string;
let alunoSerieId: string;
let serieId: string;

const limpeza: Array<() => unknown> = [];

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
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: nome, role: papel, centro_id: centroId });
  if (error) throw new Error(`criar staff ${nome}: ${error.message}`);
  return { email, password, id };
}

async function criarAluno(nome: string): Promise<string> {
  const sufixo = `${SUFIXO}-${randomInt(100000, 999999)}`;
  const email = `aluno-series-${sufixo}@zzteste.invalid`;
  const id = await criarUtilizadorAuth(email, gerarPasswordSegura(), { centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-series-${sufixo}@zzteste.invalid`,
    data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centroId, ativo: true, sala_estudo: false, faz_explicacoes: true, mensalidade_base: 0,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return id;
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

async function criarExplicacaoManual(professorId: string, data: string, hora: string, alunoIds: string[], extra: Record<string, unknown> = {}) {
  const { data: exp, error } = await supabaseAdmin.from('explicacoes').insert({
    centro_id: centroId, professor_id: professorId, disciplina_id: disciplinaId, data, hora_inicio: hora, created_by: professorId, ...extra,
  }).select().single();
  if (error) throw new Error(`criar explicacao ${data} ${hora}: ${error.message}`);
  const linhas = alunoIds.map((aluno_id) => ({ explicacao_id: exp.id, aluno_id }));
  const { error: errAlunos } = await supabaseAdmin.from('explicacoes_alunos').insert(linhas);
  if (errAlunos) throw new Error(`associar alunos ${exp.id}: ${errAlunos.message}`);
  return exp.id as string;
}

test.describe.configure({ mode: 'serial' });

test.describe('Séries de explicações e ações sobre sessões — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE Series'],
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

    secretaria = await criarStaff('secretaria', 'Secretaria Series');
    prof1 = await criarStaff('professor', 'Prof Series Um');
    prof2 = await criarStaff('professor', 'Prof Series Dois');
    prof3 = await criarStaff('professor', 'Prof Series Hoje');

    const { data: disciplina, error: errDisciplina } = await supabaseAdmin
      .from('subjects').insert({ name: DISCIPLINA_NOME, centro_id: centroId }).select('id').single();
    if (errDisciplina) throw new Error(`criar disciplina: ${errDisciplina.message}`);
    disciplinaId = disciplina.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplinaId));

    alunoM1Id = await criarAluno('Aluno Series Mudar Um');
    alunoM2Id = await criarAluno('Aluno Series Mudar Dois');
    alunoHojeId = await criarAluno('Aluno Series Hoje');
    alunoSerieId = await criarAluno('Aluno Series Fixa');
  });

  test.afterAll(async () => {
    if (centroId) {
      await supabaseAdmin.from('explicacoes_alteracoes').delete().eq('centro_id', centroId);
      // apagar-centro.mjs ainda não conhece as tabelas de séries — apaga-as
      // primeiro, à mão, para a FK nunca bloquear o apagar do centro.
      const { data: seriesDoCentro } = await supabaseAdmin.from('series_explicacoes').select('id').eq('centro_id', centroId);
      const idsSeries = (seriesDoCentro || []).map((s: any) => s.id);
      if (idsSeries.length > 0) {
        await supabaseAdmin.from('series_explicacoes_alunos').delete().in('serie_id', idsSeries);
        await supabaseAdmin.from('series_explicacoes_pausas').delete().in('serie_id', idsSeries);
        await supabaseAdmin.from('explicacoes').delete().in('serie_id', idsSeries);
        await supabaseAdmin.from('series_explicacoes').delete().in('id', idsSeries);
      }
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

  test('professor: cancelar → repor → mudar hora/dia → trocar professor pela interface; aviso com N alunos e mensagem à família uma por aluno', async ({ browser }: { browser: Browser }) => {
    const dataOriginal = addDiasISO(PROXIMA_SEGUNDA, 1);
    const expId = await criarExplicacaoManual(prof1.id, dataOriginal, '10:00:00', [alunoM1Id, alunoM2Id]);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    await page.getByLabel('Semana seguinte').click();

    const linha = page.locator('[data-sessao-linha="1"]').filter({ hasText: DISCIPLINA_NOME });
    await expect(linha).toBeVisible({ timeout: 15_000 });

    // --- cancelar ---
    await linha.click();
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByText('As famílias dos 2 alunos recebem um aviso automático. O motivo só a direção o vê.')).toBeVisible();
    await page.getByLabel('Motivo').fill('motivo de teste — só a direção vê');
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(linha).toHaveAttribute('data-sessao-estado', 'cancelada', { timeout: 15_000 });
    await expect(page.getByText(/Esta semana: 0 sessões/)).toBeVisible({ timeout: 15_000 });

    // --- repor ---
    await linha.click();
    await page.getByRole('button', { name: 'Repor sessão' }).click();
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(linha).toHaveAttribute('data-sessao-estado', 'ativa', { timeout: 15_000 });
    await expect(page.getByText(/Esta semana: 1 sessão\b/)).toBeVisible({ timeout: 15_000 });

    // --- mudar hora e dia ---
    const novaData = addDiasISO(PROXIMA_SEGUNDA, 2);
    await linha.click();
    await page.getByRole('button', { name: 'Mudar hora ou dia' }).click();
    await page.getByLabel('Nova data').fill(novaData);
    await page.getByLabel('Nova hora').fill('11:30');
    await page.getByRole('button', { name: 'Confirmar' }).click();

    const linhaNovaData = page.locator(`#dia-grupo-${novaData}`).locator('[data-sessao-linha="1"]').filter({ hasText: DISCIPLINA_NOME });
    await expect(linhaNovaData).toBeVisible({ timeout: 15_000 });

    // --- trocar professor ---
    await linhaNovaData.click();
    await page.getByRole('button', { name: 'Trocar professor' }).click();
    await page.getByLabel('Novo professor').selectOption({ label: 'Prof Series Dois' });
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(linhaNovaData).toHaveCount(0, { timeout: 15_000 });

    await context.close();

    const { data: expRow } = await supabaseAdmin.from('explicacoes').select('professor_id, data, hora_inicio').eq('id', expId).single();
    expect(expRow?.professor_id).toBe(prof2.id);
    expect(expRow?.data).toBe(novaData);
    expect(expRow?.hora_inicio?.slice(0, 5)).toBe('11:30');

    const { data: alteracoes } = await supabaseAdmin.from('explicacoes_alteracoes').select('id, tipo').eq('explicacao_id', expId);
    expect((alteracoes || []).length).toBeGreaterThanOrEqual(4);
    const alteracaoProfessor = (alteracoes || []).find((a: any) => a.tipo === 'professor');
    expect(alteracaoProfessor).toBeTruthy();

    const { data: mensagensTodas } = await supabaseAdmin.from('mensagens').select('aluno_id, payload').eq('centro_id', centroId).eq('tipo', 'alteracao_explicacao');
    const mensagensTroca = (mensagensTodas || []).filter((m: any) => m.payload?.alteracao_id === alteracaoProfessor!.id);
    expect(mensagensTroca.length).toBe(2);
    expect(new Set(mensagensTroca.map((m: any) => m.aluno_id))).toEqual(new Set([alunoM1Id, alunoM2Id]));
  });

  test('sessão já dada: cancelar/mudar/repor desativados; só o admin troca de professor', async ({ browser }: { browser: Browser }) => {
    await criarExplicacaoManual(prof1.id, addDiasISO(SEGUNDA, 3), '09:00:00', [alunoM1Id], { dado: true, horas_dadas: 1 });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });

    const linha = page.locator('[data-sessao-linha="1"][data-sessao-dado="true"]').filter({ hasText: DISCIPLINA_NOME });
    await expect(linha).toBeVisible({ timeout: 15_000 });
    await linha.click();
    await expect(page.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Mudar hora ou dia' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Trocar professor' })).toBeDisabled();
    await context.close();

    const contextAdmin = await browser.newContext();
    const pageAdmin = await contextAdmin.newPage();
    await loginUI(pageAdmin, admin.email, admin.password);
    await pageAdmin.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    await pageAdmin.locator('select').first().selectOption({ label: 'Prof Series Um' });
    const linhaAdmin = pageAdmin.locator('[data-sessao-linha="1"][data-sessao-dado="true"]').filter({ hasText: DISCIPLINA_NOME });
    await expect(linhaAdmin).toBeVisible({ timeout: 15_000 });
    await linhaAdmin.click();
    await expect(pageAdmin.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await expect(pageAdmin.getByRole('button', { name: 'Trocar professor' })).toBeEnabled();
    await contextAdmin.close();
  });

  test('"Marcar as de hoje como dadas": define as horas pela duração prevista e deixa de fora as sessões sem duração', async ({ browser }: { browser: Browser }) => {
    const expComDuracao = await criarExplicacaoManual(prof3.id, HOJE, '14:00:00', [alunoHojeId], { duracao_prevista_horas: 1.5 });
    const expSemDuracao = await criarExplicacaoManual(prof3.id, HOJE, '16:00:00', [alunoHojeId]);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof3.email, prof3.password);
    await page.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /marcar as de hoje como dadas/i }).click();
    await expect(page.getByText(/1 sessão marcada como dadas\.|sessão marcada como dadas\./i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/1 ficou de fora \(sem duração definida\)/i)).toBeVisible({ timeout: 15_000 });

    await context.close();

    const { data: linhas } = await supabaseAdmin.from('explicacoes').select('id, dado, horas_dadas').in('id', [expComDuracao, expSemDuracao]);
    const comDuracao = (linhas || []).find((l: any) => l.id === expComDuracao);
    const semDuracao = (linhas || []).find((l: any) => l.id === expSemDuracao);
    expect(comDuracao?.dado).toBe(true);
    expect(Number(comDuracao?.horas_dadas)).toBe(1.5);
    expect(semDuracao?.dado).toBe(false);
  });

  test('admin: cria série pela interface — sessões nascem; abrir Explicações duas vezes não duplica', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/explicacoes/series`, { waitUntil: 'networkidle' });

    await page.getByLabel('Nova série').click();
    await page.getByLabel('Professor').selectOption({ label: 'Prof Series Um' });
    await page.getByPlaceholder('Pesquisar aluno...').fill('Aluno Series Fixa');
    await page.getByRole('button', { name: /Aluno Series Fixa/ }).click();
    const diaLabel = DIA_SEMANA_LABEL[diaSemanaISODOW(HOJE)];
    await page.getByRole('button', { name: diaLabel, exact: true }).click();
    await page.getByLabel('Disciplina (opcional)').selectOption({ label: DISCIPLINA_NOME });
    await page.getByLabel('Hora de início').fill('09:00');
    await page.getByLabel('Duração (horas)').fill('1');
    await page.getByLabel('Início', { exact: true }).fill(HOJE);
    await page.getByRole('button', { name: 'Criar Série' }).click();
    await expect(page.getByText('Série criada.')).toBeVisible({ timeout: 15_000 });

    await context.close();

    const { data: seriesCriadas, error } = await supabaseAdmin
      .from('series_explicacoes').select('id').eq('centro_id', centroId).eq('professor_id', prof1.id);
    expect(error).toBeNull();
    expect(seriesCriadas?.length).toBe(1);
    serieId = seriesCriadas![0].id;

    const { count: n0 } = await supabaseAdmin.from('explicacoes').select('id', { count: 'exact', head: true }).eq('serie_id', serieId);
    expect(n0 ?? 0).toBeGreaterThan(0);

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await loginUI(page2, admin.email, admin.password);
    await page2.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    await page2.locator('select').first().selectOption({ label: 'Prof Series Um' });
    await page2.waitForTimeout(500);
    const { count: n1 } = await supabaseAdmin.from('explicacoes').select('id', { count: 'exact', head: true }).eq('serie_id', serieId);
    expect(n1).toBe(n0);

    await page2.reload({ waitUntil: 'networkidle' });
    await page2.waitForTimeout(500);
    const { count: n2 } = await supabaseAdmin.from('explicacoes').select('id', { count: 'exact', head: true }).eq('serie_id', serieId);
    expect(n2).toBe(n0);

    // O reload reinicia o componente (volta a selecionar o primeiro
    // professor por omissão) — escolhe "Prof Series Um" outra vez antes de
    // procurar a sessão de hoje na agenda dele.
    await page2.locator('select').first().selectOption({ label: 'Prof Series Um' });
    const hojeRow = page2.locator('[data-sessao-linha="1"]').filter({ hasText: DISCIPLINA_NOME }).filter({ hasText: 'Fixa' });
    await expect(hojeRow.first()).toBeVisible({ timeout: 15_000 });

    await context2.close();
  });

  test('admin: pausa a série (aviso certo, sessões canceladas, uma só mensagem por aluno) e termina a partir de uma data (futuras desaparecem, sem duplicar)', async ({ browser }: { browser: Browser }) => {
    const pausarDe = HOJE;
    const pausarAte = addDiasISO(HOJE, 7);
    const { count: contagemEsperada } = await supabaseAdmin
      .from('explicacoes').select('id', { count: 'exact', head: true })
      .eq('serie_id', serieId).eq('estado', 'ativa').eq('dado', false)
      .gte('data', pausarDe).lte('data', pausarAte);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/explicacoes/series`, { waitUntil: 'networkidle' });

    const cartao = page.locator('[data-serie-cartao]');
    await cartao.getByRole('button', { name: /pausar/i }).click();
    await page.getByLabel('Pausar de').fill(pausarDe);
    await page.getByLabel('Pausar até').fill(pausarAte);
    await expect(page.getByText(new RegExp(`Isto vai cancelar ${contagemEsperada} sess`))).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/avisar 1 famílias, com uma só mensagem por aluno/)).toBeVisible();

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Confirmar Pausa' }).click();
    await expect(page.getByText('Série pausada.')).toBeVisible({ timeout: 15_000 });

    const { data: canceladas } = await supabaseAdmin
      .from('explicacoes').select('id, estado').eq('serie_id', serieId).gte('data', pausarDe).lte('data', pausarAte);
    expect((canceladas || []).every((c: any) => c.estado === 'cancelada')).toBe(true);
    expect((canceladas || []).length).toBe(contagemEsperada);

    const { data: alteracoesPausa } = await supabaseAdmin
      .from('explicacoes_alteracoes').select('id, motivo, explicacao_id').eq('centro_id', centroId).eq('tipo', 'cancelada')
      .in('explicacao_id', (canceladas || []).map((c: any) => c.id));
    expect((alteracoesPausa || []).length).toBe(contagemEsperada);
    expect((alteracoesPausa || []).every((a: any) => a.motivo?.startsWith('Pausa de'))).toBe(true);

    const { data: mensagensPausa } = await supabaseAdmin
      .from('mensagens').select('id, payload').eq('centro_id', centroId).eq('aluno_id', alunoSerieId).eq('tipo', 'alteracao_explicacao');
    const mensagensDestaPausa = (mensagensPausa || []).filter((m: any) => m.payload?.tipo_alteracao === 'pausa');
    expect(mensagensDestaPausa.length).toBe(1);
    expect(Number(mensagensDestaPausa[0].payload?.sessoes)).toBe(contagemEsperada);

    // Item H: a lista de Alterações mostra "Avisadas em resumo (pausa)" em
    // vez de "Sem aviso à família" nestas linhas de cancelamento.
    await page.goto(`${BASE_URL}/admin/alteracoes`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^todas$/i }).click();
    const linhaPausa = page.locator('tr', { hasText: DISCIPLINA_NOME }).filter({ hasText: 'Pausa de' }).first();
    await expect(linhaPausa).toBeVisible({ timeout: 15_000 });
    await expect(linhaPausa).toContainText('Avisadas em resumo (pausa)');

    // Item H: o cartão fixo da pausa, nas Mensagens, usa o singular/plural certo.
    await page.goto(`${BASE_URL}/admin/mensagens`, { waitUntil: 'networkidle' });
    await page.getByText('Aluno Series Fixa').click();
    await expect(page.getByText('Pausa nas explicações')).toBeVisible({ timeout: 15_000 });
    const sufixoSessoes = contagemEsperada === 1 ? '1 sessão' : `${contagemEsperada} sessões`;
    await expect(page.getByText(new RegExp(`ficam canceladas \\(${sufixoSessoes}\\)\\.`))).toBeVisible();

    // --- terminar a partir de uma data futura ---
    const terminarA = addDiasISO(HOJE, 14);
    const { count: futurasAntes } = await supabaseAdmin
      .from('explicacoes').select('id', { count: 'exact', head: true }).eq('serie_id', serieId).gte('data', terminarA);
    expect(futurasAntes ?? 0).toBeGreaterThan(0);

    await page.goto(`${BASE_URL}/admin/explicacoes/series`, { waitUntil: 'networkidle' });
    const cartao2 = page.locator('[data-serie-cartao]');
    await cartao2.getByRole('button', { name: /terminar a partir de/i }).click();
    await page.getByLabel('Terminar a partir de').fill(terminarA);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByText('Série terminada a partir dessa data.')).toBeVisible({ timeout: 15_000 });

    const { count: futurasDepois } = await supabaseAdmin
      .from('explicacoes').select('id', { count: 'exact', head: true }).eq('serie_id', serieId).gte('data', terminarA);
    expect(futurasDepois ?? 0).toBe(0);

    // Reabrir Explicações (gerar_sessoes_series outra vez) não repõe as
    // sessões futuras apagadas — a série nova não duplica.
    const { count: totalAntes } = await supabaseAdmin.from('explicacoes').select('id', { count: 'exact', head: true }).eq('serie_id', serieId);
    await page.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const { count: totalDepois } = await supabaseAdmin.from('explicacoes').select('id', { count: 'exact', head: true }).eq('serie_id', serieId);
    expect(totalDepois).toBe(totalAntes);

    await context.close();
  });

  test('professor e secretaria não acedem a /admin/explicacoes/series', async ({ browser }: { browser: Browser }) => {
    const contextProf = await browser.newContext();
    const pageProf = await contextProf.newPage();
    await loginUI(pageProf, prof1.email, prof1.password);
    await pageProf.goto(`${BASE_URL}/admin/explicacoes/series`, { waitUntil: 'networkidle' });
    await expect(pageProf).not.toHaveURL(/\/admin\/explicacoes\/series/);
    await contextProf.close();

    const contextSec = await browser.newContext();
    const pageSec = await contextSec.newPage();
    await loginUI(pageSec, secretaria.email, secretaria.password);
    await pageSec.goto(`${BASE_URL}/admin/explicacoes/series`, { waitUntil: 'networkidle' });
    await expect(pageSec).not.toHaveURL(/\/admin\/explicacoes\/series/);
    await contextSec.close();
  });

  test('o professor não consegue escrever diretamente em estado, serie_id, data ou hora_inicio — só via alterar_sessao', async () => {
    const expId = await criarExplicacaoManual(prof1.id, addDiasISO(HOJE, 10), '12:00:00', [alunoM1Id]);
    const clienteProf1 = await sessaoComo(prof1);

    const tentativas: Array<Record<string, unknown>> = [
      { estado: 'cancelada' },
      { serie_id: serieId },
      { data: addDiasISO(HOJE, 11) },
      { hora_inicio: '13:00:00' },
    ];

    for (const payload of tentativas) {
      await clienteProf1.from('explicacoes').update(payload).eq('id', expId);
    }

    const { data: linhaFinal } = await supabaseAdmin
      .from('explicacoes').select('estado, serie_id, data, hora_inicio').eq('id', expId).single();
    expect(linhaFinal?.estado).toBe('ativa');
    expect(linhaFinal?.serie_id).toBeNull();
    expect(linhaFinal?.data).toBe(addDiasISO(HOJE, 10));
    expect(linhaFinal?.hora_inicio?.slice(0, 5)).toBe('12:00');
  });
});
