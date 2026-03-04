'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
// Adicionada a BrainCircuit para o Lab AI
import { BookOpen, LogOut, Loader2, CheckCircle2, Calendar, User, Library, ShieldAlert, GraduationCap, BrainCircuit } from 'lucide-react';

export default function StudentHome() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [studentName, setStudentName] = useState('');
  const [proximoTeste, setProximoTeste] = useState<any>(null);
  
  const [isLimitReached, setIsLimitReached] = useState(false);
  const [limitData, setLimitData] = useState({ visits: 0, limit: 0 });

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return (window.location.href = '/login');

      const { data: session } = await supabase
        .from('diario_bordo')
        .select('*')
        .eq('aluno_id', user.id)
        .is('saida', null)
        .maybeSingle();
      
      setCurrentSession(session);

      const { data: student } = await supabase
        .from('alunos')
        .select('nome, limite_semanal')
        .eq('id', user.id)
        .single();
      
      if (student) {
        setStudentName(student.nome?.split(' ')[0] || 'Aluno');
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
      }

      const { data: subjs } = await supabase.from('subjects').select('*').order('name');
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
    };
    fetchData();
  }, [supabase]);

  const handleCheckIn = async (subjectId: string, subjectName: string) => {
    if (isLimitReached) return alert('Plano esgotado.');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('diario_bordo').insert({
      aluno_id: user.id,
      student_id: user.id,
      subject_id: subjectId,
      subject_name: subjectName,
      entrada: new Date().toISOString()
    });
    if (error) alert(`Erro ao entrar: ${error.message}`);
    else window.location.reload(); 
  };

  const handleCheckout = async () => {
    if (!currentSession) return;
    if (!confirm('Já acabaste por hoje?')) return;
    await supabase.from('diario_bordo').update({ saida: new Date().toISOString() }).eq('id', currentSession.id);
    window.location.reload();
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  // --- ECRÃ 1: ALUNO JÁ ESTÁ A ESTUDAR ---
  if (currentSession) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops))] from-blue-900/20 via-slate-950 to-slate-950"></div>
        <div className="z-10 text-center space-y-8 max-w-md w-full">
          <div className="bg-emerald-500/10 text-emerald-500 p-6 rounded-full w-24 h-24 flex items-center justify-center mx-auto border-4 border-emerald-500/20 animate-pulse">
            <CheckCircle2 size={48} />
          </div>
          <div>
            <h1 className="text-3xl font-black mb-2 italic">Bom Estudo, {studentName}!</h1>
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl mt-4 inline-block w-full shadow-2xl">
              <span className="text-2xl font-black text-blue-400">{currentSession.subject_name || 'Sessão Livre'}</span>
              <p className="text-[10px] text-slate-500 mt-2 uppercase tracking-widest font-bold">Aguardando Validação da Receção</p>
            </div>
          </div>

          <div className="pt-4 space-y-4 w-full">
            {/* GRID DE FERRAMENTAS DURANTE A SESSÃO */}
            <div className="grid grid-cols-3 gap-3 mb-6">
               <Link href="/biblioteca" className="bg-slate-900 border border-slate-800 p-4 rounded-2xl hover:border-orange-500/50 hover:bg-slate-800 transition-all flex flex-col items-center justify-center gap-2 group shadow-lg">
                 <Library size={24} className="text-orange-500 group-hover:scale-110 transition-transform" />
                 <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 group-hover:text-white">Biblioteca</span>
               </Link>
               
               {/* BOTÃO DO LAB AI ADICIONADO AQUI */}
               <Link href="/aluno/lab" className="bg-slate-900 border border-orange-500/50 p-4 rounded-2xl hover:bg-orange-900/20 transition-all flex flex-col items-center justify-center gap-2 group shadow-lg shadow-orange-900/10">
                 <BrainCircuit size={24} className="text-orange-400 animate-pulse group-hover:scale-110 transition-transform" />
                 <span className="text-[8px] font-black uppercase tracking-widest text-orange-400 group-hover:text-white">Lab AI</span>
               </Link>

               <Link href="/agenda" className="bg-slate-900 border border-slate-800 p-4 rounded-2xl hover:border-purple-500/50 hover:bg-slate-800 transition-all flex flex-col items-center justify-center gap-2 group shadow-lg">
                 <Calendar size={24} className="text-purple-500 group-hover:scale-110 transition-transform" />
                 <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 group-hover:text-white">Agenda</span>
               </Link>
            </div>

            <button 
              onClick={handleCheckout}
              className="w-full bg-slate-900 hover:bg-red-900/20 text-slate-400 hover:text-red-400 border border-slate-800 py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2 active:scale-95"
            >
              <LogOut size={20} /> TERMINAR SESSÃO
            </button>
          </div>
        </div>
      </main>
    );
  }

  // --- ECRÃ 2: DASHBOARD DO ALUNO ---
  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 font-sans">
      <div className="max-w-xl mx-auto">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-black italic tracking-tighter">Olá, {studentName} 👋</h1>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">O que vamos estudar hoje?</p>
          </div>
          <div className="flex gap-2">
            <Link href="/perfil" className="bg-slate-900 hover:bg-slate-800 p-3 rounded-xl border border-slate-800 transition-all text-slate-300">
              <User size={20} />
            </Link>
            <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login'; }} className="bg-slate-900 hover:bg-red-900/20 p-3 rounded-xl border border-slate-800 text-slate-300">
              <LogOut size={20} />
            </button>
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
          <div className="bg-red-950/30 border border-red-900/50 p-8 rounded-4xl text-center space-y-6">
            <div className="bg-red-500/10 text-red-500 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto"><ShieldAlert size={40} /></div>
            <h2 className="text-2xl font-black text-white italic">Plano Esgotado</h2>
            <p className="text-slate-400 text-sm font-medium">Dirige-te à receção para validar acesso extra.</p>
          </div>
        ) : (
          <>
            {/* GRID DE ACESSOS RÁPIDOS */}
            <div className="grid grid-cols-2 gap-3 mb-8">
                <Link href="/agenda" className="bg-linear-to-br from-purple-900/50 to-blue-900/50 border border-purple-500/30 p-5 rounded-3xl group transition-all h-32 flex flex-col justify-between">
                    <div className="bg-purple-500/20 p-2 rounded-lg text-purple-400 w-fit group-hover:scale-110 transition-transform"><Calendar size={20} /></div>
                    <p className="font-black text-white text-lg">Agenda</p>
                </Link>

                <Link href="/biblioteca" className="bg-linear-to-br from-orange-900/50 to-red-900/50 border border-orange-500/30 p-5 rounded-3xl group transition-all h-32 flex flex-col justify-between">
                    <div className="bg-orange-500/20 p-2 rounded-lg text-orange-400 w-fit group-hover:scale-110 transition-transform"><Library size={20} /></div>
                    <p className="font-black text-white text-lg">Biblioteca</p>
                </Link>

                {/* BOTÃO PREMIUM DO LAB AI ADICIONADO AQUI - FULL WIDTH */}
                <Link href="/aluno/lab" className="col-span-2 bg-linear-to-r from-orange-600 to-orange-400 p-5 rounded-3xl group transition-all flex items-center justify-between shadow-xl shadow-orange-900/20 hover:scale-[1.02]">
                    <div className="flex items-center gap-4">
                      <div className="bg-white/20 p-3 rounded-2xl text-white group-hover:animate-bounce">
                        <BrainCircuit size={28} />
                      </div>
                      <div>
                        <p className="font-black text-white text-xl italic uppercase tracking-tighter">My Personal Lab</p>
                        <p className="text-[10px] text-white/80 font-bold uppercase tracking-widest">Estudo Inteligente com IA</p>
                      </div>
                    </div>
                    <span className="bg-white/20 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase">Premium</span>
                </Link>
            </div>

            <div className="flex justify-between items-center mb-4 px-1">
               <h3 className="font-black text-slate-400 text-xs uppercase tracking-widest">Disciplinas</h3>
               <span className="text-[10px] text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1 rounded-full font-black">
                 Sessões: <span className="text-blue-400">{limitData.visits}</span> / {limitData.limit > 0 ? limitData.limit : 'Livre'}
               </span>
            </div>
            <div className="grid grid-cols-2 gap-3 pb-10">
              {subjects.map((subject) => (
                <button key={subject.id} onClick={() => handleCheckIn(subject.id, subject.name)} className="bg-slate-900 hover:bg-slate-800 border border-slate-800 p-5 rounded-3xl text-left transition-all active:scale-95 group">
                  <div className="bg-blue-500/10 text-blue-500 w-10 h-10 rounded-xl flex items-center justify-center mb-3 group-hover:bg-blue-500 group-hover:text-white transition-colors"><BookOpen size={20} /></div>
                  <span className="font-black text-md block text-slate-200">{subject.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}