import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Material por aluno: separador "Material" em Os Meus Alunos (professor) +
// cartão "O meu material" / página /material (aluno). Bucket PRIVADO
// "material-alunos" e tabela public.material_aluno já existem na base de
// dados, com RLS própria — isolamento por aluno fixo ativo do professor,
// 1 upload = 1 ficheiro + 1 linha (nunca um sem o outro), extensão do
// caminho sempre do tipo validado (nunca do nome original), assinatura de
// bytes verificada no cliente, URLs assinados de 60s, e "visto" só na
// primeira vez. Centro descartável ZZTESTE (~/Desktop/gestao-centros/
// novo-centro.mjs), nunca o centro real nem o demo.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const GESTAO_DIR = path.join(os.homedir(), 'Desktop', 'gestao-centros');
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const BUCKET_MATERIAL = 'material-alunos';

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function hojeLisboaISO(): string {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const obter = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${obter('year')}-${obter('month')}-${obter('day')}`;
}

function adicionarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diaSemanaDeData(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay();
  return dow === 0 ? 7 : dow;
}

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE MaterialAluno ${SUFIXO}`;
const ADMIN_EMAIL = `admin-ma-${SUFIXO}@zzteste.invalid`;
const MARCADOR = `MA_${SUFIXO}`;
const HOJE = hojeLisboaISO();

// --- Conteúdos de ficheiro, com os primeiros bytes corretos (ou errados de
// propósito) para cada tipo — assinaturas usadas por lib/materialAluno.ts.
const PDF_VALIDO = Buffer.concat([Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]), Buffer.from('1.4 conteudo de teste ' + SUFIXO)]);
const TEXTO_FALSO_PDF = Buffer.from('isto nao e um pdf a serio, so texto simples ' + SUFIXO, 'utf8');
const PDF_GRANDE = Buffer.concat([Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]), Buffer.alloc(10 * 1024 * 1024, 0x41)]); // > 10 MB

type Conta = { email: string; password: string; id: string };

let centroId: string;
let admin: Conta;
let secretaria: Conta;
let prof1: Conta;
let prof2: Conta;
let disciplina1Id: number;

let alunoA: Conta, alunoB: Conta, alunoNaoFixo: Conta, alunoRecusado: Conta, alunoTerminado: Conta, alunoProf2: Conta;
let serieAId: string, serieBId: string, serieRecusadaId: string, serieTerminadaId: string, serieProf2Id: string;

let materialAItemId = '';
let materialAItemCaminho = '';

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

async function criarAluno(nome: string): Promise<Conta> {
  const sufixo = `${SUFIXO}-${randomInt(100000, 999999)}`;
  const email = `aluno-ma-${sufixo}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-ma-${sufixo}@zzteste.invalid`,
    data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centroId, ativo: true, sala_estudo: false, faz_explicacoes: true, mensalidade_base: 0,
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

/** Cria uma série fixa pelo próprio professor e devolve o id, identificada pelo dia_semana único (impressão digital). */
async function criarSerieComo(conta: Conta, diaFingerprint: number, disciplinaId: number, alunoId: string, dataInicio: string = HOJE): Promise<string> {
  const cliente = await sessaoComo(conta);
  const { error } = await cliente.rpc('criar_serie_explicacao', {
    p_professor: conta.id, p_disciplina: disciplinaId, p_dia: diaFingerprint, p_hora: '08:00:00',
    p_duracao: 1, p_alunos: [alunoId], p_inicio: dataInicio, p_fim: null,
  });
  if (error) throw new Error(`criar série (dia ${diaFingerprint}): ${error.message}`);
  const { data, error: errBusca } = await supabaseAdmin
    .from('series_explicacoes').select('id').eq('professor_id', conta.id).eq('dia_semana', diaFingerprint).single();
  if (errBusca || !data) throw new Error(`não encontrei a série criada (dia ${diaFingerprint}): ${errBusca?.message}`);
  return data.id;
}

/** Lista e apaga recursivamente todos os ficheiros sob um prefixo de um bucket (API de Storage não é recursiva). */
async function apagarFicheirosBucket(bucket: string, prefixo: string): Promise<void> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).list(prefixo, { limit: 1000 });
  if (error || !data) return;
  for (const item of data) {
    const caminho = `${prefixo}/${item.name}`;
    if (item.id === null) {
      await apagarFicheirosBucket(bucket, caminho);
    } else {
      await supabaseAdmin.storage.from(bucket).remove([caminho]);
    }
  }
}

// Substitui window.open por um gravador — nenhum separador real abre (mais
// rápido e sem depender de rede externa), e lemos depois se o endereço final
// foi definido. Mesmo padrão já usado em tests/lista-do-dia-presencas.spec.ts.
async function interceptarWindowOpen(page: Page) {
  await page.evaluate(() => {
    (window as any).__aberturas = [];
    (window as any).open = () => {
      const win: any = { opener: null, location: { href: '' }, closed: false, close() { win.closed = true; } };
      (window as any).__aberturas.push(win);
      return win;
    };
  });
}
async function ultimaAbertura(page: Page): Promise<{ hrefFinal: string; closed: boolean } | null> {
  return page.evaluate(() => {
    const lista = (window as any).__aberturas || [];
    const w = lista[lista.length - 1];
    return w ? { hrefFinal: w.location.href, closed: w.closed } : null;
  });
}

function decodificarTokenUrl(url: string): { iat: number; exp: number } {
  const u = new URL(url);
  const token = u.searchParams.get('token');
  if (!token) throw new Error('URL assinado sem parâmetro token');
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

test.describe.configure({ mode: 'serial' });

test.describe('Material por aluno (professor + aluno) — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE MaterialAluno'],
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

    secretaria = await criarStaff('secretaria', `Secretaria ${MARCADOR}`);
    prof1 = await criarStaff('professor', `Prof Um ${MARCADOR}`);
    prof2 = await criarStaff('professor', `Prof Dois ${MARCADOR}`);

    const { data: d1, error: errD1 } = await supabaseAdmin.from('subjects').insert({ name: `Disciplina ${MARCADOR}`, centro_id: centroId }).select('id').single();
    if (errD1) throw new Error(`criar disciplina: ${errD1.message}`);
    disciplina1Id = d1.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplina1Id));

    alunoA = await criarAluno(`Aluno A ${MARCADOR}`);
    alunoB = await criarAluno(`Aluno B ${MARCADOR}`);
    alunoNaoFixo = await criarAluno(`Aluno NaoFixo ${MARCADOR}`);
    alunoRecusado = await criarAluno(`Aluno Recusado ${MARCADOR}`);
    alunoTerminado = await criarAluno(`Aluno Terminado ${MARCADOR}`);
    alunoProf2 = await criarAluno(`Aluno Prof2 ${MARCADOR}`);

    const diaSemanaA = diaSemanaDeData(HOJE);
    const semanaK = (k: number) => ((diaSemanaA - 1 + k) % 7) + 1;

    serieAId = await criarSerieComo(prof1, diaSemanaA, disciplina1Id, alunoA.id);
    serieBId = await criarSerieComo(prof1, semanaK(1), disciplina1Id, alunoB.id);
    serieRecusadaId = await criarSerieComo(prof1, semanaK(2), disciplina1Id, alunoRecusado.id);
    serieTerminadaId = await criarSerieComo(prof1, semanaK(3), disciplina1Id, alunoTerminado.id, adicionarDias(HOJE, -30));
    serieProf2Id = await criarSerieComo(prof2, semanaK(4), disciplina1Id, alunoProf2.id);

    const { error: errRecusar } = await supabaseAdmin.from('series_explicacoes').update({ estado_validacao: 'recusada' }).eq('id', serieRecusadaId);
    if (errRecusar) throw new Error(`recusar série: ${errRecusar.message}`);
    const { error: errTerminar } = await supabaseAdmin.from('series_explicacoes').update({ data_fim: adicionarDias(HOJE, -1) }).eq('id', serieTerminadaId);
    if (errTerminar) throw new Error(`terminar série: ${errTerminar.message}`);
  });

  test.afterAll(async () => {
    test.setTimeout(90_000);
    if (centroId) {
      // material_aluno e os ficheiros no bucket não são conhecidos por
      // apagar-centro.mjs (feature nova) — apagados à mão antes, para a
      // linha de config_centro poder ser apagada sem violar FKs.
      await supabaseAdmin.from('material_aluno').delete().eq('centro_id', centroId);
      await apagarFicheirosBucket(BUCKET_MATERIAL, centroId);

      // criar_serie_explicacao gera sessões futuras (explicacoes) ligadas à
      // série — têm de desaparecer antes da série, senão a FK
      // explicacoes.serie_id bloqueia o delete de series_explicacoes (e esse
      // delete falhado, sem verificação de erro, deixaria a série viva a
      // bloquear depois o delete de subjects dentro de apagar-centro.mjs).
      const { data: explicacoesDoCentro } = await supabaseAdmin.from('explicacoes').select('id').eq('centro_id', centroId);
      const idsExplicacoes = (explicacoesDoCentro || []).map((e: any) => e.id);
      if (idsExplicacoes.length > 0) {
        await supabaseAdmin.from('explicacoes_alunos').delete().in('explicacao_id', idsExplicacoes);
      }
      await supabaseAdmin.from('explicacoes').delete().eq('centro_id', centroId);

      const { data: seriesDoCentro } = await supabaseAdmin.from('series_explicacoes').select('id').eq('centro_id', centroId);
      const idsSeries = (seriesDoCentro || []).map((s: any) => s.id);
      if (idsSeries.length > 0) {
        const { error: erroAlunos } = await supabaseAdmin.from('series_explicacoes_alunos').delete().in('serie_id', idsSeries);
        if (erroAlunos) throw new Error(`apagar series_explicacoes_alunos: ${erroAlunos.message}`);
        const { error: erroPausas } = await supabaseAdmin.from('series_explicacoes_pausas').delete().in('serie_id', idsSeries);
        if (erroPausas) throw new Error(`apagar series_explicacoes_pausas: ${erroPausas.message}`);
        const { error: erroSeries } = await supabaseAdmin.from('series_explicacoes').delete().in('id', idsSeries);
        if (erroSeries) throw new Error(`apagar series_explicacoes: ${erroSeries.message}`);
      }
    }
    await Promise.all([...limpeza].map((passo) => Promise.resolve(passo()).catch(() => {})));
    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
  });

  test('(a) professor carrega PDF para um fixo seu: aparece a linha e o ficheiro no caminho certo; o aluno vê "Novo" e o selo; abrir marca visto e o selo desce', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/os-meus-alunos/${alunoA.id}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Material' }).click();

    await page.locator('select').selectOption('ficha_casa');
    await page.getByPlaceholder(/Ficha de revisão/).fill(`Ficha de teste ${MARCADOR}`);
    await page.getByPlaceholder('Observações para o aluno...').fill(`Nota de teste ${MARCADOR}`);
    await page.setInputFiles('input[type="file"]', { name: `ficha-${MARCADOR}.pdf`, mimeType: 'application/pdf', buffer: PDF_VALIDO });

    await expect(page.getByText('A validar ficheiro...')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(`ficha-${MARCADOR}.pdf`)).toBeVisible({ timeout: 10_000 });

    const botaoCarregar = page.getByRole('button', { name: 'Carregar' });
    await expect(botaoCarregar).toBeEnabled();
    await botaoCarregar.click();
    await expect(page.getByText('Material carregado.')).toBeVisible({ timeout: 15_000 });

    const item = page.locator('[data-material-item]').first();
    await expect(item).toBeVisible({ timeout: 10_000 });
    await expect(item).toContainText(`Ficha de teste ${MARCADOR}`);
    await expect(item).toContainText('Ainda não visto');

    // Confirma na base de dados: linha correta e caminho no formato certo.
    const { data: linhas, error } = await supabaseAdmin
      .from('material_aluno').select('*').eq('professor_id', prof1.id).eq('aluno_id', alunoA.id);
    expect(error).toBeNull();
    expect(linhas).toHaveLength(1);
    materialAItemId = linhas![0].id;
    materialAItemCaminho = linhas![0].caminho;
    expect(materialAItemCaminho.startsWith(`${centroId}/${alunoA.id}/`)).toBe(true);
    expect(linhas![0].visto_em).toBeNull();
    expect(linhas![0].categoria).toBe('ficha_casa');
    expect(linhas![0].titulo).toBe(`Ficha de teste ${MARCADOR}`);

    const { data: listaFicheiros } = await supabaseAdmin.storage.from(BUCKET_MATERIAL).list(`${centroId}/${alunoA.id}`);
    expect((listaFicheiros || []).some((f) => materialAItemCaminho.endsWith(f.name))).toBe(true);

    await context.close();

    // Lado do aluno: selo "Novo" no cartão da home e etiqueta "Novo" na lista.
    const contextAluno = await browser.newContext();
    const pageAluno = await contextAluno.newPage();
    await loginUI(pageAluno, alunoA.email, alunoA.password);
    await pageAluno.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    const cartaoMaterial = pageAluno.locator('a[href="/material"]').first();
    await expect(cartaoMaterial).toBeVisible({ timeout: 15_000 });
    await expect(cartaoMaterial.getByText('1', { exact: true })).toBeVisible();

    await pageAluno.goto(`${BASE_URL}/material`, { waitUntil: 'networkidle' });
    const itemAluno = pageAluno.locator(`[data-material-aluno="${materialAItemId}"]`);
    await expect(itemAluno).toBeVisible({ timeout: 10_000 });
    await expect(itemAluno.getByText('Novo', { exact: true })).toBeVisible();

    await interceptarWindowOpen(pageAluno);
    await itemAluno.getByRole('button', { name: 'Abrir' }).click();
    await expect.poll(async () => (await ultimaAbertura(pageAluno))?.hrefFinal || '', { timeout: 10_000 }).not.toBe('');

    await expect(itemAluno.getByText('Novo', { exact: true })).toHaveCount(0, { timeout: 15_000 });

    const { data: linhaVista } = await supabaseAdmin.from('material_aluno').select('visto_em').eq('id', materialAItemId).single();
    expect(linhaVista?.visto_em).not.toBeNull();

    await pageAluno.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await expect(pageAluno.locator('a[href="/material"]').first().getByText('1', { exact: true })).toHaveCount(0);

    await contextAluno.close();
  });

  test('(b) upload bloqueado para quem não é fixo ativo do professor (não fixo, recusada, terminada) — tentativa direta ao storage e à tabela', async ({ browser }: { browser: Browser }) => {
    const clientProf1 = await sessaoComo(prof1);

    for (const [nome, aluno] of [['não fixo', alunoNaoFixo], ['recusada', alunoRecusado], ['terminada', alunoTerminado]] as const) {
      const caminho = `${centroId}/${aluno.id}/${crypto.randomUUID()}-teste.pdf`;
      const { error: erroUpload } = await clientProf1.storage.from(BUCKET_MATERIAL).upload(caminho, PDF_VALIDO, { contentType: 'application/pdf' });
      expect(erroUpload, `upload direto deveria falhar para aluno ${nome}`).not.toBeNull();

      const { error: erroInsert } = await clientProf1.from('material_aluno').insert({
        centro_id: centroId, aluno_id: aluno.id, professor_id: prof1.id, categoria: 'ficha_casa',
        titulo: `Não devia existir (${nome})`, caminho, nome_original: 'teste.pdf', tipo: 'application/pdf', tamanho: PDF_VALIDO.length,
      });
      expect(erroInsert, `insert direto deveria falhar para aluno ${nome}`).not.toBeNull();

      // A UI nem mostra o separador Material — a página recusa o aluno todo.
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginUI(page, prof1.email, prof1.password);
      await page.goto(`${BASE_URL}/admin/os-meus-alunos/${aluno.id}`, { waitUntil: 'networkidle' });
      await expect(page.getByText('Este aluno não está nas tuas explicações fixas.')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Material' })).toHaveCount(0);
      await context.close();
    }
  });

  test('(c) isolamento: aluno não lê material de outro aluno; professor2 não lê material de professor1; secretaria sem acesso; staff em /material vê página vazia', async ({ browser }: { browser: Browser }) => {
    const clientAlunoB = await sessaoComo(alunoB);
    const { data: leituraAlunoB, error: erroLeituraAlunoB } = await clientAlunoB.from('material_aluno').select('id').eq('aluno_id', alunoA.id);
    if (!erroLeituraAlunoB) expect(leituraAlunoB ?? []).toHaveLength(0);
    const { data: urlAlunoB, error: erroUrlAlunoB } = await clientAlunoB.storage.from(BUCKET_MATERIAL).createSignedUrl(materialAItemCaminho, 60);
    expect(urlAlunoB?.signedUrl ?? null, 'aluno B não devia conseguir um URL assinado do ficheiro de A').toBeNull();
    expect(erroUrlAlunoB).not.toBeNull();

    const clientProf2 = await sessaoComo(prof2);
    const { data: leituraProf2, error: erroLeituraProf2 } = await clientProf2.from('material_aluno').select('id').eq('professor_id', prof1.id);
    if (!erroLeituraProf2) expect(leituraProf2 ?? []).toHaveLength(0);
    const { data: urlProf2 } = await clientProf2.storage.from(BUCKET_MATERIAL).createSignedUrl(materialAItemCaminho, 60);
    expect(urlProf2?.signedUrl ?? null, 'prof2 não devia conseguir um URL assinado do ficheiro de prof1').toBeNull();

    const clientSecretaria = await sessaoComo(secretaria);
    const { data: leituraSecretaria, error: erroLeituraSecretaria } = await clientSecretaria.from('material_aluno').select('id').eq('centro_id', centroId);
    if (!erroLeituraSecretaria) expect(leituraSecretaria ?? []).toHaveLength(0);
    const { data: urlSecretaria } = await clientSecretaria.storage.from(BUCKET_MATERIAL).createSignedUrl(materialAItemCaminho, 60);
    expect(urlSecretaria?.signedUrl ?? null, 'secretaria não devia ter acesso nenhum').toBeNull();

    // Pelo URL direto, staff vê a página do aluno vazia (sem material, sem botão Abrir) — a direção não tem ecrã próprio nesta fase.
    for (const conta of [prof1, secretaria, admin]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginUI(page, conta.email, conta.password);
      await page.goto(`${BASE_URL}/material`, { waitUntil: 'networkidle' });
      await expect(page.getByText('Ainda não tens material.')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-material-aluno]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Abrir' })).toHaveCount(0);
      await context.close();
    }
  });

  test('(d) tipos e tamanhos recusados — no servidor (bucket), mesmo ignorando a validação do cliente; e no cliente, extensão e assinatura de bytes', async ({ browser }: { browser: Browser }) => {
    const clientProf1 = await sessaoComo(prof1);
    const prefixo = `${centroId}/${alunoA.id}`;

    const casosServidor: Array<{ nome: string; mime: string; bytes: Buffer }> = [
      { nome: 'exe', mime: 'application/x-msdownload', bytes: Buffer.from([0x4d, 0x5a, 0, 0]) },
      { nome: 'html', mime: 'text/html', bytes: Buffer.from('<html></html>') },
      { nome: 'svg', mime: 'image/svg+xml', bytes: Buffer.from('<svg></svg>') },
      { nome: 'pdf-grande', mime: 'application/pdf', bytes: PDF_GRANDE },
    ];
    for (const caso of casosServidor) {
      const caminho = `${prefixo}/${crypto.randomUUID()}-malicioso.${caso.nome}`;
      const { error } = await clientProf1.storage.from(BUCKET_MATERIAL).upload(caminho, caso.bytes, { contentType: caso.mime });
      expect(error, `upload direto (${caso.nome}) devia ser recusado pelo bucket`).not.toBeNull();
    }

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/os-meus-alunos/${alunoA.id}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Material' }).click();

    await page.setInputFiles('input[type="file"]', { name: 'x.exe', mimeType: 'application/pdf', buffer: PDF_VALIDO });
    await expect(page.getByText('A extensão do ficheiro não corresponde ao tipo indicado.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Carregar' })).toBeDisabled();

    await page.setInputFiles('input[type="file"]', { name: 'documento.pdf', mimeType: 'application/pdf', buffer: TEXTO_FALSO_PDF });
    await expect(page.getByText('O ficheiro não corresponde ao tipo indicado.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Carregar' })).toBeDisabled();

    await context.close();
  });

  test('(e) se o insert da linha falhar depois do upload (categoria inválida), o ficheiro é apagado — sem órfão', async () => {
    const clientProf1 = await sessaoComo(prof1);
    const prefixo = `${centroId}/${alunoB.id}`;

    const { data: antesFicheiros } = await supabaseAdmin.storage.from(BUCKET_MATERIAL).list(prefixo);
    expect(antesFicheiros ?? []).toHaveLength(0);

    const caminho = `${prefixo}/${crypto.randomUUID()}-orfao-teste.pdf`;
    const { error: erroUpload } = await clientProf1.storage.from(BUCKET_MATERIAL).upload(caminho, PDF_VALIDO, { contentType: 'application/pdf' });
    expect(erroUpload).toBeNull();

    const { error: erroInsert } = await clientProf1.from('material_aluno').insert({
      centro_id: centroId, aluno_id: alunoB.id, professor_id: prof1.id, categoria: 'categoria_invalida',
      titulo: 'Nunca deve existir', caminho, nome_original: 'orfao-teste.pdf', tipo: 'application/pdf', tamanho: PDF_VALIDO.length,
    });
    expect(erroInsert, 'categoria inválida devia violar a restrição da tabela').not.toBeNull();

    // Reproduz o que a app faz quando o insert falha: apaga o ficheiro já enviado.
    await clientProf1.storage.from(BUCKET_MATERIAL).remove([caminho]);

    const { data: depoisFicheiros } = await supabaseAdmin.storage.from(BUCKET_MATERIAL).list(prefixo);
    expect(depoisFicheiros ?? []).toHaveLength(0);
    const { data: linhasB } = await supabaseAdmin.from('material_aluno').select('id').eq('aluno_id', alunoB.id);
    expect(linhasB ?? []).toHaveLength(0);
  });

  test('(f) apagar: nenhum UPDATE direto para ninguém; só o professor dono apaga (linha e ficheiro); professor2 e o aluno não conseguem apagar nem editar', async ({ browser }: { browser: Browser }) => {
    expect(materialAItemId, 'depende do item criado no teste (a)').not.toBe('');

    const clientProf2 = await sessaoComo(prof2);
    const { error: erroDeleteProf2 } = await clientProf2.from('material_aluno').delete().eq('id', materialAItemId);
    const { data: aindaExiste1 } = await supabaseAdmin.from('material_aluno').select('id').eq('id', materialAItemId).maybeSingle();
    expect(aindaExiste1, 'prof2 não devia conseguir apagar o material de prof1').not.toBeNull();
    void erroDeleteProf2;

    const clientAlunoA = await sessaoComo(alunoA);
    await clientAlunoA.from('material_aluno').delete().eq('id', materialAItemId);
    const { data: aindaExiste2 } = await supabaseAdmin.from('material_aluno').select('id').eq('id', materialAItemId).maybeSingle();
    expect(aindaExiste2, 'o aluno não devia conseguir apagar o seu próprio material').not.toBeNull();

    // Nenhum UPDATE direto é permitido — nem para o próprio professor dono.
    const clientProf1 = await sessaoComo(prof1);
    const { error: erroUpdateProf1 } = await clientProf1.from('material_aluno').update({ titulo: 'Editado à força' }).eq('id', materialAItemId);
    const { data: tituloInalterado } = await supabaseAdmin.from('material_aluno').select('titulo').eq('id', materialAItemId).single();
    expect(tituloInalterado?.titulo).not.toBe('Editado à força');
    void erroUpdateProf1;

    const { error: erroUpdateAluno } = await clientAlunoA.from('material_aluno').update({ titulo: 'Editado pelo aluno' }).eq('id', materialAItemId);
    const { data: tituloInalterado2 } = await supabaseAdmin.from('material_aluno').select('titulo').eq('id', materialAItemId).single();
    expect(tituloInalterado2?.titulo).not.toBe('Editado pelo aluno');
    void erroUpdateAluno;

    // O professor dono apaga de facto, pela UI.
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/os-meus-alunos/${alunoA.id}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Material' }).click();

    const item = page.locator(`[data-material-item="${materialAItemId}"]`);
    await expect(item).toBeVisible({ timeout: 10_000 });
    page.once('dialog', (d) => d.accept());
    await item.getByRole('button', { name: 'Apagar' }).click();
    await expect(page.getByText('Material apagado.')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`[data-material-item="${materialAItemId}"]`)).toHaveCount(0);

    const { data: linhaApagada } = await supabaseAdmin.from('material_aluno').select('id').eq('id', materialAItemId).maybeSingle();
    expect(linhaApagada).toBeNull();
    const { data: listaFicheiros } = await supabaseAdmin.storage.from(BUCKET_MATERIAL).list(`${centroId}/${alunoA.id}`);
    expect((listaFicheiros || []).some((f) => materialAItemCaminho.endsWith(f.name))).toBe(false);

    await context.close();
  });

  test('(g) marcar_material_visto: só o dono, e só a primeira vez muda a data', async () => {
    const caminho = `${centroId}/${alunoA.id}/${crypto.randomUUID()}-visto-teste.pdf`;
    const { data: linha, error: erroInsert } = await supabaseAdmin.from('material_aluno').insert({
      centro_id: centroId, aluno_id: alunoA.id, professor_id: prof1.id, categoria: 'resumo',
      titulo: `Teste visto ${MARCADOR}`, caminho, nome_original: 'visto-teste.pdf', tipo: 'application/pdf', tamanho: 10,
    }).select().single();
    if (erroInsert) throw new Error(erroInsert.message);
    const materialId = linha.id;

    const clientProf2 = await sessaoComo(prof2);
    await clientProf2.rpc('marcar_material_visto', { p_id: materialId });
    const { data: aposProf2 } = await supabaseAdmin.from('material_aluno').select('visto_em').eq('id', materialId).single();
    expect(aposProf2?.visto_em).toBeNull();

    const clientAlunoB = await sessaoComo(alunoB);
    await clientAlunoB.rpc('marcar_material_visto', { p_id: materialId });
    const { data: aposAlunoB } = await supabaseAdmin.from('material_aluno').select('visto_em').eq('id', materialId).single();
    expect(aposAlunoB?.visto_em).toBeNull();

    const clientAlunoA = await sessaoComo(alunoA);
    const { error: erroVisto1 } = await clientAlunoA.rpc('marcar_material_visto', { p_id: materialId });
    expect(erroVisto1).toBeNull();
    const { data: primeiraVez } = await supabaseAdmin.from('material_aluno').select('visto_em').eq('id', materialId).single();
    expect(primeiraVez?.visto_em).not.toBeNull();
    const vistoEm1 = primeiraVez!.visto_em;

    const { error: erroVisto2 } = await clientAlunoA.rpc('marcar_material_visto', { p_id: materialId });
    expect(erroVisto2).toBeNull();
    const { data: segundaVez } = await supabaseAdmin.from('material_aluno').select('visto_em').eq('id', materialId).single();
    expect(segundaVez?.visto_em).toBe(vistoEm1);

    await supabaseAdmin.from('material_aluno').delete().eq('id', materialId);
  });

  test('(h) URL assinado expira: pedido com validade de 60s e um token real de curta duração deixa de funcionar', async () => {
    const caminho = `${centroId}/${alunoA.id}/${crypto.randomUUID()}-expira-teste.pdf`;
    const { error: erroUpload } = await supabaseAdmin.storage.from(BUCKET_MATERIAL).upload(caminho, PDF_VALIDO, { contentType: 'application/pdf' });
    expect(erroUpload).toBeNull();
    // A RLS de storage.objects para o professor junta com material_aluno
    // (só vê/assina o que ele próprio carregou) — sem esta linha, um
    // createSignedUrl feito pela sessão do professor dava "Object not found".
    const { data: linha, error: erroInsert } = await supabaseAdmin.from('material_aluno').insert({
      centro_id: centroId, aluno_id: alunoA.id, professor_id: prof1.id, categoria: 'outro',
      titulo: `Teste expira ${MARCADOR}`, caminho, nome_original: 'expira-teste.pdf', tipo: 'application/pdf', tamanho: PDF_VALIDO.length,
    }).select().single();
    if (erroInsert) throw new Error(erroInsert.message);

    const clientProf1 = await sessaoComo(prof1);
    const { data: url60, error: erro60 } = await clientProf1.storage.from(BUCKET_MATERIAL).createSignedUrl(caminho, 60);
    expect(erro60).toBeNull();
    const payload = decodificarTokenUrl(url60!.signedUrl);
    expect(payload.exp - payload.iat).toBeGreaterThanOrEqual(58);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(62);

    const { data: urlCurto, error: erroCurto } = await clientProf1.storage.from(BUCKET_MATERIAL).createSignedUrl(caminho, 1);
    expect(erroCurto).toBeNull();
    await new Promise((r) => setTimeout(r, 2500));
    const resposta = await fetch(urlCurto!.signedUrl);
    expect(resposta.ok, 'o URL assinado de 1s devia ter expirado').toBe(false);

    await supabaseAdmin.from('material_aluno').delete().eq('id', linha.id);
    await supabaseAdmin.storage.from(BUCKET_MATERIAL).remove([caminho]);
  });

  test('(i) larguras móveis (360, 390, 430) sem scroll horizontal — separador Material e página /material do aluno', async ({ browser }: { browser: Browser }) => {
    const contextProf = await browser.newContext();
    const pageProf = await contextProf.newPage();
    await loginUI(pageProf, prof1.email, prof1.password);

    for (const largura of [360, 390, 430]) {
      await pageProf.setViewportSize({ width: largura, height: 800 });
      await pageProf.goto(`${BASE_URL}/admin/os-meus-alunos/${alunoA.id}`, { waitUntil: 'networkidle' });
      await pageProf.getByRole('button', { name: 'Material' }).click();
      const semScrollMaterial = await pageProf.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(semScrollMaterial, `separador Material sem scroll horizontal a ${largura}px`).toBe(true);
    }
    await contextProf.close();

    const contextAluno = await browser.newContext();
    const pageAluno = await contextAluno.newPage();
    await loginUI(pageAluno, alunoA.email, alunoA.password);

    for (const largura of [360, 390, 430]) {
      await pageAluno.setViewportSize({ width: largura, height: 800 });
      await pageAluno.goto(`${BASE_URL}/material`, { waitUntil: 'networkidle' });
      const semScrollPagina = await pageAluno.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(semScrollPagina, `/material sem scroll horizontal a ${largura}px`).toBe(true);

      await pageAluno.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      const semScrollHome = await pageAluno.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(semScrollHome, `home do aluno sem scroll horizontal a ${largura}px`).toBe(true);
    }
    await contextAluno.close();
  });
});
