'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import {
  Building2, Mail, Save, Loader2, DollarSign,
  Plus, Trash2, RefreshCw, ShieldAlert, Key, Receipt, GraduationCap, Pencil
} from 'lucide-react';

const CATEGORIAS_DESPESA = ['Professores', 'Materiais', 'Comida', 'Outros'];

// A coluna despesas.tipo tem um CHECK que só aceita 'fixa' | 'variavel'
// (minúsculas, sem acento). Guardamos esses valores; mostramos os rótulos.
const TIPOS_DESPESA = [
  { valor: 'fixa', label: 'Fixa' },
  { valor: 'variavel', label: 'Variável' },
] as const;
const TIPO_LABEL: Record<string, string> = { fixa: 'Fixa', variavel: 'Variável' };

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
  const [emailRemetente, setEmailRemetente] = useState('');
  const [resendKey, setResendKey] = useState('');

  const [servicos, setServicos] = useState<any[]>([]);

  const [showNovoServico, setShowNovoServico] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoPreco, setNovoPreco] = useState('');
  const [novoCusto, setNovoCusto] = useState('');
  const [criarError, setCriarError] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  // Despesas do mês
  const [despesas, setDespesas] = useState<any[]>([]);
  const [showNovaDespesa, setShowNovaDespesa] = useState(false);
  const [despCategoria, setDespCategoria] = useState('Outros');
  const [despTipo, setDespTipo] = useState<'fixa' | 'variavel'>('variavel');
  const [despDescricao, setDespDescricao] = useState('');
  const [despValor, setDespValor] = useState('');
  const [despData, setDespData] = useState(new Date().toISOString().split('T')[0]);
  const [criandoDespesa, setCriandoDespesa] = useState(false);

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

        // Despesas do mês corrente (coluna `data` é DATE — comparação por string YYYY-MM-DD)
        const agora = new Date();
        const inicioMesStr = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-01`;
        const fimMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0);
        const fimMesStr = `${fimMes.getFullYear()}-${String(fimMes.getMonth() + 1).padStart(2, '0')}-${String(fimMes.getDate()).padStart(2, '0')}`;
        const { data: despRes } = await supabase
          .from('despesas')
          .select('*')
          .gte('data', inicioMesStr)
          .lte('data', fimMesStr)
          .order('data', { ascending: false });
        setDespesas(despRes || []);

        // Disciplinas do centro + preços à família — mesma fonte (subjects)
        // e a mesma lógica de anos_aplicaveis já usada em Equipa (Fase 2).
        const centro_id = user?.app_metadata?.centro_id;
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
        setEmailRemetente(config.email_remetente || '');
        setResendKey(config.resend_api_key || '');
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
      body: JSON.stringify({ nome_centro: nomeCentro, email_remetente: emailRemetente, resend_api_key: resendKey }),
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

  const handleCreateDespesa = async (e: React.FormEvent) => {
    e.preventDefault();
    const valorNum = parseFloat(despValor);
    if (!despCategoria) return showError('Escolhe uma categoria.');
    if (isNaN(valorNum) || valorNum <= 0) return showError('Valor inválido.');
    if (!despData) return showError('Escolhe a data.');

    setCriandoDespesa(true);
    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;
    if (!centro_id) {
      showError('Não foi possível obter o centro. Recarrega a página.');
      setCriandoDespesa(false);
      return;
    }

    const { error } = await supabase.from('despesas').insert({
      categoria: despCategoria,
      tipo: despTipo,
      descricao: despDescricao.trim() || null,
      valor: valorNum,
      data: despData,
      recorrente: false,
      centro_id,
    });
    if (error) {
      showError('Erro ao registar despesa: ' + error.message);
    } else {
      setDespCategoria('Outros');
      setDespTipo('variavel');
      setDespDescricao('');
      setDespValor('');
      setDespData(new Date().toISOString().split('T')[0]);
      setShowNovaDespesa(false);
      loadTudo();
    }
    setCriandoDespesa(false);
  };

  const handleDeleteDespesa = async (id: string, categoria: string, valor: number) => {
    if (!confirm(`Remover esta despesa (${categoria} — ${Number(valor).toFixed(2)}€)?`)) return;
    const { error } = await supabase.from('despesas').delete().eq('id', id);
    if (error) {
      showError('Erro ao remover despesa: ' + error.message);
      return;
    }
    loadTudo();
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
        

        {/* BLOCO 3: DESPESAS DO MÊS */}
        <section className="bg-surface border border-border/60 p-8 rounded-[2.5rem] shadow-2xl backdrop-blur-sm">
          <div className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-warning-bg rounded-2xl text-warning">
                <Receipt size={24} />
              </div>
              <h3 className="text-primary font-black uppercase text-sm tracking-widest">Despesas do Mês</h3>
            </div>
            <button
              onClick={() => setShowNovaDespesa(v => !v)}
              className={`p-2 rounded-xl border transition-all active:scale-90 ${showNovaDespesa ? 'bg-border text-primary border-border' : 'bg-warning-bg text-warning border-warning/20 hover:bg-warning hover:text-on-warning'}`}
            >
              <Plus size={20} />
            </button>
          </div>

          {showNovaDespesa && (
            <form onSubmit={handleCreateDespesa} className="mb-6 bg-page/50 border border-border rounded-3xl p-5 space-y-4">
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-[9px] font-black text-muted uppercase ml-1">Categoria</label>
                  <select
                    value={despCategoria}
                    onChange={e => setDespCategoria(e.target.value)}
                    className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-warning outline-none transition-all appearance-none"
                  >
                    {CATEGORIAS_DESPESA.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="w-32 space-y-1">
                  <label className="text-[9px] font-black text-muted uppercase ml-1">Valor (€)</label>
                  <input
                    type="number"
                    value={despValor}
                    onChange={e => setDespValor(e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-mono font-black text-warning focus:border-warning outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] font-black text-muted uppercase ml-1">Tipo</label>
                <div className="flex gap-2">
                  {TIPOS_DESPESA.map(t => (
                    <button
                      key={t.valor}
                      type="button"
                      onClick={() => setDespTipo(t.valor)}
                      className={`flex-1 py-2 rounded-2xl text-xs font-black uppercase border transition-all ${
                        despTipo === t.valor
                          ? 'bg-warning border-warning text-on-warning'
                          : 'bg-surface border-border text-muted hover:border-warning/40'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label className="text-[9px] font-black text-muted uppercase ml-1">Descrição (opcional)</label>
                  <input
                    type="text"
                    value={despDescricao}
                    onChange={e => setDespDescricao(e.target.value)}
                    placeholder="ex: salário Set., resma de papel"
                    className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-warning outline-none transition-all"
                  />
                </div>
                <div className="w-40 space-y-1">
                  <label className="text-[9px] font-black text-muted uppercase ml-1">Data</label>
                  <input
                    type="date"
                    value={despData}
                    onChange={e => setDespData(e.target.value)}
                    className="w-full bg-surface border border-border p-3 rounded-2xl text-sm font-bold focus:border-warning outline-none transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={criandoDespesa}
                  className="flex-1 py-3 bg-warning hover:bg-warning-hover text-on-warning rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                >
                  {criandoDespesa ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Registar Despesa
                </button>
                <button
                  type="button"
                  onClick={() => setShowNovaDespesa(false)}
                  className="px-5 py-3 bg-raised hover:bg-border rounded-2xl font-black text-sm transition-all active:scale-95"
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {despesas.length > 0 ? despesas.map(d => (
              <div
                key={d.id}
                className="bg-page/40 border border-border/50 p-5 rounded-3xl flex items-center justify-between group hover:border-border transition-all"
              >
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-black uppercase text-warning bg-warning-bg border border-warning/20 px-2 py-0.5 rounded-md tracking-tight">{d.categoria}</span>
                    <span className="text-[9px] font-black uppercase text-muted tracking-tight">{TIPO_LABEL[d.tipo] ?? d.tipo}</span>
                  </div>
                  <span className="font-bold text-sm text-secondary truncate mt-1">{d.descricao || '—'}</span>
                  <span className="text-[10px] text-muted font-bold mt-0.5">{new Date(d.data + 'T00:00:00').toLocaleDateString('pt-PT')}</span>
                  <button
                    onClick={() => handleDeleteDespesa(d.id, d.categoria, d.valor)}
                    className="text-[9px] text-danger/40 font-bold uppercase mt-1 opacity-0 group-hover:opacity-100 transition-all hover:text-danger text-left"
                  >
                    Remover
                  </button>
                </div>
                <span className="font-mono font-black text-warning text-lg shrink-0 ml-3">{Number(d.valor).toFixed(2)} €</span>
              </div>
            )) : (
              <div className="text-center py-12 border-2 border-dashed border-border/50 rounded-[2rem]">
                <p className="text-muted font-bold uppercase text-[10px] tracking-widest">Sem despesas registadas este mês</p>
              </div>
            )}

            {despesas.length > 0 && (
              <div className="flex justify-between items-center pt-2 px-2">
                <span className="text-[10px] font-black uppercase text-muted tracking-widest">Total do mês</span>
                <span className="font-mono font-black text-warning text-lg">
                  {despesas.reduce((acc, d) => acc + (Number(d.valor) || 0), 0).toFixed(2)} €
                </span>
              </div>
            )}
          </div>
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
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase ml-1">Email de Suporte/Faturação</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                <input 
                  type="email" 
                  value={emailRemetente} 
                  onChange={e => setEmailRemetente(e.target.value)} 
                  className="w-full bg-page/50 border border-border p-4 pl-12 rounded-2xl font-bold text-sm focus:border-accent outline-none transition-all" 
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-warning uppercase ml-1">Resend API Key (Automação de Emails)</label>
              <div className="relative">
                <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-warning/50" size={18} />
                <input 
                  type="password" 
                  value={resendKey} 
                  onChange={e => setResendKey(e.target.value)} 
                  className="w-full bg-page/50 border border-border p-4 pl-12 rounded-2xl font-mono text-xs focus:border-warning outline-none transition-all" 
                />
              </div>
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
              <h3 className="text-primary font-black uppercase text-sm tracking-widest">Preços de Explicações (Família)</h3>
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