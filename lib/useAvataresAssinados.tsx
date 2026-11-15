'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { obterUrlsAssinadosAvatares } from '@/lib/avataresAlunos';

/**
 * Hook para os ecrãs: devolve o Map (valor original de avatar_url -> URL
 * assinado) para a lista de valores visível, e `loading`. Sem cache
 * persistente nem nada guardado na BD — assina de novo sempre que o
 * conjunto de valores muda. Enquanto loading (ou sem URL para um valor
 * concreto — vazio ou inválido), quem usa o hook deve mostrar o placeholder
 * (inicial do nome / ícone) e nunca tentar um <img> sem src.
 */
export function useAvataresAssinados(valores: (string | null | undefined)[]): {
  urls: Map<string, string>;
  loading: boolean;
} {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  // Chave do último pedido já resolvido — comparada com a chave atual dá o
  // `loading` sem precisar de um setState síncrono logo no corpo do efeito.
  const [chaveResolvida, setChaveResolvida] = useState<string | null>(null);
  // Chave estável: o efeito só deve voltar a assinar quando o CONJUNTO de
  // valores muda, não a cada render só porque .map() devolveu um array novo.
  const chave = valores.filter((v): v is string => !!v).join('|');

  useEffect(() => {
    let cancelado = false;
    obterUrlsAssinadosAvatares(supabase, valores).then((mapa) => {
      if (cancelado) return;
      setUrls(mapa);
      setChaveResolvida(chave);
    });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  return { urls, loading: chaveResolvida !== chave };
}

/**
 * Avatar de um aluno numa lista — inicial do nome como placeholder (sem
 * foto, a carregar, ou falha a carregar a imagem assinada). `urls` vem do
 * hook useAvataresAssinados, partilhado por toda a lista (um só pedido em
 * lote em vez de um createSignedUrl por aluno).
 */
export function AvatarAluno({
  valor,
  nome,
  urls,
  className,
}: {
  valor: string | null | undefined;
  nome: string | null | undefined;
  urls: Map<string, string>;
  className?: string;
}) {
  const [erro, setErro] = useState(false);
  const url = valor ? urls.get(valor) : undefined;

  if (!url || erro) {
    return <span>{nome?.charAt(0) || '?'}</span>;
  }

  return <img src={url} alt={nome || ''} className={className} onError={() => setErro(true)} />;
}
