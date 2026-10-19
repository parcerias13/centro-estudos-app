import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { getHojeLisboa } from '@/lib/dataLisboa';

dotenv.config({ path: '.env.local' });

// Ajuste de apresentação: a lista "Custos Fixos" de um mês passa a mostrar
// só os ativos; terminados/futuros vão para uma gaveta "Terminados ou
// futuros (N)", fechada por defeito, com "Apagar" (confirm simples se nunca
// chegou a contar, aviso com o histórico se já contou). Centro descartável
// ZZTESTE (novo-centro.mjs) — nunca o demo, nunca o real. Ficheiro de
// credenciais nunca lido: password do admin rodada por script.

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
type Periodo = { de: string; ate: string | null; valor: number };
function valorNoMes(periodos: Periodo[], mes: string): number | null {
  const p = periodos.find((p) => {
    const de = p.de.slice(0, 7);
    const ate = p.ate ? p.ate.slice(0, 7) : null;
    return de <= mes && (ate === null || ate >= mes);
  });
  return p ? Number(p.valor) : null;
}
const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function mesParaLabelCurto(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  return `${MESES_ABREV[m - 1]} ${ano}`;
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE Apagar Terminados ${SUFIXO}`;
const ADMIN_EMAIL = `admin-apagar-term-${SUFIXO}@zzteste.invalid`;

const NOME_ATIVO = `Custo Ativo Teste ${SUFIXO}`;
const NOME_TERMINADO = `Custo Terminado Teste ${SUFIXO}`;
const NOME_FUTURO = `Custo Futuro Teste ${SUFIXO}`;
const NOME_LONGO = `Contrato de Manutenção Preventiva de Equipamento Informático e Rede ${SUFIXO}`;

const mesAtual = getHojeLisboa().slice(0, 7);
// Equivalente a "terminado em Mar / visto a partir de Jun" do pedido, mas em
// meses relativos a hoje (nunca datas fixas, para o teste nunca envelhecer).
const TERMINADO_DE = somarMeses(mesAtual, -9);
const TERMINADO_ATE = somarMeses(mesAtual, -7);
const MES_VISUALIZACAO = somarMeses(mesAtual, -4); // "Jun" — depois do fim, antes do futuro
const MES_REGRESSAO = somarMeses(mesAtual, -8); // dentro do intervalo em que o terminado contava
const FUTURO_DE = somarMeses(mesAtual, 5);
const LONGO_DE = somarMeses(mesAtual, -20);
const LONGO_ATE = somarMeses(mesAtual, -15);
const VALOR_TERMINADO = 150;
const VALOR_ATIVO = 200;
const VALOR_FUTURO = 80;
const VALOR_LONGO = 99.99;

let centroId: string;
let adminPassword: string;
let custoTerminadoId: string;
let custoFuturoId: string;

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
  for (let tentativas = 0; tentativas < 36; tentativas++) {
    const atual = await mesVisivel(page);
    if (atual === alvo) return;
    if (!atual) throw new Error('Não encontrei o seletor de mês (data-mes-selecionado).');
    if (atual < alvo) await page.getByRole('button', { name: 'Mês seguinte' }).click();
    else await page.getByRole('button', { name: 'Mês anterior' }).click();
    await page.waitForTimeout(120);
  }
  throw new Error(`Não cheguei ao mês ${alvo}`);
}

async function lerTotalFixos(page: Page): Promise<number> {
  const label = page.getByText('Fixos', { exact: true });
  const valor = await label.locator('xpath=following-sibling::p[1]').textContent();
  return parseFloat((valor || '0').replace('€', '').trim());
}

async function lerFixasPerformance(page: Page): Promise<number> {
  const texto = await page.getByText(/Fixas:/).textContent();
  const m = texto?.match(/Fixas:\s*([\d.]+)€/);
  if (!m) throw new Error('Não encontrei "Fixas:" na Performance: ' + texto);
  return parseFloat(m[1]);
}

async function criarCustoFixo(nome: string, categoria: string, centro: string, periodos: Periodo[]) {
  const { data: custo, error: e1 } = await supabaseAdmin.from('custos_fixos').insert({ nome, categoria, centro_id: centro }).select('id').single();
  if (e1) throw new Error(`criar custo ${nome}: ${e1.message}`);
  for (const p of periodos) {
    const { error: e2 } = await supabaseAdmin.from('custos_fixos_periodos').insert({ custo_id: custo.id, centro_id: centro, de: `${p.de}-01`, ate: p.ate ? `${p.ate}-01` : null, valor: p.valor });
    if (e2) throw new Error(`criar período de ${nome}: ${e2.message}`);
  }
  return custo.id as string;
}

test.describe.configure({ mode: 'serial' });

test.describe('Gestão > Custos — terminados/futuros numa gaveta à parte (ZZTESTE)', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE Terminados'],
      { cwd: GESTAO_DIR, encoding: 'utf8' }
    );
    const m = saida.match(/centro_id = ([0-9a-f-]+)/);
    if (!m) throw new Error('novo-centro.mjs não devolveu centro_id: ' + saida);
    centroId = m[1];

    const { data: staffAdmin, error: staffAdminError } = await supabaseAdmin
      .from('staff').select('id').eq('centro_id', centroId).eq('role', 'admin').single();
    if (staffAdminError || !staffAdmin) throw new Error('não encontrei o staff admin criado pelo novo-centro.mjs');
    adminPassword = gerarPasswordSegura();
    const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(staffAdmin.id, { password: adminPassword });
    if (resetError) throw new Error(`rodar password do admin: ${resetError.message}`);

    // Começa bem no passado para estar ativo tanto no mês atual como no mês
    // de visualização usado no teste do terminado (nunca "ainda não começou").
    await criarCustoFixo(NOME_ATIVO, 'Outros', centroId, [{ de: somarMeses(mesAtual, -24), ate: null, valor: VALOR_ATIVO }]);
    custoTerminadoId = await criarCustoFixo(NOME_TERMINADO, 'Professores', centroId, [{ de: TERMINADO_DE, ate: TERMINADO_ATE, valor: VALOR_TERMINADO }]);
    custoFuturoId = await criarCustoFixo(NOME_FUTURO, 'Materiais', centroId, [{ de: FUTURO_DE, ate: null, valor: VALOR_FUTURO }]);
    await criarCustoFixo(NOME_LONGO, 'Comida', centroId, [{ de: LONGO_DE, ate: LONGO_ATE, valor: VALOR_LONGO }]);
  });

  test.afterAll(async () => {
    if (centroId) await supabaseAdmin.from('custos_fixos').delete().eq('centro_id', centroId);
    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    const { data: restoFixos } = await supabaseAdmin.from('custos_fixos').select('id').eq('centro_id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
    expect(restoFixos ?? []).toHaveLength(0);
  });

  test('um custo ativo aparece na lista do mês e não na gaveta de terminados/futuros', async ({ page }) => {
    await login(page, ADMIN_EMAIL, adminPassword);
    await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await irParaMes(page, mesAtual);

    await expect(page.locator('[data-custo-fixo-linha="1"]', { hasText: NOME_ATIVO })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-custo-fixo-linha="1"]', { hasText: NOME_ATIVO }).getByText('Alterar valor')).toBeVisible();

    await page.getByRole('button', { name: /Terminados ou futuros/ }).click();
    await expect(page.locator('[data-custo-fixo-inativo-linha="1"]', { hasText: NOME_ATIVO })).toHaveCount(0);
  });

  test('um custo terminado no passado não aparece no mês de visualização, mas aparece em "Terminados ou futuros" com o período certo', async ({ page }) => {
    await login(page, ADMIN_EMAIL, adminPassword);
    await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await irParaMes(page, MES_VISUALIZACAO);

    await expect(page.locator('[data-custo-fixo-linha="1"]', { hasText: NOME_TERMINADO })).toHaveCount(0);

    const botaoGaveta = page.getByRole('button', { name: /Terminados ou futuros/ });
    await expect(botaoGaveta).toContainText('(3)'); // terminado + futuro + longo
    await botaoGaveta.click();

    const linha = page.locator('[data-custo-fixo-inativo-linha="1"]', { hasText: NOME_TERMINADO });
    await expect(linha).toBeVisible({ timeout: 10_000 });
    await expect(linha).toContainText(`de ${mesParaLabelCurto(TERMINADO_DE)} a ${mesParaLabelCurto(TERMINADO_ATE)}`);
    await expect(linha).toContainText(`${VALOR_TERMINADO.toFixed(2)}`);
  });

  test('apagar um terminado: o aviso mostra o intervalo e o total certos, e os meses antigos deixam de o contar', async ({ page }) => {
    await login(page, ADMIN_EMAIL, adminPassword);

    // Total "antes" de um mês dentro do intervalo em que o terminado contava.
    await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await irParaMes(page, MES_REGRESSAO);
    const fixosAntes = await lerTotalFixos(page);

    await page.goto(`${BASE_URL}/admin/performance`, { waitUntil: 'networkidle' });
    await irParaMes(page, MES_REGRESSAO);
    const fixasPerformanceAntes = await lerFixasPerformance(page);
    expect(fixasPerformanceAntes).toBeCloseTo(fixosAntes, 2);

    // Apagar, a partir da gaveta no mês de visualização, verificando o aviso exato.
    await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await irParaMes(page, MES_VISUALIZACAO);
    await page.getByRole('button', { name: /Terminados ou futuros/ }).click();
    const linha = page.locator('[data-custo-fixo-inativo-linha="1"]', { hasText: NOME_TERMINADO });
    await expect(linha).toBeVisible();

    const total = (() => {
      const periodos: Periodo[] = [{ de: `${TERMINADO_DE}-01`, ate: `${TERMINADO_ATE}-01`, valor: VALOR_TERMINADO }];
      let soma = 0;
      for (let m = TERMINADO_DE; m <= TERMINADO_ATE; m = somarMeses(m, 1)) soma += valorNoMes(periodos, m) ?? 0;
      return soma;
    })();
    const avisoEsperado = `Este custo contou de ${mesParaLabelCurto(TERMINADO_DE)} a ${mesParaLabelCurto(TERMINADO_ATE)}, num total de ${total.toFixed(2)} €. Se o apagares, deixa de contar nesses meses e o lucro desses meses muda. Continuar?`;

    let mensagemCapturada = '';
    page.once('dialog', (d) => { mensagemCapturada = d.message(); d.accept(); });
    await linha.getByText('Apagar').click();
    await page.waitForTimeout(500);

    expect(mensagemCapturada).toBe(avisoEsperado);
    await expect(linha).toHaveCount(0, { timeout: 10_000 });

    // Total "depois" do mesmo mês passado: caiu exatamente o valor do terminado.
    await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await irParaMes(page, MES_REGRESSAO);
    const fixosDepois = await lerTotalFixos(page);
    expect(fixosDepois).toBeCloseTo(fixosAntes - VALOR_TERMINADO, 2);

    await page.goto(`${BASE_URL}/admin/performance`, { waitUntil: 'networkidle' });
    await irParaMes(page, MES_REGRESSAO);
    const fixasPerformanceDepois = await lerFixasPerformance(page);
    expect(fixasPerformanceDepois).toBeCloseTo(fixosDepois, 2);
  });

  test('um custo futuro apaga-se com um confirm simples', async ({ page }) => {
    await login(page, ADMIN_EMAIL, adminPassword);
    await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await irParaMes(page, MES_VISUALIZACAO);
    await page.getByRole('button', { name: /Terminados ou futuros/ }).click();

    const linha = page.locator('[data-custo-fixo-inativo-linha="1"]', { hasText: NOME_FUTURO });
    await expect(linha).toBeVisible({ timeout: 10_000 });
    await expect(linha).toContainText(`a partir de ${mesParaLabelCurto(FUTURO_DE)}`);

    let mensagemCapturada = '';
    page.once('dialog', (d) => { mensagemCapturada = d.message(); d.accept(); });
    await linha.getByText('Apagar').click();
    await page.waitForTimeout(500);

    expect(mensagemCapturada).toBe(`Apagar o custo fixo "${NOME_FUTURO}"? Ainda não começou.`);
    await expect(linha).toHaveCount(0, { timeout: 10_000 });
  });

  test('lista dos ativos e totais do mês atual ficam exatamente iguais', async ({ page }) => {
    await login(page, ADMIN_EMAIL, adminPassword);
    await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
    await irParaMes(page, mesAtual);

    await expect(page.locator('[data-custo-fixo-linha="1"]', { hasText: NOME_ATIVO })).toBeVisible();
    const fixos = await lerTotalFixos(page);
    expect(fixos).toBeCloseTo(VALOR_ATIVO, 2);
  });

  for (const largura of [360, 390, 768, 1280, 1920]) {
    test(`${largura}px — gaveta aberta sem scroll horizontal nem texto cortado`, async ({ page }) => {
      await login(page, ADMIN_EMAIL, adminPassword);
      await page.setViewportSize({ width: largura, height: 900 });
      await page.goto(`${BASE_URL}/admin/gestao`, { waitUntil: 'networkidle' });
      await irParaMes(page, MES_VISUALIZACAO);
      await page.getByRole('button', { name: /Terminados ou futuros/ }).click();
      await expect(page.locator('[data-custo-fixo-inativo-linha="1"]', { hasText: NOME_LONGO })).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(250);

      const semScrollHorizontal = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(semScrollHorizontal, `scrollWidth <= clientWidth falhou a ${largura}px`).toBe(true);

      const elNome = page.locator('[data-custo-fixo-inativo-linha="1"]', { hasText: NOME_LONGO }).locator('span', { hasText: NOME_LONGO });
      await expect(elNome).toBeVisible();
      const semCorte = await elNome.evaluate((n) => n.scrollWidth <= n.clientWidth + 2);
      expect(semCorte, `nome longo parece cortado a ${largura}px`).toBe(true);
      const box = await elNome.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(largura + 1);
      }
    });
  }
});
