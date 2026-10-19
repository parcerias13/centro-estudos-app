'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import { getHojeLisboa } from '@/lib/dataLisboa';
import {
  obterCustosDoMes, obterMesesComDados, listaDeMeses, somarMeses, mesParaData, mensagemErroCusto,
  type CustosDoMes, type CustoFixoNoMes,
} from '@/lib/custos';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import {
  Building2, Save, Loader2, DollarSign, ChevronLeft, ChevronRight,
  Plus, Trash2, RefreshCw, ShieldAlert, Receipt, GraduationCap, Pencil
} from 'lucide-react';

const CATEGORIAS_DESPESA = ['Professores', 'Materiais', 'Comida', 'Outros'];

// Mesma convenção de tarifa_tipo já usada em tarifas_professor_disciplina (Equipa).
const TIPOS_PRECO_FAMILIA = [
  { valor: 'fixo', label: 'Fixo por sessão' },
  { valor: 'por_hora', label: 'Por hora' },
] as const;
const TIPO_PRECO_LABEL: Record<string, string> = { fixo: 'Fixo por sessão', por_hora: 'Por hora' };

export default function GestaoTotalPage() {
  const { toast, showError, showSuccess } = useStatusToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const [nomeCentro, setNomeCentro] = useState('');

  const [servicos, setServicos] = useState<any[]>([]);

  const [showNovoServico, setShowNovoServico] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoPreco, setNovoPreco] = useState('');
  const [novoCusto, setNovoCusto] = useState('');
  const [criarError, setCriarError] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  // Custos do centro (fixos + variáveis) — lib/custos.ts calcula os números;
  // aqui só o estado do ecrã, para Gestão e Performance nunca divergirem.
  const [centroId, setCentroId] = useState<string | null>(null);
  const [mesSelecionado, setMesSelecionado] = useState(() => getHojeLisboa().slice(0, 7));
  const [mesesDisponiveis, setMesesDisponiveis] = useState<string[]>([getHojeLisboa().slice(0, 7)]);
  const [custosMes, setCustosMes] = useState<CustosDoMes>({ fixos: [], variaveis: [], totalFixos: 0, totalVariaveis: 0, totalGeral: 0 });
  const [loadingCustos, setLoadingCustos] = useState(true);

  // Novo custo fixo
  const [showNovoFixo, setShowNovoFixo] = useState(false);
  const [novoFixoDescricao, setNovoFixoDescricao] = useState('');
  const [novoFixoCategoria, setNovoFixoCategoria] = useState('Outros');
  const [novoFixoValor, setNovoFixoValor] = useState('');
  const [novoFixoDesde, setNovoFixoDesde] = useState(() => getHojeLisboa().slice(0, 7));
  const [criandoFixo, setCriandoFixo] = useState(false);
  const [criarFixoError, setCriarFixoError] = useState<string | null>(null);

  // Alterar valor de um custo fixo ativo
  const [alterandoId, setAlterandoId] = useState<string | null>(null);
  const [alterarValor, setAlterarValor] = useState('');
  const [alterarDesde, setAlterarDesde] = useState('');
  const [alterando, setAlterando] = useState(false);
  const [alterarError, setAlterarError] = useState<string | null>(null);

  // Terminar um custo fixo ativo
  const [terminandoId, setTerminandoId] = useState<string | null>(null);
  const [terminarAPartir, setTerminarAPartir] = useState('');
  const [terminando, setTerminando] = useState(false);
  const [terminarError, setTerminarError] = useState<string | null>(null);

  // Novo custo variável
  const [showNovoVariavel, setShowNovoVariavel] = useState(false);
  const [varCategoria, setVarCategoria] = useState('Outros');
  const [varDescricao, setVarDescricao] = useState('');
  const [varValor, setVarValor] = useState('');
  const [varData, setVarData] = useState(() => getHojeLisboa());
  const [criandoVariavel, setCriandoVariavel] = useState(false);
  const [criarVariavelError, setCriarVariavelError] = useState<string | null>(null);

  // Preços de explicações à família (precos_explicacoes_familia) — mesma
  // estrutura de estado das exceções de tarifa em Equipa (Fase 2), para as
  // duas telas não derivarem por pequenas diferenças de implementação.
  const [subjects, setSubjects] = useState<any[]>([]);
  const [precosFamilia, setPrecosFamilia] = useState<any[]>([]);
  const [precoEditandoId, setPrecoEditandoId] = useState<string | null>(null); // null = formulário fechado, 'novo' = a criar
  const [precoDisciplinaId, setPrecoDisciplinaId] = useState('');
  const [precoAno, setPrecoAno] = useState(''); // '' = todos os anos
  const [precoTipo, setPrecoTipo] = useState('');
  const [precoValor, setPrecoValor] = useState('');
  const [savingPreco, setSavingPreco] = useState(false);

  const loadTudo = useCallback(async () => {
    try {
      setLoading(true);
      await supabase.auth.refreshSession();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return setIsAdmin(false);

      const configRes = await fetch('/api/config-centro');
      const adminStatus = configRes.ok;
      setIsAdmin(adminStatus);

      if (adminStatus) {
        // Busca apenas os serviços extra
        const { data: servicosRes } = await supabase.from('servicos').select('*').order('nome');
        setServicos(servicosRes || []);

        // Disciplinas do centro + preços à família — mesma fonte (subjects)
        // e a mesma lógica de anos_aplicaveis já usada em Equipa (Fase 2).
        const centro_id = user?.app_metadata?.centro_id;
        setCentroId(centro_id ?? null);
        if (centro_id) {
          const { data: subjectsRes } = await supabase
            .from('subjects')
            .select('id, name, anos_aplicaveis')
            .eq('centro_id', centro_id)
            .order('name');
          setSubjects(subjectsRes || []);

          const { data: precosRes } = await supabase
            .from('precos_explicacoes_familia')
            .select('*, subjects(name)')
            .eq('centro_id', centro_id)
            .order('ano_escolar', { ascending: true, nullsFirst: true });
          setPrecosFamilia(precosRes || []);
        }

        const config = await configRes.json();
        setNomeCentro(config.nome_centro || '');
      }
    } catch (error) {
      console.error("Erro no load:", error);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { loadTudo(); }, [loadTudo]);

  const handleSaveCentro = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSubmitting(true);
    const res = await fetch('/api/config-centro', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome_centro: nomeCentro }),
    });

    if (res.ok) {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } else {
      const body = await res.json().catch(() => ({}));
      setSaveError(body?.error || `Erro ao guardar (${res.status}). Tenta novamente.`);
    }
    setSubmitting(false);
  };

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    setCriarError(null);

    const precoNum = parseFloat(novoPreco);
    if (!novoNome.trim()) return setCriarError('O nome é obrigatório.');
    if (isNaN(precoNum) || precoNum < 0) return setCriarError('Preço inválido.');

    setCriando(true);
    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;
    if (!centro_id) {
      setCriarError('Não foi possível obter o centro. Recarrega a página.');
      setCriando(false);
      return;
    }

    const custoNum = novoCusto.trim() !== '' && !isNaN(parseFloat(novoCusto)) ? parseFloat(novoCusto) : null;
    const { error } = await supabase.from('servicos').insert({ nome: novoNome.trim(), preco: precoNum, custo: custoNum, centro_id });
    if (error) {
      setCriarError(error.message);
    } else {
      setNovoNome('');
      setNovoPreco('');
      setNovoCusto('');
      setShowNovoServico(false);
      loadTudo();
    }
    setCriando(false);
  };

  const updatePrecoServico = async (id: string, preco: string) => {
    const valor = parseFloat(preco);
    if (isNaN(valor)) return;
    const { error } = await supabase.from('servicos').update({ preco: valor }).eq('id', id);
    if (error) {
      showError('Erro ao atualizar preço: ' + error.message);
      return;
    }
    setServicos(prev => prev.map(s => s.id === id ? {...s, preco: valor} : s));
  };

  const updateCustoServico = async (id: string, custo: string) => {
    const bruto = custo.trim();
    const valor = bruto === '' ? null : parseFloat(bruto);
    if (bruto !== '' && (valor === null || isNaN(valor))) return;
    const { error } = await supabase.from('servicos').update({ custo: valor }).eq('id', id);
    if (error) {
      showError('Erro ao atualizar custo: ' + error.message);
      return;
    }
    setServicos(prev => prev.map(s => s.id === id ? {...s, custo: valor} : s));
  };

  const handleDeleteService = async (id: string, nome: string) => {
    if (confirm(`Remover o serviço "${nome}"?`)) {
      await supabase.from('servicos').delete().eq('id', id);
      loadTudo();
    }
  };

  // Recarrega a lista de meses disponíveis + os custos do mês selecionado.
  // Chamada no arranque, quando o mês muda, e depois de qualquer escrita —
  // é a mesma função usada por Gestão e Performance (via lib/custos.ts),
  // para os números nunca divergirem.
  const recarregarCustos = useCallback(async () => {
    if (!centroId) return;
    setLoadingCustos(true);
    try {
      const [comDados, dadosMes] = await Promise.all([
        obterMesesComDados(centroId),
        obterCustosDoMes(centroId, mesSelecionado),
      ]);
      setMesesDisponiveis(listaDeMeses(comDados, getHojeLisboa().slice(0, 7)));
      setCustosMes(dadosMes);
    } catch (error) {
      console.error('Erro ao carregar custos:', error);
    } finally {
      setLoadingCustos(false);
    }
  }, [centroId, mesSelecionado]);

  useEffect(() => { recarregarCustos(); }, [recarregarCustos]);

  const mesMaisAntigo = mesesDisponiveis.length > 0 ? mesesDisponiveis[0] : mesSelecionado;
  // Ao contrário da Performance (só olha para trás), aqui um custo fixo pode
  // começar num mês futuro ("a partir de" ao criar) — por isso o avanço não
  // fica preso ao mês atual real, só a um limite generoso para não navegar
  // para sempre.
  const mesLimiteFuturo = somarMeses(getHojeLisboa().slice(0, 7), 24);
  const podeRecuarMes = mesSelecionado > mesMaisAntigo;
  const podeAvancarMes = mesSelecionado < mesLimiteFuturo;
  const handleMesAnterior = () => { if (podeRecuarMes) setMesSelecionado(somarMeses(mesSelecionado, -1)); };
  const handleMesSeguinte = () => { if (podeAvancarMes) setMesSelecionado(somarMeses(mesSelecionado, 1)); };
  const mesParaLabel = (mes: string) => {
    const [ano, m] = mes.split('-').map(Number);
    return format(new Date(ano, m - 1, 1), 'MMMM yyyy', { locale: pt });
  };

  const handleCriarFixo = async (e: React.FormEvent) => {
    e.preventDefault();
    setCriarFixoError(null);
    const nome = novoFixoDescricao.trim();
    if (!nome) return setCriarFixoError('A descrição é obrigatória.');
    const valorNum = parseFloat(novoFixoValor);
    if (isNaN(valorNum) || valorNum <= 0) return setCriarFixoError('Valor inválido.');
    if (!novoFixoDesde) return setCriarFixoError('Escolhe o mês de início.');
    if (!centroId) return setCriarFixoError('Não foi possível obter o centro. Recarrega a página.');

    setCriandoFixo(true);
    const { data: custoNovo, error: errCusto } = await supabase
      .from('custos_fixos')
      .insert({ nome, categoria: novoFixoCategoria, centro_id: centroId })
      .select('id')
      .single();

    if (errCusto || !custoNovo) {
      setCriarFixoError(mensagemErroCusto(errCusto || { message: 'Erro ao criar custo fixo.' }));
      setCriandoFixo(false);
      return;
    }

    const { error: errPeriodo } = await supabase.from('custos_fixos_periodos').insert({
      custo_id: custoNovo.id,
      centro_id: centroId,
      de: mesParaData(novoFixoDesde),
      ate: null,
      valor: valorNum,
    });

    if (errPeriodo) {
      await supabase.from('custos_fixos').delete().eq('id', custoNovo.id);
      setCriarFixoError(mensagemErroCusto(errPeriodo));
      setCriandoFixo(false);
      return;
    }

    setNovoFixoDescricao('');
    setNovoFixoCategoria('Outros');
    setNovoFixoValor('');
    setNovoFixoDesde(getHojeLisboa().slice(0, 7));
    setShowNovoFixo(false);
    setCriandoFixo(false);
    showSuccess('Custo fixo criado.');
    recarregarCustos();
  };

  const handleApagarFixo = async (id: string, nome: string) => {
    if (!confirm(`Apagar o custo fixo "${nome}"? Deixa de contar em todos os meses.`)) return;
    const { error } = await supabase.from('custos_fixos').delete().eq('id', id);
    if (error) {
      showError('Erro ao apagar custo fixo: ' + mensagemErroCusto(error));
      return;
    }
    showSuccess('Custo fixo apagado.');
    recarregarCustos();
  };

  const abrirAlterarValor = (custo: CustoFixoNoMes) => {
    setTerminandoId(null);
    setTerminarError(null);
    setAlterandoId(custo.id);
    setAlterarValor(custo.valor != null ? String(custo.valor) : '');
    setAlterarDesde(mesSelecionado);
    setAlterarError(null);
  };
  const fecharAlterarValor = () => {
    setAlterandoId(null);
    setAlterarValor('');
    setAlterarError(null);
  };

  const handleConfirmarAlterarValor = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlterarError(null);
    const valorNum = parseFloat(alterarValor);
    if (isNaN(valorNum) || valorNum <= 0) return setAlterarError('Valor inválido.');
    if (!alterarDesde) return setAlterarError('Escolhe o mês.');
    if (!alterandoId) return;

    setAlterando(true);
    const { error } = await supabase.rpc('alterar_valor_custo_fixo', {
      p_custo: alterandoId,
      p_de: mesParaData(alterarDesde),
      p_valor: valorNum,
    });
    setAlterando(false);

    if (error) {
      setAlterarError(mensagemErroCusto(error));
      return;
    }

    showSuccess('Valor atualizado.');
    fecharAlterarValor();
    recarregarCustos();
  };

  const abrirTerminar = (custo: CustoFixoNoMes) => {
    setAlterandoId(null);
    setAlterarError(null);
    setTerminandoId(custo.id);
    setTerminarAPartir(mesSelecionado);
    setTerminarError(null);
  };
  const fecharTerminar = () => {
    setTerminandoId(null);
    setTerminarAPartir('');
    setTerminarError(null);
  };

  const handleConfirmarTerminar = async (e: React.FormEvent) => {
    e.preventDefault();
    setTerminarError(null);
    if (!terminarAPartir) return setTerminarError('Escolhe o mês.');
    if (!terminandoId) return;

    setTerminando(true);
    const { error } = await supabase.rpc('terminar_custo_fixo', {
      p_custo: terminandoId,
      p_a_partir_de: mesParaData(terminarAPartir),
    });
    setTerminando(false);

    if (error) {
      setTerminarError(mensagemErroCusto(error));
      return;
    }

    showSuccess('Custo fixo terminado.');
    fecharTerminar();
    recarregarCustos();
  };

  const abrirNovoVariavel = () => {
    const hoje = getHojeLisboa();
    setVarCategoria('Outros');
    setVarDescricao('');
    setVarValor('');
    setVarData(hoje.slice(0, 7) === mesSelecionado ? hoje : mesParaData(mesSelecionado));
    setCriarVariavelError(null);
    setShowNovoVariavel(true);
  };

  const handleCriarVariavel = async (e: React.FormEvent) => {
    e.preventDefault();
    setCriarVariavelError(null);
    const valorNum = parseFloat(varValor);
    if (!varCategoria) return setCriarVariavelError('Escolhe uma categoria.');
    if (isNaN(valorNum) || valorNum <= 0) return setCriarVariavelError('Valor inválido.');
    if (!varData) return setCriarVariavelError('Escolhe a data.');
    if (!centroId) return setCriarVariavelError('Não foi possível obter o centro. Recarrega a página.');

    setCriandoVariavel(true);
    const { error } = await supabase.from('despesas').insert({
      categoria: varCategoria,
      tipo: 'variavel',
      descricao: varDescricao.trim() || null,
      valor: valorNum,
      data: varData,
      recorrente: false,
      centro_id: centroId,
    });
    setCriandoVariavel(false);

    if (error) {
      setCriarVariavelError('Erro ao registar custo: ' + error.message);
      return;
    }

    setShowNovoVariavel(false);
    showSuccess('Custo variável registado.');
    recarregarCustos();
  };

  const handleApagarVariavel = async (id: string, categoria: string, valor: number) => {
    if (!confirm(`Remover este custo (${categoria} — ${Number(valor).toFixed(2)}€)?`)) return;
    const { error } = await supabase.from('despesas').delete().eq('id', id);
    if (error) {
      showError('Erro ao remover: ' + error.message);
      return;
    }
    recarregarCustos();
  };

  // --- Preços de explicações à família — mesmo padrão das exceções de tarifa em Equipa (Fase 2) ---
  const anosParaDisciplina = (disciplinaId: string) => {
    const disciplina = subjects.find((s) => String(s.id) === disciplinaId);
    if (!disciplina?.anos_aplicaveis || disciplina.anos_aplicaveis.length === 0) {
      return Array.from({ length: 12 }, (_, i) => i + 1);
    }
    return [...disciplina.anos_aplicaveis].sort((a: number, b: number) => a - b);
  };

  const abrirNovoPreco = () => {
    setPrecoEditandoId('novo');
    setPrecoDisciplinaId('');
    setPrecoAno('');
    setPrecoTipo('');
    setPrecoValor('');
  };

  const editarPreco = (preco: any) => {
    setPrecoEditandoId(preco.id);
    setPrecoDisciplinaId(String(preco.disciplina_id));
    setPrecoAno(preco.ano_escolar != null ? String(preco.ano_escolar) : '');
    setPrecoTipo(preco.tipo);
    setPrecoValor(preco.valor.toString());
  };

  const fecharFormPreco = () => {
    setPrecoEditandoId(null);
    setPrecoDisciplinaId('');
    setPrecoAno('');
    setPrecoTipo('');
    setPrecoValor('');
  };

  const handleSalvarPreco = async () => {
    if (!precoDisciplinaId) {
      showError('Escolhe a disciplina.');
      return;
    }
    if (!precoTipo) {
      showError('Escolhe o tipo de preço.');
      return;
    }
    const valor = parseFloat(precoValor);
    if (isNaN(valor) || valor < 0) {
      showError('Indica um valor válido.');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;
    if (!centro_id) {
      showError('Não foi possível obter o centro. Recarrega a página.');
      return;
    }

    setSavingPreco(true);
    const payload = {
      centro_id,
      disciplina_id: Number(precoDisciplinaId),
      ano_escolar: precoAno === '' ? null : Number(precoAno),
      tipo: precoTipo,
      valor,
    };

    const { error } =
      precoEditandoId && precoEditandoId !== 'novo'
        ? await supabase.from('precos_explicacoes_familia').update(payload).eq('id', precoEditandoId)
        : await supabase.from('precos_explicacoes_familia').insert(payload);

    setSavingPreco(false);

    if (error) {
      if (error.code === '23505') {
        showError('Já existe um preço para esta disciplina e ano — edita o que já existe em vez de criar outro.');
      } else {
        showError('Erro ao guardar preço: ' + error.message);
      }
      return;
    }

    showSuccess('Preço guardado.');
    fecharFormPreco();
    const { data } = await supabase
      .from('precos_explicacoes_familia')
      .select('*, subjects(name)')
      .eq('centro_id', centro_id)
      .order('ano_escolar', { ascending: true, nullsFirst: true });
    setPrecosFamilia(data || []);
  };

  const handleApagarPreco = async (id: string) => {
    if (!confirm('Remover este preço?')) return;
    const { error } = await supabase.from('precos_explicacoes_familia').delete().eq('id', id);
    if (error) {
      showError('Erro ao remover preço: ' + error.message);
      return;
    }
    setPrecosFamilia((prev) => prev.filter((p) => p.id !== id));
    showSuccess('Preço removido.');
  };

  if (loading) return (
    <div className="min-h-screen bg-page flex items-center justify-center">
      <Loader2 className="animate-spin text-accent" size={40} />
    </div>
  );

  if (isAdmin === false) return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center p-8 text-center">
      <ShieldAlert size={64} className="text-danger mb-4" />
      <h1 className="text-2xl font-black uppercase italic">Acesso Restrito</h1>
      <p className="text-muted mt-2">Área reservada a administradores.</p>
    </div>
  );

  return (
    <main className="min-h-screen bg-page p-4 md:p-12 text-primary font-sans">
      <header className="mb-12 flex justify-between items-end max-w-6xl mx-auto">
        <div>
          <p className="text-accent font-black uppercase text-[10px] tracking-[0.3em] mb-2">Painel de Controlo</p>
          <h1 className="text-4xl font-black italic uppercase tracking-tighter">Gestão Operacional</h1>
        </div>
        <button 
          onClick={loadTudo} 
          className="p-4 bg-surface/50 rounded-2xl border border-border hover:text-accent transition-all hover:bg-raised"
        >
          <RefreshCw size={20} />
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
        

        {/* BLOCO 3: CUSTOS DO CENTRO (fixos + variáveis) */}
        <section className="bg-surface border border-border/60 p-6 md:p-8 rounded-[2.5rem] shadow-2xl backdrop-blur-sm lg:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-warning-bg rounded-2xl text-warning shrink-0">
                <Receipt size={24} />
              </div>
              <h3 className="text-primary font-black uppercase text-sm tracking-widest">Custos do Centro</h3>
            </div>
            <div className="flex items-center bg-page border border-border rounded-2xl overflow-hidden p-1 shadow-xl shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={handleMesAnterior}
                disabled={!podeRecuarMes}
                aria-label="Mês anterior"
                className="p-2 hover:bg-raised text-secondary hover:text-primary transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="px-3 py-1 text-center min-w-32" data-mes-selecionado={mesSelecionado}>
                <p className="text-sm font-black text-primary capitalize">{mesParaLabel(mesSelecionado)}</p>
              </div>
              <button
                type="button"
                onClick={handleMesSeguinte}
                disabled={!podeAvancarMes}
                aria-label="Mês seguinte"
                className="p-2 hover:bg-raised text-secondary hover:text-primary transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          {/* Totais do mês */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
            <div className="bg-page/50 border border-border rounded-2xl p-4">
              <p className="text-[9px] font-black uppercase text-muted tracking-widest">Fixos</p>
              <p className="font-mono font-black text-lg text-warning mt-1">{custosMes.totalFixos.toFixed(2)} €</p>
            </div>
            <div className="bg-page/50 border border-border rounded-2xl p-4">
              <p className="text-[9px] font-black uppercase text-muted tracking-widest">Variáveis</p>
              <p className="font-mono font-black text-lg text-warning mt-1">{custosMes.totalVariaveis.toFixed(2)} €</p>
            </div>
            <div className="bg-page/50 border border-border rounded-2xl p-4">
              <p className="text-[9px] font-black uppercase text-muted tracking-widest">Total do mês</p>
              <p className="font-mono font-black text-lg text-primary mt-1">{custosMes.totalGeral.toFixed(2)} €</p>
            </div>
          </div>

          {loadingCustos ? (
            <div className="flex justify-center py-16">
              <Loader2 className="animate-spin text-accent" size={28} />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* CUSTOS FIXOS */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h4 className="font-black uppercase text-xs tracking-widest text-secondary">Custos Fixos</h4>
                  <button
                    type="button"
                    onClick={() => { setShowNovoFixo(v => !v); setCriarFixoError(null); }}
                    className={`p-2 rounded-xl border transition-all active:scale-90 ${showNovoFixo ? 'bg-border text-primary border-border' : 'bg-warning-bg text-warning border-warning/20 hover:bg-warning hover:text-on-warning'}`}
                  >
                    <Plus size={18} />
                  </button>
                </div>

                {showNovoFixo && (
                  <form onSubmit={handleCriarFixo} className="mb-5 bg-page/50 border border-border rounded-3xl p-5 space-y-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-muted uppercase ml-1">Descrição</label>
                      <input
                        type="text"
                        value={novoFixoDescricao}
                        onChange={e => setNovoFixoDescricao(e.target.value)}
                        placeholder="ex: Renda, Salário Professores"
                        className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-warning outline-none transition-all"
                        autoFocus
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-1 space-y-1">
                        <label className="text-[9px] font-black text-muted uppercase ml-1">Categoria</label>
                        <select
                          value={novoFixoCategoria}
                          onChange={e => setNovoFixoCategoria(e.target.value)}
                          className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-warning outline-none transition-all appearance-none"
                        >
                          {CATEGORIAS_DESPESA.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="w-full sm:w-32 space-y-1">
                        <label className="text-[9px] font-black text-muted uppercase ml-1">Valor mensal (€)</label>
                        <input
                          type="number"
                          value={novoFixoValor}
                          onChange={e => setNovoFixoValor(e.target.value)}
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-mono font-black text-warning focus:border-warning outline-none transition-all"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-muted uppercase ml-1">A partir de</label>
                      <input
                        type="month"
                        value={novoFixoDesde}
                        onChange={e => setNovoFixoDesde(e.target.value)}
                        className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-warning outline-none transition-all"
                      />
                    </div>
                    {criarFixoError && <p className="text-danger text-[11px] font-bold px-1">{criarFixoError}</p>}
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        disabled={criandoFixo}
                        className="flex-1 py-3 bg-warning hover:bg-warning-hover text-on-warning rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                      >
                        {criandoFixo ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                        Criar Custo Fixo
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowNovoFixo(false); setCriarFixoError(null); }}
                        className="px-5 py-3 bg-raised hover:bg-border rounded-2xl font-black text-sm transition-all active:scale-95"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-3 max-h-[480px] overflow-y-auto pr-2 custom-scrollbar">
                  {custosMes.fixos.length > 0 ? custosMes.fixos.map(f => {
                    const inativo = f.estado !== 'ativo';
                    const podeApagar = f.estado === 'ativo' && f.periodos.length === 1 && f.periodos[0].de.slice(0, 7) === mesSelecionado;
                    return (
                      <div key={f.id} data-custo-fixo-linha="1" className={`border p-5 rounded-3xl transition-all ${inativo ? 'bg-page/20 border-border/30 opacity-60' : 'bg-page/40 border-border/50 hover:border-border'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <span className="text-[9px] font-black uppercase text-warning bg-warning-bg border border-warning/20 px-2 py-0.5 rounded-md tracking-tight inline-block break-words">{f.categoria}</span>
                            <span className="font-bold text-sm text-secondary block mt-1 break-words">{f.nome}</span>
                            {f.estado === 'nao_comecou' && (
                              <span className="text-[10px] text-muted font-bold mt-0.5 block">Ainda não começou</span>
                            )}
                            {f.estado === 'terminado' && (
                              <span className="text-[10px] text-muted font-bold mt-0.5 block">Terminou em {f.terminouEm ? mesParaLabel(f.terminouEm) : '—'}</span>
                            )}
                          </div>
                          <span className={`font-mono font-black text-lg shrink-0 ${inativo ? 'text-muted' : 'text-warning'}`}>
                            {f.valor != null ? `${f.valor.toFixed(2)} €` : '—'}
                          </span>
                        </div>

                        {f.estado === 'ativo' && alterandoId !== f.id && terminandoId !== f.id && (
                          <div className="flex flex-wrap gap-4 mt-3">
                            <button type="button" onClick={() => abrirAlterarValor(f)} className="text-[10px] text-accent font-bold uppercase hover:underline">
                              Alterar valor
                            </button>
                            {podeApagar ? (
                              <button type="button" onClick={() => handleApagarFixo(f.id, f.nome)} className="text-[10px] text-danger/70 font-bold uppercase hover:text-danger hover:underline">
                                Apagar
                              </button>
                            ) : (
                              <button type="button" onClick={() => abrirTerminar(f)} className="text-[10px] text-danger/70 font-bold uppercase hover:text-danger hover:underline">
                                Terminar
                              </button>
                            )}
                          </div>
                        )}

                        {alterandoId === f.id && (
                          <form onSubmit={handleConfirmarAlterarValor} className="mt-4 bg-surface border border-border rounded-2xl p-4 space-y-3">
                            <div className="flex flex-col sm:flex-row gap-3">
                              <div className="flex-1 space-y-1">
                                <label className="text-[9px] font-black text-muted uppercase ml-1">Novo valor (€)</label>
                                <input
                                  type="number"
                                  value={alterarValor}
                                  onChange={e => setAlterarValor(e.target.value)}
                                  min="0"
                                  step="0.01"
                                  className="w-full bg-page border border-border p-2.5 rounded-xl text-sm font-mono font-black text-accent focus:border-accent outline-none transition-all"
                                  autoFocus
                                />
                              </div>
                              <div className="flex-1 space-y-1">
                                <label className="text-[9px] font-black text-muted uppercase ml-1">A partir de</label>
                                <input
                                  type="month"
                                  value={alterarDesde}
                                  onChange={e => setAlterarDesde(e.target.value)}
                                  className="w-full bg-page border border-border p-2.5 rounded-xl text-sm font-bold focus:border-accent outline-none transition-all"
                                />
                              </div>
                            </div>
                            {alterarError && <p className="text-danger text-[11px] font-bold px-1">{alterarError}</p>}
                            <div className="flex gap-2">
                              <button type="submit" disabled={alterando} className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-on-accent rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50">
                                {alterando ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Guardar
                              </button>
                              <button type="button" onClick={fecharAlterarValor} className="px-4 py-2.5 bg-raised hover:bg-border rounded-xl font-black text-xs transition-all active:scale-95">
                                Cancelar
                              </button>
                            </div>
                          </form>
                        )}

                        {terminandoId === f.id && (
                          <form onSubmit={handleConfirmarTerminar} className="mt-4 bg-surface border border-border rounded-2xl p-4 space-y-3">
                            <div className="space-y-1">
                              <label className="text-[9px] font-black text-muted uppercase ml-1">Terminar a partir de</label>
                              <input
                                type="month"
                                value={terminarAPartir}
                                onChange={e => setTerminarAPartir(e.target.value)}
                                className="w-full bg-page border border-border p-2.5 rounded-xl text-sm font-bold focus:border-danger outline-none transition-all"
                                autoFocus
                              />
                            </div>
                            {terminarError && <p className="text-danger text-[11px] font-bold px-1">{terminarError}</p>}
                            <div className="flex gap-2">
                              <button type="submit" disabled={terminando} className="flex-1 py-2.5 bg-danger hover:bg-danger-hover text-on-danger rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50">
                                {terminando ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Confirmar
                              </button>
                              <button type="button" onClick={fecharTerminar} className="px-4 py-2.5 bg-raised hover:bg-border rounded-xl font-black text-xs transition-all active:scale-95">
                                Cancelar
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    );
                  }) : (
                    <div className="text-center py-10 border-2 border-dashed border-border/50 rounded-[2rem]">
                      <p className="text-muted font-bold uppercase text-[10px] tracking-widest">Sem custos fixos</p>
                    </div>
                  )}
                </div>
              </div>

              {/* CUSTOS VARIÁVEIS */}
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h4 className="font-black uppercase text-xs tracking-widest text-secondary">Custos Variáveis</h4>
                  <button
                    type="button"
                    onClick={() => (showNovoVariavel ? setShowNovoVariavel(false) : abrirNovoVariavel())}
                    className={`p-2 rounded-xl border transition-all active:scale-90 ${showNovoVariavel ? 'bg-border text-primary border-border' : 'bg-warning-bg text-warning border-warning/20 hover:bg-warning hover:text-on-warning'}`}
                  >
                    <Plus size={18} />
                  </button>
                </div>

                {showNovoVariavel && (
                  <form onSubmit={handleCriarVariavel} className="mb-5 bg-page/50 border border-border rounded-3xl p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-1 space-y-1">
                        <label className="text-[9px] font-black text-muted uppercase ml-1">Categoria</label>
                        <select
                          value={varCategoria}
                          onChange={e => setVarCategoria(e.target.value)}
                          className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-warning outline-none transition-all appearance-none"
                        >
                          {CATEGORIAS_DESPESA.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="w-full sm:w-32 space-y-1">
                        <label className="text-[9px] font-black text-muted uppercase ml-1">Valor (€)</label>
                        <input
                          type="number"
                          value={varValor}
                          onChange={e => setVarValor(e.target.value)}
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-mono font-black text-warning focus:border-warning outline-none transition-all"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-1 space-y-1">
                        <label className="text-[9px] font-black text-muted uppercase ml-1">Descrição (opcional)</label>
                        <input
                          type="text"
                          value={varDescricao}
                          onChange={e => setVarDescricao(e.target.value)}
                          placeholder="ex: resma de papel"
                          className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-warning outline-none transition-all"
                        />
                      </div>
                      <div className="w-full sm:w-40 space-y-1">
                        <label className="text-[9px] font-black text-muted uppercase ml-1">Data</label>
                        <input
                          type="date"
                          value={varData}
                          onChange={e => setVarData(e.target.value)}
                          className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-warning outline-none transition-all"
                        />
                      </div>
                    </div>
                    {criarVariavelError && <p className="text-danger text-[11px] font-bold px-1">{criarVariavelError}</p>}
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        disabled={criandoVariavel}
                        className="flex-1 py-3 bg-warning hover:bg-warning-hover text-on-warning rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                      >
                        {criandoVariavel ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                        Registar Custo Variável
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowNovoVariavel(false); setCriarVariavelError(null); }}
                        className="px-5 py-3 bg-raised hover:bg-border rounded-2xl font-black text-sm transition-all active:scale-95"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-3 max-h-[480px] overflow-y-auto pr-2 custom-scrollbar">
                  {custosMes.variaveis.length > 0 ? custosMes.variaveis.map(d => (
                    <div
                      key={d.id}
                      data-custo-variavel-linha="1"
                      className="bg-page/40 border border-border/50 p-5 rounded-3xl flex items-start justify-between gap-3 group hover:border-border transition-all"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-[9px] font-black uppercase text-warning bg-warning-bg border border-warning/20 px-2 py-0.5 rounded-md tracking-tight inline-block break-words">{d.categoria}</span>
                        <span className="font-bold text-sm text-secondary block mt-1 break-words">{d.descricao || '—'}</span>
                        <span className="text-[10px] text-muted font-bold mt-0.5 block">{new Date(d.data + 'T00:00:00').toLocaleDateString('pt-PT')}</span>
                        <button
                          onClick={() => handleApagarVariavel(d.id, d.categoria, d.valor)}
                          className="text-[9px] text-danger/40 font-bold uppercase mt-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all hover:text-danger text-left"
                        >
                          Apagar
                        </button>
                      </div>
                      <span className="font-mono font-black text-warning text-lg shrink-0">{Number(d.valor).toFixed(2)} €</span>
                    </div>
                  )) : (
                    <div className="text-center py-10 border-2 border-dashed border-border/50 rounded-[2rem]">
                      <p className="text-muted font-bold uppercase text-[10px] tracking-widest">Sem custos variáveis este mês</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* BLOCO 2: SERVIÇOS EXTRA */}
        <section className="bg-surface border border-border/60 p-8 rounded-[2.5rem] shadow-2xl backdrop-blur-sm">
          <div className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-success-bg rounded-2xl text-success">
                <DollarSign size={24} />
              </div>
              <h3 className="text-primary font-black uppercase text-sm tracking-widest">Tarifário de Extras</h3>
            </div>
            <button
              onClick={() => { setShowNovoServico(v => !v); setCriarError(null); }}
              className={`p-2 rounded-xl border transition-all active:scale-90 ${showNovoServico ? 'bg-border text-primary border-border' : 'bg-success-bg text-success border-success/20 hover:bg-success hover:text-on-success'}`}
            >
              <Plus size={20} />
            </button>
          </div>

          {showNovoServico && (
            <form onSubmit={handleCreateService} className="mb-6 bg-page/50 border border-border rounded-3xl p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-muted uppercase ml-1">Nome</label>
                <input
                  type="text"
                  value={novoNome}
                  onChange={e => setNovoNome(e.target.value)}
                  placeholder="ex: Almoço, Transporte"
                  className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-success outline-none transition-all"
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-[9px] font-black text-muted uppercase ml-1">Preço (€)</label>
                  <input
                    type="number"
                    value={novoPreco}
                    onChange={e => setNovoPreco(e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-mono font-black text-success focus:border-success outline-none transition-all"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[9px] font-black text-muted uppercase ml-1">Custo (€)</label>
                  <input
                    type="number"
                    value={novoCusto}
                    onChange={e => setNovoCusto(e.target.value)}
                    placeholder="opcional"
                    min="0"
                    step="0.01"
                    className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-mono font-black text-muted focus:border-accent outline-none transition-all"
                  />
                </div>
              </div>
              {criarError && (
                <p className="text-danger text-[11px] font-bold px-1">{criarError}</p>
              )}
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={criando}
                  className="flex-1 py-3 bg-success hover:bg-success-hover text-on-success rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                >
                  {criando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Criar Serviço
                </button>
                <button
                  type="button"
                  onClick={() => { setShowNovoServico(false); setCriarError(null); setNovoNome(''); setNovoPreco(''); setNovoCusto(''); }}
                  className="px-5 py-3 bg-raised hover:bg-border rounded-2xl font-black text-sm transition-all active:scale-95"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {servicos.length > 0 ? servicos.map(s => (
              <div 
                key={s.id} 
                className="bg-page/40 border border-border/50 p-5 rounded-3xl flex items-center justify-between group hover:border-border transition-all"
              >
                <div className="flex flex-col">
                  <span className="font-black uppercase text-[11px] text-secondary tracking-tight">{s.nome}</span>
                  <button 
                    onClick={() => handleDeleteService(s.id, s.nome)} 
                    className="text-[9px] text-danger/40 font-bold uppercase mt-1 opacity-0 group-hover:opacity-100 transition-all hover:text-danger"
                  >
                    Remover Serviço
                  </button>
                </div>
                <div className="flex flex-col gap-1.5 items-end shrink-0">
                  <div className="flex items-center gap-2 bg-surface py-1.5 px-3 rounded-xl border border-border">
                    <span className="text-[8px] font-black uppercase text-muted tracking-widest w-9">Preço</span>
                    <input
                      type="number"
                      defaultValue={s.preco}
                      onBlur={(e) => updatePrecoServico(s.id, e.target.value)}
                      className="w-14 bg-transparent text-right font-mono text-success font-black text-base outline-none"
                    />
                    <span className="text-muted font-black text-xs">€</span>
                  </div>
                  <div className="flex items-center gap-2 bg-surface py-1.5 px-3 rounded-xl border border-border">
                    <span className="text-[8px] font-black uppercase text-muted tracking-widest w-9">Custo</span>
                    <input
                      type="number"
                      defaultValue={s.custo ?? ''}
                      placeholder="—"
                      onBlur={(e) => updateCustoServico(s.id, e.target.value)}
                      className="w-14 bg-transparent text-right font-mono text-muted font-black text-base outline-none placeholder:text-muted/40"
                    />
                    <span className="text-muted font-black text-xs">€</span>
                  </div>
                </div>
              </div>
            )) : (
              <div className="text-center py-12 border-2 border-dashed border-border/50 rounded-[2rem]">
                <p className="text-muted font-bold uppercase text-[10px] tracking-widest">Sem serviços extra definidos</p>
              </div>
            )}
          </div>
        </section>

        {/* BLOCO 1: INSTITUIÇÃO */}
        <section className="bg-surface border border-border/60 p-8 rounded-[2.5rem] shadow-2xl backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-3 bg-accent-soft rounded-2xl text-accent">
              <Building2 size={24} />
            </div>
            <h3 className="text-primary font-black uppercase text-sm tracking-widest">Configuração do Centro</h3>
          </div>

          <form onSubmit={handleSaveCentro} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase ml-1">Nome da Instituição</label>
              <input 
                type="text" 
                value={nomeCentro} 
                onChange={e => setNomeCentro(e.target.value)} 
                className="w-full bg-page/50 border border-border p-4 rounded-2xl font-bold text-sm focus:border-accent outline-none transition-all" 
              />
            </div>
            <button
              type="submit" 
              disabled={submitting} 
              className={`w-full p-5 rounded-[1.5rem] font-black flex items-center justify-center gap-3 transition-all active:scale-95 ${success ? 'bg-success text-on-success shadow-lg shadow-success/20' : 'bg-accent hover:bg-accent-hover text-on-accent shadow-lg shadow-accent/20'}`}
            >
              {submitting ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
              {success ? 'DADOS ATUALIZADOS' : 'GUARDAR ALTERAÇÕES'}
            </button>
            {saveError && (
              <p className="text-danger text-[11px] font-bold px-1 pt-2">{saveError}</p>
            )}
          </form>
        </section>

        {/* BLOCO 4: PREÇOS DE EXPLICAÇÕES (FAMÍLIA) */}
        <section className="bg-surface border border-border/60 p-8 rounded-[2.5rem] shadow-2xl backdrop-blur-sm">
          <div className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-accent-soft rounded-2xl text-accent">
                <GraduationCap size={24} />
              </div>
              <h3 className="text-primary font-black uppercase text-sm tracking-widest">Preços de Explicações</h3>
            </div>
            <button
              onClick={() => (precoEditandoId === null ? abrirNovoPreco() : fecharFormPreco())}
              className={`p-2 rounded-xl border transition-all active:scale-90 ${precoEditandoId !== null ? 'bg-border text-primary border-border' : 'bg-accent-soft text-accent border-accent/20 hover:bg-accent hover:text-on-accent'}`}
            >
              <Plus size={20} />
            </button>
          </div>

          {precoEditandoId !== null && (
            <div className="mb-6 bg-page/50 border border-border rounded-3xl p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-muted uppercase ml-1">Disciplina</label>
                <select
                  value={precoDisciplinaId}
                  onChange={(e) => { setPrecoDisciplinaId(e.target.value); setPrecoAno(''); }}
                  className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-accent outline-none transition-all appearance-none"
                >
                  <option value="">Disciplina...</option>
                  {subjects.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-muted uppercase ml-1">Ano</label>
                <select
                  value={precoAno}
                  onChange={(e) => setPrecoAno(e.target.value)}
                  disabled={!precoDisciplinaId}
                  className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-accent outline-none transition-all appearance-none disabled:opacity-50"
                >
                  <option value="">Todos os anos</option>
                  {anosParaDisciplina(precoDisciplinaId).map((ano) => (
                    <option key={ano} value={ano}>{ano}º Ano</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-[9px] font-black text-muted uppercase ml-1">Tipo</label>
                  <select
                    value={precoTipo}
                    onChange={(e) => setPrecoTipo(e.target.value)}
                    className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-accent outline-none transition-all appearance-none"
                  >
                    <option value="">Tipo...</option>
                    {TIPOS_PRECO_FAMILIA.map((t) => (
                      <option key={t.valor} value={t.valor}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[9px] font-black text-muted uppercase ml-1">Valor (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={precoValor}
                    onChange={(e) => setPrecoValor(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-mono font-black text-accent focus:border-accent outline-none transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleSalvarPreco}
                  disabled={savingPreco}
                  className="flex-1 py-3 bg-accent hover:bg-accent-hover text-on-accent rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                >
                  {savingPreco ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Guardar Preço
                </button>
                <button
                  type="button"
                  onClick={fecharFormPreco}
                  disabled={savingPreco}
                  className="px-5 py-3 bg-raised hover:bg-border rounded-2xl font-black text-sm transition-all active:scale-95"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {precosFamilia.length > 0 ? precosFamilia.map((p: any) => (
              <div
                key={p.id}
                className="bg-page/40 border border-border/50 p-5 rounded-3xl flex items-center justify-between group hover:border-border transition-all"
              >
                <div className="flex flex-col min-w-0">
                  <span className="font-black uppercase text-[11px] text-secondary tracking-tight truncate">{p.subjects?.name}</span>
                  <span className="text-[10px] text-muted font-bold mt-0.5">
                    {p.ano_escolar != null ? `${p.ano_escolar}º ano` : 'Todos os anos'} · {TIPO_PRECO_LABEL[p.tipo] ?? p.tipo}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className="font-mono font-black text-accent text-lg">{Number(p.valor).toFixed(2)} €</span>
                  <button type="button" onClick={() => editarPreco(p)} className="p-1.5 text-muted hover:text-accent transition-colors">
                    <Pencil size={14} />
                  </button>
                  <button type="button" onClick={() => handleApagarPreco(p.id)} className="p-1.5 text-muted hover:text-danger transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )) : (
              <div className="text-center py-12 border-2 border-dashed border-border/50 rounded-[2rem]">
                <p className="text-muted font-bold uppercase text-[10px] tracking-widest">Sem preços definidos</p>
              </div>
            )}
          </div>
        </section>

      </div>

      <StatusToast toast={toast} />
    </main>
  );
}