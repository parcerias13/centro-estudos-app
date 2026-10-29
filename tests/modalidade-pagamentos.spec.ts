import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Modalidade (sala_estudo / faz_explicacoes) em Pagamentos e na lista de
// Alunos: um aluno "só explicações" com mensalidade_base <= 0 nunca ganha
// linha em `mensalidades` (lib/mensalidades.ts); linhas antigas de 0€ por
// pagar ficam escondidas (não apagadas) em /admin/pagamentos, mas uma linha
// de 0€ já paga continua visível; filtros e etiquetas da lista de Alunos
// têm as contagens certas. Isolado num centro ZZTESTE próprio, apagado no
// fim.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const SUFIXO = String(Date.now());

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

let centroId: string;
let admin: { email: string; password: string };
let context: BrowserContext;
let page: Page;
const limpeza: Array<() => unknown> = [];

let alunoSala: { id: string; nome: string };
let alunoSoExplicacoes: { id: string; nome: string };
let alunoAmbos: { id: string; nome: string };

async function loginUI(p: Page, identificador: string, password: string) {
  await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="identificador"]', identificador);
  await p.fill('input[type="password"]', password);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

async function criarAluno(nome: string, mensalidade_base: number, sala_estudo: boolean, faz_explicacoes: boolean) {
  const res = await page.request.post(`${BASE_URL}/api/admin/criar-aluno`, {
    data: { nome, ano_escolar: 8, mensalidade_base, sala_estudo, faz_explicacoes },
  });
  const body = await res.json();
  if (!body.alunoId) throw new Error(`criar aluno ${nome}: ${body?.error}`);
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(body.alunoId));
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', body.alunoId));
  limpeza.push(() => supabaseAdmin.from('aluno_horarios').delete().eq('aluno_id', body.alunoId));
  limpeza.push(() => supabaseAdmin.from('encarregado_codigos').delete().eq('aluno_id', body.alunoId));
  return { id: body.alunoId as string, nome };
}

test.describe('Modalidade — Pagamentos e lista de Alunos', () => {
  test.beforeAll(async ({ browser }) => {
    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Modalidade Pagamentos ${SUFIXO}`, email_remetente: `zzteste-modalidade-pagamentos-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    const email = `zzteste-modalidade-pagamentos-admin-${SUFIXO}@example.invalid`;
    const password = gerarPasswordSegura();
    const { data: userData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
    if (authError) throw new Error(`criar admin: ${authError.message}`);
    const id = userData.user.id;
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
    await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { role: 'admin', centro_id: centroId } });
    const { error: staffError } = await supabaseAdmin.from('staff').insert({ id, email, name: 'ZZTESTE Admin Modalidade Pagamentos', role: 'admin', centro_id: centroId });
    if (staffError) throw new Error(`criar staff: ${staffError.message}`);
    limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
    admin = { email, password };

    context = await browser.newContext();
    page = await context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    await loginUI(page, admin.email, admin.password);
    expect(page.url()).toContain('/admin');

    // Três alunos, um de cada modalidade — criados ANTES de qualquer visita
    // a /admin/pagamentos, para a primeira geração do mês apanhar os três
    // de uma vez (garantirMesGerado só gera uma vez por ano/mês).
    alunoSala = await criarAluno(`Pagamentos Sala ${SUFIXO}`, 40, true, false);
    alunoSoExplicacoes = await criarAluno(`Pagamentos SoExplicacoes ${SUFIXO}`, 0, false, true);
    alunoAmbos = await criarAluno(`Pagamentos Ambos ${SUFIXO}`, 50, true, true);
  });

  test.afterAll(async () => {
    await supabaseAdmin.from('mensalidades').delete().eq('centro_id', centroId);
    const { data: alunosParaApagar } = await supabaseAdmin.from('alunos').select('id').eq('centro_id', centroId);
    for (const a of alunosParaApagar || []) {
      await supabaseAdmin.auth.admin.deleteUser(a.id).catch(() => {});
    }
    await supabaseAdmin.from('alunos').delete().eq('centro_id', centroId);
    await context?.close();
    for (const passo of [...limpeza].reverse()) {
      try {
        const resultado: any = await Promise.resolve(passo());
        if (resultado?.error) console.warn('limpeza: passo com erro (não fatal):', resultado.error.message);
      } catch (err: any) {
        console.warn('limpeza: passo lançou (não fatal):', err?.message);
      }
    }
  });

  test('mensalidades do mês atual: só os alunos com mensalidade_base > 0 ganham linha', async () => {
    await page.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' });
    await expect(page.locator('table')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});

    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = hoje.getMonth() + 1;

    const { data: linhaSoExplicacoes } = await supabaseAdmin.from('mensalidades').select('id').eq('aluno_id', alunoSoExplicacoes.id).eq('ano', ano).eq('mes', mes);
    expect(linhaSoExplicacoes || []).toHaveLength(0);

    const { data: linhaAmbos } = await supabaseAdmin.from('mensalidades').select('id, valor_esperado').eq('aluno_id', alunoAmbos.id).eq('ano', ano).eq('mes', mes).single();
    expect(linhaAmbos).toBeTruthy();
    expect(Number(linhaAmbos?.valor_esperado)).toBe(50);

    // Reflexo na UI: procurar pelo nome do "só explicações" não devolve nada.
    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoSoExplicacoes.nome);
    await expect(page.getByText(/nenhum aluno encontrado para a pesquisa/i)).toBeVisible();

    await page.locator('input[placeholder="Pesquisar aluno..."]').fill(alunoAmbos.nome);
    await expect(page.getByText(alunoAmbos.nome)).toBeVisible();
  });

  test('linha antiga de mensalidade a 0€: por pagar fica escondida, paga continua visível (sem apagar nenhuma da BD)', async () => {
    const hoje = new Date();
    let anoPassado = hoje.getFullYear();
    let mesPassado = hoje.getMonth(); // mês anterior, 1-based já com -1 aplicado
    if (mesPassado === 0) { mesPassado = 12; anoPassado -= 1; }

    const { error: errInsert1 } = await supabaseAdmin.from('mensalidades').insert({
      centro_id: centroId, aluno_id: alunoSala.id, ano: anoPassado, mes: mesPassado, valor_esperado: 0, pago: false,
    });
    if (errInsert1) throw new Error(`seed linha por pagar: ${errInsert1.message}`);

    const { error: errInsert2 } = await supabaseAdmin.from('mensalidades').insert({
      centro_id: centroId, aluno_id: alunoAmbos.id, ano: anoPassado, mes: mesPassado, valor_esperado: 0, pago: true,
      valor_pago: 0, data_pagamento: `${anoPassado}-${String(mesPassado).padStart(2, '0')}-01`,
    });
    if (errInsert2) throw new Error(`seed linha paga: ${errInsert2.message}`);

    await page.goto(`${BASE_URL}/admin/pagamentos`, { waitUntil: 'networkidle' });
    await page.locator('button:has(svg.lucide-chevron-left)').click();
    await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});

    await expect(page.getByText(alunoSala.nome)).toHaveCount(0);
    await expect(page.getByText(alunoAmbos.nome)).toBeVisible();

    // Confirmação de que nada foi apagado da BD — as duas linhas continuam lá.
    const { data: linhas } = await supabaseAdmin.from('mensalidades').select('aluno_id, pago').eq('centro_id', centroId).eq('ano', anoPassado).eq('mes', mesPassado);
    expect(linhas).toHaveLength(2);
  });

  test('lista de Alunos: etiquetas de cor e filtro "Todos | Sala de estudo | Só explicações | Ambos" com as contagens certas', async () => {
    await page.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });

    const selectModalidade = page.locator('select').filter({ has: page.locator('option', { hasText: 'Ambos' }) });
    const opcoes = await selectModalidade.locator('option').allTextContents();
    expect(opcoes.some((o) => /^Sala de Estudo \(\d+\)$/.test(o.trim()) && o.includes('(1)'))).toBe(true);
    expect(opcoes.some((o) => /^Só Explicações \(\d+\)$/.test(o.trim()) && o.includes('(1)'))).toBe(true);
    expect(opcoes.some((o) => /^Ambos \(\d+\)$/.test(o.trim()) && o.includes('(1)'))).toBe(true);

    // Etiquetas no cartão de cada aluno — verde (Sala de Estudo), roxo
    // (Explicações), as duas juntas para "ambos".
    const containerDoAluno = (nome: string) => page.locator('h3', { hasText: nome }).locator('xpath=..');

    await expect(containerDoAluno(alunoSala.nome).getByText('Sala de Estudo', { exact: true })).toBeVisible();
    await expect(containerDoAluno(alunoSala.nome).getByText('Explicações', { exact: true })).toHaveCount(0);

    await expect(containerDoAluno(alunoSoExplicacoes.nome).getByText('Explicações', { exact: true })).toBeVisible();
    await expect(containerDoAluno(alunoSoExplicacoes.nome).getByText('Sala de Estudo', { exact: true })).toHaveCount(0);

    await expect(containerDoAluno(alunoAmbos.nome).getByText('Sala de Estudo', { exact: true })).toBeVisible();
    await expect(containerDoAluno(alunoAmbos.nome).getByText('Explicações', { exact: true })).toBeVisible();

    // Filtro: "Só Explicações" mostra só o aluno dessa modalidade.
    await selectModalidade.selectOption('so_explicacoes');
    await expect(page.locator('h3', { hasText: alunoSoExplicacoes.nome })).toBeVisible();
    await expect(page.locator('h3', { hasText: alunoSala.nome })).toHaveCount(0);
    await expect(page.locator('h3', { hasText: alunoAmbos.nome })).toHaveCount(0);

    await selectModalidade.selectOption('ambos');
    await expect(page.locator('h3', { hasText: alunoAmbos.nome })).toBeVisible();
    await expect(page.locator('h3', { hasText: alunoSala.nome })).toHaveCount(0);

    await selectModalidade.selectOption('todos');
    await expect(page.locator('h3', { hasText: alunoSala.nome })).toBeVisible();
    await expect(page.locator('h3', { hasText: alunoSoExplicacoes.nome })).toBeVisible();
    await expect(page.locator('h3', { hasText: alunoAmbos.nome })).toBeVisible();
  });

  test('lista de Alunos a 390px de largura: sem scroll horizontal', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });
    const temScrollHorizontal = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(temScrollHorizontal).toBe(false);
    await page.setViewportSize({ width: 1280, height: 800 });
  });
});
