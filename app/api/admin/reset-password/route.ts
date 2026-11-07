import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomInt } from 'node:crypto'
import { exigirAdmin } from '@/lib/apiAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const CHARS_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function gerarPasswordSegura(tamanho = 10): string {
  return Array.from({ length: tamanho }, () => CHARS_PASSWORD[randomInt(0, CHARS_PASSWORD.length)]).join('')
}

export async function POST(req: Request) {
  const auth = await exigirAdmin()
  if ('erro' in auth) return auth.erro
  const centroAdmin = auth.centro_id

  const { alunoId, staffId, novaPassword } = await req.json()

  if (alunoId && staffId) {
    return NextResponse.json({ error: 'Indica apenas um: alunoId ou staffId.' }, { status: 400 })
  }

  let targetId: string

  if (staffId !== undefined) {
    if (!staffId || typeof staffId !== 'string' || !REGEX_UUID.test(staffId)) {
      return NextResponse.json({ error: 'ID da equipa inválido.' }, { status: 400 })
    }

    // Confirma que o alvo é professor ou secretaria do mesmo centro deste
    // admin — nunca outro admin, nunca de outro centro. 404 genérico em
    // todos os casos, para não revelar se o id existe noutro centro nem
    // se pertence a um admin.
    const { data: staffAlvo } = await supabaseAdmin.from('staff').select('id, centro_id, role').eq('id', staffId).maybeSingle()
    const papelAlvo = staffAlvo?.role?.toLowerCase()
    if (!staffAlvo || staffAlvo.centro_id !== centroAdmin || papelAlvo === 'admin') {
      return NextResponse.json({ error: 'Membro da equipa não encontrado.' }, { status: 404 })
    }
    targetId = staffId
  } else {
    if (!alunoId || typeof alunoId !== 'string' || !REGEX_UUID.test(alunoId)) {
      return NextResponse.json({ error: 'ID do aluno inválido.' }, { status: 400 })
    }

    // Confirma que o alvo é mesmo um aluno do centro deste admin — nunca um
    // staff, nunca de outro centro. 404 genérico em ambos os casos, para não
    // revelar se o id existe noutro centro.
    const { data: aluno } = await supabaseAdmin.from('alunos').select('id, centro_id').eq('id', alunoId).maybeSingle()
    if (!aluno || aluno.centro_id !== centroAdmin) {
      return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 })
    }
    targetId = alunoId
  }

  // Sem novaPassword: pediu-se para gerar uma, o servidor gera-a aqui com
  // crypto (nunca Math.random no cliente) e devolve-a uma vez. Com
  // novaPassword: escreveu-se uma à mão, usa-se tal como está.
  let passwordFinal = novaPassword
  if (passwordFinal == null || passwordFinal === '') {
    passwordFinal = gerarPasswordSegura()
  } else if (typeof passwordFinal !== 'string' || passwordFinal.length < 6) {
    return NextResponse.json({ error: 'A password deve ter no mínimo 6 caracteres.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(targetId, { password: passwordFinal })

  if (error) {
    console.error('reset-password: falha ao atualizar password', error)
    return NextResponse.json({ error: 'Não foi possível atualizar a password.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, password: passwordFinal }, { headers: { 'Cache-Control': 'no-store' } })
}
