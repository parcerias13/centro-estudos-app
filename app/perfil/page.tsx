'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, User, Loader2, Mail, Clock, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ehEmailFachada, usernameSemSufixo } from '@/lib/username';

export default function StudentProfile() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [studentData, setStudentData] = useState<any>(null);
  const [stats, setStats] = useState({ totalHours: 0, totalVisits: 0, weekVisits: 0 });

  const router = useRouter();
  

  useEffect(() => {
    fetchProfile();
  }, [supabase]);

  const fetchProfile = async () => {
    // 1. Buscar utilizador logado
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }
    setUser(user);

    // 2. CORREÇÃO: Buscar dados da tabela 'alunos' (unificada)
    const { data: student } = await supabase
      .from('alunos')
      .select('*')
      .eq('id', user.id)
      .single();
    
    if (student) setStudentData(student);

    // 3. NOVO: Buscar estatísticas pessoais do aluno
    const { data: sessions } = await supabase
      .from('diario_bordo')
      .select('*')
      .eq('aluno_id', user.id)
      .not('saida', 'is', null);

    if (sessions) {
      let totalMs = 0;
      let visitsThisWeek = 0;
      
      const hoje = new Date();
      const diaDaSemana = hoje.getDay() === 0 ? 6 : hoje.getDay() - 1;
      const inicioSemana = new Date(hoje);
      inicioSemana.setDate(hoje.getDate() - diaDaSemana);
      inicioSemana.setHours(0, 0, 0, 0);

      sessions.forEach(s => {
        const start = new Date(s.entrada).getTime();
        const end = new Date(s.saida).getTime();
        totalMs += (end - start);

        if (new Date(s.entrada) >= inicioSemana) {
           visitsThisWeek++;
        }
      });

      setStats({
        totalHours: Math.round(totalMs / (1000 * 60 * 60)),
        totalVisits: sessions.length,
        weekVisits: visitsThisWeek
      });
    }

    setLoading(false);
  };

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" size={32} /></div>;

  return (
    <main className="min-h-screen bg-page text-primary p-6 pb-20 font-sans">
      <div className="max-w-xl mx-auto space-y-8">
        
        {/* CABEÇALHO */}
        <header className="flex items-center justify-between">
            <Link href="/" className="p-3 bg-surface border border-border rounded-2xl hover:bg-raised transition-colors group">
              <ArrowLeft size={20} className="text-secondary group-hover:text-primary transition-colors" />
            </Link>
            <div className="text-right">
                <h1 className="text-2xl font-black italic tracking-tighter text-primary">MEU PERFIL</h1>
                <p className="text-[10px] font-black uppercase text-accent tracking-widest">Gestão de Conta</p>
            </div>
        </header>

        {/* CARTÃO DE IDENTIFICAÇÃO PREMIUM */}
        <div className="bg-linear-to-br from-blue-900/20 to-slate-900 border border-accent/20 p-8 rounded-[2.5rem] flex items-center gap-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5">
              <User size={120} />
          </div>
          <div className="w-20 h-20 bg-accent text-on-accent rounded-3xl flex items-center justify-center text-3xl font-black shadow-lg shadow-accent/40 relative z-10">
            {studentData?.nome?.charAt(0) || '?'}
          </div>
          <div className="relative z-10">
            <h2 className="font-black text-2xl text-primary">{studentData?.nome || 'Aluno'}</h2>
            <p className="text-secondary text-xs font-bold mt-1 flex items-center gap-1.5">
              <Mail size={12} className="text-muted" />
              {ehEmailFachada(user?.email) ? `Utilizador: ${usernameSemSufixo(user?.email)}` : user?.email}
            </p>
            <div className="flex gap-2 mt-3">
               <span className="bg-page border border-border text-secondary text-[10px] px-3 py-1 rounded-lg uppercase font-black tracking-widest">
                 {studentData?.ano_escolar || '?'}º Ano
               </span>
               <span className="bg-accent-soft border border-accent/20 text-accent text-[10px] px-3 py-1 rounded-lg uppercase font-black tracking-widest flex items-center gap-1">
                 <ShieldCheck size={12} /> Aluno Ativo
               </span>
            </div>
          </div>
        </div>

        {/* ESTATÍSTICAS PESSOAIS */}
        <div className="grid grid-cols-1 gap-4">
            <div className="bg-surface border border-border p-6 rounded-4xl shadow-xl text-center">
                <div className="bg-success-bg text-success w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3">
                    <Clock size={20} />
                </div>
                <p className="text-3xl font-black text-primary">{stats.totalHours}<span className="text-sm font-bold text-muted ml-1">h</span></p>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted mt-1">Tempo de Estudo</p>
            </div>
        </div>

      </div>
    </main>
  );
}