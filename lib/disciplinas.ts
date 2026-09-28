/**
 * Decide que disciplinas se mostram para um ano escolar. Substitui as 3
 * cópias da mesma expressão (app/page.tsx, ficha/page.tsx, notas/page.tsx).
 *
 * Regra: disciplina sem anos_aplicaveis (null ou vazio) aparece a todos os
 * anos; com anos definidos, só aos anos listados.
 *
 * Aluno com ano_escolar nulo vê TODAS as disciplinas — rede de segurança
 * deliberada (nunca esconder por falta de dado). Isto muda o comportamento
 * anterior dos 3 sítios acima, que só mostravam as disciplinas sem
 * restrição a um aluno sem ano.
 *
 * `idsHistorico` (opcional): ids de disciplinas com histórico já lançado
 * (ex: notas_periodo) que devem continuar na lista mesmo que já não se
 * apliquem ao ano atual — usa foraDoAno() para saber quais precisam do
 * aviso "fora do ano" na UI.
 */
export function disciplinasParaAno<T extends { id: number | string; anos_aplicaveis?: number[] | null }>(
  subjects: T[],
  ano: number | null | undefined,
  idsHistorico: Array<number | string> = []
): T[] {
  const idsHistoricoSet = new Set(idsHistorico);
  return subjects.filter(
    (s) =>
      ano == null ||
      !s.anos_aplicaveis ||
      s.anos_aplicaveis.length === 0 ||
      s.anos_aplicaveis.includes(ano) ||
      idsHistoricoSet.has(s.id)
  );
}

/**
 * Uma disciplina já não se aplica ao ano atual do aluno, mas continua
 * visível só por causa do histórico (ver idsHistorico acima). Usa para
 * mostrar o aviso "fora do ano" junto dessa disciplina.
 */
export function foraDoAno<T extends { anos_aplicaveis?: number[] | null }>(
  subject: T,
  ano: number | null | undefined
): boolean {
  if (ano == null) return false;
  if (!subject.anos_aplicaveis || subject.anos_aplicaveis.length === 0) return false;
  return !subject.anos_aplicaveis.includes(ano);
}

/**
 * Disciplinas comuns a vários alunos ao mesmo tempo (Agendar Teste, Nova
 * Explicação) — só as que se aplicam a TODOS os anos da seleção. Sem
 * alunos selecionados (anos vazio), devolve a lista completa (nada para
 * restringir ainda).
 */
export function disciplinasComuns<T extends { id: number | string; anos_aplicaveis?: number[] | null }>(
  subjects: T[],
  anos: Array<number | null | undefined>
): T[] {
  if (anos.length === 0) return subjects;
  return subjects.filter((s) => anos.every((ano) => disciplinasParaAno([s], ano).length > 0));
}
