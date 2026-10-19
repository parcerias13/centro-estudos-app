import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// RLS e funções SQL de custos_fixos/custos_fixos_periodos — sessões reais
// (nunca a chave de serviço para os testes em si, só para preparar/verificar).
// Centro descartável ZZTESTE criado via ~/Desktop/gestao-centros/novo-centro.mjs
// (nunca o demo, nunca o real). O ficheiro de credenciais que esse script
// escreve nunca é lido: a password da conta admin que ele cria é rodada por
// script (sabemos o id via `staff`, não via o ficheiro); professor/secretaria
// e o admin do "outro centro" são contas próprias, com password gerada em
// memória — nunca persistida nem impressa.

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
const NOME_ZZTESTE = `ZZTESTE Custos ${SUFIXO}`;
const ADMIN_EMAIL = `admin-custos-${SUFIXO}@zzteste.invalid`;

type Conta = { email: string; password: string; id: string };

let centroId: string;
let outroCentroId: string;
let admin: Conta;
let professor: Conta;
let secretaria: Conta;
let outroAdmin: Conta;
let custoId: string;

const limpeza: Array<() => unknown> = [];

async function criarUtilizadorAuth(email: string, password: string, appMetadata: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`criar utilizador ${email}: ${error.message}`);
  const id = data.user.id;
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(id, { app_metadata: appMetadata });
  if (metaError) {
    await supabaseAdmin.auth.admin.deleteUser(id);
    throw new Error(`app_metadata ${email}: ${metaError.message}`);
  }
  return id;
}

async function criarStaff(papel: string, centro: string): Promise<Conta> {
  const email = `custos-${papel}-${SUFIXO}@zzteste.invalid`;
  const password = gerarPasswordSegura();
  const id = await criarUtilizadorAuth(email, password, { role: papel, centro_id: centro });
  limpeza.push(() => supabaseAdmin.auth.admin.deleteUser(id));
  const { error } = await supabaseAdmin.from('staff').insert({ id, email, name: `Staff ${papel} ${SUFIXO}`, role: papel, centro_id: centro });
  if (error) throw new Error(`criar staff ${papel}: ${error.message}`);
  limpeza.push(() => supabaseAdmin.from('staff').delete().eq('id', id));
  return { email, password, id };
}

async function sessaoComo(conta: Conta) {
  const cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error } = await cliente.auth.signInWithPassword({ email: conta.email, password: conta.password });
  if (error) throw new Error(`login ${conta.email}: ${error.message}`);
  return cliente;
}

test.describe.configure({ mode: 'serial' });

test.describe('RLS e funções de custos fixos — centro descartável ZZTESTE', () => {
  test.beforeAll(async () => {
    const saida = execFileSync(
      'node',
      ['novo-centro.mjs', '--nome', NOME_ZZTESTE, '--admin-email', ADMIN_EMAIL, '--admin-nome', 'Admin ZZTESTE Custos'],
      { cwd: GESTAO_DIR, encoding: 'utf8' }
    );
    const m = saida.match(/centro_id = ([0-9a-f-]+)/);
    if (!m) throw new Error('novo-centro.mjs não devolveu centro_id: ' + saida);
    centroId = m[1];

    const { data: staffAdmin, error: staffAdminError } = await supabaseAdmin
      .from('staff')
      .select('id')
      .eq('centro_id', centroId)
      .eq('role', 'admin')
      .single();
    if (staffAdminError || !staffAdmin) throw new Error('não encontrei o staff admin criado pelo novo-centro.mjs');
    const passwordAdmin = gerarPasswordSegura();
    const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(staffAdmin.id, { password: passwordAdmin });
    if (resetError) throw new Error(`rodar password do admin: ${resetError.message}`);
    admin = { email: ADMIN_EMAIL, password: passwordAdmin, id: staffAdmin.id };

    professor = await criarStaff('professor', centroId);
    secretaria = await criarStaff('secretaria', centroId);

    const { data: outroCentro, error: outroCentroError } = await supabaseAdmin
      .from('config_centro')
      .insert({ nome_centro: `ZZTESTE Outro ${SUFIXO}`, email_remetente: `zzteste-outro-${SUFIXO}@example.invalid`, resend_api_key: null })
      .select('id')
      .single();
    if (outroCentroError) throw new Error(`criar outro centro: ${outroCentroError.message}`);
    outroCentroId = outroCentro.id;
    limpeza.push(() => supabaseAdmin.from('config_centro').delete().eq('id', outroCentroId));
    outroAdmin = await criarStaff('admin', outroCentroId);
  });

  test.afterAll(async () => {
    // custos_fixos/custos_fixos_periodos ainda não constam da lista de
    // tabelas do apagar-centro.mjs (tabelas novas) — apagamos nós mesmos
    // antes de chamar o script, para não deixar linhas órfãs.
    if (centroId) await supabaseAdmin.from('custos_fixos').delete().eq('centro_id', centroId);
    if (outroCentroId) await supabaseAdmin.from('custos_fixos').delete().eq('centro_id', outroCentroId);

    for (const passo of [...limpeza].reverse()) {
      try { await Promise.resolve(passo()); } catch { /* best-effort */ }
    }

    if (centroId) {
      execFileSync('node', ['apagar-centro.mjs', centroId, '--confirmo-apagar', NOME_ZZTESTE], { cwd: GESTAO_DIR, encoding: 'utf8' });
    }

    // Verificação independente (chave de serviço, sem confiar no próprio script/limpeza acima).
    const { data: restoConfig } = await supabaseAdmin.from('config_centro').select('id').eq('id', centroId);
    const { data: restoStaff } = await supabaseAdmin.from('staff').select('id').eq('centro_id', centroId);
    const { data: restoFixos } = await supabaseAdmin.from('custos_fixos').select('id').eq('centro_id', centroId);
    const { data: restoOutroCentro } = await supabaseAdmin.from('config_centro').select('id').eq('id', outroCentroId);
    expect(restoConfig ?? []).toHaveLength(0);
    expect(restoStaff ?? []).toHaveLength(0);
    expect(restoFixos ?? []).toHaveLength(0);
    expect(restoOutroCentro ?? []).toHaveLength(0);
  });

  test('admin: cria um custo fixo e o seu período, e consegue lê-lo de volta', async () => {
    const sessao = await sessaoComo(admin);
    const { data: custo, error: errCusto } = await sessao
      .from('custos_fixos')
      .insert({ nome: `Renda ${SUFIXO}`, categoria: 'Outros', centro_id: centroId })
      .select('id')
      .single();
    expect(errCusto).toBeNull();
    custoId = custo!.id;

    const { error: errPeriodo } = await sessao
      .from('custos_fixos_periodos')
      .insert({ custo_id: custoId, centro_id: centroId, de: '2026-01-01', ate: null, valor: 500 });
    expect(errPeriodo).toBeNull();

    const { data: lido } = await sessao.from('custos_fixos').select('id, custos_fixos_periodos(*)').eq('id', custoId);
    expect(lido).toHaveLength(1);
    expect(lido![0].custos_fixos_periodos).toHaveLength(1);
  });

  test('admin: um período sobreposto é recusado (23P01)', async () => {
    const sessao = await sessaoComo(admin);
    const { error } = await sessao
      .from('custos_fixos_periodos')
      .insert({ custo_id: custoId, centro_id: centroId, de: '2026-03-01', ate: null, valor: 600 });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('23P01');
  });

  test('admin: valor <= 0 é recusado', async () => {
    const sessao = await sessaoComo(admin);
    const { data: outroCusto, error: errOutro } = await sessao
      .from('custos_fixos')
      .insert({ nome: `Teste valor inválido ${SUFIXO}`, categoria: 'Outros', centro_id: centroId })
      .select('id')
      .single();
    expect(errOutro).toBeNull();

    const { error } = await sessao
      .from('custos_fixos_periodos')
      .insert({ custo_id: outroCusto!.id, centro_id: centroId, de: '2026-01-01', ate: null, valor: 0 });
    expect(error).not.toBeNull();

    await supabaseAdmin.from('custos_fixos').delete().eq('id', outroCusto!.id);
  });

  test('professor: não lê nem escreve em custos_fixos nem custos_fixos_periodos', async () => {
    const sessao = await sessaoComo(professor);
    const { data: lido, error: errLeitura } = await sessao.from('custos_fixos').select('id').eq('centro_id', centroId);
    expect(errLeitura).toBeNull();
    expect(lido ?? []).toHaveLength(0);

    const { error: errEscritaFixo } = await sessao
      .from('custos_fixos')
      .insert({ nome: 'Professor não pode', categoria: 'Outros', centro_id: centroId });
    expect(errEscritaFixo).not.toBeNull();

    const { error: errEscritaPeriodo } = await sessao
      .from('custos_fixos_periodos')
      .insert({ custo_id: custoId, centro_id: centroId, de: '2030-01-01', ate: null, valor: 10 });
    expect(errEscritaPeriodo).not.toBeNull();
  });

  test('secretaria: não lê nem escreve em custos_fixos nem custos_fixos_periodos', async () => {
    const sessao = await sessaoComo(secretaria);
    const { data: lido, error: errLeitura } = await sessao.from('custos_fixos').select('id').eq('centro_id', centroId);
    expect(errLeitura).toBeNull();
    expect(lido ?? []).toHaveLength(0);

    const { error: errEscrita } = await sessao
      .from('custos_fixos_periodos')
      .insert({ custo_id: custoId, centro_id: centroId, de: '2031-01-01', ate: null, valor: 10 });
    expect(errEscrita).not.toBeNull();
  });

  test('admin de outro centro não vê nada do ZZTESTE', async () => {
    const sessao = await sessaoComo(outroAdmin);
    const { data: lido, error } = await sessao.from('custos_fixos').select('id').eq('centro_id', centroId);
    expect(error).toBeNull();
    expect(lido ?? []).toHaveLength(0);
  });

  test('alterar_valor_custo_fixo: admin altera o valor a partir de um mês (meses anteriores mantêm o valor antigo)', async () => {
    const sessao = await sessaoComo(admin);
    const { error } = await sessao.rpc('alterar_valor_custo_fixo', { p_custo: custoId, p_de: '2026-06-01', p_valor: 550 });
    expect(error).toBeNull();

    const { data: periodos } = await supabaseAdmin
      .from('custos_fixos_periodos')
      .select('de, ate, valor')
      .eq('custo_id', custoId)
      .order('de');
    expect(periodos).toHaveLength(2);
    expect(Number(periodos![0].valor)).toBe(500);
    expect(periodos![0].ate).not.toBeNull();
    expect(new Date(periodos![0].ate as string).getTime()).toBeLessThan(new Date('2026-06-01').getTime());
    expect(Number(periodos![1].valor)).toBe(550);
    expect(periodos![1].ate).toBeNull();
  });

  test('alterar_valor_custo_fixo: recusa sobrepor um período existente', async () => {
    const sessao = await sessaoComo(admin);
    const { error } = await sessao.rpc('alterar_valor_custo_fixo', { p_custo: custoId, p_de: '2026-01-01', p_valor: 999 });
    expect(error).not.toBeNull();
  });

  test('alterar_valor_custo_fixo: recusa um custo de outro centro (nada muda)', async () => {
    const sessao = await sessaoComo(outroAdmin);
    const { error } = await sessao.rpc('alterar_valor_custo_fixo', { p_custo: custoId, p_de: '2026-08-01', p_valor: 1 });
    expect(error).not.toBeNull();

    const { data: periodos } = await supabaseAdmin.from('custos_fixos_periodos').select('valor').eq('custo_id', custoId);
    expect(periodos).toHaveLength(2);
  });

  test('terminar_custo_fixo: admin termina a partir de um mês', async () => {
    const sessao = await sessaoComo(admin);
    const { error } = await sessao.rpc('terminar_custo_fixo', { p_custo: custoId, p_a_partir_de: '2026-09-01' });
    expect(error).toBeNull();

    const { data: periodoAtivo } = await supabaseAdmin.from('custos_fixos_periodos').select('ate').eq('custo_id', custoId).is('ate', null);
    expect(periodoAtivo ?? []).toHaveLength(0);
  });

  test('terminar_custo_fixo: recusa um custo já terminado', async () => {
    const sessao = await sessaoComo(admin);
    const { error } = await sessao.rpc('terminar_custo_fixo', { p_custo: custoId, p_a_partir_de: '2026-10-01' });
    expect(error).not.toBeNull();
  });

  test('terminar_custo_fixo: recusa um custo de outro centro', async () => {
    const { data: outroCusto } = await supabaseAdmin
      .from('custos_fixos')
      .insert({ nome: 'Outro centro', categoria: 'Outros', centro_id: outroCentroId })
      .select('id')
      .single();
    await supabaseAdmin.from('custos_fixos_periodos').insert({ custo_id: outroCusto!.id, centro_id: outroCentroId, de: '2026-01-01', ate: null, valor: 10 });

    const sessao = await sessaoComo(admin); // admin do ZZTESTE, não do "outro centro"
    const { error } = await sessao.rpc('terminar_custo_fixo', { p_custo: outroCusto!.id, p_a_partir_de: '2026-02-01' });
    expect(error).not.toBeNull();

    await supabaseAdmin.from('custos_fixos').delete().eq('id', outroCusto!.id);
  });
});
