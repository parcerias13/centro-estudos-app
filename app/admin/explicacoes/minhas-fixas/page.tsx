'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { getHojeLisboa } from '@/lib/dataLisboa';
import {
  ArrowLeft, ListTree, Plus, Loader2, ShieldAlert, CalendarX2, XCircle, Trash2,
} from 'lucide-react';
import {
  DIA_SEMANA_LABEL, formatarDataCurta, nomesEAlunosDaSerie,
  FormularioSerie, SeloEstadoSerie,
} from '../_shared/fixasShared';

export default function MinhasFixasPage() {
  const { toast, showError, showSuccess } = useStatusToast();

  const [loadingPagina, setLoadingPagina] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [centroId, setCentroId] = useState<string | null>(null);
  const [professorId, setProfessorId] = useState<string | null>(null);

  const [subjects, setSubjects] = useState<any[]>([]);
  const [alunosAtivos, setAlunosAtivos] = useState<any[]>([]);

  const [series, setSeries] = useState<any[]>([]);
  const [loadingSeries, setLoadingSeries] = useState(true);

  const [mostrarNovaSerie, setMostrarNovaSerie] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setRole(user?.app_metadata?.role?.toLowerCase() ?? null);
      setCentroId(user?.app_metadata?.centro_id ?? null);
      setProfessorId(user?.id ?? null);
      setLoadingPagina(false);
    });
  }, []);

  const carregarSeries = useCallback(async (professor_id: string) => {
    setLoadingSeries(true);
    try {
      const { data, error } = await supabase
        .from('series_explicacoes')
        .select('*, subjects(name), series_explicacoes_alunos(aluno_id, alunos(nome, ano_escolar)), series_explicacoes_pausas(id, de, ate)')
        .eq('professor_id', professor_id)
        .order('dia_semana', { ascending: true })
        .order('hora_inicio', { ascending: true });
      if (error) {
        showError('Não foi possível carregar as tuas explicações fixas: ' + error.message);
        return;
      }
      setSeries(data || []);
    } finally {
      setLoadingSeries(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showError]);

  useEffect(() => {
    if (!centroId || !professorId || role !== 'professor') return;
    (async () => {
      const [{ data: subData }, { data: alunosData }] = await Promise.all([
        supabase.from('subjects').select('id, name, centro_id, anos_aplicaveis').eq('centro_id', centroId).order('name'),
        supabase.from('alunos').select('id, nome, ano_escolar, sala_estudo, faz_explicacoes').eq('ativo', true).order('nome'),
      ]);
      setSubjects(subData || []);
      setAlunosAtivos(alunosData || []);
      carregarSeries(professorId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centroId, professorId, role]);

  if (loadingPagina) {
    return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  if (role !== 'professor') {
    return (
      <div className="min-h-screen bg-page flex flex-col items-center justify-center p-8 text-center">
        <ShieldAlert size={64} className="text-danger mb-4" />
        <h1 className="text-2xl font-black uppercase italic">Acesso Restrito</h1>
        <p className="text-muted mt-2">Área reservada a professores.</p>
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
            <ListTree className="text-accent" /> As Minhas Fixas
          </h1>
          <p className="text-muted text-[10px] font-black uppercase tracking-widest mt-1">Explicações Fixas</p>
        </div>
      </div>

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

        {mostrarNovaSerie && professorId && (
          <FormularioSerie
            modo="professor"
            professorFixo={professorId}
            subjects={subjects}
            alunosAtivos={alunosAtivos}
            showError={showError}
            onCreated={() => {
              setMostrarNovaSerie(false);
              showSuccess('Criada. Fica por validar pela direção; as sessões já estão na tua agenda.');
              carregarSeries(professorId);
            }}
            onCancel={() => setMostrarNovaSerie(false)}
          />
        )}
      </div>

      {loadingSeries ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent" size={28} /></div>
      ) : series.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-border/50 rounded-[2rem]">
          <p className="text-muted font-bold uppercase text-[10px] tracking-widest">Sem explicações fixas criadas</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-muted font-bold uppercase text-[10px] tracking-widest px-1">As minhas explicações fixas</p>
          {series.map((serie) => (
            <CartaoFixaProfessor
              key={serie.id}
              serie={serie}
              showError={showError}
              showSuccess={showSuccess}
              onAtualizado={() => { if (professorId) carregarSeries(professorId); }}
            />
          ))}
        </div>
      )}

      <StatusToast toast={toast} />
    </main>
  );
}

function CartaoFixaProfessor({ serie, showError, showSuccess, onAtualizado }: any) {
  const [modoAberto, setModoAberto] = useState<'terminar' | null>(null);
  const [terminarData, setTerminarData] = useState(() => getHojeLisboa());
  const [processando, setProcessando] = useState(false);

  const { nAlunos, nomesAlunos } = nomesEAlunosDaSerie(serie);
  const estado = serie.estado_validacao ?? 'validada';
  const porValidar = estado === 'por_validar';

  const abrirTerminar = () => {
    setTerminarData(getHojeLisboa());
    setModoAberto('terminar');
  };

  const handleRetirar = async () => {
    if (!confirm('Retirar remove as sessões futuras ainda não dadas.')) return;
    setProcessando(true);
    try {
      const { data, error } = await supabase.rpc('recusar_serie', { p_serie: serie.id });
      if (error) { showError(error.message); return; }
      showSuccess(`Explicação fixa retirada.${typeof data === 'number' ? ` ${data} sessão(ões) futura(s) removida(s).` : ''}`);
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
    <div data-serie-fixa-professor={serie.id} className="bg-surface border border-border/60 rounded-3xl p-5 md:p-6 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-secondary font-bold break-words">
            {serie.subjects?.name || 'Sem disciplina'} · {DIA_SEMANA_LABEL[serie.dia_semana] || '—'} · {serie.hora_inicio?.slice(0, 5)} · {Number(serie.duracao_horas)}h
          </p>
          <p className="text-xs text-muted mt-0.5 break-words">{nomesAlunos || `${nAlunos} aluno(s)`}</p>
          <p className="text-[10px] text-muted font-bold mt-1">
            {formatarDataCurta(serie.data_inicio)} → {serie.data_fim ? formatarDataCurta(serie.data_fim) : 'sem fim'}
          </p>
        </div>
        <SeloEstadoSerie estado={estado} />
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

      {estado === 'validada' && (
        <p className="text-[10px] text-muted italic">Já tratada pela direção. Para alterar, fala com a direção.</p>
      )}

      {porValidar && modoAberto === null && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleRetirar}
            disabled={processando}
            className="flex items-center gap-1.5 bg-page border border-border text-danger px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
          >
            {processando ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Retirar
          </button>
          <button
            type="button"
            onClick={abrirTerminar}
            disabled={processando}
            className="flex items-center gap-1.5 bg-page border border-border text-warning px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
          >
            <CalendarX2 size={12} /> Terminar a partir de…
          </button>
        </div>
      )}

      {porValidar && modoAberto === 'terminar' && (
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
