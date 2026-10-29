import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import path from 'node:path';
import os from 'node:os';

dotenv.config({ path: '.env.local' });

// Modalidade (sala_estudo / faz_explicacoes) e data de nascimento opcional na
// importação por Excel — chave de idempotência passou a nome+ano escolar
// (ver app/admin/alunos/importAlunosConfig.ts). Isolado num centro ZZTESTE
// próprio, apagado no fim.

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const SUFIXO = String(Date.now());

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Template atual: "Data Nascimento" sem "*" (opcional) e nova coluna
// "Modalidade" opcional no fim.
const CABECALHOS_NOVO = [
  'Nome*', 'Data Nascimento', 'Ano Escolar*', 'Mensalidade Base*',
  'Nome de Utilizador do Aluno', 'Email Encarregado', 'Telefone Encarregado',
  'Telemovel Aluno', 'Dias Semana', 'Saida Autorizada', 'Usa App', 'NIF Encarregado', 'Morada Encarregado',
  'Modalidade',
];

// Ficheiro "antigo": template de antes desta funcionalidade — "Data
// Nascimento*" com asterisco, sem a coluna Modalidade.
const CABECALHOS_ANTIGO = [
  'Nome*', 'Data Nascimento*', 'Ano Escolar*', 'Mensalidade Base*',
  'Nome de Utilizador do Aluno', 'Email Encarregado', 'Telefone Encarregado',
  'Telemovel Aluno', 'Dias Semana', 'Saida Autorizada', 'Usa App', 'NIF Encarregado', 'Morada Encarregado',
];

async function gerarXlsx(cabecalhos: string[], linhas: (string | number)[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Alunos');
  sheet.addRow(cabecalhos);
  for (const linha of linhas) sheet.addRow(linha);
  const caminho = path.join(os.tmpdir(), `zzteste-modalidade-${SUFIXO}-${randomInt(0, 1_000_000)}.xlsx`);
  await wb.xlsx.writeFile(caminho);
  return caminho;
}

let centroId: string;
let admin: { email: string; password: string };
let context: BrowserContext;
let page: Page;
const limpeza: Array<() => unknown> = [];

async function loginUI(p: Page, identificador: string, password: string) {
  await p.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await p.fill('input[name="identificador"]', identificador);
  await p.fill('input[type="password"]', password);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
}

async function importar(ficheiro: string) {
  await page.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });
  await page.setInputFiles('input[type="file"]', ficheiro);
  await expect(page.getByRole('button', { name: /confirmar importação/i })).toBeVisible({ timeout: 15_000 });
  return page;
}

async function confirmarEColher() {
  await page.getByRole('button', { name: /confirmar importação/i }).click();
  await expect(page.getByText(/aluno\(s\) criado\(s\) com sucesso/i)).toBeVisible({ timeout: 20_000 });
  const texto = await page.evaluate(() => document.body.innerText);
  const matchCriados = texto.match(/(\d+) aluno\(s\) criado\(s\) com sucesso/);
  const matchIgnoradas = texto.match(/(\d+) linha\(s\) ignorada\(s\)/);
  return {
    criados: matchCriados ? parseInt(matchCriados[1], 10) : -1,
    ignoradas: matchIgnoradas ? parseInt(matchIgnoradas[1], 10) : 0,
    texto,
  };
}

async function concluir() {
  await page.getByRole('button', { name: /concluir/i }).click();
}

test.describe('Importação de alunos — modalidade e data de nascimento opcional', () => {
  test.beforeAll(async ({ browser }) => {
    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Modalidade Importacao ${SUFIXO}`, email_remetente: `zzteste-modalidade-importacao-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    const email = `zzteste-modalidade-importacao-admin-${SUFIXO}@example.invalid`;
    const password = gerarPasswordSegura();
    const { data: userData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
    if (authError) throw new Error(`criar admin: ${authError.message}`);
    const id = userData.user.id;
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
    await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { role: 'admin', centro_id: centroId } });
    const { error: staffError } = await supabaseAdmin.from('staff').insert({ id, email, name: 'ZZTESTE Admin Modalidade Importação', role: 'admin', centro_id: centroId });
    if (staffError) throw new Error(`criar staff: ${staffError.message}`);
    limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
    admin = { email, password };

    context = await browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    page = await context.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    await loginUI(page, admin.email, admin.password);
    expect(page.url()).toContain('/admin');
  });

  test.afterAll(async () => {
    const { data: alunosParaApagar } = await supabaseAdmin.from('alunos').select('id').eq('centro_id', centroId);
    for (const a of alunosParaApagar || []) {
      await supabaseAdmin.auth.admin.deleteUser(a.id).catch(() => {});
    }
    await supabaseAdmin.from('alunos').delete().eq('centro_id', centroId);
    await context?.close();
    for (const passo of [...limpeza].reverse()) {
      try {
        const resultado: any = await Promise.resolve(passo());
        if (resultado?.error) console.warn('limpeza: passo com erro (não fatal):', resultado.error.message);
      } catch (err: any) {
        console.warn('limpeza: passo lançou (não fatal):', err?.message);
      }
    }
  });

  test('aluno sem data de nascimento: importa com sucesso, data fica null, e a coluna Nascimento fica vazia no relatório e no "Copiar tudo"', async () => {
    const nome = `SemData ${SUFIXO}`;
    const ficheiro = await gerarXlsx(CABECALHOS_NOVO, [
      [nome, '', 5, 60, '', 'mae.semdata@example.invalid', '912100001', '', '', 'sim', 'sim', '', '', ''],
    ]);

    await importar(ficheiro);
    // Pré-visualização: linha válida (sem erro de data em falta) e célula de
    // Data Nasc. vazia, nunca '—'.
    const linhaPreview = page.locator('tbody tr').first();
    await expect(linhaPreview).toBeVisible();
    await expect(page.getByText(/Data de Nascimento em falta/i)).toHaveCount(0);

    const resultado = await confirmarEColher();
    expect(resultado.criados).toBe(1);
    expect(resultado.ignoradas).toBe(0);

    // Relatório de acessos + "Copiar tudo": coluna "Nascimento" vazia, nunca '—'/null/NaN.
    const celulaNascimento = await page.locator('tbody tr', { hasText: nome }).first().locator('td').nth(2).innerText();
    expect(celulaNascimento.trim()).toBe('');

    await page.getByRole('button', { name: /copiar tudo/i }).click();
    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    const linhaCopiada = copiado.split('\n').find((l) => l.startsWith(nome));
    expect(linhaCopiada).toBeTruthy();
    const partes = linhaCopiada!.split('\t');
    // Aluno \t Ano \t Nascimento \t Utilizador \t Palavra-passe \t Código
    expect(partes[2]).toBe('');

    await concluir();

    const { data: aluno } = await supabaseAdmin.from('alunos').select('data_nascimento, sala_estudo, faz_explicacoes').eq('centro_id', centroId).eq('nome', nome).single();
    expect(aluno?.data_nascimento).toBeNull();
    // Modalidade vazia na coluna -> default Sala de Estudo.
    expect(aluno?.sala_estudo).toBe(true);
    expect(aluno?.faz_explicacoes).toBe(false);
  });

  test('homónimos dentro do ficheiro (mesmo nome e ano, sem Nome de Utilizador diferente): bloqueados, não importados', async () => {
    const nomeHomonimo = `Homonimo Bloqueado ${SUFIXO}`;
    const nomeControlo = `Linha Normal Controlo ${SUFIXO}`;
    const ficheiro = await gerarXlsx(CABECALHOS_NOVO, [
      [nomeHomonimo, '', 5, 50, '', 'mae.homA@example.invalid', '912100002', '', '', 'sim', 'sim', '', '', ''],
      [nomeHomonimo, '', 5, 50, '', 'mae.homB@example.invalid', '912100003', '', '', 'sim', 'sim', '', '', ''],
      [nomeControlo, '', 6, 50, '', 'mae.controlo@example.invalid', '912100004', '', '', 'sim', 'sim', '', '', ''],
    ]);

    await importar(ficheiro);
    await expect(page.getByText(/Possível duplicado ou homónimo/i)).toHaveCount(2);

    const resultado = await confirmarEColher();
    expect(resultado.criados).toBe(1);
    expect(resultado.ignoradas).toBe(2);
    expect(resultado.texto).toContain('Possível duplicado ou homónimo');
    await concluir();

    const { count } = await supabaseAdmin.from('alunos').select('id', { count: 'exact', head: true }).eq('centro_id', centroId).eq('nome', nomeHomonimo);
    expect(count).toBe(0);
    const { data: controlo } = await supabaseAdmin.from('alunos').select('id').eq('centro_id', centroId).eq('nome', nomeControlo).single();
    expect(controlo).toBeTruthy();
  });

  test('homónimos dentro do ficheiro com Nome de Utilizador diferente: ambos importados sem aviso', async () => {
    const nomeHomonimo = `Homonimo Distinto ${SUFIXO}`;
    const utilizadorA = `homdistintoa${SUFIXO}`;
    const utilizadorB = `homdistintob${SUFIXO}`;
    const ficheiro = await gerarXlsx(CABECALHOS_NOVO, [
      [nomeHomonimo, '', 5, 50, utilizadorA, 'mae.homdistA@example.invalid', '912100005', '', '', 'sim', 'sim', '', '', ''],
      [nomeHomonimo, '', 5, 50, utilizadorB, 'mae.homdistB@example.invalid', '912100006', '', '', 'sim', 'sim', '', '', ''],
    ]);

    await importar(ficheiro);
    await expect(page.getByText(/Possível duplicado ou homónimo/i)).toHaveCount(0);

    const resultado = await confirmarEColher();
    expect(resultado.criados).toBe(2);
    expect(resultado.ignoradas).toBe(0);
    await concluir();

    const { count } = await supabaseAdmin.from('alunos').select('id', { count: 'exact', head: true }).eq('centro_id', centroId).eq('nome', nomeHomonimo);
    expect(count).toBe(2);
  });

  test('colisão com a base de dados: linha ignorada e listada com nome, ano e frase da modalidade atual', async () => {
    const nome = `Colisao BD ${SUFIXO}`;
    const primeiro = await gerarXlsx(CABECALHOS_NOVO, [
      [nome, '', 7, 55, '', 'mae.colisaobd@example.invalid', '912100007', '', '', 'sim', 'sim', '', '', ''],
    ]);
    await importar(primeiro);
    const resultado1 = await confirmarEColher();
    expect(resultado1.criados).toBe(1);
    await concluir();

    // Reimportação: mesmo nome + mesmo ano escolar — ignorada, nunca em
    // silêncio (aparece no relatório com nome, ano e a frase da modalidade).
    const segundo = await gerarXlsx(CABECALHOS_NOVO, [
      [nome, '', 7, 999, '', 'outro@example.invalid', '912100008', '', '', 'sim', 'sim', '', '', ''],
    ]);
    await importar(segundo);
    const resultado2 = await confirmarEColher();
    expect(resultado2.criados).toBe(0);
    expect(resultado2.ignoradas).toBe(1);
    expect(resultado2.texto).toContain(nome);
    expect(resultado2.texto).toContain('7.º ano');
    expect(resultado2.texto).toContain('Já existe como Sala de Estudo.');
    await concluir();

    const { count } = await supabaseAdmin.from('alunos').select('id', { count: 'exact', head: true }).eq('centro_id', centroId).eq('nome', nome);
    expect(count).toBe(1);
  });

  test('coluna "Modalidade" do template: aceita as variantes sem acentos/capitalização, e vazio = Sala de Estudo', async () => {
    const n = (sufixoLocal: string) => `Modalidade ${sufixoLocal} ${SUFIXO}`;
    const linhas: [string, string, number, number, string, string, string, string, string, string, string, string, string, string][] = [
      [n('SalaMaiusculas'), '', 1, 10, '', 'mae.modA@example.invalid', '912100010', '', '', 'sim', 'sim', '', '', 'SALA DE ESTUDO'],
      [n('SoExplicacoes'), '', 1, 10, '', 'mae.modB@example.invalid', '912100011', '', '', 'sim', 'sim', '', '', 'só explicações'],
      [n('Explicacoes'), '', 1, 10, '', 'mae.modC@example.invalid', '912100012', '', '', 'sim', 'sim', '', '', 'explicacoes'],
      [n('Ambos'), '', 1, 10, '', 'mae.modD@example.invalid', '912100013', '', '', 'sim', 'sim', '', '', 'AmBoS'],
      [n('Vazia'), '', 1, 10, '', 'mae.modE@example.invalid', '912100014', '', '', 'sim', 'sim', '', '', ''],
    ];
    const ficheiro = await gerarXlsx(CABECALHOS_NOVO, linhas);
    await importar(ficheiro);
    const resultado = await confirmarEColher();
    expect(resultado.criados).toBe(5);
    expect(resultado.ignoradas).toBe(0);
    await concluir();

    const { data: alunos } = await supabaseAdmin.from('alunos').select('nome, sala_estudo, faz_explicacoes').eq('centro_id', centroId).like('nome', `Modalidade %${SUFIXO}`);
    const porNome = new Map((alunos || []).map((a: any) => [a.nome, a]));

    expect(porNome.get(n('SalaMaiusculas'))).toMatchObject({ sala_estudo: true, faz_explicacoes: false });
    expect(porNome.get(n('SoExplicacoes'))).toMatchObject({ sala_estudo: false, faz_explicacoes: true });
    expect(porNome.get(n('Explicacoes'))).toMatchObject({ sala_estudo: false, faz_explicacoes: true });
    expect(porNome.get(n('Ambos'))).toMatchObject({ sala_estudo: true, faz_explicacoes: true });
    expect(porNome.get(n('Vazia'))).toMatchObject({ sala_estudo: true, faz_explicacoes: false });
  });

  test('ficheiro antigo (sem a coluna Modalidade, "Data Nascimento*" com asterisco): continua a importar com os defaults', async () => {
    const nome = `FicheiroAntigo ${SUFIXO}`;
    const ficheiro = await gerarXlsx(CABECALHOS_ANTIGO, [
      [nome, '20/05/2013', 8, 65, '', 'mae.antigo@example.invalid', '912100020', '', '', 'sim', 'sim', '', ''],
    ]);
    await importar(ficheiro);
    const resultado = await confirmarEColher();
    expect(resultado.criados).toBe(1);
    expect(resultado.ignoradas).toBe(0);
    await concluir();

    const { data: aluno } = await supabaseAdmin.from('alunos').select('data_nascimento, sala_estudo, faz_explicacoes').eq('centro_id', centroId).eq('nome', nome).single();
    expect(aluno?.data_nascimento).toBe('2013-05-20');
    expect(aluno?.sala_estudo).toBe(true);
    expect(aluno?.faz_explicacoes).toBe(false);
  });
});
