'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * Defesa em profundidade para páginas que o middleware já bloqueia ao
 * professor (editar/extrato/novo aluno — mensalidade, preços, contactos do
 * encarregado). Se a sessão já estava aberta antes desta navegação (sem
 * passar pelo middleware outra vez), confirma o papel no cliente e
 * redireciona sem deixar a página renderizar nada.
 */
export function useBloqueioProfessor(destino = '/admin/alunos') {
  const router = useRouter();
  const [bloqueado, setBloqueado] = useState(true);

  useEffect(() => {
    let ativo = true;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!ativo) return;
      const role = user?.app_metadata?.role?.toLowerCase();
      if (role === 'professor') {
        router.replace(destino);
        return; // bloqueado fica true — nunca chega a renderizar a página
      }
      setBloqueado(false);
    });
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return bloqueado;
}
