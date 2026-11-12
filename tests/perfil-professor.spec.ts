import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';
import { getHojeLisboa, dataLisboaDe, instanteLisboaParaUTC } from '@/lib/dataLisboa';

dotenv.config({ path: '.env.local' });

// «O Meu Perfil» redesenhado para o professor — cabeçalho com iniciais/nome/
// email/etiqueta, três números do mês (horas, sessões dadas, alunos fixos —
// reutiliza buscarAlunosFixosAtivos de lib/osMeusAlunos.ts, lib/registosHoras.ts
// e lib/dataLisboa.ts, nunca lógica própria), três atalhos, e o formulário de
// palavra-passe fechado por omissão. Admin e secretaria mantêm o ecrã antigo
// (cobertos em tests/alterar-password.spec.ts (c), não repetido aqui).
// Centro descartável ZZTESTE (~/Desktop/gestao-centros/novo-centro.mjs),
// nunca o centro real nem o demo.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const GESTAO_DIR = path.join(os.homedir(), 'Desktop', 'gestao-centros');
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE PerfilProf ${SUFIXO}`;
const ADMIN_EMAIL = `admin-perfilprof-${SUFIXO}@zzteste.invalid`;
const MARCADOR = `PP_${SUFIXO}`;
const HOJE = getHojeLisboa();

type Conta = { email: string; password: string; id: string };

let centroId: string;
let admin: Conta;
let secretaria: Conta;
let prof: Conta;
let prof2: Conta;
let disciplinaId: number;

let alunoP: Conta, alunoQ: Conta, alunoR: Conta, alunoS: Conta, alunoSessoes: Conta;

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
  const email = `aluno-pp-${sufixo}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-pp-${sufixo}@zzteste.invalid`,
    data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centroId, ativo: true, sala_estudo: false, faz_explicacoes: true, mensalidade_base: 0,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return { email, password, id };
}

async function sessaoComo(conta: Conta) {
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

/** Cria uma série fixa pelo próprio professor e devolve o id, identificada pelo dia_semana único usado como impressão digital. */
async function criarSerieComo(conta: Conta, diaFingerprint: number, alunoId: string, dataInicio: string = HOJE): Promise<string> {
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

async function inserirRegisto(professorId: string, entradaUTC: string, saidaUTC: string | null, origem: 'toque' | 'manual' | 'direcao' = 'manual') {
  const { data, error } = await supabaseAdmin
    .from('registos_horas_professor')
    .insert({ centro_id: centroId, professor_id: professorId, entrada: entradaUTC, saida: saidaUTC, origem })
    .select('id, minutos')
    .single();
  if (error) throw new Error(`inserir registo: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('registos_horas_professor').delete().eq('id', data.id));
  return data as { id: string; minutos: number | null };
}

async function inserirSessaoSolta(opts: { professorId: string; alunoId: string; data: string; dado: boolean; horaInicio?: string }): Promise<string> {
  const { data: row, error } = await supabaseAdmin.from('explicacoes').insert({
    centro_id: centroId, professor_id: opts.professorId, disciplina_id: disciplinaId,
    serie_id: null, data: opts.data, data_serie: null, hora_inicio: opts.horaInicio ?? '08:00:00',
    duracao_prevista_horas: null, dado: opts.dado, estado: 'ativa', horas_dadas: opts.dado ? 1 : null,
  }).select('id').single();
  if (error) throw new Error(`criar sessão solta: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('explicacoes_alunos').delete().eq('explicacao_id', row.id));
  limpeza.push(() => supabaseAdmin.from('explicacoes').delete().eq('id', row.id));
  const { error: errAlunos } = await supabaseAdmin.from('explicacoes_alunos').insert({ explicacao_id: row.id, aluno_id: opts.alunoId });
  if (errAlunos) throw new Error(`associar aluno à sessão: ${errAlunos.message}`);
  return row.id;
}

function previsaoAlunosFixos() {
  return { esperado: 2 }; // alunoP (2 fixas) + alunoS (1 fixa) — Q (recusada) e R (terminada) excluídos
}

test.describe.configure({ mode: 'serial' });

test.describe('O Meu Perfil (professor) — redesenho, centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE PerfilProf'],
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
    prof = await criarStaff('professor', `Ana Professora ${MARCADOR}`);
    prof2 = await criarStaff('professor', `Prof Dois ${MARCADOR}`);

    const { data: disc, error: errDisc } = await supabaseAdmin.from('subjects').insert({ name: `Disciplina PP ${MARCADOR}`, centro_id: centroId }).select('id').single();
    if (errDisc) throw new Error(`criar disciplina: ${errDisc.message}`);
    disciplinaId = disc.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplinaId));

    alunoP = await criarAluno(`Aluno P ${MARCADOR}`);
    alunoQ = await criarAluno(`Aluno Q ${MARCADOR}`);
    alunoR = await criarAluno(`Aluno R ${MARCADOR}`);
    alunoS = await criarAluno(`Aluno S ${MARCADOR}`);
    alunoSessoes = await criarAluno(`Aluno Sessoes ${MARCADOR}`);

    // Impressões digitais (dia_semana) únicas, derivadas do dia da semana de
    // hoje — nunca valores fixos, para nunca colidir por coincidência.
    const diaBase = diaSemanaDeData(HOJE);
    const semanaK = (k: number) => ((diaBase - 1 + k) % 7) + 1;

    // Aluno P: DUAS fixas ativas (mesmo professor) — conta uma vez só.
    await criarSerieComo(prof, diaBase, alunoP.id);
    await criarSerieComo(prof, semanaK(1), alunoP.id);
    // Aluno Q: uma fixa, mas RECUSADA — nunca conta.
    const serieQId = await criarSerieComo(prof, semanaK(2), alunoQ.id);
    const { error: errRecusar } = await supabaseAdmin.from('series_explicacoes').update({ estado_validacao: 'recusada' }).eq('id', serieQId);
    if (errRecusar) throw new Error(`recusar série Q: ${errRecusar.message}`);
    // Aluno R: uma fixa, mas TERMINADA (data_fim no passado, depois de
    // data_inicio — a série tem de ter começado há mais tempo) — nunca conta.
    const serieRId = await criarSerieComo(prof, semanaK(3), alunoR.id, adicionarDias(HOJE, -60));
    const { error: errTerminar } = await supabaseAdmin.from('series_explicacoes').update({ data_fim: adicionarDias(HOJE, -1) }).eq('id', serieRId);
    if (errTerminar) throw new Error(`terminar série R: ${errTerminar.message}`);
    // Aluno S: uma fixa normal — conta.
    await criarSerieComo(prof, semanaK(4), alunoS.id);

    // Sessões "dado = true" do professor: 2 este mês (contam), 1 por dar
    // este mês (não conta), 1 dada no mês anterior (não conta), 1 dada por
    // prof2 este mês (isolamento — não conta para `prof`).
    await inserirSessaoSolta({ professorId: prof.id, alunoId: alunoSessoes.id, data: HOJE, dado: true, horaInicio: '08:00:00' });
    await inserirSessaoSolta({ professorId: prof.id, alunoId: alunoSessoes.id, data: HOJE, dado: true, horaInicio: '10:00:00' });
    await inserirSessaoSolta({ professorId: prof.id, alunoId: alunoSessoes.id, data: HOJE, dado: false, horaInicio: '12:00:00' });
    const mesAnteriorPrimeiroDia = (() => {
      const [ano, mes] = HOJE.slice(0, 7).split('-').map(Number);
      const anoAnterior = mes === 1 ? ano - 1 : ano;
      const mesAnterior = mes === 1 ? 12 : mes - 1;
      return `${anoAnterior}-${String(mesAnterior).padStart(2, '0')}-15`;
    })();
    await inserirSessaoSolta({ professorId: prof.id, alunoId: alunoSessoes.id, data: mesAnteriorPrimeiroDia, dado: true, horaInicio: '09:00:00' });
    await inserirSessaoSolta({ professorId: prof2.id, alunoId: alunoSessoes.id, data: HOJE, dado: true, horaInicio: '14:00:00' });
  });

  test.afterAll(async () => {
    test.setTimeout(90_000);
    await Promise.all([...limpeza].map((passo) => Promise.resolve(passo()).catch(() => {})));
    if (centroId) {
      const { data: seriesDoCentro } = await supabaseAdmin.from('series_explicacoes').select('id').eq('centro_id', centroId);
      const idsSeries = (seriesDoCentro || []).map((s: any) => s.id);
      if (idsSeries.length > 0) {
        await supabaseAdmin.from('series_explicacoes_alunos').delete().in('serie_id', idsSeries);
        await supabaseAdmin.from('series_explicacoes_pausas').delete().in('serie_id', idsSeries);
      }
      await supabaseAdmin.from('explicacoes').delete().eq('centro_id', centroId);
      if (idsSeries.length > 0) {
        await supabaseAdmin.from('series_explicacoes').delete().in('id', idsSeries);
      }
      await supabaseAdmin.from('registos_horas_professor').delete().eq('centro_id', centroId);
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
  });

  // --- (a) cabeçalho ---------------------------------------------------
  test('(a) cabeçalho: iniciais, nome, email e etiqueta "Professor"', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof.email, prof.password);
    await page.goto(`${BASE_URL}/admin/perfil`, { waitUntil: 'networkidle' });

    await expect(page.getByText('AP', { exact: true })).toBeVisible({ timeout: 15_000 }); // Ana Professora -> A + P
    await expect(page.getByText(`Ana Professora ${MARCADOR}`)).toBeVisible();
    await expect(page.getByText(prof.email)).toBeVisible();
    await expect(page.getByText('Professor', { exact: true })).toBeVisible();

    await context.close();
  });

  // --- (b) os três números batem com a base de dados --------------------
  test('(b) números do mês: horas, sessões dadas e alunos fixos corretos', async ({ browser }: { browser: Browser }) => {
    const agora = new Date();
    const mesAtualLisboa = HOJE.slice(0, 7);
    const entradaDate = new Date(agora.getTime() - 65 * 60 * 1000);
    const saidaDate = new Date(agora.getTime() - 5 * 60 * 1000);
    const entradaMes = dataLisboaDe(entradaDate.toISOString()).slice(0, 7);
    const saidaMes = dataLisboaDe(saidaDate.toISOString()).slice(0, 7);

    test.skip(
      entradaMes !== mesAtualLisboa || saidaMes !== mesAtualLisboa,
      'agora está demasiado perto do início do mês em Lisboa (a janela de 65min recuaria ao mês anterior) — cenário instável, ignorado'
    );

    const registo = await inserirRegisto(prof.id, entradaDate.toISOString(), saidaDate.toISOString(), 'manual');
    const minutosEsperados = Number(registo.minutos);
    // um turno em aberto (agora mesmo) — nunca soma
    await inserirRegisto(prof.id, new Date(agora.getTime() - 2 * 60 * 1000).toISOString(), null, 'toque');

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof.email, prof.password);
    await page.goto(`${BASE_URL}/admin/perfil`, { waitUntil: 'networkidle' });

    const h = Math.floor(minutosEsperados / 60);
    const m = minutosEsperados % 60;
    const horasTexto = minutosEsperados === 0 ? '0 h' : `${h} h ${String(m).padStart(2, '0')} min`;

    const cartaoHoras = page.getByText('Horas este mês').locator('..');
    await expect(cartaoHoras.getByText(horasTexto, { exact: true })).toBeVisible({ timeout: 15_000 });

    const cartaoSessoes = page.getByText('Sessões dadas').locator('..');
    await expect(cartaoSessoes.getByText('2', { exact: true })).toBeVisible({ timeout: 15_000 });

    const cartaoFixos = page.getByText('Alunos fixos').locator('..');
    await expect(cartaoFixos.getByText(String(previsaoAlunosFixos().esperado), { exact: true })).toBeVisible({ timeout: 15_000 });

    await context.close();
  });

  // --- (c) atalhos ---------------------------------------------------
  test('(c) atalhos levam às páginas certas', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof.email, prof.password);

    const casos: Array<{ titulo: string; url: string }> = [
      { titulo: 'Horas de trabalho', url: '/admin/horas' },
      { titulo: 'Os meus alunos', url: '/admin/os-meus-alunos' },
      { titulo: 'As minhas fixas', url: '/admin/explicacoes/minhas-fixas' },
    ];

    for (const caso of casos) {
      await page.goto(`${BASE_URL}/admin/perfil`, { waitUntil: 'networkidle' });
      await page.getByText(caso.titulo, { exact: true }).click();
      await page.waitForURL(new RegExp(caso.url.replace(/\//g, '\\/')), { timeout: 10_000 });
      expect(page.url()).toContain(caso.url);
    }

    await context.close();
  });

  // --- (d) formulário de palavra-passe ------------------------------------
  test('(d) formulário de palavra-passe: fechado por omissão, dicas, validação, erro e sucesso', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof.email, prof.password);
    await page.goto(`${BASE_URL}/admin/perfil`, { waitUntil: 'networkidle' });

    // Fechado por omissão.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Alterar', exact: true }).click();
    await expect(page.locator('input[type="password"]')).toHaveCount(3);

    // Localizadores por placeholder — estáveis mesmo quando mostrar/ocultar
    // muda o atributo `type` de "password" para "text" (o que tornaria
    // `input[type="password"]` um conjunto diferente a cada nth()).
    const campoAtual = page.getByPlaceholder('A tua palavra-passe atual');
    const campoNova = page.getByPlaceholder('Mínimo 6 caracteres');
    const campoRepetir = page.getByPlaceholder('Repetir a nova palavra-passe');
    const botaoGuardar = page.getByRole('button', { name: /guardar palavra-passe/i });

    // Dica: faltam caracteres.
    await campoNova.fill('ab1');
    await expect(page.getByText('Faltam 3 caracteres.')).toBeVisible();
    await expect(botaoGuardar).toBeDisabled();

    // Dica: não coincidem.
    await campoNova.fill('password-nova-123');
    await campoRepetir.fill('password-diferente-456');
    await expect(page.getByText('As palavras-passe não coincidem.')).toBeVisible();
    await expect(botaoGuardar).toBeDisabled();

    // Dica: igual à atual.
    await campoAtual.fill(prof.password);
    await campoNova.fill(prof.password);
    await campoRepetir.fill(prof.password);
    await expect(page.getByText('A nova palavra-passe tem de ser diferente da atual.')).toBeVisible();
    await expect(botaoGuardar).toBeDisabled();

    // Mostrar/ocultar.
    await expect(campoAtual).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Mostrar palavra-passe atual' }).click();
    await expect(page.getByPlaceholder('A tua palavra-passe atual')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Ocultar palavra-passe atual' }).click();
    await expect(page.getByPlaceholder('A tua palavra-passe atual')).toHaveAttribute('type', 'password');

    // Erro da rota: palavra-passe atual errada — formulário fica aberto.
    await campoAtual.fill('password-de-certeza-errada');
    const novaValida = gerarPasswordSegura();
    await campoNova.fill(novaValida);
    await campoRepetir.fill(novaValida);
    await expect(botaoGuardar).toBeEnabled();
    await botaoGuardar.click();
    await expect(page.getByText('A palavra-passe atual está incorreta.')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[type="password"]')).toHaveCount(3); // continua aberto

    // "Fechar" fecha o formulário.
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    // Sucesso: reabre, preenche corretamente, guarda.
    await page.getByRole('button', { name: 'Alterar', exact: true }).click();
    await page.getByPlaceholder('A tua palavra-passe atual').fill(prof.password);
    await page.getByPlaceholder('Mínimo 6 caracteres').fill(novaValida);
    await page.getByPlaceholder('Repetir a nova palavra-passe').fill(novaValida);
    await page.getByRole('button', { name: /guardar palavra-passe/i }).click();
    await expect(page.getByText('Palavra-passe alterada. A tua sessão continua aberta.')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[type="password"]')).toHaveCount(0); // fechou

    await context.close();

    const ctxNova = await browser.newContext();
    await loginUI(await ctxNova.newPage(), prof.email, novaValida);
    expect((await ctxNova.pages())[0].url()).not.toContain('/login');
    await ctxNova.close();

    // repõe a password original para não afetar outros testes/suites
    await supabaseAdmin.auth.admin.updateUserById(prof.id, { password: prof.password });
  });

  // --- (e) admin e secretaria mantêm o ecrã antigo ------------------------
  test('(e) admin e secretaria veem o perfil antigo — sem iniciais, números ou atalhos', async ({ browser }: { browser: Browser }) => {
    for (const conta of [admin, secretaria]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginUI(page, conta.email, conta.password);
      await page.goto(`${BASE_URL}/admin/perfil`, { waitUntil: 'networkidle' });

      await expect(page.getByText('Horas este mês')).toHaveCount(0);
      await expect(page.getByText('Sessões dadas')).toHaveCount(0);
      await expect(page.getByText('Alunos fixos')).toHaveCount(0);
      await expect(page.getByText('As minhas fixas')).toHaveCount(0);
      await expect(page.getByText('Cargo', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /gravar nova palavra-passe/i })).toBeVisible();

      await context.close();
    }
  });

  // --- (f) mês de Lisboa independente do fuso do browser ------------------
  test('(f) mês dos números é o de Lisboa, com o browser em Pacific/Auckland', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext({ timezoneId: 'Pacific/Auckland' });
    const page = await context.newPage();
    await loginUI(page, prof.email, prof.password);
    await page.goto(`${BASE_URL}/admin/perfil`, { waitUntil: 'networkidle' });

    const cartaoSessoes = page.getByText('Sessões dadas').locator('..');
    await expect(cartaoSessoes.getByText('2', { exact: true })).toBeVisible({ timeout: 15_000 });
    const cartaoFixos = page.getByText('Alunos fixos').locator('..');
    await expect(cartaoFixos.getByText(String(previsaoAlunosFixos().esperado), { exact: true })).toBeVisible({ timeout: 15_000 });

    await context.close();
  });

  // --- (g) larguras móveis sem scroll horizontal --------------------------
  test('(g) 360/390/430px: sem scroll horizontal, três cartões de números lado a lado', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof.email, prof.password);

    for (const largura of [360, 390, 430]) {
      await page.setViewportSize({ width: largura, height: 800 });
      await page.goto(`${BASE_URL}/admin/perfil`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !document.querySelector('.animate-spin'), { timeout: 10_000 }).catch(() => {});

      const semScrollHorizontal = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(semScrollHorizontal, `scrollWidth <= clientWidth falhou a ${largura}px`).toBe(true);

      const cartaoHoras = page.getByText('Horas este mês').locator('..');
      const cartaoSessoes = page.getByText('Sessões dadas').locator('..');
      const cartaoFixos = page.getByText('Alunos fixos').locator('..');
      const [bHoras, bSessoes, bFixos] = await Promise.all([
        cartaoHoras.boundingBox(), cartaoSessoes.boundingBox(), cartaoFixos.boundingBox(),
      ]);
      expect(bHoras && bSessoes && bFixos, `cartões de número invisíveis a ${largura}px`).toBeTruthy();
      expect(Math.abs((bHoras!.y) - (bSessoes!.y)), `cartões não lado a lado a ${largura}px`).toBeLessThan(2);
      expect(Math.abs((bSessoes!.y) - (bFixos!.y)), `cartões não lado a lado a ${largura}px`).toBeLessThan(2);
    }

    await context.close();
  });
});
