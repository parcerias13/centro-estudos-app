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
const REMETENTE_PADRAO = 'avisos@mail.studycloud.pt'
const NOMES_ERRO_LIMITE = new Set(['daily_quota_exceeded', 'rate_limit_exceeded'])

// Aviso curto — SEM dados do aluno — de que há uma mensagem nova na Área
// dos Encarregados. É sempre um passo à parte, depois de a mensagem
// 'relatorio_mensal' já estar criada: uma falha aqui nunca desfaz nem
// bloqueia essa mensagem.
//
// Chave do Resend é da PLATAFORMA (process.env.RESEND_API_KEY), nunca por
// centro — só pode enviar do domínio mail.studycloud.pt, e só os centros
// em EMAIL_CENTROS_AUTORIZADOS (allowlist explícita, vazia = ninguém)
// podem usar esta rota enquanto o envio não está aberto a todos.
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

  // Allowlist explícita por centro_id — nunca ligado por omissão. Lida a
  // cada pedido (não cacheada), para nunca exigir reiniciar o servidor
  // depois de mudar a variável de ambiente.
  const centrosAutorizados = (process.env.EMAIL_CENTROS_AUTORIZADOS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  if (!centrosAutorizados.includes(centroAdmin)) {
    return NextResponse.json({ error: 'Este centro não está autorizado a enviar este aviso.' }, { status: 403 })
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

  // Chave da PLATAFORMA — nunca lida de config_centro, nunca registada nem
  // devolvida em nenhuma resposta.
  const RESEND_API_KEY = process.env.RESEND_API_KEY
  if (!RESEND_API_KEY) {
    console.error('relatorio-mensal/avisar: RESEND_API_KEY não definida — a recusar o envio.')
    return NextResponse.json({ error: 'Envio de email não configurado.' }, { status: 500 })
  }

  const { data: config } = await supabaseAdmin
    .from('config_centro')
    .select('nome_centro')
    .eq('id', centroAdmin)
    .maybeSingle()

  if (!config?.nome_centro) {
    return NextResponse.json({ error: 'Centro não encontrado.' }, { status: 404 })
  }

  const resend = new Resend(RESEND_API_KEY)
  const remetente = process.env.EMAIL_REMETENTE ?? REMETENTE_PADRAO
  const assunto = `Nova mensagem — ${config.nome_centro}`
  const texto = `Tem uma nova mensagem do ${config.nome_centro} na Área dos Encarregados. Entre em ${APP_URL}.`

  let enviados = 0
  const falhas: Array<{ alunoId: string; motivo: string }> = [...naoEncontrados]

  const comEmail = validos.filter((a) => a.email_encarregado)
  for (const a of validos) {
    if (!a.email_encarregado) falhas.push({ alunoId: a.id, motivo: 'Sem email de encarregado.' })
  }

  // Lotes pequenos com pausa entre eles — nunca os 100 pedidos de uma vez.
  // Se o Resend devolver erro de limite (plano com limite diário), pára o
  // lote já: os que ainda não foram tentados contam como "por enviar",
  // nunca marcados como enviados.
  let limiteAtingido = false
  for (let i = 0; i < comEmail.length && !limiteAtingido; i += TAMANHO_LOTE) {
    const lote = comEmail.slice(i, i + TAMANHO_LOTE)
    const resultados = await Promise.all(
      lote.map(async (a) => {
        try {
          const { error } = await resend.emails.send({
            from: `${config.nome_centro} <${remetente}>`,
            to: [a.email_encarregado!],
            subject: assunto,
            text: texto,
          })
          if (error) {
            console.error('relatorio-mensal/avisar: falha ao enviar', error)
            return { alunoId: a.id, ok: false, limite: NOMES_ERRO_LIMITE.has(error.name) }
          }
          return { alunoId: a.id, ok: true, limite: false }
        } catch (e) {
          console.error('relatorio-mensal/avisar: erro inesperado', e)
          return { alunoId: a.id, ok: false, limite: false }
        }
      })
    )
    for (const r of resultados) {
      if (r.ok) enviados += 1
      // Nunca expor o erro cru do Resend ao cliente — só um motivo genérico.
      else falhas.push({ alunoId: r.alunoId, motivo: r.limite ? 'Limite diário de envio atingido.' : 'Não foi possível enviar o email.' })
      if (r.limite) limiteAtingido = true
    }
    if (limiteAtingido) {
      // O resto do lote (ainda nem tentado) fica também "por enviar".
      const tentados = new Set([...resultados.map((r) => r.alunoId), ...falhas.map((f) => f.alunoId)])
      for (const a of comEmail.slice(i + TAMANHO_LOTE)) {
        if (!tentados.has(a.id)) falhas.push({ alunoId: a.id, motivo: 'Limite diário de envio atingido.' })
      }
      break
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
