import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Página "Os Meus Alunos" (professores) + realce "Fixo" em Nova Explicação —
// cartão por aluno fixo ativo (sem_explicações soltas), próxima sessão (sem
// canceladas), etiqueta de teste a 7/8 dias, última nota de sessão, detalhe
// com os 4 separadores, caderno privado (RLS: só o professor autor),
// isolamento entre professores, acesso de admin/secretaria, fuso de Lisboa
// independente do fuso do browser, e larguras móveis sem scroll horizontal.
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

// Mesma convenção de getHojeLisboa() (lib/dataLisboa.ts) — "hoje" em
// Europe/Lisbon, calculado uma vez, nunca com new Date() local. Isto corre
// no processo de testes (Node), não na app — é só para as datas das fixtures,
// que têm de ser as mesmas que a app vai ler como "hoje" em Lisboa.
function hojeLisboaISO(): string {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const obter = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${obter('year')}-${obter('month')}-${obter('day')}`;
}

/** Aritmética de calendário pura sobre a string ISO (sem fuso ambíguo: usa 'Z' explícito só para somar dias). */
function adicionarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** 1=Segunda..7=Domingo — mesma convenção de dia_semana usada pelas séries fixas. */
function diaSemanaDeData(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay();
  return dow === 0 ? 7 : dow;
}

const SUFIXO = String(Date.now());
const NOME_ZZTESTE = `ZZTESTE OsMeusAlunos ${SUFIXO}`;
const ADMIN_EMAIL = `admin-oma-${SUFIXO}@zzteste.invalid`;
const MARCADOR = `OMA_${SUFIXO}`;
const HOJE = hojeLisboaISO();

type Conta = { email: string; password: string; id: string };

let centroId: string;
let admin: Conta;
let secretaria: Conta;
let prof1: Conta;
let prof2: Conta;
let disciplina1Id: number;
let disciplina2Id: number;

let alunoA: Conta, alunoB: Conta, alunoC: Conta, alunoD: Conta, alunoE: Conta, alunoF: Conta;
let serieA1Id: string, serieA2Id: string, serieBId: string, serieCId: string, serieDId: string, serieFId: string;
let examAId: string;

let labelProximaSessaoAlunoA = '';

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
  const email = `aluno-oma-${sufixo}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centroId });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-oma-${sufixo}@zzteste.invalid`,
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

/** Cria uma série fixa pelo próprio professor (p_professor = o seu próprio id) e devolve o id da série, identificada pelo dia_semana único usado como impressão digital. */
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

/**
 * Define o estado de uma sessão de uma fixa numa data (data_serie) — para
 * datas dentro da janela que o gerador automático de sessões (corrido por
 * detrás de criar_serie_explicacao/gerar_sessoes_series) já preenche a
 * partir de hoje, a linha JÁ EXISTE (índice único por serie_id+data_serie
 * não deixaria inserir outra); por isso procura primeiro e ATUALIZA se
 * já existir, só insere do zero quando não existe (datas no passado, antes
 * de data_inicio, onde o gerador nunca cria nada). Sessões soltas
 * (serieId null) são sempre inseridas — nunca pré-geradas.
 */
async function inserirSessao(opts: {
  serieId: string | null; professorId: string; disciplinaId: number; alunoId: string;
  data: string; horaInicio?: string; dado: boolean; estado?: string; horasDadas?: number; notas?: string;
}): Promise<string> {
  const campos = { dado: opts.dado, estado: opts.estado ?? 'ativa', horas_dadas: opts.horasDadas ?? null, notas: opts.notas ?? null };

  if (opts.serieId) {
    const { data: existente, error: errBusca } = await supabaseAdmin
      .from('explicacoes').select('id').eq('serie_id', opts.serieId).eq('data_serie', opts.data).maybeSingle();
    if (errBusca) throw new Error(`procurar sessão gerada: ${errBusca.message}`);
    if (existente) {
      const { error: errUpdate } = await supabaseAdmin.from('explicacoes').update(campos).eq('id', existente.id);
      if (errUpdate) throw new Error(`atualizar sessão gerada: ${errUpdate.message}`);
      const { data: jaAssociado } = await supabaseAdmin
        .from('explicacoes_alunos').select('id').eq('explicacao_id', existente.id).eq('aluno_id', opts.alunoId).maybeSingle();
      if (!jaAssociado) {
        const { error: errAlunos } = await supabaseAdmin.from('explicacoes_alunos').insert({ explicacao_id: existente.id, aluno_id: opts.alunoId });
        if (errAlunos) throw new Error(`associar aluno à sessão gerada: ${errAlunos.message}`);
      }
      return existente.id;
    }
  }

  const { data: row, error } = await supabaseAdmin.from('explicacoes').insert({
    centro_id: centroId, professor_id: opts.professorId, disciplina_id: opts.disciplinaId,
    serie_id: opts.serieId, data: opts.data, hora_inicio: opts.horaInicio ?? '08:00:00',
    // explicacoes_serie_coerente: check ((serie_id is null) = (data_serie is
    // null)) — os dois juntos ou nenhum.
    data_serie: opts.serieId ? opts.data : null,
    duracao_prevista_horas: opts.serieId ? 1 : null,
    ...campos,
  }).select('id').single();
  if (error) throw new Error(`criar sessão: ${error.message}`);
  const { error: errAlunos } = await supabaseAdmin.from('explicacoes_alunos').insert({ explicacao_id: row.id, aluno_id: opts.alunoId });
  if (errAlunos) throw new Error(`associar aluno à sessão: ${errAlunos.message}`);
  return row.id;
}

test.describe.configure({ mode: 'serial' });

test.describe('Os Meus Alunos (professores) — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE OsMeusAlunos'],
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

    const { data: d1, error: errD1 } = await supabaseAdmin.from('subjects').insert({ name: `Disciplina Um ${MARCADOR}`, centro_id: centroId }).select('id').single();
    if (errD1) throw new Error(`criar disciplina1: ${errD1.message}`);
    disciplina1Id = d1.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplina1Id));

    const { data: d2, error: errD2 } = await supabaseAdmin.from('subjects').insert({ name: `Disciplina Dois ${MARCADOR}`, centro_id: centroId }).select('id').single();
    if (errD2) throw new Error(`criar disciplina2: ${errD2.message}`);
    disciplina2Id = d2.id;
    limpeza.push(() => supabaseAdmin.from('subjects').delete().eq('id', disciplina2Id));

    alunoA = await criarAluno(`Aluno A ${MARCADOR}`);
    alunoB = await criarAluno(`Aluno B ${MARCADOR}`);
    alunoC = await criarAluno(`Aluno C ${MARCADOR}`);
    alunoD = await criarAluno(`Aluno D ${MARCADOR}`);
    alunoE = await criarAluno(`Aluno E ${MARCADOR}`);
    alunoF = await criarAluno(`Aluno F ${MARCADOR}`);

    // A tabela explicacoes tem uma restrição (explicacoes_serie_coerente)
    // que exige que uma sessão ligada a uma série caia no MESMO dia da
    // semana (e à mesma hora) da série — por isso todas as datas usadas
    // abaixo para sessões de A e de B são sempre múltiplos de 7 dias a
    // partir da data em que a série "nasce" (mantém o mesmo dia da semana).
    // dia_semana é a "impressão digital" usada para encontrar cada série
    // logo depois de a criar (ver criarSerieComo) — tem de ser único por
    // professor, por isso nunca valores fixos: derivados do dia da semana
    // real de hoje (diaSemanaA), para nunca colidirem por coincidência com
    // o dia da semana real que as sessões de A e de B têm de respeitar.
    const diaSemanaA = diaSemanaDeData(HOJE);
    const semanaK = (k: number) => ((diaSemanaA - 1 + k) % 7) + 1;
    const diaSemanaB1 = semanaK(1); // mesmo valor de diaSemanaDeData(HOJE + 1 dia)

    // Fixas: A tem DUAS (disciplinas diferentes — um só cartão, disciplinas
    // juntas); B tem uma; C vai ser recusada; D vai terminar no passado; F é
    // do prof2 (isolamento). E fica sem nenhuma fixa (só sessão solta).
    serieA1Id = await criarSerieComo(prof1, diaSemanaA, disciplina1Id, alunoA.id);
    serieBId = await criarSerieComo(prof1, diaSemanaB1, disciplina1Id, alunoB.id);
    serieA2Id = await criarSerieComo(prof1, semanaK(2), disciplina2Id, alunoA.id);
    serieCId = await criarSerieComo(prof1, semanaK(3), disciplina1Id, alunoC.id);
    serieDId = await criarSerieComo(prof1, semanaK(4), disciplina1Id, alunoD.id, adicionarDias(HOJE, -30));
    serieFId = await criarSerieComo(prof2, semanaK(5), disciplina1Id, alunoF.id);

    const { error: errRecusar } = await supabaseAdmin.from('series_explicacoes').update({ estado_validacao: 'recusada' }).eq('id', serieCId);
    if (errRecusar) throw new Error(`recusar série C: ${errRecusar.message}`);
    const { error: errTerminar } = await supabaseAdmin.from('series_explicacoes').update({ data_fim: adicionarDias(HOJE, -1) }).eq('id', serieDId);
    if (errTerminar) throw new Error(`terminar série D: ${errTerminar.message}`);

    // Aluno A: próxima sessão ativa a +14 dias; uma CANCELADA a +7 dias (tem
    // de ser ignorada — a próxima sessão certa é a de +14, não a de +7);
    // última nota = a mais recente (hoje), não a antiga (-49).
    await inserirSessao({ serieId: serieA1Id, professorId: prof1.id, disciplinaId: disciplina1Id, alunoId: alunoA.id, data: adicionarDias(HOJE, 7), dado: false, estado: 'cancelada' });
    await inserirSessao({ serieId: serieA1Id, professorId: prof1.id, disciplinaId: disciplina1Id, alunoId: alunoA.id, data: adicionarDias(HOJE, 14), dado: false, estado: 'ativa' });
    await inserirSessao({ serieId: serieA1Id, professorId: prof1.id, disciplinaId: disciplina1Id, alunoId: alunoA.id, data: adicionarDias(HOJE, -49), dado: true, horasDadas: 1, notas: `Nota antiga sobre A ${MARCADOR}` });
    await inserirSessao({ serieId: serieA1Id, professorId: prof1.id, disciplinaId: disciplina1Id, alunoId: alunoA.id, data: HOJE, dado: true, horasDadas: 1.5, notas: `Nota recente sobre A ${MARCADOR}` });

    // 25 sessões de preenchimento, bem fora do mês atual e sempre no mesmo
    // dia da semana de A (múltiplos de 7, de -70 a -238 dias), só para o
    // "Ver mais" do histórico ter de facto mais de 20 linhas.
    const linhasBulk = Array.from({ length: 25 }, (_, i) => {
      const data = adicionarDias(HOJE, -7 * (10 + i));
      return {
        centro_id: centroId, professor_id: prof1.id, disciplina_id: disciplina1Id, serie_id: serieA1Id,
        data, data_serie: data, hora_inicio: '08:00:00', duracao_prevista_horas: 1, dado: true, estado: 'ativa', horas_dadas: 1, notas: `Sessao historica ${i} ${MARCADOR}`,
      };
    });
    const { data: bulkInseridas, error: errBulk } = await supabaseAdmin.from('explicacoes').insert(linhasBulk).select('id');
    if (errBulk) throw new Error(`criar sessões em lote: ${errBulk.message}`);
    const { error: errBulkAlunos } = await supabaseAdmin
      .from('explicacoes_alunos').insert((bulkInseridas || []).map((r: any) => ({ explicacao_id: r.id, aluno_id: alunoA.id })));
    if (errBulkAlunos) throw new Error(`associar sessões em lote: ${errBulkAlunos.message}`);

    // Aluno B: próxima sessão ativa a +1 dia (mais próxima do que a de A, que
    // é a +14 dias depois de ignorar a cancelada) — ordenação.
    await inserirSessao({ serieId: serieBId, professorId: prof1.id, disciplinaId: disciplina1Id, alunoId: alunoB.id, data: adicionarDias(HOJE, 1), dado: false, estado: 'ativa' });

    // Aluno E: sessão solta (sem série) com o prof1 — tem de ficar fora da
    // lista apesar de ter uma sessão real marcada.
    await inserirSessao({ serieId: null, professorId: prof1.id, disciplinaId: disciplina1Id, alunoId: alunoE.id, data: adicionarDias(HOJE, 1), horaInicio: '09:00:00', dado: false, estado: 'ativa' });

    // Aluno A: um exame que vai ser mutado ao longo do teste (b) para testar
    // hoje / amanhã / 7 dias (âmbar) / 8 dias (neutro).
    const { data: examA, error: errExamA } = await supabaseAdmin.from('exams').insert({
      aluno_id: alunoA.id, subject_name: `Teste Marcador ${MARCADOR}`, date: HOJE, centro_id: centroId,
    }).select('id').single();
    if (errExamA) throw new Error(`criar exame de A: ${errExamA.message}`);
    examAId = examA.id;

    // Aluno B: um teste confirmado (mostra valor) e um reportado pelo aluno,
    // não confirmado (mostra "Por confirmar", sem valor) — teste (e).
    const { error: errExamBConfirmado } = await supabaseAdmin.from('exams').insert({
      aluno_id: alunoB.id, subject_name: `Teste Confirmado ${MARCADOR}`, date: adicionarDias(HOJE, -5), centro_id: centroId,
      nota_valor: 15, nota_escala: '20', nota_confirmada: true, nota_reportada_por: prof1.id,
    });
    if (errExamBConfirmado) throw new Error(`criar exame confirmado de B: ${errExamBConfirmado.message}`);
    const { error: errExamBPorConfirmar } = await supabaseAdmin.from('exams').insert({
      aluno_id: alunoB.id, subject_name: `Teste Por Confirmar ${MARCADOR}`, date: adicionarDias(HOJE, -3), centro_id: centroId,
      nota_valor: 12, nota_escala: '20', nota_confirmada: false, nota_reportada_por: alunoB.id,
    });
    if (errExamBPorConfirmar) throw new Error(`criar exame por confirmar de B: ${errExamBPorConfirmar.message}`);
  });

  test.afterAll(async () => {
    test.setTimeout(90_000);
    if (centroId) {
      // Independentes entre si — em paralelo para o afterAll nunca se
      // aproximar do timeout de hook por omissão (30s).
      await Promise.all([
        supabaseAdmin.from('notas_privadas_professor').delete().eq('centro_id', centroId),
        supabaseAdmin.from('exams').delete().eq('centro_id', centroId),
        // Gatilho de auditoria: qualquer update() a explicacoes (ver
        // inserirSessao, que atualiza sessões já geradas) grava uma linha
        // aqui — apagar-centro.mjs ainda não a conhece.
        supabaseAdmin.from('explicacoes_alteracoes').delete().eq('centro_id', centroId),
      ]);
      const { data: seriesDoCentro } = await supabaseAdmin.from('series_explicacoes').select('id').eq('centro_id', centroId);
      const idsSeries = (seriesDoCentro || []).map((s: any) => s.id);
      const { data: explicacoesDoCentro } = await supabaseAdmin.from('explicacoes').select('id').eq('centro_id', centroId);
      const idsExplicacoes = (explicacoesDoCentro || []).map((e: any) => e.id);
      await Promise.all([
        idsSeries.length > 0 ? supabaseAdmin.from('series_explicacoes_alunos').delete().in('serie_id', idsSeries) : null,
        idsSeries.length > 0 ? supabaseAdmin.from('series_explicacoes_pausas').delete().in('serie_id', idsSeries) : null,
        idsExplicacoes.length > 0 ? supabaseAdmin.from('explicacoes_alunos').delete().in('explicacao_id', idsExplicacoes) : null,
      ]);
      await supabaseAdmin.from('explicacoes').delete().eq('centro_id', centroId);
      if (idsSeries.length > 0) {
        await supabaseAdmin.from('series_explicacoes').delete().in('id', idsSeries);
      }
    }
    await Promise.all([...limpeza].map((passo) => Promise.resolve(passo()).catch(() => {})));
    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    expect(restoConfig ?? []).toHaveLength(0);
  });

  test('(a)(c) lista: só os fixos ativos de prof1, um cartão por aluno, ordenados pela próxima sessão (ignorando canceladas), última nota correta', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/os-meus-alunos`, { waitUntil: 'networkidle' });

    const cartoes = page.locator('[data-cartao-aluno-fixo]');
    await expect(cartoes).toHaveCount(2, { timeout: 15_000 });

    // Ordem: B (próxima sessão a +1 dia) antes de A (a +2 dias, ignorando a
    // cancelada a +1 dia).
    await expect(cartoes.nth(0)).toHaveAttribute('data-cartao-aluno-fixo', alunoB.id);
    await expect(cartoes.nth(1)).toHaveAttribute('data-cartao-aluno-fixo', alunoA.id);

    // C (recusada), D (terminada), E (solta) e F (de outro professor) nunca aparecem.
    await expect(page.locator(`[data-cartao-aluno-fixo="${alunoC.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-cartao-aluno-fixo="${alunoD.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-cartao-aluno-fixo="${alunoE.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-cartao-aluno-fixo="${alunoF.id}"]`)).toHaveCount(0);

    const cartaoA = page.locator(`[data-cartao-aluno-fixo="${alunoA.id}"]`);
    // Um só cartão com as duas disciplinas das duas fixas.
    await expect(cartaoA).toContainText(`Disciplina Um ${MARCADOR}`);
    await expect(cartaoA).toContainText(`Disciplina Dois ${MARCADOR}`);
    // Última nota é a mais recente (hoje), nunca a antiga.
    await expect(cartaoA).toContainText(`Nota recente sobre A ${MARCADOR}`);
    await expect(cartaoA).not.toContainText(`Nota antiga sobre A ${MARCADOR}`);

    labelProximaSessaoAlunoA = (await cartaoA.getByText(/Próxima sessão:/).innerText()).trim();
    expect(labelProximaSessaoAlunoA.length).toBeGreaterThan(0);

    await context.close();
  });

  test('(b) etiqueta de teste: hoje, amanhã, 7 dias (âmbar) e 8 dias (neutra)', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);

    const casos: Array<{ data: string; texto: RegExp; ambar: boolean }> = [
      { data: HOJE, texto: /hoje/, ambar: true },
      { data: adicionarDias(HOJE, 1), texto: /amanhã/, ambar: true },
      { data: adicionarDias(HOJE, 7), texto: /em 7 dias/, ambar: true },
      { data: adicionarDias(HOJE, 8), texto: /em 8 dias/, ambar: false },
    ];

    for (const caso of casos) {
      const { error } = await supabaseAdmin.from('exams').update({ date: caso.data }).eq('id', examAId);
      expect(error).toBeNull();

      await page.goto(`${BASE_URL}/admin/os-meus-alunos`, { waitUntil: 'networkidle' });
      const etiqueta = page.locator(`[data-cartao-aluno-fixo="${alunoA.id}"]`).getByText(new RegExp(`Teste de Teste Marcador ${MARCADOR}`));
      await expect(etiqueta).toBeVisible({ timeout: 15_000 });
      await expect(etiqueta).toHaveText(caso.texto);
      const classe = (await etiqueta.getAttribute('class')) || '';
      if (caso.ambar) {
        expect(classe).toContain('warning');
      } else {
        expect(classe).not.toContain('warning');
      }
    }

    await context.close();
  });

  test('(d) detalhe: cabeçalho, 4 separadores, Resumo, e "Ver mais" nas sessões', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/os-meus-alunos/${alunoA.id}`, { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: new RegExp(`Aluno A ${MARCADOR}`) })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Fixo', { exact: true })).toBeVisible();

    for (const nome of ['Resumo', 'Sessões', 'Testes', 'As minhas notas']) {
      await expect(page.getByRole('button', { name: new RegExp(nome) })).toBeVisible();
    }

    // Resumo: este mês tem exatamente 1 sessão dada de 1h30 (a de "hoje").
    await expect(page.getByText(/1 sessão dada, 1 h 30/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`Nota recente sobre A ${MARCADOR}`)).toBeVisible();

    await page.getByRole('button', { name: 'Sessões' }).click();
    await expect(page.getByText('Histórico')).toBeVisible();
    // 27 sessões dadas no total (25 em lote + antiga + recente) — a primeira
    // página mostra exatamente 20, com "Ver mais" visível.
    const linhasHistorico = page.locator('[data-sessao-historico]');
    await expect(linhasHistorico).toHaveCount(20, { timeout: 15_000 });
    const botaoVerMais = page.getByRole('button', { name: 'Ver mais' });
    await expect(botaoVerMais).toBeVisible();

    await botaoVerMais.click();
    await expect(linhasHistorico).toHaveCount(27, { timeout: 15_000 });
    await expect(botaoVerMais).toHaveCount(0);

    await context.close();
  });

  test('(e) nota de teste: só mostra o valor se confirmada; por confirmar não mostra valor', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/os-meus-alunos/${alunoB.id}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Testes' }).click();
    await expect(page.locator('[data-teste-exam]').first()).toBeVisible({ timeout: 15_000 });

    const linhaConfirmada = page.locator('[data-teste-exam]', { has: page.getByText('Teste Confirmado', { exact: false }) });
    await expect(linhaConfirmada.getByText('15/20')).toBeVisible();

    const linhaPorConfirmar = page.locator('[data-teste-exam]', { has: page.getByText('Teste Por Confirmar', { exact: false }) });
    await expect(linhaPorConfirmar.getByText('Por confirmar', { exact: true })).toBeVisible();
    await expect(linhaPorConfirmar.getByText('12/20')).toHaveCount(0);

    await context.close();
  });

  test('(f) caderno privado: guarda, atualiza sem duplicar, persiste, e só o professor dono lê/escreve', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/os-meus-alunos/${alunoA.id}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'As minhas notas' }).click();

    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 15_000 });
    await textarea.fill(`Primeira nota privada ${MARCADOR}`);
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Caderno guardado.')).toBeVisible({ timeout: 15_000 });

    await textarea.fill(`Nota privada atualizada ${MARCADOR}`);
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Caderno guardado.')).toBeVisible({ timeout: 15_000 });

    // Sem duplicar a linha (única por professor+aluno).
    const { data: linhasCaderno, error: errLinhas } = await supabaseAdmin
      .from('notas_privadas_professor').select('id, texto').eq('professor_id', prof1.id).eq('aluno_id', alunoA.id);
    expect(errLinhas).toBeNull();
    expect(linhasCaderno?.length).toBe(1);
    expect(linhasCaderno![0].texto).toBe(`Nota privada atualizada ${MARCADOR}`);

    // Persiste ao recarregar.
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'As minhas notas' }).click();
    await expect(page.locator('textarea')).toHaveValue(`Nota privada atualizada ${MARCADOR}`, { timeout: 15_000 });

    // RLS: prof2, admin, secretaria e o próprio aluno recebem 0 linhas numa
    // consulta direta à tabela (nunca passando pela UI).
    for (const conta of [prof2, admin, secretaria, alunoA]) {
      const cliente = await sessaoComo(conta);
      const { data, error } = await cliente.from('notas_privadas_professor').select('id').eq('professor_id', prof1.id).eq('aluno_id', alunoA.id);
      if (!error) expect(data ?? []).toHaveLength(0);
    }

    await context.close();
  });

  test('(g) isolamento: prof2 não abre o detalhe de um aluno fixo do prof1', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof2.email, prof2.password);
    await page.goto(`${BASE_URL}/admin/os-meus-alunos/${alunoA.id}`, { waitUntil: 'networkidle' });

    await expect(page.getByText('Este aluno não está nas tuas explicações fixas.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Fixo', { exact: true })).toHaveCount(0);

    await context.close();
  });

  test('(h) admin e secretaria: sem o item no menu; secretaria bloqueada na rota; admin abre por URL direta e vê a lista vazia', async ({ browser }: { browser: Browser }) => {
    const contextSecretaria = await browser.newContext();
    const pageSecretaria = await contextSecretaria.newPage();
    await loginUI(pageSecretaria, secretaria.email, secretaria.password);
    await pageSecretaria.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    await expect(pageSecretaria.locator('a', { hasText: 'Os Meus Alunos' })).toHaveCount(0);

    await pageSecretaria.goto(`${BASE_URL}/admin/os-meus-alunos`, { waitUntil: 'networkidle' });
    await expect(pageSecretaria).toHaveURL(`${BASE_URL}/admin`, { timeout: 15_000 });
    await contextSecretaria.close();

    const contextAdmin = await browser.newContext();
    const pageAdmin = await contextAdmin.newPage();
    await loginUI(pageAdmin, admin.email, admin.password);
    await pageAdmin.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
    await expect(pageAdmin.locator('a', { hasText: 'Os Meus Alunos' })).toHaveCount(0);

    await pageAdmin.goto(`${BASE_URL}/admin/os-meus-alunos`, { waitUntil: 'networkidle' });
    await expect(pageAdmin).toHaveURL(`${BASE_URL}/admin/os-meus-alunos`);
    await expect(pageAdmin.getByText('Ainda não tens alunos fixos.')).toBeVisible({ timeout: 15_000 });
    await contextAdmin.close();
  });

  test('(i) realce "Fixo" em Nova Explicação: só para o professor, fixos primeiro', async ({ browser }: { browser: Browser }) => {
    const contextProf = await browser.newContext();
    const pageProf = await contextProf.newPage();
    await loginUI(pageProf, prof1.email, prof1.password);
    await pageProf.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    await pageProf.getByRole('button', { name: 'Nova Explicação' }).click();

    const listaAlunos = pageProf.locator('.max-h-40');
    const selosFixo = listaAlunos.getByText('Fixo', { exact: true });
    await expect(selosFixo.first()).toBeVisible({ timeout: 15_000 });
    await expect(selosFixo).toHaveCount(2); // alunoA e alunoB, nunca C/D (não são fixos ativos)

    // textContent (não innerText) — o selo usa text-transform:uppercase só
    // na apresentação ("FIXO" visível), o texto real no DOM é "Fixo".
    const botoes = listaAlunos.locator('button');
    const primeiroNome = await botoes.nth(0).textContent();
    const segundoNome = await botoes.nth(1).textContent();
    expect(primeiroNome).toContain('Fixo');
    expect(segundoNome).toContain('Fixo');

    await contextProf.close();

    const contextAdmin = await browser.newContext();
    const pageAdmin = await contextAdmin.newPage();
    await loginUI(pageAdmin, admin.email, admin.password);
    await pageAdmin.goto(`${BASE_URL}/admin/explicacoes`, { waitUntil: 'networkidle' });
    await pageAdmin.locator('select').first().selectOption({ label: `Prof Um ${MARCADOR}` });
    await pageAdmin.getByRole('button', { name: 'Nova Explicação' }).click();
    await expect(pageAdmin.locator('.max-h-40').getByText('Fixo', { exact: true })).toHaveCount(0, { timeout: 15_000 });
    await contextAdmin.close();
  });

  test('(j) fuso de Lisboa independente do fuso do browser (Pacific/Auckland)', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext({ timezoneId: 'Pacific/Auckland' });
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);
    await page.goto(`${BASE_URL}/admin/os-meus-alunos`, { waitUntil: 'networkidle' });

    const cartoes = page.locator('[data-cartao-aluno-fixo]');
    await expect(cartoes).toHaveCount(2, { timeout: 15_000 });
    await expect(cartoes.nth(0)).toHaveAttribute('data-cartao-aluno-fixo', alunoB.id);
    await expect(cartoes.nth(1)).toHaveAttribute('data-cartao-aluno-fixo', alunoA.id);

    const cartaoA = page.locator(`[data-cartao-aluno-fixo="${alunoA.id}"]`);
    const labelAgora = (await cartaoA.getByText(/Próxima sessão:/).innerText()).trim();
    expect(labelAgora).toBe(labelProximaSessaoAlunoA);

    // Deixado em "8 dias, neutro" pelo teste (b) — tem de continuar assim
    // mesmo com o browser 12-13h adiantado em relação a Lisboa.
    const etiquetaTeste = cartaoA.getByText(new RegExp(`Teste de Teste Marcador ${MARCADOR}`));
    await expect(etiquetaTeste).toHaveText(/em 8 dias/);
    const classe = (await etiquetaTeste.getAttribute('class')) || '';
    expect(classe).not.toContain('warning');

    await context.close();
  });

  test('(k) larguras móveis (360, 390, 430) sem scroll horizontal', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginUI(page, prof1.email, prof1.password);

    for (const largura of [360, 390, 430]) {
      await page.setViewportSize({ width: largura, height: 800 });

      await page.goto(`${BASE_URL}/admin/os-meus-alunos`, { waitUntil: 'networkidle' });
      const semScrollLista = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(semScrollLista, `lista sem scroll horizontal a ${largura}px`).toBe(true);

      await page.goto(`${BASE_URL}/admin/os-meus-alunos/${alunoA.id}`, { waitUntil: 'networkidle' });
      const semScrollDetalhe = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(semScrollDetalhe, `detalhe sem scroll horizontal a ${largura}px`).toBe(true);
    }

    await context.close();
  });
});
