'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { UserPlus, Search, FileBarChart, Edit, Trash2, ShieldCheck, ShieldAlert, Loader2, ArrowLeft, Users, Filter, FileText } from 'lucide-react';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ListaAlunos() {
  const [alunos, setAlunos] = useState<any[]>([]);
  const [busca, setBusca] = useState('');
  const [filtroAno, setFiltroAno] = useState(''); 
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchAlunos(); }, []);

  const fetchAlunos = async () => {
    setLoading(true);
    try {
      const hoje = new Date();
      const diaDaSemana = hoje.getDay() === 0 ? 6 : hoje.getDay() - 1;
      const inicioSemana = new Date(hoje);
      inicioSemana.setDate(hoje.getDate() - diaDaSemana);
      inicioSemana.setHours(0, 0, 0, 0);

      const fimSemana = new Date(inicioSemana);
      fimSemana.setDate(inicioSemana.getDate() + 6);
      fimSemana.setHours(23, 59, 59, 999);

      const { data: dataAlunos, error: errAlunos } = await supabase
        .from('alunos')
        .select('*')
        .order('nome', { ascending: true });

      const { data: dataPresencas, error: errPresencas } = await supabase
        .from('diario_bordo')
        .select('student_id')
        .gte('created_at', inicioSemana.toISOString())
        .lte('created_at', fimSemana.toISOString())
        .neq('status', 'falta');

      if (dataAlunos && dataPresencas) {
        const alunosProcessados = dataAlunos.map(aluno => {
          const contagem = dataPresencas.filter(p => p.student_id === aluno.id).length;
          return {
            ...aluno,
            consumo_semanal: contagem
          };
        });

        const alunosOrdenados = alunosProcessados.sort((a, b) => {
          const alertaA = (a.consumo_semanal >= a.limite_semanal && a.limite_semanal !== 99) ? 1 : 0;
          const alertaB = (b.consumo_semanal >= b.limite_semanal && b.limite_semanal !== 99) ? 1 : 0;
          
          if (alertaA !== alertaB) return alertaB - alertaA; 
          return a.nome.localeCompare(b.nome); 
        });

        setAlunos(alunosOrdenados);
      } else if (dataAlunos) {
        setAlunos(dataAlunos);
      }
    } catch (error) {
      console.error('Erro ao processar prioridades:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Tem a certeza que quer apagar este aluno? Todo o histórico será perdido.')) {
      const { error } = await supabase.from('alunos').delete().eq('id', id);
      if (error) {
        alert('Erro ao apagar: ' + error.message);
      } else {
        fetchAlunos(); 
      }
    }
  };

  const alunosFiltrados = alunos.filter(a => {
    const matchesNome = a.nome?.toLowerCase().includes(busca.toLowerCase());
    const matchesAno = filtroAno === '' || String(a.ano_escolar) === filtroAno;
    return matchesNome && matchesAno;
  });

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  return (
    <div className="min-h-screen bg-[#0f172a] p-6 text-white font-sans">
      
      <header className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="bg-slate-900 p-3 rounded-xl hover:bg-slate-800 transition-colors border border-slate-800">
            <ArrowLeft size={20} className="text-slate-400" />
          </Link>
          <div>
            <h1 className="text-3xl font-black tracking-tight flex items-center gap-2 italic uppercase">
                <Users className="text-blue-500" size={28} /> Gerir Alunos
            </h1>
            <p className="text-slate-500 text-xs font-black uppercase tracking-widest">{alunos.length} Matrículas Ativas</p>
          </div>
        </div>
        
        <Link href="/admin/alunos/novo" className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-2xl font-black flex items-center gap-2 shadow-lg shadow-blue-900/20 transition-all active:scale-95">
          <UserPlus size={20} /> NOVA MATRÍCULA
        </Link>
      </header>

      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
          <input 
            type="text" 
            placeholder="Pesquisar por nome do aluno..." 
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full bg-slate-900/50 border border-slate-800 p-5 pl-14 rounded-2xl outline-none focus:border-blue-500 transition-all text-lg font-medium placeholder:text-slate-600"
          />
        </div>

        <div className="relative w-full md:w-64">
          <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
          <select 
            value={filtroAno}
            onChange={(e) => setFiltroAno(e.target.value)}
            className="w-full bg-slate-900/50 border border-slate-800 p-5 pl-14 rounded-2xl outline-none focus:border-blue-500 transition-all text-lg font-medium appearance-none cursor-pointer text-slate-300"
          >
            <option value="">Todos os Anos</option>
            {[...Array(12)].map((_, i) => (
              <option key={i + 1} value={i + 1}>{i + 1}º Ano</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {alunosFiltrados.length === 0 ? (
          <div className="col-span-full text-center py-20 bg-slate-900/20 border-2 border-dashed border-slate-800 rounded-3xl">
            <p className="text-slate-500 font-medium italic">Nenhum aluno encontrado.</p>
          </div>
        ) : (
          alunosFiltrados.map((aluno) => (
            <div key={aluno.id} className={`bg-slate-900/40 border p-5 rounded-3xl flex items-center justify-between group transition-all shadow-sm ${
              (aluno.consumo_semanal >= aluno.limite_semanal && aluno.limite_semanal !== 99) 
              ? 'border-red-500/30 bg-red-500/5' 
              : 'border-slate-800/60 hover:border-slate-700'
            }`}>
              <div className="flex items-center gap-5 flex-1">
                <div className="w-14 h-14 shrink-0 bg-slate-800 rounded-2xl flex items-center justify-center text-xl font-black text-slate-500 group-hover:bg-blue-600 group-hover:text-white transition-all overflow-hidden border border-slate-700/50 shadow-inner">
                  {aluno.avatar_url ? (
                    <img src={aluno.avatar_url} alt={aluno.nome} className="w-full h-full object-cover" />
                  ) : (
                    <span>{aluno.nome?.charAt(0)}</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-white leading-tight truncate uppercase italic">{aluno.nome}</h3>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 bg-slate-800 text-slate-400 rounded-md border border-slate-700">
                      {aluno.ano_escolar}º ANO
                    </span>
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md flex items-center gap-1 ${aluno.saida_autorizada ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                      {aluno.saida_autorizada ? <ShieldCheck size={10} /> : <ShieldAlert size={10} />}
                      {aluno.saida_autorizada ? 'Autónomo' : 'Restrito'}
                    </span>
                  </div>

                  <div className="mt-4 hidden md:block max-w-50">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[9px] font-black text-slate-600 uppercase tracking-tighter">Consumo Semanal</span>
                      <span className={`text-[10px] font-bold ${aluno.consumo_semanal >= aluno.limite_semanal && aluno.limite_semanal !== 99 ? 'text-red-500' : 'text-slate-400'}`}>
                        {aluno.consumo_semanal || 0} / {aluno.limite_semanal === 99 ? '∞' : aluno.limite_semanal}
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5 border border-slate-700/30 overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-1000 ${
                          (aluno.consumo_semanal / aluno.limite_semanal) >= 1 && aluno.limite_semanal !== 99 ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]' : 'bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(((aluno.consumo_semanal || 0) / (aluno.limite_semanal || 1)) * 100, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 ml-4">
                {/* BOTÃO DO EXTRATO INDIVIDUAL (DOSSIER) */}
                <Link 
                  href={`/admin/alunos/extrato?id=${aluno.id}`} 
                  className="p-3 bg-slate-800 text-blue-400 hover:bg-blue-600 hover:text-white rounded-xl transition-all border border-slate-700 hover:border-blue-600 shadow-xl"
                  title="Extrato Detalhado por Dia"
                >
                  <FileText size={20} />
                </Link>

                <Link 
                  href={`/admin/relatorio?id=${aluno.id}`} 
                  className="p-3 bg-slate-800 text-slate-400 hover:bg-white hover:text-black rounded-xl transition-all border border-slate-700 hover:border-white shadow-xl"
                  title="Ver Relatório de Performance"
                >
                  <FileBarChart size={20} />
                </Link>

                <Link 
                  href={`/admin/alunos/editar?id=${aluno.id}`} 
                  className="p-3 bg-slate-800 text-slate-400 hover:bg-blue-600 hover:text-white rounded-xl transition-all border border-slate-700 hover:border-blue-600 shadow-xl"
                  title="Editar Aluno"
                >
                  <Edit size={20} />
                </Link>

                <button 
                  onClick={() => handleDelete(aluno.id)}
                  className="p-3 bg-slate-800 text-slate-400 hover:bg-red-600 hover:text-white rounded-xl transition-all border border-slate-700 hover:border-red-600 shadow-xl"
                  title="Remover Matrícula"
                >
                  <Trash2 size={20} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}