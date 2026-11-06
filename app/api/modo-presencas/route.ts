import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ROLES_VALIDOS = new Set(['admin', 'professor', 'secretaria'])

// Leitura só do modo de presenças do Dashboard (config_centro.modo_presencas)
// para QUALQUER staff do centro (não só admin) — a RLS viva de config_centro
// (mais restritiva do que o dump local sugeria) só deixa o admin ler a linha
// diretamente pelo cliente; esta rota existe só para o Dashboard (admin,
// professor, secretaria) saber que lista mostrar, sem tocar na RLS. O
// GET/PATCH completo (nome do centro, avisos, etc.) continua só para admin
// em /api/config-centro.
export async function GET() {
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
    .select('role, centro_id')
    .eq('id', user.id)
    .maybeSingle()

  const role = staffData?.role?.toLowerCase()
  if (!role || !ROLES_VALIDOS.has(role) || !staffData?.centro_id) {
    return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  }

  const { data: config, error } = await supabaseAdmin
    .from('config_centro')
    .select('modo_presencas')
    .eq('id', staffData.centro_id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ modo_presencas: config?.modo_presencas === 'lista_dia' ? 'lista_dia' : 'individual' })
}
