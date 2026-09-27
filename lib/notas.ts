/**
 * Regra de confirmação partilhada entre Notas de Testes (exams) e Notas de
 * Período (notas_periodo): professor ou admin a introduzir fica logo
 * confirmada; secretária (ou, no autorreporte do próprio aluno, fora deste
 * ficheiro) fica por confirmar. Não bloqueia nada sozinha — quem decide se
 * uma escrita pode ou não acontecer é a RLS e, no caso de o aluno tentar
 * sobrepor um valor já confirmado por staff, a lógica do próprio formulário
 * (ver app/agenda/page.tsx) — esta função só calcula o estado resultante.
 */
export function calcularEstadoNota(role: string | null, userId: string | null) {
  const confirmaAutomaticamente = role === 'admin' || role === 'professor';
  return {
    nota_confirmada: confirmaAutomaticamente,
    nota_confirmada_por: confirmaAutomaticamente ? userId : null,
    nota_confirmada_em: confirmaAutomaticamente ? new Date().toISOString() : null,
  };
}

/**
 * Escala não é mais escolha do utilizador — é sempre determinada pelo
 * ano_escolar do aluno no momento em que a nota é criada (snapshot).
 * ano_escolar nulo (não deveria acontecer, mas a coluna é nullable) trata-se
 * como básico por defeito, para nunca bloquear a escrita de uma nota.
 *
 * Básico (1º-9º): teste em 0-100, período em 1-5 (nunca 0 — não existe "Nível 0").
 * Secundário (10º-12º): teste e período em 0-20 (0 é nota válida nos dois).
 */
function eSecundario(anoEscolar: number | null | undefined): boolean {
  return anoEscolar != null && anoEscolar >= 10;
}

export function getEscalaTeste(anoEscolar: number | null | undefined) {
  return eSecundario(anoEscolar)
    ? { escala: '20' as const, min: 0, max: 20 }
    : { escala: '100' as const, min: 0, max: 100 };
}

export function getEscalaPeriodo(anoEscolar: number | null | undefined) {
  return eSecundario(anoEscolar)
    ? { escala: '20' as const, min: 0, max: 20 }
    : { escala: '5' as const, min: 1, max: 5 };
}
