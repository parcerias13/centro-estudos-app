// Filtro por modalidade na escolha de alunos para uma explicação (sessão
// manual ou fixa) — por defeito só "só explicações" e "ambos"; "só sala de
// estudo" só entra com a caixa "Mostrar também os alunos de sala de
// estudo" ligada. Partilhado entre NovaExplicacaoModal
// (app/admin/explicacoes/page.tsx) e FormularioSerie
// (app/admin/explicacoes/_shared/fixasShared.tsx) para as duas escolhas
// nunca divergirem.

export type ModalidadeAluno = 'sala_estudo' | 'so_explicacoes' | 'ambos';

type AlunoComModalidade = {
  sala_estudo?: boolean | null;
  faz_explicacoes?: boolean | null;
};

// sala_estudo vem com default true e faz_explicacoes com default false na
// BD — ?? aqui é só para o instante entre o primeiro render e o fetch
// devolver, nunca deve refletir um valor real em falta.
export function modalidadeDoAluno(a: AlunoComModalidade): ModalidadeAluno {
  const salaEstudo = a.sala_estudo ?? true;
  const explicacoes = a.faz_explicacoes ?? false;
  if (salaEstudo && explicacoes) return 'ambos';
  if (explicacoes) return 'so_explicacoes';
  return 'sala_estudo';
}

// Nome por nome (como até agora) + a modalidade, exceto um aluno já
// escolhido — esse nunca desaparece da lista por causa da caixa estar
// desligada, para continuar visível e desmarcável mesmo depois de a caixa
// ser desligada com ele já escolhido.
export function filtrarAlunosParaExplicacao<T extends { id: string; nome: string } & AlunoComModalidade>(
  alunos: T[],
  busca: string,
  mostrarSalaEstudo: boolean,
  idsSelecionados: string[]
): T[] {
  const buscaMin = busca.toLowerCase();
  return alunos.filter((a) => {
    if (!a.nome.toLowerCase().includes(buscaMin)) return false;
    if (mostrarSalaEstudo || idsSelecionados.includes(a.id)) return true;
    return modalidadeDoAluno(a) !== 'sala_estudo';
  });
}

export const AVISO_ALUNO_SALA_ESTUDO =
  'Este aluno está registado só como sala de estudo. Atualiza a modalidade na ficha para as explicações ficarem bem identificadas em Pagamentos.';

export const SEM_RESULTADOS_SO_EXPLICACOES =
  'Nenhum aluno de explicações encontrado. Ativa «Mostrar também os alunos de sala de estudo» para procurar em todos.';
