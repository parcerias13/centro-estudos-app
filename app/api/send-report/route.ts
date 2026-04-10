import { Resend } from 'resend';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Inicializamos o Supabase Admin (Server-side)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Precisas desta chave no .env para ler chaves privadas
);

export async function POST(req: Request) {
  try {
    const { studentId, reportHtml, targetEmail, studentName } = await req.json();

    // 1. Descobrir qual é o centro deste aluno
    const { data: student } = await supabase
      .from('alunos')
      .select('centro_id')
      .eq('id', studentId)
      .single();

    if (!student?.centro_id) {
      return NextResponse.json({ error: 'Aluno não associado a um centro' }, { status: 400 });
    }

    // 2. Buscar as configurações e a API Key desse centro específico
    const { data: config } = await supabase
      .from('config_centro')
      .select('resend_api_key, email_remetente, nome_centro')
      .eq('id', student.centro_id)
      .single();

    if (!config?.resend_api_key) {
      return NextResponse.json({ error: 'Centro sem Resend API Key configurada' }, { status: 400 });
    }

    // 3. Inicializar o Resend com a chave DINÂMICA do cliente
    const resend = new Resend(config.resend_api_key);

    // 4. Enviar o e-mail
    const { data, error } = await resend.emails.send({
      from: `${config.nome_centro} <${config.email_remetente}>`,
      to: [targetEmail],
      subject: `Relatório de Performance: ${studentName}`,
      html: reportHtml,
    });

    if (error) return NextResponse.json({ error }, { status: 500 });

    return NextResponse.json({ success: true, data });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}