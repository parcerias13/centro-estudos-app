import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

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

  if (user.app_metadata?.role?.toLowerCase() !== 'admin') {
    return NextResponse.json({ error: 'Sem permissões de administrador.' }, { status: 403 })
  }

  const { email, password, name, role, centro_id } = await req.json()

  if (!email || !password || !name || !role || !centro_id) {
    return NextResponse.json({ error: 'Campos obrigatórios em falta.' }, { status: 400 })
  }

  const emailNormalizado = email.toLowerCase().trim()

  // Criar utilizador sem enviar email de confirmação e sem afetar a sessão atual
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: emailNormalizado,
    password,
    email_confirm: true,
  })

  if (authError) {
    return NextResponse.json({ error: `Erro Auth: ${authError.message}` }, { status: 500 })
  }

  const novoId = authData.user.id

  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(novoId, {
    app_metadata: { role, centro_id },
  })

  if (metaError) {
    // Reverter a criação do utilizador se a escrita do app_metadata falhar
    await supabaseAdmin.auth.admin.deleteUser(novoId)
    return NextResponse.json({ error: `Erro ao definir permissões: ${metaError.message}` }, { status: 500 })
  }

  const { error: dbError } = await supabaseAdmin.from('staff').insert({
    id: novoId,
    email: emailNormalizado,
    name,
    role,
    centro_id,
  })

  if (dbError) {
    // Reverter a criação do utilizador se o insert falhar
    await supabaseAdmin.auth.admin.deleteUser(novoId)
    return NextResponse.json({ error: `Erro DB: ${dbError.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, staffId: novoId })
}
