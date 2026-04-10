'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { CalendarDays, BookOpen, Loader2, ArrowLeft, Search, Filter, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import Link from 'next/link';

export default function AdminAgendaReadonly() {
  const [allExams, setAllExams] = useState<any[]>([]);
  const [groupedExams, setGroupedExams] = useState<any>({});
  const [loading, setLoading] = useState(true);

  // ESTADOS DOS FILTROS
  const [filtroAluno, setFiltroAluno] = useState('');
  const [filtroAno, setFiltroAno] = useState('');
  const [filtroDisciplina, setFiltroDisciplina] = useState('');
  
  // ESTADO DE NAVEGAÇÃO SEMANAL (0 = Semana Atual, 1 = Próxima, etc.)
  const [weekOffset, setWeekOffset] = useState(0);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => { 
    fetchExams(); 
  }, []);

  useEffect(() => {
    aplicarFiltros();
  }, [filtroAluno, filtroAno, filtroDisciplina, weekOffset, allExams]);

  const fetchExams = async () => {
    // Puxamos um range largo para permitir navegação (ex: desde 1 mês atrás até ao futuro)
    const { data, error } = await supabase
      .from('exams')
      .select('*, alunos(nome, ano_escolar)') 
      .order('date', { ascending: true });

    if (error) console.error("Erro na Agenda Admin:", error.message);
    if (data) setAllExams(data);
    setLoading(false);
  };

  // LÓGICA DE CÁLCULO DA SEMANA
  const getWeekRange = (offset: number) => {
    const now = new Date();
    const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // Ajuste para Segunda ser 0
    
    const start = new Date(now);
    start.setDate(now.getDate() - dayOfWeek + (offset * 7));
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  };

  const aplicarFiltros = () => {
    const { start, end } = getWeekRange(weekOffset);
    
    let filtrados = allExams.filter(e => {
      const examDate = new Date(e.date);
      return examDate >= start && examDate <= end;
    });

    if (filtroAluno) {
      filtrados = filtrados.filter(e => 
        (e.alunos?.nome || '').toLowerCase().includes(filtroAluno.toLowerCase())
      );
    }

    if (filtroDisciplina) {
      filtrados = filtrados.filter(e => 
        (e.subject_name || '').toLowerCase().includes(filtroDisciplina.toLowerCase())
      );
    }

    if (filtroAno) {
      filtrados = filtrados.filter(e => String(e.alunos?.ano_escolar) === filtroAno);
    }

    const groups: any = {};
    filtrados.forEach((exam) => {
      if (!groups[exam.date]) groups[exam.date] = [];
      groups[exam.date].push(exam);
    });
    setGroupedExams(groups);
  };

  const { start, end } = getWeekRange(weekOffset);

  const getWeekDay = (dateString: string) => new Date(dateString).toLocaleDateString('pt-PT', { weekday: 'long' });
  const getDayAndMonth = (dateString: string) => new Date(dateString).toLocaleDateString('pt-PT', { day: '2-digit', month: 'long' });

  const getIntensityColor = (count: number) => {
    if (count >= 4) return 'bg-red-500/10 border-red-500/30 text-red-500';
    if (count >= 2) return 'bg-amber-500/10 border-amber-500/30 text-amber-500';
    return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
  };

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] p-4 md:p-8 text-white font-sans">
      
      <header className="mb-8 max-w-4xl mx-auto">
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="p-3 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-colors">
              <ArrowLeft size={20} className="text-slate-400" />
            </Link>
            <h1 className="text-3xl font-black italic tracking-tighter uppercase">Agenda</h1>
          </div>

          {/* NAVEGAÇÃO DE SEMANAS */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden p-1 shadow-xl">
            <button onClick={() => setWeekOffset(prev => prev - 1)} className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white transition-all">
              <ChevronLeft size={20} />
            </button>
            <div className="px-4 py-1 text-center min-w-45">
              <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest">
                {weekOffset === 0 ? 'Esta Semana' : weekOffset === 1 ? 'Próxima Semana' : `Em ${weekOffset} semanas`}
              </p>
              <p className="text-[10px] font-bold text-slate-300">
                {start.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })} - {end.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })}
              </p>
            </div>
            <button onClick={() => setWeekOffset(prev => prev + 1)} className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white transition-all">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
        
        {/* BARRA DE FILTROS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input type="text" placeholder="Aluno..." value={filtroAluno} onChange={(e) => setFiltroAluno(e.target.value)} className="w-full bg-slate-900/50 border border-slate-800 p-3 pl-10 rounded-xl text-sm outline-none focus:border-blue-500/50 transition-all" />
          </div>
          <div className="relative">
            <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input type="text" placeholder="Disciplina..." value={filtroDisciplina} onChange={(e) => setFiltroDisciplina(e.target.value)} className="w-full bg-slate-900/50 border border-slate-800 p-3 pl-10 rounded-xl text-sm outline-none focus:border-blue-500/50 transition-all" />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <select value={filtroAno} onChange={(e) => setFiltroAno(e.target.value)} className="w-full bg-slate-900/50 border border-slate-800 p-3 pl-10 rounded-xl text-sm outline-none focus:border-blue-500/50 transition-all appearance-none">
              <option value="">Todos os Anos</option>
              {[...Array(12)].map((_, i) => <option key={i+1} value={i+1}>{i+1}º Ano</option>)}
            </select>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto">
        {Object.keys(groupedExams).length === 0 ? (
          <div className="bg-slate-900/40 border-2 border-dashed border-slate-800 p-16 rounded-[3rem] text-center flex flex-col items-center">
            <Calendar size={48} className="mb-6 text-slate-700" />
            <p className="text-slate-500 font-bold text-lg">Sem testes para este período.</p>
            <button onClick={() => {setWeekOffset(0); setFiltroAluno(''); setFiltroAno(''); setFiltroDisciplina('');}} className="mt-4 text-blue-400 text-sm font-bold hover:underline">Voltar à semana atual</button>
          </div>
        ) : (
          <div className="space-y-10 border-l-2 border-slate-800/50 ml-2 md:ml-6 pl-6 md:pl-10 relative">
            {Object.keys(groupedExams).map((date) => {
              const count = groupedExams[date].length;
              const intensity = getIntensityColor(count);
              return (
                <div key={date} className="relative">
                  <div className={`absolute -left-8.25 md:-left-12.25 top-1.5 w-4 h-4 md:w-6 md:h-6 rounded-full border-4 border-[#0f172a] ${intensity.split(' ')[0]} ${intensity.split(' ')[2].replace('text-', 'bg-')}`}></div>
                  <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-6">
                    <h2 className="text-xl md:text-2xl font-black capitalize">{getWeekDay(date)}</h2>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 font-medium text-sm">{getDayAndMonth(date)}</span>
                      <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${intensity}`}>{count} {count === 1 ? 'Teste' : 'Testes'}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {groupedExams[date].map((exam: any) => {
                       const aluno = Array.isArray(exam.alunos) ? exam.alunos[0] : exam.alunos;
                       return (
                        <div key={exam.id} className="bg-slate-900 border border-slate-800 p-6 rounded-4xl hover:border-blue-500/50 transition-colors shadow-lg">
                          <div className="flex justify-between items-start mb-4">
                            <div className="bg-blue-500/10 text-blue-400 p-2.5 rounded-xl"><BookOpen size={18} /></div>
                            <div className="max-w-45 truncate bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 flex items-center gap-2">
                              <span className="text-[10px] font-black text-blue-500">{aluno?.ano_escolar}º</span>
                              <span className="text-[10px] font-bold text-slate-300 truncate">{aluno?.nome || 'Desconhecido'}</span>
                            </div>
                          </div>
                          <h3 className="text-lg font-black text-white">{exam.subject_name}</h3>
                          <p className="text-xs text-slate-500 mt-2 line-clamp-2">{exam.topics || 'Sem matéria detalhada'}</p>
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