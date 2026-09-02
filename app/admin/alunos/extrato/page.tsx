'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { supabase } from '@/lib/supabase';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Loader2, Calendar,
  Utensils, Printer, CheckCircle2, DollarSign
} from 'lucide-react';

function ExtratoDetalhadoContent() {
  const searchParams = useSearchParams();
  const studentId = searchParams.get('id');
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<any>(null);
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [ano, setAno] = useState(new Date().getFullYear());
  const [diasDetalhados, setDiasDetalhados] = useState<any[]>([]);
  const [resumo, setResumo] = useState<any>(null);


  const carregarDados = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);

    const primeiroDia = new Date(ano, mes - 1, 1).toISOString();
    const ultimoDia = new Date(ano, mes, 0, 23, 59, 59).toISOString();

    // 1. Buscar Aluno (Agora com mensalidade_base)
    const { data: aluno } = await supabase
      .from('alunos')
      .select('*')
      .eq('id', studentId)
      .single();
    
    setStudent(aluno);

    // 2. Buscar Presenças (apenas para assiduidade) e Extras do Mês
    const [{ data: presencas }, { data: extras }] = await Promise.all([
      supabase.from('diario_bordo')
        .select('*')
        .eq('aluno_id', studentId)
        .gte('entrada', primeiroDia)
        .lte('entrada', ultimoDia),
      supabase.from('consumos_diarios')
        .select('*, servicos(nome)')
        .eq('aluno_id', studentId)
        .gte('data_consumo', primeiroDia.split('T')[0])
        .lte('data_consumo', ultimoDia.split('T')[0])
    ]);

    // 3. NOVO MOTOR DE CÁLCULO (SOMA DIRETA: FIXO + EXTRAS)
    const mensalidadeFixa = Number(aluno?.mensalidade_base) || 0;
    const totalExtras = extras?.reduce((acc, curr) => acc + (Number(curr.preco_aplicado) || 0), 0) || 0;
    const datasUnicas = new Set(presencas?.map(p => p.entrada.split('T')[0]));
    const totalSessoes = datasUnicas.size;

    // 4. AGRUPAMENTO DIÁRIO PARA O HISTÓRICO
    const mapaDias: Record<string, any> = {};

    presencas?.forEach(p => {
      const d = p.entrada.split('T')[0];
      if (!mapaDias[d]) mapaDias[d] = { data: d, presenca: true, extras: [] };
      else mapaDias[d].presenca = true;
    });

    extras?.forEach(e => {
      const d = e.data_consumo;
      if (!mapaDias[d]) mapaDias[d] = { data: d, presenca: false, extras: [] };
      mapaDias[d].extras.push(e);
    });

    const listagem = Object.values(mapaDias).sort((a, b) => b.data.localeCompare(a.data));
    setDiasDetalhados(listagem);

    setResumo({
      totalSessoes,
      mensalidadeFixa,
      totalExtras,
      totalGeral: mensalidadeFixa + totalExtras
    });

    setLoading(false);
  }, [supabase, studentId, mes, ano]);

  useEffect(() => { carregarDados(); }, [carregarDados]);

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" size={40} /></div>;

  return (
    <main className="min-h-screen bg-page p-4 md:p-8 text-primary">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8 flex justify-between items-center no-print">
          <Link href="/admin/alunos" className="flex items-center gap-2 text-secondary hover:text-primary transition-colors">
            <ArrowLeft size={20} /> <span className="font-bold uppercase text-xs tracking-widest">Voltar</span>
          </Link>
          <div className="flex gap-4">
            <select value={mes} onChange={e => setMes(Number(e.target.value))} className="bg-surface border border-border p-2 rounded-xl text-xs font-bold outline-none focus:border-accent">
              {Array.from({length: 12}, (_, i) => <option key={i+1} value={i+1}>{new Date(0, i).toLocaleString('pt-PT', {month: 'long'})}</option>)}
            </select>
            <button onClick={() => window.print()} className="bg-accent hover:bg-accent-hover text-on-accent p-3 rounded-xl transition-all active:scale-95"><Printer size={20} /></button>
          </div>
        </header>

        {/* CARTÃO DE RESUMO FINANCEIRO - MODELO FIXO */}
        <section className="bg-surface border border-border rounded-[2.5rem] p-8 mb-8 shadow-2xl relative overflow-hidden">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
            <div>
              <p className="text-accent font-black uppercase text-[10px] tracking-[0.3em] mb-1">Dossier de Faturação</p>
              <h1 className="text-3xl font-black italic tracking-tighter">{student?.nome}</h1>
              <p className="text-[10px] text-muted font-bold uppercase mt-1">Regime de Mensalidade Acordada</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted font-black uppercase mb-1">Total do Mês</p>
              <p className="text-5xl font-black text-primary italic tracking-tighter">{resumo.totalGeral.toFixed(2)}€</p>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-4 mt-8 pt-8 border-t border-border/50">
            <div>
              <p className="text-[9px] text-muted font-black uppercase mb-1">Mensalidade Base</p>
              <p className="font-mono font-bold text-lg text-primary">{resumo.mensalidadeFixa.toFixed(2)}€</p>
            </div>
            <div>
              <p className="text-[9px] text-warning font-black uppercase mb-1">Total Extras</p>
              <p className="font-mono font-bold text-lg text-warning">+{resumo.totalExtras.toFixed(2)}€</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] text-muted font-black uppercase mb-1">Assiduidade</p>
              <p className="font-mono font-bold text-lg text-secondary">{resumo.totalSessoes} Dias</p>
            </div>
          </div>
        </section>

        {/* DETALHE DIÁRIO (AUDIT TRAIL) */}
        <section className="space-y-4">
          <h3 className="text-[10px] font-black text-muted uppercase tracking-widest ml-4">Histórico de Presenças e Consumos</h3>
          {diasDetalhados.length > 0 ? diasDetalhados.map((dia) => (
            <div key={dia.data} className="bg-surface/50 border border-border p-5 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-hover hover:border-border">
              <div className="flex items-center gap-4">
                <div className="bg-raised px-4 py-2 rounded-2xl text-center min-w-[60px]">
                  <p className="text-[10px] font-black text-muted uppercase">{new Date(dia.data).toLocaleString('pt-PT', { weekday: 'short' })}</p>
                  <p className="font-black text-lg">{new Date(dia.data).getDate()}</p>
                </div>
                <div>
                  {dia.presenca && (
                    <div className="flex items-center gap-2 text-success font-bold text-sm">
                      <CheckCircle2 size={14} /> Aluno presente no centro
                    </div>
                  )}
                  {dia.extras.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {dia.extras.map((e: any, i: number) => (
                        <span key={i} className="text-[9px] bg-warning-bg text-warning border border-warning/20 px-2 py-0.5 rounded-md font-bold uppercase">
                          {e.servicos?.nome || 'Extra'}: {e.preco_aplicado}€
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right font-mono font-bold text-warning">
                {dia.extras.length > 0 ? `+${dia.extras.reduce((a: any, c: any) => a + c.preco_aplicado, 0).toFixed(2)}€` : '—'}
              </div>
            </div>
          )) : (
            <div className="text-center py-12 border-2 border-dashed border-border rounded-3xl">
              <p className="text-muted font-bold uppercase text-xs tracking-widest">Nenhum registo encontrado para este período</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function ExtratoIndividualPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>}>
      <ExtratoDetalhadoContent />
    </Suspense>
  );
}