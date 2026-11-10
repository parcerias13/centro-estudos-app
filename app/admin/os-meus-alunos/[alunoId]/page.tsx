'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { getHojeLisboa, dataLisboaDe, horaLisboaDe } from '@/lib/dataLisboa';
import { mesParaData } from '@/lib/custos';
import { buscarAlunosFixosAtivos, type AlunoFixo } from '@/lib/osMeusAlunos';
import {
  CATEGORIAS_MATERIAL, ACCEPT_MATERIAL, TAMANHO_MAXIMO_BYTES, type CategoriaMaterial, type MaterialAluno, type TipoPermitidoMaterial,
  validarFicheiroMaterial, validarTitulo, validarNota, carregarMaterial, listarMaterialProfessor, apagarMaterial,
  obterUrlAssinadaMaterial, rotuloCategoriaMaterial, formatarTamanhoFicheiro,
} from '@/lib/materialAluno';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import {
  ArrowLeft, Star, Loader2, Clock, ClipboardCheck, CalendarClock, GraduationCap, NotebookPen,
  Save, ShieldAlert, FolderOpen, Upload, Trash2, ExternalLink, Eye, EyeOff,
} from 'lucide-react';

const TEXTO_MAX_CADERNO = 5000;

function formatarDataCurta(dataISO: string): string {
  return format(new Date(`${dataISO}T00:00:00`), "d 'de' MMM", { locale: pt });
}

function formatarHoras(horas: number): string {
  const totalMinutos = Math.round(horas * 60);
  const h = Math.floor(totalMinutos / 60);
  const m = totalMinutos % 60;
  return m > 0 ? `${h} h ${m}` : `${h} h`;
}

type SessaoFutura = { id: string; data: string; hora_inicio: string };
type SessaoHistorico = { id: string; data: string; horas_dadas: number | null; notas: string | null };
type Exam = {
  id: string; subject_name: string; date: string; topics: string | null;
  nota_valor: number | null; nota_escala: string | null; nota_confirmada: boolean;
};

type Resumo = {
  proximasSessoes: SessaoFutura[];
  esteMesSessoes: number;
  esteMesHoras: number;
  proximoTeste: { subject_name: string; date: string } | null;
  ultimaNota: { data: string; notas: string } | null;
};

const HISTORICO_PAGINA = 20;

type Aba = 'resumo' | 'sessoes' | 'testes' | 'notas' | 'material';

export default function DetalheAlunoFixoPage() {
  const params = useParams<{ alunoId: string }>();
  const alunoId = params.alunoId;
  const { toast, showError, showSuccess } = useStatusToast();
  const hoje = getHojeLisboa();

  const [loadingPagina, setLoadingPagina] = useState(true);
  const [professorId, setProfessorId] = useState<string | null>(null);
  const [centroId, setCentroId] = useState<string | null>(null);

  const [loadingFixo, setLoadingFixo] = useState(true);
  const [fixo, setFixo] = useState<AlunoFixo | null>(null);

  const [aba, setAba] = useState<Aba>('resumo');

  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [loadingResumo, setLoadingResumo] = useState(false);

  const [historico, setHistorico] = useState<SessaoHistorico[]>([]);
  const [historicoCarregado, setHistoricoCarregado] = useState(false);
  const [temMaisHistorico, setTemMaisHistorico] = useState(true);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  const [testesFuturos, setTestesFuturos] = useState<Exam[]>([]);
  const [testesPassados, setTestesPassados] = useState<Exam[]>([]);
  const [testesCarregados, setTestesCarregados] = useState(false);
  const [carregandoTestes, setCarregandoTestes] = useState(false);

  const [cadernoTexto, setCadernoTexto] = useState('');
  const [cadernoAtualizadoEm, setCadernoAtualizadoEm] = useState<string | null>(null);
  const [cadernoCarregado, setCadernoCarregado] = useState(false);
  const [carregandoCaderno, setCarregandoCaderno] = useState(false);
  const [guardandoCaderno, setGuardandoCaderno] = useState(false);

  const [materialLista, setMaterialLista] = useState<MaterialAluno[]>([]);
  const [materialCarregado, setMaterialCarregado] = useState(false);
  const [carregandoMaterial, setCarregandoMaterial] = useState(false);

  const [formCategoria, setFormCategoria] = useState<CategoriaMaterial>('ficha_casa');
  const [formTitulo, setFormTitulo] = useState('');
  const [formNota, setFormNota] = useState('');
  const [ficheiroEscolhido, setFicheiroEscolhido] = useState<File | null>(null);
  const [tipoFicheiroEscolhido, setTipoFicheiroEscolhido] = useState<TipoPermitidoMaterial | null>(null);
  const [erroFicheiro, setErroFicheiro] = useState<string | null>(null);
  const [validandoFicheiro, setValidandoFicheiro] = useState(false);
  const [carregandoUpload, setCarregandoUpload] = useState(false);
  const [apagandoMaterialId, setApagandoMaterialId] = useState<string | null>(null);
  const [abrindoMaterialId, setAbrindoMaterialId] = useState<string | null>(null);
  const fileInputMaterialRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setProfessorId(user?.id ?? null);
      setCentroId(user?.app_metadata?.centro_id ?? null);
      setLoadingPagina(false);
    });
  }, []);

  useEffect(() => {
    if (!professorId || !alunoId) return;
    (async () => {
      setLoadingFixo(true);
      try {
        const fixos = await buscarAlunosFixosAtivos(supabase, professorId, hoje);
        setFixo(fixos.find((f) => f.alunoId === alunoId) ?? null);
      } catch (e: any) {
        showError('Erro ao verificar os teus alunos fixos: ' + e.message);
        setFixo(null);
      } finally {
        setLoadingFixo(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [professorId, alunoId]);

  const carregarResumo = useCallback(async () => {
    if (!professorId || !alunoId) return;
    setLoadingResumo(true);
    try {
      const primeiroDiaMes = mesParaData(hoje.slice(0, 7));

      const [
        { data: proximas, error: errProximas },
        { data: doMes, error: errMes },
        { data: teste, error: errTeste },
        { data: notas, error: errNotas },
      ] = await Promise.all([
        supabase
          .from('explicacoes')
          .select('id, data, hora_inicio, explicacoes_alunos!inner(aluno_id)')
          .eq('explicacoes_alunos.aluno_id', alunoId)
          .eq('professor_id', professorId)
          .eq('estado', 'ativa')
          .eq('dado', false)
          .gte('data', hoje)
          .order('data', { ascending: true })
          .order('hora_inicio', { ascending: true })
          .limit(3),
        supabase
          .from('explicacoes')
          .select('id, horas_dadas, explicacoes_alunos!inner(aluno_id)')
          .eq('explicacoes_alunos.aluno_id', alunoId)
          .eq('professor_id', professorId)
          .eq('dado', true)
          .gte('data', primeiroDiaMes)
          .lte('data', hoje),
        supabase
          .from('exams')
          .select('subject_name, date')
          .eq('aluno_id', alunoId)
          .gte('date', hoje)
          .order('date', { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('explicacoes')
          .select('data, notas, explicacoes_alunos!inner(aluno_id)')
          .eq('explicacoes_alunos.aluno_id', alunoId)
          .eq('professor_id', professorId)
          .eq('dado', true)
          .not('notas', 'is', null)
          .order('data', { ascending: false })
          .limit(10),
      ]);

      if (errProximas) throw errProximas;
      if (errMes) throw errMes;
      if (errTeste) throw errTeste;
      if (errNotas) throw errNotas;

      const ultimaNotaValida = ((notas || []) as any[]).find((s) => s.notas && s.notas.trim()) ?? null;

      setResumo({
        proximasSessoes: (proximas || []) as SessaoFutura[],
        esteMesSessoes: (doMes || []).length,
        esteMesHoras: (doMes || []).reduce((soma: number, s: any) => soma + (Number(s.horas_dadas) || 0), 0),
        proximoTeste: teste ?? null,
        ultimaNota: ultimaNotaValida ? { data: ultimaNotaValida.data, notas: ultimaNotaValida.notas } : null,
      });
    } catch (e: any) {
      showError('Erro ao carregar o resumo: ' + e.message);
    } finally {
      setLoadingResumo(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [professorId, alunoId, hoje]);

  useEffect(() => {
    if (fixo && !resumo) carregarResumo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixo]);

  const carregarHistorico = useCallback(async (offset: number) => {
    if (!professorId || !alunoId) return;
    setCarregandoHistorico(true);
    try {
      const { data, error } = await supabase
        .from('explicacoes')
        .select('id, data, horas_dadas, notas, explicacoes_alunos!inner(aluno_id)')
        .eq('explicacoes_alunos.aluno_id', alunoId)
        .eq('professor_id', professorId)
        .eq('dado', true)
        .order('data', { ascending: false })
        .range(offset, offset + HISTORICO_PAGINA - 1);

      if (error) throw error;
      const pagina = (data || []) as SessaoHistorico[];
      setHistorico((prev) => (offset === 0 ? pagina : [...prev, ...pagina]));
      setTemMaisHistorico(pagina.length === HISTORICO_PAGINA);
    } catch (e: any) {
      showError('Erro ao carregar o histórico de sessões: ' + e.message);
    } finally {
      setCarregandoHistorico(false);
      setHistoricoCarregado(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [professorId, alunoId]);

  useEffect(() => {
    if (fixo && aba === 'sessoes' && !historicoCarregado) carregarHistorico(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixo, aba, historicoCarregado]);

  const carregarTestes = useCallback(async () => {
    if (!alunoId) return;
    setCarregandoTestes(true);
    try {
      const { data, error } = await supabase
        .from('exams')
        .select('id, subject_name, date, topics, nota_valor, nota_escala, nota_confirmada')
        .eq('aluno_id', alunoId)
        .order('date', { ascending: false });

      if (error) throw error;
      const todos = (data || []) as Exam[];
      setTestesPassados(todos.filter((e) => e.date < hoje));
      setTestesFuturos(todos.filter((e) => e.date >= hoje).reverse());
    } catch (e: any) {
      showError('Erro ao carregar os testes: ' + e.message);
    } finally {
      setCarregandoTestes(false);
      setTestesCarregados(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alunoId, hoje]);

  useEffect(() => {
    if (fixo && aba === 'testes' && !testesCarregados) carregarTestes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixo, aba, testesCarregados]);

  const carregarCaderno = useCallback(async () => {
    if (!professorId || !alunoId) return;
    setCarregandoCaderno(true);
    try {
      const { data, error } = await supabase
        .from('notas_privadas_professor')
        .select('texto, atualizado_em')
        .eq('professor_id', professorId)
        .eq('aluno_id', alunoId)
        .maybeSingle();

      if (error) throw error;
      setCadernoTexto(data?.texto ?? '');
      setCadernoAtualizadoEm(data?.atualizado_em ?? null);
    } catch (e: any) {
      showError('Erro ao carregar o teu caderno: ' + e.message);
    } finally {
      setCarregandoCaderno(false);
      setCadernoCarregado(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [professorId, alunoId]);

  useEffect(() => {
    if (fixo && aba === 'notas' && !cadernoCarregado) carregarCaderno();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixo, aba, cadernoCarregado]);

  const handleGuardarCaderno = async () => {
    if (!professorId || !alunoId || !centroId || guardandoCaderno) return;
    setGuardandoCaderno(true);
    try {
      const { data, error } = await supabase
        .from('notas_privadas_professor')
        .upsert(
          { professor_id: professorId, aluno_id: alunoId, centro_id: centroId, texto: cadernoTexto.trim() },
          { onConflict: 'professor_id,aluno_id' }
        )
        .select('texto, atualizado_em')
        .single();

      if (error) throw error;
      setCadernoTexto(data.texto ?? '');
      setCadernoAtualizadoEm(data.atualizado_em ?? null);
      showSuccess('Caderno guardado.');
    } catch (e: any) {
      showError('Erro ao guardar o caderno: ' + e.message);
    } finally {
      setGuardandoCaderno(false);
    }
  };

  const carregarMaterialTab = useCallback(async () => {
    if (!professorId || !alunoId) return;
    setCarregandoMaterial(true);
    try {
      const lista = await listarMaterialProfessor(supabase, professorId, alunoId);
      setMaterialLista(lista);
    } catch (e: any) {
      showError('Erro ao carregar o material: ' + e.message);
    } finally {
      setCarregandoMaterial(false);
      setMaterialCarregado(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [professorId, alunoId]);

  useEffect(() => {
    if (fixo && aba === 'material' && !materialCarregado) carregarMaterialTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixo, aba, materialCarregado]);

  const limparFormMaterial = () => {
    setFormTitulo('');
    setFormNota('');
    setFicheiroEscolhido(null);
    setTipoFicheiroEscolhido(null);
    setErroFicheiro(null);
    if (fileInputMaterialRef.current) fileInputMaterialRef.current.value = '';
  };

  const handleEscolherFicheiroMaterial = async (file: File | null) => {
    setFicheiroEscolhido(null);
    setTipoFicheiroEscolhido(null);
    setErroFicheiro(null);
    if (!file) return;
    setValidandoFicheiro(true);
    try {
      const erro = await validarFicheiroMaterial(file);
      if (erro) {
        setErroFicheiro(erro);
        return;
      }
      setFicheiroEscolhido(file);
      setTipoFicheiroEscolhido(file.type as TipoPermitidoMaterial);
    } finally {
      setValidandoFicheiro(false);
    }
  };

  const handleCarregarMaterial = async () => {
    if (!professorId || !centroId || !alunoId || carregandoUpload) return;
    const erroTitulo = validarTitulo(formTitulo);
    if (erroTitulo) { showError(erroTitulo); return; }
    const erroNota = validarNota(formNota);
    if (erroNota) { showError(erroNota); return; }
    if (!ficheiroEscolhido || !tipoFicheiroEscolhido) { showError('Escolhe um ficheiro.'); return; }

    setCarregandoUpload(true);
    try {
      const novo = await carregarMaterial(supabase, {
        file: ficheiroEscolhido,
        tipo: tipoFicheiroEscolhido,
        centroId,
        alunoId,
        professorId,
        categoria: formCategoria,
        titulo: formTitulo,
        nota: formNota,
      });
      setMaterialLista((atual) => [novo, ...atual]);
      limparFormMaterial();
      setFormCategoria('ficha_casa');
      showSuccess('Material carregado.');
    } catch (e: any) {
      showError('Erro ao carregar o material: ' + e.message);
    } finally {
      setCarregandoUpload(false);
    }
  };

  const handleAbrirMaterial = (material: MaterialAluno) => {
    if (abrindoMaterialId) return;
    // Separador aberto de forma SÍNCRONA dentro do clique — Safari bloqueia
    // window.open() depois de um await, mesmo dentro de um handler de clique.
    const novaJanela = window.open('', '_blank');
    if (!novaJanela) {
      showError('O browser bloqueou o separador. Permite pop-ups para abrir ficheiros.');
      return;
    }
    try { novaJanela.opener = null; } catch {}
    setAbrindoMaterialId(material.id);
    (async () => {
      try {
        const { url, erro } = await obterUrlAssinadaMaterial(supabase, material.caminho);
        if (!url) {
          novaJanela.close();
          showError('Não foi possível abrir o ficheiro: ' + erro);
          return;
        }
        novaJanela.location.href = url;
      } catch (e: any) {
        novaJanela.close();
        showError('Não foi possível abrir o ficheiro: ' + (e?.message || 'erro inesperado'));
      } finally {
        setAbrindoMaterialId(null);
      }
    })();
  };

  const handleApagarMaterial = async (material: MaterialAluno) => {
    if (apagandoMaterialId) return;
    if (!confirm(`Apagar "${material.titulo}"? Esta ação não pode ser desfeita.`)) return;
    setApagandoMaterialId(material.id);
    try {
      const { avisoFicheiro } = await apagarMaterial(supabase, material);
      setMaterialLista((atual) => atual.filter((m) => m.id !== material.id));
      if (avisoFicheiro) showError(avisoFicheiro);
      else showSuccess('Material apagado.');
    } catch (e: any) {
      showError('Erro ao apagar o material: ' + e.message);
    } finally {
      setApagandoMaterialId(null);
    }
  };

  if (loadingPagina || loadingFixo) {
    return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;
  }

  if (!fixo) {
    return (
      <div className="min-h-screen bg-page flex flex-col items-center justify-center p-8 text-center gap-4">
        <ShieldAlert size={48} className="text-muted" />
        <p className="text-muted font-bold">Este aluno não está nas tuas explicações fixas.</p>
        <Link
          href="/admin/os-meus-alunos"
          className="inline-flex items-center gap-2 min-h-11 px-5 py-3 bg-accent hover:bg-accent-hover text-on-accent rounded-2xl font-black text-sm transition-all active:scale-95"
        >
          <ArrowLeft size={16} /> Voltar à lista
        </Link>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-page text-primary p-6 md:p-8 max-w-4xl mx-auto font-sans">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/os-meus-alunos" className="p-3 bg-surface border border-border rounded-2xl hover:bg-raised transition-colors shrink-0">
          <ArrowLeft size={20} className="text-secondary" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-black italic tracking-tighter uppercase flex items-center gap-2 flex-wrap break-words">
            {fixo.nome}
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-success-bg text-success border border-success/30 shrink-0">
              <Star size={10} /> Fixo
            </span>
          </h1>
          <p className="text-muted text-[10px] font-black uppercase tracking-widest mt-1 break-words">
            {fixo.anoEscolar ? `${fixo.anoEscolar}.º ano` : 'Ano não definido'}
            {fixo.disciplinas.length > 0 ? ` · ${fixo.disciplinas.join(', ')}` : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 bg-page border border-border rounded-2xl p-1.5 mb-6">
        {[
          { id: 'resumo' as const, label: 'Resumo', icon: ClipboardCheck },
          { id: 'sessoes' as const, label: 'Sessões', icon: CalendarClock },
          { id: 'testes' as const, label: 'Testes', icon: GraduationCap },
          { id: 'notas' as const, label: 'As minhas notas', icon: NotebookPen },
          { id: 'material' as const, label: 'Material', icon: FolderOpen },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setAba(t.id)}
            className={`min-h-11 flex items-center gap-1.5 px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all whitespace-nowrap ${
              aba === t.id ? 'bg-accent text-on-accent' : 'text-secondary hover:text-primary'
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {aba === 'resumo' && (
        loadingResumo || !resumo ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent" size={28} /></div>
        ) : (
          <div className="space-y-4">
            <div className="bg-surface border border-border rounded-3xl p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Próxima sessão</p>
              {resumo.proximasSessoes.length > 0 ? (
                <p className="text-primary font-bold flex items-center gap-1.5">
                  <Clock size={14} className="text-accent shrink-0" />
                  {formatarDataCurta(resumo.proximasSessoes[0].data)} · {resumo.proximasSessoes[0].hora_inicio.slice(0, 5)}
                </p>
              ) : (
                <p className="text-muted italic">Sem sessão marcada</p>
              )}
            </div>

            <div className="bg-surface border border-border rounded-3xl p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Este mês</p>
              <p className="text-primary font-bold">
                {resumo.esteMesSessoes} {resumo.esteMesSessoes === 1 ? 'sessão dada' : 'sessões dadas'}, {formatarHoras(resumo.esteMesHoras)}
              </p>
            </div>

            <div className="bg-surface border border-border rounded-3xl p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Próximo teste</p>
              {resumo.proximoTeste ? (
                <p className="text-primary font-bold">{resumo.proximoTeste.subject_name} · {formatarDataCurta(resumo.proximoTeste.date)}</p>
              ) : (
                <p className="text-muted italic">Sem testes marcados</p>
              )}
            </div>

            <div className="bg-surface border border-border rounded-3xl p-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Última nota de sessão</p>
              {resumo.ultimaNota ? (
                <p className="text-primary break-words">{resumo.ultimaNota.notas}</p>
              ) : (
                <p className="text-muted italic">Ainda sem notas de sessão.</p>
              )}
            </div>
          </div>
        )
      )}

      {aba === 'sessoes' && (
        <div className="space-y-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Próximas</p>
            {!resumo ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin text-accent" size={20} /></div>
            ) : resumo.proximasSessoes.length === 0 ? (
              <p className="text-muted italic text-sm">Sem sessões futuras marcadas.</p>
            ) : (
              <div className="space-y-2">
                {resumo.proximasSessoes.map((s) => (
                  <div key={s.id} className="bg-surface border border-border rounded-2xl p-4 flex items-center gap-2">
                    <Clock size={14} className="text-accent shrink-0" />
                    <p className="text-sm font-bold text-primary">{formatarDataCurta(s.data)} · {s.hora_inicio.slice(0, 5)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Histórico</p>
            {!historicoCarregado ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin text-accent" size={20} /></div>
            ) : historico.length === 0 ? (
              <p className="text-muted italic text-sm">Sem sessões dadas ainda.</p>
            ) : (
              <div className="space-y-2">
                {historico.map((s) => (
                  <div key={s.id} data-sessao-historico={s.id} className="bg-surface border border-border rounded-2xl p-4 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-primary">{formatarDataCurta(s.data)}</p>
                      <p className="text-xs text-muted font-bold">{s.horas_dadas != null ? formatarHoras(Number(s.horas_dadas)) : '—'}</p>
                    </div>
                    {s.notas && <p className="text-xs text-secondary break-words">{s.notas}</p>}
                  </div>
                ))}
                {temMaisHistorico && (
                  <button
                    onClick={() => carregarHistorico(historico.length)}
                    disabled={carregandoHistorico}
                    className="w-full min-h-11 flex items-center justify-center gap-2 bg-surface border border-border hover:bg-raised text-secondary px-4 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-50"
                  >
                    {carregandoHistorico ? <Loader2 className="animate-spin" size={14} /> : null} Ver mais
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {aba === 'testes' && (
        carregandoTestes && !testesCarregados ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent" size={28} /></div>
        ) : (
          <div className="space-y-6">
            <ListaTestes titulo="Próximos" testes={testesFuturos} vazio="Sem testes marcados." />
            <ListaTestes titulo="Passados" testes={testesPassados} vazio="Sem testes passados." />
          </div>
        )
      )}

      {aba === 'notas' && (
        carregandoCaderno && !cadernoCarregado ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-accent" size={28} /></div>
        ) : (
          <div className="bg-surface border border-border rounded-3xl p-5 space-y-3">
            <p className="text-xs text-muted italic">Só tu vês isto. Fica guardado para as próximas sessões.</p>
            <textarea
              value={cadernoTexto}
              onChange={(e) => setCadernoTexto(e.target.value.slice(0, TEXTO_MAX_CADERNO))}
              maxLength={TEXTO_MAX_CADERNO}
              rows={10}
              placeholder="As tuas notas sobre este aluno..."
              className="w-full bg-page border border-border text-primary p-4 rounded-2xl outline-none focus:border-accent text-sm resize-y min-h-40"
            />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[10px] text-muted font-bold">
                {cadernoAtualizadoEm
                  ? `Guardado em ${formatarDataCurta(dataLisboaDe(cadernoAtualizadoEm))} às ${horaLisboaDe(cadernoAtualizadoEm)}`
                  : 'Ainda não guardaste nada.'}
              </p>
              <button
                onClick={handleGuardarCaderno}
                disabled={guardandoCaderno}
                className="min-h-11 flex items-center gap-2 bg-accent hover:bg-accent-hover text-on-accent px-5 py-3 rounded-2xl font-black text-sm transition-all active:scale-95 disabled:opacity-50"
              >
                {guardandoCaderno ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Guardar
              </button>
            </div>
          </div>
        )
      )}

      {aba === 'material' && (
        <div className="space-y-6">
          <div className="bg-surface border border-border rounded-3xl p-5 space-y-4">
            <p className="text-sm font-black text-primary flex items-center gap-2"><Upload size={16} className="text-accent" /> Novo material</p>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-muted mb-1.5 block">Categoria</label>
              <select
                value={formCategoria}
                onChange={(e) => setFormCategoria(e.target.value as CategoriaMaterial)}
                className="w-full bg-page border border-border text-primary p-3 rounded-2xl outline-none focus:border-accent text-sm"
              >
                {CATEGORIAS_MATERIAL.map((c) => (
                  <option key={c.id} value={c.id}>{c.rotulo}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-muted mb-1.5 block">Título</label>
              <input
                type="text"
                value={formTitulo}
                onChange={(e) => setFormTitulo(e.target.value.slice(0, 120))}
                maxLength={120}
                placeholder="Ex.: Ficha de revisão — Capítulo 3"
                className="w-full bg-page border border-border text-primary p-3 rounded-2xl outline-none focus:border-accent text-sm"
              />
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-muted mb-1.5 block">Nota (opcional)</label>
              <textarea
                value={formNota}
                onChange={(e) => setFormNota(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={3}
                placeholder="Observações para o aluno..."
                className="w-full bg-page border border-border text-primary p-3 rounded-2xl outline-none focus:border-accent text-sm resize-y"
              />
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-muted mb-1.5 block">Ficheiro</label>
              <input
                ref={fileInputMaterialRef}
                type="file"
                accept={ACCEPT_MATERIAL}
                onChange={(e) => handleEscolherFicheiroMaterial(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-secondary file:mr-3 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:bg-accent file:text-on-accent file:font-black file:text-xs file:uppercase file:tracking-widest"
              />
              <p className="text-[10px] text-muted mt-1.5">PDF, JPEG, PNG, DOC ou DOCX · máx. {formatarTamanhoFicheiro(TAMANHO_MAXIMO_BYTES)}</p>
              {validandoFicheiro && <p className="text-[10px] text-muted mt-1.5 flex items-center gap-1"><Loader2 className="animate-spin" size={10} /> A validar ficheiro...</p>}
              {erroFicheiro && <p className="text-xs text-danger font-bold mt-1.5">{erroFicheiro}</p>}
              {ficheiroEscolhido && !erroFicheiro && (
                <p className="text-xs text-success font-bold mt-1.5">{ficheiroEscolhido.name} · {formatarTamanhoFicheiro(ficheiroEscolhido.size)}</p>
              )}
            </div>

            <button
              onClick={handleCarregarMaterial}
              disabled={carregandoUpload || validandoFicheiro || !ficheiroEscolhido}
              className="w-full min-h-11 flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-on-accent px-5 py-3 rounded-2xl font-black text-sm transition-all active:scale-95 disabled:opacity-50"
            >
              {carregandoUpload ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />} Carregar
            </button>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Material carregado</p>
            {carregandoMaterial && !materialCarregado ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin text-accent" size={20} /></div>
            ) : materialLista.length === 0 ? (
              <p className="text-muted italic text-sm">Ainda não carregaste material para este aluno.</p>
            ) : (
              <div className="space-y-2">
                {materialLista.map((m) => (
                  <div key={m.id} data-material-item={m.id} className="bg-surface border border-border rounded-2xl p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-primary break-words">{m.titulo}</p>
                        <p className="text-[10px] text-muted font-black uppercase tracking-widest mt-0.5">
                          {rotuloCategoriaMaterial(m.categoria)} · {formatarDataCurta(dataLisboaDe(m.criado_em))} · {formatarTamanhoFicheiro(m.tamanho)}
                        </p>
                      </div>
                      <span className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                        m.visto_em ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'
                      }`}>
                        {m.visto_em ? <><Eye size={10} /> Visto pelo aluno</> : <><EyeOff size={10} /> Ainda não visto</>}
                      </span>
                    </div>
                    {m.nota && <p className="text-xs text-secondary break-words">{m.nota}</p>}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => handleAbrirMaterial(m)}
                        disabled={abrindoMaterialId === m.id}
                        className="min-h-9 flex items-center gap-1.5 bg-page border border-border hover:border-accent text-secondary px-3 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-50"
                      >
                        {abrindoMaterialId === m.id ? <Loader2 className="animate-spin" size={11} /> : <ExternalLink size={11} />} Abrir
                      </button>
                      <button
                        onClick={() => handleApagarMaterial(m)}
                        disabled={apagandoMaterialId === m.id}
                        className="min-h-9 flex items-center gap-1.5 bg-danger-bg border border-danger/30 hover:bg-danger/10 text-danger px-3 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all disabled:opacity-50"
                      >
                        {apagandoMaterialId === m.id ? <Loader2 className="animate-spin" size={11} /> : <Trash2 size={11} />} Apagar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <StatusToast toast={toast} />
    </main>
  );
}

function ListaTestes({ titulo, testes, vazio }: { titulo: string; testes: Exam[]; vazio: string }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">{titulo}</p>
      {testes.length === 0 ? (
        <p className="text-muted italic text-sm">{vazio}</p>
      ) : (
        <div className="space-y-2">
          {testes.map((exam) => (
            <div key={exam.id} data-teste-exam={exam.id} className="bg-surface border border-border rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-bold text-primary break-words">{exam.subject_name} · {formatarDataCurta(exam.date)}</p>
                {exam.topics && <p className="text-xs text-muted break-words">{exam.topics}</p>}
              </div>
              <NotaTesteEtiqueta exam={exam} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotaTesteEtiqueta({ exam }: { exam: Exam }) {
  if (exam.nota_valor == null) {
    return <span className="shrink-0 text-xs text-muted font-bold">—</span>;
  }
  if (!exam.nota_confirmada) {
    return (
      <span className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-warning-bg text-warning">
        Por confirmar
      </span>
    );
  }
  return (
    <span className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-success-bg text-success">
      {exam.nota_valor}/{exam.nota_escala}
    </span>
  );
}
