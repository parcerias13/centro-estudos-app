import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// servicos.custo foi removida; o custo passou a viver em servicos_custos
// (servico_id PK/FK para servicos, centro_id, custo >= 0 ou null,
// updated_at), com RLS a restringir todas as operações ao admin do próprio
// centro. Centro descartável ZZTESTE (~/Desktop/gestao-centros/novo-centro.mjs),
// nunca o Trupe Lias nem o Demo. Sessões reais (nunca a chave de serviço
// para as ações que o teste quer validar — só para preparar/verificar).

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
const NOME_ZZTESTE = `ZZTESTE ServicosCustos ${SUFIXO}`;
const ADMIN_EMAIL = `admin-servicoscustos-${SUFIXO}@zzteste.invalid`;

type Conta = { email: string; password: string; id: string };

let centroId: string;
let outroCentroId: string;
let admin: Conta;
let professor: Conta;
let secretaria: Conta;
let outroAdmin: Conta;
let servicoBaseId: string;

const limpeza: Array<() => unknown> = [];
const servicosCriados: string[] = [];

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

async function criarStaff(papel: string, centro: string, nome: string): Promise<Conta> {
  const email = `${nome.toLowerCase().replace(/\s+/g, '-')}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { role: papel, centro_id: centro });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: nome, role: papel, centro_id: centro });
  if (error) throw new Error(`criar staff ${papel}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
  return { email, password, id };
}

async function sessaoComo(conta: Conta) {
  const cliente = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
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

async function abrirGestaoPrecos(p: Page) {
  await p.goto(`${BASE_URL}/admin/gestao?aba=precos`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 15_000 }).catch(() => {});
}

function secaoExtras(p: Page) {
  return p.locator('section', { has: p.getByRole('heading', { name: 'Extras' }) });
}

function linhaServico(p: Page, nome: string) {
  return secaoExtras(p).locator('div.group', { hasText: nome });
}

async function criarServicoViaAdmin(centro: string, nome: string) {
  const { data, error } = await supabaseAdmin.from('servicos').insert({ nome, preco: 1, centro_id: centro }).select('id').single();
  if (error) throw new Error(`criar serviço ${nome}: ${error.message}`);
  servicosCriados.push(data.id);
  return data.id as string;
}

test.describe.configure({ mode: 'serial' });

test.describe('Gestão — custo dos serviços em servicos_custos — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE ServicosCustos'],
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

    professor = await criarStaff('professor', centroId, 'Prof ServicosCustos');
    secretaria = await criarStaff('secretaria', centroId, 'Secretaria ServicosCustos');

    const { data: outroCentro, error: outroCentroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Outro SC ${SUFIXO}`, email_remetente: `zzteste-outro-sc-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (outroCentroError) throw new Error(`criar outro centro: ${outroCentroError.message}`);
    outroCentroId = outroCentro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', outroCentroId));
    outroAdmin = await criarStaff('admin', outroCentroId, 'Admin OutroCentro SC');

    servicoBaseId = await criarServicoViaAdmin(centroId, `Serviço Base ${SUFIXO}`);
  });

  test.afterAll(async () => {
    await supabaseAdmin.from('servicos').delete().in('id', servicosCriados);

    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }

    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }

    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    const { data: restoStaff } = await supabaseAdmin.from('staff').select('id').eq('centro_id', centroId);
    const { data: restoServicos } = await supabaseAdmin.from('servicos').select('id').eq('centro_id', centroId);
    const { data: restoCustos } = await supabaseAdmin.from('servicos_custos').select('servico_id').eq('centro_id', centroId);
    const { data: restoOutroCentro } = await supabaseAdmin.from('config_centro').select('id').eq('id', outroCentroId);
    expect(restoConfig ?? []).toHaveLength(0);
    expect(restoStaff ?? []).toHaveLength(0);
    expect(restoServicos ?? []).toHaveLength(0);
    expect(restoCustos ?? []).toHaveLength(0);
    expect(restoOutroCentro ?? []).toHaveLength(0);
  });

  test('admin: cria um serviço com custo pela UI — aparece na Gestão e fica em servicos_custos com o centro certo', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await abrirGestaoPrecos(page);

    const nome = `Lanche ${SUFIXO}`;
    await secaoExtras(page).getByRole('button').first().click();
    await secaoExtras(page).getByPlaceholder('ex: Almoço, Transporte').fill(nome);
    await secaoExtras(page).getByPlaceholder('0.00').fill('2.50');
    await secaoExtras(page).getByPlaceholder('opcional').fill('1.20');
    await page.getByRole('button', { name: 'Criar Serviço' }).click();

    const linha = linhaServico(page, nome);
    await expect(linha).toBeVisible({ timeout: 10_000 });
    await expect(linha.getByPlaceholder('—')).toHaveValue('1.2', { timeout: 10_000 });

    const { data: servico, error: errServico } = await supabaseAdmin.from('servicos').select('id').eq('centro_id', centroId).eq('nome', nome).single();
    expect(errServico).toBeNull();
    servicosCriados.push(servico!.id);

    const { data: custo, error: errCusto } = await supabaseAdmin.from('servicos_custos').select('centro_id, custo').eq('servico_id', servico!.id).single();
    expect(errCusto).toBeNull();
    expect(custo!.centro_id).toBe(centroId);
    expect(Number(custo!.custo)).toBe(1.2);

    await context.close();
  });

  test('criar serviço sem custo não cria linha em servicos_custos', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await abrirGestaoPrecos(page);

    const nome = `Transporte ${SUFIXO}`;
    await secaoExtras(page).getByRole('button').first().click();
    await secaoExtras(page).getByPlaceholder('ex: Almoço, Transporte').fill(nome);
    await secaoExtras(page).getByPlaceholder('0.00').fill('5');
    await page.getByRole('button', { name: 'Criar Serviço' }).click();

    const linha = linhaServico(page, nome);
    await expect(linha).toBeVisible({ timeout: 10_000 });
    await expect(linha.getByPlaceholder('—')).toHaveValue('', { timeout: 10_000 });

    const { data: servico } = await supabaseAdmin.from('servicos').select('id').eq('centro_id', centroId).eq('nome', nome).single();
    servicosCriados.push(servico!.id);

    const { data: custo, error: errCusto } = await supabaseAdmin.from('servicos_custos').select('servico_id').eq('servico_id', servico!.id).maybeSingle();
    expect(errCusto).toBeNull();
    expect(custo).toBeNull();

    await context.close();
  });

  test('admin: altera o custo e depois limpa o campo (fica null)', async ({ browser }) => {
    // O input de custo é não-controlado (defaultValue) — ler o seu valor no
    // DOM a seguir a um fill() não prova que o pedido ao servidor terminou.
    // Confirma-se a escrita a sério pela BD (expect.poll) e, por cima, que
    // uma recarga da página volta a mostrar o valor guardado.
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await abrirGestaoPrecos(page);

    const nome = `Serviço Base ${SUFIXO}`;
    let linha = linhaServico(page, nome);
    await expect(linha).toBeVisible({ timeout: 10_000 });

    await linha.getByPlaceholder('—').fill('3.75');
    await linha.getByPlaceholder('—').blur();
    await expect.poll(async () => {
      const { data } = await supabaseAdmin.from('servicos_custos').select('custo').eq('servico_id', servicoBaseId).maybeSingle();
      return data?.custo === null || data?.custo === undefined ? null : Number(data.custo);
    }, { timeout: 10_000 }).toBe(3.75);

    await abrirGestaoPrecos(page);
    linha = linhaServico(page, nome);
    await expect(linha.getByPlaceholder('—')).toHaveValue('3.75', { timeout: 10_000 });

    await linha.getByPlaceholder('—').fill('');
    await linha.getByPlaceholder('—').blur();
    await expect.poll(async () => {
      const { data } = await supabaseAdmin.from('servicos_custos').select('custo').eq('servico_id', servicoBaseId).maybeSingle();
      return data?.custo ?? null;
    }, { timeout: 10_000 }).toBeNull();

    await context.close();
  });

  test('custo negativo é recusado na BD (check constraint)', async () => {
    const sessao = await sessaoComo(admin);
    const { error } = await sessao
      .from('servicos_custos')
      .upsert({ servico_id: servicoBaseId, centro_id: centroId, custo: -1 }, { onConflict: 'servico_id' });
    expect(error).not.toBeNull();

    const { data: custoDepois } = await supabaseAdmin.from('servicos_custos').select('custo').eq('servico_id', servicoBaseId).maybeSingle();
    expect(custoDepois?.custo ?? null).toBeNull();
  });

  test('custo negativo é recusado no cliente antes de chegar à BD', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await abrirGestaoPrecos(page);

    const nome = `Serviço Base ${SUFIXO}`;
    const linha = linhaServico(page, nome);
    const campoCusto = linha.getByPlaceholder('—');
    await campoCusto.fill('-5');
    await campoCusto.blur();
    await expect(page.getByText('O custo não pode ser negativo.')).toBeVisible({ timeout: 10_000 });

    const { data: custoFinal } = await supabaseAdmin.from('servicos_custos').select('custo').eq('servico_id', servicoBaseId).maybeSingle();
    expect(custoFinal?.custo ?? null).toBeNull();

    await context.close();
  });

  test('professor e secretaria não leem nem escrevem servicos_custos', async () => {
    for (const conta of [professor, secretaria]) {
      const sessao = await sessaoComo(conta);
      const { data: lido, error: errLeitura } = await sessao.from('servicos_custos').select('servico_id').eq('centro_id', centroId);
      expect(errLeitura).toBeNull();
      expect(lido ?? []).toHaveLength(0);

      const { error: errEscrita } = await sessao
        .from('servicos_custos')
        .upsert({ servico_id: servicoBaseId, centro_id: centroId, custo: 9 }, { onConflict: 'servico_id' });
      expect(errEscrita).not.toBeNull();
    }

    const { data: custoDepois } = await supabaseAdmin.from('servicos_custos').select('custo').eq('servico_id', servicoBaseId).maybeSingle();
    expect(custoDepois?.custo ?? null).toBeNull();
  });

  test('admin de outro centro não lê nem escreve servicos_custos do ZZTESTE', async () => {
    const sessao = await sessaoComo(outroAdmin);
    const { data: lido, error: errLeitura } = await sessao.from('servicos_custos').select('servico_id').eq('centro_id', centroId);
    expect(errLeitura).toBeNull();
    expect(lido ?? []).toHaveLength(0);

    const { error: errEscrita } = await sessao
      .from('servicos_custos')
      .upsert({ servico_id: servicoBaseId, centro_id: centroId, custo: 9 }, { onConflict: 'servico_id' });
    expect(errEscrita).not.toBeNull();

    const { data: custoDepois } = await supabaseAdmin.from('servicos_custos').select('custo').eq('servico_id', servicoBaseId).maybeSingle();
    expect(custoDepois?.custo ?? null).toBeNull();
  });

  test('admin de outro centro não consegue criar servicos_custos para um serviço que não é do seu centro', async () => {
    const sessao = await sessaoComo(outroAdmin);
    const { error } = await sessao
      .from('servicos_custos')
      .upsert({ servico_id: servicoBaseId, centro_id: outroCentroId, custo: 9 }, { onConflict: 'servico_id' });
    expect(error).not.toBeNull();
  });
});
