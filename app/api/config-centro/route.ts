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

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  console.log('[config-centro] user:', user?.id ?? null, '| error:', authError?.message ?? null)
  if (!user) return null

  const { data: staffData } = await supabaseAdmin
    .from('staff')
    .select('role, centro_id')
    .eq('id', user.id)
    .single()

  console.log('[config-centro] staffData:', JSON.stringify(staffData))

  if (staffData?.role?.toLowerCase() !== 'admin') return null
  return staffData.centro_id || null
}

export async function GET() {
  const centroId = await getAdminCentroId()
  if (!centroId) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  const { data: config, error } = await supabaseAdmin
    .from('config_centro')
    .select('nome_centro, email_remetente, resend_api_key')
    .eq('id', centroId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(config || {})
}

export async function PATCH(req: Request) {
  const centroId = await getAdminCentroId()
  if (!centroId) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  const { nome_centro, email_remetente, resend_api_key } = await req.json()

  const { error } = await supabaseAdmin
    .from('config_centro')
    .update({ nome_centro, email_remetente, resend_api_key })
    .eq('id', centroId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
