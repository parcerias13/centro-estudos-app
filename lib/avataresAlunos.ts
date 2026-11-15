import type { SupabaseClient } from '@supabase/supabase-js';

// Avatares de alunos — bucket "avatares" (ainda público nesta fase, mas o
// código já só grava e lê pelo CAMINHO relativo e mostra sempre por URL
// assinado, para a troca do bucket para privado não exigir tocar aqui outra
// vez). Caminho: `${centro_id}/{aluno_id}-{sufixo}.{ext}` (editar) ou
// `${centro_id}/{sufixo}.{ext}` em "novo aluno" (o aluno ainda não existe
// nessa fase). Ficheiro sem 'use client' nem import do cliente singleton —
// é importado também pela rota de API (app/api/admin/criar-aluno), que corre
// no servidor.
export const BUCKET_AVATARES = 'avatares';

// Mostrados inline em listas (não um download pontual como os anexos/
// material, que usam 60s) — TTL maior para a imagem não morrer a meio de uma
// sessão longa de ecrã aberto.
const TTL_SEGUNDOS = 900;

// createSignedUrls aceita uma lista grande numa só chamada, mas em blocos
// para nunca mandar um pedido desproporcionado com centros muito grandes.
const TAMANHO_LOTE = 100;

const PREFIXOS_URL_BUCKET = ['/object/public/avatares/', '/object/sign/avatares/'];

/** Extensão do caminho a partir do tipo MIME — nunca do nome do ficheiro. */
export const TIPOS_IMAGEM_PERMITIDOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export const ACCEPT_AVATAR = Object.keys(TIPOS_IMAGEM_PERMITIDOS).join(',');

function caminhoInvalido(caminho: string): boolean {
  if (!caminho || caminho.startsWith('/')) return true;
  return caminho.split('/').some((segmento) => segmento === '..');
}

/**
 * Normaliza o que está guardado em alunos.avatar_url para o CAMINHO relativo
 * ao bucket "avatares" — aceita tanto o formato antigo (URL público ou
 * assinado completo) como o novo (já só o caminho). Devolve null para vazio,
 * só espaços, URL de outra origem/bucket, ou um caminho que tentasse escapar
 * da própria pasta (".." ou a começar por "/") — nunca lança, só devolve
 * null para quem mostra cair no placeholder (quem grava decide separadamente
 * se um null aqui é motivo de erro, ver app/api/admin/criar-aluno).
 */
export function caminhoDoAvatar(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpo = valor.trim();
  if (!limpo) return null;

  let caminho = limpo;
  if (/^https?:\/\//i.test(limpo)) {
    const semQuery = limpo.split('?')[0];
    let indiceFim = -1;
    for (const prefixo of PREFIXOS_URL_BUCKET) {
      const i = semQuery.indexOf(prefixo);
      if (i !== -1) {
        indiceFim = i + prefixo.length;
        break;
      }
    }
    if (indiceFim === -1) return null;
    caminho = semQuery.slice(indiceFim);
    try {
      caminho = decodeURIComponent(caminho);
    } catch {
      return null;
    }
  }

  if (caminhoInvalido(caminho)) return null;
  return caminho;
}

/** `${centroId}/{alunoId}-{sufixo}.{ext}` ou, sem alunoId (aluno ainda não existe), `${centroId}/{sufixo}.{ext}`. */
export function construirCaminhoAvatar(centroId: string, alunoId: string | null, extensao: string): string {
  return alunoId
    ? `${centroId}/${alunoId}-${Math.random()}.${extensao}`
    : `${centroId}/${Math.random()}.${extensao}`;
}

/**
 * Assina em lote todos os caminhos válidos de `valores` (o que estiver
 * guardado em avatar_url, formato antigo ou novo) e devolve um Map da CHAVE
 * ORIGINAL (o valor exatamente como veio da BD) para o URL assinado.
 * Vazios/inválidos são ignorados; entradas duplicadas (mesmo caminho) são
 * assinadas uma só vez. Uma falha num bloco nunca propaga — essas fotos
 * ficam sem URL (quem chama mostra o placeholder), as de outros blocos
 * continuam a funcionar.
 */
export async function obterUrlsAssinadosAvatares(
  supabaseClient: SupabaseClient,
  valores: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const resultado = new Map<string, string>();
  const valoresPorCaminho = new Map<string, Set<string>>();

  for (const valor of valores) {
    if (!valor) continue;
    const caminho = caminhoDoAvatar(valor);
    if (!caminho) continue;
    if (!valoresPorCaminho.has(caminho)) valoresPorCaminho.set(caminho, new Set());
    valoresPorCaminho.get(caminho)!.add(valor);
  }

  const caminhos = [...valoresPorCaminho.keys()];
  if (caminhos.length === 0) return resultado;

  for (let i = 0; i < caminhos.length; i += TAMANHO_LOTE) {
    const bloco = caminhos.slice(i, i + TAMANHO_LOTE);
    try {
      const { data, error } = await supabaseClient.storage.from(BUCKET_AVATARES).createSignedUrls(bloco, TTL_SEGUNDOS);
      if (error || !data) continue;
      data.forEach((item: { path?: string | null; signedUrl?: string; error?: string | null }, idx: number) => {
        if (!item?.signedUrl || item?.error) return;
        const caminho = item.path || bloco[idx];
        for (const valorOriginal of valoresPorCaminho.get(caminho) ?? []) {
          resultado.set(valorOriginal, item.signedUrl!);
        }
      });
    } catch {
      // bloco falhou por inteiro (ex.: rede) — fotos deste bloco ficam sem
      // URL, nunca rebenta o ecrã; os outros blocos continuam.
    }
  }

  return resultado;
}
