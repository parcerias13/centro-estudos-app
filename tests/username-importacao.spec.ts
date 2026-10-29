import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';
import path from 'node:path';
import os from 'node:os';
import { gerarUsernameBase } from '@/lib/username';

dotenv.config({ path: '.env.local' });

// Importação de alunos por Excel com nome de utilizador (em vez de email) —
// com e sem a coluna opcional, e idempotência (duas importações do mesmo
// ficheiro não duplicam). Isolado num centro ZZTESTE próprio, apagado no fim.

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

const CABECALHOS = [
  'Nome*', 'Data Nascimento*', 'Ano Escolar*', 'Mensalidade Base*',
  'Nome de Utilizador do Aluno', 'Email Encarregado', 'Telefone Encarregado',
  'Telemovel Aluno', 'Dias Semana', 'Saida Autorizada', 'Usa App', 'NIF Encarregado', 'Morada Encarregado',
];

async function gerarXlsx(linhas: (string | number)[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Alunos');
  sheet.addRow(CABECALHOS);
  for (const linha of linhas) sheet.addRow(linha);
  const caminho = path.join(os.tmpdir(), `zzteste-import-${SUFIXO}-${randomInt(0, 1_000_000)}.xlsx`);
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
  await page.getByRole('button', { name: /confirmar importação/i }).click();
  await expect(page.getByText(/aluno\(s\) criado\(s\) com sucesso/i)).toBeVisible({ timeout: 20_000 });
  const texto = await page.evaluate(() => document.body.innerText);
  const matchCriados = texto.match(/(\d+) aluno\(s\) criado\(s\) com sucesso/);
  const matchIgnoradas = texto.match(/(\d+) linha\(s\) ignorada\(s\)/);
  await page.getByRole('button', { name: /concluir/i }).click();
  return {
    criados: matchCriados ? parseInt(matchCriados[1], 10) : -1,
    ignoradas: matchIgnoradas ? parseInt(matchIgnoradas[1], 10) : 0,
    texto,
  };
}

test.describe('Importação de alunos por Excel — nome de utilizador', () => {
  test.beforeAll(async ({ browser }) => {
    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Utilizador Importacao ${SUFIXO}`, email_remetente: `zzteste-utilizador-importacao-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    const email = `zzteste-utilizador-importacao-admin-${SUFIXO}@example.invalid`;
    const password = gerarPasswordSegura();
    const { data: userData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
    if (authError) throw new Error(`criar admin: ${authError.message}`);
    const id = userData.user.id;
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
    await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { role: 'admin', centro_id: centroId } });
    const { error: staffError } = await supabaseAdmin.from('staff').insert({ id, email, name: 'ZZTESTE Admin Importação', role: 'admin', centro_id: centroId });
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
    // Apaga também os alunos criados pelos próprios testes (via UI, não têm
    // push individual na limpeza) antes das contas de staff/config_centro.
    // Lê os ids ANTES de apagar a linha de alunos — ao contrário, a conta de
    // Auth nunca seria apagada (a query por centro_id já não devolve nada).
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

  test('importação SEM a coluna de utilizador gera o nome de utilizador a partir do nome', async () => {
    const nome = `Importacao Sem Coluna ${SUFIXO}`;
    const ficheiro = await gerarXlsx([[nome, '10/04/2014', 6, 60, '', 'mae.semcoluna@example.invalid', '912000001', '', '', 'sim', 'sim', '', '']]);

    const resultado = await importar(ficheiro);
    expect(resultado.criados).toBe(1);
    expect(resultado.ignoradas).toBe(0);

    const { data: aluno } = await supabaseAdmin.from('alunos').select('email').eq('centro_id', centroId).eq('nome', nome).single();
    expect(aluno?.email).toBe(`${gerarUsernameBase(nome)}@utilizador.invalid`);
  });

  test('importação COM a coluna de utilizador usa o valor indicado', async () => {
    const nome = `Importacao Com Coluna ${SUFIXO}`;
    const utilizadorEscolhido = `zzcustom${SUFIXO}`;
    const ficheiro = await gerarXlsx([[nome, '11/05/2014', 6, 60, utilizadorEscolhido, 'mae.comcoluna@example.invalid', '912000002', '', '', 'sim', 'sim', '', '']]);

    const resultado = await importar(ficheiro);
    expect(resultado.criados).toBe(1);
    expect(resultado.ignoradas).toBe(0);

    const { data: aluno } = await supabaseAdmin.from('alunos').select('email').eq('centro_id', centroId).eq('nome', nome).single();
    expect(aluno?.email).toBe(`${utilizadorEscolhido}@utilizador.invalid`);
  });

  test('duas importações seguidas do mesmo ficheiro não duplicam alunos', async () => {
    const nome1 = `Idempotencia Um ${SUFIXO}`;
    const nome2 = `Idempotencia Dois ${SUFIXO}`;
    const ficheiro = await gerarXlsx([
      [nome1, '01/02/2014', 5, 55, '', 'mae.idempotencia1@example.invalid', '912000003', '', '', 'sim', 'sim', '', ''],
      [nome2, '02/03/2014', 5, 55, '', 'mae.idempotencia2@example.invalid', '912000004', '', '', 'sim', 'sim', '', ''],
    ]);

    const primeira = await importar(ficheiro);
    expect(primeira.criados).toBe(2);
    expect(primeira.ignoradas).toBe(0);

    const segunda = await importar(ficheiro);
    expect(segunda.criados).toBe(0);
    expect(segunda.ignoradas).toBe(2);

    const { count } = await supabaseAdmin
      .from('alunos')
      .select('id', { count: 'exact', head: true })
      .eq('centro_id', centroId)
      .in('nome', [nome1, nome2]);
    expect(count).toBe(2);
  });

  test('nomes repetidos: aviso na pré-visualização e sufixo automático na criação', async () => {
    const nomeComum = 'Maria Costa';
    const data1 = '01/02/2011';
    const data2 = '15/06/2013';
    const ficheiro = await gerarXlsx([
      [nomeComum, data1, 5, 55, '', 'mae.repetido1@example.invalid', '912000005', '', '', 'sim', 'sim', '', ''],
      [nomeComum, data2, 6, 60, '', 'mae.repetido2@example.invalid', '912000006', '', '', 'sim', 'sim', '', ''],
    ]);

    await page.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });
    await page.setInputFiles('input[type="file"]', ficheiro);
    await expect(page.getByRole('button', { name: /confirmar importação/i })).toBeVisible({ timeout: 15_000 });

    // Aviso amarelo em cada uma das duas linhas homónimas, não bloqueia.
    const aviso = page.getByText(/Nome repetido: este aluno ficará com um número no fim/i);
    await expect(aviso).toHaveCount(2);

    await page.getByRole('button', { name: /confirmar importação/i }).click();
    await expect(page.getByText(/aluno\(s\) criado\(s\) com sucesso/i)).toBeVisible({ timeout: 20_000 });

    const texto = await page.evaluate(() => document.body.innerText);
    expect(texto).toMatch(/2 aluno\(s\) criado\(s\) com sucesso/);
    expect(texto).not.toMatch(/linha\(s\) ignorada\(s\)/);

    // Relatório mostra as 6 colunas (Aluno, Ano, Nascimento, Utilizador,
    // Palavra-passe, Código — o cabeçalho da tabela é text-transform:
    // uppercase, e innerText reflete o texto tal como é renderizado) com a
    // data no formato DD/MM/AAAA.
    expect(texto).toContain('ALUNO');
    expect(texto).toContain('NASCIMENTO');
    expect(texto).toContain(data1);
    expect(texto).toContain(data2);
    expect(texto).toContain('maria.costa');
    expect(texto).toContain('maria.costa2');

    // "Copiar tudo" tem a linha de cabeçalho e as colunas certas, por tabulação.
    await page.getByRole('button', { name: /copiar tudo/i }).click();
    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    const linhasCopiadas = copiado.split('\n');
    expect(linhasCopiadas[0]).toBe('Aluno\tAno\tNascimento\tUtilizador\tPalavra-passe\tCódigo');
    expect(linhasCopiadas).toHaveLength(3);
    expect(linhasCopiadas[1]).toMatch(new RegExp(`^${nomeComum}\\t5\\t${data1}\\tmaria\\.costa\\t`));
    expect(linhasCopiadas[2]).toMatch(new RegExp(`^${nomeComum}\\t6\\t${data2}\\tmaria\\.costa2\\t`));

    await page.getByRole('button', { name: /concluir/i }).click();

    const { data: alunos } = await supabaseAdmin
      .from('alunos')
      .select('email, data_nascimento')
      .eq('centro_id', centroId)
      .eq('nome', nomeComum);
    const porData = new Map((alunos || []).map((a: any) => [a.data_nascimento, a.email]));
    expect(porData.get('2011-02-01')).toBe('maria.costa@utilizador.invalid');
    expect(porData.get('2013-06-15')).toBe('maria.costa2@utilizador.invalid');
  });

  test('coluna de Nome de Utilizador preenchida à mão para os dois: sem aviso, usa os valores indicados', async () => {
    const nomeComum = 'Maria Costa';
    // Em minúsculas: o servidor normaliza o override com
    // normalizarUsernameManual() (lib/username.ts), que inclui toLowerCase().
    const utilizador1 = `maria.turmaa.${SUFIXO}`;
    const utilizador2 = `maria.turmab.${SUFIXO}`;
    // Ano 9 (não 5/6, já usados pelo teste anterior de "nomes repetidos") —
    // a chave de idempotência da importação passou a nome+ano escolar (já
    // não usa a data de nascimento), por isso dois "Maria Costa" com o
    // mesmo ano só se distinguem tendo Nome de Utilizador diferente, que é
    // exatamente o que este teste cobre.
    const ficheiro = await gerarXlsx([
      [nomeComum, '03/03/2012', 9, 55, utilizador1, 'mae.manual1@example.invalid', '912000007', '', '', 'sim', 'sim', '', ''],
      [nomeComum, '04/04/2012', 9, 55, utilizador2, 'mae.manual2@example.invalid', '912000008', '', '', 'sim', 'sim', '', ''],
    ]);

    await page.goto(`${BASE_URL}/admin/alunos`, { waitUntil: 'networkidle' });
    await page.setInputFiles('input[type="file"]', ficheiro);
    await expect(page.getByRole('button', { name: /confirmar importação/i })).toBeVisible({ timeout: 15_000 });

    // Utilizadores já distintos (escolhidos à mão) — sem aviso de repetição.
    await expect(page.getByText(/Nome repetido: este aluno ficará com um número no fim/i)).toHaveCount(0);

    await page.getByRole('button', { name: /confirmar importação/i }).click();
    await expect(page.getByText(/aluno\(s\) criado\(s\) com sucesso/i)).toBeVisible({ timeout: 20_000 });
    const texto = await page.evaluate(() => document.body.innerText);
    expect(texto).toMatch(/2 aluno\(s\) criado\(s\) com sucesso/);
    expect(texto).toContain(utilizador1);
    expect(texto).toContain(utilizador2);

    await page.getByRole('button', { name: /concluir/i }).click();

    const { data: alunos } = await supabaseAdmin
      .from('alunos')
      .select('email, data_nascimento')
      .eq('centro_id', centroId)
      .eq('nome', nomeComum)
      .in('data_nascimento', ['2012-03-03', '2012-04-04']);
    const porData = new Map((alunos || []).map((a: any) => [a.data_nascimento, a.email]));
    expect(porData.get('2012-03-03')).toBe(`${utilizador1}@utilizador.invalid`);
    expect(porData.get('2012-04-04')).toBe(`${utilizador2}@utilizador.invalid`);
  });
});
