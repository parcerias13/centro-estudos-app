'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { disciplinasParaAno } from '@/lib/disciplinas';
import { getHojeLisboa } from '@/lib/dataLisboa';
import {
  ArrowLeft, Calendar, Loader2, Plus, ChevronLeft, ChevronRight, X, Pencil, Trash2, Lock,
} from 'lucide-react';
import Link from 'next/link';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  addMonths,
  format,
  parseISO,
  differenceInCalendarDays,
} from 'date-fns';
import { pt } from 'date-fns/locale';

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

// Paleta pequena e legível, só decorativa — nunca os tokens semânticos
// (success/danger/warning são só para estados, nunca para decoração) nem a
// única forma de distinguir disciplinas (o nome está sempre no aria-label e
// na lista). Determinística: a mesma disciplina tem sempre a mesma cor
// nesta sessão, calculada por hash do nome.
const PALETA_DISCIPLINAS = ['bg-agenda-d1', 'bg-agenda-d2', 'bg-agenda-d3', 'bg-agenda-d4', 'bg-agenda-d5'];

function corDisciplina(nome: string): string {
  let hash = 0;
  for (let i = 0; i < nome.length; i++) hash = (hash * 31 + nome.charCodeAt(i)) >>> 0;
  return PALETA_DISCIPLINAS[hash % PALETA_DISCIPLINAS.length];
}

function rotuloRelativo(dataISO: string, hoje: string): string {
  const n = differenceInCalendarDays(parseISO(dataISO), parseISO(hoje));
  if (n < 0) return 'já passou';
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  return `daqui a ${n} dias`;
}

// Pode editar/apagar: data de hoje em diante (string ISO, comparação direta
// — nunca jaAconteceu(), que trata "hoje" como já acontecido) e sem nota.
function podeAlterar(exam: any, hoje: string): boolean {
  const semNota = (exam.nota_valor === null || exam.nota_valor === undefined) && !exam.nota_confirmada;
  return exam.date >= hoje && semNota;
}

type FormState = { subject: string; date: string; topics: string };

export default function StudentAgenda() {
  const { toast, showError, showSuccess } = useStatusToast();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [exams, setExams] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);

  const [userId, setUserId] = useState<string | null>(null);
  const [centroId, setCentroId] = useState<string | null>(null);

  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(parseISO(getHojeLisboa())));
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ subject: '', date: '', topics: '' });

  const hoje = getHojeLisboa();

  const fetchInitialData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const centro_id = user.app_metadata?.centro_id;
    setUserId(user.id);
    setCentroId(centro_id ?? null);

    const { data: aluno } = await supabase.from('alunos').select('ano_escolar').eq('id', user.id).maybeSingle();

    let subjectsQuery = supabase.from('subjects').select('*').order('name');
    if (centro_id) subjectsQuery = subjectsQuery.eq('centro_id', centro_id);
    const { data: subData } = await subjectsQuery;
    setSubjects(disciplinasParaAno(subData || [], aluno?.ano_escolar ?? null));

    const { data: examData } = await supabase
      .from('exams')
      .select('*')
      .eq('aluno_id', user.id)
      .eq('centro_id', centro_id)
      .order('date', { ascending: true });

    if (examData) setExams(examData);
    setLoading(false);
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (!selectedDayKey && !showForm) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedDayKey(null);
        fecharForm();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDayKey, showForm]);

  const examsPorDia = useMemo(() => {
    const grupos: Record<string, any[]> = {};
    exams.forEach((exam) => {
      if (!grupos[exam.date]) grupos[exam.date] = [];
      grupos[exam.date].push(exam);
    });
    return grupos;
  }, [exams]);

  const proximosTestes = useMemo(
    () => exams.filter((e) => e.date >= hoje).slice(0, 5),
    [exams, hoje]
  );

  // GRELHA DO MÊS — Seg a Dom, nº de linhas conforme o mês (5 ou 6)
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const monthDays = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const irParaHoje = () => {
    setCurrentMonth(startOfMonth(parseISO(hoje)));
  };

  const abrirNovoTeste = (dataPreenchida?: string) => {
    setEditingId(null);
    setForm({ subject: '', date: dataPreenchida || selectedDayKey || '', topics: '' });
    setShowForm(true);
  };

  const abrirEditarTeste = (exam: any) => {
    setEditingId(exam.id);
    setForm({ subject: exam.subject_name, date: exam.date, topics: exam.topics || '' });
    setShowForm(true);
  };

  const fecharForm = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);

    if (!centroId || !userId) {
      showError('Não foi possível identificar o centro. Recarrega a página e tenta novamente.');
      setSending(false);
      return;
    }

    let duplicadoQuery = supabase
      .from('exams')
      .select('id')
      .eq('aluno_id', userId)
      .eq('centro_id', centroId)
      .eq('subject_name', form.subject)
      .eq('date', form.date);
    if (editingId) duplicadoQuery = duplicadoQuery.neq('id', editingId);
    const { data: existente, error: errExistente } = await duplicadoQuery.maybeSingle();

    if (errExistente) {
      showError('Erro ao verificar testes existentes: ' + errExistente.message);
      setSending(false);
      return;
    }

    if (existente) {
      showError(`Já tens um teste de ${form.subject} marcado para este dia.`);
      setSending(false);
      return;
    }

    if (editingId) {
      const { data, error } = await supabase
        .from('exams')
        .update({ subject_name: form.subject, date: form.date, topics: form.topics })
        .eq('id', editingId)
        .eq('aluno_id', userId)
        .select();

      if (error) {
        showError(error.message);
        setSending(false);
        return;
      }
      if (!data || data.length === 0) {
        showError('Só podes corrigir testes que ainda não aconteceram e ainda não têm nota.');
        setSending(false);
        return;
      }
      showSuccess('Teste atualizado.');
    } else {
      const { error } = await supabase.from('exams').insert({
        aluno_id: userId,
        subject_name: form.subject,
        date: form.date,
        topics: form.topics,
        centro_id: centroId,
      });

      if (error) {
        showError('Erro ao gravar: ' + error.message);
        setSending(false);
        return;
      }
      showSuccess('Teste agendado com sucesso!');
    }

    setSending(false);
    fecharForm();
    fetchInitialData();
  };

  const handleApagar = async (exam: any) => {
    if (!confirm(`Apagar o teste de ${exam.subject_name} de ${format(parseISO(exam.date), "d 'de' MMMM", { locale: pt })}?`)) return;

    const { data, error } = await supabase
      .from('exams')
      .delete()
      .eq('id', exam.id)
      .eq('aluno_id', userId)
      .select();

    if (error) {
      showError('Erro ao apagar: ' + error.message);
      return;
    }
    if (!data || data.length === 0) {
      showError('Não foi possível apagar este teste.');
      return;
    }
    showSuccess('Teste apagado.');
    fetchInitialData();
  };

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;

  const examsDoDiaSelecionado = selectedDayKey ? (examsPorDia[selectedDayKey] || []) : [];

  return (
    <main className="min-h-screen bg-page text-primary p-6 max-w-md mx-auto space-y-8 pb-20">
      <Link href="/" className="flex items-center gap-2 text-muted hover:text-primary transition-colors">
        <ArrowLeft size={20} /> <span className="font-bold">Voltar ao Início</span>
      </Link>

      <h1 className="text-xl font-black flex items-center gap-2">
        <Calendar className="text-agenda-accent" /> A Minha Agenda
      </h1>

      {/* CALENDÁRIO DO MÊS */}
      <section className="bg-surface border border-border rounded-3xl p-4 shadow-xl space-y-3 overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setCurrentMonth((prev) => addMonths(prev, -1))}
            aria-label="Mês anterior"
            className="min-h-11 min-w-11 flex items-center justify-center rounded-xl hover:bg-raised text-secondary hover:text-primary transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <p className="text-sm font-black text-primary capitalize text-center flex-1 truncate">
            {format(currentMonth, 'MMMM yyyy', { locale: pt })}
          </p>
          <button
            type="button"
            onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))}
            aria-label="Mês seguinte"
            className="min-h-11 min-w-11 flex items-center justify-center rounded-xl hover:bg-raised text-secondary hover:text-primary transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <button
          type="button"
          onClick={irParaHoje}
          className="w-full text-center text-[10px] font-black uppercase tracking-widest text-agenda-accent py-1 rounded-lg hover:bg-raised transition-colors"
        >
          Hoje
        </button>

        <div className="grid grid-cols-7">
          {DIAS_SEMANA.map((dia) => (
            <div key={dia} className="text-center py-1 text-[9px] font-black uppercase tracking-widest text-muted">
              {dia}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {monthDays.map((day) => {
            const dayKey = format(day, 'yyyy-MM-dd');
            const examsDoDia = examsPorDia[dayKey] || [];
            const foraDoMes = !isSameMonth(day, currentMonth);
            const eHoje = dayKey === hoje;
            const jaPassou = dayKey < hoje;
            const selecionado = selectedDayKey === dayKey;

            const disciplinasUnicas = [...new Set(examsDoDia.map((e) => e.subject_name))];
            const visiveis = disciplinasUnicas.slice(0, 3);

            const ariaLabel = examsDoDia.length === 0
              ? `${format(day, "d 'de' MMMM", { locale: pt })}, sem testes`
              : `${format(day, "d 'de' MMMM", { locale: pt })}, ${examsDoDia.length} ${examsDoDia.length === 1 ? 'teste' : 'testes'}: ${disciplinasUnicas.join(', ')}`;

            return (
              <button
                key={dayKey}
                type="button"
                aria-label={ariaLabel}
                onClick={() => setSelectedDayKey(dayKey)}
                className={`min-h-16 min-w-11 rounded-xl p-1 flex flex-col items-center gap-1 transition-colors
                  ${selecionado ? 'bg-agenda-accent' : eHoje ? 'ring-2 ring-inset ring-agenda-accent' : ''}
                  ${foraDoMes ? 'opacity-40' : ''}
                  ${jaPassou && !selecionado ? 'opacity-50' : ''}
                  ${!selecionado ? 'hover:bg-raised' : ''}
                `}
              >
                <span className={`text-xs font-bold ${selecionado ? 'text-on-agenda-accent' : eHoje ? 'text-agenda-accent' : 'text-secondary'}`}>
                  {format(day, 'd')}
                </span>
                <div className="flex gap-0.5 flex-wrap justify-center min-h-1.5">
                  {visiveis.map((nome) => (
                    <span
                      key={nome}
                      className={`w-1.5 h-1.5 rounded-full ${selecionado ? 'bg-on-agenda-accent' : corDisciplina(nome)}`}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* PRÓXIMOS TESTES */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-black uppercase text-muted tracking-widest">Próximos Testes</h2>
          <button
            type="button"
            onClick={() => abrirNovoTeste()}
            className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-on-agenda-accent bg-agenda-accent px-3 py-2 rounded-xl min-h-11 hover:brightness-110 transition-all active:scale-95"
          >
            <Plus size={14} /> Novo Teste
          </button>
        </div>

        {proximosTestes.length === 0 ? (
          <div className="bg-surface border border-border rounded-3xl p-6 text-center space-y-2">
            <Calendar className="mx-auto text-muted" size={28} />
            <p className="text-muted text-sm italic">Ainda não marcaste nenhum teste.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {proximosTestes.map((exam) => (
              <div key={exam.id} className="bg-surface border border-border p-4 rounded-2xl flex items-center gap-4 shadow-md">
                <span className={`w-2 h-10 rounded-full shrink-0 ${corDisciplina(exam.subject_name)}`} />
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-primary truncate">{exam.subject_name}</h4>
                  <p className="text-[10px] text-muted truncate italic">{exam.topics || 'Ver matéria no caderno'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] font-black text-agenda-accent uppercase">{rotuloRelativo(exam.date, hoje)}</p>
                  <p className="text-[10px] text-muted">{format(parseISO(exam.date), "d 'de' MMM", { locale: pt })}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <StatusToast toast={toast} />

      {/* BOTTOM SHEET: testes do dia */}
      {selectedDayKey && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedDayKey(null); }}
        >
          <div
            className="bg-surface border-t border-border rounded-t-3xl w-full max-w-md max-h-[75vh] overflow-y-auto shadow-2xl"
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
          >
            <div className="flex justify-between items-center p-5 border-b border-border sticky top-0 bg-surface">
              <h3 className="font-black text-lg text-primary capitalize">
                {format(parseISO(selectedDayKey), "d 'de' MMMM", { locale: pt })}
              </h3>
              <button
                onClick={() => setSelectedDayKey(null)}
                aria-label="Fechar"
                className="min-h-11 min-w-11 flex items-center justify-center bg-page border border-border rounded-xl hover:bg-raised transition-colors text-secondary"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {examsDoDiaSelecionado.length === 0 ? (
                <div className="text-center space-y-3 py-4">
                  <p className="text-muted text-sm italic">Sem testes neste dia.</p>
                  <button
                    type="button"
                    onClick={() => { setSelectedDayKey(null); abrirNovoTeste(selectedDayKey); }}
                    className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-on-agenda-accent bg-agenda-accent px-4 py-3 rounded-xl min-h-11 hover:brightness-110 transition-all active:scale-95"
                  >
                    <Plus size={14} /> Marcar teste neste dia
                  </button>
                </div>
              ) : (
                examsDoDiaSelecionado.map((exam) => {
                  const editavel = podeAlterar(exam, hoje);
                  const temNota = exam.nota_valor !== null && exam.nota_valor !== undefined;
                  return (
                    <div key={exam.id} className="bg-page border border-border rounded-2xl p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <span className={`inline-block text-[10px] font-black uppercase px-2 py-1 rounded-lg text-on-agenda-accent ${corDisciplina(exam.subject_name)}`}>
                            {exam.subject_name}
                          </span>
                          <p className="text-sm text-secondary mt-2">{exam.topics || 'Sem matéria especificada'}</p>
                          <p className="text-[10px] text-muted mt-1 capitalize">
                            {format(parseISO(exam.date), "d 'de' MMMM", { locale: pt })} · {rotuloRelativo(exam.date, hoje)}
                          </p>
                        </div>
                        {!editavel && (
                          <span className="flex items-center gap-1 text-[10px] font-black uppercase text-muted shrink-0">
                            <Lock size={12} /> {temNota ? 'Nota registada' : 'Fechado'}
                          </span>
                        )}
                      </div>

                      {editavel && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setSelectedDayKey(null); abrirEditarTeste(exam); }}
                            className="flex-1 flex items-center justify-center gap-1 text-[11px] font-black uppercase text-primary bg-surface border border-border px-3 py-3 rounded-xl min-h-11 hover:bg-raised transition-colors"
                          >
                            <Pencil size={13} /> Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApagar(exam)}
                            className="flex-1 flex items-center justify-center gap-1 text-[11px] font-black uppercase text-danger bg-danger-bg border border-danger/20 px-3 py-3 rounded-xl min-h-11 hover:brightness-95 transition-colors"
                          >
                            <Trash2 size={13} /> Apagar
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM SHEET: novo / editar teste */}
      {showForm && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) fecharForm(); }}
        >
          <div
            className="bg-surface border-t border-border rounded-t-3xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl box-border"
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
          >
            <div className="flex justify-between items-center p-5 border-b border-border sticky top-0 bg-surface">
              <h3 className="font-black text-lg text-primary flex items-center gap-2">
                <Plus className="text-agenda-accent" size={18} /> {editingId ? 'Editar Teste' : 'Marcar Novo Teste'}
              </h3>
              <button
                onClick={fecharForm}
                aria-label="Fechar"
                className="min-h-11 min-w-11 flex items-center justify-center bg-page border border-border rounded-xl hover:bg-raised transition-colors text-secondary"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleGuardar} className="p-5 space-y-4 box-border w-full min-w-0">
              <div className="space-y-1 min-w-0">
                <label className="text-[10px] font-black uppercase text-muted ml-1">Disciplina</label>
                <select
                  required
                  value={form.subject}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                  className="w-full box-border bg-page border border-border p-4 rounded-xl outline-none focus:border-agenda-accent text-primary cursor-pointer"
                >
                  <option value="">Selecionar Disciplina...</option>
                  {subjects.length > 0 ? (
                    subjects.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)
                  ) : (
                    <option value="Outra">Outra (Carregar disciplinas no Admin)</option>
                  )}
                </select>
              </div>

              <div className="space-y-1 min-w-0">
                <label className="text-[10px] font-black uppercase text-muted ml-1">Data do Teste</label>
                <input
                  type="date"
                  required
                  min={editingId ? undefined : hoje}
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full box-border bg-page border border-border p-4 rounded-xl outline-none focus:border-agenda-accent text-primary block min-w-0"
                />
              </div>

              <div className="space-y-1 min-w-0">
                <label className="text-[10px] font-black uppercase text-muted ml-1">Matéria / Tópicos</label>
                <textarea
                  placeholder="Ex: Capítulos 1 a 3"
                  value={form.topics}
                  onChange={(e) => setForm((f) => ({ ...f, topics: e.target.value }))}
                  className="w-full box-border bg-page border border-border p-4 rounded-xl h-24 resize-none outline-none focus:border-agenda-accent"
                />
              </div>

              <button
                type="submit"
                disabled={sending}
                className="w-full bg-agenda-accent hover:brightness-110 text-on-agenda-accent font-black py-4 rounded-2xl transition-all shadow-lg active:scale-95 disabled:opacity-50 min-h-11"
              >
                {sending ? 'A GUARDAR...' : 'GUARDAR'}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
