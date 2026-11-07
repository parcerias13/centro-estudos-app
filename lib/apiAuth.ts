import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';

// Cliente ligado aos cookies do pedido em curso — para rotas de API que
// precisam de saber quem está autenticado (getUser) e/ou mudar a sessão
// atual (updateUser), nunca para operações de administração arbitrárias
// (essas usam o service role, criado à parte em cada rota).
export async function clienteDaSessao() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}

// Confirma "é admin?" sempre pelo app_metadata.role do JWT da própria
// sessão (nunca por uma leitura à tabela staff) — o mesmo padrão que
// criar-staff e criar-aluno já usavam. Devolve o utilizador e o centro_id
// quando tudo bate certo, ou a resposta de erro já pronta para devolver.
export async function exigirAdmin(): Promise<
  | { erro: NextResponse }
  | { user: User; centro_id: string }
> {
  const supabase = await clienteDaSessao();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { erro: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) };
  }

  if (user.app_metadata?.role?.toLowerCase() !== 'admin') {
    return { erro: NextResponse.json({ error: 'Sem permissões de administrador.' }, { status: 403 }) };
  }

  const centro_id = user.app_metadata?.centro_id;
  if (!centro_id) {
    return { erro: NextResponse.json({ error: 'Centro do administrador não identificado.' }, { status: 403 }) };
  }

  return { user, centro_id };
}
