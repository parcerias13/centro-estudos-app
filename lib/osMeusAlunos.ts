import type { SupabaseClient } from '@supabase/supabase-js';
import { differenceInCalendarDays } from 'date-fns';

// Lógica partilhada por "Os Meus Alunos" (app/admin/os-meus-alunos) e pelo
// realce "Fixo" na escolha de alunos de Nova Explicação
// (app/admin/explicacoes/page.tsx) — as duas precisam exatamente da mesma
// definição de "aluno fixo ativo de um professor", para nunca divergirem.

export type AlunoFixo = {
  alunoId: string;
  nome: string;
  anoEscolar: number | null;
  disciplinas: string[];
  serieIds: string[];
};

/**
 * Alunos fixos ATIVOS de um professor: séries dele com estado_validacao
 * diferente de 'recusada' (inclui 'por_validar' — já contam como fixos
 * mesmo antes de a direção validar) e sem data_fim, ou com data_fim ainda
 * não passada (hojeISO deve vir sempre de getHojeLisboa(), nunca de
 * new Date() local). Um aluno em mais de uma série do mesmo professor
 * aparece uma só vez, com as disciplinas todas juntas (sem duplicar).
 */
export async function buscarAlunosFixosAtivos(
  supabase: SupabaseClient,
  professorId: string,
  hojeISO: string
): Promise<AlunoFixo[]> {
  const { data, error } = await supabase
    .from('series_explicacoes')
    .select('id, data_fim, estado_validacao, subjects(name), series_explicacoes_alunos(aluno_id, alunos(nome, ano_escolar))')
    .eq('professor_id', professorId)
    .neq('estado_validacao', 'recusada');

  if (error) throw error;

  const porAluno = new Map<string, AlunoFixo>();
  for (const serie of (data || []) as any[]) {
    if (serie.data_fim && serie.data_fim < hojeISO) continue;
    const disciplina = (Array.isArray(serie.subjects) ? serie.subjects[0] : serie.subjects)?.name ?? null;
    for (const sa of serie.series_explicacoes_alunos || []) {
      const aluno = Array.isArray(sa.alunos) ? sa.alunos[0] : sa.alunos;
      if (!aluno) continue;
      const existente = porAluno.get(sa.aluno_id);
      if (existente) {
        if (!existente.serieIds.includes(serie.id)) existente.serieIds.push(serie.id);
        if (disciplina && !existente.disciplinas.includes(disciplina)) existente.disciplinas.push(disciplina);
      } else {
        porAluno.set(sa.aluno_id, {
          alunoId: sa.aluno_id,
          nome: aluno.nome,
          anoEscolar: aluno.ano_escolar ?? null,
          disciplinas: disciplina ? [disciplina] : [],
          serieIds: [serie.id],
        });
      }
    }
  }
  return Array.from(porAluno.values());
}

export function idsDeAlunosFixos(fixos: AlunoFixo[]): Set<string> {
  return new Set(fixos.map((f) => f.alunoId));
}

/** "Nome · 7.º ano" — mesmo rótulo usado em toda a área de Explicações. */
export function rotuloAlunoFixo(nome: string, anoEscolar: number | null | undefined): string {
  return anoEscolar ? `${nome} · ${anoEscolar}.º ano` : nome;
}

/**
 * Dias entre hoje (hojeISO, de getHojeLisboa()) e uma data (yyyy-MM-dd) —
 * nunca com new Date() local nem toISOString(), só com os dois ISO já
 * calculados em Europe/Lisbon por quem chama. Positivo = no futuro.
 */
export function diasAteData(dataISO: string, hojeISO: string): number {
  return differenceInCalendarDays(new Date(`${dataISO}T00:00:00`), new Date(`${hojeISO}T00:00:00`));
}

export const TESTE_AMBAR_LIMITE_DIAS = 7;

/** "hoje" / "amanhã" / "em N dias" — usado a seguir a "Teste de {disciplina}". */
export function rotuloDiasTeste(dias: number): string {
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  return `em ${dias} dias`;
}
