import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// /api/send-report e /api/admin/criar-staff só podem ser chamadas por admin
// (e, no caso do send-report, também secretaria) — nunca por professor nem
// por aluno. Isto cria um professor e um aluno descartáveis, autentica-os a
// sério (sessão por cookies via /login, exatamente como o browser faz) e
// confirma que as duas rotas respondem sempre 403 a ambos.
//
// Precisa de NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no
// .env.local (os mesmos que a app usa) e do servidor a correr — ver
// playwright.config.ts (webServer arranca "npm run start" sozinho).

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

type Conta = { email: string; password: string; authId: string };

let centroId: string;
let professor: Conta;
let aluno: Conta;
const limpeza: Array<() => Promise<unknown>> = [];

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

async function login(context: BrowserContext, email: string, password: string) {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
  await page.close();
}

test.describe('Rotas sensíveis exigem admin (ou secretaria, no send-report)', () => {
  test.beforeAll(async () => {
    const sufixo = Date.now();

    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({
        nome_centro: `Teste Autorização ${sufixo}`,
        email_remetente: `teste-autorizacao-${sufixo}@example.invalid`,
        resend_api_key: null,
      })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro de teste: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    // Professor
    const professorEmail = `teste-autorizacao-professor-${sufixo}@example.invalid`;
    const professorPassword = gerarPasswordSegura();
    const professorId = await criarUtilizadorAuth(professorEmail, professorPassword, { role: 'professor', centro_id: centroId });
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(professorId));
    const { error: staffError } = await supabaseAdmin.from('staff').insert({
      id: professorId, email: professorEmail, name: 'Professor Teste Autorização', role: 'professor', centro_id: centroId,
    });
    if (staffError) throw new Error(`criar staff de teste: ${staffError.message}`);
    limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', professorId));
    professor = { email: professorEmail, password: professorPassword, authId: professorId };

    // Aluno (mesmo padrão real: só centro_id no app_metadata, sem role)
    const alunoEmail = `teste-autorizacao-aluno-${sufixo}@example.invalid`;
    const alunoPassword = gerarPasswordSegura();
    const alunoId = await criarUtilizadorAuth(alunoEmail, alunoPassword, { centro_id: centroId });
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(alunoId));
    const { error: alunoError } = await supabaseAdmin.from('alunos').insert({
      id: alunoId, nome: 'Aluno Teste Autorização', email: alunoEmail,
      data_nascimento: '2012-01-01', ano_escolar: 7, centro_id: centroId,
    });
    if (alunoError) throw new Error(`criar aluno de teste: ${alunoError.message}`);
    limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', alunoId));
    aluno = { email: alunoEmail, password: alunoPassword, authId: alunoId };
  });

  test.afterAll(async () => {
    // Inversa da criação — filhas antes de pais, Auth por último. Promise.resolve()
    // porque os builders do supabase-js são "thenable" mas não têm .catch próprio.
    for (const passo of [...limpeza].reverse()) {
      try {
        await Promise.resolve(passo());
      } catch {
        // Best-effort: uma falha de limpeza não deve mascarar o resultado do teste.
      }
    }
  });

  async function esperar403(context: BrowserContext, path: string, body: Record<string, unknown>) {
    const resposta = await context.request.post(`${BASE_URL}${path}`, { data: body, failOnStatusCode: false });
    expect(resposta.status(), `${path} devia devolver 403`).toBe(403);
  }

  test('professor: send-report e criar-staff → 403', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    await login(context, professor.email, professor.password);
    await esperar403(context, '/api/send-report', { studentId: 'dummy', reportHtml: '<p>x</p>' });
    await esperar403(context, '/api/admin/criar-staff', { email: 'x@example.invalid', password: 'x', name: 'x', role: 'professor' });
    await context.close();
  });

  test('aluno: send-report e criar-staff → 403', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    await login(context, aluno.email, aluno.password);
    await esperar403(context, '/api/send-report', { studentId: 'dummy', reportHtml: '<p>x</p>' });
    await esperar403(context, '/api/admin/criar-staff', { email: 'x@example.invalid', password: 'x', name: 'x', role: 'professor' });
    await context.close();
  });
});
