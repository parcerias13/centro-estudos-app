'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { isUnlocked, touch, subscribe } from '@/lib/encarregadoUnlock';
import { horaOuDataMensagem, comSeparadoresDeDia, sanitizarPedidoExplicacao } from '@/lib/formatoMensagens';
import { disciplinasParaAno } from '@/lib/disciplinas';
import {
  BUCKET_ANEXOS, MAX_ANEXOS_POR_MENSAGEM, validarAnexo, higienizarNomeFicheiro,
  construirCaminhoAnexo, formatarTamanhoFicheiro,
} from '@/lib/mensagensAnexos';
import {
  ArrowLeft, Loader2, MessageCircle, Send, FileText, HelpCircle, CalendarCheck,
  CheckCircle2, Clock, XCircle, ChevronUp, X, Plus, Paperclip,
} from 'lucide-react';

const DIAS_SEMANA = [
  { valor: 1, rotulo: 'Seg' },
  { valor: 2, rotulo: 'Ter' },
  { valor: 3, rotulo: 'Qua' },
  { valor: 4, rotulo: 'Qui' },
  { valor: 5, rotulo: 'Sex' },
  { valor: 6, rotulo: 'Sáb' },
  { valor: 7, rotulo: 'Dom' },
];
const NOTA_MAX = 500;

type TipoMensagem = 'texto' | 'relatorio_mensal' | 'pedido_explicacao' | 'confirmacao_explicacao';

type Anexo = { id: string; caminho: string; nome_original: string; mime: string; tamanho: number };

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
  anexos?: Anexo[] | null;
};

type AnexoEscolhido = { id: string; file: File; estado: 'pendente' | 'enviado' | 'erro'; erro?: string };

const TEXTO_MAX = 4000;
const PAGINA = 200;
const SELECT_MENSAGEM = '*, anexos:mensagens_anexos(*)';

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

function TagAnexo({ anexo, corTexto, showError }: { anexo: Anexo; corTexto: string; showError: (msg: string) => void }) {
  const [abrindo, setAbrindo] = useState(false);

  // O separador tem de abrir de forma SÍNCRONA dentro do clique — Safari
  // (incluindo iOS) bloqueia window.open() chamado depois de um await, mesmo
  // num handler de clique. Por isso: abre já um separador em branco, corta a
  // ligação a window.opener, e só DEPOIS pede o URL assinado e navega esse
  // separador para lá. Nunca navegar na mesma janela — um recarregamento
  // apaga de propósito o desbloqueio do código (guardado só em memória).
  const handleAbrir = () => {
    if (abrindo) return;
    const novaJanela = window.open('', '_blank');
    if (!novaJanela) {
      showError('O browser bloqueou o separador. Permite pop-ups para abrir anexos.');
      return;
    }
    try { novaJanela.opener = null; } catch {}
    setAbrindo(true);
    (async () => {
      try {
        const { data, error } = await supabase.storage.from(BUCKET_ANEXOS).createSignedUrl(anexo.caminho, 60);
        if (error || !data?.signedUrl) {
          novaJanela.close();
          showError('Não foi possível abrir o anexo: ' + (error?.message || 'sem URL'));
          return;
        }
        novaJanela.location.href = data.signedUrl;
      } catch (e: any) {
        novaJanela.close();
        showError('Não foi possível abrir o anexo: ' + (e?.message || 'erro inesperado'));
      } finally {
        setAbrindo(false);
      }
    })();
  };

  return (
    <button
      onClick={handleAbrir}
      disabled={abrindo}
      className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-full border border-current/20 ${corTexto} bg-black/10 hover:bg-black/20 transition-all disabled:opacity-50`}
    >
      {abrindo ? <Loader2 className="animate-spin" size={10} /> : <Paperclip size={10} />}
      {anexo.nome_original} · {formatarTamanhoFicheiro(anexo.tamanho)}
    </button>
  );
}

function CartaoMensagem({ msg, showError }: { msg: Mensagem; showError: (msg: string) => void }) {
  const minha = msg.autor === 'familia';
  const base = 'max-w-[85%] rounded-3xl p-4 shadow-xl space-y-2';
  const estilo = minha
    ? `${base} bg-accent text-on-accent ml-auto`
    : `${base} bg-surface border border-border text-primary`;
  const corTag = minha ? 'text-on-accent' : 'text-primary';

  const anexos = (msg.anexos || []).length > 0 && (
    <div className="flex flex-wrap gap-1.5">
      {(msg.anexos || []).map((a) => <TagAnexo key={a.id} anexo={a} corTexto={corTag} showError={showError} />)}
    </div>
  );

  if (msg.tipo === 'texto') {
    return (
      <div className={estilo}>
        <p className="text-sm whitespace-pre-wrap break-words">{msg.texto}</p>
        {anexos}
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
        {anexos}
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted">{horaOuDataMensagem(msg.criada_em)}</p>
      </div>
    );
  }

  if (msg.tipo === 'pedido_explicacao') {
    const p = sanitizarPedidoExplicacao(msg.payload);
    return (
      <div className={estilo}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-on-accent">
            <HelpCircle size={16} />
            <p className="font-black text-xs uppercase tracking-widest">Pedido de Explicação</p>
          </div>
          <ChipPedido estado={msg.estado} />
        </div>
        {p.disciplina && <p className="text-sm">{p.disciplina}{p.anoEscolar ? ` · ${p.anoEscolar}º ano` : ''}</p>}
        {p.dias.length > 0 && (
          <p className="text-xs opacity-90">Dias: {p.dias.map((d) => DIAS_SEMANA.find((x) => x.valor === d)?.rotulo ?? d).join(', ')}</p>
        )}
        {p.horario && <p className="text-xs opacity-90">Horário: {p.horario}</p>}
        {p.nota && <p className="text-xs opacity-90 italic">"{p.nota}"</p>}
        {anexos}
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
      {anexos}
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
  const [anexosEscolhidos, setAnexosEscolhidos] = useState<AnexoEscolhido[]>([]);
  const [disciplinasDisponiveis, setDisciplinasDisponiveis] = useState<Array<{ id: number; name: string }>>([]);
  const [anoEscolar, setAnoEscolar] = useState<number | null>(null);
  const [modalPedidoAberto, setModalPedidoAberto] = useState(false);

  const userIdRef = useRef<string | null>(null);
  const centroIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);
  const fetchPendingRef = useRef(false);
  const fimRef = useRef<HTMLDivElement | null>(null);
  const enviandoRef = useRef(false);
  const mensagensRef = useRef<Mensagem[] | null>(null);
  mensagensRef.current = mensagens;
  const mensagemCriadaIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        .select(SELECT_MENSAGEM)
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
          const porId = new Map(marcadas.map((m) => [m.id, m]));
          lista = lista.map((m) => (porId.has(m.id) ? { ...m, ...porId.get(m.id) } : m));
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
        .select(SELECT_MENSAGEM)
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

        const centro_id = user.app_metadata?.centro_id ?? null;
        centroIdRef.current = centro_id;
        const [{ data: alunoData }, { data: subjectsData }] = await Promise.all([
          supabase.from('alunos').select('ano_escolar').eq('id', user.id).maybeSingle(),
          centro_id ? supabase.from('subjects').select('id, name, anos_aplicaveis').eq('centro_id', centro_id).order('name') : Promise.resolve({ data: [] as any[] }),
        ]);
        setAnoEscolar(alunoData?.ano_escolar ?? null);
        setDisciplinasDisponiveis(disciplinasParaAno(subjectsData || [], alunoData?.ano_escolar ?? null));

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

  const handleEscolherFicheiros = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const livres = MAX_ANEXOS_POR_MENSAGEM - anexosEscolhidos.length;
    if (livres <= 0) {
      showError(`Só podes anexar até ${MAX_ANEXOS_POR_MENSAGEM} ficheiros por mensagem.`);
      return;
    }
    const escolhidos: AnexoEscolhido[] = [];
    for (const file of Array.from(files)) {
      if (escolhidos.length >= livres) {
        showError(`Só podes anexar até ${MAX_ANEXOS_POR_MENSAGEM} ficheiros por mensagem.`);
        break;
      }
      const erro = validarAnexo(file);
      if (erro) { showError(`${file.name}: ${erro}`); continue; }
      escolhidos.push({ id: crypto.randomUUID(), file, estado: 'pendente' });
    }
    if (escolhidos.length > 0) setAnexosEscolhidos((atual) => [...atual, ...escolhidos]);
  };

  const handleRemoverAnexo = (id: string) => {
    setAnexosEscolhidos((atual) => atual.filter((a) => a.id !== id));
  };

  // Envia os anexos que ainda não foram enviados (pendentes ou com erro de
  // uma tentativa anterior) — nunca os que já têm estado "enviado". Se o
  // upload falhar, fica marcado como erro; se a linha em mensagens_anexos
  // falhar depois do upload ter corrido bem, apaga o ficheiro órfão do
  // bucket antes de marcar erro, para não deixar lixo sem dono.
  const enviarAnexosPendentes = async (mensagemId: string, lista: AnexoEscolhido[]): Promise<AnexoEscolhido[]> => {
    const resultado: AnexoEscolhido[] = [];
    for (const anexo of lista) {
      if (anexo.estado === 'enviado') { resultado.push(anexo); continue; }

      const caminho = construirCaminhoAnexo(centroIdRef.current || '', userIdRef.current || '', anexo.file.name);
      const { error: erroUpload } = await supabase.storage.from(BUCKET_ANEXOS).upload(caminho, anexo.file, { contentType: anexo.file.type });
      if (erroUpload) {
        resultado.push({ ...anexo, estado: 'erro', erro: erroUpload.message });
        continue;
      }

      const { data: linha, error: erroLinha } = await supabase
        .from('mensagens_anexos')
        .insert({
          mensagem_id: mensagemId,
          caminho,
          nome_original: higienizarNomeFicheiro(anexo.file.name),
          mime: anexo.file.type,
          tamanho: anexo.file.size,
        })
        .select()
        .single();

      if (erroLinha) {
        await supabase.storage.from(BUCKET_ANEXOS).remove([caminho]);
        resultado.push({ ...anexo, estado: 'erro', erro: erroLinha.message });
        continue;
      }

      setMensagens((atual) => (atual || []).map((m) => (m.id === mensagemId ? { ...m, anexos: [...(m.anexos || []), linha as Anexo] } : m)));
      resultado.push({ ...anexo, estado: 'enviado' });
    }
    return resultado;
  };

  const handleEnviar = async () => {
    if (enviandoRef.current) return;
    const limpo = texto.trim();
    if (!limpo && anexosEscolhidos.length === 0) return;
    if (limpo.length > TEXTO_MAX || !userIdRef.current) return;

    enviandoRef.current = true;
    setEnviando(true);
    touch();
    try {
      let mensagemId = mensagemCriadaIdRef.current;

      // A mensagem só se cria UMA vez — se já existe (retry de anexos), o
      // texto nunca é reenviado nem recriado.
      if (!mensagemId) {
        const textoFinal = limpo || (
          anexosEscolhidos.length === 1
            ? `Anexo: ${higienizarNomeFicheiro(anexosEscolhidos[0].file.name)}`
            : `${anexosEscolhidos.length} anexos`
        );

        const { data, error } = await supabase
          .from('mensagens')
          .insert({ aluno_id: userIdRef.current, tipo: 'texto', texto: textoFinal })
          .select(SELECT_MENSAGEM)
          .single();

        if (error) {
          showError('Não foi possível enviar a mensagem: ' + error.message);
          return;
        }

        mensagemId = data.id;
        mensagemCriadaIdRef.current = mensagemId;
        setMensagens((atual) => [...(atual || []), data as Mensagem]);
        setTexto('');
        scrollParaFim(true);
      }

      if (anexosEscolhidos.length > 0) {
        const atualizados = await enviarAnexosPendentes(mensagemId!, anexosEscolhidos);
        setAnexosEscolhidos(atualizados);
        const falhas = atualizados.filter((a) => a.estado === 'erro').length;
        if (falhas > 0) {
          showError(`Mensagem enviada, mas ${falhas} anexo(s) falharam — toca em enviar para tentar outra vez.`);
          return; // mantém mensagemCriadaIdRef para só repetir os anexos em falta
        }
      }

      mensagemCriadaIdRef.current = null;
      setAnexosEscolhidos([]);
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
        <h1 className="text-lg font-black italic flex-1">Mensagens</h1>
        <button
          onClick={() => setModalPedidoAberto(true)}
          disabled={disciplinasDisponiveis.length === 0}
          title={disciplinasDisponiveis.length === 0 ? 'Sem disciplinas disponíveis' : undefined}
          className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest bg-accent-soft text-accent px-3 py-2 rounded-xl transition-all active:scale-95 disabled:opacity-40 shrink-0"
        >
          <HelpCircle size={14} /> Pedir Explicação
        </button>
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
                <CartaoMensagem key={it.chave} msg={it.item} showError={showError} />
              )
            )}
          </>
        )}
        <div ref={fimRef} />
      </div>

      <div className="p-4 border-t border-border bg-page space-y-2">
        {anexosEscolhidos.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {anexosEscolhidos.map((a) => (
              <span
                key={a.id}
                className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-full border ${
                  a.estado === 'erro' ? 'bg-danger-bg text-danger border-danger/30'
                    : a.estado === 'enviado' ? 'bg-success-bg text-success border-success/30'
                    : 'bg-surface text-muted border-border'
                }`}
              >
                <Paperclip size={10} />
                {higienizarNomeFicheiro(a.file.name)} · {formatarTamanhoFicheiro(a.file.size)}
                {a.estado !== 'enviado' && (
                  <button onClick={() => handleRemoverAnexo(a.id)} className="hover:text-danger" title="Remover">
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => { handleEscolherFicheiros(e.target.files); e.target.value = ''; }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={enviando || anexosEscolhidos.length >= MAX_ANEXOS_POR_MENSAGEM}
            title="Anexar ficheiro"
            className="bg-surface border border-border text-muted hover:text-primary p-3 rounded-2xl shrink-0 flex items-center justify-center transition-all active:scale-95 disabled:opacity-50"
          >
            <Paperclip size={18} />
          </button>
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
            disabled={enviando || (!texto.trim() && anexosEscolhidos.length === 0)}
            aria-label="Enviar mensagem"
            className="bg-accent hover:bg-accent-hover text-on-accent p-3 rounded-2xl shrink-0 flex items-center justify-center transition-all active:scale-95 disabled:opacity-50"
          >
            {enviando ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
          </button>
        </div>
      </div>

      {modalPedidoAberto && userIdRef.current && (
        <ModalPedirExplicacao
          alunoId={userIdRef.current}
          anoEscolar={anoEscolar}
          disciplinas={disciplinasDisponiveis}
          onClose={() => setModalPedidoAberto(false)}
          onCriado={(nova) => {
            setMensagens((atual) => [...(atual || []), nova]);
            setModalPedidoAberto(false);
            scrollParaFim(true);
          }}
          showError={showError}
        />
      )}

      <StatusToast toast={toast} />
    </main>
  );
}

function ModalPedirExplicacao({
  alunoId, anoEscolar, disciplinas, onClose, onCriado, showError,
}: {
  alunoId: string;
  anoEscolar: number | null;
  disciplinas: Array<{ id: number; name: string }>;
  onClose: () => void;
  onCriado: (nova: Mensagem) => void;
  showError: (msg: string) => void;
}) {
  const [disciplinaId, setDisciplinaId] = useState('');
  const [dias, setDias] = useState<number[]>([]);
  const [horario, setHorario] = useState('');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);

  const toggleDia = (valor: number) => {
    setDias((atual) => (atual.includes(valor) ? atual.filter((d) => d !== valor) : [...atual, valor].sort()));
  };

  const handleCriar = async () => {
    if (enviando) return;
    if (!disciplinaId) { showError('Escolhe a disciplina.'); return; }
    if (dias.length === 0) { showError('Escolhe pelo menos um dia da semana.'); return; }
    if (nota.length > NOTA_MAX) { showError(`A nota não pode passar de ${NOTA_MAX} caracteres.`); return; }

    setEnviando(true);
    try {
      // Nunca um segundo pedido pendente para a mesma disciplina — verifica
      // sempre contra o servidor (não contra o que está carregado no ecrã,
      // que pode não incluir pedidos antigos fora da página atual).
      const { data: pendentes, error: erroPendentes } = await supabase
        .from('mensagens')
        .select('id')
        .eq('aluno_id', alunoId)
        .eq('tipo', 'pedido_explicacao')
        .eq('estado', 'pendente')
        .eq('payload->>disciplina_id', disciplinaId)
        .limit(1);

      if (erroPendentes) {
        showError('Não foi possível verificar pedidos existentes: ' + erroPendentes.message);
        return;
      }
      if (pendentes && pendentes.length > 0) {
        showError('Já tens um pedido pendente para esta disciplina.');
        return;
      }

      const disciplina = disciplinas.find((d) => String(d.id) === disciplinaId);
      const { data, error } = await supabase
        .from('mensagens')
        .insert({
          aluno_id: alunoId,
          tipo: 'pedido_explicacao',
          payload: {
            disciplina_id: Number(disciplinaId),
            disciplina: disciplina?.name ?? '',
            ano_escolar: anoEscolar,
            dias,
            horario: horario.trim() || null,
            nota: nota.trim() || null,
          },
        })
        .select()
        .single();

      if (error) {
        showError('Não foi possível enviar o pedido: ' + error.message);
        return;
      }

      onCriado(data as Mensagem);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface border border-border w-full max-w-md rounded-3xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-primary flex items-center gap-2"><HelpCircle className="text-accent" size={20} /> Pedir Explicação</h2>
          <button onClick={onClose} className="text-muted hover:text-primary transition-colors"><X size={20} /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-muted uppercase ml-1">Disciplina</label>
            <select
              value={disciplinaId}
              onChange={(e) => setDisciplinaId(e.target.value)}
              className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1 appearance-none"
            >
              <option value="">Escolhe a disciplina</option>
              {disciplinas.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-muted uppercase ml-1">Dias da semana</label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {DIAS_SEMANA.map((d) => (
                <button
                  key={d.valor}
                  type="button"
                  onClick={() => toggleDia(d.valor)}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
                    dias.includes(d.valor) ? 'bg-accent text-on-accent border-accent' : 'bg-page text-muted border-border'
                  }`}
                >
                  {d.rotulo}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-muted uppercase ml-1">Horário que dá jeito</label>
            <input
              type="text"
              value={horario}
              onChange={(e) => setHorario(e.target.value)}
              placeholder="Ex: depois das 18h"
              maxLength={120}
              className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1 text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-muted uppercase ml-1">Nota (opcional)</label>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={3}
              maxLength={NOTA_MAX}
              placeholder="Algo que ajude o centro a preparar a sessão..."
              className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1 resize-none text-sm"
            />
          </div>
        </div>

        <button
          onClick={handleCriar}
          disabled={enviando || !disciplinaId || dias.length === 0}
          className="w-full mt-6 bg-accent hover:bg-accent-hover text-on-accent p-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
        >
          {enviando ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
          Enviar Pedido
        </button>
      </div>
    </div>
  );
}
