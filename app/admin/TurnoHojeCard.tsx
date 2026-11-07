'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getHojeLisboa, dataLisboaDe, horaLisboaDe, instanteLisboaParaUTC } from '@/lib/dataLisboa';
import { formatarDuracao } from '@/lib/registosHoras';
import { Clock, LogIn, LogOut, AlertTriangle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

type TurnoAberto = { id: string; entrada: string } | null;

/**
 * Cartão "Turno de Hoje" do Dashboard — só para role professor (verifica a
 * própria role via supabase.auth.getUser() e não renderiza nada para outra
 * role, incluindo admin/secretaria). Toda a escrita passa por RPCs
 * (registar_entrada/registar_saida) cujos erros já vêm em português do
 * Postgres — mostrados diretamente com o StatusToast do Dashboard (props).
 * Nunca mostra euros: isto é só registo de presença.
 */
export default function TurnoHojeCard({
  showError,
  showSuccess,
}: {
  showError: (msg: string) => void;
  showSuccess: (msg: string) => void;
}) {
  const [role, setRole] = useState<string | null>(null);
  const [professorId, setProfessorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [turno, setTurno] = useState<TurnoAberto>(null);
  const [registrando, setRegistrando] = useState(false);
  const [saidaAntigaInput, setSaidaAntigaInput] = useState('');
  // Só o setter é usado — cada chamada força um novo render que recalcula o
  // tempo decorrido abaixo a partir de Date.now() (ver o setInterval mais
  // abaixo); o valor em si nunca é lido.
  const [, setTick] = useState(0);

  const carregarTurno = useCallback(async (profId: string) => {
    const { data, error } = await supabase
      .from('registos_horas_professor')
      .select('id, entrada')
      .eq('professor_id', profId)
      .is('saida', null)
      .order('entrada', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      showError('Erro ao verificar o turno: ' + error.message);
      return;
    }
    setTurno(data ?? null);
    setSaidaAntigaInput('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const r = user?.app_metadata?.role?.toLowerCase() ?? null;
      setRole(r);
      if (r !== 'professor' || !user) {
        setLoading(false);
        return;
      }
      setProfessorId(user.id);
      await carregarTurno(user.id);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tempo decorrido real (não arredondado) do turno de hoje — atualiza a cada minuto.
  useEffect(() => {
    if (role !== 'professor' || !turno) return;
    const intervalo = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(intervalo);
  }, [role, turno]);

  if (role !== 'professor' || loading) return null;

  const hoje = getHojeLisboa();
  const diaEntradaLisboa = turno ? dataLisboaDe(turno.entrada) : null;
  const ehDeHoje = diaEntradaLisboa === hoje;

  const handleRegistarEntrada = async () => {
    if (!professorId) return;
    setRegistrando(true);
    const { error } = await supabase.rpc('registar_entrada');
    setRegistrando(false);
    if (error) {
      showError(error.message);
      return;
    }
    await carregarTurno(professorId);
  };

  const handleRegistarSaidaHoje = async () => {
    if (!professorId || !turno) return;
    const agora = new Date();
    setRegistrando(true);
    const { data, error } = await supabase.rpc('registar_saida');
    setRegistrando(false);
    if (error) {
      showError(error.message);
      return;
    }
    const minutos = Number(data) || 0;
    showSuccess(`Turno registado: ${horaLisboaDe(turno.entrada)} às ${horaLisboaDe(agora)}. Conta ${formatarDuracao(minutos)}.`);
    await carregarTurno(professorId);
  };

  const handleRegistarSaidaAntiga = async () => {
    if (!professorId || !turno || !diaEntradaLisboa || !saidaAntigaInput) return;
    setRegistrando(true);
    const instante = instanteLisboaParaUTC(diaEntradaLisboa, saidaAntigaInput);
    const { error } = await supabase.rpc('registar_saida', { p_saida: instante });
    setRegistrando(false);
    if (error) {
      showError('Pede à direção.');
      return;
    }
    showSuccess('Turno registado.');
    await carregarTurno(professorId);
  };

  const tempoDecorridoMin = turno && ehDeHoje
    ? Math.max(0, Math.floor((Date.now() - new Date(turno.entrada).getTime()) / 60_000))
    : 0;

  return (
    <div className="bg-surface border border-border rounded-3xl p-5 md:p-6 mb-6">
      <h2 className="flex items-center gap-2 text-secondary font-black uppercase text-xs tracking-widest mb-4">
        <Clock size={14} /> Turno de Hoje
      </h2>

      {!turno && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-muted font-bold">Ainda sem entrada registada</p>
          <button
            type="button"
            onClick={handleRegistarEntrada}
            disabled={registrando}
            className="min-h-11 bg-accent hover:bg-accent-hover text-on-accent px-5 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
          >
            {registrando ? <Loader2 className="animate-spin" size={16} /> : <LogIn size={16} />} Registar entrada
          </button>
        </div>
      )}

      {turno && ehDeHoje && (
        <div className="space-y-3">
          <p className="text-sm text-primary font-bold">Turno em curso desde {horaLisboaDe(turno.entrada)}</p>
          <p className="text-xs text-muted font-bold">{formatarDuracao(tempoDecorridoMin)} até agora</p>
          <button
            type="button"
            onClick={handleRegistarSaidaHoje}
            disabled={registrando}
            className="w-full min-h-11 bg-danger-bg hover:bg-danger text-danger hover:text-on-danger px-5 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 border border-danger/30 transition-all active:scale-95 disabled:opacity-50"
          >
            {registrando ? <Loader2 className="animate-spin" size={16} /> : <LogOut size={16} />} Registar saída
          </button>
        </div>
      )}

      {turno && !ehDeHoje && diaEntradaLisboa && (
        <div className="space-y-3">
          <p className="text-xs text-warning font-bold flex items-center gap-1.5">
            <AlertTriangle size={14} className="shrink-0" />
            O turno de {format(new Date(`${diaEntradaLisboa}T00:00:00`), 'dd/MM', { locale: pt })} ficou aberto desde {horaLisboaDe(turno.entrada)}
          </p>
          <div>
            <label className="text-[10px] font-bold text-muted uppercase ml-1">Hora de saída</label>
            <input
              type="time"
              value={saidaAntigaInput}
              onChange={(e) => setSaidaAntigaInput(e.target.value)}
              required
              className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1 min-h-11"
            />
          </div>
          <button
            type="button"
            onClick={handleRegistarSaidaAntiga}
            disabled={registrando || !saidaAntigaInput}
            className="w-full min-h-11 bg-danger-bg hover:bg-danger text-danger hover:text-on-danger px-5 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 border border-danger/30 transition-all active:scale-95 disabled:opacity-50"
          >
            {registrando ? <Loader2 className="animate-spin" size={16} /> : <LogOut size={16} />} Registar saída
          </button>
        </div>
      )}
    </div>
  );
}
