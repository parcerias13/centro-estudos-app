import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Dado um conjunto de aluno_ids, devolve só os que têm conta de Auth associada.
// Necessário porque exams.aluno_id é a única FK do projeto que aponta para
// auth.users em vez de para alunos — alunos de demonstração sem login (ex:
// "Afonso Carvalho") existem normalmente em todas as outras tabelas, mas não
// podem ser referenciados em exams.
export async function POST(req: Request) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { data: staffData } = await supabaseAdmin
    .from('staff')
    .select('centro_id')
    .eq('id', user.id)
    .single()

  if (!staffData) {
    return NextResponse.json({ error: 'Sem permissões.' }, { status: 403 })
  }

  const { alunoIds } = await req.json()
  if (!Array.isArray(alunoIds) || alunoIds.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'Lista de IDs inválida.' }, { status: 400 })
  }

  // Restringe ao centro do staff autenticado antes de gastar chamadas à Admin API.
  const { data: alunosDoCentro } = await supabaseAdmin
    .from('alunos')
    .select('id')
    .eq('centro_id', staffData.centro_id)
    .in('id', alunoIds)

  const idsValidos = (alunosDoCentro || []).map((a) => a.id)

  const resultados = await Promise.allSettled(
    idsValidos.map((id) => supabaseAdmin.auth.admin.getUserById(id))
  )

  const comConta = idsValidos.filter((_, i) => {
    const r = resultados[i]
    return r.status === 'fulfilled' && !r.value.error && !!r.value.data.user
  })

  return NextResponse.json({ comConta })
}
