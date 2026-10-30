import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Avisos e alterações: cancelar/reativar/mudar/trocar de professor via
// RPC real alterar_sessao (sessão real de professor, JWT, nunca a chave de
// serviço) aparecem em /admin/alteracoes (admin e secretaria), o selo da
// sidebar conta e desce ao marcar como vista, "Reverter" é só do admin e
// repõe a sessão, o professor é bloqueado na página, e o cartão fixo de
// cada tipo aparece certo nas Mensagens (admin e família). Centro
// descartável ZZTESTE (~/Desktop/gestao-centros/novo-centro.mjs), nunca o
// centro real ou o demo.
//
// A mensagem de tipo 'pausa' e a de payload incompleto (fallback genérico)
// não têm ainda nenhum produtor real (alterar_sessao só cobre cancelar/
// reativar/mudar/professor) — são inseridas diretamente (chave de serviço,
// só no centro ZZTESTE) unicamente para testar a renderização fixa do
// cartão a partir de um payload com essa forma, nunca para simular
// alterar_sessao nem para testar a tabela explicacoes_alteracoes.

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
const NOME_ZZTESTE = `ZZTESTE Alteracoes ${SUFIXO}`;
const ADMIN_EMAIL = `admin-alt-${SUFIXO}@zzteste.invalid`;
const CODIGO_ALUNO = '7391';

type Conta = { email: string; password: string; id: string };

let centroId: string;
let admin: Conta;
let secretaria: Conta;
let prof1: Conta;
let prof2: Conta;
let aluno: Conta;
let disciplinaId: number;

let expCancelar: string;
let expMudar: string;
let expProfessor: string;

const idsAlteracoes: Record<string, string> = {};
const explicacaoIds: string[] = [];
const limpeza: Array<() => unknown> = [];

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
  return { email, password, id };
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

async function novaExplicacao(professorId: string, data: string, hora: string): Promise<string> {
  const { data: exp, error } = await supabaseAdmin
    .from('explicacoes')
    .insert({ centro_id: centroId, professor_id: professorId, disciplina_id: disciplinaId, data, hora_inicio: hora, created_by: professorId, dado: false })
    .select()
    .single();
  if (error) throw new Error(`criar explicacao ${data} ${hora}: ${error.message}`);
  explicacaoIds.push(exp.id);
  const { error: errAlunos } = await supabaseAdmin.from('explicacoes_alunos').insert({ explicacao_id: exp.id, aluno_id: aluno.id });
  if (errAlunos) throw new Error(`associar aluno ${exp.id}: ${errAlunos.message}`);
  return exp.id;
}

test.describe.configure({ mode: 'serial' });

test.describe('Avisos e alterações de explicações — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE Alteracoes'],
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

    secretaria = await criarStaff('secretaria', 'Secretaria Alt');
    prof1 = await criarStaff('professor', 'Prof Alt Um');
    prof2 = await criarStaff('professor', 'Prof Alt Dois');

    const { data: disciplina, error: errDisciplina } = await supabaseAdmin
      .from('subjects').insert({ name: `Disciplina Alt ${SUFIXO}`, centro_id: centroId }).select('id').single();
    if (errDisciplina) throw new Error(`criar disciplina: ${errDisciplina.message}`);
    disciplinaId = disciplina.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplinaId));

    const alunoEmail = `aluno-alt-${SUFIXO}@zzteste.invalid`;
    const alunoPassword = gerarPasswordSegura();
    const alunoId = await criarUtilizadorAuth(alunoEmail, alunoPassword, { centro_id: centroId });
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(alunoId));
    const { error: errAluno } = await supabaseAdmin.from('alunos').insert({
      id: alunoId, nome: 'Aluno Alt ZZTESTE', email: alunoEmail, email_encarregado: `enc-alt-${SUFIXO}@zzteste.invalid`,
      data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centroId, ativo: true, sala_estudo: false, faz_explicacoes: true, mensalidade_base: 0,
    });
    if (errAluno) throw new Error(`criar aluno: ${errAluno.message}`);
    aluno = { email: alunoEmail, password: alunoPassword, id: alunoId };
    limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', alunoId));

    const { error: codigoError } = await supabaseAdmin.rpc('definir_codigo_encarregado', { p_aluno_id: alunoId, p_codigo: CODIGO_ALUNO });
    if (codigoError) throw new Error(`definir código encarregado: ${codigoError.message}`);
    limpeza.push(() => supabaseAdmin.from('encarregado_codigos').delete().eq('aluno_id', alunoId));

    // --- sessões, criadas já como linhas reais de explicacoes (service role) ---
    expCancelar = await novaExplicacao(prof1.id, '2027-04-05', '14:00:00');
    expMudar = await novaExplicacao(prof1.id, '2027-04-06', '15:00:00');
    expProfessor = await novaExplicacao(prof1.id, '2027-04-07', '16:00:00');

    // --- as 4 alterações reais, via RPC alterar_sessao com sessão real do professor ---
    const sessaoProf1 = await sessaoComo(prof1);

    let r = await sessaoProf1.rpc('alterar_sessao', { p_explicacao: expCancelar, p_acao: 'cancelar', p_motivo: 'aluno doente' });
    if (r.error) throw new Error(`alterar_sessao cancelar: ${r.error.message}`);

    r = await sessaoProf1.rpc('alterar_sessao', { p_explicacao: expCancelar, p_acao: 'reativar' });
    if (r.error) throw new Error(`alterar_sessao reativar: ${r.error.message}`);

    r = await sessaoProf1.rpc('alterar_sessao', { p_explicacao: expMudar, p_acao: 'mudar', p_data: '2027-04-09', p_hora: '17:00:00', p_motivo: 'sala ocupada' });
    if (r.error) throw new Error(`alterar_sessao mudar: ${r.error.message}`);

    r = await sessaoProf1.rpc('alterar_sessao', { p_explicacao: expProfessor, p_acao: 'professor', p_professor: prof2.id, p_motivo: 'troca de horário' });
    if (r.error) throw new Error(`alterar_sessao professor: ${r.error.message}`);

    const { data: todasAlteracoes, error: errTodas } = await supabaseAdmin
      .from('explicacoes_alteracoes').select('id, tipo, explicacao_id').eq('centro_id', centroId);
    if (errTodas) throw new Error(`reler alteracoes: ${errTodas.message}`);
    for (const a of todasAlteracoes || []) {
      idsAlteracoes[`${a.tipo}:${a.explicacao_id}`] = a.id;
    }

    // --- mensagem de pausa e mensagem com payload incompleto — só para testar
    // a renderização fixa do cartão, inseridas diretamente (ver nota no topo) ---
    const { error: errPausa } = await supabaseAdmin.from('mensagens').insert({
      centro_id: centroId, aluno_id: alunoId, autor: 'centro', autor_id: admin.id, tipo: 'alteracao_explicacao',
      texto: null, lida_pelo_centro_em: new Date().toISOString(),
      payload: { tipo_alteracao: 'pausa', disciplina: `Disciplina Alt ${SUFIXO}`, de: '2027-08-01', ate: '2027-08-15', sessoes: '3 sessões' },
    });
    if (errPausa) throw new Error(`criar mensagem pausa: ${errPausa.message}`);

    const { error: errIncompleta } = await supabaseAdmin.from('mensagens').insert({
      centro_id: centroId, aluno_id: alunoId, autor: 'centro', autor_id: admin.id, tipo: 'alteracao_explicacao',
      texto: null, lida_pelo_centro_em: new Date().toISOString(),
      payload: { tipo_alteracao: 'cancelada' }, // sem disciplina/data/hora de propósito
    });
    if (errIncompleta) throw new Error(`criar mensagem incompleta: ${errIncompleta.message}`);
  });

  test.afterAll(async () => {
    if (centroId) {
      await supabaseAdmin.from('explicacoes_alteracoes').delete().eq('centro_id', centroId);
    }
    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }
    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    const { data: restoAlteracoes } = await supabaseAdmin.from('explicacoes_alteracoes').select('id').eq('centro_id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
    expect(restoAlteracoes ?? []).toHaveLength(0);
  });

  test('admin: lista mostra as 4 alterações reais, com tipo/disciplina/alunos/antes→depois/motivo/aviso certos', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/alteracoes`, { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: /^todas$/i }).click();

    // 'Cancelada' sozinho (exato, no badge) distingue a linha 'cancelada' da
    // linha 'reativada' — essa também contém o texto "Cancelada" no resumo
    // "Cancelada → Ativa" (antes→depois), por isso hasText simples ambiguaria.
    const linhaCancelada = page.locator('tr').filter({ has: page.getByText('Cancelada', { exact: true }) }).filter({ hasText: `Disciplina Alt ${SUFIXO}` });
    await expect(linhaCancelada).toBeVisible({ timeout: 15_000 });
    await expect(linhaCancelada).toContainText('Aluno Alt ZZTESTE');
    await expect(linhaCancelada).toContainText('aluno doente');

    const linhaReposta = page.locator('tr', { hasText: 'Reposta' }).filter({ hasText: `Disciplina Alt ${SUFIXO}` });
    await expect(linhaReposta).toBeVisible();

    const linhaHorario = page.locator('tr', { hasText: 'Mudou de hora/dia' });
    await expect(linhaHorario).toBeVisible();
    await expect(linhaHorario).toContainText('sala ocupada');

    const linhaProfessor = page.locator('tr', { hasText: 'Trocou de professor' });
    await expect(linhaProfessor).toBeVisible();
    await expect(linhaProfessor).toContainText('Prof Alt Um');
    await expect(linhaProfessor).toContainText('Prof Alt Dois');

    await context.close();
  });

  test('selo "Alterações" na sidebar conta e desce ao marcar uma como vista; secretaria também vê o selo', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });

    const linkAlteracoes = page.getByRole('link', { name: /alterações/i });
    await expect(linkAlteracoes).toBeVisible({ timeout: 15_000 });
    const badgeAntes = await linkAlteracoes.locator('span').last().textContent();
    expect(Number(badgeAntes)).toBeGreaterThanOrEqual(4);

    await linkAlteracoes.click();
    await expect(page.getByRole('button', { name: /^por ver/i })).toBeVisible({ timeout: 15_000 });

    const primeiraLinha = page.locator('tr', { hasText: `Disciplina Alt ${SUFIXO}` }).first();
    await expect(primeiraLinha).toBeVisible({ timeout: 15_000 });
    await primeiraLinha.getByRole('button', { name: /marcar vista/i }).click();

    await expect(async () => {
      const badgeDepois = await linkAlteracoes.locator('span').last().textContent().catch(() => null);
      if (badgeDepois && /^\d+$/.test(badgeDepois.trim())) {
        expect(Number(badgeDepois)).toBeLessThan(Number(badgeAntes));
      }
    }).toPass({ timeout: 15_000 });

    await context.close();

    // Secretaria: vê a página e o mesmo selo, mas sem o botão Reverter.
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await loginUI(page2, secretaria.email, secretaria.password);
    await page2.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    const linkAlteracoesSecretaria = page2.getByRole('link', { name: /alterações/i });
    await expect(linkAlteracoesSecretaria).toBeVisible({ timeout: 15_000 });
    await linkAlteracoesSecretaria.click();
    await page2.getByRole('button', { name: /^todas$/i }).click();
    await expect(page2.locator('tr', { hasText: `Disciplina Alt ${SUFIXO}` }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page2.getByRole('button', { name: /reverter/i })).toHaveCount(0);
    await context2.close();
  });

  test('"Reverter" só aparece ao admin e repõe a sessão (troca de professor volta ao professor original)', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/alteracoes`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^todas$/i }).click();

    const linhaProfessor = page.locator('tr', { hasText: 'Trocou de professor' });
    await expect(linhaProfessor).toBeVisible({ timeout: 15_000 });

    page.once('dialog', (d) => d.accept());
    await linhaProfessor.getByRole('button', { name: /^reverter$/i }).click();
    await expect(linhaProfessor.getByText(/revertida/i)).toBeVisible({ timeout: 15_000 });

    const { data: expRow } = await supabaseAdmin.from('explicacoes').select('professor_id').eq('id', expProfessor).single();
    expect(expRow?.professor_id).toBe(prof1.id);

    await context.close();
  });

  test('professor é bloqueado em /admin/alteracoes', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/alteracoes`, { waitUntil: 'networkidle' });
    await expect(page).not.toHaveURL(/\/admin\/alteracoes/);
    await expect(page.getByRole('link', { name: /alterações/i })).toHaveCount(0);
    await context.close();
  });

  test('admin: cartões certos nas Mensagens — cancelada, reposta, mudou de dia e hora, mudança de professor, pausa, e payload incompleto nunca parte o ecrã', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/mensagens`, { waitUntil: 'networkidle' });

    await page.getByText('Aluno Alt ZZTESTE').click();

    await expect(page.getByText('Sessão cancelada')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/foi cancelada\./)).toBeVisible();
    await expect(page.getByText('Sessão reposta')).toBeVisible();
    await expect(page.getByText(/voltou a estar marcada\./)).toBeVisible();
    await expect(page.getByText('Sessão mudou de dia e hora')).toBeVisible();
    await expect(page.getByText(/passa de .* para .*, das .* para as/)).toBeVisible();
    // Duas vezes: a troca original (Um → Dois) e a notificação da própria
    // reversão (Dois → Um, feita pelo teste "Reverter" que corre antes
    // deste na sequência serial) — ambas com o mesmo título fixo.
    await expect(page.getByText('Mudança de professor').first()).toBeVisible();
    await expect(page.getByText(/passa a ser dada por Prof Alt Dois\./)).toBeVisible();
    await expect(page.getByText('Pausa nas explicações')).toBeVisible();
    await expect(page.getByText(/ficam canceladas \(3 sessões\)\./)).toBeVisible();
    await expect(page.getByText('Alteração a uma Explicação')).toBeVisible();

    // As 6 mensagens automáticas (autor 'centro', já lidas_pelo_centro_em)
    // nunca somam ao selo "Mensagens" — esse conta só autor 'familia' por ler.
    const linkMensagens = page.getByRole('link', { name: /^mensagens$/i });
    await expect(linkMensagens.locator('span').filter({ hasText: /^\d+$/ })).toHaveCount(0);

    await context.close();
  });

  test('família: os mesmos cartões aparecem certos na Área dos Encarregados', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, aluno.email, aluno.password);
    await page.goto(`${BASE_URL}/encarregados`, { waitUntil: 'networkidle' });
    await page.fill('input[inputMode="numeric"]', CODIGO_ALUNO);
    await page.getByRole('button', { name: /entrar/i }).click();

    await page.getByRole('link', { name: /mensagens/i }).click();

    await expect(page.getByText('Sessão cancelada')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Sessão reposta')).toBeVisible();
    await expect(page.getByText('Sessão mudou de dia e hora')).toBeVisible();
    await expect(page.getByText('Mudança de professor').first()).toBeVisible();
    await expect(page.getByText('Pausa nas explicações')).toBeVisible();
    await expect(page.getByText('Alteração a uma Explicação')).toBeVisible();

    await context.close();
  });
});
