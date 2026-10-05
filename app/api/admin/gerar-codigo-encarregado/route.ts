import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { randomInt } from 'node:crypto'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function gerarCodigoSeguro(): string {
  return String(randomInt(0, 10000)).padStart(4, '0')
}

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

  const { alunoId, forcar } = await req.json()

  if (!alunoId || typeof alunoId !== 'string' || !REGEX_UUID.test(alunoId)) {
    return NextResponse.json({ error: 'ID do aluno inválido.' }, { status: 400 })
  }

  const centroAdmin = user.app_metadata?.centro_id
  if (!centroAdmin) {
    return NextResponse.json({ error: 'Centro do administrador não identificado.' }, { status: 403 })
  }

  // Confirma que o alvo é mesmo um aluno do centro deste admin — nunca um
  // staff, nunca de outro centro. 404 genérico em ambos os casos.
  const { data: aluno } = await supabaseAdmin.from('alunos').select('id, centro_id').eq('id', alunoId).maybeSingle()
  if (!aluno || aluno.centro_id !== centroAdmin) {
    return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 })
  }

  // Se a família já alterou o código, só sobrescreve com um pedido explícito
  // (forcar: true) — nunca em silêncio, nem no lote "Gerar para Todos". Uma
  // falha nesta leitura falha fechado: não gera código sem saber se havia
  // um código da família para proteger.
  const { data: codigoAtual, error: leituraError } = await supabaseAdmin
    .from('encarregado_codigos')
    .select('definido_por')
    .eq('aluno_id', alunoId)
    .maybeSingle()

  if (leituraError) {
    console.error('gerar-codigo-encarregado: falha ao ler encarregado_codigos', leituraError)
    return NextResponse.json({ error: 'Não foi possível gerar o código.' }, { status: 500 })
  }

  if (codigoAtual?.definido_por === 'familia' && forcar !== true) {
    return NextResponse.json({ error: 'codigo_da_familia' }, { status: 409 })
  }

  const codigo = gerarCodigoSeguro()
  const { error } = await supabaseAdmin.rpc('definir_codigo_encarregado', {
    p_aluno_id: alunoId,
    p_codigo: codigo,
  })

  if (error) {
    console.error('gerar-codigo-encarregado: falha ao definir código', error)
    return NextResponse.json({ error: 'Não foi possível gerar o código.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, codigo }, { headers: { 'Cache-Control': 'no-store' } })
}
