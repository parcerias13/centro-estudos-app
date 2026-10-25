import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// A chave do Resend passou a ser da PLATAFORMA (process.env.RESEND_API_KEY),
// nunca por centro — estes testes cobrem só os cenários que não dependem de
// EMAIL_CENTROS_AUTORIZADOS nem de RESEND_API_KEY estarem de uma forma
// especial no servidor (passam com o ambiente normal de desenvolvimento):
// sem sessão, professor, um centro fora da allowlist (vazia por omissão), e
// a garantia de que /api/config-centro nunca devolve a chave nem o
// remetente. Os cenários que exigem o servidor arrancado com
// EMAIL_CENTROS_AUTORIZADOS/RESEND_API_KEY especiais (404 de centro
// permitido, recusa sem chave, e o envio real) foram verificados à parte
// (não cabem num único processo de servidor partilhado pela suite).

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

let centroId: string;
let admin: { email: string; password: string; id: string };
let professor: { email: string; password: string; id: string };
let aluno: { id: string };
const CHAVE_FALSA = 'FAKE_PER_CENTRO_KEY_SHOULD_NEVER_LEAK';
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

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="identificador"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

test.describe('Aviso por email — chave da plataforma', () => {
  test.beforeAll(async () => {
    const sufixo = String(Date.now());

    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({
        nome_centro: `Teste Chave Plataforma ${sufixo}`,
        email_remetente: `teste-chave-plataforma-${sufixo}@example.invalid`,
        resend_api_key: CHAVE_FALSA, // nunca pode aparecer em lado nenhum da resposta
      })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    const adminEmail = `teste-chave-plataforma-admin-${sufixo}@example.invalid`;
    const adminPassword = gerarPasswordSegura();
    const adminId = await criarUtilizadorAuth(adminEmail, adminPassword, { role: 'admin', centro_id: centroId });
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(adminId));
    const { error: staffAdminError } = await supabaseAdmin.from('staff').insert({ id: adminId, email: adminEmail, name: 'Admin Teste', role: 'admin', centro_id: centroId });
    if (staffAdminError) throw new Error(`criar staff admin: ${staffAdminError.message}`);
    limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', adminId));
    admin = { email: adminEmail, password: adminPassword, id: adminId };

    const profEmail = `teste-chave-plataforma-prof-${sufixo}@example.invalid`;
    const profPassword = gerarPasswordSegura();
    const profId = await criarUtilizadorAuth(profEmail, profPassword, { role: 'professor', centro_id: centroId });
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(profId));
    const { error: staffProfError } = await supabaseAdmin.from('staff').insert({ id: profId, email: profEmail, name: 'Professor Teste', role: 'professor', centro_id: centroId });
    if (staffProfError) throw new Error(`criar staff professor: ${staffProfError.message}`);
    limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', profId));
    professor = { email: profEmail, password: profPassword, id: profId };

    const alunoEmail = `teste-chave-plataforma-aluno-${sufixo}@example.invalid`;
    const alunoId = await criarUtilizadorAuth(alunoEmail, gerarPasswordSegura(), { centro_id: centroId });
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(alunoId));
    const { error: alunoError } = await supabaseAdmin.from('alunos').insert({
      id: alunoId, nome: 'Aluno Teste', email: alunoEmail, email_encarregado: 'enc@example.invalid',
      data_nascimento: '2012-01-01', ano_escolar: 7, centro_id: centroId, ativo: true,
    });
    if (alunoError) throw new Error(`criar aluno: ${alunoError.message}`);
    limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', alunoId));
    aluno = { id: alunoId };
  });

  test.afterAll(async () => {
    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }
  });

  test('sem sessão → 401', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/relatorio-mensal/avisar`, {
      data: { ano: 2030, mes: 1, alunoIds: [aluno.id] },
    });
    expect(res.status()).toBe(401);
  });

  test('professor → 403', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, professor.email, professor.password);
    const res = await context.request.post(`${BASE_URL}/api/admin/relatorio-mensal/avisar`, {
      data: { ano: 2030, mes: 1, alunoIds: [aluno.id] },
    });
    expect(res.status()).toBe(403);
    await context.close();
  });

  test('admin de um centro fora da allowlist (vazia por omissão) → 403 genérico', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, admin.email, admin.password);
    const res = await context.request.post(`${BASE_URL}/api/admin/relatorio-mensal/avisar`, {
      data: { ano: 2030, mes: 1, alunoIds: [aluno.id] },
    });
    expect(res.status()).toBe(403);
    const corpo = await res.json();
    expect(corpo.error).not.toMatch(/resend|chave|key/i);
    await context.close();
  });

  test('GET /api/config-centro nunca contém a chave nem o remetente', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, admin.email, admin.password);
    const res = await context.request.get(`${BASE_URL}/api/config-centro`);
    expect(res.status()).toBe(200);
    const corpo = await res.json();
    expect(corpo).not.toHaveProperty('resend_api_key');
    expect(corpo).not.toHaveProperty('email_remetente');
    expect(JSON.stringify(corpo)).not.toContain(CHAVE_FALSA);
    await context.close();
  });
});
