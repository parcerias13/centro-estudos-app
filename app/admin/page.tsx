'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Users, AlertTriangle, ShieldAlert, Clock, GraduationCap, Loader2, RefreshCw, MessageCircle, LogOut } from 'lucide-react';

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
    const interval = setInterval(fetchDados, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchDados = async () => {
    // 1. Buscar presenças ativas
    const { data: presentes, error: errP } = await supabase
      .from('diario_bordo')
      .select('*, alunos!aluno_id(*)') 
      .is('saida', null)
      .order('entrada', { ascending: false });
    
    if (errP) {
       console.error(errP);
       setErrorMsg("Aviso de Sincronização: " + errP.message);
    } else {
       setErrorMsg(null);
    }

    // 2. Buscar agenda de testes próximos 
    const hoje = new Date().toISOString().split('T')[0];
    const { data: exames } = await supabase
      .from('exams')
      .select('*, alunos(nome)')
      .gte('date', hoje)
      .order('date', { ascending: true });
    
    setPresencas(presentes || []);
    setProximosTestes(exames || []);
    setLoading(false);
  };

  // AÇÃO 1: MENSAGEM DE CHEGADA (Novo Pedido) [cite: 2026-02-18]
  const handleAvisarEntrada = (telefone: string, nome: string) => {
     if (!telefone) return alert("Este aluno não tem telefone de encarregado registado.");
     const msg = encodeURIComponent(`Olá! Informamos que o(a) aluno(a) ${nome} deu entrada no Centro AI e já iniciou a sua sessão de estudo. Foco total! 📚`);
     window.open(`https://wa.me/351${telefone}?text=${msg}`, '_blank');
  };

  // AÇÃO 2: MENSAGEM DE SAÍDA / AGUARDAR BOLEIA [cite: 2026-02-18]
  const handleAvisarSaida = async (presencaId: string, telefone: string, nome: string) => {
     // Muda o status para o painel ficar verde (já avisado)
     await supabase.from('diario_bordo').update({ status: 'validado' }).eq('id', presencaId);
     
     if (telefone) {
         const msg = encodeURIComponent(`Olá! Informamos que o(a) aluno(a) ${nome} concluiu a sua sessão de estudo no Centro AI e encontra-se na receção a aguardar boleia. Até já! 🚗`);
         window.open(`https://wa.me/351${telefone}?text=${msg}`, '_blank');
     }
     fetchDados();
  };

  // AÇÃO 3: SAÍDA FÍSICA (Remover da Torre de Controlo)
  const handleDarSaida = async (presencaId: string) => {
     await supabase.from('diario_bordo').update({ saida: new Date().toISOString() }).eq('id', presencaId);
     fetchDados();
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] p-8 text-white font-sans">
      
      {errorMsg && (
        <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl mb-6 text-amber-500 text-xs font-black flex items-center gap-2">
            <AlertTriangle size={16} /> {errorMsg}
        </div>
      )}

      <header className="mb-10 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black italic uppercase tracking-tighter">Torre de Controlo</h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Gestão de Performance e Alertas</p>
        </div>
        <button onClick={fetchDados} className="p-3 bg-slate-900 rounded-xl border border-slate-800 hover:text-blue-400 transition-all active:scale-95" title="Forçar Atualização">
          <RefreshCw size={20} />
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LADO ESQUERDO: QUEM ESTÁ NA SALA */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="flex items-center gap-2 text-slate-400 font-black uppercase text-xs tracking-widest">
              <Clock size={14} /> Monitorização de Sala
            </h2>
            <span className="text-[10px] text-slate-600 font-bold uppercase">Ao Vivo</span>
          </div>

          {presencas.length === 0 ? (
            <div className="bg-slate-900/40 border-2 border-dashed border-slate-800 p-20 rounded-[2.5rem] text-center">
              <p className="text-slate-600 font-black uppercase text-xs tracking-widest italic opacity-50">Aguardando check-ins...</p>
            </div>
          ) : (
            presencas.map((p) => {
              const aluno = Array.isArray(p.alunos) ? p.alunos[0] : p.alunos;
              const testesAluno = proximosTestes.filter(t => t.student_id === p.aluno_id);
              const temTesteBreve = testesAluno.length > 0;
              const alertaFoco = temTesteBreve && p.subject_name && testesAluno[0].subject_name !== p.subject_name;
              
              const jaAvisado = p.status === 'validado';

              return (
                <div key={p.id} className={`bg-slate-900 border ${jaAvisado ? 'border-emerald-500/50 shadow-emerald-900/10' : 'border-slate-800'} p-5 rounded-3xl flex items-center justify-between shadow-2xl hover:border-blue-500/50 transition-colors group`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-14 h-14 ${jaAvisado ? 'bg-emerald-600' : 'bg-blue-600'} rounded-2xl flex items-center justify-center text-xl font-black shadow-lg group-hover:scale-105 transition-transform`}>
                      {aluno?.nome?.charAt(0) || '?'}
                    </div>
                    <div>
                      <h3 className="text-lg font-black group-hover:text-blue-400 transition-colors">
                        {aluno?.nome || 'Perfil Não Encontrado'}
                      </h3>
                      <p className="text-xs text-slate-500 font-medium">
                        {p.subject_name ? `A estudar: ${p.subject_name}` : 'Sessão de Estudo'}
                        {jaAvisado && <span className="text-emerald-500 font-bold ml-2 animate-pulse">• A aguardar pais</span>}
                      </p>
                      
                      <div className="flex gap-2 mt-2">
                        {aluno && !aluno.saida_autorizada && (
                          <span className="bg-red-500/10 text-red-500 border border-red-500/20 px-2 py-1 rounded text-[10px] font-black flex items-center gap-1">
                            <ShieldAlert size={12} /> Saída Restrita
                          </span>
                        )}
                        
                        {temTesteBreve && (
                          <span className={`${alertaFoco ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'} border px-2 py-1 rounded text-[10px] font-black flex items-center gap-1`}>
                            <GraduationCap size={12} /> 
                            {alertaFoco ? `ALERTA DE FOCO: Teste de ${testesAluno[0].subject_name} em breve` : `Teste de ${testesAluno[0].subject_name} próximo`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right mr-2 hidden md:block">
                      <p className="text-[10px] font-black text-slate-600 uppercase mb-1">Entrada</p>
                      <p className="text-blue-400 font-mono font-bold text-lg">
                        {new Date(p.entrada).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    
                    {/* ILHA DE BOTÕES DE AÇÃO [cite: 2025-12-04] */}
                    <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-2xl border border-slate-800">
                        {/* 1. Botão Entrada */}
                        <button 
                          onClick={() => handleAvisarEntrada(aluno?.telefone_encarregado, aluno?.nome)}
                          className="bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white p-2.5 rounded-xl transition-all active:scale-95 flex flex-col items-center justify-center gap-1 min-w-15"
                          title="Avisar Entrada"
                        >
                           <MessageCircle size={16} />
                           <span className="text-[8px] font-black uppercase">Chegada</span>
                        </button>

                        {/* 2. Botão Saída / Aguardar */}
                        <button 
                          onClick={() => handleAvisarSaida(p.id, aluno?.telefone_encarregado, aluno?.nome)}
                          className={`${jaAvisado ? 'bg-emerald-600 text-white' : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white'} p-2.5 rounded-xl transition-all active:scale-95 flex flex-col items-center justify-center gap-1 min-w-15`}
                          title="Avisar Saída e Aguardar"
                        >
                           <MessageCircle size={16} />
                           <span className="text-[8px] font-black uppercase">{jaAvisado ? 'Avisado' : 'Fim'}</span>
                        </button>

                        <div className="w-px h-8 bg-slate-800 mx-1"></div>

                        {/* 3. Botão Saída Física */}
                        <button 
                          onClick={() => { if(confirm("Confirmar que o aluno abandonou as instalações?")) handleDarSaida(p.id) }}
                          className="bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white p-2.5 rounded-xl transition-all active:scale-95 flex flex-col items-center justify-center gap-1 min-w-15"
                          title="Remover do Dashboard"
                        >
                           <LogOut size={16} />
                           <span className="text-[8px] font-black uppercase">Porta</span>
                        </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* LADO DIREITO: MÉTRICAS E ALERTAS GLOBAIS */}
        <div className="space-y-6">
          <div className="bg-blue-600 p-8 rounded-[2.5rem] shadow-2xl shadow-blue-900/20 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:rotate-12 transition-transform">
              <Users size={80} />
            </div>
            <p className="text-blue-100 font-bold uppercase text-[10px] tracking-widest relative z-10">Total de Alunos na Sala</p>
            <h4 className="text-7xl font-black mt-2 relative z-10">{presencas.length}</h4>
          </div>
          
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] shadow-lg">
            <h4 className="font-black text-sm uppercase text-slate-500 mb-6 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> Agenda de Risco
            </h4>
            <div className="space-y-5">
              {proximosTestes.length > 0 ? (
                proximosTestes.map(ex => {
                   const alunoTeste = Array.isArray(ex.alunos) ? ex.alunos[0] : ex.alunos;
                   return (
                    <div key={ex.id} className="text-xs border-l-2 border-amber-500/50 pl-4 py-1">
                      <p className="text-white font-bold">{alunoTeste?.nome || 'Aluno'}</p>
                      <p className="text-slate-500 mt-1 uppercase text-[10px] font-black">
                        Teste de {ex.subject_name} • {new Date(ex.date).toLocaleDateString('pt-PT')}
                      </p>
                    </div>
                   )
                })
              ) : (
                <p className="text-slate-600 text-xs italic">Nenhum alerta crítico nos próximos dias.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}