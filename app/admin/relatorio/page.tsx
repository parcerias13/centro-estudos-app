'use client';

import { useState, useEffect, Suspense } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, FileText, User, Clock, BookOpen, Calendar, ShieldAlert, Download } from 'lucide-react';

function RelatorioContent() {
  const searchParams = useSearchParams();
  const studentId = searchParams.get('id');
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<any>(null);
  const [stats, setStats] = useState<any>({ totalVisits: 0, totalHours: 0, topSubject: '-' });
  const [history, setHistory] = useState<any[]>([]);

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

    // 2. Histórico Completo (para estatísticas)
    const { data: entries } = await supabase
      .from('diario_bordo')
      .select('*')
      .eq('student_id', studentId)
      .not('checkout_at', 'is', null) // Só sessões terminadas conta para horas
      .order('created_at', { ascending: false });

    if (entries && entries.length > 0) {
        setHistory(entries.slice(0, 10)); // Últimas 10 para a tabela

        // Cálculos
        let totalMs = 0;
        const subjects: Record<string, number> = {};
        
        entries.forEach(e => {
            totalMs += new Date(e.checkout_at).getTime() - new Date(e.created_at).getTime();
            subjects[e.subject_name] = (subjects[e.subject_name] || 0) + 1;
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

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;
  if (!student) return <div className="p-8 text-white">Aluno não encontrado.</div>;

  return (
    <main className="min-h-screen bg-slate-950 p-6">
      <div className="max-w-4xl mx-auto bg-white rounded-3xl overflow-hidden shadow-2xl">
        
        {/* CABEÇALHO DO RELATÓRIO (Estilo "Print") */}
        <div className="bg-slate-800 p-8 text-white flex justify-between items-start">
            <div>
                <h1 className="text-3xl font-black uppercase tracking-wider mb-2 flex items-center gap-3">
                    <FileText size={28} className="text-blue-400" />
                    Relatório de Performance
                </h1>
                <p className="opacity-80">Centro de Estudos - Documento Interno</p>
            </div>
             <div className="text-right">
                <p className="font-bold text-xl">{student.nome}</p>
                <p className="text-sm opacity-70">{student.email}</p>
                <div className="mt-2 inline-flex items-center gap-2 bg-slate-700 px-3 py-1 rounded-full text-xs font-bold">
                    <ShieldAlert size={14} className={student.saida_autorizada ? "text-emerald-400" : "text-red-400"} />
                    {student.saida_autorizada ? "Saída Autorizada" : "Requer Acompanhante"}
                </div>
            </div>
        </div>

        {/* CORPO DO RELATÓRIO */}
        <div className="p-8 text-slate-800">
            
            {/* 1. RESUMO GERAL (Cards Brancos) */}
            <div className="grid grid-cols-3 gap-6 mb-10">
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                    <div className="flex items-center gap-2 text-blue-600 mb-2">
                        <Clock size={20} />
                        <h3 className="font-bold uppercase text-xs tracking-wider">Volume Total</h3>
                    </div>
                    <p className="text-4xl font-black">{stats.totalHours}<span className="text-sm text-slate-500 font-normal ml-1">horas</span></p>
                </div>
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                     <div className="flex items-center gap-2 text-purple-600 mb-2">
                        <Calendar size={20} />
                        <h3 className="font-bold uppercase text-xs tracking-wider">Frequência</h3>
                    </div>
                    <p className="text-4xl font-black">{stats.totalVisits}<span className="text-sm text-slate-500 font-normal ml-1">sessões</span></p>
                    <p className="text-xs text-slate-500 mt-1 font-bold">Plano: {student.limite_semanal === 99 ? 'Livre' : `${student.limite_semanal}x/semana`}</p>
                </div>
                 <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                     <div className="flex items-center gap-2 text-orange-600 mb-2">
                        <BookOpen size={20} />
                        <h3 className="font-bold uppercase text-xs tracking-wider">Foco Principal</h3>
                    </div>
                    <p className="text-xl font-black truncate" title={stats.topSubject}>{stats.topSubject}</p>
                </div>
            </div>

            {/* 2. HISTÓRICO RECENTE (Tabela Limpa) */}
            <h2 className="font-bold text-xl mb-4 flex items-center gap-2">
                <Clock size={20} className="text-slate-400" />
                Últimas Atividades
            </h2>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-100 text-slate-500 text-xs uppercase font-bold">
                        <tr>
                            <th className="p-4">Data</th>
                            <th className="p-4">Disciplina</th>
                            <th className="p-4">Entrada</th>
                            <th className="p-4">Saída</th>
                            <th className="p-4 text-center">Estado</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                        {history.length === 0 ? (
                            <tr><td colSpan={5} className="p-6 text-center text-slate-500">Sem histórico recente.</td></tr>
                        ) : (
                            history.map(entry => (
                                <tr key={entry.id}>
                                    <td className="p-4 font-bold text-slate-700">
                                        {new Date(entry.created_at).toLocaleDateString('pt-PT')}
                                    </td>
                                    <td className="p-4">{entry.subject_name}</td>
                                    <td className="p-4 font-mono text-sm text-slate-500">
                                        {new Date(entry.created_at).toLocaleTimeString('pt-PT', {hour:'2-digit', minute:'2-digit'})}
                                    </td>
                                     <td className="p-4 font-mono text-sm text-slate-500">
                                        {entry.checkout_at ? new Date(entry.checkout_at).toLocaleTimeString('pt-PT', {hour:'2-digit', minute:'2-digit'}) : '-'}
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className={`text-xs font-bold uppercase px-2 py-1 rounded-full ${
                                            entry.status === 'checkout' ? 'bg-green-100 text-green-700' : 
                                            entry.status === 'falta' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                                        }`}>
                                            {entry.status === 'checkout' ? 'Concluído' : entry.status}
                                        </span>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* RODAPÉ COM AÇÃO */}
            <div className="mt-8 pt-8 border-t border-slate-200 flex justify-between items-center no-print">
                <Link href="/admin/alunos" className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold transition-colors">
                    <ArrowLeft size={18} /> Voltar à Lista
                </Link>
                <button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg transition-all active:scale-95">
                    <Download size={18} /> Imprimir / Guardar PDF
                </button>
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