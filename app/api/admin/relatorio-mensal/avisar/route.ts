import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { Resend } from 'resend'
import { EMAIL_RELATORIO_ATIVO } from '@/lib/features'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TAMANHO_LOTE = 5
const PAUSA_ENTRE_LOTES_MS = 300

// Aviso curto — SEM dados do aluno — de que há uma mensagem nova na Área
// dos Encarregados. É sempre um passo à parte, depois de a mensagem
// 'relatorio_mensal' já estar criada: uma falha aqui nunca desfaz nem
// bloqueia essa mensagem.
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

  // Mesmo padrão de /api/admin/gerar-codigo-encarregado: o papel vem da
  // tabela staff (service role), nunca só do app_metadata do JWT.
  const { data: staffData } = await supabaseAdmin
    .from('staff')
    .select('role')
    .eq('id', user.id)
    .single()

  if (staffData?.role?.toLowerCase() !== 'admin') {
    return NextResponse.json({ error: 'Sem permissões de administrador.' }, { status: 403 })
  }

  const centroAdmin = user.app_metadata?.centro_id
  if (!centroAdmin) {
    return NextResponse.json({ error: 'Centro do administrador não identificado.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { ano, mes, alunoIds } = body as { ano?: unknown; mes?: unknown; alunoIds?: unknown }

  if (!Number.isInteger(ano) || (ano as number) < 2000 || (ano as number) > 2100) {
    return NextResponse.json({ error: 'Ano inválido.' }, { status: 400 })
  }
  if (!Number.isInteger(mes) || (mes as number) < 1 || (mes as number) > 12) {
    return NextResponse.json({ error: 'Mês inválido.' }, { status: 400 })
  }
  if (!Array.isArray(alunoIds) || alunoIds.length === 0 || alunoIds.length > 100) {
    return NextResponse.json({ error: 'Lista de alunos inválida (máximo 100).' }, { status: 400 })
  }
  if (!alunoIds.every((id) => typeof id === 'string' && REGEX_UUID.test(id))) {
    return NextResponse.json({ error: 'IDs de aluno inválidos.' }, { status: 400 })
  }

  // Nunca confiar no centro_id do corpo (não existe aqui, de propósito) —
  // cada aluno é resolvido no servidor e tem de pertencer ao centro de quem
  // chama. Os que não pertencem (ou não existem) nunca aparecem no envio;
  // se NENHUM pertencer, é um 404 — o mesmo padrão de send-report/
  // gerar-codigo-encarregado para um único aluno de outro centro.
  const { data: alunos } = await supabaseAdmin
    .from('alunos')
    .select('id, centro_id, email_encarregado')
    .in('id', alunoIds as string[])

  const validos = (alunos || []).filter((a) => a.centro_id === centroAdmin)
  const idsValidos = new Set(validos.map((a) => a.id))
  const naoEncontrados = (alunoIds as string[])
    .filter((id) => !idsValidos.has(id))
    .map((id) => ({ alunoId: id, motivo: 'Aluno não encontrado.' }))

  if (validos.length === 0) {
    return NextResponse.json({ error: 'Nenhum aluno encontrado neste centro.' }, { status: 404 })
  }

  // Interruptor (lib/features.ts) — enquanto desligado, a rota confirma que
  // chegou aqui com uma sessão e dados válidos mas não envia nenhum email.
  if (!EMAIL_RELATORIO_ATIVO) {
    return NextResponse.json(
      { ok: true, ativo: false, enviados: 0, falhas: naoEncontrados },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL
  if (!APP_URL) {
    console.error('relatorio-mensal/avisar: NEXT_PUBLIC_APP_URL não definido — a recusar o envio.')
    return NextResponse.json({ error: 'URL da aplicação não configurado.' }, { status: 500 })
  }

  const { data: config } = await supabaseAdmin
    .from('config_centro')
    .select('resend_api_key, email_remetente, nome_centro')
    .eq('id', centroAdmin)
    .maybeSingle()

  if (!config?.resend_api_key || !config?.email_remetente) {
    return NextResponse.json({ error: 'Centro sem email configurado.' }, { status: 400 })
  }

  const resend = new Resend(config.resend_api_key)
  const assunto = `Nova mensagem — ${config.nome_centro}`
  const texto = `Tem uma nova mensagem do ${config.nome_centro} na Área dos Encarregados. Entre em ${APP_URL}.`

  let enviados = 0
  const falhas: Array<{ alunoId: string; motivo: string }> = [...naoEncontrados]

  const comEmail = validos.filter((a) => a.email_encarregado)
  for (const a of validos) {
    if (!a.email_encarregado) falhas.push({ alunoId: a.id, motivo: 'Sem email de encarregado.' })
  }

  // Lotes pequenos com pausa entre eles — nunca os 100 pedidos de uma vez.
  for (let i = 0; i < comEmail.length; i += TAMANHO_LOTE) {
    const lote = comEmail.slice(i, i + TAMANHO_LOTE)
    const resultados = await Promise.all(
      lote.map(async (a) => {
        try {
          const { error } = await resend.emails.send({
            from: `${config.nome_centro} <${config.email_remetente}>`,
            to: [a.email_encarregado!],
            subject: assunto,
            text: texto,
          })
          if (error) {
            console.error('relatorio-mensal/avisar: falha ao enviar', error)
            return { alunoId: a.id, ok: false }
          }
          return { alunoId: a.id, ok: true }
        } catch (e) {
          console.error('relatorio-mensal/avisar: erro inesperado', e)
          return { alunoId: a.id, ok: false }
        }
      })
    )
    for (const r of resultados) {
      if (r.ok) enviados += 1
      // Nunca expor o erro cru do Resend ao cliente — só um motivo genérico.
      else falhas.push({ alunoId: r.alunoId, motivo: 'Não foi possível enviar o email.' })
    }
    if (i + TAMANHO_LOTE < comEmail.length) {
      await new Promise((resolve) => setTimeout(resolve, PAUSA_ENTRE_LOTES_MS))
    }
  }

  return NextResponse.json(
    { ok: true, ativo: true, enviados, falhas },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
