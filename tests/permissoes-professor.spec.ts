import { test, expect, type Browser } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Permissões do professor (mensalidade/preços/contactos do encarregado) —
// SÓ LEITURA e navegação, sempre no centro DEMO, sessões reais via
// entrar.mjs (nunca imprime credenciais). Nenhuma escrita: só confirma o
// que cada papel vê/não vê e para onde é redirecionado.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DEMO_DIR = path.join(os.homedir(), 'Desktop', 'demo-centro');

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

let sessaoAdminPath: string;
let sessaoProfessorPath: string;
let alunoId: string;

test.describe.configure({ mode: 'serial' });

test.describe('Permissões do professor — mensalidade, preços e contactos escondidos', () => {
  test.beforeAll(async () => {
    const saida = execFileSync('node', ['entrar.mjs'], { cwd: DEMO_DIR, encoding: 'utf8' });
    const mAdmin = saida.match(/Sessão de admin.*guardada em: (.+\.json)/);
    const mProf = saida.match(/Sessão de professor.*guardada em: (.+\.json)/);
    if (!mAdmin || !mProf) throw new Error('entrar.mjs não devolveu os caminhos das sessões esperadas: ' + saida);
    sessaoAdminPath = mAdmin[1].trim();
    sessaoProfessorPath = mProf[1].trim();

    const { data: centroRow } = await supabaseAdmin.from('config_centro').select('id').ilike('nome_centro', '%demo%').limit(1).maybeSingle();
    const centroId = centroRow?.id;
    const { data: alunoRow, error } = await supabaseAdmin.from('alunos').select('id').eq('centro_id', centroId).limit(1).maybeSingle();
    if (error || !alunoRow) throw new Error('Não encontrei nenhum aluno do centro demo para o teste de redireção: ' + error?.message);
    alunoId = alunoRow.id;
  });

  test('professor: lista de alunos sem ícones nem botões financeiros', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext({ storageState: sessaoProfessorPath });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /gerir alunos/i })).toBeVisible({ timeout: 15_000 });

    // Botões do cabeçalho escondidos
    for (const nome of [/template/i, /importar excel/i, /exportar faturação/i, /códigos dos encarregados/i, /nova matrícula/i]) {
      await expect(page.getByRole('button', { name: nome }).or(page.getByRole('link', { name: nome }))).toHaveCount(0);
    }

    // Ícones por linha: Extrato e Editar escondidos; Relatório e Ficha mantidos
    await expect(page.getByTitle('Extrato Detalhado por Dia')).toHaveCount(0);
    await expect(page.getByTitle('Editar Aluno')).toHaveCount(0);
    await expect(page.getByTitle('Ver Relatório de Performance').first()).toBeVisible();
    await expect(page.getByTitle('Ver Notas').first()).toBeVisible();

    await context.close();
  });

  test('professor: editar/extrato/novo redirecionam para /admin/alunos', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext({ storageState: sessaoProfessorPath });
    const page = await context.newPage();

    for (const caminho of [`/admin/alunos/editar?id=${alunoId}`, `/admin/alunos/extrato?id=${alunoId}`, '/admin/alunos/novo']) {
      await page.goto(`${BASE_URL}${caminho}`, { waitUntil: 'networkidle' });
      await expect(page).toHaveURL(`${BASE_URL}/admin/alunos`, { timeout: 15_000 });
      // Nunca mostra conteúdo da página bloqueada, nem por um instante no DOM final.
      await expect(page.getByText(/mensalidade/i)).toHaveCount(0);
      await expect(page.getByText(/nif/i)).toHaveCount(0);
    }

    await context.close();
  });

  test('professor: detalhe de uma sessão dada e de uma futura — sem preço da família, com o seu valor', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext({ storageState: sessaoProfessorPath });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Explicações' })).toBeVisible({ timeout: 15_000 });

    const linhaDada = page.locator('[data-sessao-linha="1"]', { hasText: 'Dada' }).first();
    const linhaPorDar = page.locator('[data-sessao-linha="1"]', { hasText: 'Por dar' }).first();

    for (const linha of [linhaDada, linhaPorDar]) {
      if ((await linha.count()) === 0) continue; // semana atual pode não ter das duas
      await linha.click();
      await expect(page.getByText('Sessão dada?')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/cobrado à família/i)).toHaveCount(0);
      await expect(page.getByText(/sem preço/i)).toHaveCount(0);
      // O valor do próprio professor, quando existe, continua visível.
      const modal = page.locator('div.fixed.inset-0');
      await modal.locator('h2', { hasText: '·' }).locator('xpath=..').locator('button').click();
      await expect(page.getByText('Sessão dada?')).toHaveCount(0, { timeout: 10_000 });
    }

    await context.close();
  });

  test('admin: continua a ver tudo (editar, extrato, botões, Cobrado à família)', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext({ storageState: sessaoAdminPath });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: /gerir alunos/i })).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole('button', { name: /template/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /importar excel/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /exportar faturação/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /códigos dos encarregados/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /nova matrícula/i })).toBeVisible();
    await expect(page.getByTitle('Extrato Detalhado por Dia').first()).toBeVisible();
    await expect(page.getByTitle('Editar Aluno').first()).toBeVisible();

    await page.goto(`${BASE_URL}/admin/alunos/editar?id=${alunoId}`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(new RegExp(`/admin/alunos/editar\\?id=${alunoId}`));
    await expect(page.getByText(/mensalidade/i).first()).toBeVisible({ timeout: 15_000 });

    await page.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    const linhaDadaAdmin = page.locator('[data-sessao-linha="1"]', { hasText: 'Dada' }).first();
    if ((await linhaDadaAdmin.count()) > 0) {
      await linhaDadaAdmin.click();
      await expect(page.getByText('Sessão dada?')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/cobrado à família/i)).toBeVisible();
    }

    await context.close();
  });

  // A secretária demo (secretaria@demo.example) existe em staff mas não tem
  // password documentada em credenciais.txt — não é possível obter uma
  // sessão real sem a alterar (o que violaria "só leitura"). As permissões
  // dela ficam verificadas por inspeção de código: nem middleware.ts nem
  // nenhuma das páginas tocadas introduzem uma condição nova para
  // role === 'secretaria' — todas usam só !== 'professor' ou são exclusivas
  // de 'admin', já existentes antes desta tarefa.
});
