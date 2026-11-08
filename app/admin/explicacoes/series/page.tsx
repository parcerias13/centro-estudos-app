'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { getHojeLisboa } from '@/lib/dataLisboa';
import {
  ArrowLeft, ListTree, Plus, Loader2, ShieldAlert, Pause, CalendarX2, Trash2,
  CheckCheck, XCircle, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  DIA_SEMANA_LABEL, formatarDataCurta, formatarDataHoraCurta, nomesEAlunosDaSerie,
  FormularioSerie,
} from '../_shared/fixasShared';

export default function SeriesExplicacoesPage() {
  const { toast, showError, showSuccess } = useStatusToast();

  const [loadingPagina, setLoadingPagina] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [centroId, setCentroId] = useState<string | null>(null);

  const [professores, setProfessores] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [alunosAtivos, setAlunosAtivos] = useState<any[]>([]);

  const [series, setSeries] = useState<any[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(true);

  const [mostrarNovaSerie, setMostrarNovaSerie] = useState(false);
  const [recusadasAbertas, setRecusadasAbertas] = useState(false);
  const [processandoValidacaoId, setProcessandoValidacaoId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setRole(user?.app_metadata?.role?.toLowerCase() ?? null);
      setCentroId(user?.app_metadata?.centro_id ?? null);
      setLoadingPagina(false);
    });
  }, []);

  const carregarSeries = useCallback(async (centro_id: string) => {
    setLoadingSeries(true);
    try {
      const { data, error } = await supabase
        .from('series_explicacoes')
        .select('*, staff!professor_id(name), subjects(name), series_explicacoes_alunos(aluno_id, alunos(nome, ano_escolar)), series_explicacoes_pausas(id, de, ate)')
        .eq('centro_id', centro_id)
        .order('dia_semana', { ascending: true })
        .order('hora_inicio', { ascending: true });
      if (error) {
        showError('Não foi possível carregar as explicações fixas: ' + error.message);
        return;
      }
      setSeries(data || []);
    } finally {
      setLoadingSeries(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showError]);

  useEffect(() => {
    if (!centroId || role !== 'admin') return;
    (async () => {
      const [{ data: profData }, { data: subData }, { data: alunosData }] = await Promise.all([
        supabase.from('staff').select('id, name').eq('role', 'professor').order('name'),
        supabase.from('subjects').select('id, name, centro_id, anos_aplicaveis').eq('centro_id', centroId).order('name'),
        supabase.from('alunos').select('id, nome, ano_escolar, sala_estudo, faz_explicacoes').eq('ativo', true).order('nome'),
      ]);
      setProfessores(profData || []);
      setSubjects(subData || []);
      setAlunosAtivos(alunosData || []);
      carregarSeries(centroId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centroId, role]);

  const nomeProfessor = (professorId: string) => professores.find((p) => p.id === professorId)?.name
    || series.find((s) => s.professor_id === professorId)?.staff?.name
    || '—';

  // A mesma lista `series` (carregarSeries, sem filtro de estado) dividida
  // em três — nunca três pedidos separados, para as contagens nunca
  // divergirem entre si.
  const porValidar = series.filter((s) => s.estado_validacao === 'por_validar');
  const validadas = series.filter((s) => s.estado_validacao !== 'por_validar' && s.estado_validacao !== 'recusada');
  const recusadas = series.filter((s) => s.estado_validacao === 'recusada');

  const handleValidar = async (serieId: string) => {
    setProcessandoValidacaoId(serieId);
    try {
      const { error } = await supabase.rpc('validar_serie', { p_serie: serieId });
      if (error) { showError(error.message); return; }
      showSuccess('Explicação fixa validada.');
      if (centroId) carregarSeries(centroId);
    } finally {
      setProcessandoValidacaoId(null);
    }
  };

  const handleRecusar = async (serieId: string) => {
    if (!confirm('Recusar remove as sessões futuras ainda não dadas desta explicação fixa.')) return;
    setProcessandoValidacaoId(serieId);
    try {
      const { data, error } = await supabase.rpc('recusar_serie', { p_serie: serieId });
      if (error) { showError(error.message); return; }
      showSuccess(`Explicação fixa recusada.${typeof data === 'number' ? ` ${data} sessão(ões) futura(s) removida(s).` : ''}`);
      if (centroId) carregarSeries(centroId);
    } finally {
      setProcessandoValidacaoId(null);
    }
  };

  if (loadingPagina) {
    return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  if (role !== 'admin') {
    return (
      <div className="min-h-screen bg-page flex flex-col items-center justify-center p-8 text-center">
        <ShieldAlert size={64} className="text-danger mb-4" />
        <h1 className="text-2xl font-black uppercase italic">Acesso Restrito</h1>
        <p className="text-muted mt-2">Área reservada a administradores.</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-page text-primary p-6 md:p-8 max-w-5xl mx-auto font-sans">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin/explicacoes" className="p-3 bg-surface border border-border rounded-2xl hover:bg-raised transition-colors">
          <ArrowLeft size={20} className="text-secondary" />
        </Link>
        <div>
          <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter uppercase flex items-center gap-3">
            <ListTree className="text-accent" /> Fixas
          </h1>
          <p className="text-muted text-[10px] font-black uppercase tracking-widest mt-1">Explicações Fixas</p>
        </div>
      </div>

      {!loadingSeries && porValidar.length > 0 && (
        <div className="bg-warning-bg border border-warning/20 rounded-[2rem] p-6 md:p-8 mb-8 space-y-4">
          <h2 className="text-warning font-black uppercase text-sm tracking-widest flex items-center gap-2">
            <ShieldAlert size={16} /> Por validar · {porValidar.length}
          </h2>
          <div className="space-y-3">
            {porValidar.map((serie) => {
              const { nAlunos, nomesAlunos } = nomesEAlunosDaSerie(serie);
              const processando = processandoValidacaoId === serie.id;
              return (
                <div key={serie.id} data-serie-porvalidar={serie.id} className="bg-surface border border-warning/30 rounded-3xl p-5 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black text-primary break-words">{nomeProfessor(serie.professor_id)}</p>
                    <p className="text-xs text-secondary font-bold mt-0.5 break-words">
                      {serie.subjects?.name || 'Sem disciplina'} · {DIA_SEMANA_LABEL[serie.dia_semana] || '—'} · {serie.hora_inicio?.slice(0, 5)} · {Number(serie.duracao_horas)}h
                    </p>
                    <p className="text-xs text-muted mt-0.5 break-words">{nomesAlunos || `${nAlunos} aluno(s)`}</p>
                    <p className="text-[10px] text-muted font-bold mt-1">
                      {formatarDataCurta(serie.data_inicio)} → {serie.data_fim ? formatarDataCurta(serie.data_fim) : 'sem fim'}
                    </p>
                    <p className="text-[10px] text-muted mt-1">Criada {formatarDataHoraCurta(serie.created_at)}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleValidar(serie.id)}
                      disabled={processando}
                      className="flex items-center gap-1.5 bg-success-bg text-success border border-success/30 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
                    >
                      {processando ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={12} />} Validar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRecusar(serie.id)}
                      disabled={processando}
                      className="flex items-center gap-1.5 bg-page border border-border text-danger px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
                    >
                      {processando ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Recusar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-surface border border-border/60 rounded-[2.5rem] shadow-2xl p-6 md:p-8 mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-primary font-black uppercase text-sm tracking-widest">Nova Explicação Fixa</h2>
          <button
            type="button"
            aria-label="Nova explicação fixa"
            onClick={() => setMostrarNovaSerie((v) => !v)}
            className={`p-2 rounded-xl border transition-all active:scale-90 ${mostrarNovaSerie ? 'bg-border text-primary border-border' : 'bg-accent-soft text-accent border-accent/20 hover:bg-accent hover:text-on-accent'}`}
          >
            <Plus size={20} />
          </button>
        </div>

        {mostrarNovaSerie && (
          <FormularioSerie
            modo="admin"
            professores={professores}
            subjects={subjects}
            alunosAtivos={alunosAtivos}
            showError={showError}
            onCreated={() => {
              setMostrarNovaSerie(false);
              showSuccess('Explicação fixa criada.');
              if (centroId) carregarSeries(centroId);
            }}
            onCancel={() => setMostrarNovaSerie(false)}
          />
        )}
      </div>

      {loadingSeries ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent" size={28} /></div>
      ) : validadas.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border/50 rounded-[2rem]">
          <p className="text-muted font-bold uppercase text-[10px] tracking-widest">Sem explicações fixas criadas</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-muted font-bold uppercase text-[10px] tracking-widest px-1">Explicações fixas ativas</p>
          {validadas.map((serie) => (
            <CartaoSerie
              key={serie.id}
              serie={serie}
              nomeProfessor={nomeProfessor(serie.professor_id)}
              showError={showError}
              showSuccess={showSuccess}
              onAtualizado={() => { if (centroId) carregarSeries(centroId); }}
            />
          ))}
        </div>
      )}

      {!loadingSeries && recusadas.length > 0 && (
        <div className="mt-8 bg-surface border border-border/60 rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setRecusadasAbertas((v) => !v)}
            className="w-full flex items-center justify-between gap-2 p-4 text-muted"
          >
            <span className="font-black text-sm uppercase tracking-widest">Recusadas · {recusadas.length}</span>
            {recusadasAbertas ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {recusadasAbertas && (
            <div className="space-y-3 px-4 pb-4">
              {recusadas.map((serie) => {
                const { nAlunos, nomesAlunos } = nomesEAlunosDaSerie(serie);
                return (
                  <div key={serie.id} className="bg-page border border-border rounded-2xl p-4">
                    <p className="font-black text-primary break-words">{nomeProfessor(serie.professor_id)}</p>
                    <p className="text-xs text-secondary font-bold mt-0.5 break-words">
                      {serie.subjects?.name || 'Sem disciplina'} · {DIA_SEMANA_LABEL[serie.dia_semana] || '—'} · {serie.hora_inicio?.slice(0, 5)} · {Number(serie.duracao_horas)}h
                    </p>
                    <p className="text-xs text-muted mt-0.5 break-words">{nomesAlunos || `${nAlunos} aluno(s)`}</p>
                    <p className="text-[10px] text-muted font-bold mt-1">
                      {formatarDataCurta(serie.data_inicio)} → {serie.data_fim ? formatarDataCurta(serie.data_fim) : 'sem fim'}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <StatusToast toast={toast} />
    </main>
  );
}

function CartaoSerie({ serie, nomeProfessor, showError, showSuccess, onAtualizado }: any) {
  const [modoAberto, setModoAberto] = useState<'pausar' | 'terminar' | null>(null);
  const [pausarDe, setPausarDe] = useState('');
  const [pausarAte, setPausarAte] = useState('');
  const [contagemPausa, setContagemPausa] = useState<number | null>(null);
  const [calculandoContagem, setCalculandoContagem] = useState(false);
  const [terminarData, setTerminarData] = useState(() => getHojeLisboa());
  const [processando, setProcessando] = useState(false);

  const { nAlunos, nomesAlunos } = nomesEAlunosDaSerie(serie);

  // N (sessões ativas e não dadas da série no intervalo) recalcula sempre
  // que o intervalo muda — nunca mostra o aviso de pausa com um número de
  // uma seleção anterior.
  useEffect(() => {
    if (modoAberto !== 'pausar' || !pausarDe || !pausarAte) {
      setContagemPausa(null);
      return;
    }
    let ativo = true;
    setCalculandoContagem(true);
    (async () => {
      const { count, error } = await supabase
        .from('explicacoes')
        .select('id', { count: 'exact', head: true })
        .eq('serie_id', serie.id)
        .eq('estado', 'ativa')
        .eq('dado', false)
        .gte('data', pausarDe)
        .lte('data', pausarAte);
      if (!ativo) return;
      if (error) { showError('Erro ao calcular as sessões afetadas: ' + error.message); }
      else setContagemPausa(count ?? 0);
      setCalculandoContagem(false);
    })();
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoAberto, pausarDe, pausarAte, serie.id]);

  const abrirModo = (modo: 'pausar' | 'terminar') => {
    setPausarDe('');
    setPausarAte('');
    setContagemPausa(null);
    setTerminarData(getHojeLisboa());
    setModoAberto(modo);
  };

  const handlePausar = async () => {
    if (!pausarDe || !pausarAte) return showError('Escolhe o intervalo da pausa.');
    if (!confirm(`Isto vai cancelar ${contagemPausa ?? 0} sessões e avisar ${nAlunos} famílias, com uma só mensagem por aluno. Continuar?`)) return;
    setProcessando(true);
    try {
      const { error } = await supabase.rpc('pausar_serie', { p_serie: serie.id, p_de: pausarDe, p_ate: pausarAte });
      if (error) { showError(error.message); return; }
      showSuccess('Explicação fixa pausada.');
      setModoAberto(null);
      onAtualizado();
    } finally {
      setProcessando(false);
    }
  };

  const handleTerminar = async () => {
    if (!terminarData) return showError('Escolhe a data.');
    if (!confirm('Apaga as sessões futuras ainda não dadas a partir dessa data. Continuar?')) return;
    setProcessando(true);
    try {
      const { error } = await supabase.rpc('terminar_serie_a_partir_de', { p_serie: serie.id, p_data: terminarData });
      if (error) { showError(error.message); return; }
      showSuccess('Explicação fixa terminada a partir dessa data.');
      setModoAberto(null);
      onAtualizado();
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div data-serie-cartao={serie.id} className="bg-surface border border-border/60 rounded-3xl p-5 md:p-6 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black text-primary break-words">{nomeProfessor}</p>
          <p className="text-xs text-secondary font-bold mt-0.5 break-words">
            {serie.subjects?.name || 'Sem disciplina'} · {DIA_SEMANA_LABEL[serie.dia_semana] || '—'} · {serie.hora_inicio?.slice(0, 5)} · {Number(serie.duracao_horas)}h
          </p>
          <p className="text-xs text-muted mt-0.5 break-words">{nomesAlunos || `${nAlunos} aluno(s)`}</p>
          <p className="text-[10px] text-muted font-bold mt-1">
            {formatarDataCurta(serie.data_inicio)} → {serie.data_fim ? formatarDataCurta(serie.data_fim) : 'sem fim'}
          </p>
        </div>
        {modoAberto === null && (
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => abrirModo('pausar')}
              className="flex items-center gap-1.5 bg-page border border-border text-warning px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            >
              <Pause size={12} /> Pausar…
            </button>
            <button
              type="button"
              onClick={() => abrirModo('terminar')}
              className="flex items-center gap-1.5 bg-page border border-border text-danger px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
            >
              <CalendarX2 size={12} /> Terminar a partir de…
            </button>
          </div>
        )}
      </div>

      {serie.series_explicacoes_pausas?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {serie.series_explicacoes_pausas.map((p: any) => (
            <span key={p.id} className="text-[9px] font-bold text-muted bg-page border border-border/60 rounded-full px-2.5 py-1">
              Pausa: {formatarDataCurta(p.de)} a {formatarDataCurta(p.ate)}
            </span>
          ))}
        </div>
      )}

      {modoAberto === 'pausar' && (
        <div className="bg-page border border-border rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black text-muted uppercase ml-1">De</label>
              <input
                type="date"
                aria-label="Pausar de"
                value={pausarDe}
                onChange={(e) => setPausarDe(e.target.value)}
                className="w-full bg-surface border border-border text-primary p-2.5 rounded-xl text-sm font-bold focus:border-warning outline-none transition-all mt-1"
              />
            </div>
            <div>
              <label className="text-[9px] font-black text-muted uppercase ml-1">Até</label>
              <input
                type="date"
                aria-label="Pausar até"
                value={pausarAte}
                onChange={(e) => setPausarAte(e.target.value)}
                className="w-full bg-surface border border-border text-primary p-2.5 rounded-xl text-sm font-bold focus:border-warning outline-none transition-all mt-1"
              />
            </div>
          </div>
          {pausarDe && pausarAte && (
            <p className="text-xs text-warning font-bold">
              {calculandoContagem ? 'A calcular…' : `Isto vai cancelar ${contagemPausa ?? 0} sessões e avisar ${nAlunos} famílias, com uma só mensagem por aluno.`}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setModoAberto(null)} disabled={processando} className="px-4 py-2.5 bg-raised hover:bg-border rounded-xl font-black text-xs transition-all active:scale-95 disabled:opacity-50">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handlePausar}
              disabled={processando || calculandoContagem}
              className="flex-1 py-2.5 bg-warning hover:bg-warning-hover text-on-warning rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              {processando ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />} Confirmar Pausa
            </button>
          </div>
        </div>
      )}

      {modoAberto === 'terminar' && (
        <div className="bg-page border border-border rounded-2xl p-4 space-y-3">
          <div>
            <label className="text-[9px] font-black text-muted uppercase ml-1">Terminar a partir de</label>
            <input
              type="date"
              aria-label="Terminar a partir de"
              value={terminarData}
              onChange={(e) => setTerminarData(e.target.value)}
              className="w-full bg-surface border border-border text-primary p-2.5 rounded-xl text-sm font-bold focus:border-danger outline-none transition-all mt-1"
            />
          </div>
          <p className="text-xs text-danger font-bold">Apaga as sessões futuras ainda não dadas a partir dessa data.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setModoAberto(null)} disabled={processando} className="px-4 py-2.5 bg-raised hover:bg-border rounded-xl font-black text-xs transition-all active:scale-95 disabled:opacity-50">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleTerminar}
              disabled={processando}
              className="flex-1 py-2.5 bg-danger hover:bg-danger-hover text-on-danger rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              {processando ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Confirmar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
