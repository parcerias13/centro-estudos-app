'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { isUnlocked, touch, subscribe } from '@/lib/encarregadoUnlock';
import { ArrowLeft, KeyRound, Loader2, CheckCircle2 } from 'lucide-react';

export default function AlterarCodigoPage() {
  const router = useRouter();
  const { toast, showError, showSuccess } = useStatusToast();

  const [loading, setLoading] = useState(true);
  const [atual, setAtual] = useState('');
  const [novo, setNovo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [bloqueadoAte, setBloqueadoAte] = useState<string | null>(null);
  const [tentativasRestantes, setTentativasRestantes] = useState<number | null>(null);
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
  // não há dados de aluno para limpar aqui, só sair do ecrã.
  useEffect(() => {
    const cancelar = subscribe(() => { router.replace('/encarregados'); });
    return cancelar;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // bloqueadoAte não deve deixar os campos disabled para sempre.
  useEffect(() => {
    if (!bloqueadoAte) return;
    const restante = new Date(bloqueadoAte).getTime() - Date.now();
    if (restante <= 0) {
      setBloqueadoAte(null);
      setErro(null);
      return;
    }
    const timer = setTimeout(() => {
      setBloqueadoAte(null);
      setErro(null);
    }, restante);
    return () => clearTimeout(timer);
  }, [bloqueadoAte]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(atual) || !/^\d{4}$/.test(novo)) {
      setErro('Os dois códigos têm de ter exatamente 4 dígitos.');
      return;
    }

    setEnviando(true);
    setErro(null);
    const { data, error } = await supabase.rpc('alterar_codigo_encarregado', { p_atual: atual, p_novo: novo });
    setEnviando(false);
    touch();

    if (error) {
      showError('Erro ao alterar o código: ' + error.message);
      return;
    }

    if (data?.ok) {
      setSucesso(true);
      setAtual('');
      setNovo('');
      setBloqueadoAte(null);
      setTentativasRestantes(null);
      showSuccess('Código alterado com sucesso.');
      return;
    }

    if (data?.erro === 'formato_invalido') {
      setErro('O novo código tem de ter exatamente 4 dígitos.');
      return;
    }

    setAtual('');
    setBloqueadoAte(data?.bloqueado_ate ?? null);
    setTentativasRestantes(data?.tentativas_restantes ?? null);
    setErro(data?.bloqueado_ate ? 'Demasiadas tentativas erradas.' : 'Código atual incorreto.');
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
          <KeyRound className="text-accent" /> Alterar Código
        </h1>
        <p className="text-secondary text-xs font-bold uppercase tracking-widest mt-1">Área dos Encarregados</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-3xl p-6 shadow-xl space-y-4">
        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase text-muted ml-1">Código Atual</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={atual}
            onChange={(e) => setAtual(e.target.value.replace(/\D/g, ''))}
            disabled={enviando || !!bloqueadoAte}
            placeholder="····"
            className="w-full bg-page border border-border text-center text-2xl font-black tracking-[0.4em] p-4 rounded-xl outline-none focus:border-accent transition-all disabled:opacity-50"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase text-muted ml-1">Código Novo</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={novo}
            onChange={(e) => setNovo(e.target.value.replace(/\D/g, ''))}
            disabled={enviando || !!bloqueadoAte}
            placeholder="····"
            className="w-full bg-page border border-border text-center text-2xl font-black tracking-[0.4em] p-4 rounded-xl outline-none focus:border-accent transition-all disabled:opacity-50"
          />
        </div>

        {erro && <p className="text-danger text-xs font-bold text-center">{erro}</p>}
        {bloqueadoAte && (
          <p className="text-danger text-xs font-bold text-center">
            Tenta de novo depois das {new Date(bloqueadoAte).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}.
          </p>
        )}
        {!bloqueadoAte && tentativasRestantes != null && (
          <p className="text-muted text-xs text-center">{tentativasRestantes} tentativa(s) restante(s).</p>
        )}
        {sucesso && (
          <p className="text-success text-xs font-bold text-center flex items-center justify-center gap-1.5">
            <CheckCircle2 size={14} /> Código alterado.
          </p>
        )}

        <button
          type="submit"
          disabled={enviando || atual.length !== 4 || novo.length !== 4 || !!bloqueadoAte}
          className="w-full bg-accent hover:bg-accent-hover text-on-accent p-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
        >
          {enviando ? <Loader2 className="animate-spin" size={18} /> : <KeyRound size={18} />}
          Guardar Novo Código
        </button>
      </form>

      <StatusToast toast={toast} />
    </main>
  );
}
