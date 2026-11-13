'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getHojeLisboa, horaLisboaDe, dataLisboaDe, janelaLarga } from '@/lib/dataLisboa';
import { DISCIPLINA_ESTUDO_AUTONOMO } from '@/lib/diarioBordo';
import { LogIn, LogOut, Loader2, Clock, CheckCircle2 } from 'lucide-react';

type Props = {
  showError: (mensagem: string) => void;
};

type Estado = 'carregando' | 'fora' | 'dentro' | 'feito';

function formatarDuracao(totalMinutos: number): string {
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  if (horas <= 0) return `${minutos} min`;
  return `${horas} h ${minutos} min`;
}

export default function CheckInBotaoUnico({ showError }: Props) {
  const [estado, setEstado] = useState<Estado>('carregando');
  const [sessaoAberta, setSessaoAberta] = useState<any>(null);
  const [ultimaSessaoFeita, setUltimaSessaoFeita] = useState<any>(null);
  const [totalMinutosHoje, setTotalMinutosHoje] = useState(0);
  const [aConfirmarSaida, setAConfirmarSaida] = useState(false);
  const [horaConfirmacao, setHoraConfirmacao] = useState('');
  const [gravando, setGravando] = useState(false);
  const [, forcarRecalculo] = useState(0);

  const carregar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const hoje = getHojeLisboa();
    const { inicio, fim } = janelaLarga(hoje);
    const { data: linhas, error } = await supabase
      .from('diario_bordo')
      .select('*')
      .eq('aluno_id', user.id)
      .gte('entrada', inicio)
      .lte('entrada', fim);

    if (error) {
      showError('Erro ao carregar o check-in: ' + error.message);
      setEstado('fora');
      return;
    }

    const linhasHoje = (linhas || []).filter((l) => dataLisboaDe(l.entrada) === hoje);
    const aberta = linhasHoje.find((l) => !l.saida) || null;

    let total = 0;
    let ultimaFeita: any = null;
    for (const linha of linhasHoje) {
      if (linha.saida) {
        total += (new Date(linha.saida).getTime() - new Date(linha.entrada).getTime()) / 60000;
        if (!ultimaFeita || new Date(linha.saida).getTime() > new Date(ultimaFeita.saida).getTime()) {
          ultimaFeita = linha;
        }
      }
    }

    setSessaoAberta(aberta);
    setUltimaSessaoFeita(ultimaFeita);
    setTotalMinutosHoje(Math.max(0, Math.round(total)));
    setAConfirmarSaida(false);
    setEstado(aberta ? 'dentro' : ultimaFeita ? 'feito' : 'fora');
  }, [showError]);

  useEffect(() => { carregar(); }, [carregar]);

  // Só para o "há X h Y min" não ficar parado enquanto a sessão está aberta.
  useEffect(() => {
    if (estado !== 'dentro') return;
    const intervalo = setInterval(() => forcarRecalculo((n) => n + 1), 60_000);
    return () => clearInterval(intervalo);
  }, [estado]);

  const darEntrada = async () => {
    if (gravando || estado === 'dentro') return;
    setGravando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const centro_id = user?.app_metadata?.centro_id;
      if (!user || !centro_id) {
        showError('Não foi possível identificar o centro. Recarrega a página e tenta novamente.');
        return;
      }
      const { error } = await supabase.from('diario_bordo').insert({
        aluno_id: user.id,
        subject_id: null,
        subject_name: DISCIPLINA_ESTUDO_AUTONOMO,
        sala_id: null,
        entrada: new Date().toISOString(),
        centro_id,
      });
      if (error) {
        showError('Erro ao dar entrada: ' + error.message);
        return;
      }
      await carregar();
    } finally {
      setGravando(false);
    }
  };

  const abrirConfirmacaoSaida = () => {
    setHoraConfirmacao(horaLisboaDe(new Date()));
    setAConfirmarSaida(true);
  };

  const confirmarSaida = async () => {
    if (gravando || !sessaoAberta) return;
    setGravando(true);
    try {
      const { error } = await supabase
        .from('diario_bordo')
        .update({ saida: new Date().toISOString() })
        .eq('id', sessaoAberta.id);
      if (error) {
        showError('Erro ao dar saída: ' + error.message);
        return;
      }
      await carregar();
    } finally {
      setGravando(false);
    }
  };

  if (estado === 'carregando') {
    return (
      <div className="bg-surface border border-border rounded-3xl p-6 flex items-center justify-center min-h-28">
        <Loader2 className="animate-spin text-muted" size={24} />
      </div>
    );
  }

  if (estado === 'fora') {
    return (
      <div className="bg-surface border border-border rounded-3xl p-6 text-center space-y-4">
        <p className="text-sm font-bold text-secondary">Ainda não deste entrada hoje.</p>
        <button
          type="button"
          onClick={darEntrada}
          disabled={gravando}
          className="w-full min-h-11 bg-accent hover:bg-accent-hover disabled:opacity-50 text-on-accent py-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95"
        >
          {gravando ? <Loader2 className="animate-spin" size={20} /> : <LogIn size={20} />}
          Dar entrada
        </button>
      </div>
    );
  }

  if (estado === 'dentro') {
    const desde = horaLisboaDe(sessaoAberta.entrada);
    const minutosDesde = Math.max(0, Math.round((Date.now() - new Date(sessaoAberta.entrada).getTime()) / 60000));
    return (
      <div className="bg-surface border border-border rounded-3xl p-6 text-center space-y-4">
        <div className="bg-success-bg text-success p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto border-4 border-success/20">
          <CheckCircle2 size={28} />
        </div>
        <div>
          <p className="text-lg font-black text-primary">Estás na sala</p>
          {sessaoAberta.status === 'present' && (
            <span className="inline-block mt-1 bg-warning-bg text-warning text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full">
              Por validar
            </span>
          )}
          <p className="text-xs text-muted font-bold mt-2 flex items-center justify-center gap-1.5">
            <Clock size={12} /> Desde as {desde} · há {formatarDuracao(minutosDesde)}
          </p>
        </div>

        {aConfirmarSaida ? (
          <div className="bg-page border border-border rounded-2xl p-4 space-y-3">
            <p className="text-sm font-bold text-primary">Dar saída agora, às {horaConfirmacao}?</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAConfirmarSaida(false)}
                disabled={gravando}
                className="flex-1 min-h-11 bg-surface border border-border text-secondary py-3 rounded-xl font-black text-xs uppercase tracking-widest disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={confirmarSaida}
                disabled={gravando}
                className="flex-1 min-h-11 bg-danger-bg text-danger border border-danger/30 py-3 rounded-xl font-black text-xs uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {gravando ? <Loader2 className="animate-spin" size={16} /> : null}
                Confirmar saída
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={abrirConfirmacaoSaida}
            disabled={gravando}
            className="w-full min-h-11 bg-surface hover:bg-danger-bg text-secondary hover:text-danger border border-border py-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            <LogOut size={20} /> Dar saída
          </button>
        )}
      </div>
    );
  }

  // estado === 'feito'
  return (
    <div className="bg-surface border border-border rounded-3xl p-6 text-center space-y-3">
      <div className="bg-success-bg text-success p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto border-4 border-success/20">
        <CheckCircle2 size={28} />
      </div>
      <p className="text-sm font-bold text-primary">Saída registada às {horaLisboaDe(ultimaSessaoFeita.saida)}</p>
      <p className="text-xs text-muted font-bold">Hoje: {formatarDuracao(totalMinutosHoje)} na sala.</p>
      <button
        type="button"
        onClick={darEntrada}
        disabled={gravando}
        className="text-[10px] font-black uppercase tracking-widest text-accent disabled:opacity-50"
      >
        {gravando ? <Loader2 className="inline animate-spin" size={12} /> : null} Voltar a entrar
      </button>
    </div>
  );
}
