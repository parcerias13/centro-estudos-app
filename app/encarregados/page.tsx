'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { isUnlocked, unlock, lock, touch, subscribe } from '@/lib/encarregadoUnlock';
import { getHojeLisboa } from '@/lib/dataLisboa';
import { getAnoLetivoAtual } from '@/lib/anoLetivo';
import {
  ArrowLeft, Lock, Unlock, Loader2, AlertTriangle, DollarSign, ClipboardList,
  MessageCircle, KeyRound,
} from 'lucide-react';

export default function EncarregadosPage() {
  const router = useRouter();
  const { toast, showError } = useStatusToast();

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [desbloqueado, setDesbloqueado] = useState(false);

  // Porta do código
  const [codigo, setCodigo] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [erroCodigo, setErroCodigo] = useState<string | null>(null);
  const [bloqueadoAte, setBloqueadoAte] = useState<string | null>(null);
  const [tentativasRestantes, setTentativasRestantes] = useState<number | null>(null);
  const [semCodigo, setSemCodigo] = useState(false);

  // Visão geral
  const [nome, setNome] = useState('');
  const [resumo, setResumo] = useState<any>(null);
  const [notasResumo, setNotasResumo] = useState<{ confirmadas: number; porConfirmar: number } | null>(null);
  const [naoLidas, setNaoLidas] = useState<number | null>(0);
  const [carregandoVisaoGeral, setCarregandoVisaoGeral] = useState(false);

  const carregarVisaoGeral = useCallback(async (uid: string) => {
    touch();
    setCarregandoVisaoGeral(true);
    try {
      // getHojeLisboa() — nunca new Date() local, o fuso do browser da família
      // pode não ser Europe/Lisbon.
      const [anoStr, mesStr] = getHojeLisboa().split('-');
      const ano = Number(anoStr);
      const mes = Number(mesStr);

      const [
        { data: aluno },
        { data: resumoData, error: resumoError },
        { data: examsData, error: examsError },
        { data: notasPeriodoData, error: notasPeriodoError },
        { count: naoLidasCount, error: naoLidasError },
      ] = await Promise.all([
        supabase.from('alunos').select('nome').eq('id', uid).maybeSingle(),
        supabase.rpc('extrato_resumo_encarregado', { p_ano: ano, p_mes: mes }),
        supabase.from('exams').select('nota_valor, nota_confirmada').eq('aluno_id', uid),
        supabase.from('notas_periodo').select('nota_confirmada').eq('aluno_id', uid).eq('ano_letivo', getAnoLetivoAtual()),
        supabase.from('mensagens').select('id', { count: 'exact', head: true }).eq('aluno_id', uid).eq('autor', 'centro').is('lida_pela_familia_em', null),
      ]);

      setNome(aluno?.nome?.split(' ')[0] || '');

      // Nunca zeros em silêncio: se alguma consulta falhar, avisa e mostra
      // "—" nesse número em vez de um valor inventado.
      if (resumoError) {
        showError('Não foi possível carregar o extrato do mês: ' + resumoError.message);
        setResumo(null);
      } else {
        setResumo(resumoData);
      }

      if (examsError || notasPeriodoError) {
        showError('Não foi possível carregar o resumo de notas: ' + (examsError || notasPeriodoError)!.message);
        setNotasResumo(null);
      } else {
        const examsComNota = (examsData || []).filter((e: any) => e.nota_valor != null);
        const confirmadas = examsComNota.filter((e: any) => e.nota_confirmada).length
          + (notasPeriodoData || []).filter((n: any) => n.nota_confirmada).length;
        const porConfirmar = examsComNota.filter((e: any) => !e.nota_confirmada).length
          + (notasPeriodoData || []).filter((n: any) => !n.nota_confirmada).length;
        setNotasResumo({ confirmadas, porConfirmar });
      }

      if (naoLidasError) {
        showError('Não foi possível carregar as mensagens não lidas: ' + naoLidasError.message);
        setNaoLidas(null);
      } else {
        setNaoLidas(naoLidasCount || 0);
      }
    } finally {
      setCarregandoVisaoGeral(false);
    }
  }, [showError]);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.replace('/login'); return; }

        const role = user.app_metadata?.role?.toLowerCase();
        if (role === 'admin' || role === 'professor' || role === 'secretaria') {
          router.replace('/admin');
          return;
        }

        setUserId(user.id);
        // Nunca busca dados da área sem confirmar o desbloqueio primeiro.
        if (isUnlocked(user.id)) {
          setDesbloqueado(true);
          await carregarVisaoGeral(user.id);
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVerificarCodigo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    if (!/^\d{4}$/.test(codigo)) {
      setErroCodigo('Introduz os 4 dígitos.');
      return;
    }

    setVerificando(true);
    setErroCodigo(null);
    try {
      const { data, error } = await supabase.rpc('verificar_codigo_encarregado', { p_codigo: codigo });

      if (error) {
        showError('Erro ao verificar o código: ' + error.message);
        return;
      }

      if (data?.ok) {
        setCodigo('');
        setBloqueadoAte(null);
        setTentativasRestantes(null);
        unlock(userId);
        setDesbloqueado(true);
        await carregarVisaoGeral(userId);
        return;
      }

      if (data?.erro === 'sem_codigo') {
        setSemCodigo(true);
        return;
      }

      setCodigo('');
      setBloqueadoAte(data?.bloqueado_ate ?? null);
      setTentativasRestantes(data?.tentativas_restantes ?? null);
      setErroCodigo(data?.bloqueado_ate ? 'Demasiadas tentativas erradas.' : 'Código incorreto.');
    } finally {
      setVerificando(false);
    }
  };

  // lock() não re-renderiza nada por si só (é só uma variável de módulo) —
  // a subscrição é que avisa esta página para limpar o que tem no estado
  // React, quer o bloqueio venha deste botão, de inatividade, ou de logout.
  useEffect(() => {
    const cancelar = subscribe(() => {
      setDesbloqueado(false);
      setResumo(null);
      setNotasResumo(null);
      setNaoLidas(0);
    });
    return cancelar;
  }, []);

  const handleBloquear = () => {
    lock();
  };

  // bloqueadoAte não deve deixar os campos disabled para sempre — limpa-se
  // sozinho quando o prazo passa, sem precisar de reload.
  useEffect(() => {
    if (!bloqueadoAte) return;
    const restante = new Date(bloqueadoAte).getTime() - Date.now();
    if (restante <= 0) {
      setBloqueadoAte(null);
      setErroCodigo(null);
      return;
    }
    const timer = setTimeout(() => {
      setBloqueadoAte(null);
      setErroCodigo(null);
    }, restante);
    return () => clearTimeout(timer);
  }, [bloqueadoAte]);

  if (loading) {
    return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  // --- PORTA DO CÓDIGO ---
  if (!desbloqueado) {
    return (
      <main className="min-h-screen bg-page text-primary p-6 max-w-md mx-auto space-y-8 pb-20">
        <Link href="/" className="flex items-center gap-2 text-muted hover:text-primary transition-colors">
          <ArrowLeft size={20} /> <span className="font-bold">Voltar ao Início</span>
        </Link>

        <div className="flex flex-col items-center text-center gap-3 pt-8">
          <div className="bg-accent-soft text-accent p-4 rounded-full">
            <Lock size={28} />
          </div>
          <h1 className="text-2xl font-black italic">Área dos Encarregados</h1>
          <p className="text-secondary text-sm">Introduz o código de 4 dígitos para entrar.</p>
        </div>

        {semCodigo ? (
          <div className="bg-warning-bg border border-warning/20 p-5 rounded-2xl text-center space-y-2">
            <AlertTriangle className="mx-auto text-warning" size={24} />
            <p className="text-sm font-bold text-warning">Ainda não tens um código definido.</p>
            <p className="text-xs text-muted">Pede ao centro para gerar o teu código.</p>
          </div>
        ) : (
          <form onSubmit={handleVerificarCodigo} className="bg-surface border border-border rounded-3xl p-6 shadow-xl space-y-4">
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              disabled={verificando || !!bloqueadoAte}
              placeholder="····"
              autoFocus
              className="w-full bg-page border border-border text-center text-3xl font-black tracking-[0.5em] p-5 rounded-2xl outline-none focus:border-accent transition-all disabled:opacity-50"
            />

            {erroCodigo && (
              <p className="text-danger text-xs font-bold text-center">{erroCodigo}</p>
            )}
            {bloqueadoAte && (
              <p className="text-danger text-xs font-bold text-center">
                Tenta de novo depois das {new Date(bloqueadoAte).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}.
              </p>
            )}
            {!bloqueadoAte && tentativasRestantes != null && (
              <p className="text-muted text-xs text-center">{tentativasRestantes} tentativa(s) restante(s).</p>
            )}

            <button
              type="submit"
              disabled={verificando || codigo.length !== 4 || !!bloqueadoAte}
              className="w-full bg-accent hover:bg-accent-hover text-on-accent p-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              {verificando ? <Loader2 className="animate-spin" size={20} /> : <Unlock size={20} />}
              Entrar
            </button>
          </form>
        )}

        <StatusToast toast={toast} />
      </main>
    );
  }

  // --- VISÃO GERAL ---
  return (
    <main className="min-h-screen bg-page text-primary p-6 max-w-md mx-auto space-y-6 pb-20">
      <Link href="/" className="flex items-center gap-2 text-muted hover:text-primary transition-colors">
        <ArrowLeft size={20} /> <span className="font-bold">Voltar ao Início</span>
      </Link>

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black italic">Olá{nome ? `, ${nome}` : ''}</h1>
          <p className="text-secondary text-xs font-bold uppercase tracking-widest mt-1">Área dos Encarregados</p>
        </div>
        <button onClick={handleBloquear} className="bg-surface p-3 rounded-xl border border-border text-secondary hover:text-danger transition-colors" title="Bloquear">
          <Lock size={20} />
        </button>
      </header>

      <section className="bg-surface border border-border rounded-3xl p-6 shadow-xl space-y-4">
        <h2 className="text-xs font-black uppercase text-muted tracking-widest flex items-center gap-2">
          <DollarSign size={14} className="text-accent" /> Resumo do Mês
        </h2>

        {carregandoVisaoGeral ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin text-accent" size={24} /></div>
        ) : resumo ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[9px] text-muted font-black uppercase mb-1">Mensalidade</p>
                <p className="font-mono font-bold text-lg">{Number(resumo.mensalidade_base).toFixed(2)}€</p>
              </div>
              <div>
                <p className="text-[9px] text-warning font-black uppercase mb-1">Extras</p>
                <p className="font-mono font-bold text-lg text-warning">+{Number(resumo.total_extras).toFixed(2)}€</p>
              </div>
              <div>
                <p className="text-[9px] text-accent font-black uppercase mb-1">Explicações</p>
                <p className="font-mono font-bold text-lg text-accent">+{Number(resumo.total_explicacoes).toFixed(2)}€</p>
              </div>
              <div>
                <p className="text-[9px] text-muted font-black uppercase mb-1">Total do Mês</p>
                <p className="font-mono font-black text-lg">{Number(resumo.total_mes).toFixed(2)}€</p>
              </div>
            </div>
            {resumo.explicacoes_sem_preco > 0 && (
              <p className="text-[10px] text-warning font-bold flex items-center gap-1.5 bg-warning-bg border border-warning/20 rounded-xl px-3 py-2">
                <AlertTriangle size={12} />
                Preço não definido — {resumo.explicacoes_sem_preco} {resumo.explicacoes_sem_preco === 1 ? 'sessão' : 'sessões'} sem valor
              </p>
            )}
          </>
        ) : (
          <p className="text-muted text-sm italic">Não foi possível carregar o extrato deste mês.</p>
        )}
      </section>

      <Link href="/notas" className="bg-surface border border-border rounded-3xl p-5 shadow-xl flex items-center justify-between group">
        <div className="flex items-center gap-3">
          <div className="bg-accent-soft text-accent p-2.5 rounded-xl"><ClipboardList size={20} /></div>
          <div>
            <p className="font-bold text-sm">Notas</p>
            <p className="text-[10px] text-muted font-bold uppercase">
              {notasResumo ? `${notasResumo.confirmadas} confirmada(s) · ${notasResumo.porConfirmar} por confirmar` : '—'}
            </p>
          </div>
        </div>
      </Link>

      <Link href="/encarregados/mensagens" className="bg-surface border border-border rounded-3xl p-5 shadow-xl flex items-center justify-between group">
        <div className="flex items-center gap-3">
          <div className="bg-accent-soft text-accent p-2.5 rounded-xl"><MessageCircle size={20} /></div>
          <div>
            <p className="font-bold text-sm">Mensagens</p>
            <p className="text-[10px] text-muted font-bold uppercase">
              {naoLidas == null ? '—' : naoLidas > 0 ? `${naoLidas} não lida(s)` : 'Sem novas mensagens'}
            </p>
          </div>
        </div>
        {naoLidas != null && naoLidas > 0 && (
          <span className="bg-danger text-on-danger text-[10px] font-black min-w-5 h-5 px-1.5 rounded-full flex items-center justify-center">{naoLidas}</span>
        )}
      </Link>

      <Link href="/encarregados/codigo" className="flex items-center justify-center gap-2 text-muted hover:text-primary text-xs font-bold uppercase tracking-widest transition-colors py-2">
        <KeyRound size={14} /> Alterar Código
      </Link>

      <StatusToast toast={toast} />
    </main>
  );
}
