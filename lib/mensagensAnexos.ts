// Partilhado pelos dois lados (família e admin) — único sítio que decide o
// que é um anexo válido e como se chama o ficheiro no bucket. A validação
// aqui é só para feedback rápido na UI; a aplicação real é o bucket
// "mensagens-anexos" (10 MB, tipos na allowlist) e as RLS de storage.objects
// por {centro_id}/{aluno_id}/ — mesmo que isto seja contornado no cliente,
// o upload falha do lado do servidor.
export const BUCKET_ANEXOS = 'mensagens-anexos';

export const TIPOS_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export type TipoPermitido = (typeof TIPOS_PERMITIDOS)[number];

export const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ANEXOS_POR_MENSAGEM = 3;
const NOME_MAX = 120;

/** null = válido; string = motivo da rejeição, para mostrar ao utilizador. */
export function validarAnexo(file: File): string | null {
  // Nunca SVG nem HTML, mesmo que alguém troque a extensão — a allowlist (não
  // uma lista negra) é que decide, por isso um .svg ou .html disfarçado de
  // imagem continua a cair fora por não ter um destes mime types.
  if (!TIPOS_PERMITIDOS.includes(file.type as TipoPermitido)) {
    return `Tipo de ficheiro não permitido${file.type ? ` (${file.type})` : ''}. Só PDF, JPEG, PNG ou WEBP.`;
  }
  if (file.size > TAMANHO_MAXIMO_BYTES) {
    return 'Ficheiro demasiado grande (máx. 10 MB).';
  }
  return null;
}

/** Sem separadores de caminho nem caracteres de controlo, no máximo 120. */
export function higienizarNomeFicheiro(nomeOriginal: string): string {
  const semCaminho = nomeOriginal.split(/[\\/]/).pop() || nomeOriginal;
  // eslint-disable-next-line no-control-regex
  const semControlo = semCaminho.replace(/[\x00-\x1f\x7f]/g, '');
  const limpo = semControlo.trim();
  return (limpo || 'ficheiro').slice(0, NOME_MAX);
}

const NOME_CAMINHO_MAX = 80;
const EXTENSAO_CAMINHO_MAX = 10;

/**
 * Nome simplificado só para o CAMINHO no bucket — nunca o nome mostrado ao
 * utilizador (esse é sempre o higienizado, via higienizarNomeFicheiro).
 * NFD sem diacríticos, tudo fora de [A-Za-z0-9._-] vira "_", sem "_"
 * repetidos, máx 80 caracteres, extensão preservada — para o caminho nunca
 * depender de acentos, espaços, emoji ou símbolos que diferentes clientes
 * HTTP/CDNs podem tratar de forma inconsistente num URL.
 */
export function simplificarNomeParaCaminho(nomeOriginal: string): string {
  const semCaminho = nomeOriginal.split(/[\\/]/).pop() || nomeOriginal;
  const pontoFinal = semCaminho.lastIndexOf('.');
  const temExtensao = pontoFinal > 0 && pontoFinal < semCaminho.length - 1;
  const base = temExtensao ? semCaminho.slice(0, pontoFinal) : semCaminho;
  const extensao = temExtensao ? semCaminho.slice(pontoFinal + 1) : '';

  const simplificar = (s: string) => s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacríticos (NFD separa a letra da marca)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const extensaoSimplificada = simplificar(extensao).replace(/[^A-Za-z0-9]/g, '').slice(0, EXTENSAO_CAMINHO_MAX);
  const sufixo = extensaoSimplificada ? `.${extensaoSimplificada}` : '';

  let baseSimplificada = simplificar(base) || 'ficheiro';
  const maxBase = Math.max(1, NOME_CAMINHO_MAX - sufixo.length);
  if (baseSimplificada.length > maxBase) baseSimplificada = baseSimplificada.slice(0, maxBase);

  return `${baseSimplificada}${sufixo}`;
}

/** {centro_id}/{aluno_id}/{uuid}-{nome simplificado} — exigido pela RLS de storage.objects. */
export function construirCaminhoAnexo(centroId: string, alunoId: string, nomeOriginal: string): string {
  const nome = simplificarNomeParaCaminho(nomeOriginal);
  return `${centroId}/${alunoId}/${crypto.randomUUID()}-${nome}`;
}

export function formatarTamanhoFicheiro(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
