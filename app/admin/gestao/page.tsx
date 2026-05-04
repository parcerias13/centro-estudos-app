'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { 
  Building2, Mail, Save, Loader2, DollarSign, 
  Plus, Trash2, RefreshCw, ShieldAlert, Key
} from 'lucide-react';

export default function GestaoTotalPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const [centroId, setCentroId] = useState<string | null>(null);
  const [nomeCentro, setNomeCentro] = useState('');
  const [emailRemetente, setEmailRemetente] = useState('');
  const [resendKey, setResendKey] = useState('');

  const [servicos, setServicos] = useState<any[]>([]);

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
        // Busca apenas os serviços extra
        const { data: servicosRes } = await supabase.from('servicos').select('*').order('nome');
        setServicos(servicosRes || []);

        if (staffData?.centro_id) {
          setCentroId(staffData.centro_id);
          const { data: config } = await supabase.from('config_centro').select('*').eq('id', staffData.centro_id).maybeSingle();
          if (config) {
            setNomeCentro(config.nome_centro || '');
            setEmailRemetente(config.email_remetente || '');
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
      nome_centro: nomeCentro, 
      email_remetente: emailRemetente, 
      resend_api_key: resendKey
    }).eq('id', centroId);
    
    if (!error) { 
      setSuccess(true); 
      setTimeout(() => setSuccess(false), 3000); 
    }
    setSubmitting(false);
  };

  const handleCreateService = async () => {
    const nome = prompt("Nome do novo serviço (ex: Almoço, Transporte):");
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
    if (confirm(`Remover o serviço "${nome}"?`)) {
      await supabase.from('servicos').delete().eq('id', id);
      loadTudo();
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
      <Loader2 className="animate-spin text-blue-500" size={40} />
    </div>
  );

  if (isAdmin === false) return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center p-8 text-center">
      <ShieldAlert size={64} className="text-red-500 mb-4" />
      <h1 className="text-2xl font-black uppercase italic">Acesso Restrito</h1>
      <p className="text-slate-500 mt-2">Área reservada a administradores.</p>
    </div>
  );

  return (
    <main className="min-h-screen bg-[#0f172a] p-4 md:p-12 text-white font-sans">
      <header className="mb-12 flex justify-between items-end max-w-6xl mx-auto">
        <div>
          <p className="text-blue-500 font-black uppercase text-[10px] tracking-[0.3em] mb-2">Painel de Controlo</p>
          <h1 className="text-4xl font-black italic uppercase tracking-tighter">Gestão Operacional</h1>
        </div>
        <button 
          onClick={loadTudo} 
          className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 hover:text-blue-400 transition-all hover:bg-slate-800"
        >
          <RefreshCw size={20} />
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
        
        {/* BLOCO 1: INSTITUIÇÃO */}
        <section className="bg-slate-900/40 border border-slate-800/60 p-8 rounded-[2.5rem] shadow-2xl backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-500">
              <Building2 size={24} />
            </div>
            <h3 className="text-slate-200 font-black uppercase text-sm tracking-widest">Configuração do Centro</h3>
          </div>

          <form onSubmit={handleSaveCentro} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Nome da Instituição</label>
              <input 
                type="text" 
                value={nomeCentro} 
                onChange={e => setNomeCentro(e.target.value)} 
                className="w-full bg-slate-950/50 border border-slate-800 p-4 rounded-2xl font-bold text-sm focus:border-blue-500 outline-none transition-all" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Email de Suporte/Faturação</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                <input 
                  type="email" 
                  value={emailRemetente} 
                  onChange={e => setEmailRemetente(e.target.value)} 
                  className="w-full bg-slate-950/50 border border-slate-800 p-4 pl-12 rounded-2xl font-bold text-sm focus:border-blue-500 outline-none transition-all" 
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-amber-500 uppercase ml-1">Resend API Key (Automação de Emails)</label>
              <div className="relative">
                <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-500/50" size={18} />
                <input 
                  type="password" 
                  value={resendKey} 
                  onChange={e => setResendKey(e.target.value)} 
                  className="w-full bg-slate-950/50 border border-slate-800 p-4 pl-12 rounded-2xl font-mono text-xs focus:border-amber-500 outline-none transition-all" 
                />
              </div>
            </div>
            
            <button 
              type="submit" 
              disabled={submitting} 
              className={`w-full p-5 rounded-[1.5rem] font-black flex items-center justify-center gap-3 transition-all active:scale-95 ${success ? 'bg-emerald-600 shadow-lg shadow-emerald-500/20' : 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/20'}`}
            >
              {submitting ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              {success ? 'DADOS ATUALIZADOS' : 'GUARDAR ALTERAÇÕES'}
            </button>
          </form>
        </section>

        {/* BLOCO 2: SERVIÇOS EXTRA */}
        <section className="bg-slate-900/40 border border-slate-800/60 p-8 rounded-[2.5rem] shadow-2xl backdrop-blur-sm">
          <div className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-500/10 rounded-2xl text-emerald-500">
                <DollarSign size={24} />
              </div>
              <h3 className="text-slate-200 font-black uppercase text-sm tracking-widest">Tarifário de Extras</h3>
            </div>
            <button 
              onClick={handleCreateService} 
              className="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl border border-emerald-500/20 hover:bg-emerald-500 hover:text-white transition-all active:scale-90"
            >
              <Plus size={20} />
            </button>
          </div>

          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {servicos.length > 0 ? servicos.map(s => (
              <div 
                key={s.id} 
                className="bg-slate-950/40 border border-slate-800/50 p-5 rounded-3xl flex items-center justify-between group hover:border-slate-700 transition-all"
              >
                <div className="flex flex-col">
                  <span className="font-black uppercase text-[11px] text-slate-300 tracking-tight">{s.nome}</span>
                  <button 
                    onClick={() => handleDeleteService(s.id, s.nome)} 
                    className="text-[9px] text-red-500/40 font-bold uppercase mt-1 opacity-0 group-hover:opacity-100 transition-all hover:text-red-500"
                  >
                    Remover Serviço
                  </button>
                </div>
                <div className="flex items-center gap-3 bg-slate-900 p-2 px-4 rounded-2xl border border-slate-800">
                  <input 
                    type="number" 
                    defaultValue={s.preco} 
                    onBlur={(e) => updatePrecoServico(s.id, e.target.value)} 
                    className="w-16 bg-transparent text-right font-mono text-emerald-500 font-black text-lg outline-none" 
                  />
                  <span className="text-slate-600 font-black text-sm">€</span>
                </div>
              </div>
            )) : (
              <div className="text-center py-12 border-2 border-dashed border-slate-800/50 rounded-[2rem]">
                <p className="text-slate-600 font-bold uppercase text-[10px] tracking-widest">Sem serviços extra definidos</p>
              </div>
            )}
          </div>
        </section>

      </div>
    </main>
  );
}