import type { SupabaseClient } from '@supabase/supabase-js';

export type FaturacaoAluno = {
  mensalidadeBase?: number | null;
  nifEncarregado?: string | null;
  moradaEncarregado?: string | null;
};

/**
 * Grava mensalidade/NIF/morada de um aluno em alunos_faturacao com a chave
 * de serviço, para preparar cenários de teste (a produção faz isto pela UI
 * de Editar Aluno ou pela API de criação). alunos_faturacao tem aluno_id
 * com FK para alunos e ON DELETE CASCADE — não precisa de limpeza própria,
 * desaparece quando o aluno é apagado no afterAll de cada spec.
 */
export async function definirFaturacaoAluno(
  supabaseAdmin: SupabaseClient,
  alunoId: string,
  centroId: string,
  dados: FaturacaoAluno
): Promise<void> {
  const { error } = await supabaseAdmin.from('alunos_faturacao').upsert(
    {
      aluno_id: alunoId,
      centro_id: centroId,
      mensalidade_base: dados.mensalidadeBase ?? 0,
      nif_encarregado: dados.nifEncarregado ?? null,
      morada_encarregado: dados.moradaEncarregado ?? null,
    },
    { onConflict: 'aluno_id' }
  );
  if (error) throw new Error(`definir faturação aluno ${alunoId}: ${error.message}`);
}
