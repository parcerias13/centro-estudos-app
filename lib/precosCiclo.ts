import { supabase } from '@/lib/supabase';

/**
 * Preços das explicações por ciclo (precos_explicacoes_ciclo) — o preço que
 * cada aluno paga quando NÃO há um preço de disciplina em
 * precos_explicacoes_familia para ele (esse continua a passar à frente,
 * decisão do gatilho calcular_valores_explicacao, nunca reimplementada
 * aqui). Mudar um preço aqui nunca recalcula sessões já dadas — só as
 * próximas sessões a ser marcadas como dadas usam o valor novo.
 *
 * Não existe no projeto nenhum "ajudante de ciclo" reutilizável (a
 * constante CICLOS em app/admin/disciplinas/page.tsx é só um agrupador de
 * botões 1º-12º ano para a UI de disciplinas, sem mapear para os valores
 * '1_ciclo'/'2_ciclo'/'3_ciclo'/'secundario' da base de dados) — por isso o
 * mapeamento vive aqui, de propósito, para ser a única fonte.
 */

export type Ciclo = '1_ciclo' | '2_ciclo' | '3_ciclo' | 'secundario';
export type TipoPrecoCiclo = 'fixo' | 'por_hora';

export interface PrecoCiclo {
  id?: string;
  ciclo: Ciclo;
  alunosAPartirDe: number;
  tipo: TipoPrecoCiclo;
  valor: number;
}

/** Linha do formulário da tabela — um ciclo, os dois campos editáveis em texto. */
export interface LinhaCicloFormulario {
  ciclo: Ciclo;
  individual: string;
  grupo: string;
}

export const CICLOS_INFO: { ciclo: Ciclo; label: string; anos: string }[] = [
  { ciclo: '1_ciclo', label: '1.º Ciclo', anos: '1.º ao 4.º ano' },
  { ciclo: '2_ciclo', label: '2.º Ciclo', anos: '5.º e 6.º ano' },
  { ciclo: '3_ciclo', label: '3.º Ciclo', anos: '7.º ao 9.º ano' },
  { ciclo: 'secundario', label: 'Secundário', anos: '10.º ao 12.º ano' },
];

export const LABEL_CICLO: Record<Ciclo, string> = {
  '1_ciclo': '1.º Ciclo',
  '2_ciclo': '2.º Ciclo',
  '3_ciclo': '3.º Ciclo',
  secundario: 'Secundário',
};

/** Ano escolar (1 a 12) -> ciclo. 1-4 = 1º ciclo, 5-6 = 2º ciclo, 7-9 = 3º ciclo, 10-12 = secundário. */
export function cicloDoAno(anoEscolar: number): Ciclo {
  if (anoEscolar <= 4) return '1_ciclo';
  if (anoEscolar <= 6) return '2_ciclo';
  if (anoEscolar <= 9) return '3_ciclo';
  return 'secundario';
}

/**
 * Mesma escolha do gatilho calcular_valores_explicacao: a linha com o maior
 * alunos_a_partir_de que não excede numAlunos. Sem nenhuma linha aplicável
 * (ex: ciclo sem preço individual), devolve null.
 */
export function escolherPrecoPorAlunos<T extends { alunosAPartirDe: number }>(
  precos: T[],
  numAlunos: number
): T | null {
  const candidatos = precos.filter((p) => p.alunosAPartirDe <= numAlunos);
  if (candidatos.length === 0) return null;
  return candidatos.reduce((maior, atual) => (atual.alunosAPartirDe > maior.alunosAPartirDe ? atual : maior));
}

/** 'por_hora' multiplica pelas horas dadas; 'fixo' é por sessão (ignora as horas). */
export function valorCobrado(preco: { tipo: TipoPrecoCiclo; valor: number }, horas: number): number {
  return preco.tipo === 'por_hora' ? preco.valor * horas : preco.valor;
}

/**
 * Aceita vírgula ou ponto como separador decimal, até 2 casas. '' -> null
 * (campo vazio, nunca um erro). Texto não numérico ou com mais de 2 casas
 * decimais -> null também — quem chama decide se null significa "vazio" ou
 * "inválido" (ver validarLinhasCiclo, que distingue os dois).
 */
export function parseValorEuro(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.');
  if (limpo === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) return null;
  const valor = Number(limpo);
  return Number.isFinite(valor) ? valor : null;
}

export function valorEuroValido(valor: number): boolean {
  return valor >= 0 && valor <= 999.99;
}

/** 16.5 -> '16,50' — para pré-preencher os campos no formato pt-PT. */
export function formatarValorPtPt(valor: number): string {
  return valor.toFixed(2).replace('.', ',');
}

/** '16,00 €' / '16,00 € / hora' — para o simulador e mensagens, nunca para gravar. */
export function formatarEuroPtPt(valor: number, sufixo?: string): string {
  return `${formatarValorPtPt(valor)} €${sufixo ? ` / ${sufixo}` : ''}`;
}

/** Linhas do centro, agrupadas em { porCiclo, extra } — extra = alunos_a_partir_de > 2, nunca editados aqui. */
export function agruparPrecosCiclo(precos: PrecoCiclo[]): {
  porCiclo: Record<Ciclo, { individual: PrecoCiclo | null; grupo: PrecoCiclo | null }>;
  extra: PrecoCiclo[];
} {
  const porCiclo: Record<Ciclo, { individual: PrecoCiclo | null; grupo: PrecoCiclo | null }> = {
    '1_ciclo': { individual: null, grupo: null },
    '2_ciclo': { individual: null, grupo: null },
    '3_ciclo': { individual: null, grupo: null },
    secundario: { individual: null, grupo: null },
  };
  const extra: PrecoCiclo[] = [];
  for (const p of precos) {
    if (p.alunosAPartirDe === 1) porCiclo[p.ciclo].individual = p;
    else if (p.alunosAPartirDe === 2) porCiclo[p.ciclo].grupo = p;
    else extra.push(p);
  }
  return { porCiclo, extra };
}

export async function obterPrecosCiclo(centroId: string): Promise<PrecoCiclo[]> {
  const { data, error } = await supabase
    .from('precos_explicacoes_ciclo')
    .select('id, ciclo, alunos_a_partir_de, tipo, valor')
    .eq('centro_id', centroId)
    .order('ciclo')
    .order('alunos_a_partir_de');
  if (error) throw error;
  return (data || []).map((p: any) => ({
    id: p.id,
    ciclo: p.ciclo,
    alunosAPartirDe: Number(p.alunos_a_partir_de),
    tipo: p.tipo,
    valor: Number(p.valor),
  }));
}

/**
 * Erro de validação por linha ({ individual, grupo }) — texto não vazio e
 * não reconhecido como euro, ou fora de 0..999,99. Nunca valida o "grupo >
 * individual" aqui (isso é aviso, não bloqueio — ver o chamador).
 */
export function validarLinhasCiclo(
  linhas: LinhaCicloFormulario[]
): Record<Ciclo, { individual?: string; grupo?: string }> {
  const erros = {} as Record<Ciclo, { individual?: string; grupo?: string }>;
  for (const linha of linhas) {
    const erroLinha: { individual?: string; grupo?: string } = {};
    for (const campo of ['individual', 'grupo'] as const) {
      const texto = linha[campo].trim();
      if (texto === '') continue;
      const valor = parseValorEuro(texto);
      if (valor === null) {
        erroLinha[campo] = 'Indica um valor válido (ex: 16,00).';
      } else if (!valorEuroValido(valor)) {
        erroLinha[campo] = 'Tem de estar entre 0 e 999,99.';
      }
    }
    if (erroLinha.individual || erroLinha.grupo) erros[linha.ciclo] = erroLinha;
  }
  return erros;
}

/**
 * Grava os preços do centro numa única operação de upsert (todas as linhas
 * a existir: individual/grupo de cada ciclo com texto válido, mais os
 * escalões extra — preservados com o seu valor, só o tipo acompanha a
 * escolha global) e, a seguir, um único delete das linhas que passaram a
 * vazio. Pressupõe que `linhas` já passou por validarLinhasCiclo sem erros —
 * nunca chamar com texto inválido (seria tratado como vazio = apagar).
 */
export async function guardarPrecosCiclo(
  centroId: string,
  linhas: LinhaCicloFormulario[],
  tipo: TipoPrecoCiclo,
  escaloesExtra: PrecoCiclo[]
): Promise<void> {
  const upsertRows: { centro_id: string; ciclo: Ciclo; alunos_a_partir_de: number; tipo: TipoPrecoCiclo; valor: number }[] = [];
  const paraApagar: { ciclo: Ciclo; alunosAPartirDe: number }[] = [];

  for (const linha of linhas) {
    const individual = parseValorEuro(linha.individual);
    const grupo = parseValorEuro(linha.grupo);

    if (individual === null) {
      paraApagar.push({ ciclo: linha.ciclo, alunosAPartirDe: 1 });
      paraApagar.push({ ciclo: linha.ciclo, alunosAPartirDe: 2 });
      continue;
    }

    upsertRows.push({ centro_id: centroId, ciclo: linha.ciclo, alunos_a_partir_de: 1, tipo, valor: individual });

    if (grupo !== null) {
      upsertRows.push({ centro_id: centroId, ciclo: linha.ciclo, alunos_a_partir_de: 2, tipo, valor: grupo });
    } else {
      paraApagar.push({ ciclo: linha.ciclo, alunosAPartirDe: 2 });
    }
  }

  for (const extra of escaloesExtra) {
    upsertRows.push({ centro_id: centroId, ciclo: extra.ciclo, alunos_a_partir_de: extra.alunosAPartirDe, tipo, valor: extra.valor });
  }

  if (upsertRows.length > 0) {
    const { error: erroUpsert } = await supabase
      .from('precos_explicacoes_ciclo')
      .upsert(upsertRows, { onConflict: 'centro_id,ciclo,alunos_a_partir_de' });
    if (erroUpsert) throw erroUpsert;
  }

  if (paraApagar.length > 0) {
    const filtro = paraApagar.map((c) => `and(ciclo.eq.${c.ciclo},alunos_a_partir_de.eq.${c.alunosAPartirDe})`).join(',');
    const { error: erroApagar } = await supabase
      .from('precos_explicacoes_ciclo')
      .delete()
      .eq('centro_id', centroId)
      .or(filtro);
    if (erroApagar) throw erroApagar;
  }
}
