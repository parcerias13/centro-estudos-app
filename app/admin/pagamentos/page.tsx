'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { garantirMesGerado } from '@/lib/mensalidades';
import { useStatusToast, StatusToast } from '@/lib/statusToast';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Search, Wallet, Loader2, CalendarClock,
  GraduationCap, AlertTriangle,
} from 'lucide-react';
import { startOfMonth, addMonths, format } from 'date-fns';
import { pt } from 'date-fns/locale';

type Aba = 'mensalidades' | 'a_pagar';

export default function PagamentosPage() {
  const { toast, showError, showSuccess } = useStatusToast();
  const [aba, setAba] = useState<Aba>('mensalidades');
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [centroId, setCentroId] = useState<string | null>(null);

  const ano = currentMonth.getFullYear();
  const mes = currentMonth.getMonth() + 1;

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCentroId(user?.app_metadata?.centro_id ?? null);
    });
  }, []);

  return (
    <main className="min-h-screen bg-page text-primary p-6 md:p-8 max-w-7xl mx-auto font-sans">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="p-3 bg-surface border border-border rounded-2xl hover:bg-raised transition-colors">
            <ArrowLeft size={20} className="text-secondary" />
          </Link>
          <div>
            <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter uppercase flex items-center gap-3">
              <Wallet className="text-accent" /> Pagamentos
            </h1>
            <p className="text-muted text-[10px] font-black uppercase tracking-widest mt-1">
              {aba === 'mensalidades' ? 'Mensalidades por Mês' : 'A Pagar a Professores'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* SEPARADORES */}
          <div className="flex items-center bg-surface border border-border rounded-2xl overflow-hidden p-1">
            <button
              onClick={() => setAba('mensalidades')}
              className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${
                aba === 'mensalidades' ? 'bg-accent text-on-accent' : 'text-secondary hover:text-primary'
              }`}
            >
              Mensalidades
            </button>
            <button
              onClick={() => setAba('a_pagar')}
              className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${
                aba === 'a_pagar' ? 'bg-accent text-on-accent' : 'text-secondary hover:text-primary'
              }`}
            >
              A Pagar
            </button>
          </div>

          {/* SELETOR DE MÊS */}
          <div className="flex items-center bg-surface border border-border rounded-2xl overflow-hidden p-1 shadow-xl">
            <button onClick={() => setCurrentMonth((prev) => addMonths(prev, -1))} className="p-2 hover:bg-raised text-secondary hover:text-primary transition-all">
              <ChevronLeft size={20} />
            </button>
            <div className="px-4 py-1 text-center min-w-40">
              <p className="text-sm font-black text-primary capitalize">
                {format(currentMonth, 'MMMM yyyy', { locale: pt })}
              </p>
            </div>
            <button onClick={() => setCurrentMonth((prev) => addMonths(prev, 1))} className="p-2 hover:bg-raised text-secondary hover:text-primary transition-all">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </div>

      {aba === 'mensalidades' ? (
        <MensalidadesTab ano={ano} mes={mes} showError={showError} showSuccess={showSuccess} />
      ) : (
        <APagarTab ano={ano} mes={mes} centroId={centroId} showError={showError} showSuccess={showSuccess} />
      )}

      <StatusToast toast={toast} />
    </main>
  );
}

// --- ABA MENSALIDADES (comportamento inalterado, só extraído para sub-componente) ---
function MensalidadesTab({ ano, mes, showError, showSuccess }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Explicações (família) — soma de valor_cobrado_familia e lista de sessões
  // do mês, por aluno; e o estado de pago próprio, em pagamentos_explicacoes_familia.
  const [explicacoesPorAluno, setExplicacoesPorAluno] = useState<Record<string, { soma: number; semPrecoCount: number; sessoes: any[] }>>({});
  const [pagamentosExplicacoes, setPagamentosExplicacoes] = useState<Record<string, { id: string; pago: boolean; data_pagamento: string | null }>>({});
  const [expandedAlunoIds, setExpandedAlunoIds] = useState<Set<string>>(new Set());

  const hoje = new Date();
  // Meses futuros não geram linhas — o valor_esperado é um snapshot e não deve
  // ser fixado antes de o mês chegar de verdade (a mensalidade pode mudar entretanto).
  const isFuturo = ano > hoje.getFullYear() || (ano === hoje.getFullYear() && mes > hoje.getMonth() + 1);

  // Guarda contra chamadas sobrepostas (mesmo padrão de isFetchingRef/fetchPendingRef
  // do Dashboard admin): navegação rápida entre meses ou StrictMode em dev podem
  // disparar fetchMes várias vezes antes da anterior terminar.
  const isFetchingRef = useRef(false);
  const fetchPendingRef = useRef(false);

  const fetchMes = useCallback(async () => {
    if (isFuturo) {
      setRows([]);
      setLoading(false);
      return;
    }
    if (isFetchingRef.current) {
      fetchPendingRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const centro_id = user?.app_metadata?.centro_id;
      if (!centro_id) {
        showError('Não foi possível identificar o centro. Recarrega a página e tenta novamente.');
        return;
      }

      const inicioMes = format(new Date(ano, mes - 1, 1), 'yyyy-MM-dd');
      const fimMes = format(new Date(ano, mes, 0), 'yyyy-MM-dd');

      // Uma query batched para todas as sessões dadas do mês (com alunos,
      // disciplina e professor embutidos) + uma para os pagamentos de
      // explicações do mês — nunca uma por aluno.
      const [linhas, { data: sessoesData, error: errSessoes }, { data: pagamentosData, error: errPagamentos }] = await Promise.all([
        garantirMesGerado(centro_id, ano, mes),
        supabase
          .from('explicacoes')
          .select('data, subjects(name), staff(name), explicacoes_alunos(aluno_id, valor_cobrado_familia)')
          .eq('dado', true)
          .gte('data', inicioMes)
          .lte('data', fimMes),
        supabase.from('pagamentos_explicacoes_familia').select('id, aluno_id, pago, data_pagamento').eq('ano', ano).eq('mes', mes),
      ]);

      if (errSessoes || errPagamentos) {
        showError('Erro ao carregar explicações: ' + (errSessoes || errPagamentos)?.message);
      }

      setRows(linhas);

      const porAluno: Record<string, { soma: number; semPrecoCount: number; sessoes: any[] }> = {};
      (sessoesData || []).forEach((exp: any) => {
        const disciplina = exp.subjects?.name || 'Sem disciplina';
        const professor = exp.staff?.name || '—';
        (exp.explicacoes_alunos || []).forEach((ea: any) => {
          if (!porAluno[ea.aluno_id]) porAluno[ea.aluno_id] = { soma: 0, semPrecoCount: 0, sessoes: [] };
          const entry = porAluno[ea.aluno_id];
          if (ea.valor_cobrado_familia != null) {
            entry.soma += Number(ea.valor_cobrado_familia);
          } else {
            entry.semPrecoCount += 1;
          }
          entry.sessoes.push({ data: exp.data, disciplina, professor, valor: ea.valor_cobrado_familia });
        });
      });
      setExplicacoesPorAluno(porAluno);

      const pagMap: Record<string, { id: string; pago: boolean; data_pagamento: string | null }> = {};
      (pagamentosData || []).forEach((p: any) => { pagMap[p.aluno_id] = { id: p.id, pago: p.pago, data_pagamento: p.data_pagamento }; });
      setPagamentosExplicacoes(pagMap);
    } catch (err: any) {
      showError('Erro ao carregar mensalidades: ' + err.message);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
      if (fetchPendingRef.current) {
        fetchPendingRef.current = false;
        fetchMes();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, mes, isFuturo]);

  useEffect(() => { fetchMes(); }, [fetchMes]);

  const handleTogglePago = async (row: any) => {
    const novoPago = !row.pago;
    const updates: Record<string, any> = { pago: novoPago };
    if (novoPago && (row.valor_pago === null || row.valor_pago === undefined)) {
      updates.valor_pago = row.valor_esperado;
    }
    if (novoPago && !row.data_pagamento) {
      updates.data_pagamento = new Date().toISOString().split('T')[0];
    }

    const { error } = await supabase.from('mensalidades').update(updates).eq('id', row.id);
    if (error) {
      showError('Erro ao atualizar estado de pagamento: ' + error.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...updates } : r)));
    showSuccess(novoPago ? 'Mensalidade marcada como paga.' : 'Mensalidade marcada como não paga.');
  };

  const handleUpdateValorPago = async (row: any, valorStr: string) => {
    const bruto = valorStr.trim();
    const valor = bruto === '' ? null : parseFloat(bruto);
    if (bruto !== '' && (valor === null || isNaN(valor))) return;

    const { error } = await supabase.from('mensalidades').update({ valor_pago: valor }).eq('id', row.id);
    if (error) {
      showError('Erro ao atualizar valor pago: ' + error.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, valor_pago: valor } : r)));
    showSuccess('Valor pago atualizado.');
  };

  const handleUpdateData = async (row: any, dataStr: string) => {
    const valor = dataStr === '' ? null : dataStr;
    const { error } = await supabase.from('mensalidades').update({ data_pagamento: valor }).eq('id', row.id);
    if (error) {
      showError('Erro ao atualizar data de pagamento: ' + error.message);
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, data_pagamento: valor } : r)));
    showSuccess('Data de pagamento atualizada.');
  };

  // --- Estado de pago das Explicações (família) — próprio, não toca em mensalidades ---
  const toggleExpandido = (alunoId: string) => {
    setExpandedAlunoIds((prev) => {
      const next = new Set(prev);
      if (next.has(alunoId)) next.delete(alunoId);
      else next.add(alunoId);
      return next;
    });
  };

  const handleToggleExplicacoesPago = async (alunoId: string) => {
    const atual = pagamentosExplicacoes[alunoId];
    const novoPago = !atual?.pago;
    // Sem centro_id no payload: pagamentos_explicacoes_familia não tem essa
    // coluna (ao contrário de pagamentos_professores) — a RLS já protege via
    // alunos.centro_id.
    const payload: Record<string, any> = { aluno_id: alunoId, ano, mes, pago: novoPago };
    if (novoPago && !atual?.data_pagamento) payload.data_pagamento = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('pagamentos_explicacoes_familia')
      .upsert(payload, { onConflict: 'aluno_id,ano,mes' })
      .select()
      .single();

    if (error) {
      showError('Erro ao atualizar pagamento de explicações: ' + error.message);
      return;
    }
    setPagamentosExplicacoes((prev) => ({ ...prev, [alunoId]: { id: data.id, pago: data.pago, data_pagamento: data.data_pagamento } }));
    showSuccess(novoPago ? 'Explicações marcadas como pagas.' : 'Explicações marcadas como não pagas.');
  };

  const handleUpdateDataPagamentoExplicacoes = async (alunoId: string, dataStr: string) => {
    const pagamento = pagamentosExplicacoes[alunoId];
    if (!pagamento) return;
    const valor = dataStr === '' ? null : dataStr;
    const { error } = await supabase.from('pagamentos_explicacoes_familia').update({ data_pagamento: valor }).eq('id', pagamento.id);
    if (error) {
      showError('Erro ao atualizar data de pagamento: ' + error.message);
      return;
    }
    setPagamentosExplicacoes((prev) => ({ ...prev, [alunoId]: { ...prev[alunoId], data_pagamento: valor } }));
    showSuccess('Data de pagamento atualizada.');
  };

  const getNome = (row: any) => {
    const aluno = Array.isArray(row.alunos) ? row.alunos[0] : row.alunos;
    return aluno?.nome || 'Desconhecido';
  };

  const rowsFiltradas = rows.filter((r) => getNome(r).toLowerCase().includes(searchQuery.toLowerCase()));

  const totalEsperado = rows.reduce((acc, r) => acc + (Number(r.valor_esperado) || 0), 0);
  const totalPago = rows.reduce((acc, r) => acc + (r.pago ? (Number(r.valor_pago) || 0) : 0), 0);
  const emFalta = totalEsperado - totalPago;
  const pctCobranca = totalEsperado > 0 ? (totalPago / totalEsperado) * 100 : 0;

  if (isFuturo) {
    return (
      <div className="bg-surface/70 border-2 border-dashed border-border p-16 rounded-[3rem] text-center flex flex-col items-center">
        <CalendarClock size={48} className="mb-6 text-muted" />
        <p className="text-muted font-bold text-lg">Este mês ainda não chegou.</p>
        <p className="text-muted text-sm mt-2 max-w-md">
          As mensalidades só são geradas quando o mês atual chega, para não fixar valores que ainda podem mudar entretanto.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* BARRA DE RESUMO */}
      <div className="bg-surface border border-border rounded-3xl p-8 mb-8 grid grid-cols-2 md:grid-cols-4 gap-6">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Total Esperado</p>
          <p className="text-2xl font-black text-primary tracking-tighter">{totalEsperado.toFixed(2)}€</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Total Pago</p>
          <p className="text-2xl font-black text-success tracking-tighter">{totalPago.toFixed(2)}€</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Em Falta</p>
          <p className={`text-2xl font-black tracking-tighter ${emFalta > 0 ? 'text-danger' : 'text-muted'}`}>{emFalta.toFixed(2)}€</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">% Cobrança</p>
          <p className="text-2xl font-black text-accent tracking-tighter">{pctCobranca.toFixed(0)}%</p>
        </div>
      </div>

      {/* PESQUISA */}
      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
        <input
          type="text"
          placeholder="Pesquisar aluno..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-surface/50 border border-border p-3 pl-10 rounded-xl text-sm outline-none focus:border-accent/50 transition-all"
        />
      </div>

      {/* TABELA */}
      <div className="bg-surface border border-border rounded-4xl overflow-hidden shadow-2xl relative min-h-50">
        {loading && (
          <div className="absolute inset-0 bg-surface/80 backdrop-blur-sm flex items-center justify-center z-10">
            <Loader2 className="animate-spin text-accent" size={32} />
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-page/50 border-b border-border text-[10px] uppercase tracking-widest text-muted">
                <th className="p-6 font-black" rowSpan={2}>Aluno</th>
                <th className="p-3 font-black text-center border-l border-border" colSpan={4}>Mensalidade</th>
                <th className="p-3 font-black text-center border-l border-border" colSpan={2}>Explicações</th>
              </tr>
              <tr className="bg-page/50 border-b border-border text-[10px] uppercase tracking-widest text-muted">
                <th className="p-4 font-black text-right border-l border-border">Valor Esperado</th>
                <th className="p-4 font-black text-center">Estado</th>
                <th className="p-4 font-black text-right">Valor Pago</th>
                <th className="p-4 font-black text-center">Data de Pagamento</th>
                <th className="p-4 font-black text-right border-l border-border">Valor</th>
                <th className="p-4 font-black text-center">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!loading && rowsFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-16 text-center text-muted font-medium italic">
                    <Wallet size={48} className="mx-auto mb-4 opacity-20" />
                    {rows.length === 0 ? 'Sem alunos ativos para gerar mensalidades neste mês.' : 'Nenhum aluno encontrado para a pesquisa.'}
                  </td>
                </tr>
              ) : (
                rowsFiltradas.map((row) => {
                  const explicacoes = explicacoesPorAluno[row.aluno_id];
                  const pagamentoExplicacoes = pagamentosExplicacoes[row.aluno_id];
                  const expandido = expandedAlunoIds.has(row.aluno_id);

                  return (
                    <Fragment key={row.id}>
                      <tr className="hover:bg-raised/20 transition-colors">
                        <td className="p-6 font-black text-primary whitespace-nowrap">{getNome(row)}</td>
                        <td className="p-6 text-right font-mono font-bold text-secondary whitespace-nowrap border-l border-border">
                          {Number(row.valor_esperado).toFixed(2)}€
                        </td>
                        <td className="p-6 text-center whitespace-nowrap">
                          <button
                            onClick={() => handleTogglePago(row)}
                            className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
                              row.pago
                                ? 'bg-success-bg text-success border-success/30'
                                : 'bg-danger-bg text-danger border-danger/30'
                            }`}
                          >
                            {row.pago ? 'Pago' : 'Não Pago'}
                          </button>
                        </td>
                        <td className="p-6 text-right whitespace-nowrap">
                          <input
                            key={`vp-${row.id}-${row.valor_pago}`}
                            type="number"
                            step="0.01"
                            defaultValue={row.valor_pago ?? ''}
                            disabled={!row.pago}
                            placeholder="—"
                            onBlur={(e) => handleUpdateValorPago(row, e.target.value)}
                            className="w-24 bg-page border border-border p-2 rounded-lg text-right font-mono font-bold text-primary outline-none focus:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                          />
                        </td>
                        <td className="p-6 text-center whitespace-nowrap">
                          <input
                            key={`dp-${row.id}-${row.data_pagamento}`}
                            type="date"
                            defaultValue={row.data_pagamento ?? ''}
                            disabled={!row.pago}
                            onChange={(e) => handleUpdateData(row, e.target.value)}
                            className="bg-page border border-border p-2 rounded-lg text-primary outline-none focus:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                          />
                        </td>
                        <td className="p-6 text-right whitespace-nowrap border-l border-border">
                          {explicacoes ? (
                            <>
                              <button
                                type="button"
                                onClick={() => toggleExpandido(row.aluno_id)}
                                className="font-mono font-bold text-primary hover:text-accent underline decoration-dotted transition-colors"
                              >
                                {explicacoes.soma.toFixed(2)}€
                              </button>
                              {explicacoes.semPrecoCount > 0 && (
                                <p className="text-[9px] text-warning font-bold mt-1 flex items-center gap-1 justify-end">
                                  <AlertTriangle size={11} />
                                  Preço não definido — {explicacoes.semPrecoCount} {explicacoes.semPrecoCount === 1 ? 'sessão' : 'sessões'} sem valor
                                </p>
                              )}
                            </>
                          ) : (
                            <span className="text-muted font-bold">—</span>
                          )}
                        </td>
                        <td className="p-6 text-center whitespace-nowrap">
                          {explicacoes ? (
                            <button
                              onClick={() => handleToggleExplicacoesPago(row.aluno_id)}
                              className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
                                pagamentoExplicacoes?.pago
                                  ? 'bg-success-bg text-success border-success/30'
                                  : 'bg-danger-bg text-danger border-danger/30'
                              }`}
                            >
                              {pagamentoExplicacoes?.pago ? 'Pago' : 'Não Pago'}
                            </button>
                          ) : (
                            <span className="text-muted text-[10px] font-black uppercase tracking-widest">Sem sessões</span>
                          )}
                        </td>
                      </tr>
                      {expandido && explicacoes && (
                        <tr className="bg-page/30">
                          <td colSpan={7} className="p-6">
                            <div className="flex items-start justify-between gap-6">
                              <div className="space-y-1.5 flex-1">
                                <p className="text-[9px] font-black uppercase text-muted tracking-widest mb-2">Sessões de {getNome(row)} este mês</p>
                                {explicacoes.sessoes.map((s: any, i: number) => (
                                  <div key={i} className="flex items-center justify-between text-xs bg-surface border border-border/60 rounded-xl px-4 py-2">
                                    <span className="text-secondary font-bold">
                                      {new Date(s.data + 'T00:00:00').toLocaleDateString('pt-PT')} · {s.disciplina} · {s.professor}
                                    </span>
                                    {s.valor != null ? (
                                      <span className="font-mono font-bold text-primary">{Number(s.valor).toFixed(2)}€</span>
                                    ) : (
                                      <span className="font-bold text-warning flex items-center gap-1">
                                        <AlertTriangle size={10} /> Sem preço
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                              <div className="shrink-0 space-y-1">
                                <label className="text-[9px] font-black text-muted uppercase ml-1">Data de Pagamento</label>
                                <input
                                  key={`dpe-${row.aluno_id}-${pagamentoExplicacoes?.data_pagamento}`}
                                  type="date"
                                  defaultValue={pagamentoExplicacoes?.data_pagamento ?? ''}
                                  disabled={!pagamentoExplicacoes?.pago}
                                  onChange={(e) => handleUpdateDataPagamentoExplicacoes(row.aluno_id, e.target.value)}
                                  className="bg-page border border-border p-2 rounded-lg text-primary outline-none focus:border-accent/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all block"
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-page/80 p-5 text-[10px] uppercase font-black tracking-widest text-muted flex justify-between items-center border-t border-border">
          <span>Total: {rowsFiltradas.length} {rowsFiltradas.length === 1 ? 'Aluno' : 'Alunos'}</span>
        </div>
      </div>
    </>
  );
}

// --- ABA A PAGAR (professores) ---
function APagarTab({ ano, mes, centroId, showError, showSuccess }: any) {
  const [linhas, setLinhas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Mesmo padrão isFetchingRef/fetchPendingRef usado no Dashboard, em Explicações
  // e na aba Mensalidades — aplicado desde já, sem esperar o problema aparecer.
  const isFetchingRef = useRef(false);
  const fetchPendingRef = useRef(false);

  const fetchAPagar = useCallback(async () => {
    if (isFetchingRef.current) {
      fetchPendingRef.current = true;
      return;
    }
    isFetchingRef.current = true;
    setLoading(true);

    try {
      const inicioMes = format(new Date(ano, mes - 1, 1), 'yyyy-MM-dd');
      const fimMes = format(new Date(ano, mes, 0), 'yyyy-MM-dd');

      const [{ data: professoresData, error: errProf }, { data: sessoesData, error: errSess }, { data: pagamentosData, error: errPag }] = await Promise.all([
        supabase.from('staff').select('id, name, tarifa_tipo').eq('role', 'professor').order('name'),
        supabase.from('explicacoes').select('professor_id, horas_dadas, valor_calculado').eq('dado', true).gte('data', inicioMes).lte('data', fimMes),
        supabase.from('pagamentos_professores').select('professor_id, pago').eq('ano', ano).eq('mes', mes),
      ]);

      if (errProf || errSess || errPag) {
        showError('Erro ao carregar dados de pagamento: ' + (errProf || errSess || errPag)?.message);
        return;
      }

      const pagoMap: Record<string, boolean> = {};
      (pagamentosData || []).forEach((p: any) => { pagoMap[p.professor_id] = p.pago; });

      const agregados: Record<string, { sessoes: number; horas: number; valor: number }> = {};
      (sessoesData || []).forEach((s: any) => {
        if (!agregados[s.professor_id]) agregados[s.professor_id] = { sessoes: 0, horas: 0, valor: 0 };
        agregados[s.professor_id].sessoes += 1;
        agregados[s.professor_id].horas += Number(s.horas_dadas) || 0;
        agregados[s.professor_id].valor += Number(s.valor_calculado) || 0;
      });

      const novasLinhas = (professoresData || [])
        .filter((p: any) => agregados[p.id])
        .map((p: any) => ({
          professorId: p.id,
          nome: p.name,
          tarifaDefinida: !!p.tarifa_tipo,
          sessoesDadas: agregados[p.id].sessoes,
          horasTotais: agregados[p.id].horas,
          valorAPagar: agregados[p.id].valor,
          pago: pagoMap[p.id] || false,
        }));

      setLinhas(novasLinhas);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
      if (fetchPendingRef.current) {
        fetchPendingRef.current = false;
        fetchAPagar();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, mes]);

  useEffect(() => { fetchAPagar(); }, [fetchAPagar]);

  const handleTogglePago = async (linha: any) => {
    if (!centroId) {
      showError('Não foi possível identificar o centro. Recarrega a página e tenta novamente.');
      return;
    }
    const novoPago = !linha.pago;
    const payload: Record<string, any> = {
      centro_id: centroId,
      professor_id: linha.professorId,
      ano,
      mes,
      pago: novoPago,
    };
    if (novoPago) payload.data_pagamento = new Date().toISOString().split('T')[0];

    const { error } = await supabase
      .from('pagamentos_professores')
      .upsert(payload, { onConflict: 'professor_id,ano,mes' });

    if (error) {
      showError('Erro ao atualizar pagamento: ' + error.message);
      return;
    }
    setLinhas((prev) => prev.map((l) => (l.professorId === linha.professorId ? { ...l, pago: novoPago } : l)));
    showSuccess(novoPago ? 'Professor marcado como pago.' : 'Marcado como não pago.');
  };

  const linhasFiltradas = linhas.filter((l) => l.nome.toLowerCase().includes(searchQuery.toLowerCase()));

  const totalSessoes = linhas.reduce((acc, l) => acc + l.sessoesDadas, 0);
  const totalHoras = linhas.reduce((acc, l) => acc + l.horasTotais, 0);
  const totalAPagar = linhas.reduce((acc, l) => acc + l.valorAPagar, 0);
  const pendentes = linhas.filter((l) => !l.pago).length;

  return (
    <>
      {/* BARRA DE RESUMO */}
      <div className="bg-surface border border-border rounded-3xl p-8 mb-8 grid grid-cols-2 md:grid-cols-4 gap-6">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Sessões Dadas</p>
          <p className="text-2xl font-black text-primary tracking-tighter">{totalSessoes}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Horas Totais</p>
          <p className="text-2xl font-black text-primary tracking-tighter">{totalHoras.toFixed(1)}h</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Total a Pagar</p>
          <p className="text-2xl font-black text-success tracking-tighter">{totalAPagar.toFixed(2)}€</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Pendentes</p>
          <p className={`text-2xl font-black tracking-tighter ${pendentes > 0 ? 'text-danger' : 'text-muted'}`}>
            {pendentes} de {linhas.length}
          </p>
        </div>
      </div>

      {/* PESQUISA */}
      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
        <input
          type="text"
          placeholder="Pesquisar professor..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-surface/50 border border-border p-3 pl-10 rounded-xl text-sm outline-none focus:border-accent/50 transition-all"
        />
      </div>

      {/* TABELA */}
      <div className="bg-surface border border-border rounded-4xl overflow-hidden shadow-2xl relative min-h-50">
        {loading && (
          <div className="absolute inset-0 bg-surface/80 backdrop-blur-sm flex items-center justify-center z-10">
            <Loader2 className="animate-spin text-accent" size={32} />
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-page/50 border-b border-border text-[10px] uppercase tracking-widest text-muted">
                <th className="p-6 font-black">Professor</th>
                <th className="p-6 font-black text-center">Sessões Dadas</th>
                <th className="p-6 font-black text-center">Horas Totais</th>
                <th className="p-6 font-black text-right">Valor a Pagar</th>
                <th className="p-6 font-black text-center">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!loading && linhasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-16 text-center text-muted font-medium italic">
                    <GraduationCap size={48} className="mx-auto mb-4 opacity-20" />
                    {linhas.length === 0 ? 'Sem sessões dadas neste mês.' : 'Nenhum professor encontrado para a pesquisa.'}
                  </td>
                </tr>
              ) : (
                linhasFiltradas.map((linha) => {
                  const semTarifa = linha.valorAPagar === 0 && linha.sessoesDadas > 0 && !linha.tarifaDefinida;
                  return (
                    <tr key={linha.professorId} className="hover:bg-raised/20 transition-colors">
                      <td className="p-6 font-black text-primary whitespace-nowrap">{linha.nome}</td>
                      <td className="p-6 text-center font-mono font-bold text-secondary whitespace-nowrap">{linha.sessoesDadas}</td>
                      <td className="p-6 text-center font-mono font-bold text-secondary whitespace-nowrap">{linha.horasTotais.toFixed(1)}h</td>
                      <td className="p-6 text-right whitespace-nowrap">
                        <p className="font-mono font-bold text-primary">{linha.valorAPagar.toFixed(2)}€</p>
                        {semTarifa && (
                          <p className="text-[9px] text-warning font-bold flex items-center gap-1 justify-end mt-1">
                            <AlertTriangle size={10} /> Tarifa não definida
                          </p>
                        )}
                      </td>
                      <td className="p-6 text-center whitespace-nowrap">
                        <button
                          onClick={() => handleTogglePago(linha)}
                          className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
                            linha.pago
                              ? 'bg-success-bg text-success border-success/30'
                              : 'bg-danger-bg text-danger border-danger/30'
                          }`}
                        >
                          {linha.pago ? 'Pago' : 'Não Pago'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-page/80 p-5 text-[10px] uppercase font-black tracking-widest text-muted flex justify-between items-center border-t border-border">
          <span>Total: {linhasFiltradas.length} {linhasFiltradas.length === 1 ? 'Professor' : 'Professores'}</span>
        </div>
      </div>
    </>
  );
}
