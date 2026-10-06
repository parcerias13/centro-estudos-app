'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { isUnlocked, touch, subscribe } from '@/lib/encarregadoUnlock';
import { horaOuDataMensagem, comSeparadoresDeDia } from '@/lib/formatoMensagens';
import {
  ArrowLeft, Loader2, MessageCircle, Send, FileText, HelpCircle, CalendarCheck,
  CheckCircle2, Clock, XCircle, ChevronUp,
} from 'lucide-react';

type TipoMensagem = 'texto' | 'relatorio_mensal' | 'pedido_explicacao' | 'confirmacao_explicacao';

type Mensagem = {
  id: string;
  aluno_id: string;
  autor: 'familia' | 'centro';
  autor_id: string | null;
  tipo: TipoMensagem;
  texto: string | null;
  payload: any;
  estado: string | null;
  explicacao_id: string | null;
  lida_pela_familia_em: string | null;
  lida_pelo_centro_em: string | null;
  criada_em: string;
};

const TEXTO_MAX = 4000;
const PAGINA = 200;

function ChipPedido({ estado }: { estado: string | null }) {
  const valor = (estado || 'pendente').toLowerCase();
  if (valor === 'marcada') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-success-bg text-success">
        <CheckCircle2 size={11} /> Marcada
      </span>
    );
  }
  if (valor === 'recusada') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-danger-bg text-danger">
        <XCircle size={11} /> Recusada
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-warning-bg text-warning">
      <Clock size={11} /> Pendente
    </span>
  );
}

function CartaoMensagem({ msg }: { msg: Mensagem }) {
  const minha = msg.autor === 'familia';
  const base = 'max-w-[85%] rounded-3xl p-4 shadow-xl space-y-2';
  const estilo = minha
    ? `${base} bg-accent text-on-accent ml-auto`
    : `${base} bg-surface border border-border text-primary`;

  if (msg.tipo === 'texto') {
    return (
      <div className={estilo}>
        <p className="text-sm whitespace-pre-wrap break-words">{msg.texto}</p>
        <p className={`text-[9px] font-bold uppercase tracking-widest ${minha ? 'text-on-accent/70' : 'text-muted'}`}>
          {horaOuDataMensagem(msg.criada_em)}
        </p>
      </div>
    );
  }

  if (msg.tipo === 'relatorio_mensal') {
    const p = msg.payload || {};
    return (
      <div className={estilo}>
        <div className="flex items-center gap-2 text-accent">
          <FileText size={16} />
          <p className="font-black text-xs uppercase tracking-widest">Relatório Mensal</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {p.mes != null && p.ano != null && (
            <p className="text-muted">Período: <span className="font-bold text-primary">{String(p.mes).padStart(2, '0')}/{p.ano}</span></p>
          )}
          {p.horas != null && <p className="text-muted">Horas: <span className="font-bold text-primary">{p.horas}</span></p>}
          {p.sessoes != null && <p className="text-muted">Sessões: <span className="font-bold text-primary">{p.sessoes}</span></p>}
          {p.disciplina_principal && <p className="text-muted col-span-2">Disciplina principal: <span className="font-bold text-primary">{p.disciplina_principal}</span></p>}
        </div>
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted">{horaOuDataMensagem(msg.criada_em)}</p>
      </div>
    );
  }

  if (msg.tipo === 'pedido_explicacao') {
    const p = msg.payload || {};
    return (
      <div className={estilo}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-on-accent">
            <HelpCircle size={16} />
            <p className="font-black text-xs uppercase tracking-widest">Pedido de Explicação</p>
          </div>
          <ChipPedido estado={msg.estado} />
        </div>
        {p.disciplina && <p className="text-sm">{p.disciplina}{p.ano_escolar ? ` · ${p.ano_escolar}º ano` : ''}</p>}
        <p className="text-[9px] font-bold uppercase tracking-widest text-on-accent/70">{horaOuDataMensagem(msg.criada_em)}</p>
      </div>
    );
  }

  // confirmacao_explicacao
  const p = msg.payload || {};
  return (
    <div className={estilo}>
      <div className="flex items-center gap-2 text-accent">
        <CalendarCheck size={16} />
        <p className="font-black text-xs uppercase tracking-widest">Explicação Confirmada</p>
      </div>
      <div className="text-xs space-y-0.5">
        {p.data && <p className="text-muted">Data: <span className="font-bold text-primary">{format(new Date(p.data + 'T00:00:00'), 'dd/MM/yyyy')}</span></p>}
        {p.hora_inicio && <p className="text-muted">Hora: <span className="font-bold text-primary">{p.hora_inicio}</span></p>}
        {p.professor && <p className="text-muted">Professor: <span className="font-bold text-primary">{p.professor}</span></p>}
      </div>
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted">{horaOuDataMensagem(msg.criada_em)}</p>
    </div>
  );
}

export default function MensagensEncarregadoPage() {
  const router = useRouter();
  const { toast, showError } = useStatusToast();

  const [loading, setLoading] = useState(true);
  const [mensagens, setMensagens] = useState<Mensagem[] | null>(null);
  const [temAnteriores, setTemAnteriores] = useState(false);
  const [carregandoAnteriores, setCarregandoAnteriores] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);

  const userIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);
  const fetchPendingRef = useRef(false);
  const fimRef = useRef<HTMLDivElement | null>(null);
  const enviandoRef = useRef(false);
  const mensagensRef = useRef<Mensagem[] | null>(null);
  mensagensRef.current = mensagens;

  const scrollParaFim = useCallback((suave = false) => {
    fimRef.current?.scrollIntoView({ behavior: suave ? 'smooth' : 'auto' });
  }, []);

  // Carrega só as últimas PAGINA mensagens — nunca a conversa toda (o
  // PostgREST corta em 1000 linhas e devolveria as mais antigas, não as
  // recentes). "Carregar anteriores" pagina para trás a partir daqui.
  const carregarMensagens = useCallback(async (uid: string) => {
    if (isFetchingRef.current) {
      fetchPendingRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    try {
      const { data, error } = await supabase
        .from('mensagens')
        .select('*')
        .eq('aluno_id', uid)
        .order('criada_em', { ascending: false })
        .limit(PAGINA);

      if (error) {
        showError('Não foi possível carregar as mensagens: ' + error.message);
        return;
      }

      let lista = ((data || []) as Mensagem[]).slice().reverse();
      setTemAnteriores((data || []).length === PAGINA);

      // Marca como lidas, num só update, as mensagens do centro ainda não
      // lidas — junta a resposta à lista em memória em vez de as voltar a
      // pedir ao servidor.
      const haNaoLidas = lista.some((m) => m.autor === 'centro' && !m.lida_pela_familia_em);
      if (haNaoLidas) {
        const { data: marcadas, error: erroMarcar } = await supabase
          .from('mensagens')
          .update({ lida_pela_familia_em: new Date().toISOString() })
          .eq('aluno_id', uid)
          .eq('autor', 'centro')
          .is('lida_pela_familia_em', null)
          .select();

        if (erroMarcar) {
          showError('Não foi possível marcar as mensagens como lidas: ' + erroMarcar.message);
        } else if (marcadas) {
          const porId = new Map(marcadas.map((m) => [m.id, m as Mensagem]));
          lista = lista.map((m) => porId.get(m.id) ?? m);
        }
      }

      setMensagens(lista);
    } finally {
      isFetchingRef.current = false;
      if (fetchPendingRef.current) {
        fetchPendingRef.current = false;
        carregarMensagens(uid);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showError]);

  const carregarAnteriores = useCallback(async () => {
    const uid = userIdRef.current;
    const atuais = mensagensRef.current;
    if (!uid || !atuais || atuais.length === 0 || carregandoAnteriores) return;

    setCarregandoAnteriores(true);
    try {
      const maisAntiga = atuais[0];
      const { data, error } = await supabase
        .from('mensagens')
        .select('*')
        .eq('aluno_id', uid)
        .lt('criada_em', maisAntiga.criada_em)
        .order('criada_em', { ascending: false })
        .limit(PAGINA);

      if (error) {
        showError('Não foi possível carregar mensagens anteriores: ' + error.message);
        return;
      }

      const novas = ((data || []) as Mensagem[]).slice().reverse();
      setTemAnteriores((data || []).length === PAGINA);
      setMensagens((atual) => [...novas, ...(atual || [])]);
    } finally {
      setCarregandoAnteriores(false);
    }
  }, [carregandoAnteriores, showError]);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.replace('/login'); return; }
        if (!isUnlocked(user.id)) { router.replace('/encarregados'); return; }
        userIdRef.current = user.id;
        await carregarMensagens(user.id);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sai do ecrã e larga os dados em memória assim que lock() acontece
  // (inatividade, logout, ou Bloquear noutra página).
  useEffect(() => {
    const cancelar = subscribe(() => {
      setMensagens(null);
      router.replace('/encarregados');
    });
    return cancelar;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualização por refetch ao ganhar foco e a cada 30s enquanto visível —
  // sem realtime. O intervalo só corre enquanto o separador está visível.
  useEffect(() => {
    const aoFocar = () => { if (userIdRef.current) carregarMensagens(userIdRef.current); };
    window.addEventListener('focus', aoFocar);

    let intervalo: ReturnType<typeof setInterval> | null = null;
    const geriIntervalo = () => {
      if (document.visibilityState === 'visible') {
        if (!intervalo) {
          intervalo = setInterval(() => {
            if (userIdRef.current) carregarMensagens(userIdRef.current);
          }, 30000);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregarMensagens]);

  useEffect(() => {
    if (mensagens && mensagens.length > 0) scrollParaFim(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const handleEnviar = async () => {
    if (enviandoRef.current) return;
    const limpo = texto.trim();
    if (!limpo || limpo.length > TEXTO_MAX || !userIdRef.current) return;

    enviandoRef.current = true;
    setEnviando(true);
    touch();
    try {
      const { data, error } = await supabase
        .from('mensagens')
        .insert({ aluno_id: userIdRef.current, tipo: 'texto', texto: limpo })
        .select()
        .single();

      if (error) {
        showError('Não foi possível enviar a mensagem: ' + error.message);
        return;
      }

      setMensagens((atual) => [...(atual || []), data as Mensagem]);
      setTexto('');
      scrollParaFim(true);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  return (
    <main className="min-h-screen bg-page text-primary flex flex-col max-w-md mx-auto">
      <header className="p-6 pb-4 flex items-center gap-3 border-b border-border">
        <Link href="/encarregados" className="flex items-center gap-2 text-muted hover:text-primary transition-colors shrink-0">
          <ArrowLeft size={20} /> <span className="font-bold text-sm">Voltar</span>
        </Link>
        <div className="bg-accent-soft text-accent p-2 rounded-xl"><MessageCircle size={18} /></div>
        <h1 className="text-lg font-black italic">Mensagens</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {mensagens === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-accent" /></div>
        ) : mensagens.length === 0 ? (
          <p className="text-muted text-sm text-center italic pt-10">Ainda não há mensagens.</p>
        ) : (
          <>
            {temAnteriores && (
              <div className="flex justify-center pb-2">
                <button
                  onClick={carregarAnteriores}
                  disabled={carregandoAnteriores}
                  className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted hover:text-primary bg-surface border border-border px-3 py-1.5 rounded-full transition-all disabled:opacity-50"
                >
                  {carregandoAnteriores ? <Loader2 className="animate-spin" size={12} /> : <ChevronUp size={12} />}
                  Carregar anteriores
                </button>
              </div>
            )}
            {comSeparadoresDeDia(mensagens).map((it) =>
              it.tipo === 'separador' ? (
                <div key={it.chave} className="flex justify-center py-1">
                  <span className="text-[9px] font-black uppercase tracking-widest text-muted bg-surface border border-border px-3 py-1 rounded-full">
                    {it.rotulo}
                  </span>
                </div>
              ) : (
                <CartaoMensagem key={it.chave} msg={it.item} />
              )
            )}
          </>
        )}
        <div ref={fimRef} />
      </div>

      <div className="p-4 border-t border-border bg-page">
        <div className="flex items-end gap-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEnviar(); }
            }}
            maxLength={TEXTO_MAX}
            rows={1}
            placeholder="Escreve uma mensagem..."
            disabled={enviando}
            className="flex-1 bg-surface border border-border text-primary p-3 rounded-2xl outline-none focus:border-accent transition-all resize-none disabled:opacity-50 text-sm"
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

      <StatusToast toast={toast} />
    </main>
  );
}
