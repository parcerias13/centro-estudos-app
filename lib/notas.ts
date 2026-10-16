import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Regra de confirmação partilhada entre Notas de Testes (exams) e Notas de
 * Período (notas_periodo): professor ou admin a introduzir fica logo
 * confirmada; secretária (ou, no autorreporte do próprio aluno, fora deste
 * ficheiro) fica por confirmar. Não bloqueia nada sozinha — quem decide se
 * uma escrita pode ou não acontecer é a RLS e, no caso de o aluno tentar
 * sobrepor um valor já confirmado por staff, a lógica do próprio formulário
 * (ver app/agenda/page.tsx) — esta função só calcula o estado resultante.
 */
export function calcularEstadoNota(role: string | null, userId: string | null) {
  const confirmaAutomaticamente = role === 'admin' || role === 'professor';
  return {
    nota_confirmada: confirmaAutomaticamente,
    nota_confirmada_por: confirmaAutomaticamente ? userId : null,
    nota_confirmada_em: confirmaAutomaticamente ? new Date().toISOString() : null,
  };
}

/**
 * Escala não é mais escolha do utilizador — é sempre determinada pelo
 * ano_escolar do aluno no momento em que a nota é criada (snapshot).
 * ano_escolar nulo (não deveria acontecer, mas a coluna é nullable) trata-se
 * como básico por defeito, para nunca bloquear a escrita de uma nota.
 *
 * Básico (1º-9º): teste em 0-100, período em 1-5 (nunca 0 — não existe "Nível 0").
 * Secundário (10º-12º): teste e período em 0-20 (0 é nota válida nos dois).
 */
function eSecundario(anoEscolar: number | null | undefined): boolean {
  return anoEscolar != null && anoEscolar >= 10;
}

export function getEscalaTeste(anoEscolar: number | null | undefined) {
  return eSecundario(anoEscolar)
    ? { escala: '20' as const, min: 0, max: 20 }
    : { escala: '100' as const, min: 0, max: 100 };
}

export function getEscalaPeriodo(anoEscolar: number | null | undefined) {
  return eSecundario(anoEscolar)
    ? { escala: '20' as const, min: 0, max: 20 }
    : { escala: '5' as const, min: 1, max: 5 };
}

/**
 * Validação pura do valor digitado contra os limites da escala — sem I/O,
 * partilhada por quem confirma/corrige notas (Ficha do Aluno e a página
 * Notas). `permiteVazio` existe porque limpar o campo tem significados
 * diferentes consoante o chamador (ex.: em exams, limpar é um valor válido
 * que anula a nota; a página Notas nunca permite vazio).
 */
export type ValidacaoNota =
  | { ok: true; valor: number | null }
  | { ok: false; motivo: 'invalido' }
  | { ok: false; motivo: 'fora_da_escala'; min: number; max: number };

export function validarValorNota(
  valorStr: string,
  min: number,
  max: number,
  opcoes: { inteiro?: boolean; permiteVazio?: boolean } = {}
): ValidacaoNota {
  const { inteiro = false, permiteVazio = true } = opcoes;
  const bruto = valorStr.trim();
  if (bruto === '') {
    if (permiteVazio) return { ok: true, valor: null };
    return { ok: false, motivo: 'invalido' };
  }
  const valor = inteiro ? parseInt(bruto, 10) : parseFloat(bruto);
  if (isNaN(valor)) return { ok: false, motivo: 'invalido' };
  if (valor < min || valor > max) return { ok: false, motivo: 'fora_da_escala', min, max };
  return { ok: true, valor };
}

/**
 * Resultado comum das escritas abaixo. `erro_servidor` cobre tanto um erro
 * real do PostgREST como um silêncio da RLS (update/insert sem linhas
 * devolvidas) — nunca se assume sucesso só por não haver `error`.
 */
export type ResultadoEscritaNota =
  | { ok: true; data: any[] }
  | { ok: false; motivo: 'invalido' }
  | { ok: false; motivo: 'fora_da_escala'; min: number; max: number; escala: string }
  | { ok: false; motivo: 'erro_servidor'; mensagem: string };

function erroServidor(mensagem: string): ResultadoEscritaNota {
  return { ok: false, motivo: 'erro_servidor', mensagem };
}

/**
 * Total de notas por confirmar do centro — mesma contagem usada pelo badge
 * "Notas" na sidebar (app/admin/layout.tsx) e pelo separador "Por confirmar"
 * da própria página, para nunca divergirem por terem lógicas copiadas.
 */
export async function contarNotasPendentes(supabase: SupabaseClient, centroId: string): Promise<number> {
  const [{ count: examsCount }, { count: periodoCount }] = await Promise.all([
    supabase.from('exams').select('id', { count: 'exact', head: true }).eq('centro_id', centroId).eq('nota_confirmada', false).not('nota_valor', 'is', null),
    supabase.from('notas_periodo').select('id', { count: 'exact', head: true }).eq('centro_id', centroId).eq('nota_confirmada', false),
  ]);
  return (examsCount || 0) + (periodoCount || 0);
}

/**
 * Confirma uma nota de teste/período já existente. NUNCA envia
 * nota_confirmada_por nem nota_confirmada_em — os dois gatilhos do Supabase
 * assinam sempre com o utilizador e a hora reais do servidor, substituindo
 * qualquer valor vindo do cliente (verificado em sessão real); enviá-los
 * seria só ruído.
 */
export async function confirmarNotaTeste(supabase: SupabaseClient, examId: string): Promise<ResultadoEscritaNota> {
  const { data, error } = await supabase.from('exams').update({ nota_confirmada: true }).eq('id', examId).select();
  if (error) return erroServidor(error.message);
  if (!data || data.length === 0) return erroServidor('Não foi possível confirmar esta nota.');
  return { ok: true, data };
}

export async function confirmarNotaPeriodo(supabase: SupabaseClient, notaPeriodoId: string): Promise<ResultadoEscritaNota> {
  const { data, error } = await supabase.from('notas_periodo').update({ nota_confirmada: true }).eq('id', notaPeriodoId).select();
  if (error) return erroServidor(error.message);
  if (!data || data.length === 0) return erroServidor('Não foi possível confirmar esta nota.');
  return { ok: true, data };
}

/**
 * Corrige o valor de uma nota de teste já existente (exams) — usada pela
 * Ficha do Aluno (handleSalvarNotaTeste, onde confirmaAutomaticamente segue
 * calcularEstadoNota) e pela página Notas (onde é sempre true, só admin/
 * professor lá chegam). `nota_reportada_por` é sempre reescrito para quem
 * corrige, mesmo ao limpar o valor — replica o comportamento que a Ficha já
 * tinha antes desta extração.
 */
export async function corrigirNotaTeste(
  supabase: SupabaseClient,
  exam: { id: string; nota_escala: string | null },
  valorStr: string,
  anoEscolar: number | null | undefined,
  confirmaAutomaticamente: boolean,
  userId: string | null
): Promise<ResultadoEscritaNota> {
  const { escala, min, max } = getEscalaTeste(anoEscolar);
  const v = validarValorNota(valorStr, min, max, { permiteVazio: true });
  if (!v.ok) {
    if (v.motivo === 'invalido') return { ok: false, motivo: 'invalido' };
    return { ok: false, motivo: 'fora_da_escala', min: v.min, max: v.max, escala };
  }
  const payload: Record<string, any> = {
    nota_valor: v.valor,
    nota_escala: v.valor === null ? exam.nota_escala : escala,
    nota_reportada_por: userId,
    nota_confirmada: v.valor === null ? false : confirmaAutomaticamente,
  };
  const { data, error } = await supabase.from('exams').update(payload).eq('id', exam.id).select();
  if (error) return erroServidor(error.message);
  if (!data || data.length === 0) return erroServidor('Não foi possível guardar esta nota.');
  return { ok: true, data };
}

/**
 * Corrige o valor de uma nota de período JÁ EXISTENTE (notas_periodo) — a
 * Ficha continua a tratar à parte a criação de uma linha nova (upsert) e a
 * remoção ao limpar o campo (delete), que não fazem sentido na página Notas
 * (que só lista linhas já existentes). Nunca permite vazio — para limpar um
 * valor continua a ser preciso ir à Ficha.
 */
export async function corrigirNotaPeriodoExistente(
  supabase: SupabaseClient,
  linha: { id: string },
  valorStr: string,
  anoEscolar: number | null | undefined,
  confirmaAutomaticamente: boolean,
  userId: string | null
): Promise<ResultadoEscritaNota> {
  const { escala, min, max } = getEscalaPeriodo(anoEscolar);
  const v = validarValorNota(valorStr, min, max, { inteiro: true, permiteVazio: false });
  if (!v.ok) {
    if (v.motivo === 'invalido') return { ok: false, motivo: 'invalido' };
    return { ok: false, motivo: 'fora_da_escala', min: v.min, max: v.max, escala };
  }
  const payload = {
    nota: v.valor,
    nota_escala: escala,
    nota_reportada_por: userId,
    nota_confirmada: confirmaAutomaticamente,
  };
  const { data, error } = await supabase.from('notas_periodo').update(payload).eq('id', linha.id).select();
  if (error) return erroServidor(error.message);
  if (!data || data.length === 0) return erroServidor('Não foi possível guardar esta nota.');
  return { ok: true, data };
}
