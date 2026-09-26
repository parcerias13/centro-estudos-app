import { supabase } from '@/lib/supabase';

/**
 * Garante que existem linhas de `mensalidades` para o mês pedido.
 *
 * Se já existirem linhas para (ano, mes), devolve-as tal como estão (histórico
 * intocado). Se ainda não existirem, gera uma linha por cada aluno ativo, com
 * valor_esperado = mensalidade_base desse aluno neste instante (snapshot).
 *
 * Meses futuros (ano/mes > hoje) nunca são gerados — devolve [] sem escrever
 * nada, para não fixar prematuramente um valor que ainda pode mudar antes de
 * o mês chegar de verdade.
 *
 * Idempotente e seguro a chamadas concorrentes (upsert + ignoreDuplicates
 * sobre a constraint única aluno_id/ano/mes).
 *
 * Partilhada entre /admin/pagamentos, /admin/performance, e (futuro) o
 * extrato do encarregado — todos precisam exatamente da mesma garantia antes
 * de mostrar valores do mês.
 */
export async function garantirMesGerado(centro_id: string, ano: number, mes: number) {
  const hoje = new Date();
  const isFuturo = ano > hoje.getFullYear() || (ano === hoje.getFullYear() && mes > hoje.getMonth() + 1);
  if (isFuturo) return [];

  const { data: existentes, error: errExistentes } = await supabase
    .from('mensalidades')
    .select('*, alunos(nome)')
    .eq('ano', ano)
    .eq('mes', mes)
    .order('nome', { foreignTable: 'alunos' });

  if (errExistentes) throw errExistentes;
  if (existentes && existentes.length > 0) return existentes;

  const { data: alunosAtivos, error: errAlunos } = await supabase
    .from('alunos')
    .select('id, mensalidade_base')
    .eq('ativo', true);

  if (errAlunos) throw errAlunos;
  if (!alunosAtivos || alunosAtivos.length === 0) return [];

  const novasLinhas = alunosAtivos.map((a) => ({
    centro_id,
    aluno_id: a.id,
    ano,
    mes,
    valor_esperado: Number(a.mensalidade_base) || 0,
    pago: false,
  }));

  const { error: errGerar } = await supabase
    .from('mensalidades')
    .upsert(novasLinhas, { onConflict: 'aluno_id,ano,mes', ignoreDuplicates: true });

  if (errGerar) throw errGerar;

  const { data: geradas, error: errRefetch } = await supabase
    .from('mensalidades')
    .select('*, alunos(nome)')
    .eq('ano', ano)
    .eq('mes', mes)
    .order('nome', { foreignTable: 'alunos' });

  if (errRefetch) throw errRefetch;
  return geradas || [];
}
