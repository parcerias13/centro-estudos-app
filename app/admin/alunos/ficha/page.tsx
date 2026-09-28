'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { supabase } from '@/lib/supabase';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { getAnoLetivoAtual } from '@/lib/anoLetivo';
import { calcularEstadoNota, getEscalaTeste, getEscalaPeriodo } from '@/lib/notas';
import { disciplinasParaAno, foraDoAno } from '@/lib/disciplinas';
import {
  ArrowLeft, Loader2, ClipboardList, School, Users2, GraduationCap,
  CheckCircle2, Clock, BookOpen, AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';

function FichaAlunoContent() {
  const searchParams = useSearchParams();
  const studentId = searchParams.get('id');
  const { toast, showError, showSuccess } = useStatusToast();

  const [loading, setLoading] = useState(true);
  const [aluno, setAluno] = useState<any>(null);
  const [exams, setExams] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [notasPeriodo, setNotasPeriodo] = useState<any[]>([]);
  // Força o remount dos inputs de período quando um apagar é bloqueado pela
  // RLS (nota já confirmada) — sem isto, o campo ficava visualmente vazio
  // mesmo com a linha intacta na BD, porque o valor de origem não mudou.
  const [resyncTick, setResyncTick] = useState(0);

  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [centroId, setCentroId] = useState<string | null>(null);

  const podeConfirmar = role === 'admin' || role === 'professor';
  const anoLetivoAtual = getAnoLetivoAtual();

  const fetchTudo = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    const currentRole = user?.app_metadata?.role?.toLowerCase() ?? null;
    const currentUserId = user?.id ?? null;
    const currentCentroId = user?.app_metadata?.centro_id ?? null;
    setRole(currentRole);
    setUserId(currentUserId);
    setCentroId(currentCentroId);

    const [
      { data: alunoData, error: errAluno },
      { data: examsData },
      { data: subjectsData },
      { data: notasPeriodoData },
    ] = await Promise.all([
      supabase.from('alunos').select('*').eq('id', studentId).eq('centro_id', currentCentroId).single(),
      supabase.from('exams').select('*').eq('aluno_id', studentId).eq('centro_id', currentCentroId).order('date', { ascending: false }),
      supabase.from('subjects').select('id, name, anos_aplicaveis').order('name'),
      supabase.from('notas_periodo').select('*').eq('aluno_id', studentId).eq('centro_id', currentCentroId).eq('ano_letivo', anoLetivoAtual),
    ]);

    if (errAluno) {
      showError('Não foi possível carregar o aluno: ' + errAluno.message);
    }
    setAluno(alunoData || null);
    setExams(examsData || []);
    setSubjects(subjectsData || []);
    setNotasPeriodo(notasPeriodoData || []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  useEffect(() => { fetchTudo(); }, [fetchTudo]);

  // --- NOTAS DE TESTES (exams) ---
  const handleSalvarNotaTeste = async (exam: any, valorStr: string) => {
    const bruto = valorStr.trim();
    const valor = bruto === '' ? null : parseFloat(bruto);
    if (bruto !== '' && (valor === null || isNaN(valor))) {
      showError('Valor de nota inválido.');
      return;
    }

    // Escala já não é escolha do utilizador — snapshot do ano_escolar do
    // aluno no momento da escrita.
    const { escala, min, max } = getEscalaTeste(aluno.ano_escolar);
    if (valor !== null && (valor < min || valor > max)) {
      showError(`A nota tem de estar entre ${min} e ${max} (escala /${escala}).`);
      return;
    }

    const payload: Record<string, any> = {
      nota_valor: valor,
      nota_escala: valor === null ? exam.nota_escala : escala,
      nota_reportada_por: userId,
    };
    if (valor === null) {
      // Sem valor, não há nada para confirmar.
      payload.nota_confirmada = false;
      payload.nota_confirmada_por = null;
      payload.nota_confirmada_em = null;
    } else {
      Object.assign(payload, calcularEstadoNota(role, userId));
    }

    const { error } = await supabase.from('exams').update(payload).eq('id', exam.id);
    if (error) {
      showError('Erro ao guardar nota: ' + error.message);
      return;
    }
    setExams((prev) => prev.map((e) => (e.id === exam.id ? { ...e, ...payload } : e)));
    showSuccess('Nota atualizada.');
  };

  const handleConfirmarNotaTeste = async (exam: any) => {
    const payload = { nota_confirmada: true, nota_confirmada_por: userId, nota_confirmada_em: new Date().toISOString() };
    const { error } = await supabase.from('exams').update(payload).eq('id', exam.id);
    if (error) {
      showError('Erro ao confirmar: ' + error.message);
      return;
    }
    setExams((prev) => prev.map((e) => (e.id === exam.id ? { ...e, ...payload } : e)));
    showSuccess('Nota confirmada.');
  };

  // --- NOTAS DE PERÍODO (notas_periodo) ---
  const handleSalvarNotaPeriodo = async (disciplinaId: number, periodo: number, valorStr: string) => {
    const linhaExistente = notasPeriodo.find((n) => n.disciplina_id === disciplinaId && n.periodo === periodo);
    const bruto = valorStr.trim();

    if (bruto === '') {
      if (!linhaExistente) return;
      const { data, error } = await supabase.from('notas_periodo').delete().eq('id', linhaExistente.id).select();
      if (error) {
        showError('Erro ao remover nota: ' + error.message);
        setResyncTick((t) => t + 1);
        return;
      }
      // RLS não devolve erro quando bloqueia — só filtra a linha (0 devolvidas).
      // Isso acontece quando a nota já está confirmada e quem tenta apagar não é
      // admin: não podemos assumir sucesso só porque não houve erro.
      if (!data || data.length === 0) {
        showError('Não é possível apagar — esta nota já foi confirmada. Contacta o admin.');
        setResyncTick((t) => t + 1);
        return;
      }
      setNotasPeriodo((prev) => prev.filter((n) => n.id !== linhaExistente.id));
      showSuccess('Nota removida.');
      return;
    }

    const nota = parseInt(bruto);
    if (isNaN(nota)) {
      showError('Valor de nota inválido.');
      return;
    }

    // Escala já não é escolha do utilizador — snapshot do ano_escolar do aluno.
    const { escala, min, max } = getEscalaPeriodo(aluno.ano_escolar);
    if (nota < min || nota > max) {
      showError(`A nota tem de estar entre ${min} e ${max} (escala /${escala}).`);
      return;
    }

    if (!centroId) {
      showError('Não foi possível identificar o centro. Recarrega a página e tenta novamente.');
      return;
    }

    const payload = {
      centro_id: centroId,
      aluno_id: studentId,
      disciplina_id: disciplinaId,
      ano_letivo: anoLetivoAtual,
      periodo,
      nota,
      nota_escala: escala,
      nota_reportada_por: userId,
      ...calcularEstadoNota(role, userId),
    };

    const { data, error } = await supabase
      .from('notas_periodo')
      .upsert(payload, { onConflict: 'aluno_id,disciplina_id,ano_letivo,periodo' })
      .select()
      .single();

    if (error) {
      showError('Erro ao guardar nota de período: ' + error.message);
      return;
    }

    setNotasPeriodo((prev) => {
      const semAntiga = prev.filter((n) => !(n.disciplina_id === disciplinaId && n.periodo === periodo));
      return [...semAntiga, data];
    });
    showSuccess('Nota de período atualizada.');
  };

  const handleConfirmarNotaPeriodo = async (linha: any) => {
    const payload = { nota_confirmada: true, nota_confirmada_por: userId, nota_confirmada_em: new Date().toISOString() };
    const { error } = await supabase.from('notas_periodo').update(payload).eq('id', linha.id);
    if (error) {
      showError('Erro ao confirmar: ' + error.message);
      return;
    }
    setNotasPeriodo((prev) => prev.map((n) => (n.id === linha.id ? { ...n, ...payload } : n)));
    showSuccess('Nota confirmada.');
  };

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" size={32} /></div>;
  if (!aluno) return <div className="p-8 text-primary">Aluno não encontrado.</div>;

  // Histórico nunca desaparece: uma disciplina com nota de período já
  // lançada continua na grelha mesmo que deixe de se aplicar ao ano atual
  // do aluno (fica marcada "fora do ano" — ver foraDoAno() abaixo).
  const idsComHistorico = [...new Set(notasPeriodo.map((n: any) => n.disciplina_id))];
  const disciplinasAplicaveis = disciplinasParaAno(subjects, aluno.ano_escolar, idsComHistorico);

  return (
    <main className="min-h-screen bg-page text-primary p-6 max-w-5xl mx-auto pb-20">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin/alunos" className="bg-surface p-3 rounded-xl hover:bg-raised transition-colors border border-border shrink-0">
          <ArrowLeft size={20} className="text-secondary" />
        </Link>
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="w-14 h-14 shrink-0 rounded-2xl bg-raised flex items-center justify-center text-xl font-black text-muted overflow-hidden border border-border/50">
            {aluno.avatar_url ? <img src={aluno.avatar_url} alt={aluno.nome} className="w-full h-full object-cover" /> : <span>{aluno.nome?.charAt(0)}</span>}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-black flex items-center gap-2 truncate">
              <ClipboardList className="text-accent shrink-0" /> {aluno.nome}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-[11px] font-bold text-secondary">
              <span className="flex items-center gap-1"><School size={12} className="text-muted" /> {aluno.escola || 'Escola não definida'}</span>
              <span className="flex items-center gap-1"><Users2 size={12} className="text-muted" /> {aluno.turma || 'Turma não definida'}</span>
              <span className="flex items-center gap-1"><GraduationCap size={12} className="text-muted" /> {aluno.ano_escolar}º Ano</span>
            </div>
          </div>
        </div>
      </div>

      {/* NOTAS DE TESTES */}
      <section className="bg-surface border border-border rounded-3xl p-6 mb-8 shadow-xl">
        <h2 className="text-sm font-black uppercase text-accent tracking-widest mb-5 flex items-center gap-2">
          <BookOpen size={16} /> Notas de Testes
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted">
                <th className="p-3 font-black">Disciplina</th>
                <th className="p-3 font-black">Matéria</th>
                <th className="p-3 font-black">Data</th>
                <th className="p-3 font-black text-center">Nota</th>
                <th className="p-3 font-black text-center">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {exams.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-muted italic">Sem testes registados.</td></tr>
              ) : (
                exams.map((exam) => {
                  const semNota = exam.nota_valor === null || exam.nota_valor === undefined;
                  return (
                    <tr key={exam.id} className="hover:bg-raised/20 transition-colors">
                      <td className="p-3 font-bold text-primary whitespace-nowrap">{exam.subject_name}</td>
                      <td className="p-3 text-secondary text-sm max-w-50 truncate">{exam.topics || '—'}</td>
                      <td className="p-3 text-secondary text-sm whitespace-nowrap">{format(new Date(exam.date + 'T00:00:00'), 'dd/MM/yyyy')}</td>
                      <td className="p-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <input
                            key={`nv-${exam.id}-${exam.nota_valor}`}
                            type="number"
                            step="0.01"
                            min={getEscalaTeste(aluno.ano_escolar).min}
                            max={getEscalaTeste(aluno.ano_escolar).max}
                            defaultValue={exam.nota_valor ?? ''}
                            placeholder="—"
                            onBlur={(e) => handleSalvarNotaTeste(exam, e.target.value)}
                            className="w-20 bg-page border border-border py-2 pl-3 pr-1 rounded-lg text-left font-mono font-bold text-primary outline-none focus:border-accent/50"
                          />
                          <span className="text-xs font-bold text-muted">
                            /{exam.nota_valor != null ? exam.nota_escala : getEscalaTeste(aluno.ano_escolar).escala}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        {semNota ? (
                          <span className="text-[10px] font-black uppercase text-muted">Sem nota</span>
                        ) : exam.nota_confirmada ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-success-bg text-success">
                            <CheckCircle2 size={11} /> Confirmada
                          </span>
                        ) : (
                          <div className="flex items-center justify-center gap-2">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-warning-bg text-warning">
                              <Clock size={11} /> Por confirmar
                            </span>
                            {podeConfirmar && (
                              <button onClick={() => handleConfirmarNotaTeste(exam)} className="text-[10px] font-black text-accent hover:underline">
                                Confirmar
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* NOTAS DE PERÍODO */}
      <section className="bg-surface border border-border rounded-3xl p-6 shadow-xl">
        <h2 className="text-sm font-black uppercase text-accent tracking-widest mb-5 flex items-center gap-2">
          <ClipboardList size={16} /> Notas de Período — {anoLetivoAtual}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted">
                <th className="p-3 font-black">Disciplina</th>
                <th className="p-3 font-black text-center">1º Período</th>
                <th className="p-3 font-black text-center">2º Período</th>
                <th className="p-3 font-black text-center">3º Período</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {disciplinasAplicaveis.length === 0 ? (
                <tr><td colSpan={4} className="p-8 text-center text-muted italic">Sem disciplinas aplicáveis a este ano.</td></tr>
              ) : (
                disciplinasAplicaveis.map((disciplina: any) => (
                  <tr key={disciplina.id} className="hover:bg-raised/20 transition-colors">
                    <td className="p-3 font-bold text-primary whitespace-nowrap">
                      {disciplina.name}
                      {foraDoAno(disciplina, aluno.ano_escolar) && (
                        <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-warning-bg text-warning align-middle" title="Já não se aplica ao ano atual do aluno — continua visível por ter histórico.">
                          <AlertTriangle size={9} /> Fora do ano
                        </span>
                      )}
                    </td>
                    {[1, 2, 3].map((periodo) => {
                      const linha = notasPeriodo.find((n) => n.disciplina_id === disciplina.id && n.periodo === periodo);
                      const escalaPeriodo = getEscalaPeriodo(aluno.ano_escolar);
                      return (
                        <td key={periodo} className="p-3 text-center whitespace-nowrap">
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center gap-1">
                              <input
                                key={`np-${disciplina.id}-${periodo}-${linha?.nota}-${resyncTick}`}
                                type="number"
                                step="1"
                                min={escalaPeriodo.min}
                                max={escalaPeriodo.max}
                                defaultValue={linha?.nota ?? ''}
                                placeholder="—"
                                onBlur={(e) => handleSalvarNotaPeriodo(disciplina.id, periodo, e.target.value)}
                                className="w-16 bg-page border border-border py-2 pl-2 pr-1 rounded-lg text-left font-mono font-bold text-primary outline-none focus:border-accent/50"
                              />
                              <span className="text-[10px] font-bold text-muted">
                                /{linha?.nota_escala || escalaPeriodo.escala}
                              </span>
                            </div>
                            {linha && (
                              linha.nota_confirmada ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-success-bg text-success">
                                  <CheckCircle2 size={9} /> Confirmada
                                </span>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-warning-bg text-warning">
                                    <Clock size={9} /> Por confirmar
                                  </span>
                                  {podeConfirmar && (
                                    <button onClick={() => handleConfirmarNotaPeriodo(linha)} className="text-[9px] font-black text-accent hover:underline">
                                      Confirmar
                                    </button>
                                  )}
                                </div>
                              )
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <StatusToast toast={toast} />
    </main>
  );
}

export default function FichaAluno() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>}>
      <FichaAlunoContent />
    </Suspense>
  );
}
