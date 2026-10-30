'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { contarAlteracoesPorVer } from '@/lib/alteracoes';
import { avisarAlteracoesVistas } from '@/lib/eventoAlteracoesAdmin';
import {
  Bell, Loader2, CalendarX, CalendarCheck, CalendarDays, UserCog, Eye, RotateCcw, CheckCheck,
} from 'lucide-react';

type Tipo = 'cancelada' | 'reativada' | 'horario' | 'professor';

type LinhaAlteracao = {
  id: string;
  centro_id: string;
  explicacao_id: string;
  tipo: Tipo;
  antes: Record<string, any> | null;
  depois: Record<string, any> | null;
  motivo: string | null;
  autor_id: string | null;
  contexto: { disciplina?: string; data?: string; hora_inicio?: string; alunos?: string[]; professor?: string; professor_antigo?: string } | null;
  criada_em: string;
  revertida_em: string | null;
  revertida_por: string | null;
  vista_em: string | null;
  vista_por: string | null;
};

type AvisoFamilia = { total: number; lidas: number };

const LIMITE_FETCH = 300;
const PAGINA = 30;

const ROTULO_TIPO: Record<Tipo, string> = {
  cancelada: 'Cancelada',
  reativada: 'Reposta',
  horario: 'Mudou de hora/dia',
  professor: 'Trocou de professor',
};

const CLASSES_TIPO: Record<Tipo, string> = {
  cancelada: 'bg-danger-bg text-danger',
  reativada: 'bg-success-bg text-success',
  horario: 'bg-warning-bg text-warning',
  professor: 'bg-purple-500/10 text-purple-500',
};

const ICONE_TIPO: Record<Tipo, typeof CalendarX> = {
  cancelada: CalendarX,
  reativada: CalendarCheck,
  horario: CalendarDays,
  professor: UserCog,
};

function capitalizar(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function formatarHoraCurta(h: string | null | undefined): string {
  return h ? h.slice(0, 5) : '';
}

function formatarDataHoraCompacta(dataISO: string | null | undefined, hora: string | null | undefined): string {
  if (!dataISO || !hora) return '—';
  try {
    return `${format(new Date(`${dataISO}T00:00:00`), 'dd/MM')} ${formatarHoraCurta(hora)}`;
  } catch {
    return '—';
  }
}

/** "Ativa → Cancelada" / "12/03 15:00 → 13/03 16:00" / "Prof A → Prof B" — nunca parte o ecrã com formas inesperadas de antes/depois. */
function resumoAntesDepois(linha: LinhaAlteracao): string {
  const antes = linha.antes || {};
  const depois = linha.depois || {};
  if (linha.tipo === 'cancelada' || linha.tipo === 'reativada') {
    const a = typeof antes.estado === 'string' ? capitalizar(antes.estado) : '—';
    const d = typeof depois.estado === 'string' ? capitalizar(depois.estado) : '—';
    return `${a} → ${d}`;
  }
  if (linha.tipo === 'horario') {
    const de = formatarDataHoraCompacta(antes.data, antes.hora_inicio);
    const para = formatarDataHoraCompacta(depois.data, depois.hora_inicio);
    return `${de} → ${para}`;
  }
  if (linha.tipo === 'professor') {
    const antigo = linha.contexto?.professor_antigo || '—';
    const novo = linha.contexto?.professor || '—';
    return `${antigo} → ${novo}`;
  }
  return '—';
}

export default function AlteracoesExplicacoesPage() {
  const { toast, showError, showSuccess } = useStatusToast();

  const [loadingPagina, setLoadingPagina] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [centroId, setCentroId] = useState<string | null>(null);

  const [loadingLista, setLoadingLista] = useState(false);
  const [linhas, setLinhas] = useState<LinhaAlteracao[] | null>(null);
  const [avisosPorAlteracao, setAvisosPorAlteracao] = useState<Map<string, AvisoFamilia>>(new Map());
  const [staffMap, setStaffMap] = useState<Map<string, string>>(new Map());
  const [totalPorVer, setTotalPorVer] = useState(0);

  const [filtroVista, setFiltroVista] = useState<'por_ver' | 'todas'>('por_ver');
  const [filtroTipo, setFiltroTipo] = useState<Tipo | ''>('');
  const [visivel, setVisivel] = useState(PAGINA);

  const [marcandoId, setMarcandoId] = useState<string | null>(null);
  const [marcandoTodas, setMarcandoTodas] = useState(false);
  const [revertendoId, setRevertendoId] = useState<string | null>(null);

  const podeReverter = role === 'admin';

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setRole(user?.app_metadata?.role?.toLowerCase() ?? null);
      setUserId(user?.id ?? null);
      setCentroId(user?.app_metadata?.centro_id ?? null);
      setLoadingPagina(false);
    });
  }, []);

  const carregarTudo = useCallback(async (centro_id: string) => {
    setLoadingLista(true);
    try {
      const [{ data: alteracoesData, error: erroAlteracoes }, { data: mensagensData, error: erroMensagens }, { data: staffData }, total] = await Promise.all([
        supabase.from('explicacoes_alteracoes').select('*').eq('centro_id', centro_id).order('criada_em', { ascending: false }).limit(LIMITE_FETCH),
        supabase.from('mensagens').select('payload, lida_pela_familia_em').eq('centro_id', centro_id).eq('tipo', 'alteracao_explicacao').limit(2000),
        supabase.from('staff').select('id, name').eq('centro_id', centro_id),
        contarAlteracoesPorVer(supabase, centro_id),
      ]);

      if (erroAlteracoes || erroMensagens) {
        showError('Não foi possível carregar as alterações: ' + (erroAlteracoes || erroMensagens)!.message);
        return;
      }

      setLinhas((alteracoesData || []) as LinhaAlteracao[]);
      setStaffMap(new Map((staffData || []).map((s: any) => [s.id, s.name])));
      setTotalPorVer(total);

      const mapa = new Map<string, AvisoFamilia>();
      for (const m of (mensagensData || []) as any[]) {
        const alteracaoId = m.payload?.alteracao_id;
        if (!alteracaoId || typeof alteracaoId !== 'string') continue;
        const atual = mapa.get(alteracaoId) || { total: 0, lidas: 0 };
        atual.total += 1;
        if (m.lida_pela_familia_em) atual.lidas += 1;
        mapa.set(alteracaoId, atual);
      }
      setAvisosPorAlteracao(mapa);
    } finally {
      setLoadingLista(false);
    }
  }, [showError]);

  useEffect(() => {
    if (centroId) carregarTudo(centroId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centroId]);

  // Reset de paginação ao trocar de filtro.
  useEffect(() => { setVisivel(PAGINA); }, [filtroVista, filtroTipo]);

  const linhasFiltradas = useMemo(() => {
    let lista = linhas || [];
    if (filtroVista === 'por_ver') lista = lista.filter((l) => !l.vista_em);
    if (filtroTipo) lista = lista.filter((l) => l.tipo === filtroTipo);
    return lista;
  }, [linhas, filtroVista, filtroTipo]);

  const linhasVisiveis = linhasFiltradas.slice(0, visivel);

  const nomeAutor = (autorId: string | null) => (autorId && staffMap.has(autorId)) ? staffMap.get(autorId)! : '—';

  const handleMarcarVista = async (id: string) => {
    if (marcandoId) return;
    setMarcandoId(id);
    try {
      const { error } = await supabase.rpc('marcar_alteracoes_vistas', { p_ids: [id] });
      if (error) {
        showError('Não foi possível marcar como vista: ' + error.message);
        return;
      }
      const agora = new Date().toISOString();
      setLinhas((prev) => (prev || []).map((l) => (l.id === id ? { ...l, vista_em: agora, vista_por: userId } : l)));
      setTotalPorVer((prev) => Math.max(0, prev - 1));
      avisarAlteracoesVistas();
    } finally {
      setMarcandoId(null);
    }
  };

  const handleMarcarTodasVistas = async () => {
    if (marcandoTodas) return;
    const ids = linhasFiltradas.filter((l) => !l.vista_em).map((l) => l.id);
    if (ids.length === 0) return;
    setMarcandoTodas(true);
    try {
      const { error } = await supabase.rpc('marcar_alteracoes_vistas', { p_ids: ids });
      if (error) {
        showError('Não foi possível marcar todas como vistas: ' + error.message);
        return;
      }
      const agora = new Date().toISOString();
      const idsSet = new Set(ids);
      setLinhas((prev) => (prev || []).map((l) => (idsSet.has(l.id) ? { ...l, vista_em: agora, vista_por: userId } : l)));
      setTotalPorVer((prev) => Math.max(0, prev - ids.length));
      avisarAlteracoesVistas();
      showSuccess(`${ids.length} alteração(ões) marcada(s) como vista(s).`);
    } finally {
      setMarcandoTodas(false);
    }
  };

  const handleReverter = async (linha: LinhaAlteracao) => {
    if (revertendoId || linha.revertida_em) return;
    if (!confirm('Reverter esta alteração? A sessão volta ao estado anterior.')) return;

    setRevertendoId(linha.id);
    try {
      const { error } = await supabase.rpc('reverter_alteracao', { p_alteracao: linha.id });
      if (error) {
        showError('Não foi possível reverter: ' + error.message);
        return;
      }
      const agora = new Date().toISOString();
      setLinhas((prev) => (prev || []).map((l) => (l.id === linha.id ? { ...l, revertida_em: agora, revertida_por: userId } : l)));
      showSuccess('Alteração revertida.');
    } finally {
      setRevertendoId(null);
    }
  };

  if (loadingPagina) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-primary flex items-center gap-2">
          <Bell className="text-accent" /> Alterações
        </h1>
        <p className="text-secondary text-sm">Cancelamentos, remarcações e trocas de professor nas explicações.</p>
      </div>

      <div className="bg-surface border border-border rounded-3xl shadow-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center bg-page border border-border rounded-2xl overflow-hidden p-1 w-fit">
            <button
              onClick={() => setFiltroVista('por_ver')}
              className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${filtroVista === 'por_ver' ? 'bg-accent text-on-accent' : 'text-secondary hover:text-primary'}`}
            >
              Por ver {totalPorVer > 0 ? `(${totalPorVer})` : ''}
            </button>
            <button
              onClick={() => setFiltroVista('todas')}
              className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${filtroVista === 'todas' ? 'bg-accent text-on-accent' : 'text-secondary hover:text-primary'}`}
            >
              Todas
            </button>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value as Tipo | '')}
              className="bg-page border border-border text-primary text-sm px-3 py-2.5 rounded-xl outline-none focus:border-accent transition-all"
            >
              <option value="">Todos os tipos</option>
              <option value="cancelada">Cancelada</option>
              <option value="reativada">Reposta</option>
              <option value="horario">Mudou de hora/dia</option>
              <option value="professor">Trocou de professor</option>
            </select>
            {linhasFiltradas.some((l) => !l.vista_em) && (
              <button
                onClick={handleMarcarTodasVistas}
                disabled={marcandoTodas}
                className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-on-accent px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all active:scale-95"
              >
                {marcandoTodas ? <Loader2 className="animate-spin" size={14} /> : <CheckCheck size={14} />} Marcar todas como vistas
              </button>
            )}
          </div>
        </div>

        {loadingLista || linhas === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-accent" /></div>
        ) : linhasFiltradas.length === 0 ? (
          <p className="text-muted text-sm text-center italic py-10">
            {filtroVista === 'por_ver' ? 'Sem alterações por ver.' : 'Sem alterações registadas.'}
          </p>
        ) : (
          <>
            {/* Desktop: tabela */}
            <div className="hidden md:block overflow-x-auto border border-border rounded-2xl">
              <table className="w-full text-sm">
                <thead className="bg-page text-muted uppercase text-[10px] font-black tracking-widest">
                  <tr>
                    <th className="p-3 text-left">Tipo</th>
                    <th className="p-3 text-left">Disciplina</th>
                    <th className="p-3 text-left">Data / Hora</th>
                    <th className="p-3 text-left">Alunos</th>
                    <th className="p-3 text-left">Antes → Depois</th>
                    <th className="p-3 text-left">Motivo</th>
                    <th className="p-3 text-left">Quem / Quando</th>
                    <th className="p-3 text-left">Aviso à família</th>
                    <th className="p-3 text-left w-48"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {linhasVisiveis.map((l) => (
                    <LinhaDesktop
                      key={l.id}
                      linha={l}
                      nomeAutor={nomeAutor(l.autor_id)}
                      aviso={avisosPorAlteracao.get(l.id)}
                      podeReverter={podeReverter}
                      marcando={marcandoId === l.id}
                      revertendo={revertendoId === l.id}
                      onMarcarVista={() => handleMarcarVista(l.id)}
                      onReverter={() => handleReverter(l)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: cartões */}
            <div className="md:hidden space-y-3">
              {linhasVisiveis.map((l) => (
                <CartaoMobile
                  key={l.id}
                  linha={l}
                  nomeAutor={nomeAutor(l.autor_id)}
                  aviso={avisosPorAlteracao.get(l.id)}
                  podeReverter={podeReverter}
                  marcando={marcandoId === l.id}
                  revertendo={revertendoId === l.id}
                  onMarcarVista={() => handleMarcarVista(l.id)}
                  onReverter={() => handleReverter(l)}
                />
              ))}
            </div>

            {linhasFiltradas.length > visivel && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => setVisivel((v) => v + PAGINA)}
                  className="text-[11px] font-black uppercase tracking-widest text-muted hover:text-primary bg-page border border-border px-4 py-2 rounded-full transition-all"
                >
                  Carregar mais
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <StatusToast toast={toast} />
    </div>
  );
}

function BadgeTipo({ tipo }: { tipo: Tipo }) {
  const Icone = ICONE_TIPO[tipo];
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${CLASSES_TIPO[tipo]}`}>
      <Icone size={11} /> {ROTULO_TIPO[tipo]}
    </span>
  );
}

function TextoAviso({ aviso }: { aviso: AvisoFamilia | undefined }) {
  if (!aviso || aviso.total === 0) return <span className="text-muted italic">Sem aviso à família</span>;
  return <span>{aviso.total} mensagem{aviso.total === 1 ? '' : 'ns'} · {aviso.lidas} lida{aviso.lidas === 1 ? '' : 's'}</span>;
}

type PropsLinha = {
  linha: LinhaAlteracao;
  nomeAutor: string;
  aviso: AvisoFamilia | undefined;
  podeReverter: boolean;
  marcando: boolean;
  revertendo: boolean;
  onMarcarVista: () => void;
  onReverter: () => void;
};

function Acoes({ linha, podeReverter, marcando, revertendo, onMarcarVista, onReverter }: PropsLinha) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {!linha.vista_em && (
        <button onClick={onMarcarVista} disabled={marcando} className="text-accent hover:underline text-[11px] font-black uppercase flex items-center gap-1">
          {marcando ? <Loader2 className="animate-spin" size={12} /> : <Eye size={12} />} Marcar vista
        </button>
      )}
      {podeReverter && (
        <button
          onClick={onReverter}
          disabled={revertendo || !!linha.revertida_em}
          title={linha.revertida_em ? 'Já revertida' : undefined}
          className="text-danger hover:underline text-[11px] font-black uppercase flex items-center gap-1 disabled:opacity-40 disabled:no-underline"
        >
          {revertendo ? <Loader2 className="animate-spin" size={12} /> : <RotateCcw size={12} />} {linha.revertida_em ? 'Revertida' : 'Reverter'}
        </button>
      )}
    </div>
  );
}

function LinhaDesktop(props: PropsLinha) {
  const { linha: l, nomeAutor, aviso } = props;
  const alunos = (l.contexto?.alunos || []).join(', ') || '—';
  return (
    <tr className="text-secondary hover:bg-raised/20 transition-colors align-top">
      <td className="p-3"><BadgeTipo tipo={l.tipo} /></td>
      <td className="p-3 font-bold text-primary whitespace-nowrap">{l.contexto?.disciplina || '—'}</td>
      <td className="p-3 whitespace-nowrap">{formatarDataHoraCompacta(l.contexto?.data, l.contexto?.hora_inicio)}</td>
      <td className="p-3">{alunos}</td>
      <td className="p-3 whitespace-nowrap font-mono text-xs">{resumoAntesDepois(l)}</td>
      <td className="p-3 max-w-[200px]">{l.motivo || <span className="text-muted">—</span>}</td>
      <td className="p-3 whitespace-nowrap">{nomeAutor}<br /><span className="text-[10px] text-muted">{format(new Date(l.criada_em), 'dd/MM/yyyy HH:mm')}</span></td>
      <td className="p-3 whitespace-nowrap"><TextoAviso aviso={aviso} /></td>
      <td className="p-3"><Acoes {...props} /></td>
    </tr>
  );
}

function CartaoMobile(props: PropsLinha) {
  const { linha: l, nomeAutor, aviso } = props;
  const alunos = (l.contexto?.alunos || []).join(', ') || '—';
  return (
    <div className="bg-page border border-border rounded-2xl p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-primary truncate">{l.contexto?.disciplina || '—'}</p>
          <p className="text-xs text-muted">{formatarDataHoraCompacta(l.contexto?.data, l.contexto?.hora_inicio)} · {alunos}</p>
        </div>
        <BadgeTipo tipo={l.tipo} />
      </div>
      <p className="text-xs font-mono text-secondary">{resumoAntesDepois(l)}</p>
      {l.motivo && <p className="text-xs text-muted italic">"{l.motivo}"</p>}
      <p className="text-xs text-muted">{nomeAutor} · {format(new Date(l.criada_em), 'dd/MM/yyyy HH:mm')}</p>
      <p className="text-xs"><TextoAviso aviso={aviso} /></p>
      <div className="pt-1"><Acoes {...props} /></div>
    </div>
  );
}
