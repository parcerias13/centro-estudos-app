// Materiais de estudo por disciplina/ano (app/admin/disciplinas) — bucket
// "materiais", continua PÚBLICO (resources.url guarda o URL público
// completo, como já acontecia). Só PDF é aceite; a extensão do caminho
// vem sempre do tipo MIME validado, nunca do nome do ficheiro escolhido —
// mesmo padrão de lib/avataresAlunos.ts e lib/materialAluno.ts.
export const BUCKET_MATERIAIS = 'materiais';

export const TAMANHO_MAXIMO_BYTES = 25 * 1024 * 1024; // 25 MB — igual ao limite configurado no bucket

export const TIPOS_PERMITIDOS_MATERIAL_DISCIPLINA = {
  'application/pdf': 'pdf',
} as const;
export type TipoPermitidoMaterialDisciplina = keyof typeof TIPOS_PERMITIDOS_MATERIAL_DISCIPLINA;

export const ACCEPT_MATERIAL_DISCIPLINA = Object.keys(TIPOS_PERMITIDOS_MATERIAL_DISCIPLINA).join(',');

/** null = válido; string = motivo da rejeição, em português, para mostrar inline. */
export function validarFicheiroMaterialDisciplina(file: File): string | null {
  if (!(file.type in TIPOS_PERMITIDOS_MATERIAL_DISCIPLINA)) {
    return `Tipo de ficheiro não permitido${file.type ? ` (${file.type})` : ''}. Só PDF.`;
  }
  if (file.size > TAMANHO_MAXIMO_BYTES) {
    return 'Ficheiro demasiado grande (máx. 25 MB).';
  }
  return null;
}

/** `${centroId}/uploads/{sufixo}.{ext do tipo validado}`. */
export function construirCaminhoMaterialDisciplina(
  centroId: string,
  tipo: TipoPermitidoMaterialDisciplina
): string {
  const extensao = TIPOS_PERMITIDOS_MATERIAL_DISCIPLINA[tipo];
  return `${centroId}/uploads/${Math.random()}.${extensao}`;
}
