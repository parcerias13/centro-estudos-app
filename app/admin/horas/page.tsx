'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { getHojeLisboa, horaLisboaDe, dataLisboaDe } from '@/lib/dataLisboa';
import { janelaMesLisboa, somaMinutosFechados, formatarDuracao, type RegistoHoraProfessor } from '@/lib/registosHoras';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Clock, Lock, Plus } from 'lucide-react';
import { startOfMonth, addMonths, addDays, format } from 'date-fns';
import { pt } from 'date-fns/locale';

export default function HorasTrabalhoProfessorPage() {
  const { toast, showError, showSuccess } = useStatusToast();
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [professorId, setProfessorId] = useState<string | null>(null);
  const [registos, setRegistos] = useState<RegistoHoraProfessor[]>([]);
  const [loading, setLoading] = useState(true);

  const [diaForm, setDiaForm] = useState<'hoje' | 'ontem'>('hoje');
  const [entradaForm, setEntradaForm] = useState('');
  const [saidaForm, setSaidaForm] = useState('');
  const [salvando, setSalvando] = useState(false);

  const ano = currentMonth.getFullYear();
  const mes = currentMonth.getMonth() + 1;
  const mesStr = `${ano}-${String(mes).padStart(2, '0')}`;
  const mesAtualLisboa = getHojeLisboa().slice(0, 7);
  const isMesAtual = mesStr === mesAtualLisboa;

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setProfessorId(user?.id ?? null);
    });
  }, []);

  const isFetchingRef = useRef(false);
  const fetchPendingRef = useRef(false);

  const fetchRegistos = useCallback(async () => {
    if (!professorId) return;
    if (isFetchingRef.current) {
      fetchPendingRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    setLoading(true);
    try {
      const { inicio, fim } = janelaMesLisboa(mesStr);
      const { data, error } = await supabase
        .from('registos_horas_professor')
        .select('id, professor_id, entrada, saida, minutos, origem')
        .eq('professor_id', professorId)
        .gte('entrada', inicio)
        .lt('entrada', fim)
        .order('entrada', { ascending: true });
      if (error) {
        showError('Erro ao carregar os registos: ' + error.message);
        return;
      }
      setRegistos(
        (data || []).map((r: any) => ({
          id: r.id,
          professorId: r.professor_id,
          entrada: r.entrada,
          saida: r.saida,
          minutos: r.minutos == null ? null : Number(r.minutos),
          origem: r.origem,
        }))
      );
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
      if (fetchPendingRef.current) {
        fetchPendingRef.current = false;
        fetchRegistos();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [professorId, mesStr]);

  useEffect(() => { fetchRegistos(); }, [fetchRegistos]);

  const totalMinutos = somaMinutosFechados(registos);

  const handleRegistarHorasEmFalta = async () => {
    if (!entradaForm || !saidaForm) {
      showError('Indica a hora de entrada e de saída.');
      return;
    }
    const hojeISO = getHojeLisboa();
    const dia = diaForm === 'hoje' ? hojeISO : format(addDays(new Date(`${hojeISO}T00:00:00`), -1), 'yyyy-MM-dd');

    setSalvando(true);
    const { error } = await supabase.rpc('registar_horas_em_falta', {
      p_dia: dia,
      p_entrada: entradaForm,
      p_saida: saidaForm,
    });
    setSalvando(false);

    if (error) {
      showError(error.message);
      return;
    }
    showSuccess('Horas registadas.');
    setEntradaForm('');
    setSaidaForm('');
    fetchRegistos();
  };

  return (
    <main className="min-h-screen bg-page text-primary p-6 md:p-8 max-w-3xl mx-auto font-sans">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="p-3 bg-surface border border-border rounded-2xl hover:bg-raised transition-colors">
            <ArrowLeft size={20} className="text-secondary" />
          </Link>
          <div>
            <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter uppercase flex items-center gap-3">
              <Clock className="text-accent" /> Horas de Trabalho
            </h1>
          </div>
        </div>

        <div className="flex items-center bg-surface border border-border rounded-2xl overflow-hidden p-1 shadow-xl">
          <button onClick={() => setCurrentMonth((prev) => addMonths(prev, -1))} className="p-2 hover:bg-raised text-secondary hover:text-primary transition-all">
            <ChevronLeft size={20} />
          </button>
          <div className="px-4 py-1 text-center min-w-40">
            <p className="text-sm font-black text-primary capitalize">
              {format(currentMonth, 'MMMM yyyy', { locale: pt })}
            </p>
          </div>
          <button onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))} className="p-2 hover:bg-raised text-secondary hover:text-primary transition-all">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-3xl p-6 md:p-8 mb-6">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Total do Mês</p>
        <p className="text-3xl font-black text-primary tracking-tighter">{formatarDuracao(totalMinutos)}</p>
      </div>

      {isMesAtual && (
        <div className="bg-surface border border-border rounded-3xl p-6 mb-6">
          <h2 className="text-xs font-black uppercase tracking-widest text-muted mb-4 flex items-center gap-2">
            <Plus size={14} /> Registar Horas em Falta
          </h2>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold text-muted uppercase ml-1">Dia</label>
              <select
                value={diaForm}
                onChange={(e) => setDiaForm(e.target.value as 'hoje' | 'ontem')}
                className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1"
              >
                <option value="hoje">Hoje</option>
                <option value="ontem">Ontem</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-muted uppercase ml-1">Entrada</label>
                <input
                  type="time"
                  value={entradaForm}
                  onChange={(e) => setEntradaForm(e.target.value)}
                  className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1 min-h-11"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted uppercase ml-1">Saída</label>
                <input
                  type="time"
                  value={saidaForm}
                  onChange={(e) => setSaidaForm(e.target.value)}
                  className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1 min-h-11"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleRegistarHorasEmFalta}
              disabled={salvando}
              className="w-full min-h-11 bg-accent hover:bg-accent-hover text-on-accent px-5 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              {salvando ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />} Registar
            </button>
            <p className="text-[11px] text-muted italic">
              Só hoje e ontem. Para outros dias, fala com a direção. Fica marcado como registo manual.
            </p>
          </div>
        </div>
      )}

      {!isMesAtual && (
        <p className="text-[11px] text-muted font-bold flex items-center gap-1.5 mb-6">
          <Lock size={12} /> Mês anterior — só leitura
        </p>
      )}

      <div className="bg-surface border border-border rounded-4xl overflow-hidden shadow-2xl relative min-h-32">
        {loading && (
          <div className="absolute inset-0 bg-surface/80 backdrop-blur-sm flex items-center justify-center z-10">
            <Loader2 className="animate-spin text-accent" size={28} />
          </div>
        )}
        {!loading && registos.length === 0 ? (
          <div className="p-12 text-center text-muted font-medium italic">
            <Clock size={40} className="mx-auto mb-3 opacity-20" />
            Sem registos este mês.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {registos.map((r) => (
              <div key={r.id} className="p-5 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-primary">
                    {format(new Date(`${dataLisboaDe(r.entrada)}T00:00:00`), "d 'de' MMMM", { locale: pt })}
                  </p>
                  {r.saida ? (
                    <p className="text-xs text-secondary font-bold mt-0.5">
                      {horaLisboaDe(r.entrada)} às {horaLisboaDe(r.saida)} · conta {formatarDuracao(r.minutos ?? 0)}
                    </p>
                  ) : (
                    <p className="text-xs text-warning font-bold mt-0.5">em aberto desde {horaLisboaDe(r.entrada)}</p>
                  )}
                </div>
                {r.origem !== 'toque' && (
                  <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-border/40 text-muted border border-border rounded-md shrink-0">
                    {r.origem === 'manual' ? 'manual' : 'direção'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <StatusToast toast={toast} />
    </main>
  );
}
