'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { 
  Building2, Mail, Phone, Key, Save, Loader2, CheckCircle2, 
  DollarSign, Package, ShieldAlert, Plus, Trash2, RefreshCw, Layers 
} from 'lucide-react';

export default function GestaoTotalPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const [centroId, setCentroId] = useState<string | null>(null);
  const [nomeCentro, setNomeCentro] = useState('');
  const [emailRemetente, setEmailRemetente] = useState('');
  const [telefoneCentro, setTelefoneCentro] = useState('');
  const [resendKey, setResendKey] = useState('');

  const [servicos, setServicos] = useState<any[]>([]);
  const [pacotes, setPacotes] = useState<any[]>([]);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const loadTudo = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return setIsAdmin(false);

      const { data: staffData } = await supabase.from('staff').select('role, centro_id').eq('id', user.id).single();
      const adminStatus = staffData?.role?.toLowerCase() === 'admin';
      setIsAdmin(adminStatus);

      if (adminStatus) {
        const [servicosRes, pacotesRes] = await Promise.all([
          supabase.from('servicos').select('*').order('nome'),
          supabase.from('pacotes').select('*, pacote_escaloes(*)').order('preco_mensal')
        ]);
        setServicos(servicosRes.data || []);
        setPacotes(pacotesRes.data || []);

        if (staffData?.centro_id) {
          setCentroId(staffData.centro_id);
          const { data: config } = await supabase.from('config_centro').select('*').eq('id', staffData.centro_id).maybeSingle();
          if (config) {
            setNomeCentro(config.nome_centro || '');
            setEmailRemetente(config.email_remetente || '');
            setTelefoneCentro(config.telefone_centro || '');
            setResendKey(config.resend_api_key || '');
          }
        }
      }
    } catch (error) {
      console.error("Erro no load:", error);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { loadTudo(); }, [loadTudo]);

  const handleSaveCentro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centroId) return;
    setSubmitting(true);
    const { error } = await supabase.from('config_centro').update({
      nome_centro: nomeCentro, email_remetente: emailRemetente, telefone_centro: telefoneCentro, resend_api_key: resendKey
    }).eq('id', centroId);
    if (!error) { setSuccess(true); setTimeout(() => setSuccess(false), 3000); }
    setSubmitting(false);
  };

  const handleCreateService = async () => {
    const nome = prompt("Nome do novo serviço (ex: Transporte, Cópias, Seguro):");
    const preco = prompt("Preço base (€):");
    if (nome && preco) {
      const { error } = await supabase.from('servicos').insert({ nome, preco: parseFloat(preco) });
      if (error) alert(error.message);
      loadTudo();
    }
  };

  const updatePrecoServico = async (id: string, preco: string) => {
    const valor = parseFloat(preco);
    if (isNaN(valor)) return;
    await supabase.from('servicos').update({ preco: valor }).eq('id', id);
    setServicos(prev => prev.map(s => s.id === id ? {...s, preco: valor} : s));
  };

  const handleDeleteService = async (id: string, nome: string) => {
    if (confirm(`Remover o serviço "${nome}"? Isto não afetará consumos antigos.`)) {
      await supabase.from('servicos').delete().eq('id', id);
      loadTudo();
    }
  };

  // --- LOGICA DE CRIAÇÃO INTELIGENTE DE PACOTES ---
  const handleCreatePackage = async () => {
    const nome = prompt("Nome do pacote (ex: 1x por semana):");
    const sessoesSemana = prompt("Sessões semanais previstas:");
    const precoMensal = prompt("Preço total mensal desejado (€):");

    if (nome && sessoesSemana && precoMensal) {
      const sNum = parseInt(sessoesSemana);
      const pNum = parseFloat(precoMensal);
      const sessoesNoMes = sNum * 4;
      const precoPorSessao = parseFloat((pNum / sessoesNoMes).toFixed(2));

      // 1. Inserir o Pacote
      const { data: newPkg, error: pErr } = await supabase.from('pacotes').insert({
        nome, sessoes_semanais: sNum, preco_mensal: pNum, centro_id: centroId
      }).select().single();

      if (pErr) return alert(pErr.message);

      // 2. Calcular o ponto de partida do escalão (min_sessoes)
      const { data: lastEsc } = await supabase.from('pacote_escaloes').select('max_sessoes').order('max_sessoes', { ascending: false }).limit(1).maybeSingle();
      const minS = lastEsc ? lastEsc.max_sessoes + 1 : 1;

      // 3. Criar escalão automático baseado na matemática de gestão
      await supabase.from('pacote_escaloes').insert({
        pacote_id: newPkg.id,
        min_sessoes: minS,
        max_sessoes: sessoesNoMes,
        preco_sessao: precoPorSessao
      });

      loadTudo();
    }
  };

  const handleDeletePackage = async (id: string) => {
    if (confirm("Eliminar este pacote?")) {
      await supabase.from('pacotes').delete().eq('id', id);
      loadTudo();
    }
  };

  const handleCreateEscalao = async (pacoteId: string) => {
    const min = prompt("Mínimo de sessões:");
    const max = prompt("Máximo de sessões:");
    const preco = prompt("Preço por sessão (€):");
    if (min && max && preco) {
      await supabase.from('pacote_escaloes').insert({
        pacote_id: pacoteId,
        min_sessoes: parseInt(min),
        max_sessoes: parseInt(max),
        preco_sessao: parseFloat(preco)
      });
      loadTudo();
    }
  };

  const handleDeleteEscalao = async (id: string) => {
    if (confirm("Remover este escalão de preço?")) {
      await supabase.from('pacote_escaloes').delete().eq('id', id);
      loadTudo();
    }
  };

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  if (isAdmin === false) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center p-8 text-center">
        <ShieldAlert size={64} className="text-red-500 mb-4" />
        <h1 className="text-2xl font-black uppercase italic">Acesso Restrito</h1>
        <p className="text-slate-500 mt-2">Área administrativa.</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f172a] p-4 md:p-8 text-white font-sans">
      <header className="mb-10 flex justify-between items-center max-w-7xl mx-auto">
        <div>
          <h1 className="text-3xl font-black italic uppercase tracking-tighter text-white">Gestão do Centro</h1>
          <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Infraestrutura, Tarifários e Automação Financeira</p>
        </div>
        <button onClick={loadTudo} className="p-3 bg-slate-900 rounded-xl border border-slate-800 hover:text-blue-400 transition-all">
          <RefreshCw size={20} />
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 max-w-7xl mx-auto">
        
        {/* COLUNA 1: DEFINIÇÕES DO CENTRO */}
        <div className="lg:col-span-4">
          <form onSubmit={handleSaveCentro} className="bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-2xl space-y-6 h-fit">
            <h3 className="text-slate-400 font-black uppercase text-xs tracking-widest mb-2 flex items-center gap-2">
              <Building2 size={14} /> Instituição
            </h3>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-2">Nome</label>
              <input type="text" value={nomeCentro} onChange={e => setNomeCentro(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-2xl font-bold text-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase flex items-center gap-2">Email</label>
              <input type="email" value={emailRemetente} onChange={e => setEmailRemetente(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-2xl font-bold text-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-amber-500 uppercase flex items-center gap-2">Resend Key</label>
              <input type="password" value={resendKey} onChange={e => setResendKey(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-2xl font-mono text-xs" />
            </div>
            <button type="submit" disabled={submitting} className={`w-full p-5 rounded-2xl font-black flex items-center justify-center gap-3 transition-all ${success ? 'bg-emerald-600' : 'bg-blue-600 hover:bg-blue-500'}`}>
              {submitting ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              {success ? 'DADOS GUARDADOS' : 'GUARDAR ALTERAÇÕES'}
            </button>
          </form>
        </div>

        {/* COLUNA 2: TARIFÁRIO DE SERVIÇOS */}
        <div className="lg:col-span-4">
          <section className="bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-2xl h-fit">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-slate-400 font-black uppercase text-xs tracking-widest flex items-center gap-2">
                <DollarSign size={14} className="text-emerald-500" /> Tarifário de Serviços
              </h3>
              <button onClick={handleCreateService} className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl border border-emerald-500/20 hover:bg-emerald-500 hover:text-white transition-all">
                <Plus size={18} />
              </button>
            </div>
            <div className="space-y-4 max-h-125 overflow-y-auto pr-2 custom-scrollbar">
              {servicos.map(s => (
                <div key={s.id} className="bg-slate-950 border border-slate-800 p-4 rounded-3xl flex items-center justify-between group">
                  <div className="flex flex-col">
                    <span className="font-black uppercase text-[10px] text-slate-300 tracking-tighter">{s.nome}</span>
                    <button onClick={() => handleDeleteService(s.id, s.nome)} className="text-[9px] text-red-500/50 font-bold uppercase mt-1 opacity-0 group-hover:opacity-100 transition-all hover:text-red-500">Remover</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" defaultValue={s.preco} onBlur={(e) => updatePrecoServico(s.id, e.target.value)} className="w-16 bg-slate-900 border border-slate-800 p-2 rounded-xl text-right font-mono text-emerald-500 font-black" />
                    <span className="text-slate-500 font-bold text-xs">€</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* COLUNA 3: PACOTES E ESCALÕES AUTOMATIZADOS */}
        <div className="lg:col-span-4">
          <section className="bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-2xl h-fit">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-slate-400 font-black uppercase text-xs tracking-widest flex items-center gap-2">
                <Package size={14} className="text-purple-500" /> Pacotes & Escalões
              </h3>
              <button onClick={handleCreatePackage} className="p-2 bg-purple-500/10 text-purple-500 rounded-xl border border-purple-500/20 hover:bg-purple-500 hover:text-white transition-all">
                <Plus size={18} />
              </button>
            </div>
            <div className="space-y-6">
              {pacotes.map(p => (
                <div key={p.id} className="bg-slate-950 border border-slate-800 p-5 rounded-4xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                    <div>
                      <p className="font-black uppercase text-xs text-white">{p.nome}</p>
                      <p className="text-[9px] text-slate-600 font-bold uppercase tracking-tighter">{p.preco_mensal}€ base ({p.sessoes_semanais}x / semana)</p>
                    </div>
                    <button onClick={() => handleDeletePackage(p.id)} className="text-slate-800 hover:text-red-500 p-2">
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center px-1">
                      <p className="text-[8px] font-black text-slate-500 uppercase tracking-[0.2em]">Escalões de Preço Reais</p>
                      <button onClick={() => handleCreateEscalao(p.id)} className="text-blue-500 hover:text-blue-400 transition-all"><Plus size={12} /></button>
                    </div>
                    {p.pacote_escaloes?.map((esc: any) => (
                      <div key={esc.id} className="bg-slate-900/50 border border-slate-800/50 p-3 rounded-2xl flex items-center justify-between group">
                        <div className="flex items-center gap-2">
                          <Layers size={10} className="text-slate-600" />
                          <span className="text-[10px] font-bold text-slate-300">{esc.min_sessoes}–{esc.max_sessoes} sessões</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-black text-emerald-500 text-[10px]">{esc.preco_sessao}€ / dia</span>
                          <button onClick={() => handleDeleteEscalao(esc.id)} className="opacity-0 group-hover:opacity-100 text-red-500/50 hover:text-red-500 transition-all">
                            <XCircleIcon size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

      </div>
    </main>
  );
}

function XCircleIcon({ size, className = "" }: { size: number, className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />
    </svg>
  );
}