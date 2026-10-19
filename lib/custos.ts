import { supabase } from '@/lib/supabase';

/**
 * Custos fixos e variáveis do centro — cálculo partilhado por Gestão
 * (ecrã "Custos") e Performance, para os números nunca divergirem (mesma
 * lição do extrato). Nada aqui depende de `new Date()` local: meses são
 * sempre strings 'AAAA-MM' (comparação lexicográfica == comparação
 * cronológica) e aritmética de meses é feita com inteiros, nunca com Date.
 */

export interface PeriodoCustoFixo {
  id?: string;
  de: string; // 'AAAA-MM-DD', sempre o 1.º dia de um mês
  ate: string | null; // 'AAAA-MM-DD' (1.º dia do último mês) ou null = ainda ativo
  valor: number;
}

export interface CustoFixoComPeriodos {
  id: string;
  nome: string;
  categoria: string;
  periodos: PeriodoCustoFixo[];
}

export type EstadoCustoFixo = 'ativo' | 'nao_comecou' | 'terminado';

export interface EstadoCustoFixoNoMes {
  estado: EstadoCustoFixo;
  valor: number | null;
  terminouEm?: string; // 'AAAA-MM', só quando estado === 'terminado'
}

export interface CustoFixoNoMes extends EstadoCustoFixoNoMes {
  id: string;
  nome: string;
  categoria: string;
  periodos: PeriodoCustoFixo[];
}

export interface DespesaVariavel {
  id: string;
  categoria: string;
  descricao: string | null;
  valor: number;
  data: string; // 'AAAA-MM-DD'
}

export interface CustosDoMes {
  fixos: CustoFixoNoMes[];
  variaveis: DespesaVariavel[];
  totalFixos: number;
  totalVariaveis: number;
  totalGeral: number;
}

// --- Aritmética de meses (strings 'AAAA-MM', sem Date) ---

export function mesParaIndice(mes: string): number {
  const [ano, m] = mes.split('-').map(Number);
  return ano * 12 + (m - 1);
}

export function indiceParaMes(indice: number): string {
  const ano = Math.floor(indice / 12);
  const m = (indice % 12) + 1;
  return `${ano}-${String(m).padStart(2, '0')}`;
}

export function somarMeses(mes: string, delta: number): string {
  return indiceParaMes(mesParaIndice(mes) + delta);
}

function anoBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

const DIAS_POR_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Último dia real do mês 'AAAA-MM', sem usar Date (cobre anos bissextos). */
export function ultimoDiaDoMes(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  const dias = m === 2 && anoBissexto(ano) ? 29 : DIAS_POR_MES[m - 1];
  return `${mes}-${String(dias).padStart(2, '0')}`;
}

/** 'AAAA-MM' -> 'AAAA-MM-01' (1.º dia do mês), formato usado em `de`/`ate`. */
export function mesParaData(mes: string): string {
  return `${mes}-01`;
}

// --- Cálculo puro ---

/** Valor de um custo fixo num mês, ou null se não houver período ativo nesse mês. */
export function valorNoMes(periodos: PeriodoCustoFixo[], mes: string): number | null {
  const periodo = periodos.find((p) => {
    const de = p.de.slice(0, 7);
    const ate = p.ate ? p.ate.slice(0, 7) : null;
    return de <= mes && (ate === null || ate >= mes);
  });
  return periodo ? Number(periodo.valor) : null;
}

/**
 * Estado de um custo fixo num mês: 'ativo' (com o valor desse mês),
 * 'nao_comecou' (o mês é anterior ao 1.º período) ou 'terminado' (o mês é
 * posterior ao último período que cobriu algum mês antes dele).
 */
export function estadoCustoFixoNoMes(periodos: PeriodoCustoFixo[], mes: string): EstadoCustoFixoNoMes {
  if (periodos.length === 0) return { estado: 'nao_comecou', valor: null };

  const valor = valorNoMes(periodos, mes);
  if (valor !== null) return { estado: 'ativo', valor };

  const primeiraDe = periodos.reduce(
    (min, p) => (p.de.slice(0, 7) < min ? p.de.slice(0, 7) : min),
    periodos[0].de.slice(0, 7)
  );
  if (mes < primeiraDe) return { estado: 'nao_comecou', valor: null };

  const atesAnteriores = periodos
    .map((p) => (p.ate ? p.ate.slice(0, 7) : null))
    .filter((a): a is string => a !== null && a < mes)
    .sort();
  const terminouEm = atesAnteriores.length > 0 ? atesAnteriores[atesAnteriores.length - 1] : undefined;
  return { estado: 'terminado', valor: null, terminouEm };
}

/**
 * Lista de meses 'AAAA-MM' a mostrar no seletor: do mais antigo com dados
 * até ao mês atual, nunca mais do que `limiteMeses` (default 12) para trás.
 * Sem dados nenhuns, mostra os últimos `limiteMeses` meses por defeito.
 */
export function listaDeMeses(mesesComDados: string[], mesAtual: string, limiteMeses = 12): string[] {
  const indiceAtual = mesParaIndice(mesAtual);
  const indiceLimite = indiceAtual - (limiteMeses - 1);
  const indiceMaisAntigo =
    mesesComDados.length > 0 ? Math.min(...mesesComDados.map(mesParaIndice)) : indiceLimite;
  const indiceInicio = Math.max(indiceLimite, indiceMaisAntigo);

  const meses: string[] = [];
  for (let i = indiceInicio; i <= indiceAtual; i++) meses.push(indiceParaMes(i));
  return meses;
}

/** Totais e detalhe de um mês, a partir de dados já carregados (sem Supabase). */
export function calcularCustosDoMes(
  custosFixos: CustoFixoComPeriodos[],
  despesasVariaveisDoMes: DespesaVariavel[],
  mes: string
): CustosDoMes {
  const fixos: CustoFixoNoMes[] = custosFixos.map((c) => ({
    id: c.id,
    nome: c.nome,
    categoria: c.categoria,
    periodos: c.periodos,
    ...estadoCustoFixoNoMes(c.periodos, mes),
  }));

  const totalFixos = fixos.reduce((acc, f) => acc + (f.valor ?? 0), 0);
  const totalVariaveis = despesasVariaveisDoMes.reduce((acc, d) => acc + (Number(d.valor) || 0), 0);

  return {
    fixos,
    variaveis: despesasVariaveisDoMes,
    totalFixos,
    totalVariaveis,
    totalGeral: totalFixos + totalVariaveis,
  };
}

/** Mensagem simples para os erros mais comuns das tabelas/funções de custos. */
export function mensagemErroCusto(error: { code?: string; message: string }): string {
  if (error.code === '23P01') return 'Já existe um valor para esse mês.';
  return error.message;
}

// --- Leitura (cliente do utilizador, nunca chave de serviço) ---

/**
 * Busca e calcula os custos de um mês para um centro. Usada por Gestão
 * (ecrã "Custos") e por Performance — a mesma função, para os dois nunca
 * mostrarem números diferentes.
 */
export async function obterCustosDoMes(centroId: string, mes: string): Promise<CustosDoMes> {
  const inicioMes = mesParaData(mes);
  const fimMes = ultimoDiaDoMes(mes);

  const [{ data: custosFixosRaw, error: errFixos }, { data: despesasRaw, error: errDesp }] = await Promise.all([
    supabase
      .from('custos_fixos')
      .select('id, nome, categoria, custos_fixos_periodos(id, de, ate, valor)')
      .eq('centro_id', centroId),
    supabase
      .from('despesas')
      .select('id, categoria, descricao, valor, data')
      .eq('centro_id', centroId)
      .eq('tipo', 'variavel')
      .gte('data', inicioMes)
      .lte('data', fimMes)
      .order('data', { ascending: false }),
  ]);

  if (errFixos) throw errFixos;
  if (errDesp) throw errDesp;

  const custosFixos: CustoFixoComPeriodos[] = (custosFixosRaw || []).map((c: any) => ({
    id: c.id,
    nome: c.nome,
    categoria: c.categoria,
    periodos: (c.custos_fixos_periodos || []).map((p: any) => ({
      id: p.id,
      de: p.de,
      ate: p.ate,
      valor: Number(p.valor),
    })),
  }));

  return calcularCustosDoMes(custosFixos, despesasRaw || [], mes);
}

/** Todos os meses 'AAAA-MM' com algum custo fixo (por `de`) ou despesa variável (por `data`). */
export async function obterMesesComDados(centroId: string): Promise<string[]> {
  const [{ data: periodos, error: errPeriodos }, { data: despesas, error: errDesp }] = await Promise.all([
    supabase.from('custos_fixos_periodos').select('de').eq('centro_id', centroId),
    supabase.from('despesas').select('data').eq('centro_id', centroId).eq('tipo', 'variavel'),
  ]);

  if (errPeriodos) throw errPeriodos;
  if (errDesp) throw errDesp;

  const meses = new Set<string>();
  for (const p of periodos || []) meses.add(String(p.de).slice(0, 7));
  for (const d of despesas || []) meses.add(String(d.data).slice(0, 7));
  return [...meses];
}
