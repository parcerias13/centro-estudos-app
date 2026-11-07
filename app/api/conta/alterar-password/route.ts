import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { clienteDaSessao } from '@/lib/apiAuth'

// Serve qualquer conta autenticada — aluno/família, professor, secretaria
// ou admin — sempre a mudar a SUA PRÓPRIA password: o utilizador vem
// sempre da sessão (cookies), nunca de um id enviado no corpo do pedido.
//
// A password atual é confirmada à parte, com um cliente novo e isolado
// (anon key, sem persistir nem atualizar sessão nenhuma) — nunca o
// singleton @/lib/supabase, e nunca a sessão do próprio pedido, para não
// arriscar nenhum efeito colateral enquanto só estamos a confirmar.
//
// A mudança em si usa updateUser() no cliente LIGADO AOS COOKIES do pedido
// (nunca a Admin API/service role) — é a única forma de o Supabase saber
// qual sessão pediu a mudança e mantê-la viva, revogando só as outras
// (confirmado em teste: a Admin API revoga TODAS as sessões, incluindo a
// de quem pediu, o que quebraria "a sessão atual continua aberta").

const JANELA_MS = 60 * 60 * 1000
const MAX_TENTATIVAS_POR_HORA = 10

// Em memória do processo — reposto a zero a cada reinício do servidor, e só
// conta falhas, nunca sucessos. Suficiente como rede de segurança simples
// contra um bot a tentar adivinhar a password atual; não substitui um rate
// limit a nível de infraestrutura.
const tentativasPorUtilizador = new Map<string, { falhas: number; desde: number }>()

function demasiadasTentativas(userId: string): boolean {
  const atual = tentativasPorUtilizador.get(userId)
  if (!atual) return false
  if (Date.now() - atual.desde > JANELA_MS) {
    tentativasPorUtilizador.delete(userId)
    return false
  }
  return atual.falhas >= MAX_TENTATIVAS_POR_HORA
}

function registarFalha(userId: string) {
  const agora = Date.now()
  const atual = tentativasPorUtilizador.get(userId)
  if (!atual || agora - atual.desde > JANELA_MS) {
    tentativasPorUtilizador.set(userId, { falhas: 1, desde: agora })
  } else {
    atual.falhas += 1
  }
}

function limparTentativas(userId: string) {
  tentativasPorUtilizador.delete(userId)
}

export async function POST(req: Request) {
  const supabase = await clienteDaSessao()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  if (demasiadasTentativas(user.id)) {
    return NextResponse.json({ error: 'Demasiadas tentativas. Tenta de novo dentro de uma hora.' }, { status: 429 })
  }

  const corpo = await req.json().catch(() => ({}))
  const { atual, nova } = corpo as { atual?: unknown; nova?: unknown }

  if (typeof atual !== 'string' || !atual || typeof nova !== 'string' || !nova) {
    registarFalha(user.id)
    return NextResponse.json({ error: 'Palavra-passe atual e nova são obrigatórias.' }, { status: 400 })
  }

  if (nova.length < 6) {
    registarFalha(user.id)
    return NextResponse.json({ error: 'A nova palavra-passe tem de ter pelo menos 6 caracteres.' }, { status: 400 })
  }

  if (nova === atual) {
    registarFalha(user.id)
    return NextResponse.json({ error: 'A nova palavra-passe tem de ser diferente da atual.' }, { status: 400 })
  }

  // Cliente novo e isolado, nunca o singleton — só para esta confirmação.
  const clienteIsolado = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { error: errAtual } = await clienteIsolado.auth.signInWithPassword({ email: user.email, password: atual })
  if (errAtual) {
    registarFalha(user.id)
    return NextResponse.json({ error: 'A palavra-passe atual está incorreta.' }, { status: 401 })
  }

  const { error: errUpdate } = await supabase.auth.updateUser({ password: nova })
  if (errUpdate) {
    console.error('alterar-password: falha ao atualizar', errUpdate)
    registarFalha(user.id)
    return NextResponse.json({ error: 'Não foi possível atualizar a palavra-passe.' }, { status: 500 })
  }

  limparTentativas(user.id)
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
