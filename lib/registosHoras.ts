import { instanteLisboaParaUTC } from '@/lib/dataLisboa';
import { mesParaData, somarMeses } from '@/lib/custos';

/**
 * Registo de horas de trabalho de um professor (registos_horas_professor) —
 * partilhado pelo Dashboard do professor (Turno de Hoje), pela página "Horas
 * de Trabalho" do professor e pela página equivalente da direção, para os
 * três nunca mostrarem números diferentes do mesmo registo. `minutos` vem já
 * calculado e arredondado pela base de dados (config_centro.arredondamento_
 * horas_min) — nunca recalculado nem arredondado aqui.
 */
export type OrigemRegistoHora = 'toque' | 'manual' | 'direcao';

export interface RegistoHoraProfessor {
  id: string;
  professorId: string;
  entrada: string; // timestamptz ISO
  saida: string | null; // timestamptz ISO, null = turno em aberto
  minutos: number | null; // null enquanto em aberto — nunca soma
  origem: OrigemRegistoHora;
}

/**
 * Janela exata em UTC que cobre o mês civil 'AAAA-MM' inteiro em
 * Europe/Lisbon — para filtrar registos_horas_professor.entrada por "este
 * mês em Lisboa" com um gte/lt direto, sem filtragem a mais no cliente (ao
 * contrário de janelaLarga em lib/dataLisboa.ts, feita para um único dia com
 * margem, aqui os dois limites são exatos porque vêm de
 * instanteLisboaParaUTC).
 */
export function janelaMesLisboa(mes: string): { inicio: string; fim: string } {
  return {
    inicio: instanteLisboaParaUTC(mesParaData(mes), '00:00'),
    fim: instanteLisboaParaUTC(mesParaData(somarMeses(mes, 1)), '00:00'),
  };
}

/** 'X h YY min' — os minutos nunca são recalculados, só formatados. */
export function formatarDuracao(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Soma dos registos já fechados (minutos != null) — um em aberto nunca soma. */
export function somaMinutosFechados(registos: { minutos: number | null }[]): number {
  return registos.reduce((acc, r) => acc + (r.minutos ?? 0), 0);
}

export function contarRegistosAbertos(registos: { saida: string | null }[]): number {
  return registos.filter((r) => r.saida === null).length;
}
