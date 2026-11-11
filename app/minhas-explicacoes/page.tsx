'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { getHojeLisboa, dataLisboaDe, horaLisboaDe } from '@/lib/dataLisboa';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { ArrowLeft, CalendarX, Clock, GraduationCap, Loader2, Users, X } from 'lucide-react';

const MOTIVO_MAX = 300;

type Explicacao = {
  explicacao_id: string;
  data: string;
  hora_inicio: string;
  horas: number;
  disciplina: string;
  professor: string;
  fixa: boolean;
  grupo: boolean;
  estado: 'ativa' | 'dada' | 'cancelada' | 'cancelada_por_mim';
  cancelamento_tardio: boolean;
  limite_gratis: string;
  pode_cancelar: boolean;
  cancelamento_ativo: boolean;
  gratis_horas: number;
};

/** "segunda-feira, 12 de outubro às 14:00" — sempre a partir da hora de
 * Lisboa do instante (nunca do fuso do browser), mesma convenção de
 * lib/formatoAlteracoes.ts. */
function formatarLimiteGratis(iso: string): string {
  const data = dataLisboaDe(iso);
  const hora = horaLisboaDe(iso);
  const extenso = format(new Date(`${data}T00:00:00`), "EEEE, d 'de' MMMM", { locale: pt });
  return `${extenso} às ${hora}`;
}

function formatarDataCurta(dataISO: string): string {
  return format(new Date(`${dataISO}T00:00:00`), "EEEE, d 'de' MMMM", { locale: pt });
}

function capitalizar(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export default function MinhasExplicacoesPage() {
  const { toast, showError, showSuccess } = useStatusToast();
  const [loading, setLoading] = useState(true);
  const [sessoes, setSessoes] = useState<Explicacao[]>([]);
  const [sheetAberta, setSheetAberta] = useState<Explicacao | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('minhas_explicacoes');
    if (error) {
      showError('Não foi possível carregar as tuas explicações: ' + error.message);
      setSessoes([]);
    } else {
      const lista = (data || []) as Explicacao[];
      lista.sort((a, b) => (a.data + a.hora_inicio).localeCompare(b.data + b.hora_inicio));
      setSessoes(lista);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return; }
      carregar();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hoje = getHojeLisboa();
  const horaAgora = horaLisboaDe(new Date());

  const abrirSheet = (sessao: Explicacao) => {
    setMotivo('');
    setSheetAberta(sessao);
  };

  const handleConfirmarCancelamento = async () => {
    if (!sheetAberta || enviando) return;
    setEnviando(true);
    try {
      const { data, error } = await supabase.rpc('cancelar_explicacao_aluno', {
        p_explicacao: sheetAberta.explicacao_id,
        p_motivo: motivo.trim() || null,
      });
      setSheetAberta(null);
      if (error) {
        showError(error.message);
        return;
      }
      showSuccess(data?.cobrada ? 'Sessão cancelada. Será cobrada à família.' : 'Sessão cancelada.');
      carregar();
    } finally {
      setEnviando(false);
    }
  };

  const sessoesPorDia = sessoes.reduce<Record<string, Explicacao[]>>((grupos, s) => {
    (grupos[s.data] ||= []).push(s);
    return grupos;
  }, {});
  const dias = Object.keys(sessoesPorDia).sort();

  if (loading) {
    return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  return (
    <main className="min-h-screen bg-page text-primary p-6 pb-20 font-sans">
      <div className="max-w-xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <Link href="/" className="p-3 bg-surface border border-border rounded-2xl hover:bg-raised transition-colors group">
            <ArrowLeft size={20} className="text-secondary group-hover:text-primary transition-colors" />
          </Link>
          <div className="text-right">
            <h1 className="text-2xl font-black italic tracking-tighter text-primary">AS MINHAS EXPLICAÇÕES</h1>
            <p className="text-[10px] font-black uppercase text-accent tracking-widest">Sessões marcadas</p>
          </div>
        </header>

        {sessoes.length === 0 ? (
          <div className="text-center py-16 bg-surface/70 rounded-[2.5rem] border border-border border-dashed">
            <GraduationCap size={48} className="mx-auto mb-4 text-muted" />
            <p className="text-muted font-bold text-sm">Não tens explicações marcadas.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {dias.map((dia) => (
              <div key={dia} className="space-y-2.5">
                <h2 className="text-xs font-black uppercase tracking-widest text-muted capitalize break-words px-1">
                  {dia === hoje ? 'Hoje' : formatarDataCurta(dia)}
                </h2>
                <div className="space-y-3">
                  {sessoesPorDia[dia].map((s) => {
                    const jaPassou = s.data === hoje && s.hora_inicio.slice(0, 5) < horaAgora;
                    return (
                      <SessaoCard
                        key={s.explicacao_id}
                        sessao={s}
                        esbatida={jaPassou}
                        onCancelar={() => abrirSheet(s)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {sheetAberta && (
        <FolhaCancelamento
          sessao={sheetAberta}
          motivo={motivo}
          onMotivoChange={setMotivo}
          enviando={enviando}
          onConfirmar={handleConfirmarCancelamento}
          onFechar={() => setSheetAberta(null)}
        />
      )}

      <StatusToast toast={toast} />
    </main>
  );
}

// Numa sessão ainda 'ativa' (por cancelar), explicacoes_alunos.cancelamento_tardio
// é só o valor por omissão (false) — só fica certo DEPOIS de cancelar_explicacao_aluno
// decidir. Para mostrar a mensagem certa antes de cancelar, a única fonte é
// comparar agora com limite_gratis (o instante que o servidor já calculou);
// nunca refazer a conta em horas (isso é só da função, lida só para mostrar).
function passouLimiteGratis(sessao: Explicacao): boolean {
  return new Date() > new Date(sessao.limite_gratis);
}

function SessaoCard({ sessao: s, esbatida, onCancelar }: { sessao: Explicacao; esbatida: boolean; onCancelar: () => void }) {
  return (
    <div data-sessao-aluno={s.explicacao_id} className={`bg-surface border border-border rounded-3xl p-5 space-y-3 ${esbatida ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="font-black text-sm text-accent flex items-center gap-1.5">
            <Clock size={13} className="shrink-0" /> {s.hora_inicio.slice(0, 5)}
          </p>
          <p className="text-sm font-bold text-primary break-words mt-1">{s.disciplina}</p>
          <p className="text-xs text-muted mt-0.5">com {s.professor}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <EstadoBadge sessao={s} />
          <div className="flex gap-1.5 flex-wrap justify-end">
            {s.fixa && (
              <span className="px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest bg-page text-muted border border-border">Fixa</span>
            )}
            {s.grupo && (
              <span className="px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest bg-page text-muted border border-border flex items-center gap-1">
                <Users size={9} /> Grupo
              </span>
            )}
          </div>
        </div>
      </div>

      {s.estado === 'ativa' && (
        s.cancelamento_ativo ? (
          s.pode_cancelar && (
            <div className="pt-2 border-t border-border space-y-2">
              <p className="text-[11px] text-muted break-words">
                {passouLimiteGratis(s)
                  ? `Faltam menos de ${s.gratis_horas} horas: se cancelares, a sessão será cobrada à família.`
                  : `Cancelamento gratuito até ${formatarLimiteGratis(s.limite_gratis)}.`}
              </p>
              <button
                type="button"
                onClick={onCancelar}
                className="w-full min-h-11 flex items-center justify-center gap-2 bg-page hover:bg-danger-bg border border-border hover:border-danger/40 text-secondary hover:text-danger px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95"
              >
                <CalendarX size={14} /> Cancelar esta sessão
              </button>
            </div>
          )
        ) : (
          <p className="pt-2 border-t border-border text-[11px] text-muted italic">Para cancelar uma explicação, fala com o centro.</p>
        )
      )}
    </div>
  );
}

function EstadoBadge({ sessao: s }: { sessao: Explicacao }) {
  if (s.estado === 'dada') {
    return <span className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border bg-success-bg text-success border-success/30">Dada</span>;
  }
  if (s.estado === 'cancelada') {
    return <span className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border bg-page text-muted border-border">Cancelada</span>;
  }
  if (s.estado === 'cancelada_por_mim') {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border bg-orange-500/10 text-orange-500 border-orange-500/30 whitespace-nowrap">
          Cancelada por ti
        </span>
        {s.cancelamento_tardio && (
          <span className="px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest bg-danger-bg text-danger">Será cobrada</span>
        )}
      </div>
    );
  }
  return null;
}

function FolhaCancelamento({
  sessao, motivo, onMotivoChange, enviando, onConfirmar, onFechar,
}: {
  sessao: Explicacao;
  motivo: string;
  onMotivoChange: (v: string) => void;
  enviando: boolean;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget && !enviando) onFechar(); }}>
      <div className="bg-surface border border-border w-full max-w-md rounded-3xl shadow-2xl p-8 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-primary">Cancelar esta sessão?</h2>
          <button onClick={onFechar} disabled={enviando} className="text-muted hover:text-primary transition-colors disabled:opacity-40">
            <X size={20} />
          </button>
        </div>

        <div className="bg-page border border-border rounded-2xl p-4 space-y-1">
          <p className="font-bold text-sm text-primary break-words">{sessao.disciplina}</p>
          <p className="text-xs text-secondary">
            {capitalizar(formatarDataCurta(sessao.data))} às {sessao.hora_inicio.slice(0, 5)}
          </p>
          <p className="text-xs text-muted">com {sessao.professor}</p>
        </div>

        <p className="text-xs text-secondary break-words">
          {passouLimiteGratis(sessao)
            ? `Faltam menos de ${sessao.gratis_horas} horas: esta sessão será cobrada à família.`
            : 'O professor, o centro e a tua família são avisados.'}
        </p>

        <div>
          <label className="text-xs font-bold text-muted uppercase ml-1">Motivo (opcional)</label>
          <textarea
            value={motivo}
            onChange={(e) => onMotivoChange(e.target.value.slice(0, MOTIVO_MAX))}
            rows={3}
            maxLength={MOTIVO_MAX}
            placeholder="Porque vais cancelar..."
            className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1 resize-none text-sm"
          />
          <p className="text-[10px] text-muted text-right mt-1">{motivo.length}/{MOTIVO_MAX}</p>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={onConfirmar}
            disabled={enviando}
            className="w-full min-h-11 flex items-center justify-center gap-2 bg-danger hover:bg-danger/90 text-on-danger px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
          >
            {enviando ? <Loader2 className="animate-spin" size={14} /> : <CalendarX size={14} />} Confirmar cancelamento
          </button>
          <button
            type="button"
            onClick={onFechar}
            disabled={enviando}
            className="w-full min-h-11 flex items-center justify-center bg-page hover:bg-raised border border-border text-secondary px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
          >
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}
