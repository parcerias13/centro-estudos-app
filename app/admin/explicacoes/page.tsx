'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { calcularValorExplicacao } from '@/lib/explicacoes';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Plus, X, GraduationCap, Loader2,
  Clock, Trash2, Save, Search, Users,
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

  const [role, setRole] = useState<string | null>(null);
  const [centroId, setCentroId] = useState<string | null>(null);
  const [professores, setProfessores] = useState<any[]>([]);
  const [selectedProfessorId, setSelectedProfessorId] = useState<string | null>(null);
  const [professorAtual, setProfessorAtual] = useState<any | null>(null);

  const [subjects, setSubjects] = useState<any[]>([]);
  const [alunosAtivos, setAlunosAtivos] = useState<any[]>([]);

  const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [sessoes, setSessoes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [detalheSessao, setDetalheSessao] = useState<any | null>(null);
  const [novaModalOpen, setNovaModalOpen] = useState(false);

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
        supabase.from('subjects').select('id, name').order('name'),
        supabase.from('alunos').select('id, nome').eq('ativo', true).order('nome'),
      ]);

      setSubjects(subData || []);
      setAlunosAtivos(alunosData || []);

      const r = user?.app_metadata?.role?.toLowerCase() ?? null;
      const cId = user?.app_metadata?.centro_id ?? null;
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

  // --- TARIFA DO PROFESSOR SELECIONADO (necessária para calcular valor_calculado) ---
  useEffect(() => {
    if (!selectedProfessorId) {
      setProfessorAtual(null);
      return;
    }
    supabase
      .from('staff')
      .select('id, name, tarifa_tipo, tarifa_valor, tarifa_escala_aluno')
      .eq('id', selectedProfessorId)
      .single()
      .then(({ data }) => setProfessorAtual(data));
  }, [selectedProfessorId]);

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
        .select('*, explicacoes_alunos(aluno_id, alunos(nome)), subjects(name)')
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
          professorAtual={professorAtual}
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
          onClose={() => setNovaModalOpen(false)}
          onCreated={() => { setNovaModalOpen(false); fetchSessoes(); }}
          showError={showError}
          showSuccess={showSuccess}
        />
      )}

      <StatusToast toast={toast} />
    </main>
  );
}

// --- PAINEL DE DETALHE: toggle dado, horas, notas, apagar (só se ainda não dada) ---
function DetalheExplicacaoModal({ sessao, professorAtual, onClose, onSaved, onDeleted, showError, showSuccess }: any) {
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
    const payload: Record<string, any> = { dado, horas_dadas: horas, notas: notas.trim() || null };

    if (dado) {
      const numAlunos = sessao.explicacoes_alunos?.length || 0;
      payload.valor_calculado = calcularValorExplicacao({
        tarifaTipo: professorAtual?.tarifa_tipo,
        tarifaValor: professorAtual?.tarifa_valor,
        tarifaEscalaAluno: professorAtual?.tarifa_escala_aluno,
        horasDadas: horas,
        numAlunos,
      });
    }

    const { data, error } = await supabase
      .from('explicacoes')
      .update(payload)
      .eq('id', sessao.id)
      .select('*, explicacoes_alunos(aluno_id, alunos(nome)), subjects(name)')
      .single();

    setSaving(false);
    if (error) {
      showError('Erro ao guardar: ' + error.message);
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
function NovaExplicacaoModal({ professorId, centroId, subjects, alunosAtivos, onClose, onCreated, showError, showSuccess }: any) {
  const [alunoIds, setAlunoIds] = useState<string[]>([]);
  const [buscaAluno, setBuscaAluno] = useState('');
  const [data, setData] = useState('');
  const [horaInicio, setHoraInicio] = useState('');
  const [disciplinaId, setDisciplinaId] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleAluno = (id: string) => {
    setAlunoIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const alunosFiltrados = alunosAtivos.filter((a: any) => a.nome.toLowerCase().includes(buscaAluno.toLowerCase()));

  const handleCriar = async () => {
    if (alunoIds.length === 0) {
      showError('Escolhe pelo menos um aluno.');
      return;
    }
    if (!data || !horaInicio) {
      showError('Preenche a data e a hora.');
      return;
    }

    setSaving(true);
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

    if (errExp) {
      showError('Erro ao criar explicação: ' + errExp.message);
      setSaving(false);
      return;
    }

    const linhasAlunos = alunoIds.map((aluno_id) => ({ explicacao_id: novaExp.id, aluno_id }));
    const { error: errAlunos } = await supabase.from('explicacoes_alunos').insert(linhasAlunos);

    setSaving(false);
    if (errAlunos) {
      showError('Erro ao associar alunos: ' + errAlunos.message);
      return;
    }

    showSuccess('Explicação marcada com sucesso.');
    onCreated();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface border border-border w-full max-w-md rounded-3xl shadow-2xl p-8 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-black text-primary">Nova Explicação</h2>
          <button onClick={onClose} className="text-muted hover:text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

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
                className="w-full bg-page border border-border text-primary pl-9 pr-3 py-2.5 rounded-xl outline-none focus:border-accent text-sm"
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
                className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Hora</label>
              <input
                type="time"
                value={horaInicio}
                onChange={(e) => setHoraInicio(e.target.value)}
                className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-muted uppercase ml-1">Disciplina (opcional)</label>
            <select
              value={disciplinaId}
              onChange={(e) => setDisciplinaId(e.target.value)}
              className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1 appearance-none"
            >
              <option value="">Sem disciplina</option>
              {subjects.map((s: any) => (
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
          Marcar Explicação
        </button>
      </div>
    </div>
  );
}
