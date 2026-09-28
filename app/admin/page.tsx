'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { disciplinasComuns } from '@/lib/disciplinas';
import { Users, AlertTriangle, ShieldAlert, Clock, Loader2, RefreshCw, MessageCircle, LogOut, MapPin, CheckCircle2, XCircle, UserPlus, Search, X, Plus, Calendar, ChevronDown, ChevronUp, Undo2 } from 'lucide-react';


export default function DashboardAdmin() {
  const { toast, showError, showSuccess } = useStatusToast();
  const [presencas, setPresencas] = useState<any[]>([]);
  const [proximosTestes, setProximosTestes] = useState<any[]>([]);
  const [salas, setSalas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- SISTEMA DE CONTROLO DE FLUXO (ANTI-DOUBLE CLICK) ---
  const safeAction = async (actionFn: () => Promise<void>) => {
    if (isSubmitting) return; 
    
    setIsSubmitting(true);
    try {
      await actionFn(); 
    } catch (error) {
      console.error("Erro na operação:", error);
    } finally {
      setIsSubmitting(false); 
    }
  };

  // --- ESTADOS PARA CHECK-IN MANUAL ---
  const [alunos, setAlunos] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubject, setSelectedSubject] = useState<any>(null);
  const [mostrarOutros, setMostrarOutros] = useState(false);
  const [alunosEmCheckin, setAlunosEmCheckin] = useState<Set<string>>(new Set());
  const [toastCheckin, setToastCheckin] = useState<{ nome: string; disciplina: string; registoId: string } | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- ESTADOS PARA AGENDAMENTO DE TESTES ---
  const [isExamModalOpen, setIsExamModalOpen] = useState(false);
  const [examSearchQuery, setExamSearchQuery] = useState('');
  const [selectedExamStudents, setSelectedExamStudents] = useState<any[]>([]);
  const [examAnoInteiro, setExamAnoInteiro] = useState('');
  // null = ainda não verificado (não filtra, para não esconder tudo por engano
  // se a verificação falhar); depois de carregado, contém só os aluno_ids que
  // têm conta de Auth (só esses podem ser referenciados em exams.aluno_id).
  const [examAlunosComConta, setExamAlunosComConta] = useState<Set<string> | null>(null);
  const [examDate, setExamDate] = useState('');
  const [examSubject, setExamSubject] = useState('');
  const [examTopics, setExamTopics] = useState('');

  // 1. FUNÇÃO DE BUSCA
  const isFetchingRef = useRef(false);
  const fetchPendingRef = useRef(false);

  const fetchDados = useCallback(async () => {
    if (isFetchingRef.current) {
      fetchPendingRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    try {
      const { data: presentes, error: errP } = await supabase
        .from('diario_bordo')
        .select(`
          *, 
          alunos!aluno_id(
            *, 
            pacotes(nome, sessoes_semanais), 
            aluno_horarios(dia_semana)
          )
        `) 
        .is('saida', null)
        .order('entrada', { ascending: false });
      
      if (errP) throw errP;

      const { data: { user } } = await supabase.auth.getUser();
      const centro_id = user?.app_metadata?.centro_id;

      const hojeStr = new Date().toISOString().split('T')[0];
      const { data: exames } = await supabase
        .from('exams')
        .select('*, alunos(nome)')
        .eq('centro_id', centro_id)
        .gte('date', hojeStr)
        .order('date', { ascending: true });

      const { data: salasData } = await supabase.from('salas').select('*').order('nome');
      
      // ADICIONADO FILTRO PARA NÃO MOSTRAR ALUNOS APAGADOS NO CHECK-IN MANUAL
      const { data: aData } = await supabase
        .from('alunos')
        .select('*, pacotes(nome), aluno_horarios(dia_semana)')
        .order('nome');
        
      const { data: subData } = await supabase.from('subjects').select('*').eq('centro_id', centro_id).order('name');
      
      setPresencas(presentes || []);
      setProximosTestes(exames || []);
      setSalas(salasData || []);
      setAlunos(aData || []);
      setSubjects(subData || []);
    } catch (err: any) {
      console.error("❌ Erro ao buscar dados:", err.message);
      setErrorMsg("Falha na sincronização: " + err.message);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
      if (fetchPendingRef.current) {
        fetchPendingRef.current = false;
        fetchDados();
      }
    }
  }, [supabase]);

  // 2. REALTIME
  useEffect(() => {
    fetchDados();
    const channel = supabase
      .channel('dashboard-realtime-master')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'diario_bordo' }, () => fetchDados())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exams' }, () => fetchDados())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchDados]);

  // Verifica, ao abrir o modal de Agendar Teste, quais alunos ativos têm conta
  // de Auth associada — só esses podem ser selecionados (exams.aluno_id exige).
  useEffect(() => {
    if (!isExamModalOpen) return;
    (async () => {
      const ids = alunos.filter((a) => a.ativo !== false).map((a) => a.id);
      if (ids.length === 0) {
        setExamAlunosComConta(new Set());
        return;
      }
      try {
        const res = await fetch('/api/admin/verificar-alunos-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alunoIds: ids }),
        });
        const body = await res.json();
        if (res.ok) {
          setExamAlunosComConta(new Set(body.comConta));
        } else {
          showError('Não foi possível verificar contas de acesso: ' + (body.error || 'erro desconhecido'));
        }
      } catch (err: any) {
        showError('Erro ao verificar contas de acesso: ' + err.message);
      }
    })();
  }, [isExamModalOpen, alunos]);

  // Rede de segurança: enquanto a verificação acima ainda não respondeu,
  // examAlunosComConta fica a null e a lista/atalho não filtram nada (falha
  // aberta, de propósito, para um erro de rede não esconder tudo). Um clique
  // nessa janela pode ter selecionado alguém sem conta antes do filtro chegar
  // — assim que a resposta real chega, remove da seleção quem não pertencer
  // ao conjunto confirmado, independentemente de como lá entrou.
  useEffect(() => {
    if (examAlunosComConta === null) return;
    setSelectedExamStudents((prev) => prev.filter((a) => examAlunosComConta.has(a.id)));
  }, [examAlunosComConta]);

  // 3. HANDLERS
  const handleMassCheckout = async () => {
    if (!confirm("⚠️ ATENÇÃO: Desejas fechar a sessão de TODOS os alunos agora?")) return;
    const { error } = await supabase.rpc('checkout_em_massa');
    if (error) alert("Erro ao realizar checkout: " + error.message);
    else fetchDados();
  };

  const handleValidarEntrada = async (presencaId: string) => {
    const { error } = await supabase.from('diario_bordo').update({ status: 'validado' }).eq('id', presencaId);
    if (!error) fetchDados();
    else showError('Erro ao validar entrada: ' + error.message);
  };

  const handleRejeitarEntrada = async (presencaId: string) => {
    if (!confirm("O aluno não está no centro?")) return;
    const { error } = await supabase.from('diario_bordo').delete().eq('id', presencaId);
    if (!error) fetchDados();
    else showError('Erro ao rejeitar entrada: ' + error.message);
  };

  const handleWhatsApp = async (presencaId: string, telefone: string, nome: string, tipo: 'entrada' | 'saida') => {
    if (!telefone) return alert("Este aluno não tem telefone registado.");
    const numApenasNumeros = telefone.replace(/\D/g, '');
    const numFinal = numApenasNumeros.startsWith('351') ? numApenasNumeros : `351${numApenasNumeros}`;
    const msg = tipo === 'entrada'
      ? `Olá! Informamos que o(a) aluno(a) ${nome} deu entrada no Centro de Estudos! 📚`
      : `Olá! Informamos que o(a) aluno(a) ${nome} concluiu a sua sessão de estudo!`;
    window.open(`https://wa.me/${numFinal}?text=${encodeURIComponent(msg)}`, '_blank');
    const updateData = tipo === 'entrada' ? { msg_in_enviada: true } : { msg_out_enviada: true };
    const { error } = await supabase.from('diario_bordo').update(updateData).eq('id', presencaId);
    if (!error) fetchDados();
    else showError('Erro ao registar envio de mensagem: ' + error.message);
  };

  const handleDarSaida = async (presencaId: string) => {
    if(!confirm("Confirmar saída física?")) return;
    const { error } = await supabase.from('diario_bordo').update({ saida: new Date().toISOString() }).eq('id', presencaId);
    if (!error) fetchDados();
    else showError('Erro ao registar saída: ' + error.message);
  };

  const handleManualCheckIn = async (aluno: any) => {
    if (!selectedSubject) return alert('Seleciona a disciplina primeiro.');
    if (alunosEmCheckin.has(aluno.id)) return;

    setAlunosEmCheckin(prev => new Set(prev).add(aluno.id));
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const centro_id = user?.app_metadata?.centro_id;
      if (!centro_id) throw new Error('Não foi possível obter o centro.');

      const { data, error } = await supabase.from('diario_bordo').insert({
        aluno_id: aluno.id,
        subject_id: selectedSubject.id,
        subject_name: selectedSubject.name,
        sala_id: selectedSubject.sala_id,
        entrada: new Date().toISOString(),
        status: 'validado',
        centro_id,
      }).select().single();
      if (error) throw error;

      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      setToastCheckin({ nome: aluno.nome, disciplina: selectedSubject.name, registoId: data.id });
      toastTimeoutRef.current = setTimeout(() => setToastCheckin(null), 3000);

      fetchDados();
    } catch (error: any) {
      alert('Erro ao fazer check-in: ' + error.message);
    } finally {
      setAlunosEmCheckin(prev => {
        const next = new Set(prev);
        next.delete(aluno.id);
        return next;
      });
    }
  };

  const handleUndoCheckin = async (registoId: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastCheckin(null);
    const { error } = await supabase.from('diario_bordo').delete().eq('id', registoId);
    if (error) alert('Erro ao desfazer: ' + error.message);
    fetchDados();
  };

  const handleCloseCheckinModal = () => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setIsModalOpen(false);
    setSelectedSubject(null);
    setSearchQuery('');
    setMostrarOutros(false);
    setToastCheckin(null);
    fetchDados();
  };

  const toggleExamStudent = (aluno: any) => {
    setSelectedExamStudents((prev) =>
      prev.some((s) => s.id === aluno.id) ? prev.filter((s) => s.id !== aluno.id) : [...prev, aluno]
    );
  };

  const handleAdicionarAnoInteiro = () => {
    // Verificação ainda a decorrer: não deixa adicionar ninguém às cegas
    // (o botão já fica desativado na UI, isto é defesa a mais).
    if (!examAnoInteiro || examAlunosComConta === null) return;
    const anoNum = parseInt(examAnoInteiro);
    const doAno = alunos.filter((a) =>
      a.ano_escolar === anoNum &&
      a.ativo !== false &&
      examAlunosComConta.has(a.id)
    );
    setSelectedExamStudents((prev) => {
      const idsExistentes = new Set(prev.map((s) => s.id));
      const novos = doAno.filter((a) => !idsExistentes.has(a.id));
      return [...prev, ...novos];
    });
  };

  const fecharModalExame = () => {
    setIsExamModalOpen(false);
    setSelectedExamStudents([]);
    setExamSearchQuery('');
    setExamAnoInteiro('');
    setExamSubject('');
    setExamTopics('');
    setExamDate('');
    setExamAlunosComConta(null);
  };

  const handleCreateExam = async () => {
    if (selectedExamStudents.length === 0 || !examSubject || !examDate) {
      showError('Escolhe pelo menos um aluno, a disciplina e a data.');
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;
    if (!centro_id) {
      showError('Não foi possível identificar o centro. Recarrega a página e tenta novamente.');
      return;
    }
    setIsSubmitting(true);
    try {
      const idsSelecionados = selectedExamStudents.map((a) => a.id);
      const topicsFinal = examTopics.trim() || null;

      // Testes já existentes para os mesmos alunos, disciplina e data: atualiza
      // em vez de duplicar. Matéria conta como valor a substituir, não como
      // parte da chave — só disciplina + dia decidem se é "o mesmo teste".
      const { data: existentes, error: errExistentes } = await supabase
        .from('exams')
        .select('id, aluno_id')
        .eq('centro_id', centro_id)
        .eq('subject_name', examSubject)
        .eq('date', examDate)
        .in('aluno_id', idsSelecionados);

      if (errExistentes) {
        showError('Erro ao verificar testes existentes: ' + errExistentes.message);
        return;
      }

      const existenteIdPorAluno = new Map((existentes || []).map((e) => [e.aluno_id, e.id]));

      // Cada aluno é uma operação independente (insert ou update). Isto é
      // deliberado: um aluno sem conta de Auth (exams.aluno_id exige uma —
      // ver verificar-alunos-auth) nunca deve derrubar o lote inteiro, só a
      // linha dele falha. O picker (Fase 2) já os esconde, mas isto continua
      // a proteger contra qualquer falha individual imprevista.
      const resultados = await Promise.allSettled(
        selectedExamStudents.map(async (aluno) => {
          const existenteId = existenteIdPorAluno.get(aluno.id);
          if (existenteId) {
            const { error } = await supabase
              .from('exams')
              .update({ subject_name: examSubject, topics: topicsFinal, date: examDate })
              .eq('id', existenteId);
            if (error) throw new Error(error.message);
            return 'atualizado' as const;
          }
          const { error } = await supabase.from('exams').insert({
            aluno_id: aluno.id,
            subject_name: examSubject,
            topics: topicsFinal,
            date: examDate,
            centro_id,
          });
          if (error) throw new Error(error.message);
          return 'criado' as const;
        })
      );

      let criados = 0;
      let atualizados = 0;
      const falhas: string[] = [];
      resultados.forEach((resultado, i) => {
        if (resultado.status === 'fulfilled') {
          if (resultado.value === 'criado') criados++;
          else atualizados++;
        } else {
          falhas.push(selectedExamStudents[i].nome);
        }
      });

      const partesSucesso: string[] = [];
      if (criados > 0) partesSucesso.push(`${criados} novo(s)`);
      if (atualizados > 0) partesSucesso.push(`${atualizados} atualizado(s)`);

      if (falhas.length === 0) {
        showSuccess(`Teste agendado: ${partesSucesso.join(', ')}.`);
        fecharModalExame();
      } else {
        const prefixo = partesSucesso.length > 0 ? `${partesSucesso.join(', ')}; ` : '';
        showError(`${prefixo}${falhas.length} falharam (${falhas.join(', ')}) — provavelmente sem conta de acesso associada.`);
      }
      fetchDados();
    } finally {
      setIsSubmitting(false);
    }
  };

  const diaSemanaAtual = new Date().getDay();
  const checkinsAtivosIds = new Set(presencas.filter(p => p.status === 'validado').map(p => p.aluno_id));
  // Restrição por ano: se a disciplina escolhida tiver anos definidos, esconde
  // os alunos cujo ano_escolar não está na lista (incluindo alunos sem ano).
  const anoPermitido = (ano?: number | null) => {
    const aa = selectedSubject?.anos_aplicaveis;
    return !aa || aa.length === 0 || (ano != null && aa.includes(ano));
  };
  const alunosFiltrados = alunos.filter(a => a.nome.toLowerCase().includes(searchQuery.toLowerCase()) && anoPermitido(a.ano_escolar));
  const alunosDoDia = alunosFiltrados.filter(a => a.aluno_horarios?.some((h: any) => h.dia_semana === diaSemanaAtual));
  const outrosAlunos = alunosFiltrados.filter(a => !a.aluno_horarios?.some((h: any) => h.dia_semana === diaSemanaAtual));
  const alunosFiltradosExame = alunos.filter(a =>
    a.ativo !== false &&
    a.nome.toLowerCase().includes(examSearchQuery.toLowerCase()) &&
    (examAlunosComConta === null || examAlunosComConta.has(a.id))
  );
  // Disciplinas comuns a todos os anos dos alunos selecionados — sem alunos
  // selecionados ainda, mostra tudo (nada para restringir).
  const disciplinasComunsExame = disciplinasComuns(subjects, selectedExamStudents.map((a) => a.ano_escolar));
  const semDisciplinaComum = selectedExamStudents.length > 0 && disciplinasComunsExame.length === 0;

  // Se a seleção de alunos mudar e a disciplina já escolhida deixar de ser
  // comum a todos, reinicia — nunca deixa confirmar um teste inválido para
  // algum dos alunos selecionados.
  useEffect(() => {
    if (examSubject && !disciplinasComunsExame.some((s: any) => s.name === examSubject)) {
      setExamSubject('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExamStudents]);

  const renderAlunoCheckinRow = (aluno: any) => {
    const isValidUrl = aluno.avatar_url && (aluno.avatar_url.startsWith('http://') || aluno.avatar_url.startsWith('https://'));
    const jaPresente = checkinsAtivosIds.has(aluno.id);
    const aProcessar = alunosEmCheckin.has(aluno.id);
    return (
      <div key={aluno.id} className="w-full p-3 bg-page/50 border border-border rounded-2xl flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-raised flex items-center justify-center font-black text-success shrink-0">
          {isValidUrl ? <img src={aluno.avatar_url} alt={aluno.nome} className="w-full h-full object-cover rounded-xl" /> : aluno.nome.charAt(0)}
        </div>
        <p className="font-bold text-sm flex-1 truncate">{aluno.nome}</p>
        <button
          disabled={jaPresente || aProcessar || !selectedSubject}
          onClick={() => handleManualCheckIn(aluno)}
          className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shrink-0 disabled:opacity-40 ${jaPresente ? 'bg-success text-on-success' : 'bg-accent-soft text-accent hover:bg-accent hover:text-on-accent'}`}
        >
          {aProcessar ? <Loader2 className="animate-spin" size={14} /> : jaPresente ? 'Presente' : 'Check-in'}
        </button>
      </div>
    );
  };

  const salasStatus = salas.map(sala => {
    const count = presencas.filter(p => p.sala_id === sala.id).length;
    const percentage = sala.capacidade > 0 ? (count / sala.capacidade) * 100 : 0;
    return { ...sala, count, percentage };
  });

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;

  return (
    <main className={`min-h-screen bg-page p-4 md:p-8 text-primary font-sans relative transition-all ${isSubmitting ? 'pointer-events-none opacity-60' : ''}`}>
      
      {errorMsg && (
        <div className="bg-warning-bg border border-warning/20 p-4 rounded-2xl mb-6 text-warning text-[10px] font-black flex items-center gap-2">
            <AlertTriangle size={16} /> {errorMsg}
        </div>
      )}

      <header className="mb-10 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl md:text-3xl font-black italic uppercase tracking-tighter">Dashboard</h1>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
          <button onClick={() => setIsModalOpen(true)} className="bg-accent hover:bg-accent-hover text-on-accent px-6 py-3 rounded-2xl font-black flex items-center gap-2 shadow-lg shadow-accent/20 transition-all active:scale-95">
            <UserPlus size={20} /> ENTRADA MANUAL
          </button>

          {presencas.length > 0 && (
            <button disabled={isSubmitting} onClick={() => safeAction(handleMassCheckout)} className="bg-danger-bg hover:bg-danger text-danger hover:text-on-danger px-5 py-3 rounded-2xl font-black flex items-center gap-2 border border-danger/30 transition-all active:scale-95 disabled:opacity-50">
              <LogOut size={18} /> CHECKOUT TOTAL
            </button>
          )}

          <Link href="/admin/salas" className="bg-surface hover:bg-raised text-secondary px-5 py-3 rounded-2xl font-black flex items-center gap-2 border border-border transition-all active:scale-95">
            <MapPin size={18} /> GESTÃO DE SALAS
          </Link>

          <button onClick={fetchDados} className="p-3 bg-surface rounded-xl border border-border hover:text-accent transition-all">
            <RefreshCw size={20} />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between px-2">
            <h2 className="flex items-center gap-2 text-secondary font-black uppercase text-xs tracking-widest">
              <Clock size={14} /> Monitorização de Sala
            </h2>
            <span className="text-[10px] text-success font-bold uppercase animate-pulse">● Ao Vivo</span>
          </div>

          {presencas.length === 0 ? (
            <div className="bg-surface/70 border-2 border-dashed border-border p-20 rounded-[2.5rem] text-center italic opacity-50">
              Aguardando check-ins...
            </div>
          ) : (
            presencas.map((p) => {
              const aluno = Array.isArray(p.alunos) ? p.alunos[0] : p.alunos;
              const diaAtual = new Date().getDay(); 
              const diaContratado = aluno?.aluno_horarios?.some((h: any) => h.dia_semana === diaAtual);
              const estaValidado = p.status === 'validado';
              const nomeSala = salas.find(s => s.id === p.sala_id)?.nome || 'Sem Sala';
              const corBase = !diaContratado ? 'bg-danger' : (estaValidado ? 'bg-success' : 'bg-accent');

              return (
                <div key={p.id} className={`bg-surface border ${!diaContratado ? 'border-danger' : (estaValidado ? 'border-success/40' : 'border-border')} p-5 rounded-3xl flex flex-col md:flex-row items-center justify-between transition-all gap-4`}>
                  <div className="flex items-center gap-4 w-full md:w-auto">
                  <div className={`w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center text-xl font-black border border-border/50 ${corBase} ${!diaContratado ? 'text-on-danger' : (estaValidado ? 'text-on-success' : 'text-on-accent')}`}>
                    {aluno?.avatar_url && (aluno.avatar_url.startsWith('http://') || aluno.avatar_url.startsWith('https://')) ? <img src={aluno.avatar_url} alt={aluno?.nome} className="w-full h-full object-cover rounded-2xl" /> : aluno?.nome?.charAt(0)}
                  </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-black">{aluno?.nome}</h3>
                        {!diaContratado && <span className="bg-danger text-on-danger text-[8px] px-2 py-0.5 rounded-full font-black uppercase">Fora de Horário</span>}
                      </div>
                      <p className="text-xs text-muted font-medium">
                        {p.subject_name || 'Sessão Livre'} • <span className="capitalize">{nomeSala}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:gap-4 w-full md:w-auto justify-between sm:justify-start">
                    <div className="text-right mr-2">
                      <p className="text-accent font-mono font-bold text-lg">
                        {new Date(p.entrada).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 bg-page p-1.5 rounded-2xl border border-border">
                        <button disabled={isSubmitting} onClick={() => safeAction(() => handleValidarEntrada(p.id))} className={`${estaValidado ? 'bg-success text-on-success' : 'bg-success-bg text-success'} p-2.5 rounded-xl transition-all min-w-14 disabled:opacity-50`}>
                          {isSubmitting && !estaValidado ? <Loader2 className="animate-spin mx-auto" size={16} /> : <CheckCircle2 size={16} className="mx-auto" />}
                          <span className="text-[8px] font-black block mt-1 uppercase">{estaValidado ? 'Aceite' : 'Aceitar'}</span>
                        </button>
                        <button disabled={isSubmitting} onClick={() => safeAction(() => handleWhatsApp(p.id, aluno?.telefone_encarregado, aluno?.nome, 'entrada'))} className={`${p.msg_in_enviada ? 'bg-accent text-on-accent shadow-[0_0_10px_rgba(37,99,235,0.3)]' : 'bg-accent-soft text-accent'} p-2.5 rounded-xl transition-all min-w-14 relative disabled:opacity-50`}>
                          <MessageCircle size={16} className="mx-auto" />
                          <span className="text-[8px] font-black block mt-1 uppercase">{p.msg_in_enviada ? 'Enviada' : 'Msg In'}</span>
                          {p.msg_in_enviada && <CheckCircle2 size={10} className="absolute top-1 right-1" />}
                        </button>
                        <button disabled={isSubmitting} onClick={() => safeAction(() => handleWhatsApp(p.id, aluno?.telefone_encarregado, aluno?.nome, 'saida'))} className={`${p.msg_out_enviada ? 'bg-purple-600 text-on-accent shadow-[0_0_10px_rgba(147,51,234,0.3)]' : 'bg-purple-500/10 text-purple-500'} p-2.5 rounded-xl transition-all min-w-14 relative disabled:opacity-50`}>
                          <MessageCircle size={16} className="mx-auto" />
                          <span className="text-[8px] font-black block mt-1 uppercase">{p.msg_out_enviada ? 'Enviada' : 'Msg Out'}</span>
                          {p.msg_out_enviada && <CheckCircle2 size={10} className="absolute top-1 right-1" />}
                        </button>
                        <button disabled={isSubmitting} onClick={() => safeAction(() => handleRejeitarEntrada(p.id))} className="bg-raised text-secondary hover:bg-danger hover:text-on-danger p-2.5 rounded-xl transition-all disabled:opacity-50">
                          {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <LogOut size={16} />}
                        </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-accent p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
            <Users size={80} className="absolute top-0 right-0 p-4 opacity-10" />
            <p className="text-on-accent font-bold uppercase text-[10px] tracking-widest relative z-10">Total no Centro</p>
            <h4 className="text-7xl font-black mt-2 relative z-10 text-on-accent">{presencas.length}</h4>
          </div>
          
          <div className="bg-surface border border-border p-8 rounded-[2.5rem]">
            <h4 className="font-black text-sm uppercase text-muted mb-6 flex items-center gap-2">
              <MapPin size={16} className="text-accent" /> Lotação das Salas
            </h4>
            <div className="space-y-5">
              {salasStatus.map(sala => (
                <div key={sala.id} className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-bold">
                    <span className="capitalize">{sala.nome}</span>
                    <span className="text-secondary">{sala.count} / {sala.capacidade}</span>
                  </div>
                  <div className="w-full bg-page rounded-full h-1.5 overflow-hidden">
                    <div className="h-full bg-accent transition-all duration-1000" style={{ width: `${sala.percentage}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface border border-border p-8 rounded-[2.5rem]">
            <h4 className="font-black text-sm uppercase text-muted mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2"><AlertTriangle size={16} className="text-warning" /> Próximos Testes</div>
              <button onClick={() => setIsExamModalOpen(true)} className="p-1 bg-raised hover:bg-warning-bg hover:text-warning rounded-md transition-all">
                <Plus size={16} />
              </button>
            </h4>
            <div className="space-y-4">
              {proximosTestes.map(ex => (
                <div key={ex.id} className="border-l-2 border-warning/50 pl-4 py-1">
                  <p className="text-xs font-bold text-primary">{ex.alunos?.nome}</p>
                  <p className="text-[10px] text-muted uppercase font-black">Teste de {ex.subject_name} • {new Date(ex.date).toLocaleDateString('pt-PT')}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* --- MODAIS --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-page/80 backdrop-blur-sm">
          <div className="bg-surface border border-border w-full max-w-lg rounded-[2.5rem] shadow-3xl p-6 animate-in zoom-in duration-200 max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-black uppercase italic">Check-in Manual</h3>
              <button onClick={handleCloseCheckinModal}><X size={20}/></button>
            </div>

            <select
              value={selectedSubject?.id || ''}
              onChange={(e) => setSelectedSubject(subjects.find(s => String(s.id) === e.target.value) || null)}
              className="w-full bg-page border border-border p-4 rounded-2xl outline-none font-bold text-primary mb-3"
            >
              <option value="">Disciplina...</option>
              {subjects.map(sub => (<option key={sub.id} value={sub.id}>{sub.name}</option>))}
            </select>

            <div className="relative mb-4">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
              <input autoFocus placeholder="Procurar aluno..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-page border border-border p-4 pl-12 rounded-2xl outline-none focus:border-success transition-all font-bold" />
            </div>

            <div className="overflow-y-auto space-y-5 flex-1">
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase text-muted tracking-widest px-1">Alunos do dia</p>
                {alunosDoDia.length === 0 ? (
                  <p className="text-xs text-muted italic px-1">Nenhum aluno com aulas hoje.</p>
                ) : alunosDoDia.map(renderAlunoCheckinRow)}
              </div>

              <div className="space-y-2">
                <button onClick={() => setMostrarOutros(v => !v)} className="w-full flex items-center justify-between px-1 py-2 text-[10px] font-black uppercase text-muted tracking-widest">
                  <span>Outros alunos ({outrosAlunos.length})</span>
                  {mostrarOutros ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {mostrarOutros && outrosAlunos.map(renderAlunoCheckinRow)}
              </div>
            </div>
          </div>

          {toastCheckin && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-surface border border-success/40 rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-4 animate-in slide-in-from-bottom duration-200">
              <p className="text-sm font-bold text-success flex items-center gap-1.5"><CheckCircle2 size={16} className="shrink-0" /> {toastCheckin.nome} — {toastCheckin.disciplina}</p>
              <button onClick={() => handleUndoCheckin(toastCheckin.registoId)} className="flex items-center gap-1 text-[10px] font-black uppercase text-secondary hover:text-primary transition-all shrink-0">
                <Undo2 size={14} /> Desfazer
              </button>
            </div>
          )}
        </div>
      )}

      {isExamModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-page/80 backdrop-blur-sm">
          <div className="bg-surface border border-border w-full max-w-lg rounded-[2.5rem] shadow-3xl p-6 animate-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6"><h3 className="text-xl font-black uppercase italic">Agendar Teste</h3><button onClick={fecharModalExame}><X size={20}/></button></div>

            <div className="space-y-4">
              {/* ATALHO: ADICIONAR ANO ESCOLAR INTEIRO */}
              <div className="flex items-center gap-2">
                <select value={examAnoInteiro} onChange={(e) => setExamAnoInteiro(e.target.value)} className="flex-1 bg-page border border-border p-3 rounded-xl text-sm font-bold outline-none text-primary">
                  <option value="">Ano escolar...</option>
                  {[...Array(12)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}º Ano</option>)}
                </select>
                <button type="button" onClick={handleAdicionarAnoInteiro} disabled={!examAnoInteiro || examAlunosComConta === null} className="px-4 py-3 bg-warning-bg text-warning font-black text-[11px] uppercase tracking-widest rounded-xl disabled:opacity-40 whitespace-nowrap">
                  Adicionar ano inteiro
                </button>
              </div>

              {/* PESQUISA + CHECKLIST DE ALUNOS */}
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
                <input autoFocus placeholder="Pesquisar aluno..." value={examSearchQuery} onChange={(e) => setExamSearchQuery(e.target.value)} className="w-full bg-page border border-border p-4 pl-12 rounded-2xl outline-none focus:border-warning font-bold" />
              </div>
              <div className="max-h-48 overflow-y-auto space-y-2 border border-border rounded-2xl p-2">
                {examAlunosComConta === null ? (
                  <p className="text-xs text-muted italic text-center py-4">A verificar contas de acesso...</p>
                ) : alunosFiltradosExame.length === 0 ? (
                  <p className="text-xs text-muted italic text-center py-4">Nenhum aluno encontrado.</p>
                ) : (
                  alunosFiltradosExame.map((aluno) => {
                    const selecionado = selectedExamStudents.some((s) => s.id === aluno.id);
                    return (
                      <button
                        key={aluno.id}
                        type="button"
                        onClick={() => toggleExamStudent(aluno)}
                        className={`w-full p-3 rounded-xl flex items-center gap-3 transition-all ${selecionado ? 'bg-warning-bg border border-warning/40' : 'bg-page/50 border border-transparent hover:border-warning/30'}`}
                      >
                        <div className="w-9 h-9 rounded-xl bg-raised flex items-center justify-center font-black text-warning text-sm shrink-0">
                          {(aluno.avatar_url && (aluno.avatar_url.startsWith('http://') || aluno.avatar_url.startsWith('https://'))) ? <img src={aluno.avatar_url} alt={aluno.nome} className="w-full h-full object-cover rounded-xl" /> : aluno.nome.charAt(0)}
                        </div>
                        <p className="font-bold text-sm text-left flex-1">{aluno.nome}</p>
                        <span className="text-[10px] font-black text-muted shrink-0">{aluno.ano_escolar}º</span>
                        {selecionado && <CheckCircle2 size={16} className="text-warning shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
              {selectedExamStudents.length > 0 && (
                <p className="text-xs font-black text-warning uppercase">{selectedExamStudents.length} aluno(s) selecionado(s)</p>
              )}

              <select value={examSubject} onChange={(e) => setExamSubject(e.target.value)} disabled={semDisciplinaComum} className="w-full bg-page border border-border p-4 rounded-2xl outline-none font-bold text-primary disabled:opacity-50">
                <option value="">Disciplina...</option>
                {disciplinasComunsExame.map(sub => (<option key={sub.id} value={sub.name}>{sub.name}</option>))}
              </select>
              {semDisciplinaComum && (
                <p className="text-danger text-xs font-bold bg-danger-bg border border-danger/20 px-4 py-3 rounded-xl">
                  Os alunos selecionados não têm disciplinas em comum — escolhe alunos do mesmo ano.
                </p>
              )}

              <textarea
                value={examTopics}
                onChange={(e) => setExamTopics(e.target.value)}
                placeholder="Matéria (opcional)"
                rows={2}
                className="w-full bg-page border border-border p-4 rounded-2xl outline-none font-bold text-primary resize-none"
              />

              <div className="relative">
                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="w-full bg-page border border-border p-4 pl-12 rounded-2xl outline-none font-bold text-primary"
                />
              </div>
            </div>

            <button
              onClick={handleCreateExam}
              disabled={isSubmitting || selectedExamStudents.length === 0 || !examDate || !examSubject || semDisciplinaComum}
              className="w-full mt-6 bg-accent hover:bg-accent-hover text-on-accent p-5 rounded-2xl font-black disabled:opacity-50"
            >
              CONFIRMAR AGENDAMENTO{selectedExamStudents.length > 1 ? ` (${selectedExamStudents.length} alunos)` : ''}
            </button>
          </div>
        </div>
      )}

      <StatusToast toast={toast} offset />
    </main>
      );
}