import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Total de alterações por ver do centro — mesma contagem usada pelo selo
 * "Alterações" na sidebar (app/admin/layout.tsx) e pelo separador "Por ver"
 * da própria página (app/admin/alteracoes), para nunca divergirem por
 * terem lógicas copiadas. Mesmo padrão de lib/notas.ts (contarNotasPendentes).
 */
export async function contarAlteracoesPorVer(supabase: SupabaseClient, centroId: string): Promise<number> {
  const { count } = await supabase
    .from('explicacoes_alteracoes')
    .select('id', { count: 'exact', head: true })
    .eq('centro_id', centroId)
    .is('vista_em', null);
  return count || 0;
}
