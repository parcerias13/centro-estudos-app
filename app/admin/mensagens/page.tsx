'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { horaOuDataMensagem, comSeparadoresDeDia, sanitizarPedidoExplicacao } from '@/lib/formatoMensagens';
import { avisarMensagensLidas } from '@/lib/eventoMensagensAdmin';
import {
  Loader2, Search, MessageCircle, Send, ArrowLeft, ExternalLink, ChevronUp,
  FileText, HelpCircle, CalendarCheck, CheckCircle2, Clock, XCircle, Check,
} from 'lucide-react';

const DIAS_SEMANA_ROTULO: Record<number, string> = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb', 7: 'Dom' };

type Mensagem = {
  id: string;
  aluno_id: string;
  autor: 'familia' | 'centro';
  autor_id: string | null;
  tipo: 'texto' | 'relatorio_mensal' | 'pedido_explicacao' | 'confirmacao_explicacao';
  texto: string | null;
  payload: any;
  estado: string | null;
  explicacao_id: string | null;
  lida_pela_familia_em: string | null;
  lida_pelo_centro_em: string | null;
  criada_em: string;
};

type Aluno = { id: string; nome: string; ano_escolar: number | null };
type UltimaMensagem = { tipo: Mensagem['tipo']; texto: string | null; criada_em: string };
type ResumoConversa = { aluno: Aluno; ultimaMensagem: UltimaMensagem | null; naoLidas: number };

const TEXTO_MAX = 4000;
const PAGINA = 200;
const LIMITE_RESUMO = 1000;

function ChipPedido({ estado }: { estado: string | null }) {
  const valor = (estado || 'pendente').toLowerCase();
  if (valor === 'marcada') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-success-bg text-success"><CheckCircle2 size={10} /> Marcada</span>;
  }
  if (valor === 'recusada') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-danger-bg text-danger"><XCircle size={10} /> Recusada</span>;
  }
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-warning-bg text-warning"><Clock size={10} /> Pendente</span>;
}

function CartaoMensagem({ msg, nomeAutorCentro }: { msg: Mensagem; nomeAutorCentro: string | null }) {
  const doCentro = msg.autor === 'centro';
  const base = 'max-w-[85%] rounded-2xl p-3 shadow-lg space-y-1.5';
  const estilo = doCentro ? `${base} bg-accent text-on-accent ml-auto` : `${base} bg-surface border border-border text-primary`;

  const rodape = (
    <p className={`text-[9px] font-bold uppercase tracking-widest ${doCentro ? 'text-on-accent/70' : 'text-muted'}`}>
      {doCentro && nomeAutorCentro ? `${nomeAutorCentro} · ` : ''}{horaOuDataMensagem(msg.criada_em)}
    </p>
  );

  if (msg.tipo === 'texto') {
    return (
      <div className={estilo}>
        <p className="text-sm whitespace-pre-wrap break-words">{msg.texto}</p>
        {rodape}
      </div>
    );
  }

  if (msg.tipo === 'relatorio_mensal') {
    const p = msg.payload || {};
    return (
      <div className={estilo}>
        <div className="flex items-center gap-1.5"><FileText size={13} /><p className="font-black text-[10px] uppercase tracking-widest">Relatório Mensal</p></div>
        <div className="text-xs space-y-0.5">
          {p.mes != null && p.ano != null && <p>Período: {String(p.mes).padStart(2, '0')}/{p.ano}</p>}
          {p.horas != null && <p>Horas: {p.horas}</p>}
          {p.sessoes != null && <p>Sessões: {p.sessoes}</p>}
          {p.disciplina_principal && <p>Disciplina: {p.disciplina_principal}</p>}
        </div>
        {rodape}
      </div>
    );
  }

  if (msg.tipo === 'pedido_explicacao') {
    const p = sanitizarPedidoExplicacao(msg.payload);
    return (
      <div className={estilo}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5"><HelpCircle size={13} /><p className="font-black text-[10px] uppercase tracking-widest">Pedido de Explicação</p></div>
          <ChipPedido estado={msg.estado} />
        </div>
        {p.disciplina && <p className="text-xs">{p.disciplina}{p.anoEscolar ? ` · ${p.anoEscolar}º ano` : ''}</p>}
        {p.dias.length > 0 && <p className="text-xs">Dias: {p.dias.map((d) => DIAS_SEMANA_ROTULO[d] ?? d).join(', ')}</p>}
        {p.horario && <p className="text-xs">Horário: {p.horario}</p>}
        {p.nota && <p className="text-xs italic">"{p.nota}"</p>}
        {rodape}
      </div>
    );
  }

  const p = msg.payload || {};
  return (
    <div className={estilo}>
      <div className="flex items-center gap-1.5"><CalendarCheck size={13} /><p className="font-black text-[10px] uppercase tracking-widest">Explicação Confirmada</p></div>
      <div className="text-xs space-y-0.5">
        {p.data && <p>Data: {format(new Date(p.data + 'T00:00:00'), 'dd/MM/yyyy')}</p>}
        {p.hora_inicio && <p>Hora: {p.hora_inicio}</p>}
        {p.professor && <p>Professor: {p.professor}</p>}
      </div>
      {rodape}
    </div>
  );
}

export default function MensagensAdminPage() {
  const { toast, showError } = useStatusToast();

  const [loading, setLoading] = useState(true);
  const [centroId, setCentroId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [recusandoId, setRecusandoId] = useState<string | null>(null);
  const [resumos, setResumos] = useState<Map<string, ResumoConversa>>(new Map());
  const [mensagensPorAluno, setMensagensPorAluno] = useState<Map<string, Mensagem[]>>(new Map());
  const [temAnterioresPorAluno, setTemAnterioresPorAluno] = useState<Map<string, boolean>>(new Map());
  const [nomesStaff, setNomesStaff] = useState<Map<string, string>>(new Map());
  const [alunoSelecionadoId, setAlunoSelecionadoId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'todas' | 'nao_lidas'>('todas');
  const [pesquisa, setPesquisa] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [carregandoAnteriores, setCarregandoAnteriores] = useState(false);

  const isFetchingRef = useRef(false);
  const fetchPendingRef = useRef(false);
  const enviandoRef = useRef(false);
  const fimRef = useRef<HTMLDivElement | null>(null);
  const alunoSelecionadoIdRef = useRef<string | null>(null);
  alunoSelecionadoIdRef.current = alunoSelecionadoId;
  const mensagensPorAlunoRef = useRef(mensagensPorAluno);
  mensagensPorAlunoRef.current = mensagensPorAluno;
  const nomesStaffRef = useRef(nomesStaff);
  nomesStaffRef.current = nomesStaff;

  // Lista de conversas: última mensagem e nº de não lidas por aluno, em
  // consultas separadas e sempre limitadas — nunca um SELECT * às mensagens
  // todas do centro (o PostgREST corta em 1000 linhas pela ordem do SELECT,
  // o que devolveria as MAIS ANTIGAS e não as recentes).
  const carregarListaConversas = useCallback(async (centro_id: string) => {
    if (isFetchingRef.current) {
      fetchPendingRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    try {
      const [
        { data: alunosData, error: erroAlunos },
        { data: ultimasData, error: erroUltimas },
        { data: naoLidasData, error: erroNaoLidas },
      ] = await Promise.all([
        supabase.from('alunos').select('id, nome, ano_escolar').eq('centro_id', centro_id).order('nome'),
        supabase.from('mensagens').select('aluno_id, tipo, texto, criada_em').eq('centro_id', centro_id).order('criada_em', { ascending: false }).limit(LIMITE_RESUMO),
        supabase.from('mensagens').select('aluno_id').eq('centro_id', centro_id).eq('autor', 'familia').is('lida_pelo_centro_em', null).limit(LIMITE_RESUMO),
      ]);

      if (erroAlunos || erroUltimas || erroNaoLidas) {
        showError('Não foi possível carregar as conversas: ' + (erroAlunos || erroUltimas || erroNaoLidas)!.message);
        return;
      }

      const ultimaPorAluno = new Map<string, UltimaMensagem>();
      for (const m of (ultimasData || []) as any[]) {
        if (!ultimaPorAluno.has(m.aluno_id)) ultimaPorAluno.set(m.aluno_id, { tipo: m.tipo, texto: m.texto, criada_em: m.criada_em });
      }
      const naoLidasPorAluno = new Map<string, number>();
      for (const m of (naoLidasData || []) as any[]) {
        naoLidasPorAluno.set(m.aluno_id, (naoLidasPorAluno.get(m.aluno_id) || 0) + 1);
      }

      const mapa = new Map<string, ResumoConversa>();
      for (const aluno of (alunosData || []) as Aluno[]) {
        mapa.set(aluno.id, { aluno, ultimaMensagem: ultimaPorAluno.get(aluno.id) ?? null, naoLidas: naoLidasPorAluno.get(aluno.id) ?? 0 });
      }
      setResumos(mapa);
    } finally {
      isFetchingRef.current = false;
      if (fetchPendingRef.current) {
        fetchPendingRef.current = false;
        carregarListaConversas(centro_id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showError]);

  // Mensagens de UMA conversa — últimas PAGINA, e marca como lidas (num só
  // update) as da família ainda não lidas pelo centro.
  const carregarConversa = useCallback(async (alunoId: string) => {
    const { data, error } = await supabase
      .from('mensagens')
      .select('*')
      .eq('aluno_id', alunoId)
      .order('criada_em', { ascending: false })
      .limit(PAGINA);

    if (error) {
      showError('Não foi possível carregar a conversa: ' + error.message);
      return;
    }

    let lista = ((data || []) as Mensagem[]).slice().reverse();
    setTemAnterioresPorAluno((atual) => new Map(atual).set(alunoId, (data || []).length === PAGINA));

    const haNaoLidas = lista.some((m) => m.autor === 'familia' && !m.lida_pelo_centro_em);
    if (haNaoLidas) {
      const { data: marcadas, error: erroMarcar } = await supabase
        .from('mensagens')
        .update({ lida_pelo_centro_em: new Date().toISOString() })
        .eq('aluno_id', alunoId)
        .eq('autor', 'familia')
        .is('lida_pelo_centro_em', null)
        .select();

      if (erroMarcar) {
        showError('Não foi possível marcar as mensagens como lidas: ' + erroMarcar.message);
      } else if (marcadas) {
        const porId = new Map(marcadas.map((m) => [m.id, m as Mensagem]));
        lista = lista.map((m) => porId.get(m.id) ?? m);
        avisarMensagensLidas();
        setResumos((atual) => {
          const copia = new Map(atual);
          const r = copia.get(alunoId);
          if (r) copia.set(alunoId, { ...r, naoLidas: 0 });
          return copia;
        });
      }
    }

    setMensagensPorAluno((atual) => new Map(atual).set(alunoId, lista));

    const faltam = new Set<string>();
    for (const m of lista) {
      if (m.autor === 'centro' && m.autor_id && !nomesStaffRef.current.has(m.autor_id)) faltam.add(m.autor_id);
    }
    if (faltam.size > 0) {
      const { data: staffData } = await supabase.from('staff').select('id, name').in('id', Array.from(faltam));
      if (staffData) {
        setNomesStaff((atual) => {
          const copia = new Map(atual);
          staffData.forEach((s: any) => copia.set(s.id, s.name));
          return copia;
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showError]);

  const carregarAnteriores = useCallback(async (alunoId: string) => {
    if (carregandoAnteriores) return;
    const atuais = mensagensPorAlunoRef.current.get(alunoId);
    if (!atuais || atuais.length === 0) return;

    setCarregandoAnteriores(true);
    try {
      const maisAntiga = atuais[0];
      const { data, error } = await supabase
        .from('mensagens')
        .select('*')
        .eq('aluno_id', alunoId)
        .lt('criada_em', maisAntiga.criada_em)
        .order('criada_em', { ascending: false })
        .limit(PAGINA);

      if (error) {
        showError('Não foi possível carregar mensagens anteriores: ' + error.message);
        return;
      }

      const novas = ((data || []) as Mensagem[]).slice().reverse();
      setTemAnterioresPorAluno((atual) => new Map(atual).set(alunoId, (data || []).length === PAGINA));
      setMensagensPorAluno((atual) => {
        const copia = new Map(atual);
        copia.set(alunoId, [...novas, ...(copia.get(alunoId) || [])]);
        return copia;
      });
    } finally {
      setCarregandoAnteriores(false);
    }
  }, [carregandoAnteriores, showError]);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const centro_id = user?.app_metadata?.centro_id ?? null;
        setCentroId(centro_id);
        setRole(user?.app_metadata?.role?.toLowerCase() ?? null);
        if (centro_id) await carregarListaConversas(centro_id);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualização por refetch ao ganhar foco e a cada 30s enquanto o
  // separador está visível — sem realtime, igual ao lado da família.
  // Atualiza a lista de conversas e, se houver uma aberta, também essa.
  useEffect(() => {
    if (!centroId) return;
    const atualizarTudo = () => {
      carregarListaConversas(centroId);
      if (alunoSelecionadoIdRef.current) carregarConversa(alunoSelecionadoIdRef.current);
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
  }, [centroId, carregarListaConversas, carregarConversa]);

  const listaConversas = useMemo(() => {
    let lista = Array.from(resumos.values());
    if (filtro === 'nao_lidas') lista = lista.filter((c) => c.naoLidas > 0);
    if (pesquisa.trim()) {
      const termo = pesquisa.trim().toLowerCase();
      lista = lista.filter((c) => c.aluno.nome.toLowerCase().includes(termo));
    }
    return lista.sort((a, b) => {
      const ta = a.ultimaMensagem?.criada_em;
      const tb = b.ultimaMensagem?.criada_em;
      if (ta && tb) return tb.localeCompare(ta);
      if (ta) return -1;
      if (tb) return 1;
      return a.aluno.nome.localeCompare(b.aluno.nome);
    });
  }, [resumos, filtro, pesquisa]);

  const totalNaoLidas = useMemo(() => Array.from(resumos.values()).reduce((soma, c) => soma + c.naoLidas, 0), [resumos]);

  const resumoAtivo = alunoSelecionadoId ? resumos.get(alunoSelecionadoId) ?? null : null;
  const mensagensAtivas = alunoSelecionadoId ? mensagensPorAluno.get(alunoSelecionadoId) ?? null : null;
  const temAnterioresAtivo = alunoSelecionadoId ? temAnterioresPorAluno.get(alunoSelecionadoId) ?? false : false;

  const abrirConversa = useCallback((alunoId: string) => {
    setAlunoSelecionadoId(alunoId);
    carregarConversa(alunoId);
  }, [carregarConversa]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [alunoSelecionadoId, mensagensAtivas?.length]);

  const handleEnviar = async () => {
    if (enviandoRef.current || !alunoSelecionadoId) return;
    const limpo = texto.trim();
    if (!limpo || limpo.length > TEXTO_MAX) return;

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const { data, error } = await supabase
        .from('mensagens')
        .insert({ aluno_id: alunoSelecionadoId, tipo: 'texto', texto: limpo })
        .select()
        .single();

      if (error) {
        showError('Não foi possível enviar a mensagem: ' + error.message);
        return;
      }

      setMensagensPorAluno((atual) => {
        const copia = new Map(atual);
        copia.set(alunoSelecionadoId, [...(copia.get(alunoSelecionadoId) || []), data as Mensagem]);
        return copia;
      });
      setResumos((atual) => {
        const copia = new Map(atual);
        const r = copia.get(alunoSelecionadoId);
        if (r) copia.set(alunoSelecionadoId, { ...r, ultimaMensagem: { tipo: 'texto', texto: limpo, criada_em: (data as Mensagem).criada_em } });
        return copia;
      });
      setTexto('');
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const handleRecusar = async (msg: Mensagem) => {
    if (recusandoId || !alunoSelecionadoId) return;
    if (!confirm('Recusar este pedido de explicação? A família não recebe nenhuma mensagem automática — se quiseres explicar o motivo, responde em texto.')) return;

    setRecusandoId(msg.id);
    try {
      const { data, error } = await supabase
        .from('mensagens')
        .update({ estado: 'recusada' })
        .eq('id', msg.id)
        .select()
        .single();

      if (error) {
        showError('Não foi possível recusar o pedido: ' + error.message);
        return;
      }

      setMensagensPorAluno((atual) => {
        const copia = new Map(atual);
        const lista = copia.get(alunoSelecionadoId);
        if (lista) copia.set(alunoSelecionadoId, lista.map((m) => (m.id === msg.id ? (data as Mensagem) : m)));
        return copia;
      });
    } finally {
      setRecusandoId(null);
    }
  };

  if (loading) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-primary flex items-center gap-2">
          <MessageCircle className="text-accent" /> Mensagens
          {totalNaoLidas > 0 && (
            <span className="bg-danger text-on-danger text-[10px] font-black min-w-5 h-5 px-1.5 rounded-full flex items-center justify-center">{totalNaoLidas}</span>
          )}
        </h1>
        <p className="text-secondary text-sm">Conversas com as famílias dos alunos.</p>
      </div>

      <div className="bg-surface border border-border rounded-3xl shadow-xl overflow-hidden grid md:grid-cols-[320px_1fr] min-h-[65vh]">
        {/* Lista de conversas */}
        <div className={`border-r border-border flex flex-col ${alunoSelecionadoId ? 'hidden md:flex' : 'flex'}`}>
          <div className="p-4 border-b border-border space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={pesquisa}
                onChange={(e) => setPesquisa(e.target.value)}
                placeholder="Pesquisar aluno..."
                className="w-full bg-page border border-border text-primary text-sm pl-9 pr-3 py-2 rounded-xl outline-none focus:border-accent transition-all"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setFiltro('todas')}
                className={`flex-1 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${filtro === 'todas' ? 'bg-accent text-on-accent border-accent' : 'bg-page text-muted border-border'}`}
              >
                Todas
              </button>
              <button
                onClick={() => setFiltro('nao_lidas')}
                className={`flex-1 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${filtro === 'nao_lidas' ? 'bg-accent text-on-accent border-accent' : 'bg-page text-muted border-border'}`}
              >
                Não lidas
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {listaConversas.length === 0 ? (
              <p className="text-muted text-sm text-center italic p-6">Nenhuma conversa encontrada.</p>
            ) : (
              listaConversas.map((c) => (
                <button
                  key={c.aluno.id}
                  onClick={() => abrirConversa(c.aluno.id)}
                  className={`w-full text-left p-4 border-b border-border flex items-center justify-between gap-2 transition-colors ${alunoSelecionadoId === c.aluno.id ? 'bg-accent-soft' : 'hover:bg-raised'}`}
                >
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-primary truncate">{c.aluno.nome}{c.aluno.ano_escolar ? ` · ${c.aluno.ano_escolar}º` : ''}</p>
                    <p className="text-xs text-muted truncate">
                      {c.ultimaMensagem ? (c.ultimaMensagem.tipo === 'texto' ? c.ultimaMensagem.texto : '[mensagem]') : 'Sem mensagens'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right space-y-1">
                    {c.ultimaMensagem && <p className="text-[9px] text-muted font-bold">{horaOuDataMensagem(c.ultimaMensagem.criada_em)}</p>}
                    {c.naoLidas > 0 && (
                      <span className="bg-danger text-on-danger text-[10px] font-black min-w-5 h-5 px-1.5 rounded-full flex items-center justify-center ml-auto">{c.naoLidas}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Conversa ativa */}
        <div className={`flex flex-col ${alunoSelecionadoId ? 'flex' : 'hidden md:flex'}`}>
          {!resumoAtivo ? (
            <div className="flex-1 flex items-center justify-center text-muted text-sm italic">Seleciona uma conversa.</div>
          ) : (
            <>
              <div className="p-4 border-b border-border flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button onClick={() => setAlunoSelecionadoId(null)} className="md:hidden text-muted shrink-0"><ArrowLeft size={18} /></button>
                  <p className="font-black text-primary truncate">{resumoAtivo.aluno.nome}{resumoAtivo.aluno.ano_escolar ? ` · ${resumoAtivo.aluno.ano_escolar}º ano` : ''}</p>
                </div>
                <Link href={`/admin/alunos/ficha?id=${resumoAtivo.aluno.id}`} className="text-muted hover:text-accent transition-colors shrink-0" title="Abrir ficha do aluno">
                  <ExternalLink size={16} />
                </Link>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {mensagensAtivas === null ? (
                  <div className="flex justify-center py-10"><Loader2 className="animate-spin text-accent" /></div>
                ) : mensagensAtivas.length === 0 ? (
                  <p className="text-muted text-sm text-center italic pt-10">Ainda não há mensagens com este aluno.</p>
                ) : (
                  <>
                    {temAnterioresAtivo && (
                      <div className="flex justify-center pb-2">
                        <button
                          onClick={() => { if (alunoSelecionadoId) carregarAnteriores(alunoSelecionadoId); }}
                          disabled={carregandoAnteriores}
                          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted hover:text-primary bg-page border border-border px-3 py-1.5 rounded-full transition-all disabled:opacity-50"
                        >
                          {carregandoAnteriores ? <Loader2 className="animate-spin" size={12} /> : <ChevronUp size={12} />}
                          Carregar anteriores
                        </button>
                      </div>
                    )}
                    {comSeparadoresDeDia(mensagensAtivas).map((it) =>
                      it.tipo === 'separador' ? (
                        <div key={it.chave} className="flex justify-center py-1">
                          <span className="text-[9px] font-black uppercase tracking-widest text-muted bg-page border border-border px-3 py-1 rounded-full">
                            {it.rotulo}
                          </span>
                        </div>
                      ) : (
                        <div key={it.chave} className="space-y-1.5">
                          <CartaoMensagem msg={it.item} nomeAutorCentro={it.item.autor_id ? nomesStaff.get(it.item.autor_id) ?? null : null} />
                          {role === 'admin' && it.item.tipo === 'pedido_explicacao' && (it.item.estado ?? 'pendente') === 'pendente' && (
                            <div className="flex gap-2 max-w-[85%]">
                              <Link
                                href={`/admin/explicacoes?pedido=${it.item.id}`}
                                className="flex-1 flex items-center justify-center gap-1.5 bg-success-bg text-success border border-success/30 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-success/10 transition-all"
                              >
                                <Check size={11} /> Marcar
                              </Link>
                              <button
                                onClick={() => handleRecusar(it.item)}
                                disabled={recusandoId === it.item.id}
                                className="flex-1 flex items-center justify-center gap-1.5 bg-danger-bg text-danger border border-danger/30 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-danger/10 transition-all disabled:opacity-50"
                              >
                                {recusandoId === it.item.id ? <Loader2 className="animate-spin" size={11} /> : <XCircle size={11} />} Recusar
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    )}
                  </>
                )}
                <div ref={fimRef} />
              </div>

              <div className="p-4 border-t border-border">
                <div className="flex items-end gap-2">
                  <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEnviar(); } }}
                    maxLength={TEXTO_MAX}
                    rows={1}
                    placeholder="Responder..."
                    disabled={enviando}
                    className="flex-1 bg-page border border-border text-primary p-3 rounded-2xl outline-none focus:border-accent transition-all resize-none disabled:opacity-50 text-sm"
                  />
                  <button
                    onClick={handleEnviar}
                    disabled={enviando || !texto.trim()}
                    aria-label="Enviar mensagem"
                    className="bg-accent hover:bg-accent-hover text-on-accent p-3 rounded-2xl shrink-0 flex items-center justify-center transition-all active:scale-95 disabled:opacity-50"
                  >
                    {enviando ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <StatusToast toast={toast} />
    </div>
  );
}
