import type { SupabaseClient } from '@supabase/supabase-js';
import { higienizarNomeFicheiro, simplificarNomeParaCaminho } from '@/lib/mensagensAnexos';

// Material por aluno (fichas, resumos, apontamentos) carregado pelo
// professor para um dos seus alunos fixos ativos. Bucket PRIVADO
// "material-alunos" e tabela public.material_aluno já existem, com RLS
// aplicada diretamente na base de dados (ver CLAUDE.md da feature) — este
// ficheiro só decide o que é um ficheiro válido e como se chama no bucket;
// a aplicação real continua a ser a RLS do lado do servidor.
export const BUCKET_MATERIAL = 'material-alunos';

export const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10 MB
const TITULO_MAX = 120;
const NOTA_MAX = 500;

export const TIPOS_PERMITIDOS_MATERIAL = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export type TipoPermitidoMaterial = (typeof TIPOS_PERMITIDOS_MATERIAL)[number];

type ConfigTipo = {
  /** Extensões aceitáveis no NOME ORIGINAL para este mime type (minúsculas, sem ponto). */
  extensoesOriginalPermitidas: string[];
  /** Extensão usada no CAMINHO do bucket — vem sempre daqui, nunca do nome original. */
  extensaoCaminho: string;
  /** Primeiros bytes esperados no ficheiro, para detetar um tipo declarado a mentir. */
  assinatura: number[];
};

const CONFIG_TIPOS: Record<TipoPermitidoMaterial, ConfigTipo> = {
  'application/pdf': {
    extensoesOriginalPermitidas: ['pdf'],
    extensaoCaminho: 'pdf',
    assinatura: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  },
  'image/jpeg': {
    extensoesOriginalPermitidas: ['jpg', 'jpeg'],
    extensaoCaminho: 'jpg',
    assinatura: [0xff, 0xd8, 0xff],
  },
  'image/png': {
    extensoesOriginalPermitidas: ['png'],
    extensaoCaminho: 'png',
    assinatura: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  'application/msword': {
    extensoesOriginalPermitidas: ['doc'],
    extensaoCaminho: 'doc',
    assinatura: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extensoesOriginalPermitidas: ['docx'],
    extensaoCaminho: 'docx',
    assinatura: [0x50, 0x4b, 0x03, 0x04], // PK\x03\x04 (zip, docx é um zip)
  },
};

export const CATEGORIAS_MATERIAL = [
  { id: 'ficha_casa', rotulo: 'Ficha para casa' },
  { id: 'resumo', rotulo: 'Resumo' },
  { id: 'apontamento', rotulo: 'Apontamento' },
  { id: 'outro', rotulo: 'Outro' },
] as const;
export type CategoriaMaterial = (typeof CATEGORIAS_MATERIAL)[number]['id'];

export function rotuloCategoriaMaterial(categoria: string): string {
  return CATEGORIAS_MATERIAL.find((c) => c.id === categoria)?.rotulo ?? categoria;
}

export const ACCEPT_MATERIAL = TIPOS_PERMITIDOS_MATERIAL.join(',');

export type MaterialAluno = {
  id: string;
  centro_id: string;
  aluno_id: string;
  professor_id: string;
  categoria: CategoriaMaterial;
  titulo: string;
  nota: string | null;
  caminho: string;
  nome_original: string;
  tipo: string;
  tamanho: number;
  criado_em: string;
  visto_em: string | null;
};

async function obterPrimeirosBytes(file: File, n: number): Promise<Uint8Array> {
  const buffer = await file.slice(0, n).arrayBuffer();
  return new Uint8Array(buffer);
}

function bytesCorrespondem(bytes: Uint8Array, assinatura: number[]): boolean {
  if (bytes.length < assinatura.length) return false;
  return assinatura.every((b, i) => bytes[i] === b);
}

/**
 * null = válido; string = motivo da rejeição, em português, para mostrar ao
 * professor. Valida por camadas, da mais barata para a mais cara: tipo
 * declarado na allowlist, tamanho, extensão do nome original coerente com o
 * tipo (nunca aceitar "x.exe" só porque o type foi forjado para
 * application/pdf), e por fim os primeiros bytes do próprio ficheiro — para
 * um ".pdf" que na realidade não é um PDF continuar a ser recusado mesmo que
 * o nome e o type batam certo. Mesmo que isto seja contornado no cliente, o
 * bucket "material-alunos" (10 MB, tipos na allowlist, definidos no próprio
 * bucket) e a RLS de storage.objects fazem a aplicação real do lado do servidor.
 */
export async function validarFicheiroMaterial(file: File): Promise<string | null> {
  if (!(TIPOS_PERMITIDOS_MATERIAL as readonly string[]).includes(file.type)) {
    return `Tipo de ficheiro não permitido${file.type ? ` (${file.type})` : ''}. Só PDF, JPEG, PNG, DOC ou DOCX.`;
  }
  if (file.size > TAMANHO_MAXIMO_BYTES) {
    return 'Ficheiro demasiado grande (máx. 10 MB).';
  }

  const config = CONFIG_TIPOS[file.type as TipoPermitidoMaterial];
  const nomeSemCaminho = file.name.split(/[\\/]/).pop() || file.name;
  const pontoFinal = nomeSemCaminho.lastIndexOf('.');
  const extensaoOriginal = pontoFinal > 0 ? nomeSemCaminho.slice(pontoFinal + 1).toLowerCase() : '';
  if (!config.extensoesOriginalPermitidas.includes(extensaoOriginal)) {
    return 'A extensão do ficheiro não corresponde ao tipo indicado.';
  }

  try {
    const bytes = await obterPrimeirosBytes(file, config.assinatura.length);
    if (!bytesCorrespondem(bytes, config.assinatura)) {
      return 'O ficheiro não corresponde ao tipo indicado.';
    }
  } catch {
    return 'Não foi possível ler o ficheiro.';
  }

  return null;
}

/**
 * {centro_id}/{aluno_id}/{uuid}-{nome simplificado}.{extensão do TIPO} —
 * exigido pela RLS de storage.objects. A extensão vem sempre de `tipo`
 * (já validado), nunca do nome original, para um nome de ficheiro nunca
 * poder ditar a extensão real guardada no bucket.
 */
export function construirCaminhoMaterial(
  centroId: string,
  alunoId: string,
  nomeOriginal: string,
  tipo: TipoPermitidoMaterial
): string {
  const nomeSimplificado = simplificarNomeParaCaminho(nomeOriginal);
  const pontoFinal = nomeSimplificado.lastIndexOf('.');
  const baseSemExtensao = pontoFinal > 0 ? nomeSimplificado.slice(0, pontoFinal) : nomeSimplificado;
  const extensao = CONFIG_TIPOS[tipo].extensaoCaminho;
  return `${centroId}/${alunoId}/${crypto.randomUUID()}-${baseSemExtensao}.${extensao}`;
}

export function formatarTamanhoFicheiro(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function validarTitulo(titulo: string): string | null {
  const limpo = titulo.trim();
  if (!limpo) return 'O título é obrigatório.';
  if (limpo.length > TITULO_MAX) return `O título não pode passar de ${TITULO_MAX} caracteres.`;
  return null;
}

export function validarNota(nota: string): string | null {
  if (nota.length > NOTA_MAX) return `A nota não pode passar de ${NOTA_MAX} caracteres.`;
  return null;
}

/** Lista o material que ESTE professor carregou para este aluno, mais recente primeiro. */
export async function listarMaterialProfessor(
  supabase: SupabaseClient,
  professorId: string,
  alunoId: string
): Promise<MaterialAluno[]> {
  const { data, error } = await supabase
    .from('material_aluno')
    .select('*')
    .eq('professor_id', professorId)
    .eq('aluno_id', alunoId)
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return (data || []) as MaterialAluno[];
}

/** Lista o material do próprio aluno autenticado, mais recente primeiro. */
export async function listarMaterialAluno(supabase: SupabaseClient, alunoId: string): Promise<MaterialAluno[]> {
  const { data, error } = await supabase
    .from('material_aluno')
    .select('*')
    .eq('aluno_id', alunoId)
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return (data || []) as MaterialAluno[];
}

export async function contarMaterialNovoAluno(supabase: SupabaseClient, alunoId: string): Promise<number> {
  const { count, error } = await supabase
    .from('material_aluno')
    .select('id', { count: 'exact', head: true })
    .eq('aluno_id', alunoId)
    .is('visto_em', null);
  if (error) throw error;
  return count || 0;
}

/**
 * Upload para o bucket + insert da linha, nesta ordem. Se o insert falhar, o
 * ficheiro já enviado é apagado antes de propagar o erro — nunca deixa um
 * órfão no bucket sem linha correspondente.
 */
export async function carregarMaterial(
  supabase: SupabaseClient,
  params: {
    file: File;
    tipo: TipoPermitidoMaterial;
    centroId: string;
    alunoId: string;
    professorId: string;
    categoria: CategoriaMaterial;
    titulo: string;
    nota: string;
  }
): Promise<MaterialAluno> {
  const caminho = construirCaminhoMaterial(params.centroId, params.alunoId, params.file.name, params.tipo);

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_MATERIAL)
    .upload(caminho, params.file, { contentType: params.tipo });
  if (erroUpload) throw new Error(erroUpload.message);

  const { data, error: erroInsert } = await supabase
    .from('material_aluno')
    .insert({
      centro_id: params.centroId,
      aluno_id: params.alunoId,
      professor_id: params.professorId,
      categoria: params.categoria,
      titulo: params.titulo.trim(),
      nota: params.nota.trim() || null,
      caminho,
      nome_original: higienizarNomeFicheiro(params.file.name),
      tipo: params.tipo,
      tamanho: params.file.size,
    })
    .select()
    .single();

  if (erroInsert) {
    await supabase.storage.from(BUCKET_MATERIAL).remove([caminho]);
    throw new Error(erroInsert.message);
  }

  return data as MaterialAluno;
}

/**
 * Apaga primeiro a linha e só depois o ficheiro — nunca deixa uma linha sem
 * ficheiro correspondente. Se apagar o ficheiro falhar depois de a linha já
 * ter desaparecido, devolve um aviso em vez de lançar (a linha já não existe,
 * não há como desfazer; o ficheiro falhado fica para limpeza manual).
 */
export async function apagarMaterial(
  supabase: SupabaseClient,
  material: Pick<MaterialAluno, 'id' | 'caminho'>
): Promise<{ avisoFicheiro: string | null }> {
  const { error: erroLinha } = await supabase.from('material_aluno').delete().eq('id', material.id);
  if (erroLinha) throw new Error(erroLinha.message);

  const { error: erroFicheiro } = await supabase.storage.from(BUCKET_MATERIAL).remove([material.caminho]);
  if (erroFicheiro) {
    return { avisoFicheiro: 'O registo foi apagado, mas o ficheiro no armazenamento não pôde ser removido agora.' };
  }
  return { avisoFicheiro: null };
}

export async function marcarMaterialVisto(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.rpc('marcar_material_visto', { p_id: id });
  if (error) throw new Error(error.message);
}

export async function obterUrlAssinadaMaterial(
  supabase: SupabaseClient,
  caminho: string
): Promise<{ url: string | null; erro: string | null }> {
  const { data, error } = await supabase.storage.from(BUCKET_MATERIAL).createSignedUrl(caminho, 60);
  if (error || !data?.signedUrl) {
    return { url: null, erro: error?.message || 'sem URL' };
  }
  return { url: data.signedUrl, erro: null };
}
