'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Activity, RefreshCw, Loader2 } from 'lucide-react';

export default function AdminStats() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>({
    accumulatedRevenue: 0,
    projectedRevenue: 0,
    totalDespesasMes: 0,
    lucroLiquido: 0,
    margemPct: 0,
    despesasFixas: 0,
    despesasVariaveis: 0,
  });

  const processStats = useCallback(async () => {
    setLoading(true);
    try {
      const agora = new Date();
      const primeiroDiaMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
      const totalDiasMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
      const diaAtual = agora.getDate();

      // Janela de despesas: mesmas strings YYYY-MM-DD usadas na página de Gestão
      const inicioMesStr = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-01`;
      const fimMesStr = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(totalDiasMes).padStart(2, '0')}`;

      const [
        { data: extras },
        { data: alunos },
        { data: despesas },
      ] = await Promise.all([
        supabase.from('consumos_diarios').select('preco_aplicado').gte('data_consumo', primeiroDiaMes.split('T')[0]),
        supabase.from('alunos').select('mensalidade_base'),
        supabase.from('despesas').select('valor, tipo').gte('data', inicioMesStr).lte('data', fimMesStr),
      ]);

      // --- RECEITA (lógica intocada) ---
      const totalMensalidadesBase = alunos?.reduce((acc, curr) => acc + (Number(curr.mensalidade_base) || 0), 0) || 0;
      const totalExtrasMes = extras?.reduce((acc, curr) => acc + (Number(curr.preco_aplicado) || 0), 0) || 0;
      const accumulatedRevenue = totalMensalidadesBase + totalExtrasMes;
      const mediaExtrasDiaria = totalExtrasMes / diaAtual;
      const projectedRevenue = totalMensalidadesBase + (mediaExtrasDiaria * totalDiasMes);

      // --- DESPESAS DO MÊS ---
      const totalDespesasMes = despesas?.reduce((acc, d) => acc + (Number(d.valor) || 0), 0) || 0;
      const despesasFixas = despesas?.filter(d => d.tipo === 'fixa').reduce((acc, d) => acc + (Number(d.valor) || 0), 0) || 0;
      const despesasVariaveis = despesas?.filter(d => d.tipo === 'variavel').reduce((acc, d) => acc + (Number(d.valor) || 0), 0) || 0;

      // --- LUCRO ---
      const lucroLiquido = accumulatedRevenue - totalDespesasMes;
      const margemPct = accumulatedRevenue > 0 ? (lucroLiquido / accumulatedRevenue) * 100 : 0;

      setStats({
        accumulatedRevenue,
        projectedRevenue,
        totalDespesasMes,
        lucroLiquido,
        margemPct,
        despesasFixas,
        despesasVariaveis,
      });
    } catch (err) {
      console.error("Erro BI:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { processStats(); }, [processStats]);

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" size={32} /></div>;

  const lucroPositivo = stats.lucroLiquido >= 0;
  const integridadeOk = Math.abs((stats.despesasFixas + stats.despesasVariaveis) - stats.totalDespesasMes) < 0.005;
  // Só para a barra (visual): parte de despesas vs. parte de lucro
  const baseBarra = stats.totalDespesasMes + Math.max(stats.lucroLiquido, 0);
  const despesasBarraPct = baseBarra > 0 ? (stats.totalDespesasMes / baseBarra) * 100 : 0;

  return (
    <main className="min-h-screen bg-page text-primary p-6 md:p-8 max-w-7xl mx-auto font-sans">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
        <div className="flex items-center gap-5">
          <Link href="/admin" className="p-4 bg-surface border border-border rounded-2xl hover:bg-raised transition-all">
            <ArrowLeft size={20} className="text-secondary" />
          </Link>
          <div>
            <h1 className="text-4xl font-black italic uppercase tracking-tighter flex items-center gap-3">
               <Activity size={32} className="text-accent" /> Performance BI
            </h1>
            <p className="text-muted text-[10px] font-black uppercase tracking-widest mt-1">Analytics: Financeiro do Mês</p>
          </div>
        </div>
        <button onClick={processStats} className="p-4 bg-surface rounded-2xl border border-border text-accent hover:scale-105 transition-all">
            <RefreshCw size={20} />
        </button>
      </header>

      {/* PAINEL FINANCEIRO DO MÊS */}
      <div className={`bg-surface border border-border rounded-3xl border-l-[3px] p-12 ${lucroPositivo ? 'border-l-success' : 'border-l-danger'}`}>

        {/* 1. FILA DO TOPO */}
        <div className="flex justify-between items-start gap-8">
          <div>
            <p className="text-sm font-black uppercase tracking-widest text-secondary">Lucro Líquido do Mês</p>
            <p className={`text-5xl font-black tabular-nums tracking-tighter mt-2 ${lucroPositivo ? 'text-success' : 'text-danger'}`}>{stats.lucroLiquido.toFixed(2)}€</p>
            <p className="text-secondary mt-2">
              Margem de <span className={`font-bold ${lucroPositivo ? 'text-success' : 'text-danger'}`}>{stats.margemPct.toFixed(1)}%</span>
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted">Projeção (Forecast)</p>
            <p className="text-xl font-black text-primary mt-1">{stats.projectedRevenue.toFixed(0)}€</p>
          </div>
        </div>

        {/* 2. FILA FINA SOBRE A BARRA */}
        <div className="flex justify-between text-sm text-secondary mt-10">
          <span>Despesas <span className="font-bold">{stats.totalDespesasMes.toFixed(2)}€</span></span>
          <span>Lucro <span className="font-bold">{stats.lucroLiquido.toFixed(2)}€</span></span>
        </div>

        {/* 3. BARRA FINA */}
        <div className="w-full h-2.5 rounded-full overflow-hidden bg-page mt-2 flex">
          <div className="h-full bg-warning" style={{ width: `${despesasBarraPct}%` }} />
          <div className="h-full bg-success" style={{ width: `${100 - despesasBarraPct}%` }} />
        </div>

        {/* 4. LEGENDA SOB A BARRA */}
        <p className="text-[11px] text-muted uppercase mt-2">Receita Real — {stats.accumulatedRevenue.toFixed(2)}€</p>

        {/* 5. DIVISÓRIA + 2 BLOCOS */}
        <div className="border-t border-border mt-10 pt-7 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Receita Real</p>
            <p className="text-2xl font-black text-primary tracking-tighter">{stats.accumulatedRevenue.toFixed(2)}€</p>
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-2">Despesas Totais</p>
            <p className="text-2xl font-black text-primary tracking-tighter">{stats.totalDespesasMes.toFixed(2)}€</p>
            <p className="text-sm font-bold text-muted mt-2">Fixas: {stats.despesasFixas.toFixed(2)}€ · Variáveis: {stats.despesasVariaveis.toFixed(2)}€</p>
            {!integridadeOk && (
              <p className="text-xs text-danger font-bold uppercase mt-1">Soma não bate com o total</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
