'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { ArrowLeft, Mail, Loader2, CheckCircle, KeyRound } from 'lucide-react';

export default function RecoverPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Cliente SSR standard
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/perfil`,
    });

    if (error) {
      setErrorMsg('Erro: ' + error.message);
      setLoading(false);
    } else {
      setSuccess(true);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6 relative overflow-hidden">
      
      {/* Fundo Decorativo Igual ao Login */}
      <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-blue-600 via-purple-600 to-pink-600"></div>
      <div className="absolute -top-20 -left-20 w-64 h-64 bg-blue-600/20 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-sm bg-slate-900/50 backdrop-blur-md border border-slate-800 p-8 rounded-3xl shadow-2xl relative z-10">
        
        <Link href="/login" className="text-slate-500 hover:text-white flex items-center gap-2 mb-6 text-sm font-bold transition-colors w-fit">
          <ArrowLeft size={16} /> Voltar ao Login
        </Link>

        {success ? (
          <div className="text-center py-8">
            <div className="bg-emerald-500/10 text-emerald-500 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
              <CheckCircle size={32} />
            </div>
            <h1 className="text-2xl font-black mb-2">Email Enviado!</h1>
            <p className="text-slate-400 text-sm">
              Verifica a tua caixa de correio ({email}).<br/>
              Clica no link para entrares e criares uma nova password.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <div className="w-12 h-12 bg-yellow-500/10 text-yellow-500 rounded-xl flex items-center justify-center mb-4 border border-yellow-500/20 shadow-[0_0_15px_rgba(234,179,8,0.2)]">
                <KeyRound size={24} />
              </div>
              <h1 className="text-2xl font-black text-white mb-2">Recuperar Conta</h1>
              <p className="text-slate-400 text-sm">Insere o teu email para receberes um link de acesso de emergência.</p>
            </div>

            <form onSubmit={handleRecover} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase ml-1 tracking-widest">Email do Aluno</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="aluno@exemplo.pt"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-yellow-500 text-white pl-12 pr-4 py-4 rounded-2xl outline-none transition-all shadow-inner"
                  />
                </div>
              </div>

              {errorMsg && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-xs p-4 rounded-xl text-center font-bold">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white hover:bg-slate-200 text-slate-900 font-black py-4 rounded-2xl flex items-center justify-center gap-2 mt-6 transition-all active:scale-95 disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" /> : 'ENVIAR LINK DE RECUPERAÇÃO'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}