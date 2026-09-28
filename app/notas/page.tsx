'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { getAnoLetivoAtual } from '@/lib/anoLetivo';
import { calcularEstadoNota, getEscalaTeste, getEscalaPeriodo } from '@/lib/notas';
import { getHojeLisboa } from '@/lib/dataLisboa';
import { ABERTURA_PERIODOS, periodoJaAbriu } from '@/lib/periodos';
import { disciplinasParaAno, foraDoAno } from '@/lib/disciplinas';
import {
  ArrowLeft, Loader2, ClipboardList, BookOpen, Lock, Clock, CheckCircle2, Plus, X, AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';

type EstadoTeste = 'confirmada' | 'aguarda_staff' | 'por_confirmar' | 'sem_nota' | 'agendado';
type EstadoPeriodo = 'bloqueado' | 'vazio' | 'confirmada' | 'aguarda_staff' | 'por_confirmar';

function estadoCartaoTeste(exam: any, userId: string | null, hoje: string): EstadoTeste {
  const semNota = exam.nota_valor === null || exam.nota_valor === undefined;
  if (semNota) {
    return exam.date > hoje ? 'agendado' : 'sem_nota';
  }
  if (exam.nota_confirmada) return 'confirmada';
  if (exam.nota_reportada_por !== userId) return 'aguarda_staff';
  return 'por_confirmar';
}

function estadoCelulaPeriodo(linha: any | undefined, periodo: 1 | 2 | 3, anoLetivo: string, userId: string | null): EstadoPeriodo {
  if (!periodoJaAbriu(periodo, anoLetivo)) return 'bloqueado';
  if (!linha) return 'vazio';
  if (linha.nota_confirmada) return 'confirmada';
  if (linha.nota_reportada_por !== userId) return 'aguarda_staff';
  return 'por_confirmar';
}

function dataAberturaPeriodo(periodo: 1 | 2 | 3, anoLetivo: string): string {
  const [anoInicio] = anoLetivo.split('/').map(Number);
  const cfg = ABERTURA_PERIODOS[periodo];
  const ano = cfg.anoDoAnoLetivo === 'fim' ? anoInicio + 1 : anoInicio;
  return `${String(cfg.dia).padStart(2, '0')}/${String(cfg.mes).padStart(2, '0')}/${ano}`;
}

export default function AsMinhasNotas() {
  const { toast, showError, showSuccess } = useStatusToast();

  const [loading, setLoading] = useState(true);
  const [aluno, setAluno] = useState<any>(null);
  const [exams, setExams] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [notasPeriodo, setNotasPeriodo] = useState<any[]>([]);

  const [userId, setUserId] = useState<string | null>(null);
  const [centroId, setCentroId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  const [valoresTeste, setValoresTeste] = useState<Record<string, string>>({});
  const [salvandoTeste, setSalvandoTeste] = useState<string | null>(null);

  const [valoresPeriodo, setValoresPeriodo] = useState<Record<string, string>>({});
  const [celulaAberta, setCelulaAberta] = useState<string | null>(null);
  const [salvandoPeriodo, setSalvandoPeriodo] = useState<string | null>(null);

  const anoLetivoAtual = getAnoLetivoAtual();
  const hoje = getHojeLisboa();

  const fetchTudo = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/login'; return; }

    const centro_id = user.app_metadata?.centro_id ?? null;
    setUserId(user.id);
    setCentroId(centro_id);
    setRole(user.app_metadata?.role?.toLowerCase() ?? null);

    if (!centro_id) {
      showError('Não foi possível identificar o centro. Recarrega a página e tenta novamente.');
      setLoading(false);
      return;
    }

    const [
      { data: alunoData },
      { data: examsData },
      { data: subjectsData },
      { data: notasPeriodoData },
    ] = await Promise.all([
      supabase.from('alunos').select('nome, ano_escolar').eq('id', user.id).maybeSingle(),
      supabase.from('exams').select('*').eq('aluno_id', user.id).eq('centro_id', centro_id).order('date', { ascending: false }),
      supabase.from('subjects').select('id, name, anos_aplicaveis').eq('centro_id', centro_id).order('name'),
      supabase.from('notas_periodo').select('*').eq('aluno_id', user.id).eq('centro_id', centro_id).eq('ano_letivo', anoLetivoAtual),
    ]);

    setAluno(alunoData || null);
    setExams(examsData || []);
    setSubjects(subjectsData || []);
    setNotasPeriodo(notasPeriodoData || []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchTudo(); }, [fetchTudo]);

  // --- NOTAS DE TESTES ---
  const handleGuardarNotaTeste = async (exam: any) => {
    const bruto = (valoresTeste[exam.id] ?? '').trim();
    const valor = bruto === '' ? null : parseFloat(bruto);
    if (bruto !== '' && (valor === null || isNaN(valor))) {
      showError('Valor de nota inválido.');
      return;
    }

    const { escala, min, max } = getEscalaTeste(aluno?.ano_escolar);
    if (valor !== null && (valor < min || valor > max)) {
      showError(`A nota tem de estar entre ${min} e ${max} (escala /${escala}).`);
      return;
    }

    setSalvandoTeste(exam.id);
    const payload: Record<string, any> = {
      nota_valor: valor,
      nota_escala: valor === null ? exam.nota_escala : escala,
      ...calcularEstadoNota(role, userId),
    };
    const { data, error } = await supabase.from('exams').update(payload).eq('id', exam.id).select();
    setSalvandoTeste(null);

    if (error) {
      // Inclui as mensagens do trigger de proteção (ex: "só podes registar a
      // partir do dia do teste") — a UI tenta concordar com o trigger, mas
      // se discordarem, é sempre a mensagem dele que aparece aqui.
      showError(error.message);
      return;
    }
    // RLS/trigger podem filtrar a linha em silêncio (sem erro) — nunca
    // assumir sucesso só por não haver `error`.
    if (!data || data.length === 0) {
      showError('Não foi possível guardar esta nota.');
      return;
    }
    setExams((prev) => prev.map((e) => (e.id === exam.id ? data[0] : e)));
    showSuccess('Nota guardada.');
  };

  // --- NOTAS DE PERÍODO ---
  const handleGuardarNotaPeriodo = async (disciplinaId: number, periodo: number) => {
    const key = `${disciplinaId}-${periodo}`;
    const bruto = (valoresPeriodo[key] ?? '').trim();
    const linhaExistente = notasPeriodo.find((n) => n.disciplina_id === disciplinaId && n.periodo === periodo);

    if (bruto === '') {
      if (linhaExistente) {
        // O aluno não tem DELETE em notas_periodo (só professor/secretária) —
        // esvaziar o campo nunca apaga nada. Repõe o valor gravado (o input é
        // controlado, por isso remover o rascunho já o faz mostrar de novo
        // linha.nota) em vez de deixar o campo vazio a mentir sobre o estado.
        setValoresPeriodo((prev) => { const cp = { ...prev }; delete cp[key]; return cp; });
        showError('Para remover esta nota, pede a um professor.');
      } else {
        showError('Introduz um valor.');
      }
      return;
    }

    const nota = parseInt(bruto, 10);
    if (isNaN(nota)) {
      showError('Valor de nota inválido.');
      return;
    }

    const { escala, min, max } = getEscalaPeriodo(aluno?.ano_escolar);
    if (nota < min || nota > max) {
      showError(`A nota tem de estar entre ${min} e ${max} (escala /${escala}).`);
      return;
    }

    if (!centroId || !userId) {
      showError('Não foi possível identificar o centro. Recarrega a página e tenta novamente.');
      return;
    }

    setSalvandoPeriodo(key);
    const payload = {
      centro_id: centroId,
      aluno_id: userId,
      disciplina_id: disciplinaId,
      ano_letivo: anoLetivoAtual,
      periodo,
      nota,
      nota_escala: escala,
      ...calcularEstadoNota(role, userId),
    };
    const { data, error } = await supabase
      .from('notas_periodo')
      .upsert(payload, { onConflict: 'aluno_id,disciplina_id,ano_letivo,periodo' })
      .select();
    setSalvandoPeriodo(null);

    if (error) {
      showError(error.message);
      return;
    }
    if (!data || data.length === 0) {
      showError('Não foi possível guardar esta nota.');
      return;
    }
    setNotasPeriodo((prev) => {
      const semAntiga = prev.filter((n) => !(n.disciplina_id === disciplinaId && n.periodo === periodo));
      return [...semAntiga, data[0]];
    });
    setValoresPeriodo((prev) => {
      const cp = { ...prev };
      delete cp[key];
      return cp;
    });
    setCelulaAberta(null);
    showSuccess('Nota guardada.');
  };

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" size={32} /></div>;

  // Histórico nunca desaparece: uma disciplina com nota de período já
  // lançada continua na grelha mesmo que deixe de se aplicar ao ano atual
  // (fica marcada "fora do ano" — ver foraDoAno() abaixo).
  const idsComHistorico = [...new Set(notasPeriodo.map((n: any) => n.disciplina_id))];
  const disciplinasAplicaveis = disciplinasParaAno(subjects, aluno?.ano_escolar ?? null, idsComHistorico);

  return (
    <main className="min-h-screen bg-page text-primary p-6 max-w-md mx-auto space-y-8 pb-20">
      <Link href="/" className="flex items-center gap-2 text-muted hover:text-primary transition-colors">
        <ArrowLeft size={20} /> <span className="font-bold">Voltar ao Início</span>
      </Link>

      <div>
        <h1 className="text-2xl font-black flex items-center gap-2">
          <ClipboardList className="text-accent" /> As Minhas Notas
        </h1>
        <p className="text-secondary text-xs font-bold uppercase tracking-widest mt-1">{anoLetivoAtual}</p>
      </div>

      {/* NOTAS DE TESTES */}
      <section className="space-y-3">
        <h2 className="text-xs font-black uppercase text-muted tracking-widest flex items-center gap-2">
          <BookOpen size={14} /> Notas de Testes
        </h2>

        {exams.length === 0 ? (
          <p className="text-muted text-sm italic">Sem testes registados.</p>
        ) : (
          exams.map((exam) => {
            const estado = estadoCartaoTeste(exam, userId, hoje);
            const escalaExibida = exam.nota_valor != null ? exam.nota_escala : getEscalaTeste(aluno?.ano_escolar).escala;
            const aGuardar = salvandoTeste === exam.id;

            return (
              <div key={exam.id} className="bg-surface border border-border rounded-3xl p-5 shadow-xl space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-black text-primary truncate">{exam.subject_name}</h3>
                    <p className="text-[11px] text-muted truncate">
                      {format(new Date(exam.date + 'T00:00:00'), 'dd/MM/yyyy')}{exam.topics ? ` · ${exam.topics}` : ''}
                    </p>
                  </div>
                  {estado === 'confirmada' && (
                    <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-success-bg text-success">
                      <CheckCircle2 size={11} /> Confirmada
                    </span>
                  )}
                  {estado === 'aguarda_staff' && (
                    <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-warning-bg text-warning">
                      <Clock size={11} /> Aguarda confirmação
                    </span>
                  )}
                  {estado === 'por_confirmar' && (
                    <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-warning-bg text-warning">
                      <Clock size={11} /> Por confirmar
                    </span>
                  )}
                </div>

                {estado === 'agendado' && (
                  <p className="text-xs text-muted italic">Podes registar a nota depois do teste.</p>
                )}

                {(estado === 'confirmada' || estado === 'aguarda_staff') && (
                  <div className="flex items-center gap-1.5 text-secondary">
                    <Lock size={14} className="text-muted" />
                    <span className="font-mono font-bold text-lg">{exam.nota_valor}</span>
                    <span className="text-xs font-bold text-muted">/{escalaExibida}</span>
                  </div>
                )}

                {(estado === 'por_confirmar' || estado === 'sem_nota') && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        step="0.01"
                        min={getEscalaTeste(aluno?.ano_escolar).min}
                        max={getEscalaTeste(aluno?.ano_escolar).max}
                        value={valoresTeste[exam.id] ?? (exam.nota_valor?.toString() ?? '')}
                        onChange={(e) => setValoresTeste((prev) => ({ ...prev, [exam.id]: e.target.value }))}
                        placeholder="—"
                        disabled={aGuardar}
                        className="w-20 bg-page border border-border py-2 pl-3 pr-1 rounded-lg text-left font-mono font-bold text-primary outline-none focus:border-accent/50 disabled:opacity-50"
                      />
                      <span className="text-xs font-bold text-muted">/{escalaExibida}</span>
                    </div>
                    <button
                      onClick={() => handleGuardarNotaTeste(exam)}
                      disabled={aGuardar}
                      className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-on-accent text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-lg transition-all disabled:opacity-50"
                    >
                      {aGuardar ? <Loader2 size={12} className="animate-spin" /> : null}
                      Guardar
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* NOTAS DE PERÍODO */}
      <section className="space-y-3">
        <h2 className="text-xs font-black uppercase text-muted tracking-widest flex items-center gap-2">
          <ClipboardList size={14} /> Notas de Período
        </h2>

        <div className="bg-surface border border-border rounded-3xl p-4 shadow-xl overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border text-[9px] uppercase tracking-widest text-muted">
                <th className="p-2 font-black">Disciplina</th>
                <th className="p-2 font-black text-center">1º</th>
                <th className="p-2 font-black text-center">2º</th>
                <th className="p-2 font-black text-center">3º</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {disciplinasAplicaveis.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-muted italic text-sm">Sem disciplinas aplicáveis a este ano.</td></tr>
              ) : (
                disciplinasAplicaveis.map((disciplina: any) => (
                  <tr key={disciplina.id}>
                    <td className="p-2 font-bold text-primary text-sm whitespace-nowrap">
                      {disciplina.name}
                      {foraDoAno(disciplina, aluno?.ano_escolar ?? null) && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase bg-warning-bg text-warning align-middle" title="Já não se aplica ao teu ano atual — continua visível por teres notas aqui.">
                          <AlertTriangle size={8} /> Fora do ano
                        </span>
                      )}
                    </td>
                    {([1, 2, 3] as const).map((periodo) => {
                      const linha = notasPeriodo.find((n) => n.disciplina_id === disciplina.id && n.periodo === periodo);
                      const estado = estadoCelulaPeriodo(linha, periodo, anoLetivoAtual, userId);
                      const key = `${disciplina.id}-${periodo}`;
                      const escalaPeriodo = getEscalaPeriodo(aluno?.ano_escolar);
                      const aGuardar = salvandoPeriodo === key;

                      return (
                        <td key={periodo} className="p-2 text-center">
                          {estado === 'bloqueado' && (
                            <div className="flex flex-col items-center gap-0.5" title={`Disponível a partir de ${dataAberturaPeriodo(periodo, anoLetivoAtual)}`}>
                              <Lock size={12} className="text-muted" />
                              <span className="text-[8px] text-muted">{dataAberturaPeriodo(periodo, anoLetivoAtual)}</span>
                            </div>
                          )}

                          {estado === 'vazio' && celulaAberta !== key && (
                            <button onClick={() => setCelulaAberta(key)} className="text-muted hover:text-accent transition-colors">
                              <Plus size={16} />
                            </button>
                          )}

                          {estado === 'vazio' && celulaAberta === key && (
                            <div className="flex flex-col items-center gap-1">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  step="1"
                                  min={escalaPeriodo.min}
                                  max={escalaPeriodo.max}
                                  value={valoresPeriodo[key] ?? ''}
                                  onChange={(e) => setValoresPeriodo((prev) => ({ ...prev, [key]: e.target.value }))}
                                  disabled={aGuardar}
                                  className="w-12 bg-page border border-border py-1 px-1 rounded-lg text-center font-mono font-bold text-primary outline-none focus:border-accent/50 disabled:opacity-50"
                                  autoFocus
                                />
                                <span className="text-[9px] font-bold text-muted">/{escalaPeriodo.escala}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleGuardarNotaPeriodo(disciplina.id, periodo)}
                                  disabled={aGuardar}
                                  className="bg-accent hover:bg-accent-hover text-on-accent text-[9px] font-black uppercase px-2 py-1 rounded-lg transition-all disabled:opacity-50"
                                >
                                  {aGuardar ? <Loader2 size={10} className="animate-spin" /> : 'Guardar'}
                                </button>
                                <button
                                  onClick={() => { setCelulaAberta(null); setValoresPeriodo((prev) => { const cp = { ...prev }; delete cp[key]; return cp; }); }}
                                  disabled={aGuardar}
                                  className="text-muted hover:text-danger transition-colors"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          )}

                          {(estado === 'confirmada' || estado === 'aguarda_staff') && (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={estado === 'confirmada' ? 'text-success' : 'text-warning'}>●</span>
                              <span className="font-mono font-bold text-sm text-primary">{linha.nota}<span className="text-[9px] text-muted">/{linha.nota_escala}</span></span>
                            </div>
                          )}

                          {estado === 'por_confirmar' && (
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-warning">○</span>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  step="1"
                                  min={escalaPeriodo.min}
                                  max={escalaPeriodo.max}
                                  value={valoresPeriodo[key] ?? linha.nota.toString()}
                                  onChange={(e) => setValoresPeriodo((prev) => ({ ...prev, [key]: e.target.value }))}
                                  disabled={aGuardar}
                                  className="w-12 bg-page border border-border py-1 px-1 rounded-lg text-center font-mono font-bold text-primary outline-none focus:border-accent/50 disabled:opacity-50"
                                />
                                <span className="text-[9px] font-bold text-muted">/{linha.nota_escala}</span>
                              </div>
                              <button
                                onClick={() => handleGuardarNotaPeriodo(disciplina.id, periodo)}
                                disabled={aGuardar}
                                className="bg-accent hover:bg-accent-hover text-on-accent text-[9px] font-black uppercase px-2 py-1 rounded-lg transition-all disabled:opacity-50"
                              >
                                {aGuardar ? <Loader2 size={10} className="animate-spin" /> : 'Guardar'}
                              </button>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted px-1">● confirmada &nbsp;·&nbsp; ○ por confirmar</p>
      </section>

      <StatusToast toast={toast} />
    </main>
  );
}
