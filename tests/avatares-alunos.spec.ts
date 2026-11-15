import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Fotos de alunos passam a URL assinado (lib/avataresAlunos.ts +
// lib/useAvataresAssinados.tsx) em vez de getPublicUrl — o bucket "avatares"
// continua PÚBLICO nesta fase (a troca para privado é um passo posterior,
// do Luís no Supabase), mas a app já só grava e lê pelo CAMINHO relativo e
// mostra sempre por URL assinado, para essa troca não exigir tocar no
// código outra vez. Centro descartável ZZTESTE (~/Desktop/gestao-centros/
// novo-centro.mjs), nunca o centro real nem o demo.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const GESTAO_DIR = path.join(os.homedir(), 'Desktop', 'gestao-centros');
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const BUCKET_AVATARES = 'avatares';

// 1x1 PNG válido (não há validação de assinatura de bytes para avatares,
// só a extensão derivada do tipo MIME — mas um PNG real evita surpresas).
const PNG_VALIDO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
  'base64'
);

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE AvataresAlunos ${SUFIXO}`;
const ADMIN_EMAIL = `admin-av-${SUFIXO}@zzteste.invalid`;
const MARCADOR = `AV_${SUFIXO}`;

type Conta = { email: string; password: string; id: string };

let centroId: string;
let admin: Conta;
let professor: Conta;
let alunoA: Conta; // upload novo, feito pela UI (teste a)
let alunoB: Conta; // avatar_url em formato antigo (URL público completo) (teste b)

const limpeza: Array<() => unknown> = [];

async function criarUtilizadorAuth(email: string, password: string, appMetadata: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`criar utilizador ${email}: ${error.message}`);
  const id = data.user.id;
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: appMetadata });
  if (metaError) throw new Error(`app_metadata ${email}: ${metaError.message}`);
  return id;
}

async function criarStaff(papel: string, nome: string): Promise<Conta> {
  const email = `${nome.toLowerCase().replace(/\s+/g, '-')}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { role: papel, centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: nome, role: papel, centro_id: centroId });
  if (error) throw new Error(`criar staff ${nome}: ${error.message}`);
  return { email, password, id };
}

// Preenche telefone_encarregado, email_encarregado e ano_escolar — campos
// obrigatórios no formulário de "Editar Aluno" — para o teste de upload (a)
// poder submeter sem ter de preencher o resto do formulário à mão.
async function criarAluno(nome: string): Promise<Conta> {
  const sufixo = `${SUFIXO}-${randomInt(100000, 999999)}`;
  const email = `aluno-av-${sufixo}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email,
    email_encarregado: `enc-av-${sufixo}@zzteste.invalid`,
    telefone_encarregado: '912345678',
    data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centroId, ativo: true, sala_estudo: true, faz_explicacoes: false,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return { email, password, id };
}

async function sessaoComo(conta: Conta): Promise<SupabaseClient> {
  const cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
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

test.describe.configure({ mode: 'serial' });

test.describe('Avatares de alunos — URL assinado, bucket ainda público (centro descartável ZZTESTE)', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE AvataresAlunos'],
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

    professor = await criarStaff('professor', `Prof ${MARCADOR}`);
    alunoA = await criarAluno(`Aluno Upload ${MARCADOR}`);
    alunoB = await criarAluno(`Aluno Legado ${MARCADOR}`);

    // alunoB simula uma linha antiga: ficheiro real no bucket + avatar_url
    // guardado como URL PÚBLICO COMPLETO (formato de antes desta mudança).
    const caminhoLegado = `${centroId}/${alunoB.id}-legado.png`;
    const { error: erroUploadLegado } = await supabaseAdmin.storage
      .from(BUCKET_AVATARES)
      .upload(caminhoLegado, PNG_VALIDO, { contentType: 'image/png' });
    if (erroUploadLegado) throw new Error(`upload legado: ${erroUploadLegado.message}`);
    const urlPublicoLegado = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_AVATARES}/${caminhoLegado}`;
    const { error: erroUpdateLegado } = await supabaseAdmin
      .from('alunos').update({ avatar_url: urlPublicoLegado }).eq('id', alunoB.id);
    if (erroUpdateLegado) throw new Error(`gravar avatar_url legado: ${erroUpdateLegado.message}`);

    // alunoB "em sala" (diario_bordo sem saída) para aparecer na lista de
    // Monitorização de Sala do dashboard (teste c) sem precisar de check-in
    // real pela UI.
    const { error: erroDiario } = await supabaseAdmin.from('diario_bordo').insert({
      aluno_id: alunoB.id, entrada: new Date().toISOString(), status: 'validado',
      subject_name: `Teste ${MARCADOR}`, centro_id: centroId,
    });
    if (erroDiario) throw new Error(`criar diario_bordo: ${erroDiario.message}`);
  });

  test.afterAll(async () => {
    test.setTimeout(90_000);
    await Promise.all([...limpeza].map((passo) => Promise.resolve(passo()).catch(() => {})));
    if (centroId) {
      // apagar-centro.mjs já apaga diario_bordo (tabela com centro_id,
      // descoberta por OpenAPI) e os ficheiros do bucket "avatares" por
      // {centro_id}/... — nada a limpar à mão aqui.
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
  });

  test('(a) admin carrega foto em "Editar Aluno": fica só o CAMINHO na BD (nunca um URL) e o preview usa um URL assinado', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/alunos/editar?id=${alunoA.id}`, { waitUntil: 'networkidle' });

    await page.setInputFiles('input[type="file"]', { name: 'foto.png', mimeType: 'image/png', buffer: PNG_VALIDO });

    const preview = page.locator('img');
    await expect(preview).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/avatares\//, { timeout: 15_000 });

    await page.getByRole('button', { name: 'GRAVAR ALTERAÇÕES' }).click();
    await page.waitForURL('**/admin/alunos', { timeout: 15_000 });

    const { data: linha, error } = await supabaseAdmin.from('alunos').select('avatar_url').eq('id', alunoA.id).single();
    expect(error).toBeNull();
    expect(linha?.avatar_url).not.toBeNull();
    expect(linha!.avatar_url.startsWith('http')).toBe(false);
    expect(linha!.avatar_url.startsWith(`${centroId}/`)).toBe(true);

    // O ficheiro existe de facto no caminho gravado.
    const { data: ficheiros } = await supabaseAdmin.storage.from(BUCKET_AVATARES).list(centroId);
    expect((ficheiros || []).some((f) => linha!.avatar_url.endsWith(f.name))).toBe(true);

    await context.close();
  });

  test('(b) avatar_url em formato antigo (URL público completo) continua a mostrar a foto, agora por URL assinado', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/alunos/ficha?id=${alunoB.id}`, { waitUntil: 'networkidle' });

    const foto = page.locator('img');
    await expect(foto).toBeVisible({ timeout: 15_000 });
    await expect(foto).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/avatares\//, { timeout: 15_000 });

    // A imagem carrega mesmo (não é só um atributo src com um URL morto).
    const src = await foto.getAttribute('src');
    const resposta = await page.request.get(src!);
    expect(resposta.ok()).toBe(true);

    await context.close();
  });

  test('(c) professor vê a foto no dashboard /admin (Monitorização de Sala) e em /admin/alunos', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, professor.email, professor.password);

    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    const cartaoDashboard = page.locator('div.rounded-3xl', { hasText: `Aluno Legado ${MARCADOR}` });
    await expect(cartaoDashboard.locator('img')).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/avatares\//, { timeout: 15_000 });

    await page.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });
    const cartaoLista = page.locator('div.rounded-3xl', { hasText: `Aluno Legado ${MARCADOR}` });
    await expect(cartaoLista.locator('img')).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/avatares\//, { timeout: 15_000 });

    await context.close();
  });

  test('(d) /api/admin/criar-aluno recusa um caminho de avatar de outro centro, e um caminho com ".."', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);

    const nomeOutroCentro = `Rejeitado OutroCentro ${MARCADOR}`;
    const resOutroCentro = await page.request.post(`${BASE_URL}/api/admin/criar-aluno`, {
      data: {
        nome: nomeOutroCentro,
        ano_escolar: 8,
        avatar_url: `11111111-1111-1111-1111-111111111111/foto.png`,
      },
    });
    expect(resOutroCentro.status()).toBe(400);
    const bodyOutroCentro = await resOutroCentro.json();
    expect(bodyOutroCentro.error).toMatch(/centro/i);

    const nomeEscape = `Rejeitado Escape ${MARCADOR}`;
    const resEscape = await page.request.post(`${BASE_URL}/api/admin/criar-aluno`, {
      data: {
        nome: nomeEscape,
        ano_escolar: 8,
        avatar_url: `${centroId}/../escape.png`,
      },
    });
    expect(resEscape.status()).toBe(400);
    const bodyEscape = await resEscape.json();
    expect(bodyEscape.error).toMatch(/inválid/i);

    // Nenhum dos dois pedidos criou fosse o que fosse — rejeitado antes da
    // conta de Auth e da linha em alunos serem criadas.
    const { data: criados } = await supabaseAdmin.from('alunos').select('id').in('nome', [nomeOutroCentro, nomeEscape]);
    expect(criados ?? []).toHaveLength(0);

    await context.close();
  });
});
