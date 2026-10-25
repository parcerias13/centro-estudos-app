import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { randomInt } from 'node:crypto'
import { gerarUsernameBase, normalizarUsernameManual, candidatoUsername, emailFachada, MAX_TENTATIVAS_USERNAME } from '@/lib/username'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Sempre gerados no servidor com crypto (nunca Math.random no cliente) — a
// password e o código dos encarregados são segredos que o próprio código
// que os cria tem de poder mostrar uma vez, por isso são gerados aqui e
// devolvidos na resposta, nunca aceites do cliente.
const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

function gerarPasswordSegura(tamanho = 10): string {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('')
}

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

  // Nunca confiar no centro_id do corpo do pedido — vem sempre da sessão do
  // próprio admin, nunca do cliente, para não deixar um admin criar alunos
  // noutro centro só por mudar o valor enviado.
  const centro_id = user.app_metadata?.centro_id
  if (!centro_id) {
    return NextResponse.json({ error: 'Centro do administrador não identificado.' }, { status: 403 })
  }

  const {
    nome, nome_utilizador_override, data_nascimento, telefone_encarregado,
    email_encarregado, nif_encarregado, morada_encarregado, telemovel_aluno, ano_escolar, mensalidade_base,
    saida_autorizada, consentimento_ia, usa_app, avatar_url,
    dias_selecionados,
  } = await req.json()

  if (!nome || !data_nascimento) {
    return NextResponse.json({ error: 'Campos obrigatórios em falta.' }, { status: 400 })
  }

  const password = gerarPasswordSegura()

  // ano_escolar é NOT NULL + CHECK (1-12) na base de dados — valida aqui para
  // nunca deixar o erro cru do Postgres chegar ao utilizador, e antes de criar
  // a conta de Auth para não deixar um utilizador órfão por reverter.
  const anoEscolarNum = Number(ano_escolar)
  if (!Number.isInteger(anoEscolarNum) || anoEscolarNum < 1 || anoEscolarNum > 12) {
    return NextResponse.json({ error: 'Ano Escolar em falta ou inválido (1 a 12).' }, { status: 400 })
  }

  // O aluno nunca dá o email — entra com um nome de utilizador (proteção de
  // dados). Gera-se aqui a partir do nome (ou do override do admin/import) e
  // compõe-se um email de fachada (@utilizador.invalid) só para satisfazer o
  // Supabase Auth, que exige email. Em colisão (nome de utilizador já usado
  // por qualquer aluno, de qualquer centro, porque o login é global),
  // tenta-se 2, 3, ... até MAX_TENTATIVAS_USERNAME — nunca confiando num
  // email vindo do cliente.
  const baseUsername = nome_utilizador_override
    ? normalizarUsernameManual(String(nome_utilizador_override))
    : gerarUsernameBase(nome)

  if (!baseUsername) {
    return NextResponse.json({ error: 'Não foi possível gerar um nome de utilizador a partir do nome indicado.' }, { status: 400 })
  }

  let novoId: string | null = null
  let nomeUtilizadorFinal: string | null = null
  let emailFinal: string | null = null

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_USERNAME; tentativa++) {
    const candidato = candidatoUsername(baseUsername, tentativa)
    const emailCandidato = emailFachada(candidato)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: emailCandidato,
      password,
      email_confirm: true,
    })

    if (!authError) {
      novoId = authData.user.id
      nomeUtilizadorFinal = candidato
      emailFinal = emailCandidato
      break
    }

    if (authError.code !== 'email_exists') {
      return NextResponse.json({ error: `Erro Auth: ${authError.message}` }, { status: 500 })
    }
    // email_exists: nome de utilizador já em uso — tenta o próximo candidato.
  }

  if (!novoId || !nomeUtilizadorFinal || !emailFinal) {
    return NextResponse.json({ error: 'Não foi possível gerar um nome de utilizador disponível. Tenta um nome de utilizador diferente.' }, { status: 409 })
  }

  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(novoId, {
    app_metadata: { centro_id },
  })

  if (metaError) {
    await supabaseAdmin.auth.admin.deleteUser(novoId)
    return NextResponse.json({ error: `Erro ao definir permissões: ${metaError.message}` }, { status: 500 })
  }

  const { error: dbError } = await supabaseAdmin.from('alunos').insert({
    id: novoId,
    nome,
    email: emailFinal,
    data_nascimento,
    telefone_encarregado,
    email_encarregado,
    nif_encarregado,
    morada_encarregado,
    telemovel_aluno,
    ano_escolar: anoEscolarNum,
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

  // O aluno (e a password gerada no servidor) já existem nesta altura — uma
  // falha nos horários não pode reverter a matrícula, porque a password só
  // é mostrada uma vez e perder-se-ia. Só avisa.
  let avisoHorarios: string | null = null
  if (Array.isArray(dias_selecionados) && dias_selecionados.length > 0) {
    const horarios = dias_selecionados.map((dia: number) => ({ aluno_id: novoId, dia_semana: dia, centro_id }))
    const { error: horariosError } = await supabaseAdmin.from('aluno_horarios').insert(horarios)
    if (horariosError) {
      avisoHorarios = 'O aluno foi criado, mas não foi possível gravar os dias de frequência. Define-os em "Editar Aluno".'
    }
  }

  // Mesma lógica: uma falha aqui não apaga o aluno — o admin ainda pode
  // gerar o código depois, na ficha.
  const codigo = gerarCodigoSeguro()
  const { error: codigoError } = await supabaseAdmin.rpc('definir_codigo_encarregado', {
    p_aluno_id: novoId,
    p_codigo: codigo,
  })

  return NextResponse.json(
    {
      ok: true,
      alunoId: novoId,
      nomeUtilizador: nomeUtilizadorFinal,
      password,
      codigo: codigoError ? null : codigo,
      avisoCodigo: codigoError
        ? 'O aluno foi criado, mas não foi possível gerar o código dos encarregados. Usa "Gerar código" na ficha do aluno.'
        : null,
      avisoHorarios,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
