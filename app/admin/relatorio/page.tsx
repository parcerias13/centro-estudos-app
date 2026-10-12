'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { supabase } from '@/lib/supabase';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, FileText, User, Clock, BookOpen, Calendar, ShieldAlert, Download } from 'lucide-react';
import { getHojeLisboa } from '@/lib/dataLisboa';
import { calcularMetricasMes, intervaloDoMes } from '@/lib/relatorio';

function RelatorioContent() {
  const searchParams = useSearchParams();
  const studentId = searchParams.get('id');
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<any>(null);
  const [stats, setStats] = useState<any>({ totalVisits: 0, totalHours: 0, topSubject: '-' });
  const [history, setHistory] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);

    // 1. Dados do Aluno
    const { data: alunoData } = await supabase
      .from('alunos')
      .select('*')
      .eq('id', studentId)
      .single();
    setStudent(alunoData);

    // Mês atual sempre via getHojeLisboa() — nunca new Date() local.
    const [anoAtual, mesAtual] = getHojeLisboa().split('-').map(Number);

    // 2. Histórico do mês para a Linha do Tempo (mesmo intervalo da lib).
    const { inicioISO, fimISO } = intervaloDoMes(anoAtual, mesAtual);
    const { data: entries } = await supabase
      .from('diario_bordo')
      .select('*')
      .eq('aluno_id', studentId)
      .gte('entrada', inicioISO)
      .lte('entrada', fimISO)
      .order('entrada', { ascending: false });

    if (entries) setHistory(entries);

    // 3. Métricas do mês — mesmo cálculo que o envio em lote usa, para os
    // números nunca divergirem.
    const metricas = await calcularMetricasMes(supabase, studentId, anoAtual, mesAtual);
    setStats({
      totalVisits: metricas.totalSessoes,
      totalHours: metricas.totalHoras,
      topSubject: metricas.disciplinaPrincipal,
    });

    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" size={32} /></div>;
  if (!student) return <div className="p-8 text-primary">Aluno não encontrado.</div>;

  const nomeMes = new Date().toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });

  return (
    <main className="min-h-screen bg-page p-6">
      <div className="max-w-4xl mx-auto bg-white rounded-3xl overflow-hidden shadow-2xl">
        {/* HEADER */}
        <div className="bg-raised p-8 text-primary flex justify-between items-start">
            <div>
                <h1 className="text-3xl font-black uppercase tracking-wider mb-2 flex items-center gap-3">
                    <FileText size={28} className="text-accent" />
                    Performance
                </h1>
                <p className="opacity-80 capitalize">Resumo de {nomeMes}</p>
            </div>
             <div className="text-right">
                <p className="font-bold text-xl">{student.nome}</p>
                <div className="mt-2 inline-flex items-center gap-2 bg-border px-3 py-1 rounded-full text-xs font-bold">
                    <ShieldAlert size={14} className={student.saida_autorizada ? "text-success" : "text-danger"} />
                    {student.saida_autorizada ? "Saída Autorizada" : "Requer Acompanhante"}
                </div>
            </div>
        </div>

        <div className="p-8 text-slate-800">
            {/* STATS CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                    <div className="flex items-center gap-2 text-accent mb-2">
                        <Clock size={20} />
                        <h3 className="font-bold uppercase text-[10px] tracking-widest">Horas Acumuladas</h3>
                    </div>
                    <p className="text-4xl font-black">{stats.totalHours}<span className="text-sm text-muted font-normal ml-1">h</span></p>
                </div>
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                     <div className="flex items-center gap-2 text-purple-600 mb-2">
                        <Calendar size={20} />
                        <h3 className="font-bold uppercase text-[10px] tracking-widest">Frequência</h3>
                    </div>
                    <p className="text-4xl font-black">{stats.totalVisits}</p>
                    <p className="text-[10px] text-secondary mt-1 font-bold uppercase">Sessões Concluídas</p>
                </div>
                 <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200">
                     <div className="flex items-center gap-2 text-orange-600 mb-2">
                        <BookOpen size={20} />
                        <h3 className="font-bold uppercase text-[10px] tracking-widest">Principal Foco</h3>
                    </div>
                    <p className="text-lg font-black truncate" title={stats.topSubject}>{stats.topSubject}</p>
                </div>
            </div>

            {/* HISTORY TABLE */}
            <h2 className="font-bold text-xl mb-4 text-secondary">Linha do Tempo</h2>
            <div className="border border-slate-100 rounded-2xl overflow-hidden overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 text-secondary text-[10px] uppercase font-black tracking-widest">
                        <tr>
                            <th className="p-4">Data</th>
                            <th className="p-4">Disciplina</th>
                            <th className="p-4">Horário</th>
                            <th className="p-4 text-center">Estado</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {history.length === 0 ? (
                            <tr><td colSpan={4} className="p-10 text-center text-secondary font-medium">Sem atividade registada este mês.</td></tr>
                        ) : (
                            history.map(entry => (
                                <tr key={entry.id} className="hover:bg-slate-50/50 transition-colors">
                                    <td className="p-4 font-bold text-muted">{new Date(entry.entrada).toLocaleDateString('pt-PT')}</td>
                                    <td className="p-4 text-sm font-medium">{entry.subject_name || 'Estudo Geral'}</td>
                                    <td className="p-4 font-mono text-xs text-secondary">
                                        {new Date(entry.entrada).toLocaleTimeString('pt-PT', {hour:'2-digit', minute:'2-digit'})} 
                                        {entry.saida ? ` → ${new Date(entry.saida).toLocaleTimeString('pt-PT', {hour:'2-digit', minute:'2-digit'})}` : ' (Em curso...)'}
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-full ${entry.saida ? 'bg-success-bg text-success' : 'bg-accent-soft text-accent animate-pulse'}`}>
                                            {entry.saida ? 'Concluído' : 'Estudar'}
                                        </span>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* ACTIONS */}
            <div className="mt-10 pt-8 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6 no-print">
                <Link href="/admin/alunos" className="flex items-center gap-2 text-secondary hover:text-slate-900 font-bold transition-colors text-sm">
                    <ArrowLeft size={16} /> Painel de Gestão
                </Link>
                <button onClick={() => window.print()} className="bg-accent hover:bg-accent-hover text-on-accent px-8 py-4 rounded-2xl font-black flex items-center gap-3 shadow-lg shadow-accent/20">
                    <Download size={20} /> PDF
                </button>
            </div>
        </div>
      </div>
    </main>
  );
}

export default function RelatorioPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>}>
      <RelatorioContent />
    </Suspense>
  );
}