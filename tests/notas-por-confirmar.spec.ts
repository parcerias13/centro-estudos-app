import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Fluxo completo da página /admin/notas: pendentes, confirmar uma, confirmar
// em lote, corrigir (valor inválido rejeitado, válido guarda e confirma),
// papéis (secretaria vê sem botões/sem selo, professor confirma, aluno e
// família não abrem), o selo "Alunos" já não existe, e regressão de que a
// Ficha do Aluno continua a confirmar. Cria um centro descartável — nunca
// toca no centro real nem no demo. Todas as linhas de teste levam um
// marcador único (tópico / nome de disciplina) para limpeza e verificação
// independentes.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

type Conta = { email: string; password: string; id: string };

const SUFIXO = String(Date.now());
const MARCADOR = `NOTAS_E2E_${SUFIXO}`;
const NOME_DISCIPLINA = `Disciplina ${MARCADOR}`;

let centroId: string;
let admin: Conta;
let professor: Conta;
let secretaria: Conta;
let disciplinaId: number;
let alunoUnica: Conta;
let alunoFicha: Conta;

const alunosIds: string[] = [];
const examIds: string[] = [];
const periodoIds: string[] = [];
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

async function criarAlunoTeste(sufixo: string) {
  const email = `teste-notas-${sufixo}@example.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome: `Aluno Notas ${sufixo}`, email, email_encarregado: `enc-notas-${sufixo}@example.invalid`,
    data_nascimento: '2012-01-01', ano_escolar: 7, centro_id: centroId, ativo: true,
  });
  if (error) throw new Error(`criar aluno ${sufixo}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  alunosIds.push(id);
  return { email, password, id };
}

async function criarExamePorConfirmar(alunoId: string, notaValor: number, topicsExtra = '') {
  const hoje = new Date().toISOString().split('T')[0];
  const { data, error } = await supabaseAdmin.from('exams').insert({
    aluno_id: alunoId, subject_name: 'Matemática', date: hoje, topics: `${MARCADOR}${topicsExtra}`,
    centro_id: centroId, nota_valor: notaValor, nota_escala: '100', nota_confirmada: false, nota_reportada_por: alunoId,
  }).select().single();
  if (error) throw new Error(`criar exam: ${error.message}`);
  examIds.push(data.id);
  return data;
}

async function criarPeriodoPorConfirmar(alunoId: string, periodo: number, nota: number) {
  const { data, error } = await supabaseAdmin.from('notas_periodo').insert({
    centro_id: centroId, aluno_id: alunoId, disciplina_id: disciplinaId, ano_letivo: '2026/2027', periodo,
    nota, nota_escala: '5', nota_confirmada: false, nota_reportada_por: alunoId,
  }).select().single();
  if (error) throw new Error(`criar notas_periodo: ${error.message}`);
  periodoIds.push(data.id);
  return data;
}

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="identificador"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

test.describe.configure({ mode: 'serial' });

test.describe('Notas por confirmar', () => {
  test.beforeAll(async () => {
    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `Teste Notas ${SUFIXO}`, email_remetente: `teste-notas-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    async function criarStaff(papel: string) {
      const email = `teste-notas-${papel}-${SUFIXO}@example.invalid`;
      const password = gerarPasswordSegura();
      const id = await criarUtilizadorAuth(email, password, { role: papel, centro_id: centroId });
      limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
      const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: `Staff ${papel} ${MARCADOR}`, role: papel, centro_id: centroId });
      if (error) throw new Error(`criar staff ${papel}: ${error.message}`);
      limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
      return { email, password, id };
    }

    admin = await criarStaff('admin');
    professor = await criarStaff('professor');
    secretaria = await criarStaff('secretaria');

    const { data: subj, error: subjError } = await supabaseAdmin.from('subjects').insert({ name: NOME_DISCIPLINA, centro_id: centroId }).select('id').single();
    if (subjError) throw new Error(`criar disciplina: ${subjError.message}`);
    disciplinaId = subj.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplinaId));

    // Alunos + linhas por confirmar:
    alunoUnica = await criarAlunoTeste(`${SUFIXO}-unica`);
    await criarExamePorConfirmar(alunoUnica.id, 75, '-unica');

    const alunoLote1 = await criarAlunoTeste(`${SUFIXO}-lote1`);
    const alunoLote2 = await criarAlunoTeste(`${SUFIXO}-lote2`);
    const alunoLote3 = await criarAlunoTeste(`${SUFIXO}-lote3`);
    await criarExamePorConfirmar(alunoLote1.id, 60, '-lote1');
    await criarExamePorConfirmar(alunoLote2.id, 65, '-lote2');
    await criarPeriodoPorConfirmar(alunoLote3.id, 1, 3);

    const alunoCorrigir = await criarAlunoTeste(`${SUFIXO}-corrigir`);
    await criarExamePorConfirmar(alunoCorrigir.id, 50, '-corrigir');

    const alunoProfessor = await criarAlunoTeste(`${SUFIXO}-prof`);
    await criarExamePorConfirmar(alunoProfessor.id, 80, '-prof');

    alunoFicha = await criarAlunoTeste(`${SUFIXO}-ficha`);
    await criarExamePorConfirmar(alunoFicha.id, 90, '-ficha');
  });

  test.afterAll(async () => {
    await supabaseAdmin.from('exams').delete().in('id', examIds);
    await supabaseAdmin.from('notas_periodo').delete().in('id', periodoIds);
    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }

    // Verificação independente: nenhuma linha com o marcador sobrevive.
    const { data: examsRestantes } = await supabaseAdmin.from('exams').select('id').ilike('topics', `%${MARCADOR}%`);
    const { data: subjectRestante } = await supabaseAdmin.from('subjects').select('id').eq('name', NOME_DISCIPLINA);
    const { data: alunosRestantes } = await supabaseAdmin.from('alunos').select('id').in('id', alunosIds);
    expect(examsRestantes || [], 'exams com o marcador não deviam sobreviver à limpeza').toHaveLength(0);
    expect(subjectRestante || [], 'disciplina de teste não devia sobreviver à limpeza').toHaveLength(0);
    expect(alunosRestantes || [], 'alunos de teste não deviam sobreviver à limpeza').toHaveLength(0);
  });

  test('admin: vê as pendentes, confirma uma, passa para Confirmadas, e o selo desce', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/notas`, { waitUntil: 'networkidle' });

    const linkNotas = page.getByRole('link', { name: /notas/i });
    await expect(linkNotas).toBeVisible({ timeout: 15_000 });
    const badgeAntes = await linkNotas.locator('span').last().textContent().catch(() => null);

    const nomeUnica = `Aluno Notas ${SUFIXO}-unica`;
    const linhaUnica = page.locator('tr', { hasText: nomeUnica });
    await expect(linhaUnica).toBeVisible({ timeout: 15_000 });
    await expect(linhaUnica).toContainText('75/100');

    await linhaUnica.getByRole('button', { name: 'Confirmar' }).click();
    await expect(linhaUnica).toHaveCount(0, { timeout: 15_000 });

    await page.getByRole('button', { name: /confirmadas/i }).click();
    const linhaConfirmada = page.locator('tr', { hasText: nomeUnica });
    await expect(linhaConfirmada).toBeVisible({ timeout: 15_000 });
    await expect(linhaConfirmada).toContainText(`Confirmada por Staff admin ${MARCADOR}`);

    if (badgeAntes && /^\d+$/.test(badgeAntes.trim())) {
      await expect(async () => {
        const badgeDepois = await linkNotas.locator('span').last().textContent();
        expect(Number(badgeDepois)).toBeLessThan(Number(badgeAntes));
      }).toPass({ timeout: 15_000 });
    }

    await context.close();
  });

  test('admin: confirma três em lote (testes e período)', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/notas`, { waitUntil: 'networkidle' });

    for (const sufixo of ['lote1', 'lote2', 'lote3']) {
      const linha = page.locator('tr', { hasText: `Aluno Notas ${SUFIXO}-${sufixo}` });
      await expect(linha).toBeVisible({ timeout: 15_000 });
      await linha.locator('input[type="checkbox"]').check();
    }

    await expect(page.getByText('3 selecionadas')).toBeVisible();
    await page.getByRole('button', { name: /confirmar selecionadas/i }).click();
    // "Confirmar" sozinho também é o texto do botão de cada linha — a barra
    // de confirmação é identificada pelo parágrafo "Confirmar N notas?", e o
    // botão fica no grupo imediatamente a seguir a esse parágrafo.
    const paragrafoConfirmacao = page.getByText(/^confirmar 3 notas\?$/i);
    await expect(paragrafoConfirmacao).toBeVisible({ timeout: 10_000 });
    await paragrafoConfirmacao.locator('xpath=following-sibling::div[1]').getByRole('button', { name: /^confirmar$/i }).click();

    await expect(page.getByText(/resumo da confirmação em lote/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/^3 confirmada\(s\)$/)).toBeVisible();

    await page.getByRole('button', { name: /confirmadas/i }).click();
    for (const sufixo of ['lote1', 'lote2', 'lote3']) {
      await expect(page.locator('tr', { hasText: `Aluno Notas ${SUFIXO}-${sufixo}` })).toBeVisible({ timeout: 15_000 });
    }

    await context.close();
  });

  test('admin: corrige um valor inválido (rejeitado) e depois um válido (guarda e confirma)', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/notas`, { waitUntil: 'networkidle' });

    const nome = `Aluno Notas ${SUFIXO}-corrigir`;
    const linha = page.locator('tr', { hasText: nome });
    await expect(linha).toBeVisible({ timeout: 15_000 });
    await linha.getByRole('button', { name: 'Corrigir' }).click();

    // O formulário de correção existe em duplicado (desktop/mobile, um deles
    // escondido por CSS) — o desktop vem primeiro na ordem do DOM.
    const input = page.locator('input[type="number"]').first();
    const botaoGuardar = page.getByRole('button', { name: /guardar e confirmar/i }).first();
    await input.fill('150');
    await botaoGuardar.click();
    await expect(page.getByText(/escreve um valor entre 0 e 100/i)).toBeVisible({ timeout: 10_000 });
    // Continua por confirmar — a tentativa inválida não gravou nada.
    await expect(page.locator('tr', { hasText: nome })).toBeVisible();

    await input.fill('88');
    await botaoGuardar.click();
    await expect(page.locator('tr', { hasText: nome })).toHaveCount(0, { timeout: 15_000 });

    await page.getByRole('button', { name: /confirmadas/i }).click();
    const linhaConfirmada = page.locator('tr', { hasText: nome });
    await expect(linhaConfirmada).toBeVisible({ timeout: 15_000 });
    await expect(linhaConfirmada).toContainText('88/100');

    await context.close();
  });

  test('secretaria: vê a lista sem botões de ação nem selo na sidebar', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, secretaria.email, secretaria.password);
    await page.goto(`${BASE_URL}/admin/notas`, { waitUntil: 'networkidle' });

    await expect(page.getByText(/a secretaria vê a lista, mas não confirma/i)).toBeVisible({ timeout: 15_000 });
    const nome = `Aluno Notas ${SUFIXO}-prof`;
    await expect(page.locator('tr', { hasText: nome })).toBeVisible({ timeout: 15_000 });
    // name sem exact:true seria substring — "Por confirmar (N)" (separador)
    // também contém "confirmar" e daria um falso positivo.
    await expect(page.getByRole('button', { name: 'Confirmar', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Corrigir', exact: true })).toHaveCount(0);

    const linkNotas = page.getByRole('link', { name: /notas/i });
    await expect(linkNotas.locator('span').filter({ hasText: /^\d+$/ })).toHaveCount(0);

    await context.close();
  });

  test('professor: vê e confirma', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, professor.email, professor.password);
    await page.goto(`${BASE_URL}/admin/notas`, { waitUntil: 'networkidle' });

    const nome = `Aluno Notas ${SUFIXO}-prof`;
    const linha = page.locator('tr', { hasText: nome });
    await expect(linha).toBeVisible({ timeout: 15_000 });
    await linha.getByRole('button', { name: 'Confirmar' }).click();
    await expect(linha).toHaveCount(0, { timeout: 15_000 });

    await page.getByRole('button', { name: /confirmadas/i }).click();
    const linhaConfirmada = page.locator('tr', { hasText: nome });
    await expect(linhaConfirmada).toBeVisible({ timeout: 15_000 });
    await expect(linhaConfirmada).toContainText(`Confirmada por Staff professor ${MARCADOR}`);

    await context.close();
  });

  test('aluno e família não abrem /admin/notas', async ({ browser }: { browser: Browser }) => {
    // Não há um papel "família" à parte — a família entra com as mesmas
    // credenciais do aluno (código de encarregado é só um segundo portão
    // dentro de /encarregados). Testar com a conta do aluno cobre os dois.
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, alunoUnica.email, alunoUnica.password);
    await page.goto(`${BASE_URL}/admin/notas`, { waitUntil: 'networkidle' });
    await expect(page).not.toHaveURL(/\/admin\/notas/);
    await context.close();
  });

  test('"Alunos" já não tem selo (passou para "Notas")', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const linkAlunos = page.getByRole('link', { name: /^alunos$/i });
    await expect(linkAlunos).toBeVisible({ timeout: 15_000 });
    await expect(linkAlunos.locator('span').filter({ hasText: /^\d+$/ })).toHaveCount(0);

    await context.close();
  });

  test('regressão: a Ficha do Aluno continua a confirmar', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, admin.email, admin.password);

    await page.goto(`${BASE_URL}/admin/alunos/ficha?id=${alunoFicha.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByText(/por confirmar/i).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^confirmar$/i }).first().click();
    await expect(page.getByText(/confirmada/i).first()).toBeVisible({ timeout: 15_000 });

    await context.close();
  });
});
