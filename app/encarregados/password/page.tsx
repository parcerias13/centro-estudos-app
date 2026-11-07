'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { isUnlocked, touch, subscribe } from '@/lib/encarregadoUnlock';
import { ArrowLeft, Lock, KeyRound, Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react';

export default function AlterarPasswordEncarregadoPage() {
  const router = useRouter();
  const { toast, showError, showSuccess } = useStatusToast();

  const [loading, setLoading] = useState(true);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetirNova, setRepetirNova] = useState('');
  const [mostrarAtual, setMostrarAtual] = useState(false);
  const [mostrarNova, setMostrarNova] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/login'); return; }
      // Mesmo padrão das outras páginas da área: sem desbloqueio, volta ao
      // ecrã do código — nunca mostra este formulário sem isUnlocked().
      if (!isUnlocked(user.id)) { router.replace('/encarregados'); return; }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Avisado por lock() (inatividade, logout, ou Bloquear noutra página) —
  // volta ao ecrã do código, tal como a página de alterar código.
  useEffect(() => {
    const cancelar = subscribe(() => { router.replace('/encarregados'); });
    return cancelar;
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
    touch();
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
      setSucesso(true);
      setAtual('');
      setNova('');
      setRepetirNova('');
      showSuccess('Palavra-passe alterada com sucesso.');
    } catch (err: any) {
      setErro(err?.message || 'Erro de rede. Tenta novamente.');
    } finally {
      setEnviando(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  return (
    <main className="min-h-screen bg-page text-primary p-6 max-w-md mx-auto space-y-8 pb-20">
      <Link href="/encarregados" className="flex items-center gap-2 text-muted hover:text-primary transition-colors">
        <ArrowLeft size={20} /> <span className="font-bold">Voltar</span>
      </Link>

      <div>
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Lock className="text-accent" /> Alterar Palavra-Passe
        </h1>
        <p className="text-secondary text-xs font-bold uppercase tracking-widest mt-1">Área dos Encarregados</p>
      </div>

      <p className="text-xs font-bold text-warning bg-warning-bg border border-warning/20 rounded-2xl px-4 py-3">
        Esta palavra-passe também é a do seu educando: se a mudar, diga-lhe a nova.
      </p>

      <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-3xl p-6 shadow-xl space-y-4">
        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase text-muted ml-1">Palavra-Passe Atual</label>
          <div className="relative">
            <input
              type={mostrarAtual ? 'text' : 'password'}
              value={atual}
              onChange={(e) => setAtual(e.target.value)}
              disabled={enviando}
              placeholder="A palavra-passe atual"
              className="w-full bg-page border border-border text-primary p-4 pr-12 rounded-xl outline-none focus:border-accent transition-all disabled:opacity-50"
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

        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase text-muted ml-1">Nova Palavra-Passe</label>
          <div className="relative">
            <input
              type={mostrarNova ? 'text' : 'password'}
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              disabled={enviando}
              placeholder="Mínimo 6 caracteres"
              className="w-full bg-page border border-border text-primary p-4 pr-12 rounded-xl outline-none focus:border-accent transition-all disabled:opacity-50"
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

        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase text-muted ml-1">Repetir Nova Palavra-Passe</label>
          <input
            type={mostrarNova ? 'text' : 'password'}
            value={repetirNova}
            onChange={(e) => setRepetirNova(e.target.value)}
            disabled={enviando}
            placeholder="Repetir a nova palavra-passe"
            className="w-full bg-page border border-border text-primary p-4 rounded-xl outline-none focus:border-accent transition-all disabled:opacity-50"
          />
        </div>

        {erro && <p className="text-danger text-xs font-bold text-center">{erro}</p>}
        {sucesso && (
          <p className="text-success text-xs font-bold text-center flex items-center justify-center gap-1.5">
            <CheckCircle2 size={14} /> Palavra-passe alterada.
          </p>
        )}

        <button
          type="submit"
          disabled={enviando || !atual || !nova || !repetirNova}
          className="w-full bg-accent hover:bg-accent-hover text-on-accent p-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
        >
          {enviando ? <Loader2 className="animate-spin" size={18} /> : <KeyRound size={18} />}
          Guardar Nova Palavra-Passe
        </button>
      </form>

      <StatusToast toast={toast} />
    </main>
  );
}
