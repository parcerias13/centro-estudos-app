'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import { ArrowLeft, BarChart3, TrendingUp, Award, Calendar, BookOpen, Clock, Loader2 } from 'lucide-react';

export default function AdminStats() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>({
    totalHours: 0,
    topStudent: { name: '-', hours: 0 },
    topSubject: { name: '-', count: 0 },
    busiestDay: { name: '-', count: 0 },
    daysDistribution: [], 
    subjectsDistribution: [], 
    topStudentsList: [] 
  });

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    processStats();
  }, []);

  const processStats = async () => {
    const { data: entries, error } = await supabase
      .from('diario_bordo')
      .select('*, alunos!aluno_id(nome)')
      .not('saida', 'is', null);

    if (error) {
      console.error("Erro ao puxar estatísticas:", error);
      setLoading(false);
      return;
    }

    if (!entries || entries.length === 0) {
      setLoading(false);
      return;
    }

    let totalMilliseconds = 0;
    const studentMap: Record<string, { name: string, ms: number, visits: number }> = {};
    const subjectMap: Record<string, number> = {};
    const dayMap: Record<number, number> = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 0:0 };

    entries.forEach(entry => {
      const start = new Date(entry.entrada).getTime();
      const end = new Date(entry.saida).getTime();
      const duration = end - start;
      const dayOfWeek = new Date(entry.entrada).getDay();

      if (isNaN(duration) || duration < 0) return;

      totalMilliseconds += duration;

      const sName = Array.isArray(entry.alunos) ? entry.alunos[0]?.nome : entry.alunos?.nome;
      const finalName = sName || 'Desconhecido';
      
      if (!studentMap[finalName]) studentMap[finalName] = { name: finalName, ms: 0, visits: 0 };
      studentMap[finalName].ms += duration;
      studentMap[finalName].visits += 1;

      const subName = entry.subject_name || 'Sessão Livre';
      subjectMap[subName] = (subjectMap[subName] || 0) + 1;

      dayMap[dayOfWeek] += 1;
    });

    const sortedStudents = Object.values(studentMap).sort((a, b) => b.ms - a.ms);
    const topStudentObj = sortedStudents[0];
    const sortedSubjects = Object.entries(subjectMap).sort((a, b) => b[1] - a[1]);
    const topSubjectObj = sortedSubjects[0];
    const daysNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const sortedDays = Object.entries(dayMap).sort((a, b) => b[1] - a[1]);
    const busiestDayIndex = parseInt(sortedDays[0][0]);

    // --- CORREÇÃO DO GRÁFICO (Lógica de Escala Dinâmica) --- //
    // Calculamos o máximo apenas dos dias que vamos mostrar (Seg-Sex) para a escala ser perfeita
    const displayedDays = [1, 2, 3, 4, 5];
    const maxVisitsInChart = Math.max(...displayedDays.map(d => dayMap[d]), 1);
    
    const daysChart = displayedDays.map(d => ({ 
      day: daysNames[d].substring(0, 3), 
      value: dayMap[d],
      // Cálculo da altura relativa ao pico da semana
      percent: (dayMap[d] / maxVisitsInChart) * 100
    }));

    const totalVisits = entries.length;
    const subjectsChart = sortedSubjects.slice(0, 5).map(([name, count]) => ({
      name,
      count,
      percent: (count / totalVisits) * 100
    }));

    setStats({
      totalHours: Math.round(totalMilliseconds / (1000 * 60 * 60)),
      topStudent: { 
        name: topStudentObj?.name || '-', 
        hours: Math.round((topStudentObj?.ms || 0) / (1000 * 60 * 60)) 
      },
      topSubject: { name: topSubjectObj ? topSubjectObj[0] : '-', count: topSubjectObj ? topSubjectObj[1] : 0 },
      busiestDay: { name: daysNames[busiestDayIndex], count: sortedDays[0][1] },
      daysDistribution: daysChart,
      subjectsDistribution: subjectsChart,
      topStudentsList: sortedStudents.slice(0, 5) 
    });

    setLoading(false);
  };

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] text-white p-6 md:p-8 max-w-7xl mx-auto font-sans">
      
      <div className="flex items-center gap-4 mb-10">
        <Link href="/admin" className="p-3 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-colors group">
          <ArrowLeft size={20} className="text-slate-400 group-hover:text-white" />
        </Link>
        <div>
          <h1 className="text-3xl md:text-4xl font-black flex items-center gap-3 italic tracking-tighter uppercase">
            <div className="bg-emerald-500/10 text-emerald-400 p-2 rounded-xl border border-emerald-500/20">
               <BarChart3 size={28} />
            </div>
            Desempenho Global
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Métricas de produtividade e ocupação do centro</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl hover:border-emerald-500/50 transition-colors group">
          <div className="flex justify-between items-start mb-4">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Volume de Estudo</p>
            <Clock size={20} className="text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-4xl font-black text-white">{stats.totalHours} <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">horas</span></p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl hover:border-yellow-500/50 transition-colors group">
          <div className="flex justify-between items-start mb-4">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Melhor Aluno(a)</p>
            <Award size={20} className="text-yellow-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-xl font-black text-white truncate">{stats.topStudent.name}</p>
          <p className="text-xs text-yellow-500 font-bold mt-1 bg-yellow-500/10 px-2 py-1 rounded inline-block">{stats.topStudent.hours} horas registadas</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl hover:border-purple-500/50 transition-colors group">
          <div className="flex justify-between items-start mb-4">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Mais Procurada</p>
            <BookOpen size={20} className="text-purple-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-xl font-black text-white truncate">{stats.topSubject.name}</p>
          <p className="text-xs text-purple-400 font-bold mt-1 bg-purple-500/10 px-2 py-1 rounded inline-block">{stats.topSubject.count} sessões de estudo</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl hover:border-red-500/50 transition-colors group">
          <div className="flex justify-between items-start mb-4">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Dia de Caos</p>
            <Calendar size={20} className="text-red-500 group-hover:scale-110 transition-transform" />
          </div>
          <p className="text-xl font-black text-white truncate">{stats.busiestDay.name}</p>
          <p className="text-xs text-red-400 font-bold mt-1 bg-red-500/10 px-2 py-1 rounded inline-block">Reforçar staff neste dia</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-xl">
          <h3 className="font-black text-sm uppercase text-slate-400 tracking-widest mb-12 flex items-center gap-2">
             <TrendingUp size={18} className="text-blue-500" /> Fluxo Semanal
          </h3>
          
          <div className="flex items-end justify-between h-56 gap-4 px-2">
            {stats.daysDistribution.map((d: any) => (
              <div key={d.day} className="flex flex-col items-center w-full group h-full justify-end">
                <div className="relative w-full flex flex-col items-center">
                    {/* TOOLTIP DINÂMICO */}
                    <div className="absolute -top-10 bg-blue-600 text-white font-black text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
                        {d.value} Entradas
                    </div>
                    
                    {/* BARRA CORRIGIDA COM TRANSIÇÃO */}
                    <div 
                        className="w-full max-w-10 bg-linear-to-t from-blue-700 to-blue-500 rounded-t-xl transition-all duration-1000 ease-out group-hover:from-blue-500 group-hover:to-blue-300 shadow-[0_0_20px_rgba(37,99,235,0.2)]"
                        style={{ height: `${Math.max(d.percent, 8)}%` }} 
                    ></div>
                </div>
                <p className="text-[10px] text-slate-500 mt-4 font-black uppercase tracking-widest">{d.day}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-xl">
          <h3 className="font-black text-sm uppercase text-slate-400 tracking-widest mb-6 flex items-center gap-2">
            <Award size={18} className="text-yellow-500" /> Quadro de Honra
          </h3>
          
          {stats.topStudentsList.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-slate-600 text-sm font-medium italic border-2 border-dashed border-slate-800 rounded-3xl">
                A aguardar conclusão de sessões.
            </div>
          ) : (
            <div className="space-y-4">
              {stats.topStudentsList.map((student: any, index: number) => (
                <div key={index} className="flex items-center justify-between p-4 bg-slate-950 rounded-2xl border border-slate-800 hover:border-slate-600 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg shadow-lg ${
                      index === 0 ? 'bg-yellow-500 text-yellow-950 shadow-yellow-500/20' : 
                      index === 1 ? 'bg-slate-300 text-slate-800' : 
                      index === 2 ? 'bg-orange-700 text-orange-100' : 'bg-slate-800 text-slate-400'
                    }`}>
                      #{index + 1}
                    </div>
                    <div>
                      <p className="font-bold text-white">{student.name}</p>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-1">{student.visits} sessões</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-emerald-400 font-black font-mono text-xl">{Math.round(student.ms / (1000 * 60 * 60))}h</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}