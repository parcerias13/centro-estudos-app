'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { ArrowLeft, Search, FileText, Loader2, Clock, CheckCircle2, User, BookOpen } from 'lucide-react';

export default function HistoryPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtros
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]); 
  const [search, setSearch] = useState('');

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const fetchHistory = async () => {
    setLoading(true);
    
    // USAR AS COLUNAS MODERNAS (entrada/saida) E O EXPLÍCITO (!aluno_id)
    let query = supabase
      .from('diario_bordo')
      .select('*, alunos!aluno_id(nome)')
      .order('entrada', { ascending: false });

    // Filtro de Data Inteligente
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      
      query = query.gte('entrada', start.toISOString()).lte('entrada', end.toISOString());
    }

    const { data, error } = await query;

    if (error) {
       console.error("Erro ao puxar histórico:", error);
       alert("Erro de Sincronização: " + error.message);
    }

    if (data) {
      // Filtro de Pesquisa (As you type)
      const filtered = data.filter((e: any) => {
        const alunoNome = Array.isArray(e.alunos) ? e.alunos[0]?.nome : e.alunos?.nome;
        return (
          (alunoNome || '').toLowerCase().includes(search.toLowerCase()) ||
          (e.subject_name || '').toLowerCase().includes(search.toLowerCase())
        );
      });
      setEntries(filtered);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchHistory();
  }, [date, search]);

  // Função para calcular duração (Recuperada do teu código original)
  const calculateDuration = (start: string, end: string | null) => {
    if (!end) return 'A decorrer';
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    const diffMs = endTime - startTime;
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours === 0 && minutes === 0) return '< 1m';
    return `${hours}h ${minutes}m`;
  };

  const formatTime = (isoString: string | null) => {
    if (!isoString) return '--:--';
    return new Date(isoString).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 md:p-8 max-w-7xl mx-auto font-sans">
      
      {/* CABEÇALHO E FILTROS */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-10 gap-6">
        <div>
          <div className="flex items-center gap-4 mb-4">
            <Link href="/admin" className="p-3 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-colors group">
              <ArrowLeft size={20} className="text-slate-400 group-hover:text-white" />
            </Link>
            <div className="bg-blue-500/10 text-blue-400 p-3 rounded-2xl border border-blue-500/20">
              <FileText size={24} />
            </div>
          </div>
          <h1 className="text-4xl font-black italic tracking-tighter uppercase">Arquivo Diário</h1>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-2">
            Registo de Assiduidade e Faturação
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto">
          {/* Escolher Data */}
          <div className="relative">
            <input 
              type="date" 
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ colorScheme: "dark" }}
              className="bg-slate-900 border border-slate-800 text-white p-4 rounded-2xl outline-none focus:border-blue-500 w-full cursor-pointer font-bold transition-all shadow-lg"
            />
          </div>

          {/* Pesquisar */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
            <input 
              type="text" 
              placeholder="Procurar aluno ou disciplina..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-white pl-12 pr-4 py-4 rounded-2xl outline-none focus:border-blue-500 w-full transition-all shadow-lg placeholder:text-slate-600"
            />
          </div>
        </div>
      </div>

      {/* TABELA DE DADOS DE ALTA PERFORMANCE */}
      <div className="bg-slate-900 border border-slate-800 rounded-4xl overflow-hidden shadow-2xl relative min-h-100">
        
        {loading && (
           <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-10">
               <Loader2 className="animate-spin text-blue-500" size={32} />
           </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950/50 border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="p-6 font-black">Aluno</th>
                <th className="p-6 font-black">Disciplina</th>
                <th className="p-6 font-black text-center">Entrada</th>
                <th className="p-6 font-black text-center">Saída</th>
                <th className="p-6 font-black text-center">Duração</th>
                <th className="p-6 font-black text-right">Status Operacional</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {!loading && entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-16 text-center text-slate-600 font-medium italic">
                    <FileText size={48} className="mx-auto mb-4 opacity-20" />
                    Nenhum registo encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => {
                  const alunoNome = Array.isArray(entry.alunos) ? entry.alunos[0]?.nome : entry.alunos?.nome;
                  const isAtivo = !entry.saida;

                  return (
                    <tr key={entry.id} className="hover:bg-slate-800/20 transition-colors group">
                      
                      {/* ALUNO */}
                      <td className="p-6 font-black text-white whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${isAtivo ? 'bg-amber-500/20 text-amber-500' : 'bg-blue-600/20 text-blue-400'}`}>
                            <User size={16} />
                          </div>
                          {alunoNome || 'Desconhecido'}
                        </div>
                      </td>

                      {/* DISCIPLINA */}
                      <td className="p-6 text-slate-400 font-medium whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <BookOpen size={14} className="text-slate-600" />
                          {entry.subject_name || 'Sessão Livre'}
                        </div>
                      </td>

                      {/* ENTRADA */}
                      <td className="p-6 text-center text-blue-400 font-mono font-bold whitespace-nowrap">
                        {formatTime(entry.entrada)}
                      </td>

                      {/* SAÍDA */}
                      <td className="p-6 text-center font-mono font-bold text-slate-400 whitespace-nowrap">
                        {isAtivo ? '---' : formatTime(entry.saida)}
                      </td>

                      {/* DURAÇÃO (O que pediste) */}
                      <td className="p-6 text-center font-mono font-black text-emerald-400 whitespace-nowrap">
                        {calculateDuration(entry.entrada, entry.saida)}
                      </td>

                      {/* STATUS DA OPERAÇÃO */}
                      <td className="p-6 text-right whitespace-nowrap">
                        {isAtivo ? (
                          <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1 animate-pulse">
                            <Clock size={10} /> Em Estudo
                          </span>
                        ) : entry.status === 'validado' ? (
                          <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1">
                            <CheckCircle2 size={10} /> Concluída & Avisada
                          </span>
                        ) : (
                          <span className="bg-slate-800 text-slate-400 border border-slate-700 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest inline-flex items-center gap-1">
                            <CheckCircle2 size={10} /> Concluída
                          </span>
                        )}
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        
        {/* RODAPÉ DO HISTÓRICO */}
        <div className="bg-slate-950/80 p-5 text-[10px] uppercase font-black tracking-widest text-slate-500 flex justify-between items-center border-t border-slate-800">
          <span>Total: {entries.length} {entries.length === 1 ? 'Sessão' : 'Sessões'}</span>
          <span>Sistema Central de Operações</span>
        </div>
      </div>
    </main>
  );
}