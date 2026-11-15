import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Quatro correções de código, sem SQL, sem tocar na configuração dos
// buckets:
//  1. app/admin/disciplinas (bucket "materiais", continua público): só PDF,
//     extensão do caminho vem do tipo validado, limite de 25 MB (igual ao
//     configurado no bucket).
//  2. app/biblioteca: filtro de centro_id explícito em `resources` (defesa
//     em profundidade) + redireciona para /login sem sessão.
//  3. lib/mensagensAnexos: construirCaminhoAnexo deriva a extensão do tipo
//     MIME já validado, nunca do nome original.
//  4. app/page.tsx (início do aluno): professor e secretaria também são
//     redirecionados para /admin (já acontecia só para admin).
// Dois centros descartáveis ZZTESTE (A e B — B só para o teste de
// isolamento da biblioteca), criados/apagados pelos scripts habituais.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const GESTAO_DIR = path.join(os.homedir(), 'Desktop', 'gestao-centros');
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const BUCKET_ANEXOS = 'mensagens-anexos';

const PDF_BUFFER = Buffer.from('%PDF-1.4\nconteudo de teste\n');
const HTML_BUFFER = Buffer.from('<html><body>nao e um pdf</body></html>');
const EXE_BUFFER = Buffer.from([0x4d, 0x5a, 0x00, 0x00, 0x90, 0x00]);

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE PequenasCorrecoes ${SUFIXO}`;
const NOME_ZZTESTE_B = `ZZTESTE PequenasCorrecoesB ${SUFIXO}`;
const ADMIN_EMAIL = `admin-pc-${SUFIXO}@zzteste.invalid`;
const ADMIN_EMAIL_B = `admin-pcb-${SUFIXO}@zzteste.invalid`;
const MARCADOR = `PC_${SUFIXO}`;
const ANO_ESCOLAR_TESTE = 9;

type Conta = { email: string; password: string; id: string };

let centroId: string;
let centroIdB: string;
let admin: Conta;
let professor: Conta;
let secretaria: Conta;
let alunoA: Conta;
let disciplinaId: number;

const limpeza: Array<() => unknown> = [];

async function criarCentro(nome: string, adminEmail: string, adminNome: string): Promise<{ centroId: string; admin: Conta }> {
  const saida = execFileSync(
    'node',
    ['novo-centro.mjs', '--nome', nome, '--admin-email', adminEmail, '--admin-nome', adminNome],
    { cwd: GESTAO_DIR, encoding: 'utf8' }
  );
  const m = saida.match(/centro_id = ([0-9a-f-]+)/);
  if (!m) throw new Error(`novo-centro.mjs (${nome}) não devolveu centro_id: ${saida}`);
  const cid = m[1];

  const { data: staffAdmin, error: staffAdminError } = await supabaseAdmin
    .from('staff').select('id').eq('centro_id', cid).eq('role', 'admin').single();
  if (staffAdminError || !staffAdmin) throw new Error(`não encontrei o staff admin de ${nome}`);
  const password = gerarPasswordSegura();
  const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(staffAdmin.id, { password });
  if (resetError) throw new Error(`rodar password do admin de ${nome}: ${resetError.message}`);

  return { centroId: cid, admin: { email: adminEmail, password, id: staffAdmin.id } };
}

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

async function criarAluno(nome: string, anoEscolar: number): Promise<Conta> {
  const sufixo = `${SUFIXO}-${randomInt(100000, 999999)}`;
  const email = `aluno-pc-${sufixo}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email,
    email_encarregado: `enc-pc-${sufixo}@zzteste.invalid`,
    telefone_encarregado: '912345678',
    data_nascimento: '2011-01-01', ano_escolar: anoEscolar, centro_id: centroId, ativo: true, sala_estudo: true, faz_explicacoes: false,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return { email, password, id };
}

async function loginUI(p: Page, email: string, password: string) {
  await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="identificador"]', email);
  await p.fill('input[type="password"]', password);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

test.describe.configure({ mode: 'serial' });

test.describe('Pequenas correções — materiais, biblioteca, anexos, início do aluno (dois centros ZZTESTE)', () => {
  test.beforeAll(async () => {
    const a = await criarCentro(NOME_ZZTESTE, ADMIN_EMAIL, 'Admin ZZTESTE PequenasCorrecoes');
    centroId = a.centroId;
    admin = a.admin;

    professor = await criarStaff('professor', `Prof ${MARCADOR}`);
    secretaria = await criarStaff('secretaria', `Secretaria ${MARCADOR}`);
    alunoA = await criarAluno(`Aluno A ${MARCADOR}`, ANO_ESCOLAR_TESTE);

    const { data: disc, error: discError } = await supabaseAdmin
      .from('subjects').insert({ name: `Disciplina Materiais ${MARCADOR}`, centro_id: centroId }).select('id').single();
    if (discError) throw new Error(`criar disciplina: ${discError.message}`);
    disciplinaId = disc.id;

    // Recurso do PRÓPRIO centro A, no mesmo ano do alunoA — tem de continuar visível.
    const { error: erroResourceA } = await supabaseAdmin.from('resources').insert({
      title: `Recurso Centro A ${MARCADOR}`, url: 'https://exemplo.invalid/recurso-a.pdf', type: 'pdf',
      subject_id: disciplinaId, ano_escolar: ANO_ESCOLAR_TESTE, centro_id: centroId,
    });
    if (erroResourceA) throw new Error(`criar resource A: ${erroResourceA.message}`);

    // --- Centro B — só para o teste de isolamento da biblioteca ---
    const b = await criarCentro(NOME_ZZTESTE_B, ADMIN_EMAIL_B, 'Admin ZZTESTE PequenasCorrecoesB');
    centroIdB = b.centroId;

    const { data: discB, error: discBError } = await supabaseAdmin
      .from('subjects').insert({ name: `Disciplina B ${MARCADOR}`, centro_id: centroIdB }).select('id').single();
    if (discBError) throw new Error(`criar disciplina B: ${discBError.message}`);

    const { error: erroResourceB } = await supabaseAdmin.from('resources').insert({
      title: `Recurso Centro B ${MARCADOR}`, url: 'https://exemplo.invalid/recurso-b.pdf', type: 'pdf',
      subject_id: discB.id, ano_escolar: ANO_ESCOLAR_TESTE, centro_id: centroIdB,
    });
    if (erroResourceB) throw new Error(`criar resource B: ${erroResourceB.message}`);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await Promise.all([...limpeza].map((passo) => Promise.resolve(passo()).catch(() => {})));
    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    if (centroIdB) {
      execFileSync('node', ['apagar-centro.mjs', centroIdB, '--confirmo-apagar', NOME_ZZTESTE_B], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoA } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    expect(restoA ?? []).toHaveLength(0);
    const { data: restoB } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroIdB);
    expect(restoB ?? []).toHaveLength(0);
  });

  test('(a) upload de material não-PDF (.html, text/html) é recusado com mensagem inline e não cria linha em resources', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/disciplinas`, { waitUntil: 'networkidle' });

    await page.getByText(`Disciplina Materiais ${MARCADOR}`, { exact: true }).click();
    await page.getByRole('button', { name: /adicionar material/i }).click();

    const tituloRecusado = `Material HTML Recusado ${MARCADOR}`;
    await page.getByPlaceholder('Ex: Resumo Cap. 1').fill(tituloRecusado);
    await page.setInputFiles('input[type="file"]', { name: 'pagina.html', mimeType: 'text/html', buffer: HTML_BUFFER });
    await page.getByRole('button', { name: /publicar material/i }).click();

    await expect(page.getByText(/Tipo de ficheiro não permitido/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Só PDF/)).toBeVisible();

    const { data: criado } = await supabaseAdmin.from('resources').select('id').eq('centro_id', centroId).eq('title', tituloRecusado);
    expect(criado ?? []).toHaveLength(0);

    await context.close();
  });

  test('(b) upload de PDF válido continua a funcionar e o caminho no bucket termina em .pdf (nunca a extensão do nome do ficheiro)', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/disciplinas`, { waitUntil: 'networkidle' });

    await page.getByText(`Disciplina Materiais ${MARCADOR}`, { exact: true }).click();
    await page.getByRole('button', { name: /adicionar material/i }).click();

    const titulo = `Material PDF Valido ${MARCADOR}`;
    await page.getByPlaceholder('Ex: Resumo Cap. 1').fill(titulo);
    // Nome do ficheiro propositadamente "errado" (.txt) — a extensão no
    // caminho tem de vir do tipo MIME validado (application/pdf), nunca
    // deste nome.
    await page.setInputFiles('input[type="file"]', { name: 'nome-qualquer.txt', mimeType: 'application/pdf', buffer: PDF_BUFFER });
    await page.getByRole('button', { name: /publicar material/i }).click();

    await expect(page.getByText(titulo, { exact: true })).toBeVisible({ timeout: 15_000 });

    const { data: linha, error } = await supabaseAdmin.from('resources').select('url').eq('centro_id', centroId).eq('title', titulo).single();
    expect(error).toBeNull();
    expect(linha?.url.endsWith('.pdf')).toBe(true);
    expect(linha?.url.includes('.txt')).toBe(false);

    await context.close();
  });

  test('(c) biblioteca: um aluno do centro A não vê recursos do centro B com o mesmo ano escolar (só os do próprio centro)', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, alunoA.email, alunoA.password);
    await page.goto(`${BASE_URL}/biblioteca`, { waitUntil: 'networkidle' });

    await expect(page.getByText(`Recurso Centro A ${MARCADOR}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`Recurso Centro B ${MARCADOR}`)).toHaveCount(0);

    await context.close();
  });

  test('(d) anexo de mensagem com extensão enganadora ("malware.exe", tipo application/pdf) fica com a extensão do tipo validado; anexos antigos continuam a abrir', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, admin.email, admin.password);
    await page.goto(`${BASE_URL}/admin/mensagens`, { waitUntil: 'networkidle' });

    await page.getByPlaceholder('Pesquisar aluno...').fill(`Aluno A ${MARCADOR}`);
    await page.getByText(`Aluno A ${MARCADOR}`, { exact: false }).first().click();

    await page.locator('input[type="file"]').setInputFiles({ name: 'malware.exe', mimeType: 'application/pdf', buffer: EXE_BUFFER });
    await page.getByPlaceholder('Responder...').fill(`Anexo de teste ${MARCADOR}`);
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();

    // O clique só espera o evento ser despachado, não o handleEnviar
    // assíncrono (mensagem + upload + insert do anexo) terminar — por isso
    // não se pode ler a BD logo a seguir. O sinal fiável de que tudo
    // terminou é o anexo ENVIADO (um <button>, só aparece depois do insert
    // em mensagens_anexos) — o chip PENDENTE, antes de enviar, é um <span>
    // sem essa role, nunca é confundido com este.
    await expect(page.getByRole('button', { name: 'malware.exe · 6 B' })).toBeVisible({ timeout: 15_000 });

    const { data: mensagem, error: erroMensagem } = await supabaseAdmin
      .from('mensagens').select('id').eq('aluno_id', alunoA.id).eq('texto', `Anexo de teste ${MARCADOR}`).single();
    expect(erroMensagem).toBeNull();

    const { data: anexoFinal } = await supabaseAdmin
      .from('mensagens_anexos').select('caminho, nome_original, mime').eq('mensagem_id', mensagem!.id).single();
    expect(anexoFinal!.nome_original).toBe('malware.exe');
    expect(anexoFinal!.caminho.endsWith('.pdf')).toBe(true);
    expect(anexoFinal!.caminho.endsWith('.exe')).toBe(false);
    limpeza.push(() => supabaseAdmin.storage.from(BUCKET_ANEXOS).remove([anexoFinal!.caminho]));

    // Anexo "antigo" simulado: caminho que nunca passaria pela nova
    // construirCaminhoAnexo (sem extensão derivada do tipo), para confirmar
    // que a LEITURA nunca recalcula nada — só assina o que está guardado.
    const caminhoAntigo = `${centroId}/${alunoA.id}/${randomInt(1e9, 2e9)}-ficheiro-legado-sem-extensao-nova`;
    const { error: erroUploadAntigo } = await supabaseAdmin.storage.from(BUCKET_ANEXOS).upload(caminhoAntigo, PDF_BUFFER, { contentType: 'application/pdf' });
    expect(erroUploadAntigo).toBeNull();
    limpeza.push(() => supabaseAdmin.storage.from(BUCKET_ANEXOS).remove([caminhoAntigo]));

    const clienteAdmin = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: erroLoginAdmin } = await clienteAdmin.auth.signInWithPassword({ email: admin.email, password: admin.password });
    expect(erroLoginAdmin).toBeNull();
    const { data: assinado, error: erroAssinar } = await clienteAdmin.storage.from(BUCKET_ANEXOS).createSignedUrl(caminhoAntigo, 60);
    expect(erroAssinar, 'um anexo "antigo" (caminho em formato anterior à correção) continua a conseguir ser assinado').toBeNull();
    expect(assinado?.signedUrl).toBeTruthy();
    const resposta = await fetch(assinado!.signedUrl);
    expect(resposta.ok, 'o URL assinado do anexo antigo tinha de carregar de facto').toBe(true);

    await context.close();
  });

  test('(e) professor e secretaria a abrir "/" são redirecionados para /admin, tal como admin já era', async ({ browser }: { browser: Browser }) => {
    for (const conta of [professor, secretaria]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginUI(page, conta.email, conta.password);
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await page.waitForURL('**/admin', { timeout: 15_000 });
      await context.close();
    }
  });
});
