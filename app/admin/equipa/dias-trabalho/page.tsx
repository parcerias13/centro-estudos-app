'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { getHojeLisboa } from '@/lib/dataLisboa';
import { mesParaData, ultimoDiaDoMes, type PeriodoCustoFixo } from '@/lib/custos';
import { tipoNoMes } from '@/lib/remuneracaoProfessores';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Loader2, CalendarClock, AlertTriangle, Lock,
} from 'lucide-react';
import { startOfMonth, addMonths, startOfWeek, endOfWeek, eachDayOfInterval, format, isSameMonth } from 'date-fns';
import { pt } from 'date-fns/locale';

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function DiasTrabalhoContent() {
  const { toast, showError, showSuccess } = useStatusToast();
  const searchParams = useSearchParams();
  // ?professor=<id>&mes=AAAA-MM — vindo do link "Ver dias" em Pagamentos →
  // A Pagar. Só aplicado uma vez, no arranque; depois disso a pessoa navega
  // livremente entre meses/professores sem a URL a forçar nada.
  const professorParamAplicadoRef = useRef(false);

  const [centroId, setCentroId] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const mesParam = searchParams.get('mes');
    if (mesParam && /^\d{4}-\d{2}$/.test(mesParam)) {
      const [a, m] = mesParam.split('-').map(Number);
      return startOfMonth(new Date(a, m - 1, 1));
    }
    const [ano, mes] = getHojeLisboa().split('-').map(Number);
    return startOfMonth(new Date(ano, mes - 1, 1));
  });

  const [professores, setProfessores] = useState<any[]>([]);
  const [tipoPorProfessor, setTipoPorProfessor] = useState<Record<string, 'salario' | 'variavel'>>({});
  const [selectedProfessorId, setSelectedProfessorId] = useState<string | null>(null);
  const [loadingProfessores, setLoadingProfessores] = useState(true);

  const [diasDoMes, setDiasDoMes] = useState<Record<string, number>>({}); // data -> fracao
  const [mesPago, setMesPago] = useState(false);
  const [loadingDias, setLoadingDias] = useState(false);

  const ano = currentMonth.getFullYear();
  const mes = currentMonth.getMonth() + 1;
  const mesStr = `${ano}-${String(mes).padStart(2, '0')}`;

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCentroId(user?.app_metadata?.centro_id ?? null);
    });
  }, []);

  // Professores do centro + tipo implícito no mês selecionado — a lista de
  // escolha nunca mostra quem é de salário nesse mês (não marca dias).
  useEffect(() => {
    if (!centroId) return;
    setLoadingProfessores(true);
    (async () => {
      const { data: staffData, error: errStaff } = await supabase
        .from('staff')
        .select('id, name')
        .eq('centro_id', centroId)
        .eq('role', 'professor')
        .order('name');
      if (errStaff) {
        showError('Erro ao carregar professores: ' + errStaff.message);
        setLoadingProfessores(false);
        return;
      }
      setProfessores(staffData || []);

      const ids = (staffData || []).map((p) => p.id);
      let tipos: Record<string, 'salario' | 'variavel'> = {};
      if (ids.length > 0) {
        const { data: periodosSalario } = await supabase
          .from('periodos_valor_professor')
          .select('professor_id, de, ate, valor')
          .eq('centro_id', centroId)
          .eq('tipo', 'salario')
          .in('professor_id', ids);

        const porProf: Record<string, PeriodoCustoFixo[]> = {};
        (periodosSalario || []).forEach((p: any) => {
          if (!porProf[p.professor_id]) porProf[p.professor_id] = [];
          porProf[p.professor_id].push({ de: p.de, ate: p.ate, valor: Number(p.valor) });
        });
        ids.forEach((id) => { tipos[id] = tipoNoMes(porProf[id] || [], mesStr); });
      }
      setTipoPorProfessor(tipos);

      // ?professor=<id> da URL — só da primeira vez, e só se for de facto
      // variável neste mês (senão cai no comportamento normal abaixo).
      const professorParam = searchParams.get('professor');
      if (!professorParamAplicadoRef.current && professorParam) {
        professorParamAplicadoRef.current = true;
        if ((staffData || []).some((p) => p.id === professorParam) && tipos[professorParam] === 'variavel') {
          setSelectedProfessorId(professorParam);
          setLoadingProfessores(false);
          return;
        }
      }

      // Mantém a seleção se ainda for válida (variável neste mês); senão,
      // escolhe o primeiro professor variável disponível.
      setSelectedProfessorId((atual) => {
        if (atual && tipos[atual] === 'variavel') return atual;
        const primeiroVariavel = (staffData || []).find((p) => tipos[p.id] === 'variavel');
        return primeiroVariavel ? primeiroVariavel.id : (staffData || [])[0]?.id ?? null;
      });

      setLoadingProfessores(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centroId, mesStr]);

  const isFetchingRef = useRef(false);
  const fetchPendingRef = useRef(false);

  const fetchDiasDoMes = useCallback(async () => {
    if (!selectedProfessorId || !centroId) {
      setDiasDoMes({});
      setMesPago(false);
      return;
    }
    if (isFetchingRef.current) {
      fetchPendingRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    setLoadingDias(true);
    try {
      const inicioMes = mesParaData(mesStr);
      const fimMes = ultimoDiaDoMes(mesStr);

      const [{ data: diasData, error: errDias }, { data: pagamentoData, error: errPag }] = await Promise.all([
        supabase
          .from('dias_trabalho_professor')
          .select('data, fracao')
          .eq('centro_id', centroId)
          .eq('professor_id', selectedProfessorId)
          .gte('data', inicioMes)
          .lte('data', fimMes),
        supabase
          .from('pagamentos_professores')
          .select('pago')
          .eq('centro_id', centroId)
          .eq('professor_id', selectedProfessorId)
          .eq('ano', ano)
          .eq('mes', mes)
          .maybeSingle(),
      ]);

      if (errDias || errPag) {
        showError('Erro ao carregar dias de trabalho: ' + (errDias || errPag)?.message);
        return;
      }

      const mapa: Record<string, number> = {};
      (diasData || []).forEach((d: any) => { mapa[d.data] = Number(d.fracao); });
      setDiasDoMes(mapa);
      setMesPago(!!pagamentoData?.pago);
    } finally {
      setLoadingDias(false);
      isFetchingRef.current = false;
      if (fetchPendingRef.current) {
        fetchPendingRef.current = false;
        fetchDiasDoMes();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfessorId, centroId, ano, mes, mesStr]);

  useEffect(() => { fetchDiasDoMes(); }, [fetchDiasDoMes]);

  const handleClicarDia = async (dataISO: string) => {
    if (!selectedProfessorId || !centroId || mesPago) return;
    const fracaoAtual = diasDoMes[dataISO];
    // Ciclo: vazio -> 0.5 -> 1 -> vazio
    const proxima = fracaoAtual === undefined ? 0.5 : fracaoAtual === 0.5 ? 1 : null;

    if (proxima === null) {
      const { error } = await supabase
        .from('dias_trabalho_professor')
        .delete()
        .eq('centro_id', centroId)
        .eq('professor_id', selectedProfessorId)
        .eq('data', dataISO);
      if (error) {
        showError(error.message);
        return;
      }
      setDiasDoMes((prev) => {
        const next = { ...prev };
        delete next[dataISO];
        return next;
      });
    } else {
      // Nunca enviar marcado_por — o gatilho preenche-o no servidor.
      const { error } = await supabase
        .from('dias_trabalho_professor')
        .upsert(
          { centro_id: centroId, professor_id: selectedProfessorId, data: dataISO, fracao: proxima },
          { onConflict: 'professor_id,data' }
        );
      if (error) {
        showError(error.message);
        return;
      }
      setDiasDoMes((prev) => ({ ...prev, [dataISO]: proxima }));
    }
  };

  const professorSelecionado = professores.find((p) => p.id === selectedProfessorId);
  const professorEhSalario = selectedProfessorId ? tipoPorProfessor[selectedProfessorId] === 'salario' : false;
  const somaDias = Object.values(diasDoMes).reduce((acc, f) => acc + f, 0);

  const inicioGrelha = startOfWeek(currentMonth, { weekStartsOn: 1 });
  const fimMesDate = new Date(ano, mes - 1 + 1, 0);
  const fimGrelha = endOfWeek(fimMesDate, { weekStartsOn: 1 });
  const diasGrelha = eachDayOfInterval({ start: inicioGrelha, end: fimGrelha });

  return (
    <main className="min-h-screen bg-page text-primary p-6 md:p-8 max-w-4xl mx-auto font-sans">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/equipa" className="p-3 bg-surface border border-border rounded-2xl hover:bg-raised transition-colors">
            <ArrowLeft size={20} className="text-secondary" />
          </Link>
          <div>
            <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter uppercase flex items-center gap-3">
              <CalendarClock className="text-accent" /> Dias de Trabalho
            </h1>
            <p className="text-muted text-[10px] font-black uppercase tracking-widest mt-1">Professores Variáveis</p>
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

      <div className="bg-surface border border-border rounded-3xl p-6 mb-6">
        <label className="text-[10px] font-black uppercase tracking-widest text-muted mb-2 block">Professor</label>
        {loadingProfessores ? (
          <Loader2 className="animate-spin text-accent" size={20} />
        ) : (
          <select
            value={selectedProfessorId || ''}
            onChange={(e) => setSelectedProfessorId(e.target.value)}
            className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent"
          >
            {professores.length === 0 && <option value="">Sem professores</option>}
            {professores.map((p) => (
              <option key={p.id} value={p.id} disabled={tipoPorProfessor[p.id] === 'salario'}>
                {p.name}{tipoPorProfessor[p.id] === 'salario' ? ' (salário — sem dias)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {professorEhSalario ? (
        <div className="bg-surface/70 border-2 border-dashed border-border p-12 rounded-[3rem] text-center flex flex-col items-center">
          <AlertTriangle size={40} className="mb-4 text-muted" />
          <p className="text-muted font-bold">
            {professorSelecionado?.name} está de salário em {format(currentMonth, 'MMMM yyyy', { locale: pt })} — não marca dias de trabalho.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-4xl overflow-hidden shadow-2xl relative">
          {loadingDias && (
            <div className="absolute inset-0 bg-surface/80 backdrop-blur-sm flex items-center justify-center z-10">
              <Loader2 className="animate-spin text-accent" size={32} />
            </div>
          )}

          <div className="flex items-center justify-between p-6 border-b border-border">
            <p className="text-xs font-black uppercase tracking-widest text-muted">
              Soma do mês: <span className="text-primary">{somaDias.toFixed(1)} {somaDias === 1 ? 'dia' : 'dias'}</span>
            </p>
            {mesPago && (
              <p className="text-[10px] font-black uppercase tracking-widest text-warning flex items-center gap-1.5">
                <Lock size={12} /> Mês pago — desmarca o pagamento em Pagamentos para corrigir
              </p>
            )}
          </div>

          <div className="p-6">
            <div className="grid grid-cols-7 gap-2 mb-2">
              {DIAS_SEMANA.map((d) => (
                <div key={d} className="text-center text-[10px] font-black uppercase text-muted">{d}</div>
              ))}
            </div>
            <div className={`grid grid-cols-7 gap-2 ${mesPago ? 'opacity-40' : ''}`}>
              {diasGrelha.map((dia) => {
                const dataISO = format(dia, 'yyyy-MM-dd');
                const dentroDoMes = isSameMonth(dia, currentMonth);
                const fracao = diasDoMes[dataISO];
                return (
                  <button
                    key={dataISO}
                    type="button"
                    disabled={!dentroDoMes || mesPago}
                    onClick={() => handleClicarDia(dataISO)}
                    className={`aspect-square rounded-xl border text-sm font-bold transition-all flex flex-col items-center justify-center gap-0.5 ${
                      !dentroDoMes
                        ? 'border-transparent text-transparent cursor-default'
                        : fracao === 1
                        ? 'bg-accent text-on-accent border-accent'
                        : fracao === 0.5
                        ? 'bg-accent/30 text-primary border-accent/40'
                        : 'bg-page border-border text-secondary hover:border-accent/50'
                    } ${mesPago ? 'cursor-not-allowed' : 'cursor-pointer active:scale-95'}`}
                  >
                    {dentroDoMes && <span>{format(dia, 'd')}</span>}
                    {dentroDoMes && fracao && <span className="text-[9px] font-black">{fracao === 1 ? '●' : '◐'}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <StatusToast toast={toast} />
    </main>
  );
}

export default function DiasTrabalhoPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>}>
      <DiasTrabalhoContent />
    </Suspense>
  );
}
