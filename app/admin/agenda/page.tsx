'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { CalendarDays, BookOpen, User, Loader2, ArrowLeft, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function AdminAgendaReadonly() {
  const [groupedExams, setGroupedExams] = useState<any>({});
  const [loading, setLoading] = useState(true);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => { 
    fetchExams(); 
  }, []);

  const fetchExams = async () => {
    const today = new Date().toISOString().split('T')[0];
    
    // CORREÇÃO DE QUERY: Garantir que buscamos tudo sem filtros de ID
    const { data, error } = await supabase
      .from('exams')
      .select('*, alunos(nome)') // Se isto der erro, verifica se a FK no Supabase se chama 'alunos'
      .gte('date', today)
      .order('date', { ascending: true });

    if (error) {
      console.error("Erro na Agenda Admin:", error.message);
    }

    if (data) {
      const groups: any = {};
      data.forEach((exam) => {
        if (!groups[exam.date]) groups[exam.date] = [];
        groups[exam.date].push(exam);
      });
      setGroupedExams(groups);
    }
    setLoading(false);
  };

  const getWeekDay = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-PT', { weekday: 'long' });
  };
  
  const getDayAndMonth = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-PT', { day: '2-digit', month: 'long' });
  };

  const getIntensityColor = (count: number) => {
    if (count >= 4) return 'bg-red-500/10 border-red-500/30 text-red-500';
    if (count >= 2) return 'bg-amber-500/10 border-amber-500/30 text-amber-500';
    return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
  };

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] p-4 md:p-8 text-white font-sans">
      
      {/* CABEÇALHO RESPONSIVO */}
      <header className="mb-8 md:mb-12 max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/admin" className="p-3 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-colors">
            <ArrowLeft size={20} className="text-slate-400" />
          </Link>
          <div className="bg-purple-500/10 text-purple-400 p-3 rounded-2xl border border-purple-500/20">
             <CalendarDays size={24} />
          </div>
        </div>
        <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter uppercase">Mapa de Testes</h1>
        <p className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-widest mt-2">
          Visão global dos compromissos escolares
        </p>
      </header>

      {/* TIMELINE AJUSTADA PARA MOBILE */}
      <div className="max-w-4xl mx-auto">
        {Object.keys(groupedExams).length === 0 ? (
          <div className="bg-slate-900/40 border-2 border-dashed border-slate-800 p-10 md:p-20 rounded-4xl md:rounded-[3rem] text-center flex flex-col items-center">
            <BookOpen size={48} className="mb-6 text-slate-700" />
            <p className="text-slate-500 font-bold text-lg text-center">A agenda está limpa.</p>
          </div>
        ) : (
          <div className="space-y-10 border-l-2 border-slate-800/50 ml-2 md:ml-6 pl-6 md:pl-10 relative">
            
            {Object.keys(groupedExams).map((date) => {
              const count = groupedExams[date].length;
              const intensity = getIntensityColor(count);

              return (
                <div key={date} className="relative">
                  {/* Ponto na Timeline ajustado */}
                  <div className={`absolute -left-8.25 md:-left-12.25 top-1.5 w-4 h-4 md:w-6 md:h-6 rounded-full border-4 border-[#0f172a] ${intensity.split(' ')[0]} ${intensity.split(' ')[2].replace('text-', 'bg-')}`}></div>
                  
                  <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-6">
                    <h2 className="text-xl md:text-2xl font-black capitalize">{getWeekDay(date)}</h2>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 font-medium text-sm">{getDayAndMonth(date)}</span>
                      <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${intensity}`}>
                        {count} {count === 1 ? 'Teste' : 'Testes'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {groupedExams[date].map((exam: any) => {
                       const nomeAluno = Array.isArray(exam.alunos) ? exam.alunos[0]?.nome : exam.alunos?.nome;
                       return (
                        <div key={exam.id} className="bg-slate-900 border border-slate-800 p-5 md:p-6 rounded-3xl md:rounded-4xl hover:border-purple-500/50 transition-colors">
                          <div className="flex justify-between items-start mb-4">
                            <div className="bg-purple-500/10 text-purple-400 p-2.5 rounded-xl">
                              <BookOpen size={18} />
                            </div>
                            <div className="max-w-37.5 truncate bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
                              <span className="text-[10px] font-bold text-slate-300">{nomeAluno || 'Aluno Desconhecido'}</span>
                            </div>
                          </div>
                          <h3 className="text-lg md:text-xl font-black text-white">{exam.subject_name}</h3>
                          <p className="text-xs md:text-sm text-slate-500 mt-2 line-clamp-2">{exam.topics || 'Sem matéria detalhada'}</p>
                        </div>
                       )
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}