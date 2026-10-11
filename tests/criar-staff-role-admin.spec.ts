import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// /api/admin/criar-staff volta a permitir role "admin" (além de professor e
// secretaria) — mas o centro_id do novo utilizador tem de vir sempre da
// sessão de quem cria, nunca do corpo do pedido. Este teste confirma que um
// admin que tenta criar outro admin "no centro de outra pessoa" (centro_id
// de outro centro no corpo) acaba sempre no SEU PRÓPRIO centro.

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

let centroChamadorId: string;
let centroAlvoId: string;
let adminChamador: { email: string; password: string; authId: string };
let novoAdminId: string | undefined;
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

async function login(context: BrowserContext, email: string, password: string) {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
  await page.close();
}

test.describe('criar-staff aceita role admin, sempre no centro de quem cria', () => {
  test.beforeAll(async () => {
    const sufixo = Date.now();

    const { data: centroChamador, error: centroChamadorError } = await supabaseAdmin
      .from('config_centro')
      .insert({
        nome_centro: `Teste Admin Chamador ${sufixo}`,
        email_remetente: `teste-admin-chamador-${sufixo}@example.invalid`,
        resend_api_key: null,
      })
      .select('id')
      .single();
    if (centroChamadorError) throw new Error(`criar config_centro chamador: ${centroChamadorError.message}`);
    centroChamadorId = centroChamador.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroChamadorId));

    const { data: centroAlvo, error: centroAlvoError } = await supabaseAdmin
      .from('config_centro')
      .insert({
        nome_centro: `Teste Admin Alvo ${sufixo}`,
        email_remetente: `teste-admin-alvo-${sufixo}@example.invalid`,
        resend_api_key: null,
      })
      .select('id')
      .single();
    if (centroAlvoError) throw new Error(`criar config_centro alvo: ${centroAlvoError.message}`);
    centroAlvoId = centroAlvo.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroAlvoId));

    const adminEmail = `teste-admin-chamador-${sufixo}@example.invalid`;
    const adminPassword = gerarPasswordSegura();
    const adminId = await criarUtilizadorAuth(adminEmail, adminPassword, { role: 'admin', centro_id: centroChamadorId });
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(adminId));
    const { error: staffError } = await supabaseAdmin.from('staff').insert({
      id: adminId, email: adminEmail, name: 'Admin Teste Chamador', role: 'admin', centro_id: centroChamadorId,
    });
    if (staffError) throw new Error(`criar staff admin chamador: ${staffError.message}`);
    limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', adminId));
    adminChamador = { email: adminEmail, password: adminPassword, authId: adminId };
  });

  test.afterAll(async () => {
    if (novoAdminId) {
      limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(novoAdminId!));
      limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', novoAdminId!));
    }
    for (const passo of [...limpeza].reverse()) {
      try {
        await Promise.resolve(passo());
      } catch {
        // Best-effort: uma falha de limpeza não deve mascarar o resultado do teste.
      }
    }
  });

  test('admin cria role=admin com centro_id de outro centro no corpo → novo admin fica no centro do chamador', async ({ browser }) => {
    const sufixo = Date.now();
    const context = await browser.newContext();
    await login(context, adminChamador.email, adminChamador.password);

    const resposta = await context.request.post(`${BASE_URL}/api/admin/criar-staff`, {
      data: {
        email: `teste-novo-admin-${sufixo}@example.invalid`,
        password: gerarPasswordSegura(),
        name: 'Novo Admin Teste',
        role: 'admin',
        centro_id: centroAlvoId, // tentativa de injeção — deve ser ignorada
      },
      failOnStatusCode: false,
    });
    expect(resposta.status(), 'criar-staff com role=admin devia ter sucesso').toBe(200);
    const corpo = await resposta.json();
    expect(corpo.ok).toBe(true);
    novoAdminId = corpo.staffId;

    const { data: novoStaff, error } = await supabaseAdmin
      .from('staff')
      .select('centro_id, role')
      .eq('id', novoAdminId)
      .single();
    if (error) throw new Error(`ler staff novo admin: ${error.message}`);
    expect(novoStaff.role).toBe('admin');
    expect(novoStaff.centro_id).toBe(centroChamadorId);
    expect(novoStaff.centro_id).not.toBe(centroAlvoId);

    const { data: novoUser, error: userError } = await supabaseAdmin.auth.admin.getUserById(novoAdminId!);
    if (userError) throw new Error(`ler utilizador novo admin: ${userError.message}`);
    expect(novoUser.user.app_metadata?.centro_id).toBe(centroChamadorId);

    await context.close();
  });
});
