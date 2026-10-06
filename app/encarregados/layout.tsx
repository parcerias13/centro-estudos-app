'use client';

import { useEffect } from 'react';
import { lock } from '@/lib/encarregadoUnlock';

// Montado uma vez para toda a área e só desmonta ao sair dela (navegar entre
// visão geral, mensagens e alterar código não desmonta o layout, por isso
// não bloqueia). lock(false) é silencioso de propósito: um lock() normal
// acionaria as subscrições das páginas (router.replace('/encarregados')) e
// devolvia o utilizador à porta — aqui já se está a saída da área.
export default function EncarregadosLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => () => { lock(false); }, []);
  return <>{children}</>;
}
