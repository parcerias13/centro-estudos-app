'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { BookOpen, Loader2, ArrowLeft, Search, Filter, ChevronLeft, ChevronRight, X } from 'lucide-react';
import Link from 'next/link';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  addMonths,
  format,
} from 'date-fns';
import { pt } from 'date-fns/locale';

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export default function AdminAgendaReadonly() {
  const [allExams, setAllExams] = useState<any[]>([]);
  const [groupedExams, setGroupedExams] = useState<Record<string, any[]>>({});
  const [subjects, setSubjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ESTADOS DOS FILTROS
  const [filtroAluno, setFiltroAluno] = useState('');
  const [filtroAno, setFiltroAno] = useState('');
  const [filtroDisciplina, setFiltroDisciplina] = useState('');

  // ESTADO DE NAVEGAÇÃO MENSAL (mês visível, sempre normalizado ao dia 1)
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));

  // POPOVER (um fixo de cada vez) E MODAL DE LISTA COMPLETA DO DIA
  const [pinnedExamId, setPinnedExamId] = useState<string | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const fetchExams = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;

    const { data, error } = await supabase
      .from('exams')
      .select('*, alunos(nome, ano_escolar)')
      .eq('centro_id', centro_id)
      .order('date', { ascending: true });

    if (error) console.error("Erro na Agenda Admin:", error.message);
    if (data) setAllExams(data);
    setLoading(false);
  };

  const fetchSubjects = async () => {
    const { data, error } = await supabase
      .from('subjects')
      .select('id, name')
      .order('name');

    if (error) console.error("Erro ao buscar disciplinas:", error.message);
    if (data) setSubjects(data);
  };

  const aplicarFiltros = () => {
    let filtrados = allExams;

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

    const groups: Record<string, any[]> = {};
    filtrados.forEach((exam) => {
      if (!groups[exam.date]) groups[exam.date] = [];
      groups[exam.date].push(exam);
    });
    setGroupedExams(groups);
  };

  useEffect(() => {
    fetchExams();
    fetchSubjects();
  }, []);

  useEffect(() => {
    aplicarFiltros();
  }, [filtroAluno, filtroAno, filtroDisciplina, allExams]);

  // GRELHA DO MÊS — Seg a Dom, nº de linhas conforme o mês (5 ou 6)
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const monthDays = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const getIntensityClasses = (count: number) => {
    if (count >= 4) return 'bg-danger-bg text-danger';
    if (count >= 2) return 'bg-warning-bg text-warning';
    return 'bg-accent-soft text-accent';
  };

  const irParaHoje = () => {
    setCurrentMonth(startOfMonth(new Date()));
    setPinnedExamId(null);
  };

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" size={32} /></div>;

  return (
    <main className="min-h-screen bg-page p-4 md:p-8 text-primary font-sans" onClick={() => setPinnedExamId(null)}>

      <header className="mb-8 max-w-6xl mx-auto">
        <div className="flex justify-between items-start mb-6 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="p-3 bg-surface border border-border rounded-2xl hover:bg-raised transition-colors">
              <ArrowLeft size={20} className="text-secondary" />
            </Link>
            <h1 className="text-3xl font-black italic tracking-tighter uppercase">Agenda</h1>
          </div>

          {/* NAVEGAÇÃO MENSAL */}
          <div className="flex items-center bg-surface border border-border rounded-2xl overflow-hidden p-1 shadow-xl">
            <button onClick={(e) => { e.stopPropagation(); setCurrentMonth(prev => addMonths(prev, -1)); }} className="p-2 hover:bg-raised text-secondary hover:text-primary transition-all">
              <ChevronLeft size={20} />
            </button>
            <div className="px-4 py-1 text-center min-w-40">
              <p className="text-sm font-black text-primary capitalize">
                {format(currentMonth, 'MMMM yyyy', { locale: pt })}
              </p>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setCurrentMonth(prev => addMonths(prev, 1)); }} className="p-2 hover:bg-raised text-secondary hover:text-primary transition-all">
              <ChevronRight size={20} />
            </button>
            <button onClick={(e) => { e.stopPropagation(); irParaHoje(); }} className="ml-1 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-accent bg-accent-soft rounded-xl hover:brightness-95 transition-all">
              Hoje
            </button>
          </div>
        </div>

        {/* BARRA DE FILTROS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
            <input type="text" placeholder="Aluno..." value={filtroAluno} onChange={(e) => setFiltroAluno(e.target.value)} className="w-full bg-surface/50 border border-border p-3 pl-10 rounded-xl text-sm outline-none focus:border-accent/50 transition-all" />
          </div>
          <div className="relative">
            <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
            <select value={filtroDisciplina} onChange={(e) => setFiltroDisciplina(e.target.value)} className="w-full bg-surface/50 border border-border p-3 pl-10 rounded-xl text-sm outline-none focus:border-accent/50 transition-all appearance-none">
              <option value="">Todas as Disciplinas</option>
              {subjects.map((sub) => <option key={sub.id} value={sub.name}>{sub.name}</option>)}
            </select>
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
            <select value={filtroAno} onChange={(e) => setFiltroAno(e.target.value)} className="w-full bg-surface/50 border border-border p-3 pl-10 rounded-xl text-sm outline-none focus:border-accent/50 transition-all appearance-none">
              <option value="">Todos os Anos</option>
              {[...Array(12)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}º Ano</option>)}
            </select>
          </div>
        </div>
      </header>

      {/* GRELHA DO CALENDÁRIO */}
      <div className="max-w-6xl mx-auto">
        <div className="border border-border rounded-3xl overflow-hidden bg-page shadow-xl">
          <div className="grid grid-cols-7 bg-surface border-b border-border">
            {DIAS_SEMANA.map((dia) => (
              <div key={dia} className="text-center py-3 text-[10px] font-black uppercase tracking-widest text-muted">
                {dia}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((day) => {
              const dayKey = format(day, 'yyyy-MM-dd');
              const examsDoDia = groupedExams[dayKey] || [];
              const foraDoMes = !isSameMonth(day, currentMonth);
              const hoje = isToday(day);
              const visiveis = examsDoDia.slice(0, 3);
              const excedente = examsDoDia.length - visiveis.length;
              const intensidade = getIntensityClasses(examsDoDia.length);

              return (
                <div
                  key={dayKey}
                  className={`min-h-28 md:min-h-32 p-2 border-r border-b border-border last:border-r-0 [&:nth-child(7n)]:border-r-0 flex flex-col gap-1 ${foraDoMes ? 'bg-surface/40' : 'bg-page'} ${hoje ? 'bg-accent-soft/40' : ''}`}
                >
                  <span className={`text-xs font-bold ${foraDoMes ? 'text-muted' : hoje ? 'text-accent' : 'text-secondary'}`}>
                    {format(day, 'd')}
                  </span>

                  {visiveis.map((exam) => {
                    const aluno = Array.isArray(exam.alunos) ? exam.alunos[0] : exam.alunos;
                    const isPinned = pinnedExamId === exam.id;

                    return (
                      <div key={exam.id} className="relative group/chip">
                        <button
                          onClick={(e) => { e.stopPropagation(); setPinnedExamId(isPinned ? null : exam.id); }}
                          className={`w-full text-left text-[10px] font-bold px-2 py-1 rounded-lg truncate transition-opacity ${intensidade} ${foraDoMes ? 'opacity-50' : ''}`}
                        >
                          {exam.subject_name} · {aluno?.ano_escolar}º
                        </button>

                        {/* POPOVER DE DETALHE — hover mostra, click fixa (só um de cada vez) */}
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className={`absolute top-full left-0 mt-1 z-40 w-52 bg-surface border border-border rounded-2xl p-3 shadow-2xl transition-opacity
                            ${isPinned ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none group-hover/chip:opacity-100 group-hover/chip:pointer-events-auto'}`}
                        >
                          <p className="font-black text-sm text-primary">{aluno?.nome || 'Desconhecido'}</p>
                          <p className="text-[10px] font-bold text-secondary mt-0.5">{exam.subject_name} · {aluno?.ano_escolar}º ano</p>
                          <p className="text-[10px] text-muted mt-1.5 leading-relaxed">
                            {exam.topics || 'Sem matéria especificada'}
                          </p>
                        </div>
                      </div>
                    );
                  })}

                  {excedente > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setPinnedExamId(null); setSelectedDayKey(dayKey); }}
                      className="text-[10px] font-black text-accent hover:underline text-left px-2"
                    >
                      +{excedente} mais
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* MODAL DE LISTA COMPLETA DO DIA */}
      {selectedDayKey && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) setSelectedDayKey(null); }}
        >
          <div className="bg-surface border border-border rounded-3xl w-full max-w-md max-h-[70vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center p-5 border-b border-border sticky top-0 bg-surface">
              <div>
                <h3 className="font-black text-lg text-primary capitalize">
                  {format(new Date(selectedDayKey + 'T00:00:00'), "d 'de' MMMM", { locale: pt })}
                </h3>
                <p className="text-[10px] font-bold text-muted uppercase tracking-widest mt-0.5">
                  {(groupedExams[selectedDayKey] || []).length} {(groupedExams[selectedDayKey] || []).length === 1 ? 'teste agendado' : 'testes agendados'}
                </p>
              </div>
              <button onClick={() => setSelectedDayKey(null)} className="p-2 bg-page border border-border rounded-xl hover:bg-raised transition-colors text-secondary">
                <X size={16} />
              </button>
            </div>
            <div className="p-3 space-y-1">
              {(groupedExams[selectedDayKey] || []).map((exam) => {
                const aluno = Array.isArray(exam.alunos) ? exam.alunos[0] : exam.alunos;
                const intensidade = getIntensityClasses((groupedExams[selectedDayKey!] || []).length);
                return (
                  <div key={exam.id} className="flex justify-between items-start gap-3 p-3 rounded-2xl hover:bg-page/60 transition-colors">
                    <div>
                      <p className="font-black text-sm text-primary">{aluno?.nome || 'Desconhecido'}</p>
                      <p className="text-[11px] text-muted mt-0.5">{exam.topics || 'Sem matéria especificada'}</p>
                    </div>
                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg whitespace-nowrap ${intensidade}`}>
                      {exam.subject_name} · {aluno?.ano_escolar}º
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
