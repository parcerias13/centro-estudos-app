'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { Lock, Mail, ArrowRight, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      alert('Erro de Acesso: ' + authError.message);
      setLoading(false);
      return;
    }

    if (authData.user) {
      const { data: staffMember } = await supabase
        .from('staff')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      if (staffMember) {
        router.push('/admin');
      } else {
        router.push('/');
      }
      
      router.refresh();
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6 relative overflow-hidden">
      
      {/* Fundo Decorativo */}
      <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-blue-600 via-purple-600 to-pink-600"></div>
      <div className="absolute -top-20 -left-20 w-64 h-64 bg-blue-600/20 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-purple-600/20 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-sm bg-slate-900/50 backdrop-blur-md border border-slate-800 p-8 rounded-3xl shadow-2xl relative z-10">
        
        <div className="flex justify-center mb-8">
          <div className="bg-slate-800 p-4 rounded-2xl shadow-lg border border-slate-700">
            <Lock size={32} className="text-blue-500" />
          </div>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-black text-white mb-2">Acesso Reservado</h1>
          <p className="text-slate-400 text-sm">Insere as tuas credenciais para entrar.</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase ml-1 tracking-widest">Email</label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="exemplo@centro.pt"
                className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 text-white pl-12 pr-4 py-4 rounded-2xl outline-none transition-all shadow-inner"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center px-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Password</label>
                
                {/* SOLUÇÃO NUCLEAR: Usar uma tag 'a' nativa para forçar a navegação real */}
                <a href="/recuperar" className="text-xs font-bold text-blue-500 hover:text-blue-400 hover:underline transition-colors">
                    Esqueci-me da password
                </a>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 text-white px-4 py-4 rounded-2xl outline-none transition-all font-mono shadow-inner"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 mt-6 transition-all active:scale-95 shadow-lg shadow-blue-900/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" /> : <>ENTRAR <ArrowRight size={18} /></>}
          </button>
        </form>

        <p className="text-center mt-8 text-xs text-slate-600 font-bold uppercase tracking-widest">
          Problemas no acesso? Contacta a Secretaria.
        </p>
      </div>
    </main>
  );
}