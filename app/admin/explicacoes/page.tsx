'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { disciplinasComuns } from '@/lib/disciplinas';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import {
  ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Plus, X, GraduationCap, Loader2,
  Clock, Trash2, Save, Search, Users, AlertTriangle, HelpCircle, CalendarDays,
  CheckCheck, Ban, RotateCcw, UserCog, CalendarClock, ListTree,
} from 'lucide-react';
import { startOfWeek, endOfWeek, addWeeks, addDays, eachDayOfInterval, format, isSameDay } from 'date-fns';
import { pt } from 'date-fns/locale';
import { getHojeLisboa } from '@/lib/dataLisboa';
import { mesParaData, ultimoDiaDoMes } from '@/lib/custos';
import { tipoNoMes } from '@/lib/remuneracaoProfessores';
import { sanitizarPedidoExplicacao, type PedidoExplicacaoSeguro } from '@/lib/formatoMensagens';

// «Nome · 7.º ano» — mesmo rótulo em toda a página (lista de alunos da
// modal, banners de pedidos, e os nomes mostrados no detalhe da sessão).
const rotuloAluno = (nome: string, anoEscolar: number | null | undefined) =>
  anoEscolar ? `${nome} · ${anoEscolar}.º ano` : nome;

const getNomeAluno = (ea: any) => {
  const aluno = Array.isArray(ea.alunos) ? ea.alunos[0] : ea.alunos;
  if (!aluno?.nome) return 'Desconhecido';
  return rotuloAluno(aluno.nome, aluno.ano_escolar);
};

const DIAS_SEMANA_EXTENSO: Record<number, string> = {
  1: 'Segunda-feira', 2: 'Terça-feira', 3: 'Quarta-feira', 4: 'Quinta-feira',
  5: 'Sexta-feira', 6: 'Sábado', 7: 'Domingo',
};

// Próxima data (hoje incluído) em que cai o dia da semana pedido —
// convenção 1=Segunda...7=Domingo, igual ao payload do pedido. Sempre a
// partir de getHojeLisboa(), nunca new Date() local.
function proximaOcorrencia(diaSemana1a7: number, hojeISO: string = getHojeLisboa()): string {
  const hoje = new Date(`${hojeISO}T00:00:00`);
  const diaSemanaHoje = hoje.getDay() === 0 ? 7 : hoje.getDay();
  let diferenca = diaSemana1a7 - diaSemanaHoje;
  if (diferenca < 0) diferenca += 7;
  return format(addDays(hoje, diferenca), 'yyyy-MM-dd');
}

// Extrai uma hora legível de texto livre ("17:00", "17h", "17h30", "depois
// das 18h") — sem correspondência clara, deixa em branco para a pessoa
// preencher à mão.
function extrairHoraDoPedido(horario: string | null): string {
  if (!horario) return '';
  const match = horario.match(/\b([01]?\d|2[0-3])[h:]([0-5]\d)?\b/i);
  if (!match) return '';
  const hora = match[1].padStart(2, '0');
  const minuto = match[2] ?? '00';
  return `${hora}:${minuto}`;
}

// Só apresentação: "Dada"/"Por dar" vêm direto de sessao.dado, sem comparar
// datas; "Cancelada" tem sempre prioridade sobre o estado de dado (uma
// sessão dada nunca fica cancelada — garantido por alterar_sessao).
const getEstadoSessaoResumido = (sessao: any) =>
  sessao.estado === 'cancelada'
    ? { label: 'Cancelada', classes: 'bg-page text-muted border-border' }
    : sessao.dado
      ? { label: 'Dada', classes: 'bg-success-bg text-success border-success/30' }
      : { label: 'Por dar', classes: 'bg-page text-muted border-border' };

// Nomes separados por vírgula (sem o "· N.º ano" por nome, que rotuloAluno/
// getNomeAluno sempre acrescentam — usados tal e qual nas modais) + o ano
// escolar do grupo UMA vez só, à parte, tal como o desenho pede. Uma sessão
// em grupo é sempre do mesmo ano (validado em toggleAluno), por isso o ano
// do primeiro aluno já representa o grupo todo.
function nomesEAnoDaSessao(sessao: any): { nomes: string; anoEscolar: number | null } {
  const alunos = (sessao.explicacoes_alunos || [])
    .map((ea: any) => (Array.isArray(ea.alunos) ? ea.alunos[0] : ea.alunos))
    .filter(Boolean);
  return {
    nomes: alunos.map((a: any) => a?.nome || 'Desconhecido').join(', '),
    anoEscolar: alunos[0]?.ano_escolar ?? null,
  };
}

// "12 a 18 Out" — ou "29 Set a 5 Out" quando a semana atravessa dois meses.
function intervaloSemanaLabel(inicio: Date, fim: Date): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const mesInicio = cap(format(inicio, 'MMM', { locale: pt }));
  const mesFim = cap(format(fim, 'MMM', { locale: pt }));
  if (mesInicio === mesFim) return `${format(inicio, 'd')} a ${format(fim, 'd')} ${mesFim}`;
  return `${format(inicio, 'd')} ${mesInicio} a ${format(fim, 'd')} ${mesFim}`;
}

// Soma horas_dadas já carregadas na semana (mesmo campo e mesma soma que
// app/admin/pagamentos/page.tsx usa) — "3 h 30", nunca em euros.
function formatarHorasResumo(totalHoras: number): string {
  const totalMinutos = Math.round(totalHoras * 60);
  const h = Math.floor(totalMinutos / 60);
  const m = totalMinutos % 60;
  return m > 0 ? `${h} h ${m}` : `${h} h`;
}

function ExplicacoesPageContent() {
  const { toast, showError, showSuccess } = useStatusToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [role, setRole] = useState<string | null>(null);
  const [centroId, setCentroId] = useState<string | null>(null);
  const [professores, setProfessores] = useState<any[]>([]);
  const [selectedProfessorId, setSelectedProfessorId] = useState<string | null>(null);

  const [subjects, setSubjects] = useState<any[]>([]);
  const [alunosAtivos, setAlunosAtivos] = useState<any[]>([]);

  const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [sessoes, setSessoes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [marcandoHoje, setMarcandoHoje] = useState(false);

  const [detalheSessao, setDetalheSessao] = useState<any | null>(null);
  const [novaModalOpen, setNovaModalOpen] = useState(false);
  const [pedidoPreSelecionado, setPedidoPreSelecionado] = useState<{ id: string; alunoId: string; disciplinaId: string | null; detalhe: PedidoExplicacaoSeguro } | null>(null);

  // Banner "N pedidos por marcar" — só para admin. Um professor também abre
  // esta página (para a sua própria agenda) e não tem acesso de leitura a
  // mensagens (RLS); nunca pede nem mostra nada para ele, e nunca dá erro.
  const [pedidosPendentes, setPedidosPendentes] = useState<any[]>([]);
  const [pedidosAbertos, setPedidosAbertos] = useState(false);

  // Só apresentação: qual dia está em foco na faixa da semana (fundo de
  // destaque + scroll até ao grupo) — nunca decide o que é "hoje" (isso
  // continua a ser calculado com getHojeLisboa(), mais abaixo).
  const [diaFocoISO, setDiaFocoISO] = useState<string | null>(null);

  // Se o PRÓPRIO professor autenticado é de salário no mês civil atual —
  // via RPC security definer sou_salario_no_mes (nunca lê periodos_valor_
  // professor diretamente, isso é RLS admin-only). Esconde "Trabalhei Hoje
  // — Os Meus Dias" (abaixo) e, no detalhe de uma sessão, "Último valor
  // calculado" (ver DetalheExplicacaoModal). Falha na chamada = assume
  // variável (não esconde nada) e avisa com o StatusToast — nunca esconde
  // por causa de um erro de rede.
  const [souSalarioNoMesAtual, setSouSalarioNoMesAtual] = useState(false);

  const verificarSouSalarioNoMes = useCallback(async () => {
    if (role !== 'professor') return;
    const primeiroDiaDoMes = mesParaData(getHojeLisboa().slice(0, 7));
    const { data, error } = await supabase.rpc('sou_salario_no_mes', { p_mes: primeiroDiaDoMes });
    if (error) {
      showError('Erro ao verificar o tipo de remuneração: ' + error.message);
      setSouSalarioNoMesAtual(false);
      return;
    }
    setSouSalarioNoMesAtual(!!data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  useEffect(() => { verificarSouSalarioNoMes(); }, [verificarSouSalarioNoMes]);

  // "Os meus dias" (só professor) — dias de trabalho do mês civil atual,
  // nunca em euros.
  const [meusDias, setMeusDias] = useState<Record<string, number>>({});

  const carregarMeusDias = useCallback(async () => {
    if (role !== 'professor' || !selectedProfessorId) return;
    const mesAtualStr = getHojeLisboa().slice(0, 7);
    const { data, error } = await supabase
      .from('dias_trabalho_professor')
      .select('data, fracao')
      .eq('professor_id', selectedProfessorId)
      .gte('data', mesParaData(mesAtualStr))
      .lte('data', ultimoDiaDoMes(mesAtualStr))
      .order('data');
    if (error) {
      showError('Erro ao carregar os meus dias: ' + error.message);
      return;
    }
    const mapa: Record<string, number> = {};
    (data || []).forEach((d: any) => { mapa[d.data] = Number(d.fracao); });
    setMeusDias(mapa);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, selectedProfessorId]);

  useEffect(() => { carregarMeusDias(); }, [carregarMeusDias]);

  const handleMarcarMeuDia = async (dataISO: string, fracao: 0.5 | 1 | null) => {
    if (!centroId || !selectedProfessorId) return;
    if (fracao === null) {
      const { error } = await supabase
        .from('dias_trabalho_professor')
        .delete()
        .eq('professor_id', selectedProfessorId)
        .eq('data', dataISO);
      if (error) { showError(error.message); return; }
    } else {
      // Nunca enviar marcado_por — o gatilho preenche-o no servidor.
      const { error } = await supabase
        .from('dias_trabalho_professor')
        .upsert({ centro_id: centroId, professor_id: selectedProfessorId, data: dataISO, fracao }, { onConflict: 'professor_id,data' });
      if (error) { showError(error.message); return; }
    }
    carregarMeusDias();
  };

  const carregarPedidosPendentes = useCallback(async (centro_id: string) => {
    const { data, error } = await supabase
      .from('mensagens')
      .select('id, aluno_id, payload, criada_em, alunos!aluno_id(nome, ano_escolar)')
      .eq('centro_id', centro_id)
      .eq('tipo', 'pedido_explicacao')
      .eq('estado', 'pendente')
      .order('criada_em', { ascending: true });
    if (!error) setPedidosPendentes(data || []);
  }, []);

  useEffect(() => {
    if (role !== 'admin' || !centroId) return;
    carregarPedidosPendentes(centroId);
  }, [role, centroId, carregarPedidosPendentes]);

  // ?pedido=<mensagem_id> — pré-preenche o NovaExplicacaoModal a partir de
  // um pedido pendente (vindo do cartão em /admin/mensagens ou do banner).
  useEffect(() => {
    const pedidoId = searchParams.get('pedido');
    if (!pedidoId || role !== 'admin') return;

    (async () => {
      const { data, error } = await supabase
        .from('mensagens')
        .select('id, aluno_id, payload, estado')
        .eq('id', pedidoId)
        .maybeSingle();

      if (error || !data) {
        showError('Não foi possível carregar o pedido.');
      } else if (data.estado !== 'pendente') {
        showError('Este pedido já foi tratado.');
      } else {
        const detalhe = sanitizarPedidoExplicacao(data.payload);
        setPedidoPreSelecionado({ id: data.id, alunoId: data.aluno_id, disciplinaId: detalhe.disciplinaId != null ? String(detalhe.disciplinaId) : null, detalhe });
        setNovaModalOpen(true);
      }
      router.replace('/admin/explicacoes');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, role]);

  // --- CARGA INICIAL: identidade, disciplinas, alunos, professores (se admin) ---
  // initRef bloqueia a segunda invocação do StrictMode (dev). Independentemente
  // disso, subjects/alunos são pedidos em paralelo com getUser() (não dependem
  // do professor selecionado) e setSelectedProfessorId só é chamado no fim —
  // é a única mudança de estado desta função que aciona os efeitos de tarifa e
  // de sessões da semana, por isso tem de ser sempre a última coisa a acontecer,
  // depois de todas as outras chamadas já estarem resolvidas (não só em dev
  // com StrictMode — isto acontecia também em produção, sem duplicação nenhuma).
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    (async () => {
      // gerar_sessoes_series() corre aqui, em paralelo com o resto — é
      // idempotente e segura em paralelo (qualquer staff pode chamá-la), por
      // isso não depende de role/centro para arrancar. Uma falha mostra-se
      // com o StatusToast mas nunca bloqueia a carga da página.
      const [{ data: { user } }, { data: subData }, { data: alunosData }, { data: professoresData }, { error: erroGeracao }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('subjects').select('id, name, centro_id, anos_aplicaveis').order('name'),
        supabase.from('alunos').select('id, nome, ano_escolar').eq('ativo', true).order('nome'),
        supabase.from('staff').select('id, name').eq('role', 'professor').order('name'),
        supabase.rpc('gerar_sessoes_series'),
      ]);

      if (erroGeracao) showError('Erro ao gerar as sessões das séries: ' + erroGeracao.message);

      const r = user?.app_metadata?.role?.toLowerCase() ?? null;
      const cId = user?.app_metadata?.centro_id ?? null;
      // subjects já vem pedido em paralelo com getUser() (não depende dele) —
      // filtra pelo centro aqui, só depois de cId estar disponível.
      setSubjects((subData || []).filter((s: any) => s.centro_id === cId));
      setAlunosAtivos(alunosData || []);
      setRole(r);
      setCentroId(cId);
      // Lista de professores do centro carregada para qualquer role — além
      // do seletor do admin, alimenta "Trocar professor" na modal de
      // detalhe, também disponível ao professor da sessão.
      setProfessores(professoresData || []);

      if (r === 'professor' && user) {
        setSelectedProfessorId(user.id);
      } else if (r === 'admin') {
        if (professoresData && professoresData.length > 0) setSelectedProfessorId(professoresData[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- SESSÕES DA SEMANA ---
  // Guarda contra chamadas sobrepostas (mesmo padrão de isFetchingRef/fetchPendingRef
  // do Dashboard admin): navegação rápida entre semanas ou StrictMode em dev podem
  // disparar fetchSessoes várias vezes antes da anterior terminar.
  const isFetchingSessoesRef = useRef(false);
  const fetchSessoesPendingRef = useRef(false);

  const fetchSessoes = useCallback(async () => {
    if (!selectedProfessorId) {
      setSessoes([]);
      setLoading(false);
      return;
    }
    if (isFetchingSessoesRef.current) {
      fetchSessoesPendingRef.current = true;
      return;
    }
    isFetchingSessoesRef.current = true;
    setLoading(true);
    try {
      const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });

      const { data, error } = await supabase
        .from('explicacoes')
        .select('*, explicacoes_alunos(id, aluno_id, valor_cobrado_familia, alunos(nome, ano_escolar)), subjects(name)')
        .eq('professor_id', selectedProfessorId)
        .gte('data', format(currentWeekStart, 'yyyy-MM-dd'))
        .lte('data', format(weekEnd, 'yyyy-MM-dd'))
        .order('data', { ascending: true })
        .order('hora_inicio', { ascending: true });

      if (error) {
        showError('Erro ao carregar explicações: ' + error.message);
        return;
      }
      setSessoes(data || []);
    } finally {
      setLoading(false);
      isFetchingSessoesRef.current = false;
      if (fetchSessoesPendingRef.current) {
        fetchSessoesPendingRef.current = false;
        fetchSessoes();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfessorId, currentWeekStart]);

  useEffect(() => { fetchSessoes(); }, [fetchSessoes]);

  const diasDaSemana = eachDayOfInterval({
    start: currentWeekStart,
    end: endOfWeek(currentWeekStart, { weekStartsOn: 1 }),
  });

  const handleSessaoAtualizada = (atualizada: any) => {
    // "Trocar professor" muda o professor_id — a sessão deixa de pertencer
    // à agenda do professor selecionado e tem de desaparecer da lista
    // atual, nunca só atualizar-se no lugar (que a deixaria visível na
    // agenda errada até ao próximo fetchSessoes).
    setSessoes((prev) =>
      atualizada.professor_id !== selectedProfessorId
        ? prev.filter((s) => s.id !== atualizada.id)
        : prev.map((s) => (s.id === atualizada.id ? atualizada : s))
    );
    setDetalheSessao(null);
  };

  const handleSessaoApagada = (id: string) => {
    setSessoes((prev) => prev.filter((s) => s.id !== id));
    setDetalheSessao(null);
  };

  // "Marcar as de hoje como dadas" — só sessões de hoje (getHojeLisboa(),
  // nunca new Date() local), estado 'ativa' e ainda não dadas. Cada uma
  // recebe horas_dadas = duracao_prevista_horas (as sessões manuais, sem
  // duração prevista, nunca são marcadas automaticamente — ficam de fora e
  // o resultado diz quantas). Query direta à base de dados (não ao estado
  // sessoes já carregado), porque "hoje" pode não estar na semana aberta.
  const nomeProfessorSelecionado = professores.find((p) => p.id === selectedProfessorId)?.name || 'professor';

  const handleMarcarHojeComoDadas = async () => {
    if (!selectedProfessorId || marcandoHoje) return;
    const hojeISO = getHojeLisboa();
    const { data: hojeSessoes, error } = await supabase
      .from('explicacoes')
      .select('id, duracao_prevista_horas')
      .eq('professor_id', selectedProfessorId)
      .eq('data', hojeISO)
      .eq('estado', 'ativa')
      .eq('dado', false);

    if (error) {
      showError('Erro ao verificar as sessões de hoje: ' + error.message);
      return;
    }
    if (!hojeSessoes || hojeSessoes.length === 0) {
      showError('Não há sessões de hoje por marcar.');
      return;
    }
    if (!confirm(`Marcar as ${hojeSessoes.length} sessões de hoje de ${nomeProfessorSelecionado} como dadas?`)) return;

    setMarcandoHoje(true);
    try {
      const comDuracao = hojeSessoes.filter((s) => s.duracao_prevista_horas != null);
      const semDuracao = hojeSessoes.length - comDuracao.length;

      const resultados = await Promise.all(
        comDuracao.map((s) =>
          supabase.from('explicacoes').update({ dado: true, horas_dadas: s.duracao_prevista_horas }).eq('id', s.id)
        )
      );
      const erroMarcar = resultados.find((r) => r.error)?.error;
      if (erroMarcar) {
        showError('Erro ao marcar sessões como dadas: ' + erroMarcar.message);
        return;
      }

      showSuccess(
        `${comDuracao.length} ${comDuracao.length === 1 ? 'sessão marcada' : 'sessões marcadas'} como dadas.` +
          (semDuracao > 0 ? ` ${semDuracao} ${semDuracao === 1 ? 'ficou' : 'ficaram'} de fora (sem duração definida).` : '')
      );
      fetchSessoes();
    } finally {
      setMarcandoHoje(false);
    }
  };

  return (
    <main className="min-h-screen bg-page text-primary p-6 md:p-8 max-w-7xl mx-auto font-sans">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <Link href="/admin" className="p-3 bg-surface border border-border rounded-2xl hover:bg-raised transition-colors shrink-0">
              <ArrowLeft size={20} className="text-secondary" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter uppercase flex items-center gap-3">
                <GraduationCap className="text-accent shrink-0" /> Explicações
              </h1>
              <p className="text-muted text-[10px] font-black uppercase tracking-widest mt-1">Agenda de Sessões</p>
            </div>
          </div>
          {role === 'admin' && (
            <Link
              href="/admin/explicacoes/series"
              className="flex items-center gap-1.5 bg-surface border border-border hover:border-accent/50 text-secondary hover:text-primary px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all shrink-0"
            >
              <ListTree size={14} /> Séries
            </Link>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          <button
            onClick={handleMarcarHojeComoDadas}
            disabled={!selectedProfessorId || marcandoHoje}
            className="flex items-center gap-2 bg-surface border border-border hover:border-success/40 text-secondary hover:text-success px-4 py-3 rounded-2xl font-black text-sm transition-all active:scale-95 disabled:opacity-40 min-w-0"
          >
            {marcandoHoje ? <Loader2 className="animate-spin shrink-0" size={16} /> : <CheckCheck className="shrink-0" size={16} />}
            <span className="text-left break-words">Marcar as de hoje como dadas</span>
          </button>

          {role === 'admin' && (
            <select
              value={selectedProfessorId || ''}
              onChange={(e) => setSelectedProfessorId(e.target.value || null)}
              className="bg-surface border border-border p-3 rounded-2xl text-sm font-bold outline-none focus:border-accent/50 transition-all appearance-none min-w-0"
            >
              {professores.length === 0 && <option value="">Sem professores</option>}
              {professores.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          {/* SELETOR DE SEMANA */}
          <div className="flex items-center bg-surface border border-border rounded-2xl overflow-hidden p-1 shadow-xl shrink-0">
            <button aria-label="Semana anterior" onClick={() => setCurrentWeekStart((prev) => addWeeks(prev, -1))} className="p-2 hover:bg-raised text-secondary hover:text-primary transition-all">
              <ChevronLeft size={20} />
            </button>
            <div className="px-3 py-1 text-center">
              <p className="text-xs font-black text-primary whitespace-nowrap">
                {intervaloSemanaLabel(currentWeekStart, endOfWeek(currentWeekStart, { weekStartsOn: 1 }))}
              </p>
            </div>
            <button aria-label="Semana seguinte" onClick={() => setCurrentWeekStart((prev) => addWeeks(prev, 1))} className="p-2 hover:bg-raised text-secondary hover:text-primary transition-all">
              <ChevronRight size={20} />
            </button>
          </div>

          <button
            onClick={() => setCurrentWeekStart(startOfWeek(new Date(`${getHojeLisboa()}T00:00:00`), { weekStartsOn: 1 }))}
            className="bg-surface border border-border hover:bg-raised text-primary px-4 py-3 rounded-2xl font-black text-sm transition-all active:scale-95 shrink-0"
          >
            Hoje
          </button>

          <button
            onClick={() => setNovaModalOpen(true)}
            disabled={!selectedProfessorId}
            className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-on-accent px-4 py-3 rounded-2xl font-black text-sm transition-all active:scale-95 disabled:opacity-40 sm:ml-auto shrink-0"
          >
            <Plus size={18} /> Nova Explicação
          </button>
        </div>
      </div>

      {role === 'professor' && !souSalarioNoMesAtual && (() => {
        const hojeISO = getHojeLisboa();
        const ontemISO = format(addDays(new Date(`${hojeISO}T00:00:00`), -1), 'yyyy-MM-dd');
        const somaMeusDias = Object.values(meusDias).reduce((acc, f) => acc + f, 0);
        const linhaDia = (label: string, dataISO: string) => {
          const fracao = meusDias[dataISO];
          return (
            <div key={dataISO} className="bg-page border border-border rounded-2xl p-4">
              <p className="text-[10px] font-black uppercase text-muted mb-2">{label}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleMarcarMeuDia(dataISO, fracao === 0.5 ? null : 0.5)}
                  className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase tracking-wide border transition-all ${
                    fracao === 0.5 ? 'bg-accent text-on-accent border-accent' : 'bg-surface border-border text-secondary hover:border-accent/50'
                  }`}
                >
                  Meio Dia
                </button>
                <button
                  type="button"
                  onClick={() => handleMarcarMeuDia(dataISO, fracao === 1 ? null : 1)}
                  className={`flex-1 py-2 rounded-xl text-[11px] font-black uppercase tracking-wide border transition-all ${
                    fracao === 1 ? 'bg-accent text-on-accent border-accent' : 'bg-surface border-border text-secondary hover:border-accent/50'
                  }`}
                >
                  Dia Inteiro
                </button>
              </div>
            </div>
          );
        };
        return (
          <div data-testid="meus-dias-trabalho" className="bg-surface border border-border rounded-3xl p-6 mb-8">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-xs font-black uppercase tracking-widest text-muted">
                Trabalhei Hoje — Os Meus Dias ({format(new Date(`${hojeISO}T00:00:00`), 'MMMM yyyy', { locale: pt })})
              </h2>
              <span className="text-xs font-bold text-secondary">{somaMeusDias} {somaMeusDias === 1 ? 'dia' : 'dias'} este mês</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {linhaDia('Hoje', hojeISO)}
              {linhaDia('Ontem', ontemISO)}
            </div>
            {Object.keys(meusDias).length > 0 && (
              <div className="space-y-1.5">
                {Object.entries(meusDias)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([data, fracao]) => (
                    <div key={data} className="flex items-center justify-between text-xs bg-page border border-border/60 rounded-lg px-3 py-2">
                      <span className="text-secondary font-bold">{format(new Date(`${data}T00:00:00`), "d 'de' MMMM", { locale: pt })}</span>
                      <span className="font-bold text-primary">{fracao === 1 ? 'Dia inteiro' : 'Meio dia'}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        );
      })()}

      {role === 'admin' && pedidosPendentes.length > 0 && (
        <div className="bg-warning-bg border border-warning/20 rounded-2xl mb-8 overflow-hidden">
          <button
            type="button"
            onClick={() => setPedidosAbertos((v) => !v)}
            className="w-full flex items-center justify-between gap-2 p-4 text-warning"
          >
            <span className="flex items-center gap-2 min-w-0">
              <HelpCircle size={18} className="shrink-0" />
              <span className="font-black text-sm">{pedidosPendentes.length} pedido{pedidosPendentes.length > 1 ? 's' : ''} por marcar</span>
            </span>
            {pedidosAbertos ? <ChevronUp size={18} className="shrink-0" /> : <ChevronDown size={18} className="shrink-0" />}
          </button>
          {pedidosAbertos && (
            <div className="space-y-1.5 px-4 pb-4">
              {pedidosPendentes.map((p) => (
                <Link
                  key={p.id}
                  href={`/admin/explicacoes?pedido=${p.id}`}
                  className="flex items-center justify-between gap-2 bg-page/60 hover:bg-page rounded-xl px-3 py-2 text-sm transition-colors"
                >
                  <span className="font-bold text-primary min-w-0 break-words">
                    {rotuloAluno(p.alunos?.nome ?? 'Aluno', p.alunos?.ano_escolar)} — {sanitizarPedidoExplicacao(p.payload).disciplina ?? 'Disciplina'}
                  </span>
                  <span className="text-[10px] font-black uppercase text-warning shrink-0">Marcar</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {pedidoPreSelecionado && !selectedProfessorId && (
        <div className="bg-warning-bg border border-warning/20 rounded-2xl p-4 mb-8">
          <p className="font-bold text-sm text-warning">
            Escolhe o professor para marcar o pedido de {(() => {
              const a = alunosAtivos.find((a: any) => a.id === pedidoPreSelecionado.alunoId);
              return a ? rotuloAluno(a.nome, a.ano_escolar) : 'aluno';
            })()}.
          </p>
        </div>
      )}

      {!selectedProfessorId ? (
        <div className="bg-surface/70 border-2 border-dashed border-border p-16 rounded-[3rem] text-center flex flex-col items-center">
          <GraduationCap size={48} className="mb-6 text-muted" />
          <p className="text-muted font-bold text-lg">
            {role === 'admin' ? 'Sem professores disponíveis.' : 'Não foi possível identificar o professor.'}
          </p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-accent" size={32} />
        </div>
      ) : (() => {
        // Agrupado uma única vez — a faixa da semana e os grupos por dia
        // usam exatamente a mesma contagem, nunca recalculada em separado.
        const hojeDate = new Date(`${getHojeLisboa()}T00:00:00`);
        // Uma sessão cancelada fica sempre visível no grupo do dia, mas
        // nunca entra em nenhuma contagem ("N sessões", "N sess.", total de
        // horas da semana) — sessoesAtivasDoDia é a mesma lista menos essas.
        const sessoesPorDia = diasDaSemana.map((dia) => {
          const sessoesDoDia = sessoes.filter((s) => isSameDay(new Date(s.data + 'T00:00:00'), dia));
          return {
            dia,
            diaISO: format(dia, 'yyyy-MM-dd'),
            ehHoje: isSameDay(dia, hojeDate),
            sessoesDoDia,
            sessoesAtivasDoDia: sessoesDoDia.filter((s) => s.estado !== 'cancelada'),
          };
        });
        const sessoesAtivasSemana = sessoes.filter((s) => s.estado !== 'cancelada');
        const totalSessoesSemana = sessoesAtivasSemana.length;
        const totalHorasSemana = sessoesAtivasSemana.reduce((soma, s) => soma + (Number(s.horas_dadas) || 0), 0);

        const irParaDia = (diaISO: string) => {
          setDiaFocoISO(diaISO);
          document.getElementById(`dia-grupo-${diaISO}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };

        return (
          <div className="space-y-6">
            {/* FAIXA DA SEMANA */}
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {sessoesPorDia.map(({ dia, diaISO, ehHoje, sessoesAtivasDoDia }) => (
                <button
                  key={diaISO}
                  onClick={() => irParaDia(diaISO)}
                  className={`min-w-0 flex flex-col items-center gap-0.5 rounded-2xl border px-1 py-2.5 transition-all ${
                    diaFocoISO === diaISO
                      ? 'bg-accent-soft border-accent text-accent'
                      : ehHoje
                        ? 'bg-accent text-on-accent border-accent'
                        : 'bg-surface border-border text-secondary hover:border-accent/40'
                  }`}
                >
                  <span className="text-[9px] font-black uppercase tracking-widest opacity-80">{format(dia, 'EEEEE', { locale: pt })}</span>
                  <span className="text-base font-black leading-none">{format(dia, 'd')}</span>
                  <span className="text-[9px] font-bold leading-tight text-center break-words">
                    {sessoesAtivasDoDia.length > 0 ? `${sessoesAtivasDoDia.length} sess.` : 'livre'}
                  </span>
                </button>
              ))}
            </div>

            {/* GRUPOS POR DIA */}
            <div className="space-y-5">
              {sessoesPorDia.map(({ dia, diaISO, ehHoje, sessoesDoDia, sessoesAtivasDoDia }) => (
                <div
                  key={diaISO}
                  id={`dia-grupo-${diaISO}`}
                  className={`rounded-3xl border transition-colors scroll-mt-4 ${
                    diaFocoISO === diaISO ? 'bg-accent-soft/40 border-accent/40' : 'bg-surface border-border'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <h2 className="text-sm font-black text-primary capitalize break-words">
                        {format(dia, 'EEEE, d', { locale: pt })}
                      </h2>
                      {ehHoje && (
                        <span className="shrink-0 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-accent text-on-accent">hoje</span>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-3">
                      <span className="text-xs font-bold text-muted whitespace-nowrap">
                        {sessoesAtivasDoDia.length > 0 ? `${sessoesAtivasDoDia.length} ${sessoesAtivasDoDia.length === 1 ? 'sessão' : 'sessões'}` : 'livre'}
                      </span>
                      {sessoesDoDia.length === 0 && (
                        <button
                          onClick={() => setNovaModalOpen(true)}
                          disabled={!selectedProfessorId}
                          className="flex items-center gap-1 bg-accent hover:bg-accent-hover text-on-accent px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-40"
                        >
                          <Plus size={12} /> Marcar
                        </button>
                      )}
                    </div>
                  </div>

                  {sessoesDoDia.length > 0 && (
                    <div className="divide-y divide-border border-t border-border">
                      {sessoesDoDia.map((sessao) => {
                        const estado = getEstadoSessaoResumido(sessao);
                        const cancelada = sessao.estado === 'cancelada';
                        const { nomes, anoEscolar } = nomesEAnoDaSessao(sessao);
                        const hora = sessao.hora_inicio?.slice(0, 5);
                        const duracao = sessao.horas_dadas != null ? formatarHorasResumo(Number(sessao.horas_dadas)) : null;
                        const disciplina = sessao.subjects?.name || '—';
                        const etiquetaFixa = sessao.serie_id && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest bg-page text-muted border border-border">
                            Fixa
                          </span>
                        );
                        return (
                          <button
                            key={sessao.id}
                            data-sessao-linha="1"
                            data-sessao-estado={sessao.estado}
                            data-sessao-dado={String(sessao.dado)}
                            onClick={() => setDetalheSessao(sessao)}
                            className={`w-full text-left px-4 py-3.5 hover:bg-raised/40 transition-colors ${cancelada ? 'opacity-50' : ''}`}
                          >
                            {/* < 768px: hora/disciplina/estado em cima, alunos por baixo */}
                            <div className="md:hidden space-y-1.5">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3 min-w-0 flex-1">
                                  <div className="shrink-0">
                                    <p className={`font-black text-sm flex items-center gap-1 whitespace-nowrap ${cancelada ? 'text-muted line-through' : 'text-accent'}`}><Clock size={13} />{hora}</p>
                                    {duracao && <p className="text-[10px] text-muted mt-0.5 whitespace-nowrap">{duracao}</p>}
                                  </div>
                                  <p className={`min-w-0 break-words text-sm font-bold flex items-center gap-1.5 ${cancelada ? 'text-muted line-through' : 'text-primary'}`}>
                                    {disciplina} {etiquetaFixa}
                                  </p>
                                </div>
                                <span className={`shrink-0 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border whitespace-nowrap ${estado.classes}`}>
                                  {estado.label}
                                </span>
                              </div>
                              <p className={`min-w-0 break-words text-sm ${cancelada ? 'text-muted line-through' : 'text-secondary'}`}>
                                {nomes || 'Sem alunos'}{anoEscolar && <span className="text-muted"> · {anoEscolar}.º ano</span>}
                              </p>
                            </div>

                            {/* >= 768px: hora | disciplina | alunos | estado, uma linha só */}
                            <div className="hidden md:grid md:grid-cols-4 md:gap-4 md:items-start">
                              <div className="min-w-0">
                                <p className={`font-black text-sm flex items-center gap-1 whitespace-nowrap ${cancelada ? 'text-muted line-through' : 'text-accent'}`}><Clock size={14} />{hora}</p>
                                {duracao && <p className="text-[10px] text-muted mt-0.5 whitespace-nowrap">{duracao}</p>}
                              </div>
                              <p className={`min-w-0 break-words text-sm font-bold flex items-center gap-1.5 ${cancelada ? 'text-muted line-through' : 'text-primary'}`}>
                                {disciplina} {etiquetaFixa}
                              </p>
                              <p className={`min-w-0 break-words text-sm ${cancelada ? 'text-muted line-through' : 'text-secondary'}`}>
                                {nomes || 'Sem alunos'}{anoEscolar && <span className="text-muted"> · {anoEscolar}.º ano</span>}
                              </p>
                              <div className="min-w-0 flex justify-end">
                                <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border whitespace-nowrap ${estado.classes}`}>
                                  {estado.label}
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* RESUMO */}
            <div className="flex items-center gap-2 text-muted px-1">
              <CalendarDays size={14} className="shrink-0" />
              <p className="text-xs font-bold break-words">
                Esta semana: {totalSessoesSemana} {totalSessoesSemana === 1 ? 'sessão' : 'sessões'}, {formatarHorasResumo(totalHorasSemana)}
              </p>
            </div>
          </div>
        );
      })()}

      {detalheSessao && (
        <DetalheExplicacaoModal
          sessao={detalheSessao}
          role={role}
          souSalarioNoMesAtual={souSalarioNoMesAtual}
          professores={professores}
          onClose={() => setDetalheSessao(null)}
          onSaved={handleSessaoAtualizada}
          onDeleted={handleSessaoApagada}
          showError={showError}
          showSuccess={showSuccess}
        />
      )}

      {novaModalOpen && selectedProfessorId && centroId && (
        <NovaExplicacaoModal
          professorId={selectedProfessorId}
          centroId={centroId}
          subjects={subjects}
          alunosAtivos={alunosAtivos}
          initialAlunoIds={pedidoPreSelecionado ? [pedidoPreSelecionado.alunoId] : undefined}
          initialDisciplinaId={pedidoPreSelecionado?.disciplinaId ?? undefined}
          pedidoMensagemId={pedidoPreSelecionado?.id}
          pedidoAlunoId={pedidoPreSelecionado?.alunoId}
          pedidoDetalhe={pedidoPreSelecionado?.detalhe}
          onClose={() => { setNovaModalOpen(false); setPedidoPreSelecionado(null); }}
          onCreated={() => {
            setNovaModalOpen(false);
            setPedidoPreSelecionado(null);
            fetchSessoes();
            if (centroId) carregarPedidosPendentes(centroId);
          }}
          showError={showError}
          showSuccess={showSuccess}
        />
      )}

      <StatusToast toast={toast} />
    </main>
  );
}

export default function ExplicacoesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>}>
      <ExplicacoesPageContent />
    </Suspense>
  );
}

// --- PAINEL DE DETALHE: toggle dado, horas, notas, apagar (só se ainda não dada) ---
type AcaoSessao = 'cancelar' | 'mudar' | 'professor' | 'reativar';

function DetalheExplicacaoModal({ sessao, role, souSalarioNoMesAtual, professores, onClose, onSaved, onDeleted, showError, showSuccess }: any) {
  const [dado, setDado] = useState<boolean>(sessao.dado);
  const [horasDadas, setHorasDadas] = useState(sessao.horas_dadas?.toString() || '');
  const [notas, setNotas] = useState(sessao.notas || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Ações via alterar_sessao (cancelar/mudar/trocar professor/repor) — a
  // ÚNICA forma de escrever estado, serie_id, data ou hora_inicio de uma
  // explicação; qualquer outra tentativa é recusada pela base de dados.
  const [acaoAberta, setAcaoAberta] = useState<AcaoSessao | null>(null);
  const [motivoAcao, setMotivoAcao] = useState('');
  const [novaData, setNovaData] = useState(sessao.data);
  const [novaHora, setNovaHora] = useState(sessao.hora_inicio?.slice(0, 5) || '');
  const [novoProfessorId, setNovoProfessorId] = useState('');
  const [alterando, setAlterando] = useState(false);

  const nAlunosSessao = (sessao.explicacoes_alunos || []).length;
  const podeAlterarSessao = role === 'admin' || role === 'professor';
  const cancelarMudarReporDesativado = sessao.dado;
  const trocarProfessorDesativado = sessao.dado && role !== 'admin';
  const outrosProfessores = (professores || []).filter((p: any) => p.id !== sessao.professor_id);

  const abrirAcao = (acao: AcaoSessao) => {
    setMotivoAcao('');
    setNovaData(sessao.data);
    setNovaHora(sessao.hora_inicio?.slice(0, 5) || '');
    setNovoProfessorId('');
    setAcaoAberta(acao);
  };

  const handleConfirmarAcao = async () => {
    if (!acaoAberta || alterando) return;
    if (acaoAberta === 'mudar' && (!novaData || !novaHora)) {
      showError('Preenche a nova data e hora.');
      return;
    }
    if (acaoAberta === 'professor' && !novoProfessorId) {
      showError('Escolhe o novo professor.');
      return;
    }

    setAlterando(true);
    try {
      const params: Record<string, unknown> = { p_explicacao: sessao.id, p_acao: acaoAberta };
      if (acaoAberta === 'cancelar') params.p_motivo = motivoAcao.trim() || null;
      if (acaoAberta === 'mudar') { params.p_data = novaData; params.p_hora = novaHora; }
      if (acaoAberta === 'professor') params.p_professor = novoProfessorId;

      const { error } = await supabase.rpc('alterar_sessao', params);
      if (error) {
        showError(error.message);
        return;
      }

      // Trocar professor: o professor de origem perde o acesso RLS a esta
      // linha no mesmo instante (já não é dele) — reler por SELECT devolvia
      // "no rows" só para ele. Monta a sessão atualizada a partir do que já
      // se sabe, sem reler; handleSessaoAtualizada decide se ela desaparece
      // da agenda atual (deixou de ser do professor selecionado).
      if (acaoAberta === 'professor') {
        showSuccess('Sessão atualizada.');
        onSaved({ ...sessao, professor_id: novoProfessorId });
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('explicacoes')
        .select('*, explicacoes_alunos(id, aluno_id, valor_cobrado_familia, alunos(nome, ano_escolar)), subjects(name)')
        .eq('id', sessao.id)
        .single();
      if (fetchError) {
        showError('Erro ao reler a explicação: ' + fetchError.message);
        return;
      }
      showSuccess('Sessão atualizada.');
      onSaved(data);
    } finally {
      setAlterando(false);
    }
  };

  // Para o admin: se o professor desta sessão é de salário no mês da
  // sessão, esconde "Último valor calculado" (não gera pagamento à parte
  // para ele) — nada muda aqui, é a mesma consulta de sempre (RLS admin-
  // only a periodos_valor_professor). Para o professor a ver a sua própria
  // sessão, quem decide é souSalarioNoMesAtual (RPC sou_salario_no_mes, lido
  // no componente pai) — esta consulta aqui nem chega a correr para ele.
  const [professorEhSalario, setProfessorEhSalario] = useState(false);
  useEffect(() => {
    if (role === 'professor') return;
    let ativo = true;
    supabase
      .from('periodos_valor_professor')
      .select('de, ate, valor')
      .eq('professor_id', sessao.professor_id)
      .eq('tipo', 'salario')
      .then(({ data }) => {
        if (!ativo) return;
        const periodos = (data || []).map((p: any) => ({ de: p.de, ate: p.ate, valor: Number(p.valor) }));
        setProfessorEhSalario(tipoNoMes(periodos, sessao.data.slice(0, 7)) === 'salario');
      });
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, sessao.professor_id, sessao.data]);

  const escondeValorCalculado = role === 'professor' ? souSalarioNoMesAtual : professorEhSalario;

  const nomes = (sessao.explicacoes_alunos || []).map(getNomeAluno).join(', ');

  const handleGuardar = async () => {
    const bruto = horasDadas.trim();
    const horas = bruto === '' ? null : parseFloat(bruto);
    if (bruto !== '' && (horas === null || isNaN(horas))) {
      showError('Indica um número de horas válido.');
      return;
    }

    setSaving(true);
    // valor_calculado (professor) e valor_cobrado_familia (por aluno) já não
    // se calculam aqui — o trigger calcular_valores_explicacao trata dos dois
    // assim que dado passa (ou continua) a true.
    const payload = { dado, horas_dadas: horas, notas: notas.trim() || null };

    const { error } = await supabase.from('explicacoes').update(payload).eq('id', sessao.id);

    if (error) {
      setSaving(false);
      showError('Erro ao guardar: ' + error.message);
      return;
    }

    // Reler numa segunda chamada, à parte do update — o update e o embedding de
    // explicacoes_alunos no mesmo pedido partilham o snapshot da mesma instrução
    // SQL, por isso não veem o valor_cobrado_familia que o trigger acabou de
    // escrever na tabela relacionada (fica null até um pedido novo).
    const { data, error: fetchError } = await supabase
      .from('explicacoes')
      .select('*, explicacoes_alunos(id, aluno_id, valor_cobrado_familia, alunos(nome, ano_escolar)), subjects(name)')
      .eq('id', sessao.id)
      .single();

    setSaving(false);
    if (fetchError) {
      showError('Erro ao reler a explicação: ' + fetchError.message);
      return;
    }
    showSuccess('Explicação atualizada.');
    onSaved(data);
  };

  const handleApagar = async () => {
    const mensagemConfirmacao = sessao.dado
      ? 'Esta sessão já foi dada e tem valores calculados. Apagar remove-os. Continuar?'
      : 'Apagar esta sessão? Esta ação não pode ser desfeita.';
    if (!confirm(mensagemConfirmacao)) return;

    setDeleting(true);
    try {
      // Só sessões já dadas têm valores a proteger — uma sessão não dada
      // apaga-se sempre, sem olhar a pagamentos.
      if (sessao.dado) {
        const [anoSessao, mesSessao] = sessao.data.split('-').map(Number);
        const alunoIds = (sessao.explicacoes_alunos || []).map((ea: any) => ea.aluno_id);

        const [{ data: pagProf, error: erroPagProf }, { data: pagFam, error: erroPagFam }] = await Promise.all([
          supabase.from('pagamentos_professores').select('id').eq('professor_id', sessao.professor_id).eq('ano', anoSessao).eq('mes', mesSessao).eq('pago', true).limit(1),
          alunoIds.length > 0
            ? supabase.from('pagamentos_explicacoes_familia').select('id').in('aluno_id', alunoIds).eq('ano', anoSessao).eq('mes', mesSessao).eq('pago', true).limit(1)
            : Promise.resolve({ data: [] as any[], error: null }),
        ]);

        if (erroPagProf || erroPagFam) {
          showError('Não foi possível verificar os pagamentos: ' + (erroPagProf || erroPagFam)!.message);
          return;
        }
        if ((pagProf && pagProf.length > 0) || (pagFam && pagFam.length > 0)) {
          showError('O mês já está marcado como pago. Desmarca o pagamento primeiro.');
          return;
        }
      }

      const { error } = await supabase.from('explicacoes').delete().eq('id', sessao.id);
      if (error) {
        showError('Erro ao apagar: ' + error.message);
        return;
      }
      showSuccess('Sessão apagada.');
      onDeleted(sessao.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface border border-border w-full max-w-md rounded-3xl shadow-2xl p-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-black text-primary">
            {format(new Date(sessao.data + 'T00:00:00'), "d 'de' MMMM", { locale: pt })} · {sessao.hora_inicio?.slice(0, 5)}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-primary transition-colors">
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-secondary font-bold mb-1">{nomes || 'Sem alunos'}</p>
        {sessao.subjects?.name && <p className="text-xs text-muted mb-6">{sessao.subjects.name}</p>}

        <div className="space-y-4">
          <div className="bg-page p-4 rounded-2xl border border-border flex items-center justify-between">
            <span className="font-bold text-sm text-primary">Sessão dada?</span>
            <button
              type="button"
              onClick={() => setDado((v) => {
                const novo = !v;
                // Sessão de série (duracao_prevista_horas definida) — ao marcar
                // como dada, pré-preenche as horas com a duração prevista, só
                // se o campo ainda estiver vazio (nunca substitui um valor já
                // escrito à mão).
                if (novo && sessao.duracao_prevista_horas != null && horasDadas.trim() === '') {
                  setHorasDadas(String(sessao.duracao_prevista_horas));
                }
                return novo;
              })}
              className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
                dado ? 'bg-success-bg text-success border-success/30' : 'bg-raised text-muted border-border'
              }`}
            >
              {dado ? 'Sim' : 'Não'}
            </button>
          </div>

          <div>
            <label className="text-xs font-bold text-muted uppercase ml-1">Horas Dadas</label>
            <input
              type="number"
              step="0.25"
              value={horasDadas}
              onChange={(e) => setHorasDadas(e.target.value)}
              placeholder="Ex: 1.5"
              className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-muted uppercase ml-1">Notas / Materiais</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              placeholder="Matéria dada, observações..."
              className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1 resize-none"
            />
          </div>

          {sessao.valor_calculado != null && !escondeValorCalculado && (
            <p className="text-xs text-muted">
              Último valor calculado: <span className="font-bold text-primary">{Number(sessao.valor_calculado).toFixed(2)}€</span>
            </p>
          )}

          {/* Preço cobrado à família — nunca para o professor, só o seu
              próprio valor_calculado acima fica visível a ele. */}
          {role !== 'professor' && sessao.dado && sessao.explicacoes_alunos?.length > 0 && (
            <div className="bg-page p-3 rounded-xl border border-border space-y-1.5">
              <p className="text-[9px] font-black uppercase text-muted tracking-widest">Cobrado à família</p>
              {sessao.explicacoes_alunos.map((ea: any) => (
                <div key={ea.id} className="flex items-center justify-between text-xs">
                  <span className="text-secondary font-bold">{ea.alunos?.nome ? rotuloAluno(ea.alunos.nome, ea.alunos.ano_escolar) : ''}</span>
                  {ea.valor_cobrado_familia != null ? (
                    <span className="font-bold text-primary">{Number(ea.valor_cobrado_familia).toFixed(2)}€</span>
                  ) : (
                    <span className="font-bold text-warning flex items-center gap-1">
                      <AlertTriangle size={10} /> Sem preço
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {podeAlterarSessao && (
          <div className="mt-6 pt-6 border-t border-border space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted">Ações</p>

            {!acaoAberta ? (
              <div className="flex flex-wrap gap-2">
                {sessao.estado === 'cancelada' ? (
                  <button
                    type="button"
                    onClick={() => abrirAcao('reativar')}
                    disabled={cancelarMudarReporDesativado}
                    className="flex items-center gap-1.5 bg-page border border-border text-success px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-40"
                  >
                    <RotateCcw size={13} /> Repor sessão
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => abrirAcao('cancelar')}
                      disabled={cancelarMudarReporDesativado}
                      className="flex items-center gap-1.5 bg-page border border-border text-danger px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-40"
                    >
                      <Ban size={13} /> Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => abrirAcao('mudar')}
                      disabled={cancelarMudarReporDesativado}
                      className="flex items-center gap-1.5 bg-page border border-border text-warning px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-40"
                    >
                      <CalendarClock size={13} /> Mudar hora ou dia
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => abrirAcao('professor')}
                  disabled={trocarProfessorDesativado}
                  className="flex items-center gap-1.5 bg-page border border-border text-accent px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all disabled:opacity-40"
                >
                  <UserCog size={13} /> Trocar professor
                </button>
              </div>
            ) : (
              <div className="bg-page border border-border rounded-2xl p-4 space-y-3">
                <p className="text-xs text-warning font-bold">
                  As famílias dos {nAlunosSessao} aluno{nAlunosSessao === 1 ? '' : 's'} recebem um aviso automático. O motivo só a direção o vê.
                </p>

                {acaoAberta === 'cancelar' && (
                  <div>
                    <label className="text-xs font-bold text-muted uppercase ml-1">Motivo (opcional)</label>
                    <input
                      type="text"
                      aria-label="Motivo"
                      value={motivoAcao}
                      onChange={(e) => setMotivoAcao(e.target.value)}
                      placeholder="Só a direção vê isto"
                      className="w-full bg-surface border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1"
                    />
                  </div>
                )}

                {acaoAberta === 'mudar' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-muted uppercase ml-1">Nova data</label>
                      <input
                        type="date"
                        aria-label="Nova data"
                        value={novaData}
                        onChange={(e) => setNovaData(e.target.value)}
                        className="w-full bg-surface border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-muted uppercase ml-1">Nova hora</label>
                      <input
                        type="time"
                        aria-label="Nova hora"
                        value={novaHora}
                        onChange={(e) => setNovaHora(e.target.value)}
                        className="w-full bg-surface border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1"
                      />
                    </div>
                  </div>
                )}

                {acaoAberta === 'professor' && (
                  <div>
                    <label className="text-xs font-bold text-muted uppercase ml-1">Novo professor</label>
                    <select
                      aria-label="Novo professor"
                      value={novoProfessorId}
                      onChange={(e) => setNovoProfessorId(e.target.value)}
                      className="w-full bg-surface border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1 appearance-none"
                    >
                      <option value="">Escolhe...</option>
                      {outrosProfessores.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAcaoAberta(null)}
                    disabled={alterando}
                    className="px-4 py-2.5 bg-raised hover:bg-border rounded-xl font-black text-xs transition-all active:scale-95 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmarAcao}
                    disabled={alterando}
                    className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-on-accent rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {alterando ? <Loader2 size={14} className="animate-spin" /> : null} Confirmar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleApagar}
            disabled={deleting || saving}
            className="p-4 bg-page border border-border text-danger hover:bg-danger-bg rounded-2xl transition-all active:scale-95 disabled:opacity-50"
          >
            {deleting ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
          </button>
          <button
            onClick={handleGuardar}
            disabled={saving || deleting}
            className="flex-1 bg-accent hover:bg-accent-hover text-on-accent p-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
          >
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// --- NOVA EXPLICAÇÃO: escolher aluno(s), data, hora, disciplina opcional ---
type EtapaExplicacao = 'nova' | 'alunos' | 'rpc';

function NovaExplicacaoModal({
  professorId, centroId, subjects, alunosAtivos, initialAlunoIds, initialDisciplinaId, pedidoMensagemId, pedidoAlunoId,
  pedidoDetalhe,
  onClose, onCreated, showError, showSuccess,
}: any) {
  const [alunoIds, setAlunoIds] = useState<string[]>(initialAlunoIds || []);
  const [buscaAluno, setBuscaAluno] = useState('');
  // Pré-preenchidos a partir do pedido da família quando existe — a próxima
  // ocorrência do primeiro dia pedido, e a hora só se o texto livre do
  // horário tiver uma hora legível. Tudo continua editável a seguir.
  const [data, setData] = useState<string>(() =>
    pedidoDetalhe?.dias?.length > 0 ? proximaOcorrencia(pedidoDetalhe.dias[0]) : ''
  );
  const [horaInicio, setHoraInicio] = useState<string>(() =>
    pedidoDetalhe ? extrairHoraDoPedido(pedidoDetalhe.horario) : ''
  );
  const [disciplinaId, setDisciplinaId] = useState(initialDisciplinaId || '');
  const [saving, setSaving] = useState(false);
  // Fluxo em etapas, cada uma com repetição própria: 'nova' (nada criado
  // ainda) -> 'alunos' (sessão criada, falta inserir explicacoes_alunos) ->
  // 'rpc' (alunos associados, falta marcar_pedido_explicacao, só quando há
  // pedido). Um novo clique em handleCriar nunca repete uma etapa já feita
  // — só continua da etapa guardada aqui. etapaRef é a fonte da verdade
  // (lida de forma síncrona dentro de handleCriar); etapa é só para o JSX.
  const explicacaoCriadaIdRef = useRef<string | null>(null);
  const etapaRef = useRef<EtapaExplicacao>('nova');
  const [etapa, setEtapa] = useState<EtapaExplicacao>('nova');
  const definirEtapa = (e: EtapaExplicacao) => { etapaRef.current = e; setEtapa(e); };

  // Uma sessão em grupo é sempre do mesmo ano escolar — o cálculo do
  // professor (trigger calcular_valores_explicacao) assume isto para
  // resolver uma tarifa inequívoca. Só valida ao adicionar; remover nunca
  // é bloqueado.
  const toggleAluno = (id: string) => {
    const jaSelecionado = alunoIds.includes(id);
    if (!jaSelecionado && alunoIds.length > 0) {
      const anoDoGrupo = alunosAtivos.find((a: any) => a.id === alunoIds[0])?.ano_escolar;
      const anoDoNovo = alunosAtivos.find((a: any) => a.id === id)?.ano_escolar;
      if (anoDoGrupo != null && anoDoNovo !== anoDoGrupo) {
        showError('Todos os alunos de uma sessão têm de ser do mesmo ano escolar.');
        return;
      }
    }
    setAlunoIds((prev) => (jaSelecionado ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const alunosFiltrados = alunosAtivos.filter((a: any) => a.nome.toLowerCase().includes(buscaAluno.toLowerCase()));

  // Disciplinas comuns aos alunos selecionados — sem ninguém selecionado
  // ainda, mostra tudo. Disciplina continua opcional, por isso não há aviso
  // nem bloqueio quando não há nenhuma em comum, só a opção "Sem disciplina".
  const disciplinasComunsExplicacao = disciplinasComuns(
    subjects,
    alunoIds.map((id) => alunosAtivos.find((a: any) => a.id === id)?.ano_escolar)
  );

  useEffect(() => {
    if (disciplinaId && !disciplinasComunsExplicacao.some((s: any) => String(s.id) === disciplinaId)) {
      setDisciplinaId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alunoIds]);

  // Cada passo devolve true/false — handleCriar decide o que fazer a seguir
  // a partir disso, nunca repetindo um passo que já tenha devolvido true.
  const passoInserirAlunos = async (explicacaoId: string): Promise<boolean> => {
    const linhasAlunos = alunoIds.map((aluno_id) => ({ explicacao_id: explicacaoId, aluno_id }));
    const { error } = await supabase.from('explicacoes_alunos').insert(linhasAlunos);
    if (error) {
      showError('A sessão já foi criada, mas não foi possível associar os alunos: ' + error.message + ' — tenta outra vez.');
      return false;
    }
    return true;
  };

  const passoMarcarPedido = async (explicacaoId: string): Promise<boolean> => {
    const { error } = await supabase.rpc('marcar_pedido_explicacao', {
      p_mensagem_id: pedidoMensagemId,
      p_explicacao_id: explicacaoId,
    });
    if (error) {
      showError('A sessão e os alunos já estão associados, mas não foi possível marcar o pedido como atendido: ' + error.message + ' — tenta outra vez.');
      return false;
    }
    return true;
  };

  const handleCriar = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (etapaRef.current === 'nova') {
        if (alunoIds.length === 0) { showError('Escolhe pelo menos um aluno.'); return; }
        if (!data || !horaInicio) { showError('Preenche a data e a hora.'); return; }
        // Validado ANTES de criar — se o aluno do pedido foi retirado da
        // seleção, nada é criado.
        if (pedidoAlunoId && !alunoIds.includes(pedidoAlunoId)) {
          showError('O aluno do pedido tem de estar na sessão.');
          return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        const { data: novaExp, error: errExp } = await supabase
          .from('explicacoes')
          .insert({
            centro_id: centroId,
            professor_id: professorId,
            disciplina_id: disciplinaId ? Number(disciplinaId) : null,
            data,
            hora_inicio: horaInicio,
            created_by: user?.id,
          })
          .select()
          .single();

        if (errExp) { showError('Erro ao criar explicação: ' + errExp.message); return; }

        explicacaoCriadaIdRef.current = novaExp.id;
        definirEtapa('alunos');
      }

      if (etapaRef.current === 'alunos') {
        const ok = await passoInserirAlunos(explicacaoCriadaIdRef.current!);
        if (!ok) return;

        if (!pedidoMensagemId) {
          showSuccess('Explicação marcada com sucesso.');
          onCreated();
          return;
        }
        definirEtapa('rpc');
      }

      if (etapaRef.current === 'rpc') {
        const ok = await passoMarcarPedido(explicacaoCriadaIdRef.current!);
        if (!ok) return;

        showSuccess('Explicação marcada e pedido atendido.');
        onCreated();
      }
    } finally {
      setSaving(false);
    }
  };

  // Fechar com a sessão já criada mas o fluxo por terminar exige
  // confirmação explícita — a sessão fica mesmo assim, só deixa de haver
  // forma automática de terminar o que falta.
  const handleTentarFechar = () => {
    if (etapaRef.current === 'nova') { onClose(); return; }
    const falta = etapaRef.current === 'alunos' ? 'associar os alunos à sessão' : 'marcar o pedido como atendido';
    if (confirm(`A sessão já foi criada, mas ainda falta ${falta}. Se saíres agora, tens de resolver isto à mão. Sair mesmo assim?`)) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) handleTentarFechar(); }}>
      <div className="bg-surface border border-border w-full max-w-md rounded-3xl shadow-2xl p-8 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-black text-primary">Nova Explicação</h2>
          <button onClick={handleTentarFechar} className="text-muted hover:text-primary transition-colors">
            <X size={20} />
          </button>
        </div>
        {pedidoMensagemId && pedidoDetalhe && (
          <div className="bg-accent-soft border border-accent/20 rounded-2xl p-4 mb-4 space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-accent mb-1.5">Pedido da família</p>
            {pedidoDetalhe.disciplina && (
              <p className="text-xs text-primary"><span className="font-bold">Disciplina:</span> {pedidoDetalhe.disciplina}</p>
            )}
            {pedidoDetalhe.dias.length > 0 && (
              <p className="text-xs text-primary"><span className="font-bold">Dias:</span> {pedidoDetalhe.dias.map((d: number) => DIAS_SEMANA_EXTENSO[d] ?? d).join(', ')}</p>
            )}
            {pedidoDetalhe.horario && (
              <p className="text-xs text-primary"><span className="font-bold">Horário:</span> {pedidoDetalhe.horario}</p>
            )}
            {pedidoDetalhe.nota && (
              <p className="text-xs text-primary italic">"{pedidoDetalhe.nota}"</p>
            )}
          </div>
        )}
        {pedidoMensagemId && !pedidoDetalhe && (
          <p className="text-xs text-accent font-bold mb-4">A marcar um pedido de explicação da família.</p>
        )}
        {etapa === 'alunos' && (
          <p className="text-xs text-warning font-bold mb-4">A sessão já foi criada. Falta associar os alunos — tenta outra vez.</p>
        )}
        {etapa === 'rpc' && (
          <p className="text-xs text-warning font-bold mb-4">A sessão e os alunos já estão associados. Falta marcar o pedido como atendido — tenta outra vez.</p>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-muted uppercase ml-1 flex items-center gap-1.5">
              <Users size={12} /> Aluno(s)
            </label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={14} />
              <input
                type="text"
                placeholder="Pesquisar aluno..."
                value={buscaAluno}
                onChange={(e) => setBuscaAluno(e.target.value)}
                disabled={etapa !== 'nova'}
                className="w-full bg-page border border-border text-primary pl-9 pr-3 py-2.5 rounded-xl outline-none focus:border-accent text-sm disabled:opacity-50"
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
                      disabled={etapa !== 'nova'}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50 ${
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Data</label>
              <input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                disabled={etapa !== 'nova'}
                className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Hora</label>
              <input
                type="time"
                value={horaInicio}
                onChange={(e) => setHoraInicio(e.target.value)}
                disabled={etapa !== 'nova'}
                className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1 disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-muted uppercase ml-1">Disciplina (opcional)</label>
            <select
              value={disciplinaId}
              onChange={(e) => setDisciplinaId(e.target.value)}
              disabled={etapa !== 'nova'}
              className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1 appearance-none disabled:opacity-50"
            >
              <option value="">Sem disciplina</option>
              {disciplinasComunsExplicacao.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleCriar}
          disabled={saving}
          className="w-full mt-6 bg-accent hover:bg-accent-hover text-on-accent p-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
          {etapa === 'alunos' ? 'Repetir: Associar Alunos' : etapa === 'rpc' ? 'Repetir: Marcar Pedido como Atendido' : 'Marcar Explicação'}
        </button>
      </div>
    </div>
  );
}
