'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Users, AlertTriangle, ShieldAlert, Clock, GraduationCap, Loader2, RefreshCw, MessageCircle, LogOut, CalendarDays } from 'lucide-react';

export default function DashboardAdmin() {
  const [presencas, setPresencas] = useState<any[]>([]);
  const [proximosTestes, setProximosTestes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    fetchDados();

    const channel = supabase
      .channel('torre-controlo-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'diario_bordo' }, () => fetchDados())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exams' }, () => fetchDados())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchDados = async () => {
    // ATUALIZAÇÃO: Agora puxamos o Pacote e os Horários vinculados ao Aluno
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
    
    if (errP) {
       console.error(errP);
       setErrorMsg("Erro de Sincronização: " + errP.message);
    }

    const hojeStr = new Date().toISOString().split('T')[0];
    const { data: exames } = await supabase
      .from('exams')
      .select('*, alunos(nome)')
      .gte('date', hojeStr)
      .order('date', { ascending: true });
    
    setPresencas(presentes || []);
    setProximosTestes(exames || []);
    setLoading(false);
  };

  // Handlers omitidos para brevidade (mantém os que já tinhas: handleAvisarEntrada, handleAvisarSaida, handleDarSaida)
  const handleAvisarEntrada = (telefone: string, nome: string) => {
    if (!telefone) return alert("Este aluno não tem telefone de encarregado registado.");
    const msg = encodeURIComponent(`Olá! Informamos que o(a) aluno(a) ${nome} deu entrada no Centro AI. Foco total! 📚`);
    window.open(`https://wa.me/351${telefone}?text=${msg}`, '_blank');
 };

 const handleAvisarSaida = async (presencaId: string, telefone: string, nome: string) => {
    await supabase.from('diario_bordo').update({ status: 'validado' }).eq('id', presencaId);
    if (telefone) {
        const msg = encodeURIComponent(`Olá! Informamos que o(a) aluno(a) ${nome} concluiu a sua sessão e aguarda boleia. 🚗`);
        window.open(`https://wa.me/351${telefone}?text=${msg}`, '_blank');
    }
 };

 const handleDarSaida = async (presencaId: string) => {
    await supabase.from('diario_bordo').update({ saida: new Date().toISOString() }).eq('id', presencaId);
 };

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] p-4 md:p-8 text-white font-sans">
      
      {errorMsg && (
        <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl mb-6 text-amber-500 text-xs font-black flex items-center gap-2">
            <AlertTriangle size={16} /> {errorMsg}
        </div>
      )}

      <header className="mb-10 flex justify-between items-center">
        <div>
          <h1 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter">Torre de Controlo</h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Monitorização de Pacotes e Horários</p>
        </div>
        <button onClick={fetchDados} className="p-3 bg-slate-900 rounded-xl border border-slate-800 hover:text-blue-400 transition-all">
          <RefreshCw size={20} />
        </button>
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
              
              // LÓGICA DE VALIDAÇÃO DE HORÁRIO
              const diaAtual = new Date().getDay(); // 0 (Dom) a 6 (Sáb)
              const diaContratado = aluno?.aluno_horarios?.some((h: any) => h.dia_semana === diaAtual);
              const nomePacote = aluno?.pacotes?.nome || 'Sem Pacote';
              
              const jaAvisado = p.status === 'validado';

              return (
                <div key={p.id} className={`bg-slate-900 border ${!diaContratado ? 'border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]' : (jaAvisado ? 'border-emerald-500/50' : 'border-slate-800')} p-5 rounded-3xl flex flex-col md:flex-row items-center justify-between transition-all group gap-4`}>
                  <div className="flex items-center gap-4 w-full md:w-auto">
                    <div className={`w-14 h-14 shrink-0 ${!diaContratado ? 'bg-red-600' : (jaAvisado ? 'bg-emerald-600' : 'bg-blue-600')} rounded-2xl flex items-center justify-center text-xl font-black shadow-lg`}>
                      {aluno?.nome?.charAt(0) || '?'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-black group-hover:text-blue-400 transition-colors">
                          {aluno?.nome || 'Perfil Não Encontrado'}
                        </h3>
                        {!diaContratado && (
                          <span className="bg-red-500 text-[8px] px-2 py-0.5 rounded-full font-black uppercase animate-bounce">
                            Dia Não Contratado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 font-medium">
                        {nomePacote} • {p.subject_name || 'Sessão de Estudo'}
                      </p>
                      
                      <div className="flex flex-wrap gap-2 mt-2">
                        {/* Tag de Horário */}
                        <span className={`px-2 py-1 rounded text-[10px] font-black flex items-center gap-1 border ${diaContratado ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
                          <CalendarDays size={12} /> {diaContratado ? 'Dentro do Horário' : 'Fora de Horário'}
                        </span>
                        
                        {aluno && !aluno.saida_autorizada && (
                          <span className="bg-red-500/10 text-red-500 border border-red-500/20 px-2 py-1 rounded text-[10px] font-black flex items-center gap-1">
                            <ShieldAlert size={12} /> Saída Restrita
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
                    <div className="text-right mr-2">
                      <p className="text-[10px] font-black text-slate-600 uppercase mb-1">Entrada</p>
                      <p className="text-blue-400 font-mono font-bold text-lg">
                        {new Date(p.entrada).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
                        <button onClick={() => handleAvisarEntrada(aluno?.telefone_encarregado, aluno?.nome)} className="bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white p-2.5 rounded-xl transition-all min-w-15">
                           <MessageCircle size={16} className="mx-auto" />
                           <span className="text-[8px] font-black uppercase block mt-1">Chegada</span>
                        </button>

                        <button onClick={() => handleAvisarSaida(p.id, aluno?.telefone_encarregado, aluno?.nome)} className={`${jaAvisado ? 'bg-emerald-600 text-white' : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500'} p-2.5 rounded-xl transition-all min-w-15`}>
                           <MessageCircle size={16} className="mx-auto" />
                           <span className="text-[8px] font-black uppercase block mt-1">{jaAvisado ? 'Avisado' : 'Fim'}</span>
                        </button>

                        <div className="w-px h-8 bg-slate-800 mx-1"></div>

                        <button onClick={() => { if(confirm("Confirmar saída física?")) handleDarSaida(p.id) }} className="bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white p-2.5 rounded-xl transition-all min-w-15">
                           <LogOut size={16} className="mx-auto" />
                           <span className="text-[8px] font-black uppercase block mt-1">Porta</span>
                        </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* LADO DIREITO: MÉTRICAS */}
        <div className="space-y-6">
          <div className="bg-blue-600 p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
            <Users size={80} className="absolute top-0 right-0 p-4 opacity-10" />
            <p className="text-blue-100 font-bold uppercase text-[10px] tracking-widest relative z-10">Total na Sala</p>
            <h4 className="text-7xl font-black mt-2 relative z-10">{presencas.length}</h4>
          </div>
          
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem]">
            <h4 className="font-black text-sm uppercase text-slate-500 mb-6 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> Agenda de Risco
            </h4>
            <div className="space-y-5">
              {proximosTestes.length > 0 ? (
                proximosTestes.map(ex => (
                  <div key={ex.id} className="text-xs border-l-2 border-amber-500/50 pl-4 py-1">
                    <p className="text-white font-bold">{ex.alunos?.nome || 'Aluno'}</p>
                    <p className="text-slate-500 mt-1 uppercase text-[10px] font-black">
                      Teste de {ex.subject_name} • {new Date(ex.date).toLocaleDateString('pt-PT')}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-slate-600 text-xs italic">Nenhum teste próximo.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}