'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { getHojeLisboa } from '@/lib/dataLisboa';
import { disciplinasComuns } from '@/lib/disciplinas';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import {
  ArrowLeft, ListTree, Plus, X, Loader2, Search, Users, ShieldAlert, Pause, CalendarX2, Trash2,
} from 'lucide-react';

const DIAS_SEMANA = [
  { valor: 1, label: 'Seg' },
  { valor: 2, label: 'Ter' },
  { valor: 3, label: 'Qua' },
  { valor: 4, label: 'Qui' },
  { valor: 5, label: 'Sex' },
  { valor: 6, label: 'Sáb' },
  { valor: 7, label: 'Dom' },
];
const DIA_SEMANA_LABEL: Record<number, string> = Object.fromEntries(DIAS_SEMANA.map((d) => [d.valor, d.label]));

const rotuloAluno = (nome: string, anoEscolar: number | null | undefined) =>
  anoEscolar ? `${nome} · ${anoEscolar}.º ano` : nome;

function formatarDataCurta(dataISO: string | null | undefined): string {
  if (!dataISO) return '—';
  return format(new Date(`${dataISO}T00:00:00`), "d 'de' MMM", { locale: pt });
}

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
        showError('Não foi possível carregar as séries: ' + error.message);
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
        supabase.from('alunos').select('id, nome, ano_escolar').eq('ativo', true).order('nome'),
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
            <ListTree className="text-accent" /> Séries
          </h1>
          <p className="text-muted text-[10px] font-black uppercase tracking-widest mt-1">Explicações Fixas</p>
        </div>
      </div>

      <div className="bg-surface border border-border/60 rounded-[2.5rem] shadow-2xl p-6 md:p-8 mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-primary font-black uppercase text-sm tracking-widest">Nova Série</h2>
          <button
            type="button"
            aria-label="Nova série"
            onClick={() => setMostrarNovaSerie((v) => !v)}
            className={`p-2 rounded-xl border transition-all active:scale-90 ${mostrarNovaSerie ? 'bg-border text-primary border-border' : 'bg-accent-soft text-accent border-accent/20 hover:bg-accent hover:text-on-accent'}`}
          >
            <Plus size={20} />
          </button>
        </div>

        {mostrarNovaSerie && (
          <FormNovaSerie
            centroId={centroId!}
            professores={professores}
            subjects={subjects}
            alunosAtivos={alunosAtivos}
            showError={showError}
            onCreated={() => {
              setMostrarNovaSerie(false);
              showSuccess('Série criada.');
              if (centroId) carregarSeries(centroId);
            }}
            onCancel={() => setMostrarNovaSerie(false)}
          />
        )}
      </div>

      {loadingSeries ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent" size={28} /></div>
      ) : series.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border/50 rounded-[2rem]">
          <p className="text-muted font-bold uppercase text-[10px] tracking-widest">Sem séries criadas</p>
        </div>
      ) : (
        <div className="space-y-4">
          {series.map((serie) => (
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

      <StatusToast toast={toast} />
    </main>
  );
}

function FormNovaSerie({ centroId, professores, subjects, alunosAtivos, showError, onCreated, onCancel }: any) {
  const [professorId, setProfessorId] = useState('');
  const [disciplinaId, setDisciplinaId] = useState('');
  const [diaSemana, setDiaSemana] = useState<number | null>(null);
  const [horaInicio, setHoraInicio] = useState('');
  const [duracaoHoras, setDuracaoHoras] = useState('');
  const [alunoIds, setAlunoIds] = useState<string[]>([]);
  const [buscaAluno, setBuscaAluno] = useState('');
  const [dataInicio, setDataInicio] = useState(() => getHojeLisboa());
  const [dataFim, setDataFim] = useState('');
  const [criando, setCriando] = useState(false);

  const toggleAluno = (id: string) => {
    const jaSelecionado = alunoIds.includes(id);
    if (!jaSelecionado && alunoIds.length > 0) {
      const anoDoGrupo = alunosAtivos.find((a: any) => a.id === alunoIds[0])?.ano_escolar;
      const anoDoNovo = alunosAtivos.find((a: any) => a.id === id)?.ano_escolar;
      if (anoDoGrupo != null && anoDoNovo !== anoDoGrupo) {
        showError('Todos os alunos de uma série têm de ser do mesmo ano escolar.');
        return;
      }
    }
    setAlunoIds((prev) => (jaSelecionado ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const alunosFiltrados = alunosAtivos.filter((a: any) => a.nome.toLowerCase().includes(buscaAluno.toLowerCase()));
  const disciplinasComunsSerie = disciplinasComuns(
    subjects,
    alunoIds.map((id) => alunosAtivos.find((a: any) => a.id === id)?.ano_escolar)
  );

  useEffect(() => {
    if (disciplinaId && !disciplinasComunsSerie.some((s: any) => String(s.id) === disciplinaId)) {
      setDisciplinaId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alunoIds]);

  const handleCriar = async () => {
    if (!professorId) return showError('Escolhe o professor.');
    if (diaSemana == null) return showError('Escolhe o dia da semana.');
    if (!horaInicio) return showError('Indica a hora de início.');
    const duracaoNum = parseFloat(duracaoHoras);
    if (isNaN(duracaoNum) || duracaoNum <= 0) return showError('Indica uma duração válida.');
    if (alunoIds.length === 0) return showError('Escolhe pelo menos um aluno.');
    if (!dataInicio) return showError('Escolhe a data de início.');

    setCriando(true);
    try {
      const { error } = await supabase.rpc('criar_serie_explicacao', {
        p_professor: professorId,
        p_disciplina: disciplinaId ? Number(disciplinaId) : null,
        p_dia: diaSemana,
        p_hora: `${horaInicio}:00`,
        p_duracao: duracaoNum,
        p_alunos: alunoIds,
        p_inicio: dataInicio,
        p_fim: dataFim || null,
      });
      if (error) {
        showError(error.message);
        return;
      }
      onCreated();
    } finally {
      setCriando(false);
    }
  };

  return (
    <div className="mt-4 bg-page/50 border border-border rounded-3xl p-5 space-y-4">
      <div>
        <label className="text-[9px] font-black text-muted uppercase ml-1">Professor</label>
        <select
          aria-label="Professor"
          value={professorId}
          onChange={(e) => setProfessorId(e.target.value)}
          className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-accent outline-none transition-all appearance-none mt-1"
        >
          <option value="">Escolhe...</option>
          {professores.map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-[9px] font-black text-muted uppercase ml-1 flex items-center gap-1.5">
          <Users size={12} /> Aluno(s)
        </label>
        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
          <input
            type="text"
            placeholder="Pesquisar aluno..."
            value={buscaAluno}
            onChange={(e) => setBuscaAluno(e.target.value)}
            className="w-full bg-surface border border-border text-primary pl-9 pr-3 py-2.5 rounded-xl outline-none focus:border-accent text-sm"
          />
        </div>
        <div className="max-h-40 overflow-y-auto mt-2 space-y-1 border border-border rounded-xl p-2">
          {alunosFiltrados.length === 0 ? (
            <p className="text-xs text-muted italic p-2">Nenhum aluno encontrado.</p>
          ) : (
            alunosFiltrados.map((aluno: any) => {
              const selecionado = alunoIds.includes(aluno.id);
              return (
                <button
                  key={aluno.id}
                  type="button"
                  onClick={() => toggleAluno(aluno.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                    selecionado ? 'bg-accent text-on-accent' : 'bg-page text-primary hover:bg-raised'
                  }`}
                >
                  {rotuloAluno(aluno.nome, aluno.ano_escolar)}
                </button>
              );
            })
          )}
        </div>
        {alunoIds.length > 0 && (
          <p className="text-[10px] text-accent font-bold mt-1.5">{alunoIds.length} selecionado(s)</p>
        )}
      </div>

      <div>
        <label className="text-[9px] font-black text-muted uppercase ml-1">Dia da semana</label>
        <div className="grid grid-cols-7 gap-1.5 mt-1">
          {DIAS_SEMANA.map((d) => (
            <button
              key={d.valor}
              type="button"
              onClick={() => setDiaSemana(d.valor)}
              className={`py-2.5 rounded-xl text-[11px] font-black uppercase transition-all border ${
                diaSemana === d.valor ? 'bg-accent text-on-accent border-accent' : 'bg-surface border-border text-secondary hover:border-accent/40'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 space-y-1">
          <label className="text-[9px] font-black text-muted uppercase ml-1">Hora de início</label>
          <input
            type="time"
            aria-label="Hora de início"
            value={horaInicio}
            onChange={(e) => setHoraInicio(e.target.value)}
            className="w-full bg-surface border border-border text-primary p-3 rounded-2xl text-sm font-bold focus:border-accent outline-none transition-all"
          />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-[9px] font-black text-muted uppercase ml-1">Duração (horas)</label>
          <input
            type="number"
            step="0.25"
            min="0"
            aria-label="Duração (horas)"
            value={duracaoHoras}
            onChange={(e) => setDuracaoHoras(e.target.value)}
            placeholder="Ex: 1.5"
            className="w-full bg-surface border border-border text-primary p-3 rounded-2xl text-sm font-bold focus:border-accent outline-none transition-all"
          />
        </div>
      </div>

      <div>
        <label className="text-[9px] font-black text-muted uppercase ml-1">Disciplina (opcional)</label>
        <select
          aria-label="Disciplina (opcional)"
          value={disciplinaId}
          onChange={(e) => setDisciplinaId(e.target.value)}
          className="w-full bg-surface border border-border text-primary p-3 rounded-2xl text-sm font-bold focus:border-accent outline-none transition-all appearance-none mt-1"
        >
          <option value="">Sem disciplina</option>
          {disciplinasComunsSerie.map((s: any) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 space-y-1">
          <label className="text-[9px] font-black text-muted uppercase ml-1">Início</label>
          <input
            type="date"
            aria-label="Início"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="w-full bg-surface border border-border text-primary p-3 rounded-2xl text-sm font-bold focus:border-accent outline-none transition-all"
          />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-[9px] font-black text-muted uppercase ml-1">Fim (opcional)</label>
          <input
            type="date"
            aria-label="Fim (opcional)"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="w-full bg-surface border border-border text-primary p-3 rounded-2xl text-sm font-bold focus:border-accent outline-none transition-all"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleCriar}
          disabled={criando}
          className="flex-1 py-3 bg-accent hover:bg-accent-hover text-on-accent rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
        >
          {criando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Criar Série
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={criando}
          className="px-5 py-3 bg-raised hover:bg-border rounded-2xl font-black text-sm transition-all active:scale-95"
        >
          Cancelar
        </button>
      </div>
    </div>
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

  const nAlunos = (serie.series_explicacoes_alunos || []).length;
  const nomesAlunos = (serie.series_explicacoes_alunos || [])
    .map((sa: any) => (Array.isArray(sa.alunos) ? sa.alunos[0] : sa.alunos))
    .filter(Boolean)
    .map((a: any) => rotuloAluno(a.nome, a.ano_escolar))
    .join(', ');

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
      showSuccess('Série pausada.');
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
      showSuccess('Série terminada a partir dessa data.');
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
