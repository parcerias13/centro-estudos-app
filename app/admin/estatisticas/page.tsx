'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import { ArrowLeft, BarChart3, TrendingUp, Award, Calendar, BookOpen, Clock, Loader2, AlertCircle } from 'lucide-react';

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

  const CAPACIDADE_MAXIMA = 15; // Define aqui o limite da tua sala

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

    // --- PROCESSAMENTO MESMO SEM ENTRADAS ---
    let totalMilliseconds = 0;
    const studentMap: Record<string, { name: string, ms: number, visits: number }> = {};
    const subjectMap: Record<string, number> = {};
    const dayMap: Record<number, number> = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 0:0 };

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

        dayMap[dayOfWeek] += 1;
      });
    }

    const sortedStudents = Object.values(studentMap).sort((a, b) => b.ms - a.ms);
    const topStudentObj = sortedStudents[0];
    const sortedSubjects = Object.entries(subjectMap).sort((a, b) => b[1] - a[1]);
    const topSubjectObj = sortedSubjects[0];
    const daysNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    
    // Escala baseada na Capacidade Máxima ou no pico real (o que for maior)
    const maxReal = Math.max(...Object.values(dayMap));
    const escalaGrafico = Math.max(maxReal, CAPACIDADE_MAXIMA, 1);

    const daysChart = [1, 2, 3, 4, 5].map(d => ({ 
      day: daysNames[d], 
      value: dayMap[d],
      // Altura calculada sobre a escala fixa
      percent: (dayMap[d] / escalaGrafico) * 100
    }));

    setStats({
      totalHours: Math.round(totalMilliseconds / (1000 * 60 * 60)),
      topStudent: { 
        name: topStudentObj?.name || '-', 
        hours: Math.round((topStudentObj?.ms || 0) / (1000 * 60 * 60)) 
      },
      topSubject: { name: topSubjectObj ? topSubjectObj[0] : '-', count: topSubjectObj ? topSubjectObj[1] : 0 },
      busiestDay: { 
        name: daysNames[parseInt(Object.entries(dayMap).sort((a,b)=>b[1]-a[1])[0][0])] || '-', 
        count: Math.max(...Object.values(dayMap)) 
      },
      daysDistribution: daysChart,
      topStudentsList: sortedStudents.slice(0, 5) 
    });

    setLoading(false);
  };

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] text-white p-6 md:p-8 max-w-7xl mx-auto font-sans">
      
      {/* CABEÇALHO */}
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

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl">
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-4">Volume de Estudo</p>
          <p className="text-4xl font-black text-white">{stats.totalHours} <span className="text-sm font-bold text-slate-500 uppercase">h</span></p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl">
          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-4">Melhor Aluno(a)</p>
          <p className="text-xl font-black text-white truncate">{stats.topStudent.name}</p>
          <p className="text-[10px] text-yellow-500 font-bold mt-1 uppercase">{stats.topStudent.hours}h registadas</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl text-purple-400">
           <p className="text-slate-400 text-[10px] font-black uppercase mb-4">Disciplina Top</p>
           <p className="text-xl font-black text-white truncate">{stats.topSubject.name}</p>
           <p className="text-[10px] font-bold mt-1 uppercase">{stats.topSubject.count} sessões</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl text-red-400">
           <p className="text-slate-400 text-[10px] font-black uppercase mb-4">Pico de Ocupação</p>
           <p className="text-xl font-black text-white truncate">{stats.busiestDay.name}</p>
           <p className="text-[10px] font-bold mt-1 uppercase">{stats.busiestDay.count} alunos max</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {/* GRÁFICO CORRIGIDO COM LINHA DE CAPACIDADE */}
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-xl relative overflow-hidden">
          <h3 className="font-black text-sm uppercase text-slate-400 tracking-widest mb-16 flex items-center gap-2">
             <TrendingUp size={18} className="text-blue-500" /> Fluxo Semanal
          </h3>
          
          <div className="relative h-64 flex items-end justify-between gap-4 px-2 border-b border-slate-800/50">
            
            {/* LINHA DE CAPACIDADE MÁXIMA */}
            <div 
              className="absolute left-0 right-0 border-t-2 border-dashed border-red-500/30 z-0 flex items-center justify-end pr-2"
              style={{ bottom: `${(CAPACIDADE_MAXIMA / Math.max(stats.busiestDay.count, CAPACIDADE_MAXIMA)) * 100}%` }}
            >
              <span className="text-[8px] font-black text-red-500/50 uppercase mb-4">Limite Sala ({CAPACIDADE_MAXIMA})</span>
            </div>

            {stats.daysDistribution.map((d: any) => (
              <div key={d.day} className="flex flex-col items-center w-full group relative z-10">
                <div className="relative w-full flex flex-col items-center justify-end h-48">
                    <div className="absolute -top-8 bg-blue-600 text-white font-black text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                        {d.value} Alunos
                    </div>
                    
                    <div 
                        className={`w-full max-w-8 rounded-t-lg transition-all duration-700 ease-out shadow-lg 
                          ${d.value >= CAPACIDADE_MAXIMA ? 'bg-red-500 shadow-red-900/40' : 'bg-blue-600 shadow-blue-900/40'}`}
                        style={{ height: `${Math.max(d.percent, 4)}%` }} 
                    ></div>
                </div>
                <p className="text-[10px] text-slate-500 mt-4 font-black uppercase">{d.day}</p>
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
            {stats.topStudentsList.length === 0 ? (
               <div className="p-10 text-center border-2 border-dashed border-slate-800 rounded-3xl text-slate-600 text-xs italic">Sem dados suficientes</div>
            ) : (
              stats.topStudentsList.map((student: any, index: number) => (
                <div key={index} className="flex items-center justify-between p-4 bg-slate-950 rounded-2xl border border-slate-800">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center font-black text-slate-400 text-xs">#{index + 1}</div>
                    <p className="font-bold text-sm">{student.name}</p>
                  </div>
                  <p className="text-emerald-400 font-black font-mono">{Math.round(student.ms / (1000 * 60 * 60))}h</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}