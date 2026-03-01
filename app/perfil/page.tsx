'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import { ArrowLeft, User, Lock, Save, Loader2, Mail, KeyRound, Activity, Clock, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function StudentProfile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [studentData, setStudentData] = useState<any>(null);
  const [stats, setStats] = useState({ totalHours: 0, totalVisits: 0, weekVisits: 0 });
  
  // Formulário de Password
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState({ type: '', text: '' });

  const router = useRouter();
  
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

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

  const handleUpdatePassword = async (e: any) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'A password deve ter pelo menos 6 caracteres.' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'As passwords não coincidem.' });
      return;
    }

    setSaving(true);

    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      setMessage({ type: 'error', text: 'Erro: ' + error.message });
    } else {
      setMessage({ type: 'success', text: 'Password atualizada com segurança!' });
      setNewPassword('');
      setConfirmPassword('');
    }
    setSaving(false);
  };

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] text-white p-6 pb-20 font-sans">
      <div className="max-w-xl mx-auto space-y-8">
        
        {/* CABEÇALHO */}
        <header className="flex items-center justify-between">
            <Link href="/" className="p-3 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-colors group">
              <ArrowLeft size={20} className="text-slate-400 group-hover:text-white transition-colors" />
            </Link>
            <div className="text-right">
                <h1 className="text-2xl font-black italic tracking-tighter text-white">MEU PERFIL</h1>
                <p className="text-[10px] font-black uppercase text-blue-500 tracking-widest">Gestão de Conta</p>
            </div>
        </header>

        {/* CARTÃO DE IDENTIFICAÇÃO PREMIUM */}
        <div className="bg-linear-to-br from-blue-900/20 to-slate-900 border border-blue-500/20 p-8 rounded-[2.5rem] flex items-center gap-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-5">
              <User size={120} />
          </div>
          <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center text-3xl font-black shadow-lg shadow-blue-900/40 relative z-10">
            {studentData?.nome?.charAt(0) || '?'}
          </div>
          <div className="relative z-10">
            <h2 className="font-black text-2xl text-white">{studentData?.nome || 'Aluno'}</h2>
            <p className="text-slate-400 text-xs font-bold mt-1 flex items-center gap-1.5">
              <Mail size={12} className="text-slate-500" /> {user?.email}
            </p>
            <div className="flex gap-2 mt-3">
               <span className="bg-slate-950 border border-slate-800 text-slate-300 text-[10px] px-3 py-1 rounded-lg uppercase font-black tracking-widest">
                 {studentData?.ano_escolar || '?'}º Ano
               </span>
               <span className="bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] px-3 py-1 rounded-lg uppercase font-black tracking-widest flex items-center gap-1">
                 <ShieldCheck size={12} /> Aluno Ativo
               </span>
            </div>
          </div>
        </div>

        {/* ESTATÍSTICAS PESSOAIS */}
        <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl text-center">
                <div className="bg-emerald-500/10 text-emerald-500 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3">
                    <Clock size={20} />
                </div>
                <p className="text-3xl font-black text-white">{stats.totalHours}<span className="text-sm font-bold text-slate-500 ml-1">h</span></p>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-1">Tempo de Estudo</p>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-xl text-center">
                <div className="bg-purple-500/10 text-purple-400 w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3">
                    <Activity size={20} />
                </div>
                <p className="text-3xl font-black text-white">
                    {stats.weekVisits}
                    <span className="text-sm font-bold text-slate-500 ml-1">
                        / {studentData?.limite_semanal > 0 ? studentData.limite_semanal : '∞'}
                    </span>
                </p>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-1">Sessões na Semana</p>
            </div>
        </div>

        {/* ZONA DE SEGURANÇA (ALTERAR PASSWORD) */}
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] shadow-xl">
          <h3 className="font-black text-sm uppercase tracking-widest mb-6 flex items-center gap-2 text-slate-400">
            <Lock size={18} className="text-yellow-500" /> Segurança da Conta
          </h3>
          
          <form onSubmit={handleUpdatePassword} className="space-y-5">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Nova Password</label>
              <div className="relative mt-1">
                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input 
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full bg-slate-950 border border-slate-800 text-white pl-12 pr-4 py-4 rounded-2xl outline-none focus:border-yellow-500 transition-all font-medium placeholder:text-slate-600"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Confirmar Password</label>
              <div className="relative mt-1">
                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input 
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repetir password"
                  className="w-full bg-slate-950 border border-slate-800 text-white pl-12 pr-4 py-4 rounded-2xl outline-none focus:border-yellow-500 transition-all font-medium placeholder:text-slate-600"
                />
              </div>
            </div>

            {message.text && (
              <div className={`p-4 rounded-2xl text-xs font-black uppercase tracking-widest text-center border ${message.type === 'error' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'}`}>
                {message.text}
              </div>
            )}

            <button 
              type="submit" 
              disabled={saving || !newPassword}
              className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-yellow-950 font-black py-4 rounded-2xl transition-all active:scale-95 shadow-lg shadow-yellow-900/20 flex items-center justify-center gap-2 mt-2"
            >
              {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              {saving ? 'A ATUALIZAR...' : 'GRAVAR NOVA PASSWORD'}
            </button>
          </form>
        </div>

      </div>
    </main>
  );
}