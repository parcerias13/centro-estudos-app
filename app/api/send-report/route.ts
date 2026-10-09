import { Resend } from 'resend';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const role = user.app_metadata?.role?.toLowerCase();
  if (role !== 'admin' && role !== 'secretaria') {
    return NextResponse.json({ error: 'Sem permissões.' }, { status: 403 });
  }

  const centroChamador = user.app_metadata?.centro_id;
  if (!centroChamador) {
    return NextResponse.json({ error: 'Centro não identificado.' }, { status: 403 });
  }

  const { studentId, reportHtml } = await req.json();

  if (!studentId || typeof studentId !== 'string' || !REGEX_UUID.test(studentId)) {
    return NextResponse.json({ error: 'Aluno inválido.' }, { status: 400 });
  }
  if (!reportHtml || typeof reportHtml !== 'string') {
    return NextResponse.json({ error: 'Relatório em falta.' }, { status: 400 });
  }

  // Nunca confiar no targetEmail nem no studentName do cliente — o aluno tem
  // de ser do mesmo centro de quem chama (404 genérico se não for, para não
  // revelar se o id existe noutro centro), e o destino é sempre o
  // email_encarregado já guardado, nunca o que vier no pedido.
  const { data: aluno } = await supabaseAdmin
    .from('alunos')
    .select('id, nome, centro_id, email_encarregado')
    .eq('id', studentId)
    .maybeSingle();

  if (!aluno || aluno.centro_id !== centroChamador) {
    return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });
  }

  if (!aluno.email_encarregado) {
    return NextResponse.json({ error: 'O aluno não tem email de encarregado definido.' }, { status: 400 });
  }

  const { data: config } = await supabaseAdmin
    .from('config_centro')
    .select('resend_api_key, email_remetente, nome_centro')
    .eq('id', centroChamador)
    .maybeSingle();

  if (!config?.resend_api_key || !config?.email_remetente) {
    return NextResponse.json({ error: 'Centro sem email configurado.' }, { status: 400 });
  }

  const resend = new Resend(config.resend_api_key);

  const { error } = await resend.emails.send({
    from: `${config.nome_centro} <${config.email_remetente}>`,
    to: [aluno.email_encarregado],
    subject: `Relatório de Performance: ${aluno.nome}`,
    html: reportHtml,
  });

  if (error) {
    console.error('send-report: falha ao enviar email', error);
    return NextResponse.json({ error: 'Não foi possível enviar o email.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
