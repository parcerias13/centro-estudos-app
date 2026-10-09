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

  // Nunca confiar no centro_id do corpo do pedido — vem sempre da sessão do
  // próprio admin, para um admin nunca poder criar staff noutro centro só
  // por mudar o valor enviado.
  const centro_id = user.app_metadata?.centro_id
  if (!centro_id) {
    return NextResponse.json({ error: 'Centro do administrador não identificado.' }, { status: 403 })
  }

  const { email, password, name, role: roleRecebido } = await req.json()

  if (!email || !password || !name || !roleRecebido) {
    return NextResponse.json({ error: 'Campos obrigatórios em falta.' }, { status: 400 })
  }

  // Este endpoint nunca cria outro admin — só professor ou secretaria.
  const roleNormalizado = String(roleRecebido).toLowerCase()
  if (roleNormalizado !== 'professor' && roleNormalizado !== 'secretaria') {
    return NextResponse.json({ error: 'Cargo inválido.' }, { status: 400 })
  }
  const role = roleNormalizado

  const emailNormalizado = email.toLowerCase().trim()

  // Criar utilizador sem enviar email de confirmação e sem afetar a sessão atual
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: emailNormalizado,
    password,
    email_confirm: true,
  })

  if (authError) {
    console.error('criar-staff: falha ao criar utilizador', authError)
    return NextResponse.json({ error: 'Não foi possível criar o utilizador.' }, { status: 500 })
  }

  const novoId = authData.user.id

  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(novoId, {
    app_metadata: { role, centro_id },
  })

  if (metaError) {
    // Reverter a criação do utilizador se a escrita do app_metadata falhar
    await supabaseAdmin.auth.admin.deleteUser(novoId)
    console.error('criar-staff: falha ao definir permissões', metaError)
    return NextResponse.json({ error: 'Não foi possível definir as permissões.' }, { status: 500 })
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
    console.error('criar-staff: falha ao gravar staff', dbError)
    return NextResponse.json({ error: 'Não foi possível gravar o novo membro da equipa.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, staffId: novoId })
}
