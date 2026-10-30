import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getAdminCentroId(): Promise<string | null> {
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
  if (!user) return null

  const { data: staffData } = await supabaseAdmin
    .from('staff')
    .select('role, centro_id')
    .eq('id', user.id)
    .single()

  if (staffData?.role?.toLowerCase() !== 'admin') return null
  return staffData.centro_id || null
}
export async function GET() {
  const centroId = await getAdminCentroId()
  if (!centroId) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  // resend_api_key e email_remetente nunca são devolvidos — a chave do
  // Resend passou a ser da plataforma (process.env.RESEND_API_KEY), nunca
  // por centro, para não a pôr nas mãos de cada admin.
  const { data: config, error } = await supabaseAdmin
    .from('config_centro')
    .select('nome_centro, aviso_alteracoes_explicacao_ativo')
    .eq('id', centroId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(config || {})
}

export async function PATCH(req: Request) {
  const centroId = await getAdminCentroId()
  if (!centroId) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  const { nome_centro, aviso_alteracoes_explicacao_ativo } = await req.json()

  // email_remetente e resend_api_key deixaram de ser aceites aqui — a
  // chave é da plataforma, nunca por centro. Cada campo só entra no update
  // se vier no pedido — a Gestão envia os dois num PATCH só, mas o
  // interruptor de aviso pode vir sozinho sem apagar o nome do centro.
  const payload: Record<string, unknown> = {}
  if (typeof nome_centro === 'string') payload.nome_centro = nome_centro
  if (typeof aviso_alteracoes_explicacao_ativo === 'boolean') {
    payload.aviso_alteracoes_explicacao_ativo = aviso_alteracoes_explicacao_ativo
  }

  const { error } = await supabaseAdmin
    .from('config_centro')
    .update(payload)
    .eq('id', centroId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
