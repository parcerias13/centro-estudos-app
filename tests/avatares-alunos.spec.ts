import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Fotos de alunos passam a URL assinado (lib/avataresAlunos.ts +
// lib/useAvataresAssinados.tsx) em vez de getPublicUrl. O bucket "avatares"
// já está PRIVADO em produção (o Luís tratou disto no Supabase) — a app só
// grava e lê pelo CAMINHO relativo e mostra sempre por URL assinado, e as
// RLS de storage.objects é que fazem a aplicação real do isolamento entre
// centros. Centros descartáveis ZZTESTE (~/Desktop/gestao-centros/
// {novo-centro,apagar-centro}.mjs — este spec usa DOIS, A e B, para os
// testes de isolamento), nunca o centro real nem o demo.

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
const NOME_ZZTESTE_B = `ZZTESTE AvataresAlunosB ${SUFIXO}`;
const ADMIN_EMAIL = `admin-av-${SUFIXO}@zzteste.invalid`;
const ADMIN_EMAIL_B = `admin-avb-${SUFIXO}@zzteste.invalid`;
const MARCADOR = `AV_${SUFIXO}`;

type Conta = { email: string; password: string; id: string };

let centroId: string; // Centro A — onde corre a maioria dos testes
let centroIdB: string; // Centro B — só para os testes de isolamento (e)-(g)
let admin: Conta;
let professor: Conta;
let alunoA: Conta; // upload novo, feito pela UI (teste a)
let alunoB: Conta; // avatar_url em formato antigo (URL público completo) (teste b)
let caminhoLegadoA = ''; // caminho real do ficheiro de alunoB, no centro A — reusado no teste (g)
let caminhoFicheiroB = ''; // ficheiro real só no centro B — nunca lido por ninguém do centro A

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

test.describe('Avatares de alunos — URL assinado, bucket privado (dois centros descartáveis ZZTESTE)', () => {
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
    caminhoLegadoA = `${centroId}/${alunoB.id}-legado.png`;
    const { error: erroUploadLegado } = await supabaseAdmin.storage
      .from(BUCKET_AVATARES)
      .upload(caminhoLegadoA, PNG_VALIDO, { contentType: 'image/png' });
    if (erroUploadLegado) throw new Error(`upload legado: ${erroUploadLegado.message}`);
    const urlPublicoLegado = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_AVATARES}/${caminhoLegadoA}`;
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

    // --- Centro B — só para os testes de isolamento ao nível do storage ---
    const saidaB = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE_B, '--admin-email', ADMIN_EMAIL_B, '--admin-nome', 'Admin ZZTESTE AvataresAlunos B'],
      { cwd: GESTAO_DIR, encoding: 'utf8' }
    );
    const mB = saidaB.match(/centro_id = ([0-9a-f-]+)/);
    if (!mB) throw new Error('novo-centro.mjs (centro B) não devolveu centro_id: ' + saidaB);
    centroIdB = mB[1];

    // Ficheiro real só no centro B — nenhum utilizador do centro A deve
    // conseguir assiná-lo, descarregá-lo ou sequer listá-lo.
    caminhoFicheiroB = `${centroIdB}/isolamento-teste.png`;
    const { error: erroUploadB } = await supabaseAdmin.storage
      .from(BUCKET_AVATARES)
      .upload(caminhoFicheiroB, PNG_VALIDO, { contentType: 'image/png' });
    if (erroUploadB) throw new Error(`upload ficheiro centro B: ${erroUploadB.message}`);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await Promise.all([...limpeza].map((passo) => Promise.resolve(passo()).catch(() => {})));
    if (centroId) {
      // apagar-centro.mjs já apaga diario_bordo (tabela com centro_id,
      // descoberta por OpenAPI) e os ficheiros do bucket "avatares" por
      // {centro_id}/... — nada a limpar à mão aqui.
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    if (centroIdB) {
      // Mesma garantia para o centro B: apagar-centro.mjs limpa também o
      // ficheiro de isolamento em {centroIdB}/... do bucket "avatares".
      execFileSync('node', ['apagar-centro.mjs', centroIdB, '--confirmo-apagar', NOME_ZZTESTE_B], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
    const { data: restoConfigB } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroIdB);
    expect(restoConfigB ?? []).toHaveLength(0);
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

  // --- Isolamento ao nível do storage (bucket "avatares" privado) ---------

  test('(e) isolamento entre centros: professor do centro A não consegue assinar, descarregar nem listar um ficheiro do centro B', async () => {
    const clientProfessorA = await sessaoComo(professor);

    const { data: assinado, error: erroAssinar } = await clientProfessorA.storage
      .from(BUCKET_AVATARES).createSignedUrl(caminhoFicheiroB, 60);
    expect(assinado?.signedUrl ?? null, 'professor A não devia conseguir assinar um ficheiro do centro B').toBeNull();
    expect(erroAssinar).not.toBeNull();

    const { data: assinadosLote } = await clientProfessorA.storage
      .from(BUCKET_AVATARES).createSignedUrls([caminhoFicheiroB], 60);
    const itemB = (assinadosLote || [])[0];
    expect(itemB?.signedUrl ?? null, 'createSignedUrls em lote também não devia devolver um URL válido para o ficheiro do centro B').toBeNull();

    const { data: descarregado, error: erroDescarregar } = await clientProfessorA.storage
      .from(BUCKET_AVATARES).download(caminhoFicheiroB);
    expect(descarregado).toBeNull();
    expect(erroDescarregar).not.toBeNull();

    const { data: listagemB } = await clientProfessorA.storage.from(BUCKET_AVATARES).list(centroIdB);
    expect(listagemB ?? [], 'professor A não devia listar nada na pasta do centro B').toHaveLength(0);
  });

  test('(f) sem sessão (anon): não lê nem lista nada no bucket avatares, e o URL público antigo deixa de funcionar', async () => {
    const clientAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: assinadoAnon, error: erroAnon } = await clientAnon.storage
      .from(BUCKET_AVATARES).createSignedUrl(caminhoFicheiroB, 60);
    expect(assinadoAnon?.signedUrl ?? null, 'anon não devia conseguir assinar nenhum ficheiro').toBeNull();
    expect(erroAnon).not.toBeNull();

    const { data: listaAnonB } = await clientAnon.storage.from(BUCKET_AVATARES).list(centroIdB);
    expect(listaAnonB ?? [], 'anon não devia listar a pasta do centro B').toHaveLength(0);
    const { data: listaAnonA } = await clientAnon.storage.from(BUCKET_AVATARES).list(centroId);
    expect(listaAnonA ?? [], 'anon não devia listar a pasta do centro A').toHaveLength(0);

    // O formato antigo (URL público direto, sem assinatura) tinha de deixar
    // de funcionar — é exatamente o que motivou tornar o bucket privado.
    const urlPublicoAntigo = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_AVATARES}/${caminhoFicheiroB}`;
    const respostaPublica = await fetch(urlPublicoAntigo);
    expect(respostaPublica.ok, 'o URL público antigo tinha de deixar de funcionar com o bucket privado').toBe(false);

    const urlPublicoAntigoA = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_AVATARES}/${caminhoLegadoA}`;
    const respostaPublicaA = await fetch(urlPublicoAntigoA);
    expect(respostaPublicaA.ok, 'o URL público antigo do centro A também tinha de deixar de funcionar').toBe(false);
  });

  test('(g) professor do centro A consegue assinar e descarregar um ficheiro do PRÓPRIO centro (leitura permitida)', async () => {
    const clientProfessorA = await sessaoComo(professor);

    const { data: assinadoProprio, error: erroProprio } = await clientProfessorA.storage
      .from(BUCKET_AVATARES).createSignedUrl(caminhoLegadoA, 60);
    expect(erroProprio, 'professor devia conseguir assinar um ficheiro do seu próprio centro').toBeNull();
    expect(assinadoProprio?.signedUrl).toBeTruthy();

    const resposta = await fetch(assinadoProprio!.signedUrl);
    expect(resposta.ok, 'o URL assinado do próprio centro tinha de carregar de facto').toBe(true);

    const { data: listagemPropria } = await clientProfessorA.storage.from(BUCKET_AVATARES).list(centroId);
    expect((listagemPropria || []).length).toBeGreaterThan(0);
  });

  // --- Upload do admin continua a funcionar com o bucket privado ----------

  test('(h) admin carrega foto em "Novo Aluno" (antes de o aluno existir): upload funciona com o bucket privado, preview por URL assinado, e nasce com o caminho certo', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/alunos/novo`, { waitUntil: 'networkidle' });

    await page.setInputFiles('input[type="file"]', { name: 'foto-novo.png', mimeType: 'image/png', buffer: PNG_VALIDO });
    const preview = page.locator('img');
    await expect(preview).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/avatares\//, { timeout: 15_000 });

    const nome = `Aluno Novo Upload ${MARCADOR}`;
    await page.locator('input[type="text"]').first().fill(nome);
    await page.locator('select').selectOption('8');
    await page.locator('input[placeholder="Ex: 912345678"]').nth(1).fill('912999010');
    await page.fill('input[placeholder="email@exemplo.com"]', `enc-novo-${SUFIXO}@zzteste.invalid`);
    await page.fill('input[placeholder="0.00"]', '50');
    await page.getByRole('button', { name: /finalizar matrícula/i }).click();
    await expect(page.getByText(/matrícula criada/i)).toBeVisible({ timeout: 20_000 });

    const { data: alunoNovo, error } = await supabaseAdmin.from('alunos').select('id, avatar_url').eq('centro_id', centroId).eq('nome', nome).single();
    expect(error).toBeNull();
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(alunoNovo!.id));
    limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', alunoNovo!.id));

    expect(alunoNovo?.avatar_url).not.toBeNull();
    expect(alunoNovo!.avatar_url.startsWith('http')).toBe(false);
    expect(alunoNovo!.avatar_url.startsWith(`${centroId}/`)).toBe(true);

    const { data: ficheiros } = await supabaseAdmin.storage.from(BUCKET_AVATARES).list(centroId);
    expect((ficheiros || []).some((f) => alunoNovo!.avatar_url.endsWith(f.name))).toBe(true);

    await context.close();
  });
});
