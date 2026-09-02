'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Building2, Mail, Save, Loader2, DollarSign, 
  Plus, Trash2, RefreshCw, ShieldAlert, Key
} from 'lucide-react';

export default function GestaoTotalPage() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const [nomeCentro, setNomeCentro] = useState('');
  const [emailRemetente, setEmailRemetente] = useState('');
  const [resendKey, setResendKey] = useState('');

  const [servicos, setServicos] = useState<any[]>([]);

  const [showNovoServico, setShowNovoServico] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoPreco, setNovoPreco] = useState('');
  const [criarError, setCriarError] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const loadTudo = useCallback(async () => {
    try {
      setLoading(true);
      await supabase.auth.refreshSession();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return setIsAdmin(false);

      const configRes = await fetch('/api/config-centro');
      const adminStatus = configRes.ok;
      setIsAdmin(adminStatus);

      if (adminStatus) {
        // Busca apenas os serviços extra
        const { data: servicosRes } = await supabase.from('servicos').select('*').order('nome');
        setServicos(servicosRes || []);

        const config = await configRes.json();
        setNomeCentro(config.nome_centro || '');
        setEmailRemetente(config.email_remetente || '');
        setResendKey(config.resend_api_key || '');
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
    setSaveError(null);
    setSubmitting(true);
    const res = await fetch('/api/config-centro', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome_centro: nomeCentro, email_remetente: emailRemetente, resend_api_key: resendKey }),
    });

    if (res.ok) {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } else {
      const body = await res.json().catch(() => ({}));
      setSaveError(body?.error || `Erro ao guardar (${res.status}). Tenta novamente.`);
    }
    setSubmitting(false);
  };

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    setCriarError(null);

    const precoNum = parseFloat(novoPreco);
    if (!novoNome.trim()) return setCriarError('O nome é obrigatório.');
    if (isNaN(precoNum) || precoNum < 0) return setCriarError('Preço inválido.');

    setCriando(true);
    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;
    if (!centro_id) {
      setCriarError('Não foi possível obter o centro. Recarrega a página.');
      setCriando(false);
      return;
    }

    const { error } = await supabase.from('servicos').insert({ nome: novoNome.trim(), preco: precoNum, centro_id });
    if (error) {
      setCriarError(error.message);
    } else {
      setNovoNome('');
      setNovoPreco('');
      setShowNovoServico(false);
      loadTudo();
    }
    setCriando(false);
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
    <div className="min-h-screen bg-page flex items-center justify-center">
      <Loader2 className="animate-spin text-accent" size={40} />
    </div>
  );

  if (isAdmin === false) return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center p-8 text-center">
      <ShieldAlert size={64} className="text-danger mb-4" />
      <h1 className="text-2xl font-black uppercase italic">Acesso Restrito</h1>
      <p className="text-muted mt-2">Área reservada a administradores.</p>
    </div>
  );

  return (
    <main className="min-h-screen bg-page p-4 md:p-12 text-primary font-sans">
      <header className="mb-12 flex justify-between items-end max-w-6xl mx-auto">
        <div>
          <p className="text-accent font-black uppercase text-[10px] tracking-[0.3em] mb-2">Painel de Controlo</p>
          <h1 className="text-4xl font-black italic uppercase tracking-tighter">Gestão Operacional</h1>
        </div>
        <button 
          onClick={loadTudo} 
          className="p-4 bg-surface/50 rounded-2xl border border-border hover:text-accent transition-all hover:bg-raised"
        >
          <RefreshCw size={20} />
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
        
        {/* BLOCO 1: INSTITUIÇÃO */}
        <section className="bg-surface/40 border border-border/60 p-8 rounded-[2.5rem] shadow-2xl backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-3 bg-accent-soft rounded-2xl text-accent">
              <Building2 size={24} />
            </div>
            <h3 className="text-primary font-black uppercase text-sm tracking-widest">Configuração do Centro</h3>
          </div>

          <form onSubmit={handleSaveCentro} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase ml-1">Nome da Instituição</label>
              <input 
                type="text" 
                value={nomeCentro} 
                onChange={e => setNomeCentro(e.target.value)} 
                className="w-full bg-page/50 border border-border p-4 rounded-2xl font-bold text-sm focus:border-accent outline-none transition-all" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase ml-1">Email de Suporte/Faturação</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                <input 
                  type="email" 
                  value={emailRemetente} 
                  onChange={e => setEmailRemetente(e.target.value)} 
                  className="w-full bg-page/50 border border-border p-4 pl-12 rounded-2xl font-bold text-sm focus:border-accent outline-none transition-all" 
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-warning uppercase ml-1">Resend API Key (Automação de Emails)</label>
              <div className="relative">
                <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-warning/50" size={18} />
                <input 
                  type="password" 
                  value={resendKey} 
                  onChange={e => setResendKey(e.target.value)} 
                  className="w-full bg-page/50 border border-border p-4 pl-12 rounded-2xl font-mono text-xs focus:border-warning outline-none transition-all" 
                />
              </div>
            </div>
            
            <button 
              type="submit" 
              disabled={submitting} 
              className={`w-full p-5 rounded-[1.5rem] font-black flex items-center justify-center gap-3 transition-all active:scale-95 ${success ? 'bg-success text-on-success shadow-lg shadow-success/20' : 'bg-accent hover:bg-accent-hover text-on-accent shadow-lg shadow-accent/20'}`}
            >
              {submitting ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              {success ? 'DADOS ATUALIZADOS' : 'GUARDAR ALTERAÇÕES'}
            </button>
            {saveError && (
              <p className="text-danger text-[11px] font-bold px-1 pt-2">{saveError}</p>
            )}
          </form>
        </section>

        {/* BLOCO 2: SERVIÇOS EXTRA */}
        <section className="bg-surface/40 border border-border/60 p-8 rounded-[2.5rem] shadow-2xl backdrop-blur-sm">
          <div className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-success-bg rounded-2xl text-success">
                <DollarSign size={24} />
              </div>
              <h3 className="text-primary font-black uppercase text-sm tracking-widest">Tarifário de Extras</h3>
            </div>
            <button
              onClick={() => { setShowNovoServico(v => !v); setCriarError(null); }}
              className={`p-2 rounded-xl border transition-all active:scale-90 ${showNovoServico ? 'bg-border text-primary border-border' : 'bg-success-bg text-success border-success/20 hover:bg-success hover:text-on-success'}`}
            >
              <Plus size={20} />
            </button>
          </div>

          {showNovoServico && (
            <form onSubmit={handleCreateService} className="mb-6 bg-page/50 border border-border rounded-3xl p-5 space-y-4">
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-[9px] font-black text-muted uppercase ml-1">Nome</label>
                  <input
                    type="text"
                    value={novoNome}
                    onChange={e => setNovoNome(e.target.value)}
                    placeholder="ex: Almoço, Transporte"
                    className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-success outline-none transition-all"
                    autoFocus
                  />
                </div>
                <div className="w-28 space-y-1">
                  <label className="text-[9px] font-black text-muted uppercase ml-1">Preço (€)</label>
                  <input
                    type="number"
                    value={novoPreco}
                    onChange={e => setNovoPreco(e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-mono font-black text-success focus:border-success outline-none transition-all"
                  />
                </div>
              </div>
              {criarError && (
                <p className="text-danger text-[11px] font-bold px-1">{criarError}</p>
              )}
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={criando}
                  className="flex-1 py-3 bg-success hover:bg-success-hover text-on-success rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                >
                  {criando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Criar Serviço
                </button>
                <button
                  type="button"
                  onClick={() => { setShowNovoServico(false); setCriarError(null); setNovoNome(''); setNovoPreco(''); }}
                  className="px-5 py-3 bg-raised hover:bg-border rounded-2xl font-black text-sm transition-all active:scale-95"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {servicos.length > 0 ? servicos.map(s => (
              <div 
                key={s.id} 
                className="bg-page/40 border border-border/50 p-5 rounded-3xl flex items-center justify-between group hover:border-border transition-all"
              >
                <div className="flex flex-col">
                  <span className="font-black uppercase text-[11px] text-secondary tracking-tight">{s.nome}</span>
                  <button 
                    onClick={() => handleDeleteService(s.id, s.nome)} 
                    className="text-[9px] text-danger/40 font-bold uppercase mt-1 opacity-0 group-hover:opacity-100 transition-all hover:text-danger"
                  >
                    Remover Serviço
                  </button>
                </div>
                <div className="flex items-center gap-3 bg-surface p-2 px-4 rounded-2xl border border-border">
                  <input 
                    type="number" 
                    defaultValue={s.preco} 
                    onBlur={(e) => updatePrecoServico(s.id, e.target.value)} 
                    className="w-16 bg-transparent text-right font-mono text-success font-black text-lg outline-none" 
                  />
                  <span className="text-muted font-black text-sm">€</span>
                </div>
              </div>
            )) : (
              <div className="text-center py-12 border-2 border-dashed border-border/50 rounded-[2rem]">
                <p className="text-muted font-bold uppercase text-[10px] tracking-widest">Sem serviços extra definidos</p>
              </div>
            )}
          </div>
        </section>

      </div>
    </main>
  );
}