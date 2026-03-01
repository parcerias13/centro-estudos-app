'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { ArrowLeft, Calendar, Loader2, Plus, CheckCircle2, BookOpen } from 'lucide-react';
import Link from 'next/link';

export default function StudentAgenda() {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [exams, setExams] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]); 
  
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState('');
  const [topics, setTopics] = useState('');

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => { 
    fetchInitialData(); 
  }, []);

  const fetchInitialData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Buscar Disciplinas Disponíveis (para o Dropdown)
    const { data: subData } = await supabase.from('subjects').select('*').order('name');
    if (subData) setSubjects(subData);

    // 2. Buscar Testes Agendados
    const { data: examData } = await supabase
      .from('exams')
      .select('*')
      .eq('student_id', user.id)
      .order('date', { ascending: true });
    
    if (examData) setExams(examData);
    setLoading(false);
  };

  const handleAgendar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);

    const { data: { user } } = await supabase.auth.getUser();
    
    const { error } = await supabase.from('exams').insert({
      student_id: user?.id,
      subject_name: subject,
      date: date,
      topics: topics
    });

    if (error) {
      alert("Erro ao gravar teste: " + error.message);
    } else {
      setSubject(''); setDate(''); setTopics('');
      fetchInitialData();
      alert("Teste agendado com sucesso! 🚀");
    }
    setSending(false);
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 max-w-md mx-auto space-y-8 pb-20">
      <Link href="/" className="flex items-center gap-2 text-slate-500 hover:text-white transition-colors">
        <ArrowLeft size={20} /> <span className="font-bold">Voltar ao Início</span>
      </Link>

      <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
        <h1 className="text-xl font-black mb-6 flex items-center gap-2">
            <Plus className="text-purple-500" /> Marcar Novo Teste
        </h1>
        
        <form onSubmit={handleAgendar} className="space-y-4">
          
          {/* SELETOR DE DISCIPLINAS (DROPDOWN) */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-slate-500 ml-1">Disciplina</label>
            <select 
              required 
              value={subject} 
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-purple-500 text-white cursor-pointer"
            >
              <option value="">Selecionar Disciplina...</option>
              {subjects.length > 0 ? (
                subjects.map(s => <option key={s.id} value={s.name}>{s.name}</option>)
              ) : (
                <option value="Outra">Outra (Carregar disciplinas no Admin)</option>
              )}
            </select>
          </div>

          {/* CAMPO DE DATA (COM ÍCONE VISÍVEL) */}
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-slate-500 ml-1">Data do Teste</label>
            <div className="relative">
                <input 
                  type="date" 
                  required 
                  value={date} 
                  onChange={(e) => setDate(e.target.value)} 
                  className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-purple-500 text-white block"
                  style={{ colorScheme: 'dark' }} // Garante que o ícone do browser seja visível em tema escuro
                />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-slate-500 ml-1">Matéria / Tópicos</label>
            <textarea 
              placeholder="Ex: Capítulos 1 a 3" 
              value={topics} 
              onChange={(e) => setTopics(e.target.value)} 
              className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl h-24 resize-none outline-none focus:border-purple-500" 
            />
          </div>
          
          <button 
            disabled={sending} 
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-black py-4 rounded-2xl transition-all shadow-lg active:scale-95 disabled:opacity-50"
          >
            {sending ? 'A GUARDAR...' : 'AGENDAR AGORA'}
          </button>
        </form>
      </section>

      {/* CALENDÁRIO VISUAL DE COMPROMISSOS */}
      <section className="space-y-4">
        <h2 className="text-xs font-black uppercase text-slate-500 tracking-widest">A Tua Agenda</h2>
        <div className="space-y-3">
          {exams.length === 0 ? (
            <p className="text-slate-600 text-sm italic">Nenhum teste no horizonte.</p>
          ) : (
            exams.map((exam) => (
              <div key={exam.id} className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex items-center justify-between border-l-4 border-l-purple-500 shadow-md">
                <div className="flex items-center gap-4">
                  <div className="text-center bg-slate-800 px-3 py-1 rounded-lg min-w-16.25">
                    <p className="text-[10px] font-black text-purple-400 uppercase">
                        {new Date(exam.date).toLocaleDateString('pt-PT', { month: 'short' })}
                    </p>
                    <p className="text-xl font-black">
                        {new Date(exam.date).getDate()}
                    </p>
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-100">{exam.subject_name}</h4>
                    <p className="text-[10px] text-slate-500 truncate max-w-37.5 italic">
                        {exam.topics || 'Ver matéria no caderno'}
                    </p>
                  </div>
                </div>
                <CheckCircle2 size={18} className="text-emerald-500 opacity-40" />
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}