'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getHojeLisboa, diaSemanaLisboa, dataLisboaDe, instanteLisboaParaUTC } from '@/lib/dataLisboa';
import { urlWhatsApp, marcarMensagemEnviada } from '@/lib/whatsapp';
import {
  Search, X, Plus, Undo2, MessageCircle, CheckCircle2, Loader2, AlertTriangle, Clock,
} from 'lucide-react';

type Props = {
  alunos: any[];
  subjects: any[];
  presencasAbertas: any[]; // todas as sessões com saida IS NULL, qualquer dia (= `presencas` do Dashboard)
  diarioHoje: any[]; // todas as linhas de diario_bordo de hoje (Europe/Lisbon), qualquer status/saida
  isSubmitting: boolean;
  fetchDados: () => void;
  showError: (mensagem: string) => void;
  showSuccess: (mensagem: string) => void;
  handleWhatsApp: (presencaId: string, telefone: string, nome: string, tipo: 'entrada' | 'saida') => Promise<void>;
  handleDarSaida: (presencaId: string) => Promise<boolean>;
  handleRejeitarEntrada: (presencaId: string) => Promise<void>;
};

type Estado = 'esperado' | 'por_validar' | 'chegou' | 'saiu';

type Linha = {
  aluno: any;
  linhaHoje: any | null;
  antiga: any | null; // sessão aberta de um dia anterior, se existir
  estado: Estado;
  temHorarioHoje: boolean;
};

const CHAVE_DISCIPLINA = 'listaDoDia.disciplinaId';
const CHAVE_WHATSAPP_AO_TOCAR = 'listaDoDia.whatsappAoTocar';

export default function ListaDoDiaPresencas({
  alunos,
  subjects,
  presencasAbertas,
  diarioHoje,
  isSubmitting,
  fetchDados,
  showError,
  showSuccess,
  handleWhatsApp,
  handleDarSaida,
  handleRejeitarEntrada,
}: Props) {
  const [disciplinaEscolhidaId, setDisciplinaEscolhidaId] = useState('');
  const [whatsappAoTocar, setWhatsappAoTocar] = useState(false);
  const [processando, setProcessando] = useState<Set<string>>(new Set());

  const [mostrarForaLista, setMostrarForaLista] = useState(false);
  const [pesquisaForaLista, setPesquisaForaLista] = useState('');

  const [fechandoSessao, setFechandoSessao] = useState<{ presencaId: string; nome: string; entrada: string } | null>(null);
  const [horaFechar, setHoraFechar] = useState('');
  const [erroFechar, setErroFechar] = useState<string | null>(null);
  const [aFecharSessao, setAFecharSessao] = useState(false);

  // Preferências por dispositivo (nunca sincronizadas com a BD) — lidas só no
  // cliente, depois do primeiro render, para não desalinhar com o SSR.
  useEffect(() => {
    try {
      const disciplinaGuardada = localStorage.getItem(CHAVE_DISCIPLINA);
      if (disciplinaGuardada) setDisciplinaEscolhidaId(disciplinaGuardada);
      setWhatsappAoTocar(localStorage.getItem(CHAVE_WHATSAPP_AO_TOCAR) === '1');
    } catch { /* localStorage indisponível — fica nos valores por omissão */ }
  }, []);

  const guardarDisciplinaEscolhida = (id: string) => {
    setDisciplinaEscolhidaId(id);
    try { localStorage.setItem(CHAVE_DISCIPLINA, id); } catch { /* ignora */ }
  };

  const alternarWhatsappAoTocar = () => {
    const novoValor = !whatsappAoTocar;
    setWhatsappAoTocar(novoValor);
    try { localStorage.setItem(CHAVE_WHATSAPP_AO_TOCAR, novoValor ? '1' : '0'); } catch { /* ignora */ }
  };

  const hoje = getHojeLisboa();
  const diaSemanaHoje = diaSemanaLisboa();

  const diarioHojePorAluno = useMemo(() => {
    const mapa = new Map<string, any>();
    for (const linha of diarioHoje) {
      const atual = mapa.get(linha.aluno_id);
      if (!atual || new Date(linha.entrada).getTime() > new Date(atual.entrada).getTime()) {
        mapa.set(linha.aluno_id, linha);
      }
    }
    return mapa;
  }, [diarioHoje]);

  const sessoesAntigasPorAluno = useMemo(() => {
    const mapa = new Map<string, any>();
    for (const p of presencasAbertas) {
      if (dataLisboaDe(p.entrada) !== hoje && !mapa.has(p.aluno_id)) {
        mapa.set(p.aluno_id, p);
      }
    }
    return mapa;
  }, [presencasAbertas, hoje]);

  const linhas: Linha[] = useMemo(() => {
    const alunosAtivos = alunos.filter((a) => a.ativo !== false);
    const porId = new Map(alunos.map((a) => [a.id, a]));

    const idsEsperados = new Set(
      alunosAtivos
        .filter((a) => (a.sala_estudo ?? true) && a.aluno_horarios?.some((h: any) => h.dia_semana === diaSemanaHoje))
        .map((a) => a.id)
    );

    const idsUniao = new Set<string>([...idsEsperados, ...diarioHojePorAluno.keys(), ...sessoesAntigasPorAluno.keys()]);

    const resultado: Linha[] = [];
    for (const id of idsUniao) {
      const aluno = porId.get(id);
      if (!aluno) continue; // aluno apagado entretanto — não há ficha para mostrar
      const linhaHoje = diarioHojePorAluno.get(id) || null;
      const antiga = sessoesAntigasPorAluno.get(id) || null;
      const temHorarioHoje = !!aluno.aluno_horarios?.some((h: any) => h.dia_semana === diaSemanaHoje);
      let estado: Estado;
      if (!linhaHoje) estado = 'esperado';
      else if (linhaHoje.saida) estado = 'saiu';
      else if (linhaHoje.status === 'validado') estado = 'chegou';
      else estado = 'por_validar';
      resultado.push({ aluno, linhaHoje, antiga, estado, temHorarioHoje });
    }

    const prioridade: Record<Estado, number> = { por_validar: 0, chegou: 1, esperado: 2, saiu: 3 };
    resultado.sort((a, b) => prioridade[a.estado] - prioridade[b.estado] || a.aluno.nome.localeCompare(b.aluno.nome));
    return resultado;
  }, [alunos, diarioHojePorAluno, sessoesAntigasPorAluno, diaSemanaHoje]);

  const contagens = useMemo(() => {
    let esperados = 0, naSala = 0, saiu = 0;
    for (const l of linhas) {
      if (l.estado === 'esperado') esperados++;
      else if (l.estado === 'saiu') saiu++;
      else naSala++;
    }
    return { esperados, naSala, saiu };
  }, [linhas]);

  const disciplinaEscolhida = disciplinaEscolhidaId ? subjects.find((s) => String(s.id) === disciplinaEscolhidaId) : null;

  const marcar = (id: string) => setProcessando((prev) => new Set(prev).add(id));
  const desmarcar = (id: string) => setProcessando((prev) => { const n = new Set(prev); n.delete(id); return n; });

  // Cria uma chegada por toque (Esperado -&gt; Chegou, ou Saiu -&gt; nova chegada).
  // Devolve o id da linha criada, ou null em erro.
  const criarChegada = async (aluno: any): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;
    if (!centro_id || !user) {
      showError('Não foi possível identificar o centro. Recarrega a página.');
      return null;
    }
    const { data, error } = await supabase
      .from('diario_bordo')
      .insert({
        aluno_id: aluno.id,
        subject_id: disciplinaEscolhida?.id ?? null,
        subject_name: disciplinaEscolhida?.name ?? null,
        sala_id: disciplinaEscolhida?.sala_id ?? null,
        entrada: new Date().toISOString(),
        status: 'validado',
        verified_at: new Date().toISOString(),
        verified_by: user.id,
        centro_id,
      })
      .select('id')
      .single();
    if (error) {
      showError('Erro ao marcar chegada: ' + error.message);
      return null;
    }
    return data.id as string;
  };

  // Valida (Por validar -&gt; Chegou) com registo de autor. Usado só aqui — o
  // "Aceitar" do modo individual (handleValidarEntrada) fica intocado.
  const validarComAutor = async (presencaId: string): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      showError('Sessão expirada — recarrega a página.');
      return false;
    }
    const { error } = await supabase
      .from('diario_bordo')
      .update({ status: 'validado', verified_at: new Date().toISOString(), verified_by: user.id })
      .eq('id', presencaId);
    if (error) {
      showError('Erro ao validar entrada: ' + error.message);
      return false;
    }
    return true;
  };

  const abrirJanelaSeNecessario = (temTelefone: boolean): Window | null => {
    if (!whatsappAoTocar || !temTelefone) return null;
    return window.open('about:blank', '_blank');
  };

  const concluirWhatsApp = async (win: Window | null, telefone: string | null, nome: string, tipo: 'entrada' | 'saida', presencaId: string | null) => {
    if (!win) return;
    if (!telefone || !presencaId) { win.close(); return; }
    win.location.href = urlWhatsApp(telefone, nome, tipo);
    const erro = await marcarMensagemEnviada(supabase, presencaId, tipo);
    if (erro) showError('Erro ao registar envio de mensagem: ' + erro);
  };

  const handleTocarLinha = async (item: Linha) => {
    if (processando.has(item.aluno.id) || isSubmitting) return;
    const telefone: string | null = item.aluno.telefone_encarregado || null;
    marcar(item.aluno.id);
    try {
      if (item.estado === 'esperado' || item.estado === 'saiu') {
        if (whatsappAoTocar && !telefone) {
          showError(`${item.aluno.nome} não tem número de encarregado — a chegada fica marcada, sem mensagem.`);
        }
        const win = abrirJanelaSeNecessario(!!telefone);
        const novoId = await criarChegada(item.aluno);
        if (novoId) {
          fetchDados();
          await concluirWhatsApp(win, telefone, item.aluno.nome, 'entrada', novoId);
        } else if (win) {
          win.close();
        }
      } else if (item.estado === 'por_validar' && item.linhaHoje) {
        if (whatsappAoTocar && !telefone) {
          showError(`${item.aluno.nome} não tem número de encarregado — a validação fica feita, sem mensagem.`);
        }
        const win = abrirJanelaSeNecessario(!!telefone);
        const ok = await validarComAutor(item.linhaHoje.id);
        if (ok) {
          fetchDados();
          await concluirWhatsApp(win, telefone, item.aluno.nome, 'entrada', item.linhaHoje.id);
        } else if (win) {
          win.close();
        }
      } else if (item.estado === 'chegou' && item.linhaHoje) {
        const win = abrirJanelaSeNecessario(whatsappAoTocar && !!telefone);
        const ok = await handleDarSaida(item.linhaHoje.id);
        if (ok) {
          await concluirWhatsApp(win, telefone, item.aluno.nome, 'saida', item.linhaHoje.id);
        } else if (win) {
          win.close();
        }
      }
    } finally {
      desmarcar(item.aluno.id);
    }
  };

  const handleDesfazer = async (item: Linha, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.linhaHoje) return;
    if (processando.has(item.aluno.id)) return;
    marcar(item.aluno.id);
    try {
      if (item.estado === 'chegou') {
        // Distingue quem criou a chegada: se o próprio aluno fez o check-in e
        // o staff só validou mais tarde (verified_at bem depois da entrada),
        // "Desfazer" não pode apagar o check-in do aluno — só desfaz a
        // validação, voltando a "Por validar". Só apaga a linha quando foi
        // mesmo o toque do staff a criá-la (verified_at ~ entrada).
        const entradaMs = new Date(item.linhaHoje.entrada).getTime();
        const verificadoMs = item.linhaHoje.verified_at ? new Date(item.linhaHoje.verified_at).getTime() : null;
        const foiValidacaoDeAutoCheckin = verificadoMs === null || verificadoMs - entradaMs > 30_000;

        if (foiValidacaoDeAutoCheckin) {
          const { error } = await supabase
            .from('diario_bordo')
            .update({ status: 'present', verified_at: null, verified_by: null })
            .eq('id', item.linhaHoje.id);
          if (error) showError('Erro ao desfazer: ' + error.message);
          else fetchDados();
        } else {
          const minutosDesdeEntrada = (Date.now() - entradaMs) / 60_000;
          if (minutosDesdeEntrada >= 3) {
            const minutos = Math.round(minutosDesdeEntrada);
            if (!confirm(`Apagar a presença de ${item.aluno.nome}? Esta sessão, com ${minutos} min de estudo, deixa de contar nos relatórios.`)) {
              return;
            }
          }
          const { error } = await supabase.from('diario_bordo').delete().eq('id', item.linhaHoje.id);
          if (error) showError('Erro ao desfazer: ' + error.message);
          else fetchDados();
        }
      } else if (item.estado === 'saiu') {
        const { error } = await supabase.from('diario_bordo').update({ saida: null }).eq('id', item.linhaHoje.id);
        if (error) showError('Erro ao desfazer: ' + error.message);
        else fetchDados();
      } else if (item.estado === 'por_validar') {
        await handleRejeitarEntrada(item.linhaHoje.id);
      }
    } finally {
      desmarcar(item.aluno.id);
    }
  };

  const abrirFecharSessao = (item: Linha, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.antiga) return;
    setFechandoSessao({ presencaId: item.antiga.id, nome: item.aluno.nome, entrada: item.antiga.entrada });
    setHoraFechar('');
    setErroFechar(null);
  };

  const confirmarFecharSessao = async () => {
    if (!fechandoSessao) return;
    if (!horaFechar) { setErroFechar('Escolhe a hora de saída.'); return; }
    const diaEntrada = dataLisboaDe(fechandoSessao.entrada);
    const saidaISO = instanteLisboaParaUTC(diaEntrada, horaFechar);
    if (new Date(saidaISO).getTime() <= new Date(fechandoSessao.entrada).getTime()) {
      setErroFechar('A hora de saída tem de ser depois da hora de entrada.');
      return;
    }
    setAFecharSessao(true);
    const { error } = await supabase.from('diario_bordo').update({ saida: saidaISO }).eq('id', fechandoSessao.presencaId);
    setAFecharSessao(false);
    if (error) {
      setErroFechar('Erro ao fechar sessão: ' + error.message);
      return;
    }
    showSuccess('Sessão fechada.');
    setFechandoSessao(null);
    fetchDados();
  };

  const alunosForaLista = useMemo(() => {
    const q = pesquisaForaLista.trim().toLowerCase();
    if (!q) return [];
    return alunos.filter((a) => a.ativo !== false && a.nome.toLowerCase().includes(q)).slice(0, 20);
  }, [alunos, pesquisaForaLista]);

  const handleAdicionarForaLista = async (aluno: any) => {
    if (processando.has(aluno.id)) return;
    marcar(aluno.id);
    try {
      const novoId = await criarChegada(aluno);
      if (novoId) {
        showSuccess(`${aluno.nome} — chegada marcada.`);
        fetchDados();
      }
    } finally {
      desmarcar(aluno.id);
    }
  };

  const CORES: Record<Estado, { fundo: string; borda: string; texto: string; rotulo: string }> = {
    esperado: { fundo: 'bg-raised', borda: 'border-border', texto: 'text-muted', rotulo: 'Esperado' },
    por_validar: { fundo: 'bg-warning-bg', borda: 'border-warning/40', texto: 'text-warning', rotulo: 'Por validar' },
    chegou: { fundo: 'bg-success-bg', borda: 'border-success/40', texto: 'text-success', rotulo: 'Chegou' },
    saiu: { fundo: 'bg-blue-500/10', borda: 'border-blue-500/30', texto: 'text-blue-500', rotulo: 'Saiu' },
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-border rounded-3xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <span className="text-[10px] font-black uppercase text-muted tracking-widest shrink-0">
            Esperados {contagens.esperados} · Na sala {contagens.naSala} · Já saíram {contagens.saiu}
          </span>
        </div>
        <select
          value={disciplinaEscolhidaId}
          onChange={(e) => guardarDisciplinaEscolhida(e.target.value)}
          className="bg-page border border-border p-2 rounded-xl outline-none font-bold text-xs text-primary"
        >
          <option value="">Disciplina: nenhuma</option>
          {subjects.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
        </select>
        <label className="flex items-center gap-2 text-[10px] font-black uppercase text-muted tracking-widest cursor-pointer select-none">
          <input type="checkbox" checked={whatsappAoTocar} onChange={alternarWhatsappAoTocar} className="accent-accent w-4 h-4" />
          Abrir o WhatsApp ao tocar
        </label>
        <button
          type="button"
          onClick={() => setMostrarForaLista((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 bg-accent-soft text-accent rounded-xl text-[10px] font-black uppercase tracking-widest"
        >
          <Plus size={14} /> Aluno fora da lista
        </button>
      </div>

      {mostrarForaLista && (
        <div className="bg-surface border border-border rounded-3xl p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <input
              autoFocus
              placeholder="Procurar aluno..."
              value={pesquisaForaLista}
              onChange={(e) => setPesquisaForaLista(e.target.value)}
              className="w-full bg-page border border-border p-3 pl-11 rounded-2xl outline-none font-bold text-sm"
            />
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {alunosForaLista.map((aluno) => (
              <div key={aluno.id} className="flex items-center gap-3 p-2.5 bg-page/50 border border-border rounded-xl">
                <p className="font-bold text-sm flex-1 truncate">{aluno.nome}</p>
                <button
                  disabled={processando.has(aluno.id)}
                  onClick={() => handleAdicionarForaLista(aluno)}
                  className="px-3 py-1.5 rounded-lg bg-accent-soft text-accent text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
                >
                  {processando.has(aluno.id) ? <Loader2 className="animate-spin" size={14} /> : 'Adicionar'}
                </button>
              </div>
            ))}
            {pesquisaForaLista.trim() && alunosForaLista.length === 0 && (
              <p className="text-xs text-muted italic px-1">Nenhum aluno encontrado.</p>
            )}
          </div>
        </div>
      )}

      {linhas.length === 0 ? (
        <div className="bg-surface/70 border-2 border-dashed border-border p-20 rounded-[2.5rem] text-center italic opacity-50">
          Sem alunos esperados hoje.
        </div>
      ) : (
        linhas.map((item) => {
          const cor = CORES[item.estado];
          const aProcessar = processando.has(item.aluno.id);
          const temLinhaHoje = !!item.linhaHoje;
          return (
            <div key={item.aluno.id} className="space-y-1.5">
              <div
                role="button"
                tabIndex={aProcessar || isSubmitting ? -1 : 0}
                aria-disabled={aProcessar || isSubmitting}
                onClick={() => { if (!aProcessar && !isSubmitting) handleTocarLinha(item); }}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !aProcessar && !isSubmitting) { e.preventDefault(); handleTocarLinha(item); } }}
                className={`w-full min-h-[54px] bg-surface border ${cor.borda} p-4 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-left transition-all active:scale-[0.99] cursor-pointer ${aProcessar || isSubmitting ? 'opacity-60 pointer-events-none' : ''}`}
              >
                <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
                  <div className={`w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center text-sm font-black ${cor.fundo} ${cor.texto}`}>
                    {aProcessar ? <Loader2 className="animate-spin" size={16} /> : item.aluno.nome.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-black text-sm truncate">{item.aluno.nome}</p>
                      {temLinhaHoje && !item.temHorarioHoje && (
                        <span className="bg-danger text-on-danger text-[8px] px-2 py-0.5 rounded-full font-black uppercase shrink-0">Fora de Horário</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] font-black uppercase tracking-widest ${cor.texto}`}>{cor.rotulo}</span>
                      {temLinhaHoje && item.linhaHoje.entrada && (
                        <span className="text-[10px] font-mono text-muted">
                          {new Date(item.linhaHoje.entrada).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}
                          {item.estado === 'saiu' && item.linhaHoje.saida && (
                            <> → {new Date(item.linhaHoje.saida).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-end shrink-0">
                  {temLinhaHoje && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleWhatsApp(item.linhaHoje.id, item.aluno.telefone_encarregado, item.aluno.nome, 'entrada'); }}
                        disabled={isSubmitting}
                        className={`${item.linhaHoje.msg_in_enviada ? 'bg-accent text-on-accent' : 'bg-accent-soft text-accent'} p-2 rounded-lg text-[9px] font-black uppercase flex items-center gap-1 disabled:opacity-50`}
                      >
                        <MessageCircle size={12} /> {item.linhaHoje.msg_in_enviada ? '✓' : 'Msg In'}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleWhatsApp(item.linhaHoje.id, item.aluno.telefone_encarregado, item.aluno.nome, 'saida'); }}
                        disabled={isSubmitting || item.estado !== 'saiu'}
                        className={`${item.linhaHoje.msg_out_enviada ? 'bg-purple-600 text-on-accent' : 'bg-purple-500/10 text-purple-500'} p-2 rounded-lg text-[9px] font-black uppercase flex items-center gap-1 disabled:opacity-50`}
                      >
                        <MessageCircle size={12} /> {item.linhaHoje.msg_out_enviada ? '✓' : 'Msg Out'}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDesfazer(item, e)}
                        disabled={aProcessar}
                        className="p-2 rounded-lg bg-raised text-secondary text-[9px] font-black uppercase flex items-center gap-1 disabled:opacity-50"
                      >
                        <Undo2 size={12} /> Desfazer
                      </button>
                    </>
                  )}
                </div>
              </div>

              {item.antiga && (
                <div className="ml-2 flex items-center gap-3 bg-warning-bg border border-warning/30 rounded-2xl px-4 py-2.5">
                  <AlertTriangle size={14} className="text-warning shrink-0" />
                  <p className="text-[11px] font-bold text-warning flex-1">
                    Ficou aberta desde {new Date(item.antiga.entrada).toLocaleDateString('pt-PT')}
                  </p>
                  <button
                    type="button"
                    onClick={(e) => abrirFecharSessao(item, e)}
                    className="shrink-0 px-3 py-1.5 bg-warning text-on-warning rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center gap-1"
                  >
                    <Clock size={12} /> Fechar sessão
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {fechandoSessao && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-page/80 backdrop-blur-sm">
          <div className="bg-surface border border-border w-full max-w-sm rounded-[2rem] shadow-3xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-black uppercase italic">Fechar sessão</h3>
              <button onClick={() => setFechandoSessao(null)}><X size={20} /></button>
            </div>
            <p className="text-sm text-secondary mb-1">{fechandoSessao.nome}</p>
            <p className="text-[10px] text-muted font-bold uppercase mb-4">
              Entrada: {new Date(fechandoSessao.entrada).toLocaleString('pt-PT')}
            </p>
            <label className="text-[10px] font-black text-muted uppercase ml-1">Hora de saída</label>
            <input
              type="time"
              value={horaFechar}
              onChange={(e) => setHoraFechar(e.target.value)}
              className="w-full bg-page border border-border p-3 rounded-2xl outline-none font-bold text-primary mt-1 mb-3"
            />
            {erroFechar && <p className="text-danger text-[11px] font-bold mb-3">{erroFechar}</p>}
            <button
              onClick={confirmarFecharSessao}
              disabled={aFecharSessao}
              className="w-full bg-warning hover:bg-warning-hover text-on-warning p-4 rounded-2xl font-black flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {aFecharSessao ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
              Confirmar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
