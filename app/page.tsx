'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { BookOpen, LogOut, Loader2, CheckCircle2, Calendar, User, Library, ShieldAlert, GraduationCap } from 'lucide-react';

export default function StudentHome() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [studentName, setStudentName] = useState('');
  const [proximoTeste, setProximoTeste] = useState<any>(null);
  
  // Variáveis de Segurança Financeira
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

      // 1. Está a estudar agora?
      const { data: session } = await supabase
        .from('diario_bordo')
        .select('*')
        .eq('aluno_id', user.id)
        .is('saida', null)
        .maybeSingle();
      
      setCurrentSession(session);

      // 2. Buscar dados do aluno
      const { data: student } = await supabase
        .from('alunos')
        .select('nome, limite_semanal')
        .eq('id', user.id)
        .single();
      
      if (student) {
        setStudentName(student.nome?.split(' ')[0] || 'Aluno');
        
        // --- MOTOR DE SEGURANÇA SEMANAL --- //
        const hoje = new Date();
        const diaDaSemana = hoje.getDay() === 0 ? 6 : hoje.getDay() - 1;
        const inicioSemana = new Date(hoje);
        inicioSemana.setDate(hoje.getDate() - diaDaSemana);
        inicioSemana.setHours(0, 0, 0, 0);
        
        const fimSemana = new Date(inicioSemana);
        fimSemana.setDate(inicioSemana.getDate() + 6);
        fimSemana.setHours(23, 59, 59, 999);

        // Contar visitas esta semana
        const { count } = await supabase
          .from('diario_bordo')
          .select('*', { count: 'exact', head: true })
          .eq('aluno_id', user.id)
          .gte('entrada', inicioSemana.toISOString())
          .lte('entrada', fimSemana.toISOString());

        const limite = student.limite_semanal || 0;
        const visitasFeitas = count || 0;
        
        setLimitData({ visits: visitasFeitas, limit: limite });
        
        if (limite > 0 && visitasFeitas >= limite) {
           setIsLimitReached(true);
        }
      }

      // 3. Buscar disciplinas
      const { data: subjs } = await supabase.from('subjects').select('*').order('name');
      if (subjs) setSubjects(subjs);

      // 4. Buscar alertas de agenda
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

  // A CORREÇÃO ESTÁ AQUI: student_id adicionado para satisfazer a base de dados
  const handleCheckIn = async (subjectId: string, subjectName: string) => {
    if (isLimitReached) return alert('Plano esgotado.');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('diario_bordo').insert({
      aluno_id: user.id,       // Novo campo
      student_id: user.id,     // Campo antigo obrigatório
      subject_id: subjectId,
      subject_name: subjectName,
      entrada: new Date().toISOString()
    });

    if (error) {
      alert(`Erro ao entrar: ${error.message}`);
    } else {
      window.location.reload(); 
    }
  };

  const handleCheckout = async () => {
    if (!currentSession) return;
    if (!confirm('Já acabaste por hoje?')) return;

    await supabase
      .from('diario_bordo')
      .update({ saida: new Date().toISOString() })
      .eq('id', currentSession.id);
    
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
            <p className="text-slate-400">A tua sessão está ativa:</p>
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl mt-4 inline-block w-full shadow-2xl">
              <span className="text-2xl font-black text-blue-400">{currentSession.subject_name || 'Sessão Livre'}</span>
              <p className="text-[10px] text-slate-500 mt-2 uppercase tracking-widest font-bold">Aguardando Validação da Receção</p>
            </div>
          </div>

          <div className="pt-4 space-y-4 w-full">
            {/* NOVO: Ferramentas de Estudo durante a sessão */}
            <div className="grid grid-cols-2 gap-3 mb-6">
               <Link href="/biblioteca" className="bg-slate-900 border border-slate-800 p-4 rounded-2xl hover:border-orange-500/50 hover:bg-slate-800 transition-all flex flex-col items-center justify-center gap-2 group shadow-lg">
                 <Library size={24} className="text-orange-500 group-hover:scale-110 transition-transform" />
                 <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-white">Biblioteca</span>
               </Link>
               
               <Link href="/agenda" className="bg-slate-900 border border-slate-800 p-4 rounded-2xl hover:border-purple-500/50 hover:bg-slate-800 transition-all flex flex-col items-center justify-center gap-2 group shadow-lg">
                 <Calendar size={24} className="text-purple-500 group-hover:scale-110 transition-transform" />
                 <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-white">Agenda</span>
               </Link>
            </div>

            <div className="w-full h-px bg-slate-800/50 my-4"></div>

            <button 
              onClick={handleCheckout}
              className="w-full bg-slate-900 hover:bg-red-900/20 text-slate-400 hover:text-red-400 border border-slate-800 hover:border-red-900/50 py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2 active:scale-95 shadow-xl"
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
            <Link href="/perfil" className="bg-slate-900 hover:bg-slate-800 p-3 rounded-xl border border-slate-800 transition-all text-slate-300 hover:text-white" title="Meu Perfil">
              <User size={20} />
            </Link>
            <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login'; }} className="bg-slate-900 hover:bg-red-900/20 p-3 rounded-xl border border-slate-800 hover:border-red-900/50 transition-all text-slate-300 hover:text-red-400" title="Sair">
              <LogOut size={20} />
            </button>
          </div>
        </header>

        {/* ALERTA DE TESTE PRÓXIMO */}
        {proximoTeste && (
          <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl mb-6 flex items-center gap-4 text-left">
            <div className="bg-amber-500 p-3 rounded-xl text-black">
              <GraduationCap size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase text-amber-500/60 tracking-widest">Alvo de Foco</p>
              <p className="text-sm font-bold text-amber-100">Teste de {proximoTeste.subject_name} dia {new Date(proximoTeste.date).getDate()}!</p>
            </div>
          </div>
        )}

        {/* ECRÃ DE BLOQUEIO (LIMITE ATINGIDO) */}
        {isLimitReached ? (
          <div className="bg-red-950/30 border border-red-900/50 p-8 rounded-4xl text-center space-y-6 shadow-2xl">
            <div className="bg-red-500/10 text-red-500 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(239,68,68,0.2)]">
              <ShieldAlert size={40} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white mb-2 italic">Plano Esgotado</h2>
              <p className="text-slate-400 text-sm font-medium">Já utilizaste as tuas <strong className="text-white">{limitData.limit} sessões</strong> desta semana.</p>
            </div>
            <div className="bg-slate-950 p-4 rounded-xl text-slate-400 text-xs font-bold border border-slate-800 inline-block uppercase tracking-wide">
              Dirige-te à receção para validar acesso extra.
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-8">
                <Link href="/agenda" className="bg-linear-to-br from-purple-900/50 to-blue-900/50 hover:from-purple-800/50 hover:to-blue-800/50 border border-purple-500/30 p-5 rounded-3xl group transition-all relative overflow-hidden h-36 flex flex-col justify-between shadow-lg">
                    <div className="bg-purple-500/20 p-3 rounded-xl text-purple-400 w-fit group-hover:scale-110 transition-transform">
                        <Calendar size={24} />
                    </div>
                    <div>
                        <p className="font-black text-white group-hover:text-purple-200 transition-colors text-lg">Agenda</p>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mt-1">Testes & Metas</p>
                    </div>
                </Link>

                <Link href="/biblioteca" className="bg-linear-to-br from-orange-900/50 to-red-900/50 hover:from-orange-800/50 hover:to-red-800/50 border border-orange-500/30 p-5 rounded-3xl group transition-all relative overflow-hidden h-36 flex flex-col justify-between shadow-lg">
                    <div className="absolute top-0 right-0 w-16 h-16 bg-orange-500/10 rounded-full blur-xl -mr-6 -mt-6"></div>
                    <div className="bg-orange-500/20 p-3 rounded-xl text-orange-400 w-fit group-hover:scale-110 transition-transform relative z-10">
                        <Library size={24} />
                    </div>
                    <div className="relative z-10">
                        <p className="font-black text-white group-hover:text-orange-200 transition-colors text-lg">Biblioteca</p>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mt-1">Fichas & Resumos</p>
                    </div>
                </Link>
            </div>

            {/* LISTA DE DISCIPLINAS */}
            <div className="flex justify-between items-center mb-4 px-1">
               <h3 className="font-black text-slate-400 text-xs uppercase tracking-widest">Escolhe a Disciplina</h3>
               <span className="text-[10px] text-slate-400 bg-slate-900 border border-slate-800 px-3 py-1 rounded-full font-black uppercase">
                 Sessões: <span className="text-blue-400">{limitData.visits}</span> / {limitData.limit > 0 ? limitData.limit : 'Livre'}
               </span>
            </div>
            <div className="grid grid-cols-2 gap-3 pb-10">
              {subjects.length === 0 ? (
                <p className="col-span-2 text-center text-slate-600 text-sm py-10 italic">Nenhuma disciplina cadastrada no sistema.</p>
              ) : (
                subjects.map((subject) => (
                  <button
                    key={subject.id}
                    onClick={() => handleCheckIn(subject.id, subject.name)}
                    className="bg-slate-900 hover:bg-slate-800 border border-slate-800 p-6 rounded-4xl text-left transition-all active:scale-95 group shadow-xl"
                  >
                    <div className="bg-blue-500/10 text-blue-500 w-12 h-12 rounded-xl flex items-center justify-center mb-4 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                      <BookOpen size={24} />
                    </div>
                    <span className="font-black text-lg block text-slate-200 group-hover:text-white">{subject.name}</span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}