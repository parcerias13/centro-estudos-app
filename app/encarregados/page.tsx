'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { isUnlocked, unlock, lock, touch, subscribe } from '@/lib/encarregadoUnlock';
import { getHojeLisboa } from '@/lib/dataLisboa';
import { getAnoLetivoAtual } from '@/lib/anoLetivo';
import { mensalidadeEmAtraso } from '@/lib/mensalidadeEmAtraso';
import { obterDadosPagamentoCentro, type DadosPagamentoCentro } from '@/lib/extrasCentro';
import {
  ArrowLeft, Lock, Unlock, Loader2, AlertTriangle, DollarSign, ClipboardList,
  MessageCircle, KeyRound, ChevronLeft, ChevronRight, CheckCircle2, Clock, Copy, Check, Landmark,
} from 'lucide-react';

type LinhaExplicacaoResumo = {
  data: string;
  hora_inicio: string;
  disciplina: string;
  valor: number | null;
  grupo: boolean;
  cancelada_tarde: boolean;
};

type LinhaExtraResumo = { nome: string; quantidade: number; total: number };

type ResumoMes = {
  ano: number;
  mes: number;
  presencas: { dias: number; datas: string[] };
  mensalidade: { valor: number; pago: boolean } | null;
  explicacoes: { linhas: LinhaExplicacaoResumo[]; total: number; sem_preco: number; pago: boolean };
  extras: { linhas: LinhaExtraResumo[]; total: number };
  total_mes: number;
};

type DiaForaHorarioResumo = { data: string; valor: number };

type ExtrasMesEncarregado = {
  consumos: number;
  dias_fora: DiaForaHorarioResumo[];
  dias_fora_total: number;
  total: number;
  pago: boolean;
  valor_pago: number | null;
  data_pagamento: string | null;
  dia_limite: number;
};

/** "PT50 0002 0123 1234 5678 9015 4" — de 4 em 4 caracteres, só para apresentação; a cópia usa sempre o IBAN sem espaços. */
function agruparIban(iban: string): string {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

/** "novembro" — sem ano, para a referência sugerida "{aluno} · {mês} {ano}". */
function nomeMes(mes: number): string {
  return new Intl.DateTimeFormat('pt-PT', { month: 'long' }).format(new Date(2000, mes - 1, 1));
}

/** Mesmo formato de euros do resto do projeto: "12.34€" (sem espaço). */
function euro(valor: number): string {
  return `${Number(valor).toFixed(2)}€`;
}

/** "dd/MM" por extração direta da string yyyy-MM-dd — nunca um Date, para nunca escorregar de dia por fuso. */
function dataCurta(dataISO: string): string {
  return `${dataISO.slice(8, 10)}/${dataISO.slice(5, 7)}`;
}

/** "novembro de 2026" — só para apresentação; ano/mes vêm sempre do servidor, nunca de new Date() local. */
function nomeMesPorExtenso(ano: number, mes: number): string {
  return new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric' }).format(new Date(ano, mes - 1, 1));
}

/** "Segunda-feira, 3 de novembro" — a data já é um dia civil fixo (coluna date), por isso um Date à meia-noite local nunca desloca o dia. */
function diaDaSemanaPorExtenso(dataISO: string): string {
  const data = new Date(`${dataISO}T00:00:00`);
  return new Intl.DateTimeFormat('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' }).format(data);
}

function SeloPago({ pago }: { pago: boolean }) {
  return pago ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-success-bg text-success shrink-0">
      <CheckCircle2 size={11} /> Pago
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-warning-bg text-warning shrink-0">
      <Clock size={11} /> Por pagar
    </span>
  );
}

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
  const [nomeCompleto, setNomeCompleto] = useState('');
  const [mesesDisponiveis, setMesesDisponiveis] = useState<Array<{ ano: number; mes: number }>>([]);
  const [indiceMes, setIndiceMes] = useState(0);
  const [resumoMes, setResumoMes] = useState<ResumoMes | null>(null);
  const [extrasMes, setExtrasMes] = useState<ExtrasMesEncarregado | null>(null);
  const [carregandoResumoMes, setCarregandoResumoMes] = useState(false);
  const [diasAbertos, setDiasAbertos] = useState(false);
  const [extrasAbertos, setExtrasAbertos] = useState(false);
  const [notasResumo, setNotasResumo] = useState<{ confirmadas: number; porConfirmar: number } | null>(null);
  const [naoLidas, setNaoLidas] = useState<number | null>(0);
  const [carregandoVisaoGeral, setCarregandoVisaoGeral] = useState(false);
  const [dadosPagamento, setDadosPagamento] = useState<DadosPagamentoCentro | null>(null);
  const [ibanCopiado, setIbanCopiado] = useState(false);
  const [referenciaCopiada, setReferenciaCopiada] = useState(false);

  // Pede resumo_mes_encarregado para um mês concreto — chamado tanto no
  // arranque (mês atual) como pelas setas de navegação.
  const carregarResumoMes = useCallback(async (ano: number, mes: number) => {
    setCarregandoResumoMes(true);
    setDiasAbertos(false);
    setExtrasAbertos(false);
    try {
      const [{ data, error }, { data: extrasData, error: extrasError }] = await Promise.all([
        supabase.rpc('resumo_mes_encarregado', { p_ano: ano, p_mes: mes }),
        supabase.rpc('extras_mes_encarregado', { p_ano: ano, p_mes: mes }),
      ]);
      if (error) {
        showError('Não foi possível carregar o resumo do mês: ' + error.message);
        setResumoMes(null);
      } else {
        setResumoMes(data as ResumoMes);
      }
      if (extrasError) {
        showError('Não foi possível carregar os extras do mês: ' + extrasError.message);
        setExtrasMes(null);
      } else {
        setExtrasMes(extrasData as ExtrasMesEncarregado);
      }
    } finally {
      setCarregandoResumoMes(false);
    }
  }, [showError]);

  const carregarVisaoGeral = useCallback(async (uid: string) => {
    touch();
    setCarregandoVisaoGeral(true);
    try {
      // getHojeLisboa() — nunca new Date() local, o fuso do browser da família
      // pode não ser Europe/Lisbon.
      const [anoStr, mesStr] = getHojeLisboa().split('-');
      const anoAtual = Number(anoStr);
      const mesAtual = Number(mesStr);

      const [
        { data: aluno },
        { data: mesesData, error: mesesError },
        { data: examsData, error: examsError },
        { data: notasPeriodoData, error: notasPeriodoError },
        { count: naoLidasCount, error: naoLidasError },
        dadosPagamentoRes,
      ] = await Promise.all([
        supabase.from('alunos').select('nome').eq('id', uid).maybeSingle(),
        supabase.rpc('meses_resumo_encarregado'),
        supabase.from('exams').select('nota_valor, nota_confirmada').eq('aluno_id', uid),
        supabase.from('notas_periodo').select('nota_confirmada').eq('aluno_id', uid).eq('ano_letivo', getAnoLetivoAtual()),
        supabase.from('mensagens').select('id', { count: 'exact', head: true }).eq('aluno_id', uid).eq('autor', 'centro').is('lida_pela_familia_em', null),
        obterDadosPagamentoCentro().catch(() => null),
      ]);

      setNome(aluno?.nome?.split(' ')[0] || '');
      setNomeCompleto(aluno?.nome || '');
      setDadosPagamento(dadosPagamentoRes);

      // Nunca zeros em silêncio: se alguma consulta falhar, avisa e mostra
      // "—" nesse número em vez de um valor inventado.
      if (mesesError) {
        showError('Não foi possível carregar os meses disponíveis: ' + mesesError.message);
        setMesesDisponiveis([]);
        setResumoMes(null);
      } else {
        const lista = (mesesData || []) as Array<{ ano: number; mes: number }>;
        setMesesDisponiveis(lista);
        const indiceAtual = lista.findIndex((m) => m.ano === anoAtual && m.mes === mesAtual);
        const indiceInicial = indiceAtual >= 0 ? indiceAtual : 0;
        setIndiceMes(indiceInicial);
        if (lista.length > 0) {
          await carregarResumoMes(lista[indiceInicial].ano, lista[indiceInicial].mes);
        } else {
          setResumoMes(null);
        }
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
  }, [showError, carregarResumoMes]);

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
      setMesesDisponiveis([]);
      setIndiceMes(0);
      setResumoMes(null);
      setExtrasMes(null);
      setDiasAbertos(false);
      setExtrasAbertos(false);
      setNotasResumo(null);
      setNaoLidas(0);
      setDadosPagamento(null);
    });
    return cancelar;
  }, []);

  const handleBloquear = () => {
    lock();
  };

  // As setas só percorrem os meses devolvidos por meses_resumo_encarregado:
  // a lista vem do mais recente (índice 0, sempre o mês atual) para o mais
  // antigo — "anterior" avança o índice (mês mais antigo), "seguinte" recua.
  const handleMesAnterior = () => {
    const novoIndice = indiceMes + 1;
    if (novoIndice >= mesesDisponiveis.length) return;
    setIndiceMes(novoIndice);
    const m = mesesDisponiveis[novoIndice];
    carregarResumoMes(m.ano, m.mes);
  };

  const handleMesSeguinte = () => {
    const novoIndice = indiceMes - 1;
    if (novoIndice < 0) return;
    setIndiceMes(novoIndice);
    const m = mesesDisponiveis[novoIndice];
    carregarResumoMes(m.ano, m.mes);
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

      <section data-testid="resumo-mes" className="bg-surface border border-border rounded-3xl p-6 shadow-xl space-y-5">
        <h2 className="text-xs font-black uppercase text-muted tracking-widest flex items-center gap-2">
          <DollarSign size={14} className="text-accent" /> Resumo do Mês
        </h2>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            data-testid="resumo-mes-anterior"
            onClick={handleMesAnterior}
            disabled={carregandoVisaoGeral || carregandoResumoMes || indiceMes >= mesesDisponiveis.length - 1}
            aria-label="Mês anterior"
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl bg-page border border-border text-secondary hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={18} />
          </button>
          <p data-testid="resumo-mes-titulo" className="font-bold text-sm text-primary capitalize text-center flex-1">
            {mesesDisponiveis.length > 0 ? nomeMesPorExtenso(mesesDisponiveis[indiceMes].ano, mesesDisponiveis[indiceMes].mes) : '—'}
          </p>
          <button
            type="button"
            data-testid="resumo-mes-seguinte"
            onClick={handleMesSeguinte}
            disabled={carregandoVisaoGeral || carregandoResumoMes || indiceMes <= 0}
            aria-label="Mês seguinte"
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl bg-page border border-border text-secondary hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {carregandoVisaoGeral || carregandoResumoMes ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin text-accent" size={24} /></div>
        ) : !resumoMes ? (
          <p className="text-muted text-sm italic">Não foi possível carregar o resumo deste mês.</p>
        ) : resumoMes.presencas.dias === 0 && resumoMes.explicacoes.linhas.length === 0 && resumoMes.extras.linhas.length === 0 && !resumoMes.mensalidade ? (
          <p className="text-muted text-sm italic">Sem movimentos neste mês.</p>
        ) : (
          <div className="space-y-5">
            {/* Presenças */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p data-testid="presencas-dias" className="text-sm">
                  <span className="font-bold text-primary">{resumoMes.presencas.dias}</span>{' '}
                  <span className="text-secondary">{resumoMes.presencas.dias === 1 ? 'dia de presença' : 'dias de presença'}</span>
                </p>
                {resumoMes.presencas.dias > 0 && (
                  <button
                    type="button"
                    onClick={() => setDiasAbertos((a) => !a)}
                    className="min-h-11 px-3 text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-1 shrink-0"
                  >
                    Ver dias
                  </button>
                )}
              </div>
              {diasAbertos && resumoMes.presencas.datas.length > 0 && (
                <ul data-testid="presencas-lista" className="bg-page border border-border rounded-2xl p-3 space-y-1">
                  {resumoMes.presencas.datas.map((d) => (
                    <li key={d} className="text-xs text-secondary capitalize">{diaDaSemanaPorExtenso(d)}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* Explicações */}
            {resumoMes.explicacoes.linhas.length > 0 && (
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-[9px] text-accent font-black uppercase tracking-widest">Explicações</p>
                <div className="space-y-1.5">
                  {resumoMes.explicacoes.linhas.map((l, i) => (
                    <div key={i} data-testid="explicacoes-linha" className="flex items-start justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-primary">{dataCurta(l.data)} · {l.hora_inicio.slice(0, 5)}</span>
                        <span className="text-secondary">{l.disciplina}</span>
                        {l.grupo && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-accent-soft text-accent">Grupo</span>
                        )}
                        {l.cancelada_tarde && (
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-danger-bg text-danger">Cancelada tarde (cobrada)</span>
                        )}
                      </div>
                      <span className="font-mono font-bold text-primary shrink-0">{l.valor != null ? euro(l.valor) : '—'}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-1 gap-2">
                  <p data-testid="explicacoes-total" className="text-xs font-black text-primary">Total das explicações: <span className="font-mono">{euro(resumoMes.explicacoes.total)}</span></p>
                  <span data-testid="explicacoes-selo"><SeloPago pago={resumoMes.explicacoes.pago} /></span>
                </div>
                {resumoMes.explicacoes.sem_preco > 0 && (
                  <p className="text-[10px] text-warning font-bold flex items-center gap-1.5 bg-warning-bg border border-warning/20 rounded-xl px-3 py-2">
                    <AlertTriangle size={12} />
                    {resumoMes.explicacoes.sem_preco} {resumoMes.explicacoes.sem_preco === 1 ? 'sessão' : 'sessões'} ainda sem preço
                  </p>
                )}
              </div>
            )}

            {/* Mensalidade */}
            {resumoMes.mensalidade && (
              <div data-testid="mensalidade-bloco" className="flex items-center justify-between border-t border-border pt-4">
                <div>
                  <p className="text-[9px] text-muted font-black uppercase mb-1">Mensalidade</p>
                  <p data-testid="mensalidade-valor" className="font-mono font-bold text-lg text-primary">{euro(resumoMes.mensalidade.valor)}</p>
                  {extrasMes && (
                    <p className="text-[10px] text-muted mt-0.5">A pagar até dia {extrasMes.dia_limite}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span data-testid="mensalidade-selo"><SeloPago pago={resumoMes.mensalidade.pago} /></span>
                  {extrasMes && mensalidadeEmAtraso({
                    pago: resumoMes.mensalidade.pago,
                    valorEsperado: resumoMes.mensalidade.valor,
                    ano: resumoMes.ano,
                    mes: resumoMes.mes,
                    diaLimite: extrasMes.dia_limite,
                    hojeISO: getHojeLisboa(),
                  }) && (
                    <span data-testid="mensalidade-atraso" className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-danger-bg text-danger shrink-0">
                      <AlertTriangle size={11} /> Em atraso
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Extras do mês — consumos + dias fora do horário, pagam-se no fim do mês */}
            {extrasMes && (resumoMes.extras.linhas.length > 0 || extrasMes.dias_fora.length > 0) && (
              <div className="border-t border-border pt-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[9px] text-warning font-black uppercase mb-1">Extras do mês</p>
                    <p data-testid="extras-total" className="font-mono font-bold text-lg text-warning">{euro(extrasMes.total)}</p>
                    <p className="text-[10px] text-muted mt-0.5">A pagar no fim do mês</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span data-testid="extras-selo"><SeloPago pago={extrasMes.pago} /></span>
                    <button
                      type="button"
                      onClick={() => setExtrasAbertos((a) => !a)}
                      className="min-h-11 px-3 text-[10px] font-black uppercase tracking-widest text-accent flex items-center gap-1 shrink-0"
                    >
                      Ver detalhe
                    </button>
                  </div>
                </div>
                {extrasAbertos && (
                  <ul data-testid="extras-lista" className="bg-page border border-border rounded-2xl p-3 space-y-1">
                    {resumoMes.extras.linhas.map((e, i) => (
                      <li key={`servico-${i}`} className="flex items-center justify-between gap-2 text-xs text-secondary">
                        <span>{e.nome} × {e.quantidade}</span>
                        <span className="font-mono font-bold text-primary shrink-0">{euro(e.total)}</span>
                      </li>
                    ))}
                    {extrasMes.dias_fora.map((d, i) => (
                      <li key={`fora-${i}`} data-testid="extras-dia-fora-linha" className="flex items-center justify-between gap-2 text-xs text-secondary">
                        <span>Dia fora do horário · {dataCurta(d.data)}</span>
                        <span className="font-mono font-bold text-primary shrink-0">{euro(d.valor)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Total do mês — mensalidade + explicações + extras (consumos + dias fora do horário) */}
            <div className="border-t border-border pt-4 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-black uppercase text-muted tracking-widest">Total do Mês</p>
                <p data-testid="total-mes" className="font-mono font-black text-xl text-primary">
                  {euro(extrasMes ? resumoMes.total_mes - resumoMes.extras.total + extrasMes.total : resumoMes.total_mes)}
                </p>
              </div>
              {resumoMes.ano === Number(getHojeLisboa().split('-')[0]) && resumoMes.mes === Number(getHojeLisboa().split('-')[1]) && (
                <p data-testid="aviso-mes-atual" className="text-[10px] text-muted italic">O mês ainda não acabou: o total pode subir.</p>
              )}
            </div>
          </div>
        )}

        {/* Como pagar — independente do mês mostrado; só aparece com IBAN preenchido no centro */}
        {dadosPagamento && mesesDisponiveis.length > 0 && (
          <div data-testid="como-pagar" className="border-t border-border pt-4 space-y-3">
            <p className="text-[9px] text-muted font-black uppercase tracking-widest flex items-center gap-1.5">
              <Landmark size={12} className="text-accent" /> Como pagar
            </p>
            <div>
              <p className="text-[10px] text-muted font-bold uppercase">Beneficiário</p>
              <p className="text-sm font-bold text-primary">{dadosPagamento.beneficiario}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted font-bold uppercase">IBAN</p>
              <div className="flex items-center justify-between gap-2">
                <p data-testid="iban-valor" className="font-mono font-bold text-sm text-primary">{agruparIban(dadosPagamento.iban)}</p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(dadosPagamento.iban);
                      setIbanCopiado(true);
                      setTimeout(() => setIbanCopiado(false), 2000);
                    } catch { /* clipboard indisponível — sem feedback */ }
                  }}
                  className="shrink-0 min-h-11 px-3 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-accent"
                >
                  {ibanCopiado ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar IBAN</>}
                </button>
              </div>
            </div>
            {mesesDisponiveis[indiceMes] && (
              <div>
                <p className="text-[10px] text-muted font-bold uppercase">Referência sugerida</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-primary">
                    {nomeCompleto || 'Aluno'} · {nomeMes(mesesDisponiveis[indiceMes].mes)} {mesesDisponiveis[indiceMes].ano}
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(`${nomeCompleto || 'Aluno'} · ${nomeMes(mesesDisponiveis[indiceMes].mes)} ${mesesDisponiveis[indiceMes].ano}`);
                        setReferenciaCopiada(true);
                        setTimeout(() => setReferenciaCopiada(false), 2000);
                      } catch { /* clipboard indisponível — sem feedback */ }
                    }}
                    className="shrink-0 min-h-11 px-3 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-accent"
                  >
                    {referenciaCopiada ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar referência</>}
                  </button>
                </div>
              </div>
            )}
          </div>
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

      <div className="flex items-center justify-center gap-6">
        <Link href="/encarregados/codigo" className="flex items-center justify-center gap-2 text-muted hover:text-primary text-xs font-bold uppercase tracking-widest transition-colors py-2">
          <KeyRound size={14} /> Alterar Código
        </Link>
        <Link href="/encarregados/password" className="flex items-center justify-center gap-2 text-muted hover:text-primary text-xs font-bold uppercase tracking-widest transition-colors py-2">
          <Lock size={14} /> Alterar Palavra-Passe
        </Link>
      </div>

      <StatusToast toast={toast} />
    </main>
  );
}
