'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { Lock, Mail, ArrowRight, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // 1. Tentar Autenticação (Verificar se a password está correta)
    const { data: { user }, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert('Erro de Acesso: ' + error.message);
      setLoading(false);
      return;
    }

    // 2. SUCESSO! Agora verificamos QUEM É (Staff vs Aluno)
    const { data: staffMember } = await supabase
      .from('staff')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (staffMember) {
      // Se encontrou na tabela staff -> Redireciona para o Backoffice
      router.push('/admin');
    } else {
      // Se não encontrou -> Assume que é Aluno
      router.push('/');
    }
    
    router.refresh();
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6 relative overflow-hidden">
      
      {/* Fundo Decorativo */}
      <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-blue-600 via-purple-600 to-pink-600"></div>
      <div className="absolute -top-20 -left-20 w-64 h-64 bg-blue-600/20 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-purple-600/20 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-sm bg-slate-900/50 backdrop-blur-md border border-slate-800 p-8 rounded-3xl shadow-2xl relative">
        
        {/* ÍCONE */}
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
            <label className="text-xs font-bold text-slate-500 uppercase ml-1">Email</label>
            <div className="relative">
              <Mail className="absolute left-4 top-3.5 text-slate-500" size={18} />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="exemplo@centro.pt"
                className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 text-white pl-12 pr-4 py-3 rounded-xl outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center px-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Password</label>
                
                {/* SOLUÇÃO BULLETPROOF: Botão em vez de Link para evitar conflitos com o Form */}
                <button 
                  type="button" 
                  onClick={(e) => {
                    e.preventDefault();
                    router.push('/recuperar');
                  }}
                  className="text-xs font-bold text-blue-500 hover:text-blue-400 hover:underline transition-colors cursor-pointer bg-transparent border-none p-0"
                >
                    Esqueci-me da password
                </button>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-950 border border-slate-800 focus:border-blue-500 text-white px-4 py-3 rounded-xl outline-none transition-all font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 mt-6 transition-all active:scale-95 shadow-lg shadow-blue-900/20"
          >
            {loading ? <Loader2 className="animate-spin" /> : <>Entrar <ArrowRight size={18} /></>}
          </button>
        </form>

        <p className="text-center mt-8 text-xs text-slate-600">
          Problemas no acesso? Contacta a Secretaria.
        </p>
      </div>
    </main>
  );
}