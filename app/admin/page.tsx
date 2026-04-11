'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { Users, AlertTriangle, ShieldAlert, Clock, Loader2, RefreshCw, MessageCircle, LogOut, CalendarDays, MapPin, CheckCircle2, XCircle, UserPlus, Search, BookOpen, X, Plus, Calendar } from 'lucide-react';


export default function DashboardAdmin() {
  const [presencas, setPresencas] = useState<any[]>([]);
  const [proximosTestes, setProximosTestes] = useState<any[]>([]);
  const [salas, setSalas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- SISTEMA DE CONTROLO DE FLUXO (ANTI-DOUBLE CLICK) ---
  const safeAction = async (actionFn: () => Promise<void>) => {
    if (isSubmitting) return; 
    
    setIsSubmitting(true);
    try {
      await actionFn(); 
    } catch (error) {
      console.error("Erro na operação:", error);
    } finally {
      setIsSubmitting(false); 
    }
  };

  // --- CONTROLO DE ACESSO (ROLE) ---
  const [userRole, setUserRole] = useState<string | null>(null);

  // --- ESTADOS PARA CHECK-IN MANUAL ---
  const [alunos, setAlunos] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAluno, setSelectedAluno] = useState<any>(null);

  // --- ESTADOS PARA AGENDAMENTO DE TESTES ---
  const [isExamModalOpen, setIsExamModalOpen] = useState(false);
  const [examSearchQuery, setExamSearchQuery] = useState('');
  const [selectedExamStudent, setSelectedExamStudent] = useState<any>(null);
  const [examDate, setExamDate] = useState('');
  const [examSubject, setExamSubject] = useState('');

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // 1. FUNÇÃO DE BUSCA
  const fetchDados = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: perfil } = await supabase.from('staff').select('role').eq('id', user.id).single();
        setUserRole(perfil?.role?.toLowerCase() || 'explicador');
      }

      const { data: presentes, error: errP } = await supabase
        .from('diario_bordo')
        .select(`
          *, 
          alunos!aluno_id(
            *, 
            pacotes(nome, sessoes_semanais), 
            aluno_horarios(dia_semana)
          )
        `) 
        .is('saida', null)
        .order('entrada', { ascending: false });
      
      if (errP) throw errP;

      const hojeStr = new Date().toISOString().split('T')[0];
      const { data: exames } = await supabase
        .from('exams')
        .select('*, alunos(nome)')
        .gte('date', hojeStr)
        .order('date', { ascending: true });

      const { data: salasData } = await supabase.from('salas').select('*').order('nome');
      const { data: aData } = await supabase.from('alunos').select('*, pacotes(nome)').order('nome');
      const { data: subData } = await supabase.from('subjects').select('*').order('name');
      
      setPresencas(presentes || []);
      setProximosTestes(exames || []);
      setSalas(salasData || []);
      setAlunos(aData || []);
      setSubjects(subData || []);
    } catch (err: any) {
      console.error("❌ Erro ao buscar dados:", err.message);
      setErrorMsg("Falha na sincronização: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // 2. REALTIME
  useEffect(() => {
    fetchDados();
    const channel = supabase
      .channel('dashboard-realtime-master')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'diario_bordo' }, () => fetchDados())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exams' }, () => fetchDados())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchDados]);

  // 3. HANDLERS
  const handleMassCheckout = async () => {
    if (!confirm("⚠️ ATENÇÃO: Desejas fechar a sessão de TODOS os alunos agora?")) return;
    const { error } = await supabase.rpc('checkout_em_massa');
    if (error) alert("Erro ao realizar checkout: " + error.message);
    else fetchDados();
  };

  const handleValidarEntrada = async (presencaId: string) => {
    const { error } = await supabase.from('diario_bordo').update({ status: 'validado' }).eq('id', presencaId);
    if (!error) fetchDados(); 
  };

  const handleRejeitarEntrada = async (presencaId: string) => {
    if (!confirm("O aluno não está no centro?")) return;
    const { error } = await supabase.from('diario_bordo').delete().eq('id', presencaId);
    if (!error) fetchDados(); 
  };

  const handleWhatsApp = async (presencaId: string, telefone: string, nome: string, tipo: 'entrada' | 'saida') => {
    if (!telefone) return alert("Este aluno não tem telefone registado.");
    const numApenasNumeros = telefone.replace(/\D/g, '');
    const numFinal = numApenasNumeros.startsWith('351') ? numApenasNumeros : `351${numApenasNumeros}`;
    const msg = tipo === 'entrada' 
      ? `Olá! Informamos que o(a) aluno(a) ${nome} deu entrada no Centro de Estudos! 📚`
      : `Olá! Informamos que o(a) aluno(a) ${nome} concluiu a sua sessão de estudo!`;
    window.open(`https://wa.me/${numFinal}?text=${encodeURIComponent(msg)}`, '_blank');
    const updateData = tipo === 'entrada' ? { msg_in_enviada: true } : { msg_out_enviada: true };
    const { error } = await supabase.from('diario_bordo').update(updateData).eq('id', presencaId);
    if (!error) fetchDados(); 
  };

  const handleDarSaida = async (presencaId: string) => {
    if(!confirm("Confirmar saída física?")) return;
    const { error } = await supabase.from('diario_bordo').update({ saida: new Date().toISOString() }).eq('id', presencaId);
    if (!error) fetchDados(); 
  };

  const handleManualCheckIn = async (subject: any) => {
    if (!selectedAluno) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('diario_bordo').insert({
        aluno_id: selectedAluno.id,
        student_id: selectedAluno.id,
        subject_id: subject.id,
        subject_name: subject.name,
        sala_id: subject.sala_id, 
        entrada: new Date().toISOString(),
        status: 'validado'
      });
      if (error) throw error;
      setIsModalOpen(false);
      setSelectedAluno(null);
      setSearchQuery('');
      fetchDados();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateExam = async () => {
    if (!selectedExamStudent || !examSubject || !examDate) return alert("Preenche tudo!");
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('exams').insert({
        student_id: selectedExamStudent.id,
        subject_name: examSubject,
        date: examDate
      });
      if (!error) {
        setIsExamModalOpen(false);
        setSelectedExamStudent(null);
        setExamSubject('');
        setExamDate('');
        fetchDados();
      } else {
        alert("Erro: " + error.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const alunosDisponiveis = alunos.filter(a => !presencas.some(p => p.aluno_id === a.id) && a.nome.toLowerCase().includes(searchQuery.toLowerCase()));
  const alunosFiltradosExame = alunos.filter(a => a.nome.toLowerCase().includes(examSearchQuery.toLowerCase()));

  const salasStatus = salas.map(sala => {
    const count = presencas.filter(p => p.sala_id === sala.id).length;
    const percentage = sala.capacidade > 0 ? (count / sala.capacidade) * 100 : 0;
    return { ...sala, count, percentage };
  });

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  return (
    <main className={`min-h-screen bg-[#0f172a] p-4 md:p-8 text-white font-sans relative transition-all ${isSubmitting ? 'pointer-events-none opacity-60' : ''}`}>
      
      {errorMsg && (
        <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl mb-6 text-amber-500 text-[10px] font-black flex items-center gap-2">
            <AlertTriangle size={16} /> {errorMsg}
        </div>
      )}

      <header className="mb-10 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter">Dashboard</h1>
        </div>
        
        <div className="flex items-center gap-3">
          <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 px-4 py-3 bg-emerald-600/10 text-emerald-500 border border-emerald-500/20 rounded-xl hover:bg-emerald-600 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest shadow-lg">
            <UserPlus size={16} /> Entrada Manual
          </button>

          {presencas.length > 0 && (
            <button disabled={isSubmitting} onClick={() => safeAction(handleMassCheckout)} className="flex items-center gap-2 px-4 py-3 bg-red-600/10 text-red-500 border border-red-500/20 rounded-xl hover:bg-red-600 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest shadow-lg shadow-red-900/10 disabled:opacity-50">
              <LogOut size={16} /> Checkout Total
            </button>
          )}

          <Link href="/admin/salas" className="flex items-center gap-2 px-4 py-3 bg-blue-600/10 text-blue-500 border border-blue-500/20 rounded-xl hover:bg-blue-600 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest shadow-lg">
            <MapPin size={16} /> Gestão de Salas
          </Link>
          
          <button onClick={fetchDados} className="p-3 bg-slate-900 rounded-xl border border-slate-800 hover:text-blue-400 transition-all">
            <RefreshCw size={20} />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="flex items-center gap-2 text-slate-400 font-black uppercase text-xs tracking-widest">
              <Clock size={14} /> Monitorização de Sala
            </h2>
            <span className="text-[10px] text-emerald-500 font-bold uppercase animate-pulse">● Ao Vivo</span>
          </div>

          {presencas.length === 0 ? (
            <div className="bg-slate-900/40 border-2 border-dashed border-slate-800 p-20 rounded-[2.5rem] text-center italic opacity-50">
              Aguardando check-ins...
            </div>
          ) : (
            presencas.map((p) => {
              const aluno = Array.isArray(p.alunos) ? p.alunos[0] : p.alunos;
              const diaAtual = new Date().getDay(); 
              const diaContratado = aluno?.aluno_horarios?.some((h: any) => h.dia_semana === diaAtual);
              const estaValidado = p.status === 'validado';
              const nomeSala = salas.find(s => s.id === p.sala_id)?.nome || 'Sem Sala';
              const corBase = !diaContratado ? 'bg-red-600' : (estaValidado ? 'bg-emerald-600' : 'bg-blue-600');

              return (
                <div key={p.id} className={`bg-slate-900 border ${!diaContratado ? 'border-red-500' : (estaValidado ? 'border-emerald-500/40' : 'border-slate-800')} p-5 rounded-3xl flex flex-col md:flex-row items-center justify-between transition-all gap-4`}>
                  <div className="flex items-center gap-4 w-full md:w-auto">
                  <div className={`w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center text-xl font-black border border-slate-700/50 ${corBase}`}>
                    {aluno?.avatar_url && (aluno.avatar_url.startsWith('http://') || aluno.avatar_url.startsWith('https://')) ? <img src={aluno.avatar_url} alt={aluno?.nome} className="w-full h-full object-cover rounded-2xl" /> : aluno?.nome?.charAt(0)}
                  </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-black">{aluno?.nome}</h3>
                        {!diaContratado && <span className="bg-red-500 text-[8px] px-2 py-0.5 rounded-full font-black uppercase">Fora de Horário</span>}
                      </div>
                      <p className="text-xs text-slate-500 font-medium">
                        {aluno?.pacotes?.nome || 'Sem Pacote'} • {p.subject_name || 'Sessão Livre'} • <span className="text-white/70">{nomeSala}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right mr-2">
                      <p className="text-blue-400 font-mono font-bold text-lg">
                        {new Date(p.entrada).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
                        <button disabled={isSubmitting} onClick={() => safeAction(() => handleValidarEntrada(p.id))} className={`${estaValidado ? 'bg-emerald-600 text-white' : 'bg-emerald-500/10 text-emerald-500'} p-2.5 rounded-xl transition-all min-w-14 disabled:opacity-50`}>
                          {isSubmitting && !estaValidado ? <Loader2 className="animate-spin mx-auto" size={16} /> : <CheckCircle2 size={16} className="mx-auto" />}
                          <span className="text-[8px] font-black block mt-1 uppercase">{estaValidado ? 'Aceite' : 'Aceitar'}</span>
                        </button>
                        <button disabled={isSubmitting} onClick={() => safeAction(() => handleWhatsApp(p.id, aluno?.telefone_encarregado, aluno?.nome, 'entrada'))} className={`${p.msg_in_enviada ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.3)]' : 'bg-blue-500/10 text-blue-500'} p-2.5 rounded-xl transition-all min-w-14 relative disabled:opacity-50`}>
                          <MessageCircle size={16} className="mx-auto" />
                          <span className="text-[8px] font-black block mt-1 uppercase">{p.msg_in_enviada ? 'Enviada' : 'Msg In'}</span>
                          {p.msg_in_enviada && <CheckCircle2 size={10} className="absolute top-1 right-1" />}
                        </button>
                        <button disabled={isSubmitting} onClick={() => safeAction(() => handleWhatsApp(p.id, aluno?.telefone_encarregado, aluno?.nome, 'saida'))} className={`${p.msg_out_enviada ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.3)]' : 'bg-purple-500/10 text-purple-500'} p-2.5 rounded-xl transition-all min-w-14 relative disabled:opacity-50`}>
                          <MessageCircle size={16} className="mx-auto" />
                          <span className="text-[8px] font-black block mt-1 uppercase">{p.msg_out_enviada ? 'Enviada' : 'Msg Out'}</span>
                          {p.msg_out_enviada && <CheckCircle2 size={10} className="absolute top-1 right-1" />}
                        </button>
                        <button disabled={isSubmitting} onClick={() => safeAction(() => handleDarSaida(p.id))} className="bg-slate-800 text-slate-400 hover:bg-red-500 hover:text-white p-2.5 rounded-xl transition-all disabled:opacity-50">
                          {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <LogOut size={16} />}
                        </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-blue-600 p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
            <Users size={80} className="absolute top-0 right-0 p-4 opacity-10" />
            <p className="text-blue-100 font-bold uppercase text-[10px] tracking-widest relative z-10">Total no Centro</p>
            <h4 className="text-7xl font-black mt-2 relative z-10">{presencas.length}</h4>
          </div>
          
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem]">
            <h4 className="font-black text-sm uppercase text-slate-500 mb-6 flex items-center gap-2">
              <MapPin size={16} className="text-blue-500" /> Lotação das Salas
            </h4>
            <div className="space-y-5">
              {salasStatus.map(sala => (
                <div key={sala.id} className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-bold">
                    <span>{sala.nome}</span>
                    <span className="text-slate-400">{sala.count} / {sala.capacidade}</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all duration-1000" style={{ width: `${sala.percentage}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem]">
            <h4 className="font-black text-sm uppercase text-slate-500 mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2"><AlertTriangle size={16} className="text-amber-500" /> Agenda de Risco</div>
              <button onClick={() => setIsExamModalOpen(true)} className="p-1 bg-slate-800 hover:bg-amber-500/20 hover:text-amber-500 rounded-md transition-all">
                <Plus size={16} />
              </button>
            </h4>
            <div className="space-y-4">
              {proximosTestes.map(ex => (
                <div key={ex.id} className="border-l-2 border-amber-500/50 pl-4 py-1">
                  <p className="text-xs font-bold text-white">{ex.alunos?.nome}</p>
                  <p className="text-[10px] text-slate-500 uppercase font-black">Teste de {ex.subject_name} • {new Date(ex.date).toLocaleDateString('pt-PT')}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* --- MODAIS --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-[2.5rem] shadow-3xl p-6 animate-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-6"><h3 className="text-xl font-black uppercase italic">Check-in Manual</h3><button onClick={() => { setIsModalOpen(false); setSelectedAluno(null); }}><X size={20}/></button></div>
            {!selectedAluno ? (
                <>
                  <div className="relative mb-4"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} /><input autoFocus placeholder="Quem chegou?" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 pl-12 rounded-2xl outline-none focus:border-emerald-500 transition-all font-bold" /></div>
                  <div className="max-h-60 overflow-y-auto space-y-2">{alunosDisponiveis.map(aluno => {
                    const isValidUrl = aluno.avatar_url && (aluno.avatar_url.startsWith('http://') || aluno.avatar_url.startsWith('https://'));
                    return (<button key={aluno.id} onClick={() => setSelectedAluno(aluno)} className="w-full p-4 bg-slate-950/50 border border-slate-800 rounded-2xl flex items-center gap-3 hover:border-emerald-500 transition-all group"><div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center font-black text-emerald-500">{isValidUrl ? <img src={aluno.avatar_url} alt={aluno.nome} className="w-full h-full object-cover rounded-xl" /> : aluno.nome.charAt(0)}</div><div className="text-left"><p className="font-bold text-sm">{aluno.nome}</p></div></button>);
                  })}</div>
                </>
            ) : (
                <div className="space-y-4"><div className="flex items-center gap-4 bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/20"><div className="w-12 h-12 rounded-xl bg-emerald-500 flex items-center justify-center font-black text-white text-xl">{selectedAluno.nome.charAt(0)}</div><div><p className="text-lg font-black">{selectedAluno.nome}</p></div><button onClick={() => setSelectedAluno(null)} className="ml-auto text-xs font-black text-slate-500 uppercase">Trocar</button></div><div className="grid grid-cols-2 gap-2">{subjects.map(sub => (<button key={sub.id} disabled={isSubmitting} onClick={() => handleManualCheckIn(sub)} className="p-4 bg-slate-950 border border-slate-800 rounded-2xl hover:border-blue-500 transition-all text-xs font-bold">{sub.name}</button>))}</div></div>
            )}
          </div>
        </div>
      )}

      {isExamModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-[2.5rem] shadow-3xl p-6 animate-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-6"><h3 className="text-xl font-black uppercase italic">Agendar Teste</h3><button onClick={() => { setIsExamModalOpen(false); setSelectedExamStudent(null); }}><X size={20}/></button></div>
            {!selectedExamStudent ? (
                <>
                  <div className="relative mb-4"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} /><input autoFocus placeholder="Qual o aluno?" value={examSearchQuery} onChange={(e) => setExamSearchQuery(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 pl-12 rounded-2xl outline-none focus:border-amber-500 font-bold" /></div>
                  <div className="max-h-60 overflow-y-auto space-y-2">{alunosFiltradosExame.map(aluno => (<button key={aluno.id} onClick={() => setSelectedExamStudent(aluno)} className="w-full p-4 bg-slate-950/50 border border-slate-800 rounded-2xl flex items-center gap-3 hover:border-amber-500 transition-all group"><div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center font-black text-amber-500">{(aluno.avatar_url && (aluno.avatar_url.startsWith('http://') || aluno.avatar_url.startsWith('https://'))) ? <img src={aluno.avatar_url} alt={aluno.nome} className="w-full h-full object-cover rounded-xl" /> : aluno.nome.charAt(0)}</div><p className="font-bold text-sm">{aluno.nome}</p></button>))}</div>
                </>
            ) : (
                <div className="space-y-6">
                  <div className="flex items-center gap-4 bg-amber-500/10 p-4 rounded-2xl border border-amber-500/20">
                    <div><p className="text-lg font-black">{selectedExamStudent.nome}</p></div>
                    <button onClick={() => setSelectedExamStudent(null)} className="ml-auto text-xs font-black text-slate-500 uppercase">Trocar</button>
                  </div>
                  <div className="space-y-4">
                    <select value={examSubject} onChange={(e) => setExamSubject(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-2xl outline-none font-bold text-white">
                      <option value="">Disciplina...</option>
                      {subjects.map(sub => (<option key={sub.id} value={sub.name}>{sub.name}</option>))}
                    </select>
                    <div className="relative">
                      <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                      <input 
                        type="date" 
                        value={examDate} 
                        onChange={(e) => setExamDate(e.target.value)} 
                        className="w-full bg-slate-950 border border-slate-800 p-4 pl-12 rounded-2xl outline-none font-bold text-white" 
                      />
                    </div>
                  </div>
                  <button onClick={handleCreateExam} disabled={isSubmitting || !examDate || !examSubject} className="w-full bg-amber-600 hover:bg-amber-500 text-white p-5 rounded-2xl font-black">CONFIRMAR AGENDAMENTO</button>
                </div>
            )}
          </div>
        </div>
      )}
    </main>
      );
}