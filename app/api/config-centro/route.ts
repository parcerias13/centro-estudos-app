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
    .select('nome_centro, aviso_alteracoes_explicacao_ativo, modo_presencas, aluno_cancela_explicacoes, cancelamento_gratis_horas, checkin_aluno, valor_dia_fora_horario, dia_limite_mensalidade, iban, iban_beneficiario')
    .eq('id', centroId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(config || {})
}

export async function PATCH(req: Request) {
  const centroId = await getAdminCentroId()
  if (!centroId) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  const {
    nome_centro, aviso_alteracoes_explicacao_ativo, modo_presencas,
    aluno_cancela_explicacoes, cancelamento_gratis_horas, checkin_aluno,
    valor_dia_fora_horario, dia_limite_mensalidade, iban, iban_beneficiario,
  } = await req.json()

  // email_remetente e resend_api_key deixaram de ser aceites aqui — a
  // chave é da plataforma, nunca por centro. Cada campo só entra no update
  // se vier no pedido — a Gestão envia os dois num PATCH só, mas o
  // interruptor de aviso pode vir sozinho sem apagar o nome do centro.
  const payload: Record<string, unknown> = {}
  const fieldErrors: Record<string, string> = {}

  if (typeof nome_centro === 'string') payload.nome_centro = nome_centro
  if (typeof aviso_alteracoes_explicacao_ativo === 'boolean') {
    payload.aviso_alteracoes_explicacao_ativo = aviso_alteracoes_explicacao_ativo
  }
  if (modo_presencas === 'individual' || modo_presencas === 'lista_dia') {
    payload.modo_presencas = modo_presencas
  }
  if (checkin_aluno === 'botao_unico' || checkin_aluno === 'disciplina') {
    payload.checkin_aluno = checkin_aluno
  }
  if (typeof aluno_cancela_explicacoes === 'boolean') {
    payload.aluno_cancela_explicacoes = aluno_cancela_explicacoes
  }
  if (
    typeof cancelamento_gratis_horas === 'number' &&
    Number.isInteger(cancelamento_gratis_horas) &&
    cancelamento_gratis_horas >= 0 &&
    cancelamento_gratis_horas <= 720
  ) {
    payload.cancelamento_gratis_horas = cancelamento_gratis_horas
  }

  // Valor por dia fora do horário: número >= 0, no máximo 2 casas decimais,
  // menor que 1000. 0 desliga a funcionalidade — valor válido, não um erro.
  if (valor_dia_fora_horario !== undefined) {
    const valor = Number(valor_dia_fora_horario)
    // Comparação com margem (não ===) porque multiplicar por 100 em ponto
    // flutuante pode dar 1598.9999999999998 para um valor válido como 15.99.
    const casasValidas = Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-9
    if (typeof valor_dia_fora_horario !== 'number' || isNaN(valor) || valor < 0 || valor >= 1000 || !casasValidas) {
      fieldErrors.valor_dia_fora_horario = 'Indica um valor entre 0 e 999,99 €, com no máximo 2 casas decimais.'
    } else {
      payload.valor_dia_fora_horario = valor
    }
  }

  // Dia limite da mensalidade: inteiro entre 1 e 28.
  if (dia_limite_mensalidade !== undefined) {
    if (
      typeof dia_limite_mensalidade !== 'number' ||
      !Number.isInteger(dia_limite_mensalidade) ||
      dia_limite_mensalidade < 1 ||
      dia_limite_mensalidade > 28
    ) {
      fieldErrors.dia_limite_mensalidade = 'Indica um dia entre 1 e 28.'
    } else {
      payload.dia_limite_mensalidade = dia_limite_mensalidade
    }
  }

  // IBAN: vazio guarda null; preenchido tem de bater com PT + 23 dígitos
  // (sem espaços, em maiúsculas) e precisa de um beneficiário.
  let ibanNormalizado: string | null | undefined
  if (iban !== undefined) {
    const bruto = typeof iban === 'string' ? iban.replace(/\s+/g, '').toUpperCase() : ''
    if (bruto === '') {
      ibanNormalizado = null
    } else if (!/^PT[0-9]{23}$/.test(bruto)) {
      fieldErrors.iban = 'IBAN inválido — tem de começar por PT e ter 23 dígitos.'
    } else {
      ibanNormalizado = bruto
    }
  }

  let beneficiarioNormalizado: string | null | undefined
  if (iban_beneficiario !== undefined) {
    const bruto = typeof iban_beneficiario === 'string' ? iban_beneficiario.trim() : ''
    if (bruto === '') {
      beneficiarioNormalizado = null
    } else if (bruto.length > 120) {
      fieldErrors.iban_beneficiario = 'O nome do beneficiário não pode ter mais de 120 caracteres.'
    } else {
      beneficiarioNormalizado = bruto
    }
  }

  if (!fieldErrors.iban && !fieldErrors.iban_beneficiario) {
    // O IBAN final (novo, ou o que já estava guardado se não vier no pedido)
    // não pode ficar sem beneficiário — e vice-versa.
    const ibanFinal = ibanNormalizado !== undefined
      ? ibanNormalizado
      : (await supabaseAdmin.from('config_centro').select('iban').eq('id', centroId).maybeSingle()).data?.iban ?? null
    const beneficiarioFinal = beneficiarioNormalizado !== undefined
      ? beneficiarioNormalizado
      : (await supabaseAdmin.from('config_centro').select('iban_beneficiario').eq('id', centroId).maybeSingle()).data?.iban_beneficiario ?? null

    if (ibanFinal && !beneficiarioFinal) {
      fieldErrors.iban_beneficiario = 'Indica o nome do beneficiário.'
    } else {
      if (ibanNormalizado !== undefined) payload.iban = ibanNormalizado
      if (beneficiarioNormalizado !== undefined) payload.iban_beneficiario = beneficiarioNormalizado
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ error: 'Corrige os campos assinalados.', fieldErrors }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('config_centro')
    .update(payload)
    .eq('id', centroId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
