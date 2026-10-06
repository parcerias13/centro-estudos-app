'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { disciplinasComuns } from '@/lib/disciplinas';
import { sanitizarPedidoExplicacao } from '@/lib/formatoMensagens';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Plus, X, GraduationCap, Loader2,
  Clock, Trash2, Save, Search, Users, AlertTriangle, HelpCircle,
} from 'lucide-react';
import { startOfWeek, endOfWeek, addWeeks, eachDayOfInterval, format, isSameDay } from 'date-fns';
import { pt } from 'date-fns/locale';

const getNomeAluno = (ea: any) => {
  const aluno = Array.isArray(ea.alunos) ? ea.alunos[0] : ea.alunos;
  return aluno?.nome || 'Desconhecido';
};

const getEstadoSessao = (sessao: any) => {
  if (sessao.dado) return { label: 'Dada', classes: 'bg-success-bg text-success border-success/30' };
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataSessao = new Date(sessao.data + 'T00:00:00');
  if (dataSessao < hoje) return { label: 'Não Dada', classes: 'bg-danger-bg text-danger border-danger/30' };
  return { label: 'Agendada', classes: 'bg-accent-soft text-accent border-accent/30' };
};

export default function ExplicacoesPage() {
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

  const [detalheSessao, setDetalheSessao] = useState<any | null>(null);
  const [novaModalOpen, setNovaModalOpen] = useState(false);
  const [pedidoPreSelecionado, setPedidoPreSelecionado] = useState<{ id: string; alunoId: string; disciplinaId: string | null } | null>(null);

  // Banner "N pedidos por marcar" — só para admin. Um professor também abre
  // esta página (para a sua própria agenda) e não tem acesso de leitura a
  // mensagens (RLS); nunca pede nem mostra nada para ele, e nunca dá erro.
  const [pedidosPendentes, setPedidosPendentes] = useState<any[]>([]);

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
        const disciplinaId = sanitizarPedidoExplicacao(data.payload).disciplinaId;
        setPedidoPreSelecionado({ id: data.id, alunoId: data.aluno_id, disciplinaId: disciplinaId != null ? String(disciplinaId) : null });
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
      const [{ data: { user } }, { data: subData }, { data: alunosData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('subjects').select('id, name, centro_id, anos_aplicaveis').order('name'),
        supabase.from('alunos').select('id, nome, ano_escolar').eq('ativo', true).order('nome'),
      ]);

      const r = user?.app_metadata?.role?.toLowerCase() ?? null;
      const cId = user?.app_metadata?.centro_id ?? null;
      // subjects já vem pedido em paralelo com getUser() (não depende dele) —
      // filtra pelo centro aqui, só depois de cId estar disponível.
      setSubjects((subData || []).filter((s: any) => s.centro_id === cId));
      setAlunosAtivos(alunosData || []);
      setRole(r);
      setCentroId(cId);

      if (r === 'professor' && user) {
        setSelectedProfessorId(user.id);
      } else if (r === 'admin') {
        const { data } = await supabase.from('staff').select('id, name').eq('role', 'professor').order('name');
        setProfessores(data || []);
        if (data && data.length > 0) setSelectedProfessorId(data[0].id);
      }
    })();
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
        .select('*, explicacoes_alunos(id, aluno_id, valor_cobrado_familia, alunos(nome)), subjects(name)')
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
    setSessoes((prev) => prev.map((s) => (s.id === atualizada.id ? atualizada : s)));
    setDetalheSessao(null);
  };

  const handleSessaoApagada = (id: string) => {
    setSessoes((prev) => prev.filter((s) => s.id !== id));
    setDetalheSessao(null);
  };

  return (
    <main className="min-h-screen bg-page text-primary p-6 md:p-8 max-w-7xl mx-auto font-sans">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="p-3 bg-surface border border-border rounded-2xl hover:bg-raised transition-colors">
            <ArrowLeft size={20} className="text-secondary" />
          </Link>
          <div>
            <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter uppercase flex items-center gap-3">
              <GraduationCap className="text-accent" /> Explicações
            </h1>
            <p className="text-muted text-[10px] font-black uppercase tracking-widest mt-1">Agenda de Sessões</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {role === 'admin' && (
            <select
              value={selectedProfessorId || ''}
              onChange={(e) => setSelectedProfessorId(e.target.value || null)}
              className="bg-surface border border-border p-3 rounded-2xl text-sm font-bold outline-none focus:border-accent/50 transition-all appearance-none"
            >
              {professores.length === 0 && <option value="">Sem professores</option>}
              {professores.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          {/* SELETOR DE SEMANA */}
          <div className="flex items-center bg-surface border border-border rounded-2xl overflow-hidden p-1 shadow-xl">
            <button onClick={() => setCurrentWeekStart((prev) => addWeeks(prev, -1))} className="p-2 hover:bg-raised text-secondary hover:text-primary transition-all">
              <ChevronLeft size={20} />
            </button>
            <div className="px-4 py-1 text-center min-w-40">
              <p className="text-xs font-black text-primary capitalize">
                {format(currentWeekStart, 'd MMM', { locale: pt })} – {format(endOfWeek(currentWeekStart, { weekStartsOn: 1 }), 'd MMM', { locale: pt })}
              </p>
            </div>
            <button onClick={() => setCurrentWeekStart((prev) => addWeeks(prev, 1))} className="p-2 hover:bg-raised text-secondary hover:text-primary transition-all">
              <ChevronRight size={20} />
            </button>
          </div>

          <button
            onClick={() => setNovaModalOpen(true)}
            disabled={!selectedProfessorId}
            className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-on-accent px-4 py-3 rounded-2xl font-black text-sm transition-all active:scale-95 disabled:opacity-40"
          >
            <Plus size={18} /> Nova Explicação
          </button>
        </div>
      </div>

      {role === 'admin' && pedidosPendentes.length > 0 && (
        <div className="bg-warning-bg border border-warning/20 rounded-2xl p-4 mb-8 space-y-3">
          <div className="flex items-center gap-2 text-warning">
            <HelpCircle size={18} />
            <p className="font-black text-sm">{pedidosPendentes.length} pedido{pedidosPendentes.length > 1 ? 's' : ''} por marcar</p>
          </div>
          <div className="space-y-1.5">
            {pedidosPendentes.map((p) => (
              <Link
                key={p.id}
                href={`/admin/explicacoes?pedido=${p.id}`}
                className="flex items-center justify-between gap-2 bg-page/60 hover:bg-page rounded-xl px-3 py-2 text-sm transition-colors"
              >
                <span className="font-bold text-primary truncate">
                  {p.alunos?.nome ?? 'Aluno'}{p.alunos?.ano_escolar ? ` · ${p.alunos.ano_escolar}º` : ''} — {sanitizarPedidoExplicacao(p.payload).disciplina ?? 'Disciplina'}
                </span>
                <span className="text-[10px] font-black uppercase text-warning shrink-0">Marcar</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {pedidoPreSelecionado && !selectedProfessorId && (
        <div className="bg-warning-bg border border-warning/20 rounded-2xl p-4 mb-8">
          <p className="font-bold text-sm text-warning">
            Escolhe o professor para marcar o pedido de {alunosAtivos.find((a: any) => a.id === pedidoPreSelecionado.alunoId)?.nome ?? 'aluno'}.
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
      ) : (
        <div className="space-y-8">
          {diasDaSemana.map((dia) => {
            const sessoesDoDia = sessoes.filter((s) => isSameDay(new Date(s.data + 'T00:00:00'), dia));
            return (
              <div key={dia.toISOString()}>
                <h2 className="text-sm font-black uppercase tracking-widest text-muted mb-3">
                  {format(dia, "EEEE, d 'de' MMMM", { locale: pt })}
                </h2>
                {sessoesDoDia.length === 0 ? (
                  <p className="text-muted text-sm italic pl-1">Sem sessões.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {sessoesDoDia.map((sessao) => {
                      const estado = getEstadoSessao(sessao);
                      const nomes = (sessao.explicacoes_alunos || []).map(getNomeAluno).join(', ');
                      return (
                        <button
                          key={sessao.id}
                          onClick={() => setDetalheSessao(sessao)}
                          className="text-left bg-surface border border-border p-5 rounded-3xl hover:border-accent/50 transition-colors shadow-lg"
                        >
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-2 text-accent font-black">
                              <Clock size={16} />
                              {sessao.hora_inicio?.slice(0, 5)}
                            </div>
                            <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${estado.classes}`}>
                              {estado.label}
                            </span>
                          </div>
                          <p className="font-bold text-primary text-sm truncate">{nomes || 'Sem alunos'}</p>
                          {sessao.subjects?.name && (
                            <p className="text-xs text-muted mt-1">{sessao.subjects.name}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {detalheSessao && (
        <DetalheExplicacaoModal
          sessao={detalheSessao}
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

// --- PAINEL DE DETALHE: toggle dado, horas, notas, apagar (só se ainda não dada) ---
function DetalheExplicacaoModal({ sessao, onClose, onSaved, onDeleted, showError, showSuccess }: any) {
  const [dado, setDado] = useState<boolean>(sessao.dado);
  const [horasDadas, setHorasDadas] = useState(sessao.horas_dadas?.toString() || '');
  const [notas, setNotas] = useState(sessao.notas || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      .select('*, explicacoes_alunos(id, aluno_id, valor_cobrado_familia, alunos(nome)), subjects(name)')
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
    if (!confirm('Apagar esta sessão? Esta ação não pode ser desfeita.')) return;
    setDeleting(true);
    const { error } = await supabase.from('explicacoes').delete().eq('id', sessao.id);
    setDeleting(false);
    if (error) {
      showError('Erro ao apagar: ' + error.message);
      return;
    }
    showSuccess('Sessão apagada.');
    onDeleted(sessao.id);
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
            <button type="button" onClick={() => setDado((v) => !v)} className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
              dado ? 'bg-success-bg text-success border-success/30' : 'bg-raised text-muted border-border'
            }`}>
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

          {sessao.valor_calculado != null && (
            <p className="text-xs text-muted">
              Último valor calculado: <span className="font-bold text-primary">{Number(sessao.valor_calculado).toFixed(2)}€</span>
            </p>
          )}

          {sessao.dado && sessao.explicacoes_alunos?.length > 0 && (
            <div className="bg-page p-3 rounded-xl border border-border space-y-1.5">
              <p className="text-[9px] font-black uppercase text-muted tracking-widest">Cobrado à família</p>
              {sessao.explicacoes_alunos.map((ea: any) => (
                <div key={ea.id} className="flex items-center justify-between text-xs">
                  <span className="text-secondary font-bold">{ea.alunos?.nome}</span>
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

        <div className="flex gap-3 mt-6">
          {!sessao.dado && (
            <button
              onClick={handleApagar}
              disabled={deleting || saving}
              className="p-4 bg-page border border-border text-danger hover:bg-danger-bg rounded-2xl transition-all active:scale-95 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="animate-spin" size={18} /> : <Trash2 size={18} />}
            </button>
          )}
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
  onClose, onCreated, showError, showSuccess,
}: any) {
  const [alunoIds, setAlunoIds] = useState<string[]>(initialAlunoIds || []);
  const [buscaAluno, setBuscaAluno] = useState('');
  const [data, setData] = useState('');
  const [horaInicio, setHoraInicio] = useState('');
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
        {pedidoMensagemId && (
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
                      {aluno.nome}
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
