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

  const { data: staffData } = await supabaseAdmin
    .from('staff')
    .select('role')
    .eq('id', user.id)
    .single()

  if (staffData?.role?.toLowerCase() !== 'admin') {
    return NextResponse.json({ error: 'Sem permissões de administrador.' }, { status: 403 })
  }

  const {
    email, password, nome, data_nascimento, telefone_encarregado,
    email_encarregado, nif_encarregado, morada_encarregado, telemovel_aluno, ano_escolar, mensalidade_base,
    saida_autorizada, consentimento_ia, usa_app, avatar_url,
    centro_id, dias_selecionados,
  } = await req.json()

  if (!email || !password || !nome || !data_nascimento || !centro_id) {
    return NextResponse.json({ error: 'Campos obrigatórios em falta.' }, { status: 400 })
  }

  // Criar utilizador sem enviar email de confirmação e sem afetar a sessão atual
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError) {
    return NextResponse.json({ error: `Erro Auth: ${authError.message}` }, { status: 500 })
  }

  const novoId = authData.user.id

  await supabaseAdmin.auth.admin.updateUserById(novoId, {
    app_metadata: { centro_id },
  })

  const { error: dbError } = await supabaseAdmin.from('alunos').insert({
    id: novoId,
    nome,
    email,
    data_nascimento,
    telefone_encarregado,
    email_encarregado,
    nif_encarregado,
    morada_encarregado,
    telemovel_aluno,
    ano_escolar,
    mensalidade_base,
    saida_autorizada,
    consentimento_ia,
    usa_app,
    avatar_url,
    centro_id,
  })

  if (dbError) {
    // Reverter a criação do utilizador se o insert falhar
    await supabaseAdmin.auth.admin.deleteUser(novoId)
    return NextResponse.json({ error: `Erro DB: ${dbError.message}` }, { status: 500 })
  }

  if (dias_selecionados?.length > 0) {
    const horarios = dias_selecionados.map((dia: number) => ({ aluno_id: novoId, dia_semana: dia, centro_id }))
    const { error: horariosError } = await supabaseAdmin.from('aluno_horarios').insert(horarios)
    if (horariosError) {
      return NextResponse.json({ error: `Erro Horários: ${horariosError.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, alunoId: novoId })
}
