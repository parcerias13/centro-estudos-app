'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, ShieldAlert, CheckCircle2, AlertTriangle, Activity, Loader2 } from 'lucide-react';

export default function AttendanceControl() {
  const [loading, setLoading] = useState(true);
  const [alunosStatus, setAlunosStatus] = useState<any[]>([]);

  useEffect(() => {
    carregarRadar();
  }, []);

  const carregarRadar = async () => {
    // 1. Descobrir as datas da semana atual (Segunda a Domingo)
    const hoje = new Date();
    const diaDaSemana = hoje.getDay() === 0 ? 6 : hoje.getDay() - 1; // 0 = Segunda, 6 = Domingo
    
    const inicioSemana = new Date(hoje);
    inicioSemana.setDate(hoje.getDate() - diaDaSemana);
    inicioSemana.setHours(0, 0, 0, 0);
    
    const fimSemana = new Date(inicioSemana);
    fimSemana.setDate(inicioSemana.getDate() + 6);
    fimSemana.setHours(23, 59, 59, 999);

    // 2. Puxar todos os alunos e os seus limites
    const { data: alunos, error: errAlunos } = await supabase
      .from('alunos')
      .select('id, nome, limite_semanal')
      .order('nome');

    // 3. Puxar as presenças desta semana (ignorando faltas)
    const { data: presencas, error: errPresencas } = await supabase
      .from('diario_bordo')
      .select('student_id')
      .gte('created_at', inicioSemana.toISOString())
      .lte('created_at', fimSemana.toISOString())
      .neq('status', 'falta');

    if (alunos && presencas) {
      // 4. Cruzar os dados (Motor de Cálculo)
      const statusCalculado = alunos.map(aluno => {
        const visitas = presencas.filter(p => p.student_id === aluno.id).length;
        const limite = aluno.limite_semanal || 0;
        
        // Lógica de Negócio
        let status = 'ok'; // Verde
        if (visitas === limite) status = 'warning'; // Amarelo (Esgotado)
        if (visitas > limite) status = 'danger'; // Vermelho (Ultrapassado)

        return {
          ...aluno,
          visitas,
          status,
          percentagem: limite > 0 ? Math.min((visitas / limite) * 100, 100) : 0
        };
      });

      // Ordenar: Primeiro os que estão em perigo (danger), depois warning, depois ok
      statusCalculado.sort((a, b) => {
        const peso = { danger: 3, warning: 2, ok: 1 };
        return peso[b.status as keyof typeof peso] - peso[a.status as keyof typeof peso];
      });

      setAlunosStatus(statusCalculado);
    }
    setLoading(false);
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 max-w-6xl mx-auto">
      
      {/* CABEÇALHO */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="bg-slate-900 p-3 rounded-xl hover:bg-slate-800 transition-colors border border-slate-800">
            <ArrowLeft size={20} className="text-slate-400" />
          </Link>
          <div>
            <h1 className="text-2xl font-black flex items-center gap-2">
              <Activity className="text-blue-500" />
              Radar de Frequência
            </h1>
            <p className="text-slate-500 text-xs">Controlo de pacotes da semana atual.</p>
          </div>
        </div>
      </div>

      {/* GRID DE ALUNOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {alunosStatus.map((aluno) => (
          <div 
            key={aluno.id} 
            className={`bg-slate-900 border rounded-2xl p-6 transition-all ${
              aluno.status === 'danger' ? 'border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.1)]' :
              aluno.status === 'warning' ? 'border-yellow-500/50' : 'border-slate-800'
            }`}
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="font-bold text-lg truncate pr-4">{aluno.nome}</h3>
              
              {/* Ícones Dinâmicos */}
              {aluno.status === 'danger' && <ShieldAlert className="text-red-500 shrink-0" size={24} />}
              {aluno.status === 'warning' && <AlertTriangle className="text-yellow-500 shrink-0" size={24} />}
              {aluno.status === 'ok' && <CheckCircle2 className="text-emerald-500 shrink-0" size={24} />}
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Consumo Semanal</span>
                <span className="font-bold font-mono">
                  <span className={aluno.visitas > aluno.limite_semanal ? 'text-red-500' : 'text-white'}>
                    {aluno.visitas}
                  </span>
                  <span className="text-slate-500"> / {aluno.limite_semanal || '?'}</span>
                </span>
              </div>

              {/* Barra de Progresso */}
              <div className="w-full bg-slate-950 rounded-full h-2.5 border border-slate-800 overflow-hidden">
                <div 
                  className={`h-2.5 rounded-full transition-all duration-500 ${
                    aluno.status === 'danger' ? 'bg-red-500' :
                    aluno.status === 'warning' ? 'bg-yellow-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${aluno.percentagem}%` }}
                ></div>
              </div>

              {/* Mensagem de Alerta */}
              <div className="pt-3">
                {aluno.status === 'danger' && (
                  <p className="text-xs text-red-400 font-bold bg-red-500/10 p-2 rounded">
                    ⚠️ Limite ultrapassado. Cobrar extra.
                  </p>
                )}
                {aluno.status === 'warning' && (
                  <p className="text-xs text-yellow-500 font-bold bg-yellow-500/10 p-2 rounded">
                    Aviso: Esgotou o pacote desta semana.
                  </p>
                )}
                {aluno.status === 'ok' && (
                  <p className="text-xs text-slate-500">
                    Dentro dos limites do plano.
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

    </main>
  );
}