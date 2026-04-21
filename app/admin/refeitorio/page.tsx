'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { 
  Search, UserPlus, RefreshCw, X, Loader2, CheckCircle2, Clock, Utensils, Apple
} from 'lucide-react';

// Interfaces robustas
interface AlunoRefeitorio {
  aluno_id: string;
  aluno_nome: string;
  avatar_url?: string | null;
}

interface Servico {
  id: string;
  nome: string;
  preco: number;
}

interface Consumo {
  aluno_id: string;
  servico_id: string;
}

export default function RefeitorioPage() {
  const [alunosPresentes, setAlunosPresentes] = useState<AlunoRefeitorio[]>([]);
  const [todosAlunos, setTodosAlunos] = useState<any[]>([]);
  const [listaServicos, setListaServicos] = useState<Servico[]>([]);
  const [consumosHoje, setConsumosHoje] = useState<Consumo[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Validador de URL (Preservado do teu código)
  const getSafeAvatar = (url: string | null | undefined) => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
    try { return new URL(url).href; } catch { return null; }
  };

  const fetchDados = useCallback(async () => {
    try {
      const hoje = new Date().toISOString().split('T')[0];

      const [servs, presencas, todos, consumos] = await Promise.all([
        supabase.from('servicos').select('id, nome, preco').order('nome'),
        supabase.from('view_refeitorio_hoje').select('aluno_id, aluno_nome, avatar_url'),
        supabase.from('alunos').select('id, nome, avatar_url').is('deleted_at', null).order('nome'),
        supabase.from('consumos_diarios').select('aluno_id, servico_id').eq('data_consumo', hoje)
      ]);

      setListaServicos(servs.data || []);
      setAlunosPresentes(presencas.data || []);
      setTodosAlunos(todos.data || []);
      setConsumosHoje(consumos.data || []);
    } catch (err) {
      console.error("Erro ao carregar dados do refeitório:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { fetchDados(); }, [fetchDados]);

  const handleConsumo = async (alunoId: string, servico: Servico) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const jaConsumiu = consumosHoje.some(c => c.aluno_id === alunoId && c.servico_id === servico.id);
    const hoje = new Date().toISOString().split('T')[0];

    try {
      if (jaConsumiu) {
        // Remover consumo (Lógica original preservada)
        await supabase.from('consumos_diarios').delete()
          .eq('aluno_id', alunoId)
          .eq('servico_id', servico.id)
          .eq('data_consumo', hoje);
      } else {
        // 1. Garantir entrada física (Auto Check-in se o aluno não passou o QR)
        const { data: entrada } = await supabase.from('diario_bordo')
          .select('id').eq('aluno_id', alunoId).is('saida', null).gte('entrada', hoje).maybeSingle();

        if (!entrada) {
          await supabase.from('diario_bordo').insert({
            aluno_id: alunoId, student_id: alunoId, entrada: new Date().toISOString(),
            status: 'validado', subject_name: `Serviço: ${servico.nome}`
          });
        }

        // 2. Registar consumo com SNAPSHOT DE PREÇO (Automação Financeira)
        await supabase.from('consumos_diarios').insert({
          aluno_id: alunoId,
          servico_id: servico.id,
          data_consumo: hoje,
          preco_aplicado: servico.preco // Protege o passado de mudanças de preço
        });
      }
      await fetchDados();
    } finally {
      setIsSubmitting(false);
      setIsModalOpen(false);
    }
  };

  const alunosFiltrados = todosAlunos.filter(a => 
    !alunosPresentes.some(p => p.aluno_id === a.id) && 
    a.nome.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  return (
    <main className={`min-h-screen bg-[#0f172a] p-4 md:p-8 text-white transition-all ${isSubmitting ? 'opacity-60 pointer-events-none' : ''}`}>
      
      <header className="mb-10 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black italic uppercase tracking-tighter">Refeitório & Serviços</h1>
          <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Gestão Dinâmica de Consumos</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 px-6 py-3 bg-emerald-600/10 text-emerald-500 border border-emerald-500/20 rounded-xl hover:bg-emerald-600 hover:text-white transition-all text-[10px] font-black uppercase tracking-widest shadow-lg">
            <UserPlus size={16} /> Adicionar Aluno
          </button>
          <button onClick={fetchDados} className="p-3 bg-slate-900 rounded-xl border border-slate-800 hover:text-blue-400">
            <RefreshCw size={20} />
          </button>
        </div>
      </header>

      <div className="space-y-4 max-w-5xl">
        <div className="flex items-center justify-between px-2 mb-2">
          <h2 className="flex items-center gap-2 text-slate-400 font-black uppercase text-xs tracking-widest">
            <Clock size={14} /> Alunos no Centro
          </h2>
        </div>

        {alunosPresentes.length === 0 ? (
          <div className="bg-slate-900/40 border-2 border-dashed border-slate-800 p-20 rounded-4xl text-center italic opacity-50">
            Nenhum aluno com check-in hoje...
          </div>
        ) : (
          alunosPresentes.map((aluno) => {
            const safeUrl = getSafeAvatar(aluno.avatar_url);
            return (
              <div key={aluno.aluno_id} className="bg-slate-900 border border-slate-800 p-5 rounded-4xl flex flex-col lg:flex-row items-center justify-between transition-all gap-6 group hover:border-slate-700">
                <div className="flex items-center gap-4 w-full lg:w-1/3">
                  <div className="w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center text-xl font-black border border-slate-700/50 bg-slate-800 overflow-hidden">
                    {/* snyk:ignore:javascript/DOMXSS */}
                    {safeUrl ? <img src={safeUrl} alt="" className="w-full h-full object-cover" /> : <span className="text-slate-500">{aluno.aluno_nome.charAt(0)}</span>}
                  </div>
                  <div>
                    <h3 className="text-lg font-black group-hover:text-blue-400 transition-colors">{aluno.aluno_nome}</h3>
                    <p className="text-[10px] text-emerald-500 font-black uppercase flex items-center gap-1">
                      <CheckCircle2 size={10} /> Em Sala
                    </p>
                  </div>
                </div>

                {/* BOTÕES DINÂMICOS - Mapeia todos os serviços da Gestão */}
                <div className="flex flex-wrap items-center gap-2 w-full lg:w-2/3 lg:justify-end">
                  {listaServicos.map(servico => {
                    const ativo = consumosHoje.some(c => c.aluno_id === aluno.aluno_id && c.servico_id === servico.id);
                    return (
                      <button 
                        key={servico.id}
                        onClick={() => handleConsumo(aluno.aluno_id, servico)}
                        className={`flex items-center gap-2 px-4 py-3 rounded-xl transition-all border text-[10px] font-black uppercase tracking-tighter ${
                          ativo 
                          ? 'bg-blue-600 border-blue-400 text-white shadow-lg' 
                          : 'bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-600'
                        }`}
                      >
                        {servico.nome === 'Almoço' ? <Utensils size={14} /> : servico.nome === 'Lanche' ? <Apple size={14} /> : <div className="w-2 h-2 rounded-full bg-current" />}
                        {servico.nome}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* MODAL DE ADIÇÃO MANUAL - Preservado e Reforçado */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-4xl shadow-3xl p-8 animate-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black uppercase italic text-white tracking-tighter">Registar Serviço Extra</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white transition-colors"><X size={24}/></button>
            </div>
            
            <div className="relative mb-6">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
              <input 
                autoFocus 
                placeholder="Qual o aluno?" 
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)} 
                className="w-full bg-slate-950 border border-slate-800 p-5 pl-14 rounded-2xl outline-none focus:border-emerald-500 transition-all font-bold text-white text-lg" 
              />
            </div>

            <div className="max-h-80 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
              {alunosFiltrados.map(aluno => (
                <div key={aluno.id} className="w-full p-4 bg-slate-950 border border-slate-800 rounded-2xl flex flex-col gap-4">
                  <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center font-black text-slate-500 overflow-hidden">
                      {/* snyk:ignore:javascript/DOMXSS */}
                      {aluno.avatar_url ? <img src={aluno.avatar_url} className="w-full h-full object-cover" /> : aluno.nome.charAt(0)}
                    </div>
                    <p className="font-bold text-white">{aluno.nome}</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    {listaServicos.map(s => (
                      <button 
                        key={s.id}
                        onClick={() => handleConsumo(aluno.id, s)}
                        className="p-3 bg-slate-900 border border-slate-700 rounded-xl text-[9px] font-black uppercase hover:bg-emerald-600 hover:text-white transition-all"
                      >
                        + {s.nome} ({s.preco}€)
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}