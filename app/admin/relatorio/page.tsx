'use client';

import { useState, useEffect, Suspense } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, FileText, User, Clock, BookOpen, Calendar, ShieldAlert, Download, Mail, CheckCircle2 } from 'lucide-react';

function RelatorioContent() {
  const searchParams = useSearchParams();
  const studentId = searchParams.get('id');
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<any>(null);
  const [stats, setStats] = useState<any>({ totalVisits: 0, totalHours: 0, topSubject: '-' });
  const [history, setHistory] = useState<any[]>([]);

  const [isSending, setIsSending] = useState(false);
  const [sentStatus, setSentStatus] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    if (studentId) fetchData();
  }, [studentId]);

  const fetchData = async () => {
    // 1. Dados do Aluno
    const { data: alunoData } = await supabase
      .from('alunos')
      .select('*')
      .eq('id', studentId)
      .single();
    setStudent(alunoData);

    // LÓGICA DE DATA: Primeiro dia do mês corrente
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    // 2. Histórico de Sessões - Filtro Mensal (.gte)
    const { data: entries } = await supabase
      .from('diario_bordo')
      .select('*')
      .eq('aluno_id', studentId)
      .not('saida', 'is', null)
      .gte('entrada', inicioMes.toISOString()) // Filtra a partir do dia 1 às 00:00
      .order('entrada', { ascending: false });

    if (entries) {
        // Mostra todos os registos do mês no histórico
        setHistory(entries);

        let totalMs = 0;
        const subjects: Record<string, number> = {};
        
        entries.forEach(e => {
            if (e.saida && e.entrada) {
              totalMs += new Date(e.saida).getTime() - new Date(e.entrada).getTime();
              subjects[e.subject_name] = (subjects[e.subject_name] || 0) + 1;
            }
        });

        const topSubjectEntry = Object.entries(subjects).sort((a, b) => b[1] - a[1])[0];

        setStats({
            totalVisits: entries.length,
            totalHours: Math.round(totalMs / (1000 * 60 * 60)),
            topSubject: topSubjectEntry ? `${topSubjectEntry[0]} (${topSubjectEntry[1]}x)` : '-'
        });
    }
    setLoading(false);
  };

  const handleSendEmail = async () => {
    if (!student?.email_encarregado) {
      return alert("Erro: Este aluno não tem um e-mail de encarregado registado.");
    }

    setIsSending(true);

    const reportHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background: #ffffff; padding: 40px; border-radius: 20px; border: 1px solid #e2e8f0;">
        <h1 style="color: #2563eb; font-size: 24px; font-weight: 900; text-transform: uppercase; margin-bottom: 20px;">Relatório Mensal de Performance</h1>
        <p style="font-size: 16px;">Olá, segue o resumo das atividades do(a) aluno(a) <strong>${student.nome}</strong> referente ao mês atual.</p>
        
        <div style="background: #f8fafc; padding: 25px; border-radius: 15px; border: 1px solid #e2e8f0; margin: 20px 0;">
          <p style="margin: 8px 0; font-size: 15px;"><strong>Volume no Mês:</strong> ${stats.totalHours} horas</p>
          <p style="margin: 8px 0; font-size: 15px;"><strong>Sessões Concluídas:</strong> ${stats.totalVisits}</p>
          <p style="margin: 8px 0; font-size: 15px;"><strong>Foco Principal:</strong> ${stats.topSubject}</p>
        </div>

        <p style="font-size: 12px; color: #64748b; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
          Este é um relatório automático gerado pelo sistema <strong>CogniLab</strong>.
        </p>
      </div>
    `;

    try {
      const response = await fetch('/api/send-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          targetEmail: student.email_encarregado,
          studentName: student.nome,
          reportHtml: reportHtml
        }),
      });

      if (response.ok) {
        setSentStatus(true);
        setTimeout(() => setSentStatus(false), 5000);
      } else {
        alert("Erro ao enviar email.");
      }
    } catch (err) {
      alert("Falha na ligação ao servidor.");
    } finally {
      setIsSending(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;
  if (!student) return <div className="p-8 text-white">Aluno não encontrado.</div>;

  const nomeMes = new Date().toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

  return (
    <main className="min-h-screen bg-slate-950 p-6">
      <div className="max-w-4xl mx-auto bg-white rounded-3xl overflow-hidden shadow-2xl">
        
        <div className="bg-slate-800 p-8 text-white flex justify-between items-start">
            <div>
                <h1 className="text-3xl font-black uppercase tracking-wider mb-2 flex items-center gap-3">
                    <FileText size={28} className="text-blue-400" />
                    Performance
                </h1>
                <p className="opacity-80 capitalize">Relatório de {nomeMes}</p>
            </div>
             <div className="text-right">
                <p className="font-bold text-xl">{student.nome}</p>
                <p className="text-sm opacity-70">{student.email_encarregado}</p>
                <div className="mt-2 inline-flex items-center gap-2 bg-slate-700 px-3 py-1 rounded-full text-xs font-bold">
                    <ShieldAlert size={14} className={student.saida_autorizada ? "text-emerald-400" : "text-red-400"} />
                    {student.saida_autorizada ? "Saída Autorizada" : "Requer Acompanhante"}
                </div>
            </div>
        </div>

        <div className="p-8 text-slate-800">
            <div className="grid grid-cols-3 gap-6 mb-10">
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                    <div className="flex items-center gap-2 text-blue-600 mb-2">
                        <Clock size={20} />
                        <h3 className="font-bold uppercase text-xs tracking-wider">Horas no Mês</h3>
                    </div>
                    <p className="text-4xl font-black">{stats.totalHours}<span className="text-sm text-slate-500 font-normal ml-1">h</span></p>
                </div>
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                     <div className="flex items-center gap-2 text-purple-600 mb-2">
                        <Calendar size={20} />
                        <h3 className="font-bold uppercase text-xs tracking-wider">Frequência</h3>
                    </div>
                    <p className="text-4xl font-black">{stats.totalVisits}</p>
                    <p className="text-[10px] text-slate-400 mt-1 font-bold uppercase">Sessões em {nomeMes}</p>
                </div>
                 <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                     <div className="flex items-center gap-2 text-orange-600 mb-2">
                        <BookOpen size={20} />
                        <h3 className="font-bold uppercase text-xs tracking-wider">Principal Foco</h3>
                    </div>
                    <p className="text-lg font-black truncate" title={stats.topSubject}>{stats.topSubject}</p>
                </div>
            </div>

            <h2 className="font-bold text-xl mb-4 flex items-center gap-2 text-slate-400">
                Atividades de {nomeMes}
            </h2>
            <div className="border border-slate-100 rounded-2xl overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase font-black tracking-widest">
                        <tr>
                            <th className="p-4">Data</th>
                            <th className="p-4">Disciplina</th>
                            <th className="p-4">Entrada/Saída</th>
                            <th className="p-4 text-center">Estado</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 bg-white">
                        {history.length === 0 ? (
                            <tr><td colSpan={4} className="p-10 text-center text-slate-300 font-medium">Nenhum registo este mês.</td></tr>
                        ) : (
                            history.map(entry => (
                                <tr key={entry.id} className="hover:bg-slate-50/50 transition-colors">
                                    <td className="p-4 font-bold text-slate-700">{new Date(entry.entrada).toLocaleDateString('pt-PT')}</td>
                                    <td className="p-4 text-sm font-medium">{entry.subject_name}</td>
                                    <td className="p-4 font-mono text-xs text-slate-400">
                                        {new Date(entry.entrada).toLocaleTimeString('pt-PT', {hour:'2-digit', minute:'2-digit'})} 
                                        {entry.saida ? ` → ${new Date(entry.saida).toLocaleTimeString('pt-PT', {hour:'2-digit', minute:'2-digit'})}` : ' -'}
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className="text-[10px] font-black uppercase px-3 py-1 rounded-full bg-emerald-100 text-emerald-700">
                                            Concluído
                                        </span>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <div className="mt-10 pt-8 border-t border-slate-100 flex justify-between items-center no-print">
                <Link href="/admin/alunos" className="flex items-center gap-2 text-slate-400 hover:text-slate-900 font-bold transition-colors text-sm">
                    <ArrowLeft size={16} /> Voltar à Gestão
                </Link>
                
                <div className="flex items-center gap-4">
                    <button 
                        onClick={handleSendEmail}
                        disabled={isSending}
                        className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-black transition-all active:scale-[0.98] shadow-xl ${
                        sentStatus 
                            ? 'bg-emerald-600 text-white shadow-emerald-500/20' 
                            : 'bg-slate-900 hover:bg-slate-800 text-white shadow-slate-900/20'
                        }`}
                    >
                        {isSending ? <Loader2 className="animate-spin" size={20} /> : sentStatus ? <CheckCircle2 size={20} /> : <Mail size={20} />}
                        {isSending ? 'A PROCESSAR...' : sentStatus ? 'ENVIADO COM SUCESSO' : 'ENVIAR POR EMAIL'}
                    </button>

                    <button 
                        onClick={() => window.print()} 
                        className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-2xl font-black flex items-center gap-3 shadow-xl shadow-blue-500/20 transition-all active:scale-95"
                    >
                        <Download size={20} /> PDF
                    </button>
                </div>
            </div>

        </div>
      </div>
    </main>
  );
}

export default function RelatorioPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>}>
      <RelatorioContent />
    </Suspense>
  );
}