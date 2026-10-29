import { supabase } from '@/lib/supabase';
import { getHojeLisboa } from '@/lib/dataLisboa';

type LinhaMensalidade = Record<string, any>;

const SELECT_LINHA = '*, alunos(nome)';

async function buscarLinhasDoMes(centro_id: string, ano: number, mes: number): Promise<LinhaMensalidade[]> {
  const { data, error } = await supabase
    .from('mensalidades')
    .select(SELECT_LINHA)
    .eq('centro_id', centro_id)
    .eq('ano', ano)
    .eq('mes', mes)
    .order('nome', { foreignTable: 'alunos' });
  if (error) throw error;
  return data || [];
}

/**
 * Núcleo partilhado por garantirMesGerado() e garantirMesGeradoComContagem():
 * só CRIA linhas de `mensalidades` em falta para o MÊS CORRENTE, em
 * Europe/Lisbon (via getHojeLisboa() — nunca new Date() local, que pode
 * discordar do fuso real do servidor/browser). Nunca toca nas linhas que já
 * existem (valor_esperado, pago, valor_pago ficam intocados).
 *
 * - Mês futuro: devolve [] sem criar nada — valor_esperado seria um
 *   snapshot da mensalidade_base de agora, que ainda pode mudar antes do
 *   mês chegar de verdade.
 * - Mês passado: devolve só as linhas que já existem, sem criar nenhuma —
 *   nunca "inventa" histórico para um mês que já fechou. Um aluno
 *   matriculado depois de um mês passado ter terminado não é tratado aqui;
 *   só conta a partir do mês em que entrar como corrente.
 * - Mês corrente: completa as linhas em falta — aluno ativo, com
 *   mensalidade_base > 0, que ainda não tem linha para (aluno_id, ano,
 *   mes). Isto corrige o bug de produção em que um aluno matriculado
 *   DEPOIS da primeira abertura de Pagamentos/Performance no mês nunca
 *   ganhava linha — o "se já existem linhas, devolve" de antes só gerava
 *   uma vez por mês, para sempre.
 *
 * Idempotente e seguro a chamadas concorrentes: insere por upsert com
 * ignoreDuplicates sobre a constraint única (aluno_id, ano, mes) — nunca um
 * insert simples, que rebentaria em corrida. .select() depois do upsert só
 * devolve as linhas que ESTE pedido conseguiu mesmo inserir (um ON CONFLICT
 * DO NOTHING do Postgres não devolve as que perderam a corrida), por isso
 * `criadas` é sempre a contagem real desta chamada, mesmo com outra a
 * correr ao mesmo tempo.
 */
async function garantirMesGeradoNucleo(
  centro_id: string,
  ano: number,
  mes: number
): Promise<{ linhas: LinhaMensalidade[]; criadas: number }> {
  const [anoAtual, mesAtual] = getHojeLisboa().split('-').map(Number);
  const isFuturo = ano > anoAtual || (ano === anoAtual && mes > mesAtual);
  if (isFuturo) return { linhas: [], criadas: 0 };

  const isPassado = ano < anoAtual || (ano === anoAtual && mes < mesAtual);
  if (isPassado) {
    const linhas = await buscarLinhasDoMes(centro_id, ano, mes);
    return { linhas, criadas: 0 };
  }

  // Só chega aqui para o mês corrente (Europe/Lisbon).
  const { data: existentes, error: errExistentes } = await supabase
    .from('mensalidades')
    .select('aluno_id')
    .eq('centro_id', centro_id)
    .eq('ano', ano)
    .eq('mes', mes);
  if (errExistentes) throw errExistentes;
  const idsComLinha = new Set((existentes || []).map((l: any) => l.aluno_id));

  // gt('mensalidade_base', 0) já exclui null e 0 ao mesmo tempo (comparação
  // com null é sempre desconhecida em SQL) — alunos "só explicações"
  // (mensalidade_base <= 0 ou nula) nunca ganham linha.
  const { data: alunosAtivos, error: errAlunos } = await supabase
    .from('alunos')
    .select('id, mensalidade_base')
    .eq('centro_id', centro_id)
    .eq('ativo', true)
    .gt('mensalidade_base', 0);
  if (errAlunos) throw errAlunos;

  const emFalta = (alunosAtivos || []).filter((a) => !idsComLinha.has(a.id));

  let criadas = 0;
  if (emFalta.length > 0) {
    const novasLinhas = emFalta.map((a) => ({
      centro_id,
      aluno_id: a.id,
      ano,
      mes,
      valor_esperado: Number(a.mensalidade_base) || 0,
      pago: false,
    }));

    const { data: inseridas, error: errGerar } = await supabase
      .from('mensalidades')
      .upsert(novasLinhas, { onConflict: 'aluno_id,ano,mes', ignoreDuplicates: true })
      .select('id');
    if (errGerar) throw errGerar;
    criadas = inseridas?.length ?? 0;
  }

  const linhas = await buscarLinhasDoMes(centro_id, ano, mes);
  return { linhas, criadas };
}

/**
 * Garante que existem linhas de `mensalidades` para o mês pedido, completando
 * as que faltam SÓ se for o mês corrente (ver garantirMesGeradoNucleo) —
 * nunca altera as existentes, e nunca cria nada para meses passados ou
 * futuros. Devolve a lista completa do mês (vazia, se o mês ainda não tem
 * nenhuma linha e não é o corrente). Partilhada entre /admin/pagamentos e
 * /admin/performance (mês corrente), e (futuro) o extrato do encarregado —
 * todos têm de ver exatamente o mesmo conjunto de linhas para o mesmo mês.
 */
export async function garantirMesGerado(centro_id: string, ano: number, mes: number): Promise<LinhaMensalidade[]> {
  const { linhas } = await garantirMesGeradoNucleo(centro_id, ano, mes);
  return linhas;
}

/**
 * Mesma garantia que garantirMesGerado(), mas devolve também quantas linhas
 * esta chamada em concreto criou — usado só em /admin/pagamentos, para
 * mostrar um aviso discreto ("Foram criadas N mensalidades em falta para
 * este mês") exatamente na abertura em que isso aconteceu. Fora do mês
 * corrente, `criadas` é sempre 0 (nunca se gera nada para um mês passado ou
 * futuro), por isso o aviso nunca aparece ao navegar para esses meses.
 */
export async function garantirMesGeradoComContagem(
  centro_id: string,
  ano: number,
  mes: number
): Promise<{ linhas: LinhaMensalidade[]; criadas: number }> {
  return garantirMesGeradoNucleo(centro_id, ano, mes);
}
