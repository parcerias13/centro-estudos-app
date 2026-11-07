'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { ArrowLeft, User, Mail, Shield, Lock, KeyRound, Eye, EyeOff, Loader2, Save } from 'lucide-react';

export default function PerfilStaffPage() {
  const router = useRouter();
  const { toast, showError, showSuccess } = useStatusToast();

  const [loading, setLoading] = useState(true);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [cargo, setCargo] = useState('');

  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetirNova, setRepetirNova] = useState('');
  const [mostrarAtual, setMostrarAtual] = useState(false);
  const [mostrarNova, setMostrarNova] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }

      const { data: staff, error } = await supabase
        .from('staff')
        .select('name, email, role')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        showError('Não foi possível carregar o perfil: ' + error.message);
      } else if (staff) {
        setNome(staff.name || '');
        setEmail(staff.email || user.email || '');
        setCargo(staff.role || '');
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    if (!atual || !nova) {
      setErro('Preenche a palavra-passe atual e a nova.');
      return;
    }
    if (nova.length < 6) {
      setErro('A nova palavra-passe tem de ter pelo menos 6 caracteres.');
      return;
    }
    if (nova !== repetirNova) {
      setErro('As duas palavras-passe novas não coincidem.');
      return;
    }
    if (nova === atual) {
      setErro('A nova palavra-passe tem de ser diferente da atual.');
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch('/api/conta/alterar-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atual, nova }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(body?.error || `Erro (${res.status}). Tenta novamente.`);
        return;
      }
      showSuccess('Palavra-passe alterada com sucesso.');
      setAtual('');
      setNova('');
      setRepetirNova('');
    } catch (err: any) {
      setErro(err?.message || 'Erro de rede. Tenta novamente.');
    } finally {
      setEnviando(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" size={32} /></div>;
  }

  return (
    <main className="min-h-screen bg-page text-primary p-6 max-w-xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="bg-surface p-3 rounded-xl hover:bg-raised transition-colors border border-border">
          <ArrowLeft size={20} className="text-secondary" />
        </Link>
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Shield className="text-accent" /> O Meu Perfil
          </h1>
          <p className="text-muted text-xs font-bold uppercase tracking-widest mt-1">Dados da Conta</p>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-3xl p-8 shadow-xl space-y-6 mb-8">
        <div className="flex items-center gap-3">
          <div className="bg-accent-soft text-accent p-2.5 rounded-xl"><User size={18} /></div>
          <div>
            <p className="text-[10px] font-black uppercase text-muted tracking-widest">Nome</p>
            <p className="font-bold text-primary">{nome || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-accent-soft text-accent p-2.5 rounded-xl"><Mail size={18} /></div>
          <div>
            <p className="text-[10px] font-black uppercase text-muted tracking-widest">Email</p>
            <p className="font-bold text-primary">{email || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-accent-soft text-accent p-2.5 rounded-xl"><Shield size={18} /></div>
          <div>
            <p className="text-[10px] font-black uppercase text-muted tracking-widest">Cargo</p>
            <p className="font-bold text-primary uppercase">{cargo || '—'}</p>
          </div>
        </div>
      </div>

      <div className="bg-surface border border-border p-8 rounded-[2.5rem] shadow-xl">
        <h3 className="font-black text-sm uppercase tracking-widest mb-6 flex items-center gap-2 text-secondary">
          <Lock size={18} className="text-yellow-500" /> Alterar Palavra-Passe
        </h3>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-[10px] font-black text-muted uppercase tracking-widest ml-1">Palavra-Passe Atual</label>
            <div className="relative mt-1">
              <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
              <input
                type={mostrarAtual ? 'text' : 'password'}
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
                placeholder="A tua palavra-passe atual"
                className="w-full bg-page border border-border text-primary pl-12 pr-12 py-4 rounded-2xl outline-none focus:border-yellow-500 transition-all font-medium placeholder:text-muted"
              />
              <button
                type="button"
                onClick={() => setMostrarAtual((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors"
              >
                {mostrarAtual ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-muted uppercase tracking-widest ml-1">Nova Palavra-Passe</label>
            <div className="relative mt-1">
              <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
              <input
                type={mostrarNova ? 'text' : 'password'}
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full bg-page border border-border text-primary pl-12 pr-12 py-4 rounded-2xl outline-none focus:border-yellow-500 transition-all font-medium placeholder:text-muted"
              />
              <button
                type="button"
                onClick={() => setMostrarNova((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors"
              >
                {mostrarNova ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-muted uppercase tracking-widest ml-1">Repetir Nova Palavra-Passe</label>
            <div className="relative mt-1">
              <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
              <input
                type={mostrarNova ? 'text' : 'password'}
                value={repetirNova}
                onChange={(e) => setRepetirNova(e.target.value)}
                placeholder="Repetir a nova palavra-passe"
                className="w-full bg-page border border-border text-primary pl-12 pr-4 py-4 rounded-2xl outline-none focus:border-yellow-500 transition-all font-medium placeholder:text-muted"
              />
            </div>
          </div>

          {erro && (
            <div className="p-4 rounded-2xl text-xs font-black uppercase tracking-widest text-center border bg-danger-bg text-danger border-danger/20">
              {erro}
            </div>
          )}

          <button
            type="submit"
            disabled={enviando || !atual || !nova || !repetirNova}
            className="w-full bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-yellow-950 font-black py-4 rounded-2xl transition-all active:scale-95 shadow-lg shadow-yellow-900/20 flex items-center justify-center gap-2 mt-2"
          >
            {enviando ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
            {enviando ? 'A ATUALIZAR...' : 'GRAVAR NOVA PALAVRA-PASSE'}
          </button>
        </form>
      </div>

      <StatusToast toast={toast} />
    </main>
  );
}
