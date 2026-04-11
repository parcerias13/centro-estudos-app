'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { BookOpen, LogOut, Loader2, CheckCircle2, Calendar, User, Library, ShieldAlert, GraduationCap, BrainCircuit, MapPin } from 'lucide-react';

export default function StudentHome() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [studentName, setStudentName] = useState('');
  const [proximoTeste, setProximoTeste] = useState<any>(null);
  const [hasIaConsent, setHasIaConsent] = useState(false); 
  
  const [isLimitReached, setIsLimitReached] = useState(false);
  const [limitData, setLimitData] = useState({ visits: 0, limit: 0 });

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // --- 1. FUNÇÃO DE BUSCA (EXTRAÍDA PARA SER REUTILIZÁVEL) ---
  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return (window.location.href = '/login');

    // Buscar sessão atual
    const { data: session } = await supabase
      .from('diario_bordo')
      .select('*, salas(nome)')
      .eq('aluno_id', user.id)
      .is('saida', null)
      .maybeSingle();
    
    setCurrentSession(session);

    // Buscar dados do aluno
    const { data: student } = await supabase
      .from('alunos')
      .select('nome, limite_semanal, consentimento_ia')
      .eq('id', user.id)
      .single();
    
    if (student) {
      setStudentName(student.nome?.split(' ')[0] || 'Aluno');
      setHasIaConsent(student.consentimento_ia || false);

      const hoje = new Date();
      const diaDaSemana = hoje.getDay() === 0 ? 6 : hoje.getDay() - 1;
      const inicioSemana = new Date(hoje);
      inicioSemana.setDate(hoje.getDate() - diaDaSemana);
      inicioSemana.setHours(0, 0, 0, 0);
      const fimSemana = new Date(inicioSemana);
      fimSemana.setDate(inicioSemana.getDate() + 6);
      fimSemana.setHours(23, 59, 59, 999);

      const { count } = await supabase
        .from('diario_bordo')
        .select('*', { count: 'exact', head: true })
        .eq('aluno_id', user.id)
        .gte('entrada', inicioSemana.toISOString())
        .lte('entrada', fimSemana.toISOString());

      const limite = student.limite_semanal || 0;
      const visitasFeitas = count || 0;
      setLimitData({ visits: visitasFeitas, limit: limite });
      if (limite > 0 && visitasFeitas >= limite) setIsLimitReached(true);
      else setIsLimitReached(false);
    }

    const { data: subjs } = await supabase
      .from('subjects')
      .select('*, salas(nome)')
      .order('name');
    if (subjs) setSubjects(subjs);

    const hojeStr = new Date().toISOString().split('T')[0];
    const { data: teste } = await supabase
      .from('exams')
      .select('*')
      .eq('student_id', user.id)
      .gte('date', hojeStr)
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle();
    setProximoTeste(teste);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- 2. SISTEMA DE CONTROLO DE FLUXO ---
  const safeAction = async (actionFn: () => Promise<void>) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await actionFn();
      await fetchData(); // EM VEZ DE RELOAD: Atualiza os dados para mudar o ecrã
    } catch (error) {
      console.error("Erro na operação:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- 3. HANDLERS ATUALIZADOS ---
  const handleCheckIn = async (subjectId: string, subjectName: string, salaId: string | null) => {
    if (isLimitReached || currentSession) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const { error } = await supabase.from('diario_bordo').insert({
      aluno_id: user.id,
      student_id: user.id,
      subject_id: subjectId,
      subject_name: subjectName,
      sala_id: salaId,
      entrada: new Date().toISOString()
    });
    
    if (error) alert(`Erro: ${error.message}`);
  };

  const handleCheckout = async () => {
    if (!currentSession) return;
    if (!confirm('Já acabaste por hoje?')) return;
    await supabase.from('diario_bordo').update({ saida: new Date().toISOString() }).eq('id', currentSession.id);
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  return (
    <main className={`min-h-screen bg-slate-950 text-white p-6 font-sans transition-all duration-300 ${isSubmitting ? 'pointer-events-none opacity-60' : ''}`}>
      <div className="max-w-xl mx-auto">
        
        {/* ECRÃ DE SESSÃO ATIVA (Condicional via Estado) */}
        {currentSession ? (
          <div className="flex flex-col items-center justify-center space-y-8 animate-in fade-in zoom-in duration-500 py-12">
            <div className="bg-emerald-500/10 text-emerald-500 p-6 rounded-full w-24 h-24 flex items-center justify-center mx-auto border-4 border-emerald-500/20 animate-pulse">
              <CheckCircle2 size={48} />
            </div>
            <div className="text-center">
              <h1 className="text-3xl font-black mb-2 italic">Bom Estudo, {studentName}!</h1>
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl mt-4 inline-block w-full shadow-2xl">
                <span className="text-2xl font-black text-blue-400">{currentSession.subject_name || 'Sessão Livre'}</span>
                {currentSession.salas?.nome && (
                  <div className="mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-center justify-center gap-3">
                    <MapPin size={24} className="text-emerald-500 animate-bounce" />
                    <div className="text-left">
                      <p className="text-[10px] text-emerald-500 uppercase font-black tracking-widest">A tua sala hoje:</p>
                      <p className="text-lg font-black text-white">{currentSession.salas.nome}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="w-full space-y-4">
              <div className={`grid ${hasIaConsent ? 'grid-cols-3' : 'grid-cols-2'} gap-3 mb-6`}>
                 <Link href="/biblioteca" className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col items-center justify-center gap-2 group">
                   <Library size={24} className="text-orange-500" />
                   <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Biblioteca</span>
                 </Link>
                 {hasIaConsent && (
                   <Link href="/aluno/lab" className="bg-slate-900 border border-orange-500/50 p-4 rounded-2xl flex flex-col items-center justify-center gap-2 shadow-lg shadow-orange-900/10">
                     <BrainCircuit size={24} className="text-orange-400" />
                     <span className="text-[8px] font-black uppercase tracking-widest text-orange-400">Lab AI</span>
                   </Link>
                 )}
                 <Link href="/agenda" className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex flex-col items-center justify-center gap-2 group">
                   <Calendar size={24} className="text-purple-500" />
                   <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Agenda</span>
                 </Link>
              </div>
              <button onClick={() => safeAction(handleCheckout)} disabled={isSubmitting} className="w-full bg-slate-900 hover:bg-red-900/20 text-slate-400 hover:text-red-400 border border-slate-800 py-4 rounded-2xl font-black flex items-center justify-center gap-2">
                {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <LogOut size={20} />} TERMINAR SESSÃO
              </button>
            </div>
          </div>
        ) : (
          /* ECRÃ DE SELEÇÃO DE DISCIPLINAS */
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="mb-8 flex justify-between items-center">
              <div>
                <h1 className="text-3xl font-black italic tracking-tighter">Olá, {studentName} 👋</h1>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">O que vamos estudar hoje?</p>
              </div>
              <div className="flex gap-2">
                <Link href="/perfil" className="bg-slate-900 p-3 rounded-xl border border-slate-800 text-slate-300"><User size={20} /></Link>
                <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login'; }} className="bg-slate-900 p-3 rounded-xl border border-slate-800 text-slate-300"><LogOut size={20} /></button>
              </div>
            </header>

            {proximoTeste && (
              <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl mb-6 flex items-center gap-4">
                <div className="bg-amber-500 p-3 rounded-xl text-black"><GraduationCap size={20} /></div>
                <div>
                  <p className="text-[10px] font-black uppercase text-amber-500/60 tracking-widest">Alvo de Foco</p>
                  <p className="text-sm font-bold text-amber-100">Teste de {proximoTeste.subject_name} dia {new Date(proximoTeste.date).getDate()}!</p>
                </div>
              </div>
            )}

            {isLimitReached ? (
              <div className="bg-red-950/30 border border-red-900/50 p-8 rounded-4xl text-center space-y-6 py-20">
                <div className="bg-red-500/10 text-red-500 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto"><ShieldAlert size={40} /></div>
                <h2 className="text-2xl font-black text-white italic uppercase">Limite Semanal Atingido</h2>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-8">
                    <Link href="/agenda" className="bg-linear-to-br from-purple-900/50 to-blue-900/50 border border-purple-500/30 p-5 rounded-3xl h-32 flex flex-col justify-between">
                        <div className="bg-purple-500/20 p-2 rounded-lg text-purple-400 w-fit"><Calendar size={20} /></div>
                        <p className="font-black text-white text-lg">Agenda</p>
                    </Link>
                    <Link href="/biblioteca" className="bg-linear-to-br from-orange-900/50 to-red-900/50 border border-orange-500/30 p-5 rounded-3xl h-32 flex flex-col justify-between">
                        <div className="bg-orange-500/20 p-2 rounded-lg text-orange-400 w-fit"><Library size={20} /></div>
                        <p className="font-black text-white text-lg">Biblioteca</p>
                    </Link>
                    {hasIaConsent && (
                      <Link href="/aluno/lab" className="col-span-2 bg-linear-to-r from-orange-600 to-orange-400 p-5 rounded-3xl flex items-center justify-between shadow-xl shadow-orange-900/20">
                          <div className="flex items-center gap-4">
                            <div className="bg-white/20 p-3 rounded-2xl text-white"><BrainCircuit size={28} /></div>
                            <div>
                              <p className="font-black text-white text-xl italic uppercase tracking-tighter">My Personal Lab</p>
                              <p className="text-[10px] text-white/80 font-bold uppercase tracking-widest">Estudo Inteligente com IA</p>
                            </div>
                          </div>
                          <span className="bg-white/20 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase">Premium</span>
                      </Link>
                    )}
                </div>

                <div className="flex justify-between items-center mb-4 px-1">
                    <h3 className="font-black text-slate-400 text-xs uppercase tracking-widest">Escolhe a tua Disciplina</h3>
                    <span className="text-[10px] text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1 rounded-full font-black">
                      Sessões: <span className="text-blue-400">{limitData.visits}</span> / {limitData.limit > 0 ? limitData.limit : 'Livre'}
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-3 pb-10">
                  {subjects.map((subject) => (
                    <button 
                      key={subject.id} 
                      disabled={isSubmitting}
                      onClick={() => safeAction(() => handleCheckIn(subject.id, subject.name, subject.sala_id))} 
                      className="bg-slate-900 hover:bg-slate-800 border border-slate-800 p-5 rounded-3xl text-left transition-all relative overflow-hidden active:scale-95 disabled:opacity-50"
                    >
                      <div className="bg-blue-500/10 text-blue-500 w-10 h-10 rounded-xl flex items-center justify-center mb-3">
                        {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <BookOpen size={20} />}
                      </div>
                      <span className="font-black text-md block text-slate-200">{isSubmitting ? 'A entrar...' : subject.name}</span>
                      {subject.salas?.nome && (
                        <span className="absolute top-4 right-4 text-[8px] bg-slate-800 text-slate-400 px-2 py-1 rounded font-black uppercase tracking-widest">
                          {subject.salas.nome}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}