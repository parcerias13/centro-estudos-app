'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import { 
  ArrowLeft, Activity, RefreshCw, Layout, PieChart, Loader2, DollarSign, Clock, Award, BarChart3
} from 'lucide-react';

export default function AdminStats() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>({
    monthlyHours: 0,
    accumulatedRevenue: 0,
    projectedRevenue: 0,
    topStudent: { name: '-', hours: 0 },
    subjectDistribution: [],
    daysDistribution: [], 
    topStudentsList: [],
    roomOccupancy: []
  });

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const processStats = useCallback(async () => {
    setLoading(true);
    try {
      const agora = new Date();
      const primeiroDiaMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
      const totalDiasMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
      const diaAtual = agora.getDate();

      const [
        { data: entries },
        { data: activeSessions },
        { data: extras },
        { data: alunos }, // NOVO: Para as mensalidades fixas
        { data: salas }
      ] = await Promise.all([
        supabase.from('diario_bordo').select('*, alunos!aluno_id(nome)').gte('entrada', primeiroDiaMes).is('deleted_at', null),
        supabase.from('diario_bordo').select('sala_id').is('saida', null).is('deleted_at', null),
        supabase.from('consumos_diarios').select('preco_aplicado').gte('data_consumo', primeiroDiaMes.split('T')[0]),
        supabase.from('alunos').select('mensalidade_base'),
        supabase.from('salas').select('*')
      ]);

      // --- 1. LÓGICA PEDAGÓGICA (MANTÉM TUDO O QUE TINHAS) ---
      let totalMs = 0;
      const studentMap: Record<string, { name: string, ms: number }> = {};
      const subjectMap: Record<string, number> = {};
      const dayMap: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

      entries?.forEach(entry => {
        const studentName = entry.alunos?.nome;
        if (!studentName) return;

        const start = new Date(entry.entrada).getTime();
        const end = entry.saida ? new Date(entry.saida).getTime() : agora.getTime();
        const duration = end - start;
        if (duration > 0) totalMs += duration;

        const idAl = entry.aluno_id;
        if (!studentMap[idAl]) studentMap[idAl] = { name: studentName, ms: 0 };
        studentMap[idAl].ms += duration;

        subjectMap[entry.subject_name || 'Estudo Autónomo'] = (subjectMap[entry.subject_name || 'Estudo Autónomo'] || 0) + 1;
        const dayOfWeek = new Date(entry.entrada).getDay();
        if (dayMap.hasOwnProperty(dayOfWeek)) dayMap[dayOfWeek] += 1;
      });

      // --- 2. NOVA LÓGICA FINANCEIRA (SIMPLIFICADA) ---
      const totalMensalidadesBase = alunos?.reduce((acc, curr) => acc + (Number(curr.mensalidade_base) || 0), 0) || 0;
      const totalExtrasMes = extras?.reduce((acc, curr) => acc + (Number(curr.preco_aplicado) || 0), 0) || 0;
      
      const accumulatedRevenue = totalMensalidadesBase + totalExtrasMes;
      
      // Projeção: Mensalidades (Fixas) + Média de Extras projetada para o fim do mês
      const mediaExtrasDiaria = totalExtrasMes / diaAtual;
      const projectedRevenue = totalMensalidadesBase + (mediaExtrasDiaria * totalDiasMes);

      // --- 3. OCUPAÇÃO E RANKINGS (MANTÉM TUDO) ---
      const roomStats = salas?.map(sala => {
        const presentes = activeSessions?.filter(s => String(s.sala_id) === String(sala.id)).length || 0;
        return {
          nome: sala.nome,
          presentes,
          percentagem: (presentes / (sala.capacidade || 10)) * 100
        };
      }) || [];

      const sortedStudents = Object.values(studentMap).sort((a, b) => b.ms - a.ms);

      setStats({
        monthlyHours: Math.round(totalMs / (1000 * 60 * 60)),
        accumulatedRevenue,
        projectedRevenue,
        topStudent: { 
          name: sortedStudents[0]?.name || '-', 
          hours: Math.round((sortedStudents[0]?.ms || 0) / (1000 * 60 * 60)) 
        },
        subjectDistribution: Object.entries(subjectMap).sort((a, b) => b[1] - a[1]).slice(0, 5),
        daysDistribution: [1, 2, 3, 4, 5].map(d => ({
          day: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'][d - 1],
          value: dayMap[d],
          percent: (dayMap[d] / Math.max(...Object.values(dayMap), 1)) * 100
        })),
        topStudentsList: sortedStudents.slice(0, 5),
        roomOccupancy: roomStats
      });

    } catch (err) {
      console.error("Erro BI:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { processStats(); }, [processStats]);

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] text-white p-6 md:p-8 max-w-7xl mx-auto font-sans">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
        <div className="flex items-center gap-5">
          <Link href="/admin" className="p-4 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-all">
            <ArrowLeft size={20} className="text-slate-400" />
          </Link>
          <div>
            <h1 className="text-4xl font-black italic uppercase tracking-tighter flex items-center gap-3">
               <Activity size={32} className="text-blue-500" /> Performance BI
            </h1>
            <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Analytics: Estudo & Financeiro Fixo</p>
          </div>
        </div>
        <button onClick={processStats} className="p-4 bg-slate-900 rounded-2xl border border-slate-800 text-blue-500 hover:scale-105 transition-all">
            <RefreshCw size={20} />
        </button>
      </header>

      {/* KPI GRID - FINANCEIRO E ESTUDO */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-2xl border-l-4 border-l-emerald-500">
          <p className="text-emerald-500 text-[10px] font-black uppercase tracking-widest mb-4">Receita Real (Mês)</p>
          <p className="text-4xl font-black italic tracking-tighter">{stats.accumulatedRevenue.toFixed(2)}€</p>
          <p className="text-[10px] text-slate-500 font-bold mt-2 uppercase">Base Fixa + Extras Consumidos</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-2xl border-l-4 border-l-blue-500">
          <p className="text-blue-500 text-[10px] font-black uppercase tracking-widest mb-4">Projeção (Forecast)</p>
          <p className="text-4xl font-black italic tracking-tighter">{stats.projectedRevenue.toFixed(0)}€</p>
          <p className="text-[10px] text-slate-500 font-bold mt-2 uppercase">Base + Tendência de Extras</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-2xl">
          <p className="text-purple-500 text-[10px] font-black uppercase tracking-widest mb-4">Horas de Estudo</p>
          <p className="text-4xl font-black italic tracking-tighter">{stats.monthlyHours}H</p>
          <p className="text-[10px] text-slate-500 font-bold mt-2 uppercase">Total Acumulado</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-2xl">
          <p className="text-orange-500 text-[10px] font-black uppercase tracking-widest mb-4">Melhor do Mês</p>
          <p className="text-xl font-black truncate italic uppercase">{stats.topStudent.name}</p>
          <p className="text-[10px] text-slate-500 font-bold mt-2 uppercase">{stats.topStudent.hours}H Focadas</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* GRÁFICO DE SALAS - MANTIDO */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-2xl">
          <h3 className="font-black text-xs uppercase text-slate-400 tracking-widest mb-12 flex items-center gap-2">
              <Layout size={18} className="text-blue-500" /> Ocupação por Sala (LIVE)
          </h3>
          <div className="h-80 flex items-end justify-between gap-10 px-4 border-b border-slate-800/50 pb-6 overflow-x-auto">
            {stats.roomOccupancy.map((sala: any) => (
              <div key={sala.nome} className="flex flex-col items-center justify-end h-full min-w-20 group relative">
                <div className="absolute -top-10 bg-blue-600 text-[10px] font-black px-3 py-1 rounded shadow-xl">
                    {sala.presentes} Alunos
                </div>
                <div className="relative w-14 h-full flex items-end bg-slate-800/30 rounded-t-2xl overflow-hidden border border-white/5">
                  <div 
                    className={`w-full transition-all duration-700 ${sala.percentagem > 90 ? 'bg-red-500' : 'bg-blue-600'}`}
                    style={{ height: `${Math.max(sala.percentagem, 3)}%` }}
                  ></div>
                </div>
                <p className="text-[10px] text-slate-500 mt-6 font-black uppercase tracking-tighter text-center">{sala.nome}</p>
              </div>
            ))}
          </div>
        </div>

        {/* TOP DISCIPLINAS E DISTRIBUIÇÃO - MANTIDO */}
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-4xl shadow-2xl">
          <h3 className="font-black text-xs uppercase text-slate-400 tracking-widest mb-8 flex items-center gap-2">
            <PieChart size={18} className="text-orange-500" /> Foco por Disciplina
          </h3>
          <div className="space-y-6">
            {stats.subjectDistribution.map(([name, count]: any, index: number) => (
              <div key={index} className="space-y-2">
                <div className="flex justify-between text-[10px] font-black uppercase">
                    <span className="text-slate-300">{name}</span>
                    <span className="text-slate-500">{count} sessões</span>
                </div>
                <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                    <div className="h-full bg-orange-500" style={{ width: `${(count / (stats.subjectDistribution[0][1] || 1)) * 100}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}