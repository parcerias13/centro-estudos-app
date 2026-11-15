import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// subjects.name passou de UNIQUE(name) global para UNIQUE(centro_id,
// lower(btrim(name))) — a mesma disciplina pode existir em centros
// diferentes, mas não duas vezes no mesmo centro (nem só a trocar
// maiúsculas/minúsculas). Dois centros descartáveis ZZTESTE (A e B),
// criados/apagados pelos scripts habituais (~/Desktop/gestao-centros/
// {novo-centro,apagar-centro}.mjs), nunca o centro real nem o demo.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const GESTAO_DIR = path.join(os.homedir(), 'Desktop', 'gestao-centros');
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SUFIXO = String(Date.now());
const NOME_ZZTESTE_A = `ZZTESTE SubjectsUnicidadeA ${SUFIXO}`;
const NOME_ZZTESTE_B = `ZZTESTE SubjectsUnicidadeB ${SUFIXO}`;
const ADMIN_EMAIL_A = `admin-su-a-${SUFIXO}@zzteste.invalid`;
const ADMIN_EMAIL_B = `admin-su-b-${SUFIXO}@zzteste.invalid`;
const MARCADOR = `SU_${SUFIXO}`;
const NOME_PARTILHADO = `Disciplina Partilhada ${MARCADOR}`;

type Conta = { email: string; password: string; id: string };

let centroIdA: string;
let centroIdB: string;
let adminA: Conta;
let adminB: Conta;

const limpeza: Array<() => unknown> = [];

async function criarCentro(nome: string, adminEmail: string, adminNome: string): Promise<{ centroId: string; admin: Conta }> {
  const saida = execFileSync(
    'node',
    ['novo-centro.mjs', '--nome', nome, '--admin-email', adminEmail, '--admin-nome', adminNome],
    { cwd: GESTAO_DIR, encoding: 'utf8' }
  );
  const m = saida.match(/centro_id = ([0-9a-f-]+)/);
  if (!m) throw new Error(`novo-centro.mjs (${nome}) não devolveu centro_id: ${saida}`);
  const centroId = m[1];

  const { data: staffAdmin, error: staffAdminError } = await supabaseAdmin
    .from('staff').select('id').eq('centro_id', centroId).eq('role', 'admin').single();
  if (staffAdminError || !staffAdmin) throw new Error(`não encontrei o staff admin de ${nome}`);
  const password = gerarPasswordSegura();
  const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(staffAdmin.id, { password });
  if (resetError) throw new Error(`rodar password do admin de ${nome}: ${resetError.message}`);

  return { centroId, admin: { email: adminEmail, password, id: staffAdmin.id } };
}

async function loginUI(p: Page, email: string, password: string) {
  await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="identificador"]', email);
  await p.fill('input[type="password"]', password);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

async function criarDisciplinaViaUI(page: Page, nome: string, anosAplicaveis: number[] = []) {
  await page.getByRole('button', { name: 'Adicionar Disciplina' }).click();
  await page.getByPlaceholder('Ex: Biologia').fill(nome);
  for (const ano of anosAplicaveis) {
    await page.getByRole('button', { name: `${ano}º`, exact: true }).click();
  }
  await page.getByRole('button', { name: /criar disciplina/i }).click();
}

test.describe.configure({ mode: 'serial' });

test.describe('subjects.name único por centro (sem distinguir maiúsculas) — dois centros descartáveis ZZTESTE', () => {
  test.beforeAll(async () => {
    const a = await criarCentro(NOME_ZZTESTE_A, ADMIN_EMAIL_A, 'Admin ZZTESTE SubjectsUnicidade A');
    centroIdA = a.centroId;
    adminA = a.admin;

    const b = await criarCentro(NOME_ZZTESTE_B, ADMIN_EMAIL_B, 'Admin ZZTESTE SubjectsUnicidade B');
    centroIdB = b.centroId;
    adminB = b.admin;
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await Promise.all([...limpeza].map((passo) => Promise.resolve(passo()).catch(() => {})));
    if (centroIdA) {
      execFileSync('node', ['apagar-centro.mjs', centroIdA, '--confirmo-apagar', NOME_ZZTESTE_A], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    if (centroIdB) {
      execFileSync('node', ['apagar-centro.mjs', centroIdB, '--confirmo-apagar', NOME_ZZTESTE_B], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoA } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroIdA);
    expect(restoA ?? []).toHaveLength(0);
    const { data: restoB } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroIdB);
    expect(restoB ?? []).toHaveLength(0);
  });

  test('(a) o mesmo nome de disciplina pode existir em dois centros diferentes', async () => {
    const { data: subjA, error: erroA } = await supabaseAdmin
      .from('subjects').insert({ name: NOME_PARTILHADO, centro_id: centroIdA }).select('id, name, centro_id').single();
    expect(erroA, 'criar a disciplina no centro A não devia falhar').toBeNull();
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', subjA!.id));

    const { data: subjB, error: erroB } = await supabaseAdmin
      .from('subjects').insert({ name: NOME_PARTILHADO, centro_id: centroIdB }).select('id, name, centro_id').single();
    expect(erroB, 'criar a MESMA disciplina no centro B também não devia falhar').toBeNull();
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', subjB!.id));

    expect(subjA!.name).toBe(NOME_PARTILHADO);
    expect(subjB!.name).toBe(NOME_PARTILHADO);
    expect(subjA!.centro_id).toBe(centroIdA);
    expect(subjB!.centro_id).toBe(centroIdB);
    expect(subjA!.id).not.toBe(subjB!.id);
  });

  test('(b) no mesmo centro, repetir o nome (incl. só com maiúsculas diferentes) mostra a mensagem amigável na UI', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, adminA.email, adminA.password);
    await page.goto(`${BASE_URL}/admin/disciplinas`, { waitUntil: 'networkidle' });

    const nome = `Disciplina Dup ${MARCADOR}`;

    // 1ª criação: sucesso — o modal fecha e a disciplina aparece na lista.
    await criarDisciplinaViaUI(page, nome);
    await expect(page.getByText(nome, { exact: true })).toBeVisible({ timeout: 15_000 });

    const { data: criada } = await supabaseAdmin.from('subjects').select('id').eq('centro_id', centroIdA).eq('name', nome).single();
    expect(criada).toBeTruthy();
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', criada!.id));

    // 2ª tentativa, nome exatamente igual: mensagem amigável, sem alert().
    await criarDisciplinaViaUI(page, nome);
    await expect(page.getByText('Já existe uma disciplina com este nome neste centro.')).toBeVisible({ timeout: 10_000 });

    // 3ª tentativa, só a trocar maiúsculas/minúsculas: mesma mensagem —
    // confirma que a comparação ignora caixa (lower(btrim(name))).
    await page.getByPlaceholder('Ex: Biologia').fill(nome.toUpperCase());
    await page.getByRole('button', { name: /criar disciplina/i }).click();
    await expect(page.getByText('Já existe uma disciplina com este nome neste centro.')).toBeVisible({ timeout: 10_000 });

    // Nenhuma das duas tentativas falhadas criou uma segunda linha.
    const { data: linhas } = await supabaseAdmin.from('subjects').select('id').eq('centro_id', centroIdA).ilike('name', nome);
    expect(linhas ?? []).toHaveLength(1);

    await context.close();
  });
});
