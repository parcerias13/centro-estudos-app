import type { SupabaseClient } from '@supabase/supabase-js';

export type TarifaStaff = {
  tipo: 'fixo' | 'por_hora';
  valor: number;
  escalaAluno?: boolean;
};

/**
 * Grava a tarifa de um professor em staff_remuneracao com a chave de
 * serviço, para preparar cenários de teste (a produção faz isto pela UI de
 * Equipa). staff_remuneracao tem staff_id com FK para staff e ON DELETE
 * CASCADE — não precisa de limpeza própria, desaparece quando o staff é
 * apagado no afterAll de cada spec.
 */
export async function definirTarifaStaff(
  supabaseAdmin: SupabaseClient,
  staffId: string,
  centroId: string,
  tarifa: TarifaStaff
): Promise<void> {
  const { error } = await supabaseAdmin.from('staff_remuneracao').upsert(
    {
      staff_id: staffId,
      centro_id: centroId,
      tarifa_tipo: tarifa.tipo,
      tarifa_valor: tarifa.valor,
      tarifa_escala_aluno: tarifa.escalaAluno ?? false,
    },
    { onConflict: 'staff_id' }
  );
  if (error) throw new Error(`definir tarifa staff ${staffId}: ${error.message}`);
}
