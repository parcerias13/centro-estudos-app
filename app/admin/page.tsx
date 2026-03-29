'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { Users, AlertTriangle, ShieldAlert, Clock, Loader2, RefreshCw, MessageCircle, LogOut, CalendarDays, MapPin, CheckCircle2, XCircle } from 'lucide-react';

export default function DashboardAdmin() {
  const [presencas, setPresencas] = useState<any[]>([]);
  const [proximosTestes, setProximosTestes] = useState<any[]>([]);
  const [salas, setSalas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // 1. FUNÇÃO DE BUSCA (A ÚNICA FONTE DA VERDADE)
  const fetchDados = useCallback(async () => {
    try {
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
      
      setPresencas(presentes || []);
      setProximosTestes(exames || []);
      setSalas(salasData || []);
    } catch (err: any) {
      console.error("❌ Erro ao buscar dados:", err.message);
      setErrorMsg("Falha na sincronização: " + err.message);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // 2. REALTIME (SINTONIA)
  useEffect(() => {
    fetchDados();

    const channel = supabase
      .channel('dashboard-realtime-master')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'diario_bordo' }, (payload) => {
        console.log('🔄 Mudança detetada:', payload.eventType);
        fetchDados();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exams' }, () => fetchDados())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchDados]);

  // 3. HANDLERS (Com atualização forçada para a cor mudar na hora)
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
    
    const msg = tipo === 'entrada' 
      ? `Olá! Informamos que o(a) aluno(a) ${nome} deu entrada no Centro AI. Foco total! 📚`
      : `Olá! Informamos que o(a) aluno(a) ${nome} concluiu a sua sessão e aguarda boleia. 🚗`;

    window.open(`https://wa.me/351${telefone}?text=${encodeURIComponent(msg)}`, '_blank');

    const updateData = tipo === 'entrada' ? { msg_in_enviada: true } : { msg_out_enviada: true };
    const { error } = await supabase.from('diario_bordo').update(updateData).eq('id', presencaId);
    if (!error) fetchDados(); // FORÇA A MUDANÇA DE COR
  };

  const handleDarSaida = async (presencaId: string) => {
    if(!confirm("Confirmar saída física?")) return;
    const { error } = await supabase.from('diario_bordo').update({ saida: new Date().toISOString() }).eq('id', presencaId);
    if (!error) fetchDados(); 
  };

  const salasStatus = salas.map(sala => {
    const count = presencas.filter(p => p.sala_id === sala.id).length;
    const percentage = sala.capacidade > 0 ? (count / sala.capacidade) * 100 : 0;
    return { ...sala, count, percentage };
  });

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] p-4 md:p-8 text-white font-sans">
      
      {errorMsg && (
        <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl mb-6 text-amber-500 text-[10px] font-black flex items-center gap-2">
            <AlertTriangle size={16} /> {errorMsg}
        </div>
      )}

      <header className="mb-10 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <h1 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter">Dashboard</h1>
        <div className="flex items-center gap-3">
          <Link href="/admin/salas" className="flex items-center gap-2 px-4 py-3 bg-blue-600/10 text-blue-500 border border-blue-500/20 rounded-xl hover:bg-blue-600 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest">
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

          {presencas.map((p) => {
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
                    {aluno?.nome?.charAt(0)}
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
                      <button onClick={() => handleValidarEntrada(p.id)} className={`${estaValidado ? 'bg-emerald-600 text-white' : 'bg-emerald-500/10 text-emerald-500'} p-2.5 rounded-xl transition-all min-w-14`}>
                        <CheckCircle2 size={16} className="mx-auto" />
                        <span className="text-[8px] font-black block mt-1 uppercase">{estaValidado ? 'Aceite' : 'Aceitar'}</span>
                      </button>

                      <button onClick={() => handleWhatsApp(p.id, aluno?.telefone_encarregado, aluno?.nome, 'entrada')} className={`${p.msg_in_enviada ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(37,99,235,0.3)]' : 'bg-blue-500/10 text-blue-500'} p-2.5 rounded-xl transition-all min-w-14 relative`}>
                        <MessageCircle size={16} className="mx-auto" />
                        <span className="text-[8px] font-black block mt-1 uppercase">{p.msg_in_enviada ? 'Enviada' : 'Msg In'}</span>
                        {p.msg_in_enviada && <CheckCircle2 size={10} className="absolute top-1 right-1" />}
                      </button>

                      <button onClick={() => handleWhatsApp(p.id, aluno?.telefone_encarregado, aluno?.nome, 'saida')} className={`${p.msg_out_enviada ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.3)]' : 'bg-purple-500/10 text-purple-500'} p-2.5 rounded-xl transition-all min-w-14 relative`}>
                        <MessageCircle size={16} className="mx-auto" />
                        <span className="text-[8px] font-black block mt-1 uppercase">{p.msg_out_enviada ? 'Enviada' : 'Msg Out'}</span>
                        {p.msg_out_enviada && <CheckCircle2 size={10} className="absolute top-1 right-1" />}
                      </button>

                      <button onClick={() => handleDarSaida(p.id)} className="bg-slate-800 text-slate-400 hover:bg-red-500 hover:text-white p-2.5 rounded-xl transition-all">
                        <LogOut size={16} />
                      </button>
                  </div>
                </div>
              </div>
            );
          })}
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
            <h4 className="font-black text-sm uppercase text-slate-500 mb-6 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> Agenda de Risco
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
    </main>
  );
}