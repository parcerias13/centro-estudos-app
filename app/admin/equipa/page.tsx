'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Shield, Plus, Trash2, Loader2, Save, Mail, User, Lock, X, AlertTriangle, Pencil, CalendarClock } from 'lucide-react';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { getHojeLisboa } from '@/lib/dataLisboa';
import { estadoCustoFixoNoMes, mesParaData, mensagemErroCusto, type PeriodoCustoFixo } from '@/lib/custos';
import { obterPeriodosDoProfessor, tipoNoMes, type TipoRemuneracaoMes } from '@/lib/remuneracaoProfessores';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

// 'AAAA-MM' ou 'AAAA-MM-DD' -> "Mar 2026" — só os primeiros 7 caracteres importam.
function formatarMesAno(valor: string) {
  const mes = valor.slice(0, 7);
  return format(new Date(`${mes}-01T00:00:00`), 'MMM yyyy', { locale: pt });
}

type ModoFormPeriodo = 'valor' | 'terminar';
type FormPeriodoAberto = { tipo: 'salario' | 'valor_dia'; modo: ModoFormPeriodo } | null;

// Editor de um período (salário mensal OU valor por dia de trabalho) — mesmo
// padrão visual de Gestão → Custos (alterar/terminar a partir de um mês),
// reutilizado aqui duas vezes dentro do mesmo modal.
function BlocoPeriodoRemuneracao({
  periodos,
  mesAtual,
  sufixo,
  formAberto,
  formModo,
  onAbrirValor,
  onAbrirTerminar,
  onFechar,
  formDe,
  setFormDe,
  formValor,
  setFormValor,
  onConfirmar,
  salvando,
  notaBloqueio,
}: {
  periodos: PeriodoCustoFixo[];
  mesAtual: string;
  sufixo: string;
  formAberto: boolean;
  formModo?: ModoFormPeriodo;
  onAbrirValor: () => void;
  onAbrirTerminar: () => void;
  onFechar: () => void;
  formDe: string;
  setFormDe: (v: string) => void;
  formValor: string;
  setFormValor: (v: string) => void;
  onConfirmar: () => void;
  salvando: boolean;
  notaBloqueio?: string;
}) {
  const estado = estadoCustoFixoNoMes(periodos, mesAtual);
  const temHistorico = periodos.length > 0;

  return (
    <div className="space-y-3">
      {notaBloqueio && (
        <p className="text-[10px] text-warning font-bold flex items-center gap-1.5 bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
          <AlertTriangle size={12} className="shrink-0" /> {notaBloqueio}
        </p>
      )}

      {estado.estado === 'ativo' ? (
        <>
          <p className="text-2xl font-black text-primary tracking-tighter">
            {Number(estado.valor).toFixed(2)}€{sufixo}
          </p>
          {!formAberto && (
            <div className="flex gap-3">
              <button type="button" onClick={onAbrirValor} className="text-[10px] font-black text-accent hover:text-accent-hover">
                Alterar valor a partir de...
              </button>
              <button type="button" onClick={onAbrirTerminar} className="text-[10px] font-black text-danger hover:text-danger/80">
                Terminar a partir de...
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted italic">
            {estado.estado === 'terminado' ? `Terminado em ${formatarMesAno(estado.terminouEm!)}` : 'Ainda sem valor definido.'}
          </p>
          {!formAberto && (
            <button type="button" onClick={onAbrirValor} className="text-[10px] font-black text-accent hover:text-accent-hover">
              Definir valor a partir de...
            </button>
          )}
        </>
      )}

      {formAberto && (
        <div className="bg-surface border border-border p-4 rounded-xl space-y-3">
          <div>
            <label className="text-[10px] font-bold text-muted uppercase ml-1">Mês</label>
            <input
              type="month"
              value={formDe}
              onChange={(e) => setFormDe(e.target.value)}
              className="w-full bg-page border border-border text-primary p-2.5 rounded-lg outline-none focus:border-accent text-sm mt-1"
            />
          </div>
          {formModo !== 'terminar' && (
            <div>
              <label className="text-[10px] font-bold text-muted uppercase ml-1">Valor (€){sufixo}</label>
              <input
                type="number"
                step="0.01"
                value={formValor}
                onChange={(e) => setFormValor(e.target.value)}
                placeholder="0.00"
                className="w-full bg-page border border-border text-primary p-2.5 rounded-lg outline-none focus:border-accent text-sm mt-1"
              />
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirmar}
              disabled={salvando}
              className="flex-1 bg-accent hover:bg-accent-hover text-on-accent text-xs font-black py-2.5 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {salvando ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
              {formModo === 'terminar' ? 'Terminar' : 'Guardar'}
            </button>
            <button type="button" onClick={onFechar} disabled={salvando} className="px-4 text-xs font-black text-muted hover:text-secondary">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {temHistorico && (
        <div className="space-y-1.5 pt-3 border-t border-border">
          <p className="text-[9px] font-black uppercase text-muted tracking-widest">Histórico</p>
          {[...periodos]
            .sort((a, b) => b.de.localeCompare(a.de))
            .map((p, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] bg-surface border border-border/60 rounded-lg px-3 py-1.5">
                <span className="text-secondary font-bold">
                  {formatarMesAno(p.de)} — {p.ate ? formatarMesAno(p.ate) : 'em aberto'}
                </span>
                <span className="font-mono font-bold text-primary">{Number(p.valor).toFixed(2)}€</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export default function AdminTeam() {
  const { toast, showError, showSuccess } = useStatusToast();
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Formulário
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('professor');
  const [password, setPassword] = useState(''); // ESTADO MOVIDO PARA DENTRO

  // Tipo de remuneração atual (implícito, por mês) de cada professor — para
  // a etiqueta na lista e para excluir professores de salário do aviso de
  // "tarifa não definida" (nunca precisam de tarifa).
  const [tipoAtualPorProfessor, setTipoAtualPorProfessor] = useState<Record<string, TipoRemuneracaoMes>>({});

  // Tarifa do professor (modal "Remuneração de {nome}")
  const [tarifaModalMember, setTarifaModalMember] = useState<any | null>(null);
  const [tarifaTipo, setTarifaTipo] = useState('');
  const [tarifaValor, setTarifaValor] = useState('');
  const [tarifaEscalaAluno, setTarifaEscalaAluno] = useState(false);
  const [savingTarifa, setSavingTarifa] = useState(false);

  // Tipo de remuneração selecionado DENTRO do modal (só decide que secção
  // mostrar — a mudança de tipo real só acontece ao definir/terminar um
  // período, nunca aqui).
  const [tipoRemuneracaoSelecionado, setTipoRemuneracaoSelecionado] = useState<TipoRemuneracaoMes>('variavel');
  const [periodosSalario, setPeriodosSalario] = useState<PeriodoCustoFixo[]>([]);
  const [periodosValorDia, setPeriodosValorDia] = useState<PeriodoCustoFixo[]>([]);
  const [loadingPeriodos, setLoadingPeriodos] = useState(false);
  const [periodoFormAberto, setPeriodoFormAberto] = useState<FormPeriodoAberto>(null);
  const [periodoFormDe, setPeriodoFormDe] = useState('');
  const [periodoFormValor, setPeriodoFormValor] = useState('');
  const [salvandoPeriodo, setSalvandoPeriodo] = useState(false);

  // Sessões já dadas por professores sem tarifa definida — aviso, não bloqueio
  // (ver /admin/explicacoes: dado=true sem tarifa grava valor_calculado=0€ em silêncio).
  // Um professor de salário nunca entra aqui: não precisa de tarifa nenhuma.
  const [sessoesSemTarifaCount, setSessoesSemTarifaCount] = useState<Record<string, number>>({});

  // Exceções de tarifa por disciplina/ano (tarifas_professor_disciplina)
  const [subjects, setSubjects] = useState<any[]>([]);
  const [excecoes, setExcecoes] = useState<any[]>([]);
  const [loadingExcecoes, setLoadingExcecoes] = useState(false);
  const [excecaoEditandoId, setExcecaoEditandoId] = useState<string | null>(null); // null = formulário fechado, 'novo' = a criar
  const [excecaoDisciplinaId, setExcecaoDisciplinaId] = useState('');
  const [excecaoAno, setExcecaoAno] = useState(''); // '' = todos os anos
  const [excecaoTipo, setExcecaoTipo] = useState('');
  const [excecaoValor, setExcecaoValor] = useState('');
  const [excecaoEscalaAluno, setExcecaoEscalaAluno] = useState(false);
  const [savingExcecao, setSavingExcecao] = useState(false);

  const mesAtual = getHojeLisboa().slice(0, 7);

  const fetchTeam = async () => {
    const { data } = await supabase.from('staff').select('*').order('name');
    if (data) setTeam(data);
    setLoading(false);

    const professorIds = (data || []).filter((m) => m.role?.toLowerCase() === 'professor').map((m) => m.id);

    let tiposPorProfessor: Record<string, TipoRemuneracaoMes> = {};
    if (professorIds.length > 0) {
      const { data: periodosSalarioData } = await supabase
        .from('periodos_valor_professor')
        .select('professor_id, de, ate, valor')
        .eq('tipo', 'salario')
        .in('professor_id', professorIds);

      const porProf: Record<string, PeriodoCustoFixo[]> = {};
      (periodosSalarioData || []).forEach((p: any) => {
        if (!porProf[p.professor_id]) porProf[p.professor_id] = [];
        porProf[p.professor_id].push({ de: p.de, ate: p.ate, valor: Number(p.valor) });
      });
      professorIds.forEach((id) => {
        tiposPorProfessor[id] = tipoNoMes(porProf[id] || [], mesAtual);
      });
    }
    setTipoAtualPorProfessor(tiposPorProfessor);

    const semTarifaIds = (data || [])
      .filter((m) => m.role?.toLowerCase() === 'professor' && !m.tarifa_tipo && tiposPorProfessor[m.id] !== 'salario')
      .map((m) => m.id);

    if (semTarifaIds.length === 0) {
      setSessoesSemTarifaCount({});
      return;
    }

    const { data: sessoesDadas } = await supabase
      .from('explicacoes')
      .select('professor_id')
      .eq('dado', true)
      .in('professor_id', semTarifaIds);

    const contagem: Record<string, number> = {};
    (sessoesDadas || []).forEach((s) => {
      contagem[s.professor_id] = (contagem[s.professor_id] || 0) + 1;
    });
    setSessoesSemTarifaCount(contagem);
  };

  useEffect(() => {
    fetchTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disciplinas do centro, para o dropdown das exceções.
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      const centro_id = user?.app_metadata?.centro_id;
      if (!centro_id) return;
      supabase
        .from('subjects')
        .select('id, name, anos_aplicaveis')
        .eq('centro_id', centro_id)
        .order('name')
        .then(({ data }) => setSubjects(data || []));
    });
  }, []);

  // Exceções do professor cujo modal de tarifa está aberto.
  useEffect(() => {
    if (!tarifaModalMember) {
      setExcecoes([]);
      fecharFormExcecao();
      return;
    }
    setLoadingExcecoes(true);
    supabase
      .from('tarifas_professor_disciplina')
      .select('*, subjects(name)')
      .eq('professor_id', tarifaModalMember.id)
      .order('ano_escolar', { ascending: true, nullsFirst: true })
      .then(({ data, error }) => {
        setLoadingExcecoes(false);
        if (error) {
          showError('Erro ao carregar exceções: ' + error.message);
          return;
        }
        setExcecoes(data || []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarifaModalMember]);

  const anosParaDisciplina = (disciplinaId: string) => {
    const disciplina = subjects.find((s) => String(s.id) === disciplinaId);
    if (!disciplina?.anos_aplicaveis || disciplina.anos_aplicaveis.length === 0) {
      return Array.from({ length: 12 }, (_, i) => i + 1);
    }
    return [...disciplina.anos_aplicaveis].sort((a: number, b: number) => a - b);
  };

  const abrirNovaExcecao = () => {
    setExcecaoEditandoId('novo');
    setExcecaoDisciplinaId('');
    setExcecaoAno('');
    setExcecaoTipo('');
    setExcecaoValor('');
    setExcecaoEscalaAluno(false);
  };

  const editarExcecao = (exc: any) => {
    setExcecaoEditandoId(exc.id);
    setExcecaoDisciplinaId(String(exc.disciplina_id));
    setExcecaoAno(exc.ano_escolar != null ? String(exc.ano_escolar) : '');
    setExcecaoTipo(exc.tarifa_tipo);
    setExcecaoValor(exc.tarifa_valor.toString());
    setExcecaoEscalaAluno(exc.tarifa_escala_aluno || false);
  };

  const fecharFormExcecao = () => {
    setExcecaoEditandoId(null);
    setExcecaoDisciplinaId('');
    setExcecaoAno('');
    setExcecaoTipo('');
    setExcecaoValor('');
    setExcecaoEscalaAluno(false);
  };

  const handleSalvarExcecao = async () => {
    if (!tarifaModalMember) return;
    if (!excecaoDisciplinaId) {
      showError('Escolhe a disciplina.');
      return;
    }
    if (!excecaoTipo) {
      showError('Escolhe o tipo de tarifa.');
      return;
    }
    const valor = parseFloat(excecaoValor);
    if (isNaN(valor) || valor < 0) {
      showError('Indica um valor de tarifa válido.');
      return;
    }

    const ctx = await getAdminContext();
    if (!ctx) return;

    setSavingExcecao(true);
    const payload = {
      professor_id: tarifaModalMember.id,
      disciplina_id: Number(excecaoDisciplinaId),
      ano_escolar: excecaoAno === '' ? null : Number(excecaoAno),
      tarifa_tipo: excecaoTipo,
      tarifa_valor: valor,
      tarifa_escala_aluno: excecaoEscalaAluno,
    };

    const { error } =
      excecaoEditandoId && excecaoEditandoId !== 'novo'
        ? await supabase.from('tarifas_professor_disciplina').update(payload).eq('id', excecaoEditandoId)
        : await supabase.from('tarifas_professor_disciplina').insert(payload);

    setSavingExcecao(false);

    if (error) {
      if (error.code === '23505') {
        showError('Já existe uma exceção para esta disciplina e ano — edita a que já existe em vez de criar outra.');
      } else {
        showError('Erro ao guardar exceção: ' + error.message);
      }
      return;
    }

    showSuccess('Exceção guardada.');
    fecharFormExcecao();
    const { data } = await supabase
      .from('tarifas_professor_disciplina')
      .select('*, subjects(name)')
      .eq('professor_id', tarifaModalMember.id)
      .order('ano_escolar', { ascending: true, nullsFirst: true });
    setExcecoes(data || []);
  };

  const handleApagarExcecao = async (id: string) => {
    if (!confirm('Remover esta exceção de tarifa?')) return;
    const ctx = await getAdminContext();
    if (!ctx) return;
    const { error } = await supabase.from('tarifas_professor_disciplina').delete().eq('id', id);
    if (error) {
      showError('Erro ao remover exceção: ' + error.message);
      return;
    }
    setExcecoes((prev) => prev.filter((e) => e.id !== id));
    showSuccess('Exceção removida.');
  };

  const getAdminContext = async (): Promise<{ centro_id: string } | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    const role_meta = user?.app_metadata?.role;
    const centro_id = user?.app_metadata?.centro_id;

    if (role_meta?.toLowerCase() !== 'admin') {
      setFormError('Sem permissões de administrador para esta ação.');
      return null;
    }
    if (!centro_id) {
      setFormError('Não foi possível obter o centro. Recarrega a página.');
      return null;
    }
    return { centro_id };
  };

  const handleAdd = async (e: any) => {
    e.preventDefault();
    if (!email || !name || !password) return;
    setFormError(null);
    setSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;

    const res = await fetch('/api/admin/criar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.toLowerCase().trim(),
        password,
        name,
        role,
        centro_id,
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      setFormError(result.error || 'Erro ao criar membro da equipa.');
    } else {
      setName('');
      setEmail('');
      setPassword('');
      fetchTeam();
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este membro da equipa? Ele deixará de ter acesso ao Admin.')) return;
    setFormError(null);

    const ctx = await getAdminContext();
    if (!ctx) return;

    await supabase.from('staff').delete().eq('id', id);
    fetchTeam();
  };

  const abrirTarifaModal = async (member: any) => {
    setTarifaModalMember(member);
    setTarifaTipo(member.tarifa_tipo || '');
    setTarifaValor(member.tarifa_valor?.toString() || '');
    setTarifaEscalaAluno(member.tarifa_escala_aluno || false);
    setTipoRemuneracaoSelecionado(tipoAtualPorProfessor[member.id] || 'variavel');
    setPeriodoFormAberto(null);

    setLoadingPeriodos(true);
    try {
      const { salario, valorDia } = await obterPeriodosDoProfessor(member.id);
      setPeriodosSalario(salario);
      setPeriodosValorDia(valorDia);
    } catch (e: any) {
      showError('Erro ao carregar períodos de remuneração: ' + e.message);
    } finally {
      setLoadingPeriodos(false);
    }
  };

  const fecharTarifaModal = () => {
    setTarifaModalMember(null);
    setPeriodosSalario([]);
    setPeriodosValorDia([]);
    setPeriodoFormAberto(null);
    setPeriodoFormDe('');
    setPeriodoFormValor('');
  };

  const handleSaveTarifa = async () => {
    if (!tarifaModalMember) return;
    if (!tarifaTipo) {
      showError('Escolhe o tipo de tarifa.');
      return;
    }
    const valor = parseFloat(tarifaValor);
    if (isNaN(valor)) {
      showError('Indica um valor de tarifa válido.');
      return;
    }

    const ctx = await getAdminContext();
    if (!ctx) return;

    setSavingTarifa(true);
    const { error } = await supabase
      .from('staff')
      .update({ tarifa_tipo: tarifaTipo, tarifa_valor: valor, tarifa_escala_aluno: tarifaEscalaAluno })
      .eq('id', tarifaModalMember.id);
    setSavingTarifa(false);

    if (error) {
      showError('Erro ao guardar tarifa: ' + error.message);
      return;
    }
    showSuccess('Tarifa atualizada com sucesso.');
  };

  // --- Períodos de remuneração (salário mensal / valor por dia) ---

  const abrirPeriodoFormValor = (tipo: 'salario' | 'valor_dia') => {
    const periodos = tipo === 'salario' ? periodosSalario : periodosValorDia;
    const estado = estadoCustoFixoNoMes(periodos, mesAtual);
    setPeriodoFormDe(mesAtual);
    setPeriodoFormValor(estado.estado === 'ativo' && estado.valor != null ? String(estado.valor) : '');
    setPeriodoFormAberto({ tipo, modo: 'valor' });
  };

  const abrirPeriodoFormTerminar = (tipo: 'salario' | 'valor_dia') => {
    setPeriodoFormDe(mesAtual);
    setPeriodoFormValor('');
    setPeriodoFormAberto({ tipo, modo: 'terminar' });
  };

  const fecharPeriodoForm = () => {
    setPeriodoFormAberto(null);
    setPeriodoFormDe('');
    setPeriodoFormValor('');
  };

  const recarregarPeriodos = async () => {
    if (!tarifaModalMember) return;
    const { salario, valorDia } = await obterPeriodosDoProfessor(tarifaModalMember.id);
    setPeriodosSalario(salario);
    setPeriodosValorDia(valorDia);
    fetchTeam();
  };

  const handleConfirmarPeriodo = async () => {
    if (!tarifaModalMember || !periodoFormAberto) return;
    if (!periodoFormDe) {
      showError('Escolhe o mês.');
      return;
    }
    const { tipo, modo } = periodoFormAberto;

    setSalvandoPeriodo(true);
    try {
      if (modo === 'terminar') {
        const { error } = await supabase.rpc('terminar_periodo_professor', {
          p_professor: tarifaModalMember.id,
          p_tipo: tipo,
          p_a_partir_de: mesParaData(periodoFormDe),
        });
        if (error) throw error;
        showSuccess('Período terminado.');
      } else {
        const valor = parseFloat(periodoFormValor);
        if (isNaN(valor) || valor <= 0) {
          showError('Indica um valor válido.');
          setSalvandoPeriodo(false);
          return;
        }
        const { error } = await supabase.rpc('definir_periodo_professor', {
          p_professor: tarifaModalMember.id,
          p_tipo: tipo,
          p_de: mesParaData(periodoFormDe),
          p_valor: valor,
        });
        if (error) throw error;
        showSuccess('Valor atualizado.');
      }
      fecharPeriodoForm();
      await recarregarPeriodos();
    } catch (e: any) {
      showError(mensagemErroCusto(e));
    } finally {
      setSalvandoPeriodo(false);
    }
  };

  const handleEscolherTipoRemuneracao = (tipo: TipoRemuneracaoMes) => {
    setTipoRemuneracaoSelecionado(tipo);
    fecharPeriodoForm();
    // Primeira vez (sem histórico nenhum de salário): o formulário já abre
    // pedido logo o valor e o mês de início, sem passo extra.
    if (tipo === 'salario' && periodosSalario.length === 0) {
      abrirPeriodoFormValor('salario');
    }
  };

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;

  const estadoSalarioAtual = tarifaModalMember ? estadoCustoFixoNoMes(periodosSalario, mesAtual) : null;
  const estadoValorDiaAtual = tarifaModalMember ? estadoCustoFixoNoMes(periodosValorDia, mesAtual) : null;

  return (
    <main className="min-h-screen bg-page text-primary p-6 max-w-5xl mx-auto">

      <div className="flex items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="bg-surface p-3 rounded-xl hover:bg-raised transition-colors border border-border">
            <ArrowLeft size={20} className="text-secondary" />
          </Link>
          <div>
            <h1 className="text-2xl font-black flex items-center gap-2">
              <Shield className="text-indigo-500" />
              Gestão de Equipa
            </h1>
            <p className="text-muted text-xs">Quem tem a chave do centro?</p>
          </div>
        </div>
        <Link
          href="/admin/equipa/dias-trabalho"
          className="flex items-center gap-2 bg-surface border border-border px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-secondary hover:text-primary hover:bg-raised transition-colors"
        >
          <CalendarClock size={16} /> Dias de Trabalho
        </Link>
      </div>

      <div className="grid md:grid-cols-3 gap-8">

        <div className="md:col-span-1 bg-surface border border-border p-6 rounded-2xl h-fit">
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2 text-primary">
            <Plus size={20} className="text-green-500" /> Novo Membro
          </h2>

          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Nome</label>
              <div className="relative">
                <User className="absolute left-3 top-3.5 text-muted" size={16} />
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Maria Santos"
                    className="w-full bg-page border border-border text-primary pl-10 pr-3 py-3 rounded-xl outline-none focus:border-indigo-500"
                    required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Email de Acesso</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3.5 text-muted" size={16} />
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@gmail.com"
                    className="w-full bg-page border border-border text-primary pl-10 pr-3 py-3 rounded-xl outline-none focus:border-indigo-500"
                    required
                />
              </div>
            </div>

            {/* CAMPO DA PASSWORD ADICIONADO NO LOCAL CORRETO */}
            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Password Provisória</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3.5 text-muted" size={16} />
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full bg-page border border-border text-primary pl-10 pr-3 py-3 rounded-xl outline-none focus:border-indigo-500"
                    required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Cargo</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-indigo-500"
              >
                <option value="professor">Professor</option>
                <option value="Secretaria">Secretaria</option>
                <option value="Admin">Admin</option>
              </select>
            </div>

            {formError && (
              <p className="text-danger text-[11px] font-bold px-1">{formError}</p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-primary font-bold py-3 rounded-xl transition-all active:scale-95 shadow-lg shadow-indigo-900/20 flex items-center justify-center gap-2 mt-4"
            >
              {submitting ? <Loader2 className="animate-spin" /> : <><Save size={18} /> Dar Acesso</>}
            </button>
          </form>
        </div>

        <div className="md:col-span-2 space-y-3">
          <h3 className="text-muted font-bold uppercase text-xs tracking-wider mb-2">Equipa Ativa ({team.length})</h3>

          {team.map((member) => {
            const isProfessor = member.role?.toLowerCase() === 'professor';
            const tipoAtual = tipoAtualPorProfessor[member.id];
            return (
              <div key={member.id} data-testid={`membro-${member.id}`} className="bg-surface border border-border p-4 rounded-xl flex justify-between items-center group hover:border-border transition-all">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-primary ${
                      member.role === 'Admin' || member.role === 'CEO' ? 'bg-indigo-600' : 'bg-border'
                  }`}>
                    {member.name.charAt(0)}
                  </div>
                  <div>
                    <h4 className="font-bold text-primary">{member.name}</h4>
                    <div className="flex items-center gap-2 text-xs text-secondary">
                        <span>{member.email}</span>
                        <span className="w-1 h-1 rounded-full bg-border"></span>
                        <span className="text-indigo-400 font-bold uppercase">{member.role}</span>
                        {isProfessor && tipoAtual && (
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md border ${
                            tipoAtual === 'salario'
                              ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                              : 'bg-border/40 text-muted border-border'
                          }`}>
                            {tipoAtual === 'salario' ? 'Salário' : 'Variável'}
                          </span>
                        )}
                    </div>
                    {isProfessor && tipoAtual === 'variavel' && member.tarifa_tipo && (
                      <p className="text-[10px] text-accent font-bold mt-1">
                        {member.tarifa_tipo === 'fixo'
                          ? `${Number(member.tarifa_valor).toFixed(2)}€ fixo por sessão`
                          : `${Number(member.tarifa_valor).toFixed(2)}€/hora`}
                        {member.tarifa_escala_aluno ? ' · escala por aluno' : ''}
                      </p>
                    )}
                    {isProfessor && tipoAtual === 'variavel' && !member.tarifa_tipo && sessoesSemTarifaCount[member.id] > 0 && (
                      <p className="text-[10px] text-warning font-bold mt-1 flex items-center gap-1">
                        <AlertTriangle size={11} />
                        Tarifa não definida — {sessoesSemTarifaCount[member.id]} {sessoesSemTarifaCount[member.id] === 1 ? 'sessão dada' : 'sessões dadas'} sem valor
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {isProfessor && (
                    <button
                      onClick={() => abrirTarifaModal(member)}
                      className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-accent hover:bg-accent-soft rounded-lg transition-colors"
                    >
                      Remuneração
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(member.id)}
                    className="p-2 text-muted hover:text-danger hover:bg-danger-bg rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {tarifaModalMember && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) fecharTarifaModal(); }}
        >
          <div className="bg-surface border border-border w-full max-w-md rounded-3xl shadow-2xl p-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black text-primary">Remuneração de {tarifaModalMember.name}</h2>
              <button onClick={fecharTarifaModal} className="text-muted hover:text-primary transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* SELETOR DE TIPO — só decide que secção ver; a mudança real só
                acontece ao definir/terminar um período (ver handleConfirmarPeriodo). */}
            <div className="flex items-center bg-page border border-border rounded-2xl overflow-hidden p-1 mb-6">
              <button
                type="button"
                onClick={() => handleEscolherTipoRemuneracao('salario')}
                className={`flex-1 px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${
                  tipoRemuneracaoSelecionado === 'salario' ? 'bg-accent text-on-accent' : 'text-secondary hover:text-primary'
                }`}
              >
                Salário Mensal
              </button>
              <button
                type="button"
                onClick={() => handleEscolherTipoRemuneracao('variavel')}
                className={`flex-1 px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${
                  tipoRemuneracaoSelecionado === 'variavel' ? 'bg-accent text-on-accent' : 'text-secondary hover:text-primary'
                }`}
              >
                Variável
              </button>
            </div>

            {loadingPeriodos ? (
              <Loader2 className="animate-spin text-accent mx-auto my-8" size={24} />
            ) : tipoRemuneracaoSelecionado === 'salario' ? (
              <BlocoPeriodoRemuneracao
                periodos={periodosSalario}
                mesAtual={mesAtual}
                sufixo="/mês"
                formAberto={periodoFormAberto?.tipo === 'salario'}
                formModo={periodoFormAberto?.tipo === 'salario' ? periodoFormAberto.modo : undefined}
                onAbrirValor={() => abrirPeriodoFormValor('salario')}
                onAbrirTerminar={() => abrirPeriodoFormTerminar('salario')}
                onFechar={fecharPeriodoForm}
                formDe={periodoFormDe}
                setFormDe={setPeriodoFormDe}
                formValor={periodoFormValor}
                setFormValor={setPeriodoFormValor}
                onConfirmar={handleConfirmarPeriodo}
                salvando={salvandoPeriodo}
                notaBloqueio={
                  estadoValorDiaAtual?.estado === 'ativo'
                    ? `Este professor tem valor por dia ativo em ${formatarMesAno(mesAtual)} — termina-o primeiro para definir salário.`
                    : undefined
                }
              />
            ) : (
              <div className="space-y-6">
                <div>
                  <label className="text-xs font-bold text-muted uppercase ml-1">Tipo de Tarifa</label>
                  <select
                    value={tarifaTipo}
                    onChange={(e) => setTarifaTipo(e.target.value)}
                    className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1"
                  >
                    <option value="">Selecionar...</option>
                    <option value="fixo">Fixo por sessão</option>
                    <option value="por_hora">Por hora</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-muted uppercase ml-1">Valor (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={tarifaValor}
                    onChange={(e) => setTarifaValor(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-accent mt-1"
                  />
                </div>

                <label className="flex items-center gap-3 bg-page p-4 rounded-xl border border-border cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tarifaEscalaAluno}
                    onChange={(e) => setTarifaEscalaAluno(e.target.checked)}
                    className="w-4 h-4 accent-accent"
                  />
                  <span className="text-sm font-bold text-primary">Multiplica pelo nº de alunos presentes na sessão</span>
                </label>

                <button
                  onClick={handleSaveTarifa}
                  disabled={savingTarifa}
                  className="w-full bg-accent hover:bg-accent-hover text-on-accent p-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                >
                  {savingTarifa ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  Guardar Tarifa
                </button>

                {/* EXCEÇÕES POR DISCIPLINA/ANO — vencem sobre a tarifa geral acima */}
                <div className="pt-6 border-t border-border">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-black uppercase text-muted tracking-widest">Exceções por Disciplina</h3>
                    {excecaoEditandoId === null && (
                      <button
                        type="button"
                        onClick={abrirNovaExcecao}
                        className="text-[10px] font-black text-accent hover:text-accent-hover flex items-center gap-1"
                      >
                        <Plus size={12} /> Adicionar exceção
                      </button>
                    )}
                  </div>

                  {loadingExcecoes ? (
                    <Loader2 className="animate-spin text-accent mx-auto my-4" size={18} />
                  ) : (
                    <div className="space-y-2 mb-3">
                      {excecoes.length === 0 && excecaoEditandoId === null && (
                        <p className="text-[11px] text-muted italic">Sem exceções — usa sempre a tarifa geral acima.</p>
                      )}
                      {excecoes.map((exc) => (
                        <div key={exc.id} className="bg-page border border-border p-3 rounded-xl flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-primary truncate">
                              {exc.subjects?.name}{' '}
                              <span className="text-muted font-normal">
                                · {exc.ano_escolar != null ? `${exc.ano_escolar}º ano` : 'Todos os anos'}
                              </span>
                            </p>
                            <p className="text-[10px] text-accent font-bold">
                              {exc.tarifa_tipo === 'fixo'
                                ? `${Number(exc.tarifa_valor).toFixed(2)}€ fixo`
                                : `${Number(exc.tarifa_valor).toFixed(2)}€/hora`}
                              {exc.tarifa_escala_aluno ? ' · escala por aluno' : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={() => editarExcecao(exc)} className="p-1.5 text-muted hover:text-accent transition-colors">
                              <Pencil size={14} />
                            </button>
                            <button type="button" onClick={() => handleApagarExcecao(exc.id)} className="p-1.5 text-muted hover:text-danger transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {excecaoEditandoId !== null && (
                    <div className="bg-page border border-border p-4 rounded-xl space-y-3">
                      <select
                        value={excecaoDisciplinaId}
                        onChange={(e) => { setExcecaoDisciplinaId(e.target.value); setExcecaoAno(''); }}
                        className="w-full bg-surface border border-border text-primary p-2.5 rounded-lg outline-none focus:border-accent text-sm"
                      >
                        <option value="">Disciplina...</option>
                        {subjects.map((s: any) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>

                      <select
                        value={excecaoAno}
                        onChange={(e) => setExcecaoAno(e.target.value)}
                        disabled={!excecaoDisciplinaId}
                        className="w-full bg-surface border border-border text-primary p-2.5 rounded-lg outline-none focus:border-accent text-sm disabled:opacity-50"
                      >
                        <option value="">Todos os anos</option>
                        {anosParaDisciplina(excecaoDisciplinaId).map((ano) => (
                          <option key={ano} value={ano}>{ano}º Ano</option>
                        ))}
                      </select>

                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={excecaoTipo}
                          onChange={(e) => setExcecaoTipo(e.target.value)}
                          className="w-full bg-surface border border-border text-primary p-2.5 rounded-lg outline-none focus:border-accent text-sm"
                        >
                          <option value="">Tipo...</option>
                          <option value="fixo">Fixo por sessão</option>
                          <option value="por_hora">Por hora</option>
                        </select>
                        <input
                          type="number"
                          step="0.01"
                          value={excecaoValor}
                          onChange={(e) => setExcecaoValor(e.target.value)}
                          placeholder="0.00€"
                          className="w-full bg-surface border border-border text-primary p-2.5 rounded-lg outline-none focus:border-accent text-sm"
                        />
                      </div>

                      <label className="flex items-center gap-2 text-xs font-bold text-primary cursor-pointer">
                        <input
                          type="checkbox"
                          checked={excecaoEscalaAluno}
                          onChange={(e) => setExcecaoEscalaAluno(e.target.checked)}
                          className="w-4 h-4 accent-accent"
                        />
                        Multiplica pelo nº de alunos
                      </label>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleSalvarExcecao}
                          disabled={savingExcecao}
                          className="flex-1 bg-accent hover:bg-accent-hover text-on-accent text-xs font-black py-2.5 rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          {savingExcecao ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Guardar
                        </button>
                        <button
                          type="button"
                          onClick={fecharFormExcecao}
                          disabled={savingExcecao}
                          className="px-4 text-xs font-black text-muted hover:text-secondary"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* VALOR POR DIA DE TRABALHO — mesmo editor de período, tipo valor_dia */}
                <div className="pt-6 border-t border-border">
                  <h3 className="text-xs font-black uppercase text-muted tracking-widest mb-3">Valor por Dia de Trabalho</h3>
                  <BlocoPeriodoRemuneracao
                    periodos={periodosValorDia}
                    mesAtual={mesAtual}
                    sufixo="/dia"
                    formAberto={periodoFormAberto?.tipo === 'valor_dia'}
                    formModo={periodoFormAberto?.tipo === 'valor_dia' ? periodoFormAberto.modo : undefined}
                    onAbrirValor={() => abrirPeriodoFormValor('valor_dia')}
                    onAbrirTerminar={() => abrirPeriodoFormTerminar('valor_dia')}
                    onFechar={fecharPeriodoForm}
                    formDe={periodoFormDe}
                    setFormDe={setPeriodoFormDe}
                    formValor={periodoFormValor}
                    setFormValor={setPeriodoFormValor}
                    onConfirmar={handleConfirmarPeriodo}
                    salvando={salvandoPeriodo}
                    notaBloqueio={
                      estadoSalarioAtual?.estado === 'ativo'
                        ? `Este professor está de salário em ${formatarMesAno(mesAtual)} — termina o salário primeiro para definir valor por dia.`
                        : undefined
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <StatusToast toast={toast} />
    </main>
  );
}
