'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { CalendarDays, BookOpen, User, Loader2, ArrowLeft, ChevronRight, AlertCircle } from 'lucide-react';
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
    
    // Busca exames e os nomes dos alunos
    const { data } = await supabase
      .from('exams')
      .select('*, alunos(nome)')
      .gte('date', today)
      .order('date', { ascending: true });

    if (data) {
      // Lógica para agrupar testes pela mesma data
      const groups: any = {};
      data.forEach((exam) => {
        if (!groups[exam.date]) groups[exam.date] = [];
        groups[exam.date].push(exam);
      });
      setGroupedExams(groups);
    }
    setLoading(false);
  };

  // Funções de formatação de datas
  const getWeekDay = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-PT', { weekday: 'long' });
  };
  
  const getDayAndMonth = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-PT', { day: '2-digit', month: 'long' });
  };

  // Inteligência visual: se há muitos testes no mesmo dia, alerta a cor
  const getIntensityColor = (count: number) => {
    if (count >= 4) return 'bg-red-500/10 border-red-500/30 text-red-500';
    if (count >= 2) return 'bg-amber-500/10 border-amber-500/30 text-amber-500';
    return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
  };

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] p-8 text-white font-sans">
      
      {/* CABEÇALHO */}
      <header className="mb-12">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/admin" className="p-3 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-colors group">
            <ArrowLeft size={20} className="text-slate-400 group-hover:text-white" />
          </Link>
          <div className="bg-purple-500/10 text-purple-400 p-3 rounded-2xl border border-purple-500/20">
             <CalendarDays size={24} />
          </div>
        </div>
        <h1 className="text-4xl font-black italic tracking-tighter uppercase">Mapa de Testes</h1>
        <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-2">
          Visão global dos compromissos escolares reportados pelos alunos
        </p>
      </header>

      {/* TIMELINE DE TESTES */}
      <div className="max-w-4xl">
        {Object.keys(groupedExams).length === 0 ? (
          <div className="bg-slate-900/40 border-2 border-dashed border-slate-800 p-20 rounded-[3rem] text-center flex flex-col items-center">
            <BookOpen size={48} className="mb-6 text-slate-700" />
            <p className="text-slate-500 font-bold text-lg">A agenda dos teus alunos está limpa.</p>
            <p className="text-slate-600 text-sm mt-2">Não há testes marcados para os próximos dias.</p>
          </div>
        ) : (
          <div className="space-y-10 border-l-2 border-slate-800/50 ml-6 pl-10 relative">
            
            {Object.keys(groupedExams).map((date, index) => {
              const count = groupedExams[date].length;
              const intensity = getIntensityColor(count);

              return (
                <div key={date} className="relative">
                  {/* Ponto na Timeline */}
                  <div className={`absolute -left-12.25 top-1.5 w-6 h-6 rounded-full border-4 border-[#0f172a] ${intensity.split(' ')[0]} ${intensity.split(' ')[2].replace('text-', 'bg-')}`}></div>
                  
                  {/* Cabeçalho da Data */}
                  <div className="flex items-center gap-4 mb-6">
                    <h2 className="text-2xl font-black capitalize">{getWeekDay(date)}</h2>
                    <span className="text-slate-400 font-medium">{getDayAndMonth(date)}</span>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${intensity}`}>
                      {count} {count === 1 ? 'Teste' : 'Testes'}
                    </span>
                  </div>

                  {/* Grelha de Exames desse dia */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {groupedExams[date].map((exam: any) => {
                       const nomeAluno = Array.isArray(exam.alunos) ? exam.alunos[0]?.nome : exam.alunos?.nome;
                       
                       return (
                        <div key={exam.id} className="bg-slate-900 border border-slate-800 p-6 rounded-4xl hover:border-purple-500/50 transition-colors group">
                          <div className="flex justify-between items-start mb-4">
                            <div className="bg-purple-500/10 text-purple-400 p-2.5 rounded-xl">
                              <BookOpen size={18} />
                            </div>
                            <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800">
                              <User size={12} className="text-slate-500" />
                              <span className="text-xs font-bold text-slate-300">{nomeAluno || 'Aluno Desconhecido'}</span>
                            </div>
                          </div>
                          
                          <h3 className="text-xl font-black text-white group-hover:text-purple-300 transition-colors">
                            {exam.subject_name}
                          </h3>
                          
                          {exam.topics ? (
                            <p className="text-sm text-slate-500 mt-2 line-clamp-2 leading-relaxed">
                              {exam.topics}
                            </p>
                          ) : (
                            <div className="flex items-center gap-2 mt-2 text-slate-600 italic text-xs">
                              <AlertCircle size={12} /> Sem matéria detalhada
                            </div>
                          )}
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