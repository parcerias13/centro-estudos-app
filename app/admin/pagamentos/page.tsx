'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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

      const linhas = await garantirMesGerado(centro_id, ano, mes);
      setRows(linhas);
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
                <th className="p-6 font-black">Aluno</th>
                <th className="p-6 font-black text-right">Valor Esperado</th>
                <th className="p-6 font-black text-center">Estado</th>
                <th className="p-6 font-black text-right">Valor Pago</th>
                <th className="p-6 font-black text-center">Data de Pagamento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!loading && rowsFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-16 text-center text-muted font-medium italic">
                    <Wallet size={48} className="mx-auto mb-4 opacity-20" />
                    {rows.length === 0 ? 'Sem alunos ativos para gerar mensalidades neste mês.' : 'Nenhum aluno encontrado para a pesquisa.'}
                  </td>
                </tr>
              ) : (
                rowsFiltradas.map((row) => (
                  <tr key={row.id} className="hover:bg-raised/20 transition-colors">
                    <td className="p-6 font-black text-primary whitespace-nowrap">{getNome(row)}</td>
                    <td className="p-6 text-right font-mono font-bold text-secondary whitespace-nowrap">
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
                  </tr>
                ))
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
