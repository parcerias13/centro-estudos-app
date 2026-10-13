import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Fluxo completo da página /admin/relatorio-mensal: estados da lista (sem
// dados / já enviado), envio em lote a 3 famílias, o cartão do lado da
// família com os mesmos números, o contador de não lidas a subir e a
// descer, idempotência ao reabrir a página, e bloqueio de professor e
// secretaria. Cria um centro descartável — nunca toca no centro real nem
// no demo.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

function hojeLisboaISO(): string {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const obter = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${obter('year')}-${obter('month')}-${obter('day')}`;
}

// Mesmo mês por omissão que lib/relatorio.ts (mesAnteriorPorOmissao): o mês
// anterior ao de hoje em Europe/Lisbon.
const [anoHoje, mesHoje] = hojeLisboaISO().split('-').map(Number);
let ANO_ALVO = anoHoje;
let MES_ALVO = mesHoje - 1;
if (MES_ALVO === 0) { MES_ALVO = 12; ANO_ALVO -= 1; }
const MES_ALVO_FMT = String(MES_ALVO).padStart(2, '0');

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

type Conta = { email: string; password: string; id: string };

let centroId: string;
let admin: Conta;
let professor: Conta;
let secretaria: Conta;
let aluno1: Conta, aluno2: Conta, aluno3: Conta, aluno4: Conta, aluno5: Conta;
const CODIGO_ALUNO1 = '1234';
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

async function criarAlunoTeste(sufixo: string, extra: Record<string, unknown> = {}) {
  const email = `teste-relatorio-mensal-${sufixo}@example.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome: `Aluno Teste ${sufixo}`, email, email_encarregado: `enc-${sufixo}@example.invalid`,
    data_nascimento: '2012-01-01', ano_escolar: 7, centro_id: centroId, ativo: true, ...extra,
  });
  if (error) throw new Error(`criar aluno ${sufixo}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return { email, password, id };
}

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

test.describe.configure({ mode: 'serial' });

test.describe('Relatório Mensal em lote', () => {
  test.beforeAll(async () => {
    const sufixo = String(Date.now());

    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `Teste Relatório Mensal ${sufixo}`, email_remetente: `teste-relatorio-mensal-${sufixo}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    async function criarStaff(papel: string) {
      const email = `teste-relatorio-mensal-${papel}-${sufixo}@example.invalid`;
      const password = gerarPasswordSegura();
      const id = await criarUtilizadorAuth(email, password, { role: papel, centro_id: centroId });
      limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
      const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: `Staff ${papel}`, role: papel, centro_id: centroId });
      if (error) throw new Error(`criar staff ${papel}: ${error.message}`);
      limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
      return { email, password, id };
    }

    admin = await criarStaff('admin');
    professor = await criarStaff('professor');
    secretaria = await criarStaff('secretaria');

    aluno1 = await criarAlunoTeste(`${sufixo}-1`);
    aluno2 = await criarAlunoTeste(`${sufixo}-2`);
    aluno3 = await criarAlunoTeste(`${sufixo}-3`);
    aluno4 = await criarAlunoTeste(`${sufixo}-4`); // sem dados no mês
    aluno5 = await criarAlunoTeste(`${sufixo}-5`); // já enviado

    // Código do encarregado do aluno1, para o teste de família conseguir entrar.
    const { error: codigoError } = await supabaseAdmin.rpc('definir_codigo_encarregado', { p_aluno_id: aluno1.id, p_codigo: CODIGO_ALUNO1 });
    if (codigoError) throw new Error(`definir código aluno1: ${codigoError.message}`);
    limpeza.push(() => supabaseAdmin.from('encarregado_codigos').delete().eq('aluno_id', aluno1.id));

    // diario_bordo do mês-alvo: aluno1 com dados conhecidos (2h, 1 sessão,
    // "Matemática") para comparar exatamente com o cartão da família depois;
    // aluno2/aluno3 só precisam de ter ALGUM dado no mês (ficam "pronto").
    async function inserirSessao(alunoId: string, dia: string, horaInicio: string, horaFim: string, subject: string) {
      const { error } = await supabaseAdmin.from('diario_bordo').insert({
        aluno_id: alunoId, centro_id: centroId, subject_name: subject,
        entrada: `${ANO_ALVO}-${MES_ALVO_FMT}-${dia}T${horaInicio}`,
        saida: `${ANO_ALVO}-${MES_ALVO_FMT}-${dia}T${horaFim}`,
      });
      if (error) throw new Error(`inserir diario_bordo ${alunoId}: ${error.message}`);
    }
    await inserirSessao(aluno1.id, '02', '10:00:00', '12:00:00', 'Matemática');
    await inserirSessao(aluno2.id, '03', '09:00:00', '10:00:00', 'Português');
    await inserirSessao(aluno3.id, '04', '14:00:00', '15:00:00', 'Inglês');
    limpeza.push(() => supabaseAdmin.from('diario_bordo').delete().in('aluno_id', [aluno1.id, aluno2.id, aluno3.id]));

    // aluno5 já tem relatorio_mensal deste mês — deve aparecer "já enviado".
    const { error: relatorioError } = await supabaseAdmin.from('mensagens').insert({
      aluno_id: aluno5.id, tipo: 'relatorio_mensal', payload: { ano: ANO_ALVO, mes: MES_ALVO, horas: 0, sessoes: 0, disciplina_principal: null },
      // Inserção via service role (sem auth.uid()) — o trigger só deriva
      // autor/autor_id automaticamente de uma sessão real, por isso aqui
      // têm de ser indicados à mão, como o próprio centro teria feito.
      autor: 'centro', autor_id: admin.id,
    });
    if (relatorioError) throw new Error(`pré-criar relatorio_mensal aluno5: ${relatorioError.message}`);
  });

  test.afterAll(async () => {
    // Mensagens criadas durante o teste (as que o próprio envio em lote cria) —
    // apagadas por aluno_id, antes dos alunos (filhas antes de pais).
    await supabaseAdmin.from('mensagens').delete().in('aluno_id', [aluno1.id, aluno2.id, aluno3.id, aluno4.id, aluno5.id]);
    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }
  });

  test('admin: lista mostra os estados certos e envia a 3 famílias', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/relatorio-mensal`, { waitUntil: 'networkidle' });

    await expect(page.locator('tr', { hasText: 'Aluno Teste' }).first()).toBeVisible({ timeout: 15_000 });

    // Localiza cada linha pelo nome do aluno (mais estável que por id no DOM).
    const nomeAluno1 = (await supabaseAdmin.from('alunos').select('nome').eq('id', aluno1.id).single()).data!.nome;
    const nomeAluno4 = (await supabaseAdmin.from('alunos').select('nome').eq('id', aluno4.id).single()).data!.nome;
    const nomeAluno5 = (await supabaseAdmin.from('alunos').select('nome').eq('id', aluno5.id).single()).data!.nome;

    const linhaAluno1 = page.locator('tr', { hasText: nomeAluno1 });
    const linhaAluno4Real = page.locator('tr', { hasText: nomeAluno4 });
    const linhaAluno5Real = page.locator('tr', { hasText: nomeAluno5 });

    await expect(linhaAluno1.locator('input[type="checkbox"]')).toBeChecked();
    await expect(linhaAluno4Real).toContainText('Sem dados no mês');
    await expect(linhaAluno4Real.locator('input[type="checkbox"]')).not.toBeChecked();
    await expect(linhaAluno4Real.locator('input[type="checkbox"]')).toBeEnabled(); // sem dados: desmarcado mas o admin pode marcar à mão
    await expect(linhaAluno5Real).toContainText('Já enviado');
    await expect(linhaAluno5Real.locator('input[type="checkbox"]')).toBeDisabled();

    // Pré-visualização de um aluno sem dados no mês: nunca um cartão vazio.
    await linhaAluno4Real.getByTitle('Pré-visualizar cartão').click();
    await expect(page.getByText('Sem dados neste mês.')).toBeVisible({ timeout: 10_000 });

    await expect(page.getByRole('button', { name: /enviar a 3 família/i })).toBeVisible();
    await page.getByRole('button', { name: /enviar a 3 família/i }).click();
    await page.getByRole('button', { name: /confirmar envio/i }).click();

    await expect(page.getByText(/resumo do envio/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^3 enviado\(s\)$/)).toBeVisible();
    await expect(linhaAluno1).toContainText('Enviado');

    await context.close();
  });

  test('família: cartão mostra os mesmos números, contador sobe e desce', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, aluno1.email, aluno1.password);

    await page.goto(`${BASE_URL}/encarregados`, { waitUntil: 'networkidle' });
    await page.fill('input[inputMode="numeric"]', CODIGO_ALUNO1);
    await page.getByRole('button', { name: /entrar/i }).click();

    await expect(page.getByText('1 não lida(s)')).toBeVisible({ timeout: 15_000 });

    // Navegação em SPA (clique, nunca page.goto): o desbloqueio do código só
    // vive em memória — uma navegação completa (reload) apaga-o de propósito.
    await page.getByRole('link', { name: /mensagens/i }).click();
    await expect(page.getByText('Relatório Mensal')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`Período: ${MES_ALVO_FMT}/${ANO_ALVO}`)).toBeVisible();
    await expect(page.getByText('Horas: 2')).toBeVisible();
    await expect(page.getByText('Sessões: 1')).toBeVisible();
    await expect(page.getByText('Disciplina principal: Matemática (1x)')).toBeVisible();

    await page.getByRole('link', { name: /voltar/i }).click();
    await expect(page.getByText('Sem novas mensagens')).toBeVisible({ timeout: 15_000 });

    await context.close();
  });

  test('admin: ao reabrir o mesmo mês, os enviados aparecem como "já enviado"', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/relatorio-mensal`, { waitUntil: 'networkidle' });

    const nomeAluno1 = (await supabaseAdmin.from('alunos').select('nome').eq('id', aluno1.id).single()).data!.nome;
    const linhaAluno1 = page.locator('tr', { hasText: nomeAluno1 });
    await expect(linhaAluno1).toContainText('Já enviado', { timeout: 15_000 });
    await expect(linhaAluno1.locator('input[type="checkbox"]')).toBeDisabled();

    await context.close();
  });

  test('professor e secretaria não abrem /admin/relatorio-mensal', async ({ browser }: { browser: Browser }) => {
    for (const conta of [professor, secretaria]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await login(page, conta.email, conta.password);
      await page.goto(`${BASE_URL}/admin/relatorio-mensal`, { waitUntil: 'networkidle' });
      await expect(page).not.toHaveURL(/\/admin\/relatorio-mensal/);
      await context.close();
    }
  });
});
