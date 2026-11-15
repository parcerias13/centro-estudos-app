import { test, expect, type Page, type Browser } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import path from 'node:path';
import os from 'node:os';

dotenv.config({ path: '.env.local' });

// NIF, morada e mensalidade base do encarregado passam a viver em
// alunos_faturacao (aluno_id PK/FK para alunos com ON DELETE CASCADE,
// centro_id, mensalidade_base numeric >= 0 default 0, nif_encarregado,
// morada_encarregado, updated_at), com RLS a restringir leitura/escrita ao
// admin/secretaria do próprio centro e leitura só da própria linha ao
// aluno/encarregado. As colunas antigas em `alunos` já foram removidas da
// base de dados. Um aluno sem linha em alunos_faturacao é tratado como
// mensalidade 0 e NIF/morada vazios, nunca um erro. Isolado num centro
// ZZTESTE próprio (e um segundo centro ZZTESTE só para os testes de
// isolamento), ambos apagados no fim. Cada teste de UI abre o seu próprio
// browser context (cada login troca de papel) — nunca reaproveita uma
// sessão entre papéis diferentes.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const SUFIXO = String(Date.now());

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Conta = { email: string; password: string; id: string };
type AlunoConta = Conta & { nome: string };

let centroId: string;
let outroCentroId: string;
let admin: Conta;
let secretaria: Conta;
let professor: Conta;
let outroAdmin: Conta;
let outroAluno: AlunoConta;
const limpeza: Array<() => unknown> = [];

async function criarUtilizadorAuth(email: string, password: string, appMetadata: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`criar utilizador ${email}: ${error.message}`);
  const id = data.user.id;
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: appMetadata });
  if (metaError) throw new Error(`app_metadata ${email}: ${metaError.message}`);
  return id;
}

async function criarStaff(papel: string, nome: string, centro: string): Promise<Conta> {
  const email = `${nome.toLowerCase().replace(/\s+/g, '-')}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { role: papel, centro_id: centro });
  const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: nome, role: papel, centro_id: centro });
  if (error) throw new Error(`criar staff ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
  return { email, password, id };
}

// Insere diretamente em `alunos`, SEM nenhuma linha em alunos_faturacao —
// é exatamente o estado "ainda não editado"/"legado" que o código novo tem
// de aguentar sem partir.
async function criarAlunoDireto(nome: string, sufixo: string, centro: string): Promise<AlunoConta> {
  const email = `aluno-${sufixo}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { centro_id: centro });
  const { error } = await supabaseAdmin.from('alunos').insert({
    id, nome, email, email_encarregado: `enc-${sufixo}-${SUFIXO}@zzteste.invalid`,
    telefone_encarregado: '912999000',
    data_nascimento: '2012-01-01', ano_escolar: 8, centro_id: centro, ativo: true,
    sala_estudo: true, faz_explicacoes: false,
  });
  if (error) throw new Error(`criar aluno ${nome}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', id));
  return { id, email, password, nome };
}

async function sessaoComo(conta: Conta) {
  const cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await cliente.auth.signInWithPassword({ email: conta.email, password: conta.password });
  if (error) throw new Error(`login ${conta.email}: ${error.message}`);
  return cliente;
}

async function loginUI(p: Page, identificador: string, password: string) {
  await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="identificador"]', identificador);
  await p.fill('input[type="password"]', password);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

// Abre um browser context novo, faz login como `conta`, corre `acao`, e
// fecha o context no fim (mesmo que `acao` lance) — nunca reaproveita
// cookies/sessão entre testes ou entre papéis diferentes.
async function comSessaoUI(browser: Browser, conta: { email: string; password: string }, acao: (p: Page) => Promise<void>) {
  const context = await browser.newContext();
  const p = await context.newPage();
  p.on('dialog', (dialog) => dialog.accept());
  try {
    await loginUI(p, conta.email, conta.password);
    await acao(p);
  } finally {
    await context.close();
  }
}

async function abrirEditar(p: Page, alunoId: string) {
  await p.goto(`${BASE_URL}/admin/alunos/editar?id=${alunoId}`, { waitUntil: 'networkidle' });
  await expect(p.getByPlaceholder('0.00')).toBeVisible({ timeout: 10_000 });
}

async function preencherFaturacaoEGravar(p: Page, dados: { nif: string; morada: string; mensalidade: string }) {
  await p.fill('input[placeholder="Ex: 123456789"]', dados.nif);
  await p.fill('input[placeholder="Rua Exemplo, 123, Porto"]', dados.morada);
  await p.fill('input[placeholder="0.00"]', dados.mensalidade);
  await p.getByRole('button', { name: /gravar alterações/i }).click();
  await expect(p).toHaveURL(/\/admin\/alunos$/, { timeout: 20_000 });
}

async function gerarXlsxUmAluno(nome: string, mensalidade: number, nif: string, morada: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Alunos');
  sheet.addRow(['Nome*', 'Data Nascimento', 'Ano Escolar*', 'Mensalidade Base*', 'Nome de Utilizador do Aluno', 'Email Encarregado', 'Telefone Encarregado', 'Telemovel Aluno', 'Dias Semana', 'Saida Autorizada', 'Usa App', 'NIF Encarregado', 'Morada Encarregado', 'Modalidade']);
  sheet.addRow([nome, '', 6, mensalidade, '', `mae.${nome.toLowerCase().replace(/\s+/g, '')}@example.invalid`, '912100099', '', '', 'sim', 'sim', nif, morada, '']);
  const caminho = path.join(os.tmpdir(), `zzteste-alunosfaturacao-${SUFIXO}-${randomInt(0, 1_000_000)}.xlsx`);
  await wb.xlsx.writeFile(caminho);
  return caminho;
}

test.describe.configure({ mode: 'serial' });

test.describe('NIF, morada e mensalidade base em alunos_faturacao — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE AlunosFaturacao ${SUFIXO}`, email_remetente: `zzteste-alunosfaturacao-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    admin = await criarStaff('admin', `Admin AlunosFaturacao ${SUFIXO}`, centroId);
    secretaria = await criarStaff('secretaria', `Secretaria AlunosFaturacao ${SUFIXO}`, centroId);
    professor = await criarStaff('professor', `Professor AlunosFaturacao ${SUFIXO}`, centroId);

    const { data: outroCentro, error: outroCentroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Outro AlunosFaturacao ${SUFIXO}`, email_remetente: `zzteste-outro-alunosfaturacao-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (outroCentroError) throw new Error(`criar outro centro: ${outroCentroError.message}`);
    outroCentroId = outroCentro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', outroCentroId));
    outroAdmin = await criarStaff('admin', `Admin OutroCentro AlunosFaturacao ${SUFIXO}`, outroCentroId);
    outroAluno = await criarAlunoDireto(`Aluno OutroCentro AlunosFaturacao ${SUFIXO}`, 'outro-aluno', outroCentroId);
  });

  test.afterAll(async () => {
    const { data: alunosParaApagar } = await supabaseAdmin.from('alunos').select('id').in('centro_id', [centroId, outroCentroId]);
    for (const a of alunosParaApagar || []) {
      await supabaseAdmin.auth.admin.deleteUser(a.id).catch(() => {});
    }
    await supabaseAdmin.from('alunos').delete().in('centro_id', [centroId, outroCentroId]);
    for (const passo of [...limpeza].reverse()) {
      try {
        const resultado: any = await Promise.resolve(passo());
        if (resultado?.error) console.warn('limpeza: passo com erro (não fatal):', resultado.error.message);
      } catch (err: any) {
        console.warn('limpeza: passo lançou (não fatal):', err?.message);
      }
    }
  });

  // --- 1/2. Admin e secretaria editam pela UI ---
  test('admin edita mensalidade, NIF e morada pela UI: ficam em alunos_faturacao com o centro certo', async ({ browser }) => {
    const alunoAdmin = await criarAlunoDireto(`Aluno Editado Admin ${SUFIXO}`, 'edit-admin', centroId);

    await comSessaoUI(browser, admin, async (p) => {
      await abrirEditar(p, alunoAdmin.id);
      await preencherFaturacaoEGravar(p, { nif: '123456789', morada: 'Rua do Admin, 1, Lisboa', mensalidade: '75' });
    });

    const { data: faturacao, error: errFaturacao } = await supabaseAdmin
      .from('alunos_faturacao')
      .select('centro_id, mensalidade_base, nif_encarregado, morada_encarregado')
      .eq('aluno_id', alunoAdmin.id)
      .single();
    expect(errFaturacao).toBeNull();
    expect(faturacao!.centro_id).toBe(centroId);
    expect(Number(faturacao!.mensalidade_base)).toBe(75);
    expect(faturacao!.nif_encarregado).toBe('123456789');
    expect(faturacao!.morada_encarregado).toBe('Rua do Admin, 1, Lisboa');
  });

  test('secretaria edita mensalidade, NIF e morada pela UI e consegue', async ({ browser }) => {
    const alunoSecretaria = await criarAlunoDireto(`Aluno Editado Secretaria ${SUFIXO}`, 'edit-secretaria', centroId);

    await comSessaoUI(browser, secretaria, async (p) => {
      await abrirEditar(p, alunoSecretaria.id);
      await preencherFaturacaoEGravar(p, { nif: '987654321', morada: 'Rua da Secretaria, 2, Porto', mensalidade: '60' });
    });

    const { data: faturacao } = await supabaseAdmin
      .from('alunos_faturacao')
      .select('centro_id, mensalidade_base, nif_encarregado, morada_encarregado')
      .eq('aluno_id', alunoSecretaria.id)
      .single();
    expect(faturacao!.centro_id).toBe(centroId);
    expect(Number(faturacao!.mensalidade_base)).toBe(60);
    expect(faturacao!.nif_encarregado).toBe('987654321');
    expect(faturacao!.morada_encarregado).toBe('Rua da Secretaria, 2, Porto');
  });

  // --- 3. Professor: nunca recebe estas colunas no browser; nem lê nem escreve alunos_faturacao ---
  test('professor: a lista e a ficha de alunos nunca trazem mensalidade_base/nif_encarregado/morada_encarregado nas respostas; alunos_faturacao não dá linhas nem aceita escrita', async ({ browser }) => {
    const alunoVisivel = await criarAlunoDireto(`Aluno Visivel Professor ${SUFIXO}`, 'prof-visivel', centroId);
    await supabaseAdmin.from('alunos_faturacao').upsert(
      { aluno_id: alunoVisivel.id, centro_id: centroId, mensalidade_base: 55, nif_encarregado: '111222333', morada_encarregado: 'Rua Secreta, 9' },
      { onConflict: 'aluno_id' }
    );

    const respostasSensiveis: string[] = [];
    const respostasAlunosComCiclo: string[] = [];

    await comSessaoUI(browser, professor, async (p) => {
      const ouvinte = async (response: any) => {
        const url = response.url();
        let caminho: string;
        try { caminho = new URL(url).pathname; } catch { return; }
        if (caminho === '/rest/v1/alunos') {
          try {
            const corpo = await response.text();
            if (corpo.includes('mensalidade_base') || corpo.includes('nif_encarregado') || corpo.includes('morada_encarregado')) {
              respostasSensiveis.push(corpo);
            }
          } catch { /* corpo não textual — ignora */ }
        }
        if (caminho === '/rest/v1/alunos_com_ciclo') {
          respostasAlunosComCiclo.push(url);
        }
      };
      p.on('response', ouvinte);

      // /admin (dashboard, sempre permitido a qualquer papel) também lê
      // `alunos` — não está na lista de ecrãs do plano original, mas tem o
      // mesmo risco: confirma-se aqui também.
      await p.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle' });
      await p.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });
      await expect(p.getByText(alunoVisivel.nome)).toBeVisible({ timeout: 15_000 });
      await p.goto(`${BASE_URL}/admin/alunos/ficha?id=${alunoVisivel.id}`, { waitUntil: 'networkidle' });
      await expect(p.getByText(alunoVisivel.nome)).toBeVisible({ timeout: 15_000 });

      p.off('response', ouvinte);
    });

    expect(respostasSensiveis).toHaveLength(0);
    for (const url of respostasAlunosComCiclo) {
      expect(url).not.toContain('mensalidade_base');
    }

    const alunoSemLinha = await criarAlunoDireto(`Aluno Professor SemLinha ${SUFIXO}`, 'prof-semlinha', centroId);

    const sessaoProfessor = await sessaoComo(professor);
    const { data: lido, error: errLeitura } = await sessaoProfessor.from('alunos_faturacao').select('aluno_id').eq('centro_id', centroId);
    expect(errLeitura).toBeNull();
    expect(lido ?? []).toHaveLength(0);

    // INSERT bloqueado pela RLS devolve sempre um erro real (WITH CHECK a
    // falhar never filtra em silêncio, ao contrário de SELECT/UPDATE/DELETE).
    const { data: dadosInsercao, error: errInsercao } = await sessaoProfessor
      .from('alunos_faturacao')
      .insert({ aluno_id: alunoSemLinha.id, centro_id: centroId, mensalidade_base: 1 })
      .select();
    expect(errInsercao).not.toBeNull();
    expect(errInsercao?.code).toBe('42501');
    expect(dadosInsercao).toBeNull();

    const { data: dadosEscrita, error: errEscrita } = await sessaoProfessor
      .from('alunos_faturacao')
      .update({ mensalidade_base: 1 })
      .eq('aluno_id', alunoVisivel.id)
      .select();
    const escritaBloqueada = errEscrita !== null || (dadosEscrita?.length ?? 0) === 0;
    expect(escritaBloqueada).toBe(true);

    const { data: depois } = await supabaseAdmin.from('alunos_faturacao').select('mensalidade_base').eq('aluno_id', alunoVisivel.id).single();
    expect(Number(depois?.mensalidade_base)).toBe(55);
    const { data: aindaSemLinha } = await supabaseAdmin.from('alunos_faturacao').select('aluno_id').eq('aluno_id', alunoSemLinha.id).maybeSingle();
    expect(aindaSemLinha).toBeNull();
  });

  // --- 4. Criação pela UI nasce com linha; sem linha = mensalidade 0, sem crash ---
  test('criar aluno pela UI (admin): nasce com linha em alunos_faturacao com os valores certos', async ({ browser }) => {
    const nome = `Aluno Nova Matricula Faturacao ${SUFIXO}`;

    await comSessaoUI(browser, admin, async (p) => {
      await p.goto(`${BASE_URL}/admin/alunos/novo`, { waitUntil: 'networkidle' });
      await p.locator('input[type="text"]').first().fill(nome);
      await p.locator('select').selectOption('8');
      await p.locator('input[placeholder="Ex: 912345678"]').nth(1).fill('912999010');
      await p.fill('input[placeholder="email@exemplo.com"]', 'mae.novamatriculafaturacao@example.invalid');
      await p.fill('input[placeholder="Ex: 123456789"]', '555666777');
      await p.fill('input[placeholder="Rua Exemplo, 123, Porto"]', 'Avenida Nova, 10, Faro');
      await p.fill('input[placeholder="0.00"]', '99');
      await p.getByRole('button', { name: /finalizar matrícula/i }).click();
      await expect(p.getByText(/matrícula criada/i)).toBeVisible({ timeout: 20_000 });
      await p.getByRole('button', { name: /concluir/i }).click();
    });

    const { data: aluno } = await supabaseAdmin.from('alunos').select('id').eq('centro_id', centroId).eq('nome', nome).single();
    expect(aluno).toBeTruthy();
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(aluno!.id));
    limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', aluno!.id));
    const { data: faturacao } = await supabaseAdmin
      .from('alunos_faturacao')
      .select('centro_id, mensalidade_base, nif_encarregado, morada_encarregado')
      .eq('aluno_id', aluno!.id)
      .single();
    expect(faturacao!.centro_id).toBe(centroId);
    expect(Number(faturacao!.mensalidade_base)).toBe(99);
    expect(faturacao!.nif_encarregado).toBe('555666777');
    expect(faturacao!.morada_encarregado).toBe('Avenida Nova, 10, Faro');
  });

  test('aluno sem linha em alunos_faturacao: extrato mostra mensalidade 0,00€ e não parte nada', async ({ browser }) => {
    const alunoSemLinha = await criarAlunoDireto(`Aluno Sem Linha Faturacao ${SUFIXO}`, 'sem-linha', centroId);

    await comSessaoUI(browser, admin, async (p) => {
      await p.goto(`${BASE_URL}/admin/alunos/extrato?id=${alunoSemLinha.id}`, { waitUntil: 'networkidle' });
      await expect(p.getByText(alunoSemLinha.nome)).toBeVisible({ timeout: 15_000 });
      const blocoMensalidade = p.locator('p', { hasText: 'Mensalidade Base' }).locator('xpath=following-sibling::p');
      await expect(blocoMensalidade).toContainText('0.00€');
    });
  });

  // --- 5. Importação em massa cria a linha ---
  test('importação em massa: cria a linha de faturação com os valores certos', async ({ browser }) => {
    const nome = `Aluno Importado Faturacao ${SUFIXO}`;
    const ficheiro = await gerarXlsxUmAluno(nome, 88, '444555666', 'Travessa Importada, 3, Braga');

    await comSessaoUI(browser, admin, async (p) => {
      await p.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });
      await p.setInputFiles('input[type="file"]', ficheiro);
      await expect(p.getByRole('button', { name: /confirmar importação/i })).toBeVisible({ timeout: 15_000 });
      await p.getByRole('button', { name: /confirmar importação/i }).click();
      await expect(p.getByText(/aluno\(s\) criado\(s\) com sucesso/i)).toBeVisible({ timeout: 20_000 });
      await p.getByRole('button', { name: /concluir/i }).click();
    });

    const { data: aluno } = await supabaseAdmin.from('alunos').select('id').eq('centro_id', centroId).eq('nome', nome).single();
    expect(aluno).toBeTruthy();
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(aluno!.id));
    limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', aluno!.id));
    const { data: faturacao } = await supabaseAdmin
      .from('alunos_faturacao')
      .select('mensalidade_base, nif_encarregado, morada_encarregado')
      .eq('aluno_id', aluno!.id)
      .single();
    expect(Number(faturacao!.mensalidade_base)).toBe(88);
    expect(faturacao!.nif_encarregado).toBe('444555666');
    expect(faturacao!.morada_encarregado).toBe('Travessa Importada, 3, Braga');
  });

  // --- 6. Extrato do admin e exportação mostram os mesmos valores ---
  test('extrato do admin e exportação de faturação mostram os mesmos valores, NIF e morada, vindos de alunos_faturacao', async ({ browser }) => {
    const nome = `Aluno Extrato Export ${SUFIXO}`;
    const aluno = await criarAlunoDireto(nome, 'extrato-export', centroId);
    await supabaseAdmin.from('alunos_faturacao').upsert(
      { aluno_id: aluno.id, centro_id: centroId, mensalidade_base: 45, nif_encarregado: '222333444', morada_encarregado: 'Praça do Extrato, 5, Coimbra' },
      { onConflict: 'aluno_id' }
    );

    await comSessaoUI(browser, admin, async (p) => {
      await p.goto(`${BASE_URL}/admin/alunos/extrato?id=${aluno.id}`, { waitUntil: 'networkidle' });
      await expect(p.getByText(nome)).toBeVisible({ timeout: 15_000 });
      const blocoMensalidade = p.locator('p', { hasText: 'Mensalidade Base' }).locator('xpath=following-sibling::p');
      await expect(blocoMensalidade).toContainText('45.00€');

      await p.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });
      await p.getByRole('button', { name: /exportar faturação/i }).click();
      await p.getByRole('button', { name: /selecionar alunos/i }).click();
      await p.locator('label', { hasText: nome }).locator('input[type="checkbox"]').check();

      const [download] = await Promise.all([
        p.waitForEvent('download'),
        p.getByRole('button', { name: /gerar excel/i }).click(),
      ]);
      const caminhoDescarregado = path.join(os.tmpdir(), `zzteste-export-${SUFIXO}.xlsx`);
      await download.saveAs(caminhoDescarregado);

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(caminhoDescarregado);
      const sheet = wb.getWorksheet('Faturação')!;
      const linha = sheet.getRow(2);
      expect(linha.getCell(1).value).toBe(nome);
      expect(linha.getCell(2).value).toBe('222333444');
      expect(linha.getCell(3).value).toBe('Praça do Extrato, 5, Coimbra');
      expect(Number(linha.getCell(6).value)).toBe(45);
    });
  });

  // --- 7. Sessão do próprio aluno/encarregado ---
  test('o aluno, com a sua sessão, só lê a própria linha em alunos_faturacao, nunca escreve nem apaga; aluno e admin de outro centro não leem nem escrevem', async () => {
    const aluno = await criarAlunoDireto(`Aluno Sessao Propria ${SUFIXO}`, 'sessao-propria', centroId);
    await supabaseAdmin.from('alunos_faturacao').upsert(
      { aluno_id: aluno.id, centro_id: centroId, mensalidade_base: 65, nif_encarregado: null, morada_encarregado: null },
      { onConflict: 'aluno_id' }
    );

    const sessaoAluno = await sessaoComo(aluno);
    const { data: propria, error: errPropria } = await sessaoAluno.from('alunos_faturacao').select('aluno_id, mensalidade_base').eq('aluno_id', aluno.id);
    expect(errPropria).toBeNull();
    expect(propria).toHaveLength(1);
    expect(Number(propria![0].mensalidade_base)).toBe(65);

    // RLS nega em silêncio (0 linhas afetadas), não devolve `error` — os dois
    // contam como bloqueado.
    const { data: dadosUpdate, error: errUpdate } = await sessaoAluno.from('alunos_faturacao').update({ mensalidade_base: 999 }).eq('aluno_id', aluno.id).select();
    expect(errUpdate !== null || (dadosUpdate?.length ?? 0) === 0).toBe(true);
    const { data: dadosDelete, error: errDelete } = await sessaoAluno.from('alunos_faturacao').delete().eq('aluno_id', aluno.id).select();
    expect(errDelete !== null || (dadosDelete?.length ?? 0) === 0).toBe(true);

    const sessaoOutroAluno = await sessaoComo(outroAluno);
    const { data: lidoOutroAluno, error: errOutroAluno } = await sessaoOutroAluno.from('alunos_faturacao').select('aluno_id').eq('aluno_id', aluno.id);
    expect(errOutroAluno).toBeNull();
    expect(lidoOutroAluno ?? []).toHaveLength(0);

    const sessaoOutroAdmin = await sessaoComo(outroAdmin);
    const { data: lidoOutroAdmin, error: errOutroAdmin } = await sessaoOutroAdmin.from('alunos_faturacao').select('aluno_id').eq('aluno_id', aluno.id);
    expect(errOutroAdmin).toBeNull();
    expect(lidoOutroAdmin ?? []).toHaveLength(0);
    const { data: dadosEscritaOutroAdmin, error: errEscritaOutroAdmin } = await sessaoOutroAdmin.from('alunos_faturacao').update({ mensalidade_base: 1 }).eq('aluno_id', aluno.id).select();
    expect(errEscritaOutroAdmin !== null || (dadosEscritaOutroAdmin?.length ?? 0) === 0).toBe(true);

    const { data: depois } = await supabaseAdmin.from('alunos_faturacao').select('mensalidade_base').eq('aluno_id', aluno.id).single();
    expect(Number(depois?.mensalidade_base)).toBe(65);
  });

  // --- 8. Mensalidade negativa recusada ---
  test('mensalidade negativa é recusada no formulário e pela base de dados', async ({ browser }) => {
    const aluno = await criarAlunoDireto(`Aluno Mensalidade Negativa ${SUFIXO}`, 'mensalidade-negativa', centroId);

    await comSessaoUI(browser, admin, async (p) => {
      await abrirEditar(p, aluno.id);
      await p.fill('input[placeholder="0.00"]', '-10');
      await p.getByRole('button', { name: /gravar alterações/i }).click();
      await expect(p.getByText('A mensalidade base não pode ser negativa.')).toBeVisible({ timeout: 10_000 });
      await expect(p).toHaveURL(/\/admin\/alunos\/editar/);
    });

    // O aluno nasce sem linha em alunos_faturacao (criado direto, sem passar
    // pela edição) — o que importa é que a tentativa rejeitada no
    // formulário nunca chega a criar uma com -10.
    const { data: faturacao } = await supabaseAdmin.from('alunos_faturacao').select('mensalidade_base').eq('aluno_id', aluno.id).maybeSingle();
    expect(Number(faturacao?.mensalidade_base ?? 0)).toBe(0);

    const sessaoAdmin = await sessaoComo(admin);
    const { error } = await sessaoAdmin
      .from('alunos_faturacao')
      .upsert({ aluno_id: aluno.id, centro_id: centroId, mensalidade_base: -5 }, { onConflict: 'aluno_id' });
    expect(error).not.toBeNull();
  });
});
