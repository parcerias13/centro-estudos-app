'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { avisarNotasConfirmadas } from '@/lib/eventoNotasAdmin';
import {
  getEscalaTeste, getEscalaPeriodo, confirmarNotaTeste, confirmarNotaPeriodo,
  corrigirNotaTeste, corrigirNotaPeriodoExistente, contarNotasPendentes,
} from '@/lib/notas';
import {
  ClipboardCheck, Loader2, Search, CheckCircle2, Clock, Pencil, Check,
  RotateCcw, X, AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';

type Tipo = 'teste' | 'periodo';

type LinhaNota = {
  chave: string; // `${tipo}:${id}`
  id: string;
  tipo: Tipo;
  alunoId: string;
  alunoNome: string;
  anoEscolar: number | null;
  disciplina: string;
  dataLabel: string;
  dataOrdenavel: string; // ISO — base da ordenação "mais antigas primeiro"
  notaValor: number | null;
  notaEscala: string | null;
  notaConfirmada: boolean;
  notaConfirmadaPor: string | null;
  notaConfirmadaEm: string | null;
  notaReportadaPor: string | null;
  raw: any;
};

type ResultadoLote = { status: 'ok' | 'falhou'; motivo?: string };

const LIMITE_FETCH = 200;
const PAGINA = 30;
const TAMANHO_LOTE = 4;

async function processarEmLotes<T>(itens: T[], tamanhoLote: number, worker: (item: T) => Promise<void>) {
  for (let i = 0; i < itens.length; i += tamanhoLote) {
    const lote = itens.slice(i, i + tamanhoLote);
    await Promise.all(lote.map(worker));
  }
}

function periodoLabel(periodo: number, anoLetivo: string) {
  return `${periodo}º Período · ${anoLetivo}`;
}

export default function NotasPorConfirmarPage() {
  const { toast, showError, showSuccess } = useStatusToast();

  const [loadingPagina, setLoadingPagina] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [centroId, setCentroId] = useState<string | null>(null);

  const [aba, setAba] = useState<'pendentes' | 'confirmadas'>('pendentes');
  const [linhasPendentes, setLinhasPendentes] = useState<LinhaNota[] | null>(null);
  const [linhasConfirmadas, setLinhasConfirmadas] = useState<LinhaNota[] | null>(null);
  const [totalPendentes, setTotalPendentes] = useState(0);
  const [loadingLista, setLoadingLista] = useState(false);

  const [pesquisa, setPesquisa] = useState('');
  const [filtroAno, setFiltroAno] = useState('');
  const [filtroDisciplina, setFiltroDisciplina] = useState('');
  const [visivel, setVisivel] = useState(PAGINA);

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [aConfirmarLote, setAConfirmarLote] = useState(false);
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const [progressoLote, setProgressoLote] = useState({ total: 0, concluidos: 0 });
  const [resultadosLote, setResultadosLote] = useState<Map<string, ResultadoLote>>(new Map());
  const [resumoLoteVisivel, setResumoLoteVisivel] = useState(false);

  const [confirmandoUnicaChave, setConfirmandoUnicaChave] = useState<string | null>(null);
  const [corrigindoChave, setCorrigindoChave] = useState<string | null>(null);
  const [valorCorrecao, setValorCorrecao] = useState('');
  const [guardandoCorrecao, setGuardandoCorrecao] = useState(false);

  const isFetchingPendentesRef = useRef(false);
  const fetchPendentesPendingRef = useRef(false);
  const isFetchingConfirmadasRef = useRef(false);
  const fetchConfirmadasPendingRef = useRef(false);

  const podeAgir = role === 'admin' || role === 'professor';

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setRole(user?.app_metadata?.role?.toLowerCase() ?? null);
      setUserId(user?.id ?? null);
      setCentroId(user?.app_metadata?.centro_id ?? null);
      setLoadingPagina(false);
    });
  }, []);

  // Mapas de apoio (alunos, disciplinas, staff) — carregados uma vez por
  // centro e reutilizados a montar as linhas das duas listas. alunos/
  // disciplinas vivem em refs, não em estado: são lidos de imediato por
  // montarLinhaTeste/Periodo logo a seguir a carregarMapas, dentro da MESMA
  // função assíncrona — usar estado React aqui arriscava uma corrida (a
  // primeira busca das linhas a correr antes do re-render que publicava o
  // novo Map, construindo linhas com o nome "Aluno" de reserva). staffMap
  // fica em estado porque só é lido de forma reativa, no render, para
  // "Registada por"/"Confirmada por" — aí não há essa corrida.
  const alunosMapRef = useRef<Map<string, { nome: string; ano_escolar: number | null }>>(new Map());
  const disciplinasMapRef = useRef<Map<number, string>>(new Map());
  const [staffMap, setStaffMap] = useState<Map<string, string>>(new Map());

  const carregarMapas = useCallback(async (centro_id: string) => {
    const [{ data: alunosData }, { data: subjectsData }, { data: staffData }] = await Promise.all([
      supabase.from('alunos').select('id, nome, ano_escolar').eq('centro_id', centro_id),
      supabase.from('subjects').select('id, name').eq('centro_id', centro_id),
      supabase.from('staff').select('id, name').eq('centro_id', centro_id),
    ]);
    alunosMapRef.current = new Map((alunosData || []).map((a: any) => [a.id, { nome: a.nome, ano_escolar: a.ano_escolar }]));
    disciplinasMapRef.current = new Map((subjectsData || []).map((s: any) => [s.id, s.name]));
    setStaffMap(new Map((staffData || []).map((s: any) => [s.id, s.name])));
  }, []);

  const montarLinhaTeste = useCallback((e: any): LinhaNota => {
    const aluno = alunosMapRef.current.get(e.aluno_id);
    return {
      chave: `teste:${e.id}`,
      id: e.id,
      tipo: 'teste',
      alunoId: e.aluno_id,
      alunoNome: aluno?.nome ?? 'Aluno',
      anoEscolar: aluno?.ano_escolar ?? null,
      disciplina: e.subject_name,
      dataLabel: format(new Date(e.date + 'T00:00:00'), 'dd/MM/yyyy'),
      dataOrdenavel: e.created_at,
      notaValor: e.nota_valor,
      notaEscala: e.nota_escala,
      notaConfirmada: e.nota_confirmada,
      notaConfirmadaPor: e.nota_confirmada_por,
      notaConfirmadaEm: e.nota_confirmada_em,
      notaReportadaPor: e.nota_reportada_por,
      raw: e,
    };
  }, []);

  const montarLinhaPeriodo = useCallback((n: any): LinhaNota => {
    const aluno = alunosMapRef.current.get(n.aluno_id);
    return {
      chave: `periodo:${n.id}`,
      id: n.id,
      tipo: 'periodo',
      alunoId: n.aluno_id,
      alunoNome: aluno?.nome ?? 'Aluno',
      anoEscolar: aluno?.ano_escolar ?? null,
      disciplina: disciplinasMapRef.current.get(n.disciplina_id) ?? 'Disciplina',
      dataLabel: periodoLabel(n.periodo, n.ano_letivo),
      dataOrdenavel: n.created_at,
      notaValor: n.nota,
      notaEscala: n.nota_escala,
      notaConfirmada: n.nota_confirmada,
      notaConfirmadaPor: n.nota_confirmada_por,
      notaConfirmadaEm: n.nota_confirmada_em,
      notaReportadaPor: n.nota_reportada_por,
      raw: n,
    };
  }, []);

  const carregarPendentes = useCallback(async (centro_id: string) => {
    if (isFetchingPendentesRef.current) { fetchPendentesPendingRef.current = true; return; }
    isFetchingPendentesRef.current = true;
    try {
      const [{ data: examsData, error: erroExams }, { data: periodoData, error: erroPeriodo }, total] = await Promise.all([
        supabase.from('exams').select('*').eq('centro_id', centro_id).eq('nota_confirmada', false).not('nota_valor', 'is', null).order('created_at', { ascending: true }).limit(LIMITE_FETCH),
        supabase.from('notas_periodo').select('*').eq('centro_id', centro_id).eq('nota_confirmada', false).order('created_at', { ascending: true }).limit(LIMITE_FETCH),
        contarNotasPendentes(supabase, centro_id),
      ]);
      if (erroExams || erroPeriodo) {
        showError('Não foi possível carregar as notas por confirmar: ' + (erroExams || erroPeriodo)!.message);
        return;
      }
      const linhas = [...(examsData || []).map(montarLinhaTeste), ...(periodoData || []).map(montarLinhaPeriodo)]
        .sort((a, b) => a.dataOrdenavel.localeCompare(b.dataOrdenavel));
      setLinhasPendentes(linhas);
      setTotalPendentes(total);
    } finally {
      isFetchingPendentesRef.current = false;
      if (fetchPendentesPendingRef.current) {
        fetchPendentesPendingRef.current = false;
        carregarPendentes(centro_id);
      }
    }
  }, [showError, montarLinhaTeste, montarLinhaPeriodo]);

  const carregarConfirmadas = useCallback(async (centro_id: string) => {
    if (isFetchingConfirmadasRef.current) { fetchConfirmadasPendingRef.current = true; return; }
    isFetchingConfirmadasRef.current = true;
    try {
      const desde = new Date();
      desde.setDate(desde.getDate() - 30);
      const desdeISO = desde.toISOString();
      const [{ data: examsData, error: erroExams }, { data: periodoData, error: erroPeriodo }] = await Promise.all([
        supabase.from('exams').select('*').eq('centro_id', centro_id).eq('nota_confirmada', true).gte('nota_confirmada_em', desdeISO).order('nota_confirmada_em', { ascending: false }).limit(LIMITE_FETCH),
        supabase.from('notas_periodo').select('*').eq('centro_id', centro_id).eq('nota_confirmada', true).gte('nota_confirmada_em', desdeISO).order('nota_confirmada_em', { ascending: false }).limit(LIMITE_FETCH),
      ]);
      if (erroExams || erroPeriodo) {
        showError('Não foi possível carregar as notas confirmadas: ' + (erroExams || erroPeriodo)!.message);
        return;
      }
      const linhas = [...(examsData || []).map(montarLinhaTeste), ...(periodoData || []).map(montarLinhaPeriodo)]
        .sort((a, b) => (b.notaConfirmadaEm || '').localeCompare(a.notaConfirmadaEm || ''));
      setLinhasConfirmadas(linhas);
    } finally {
      isFetchingConfirmadasRef.current = false;
      if (fetchConfirmadasPendingRef.current) {
        fetchConfirmadasPendingRef.current = false;
        carregarConfirmadas(centro_id);
      }
    }
  }, [showError, montarLinhaTeste, montarLinhaPeriodo]);

  const carregarTudo = useCallback(async (centro_id: string) => {
    setLoadingLista(true);
    await carregarMapas(centro_id);
    setLoadingLista(false);
  }, [carregarMapas]);

  useEffect(() => {
    if (centroId) carregarTudo(centroId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centroId]);

  // Só busca as linhas depois de os mapas (alunos/disciplinas) já terem
  // chegado — montarLinhaTeste/Periodo dependem deles para o nome/disciplina.
  useEffect(() => {
    if (centroId && !loadingLista) {
      carregarPendentes(centroId);
      carregarConfirmadas(centroId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centroId, loadingLista]);

  // Atualização a cada 30s enquanto o separador está visível, ao ganhar
  // foco, e imediatamente a seguir a confirmar notas — mesmo padrão do
  // badge "Notas" na sidebar.
  useEffect(() => {
    if (!centroId) return;
    const atualizarTudo = () => {
      carregarPendentes(centroId);
      carregarConfirmadas(centroId);
    };
    const aoFocar = () => atualizarTudo();
    window.addEventListener('focus', aoFocar);
    let intervalo: ReturnType<typeof setInterval> | null = null;
    const geriIntervalo = () => {
      if (document.visibilityState === 'visible') {
        if (!intervalo) intervalo = setInterval(atualizarTudo, 30000);
      } else if (intervalo) {
        clearInterval(intervalo);
        intervalo = null;
      }
    };
    geriIntervalo();
    document.addEventListener('visibilitychange', geriIntervalo);
    return () => {
      window.removeEventListener('focus', aoFocar);
      document.removeEventListener('visibilitychange', geriIntervalo);
      if (intervalo) clearInterval(intervalo);
    };
  }, [centroId, carregarPendentes, carregarConfirmadas]);

  // Reset de paginação/seleção ao trocar de separador ou de filtros.
  useEffect(() => { setVisivel(PAGINA); setSelecionados(new Set()); }, [aba, pesquisa, filtroAno, filtroDisciplina]);

  const listaAtiva = aba === 'pendentes' ? linhasPendentes : linhasConfirmadas;

  const anosDisponiveis = useMemo(() => {
    const set = new Set<number>();
    (listaAtiva || []).forEach((l) => { if (l.anoEscolar != null) set.add(l.anoEscolar); });
    return Array.from(set).sort((a, b) => a - b);
  }, [listaAtiva]);

  const disciplinasDisponiveis = useMemo(() => {
    const set = new Set<string>();
    (listaAtiva || []).forEach((l) => set.add(l.disciplina));
    return Array.from(set).sort();
  }, [listaAtiva]);

  const linhasFiltradas = useMemo(() => {
    let lista = listaAtiva || [];
    if (pesquisa.trim()) {
      const termo = pesquisa.trim().toLowerCase();
      lista = lista.filter((l) => l.alunoNome.toLowerCase().includes(termo));
    }
    if (filtroAno) lista = lista.filter((l) => String(l.anoEscolar) === filtroAno);
    if (filtroDisciplina) lista = lista.filter((l) => l.disciplina === filtroDisciplina);
    return lista;
  }, [listaAtiva, pesquisa, filtroAno, filtroDisciplina]);

  const linhasVisiveis = linhasFiltradas.slice(0, visivel);

  const nomeRegistadoPor = (l: LinhaNota) => {
    if (l.notaReportadaPor === l.alunoId) return 'o próprio aluno';
    if (l.notaReportadaPor && staffMap.has(l.notaReportadaPor)) return staffMap.get(l.notaReportadaPor)!;
    return '—';
  };

  const nomeConfirmadoPor = (l: LinhaNota) => (l.notaConfirmadaPor && staffMap.has(l.notaConfirmadaPor)) ? staffMap.get(l.notaConfirmadaPor)! : '—';

  const atualizarAposConfirmar = (chave: string, novaLinha: LinhaNota) => {
    setLinhasPendentes((prev) => (prev || []).filter((l) => l.chave !== chave));
    setLinhasConfirmadas((prev) => [novaLinha, ...(prev || [])]);
    setTotalPendentes((prev) => Math.max(0, prev - 1));
    avisarNotasConfirmadas();
  };

  const handleConfirmarUnica = async (l: LinhaNota) => {
    if (confirmandoUnicaChave) return;
    setConfirmandoUnicaChave(l.chave);
    try {
      const resultado = l.tipo === 'teste' ? await confirmarNotaTeste(supabase, l.id) : await confirmarNotaPeriodo(supabase, l.id);
      if (!resultado.ok) {
        showError('Não foi possível confirmar: ' + (resultado.motivo === 'erro_servidor' ? resultado.mensagem : 'erro inesperado.'));
        return;
      }
      const nova = l.tipo === 'teste' ? montarLinhaTeste(resultado.data[0]) : montarLinhaPeriodo(resultado.data[0]);
      atualizarAposConfirmar(l.chave, nova);
      showSuccess('Nota confirmada.');
    } finally {
      setConfirmandoUnicaChave(null);
    }
  };

  const toggleSelecionado = (chave: string) => {
    setSelecionados((atual) => {
      const copia = new Set(atual);
      if (copia.has(chave)) copia.delete(chave);
      else copia.add(chave);
      return copia;
    });
  };

  const toggleSelecionarTodosVisiveis = () => {
    setSelecionados((atual) => {
      const todosMarcados = linhasVisiveis.length > 0 && linhasVisiveis.every((l) => atual.has(l.chave));
      if (todosMarcados) return new Set();
      return new Set(linhasVisiveis.map((l) => l.chave));
    });
  };

  const confirmarUma = async (chave: string): Promise<ResultadoLote> => {
    const [tipo, id] = chave.split(':') as [Tipo, string];
    const resultado = tipo === 'teste' ? await confirmarNotaTeste(supabase, id) : await confirmarNotaPeriodo(supabase, id);
    if (!resultado.ok) return { status: 'falhou', motivo: resultado.motivo === 'erro_servidor' ? resultado.mensagem : 'não foi possível confirmar' };
    const linhaOriginal = (linhasPendentes || []).find((l) => l.chave === chave);
    if (linhaOriginal) {
      const nova = tipo === 'teste' ? montarLinhaTeste(resultado.data[0]) : montarLinhaPeriodo(resultado.data[0]);
      atualizarAposConfirmar(chave, nova);
    }
    return { status: 'ok' };
  };

  const executarConfirmacaoLote = async (chaves: string[]) => {
    if (chaves.length === 0) return;
    setConfirmandoLote(true);
    setProgressoLote({ total: chaves.length, concluidos: 0 });
    const novosResultados = new Map(resultadosLote);
    await processarEmLotes(chaves, TAMANHO_LOTE, async (chave) => {
      const resultado = await confirmarUma(chave);
      novosResultados.set(chave, resultado);
      setResultadosLote(new Map(novosResultados));
      setProgressoLote((atual) => ({ ...atual, concluidos: atual.concluidos + 1 }));
    });
    setConfirmandoLote(false);
    setResumoLoteVisivel(true);
    setAConfirmarLote(false);
    setSelecionados(new Set());
    const sucesso = chaves.filter((c) => novosResultados.get(c)?.status === 'ok').length;
    showSuccess(`Confirmação concluída: ${sucesso} nota(s) confirmada(s).`);
  };

  const handleConfirmarSelecionadas = () => executarConfirmacaoLote(Array.from(selecionados));
  const handleRepetirFalhadas = () => {
    const falhadas = Array.from(resultadosLote.entries()).filter(([, r]) => r.status === 'falhou').map(([chave]) => chave);
    executarConfirmacaoLote(falhadas);
  };

  const abrirCorrecao = (l: LinhaNota) => {
    setCorrigindoChave(l.chave);
    setValorCorrecao(l.notaValor != null ? String(l.notaValor) : '');
  };
  const fecharCorrecao = () => { setCorrigindoChave(null); setValorCorrecao(''); };

  const handleGuardarECorrigir = async (l: LinhaNota) => {
    if (guardandoCorrecao) return;
    const escala = l.tipo === 'teste' ? getEscalaTeste(l.anoEscolar) : getEscalaPeriodo(l.anoEscolar);
    setGuardandoCorrecao(true);
    try {
      const resultado = l.tipo === 'teste'
        ? await corrigirNotaTeste(supabase, l.raw, valorCorrecao, l.anoEscolar, true, userId)
        : await corrigirNotaPeriodoExistente(supabase, l.raw, valorCorrecao, l.anoEscolar, true, userId);

      if (!resultado.ok) {
        if (resultado.motivo === 'invalido' || resultado.motivo === 'fora_da_escala') {
          showError(`Escreve um valor entre ${escala.min} e ${escala.max}.`);
        } else {
          showError('Não foi possível guardar: ' + resultado.mensagem);
        }
        return;
      }
      const nova = l.tipo === 'teste' ? montarLinhaTeste(resultado.data[0]) : montarLinhaPeriodo(resultado.data[0]);
      if (l.notaConfirmada) {
        // Já estava confirmada — continua confirmada, só atualiza a linha no lugar.
        setLinhasConfirmadas((prev) => (prev || []).map((x) => (x.chave === l.chave ? nova : x)));
      } else {
        atualizarAposConfirmar(l.chave, nova);
      }
      fecharCorrecao();
      showSuccess('Nota corrigida e confirmada.');
    } finally {
      setGuardandoCorrecao(false);
    }
  };

  if (loadingPagina) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  const totalSelecionados = selecionados.size;
  const resumoLote = {
    confirmadas: Array.from(resultadosLote.values()).filter((r) => r.status === 'ok').length,
    falhadas: Array.from(resultadosLote.entries()).filter(([, r]) => r.status === 'falhou'),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-primary flex items-center gap-2">
          <ClipboardCheck className="text-accent" /> Notas
        </h1>
        <p className="text-secondary text-sm">Testes e notas de período por confirmar.</p>
      </div>

      <div className="bg-surface border border-border rounded-3xl shadow-xl p-5 space-y-5">
        {/* Separadores */}
        <div className="flex items-center bg-page border border-border rounded-2xl overflow-hidden p-1 w-fit">
          <button
            onClick={() => setAba('pendentes')}
            className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${aba === 'pendentes' ? 'bg-accent text-on-accent' : 'text-secondary hover:text-primary'}`}
          >
            Por confirmar {totalPendentes > 0 ? `(${totalPendentes})` : ''}
          </button>
          <button
            onClick={() => setAba('confirmadas')}
            className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${aba === 'confirmadas' ? 'bg-accent text-on-accent' : 'text-secondary hover:text-primary'}`}
          >
            Confirmadas
          </button>
        </div>

        {!podeAgir && (
          <div className="bg-page border border-border rounded-2xl p-3 flex items-center gap-2 text-xs text-muted font-bold">
            <AlertTriangle size={14} className="shrink-0 text-warning" />
            A secretaria vê a lista, mas não confirma.
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={pesquisa}
              onChange={(e) => setPesquisa(e.target.value)}
              placeholder="Pesquisar aluno..."
              className="w-full bg-page border border-border text-primary text-sm pl-9 pr-3 py-2.5 rounded-xl outline-none focus:border-accent transition-all"
            />
          </div>
          <select
            value={filtroAno}
            onChange={(e) => setFiltroAno(e.target.value)}
            className="bg-page border border-border text-primary text-sm px-3 py-2.5 rounded-xl outline-none focus:border-accent transition-all"
          >
            <option value="">Todos os anos</option>
            {anosDisponiveis.map((a) => <option key={a} value={a}>{a}º ano</option>)}
          </select>
          <select
            value={filtroDisciplina}
            onChange={(e) => setFiltroDisciplina(e.target.value)}
            className="bg-page border border-border text-primary text-sm px-3 py-2.5 rounded-xl outline-none focus:border-accent transition-all"
          >
            <option value="">Todas as disciplinas</option>
            {disciplinasDisponiveis.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Lista */}
        {loadingLista || listaAtiva === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-accent" /></div>
        ) : linhasFiltradas.length === 0 ? (
          <p className="text-muted text-sm text-center italic py-10">
            {aba === 'pendentes' ? 'Sem notas por confirmar.' : 'Sem notas confirmadas nos últimos 30 dias.'}
          </p>
        ) : (
          <>
            {/* Desktop: tabela */}
            <div className="hidden md:block overflow-x-auto border border-border rounded-2xl">
              <table className="w-full text-sm">
                <thead className="bg-page text-muted uppercase text-[10px] font-black tracking-widest">
                  <tr>
                    {aba === 'pendentes' && podeAgir && (
                      <th className="p-3 text-left w-10">
                        <input type="checkbox" className="accent-blue-600" checked={linhasVisiveis.length > 0 && linhasVisiveis.every((l) => selecionados.has(l.chave))} onChange={toggleSelecionarTodosVisiveis} />
                      </th>
                    )}
                    <th className="p-3 text-left">Aluno</th>
                    <th className="p-3 text-left">Tipo</th>
                    <th className="p-3 text-left">Disciplina</th>
                    <th className="p-3 text-left">Data / Período</th>
                    <th className="p-3 text-left">Nota</th>
                    <th className="p-3 text-left">{aba === 'pendentes' ? 'Registada por' : 'Confirmada por'}</th>
                    {aba === 'pendentes' && podeAgir && <th className="p-3 text-left w-40"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {linhasVisiveis.map((l) => (
                    <LinhaDesktop
                      key={l.chave}
                      linha={l}
                      aba={aba}
                      podeAgir={podeAgir}
                      selecionado={selecionados.has(l.chave)}
                      toggleSelecionado={() => toggleSelecionado(l.chave)}
                      nomeRegistadoPor={nomeRegistadoPor(l)}
                      nomeConfirmadoPor={nomeConfirmadoPor(l)}
                      confirmando={confirmandoUnicaChave === l.chave}
                      onConfirmar={() => handleConfirmarUnica(l)}
                      aCorrigir={corrigindoChave === l.chave}
                      onAbrirCorrigir={() => abrirCorrecao(l)}
                      onFecharCorrigir={fecharCorrecao}
                      valorCorrecao={valorCorrecao}
                      onMudarValorCorrecao={setValorCorrecao}
                      onGuardarCorrecao={() => handleGuardarECorrigir(l)}
                      guardandoCorrecao={guardandoCorrecao}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: cartões */}
            <div className="md:hidden space-y-3">
              {linhasVisiveis.map((l) => (
                <CartaoMobile
                  key={l.chave}
                  linha={l}
                  aba={aba}
                  podeAgir={podeAgir}
                  selecionado={selecionados.has(l.chave)}
                  toggleSelecionado={() => toggleSelecionado(l.chave)}
                  nomeRegistadoPor={nomeRegistadoPor(l)}
                  nomeConfirmadoPor={nomeConfirmadoPor(l)}
                  confirmando={confirmandoUnicaChave === l.chave}
                  onConfirmar={() => handleConfirmarUnica(l)}
                  aCorrigir={corrigindoChave === l.chave}
                  onAbrirCorrigir={() => abrirCorrecao(l)}
                  onFecharCorrigir={fecharCorrecao}
                  valorCorrecao={valorCorrecao}
                  onMudarValorCorrecao={setValorCorrecao}
                  onGuardarCorrecao={() => handleGuardarECorrigir(l)}
                  guardandoCorrecao={guardandoCorrecao}
                />
              ))}
            </div>

            {linhasFiltradas.length > visivel && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => setVisivel((v) => v + PAGINA)}
                  className="text-[11px] font-black uppercase tracking-widest text-muted hover:text-primary bg-page border border-border px-4 py-2 rounded-full transition-all"
                >
                  Carregar mais
                </button>
              </div>
            )}
          </>
        )}

        {/* Barra de seleção em lote */}
        {aba === 'pendentes' && podeAgir && totalSelecionados > 0 && (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            {confirmandoLote && (
              <div className="space-y-2">
                <div className="h-2 bg-page rounded-full overflow-hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: `${progressoLote.total > 0 ? (progressoLote.concluidos / progressoLote.total) * 100 : 0}%` }} />
                </div>
                <p className="text-xs text-muted font-bold">{progressoLote.concluidos} / {progressoLote.total}</p>
              </div>
            )}

            {!aConfirmarLote ? (
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-sm font-bold text-primary">{totalSelecionados} selecionada{totalSelecionados === 1 ? '' : 's'}</p>
                <button
                  onClick={() => setAConfirmarLote(true)}
                  disabled={confirmandoLote}
                  className="bg-accent hover:bg-accent-hover disabled:opacity-40 text-on-accent px-5 py-2.5 rounded-2xl font-black text-sm flex items-center gap-2 transition-all active:scale-95"
                >
                  <Check size={16} /> Confirmar selecionadas
                </button>
              </div>
            ) : (
              <div className="bg-warning-bg border border-warning/30 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-bold text-primary">Confirmar {totalSelecionados} nota{totalSelecionados === 1 ? '' : 's'}?</p>
                <div className="flex gap-2">
                  <button onClick={() => setAConfirmarLote(false)} disabled={confirmandoLote} className="px-4 py-2 rounded-xl font-black text-secondary hover:text-primary transition-colors text-sm">Cancelar</button>
                  <button onClick={handleConfirmarSelecionadas} disabled={confirmandoLote} className="bg-accent hover:bg-accent-hover text-on-accent px-5 py-2 rounded-xl font-black text-sm flex items-center gap-2 transition-all active:scale-95">
                    {confirmandoLote ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />} Confirmar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {resumoLoteVisivel && !confirmandoLote && (
          <div className="bg-page border border-border rounded-2xl p-4 text-sm space-y-1">
            <p className="font-black text-primary">Resumo da confirmação em lote</p>
            <p className="text-success">{resumoLote.confirmadas} confirmada(s)</p>
            {resumoLote.falhadas.length > 0 && (
              <div className="text-danger space-y-1">
                <p>{resumoLote.falhadas.length} falhada(s):</p>
                <ul className="list-disc list-inside">
                  {resumoLote.falhadas.map(([chave, r]) => {
                    const linha = (linhasPendentes || []).find((l) => l.chave === chave);
                    return <li key={chave}>{linha ? `${linha.alunoNome} · ${linha.disciplina}` : chave}: {r.motivo}</li>;
                  })}
                </ul>
                <button onClick={handleRepetirFalhadas} className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-accent hover:underline">
                  <RotateCcw size={12} /> Repetir só as falhadas
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <StatusToast toast={toast} />
    </div>
  );
}

// --- Chip de tipo (Teste / Período) ---
function ChipTipo({ tipo }: { tipo: Tipo }) {
  return tipo === 'teste' ? (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-accent-soft text-accent">Teste</span>
  ) : (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-purple-500/10 text-purple-500">Período</span>
  );
}

function ChipEstado({ confirmada }: { confirmada: boolean }) {
  return confirmada ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-success-bg text-success"><CheckCircle2 size={11} /> Confirmada</span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-warning-bg text-warning"><Clock size={11} /> Por confirmar</span>
  );
}

type PropsLinha = {
  linha: LinhaNota;
  aba: 'pendentes' | 'confirmadas';
  podeAgir: boolean;
  selecionado: boolean;
  toggleSelecionado: () => void;
  nomeRegistadoPor: string;
  nomeConfirmadoPor: string;
  confirmando: boolean;
  onConfirmar: () => void;
  aCorrigir: boolean;
  onAbrirCorrigir: () => void;
  onFecharCorrigir: () => void;
  valorCorrecao: string;
  onMudarValorCorrecao: (v: string) => void;
  onGuardarCorrecao: () => void;
  guardandoCorrecao: boolean;
};

function FormCorrecao({ linha, valorCorrecao, onMudarValorCorrecao, onGuardarCorrecao, onFecharCorrigir, guardandoCorrecao }: PropsLinha) {
  const escala = linha.tipo === 'teste' ? getEscalaTeste(linha.anoEscolar) : getEscalaPeriodo(linha.anoEscolar);
  return (
    <div className="flex flex-wrap items-center gap-2 bg-page border border-border rounded-xl p-2.5">
      <input
        type="number"
        step={linha.tipo === 'teste' ? '0.01' : '1'}
        min={escala.min}
        max={escala.max}
        value={valorCorrecao}
        onChange={(e) => onMudarValorCorrecao(e.target.value)}
        placeholder={`${escala.min}-${escala.max}`}
        className="w-24 bg-surface border border-border text-primary py-2 px-2.5 rounded-lg font-mono font-bold outline-none focus:border-accent/50"
      />
      <span className="text-[11px] text-muted font-bold">/{escala.escala}</span>
      <button
        onClick={onGuardarCorrecao}
        disabled={guardandoCorrecao}
        className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-on-accent px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all active:scale-95"
      >
        {guardandoCorrecao ? <Loader2 className="animate-spin" size={12} /> : <Check size={12} />} Guardar e confirmar
      </button>
      <button onClick={onFecharCorrigir} disabled={guardandoCorrecao} className="text-muted hover:text-danger p-2 transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}

function LinhaDesktop(props: PropsLinha) {
  const { linha: l, aba, podeAgir, selecionado, toggleSelecionado, nomeRegistadoPor, nomeConfirmadoPor, confirmando, onConfirmar, aCorrigir, onAbrirCorrigir } = props;
  return (
    <>
      <tr className="text-secondary hover:bg-raised/20 transition-colors">
        {aba === 'pendentes' && podeAgir && (
          <td className="p-3"><input type="checkbox" className="accent-blue-600" checked={selecionado} onChange={toggleSelecionado} /></td>
        )}
        <td className="p-3 font-bold text-primary whitespace-nowrap">{l.alunoNome}{l.anoEscolar ? ` · ${l.anoEscolar}º` : ''}</td>
        <td className="p-3"><ChipTipo tipo={l.tipo} /></td>
        <td className="p-3">{l.disciplina}</td>
        <td className="p-3 whitespace-nowrap">{l.dataLabel}</td>
        <td className="p-3 font-mono font-bold text-primary whitespace-nowrap">{l.notaValor}/{l.notaEscala}</td>
        <td className="p-3 whitespace-nowrap">
          {aba === 'pendentes' ? nomeRegistadoPor : (
            <span>Confirmada por {nomeConfirmadoPor}{l.notaConfirmadaEm ? `, ${format(new Date(l.notaConfirmadaEm), 'dd/MM/yyyy HH:mm')}` : ''}</span>
          )}
        </td>
        {aba === 'pendentes' && podeAgir && (
          <td className="p-3">
            <div className="flex items-center gap-2">
              <button onClick={onConfirmar} disabled={confirmando} className="text-success hover:underline text-[11px] font-black uppercase flex items-center gap-1">
                {confirmando ? <Loader2 className="animate-spin" size={12} /> : <Check size={12} />} Confirmar
              </button>
              <button onClick={onAbrirCorrigir} className="text-accent hover:underline text-[11px] font-black uppercase flex items-center gap-1">
                <Pencil size={12} /> Corrigir
              </button>
            </div>
          </td>
        )}
      </tr>
      {aCorrigir && (
        <tr>
          <td colSpan={7} className="p-3 pt-0">
            <FormCorrecao {...props} />
          </td>
        </tr>
      )}
    </>
  );
}

function CartaoMobile(props: PropsLinha) {
  const { linha: l, aba, podeAgir, selecionado, toggleSelecionado, nomeRegistadoPor, nomeConfirmadoPor, confirmando, onConfirmar, aCorrigir, onAbrirCorrigir } = props;
  return (
    <div className="bg-page border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          {aba === 'pendentes' && podeAgir && (
            <input type="checkbox" className="accent-blue-600 mt-1 shrink-0 w-5 h-5" checked={selecionado} onChange={toggleSelecionado} />
          )}
          <div className="min-w-0">
            <p className="font-bold text-primary truncate">{l.alunoNome}{l.anoEscolar ? ` · ${l.anoEscolar}º ano` : ''}</p>
            <p className="text-xs text-muted">{l.disciplina} · {l.dataLabel}</p>
          </div>
        </div>
        <ChipTipo tipo={l.tipo} />
      </div>

      <div className="flex items-center justify-between">
        <p className="font-mono font-black text-lg text-primary">{l.notaValor}<span className="text-sm text-muted">/{l.notaEscala}</span></p>
        <ChipEstado confirmada={l.notaConfirmada} />
      </div>

      <p className="text-xs text-muted">
        {aba === 'pendentes' ? `Registada por ${nomeRegistadoPor}` : `Confirmada por ${nomeConfirmadoPor}${l.notaConfirmadaEm ? `, ${format(new Date(l.notaConfirmadaEm), 'dd/MM/yyyy HH:mm')}` : ''}`}
      </p>

      {aCorrigir && <FormCorrecao {...props} />}

      {aba === 'pendentes' && podeAgir && !aCorrigir && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={onConfirmar}
            disabled={confirmando}
            className="flex-1 bg-success-bg text-success border border-success/30 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          >
            {confirmando ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />} Confirmar
          </button>
          <button
            onClick={onAbrirCorrigir}
            className="flex-1 bg-accent-soft text-accent border border-accent/30 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1.5 active:scale-95 transition-all"
          >
            <Pencil size={14} /> Corrigir
          </button>
        </div>
      )}
    </div>
  );
}
