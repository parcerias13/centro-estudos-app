'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, Key, Mail, Building2, CheckCircle2, Phone } from 'lucide-react';

export default function ConfiguracoesCentro() {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  
  // Estados para os campos do formulário
  const [centroId, setCentroId] = useState<string | null>(null);
  const [nomeCentro, setNomeCentro] = useState('');
  const [emailRemetente, setEmailRemetente] = useState('');
  const [telefoneCentro, setTelefoneCentro] = useState('');
  const [resendKey, setResendKey] = useState('');

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const loadConfigs = useCallback(async () => {
    try {
      // 1. Obter o utilizador logado no Auth
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        console.error("Erro ao obter utilizador Auth:", authError);
        return;
      }

      console.log("ID do utilizador logado (Auth):", user.id);

      // 2. Obter a linha correspondente na tabela 'staff'
      const { data: staffData, error: staffError } = await supabase
        .from('staff')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      console.log("Dados encontrados na tabela staff:", staffData);

      if (staffError) {
        console.error("Erro ao ler tabela staff:", staffError);
        return;
      }

      // 3. Se tivermos o centro_id, carregamos as definições do centro
      if (staffData && staffData.centro_id) {
        setCentroId(staffData.centro_id);
        
        const { data: config, error: configError } = await supabase
          .from('config_centro')
          .select('*')
          .eq('id', staffData.centro_id)
          .maybeSingle();

        if (configError) {
          console.error("Erro ao ler config_centro:", configError);
        }

        if (config) {
          setNomeCentro(config.nome_centro || '');
          setEmailRemetente(config.email_remetente || '');
          setTelefoneCentro(config.telefone_centro || '');
          setResendKey(config.resend_api_key || '');
        }
      } else {
        console.warn("Aviso: Utilizador logado não tem um centro_id associado na tabela staff.");
      }
    } catch (error) {
      console.error("Erro inesperado no loadConfigs:", error);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    console.log("Botão clicado. ID do Centro atual:", centroId);

    if (!centroId) {
      alert("ERRO: O teu utilizador não está ligado a nenhum centro na tabela 'staff'.");
      return;
    }
    
    setSubmitting(true);
    setSuccess(false);

    try {
      const { error } = await supabase
        .from('config_centro')
        .update({
          nome_centro: nomeCentro,
          email_remetente: emailRemetente,
          telefone_centro: telefoneCentro,
          resend_api_key: resendKey
        })
        .eq('id', centroId);

      if (error) throw error;
      
      setSuccess(true);
      console.log("Alterações gravadas com sucesso para o centro:", centroId);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error: any) {
      console.error("Erro ao gravar na base de dados:", error);
      alert("Erro ao gravar: " + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f172a] p-4 md:p-8 text-white font-sans">
      <header className="mb-10 max-w-2xl mx-auto">
        <Link href="/admin" className="inline-flex items-center gap-2 text-slate-500 hover:text-white transition-colors mb-6 text-sm font-bold uppercase tracking-widest">
          <ArrowLeft size={16} /> Voltar ao Painel
        </Link>
        <h1 className="text-3xl font-black italic uppercase tracking-tighter">Configurações do Centro</h1>
        <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-2">Gere a tua infraestrutura de comunicação</p>
      </header>

      <div className="max-w-2xl mx-auto">
        <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] shadow-2xl space-y-6">
          
          {/* NOME DO CENTRO */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Building2 size={12} /> Nome da Instituição
            </label>
            <input 
              type="text"
              value={nomeCentro}
              onChange={(e) => setNomeCentro(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 p-4 rounded-2xl outline-none focus:border-blue-500 transition-all font-bold text-white"
              placeholder="Ex: Centro de Estudos AI"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* EMAIL REMETENTE */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Mail size={12} /> Email de Envio
              </label>
              <input 
                type="email"
                value={emailRemetente}
                onChange={(e) => setEmailRemetente(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 p-4 rounded-2xl outline-none focus:border-blue-500 transition-all font-bold text-white"
                placeholder="exemplo@centro.pt"
                required
              />
            </div>

            {/* TELEFONE OFICIAL */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Phone size={12} /> Telefone Oficial
              </label>
              <input 
                type="text"
                value={telefoneCentro}
                onChange={(e) => setTelefoneCentro(e.target.value)}
                placeholder="Ex: 912345678"
                className="w-full bg-slate-950 border border-slate-800 p-4 rounded-2xl outline-none focus:border-blue-500 transition-all font-bold text-white"
              />
            </div>
          </div>

          {/* RESEND API KEY */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-amber-500 uppercase tracking-widest flex items-center gap-2">
              <Key size={12} /> Resend API Key
            </label>
            <input 
              type="password"
              value={resendKey}
              onChange={(e) => setResendKey(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 p-4 rounded-2xl outline-none focus:border-amber-500 transition-all font-mono text-sm"
              placeholder="re_123456789..."
            />
            <p className="text-[9px] text-slate-600 italic px-1">Garante que esta chave tem permissão de "Sending".</p>
          </div>

          {/* BOTÃO SUBMIT */}
          <button 
            type="submit"
            disabled={submitting}
            className={`w-full p-5 rounded-2xl font-black flex items-center justify-center gap-3 transition-all active:scale-[0.98] mt-4 shadow-xl ${
              success ? 'bg-emerald-600' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/20'
            }`}
          >
            {submitting ? (
              <Loader2 className="animate-spin" />
            ) : success ? (
              <>
                <CheckCircle2 size={20} /> CONFIGURAÇÕES GRAVADAS
              </>
            ) : (
              <>
                <Save size={20} /> GUARDAR ALTERAÇÕES
              </>
            )}
          </button>
        </form>

        <div className="mt-8 p-6 border-2 border-dashed border-slate-800 rounded-4xl opacity-30">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 italic">Developer Debug Mode Active</h4>
          <p className="text-[9px]">Abre a consola do browser (F12) para validar a sincronização dos IDs de utilizador e centro.</p>
        </div>
      </div>
    </main>
  );
}