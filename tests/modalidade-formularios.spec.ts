import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Modalidade na Nova Matrícula e na Edição (formulários), e proteção
// server-side: um aluno autenticado nunca consegue mudar a sua própria
// modalidade diretamente via Supabase (RLS/trigger fn_alunos_proteger).
// Isolado num centro ZZTESTE próprio, apagado no fim.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const SUFIXO = String(Date.now());

function gerarPasswordSegura(tamanho = 14) {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('');
}

const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

interface DadosAluno {
  nome: string;
  data_nascimento?: string | null;
  ano_escolar?: number;
  mensalidade_base?: number;
  sala_estudo?: boolean;
  faz_explicacoes?: boolean;
}

async function criarAlunoViaApi(dados: DadosAluno) {
  const res = await page.request.post(`${BASE_URL}/api/admin/criar-aluno`, {
    data: {
      ano_escolar: 7,
      mensalidade_base: 50,
      // Obrigatórios no formulário de Edição (telefone/email do
      // encarregado) — sem eles, o HTML5 required bloqueia o submit em
      // silêncio (sem erro JS, sem pedido de rede) quando o teste tenta
      // gravar alterações na ficha.
      telefone_encarregado: '912999000',
      email_encarregado: `mae.${Date.now()}.${randomInt(0, 1_000_000)}@example.invalid`,
      ...dados,
    },
  });
  const body = await res.json();
  if (body.alunoId) {
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(body.alunoId));
    limpeza.push(() => supabaseAdmin.from('alunos').delete().eq('id', body.alunoId));
    limpeza.push(() => supabaseAdmin.from('aluno_horarios').delete().eq('aluno_id', body.alunoId));
    limpeza.push(() => supabaseAdmin.from('encarregado_codigos').delete().eq('aluno_id', body.alunoId));
  }
  return { status: res.status(), body: body as { ok?: boolean; alunoId?: string; nomeUtilizador?: string; password?: string; error?: string } };
}

test.describe('Modalidade — formulários e proteção server-side', () => {
  test.beforeAll(async ({ browser }) => {
    const { data: centro, error: centroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Modalidade Formularios ${SUFIXO}`, email_remetente: `zzteste-modalidade-formularios-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (centroError) throw new Error(`criar config_centro: ${centroError.message}`);
    centroId = centro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', centroId));

    const email = `zzteste-modalidade-formularios-admin-${SUFIXO}@example.invalid`;
    const password = gerarPasswordSegura();
    const { data: userData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
    if (authError) throw new Error(`criar admin: ${authError.message}`);
    const id = userData.user.id;
    limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
    await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: { role: 'admin', centro_id: centroId } });
    const { error: staffError } = await supabaseAdmin.from('staff').insert({ id, email, name: 'ZZTESTE Admin Modalidade Formulários', role: 'admin', centro_id: centroId });
    if (staffError) throw new Error(`criar staff: ${staffError.message}`);
    limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
    admin = { email, password };

    context = await browser.newContext();
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

  test('Nova Matrícula: sem data de nascimento e com "Só Explicações" grava a modalidade correta', async () => {
    const nome = `Nova Matricula Modalidade ${SUFIXO}`;
    await page.goto(`${BASE_URL}/admin/alunos/novo`, { waitUntil: 'networkidle' });

    await page.locator('input[type="text"]').first().fill(nome); // Nome Completo (primeiro input de texto do formulário)
    // Data de Nascimento (opcional) fica vazia de propósito.
    await page.locator('select').selectOption('9'); // Ano Escolar
    await page.locator('input[placeholder="Ex: 912345678"]').nth(1).fill('912999001'); // Telemóvel Encarregado
    await page.fill('input[placeholder="email@exemplo.com"]', 'mae.novamatricula@example.invalid'); // Email Encarregado
    await page.getByRole('button', { name: 'Só Explicações' }).click();
    await page.fill('input[placeholder="0.00"]', '0'); // Mensalidade Base

    await page.getByRole('button', { name: /finalizar matrícula/i }).click();
    await expect(page.getByText(/matrícula criada/i)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /concluir/i }).click();

    const { data: aluno } = await supabaseAdmin
      .from('alunos')
      .select('data_nascimento, sala_estudo, faz_explicacoes')
      .eq('centro_id', centroId)
      .eq('nome', nome)
      .single();
    expect(aluno?.data_nascimento).toBeNull();
    expect(aluno?.sala_estudo).toBe(false);
    expect(aluno?.faz_explicacoes).toBe(true);
  });

  test('Editar Aluno: mudar de Sala de Estudo (default) para Ambos grava as duas colunas', async () => {
    const nome = `Editar Modalidade ${SUFIXO}`;
    const criado = await criarAlunoViaApi({ nome, data_nascimento: '2012-01-01' });
    expect(criado.status).toBe(200);
    const alunoId = criado.body.alunoId!;

    await page.goto(`${BASE_URL}/admin/alunos/editar?id=${alunoId}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: 'Sala de Estudo' })).toBeVisible();
    await page.getByRole('button', { name: 'Ambos' }).click();
    // Aluno criado sem dias de frequência — seleciona um antes de gravar
    // (handleUpdate grava sempre os dias selecionados a par da modalidade).
    await page.getByRole('button', { name: 'Segunda' }).click();
    await page.getByRole('button', { name: /gravar alterações/i }).click();
    await expect(page).toHaveURL(/\/admin\/alunos$/, { timeout: 20_000 });

    const { data: aluno } = await supabaseAdmin.from('alunos').select('sala_estudo, faz_explicacoes').eq('id', alunoId).single();
    expect(aluno?.sala_estudo).toBe(true);
    expect(aluno?.faz_explicacoes).toBe(true);
  });

  test('API criar-aluno recusa modalidade com as duas falsas', async () => {
    const criado = await criarAlunoViaApi({ nome: `Sem Modalidade ${SUFIXO}`, sala_estudo: false, faz_explicacoes: false });
    expect(criado.status).toBe(400);
    expect(criado.body.error).toMatch(/pelo menos uma modalidade/i);
  });

  test('um aluno autenticado não consegue mudar a própria modalidade (nem ano_escolar, nem mensalidade_base) diretamente (RLS + trg_alunos_proteger)', async () => {
    const nome = `Aluno Protege Modalidade ${SUFIXO}`;
    const criado = await criarAlunoViaApi({ nome, sala_estudo: true, faz_explicacoes: false, ano_escolar: 6, mensalidade_base: 35 });
    expect(criado.status).toBe(200);
    const alunoId = criado.body.alunoId!;
    const alunoEmail = `${criado.body.nomeUtilizador}@utilizador.invalid`;
    const alunoPassword = criado.body.password!;

    const clienteAluno = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error: loginError } = await clienteAluno.auth.signInWithPassword({ email: alunoEmail, password: alunoPassword });
    expect(loginError).toBeNull();

    // A tabela `alunos` não tem política de UPDATE para o papel aluno (só
    // para a equipa) — RLS nega a linha, não devolve erro, por isso uma
    // escrita sem permissão aparece como 0 linhas afetadas em .select(), não
    // como `error`. trg_alunos_proteger dispara em todo o UPDATE e também
    // cobre sala_estudo/faz_explicacoes. Prova-se então em dois passos, por
    // coluna: (1) a escrita não devolve nenhuma linha (ou devolve erro — os
    // dois contam como bloqueado); (2) a leitura a seguir, com a service
    // role, mostra o valor original intacto.
    const { data: original } = await supabaseAdmin
      .from('alunos')
      .select('sala_estudo, faz_explicacoes, ano_escolar, mensalidade_base')
      .eq('id', alunoId)
      .single();
    expect(original).toBeTruthy();

    async function tentarEscritaBloqueada(campo: string, valorNovo: unknown) {
      const { data, error } = await clienteAluno.from('alunos').update({ [campo]: valorNovo }).eq('id', alunoId).select();
      const bloqueado = error !== null || (data?.length ?? 0) === 0;
      return { bloqueado, error, data };
    }

    const tentativaModalidade = await tentarEscritaBloqueada('sala_estudo', !original!.sala_estudo);
    expect(tentativaModalidade.bloqueado).toBe(true);

    const tentativaExplicacoes = await tentarEscritaBloqueada('faz_explicacoes', !original!.faz_explicacoes);
    expect(tentativaExplicacoes.bloqueado).toBe(true);

    const tentativaAno = await tentarEscritaBloqueada('ano_escolar', original!.ano_escolar + 1);
    expect(tentativaAno.bloqueado).toBe(true);

    const tentativaMensalidade = await tentarEscritaBloqueada('mensalidade_base', Number(original!.mensalidade_base) + 1);
    expect(tentativaMensalidade.bloqueado).toBe(true);

    // Nada mudou, em nenhuma das quatro colunas — lido com a service role,
    // nunca com o cliente do aluno (que, se algo tivesse passado, poderia
    // estar a ler um cache/otimismo do próprio SDK em vez da BD real).
    const { data: depois } = await supabaseAdmin
      .from('alunos')
      .select('sala_estudo, faz_explicacoes, ano_escolar, mensalidade_base')
      .eq('id', alunoId)
      .single();
    expect(depois?.sala_estudo).toBe(original!.sala_estudo);
    expect(depois?.faz_explicacoes).toBe(original!.faz_explicacoes);
    expect(depois?.ano_escolar).toBe(original!.ano_escolar);
    expect(Number(depois?.mensalidade_base)).toBe(Number(original!.mensalidade_base));
  });
});
