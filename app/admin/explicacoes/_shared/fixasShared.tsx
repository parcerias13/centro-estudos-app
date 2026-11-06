'use client';

// Partilhado entre app/admin/explicacoes/series/page.tsx (admin) e
// app/admin/explicacoes/minhas-fixas/page.tsx (professor) — o mesmo
// formulário de criação de explicação fixa e os mesmos pequenos
// utilitários de apresentação, para as duas páginas nunca divergirem por
// terem lógica copiada. Pasta com "_" para o Next.js nunca a tratar como
// rota.

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { Loader2, Plus, Search, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { disciplinasComuns } from '@/lib/disciplinas';
import { getHojeLisboa } from '@/lib/dataLisboa';

export const DIAS_SEMANA = [
  { valor: 1, label: 'Seg' },
  { valor: 2, label: 'Ter' },
  { valor: 3, label: 'Qua' },
  { valor: 4, label: 'Qui' },
  { valor: 5, label: 'Sex' },
  { valor: 6, label: 'Sáb' },
  { valor: 7, label: 'Dom' },
];
export const DIA_SEMANA_LABEL: Record<number, string> = Object.fromEntries(DIAS_SEMANA.map((d) => [d.valor, d.label]));

export const rotuloAluno = (nome: string, anoEscolar: number | null | undefined) =>
  anoEscolar ? `${nome} · ${anoEscolar}.º ano` : nome;

export function formatarDataCurta(dataISO: string | null | undefined): string {
  if (!dataISO) return '—';
  return format(new Date(`${dataISO}T00:00:00`), "d 'de' MMM", { locale: pt });
}

export function formatarDataHoraCurta(dataISO: string | null | undefined): string {
  if (!dataISO) return '—';
  return format(new Date(dataISO), "d 'de' MMM 'às' HH:mm", { locale: pt });
}

// Nomes dos alunos de uma série (separados por vírgula, com o ano escolar
// de cada um — mesmo rótulo usado em toda a página) + a contagem, para as
// três listagens (ativas, por validar, recusadas) nunca divergirem.
export function nomesEAlunosDaSerie(serie: any): { nAlunos: number; nomesAlunos: string } {
  const alunos = serie.series_explicacoes_alunos || [];
  const nomesAlunos = alunos
    .map((sa: any) => (Array.isArray(sa.alunos) ? sa.alunos[0] : sa.alunos))
    .filter(Boolean)
    .map((a: any) => rotuloAluno(a.nome, a.ano_escolar))
    .join(', ');
  return { nAlunos: alunos.length, nomesAlunos };
}

export type EstadoValidacaoSerie = 'por_validar' | 'validada' | 'recusada';

const ESTADO_SELO: Record<EstadoValidacaoSerie, { label: string; classes: string }> = {
  por_validar: { label: 'Por validar', classes: 'bg-warning-bg text-warning border-warning/30' },
  validada: { label: 'Validada', classes: 'bg-success-bg text-success border-success/30' },
  recusada: { label: 'Recusada', classes: 'bg-page text-muted border-border' },
};

export function SeloEstadoSerie({ estado }: { estado: EstadoValidacaoSerie | null | undefined }) {
  const cfg = ESTADO_SELO[estado ?? 'validada'] ?? ESTADO_SELO.validada;
  return (
    <span className={`shrink-0 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border whitespace-nowrap ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

type FormularioSerieProps = {
  // 'admin': mostra o seletor de professor (criar_serie_explicacao nasce
  // 'validada'). 'professor': sem seletor — p_professor é sempre
  // professorFixo (o próprio), e nasce 'por_validar'.
  modo: 'admin' | 'professor';
  professorFixo?: string;
  professores?: any[];
  subjects: any[];
  alunosAtivos: any[];
  showError: (mensagem: string) => void;
  onCreated: () => void;
  onCancel: () => void;
};

export function FormularioSerie({ modo, professorFixo, professores, subjects, alunosAtivos, showError, onCreated, onCancel }: FormularioSerieProps) {
  const [professorId, setProfessorId] = useState(modo === 'professor' ? (professorFixo || '') : '');
  const [disciplinaId, setDisciplinaId] = useState('');
  const [diaSemana, setDiaSemana] = useState<number | null>(null);
  const [horaInicio, setHoraInicio] = useState('');
  const [duracaoHoras, setDuracaoHoras] = useState('');
  const [alunoIds, setAlunoIds] = useState<string[]>([]);
  const [buscaAluno, setBuscaAluno] = useState('');
  const [dataInicio, setDataInicio] = useState(() => getHojeLisboa());
  const [semDataFim, setSemDataFim] = useState(true);
  const [dataFim, setDataFim] = useState('');
  const [criando, setCriando] = useState(false);

  const toggleAluno = (id: string) => {
    const jaSelecionado = alunoIds.includes(id);
    if (!jaSelecionado && alunoIds.length > 0) {
      const anoDoGrupo = alunosAtivos.find((a: any) => a.id === alunoIds[0])?.ano_escolar;
      const anoDoNovo = alunosAtivos.find((a: any) => a.id === id)?.ano_escolar;
      if (anoDoGrupo != null && anoDoNovo !== anoDoGrupo) {
        showError('Todos os alunos de uma explicação fixa têm de ser do mesmo ano escolar.');
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
    const professorFinal = modo === 'professor' ? professorFixo : professorId;
    if (!professorFinal) return showError('Escolhe o professor.');
    if (diaSemana == null) return showError('Escolhe o dia da semana.');
    if (!horaInicio) return showError('Indica a hora de início.');
    const duracaoNum = parseFloat(duracaoHoras);
    if (isNaN(duracaoNum) || duracaoNum <= 0) return showError('Indica uma duração válida.');
    if (alunoIds.length === 0) return showError('Escolhe pelo menos um aluno.');
    if (!dataInicio) return showError('Escolhe a data de início.');

    setCriando(true);
    try {
      const { error } = await supabase.rpc('criar_serie_explicacao', {
        p_professor: professorFinal,
        p_disciplina: disciplinaId ? Number(disciplinaId) : null,
        p_dia: diaSemana,
        p_hora: `${horaInicio}:00`,
        p_duracao: duracaoNum,
        p_alunos: alunoIds,
        p_inicio: dataInicio,
        p_fim: semDataFim ? null : (dataFim || null),
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
      {modo === 'admin' && (
        <div>
          <label className="text-[9px] font-black text-muted uppercase ml-1">Professor</label>
          <select
            aria-label="Professor"
            value={professorId}
            onChange={(e) => setProfessorId(e.target.value)}
            className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-accent outline-none transition-all appearance-none mt-1"
          >
            <option value="">Escolhe...</option>
            {(professores || []).map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

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

      <div>
        <label className="text-[9px] font-black text-muted uppercase ml-1">Início</label>
        <input
          type="date"
          aria-label="Início"
          value={dataInicio}
          onChange={(e) => setDataInicio(e.target.value)}
          className="w-full bg-surface border border-border text-primary p-3 rounded-2xl text-sm font-bold focus:border-accent outline-none transition-all"
        />
      </div>

      <label className="flex items-start gap-2 text-xs font-bold text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={semDataFim}
          onChange={(e) => setSemDataFim(e.target.checked)}
          className="mt-0.5 shrink-0 accent-accent"
        />
        <span>Sem data de fim: continua todas as semanas até a terminares</span>
      </label>

      {!semDataFim && (
        <div>
          <label className="text-[9px] font-black text-muted uppercase ml-1">Data de fim</label>
          <input
            type="date"
            aria-label="Data de fim"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="w-full bg-surface border border-border text-primary p-3 rounded-2xl text-sm font-bold focus:border-accent outline-none transition-all"
          />
        </div>
      )}

      <p className="text-[10px] text-muted italic">
        As próximas 12 semanas ficam logo marcadas e depois vão-se marcando sozinhas, semana a semana.
      </p>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleCriar}
          disabled={criando}
          className="flex-1 py-3 bg-accent hover:bg-accent-hover text-on-accent rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
        >
          {criando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Criar Explicação Fixa
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
