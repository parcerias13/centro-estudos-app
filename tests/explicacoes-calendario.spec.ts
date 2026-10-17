import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Redesenho visual de /admin/explicacoes (calendário -> lista compacta por
// dia). Cria um centro ZZTESTE descartável com node ~/Desktop/gestao-centros
// /novo-centro.mjs (nunca o demo, nunca o real — essa recusa já vem do
// próprio script), com dados extremos (nome muito longo, sessão com 3
// alunos, disciplina longa, um dia com 6 sessões e outro sem nenhuma).
// Verifica, em 7 larguras, que nada corta/transborda/sobrepõe, e que o
// fluxo existente (criar pela modal, marcar pedido pelo banner, abrir
// detalhe) continua igual. Apaga o centro no fim com apagar-centro.mjs e
// confirma por queries independentes que não sobra nada.

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

function hojeLisboaISO(): string {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const obter = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${obter('year')}-${obter('month')}-${obter('day')}`;
}

// Nunca toISOString() aqui — converte para UTC, e em DST (Lisboa = UTC+1)
// meia-noite local vira 23h do dia anterior em UTC, perdendo um dia.
function addDiasISO(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + dias);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Segunda-feira da semana corrente (Europe/Lisbon) — a mesma semana que a
// página mostra por omissão ao abrir.
function segundaDaSemanaAtual(): string {
  const hoje = hojeLisboaISO();
  const d = new Date(`${hoje}T00:00:00`);
  const diaSemana = d.getDay() === 0 ? 7 : d.getDay(); // 1..7 Segunda..Domingo
  return addDiasISO(hoje, -(diaSemana - 1));
}

const SUFIXO = String(Date.now());
const NOME_CENTRO = 'ZZTESTE';
const ADMIN_EMAIL = `teste-explicacoes-zzteste-${SUFIXO}@example.invalid`;
const CREDENCIAIS_PATH = path.join(GESTAO_DIR, 'credenciais-zzteste.txt');

const DIA_CHEIO = segundaDaSemanaAtual(); // 6 sessões
const DIA_VAZIO = addDiasISO(DIA_CHEIO, 2); // sem nenhuma

const NOME_LONGO = 'Maria Fernanda de Albuquerque e Castro';
const DISCIPLINA_LONGA = 'Educação Física e Desportiva';
// subjects.name tem uma constraint única GLOBAL (não por centro_id) — nunca
// um nome genérico ("Matemática") aqui, para nunca colidir com outro centro.
const DISCIPLINA_NORMAL = `Química Teste ${SUFIXO}`;

let centroId: string;
let adminPassword: string;
let professorId: string;
let professorEmail: string;
let professorPassword: string;
let disciplinaLongaId: number;
let disciplinaNormalId: number;
let alunoLongoId: string;
let alunoGrupoIds: string[] = [];
let alunoFillerIds: string[] = [];
let pedidoMensagemId: string;
const explicacaoIds: string[] = [];

async function criarUtilizadorAuth(email: string, password: string, appMetadata: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`criar utilizador ${email}: ${error.message}`);
  const id = data.user.id;
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: appMetadata });
  if (metaError) throw new Error(`app_metadata ${email}: ${metaError.message}`);
  return id;
}

async function criarAluno(nome: string, anoEscolar: number, sufixo: string) {
  const email = `teste-expl-${sufixo}@example.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-expl-${sufixo}@example.invalid`,
    data_nascimento: '2012-01-01', ano_escolar: anoEscolar, centro_id: centroId, ativo: true,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  return id;
}

async function criarExplicacao(data: string, hora: string, disciplina_id: number | null, alunoIds: string[], dado: boolean, horasDadas: number | null) {
  const { data: exp, error } = await supabaseAdmin.from('explicacoes').insert({
    centro_id: centroId, professor_id: professorId, disciplina_id, data, hora_inicio: hora,
    created_by: professorId, dado, horas_dadas: horasDadas,
  }).select().single();
  if (error) throw new Error(`criar explicacao ${data} ${hora}: ${error.message}`);
  explicacaoIds.push(exp.id);
  const linhas = alunoIds.map((aluno_id) => ({ explicacao_id: exp.id, aluno_id }));
  const { error: errAlunos } = await supabaseAdmin.from('explicacoes_alunos').insert(linhas);
  if (errAlunos) throw new Error(`associar alunos ${exp.id}: ${errAlunos.message}`);
  return exp.id;
}

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

test.describe.configure({ mode: 'serial' });

test.describe('Explicações — calendário em lista compacta', () => {
  test.beforeAll(async () => {
    // --- 1) Centro ZZTESTE via novo-centro.mjs (nunca o demo/real) ---
    const saida = execFileSync(
      'node', ['novo-centro.mjs', '--nome', NOME_CENTRO, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE'],
      { cwd: GESTAO_DIR, encoding: 'utf8' }
    );
    const m = saida.match(/centro_id = ([0-9a-f-]{36})/i);
    if (!m) throw new Error('novo-centro.mjs não devolveu centro_id: ' + saida);
    centroId = m[1];

    if (!existsSync(CREDENCIAIS_PATH)) throw new Error('credenciais-zzteste.txt não foi criado.');
    const raw = readFileSync(CREDENCIAIS_PATH, 'utf8');
    const linhaAdmin = raw.match(/^ADMIN\b.*$/im)?.[0];
    const credMatch = linhaAdmin?.match(/email:\s*(\S+)\s+password:\s*(\S+)/i);
    if (!credMatch) throw new Error('Não consegui ler a password do admin em credenciais-zzteste.txt.');
    adminPassword = credMatch[2];

    // --- 2) professor + disciplinas + alunos extremos ---
    professorEmail = `teste-expl-prof-${SUFIXO}@example.invalid`;
    professorPassword = gerarPasswordSegura();
    professorId = await criarUtilizadorAuth(professorEmail, professorPassword, { role: 'professor', centro_id: centroId });
    { const { error } = await supabaseAdmin.from('staff').insert({ id: professorId, email: professorEmail, name: 'Professor ZZTESTE', role: 'professor', centro_id: centroId }); if (error) throw new Error('criar staff professor: ' + error.message); }

    { const { data, error } = await supabaseAdmin.from('subjects').insert({ name: DISCIPLINA_LONGA, centro_id: centroId }).select('id').single(); if (error) throw new Error('criar disciplina longa: ' + error.message); disciplinaLongaId = data.id; }
    { const { data, error } = await supabaseAdmin.from('subjects').insert({ name: DISCIPLINA_NORMAL, centro_id: centroId }).select('id').single(); if (error) throw new Error('criar disciplina normal: ' + error.message); disciplinaNormalId = data.id; }

    alunoLongoId = await criarAluno(NOME_LONGO, 9, `${SUFIXO}-longo`);
    alunoGrupoIds = [
      await criarAluno('Aluno Grupo Um', 7, `${SUFIXO}-g1`),
      await criarAluno('Aluno Grupo Dois', 7, `${SUFIXO}-g2`),
      await criarAluno('Aluno Grupo Três', 7, `${SUFIXO}-g3`),
    ];
    alunoFillerIds = [
      await criarAluno('Aluno Filler Um', 8, `${SUFIXO}-f1`),
      await criarAluno('Aluno Filler Dois', 8, `${SUFIXO}-f2`),
      await criarAluno('Aluno Filler Três', 8, `${SUFIXO}-f3`),
    ];

    // --- 3) dia cheio (6 sessões) + dia vazio (0) ---
    await criarExplicacao(DIA_CHEIO, '09:00', disciplinaLongaId, [alunoLongoId], false, null);
    await criarExplicacao(DIA_CHEIO, '10:00', disciplinaNormalId, alunoGrupoIds, true, 1.5);
    await criarExplicacao(DIA_CHEIO, '11:00', null, [alunoFillerIds[0]], false, null);
    await criarExplicacao(DIA_CHEIO, '12:00', disciplinaNormalId, [alunoFillerIds[1]], true, 1);
    await criarExplicacao(DIA_CHEIO, '13:00', disciplinaLongaId, [alunoFillerIds[2]], false, null);
    await criarExplicacao(DIA_CHEIO, '14:00', disciplinaNormalId, [alunoLongoId], false, null);

    // --- 4) pedido de explicação pendente, para o teste do banner ---
    const { data: pedido, error: erroPedido } = await supabaseAdmin.from('mensagens').insert({
      aluno_id: alunoFillerIds[0], centro_id: centroId, tipo: 'pedido_explicacao', estado: 'pendente',
      payload: { disciplina: DISCIPLINA_NORMAL, disciplina_id: disciplinaNormalId, dias: [], horario: '', nota: '' },
      autor: 'familia', autor_id: alunoFillerIds[0],
    }).select().single();
    if (erroPedido) throw new Error('criar pedido de explicação: ' + erroPedido.message);
    pedidoMensagemId = pedido.id;
  });

  test.afterAll(async () => {
    const saida = execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_CENTRO], { cwd: GESTAO_DIR, encoding: 'utf8' });
    expect(saida, 'apagar-centro.mjs tem de confirmar que não sobrou nada').toContain('Confirmado: não resta nada deste centro.');

    if (existsSync(CREDENCIAIS_PATH)) rmSync(CREDENCIAIS_PATH);

    // Verificação independente (da própria spec, não só do script).
    const [{ data: centroRestante }, { data: staffRestante }, { data: alunosRestantes }, { data: explicacoesRestantes }] = await Promise.all([
      supabaseAdmin.from('config_centro').select('id').eq('id', centroId),
      supabaseAdmin.from('staff').select('id').eq('centro_id', centroId),
      supabaseAdmin.from('alunos').select('id').eq('centro_id', centroId),
      supabaseAdmin.from('explicacoes').select('id').in('id', explicacaoIds),
    ]);
    expect(centroRestante || [], 'config_centro não devia sobreviver').toHaveLength(0);
    expect(staffRestante || [], 'staff não devia sobreviver').toHaveLength(0);
    expect(alunosRestantes || [], 'alunos não deviam sobreviver').toHaveLength(0);
    expect(explicacoesRestantes || [], 'explicacoes não deviam sobreviver').toHaveLength(0);
  });

  test('7 larguras: sem scroll horizontal, sem corte, sem sobreposição, botões-chave acessíveis', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, ADMIN_EMAIL, adminPassword);
    await page.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    // O texto de cada linha existe em duplicado no DOM (versão mobile e
    // desktop, uma delas escondida por CSS consoante a largura) — ":visible"
    // isola sempre a cópia realmente mostrada.
    await expect(page.locator('p:visible', { hasText: NOME_LONGO }).first()).toBeVisible({ timeout: 15_000 });

    const LARGURAS = [360, 390, 767, 768, 1024, 1280, 1920];
    for (const largura of LARGURAS) {
      await page.setViewportSize({ width: largura, height: 1000 });
      await page.waitForTimeout(250);

      // (a) sem scroll horizontal
      const semScrollHorizontal = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(semScrollHorizontal, `scrollWidth <= clientWidth falhou a ${largura}px`).toBe(true);

      // (b) o nome muito longo e a disciplina longa não transbordam da sua célula
      for (const texto of [NOME_LONGO, DISCIPLINA_LONGA]) {
        const el = page.locator('p:visible', { hasText: texto }).first();
        await expect(el).toBeVisible();
        const semCorte = await el.evaluate((n) => n.scrollWidth <= n.clientWidth + 2);
        expect(semCorte, `"${texto}" parece cortado/com ellipsis a ${largura}px`).toBe(true);
        const box = await el.boundingBox();
        expect(box, `"${texto}" sem bounding box a ${largura}px`).not.toBeNull();
        if (box) {
          expect(box.x, `"${texto}" sai do viewport à esquerda a ${largura}px`).toBeGreaterThanOrEqual(-1);
          expect(box.x + box.width, `"${texto}" sai do viewport à direita a ${largura}px`).toBeLessThanOrEqual(largura + 1);
        }
      }

      // (c) linhas de sessão não se sobrepõem verticalmente
      const linhas = page.locator('[data-sessao-linha="1"]');
      const n = await linhas.count();
      const caixas: { top: number; bottom: number }[] = [];
      for (let i = 0; i < n; i++) {
        const box = await linhas.nth(i).boundingBox();
        if (box) caixas.push({ top: box.y, bottom: box.y + box.height });
      }
      caixas.sort((a, b) => a.top - b.top);
      for (let i = 1; i < caixas.length; i++) {
        expect(caixas[i].top, `linhas de sessão sobrepostas a ${largura}px`).toBeGreaterThanOrEqual(caixas[i - 1].bottom - 1);
      }

      // (d) botões-chave visíveis e clicáveis
      for (const nome of [/nova explicação/i, /^hoje$/i]) {
        await expect(page.getByRole('button', { name: nome })).toBeVisible();
      }
      await expect(page.getByRole('combobox').first()).toBeVisible();

      await page.screenshot({ path: `test-results/explicacoes-${largura}px.png`, fullPage: true });
    }

    await context.close();
  });

  test('fluxo existente continua igual: criar pela modal, marcar pedido pelo banner, abrir detalhe', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // As modais (Nova Explicação / Detalhe) nunca mudaram nesta tarefa — só
    // existe uma de cada vez, sempre dentro deste overlay. O calendário por
    // trás continua no DOM (duplicado mobile/desktop), por isso qualquer
    // interação com o conteúdo de uma modal fica sempre âmbito a "modal",
    // nunca a "page" diretamente.
    const modal = page.locator('div.fixed.inset-0');

    await login(page, ADMIN_EMAIL, adminPassword);
    await page.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    await expect(page.locator('p:visible', { hasText: NOME_LONGO }).first()).toBeVisible({ timeout: 15_000 });

    // --- criar uma explicação pela modal (fluxo inalterado) ---
    await page.getByRole('button', { name: /nova explicação/i }).click();
    await expect(modal.getByRole('heading', { name: 'Nova Explicação' })).toBeVisible();
    await modal.getByPlaceholder('Pesquisar aluno...').fill('Aluno Grupo Um');
    await modal.getByText('Aluno Grupo Um · 7.º ano').click();
    await modal.locator('input[type="date"]').fill(DIA_VAZIO);
    await modal.locator('input[type="time"]').fill('16:00');
    await modal.getByRole('button', { name: /marcar explicação/i }).click();
    await expect(modal).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('p:visible', { hasText: 'Aluno Grupo Um' }).first()).toBeVisible({ timeout: 15_000 });

    // --- marcar um pedido pelo banner (fluxo inalterado) ---
    await page.getByRole('button', { name: /pedido por marcar/i }).click();
    // "Marcar" sozinho também é o texto do botão "+ Marcar" de um dia livre
    // no calendário — o link do pedido é identificado pelo href, sem ambiguidade.
    const linkPedido = page.locator(`a[href*="?pedido=${pedidoMensagemId}"]`);
    await expect(linkPedido).toBeVisible({ timeout: 10_000 });
    await linkPedido.click();
    await expect(modal.getByRole('heading', { name: 'Nova Explicação' })).toBeVisible({ timeout: 15_000 });
    await expect(modal.getByText(/pedido da família/i)).toBeVisible();
    // O aluno do pedido já vem pré-selecionado (initialAlunoIds) — tocar-lhe
    // outra vez desmarcava-o, por isso só falta data/hora.
    await modal.locator('input[type="date"]').fill(DIA_VAZIO);
    await modal.locator('input[type="time"]').fill('17:00');
    await modal.getByRole('button', { name: /marcar explicação/i }).click();
    await expect(modal).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: /pedido por marcar/i })).toHaveCount(0, { timeout: 15_000 });

    // --- abrir o detalhe de uma sessão existente (fluxo inalterado) ---
    await page.locator('p:visible', { hasText: NOME_LONGO }).first().click();
    await expect(modal.getByText('Sessão dada?')).toBeVisible({ timeout: 10_000 });
    await expect(modal.getByText(DISCIPLINA_LONGA)).toBeVisible();
    // Cabeçalho da modal é "<data> · <hora>" — o X de fechar é o único
    // botão dentro desse mesmo cabeçalho.
    await modal.locator('h2', { hasText: '·' }).locator('xpath=..').locator('button').click();
    await expect(modal).toHaveCount(0, { timeout: 10_000 });

    await context.close();
  });
});
