'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { getHojeLisboa, horaLisboaDe, dataLisboaDe } from '@/lib/dataLisboa';
import { type PeriodoCustoFixo } from '@/lib/custos';
import { tipoNoMes } from '@/lib/remuneracaoProfessores';
import { janelaMesLisboa, somaMinutosFechados, formatarDuracao, type RegistoHoraProfessor } from '@/lib/registosHoras';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Loader2, Clock, AlertTriangle, Lock, Plus, Pencil, Trash2, Save, X,
} from 'lucide-react';
import { startOfMonth, addMonths, format } from 'date-fns';
import { pt } from 'date-fns/locale';

function HorasTrabalhoContent() {
  const { toast, showError, showSuccess } = useStatusToast();
  const searchParams = useSearchParams();
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
  const [selectedProfessorId, setSelectedProfessorId] = useState<string | null>(null);
  const [loadingProfessores, setLoadingProfessores] = useState(true);

  const [tipoNoMesSelecionado, setTipoNoMesSelecionado] = useState<'salario' | 'variavel'>('variavel');
  const [registos, setRegistos] = useState<RegistoHoraProfessor[]>([]);
  const [mesPago, setMesPago] = useState(false);
  const [loadingRegistos, setLoadingRegistos] = useState(false);

  const [formAbertoNovo, setFormAbertoNovo] = useState(false);
  const [novoDia, setNovoDia] = useState('');
  const [novoEntrada, setNovoEntrada] = useState('');
  const [novoSaida, setNovoSaida] = useState('');

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editDia, setEditDia] = useState('');
  const [editEntrada, setEditEntrada] = useState('');
  const [editSaida, setEditSaida] = useState('');

  const [salvando, setSalvando] = useState(false);

  const ano = currentMonth.getFullYear();
  const mes = currentMonth.getMonth() + 1;
  const mesStr = `${ano}-${String(mes).padStart(2, '0')}`;

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCentroId(user?.app_metadata?.centro_id ?? null);
    });
  }, []);

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

      const professorParam = searchParams.get('professor');
      if (!professorParamAplicadoRef.current && professorParam) {
        professorParamAplicadoRef.current = true;
        if ((staffData || []).some((p) => p.id === professorParam)) {
          setSelectedProfessorId(professorParam);
          setLoadingProfessores(false);
          return;
        }
      }

      setSelectedProfessorId((atual) => atual ?? (staffData || [])[0]?.id ?? null);
      setLoadingProfessores(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centroId]);

  // Tipo implícito (salário/variável) do professor selecionado, no mês selecionado.
  useEffect(() => {
    if (!selectedProfessorId) return;
    (async () => {
      const { data } = await supabase
        .from('periodos_valor_professor')
        .select('de, ate, valor')
        .eq('professor_id', selectedProfessorId)
        .eq('tipo', 'salario');
      const periodos: PeriodoCustoFixo[] = (data || []).map((p: any) => ({ de: p.de, ate: p.ate, valor: Number(p.valor) }));
      setTipoNoMesSelecionado(tipoNoMes(periodos, mesStr));
    })();
  }, [selectedProfessorId, mesStr]);

  const isFetchingRef = useRef(false);
  const fetchPendingRef = useRef(false);

  const fetchRegistos = useCallback(async () => {
    if (!selectedProfessorId || !centroId) {
      setRegistos([]);
      setMesPago(false);
      return;
    }
    if (isFetchingRef.current) {
      fetchPendingRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    setLoadingRegistos(true);
    try {
      const { inicio, fim } = janelaMesLisboa(mesStr);
      const [{ data: registosData, error: errRegistos }, { data: pagamentoData, error: errPag }] = await Promise.all([
        supabase
          .from('registos_horas_professor')
          .select('id, professor_id, entrada, saida, minutos, origem')
          .eq('centro_id', centroId)
          .eq('professor_id', selectedProfessorId)
          .gte('entrada', inicio)
          .lt('entrada', fim)
          .order('entrada', { ascending: true }),
        supabase
          .from('pagamentos_professores')
          .select('pago')
          .eq('centro_id', centroId)
          .eq('professor_id', selectedProfessorId)
          .eq('ano', ano)
          .eq('mes', mes)
          .maybeSingle(),
      ]);

      if (errRegistos || errPag) {
        showError('Erro ao carregar registos: ' + (errRegistos || errPag)?.message);
        return;
      }

      setRegistos(
        (registosData || []).map((r: any) => ({
          id: r.id,
          professorId: r.professor_id,
          entrada: r.entrada,
          saida: r.saida,
          minutos: r.minutos == null ? null : Number(r.minutos),
          origem: r.origem,
        }))
      );
      setMesPago(!!pagamentoData?.pago);
    } finally {
      setLoadingRegistos(false);
      isFetchingRef.current = false;
      if (fetchPendingRef.current) {
        fetchPendingRef.current = false;
        fetchRegistos();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfessorId, centroId, ano, mes, mesStr]);

  useEffect(() => { fetchRegistos(); }, [fetchRegistos]);

  const professorSelecionado = professores.find((p) => p.id === selectedProfessorId);
  const totalMinutos = somaMinutosFechados(registos);

  const fecharFormNovo = () => {
    setFormAbertoNovo(false);
    setNovoDia('');
    setNovoEntrada('');
    setNovoSaida('');
  };

  const handleAdicionarHoras = async () => {
    if (!selectedProfessorId || !novoDia || !novoEntrada || !novoSaida) {
      showError('Preenche o dia, a entrada e a saída.');
      return;
    }
    setSalvando(true);
    const { error } = await supabase.rpc('adicionar_horas_professor', {
      p_professor: selectedProfessorId,
      p_dia: novoDia,
      p_entrada: novoEntrada,
      p_saida: novoSaida,
    });
    setSalvando(false);
    if (error) {
      showError(error.message);
      return;
    }
    showSuccess('Horas adicionadas.');
    fecharFormNovo();
    fetchRegistos();
  };

  const abrirEdicao = (r: RegistoHoraProfessor) => {
    setEditandoId(r.id);
    setEditDia(dataLisboaDe(r.entrada));
    setEditEntrada(horaLisboaDe(r.entrada));
    setEditSaida(r.saida ? horaLisboaDe(r.saida) : '');
  };

  const fecharEdicao = () => {
    setEditandoId(null);
    setEditDia('');
    setEditEntrada('');
    setEditSaida('');
  };

  const handleCorrigir = async () => {
    if (!editandoId || !editDia || !editEntrada || !editSaida) {
      showError('Preenche o dia, a entrada e a saída.');
      return;
    }
    setSalvando(true);
    const { error } = await supabase.rpc('corrigir_horas_professor', {
      p_id: editandoId,
      p_dia: editDia,
      p_entrada: editEntrada,
      p_saida: editSaida,
    });
    setSalvando(false);
    if (error) {
      showError(error.message);
      return;
    }
    showSuccess('Registo corrigido.');
    fecharEdicao();
    fetchRegistos();
  };

  const handleApagar = async (id: string) => {
    if (!confirm('Apagar este registo de horas? Esta ação não pode ser desfeita.')) return;
    const { error } = await supabase.rpc('apagar_horas_professor', { p_id: id });
    if (error) {
      showError(error.message);
      return;
    }
    showSuccess('Registo apagado.');
    fetchRegistos();
  };

  return (
    <main className="min-h-screen bg-page text-primary p-6 md:p-8 max-w-4xl mx-auto font-sans">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/equipa" className="p-3 bg-surface border border-border rounded-2xl hover:bg-raised transition-colors">
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
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        {tipoNoMesSelecionado === 'salario' && (
          <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mt-3">
            Registo de presença: não entra no pagamento
          </p>
        )}
      </div>

      <div className="bg-surface border border-border rounded-3xl p-6 mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-1">Total do Mês</p>
          <p className="text-2xl font-black text-primary tracking-tighter">{formatarDuracao(totalMinutos)}</p>
        </div>
        {mesPago ? (
          <p className="text-[10px] font-black uppercase tracking-widest text-warning flex items-center gap-1.5">
            <Lock size={12} /> Mês pago — desmarca o pagamento em Pagamentos para corrigir
          </p>
        ) : (
          !formAbertoNovo && (
            <button
              type="button"
              onClick={() => { setFormAbertoNovo(true); setNovoDia(getHojeLisboa()); }}
              className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-on-accent px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
            >
              <Plus size={14} /> Adicionar Horas
            </button>
          )
        )}
      </div>

      {formAbertoNovo && !mesPago && (
        <div className="bg-surface border border-border rounded-3xl p-6 mb-6 space-y-3">
          <h3 className="text-xs font-black uppercase text-muted tracking-widest">Adicionar Horas de {professorSelecionado?.name}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-muted uppercase ml-1">Dia</label>
              <input type="date" value={novoDia} onChange={(e) => setNovoDia(e.target.value)} className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-muted uppercase ml-1">Entrada</label>
              <input type="time" value={novoEntrada} onChange={(e) => setNovoEntrada(e.target.value)} className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-muted uppercase ml-1">Saída</label>
              <input type="time" value={novoSaida} onChange={(e) => setNovoSaida(e.target.value)} className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleAdicionarHoras} disabled={salvando} className="flex-1 bg-accent hover:bg-accent-hover text-on-accent text-xs font-black py-2.5 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5">
              {salvando ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Guardar
            </button>
            <button type="button" onClick={fecharFormNovo} disabled={salvando} className="px-4 text-xs font-black text-muted hover:text-secondary">Cancelar</button>
          </div>
        </div>
      )}

      <div className="bg-surface border border-border rounded-4xl overflow-hidden shadow-2xl relative min-h-32">
        {loadingRegistos && (
          <div className="absolute inset-0 bg-surface/80 backdrop-blur-sm flex items-center justify-center z-10">
            <Loader2 className="animate-spin text-accent" size={28} />
          </div>
        )}
        {!loadingRegistos && registos.length === 0 ? (
          <div className="p-12 text-center text-muted font-medium italic">
            <Clock size={40} className="mx-auto mb-3 opacity-20" />
            Sem registos este mês.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {registos.map((r) => (
              <div key={r.id} className="p-5">
                {editandoId === r.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-muted uppercase ml-1">Dia</label>
                        <input type="date" value={editDia} onChange={(e) => setEditDia(e.target.value)} className="w-full bg-page border border-border text-primary p-2.5 rounded-lg outline-none focus:border-accent mt-1 text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-muted uppercase ml-1">Entrada</label>
                        <input type="time" value={editEntrada} onChange={(e) => setEditEntrada(e.target.value)} className="w-full bg-page border border-border text-primary p-2.5 rounded-lg outline-none focus:border-accent mt-1 text-sm" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-muted uppercase ml-1">Saída</label>
                        <input type="time" value={editSaida} onChange={(e) => setEditSaida(e.target.value)} className="w-full bg-page border border-border text-primary p-2.5 rounded-lg outline-none focus:border-accent mt-1 text-sm" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleCorrigir} disabled={salvando} className="flex-1 bg-accent hover:bg-accent-hover text-on-accent text-xs font-black py-2 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5">
                        {salvando ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Guardar
                      </button>
                      <button type="button" onClick={fecharEdicao} disabled={salvando} className="px-3 text-xs font-black text-muted hover:text-secondary flex items-center gap-1">
                        <X size={14} /> Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-primary">
                        {format(new Date(`${dataLisboaDe(r.entrada)}T00:00:00`), "d 'de' MMMM", { locale: pt })}
                      </p>
                      {r.saida ? (
                        <p className="text-xs text-secondary font-bold mt-0.5">
                          {horaLisboaDe(r.entrada)} às {horaLisboaDe(r.saida)} · conta {formatarDuracao(r.minutos ?? 0)}
                        </p>
                      ) : (
                        <p className="text-xs text-warning font-bold mt-0.5 flex items-center gap-1">
                          <AlertTriangle size={11} /> em aberto desde {horaLisboaDe(r.entrada)}
                        </p>
                      )}
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-border/40 text-muted border border-border rounded-md inline-block mt-1.5">
                        {r.origem === 'toque' ? 'toque' : r.origem === 'manual' ? 'manual' : 'direção'}
                      </span>
                    </div>
                    {!mesPago && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => abrirEdicao(r)} className="p-2 text-muted hover:text-accent transition-colors">
                          <Pencil size={16} />
                        </button>
                        <button type="button" onClick={() => handleApagar(r.id)} className="p-2 text-muted hover:text-danger transition-colors">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </div>
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

export default function HorasTrabalhoPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>}>
      <HorasTrabalhoContent />
    </Suspense>
  );
}
