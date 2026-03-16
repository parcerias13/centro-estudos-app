'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import { ArrowLeft, BarChart3, TrendingUp, Award, Clock, Loader2, BookOpen, Calendar } from 'lucide-react';

export default function AdminStats() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>({
    totalHours: 0,
    topStudent: { name: '-', hours: 0 },
    topSubject: { name: '-', count: 0 },
    busiestDay: { name: '-', count: 0 },
    daysDistribution: [], 
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

    let totalMilliseconds = 0;
    const studentMap: Record<string, { name: string, ms: number, visits: number }> = {};
    const subjectMap: Record<string, number> = {};
    const dayMap: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; // Foco Seg a Sex

    if (entries && entries.length > 0) {
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

        // Contabilizar apenas se for dia de semana (1-5)
        if (dayMap.hasOwnProperty(dayOfWeek)) {
          dayMap[dayOfWeek] += 1;
        }
      });
    }

    const sortedStudents = Object.values(studentMap).sort((a, b) => b.ms - a.ms);
    const sortedSubjects = Object.entries(subjectMap).sort((a, b) => b[1] - a[1]);
    const daysNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
    
    // Escala dinâmica: o dia com mais entradas define o 100% da altura
    const maxEntradas = Math.max(...Object.values(dayMap), 1);

    const daysChart = [1, 2, 3, 4, 5].map(d => ({ 
      day: daysNames[d - 1], 
      value: dayMap[d],
      percent: (dayMap[d] / maxEntradas) * 100
    }));

    setStats({
      totalHours: Math.round(totalMilliseconds / (1000 * 60 * 60)),
      topStudent: { 
        name: sortedStudents[0]?.name || '-', 
        hours: Math.round((sortedStudents[0]?.ms || 0) / (1000 * 60 * 60)) 
      },
      topSubject: { 
        name: sortedSubjects[0] ? sortedSubjects[0][0] : '-', 
        count: sortedSubjects[0] ? sortedSubjects[0][1] : 0 
      },
      busiestDay: {
        name: daysNames[parseInt(Object.entries(dayMap).sort((a,b) => b[1]-a[1])[0][0]) - 1] || '-',
        count: maxEntradas
      },
      daysDistribution: daysChart,
      topStudentsList: sortedStudents.slice(0, 5) 
    });

    setLoading(false);
  };

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] text-white p-6 md:p-8 max-w-7xl mx-auto font-sans">
      
      <header className="flex items-center gap-4 mb-10">
        <Link href="/admin" className="p-3 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-colors group">
          <ArrowLeft size={20} className="text-slate-400 group-hover:text-white" />
        </Link>
        <div>
          <h1 className="text-3xl md:text-4xl font-black italic uppercase tracking-tighter flex items-center gap-3">
             <BarChart3 size={28} className="text-blue-500" /> Desempenho Global
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Estatísticas de Ocupação do Centro</p>
        </div>
      </header>

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl">
          <p className="text-slate-400 text-[10px] font-black uppercase mb-4">Volume de Estudo</p>
          <p className="text-4xl font-black">{stats.totalHours} <span className="text-sm font-bold text-slate-500 uppercase">h</span></p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl">
          <p className="text-slate-400 text-[10px] font-black uppercase mb-4">Melhor Aluno(a)</p>
          <p className="text-xl font-black truncate">{stats.topStudent.name}</p>
          <p className="text-[10px] text-blue-500 font-bold mt-1 uppercase">{stats.topStudent.hours}h registadas</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl">
           <p className="text-slate-400 text-[10px] font-black uppercase mb-4">Disciplina Top</p>
           <p className="text-xl font-black truncate">{stats.topSubject.name}</p>
           <p className="text-[10px] text-emerald-500 font-bold mt-1 uppercase">{stats.topSubject.count} sessões</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl">
           <p className="text-slate-400 text-[10px] font-black uppercase mb-4">Dia de Pico</p>
           <p className="text-xl font-black truncate">{stats.busiestDay.name}</p>
           <p className="text-[10px] text-red-500 font-bold mt-1 uppercase">{stats.busiestDay.count} entradas</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* GRÁFICO DE FLUXO */}
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-xl">
          <h3 className="font-black text-sm uppercase text-slate-400 tracking-widest mb-16 flex items-center gap-2">
             <TrendingUp size={18} className="text-blue-500" /> Fluxo Semanal
          </h3>
          
          <div className="h-64 flex items-end justify-between gap-4 px-2 border-b border-slate-800/50">
            {stats.daysDistribution.map((d: any) => (
              <div key={d.day} className="flex flex-col items-center w-full group relative">
                {/* TOOLTIP: "X Entradas" */}
                <div className="absolute -top-10 bg-blue-600 text-white font-black text-[10px] py-1 px-3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow-xl">
                    {d.value} Entradas
                </div>
                
                {/* BARRA: Altura baseada na percentagem real */}
                <div 
                    className="w-full max-w-8.75 bg-blue-600 rounded-t-xl transition-all duration-700 ease-out group-hover:bg-blue-400 shadow-lg shadow-blue-900/20"
                    style={{ height: `${Math.max(d.percent, 5)}%` }} 
                ></div>
                
                <p className="text-[10px] text-slate-500 mt-4 font-black uppercase tracking-widest">{d.day}</p>
              </div>
            ))}
          </div>
        </div>

        {/* QUADRO DE HONRA */}
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-xl">
          <h3 className="font-black text-sm uppercase text-slate-400 tracking-widest mb-6 flex items-center gap-2">
            <Award size={18} className="text-yellow-500" /> Quadro de Honra
          </h3>
          <div className="space-y-4">
            {stats.topStudentsList.map((student: any, index: number) => (
              <div key={index} className="flex items-center justify-between p-4 bg-slate-950 rounded-2xl border border-slate-800 hover:border-slate-700 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center font-black text-slate-400 text-xs">#{index + 1}</div>
                  <p className="font-bold text-sm text-white">{student.name}</p>
                </div>
                <p className="text-emerald-400 font-black font-mono">{Math.round(student.ms / (1000 * 60 * 60))}h</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}