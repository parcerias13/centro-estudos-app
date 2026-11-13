'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { disciplinasParaAno } from '@/lib/disciplinas';
import { getHojeLisboa, diasEntre } from '@/lib/dataLisboa';
import {
  BookOpen, LogOut, Loader2, CheckCircle2, Calendar, User, Library, MapPin, RefreshCw,
  ClipboardList, Lock, FolderOpen, CalendarClock, GraduationCap,
} from 'lucide-react';
import { contarMaterialNovoAluno } from '@/lib/materialAluno';
import CheckInBotaoUnico from './CheckInBotaoUnico';

export default function StudentHome() {
  const { toast, showError } = useStatusToast();
  const [subjects, setSubjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentSession, setCurrentSession] = useState<any>(null);
  const [studentName, setStudentName] = useState('');
  const [proximoTeste, setProximoTeste] = useState<any>(null);

  const [showSwitchList, setShowSwitchList] = useState(false);
  const [encarregadosNaoLidas, setEncarregadosNaoLidas] = useState(0);
  const [materialNovoCount, setMaterialNovoCount] = useState(0);
  const [checkinMode, setCheckinMode] = useState<'disciplina' | 'botao_unico'>('disciplina');

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return (window.location.href = '/login');
    if (user.app_metadata?.role === 'admin') return (window.location.href = '/admin');
    const centro_id = user.app_metadata?.centro_id;

    const { data: session } = await supabase
      .from('diario_bordo')
      .select('*, salas(nome)')
      .eq('aluno_id', user.id)
      .is('saida', null)
      .maybeSingle();

    setCurrentSession(session);

    try {
      const { data: modo } = await supabase.rpc('modo_checkin_aluno');
      setCheckinMode(modo === 'botao_unico' ? 'botao_unico' : 'disciplina');
    } catch {
      setCheckinMode('disciplina');
    }

    const { data: student } = await supabase
      .from('alunos')
      .select('nome, ano_escolar')
      .eq('id', user.id)
      .maybeSingle();

    if (student) {
      setStudentName(student.nome?.split(' ')[0] || 'Aluno');
    }

    let subjectsQuery = supabase.from('subjects').select('*, salas(nome)').order('name');
    if (centro_id) subjectsQuery = subjectsQuery.eq('centro_id', centro_id);
    const { data: subjs } = await subjectsQuery;
    const anoAluno = student?.ano_escolar ?? null;
    setSubjects(disciplinasParaAno(subjs || [], anoAluno));

    const hojeStr = getHojeLisboa();
    const { data: teste } = await supabase
      .from('exams')
      .select('*')
      .eq('aluno_id', user.id)
      .eq('centro_id', user.app_metadata?.centro_id)
      .gte('date', hojeStr)
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle();
    setProximoTeste(teste);

    const { count: naoLidasCount } = await supabase
      .from('mensagens')
      .select('id', { count: 'exact', head: true })
      .eq('aluno_id', user.id)
      .eq('autor', 'centro')
      .is('lida_pela_familia_em', null);
    setEncarregadosNaoLidas(naoLidasCount || 0);

    try {
      setMaterialNovoCount(await contarMaterialNovoAluno(supabase, user.id));
    } catch {
      setMaterialNovoCount(0);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const safeAction = async (actionFn: () => Promise<void>) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await actionFn();
      await fetchData();
    } catch (error) {
      console.error("Erro na operação:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckIn = async (subjectId: number, subjectName: string, salaId: string | null) => {
    if (currentSession) return;
    await supabase.auth.refreshSession();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const centro_id = user.app_metadata?.centro_id;
    if (!centro_id) return;

    const { data: newSession, error } = await supabase.from('diario_bordo').insert({
      aluno_id: user.id,
      subject_id: subjectId,
      subject_name: subjectName,
      sala_id: salaId,
      entrada: new Date().toISOString(),
      centro_id,
    }).select().single();

    if (error) return showError(`Erro: ${error.message}`);

    if (newSession) {
      await supabase.from('atividades_estudo').insert({
        sessao_id: newSession.id,
        subject_id: subjectId,
        centro_id,
      });
    }
  };

  const handleSwitchSubject = async (newSubjectId: number, newSubjectName: string, newSalaId: string | null) => {
    if (!currentSession) return;

    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;
    if (!centro_id) {
      showError('Não foi possível identificar o centro. Recarrega a página e tenta novamente.');
      return;
    }

    await supabase.from('atividades_estudo')
      .update({ fim: new Date().toISOString() })
      .eq('sessao_id', currentSession.id)
      .is('fim', null);

    await supabase.from('atividades_estudo').insert({
      sessao_id: currentSession.id,
      subject_id: newSubjectId,
      centro_id,
    });

    const { error } = await supabase.from('diario_bordo')
      .update({
        subject_id: newSubjectId,
        subject_name: newSubjectName,
        sala_id: newSalaId
      })
      .eq('id', currentSession.id);

    if (error) {
      showError('Erro ao trocar de disciplina: ' + error.message);
      return;
    }

    setShowSwitchList(false);
  };

  const handleCheckout = async () => {
    if (!currentSession) return;
    if (!confirm('Já acabaste por hoje?')) return;

    await supabase.from('atividades_estudo')
      .update({ fim: new Date().toISOString() })
      .eq('sessao_id', currentSession.id)
      .is('fim', null);

    const { error } = await supabase.from('diario_bordo')
      .update({ saida: new Date().toISOString() })
      .eq('id', currentSession.id);

    if (error) {
      showError('Erro ao terminar sessão: ' + error.message);
    }
  };

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;

  const diasAteTeste = proximoTeste ? diasEntre(proximoTeste.date) : null;
  const rotuloTeste = diasAteTeste === null ? ''
    : diasAteTeste <= 0 ? 'hoje'
    : diasAteTeste === 1 ? 'amanhã'
    : `daqui a ${diasAteTeste} dias`;

  return (
    <main className="min-h-screen bg-page text-primary p-6 font-sans">
      <div className="max-w-xl mx-auto">

        <header className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-black italic tracking-tighter">Olá, {studentName}</h1>
            <p className="text-secondary text-sm font-normal mt-1">O que vamos estudar hoje?</p>
          </div>
          <div className="flex gap-2">
            <Link href="/perfil" className="bg-surface p-3 rounded-xl border border-border text-secondary"><User size={20} /></Link>
            <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login'; }} className="bg-surface p-3 rounded-xl border border-border text-secondary"><LogOut size={20} /></button>
          </div>
        </header>

        {proximoTeste && (
          <Link
            href="/agenda"
            className="flex items-center gap-4 bg-warning-bg border border-warning/20 p-4 rounded-2xl mb-6 min-h-11"
          >
            <div className="bg-warning-bg p-3 rounded-xl text-warning shrink-0"><GraduationCap size={20} /></div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase text-warning/60 tracking-widest">Próximo teste</p>
              <p className="text-sm font-bold text-warning truncate">{proximoTeste.subject_name} · {rotuloTeste}</p>
            </div>
          </Link>
        )}

        <section className={`mb-8 transition-all duration-300 ${isSubmitting ? 'pointer-events-none opacity-60' : ''}`}>
          {checkinMode === 'botao_unico' ? (
            <CheckInBotaoUnico showError={showError} />
          ) : currentSession ? (
            <div className="bg-surface border border-border p-6 rounded-3xl text-center space-y-4">
              <div className="bg-success-bg text-success p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto border-4 border-success/20">
                <CheckCircle2 size={28} />
              </div>
              <div>
                <p className="text-lg font-black text-primary">Bom Estudo, {studentName}!</p>
                <p className="text-sm font-black text-accent mt-1">{currentSession.subject_name || 'Sessão Livre'}</p>
                {currentSession.salas?.nome && (
                  <div className="mt-3 bg-success-bg border border-success/30 rounded-xl p-3 flex items-center justify-center gap-2">
                    <MapPin size={16} className="text-success" />
                    <p className="text-xs font-black text-primary capitalize">{currentSession.salas.nome}</p>
                  </div>
                )}
              </div>

              <button
                onClick={() => setShowSwitchList(!showSwitchList)}
                className="w-full min-h-11 py-3 bg-raised hover:bg-border text-secondary rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all"
              >
                <RefreshCw size={14} className={showSwitchList ? 'animate-spin' : ''} />
                {showSwitchList ? 'Cancelar Troca' : 'Trocar Disciplina'}
              </button>

              {showSwitchList && (
                <div className="grid grid-cols-2 gap-2">
                  {subjects.filter(s => s.id !== currentSession.subject_id).map((subject) => (
                    <button
                      key={subject.id}
                      onClick={() => safeAction(() => handleSwitchSubject(subject.id, subject.name, subject.sala_id))}
                      className="bg-page border border-border p-3 rounded-xl text-[10px] font-bold hover:border-accent transition-colors min-h-11"
                    >
                      {subject.name}
                    </button>
                  ))}
                </div>
              )}

              <button onClick={() => safeAction(handleCheckout)} disabled={isSubmitting} className="w-full min-h-11 bg-surface hover:bg-danger-bg text-secondary hover:text-danger border border-border py-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all">
                {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : <LogOut size={20} />} TERMINAR SESSÃO
              </button>
            </div>
          ) : (
            <div>
              <h3 className="font-black text-secondary text-xs uppercase tracking-widest mb-3 px-1">Cheguei: escolhe a disciplina</h3>
              <div className="grid grid-cols-2 gap-3">
                {subjects.map((subject) => (
                  <button
                    key={subject.id}
                    disabled={isSubmitting}
                    onClick={() => safeAction(() => handleCheckIn(subject.id, subject.name, subject.sala_id))}
                    className="bg-surface hover:bg-raised border border-border p-4 rounded-2xl text-left transition-all relative active:scale-95 disabled:opacity-50 min-h-11"
                  >
                    <div className="bg-accent-soft text-accent w-8 h-8 rounded-lg flex items-center justify-center mb-2">
                      <BookOpen size={16} />
                    </div>
                    <span className="font-black text-sm block text-primary">{subject.name}</span>
                    {subject.salas?.nome && (
                      <span className="absolute top-3 right-3 text-[8px] bg-raised text-secondary px-1.5 py-0.5 rounded font-black uppercase tracking-widest">
                        {subject.salas.nome}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <h3 className="font-black text-secondary text-xs uppercase tracking-widest mb-3 px-1">O teu espaço</h3>
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Link href="/agenda" className="bg-surface border border-border p-4 rounded-2xl flex flex-col gap-2 min-h-11">
            <Calendar size={18} className="text-purple-500" />
            <span className="font-black text-sm text-primary">Agenda</span>
            <p className="text-xs text-secondary font-normal">Calendário de testes</p>
          </Link>

          <Link href="/notas" className="bg-surface border border-border p-4 rounded-2xl flex flex-col gap-2 min-h-11">
            <ClipboardList size={18} className="text-accent" />
            <span className="font-black text-sm text-primary">Notas</span>
            <p className="text-xs text-secondary font-normal">Testes e Notas de Período</p>
          </Link>

          <Link href="/biblioteca" className="bg-surface border border-border p-4 rounded-2xl flex flex-col gap-2 min-h-11">
            <Library size={18} className="text-orange-500" />
            <span className="font-black text-sm text-primary">Biblioteca</span>
            <p className="text-xs text-secondary font-normal">Livros e recursos de estudo</p>
          </Link>

          <Link href="/material" className="relative bg-surface border border-border p-4 rounded-2xl flex flex-col gap-2 min-h-11">
            {materialNovoCount > 0 && (
              <span className="absolute top-3 right-3 bg-danger text-on-danger text-[9px] font-black min-w-5 h-5 px-1 rounded-full flex items-center justify-center">{materialNovoCount}</span>
            )}
            <FolderOpen size={18} className="text-teal-500" />
            <span className="font-black text-sm text-primary">Material</span>
            <p className="text-xs text-secondary font-normal">Fichas, resumos e apontamentos</p>
          </Link>

          <Link href="/minhas-explicacoes" className="bg-surface border border-border p-4 rounded-2xl flex flex-col gap-2 min-h-11">
            <CalendarClock size={18} className="text-blue-500" />
            <span className="font-black text-sm text-primary">As Minhas Explicações</span>
            <p className="text-xs text-secondary font-normal">Sessões marcadas e cancelamentos</p>
          </Link>
        </div>

        <Link href="/encarregados" className="flex items-center gap-3 min-h-11 py-2">
          <Lock size={16} className="text-muted shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-secondary truncate">Área dos Encarregados</p>
            <p className="text-[10px] font-normal text-muted truncate">Só para encarregados, com código</p>
          </div>
          <span className="flex items-center gap-1.5 shrink-0">
            {encarregadosNaoLidas > 0 && (
              <span className="bg-danger text-on-danger text-[9px] font-black min-w-4 h-4 px-1 rounded-full flex items-center justify-center">{encarregadosNaoLidas}</span>
            )}
            <span className="text-muted">›</span>
          </span>
        </Link>
      </div>

      <StatusToast toast={toast} />
    </main>
  );
}
