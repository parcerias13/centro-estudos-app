import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { getHojeLisboa } from '@/lib/dataLisboa';

dotenv.config({ path: '.env.local' });

// Fluxo completo da secção "Custos" de Gestão + Performance, num centro
// descartável ZZTESTE (nunca o demo, nunca o real), criado via
// ~/Desktop/gestao-centros/novo-centro.mjs. O ficheiro de credenciais que
// esse script escreve nunca é lido — a password da conta admin é rodada por
// script (id via `staff`), nunca lida do ficheiro.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const GESTAO_DIR = path.join(os.homedir(), 'Desktop', 'gestao-centros');
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

// Mesma aritmética de meses de lib/custos.ts, reimplementada aqui (sem Date)
// para este ficheiro não precisar de importar @/lib/custos (que arrasta
// @/lib/supabase e exige env vars de browser logo no import).
function mesParaIndice(mes: string): number {
  const [ano, m] = mes.split('-').map(Number);
  return ano * 12 + (m - 1);
}
function indiceParaMes(indice: number): string {
  const ano = Math.floor(indice / 12);
  const m = (indice % 12) + 1;
  return `${ano}-${String(m).padStart(2, '0')}`;
}
function somarMeses(mes: string, delta: number): string {
  return indiceParaMes(mesParaIndice(mes) + delta);
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE Fluxo Custos ${SUFIXO}`;
const ADMIN_EMAIL = `admin-fluxo-custos-${SUFIXO}@zzteste.invalid`;
const NOME_CUSTO = `Renda Teste ${SUFIXO}`;
const CATEGORIA_LONGA = 'Materiais e Equipamento Pedagógico Especializado';
const NOME_LONGO = `Contrato de Manutenção e Assistência Técnica Trimestral do Edifício Principal ${SUFIXO}`;

let centroId: string;
let adminPassword: string;

const mesAtual = getHojeLisboa().slice(0, 7);
const mesSeguinte = somarMeses(mesAtual, 1);
const mesDepoisDisso = somarMeses(mesAtual, 2);

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 });
}

async function mesVisivel(page: Page) {
  return page.locator('[data-mes-selecionado]').first().getAttribute('data-mes-selecionado');
}

async function irParaMes(page: Page, alvo: string) {
  for (let tentativas = 0; tentativas < 24; tentativas++) {
    const atual = await mesVisivel(page);
    if (atual === alvo) return;
    if (!atual) throw new Error('Não encontrei o seletor de mês (data-mes-selecionado).');
    if (atual < alvo) await page.getByRole('button', { name: 'Mês seguinte' }).click();
    else await page.getByRole('button', { name: 'Mês anterior' }).click();
    await page.waitForTimeout(150);
  }
  throw new Error(`Não cheguei ao mês ${alvo}`);
}

test.describe.configure({ mode: 'serial' });

test.describe('Fluxo completo de Custos — Gestão + Performance (ZZTESTE)', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE Fluxo'],
      { cwd: GESTAO_DIR, encoding: 'utf8' }
    );
    const m = saida.match(/centro_id = ([0-9a-f-]+)/);
    if (!m) throw new Error('novo-centro.mjs não devolveu centro_id: ' + saida);
    centroId = m[1];

    const { data: staffAdmin, error: staffAdminError } = await supabaseAdmin
      .from('staff')
      .select('id')
      .eq('centro_id', centroId)
      .eq('role', 'admin')
      .single();
    if (staffAdminError || !staffAdmin) throw new Error('não encontrei o staff admin criado pelo novo-centro.mjs');
    adminPassword = gerarPasswordSegura();
    const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(staffAdmin.id, { password: adminPassword });
    if (resetError) throw new Error(`rodar password do admin: ${resetError.message}`);
  });

  test.afterAll(async () => {
    // custos_fixos/custos_fixos_periodos ainda não constam da lista de
    // tabelas do apagar-centro.mjs — apagamos nós mesmos antes de o chamar.
    if (centroId) await supabaseAdmin.from('custos_fixos').delete().eq('centro_id', centroId);
    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    const { data: restoFixos } = await supabaseAdmin.from('custos_fixos').select('id').eq('centro_id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
    expect(restoFixos ?? []).toHaveLength(0);
  });

  test('criar um custo fixo e vê-lo contar no mês seguinte sem fazer nada', async ({ page }) => {
    await login(page, ADMIN_EMAIL, adminPassword);
    await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Custos do Centro')).toBeVisible({ timeout: 15_000 });
    await irParaMes(page, mesAtual);

    // Criar
    await page.getByText('Custos Fixos').locator('xpath=following-sibling::button[1]').click();
    await page.getByPlaceholder('ex: Renda, Salário Professores').fill(NOME_CUSTO);
    await page.locator('select').first().selectOption('Professores');
    await page.getByPlaceholder('0.00').first().fill('500');
    await page.locator('input[type="month"]').first().fill(mesAtual);
    await page.getByRole('button', { name: 'Criar Custo Fixo' }).click();

    const linha = page.locator('[data-custo-fixo-linha="1"]', { hasText: NOME_CUSTO });
    await expect(linha).toBeVisible({ timeout: 10_000 });
    await expect(linha).toContainText('500.00');

    // Mês seguinte: sem fazer nada, continua a contar 500.
    await irParaMes(page, mesSeguinte);
    const linhaSeguinte = page.locator('[data-custo-fixo-linha="1"]', { hasText: NOME_CUSTO });
    await expect(linhaSeguinte).toContainText('500.00');
    await expect(linhaSeguinte).not.toContainText('Ainda não começou');
    await expect(linhaSeguinte).not.toContainText('Terminou');
  });

  test('alterar o valor a partir do mês seguinte — o mês atual não muda', async ({ page }) => {
    await login(page, ADMIN_EMAIL, adminPassword);
    await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await irParaMes(page, mesAtual);

    const linha = page.locator('[data-custo-fixo-linha="1"]', { hasText: NOME_CUSTO });
    await linha.getByText('Alterar valor').click();
    await linha.locator('input[type="number"]').fill('650');
    await linha.locator('input[type="month"]').fill(mesSeguinte);
    await linha.getByRole('button', { name: 'Guardar' }).click();
    await expect(linha.getByRole('button', { name: 'Guardar' })).toHaveCount(0, { timeout: 10_000 });

    // Mês atual mantém o valor antigo.
    await expect(linha).toContainText('500.00');

    // Mês seguinte já mostra o novo valor.
    await irParaMes(page, mesSeguinte);
    const linhaSeguinte = page.locator('[data-custo-fixo-linha="1"]', { hasText: NOME_CUSTO });
    await expect(linhaSeguinte).toContainText('650.00');
  });

  test('terminar o custo — deixa de contar a partir do mês escolhido', async ({ page }) => {
    await login(page, ADMIN_EMAIL, adminPassword);
    await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await irParaMes(page, mesSeguinte);

    const linha = page.locator('[data-custo-fixo-linha="1"]', { hasText: NOME_CUSTO });
    await linha.getByText('Terminar').click();
    await linha.locator('input[type="month"]').fill(mesDepoisDisso);
    await linha.getByRole('button', { name: 'Confirmar' }).click();
    await expect(linha.getByRole('button', { name: 'Confirmar' })).toHaveCount(0, { timeout: 10_000 });

    // Mês seguinte (antes do fim) continua ativo.
    await expect(linha).toContainText('650.00');

    // Mês do fim em diante: terminado, cinzento, sem botões.
    await irParaMes(page, mesDepoisDisso);
    const linhaTerminada = page.locator('[data-custo-fixo-linha="1"]', { hasText: NOME_CUSTO });
    await expect(linhaTerminada).toContainText('Terminou em');
    await expect(linhaTerminada.getByText('Alterar valor')).toHaveCount(0);
    await expect(linhaTerminada.getByText('Terminar')).toHaveCount(0);
  });

  test('acrescentar e apagar um custo variável — os totais do mês batem certo', async ({ page }) => {
    await login(page, ADMIN_EMAIL, adminPassword);
    await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await irParaMes(page, mesAtual);

    await page.getByText('Custos Variáveis').locator('xpath=following-sibling::button[1]').click();
    await page.locator('select').first().selectOption('Comida');
    await page.getByPlaceholder('0.00').first().fill('42.50');
    await page.getByPlaceholder('ex: resma de papel').fill(`Lanches ${SUFIXO}`);
    await page.getByRole('button', { name: 'Registar Custo Variável' }).click();

    const linhaVar = page.locator('[data-custo-variavel-linha="1"]', { hasText: `Lanches ${SUFIXO}` });
    await expect(linhaVar).toBeVisible({ timeout: 10_000 });

    // Totais do mês: fixos (500, ainda não alterado neste mês) + variáveis (42.50).
    const totais = page.locator('div').filter({ hasText: 'Total do mês' }).last();
    await expect(totais).toContainText('542.50');

    page.once('dialog', (d) => d.accept());
    await linhaVar.getByText('Apagar').click();
    await expect(linhaVar).toHaveCount(0, { timeout: 10_000 });
    await expect(totais).toContainText('500.00');
  });

  test('a Performance mostra os mesmos totais que Gestão', async ({ page }) => {
    await login(page, ADMIN_EMAIL, adminPassword);
    await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await irParaMes(page, mesAtual);
    await expect(page.locator('div').filter({ hasText: 'Total do mês' }).last()).toContainText('500.00');

    await page.goto(`${BASE_URL}/admin/performance`, { waitUntil: 'networkidle' });
    await irParaMes(page, mesAtual);
    // "Fixas: 500.00€ · Variáveis: 0.00€ · Explicações: ..." — mesmo valor fixo que Gestão.
    await expect(page.getByText(/Fixas:/)).toContainText('500.00');
    await expect(page.getByText(/Fixas:/)).toContainText('Variáveis: 0.00');
  });

  for (const largura of [360, 390, 768, 1024, 1280, 1920]) {
    test(`${largura}px — sem scroll horizontal, sem texto cortado, sem sobreposições`, async ({ page }) => {
      await login(page, ADMIN_EMAIL, adminPassword);
      await page.setViewportSize({ width: largura, height: 900 });

      // Fixture extra com nome/categoria longos, só para este teste de layout.
      await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
      await irParaMes(page, mesAtual);

      const jaExiste = await page.locator('[data-custo-fixo-linha="1"]', { hasText: NOME_LONGO }).count();
      if (jaExiste === 0) {
        await page.getByText('Custos Fixos').locator('xpath=following-sibling::button[1]').click();
        await page.getByPlaceholder('ex: Renda, Salário Professores').fill(NOME_LONGO);
        await page.locator('select').first().selectOption({ label: 'Materiais' });
        await page.getByPlaceholder('0.00').first().fill('99.99');
        await page.locator('input[type="month"]').first().fill(mesAtual);
        await page.getByRole('button', { name: 'Criar Custo Fixo' }).click();
        await expect(page.locator('[data-custo-fixo-linha="1"]', { hasText: NOME_LONGO })).toBeVisible({ timeout: 10_000 });
      }

      await page.waitForTimeout(250);

      const semScrollHorizontal = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(semScrollHorizontal, `scrollWidth <= clientWidth falhou a ${largura}px`).toBe(true);

      const elNome = page.locator('[data-custo-fixo-linha="1"]', { hasText: NOME_LONGO }).locator('span', { hasText: NOME_LONGO });
      await expect(elNome).toBeVisible();
      const semCorte = await elNome.evaluate((n) => n.scrollWidth <= n.clientWidth + 2);
      expect(semCorte, `nome longo parece cortado a ${largura}px`).toBe(true);
      const box = await elNome.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(largura + 1);
      }

      const linhas = page.locator('[data-custo-fixo-linha="1"]');
      const n = await linhas.count();
      const caixas: { top: number; bottom: number }[] = [];
      for (let i = 0; i < n; i++) {
        const b = await linhas.nth(i).boundingBox();
        if (b) caixas.push({ top: b.y, bottom: b.y + b.height });
      }
      caixas.sort((a, b) => a.top - b.top);
      for (let i = 1; i < caixas.length; i++) {
        expect(caixas[i].top, `linhas de custo fixo sobrepostas a ${largura}px`).toBeGreaterThanOrEqual(caixas[i - 1].bottom - 1);
      }
    });
  }
});
