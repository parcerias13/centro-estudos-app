'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { ArrowLeft, MapPin, Plus, Users, BookOpen, Loader2, Save, Trash2 } from 'lucide-react';

export default function GestaoSalas() {
  const [loading, setLoading] = useState(true);
  const [salas, setSalas] = useState<any[]>([]);
  const [disciplinas, setDisciplinas] = useState<any[]>([]);
  
  // Nova Sala
  const [novaSalaNome, setNovaSalaNome] = useState('');
  const [novaSalaCapacidade, setNovaSalaCapacidade] = useState('10');
  const [savingSala, setSavingSala] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    fetchDados();
  }, []);

  const fetchDados = async () => {
    setLoading(true);
    // Buscar Salas
    const { data: salasData } = await supabase.from('salas').select('*').order('nome');
    if (salasData) setSalas(salasData);

    // Buscar Disciplinas
    const { data: discData } = await supabase.from('subjects').select('*').order('name');
    if (discData) setDisciplinas(discData);
    
    setLoading(false);
  };

  const handleCriarSala = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novaSalaNome) return;
    setSavingSala(true);

    const { error } = await supabase.from('salas').insert({
      nome: novaSalaNome,
      capacidade: parseInt(novaSalaCapacidade)
    });

    if (error) {
      alert("Erro ao criar sala: " + error.message);
    } else {
      setNovaSalaNome('');
      setNovaSalaCapacidade('10');
      fetchDados();
    }
    setSavingSala(false);
  };

  const handleEliminarSala = async (id: string) => {
    if (!confirm("Tem a certeza que deseja eliminar esta sala? Isto pode afetar o roteamento de disciplinas.")) return;
    
    const { error } = await supabase.from('salas').delete().eq('id', id);
    
    if (error) {
      alert("Erro ao eliminar sala: " + error.message);
    } else {
      fetchDados();
    }
  };

  const handleMapearDisciplina = async (disciplinaId: string, salaId: string) => {
    // Se salaId for vazio, definimos como null (sem sala)
    const valorSala = salaId === "" ? null : salaId;
    
    const { error } = await supabase
      .from('subjects')
      .update({ sala_id: valorSala })
      .eq('id', disciplinaId);

    if (error) {
      alert("Erro ao mapear: " + error.message);
    } else {
      fetchDados(); // Atualiza a UI para refletir o roteamento
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 md:p-8 max-w-6xl mx-auto font-sans">
      
      <header className="flex items-center gap-4 mb-10">
        <Link href="/admin" className="p-3 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-colors group">
          <ArrowLeft size={20} className="text-slate-400 group-hover:text-white" />
        </Link>
        <div>
          <h1 className="text-3xl md:text-4xl font-black italic uppercase tracking-tighter flex items-center gap-3">
             <MapPin size={28} className="text-blue-500" /> Logística e Salas
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Mapeamento de recursos físicos</p>
        </div>
      </header>

      <div className="grid md:grid-cols-3 gap-8">
        
        {/* COLUNA ESQUERDA: CRIAR E LISTAR SALAS */}
        <div className="md:col-span-1 space-y-8">
          
          {/* FORM NOVA SALA */}
          <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
            <h2 className="text-sm font-black uppercase text-slate-400 tracking-widest mb-6 flex items-center gap-2">
              <Plus size={16} className="text-blue-500" /> Adicionar Sala
            </h2>
            <form onSubmit={handleCriarSala} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Nome da Sala</label>
                <input 
                  type="text" required value={novaSalaNome} onChange={(e)=>setNovaSalaNome(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 text-sm font-bold"
                  placeholder="Ex: Sala 1"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Lotação (Cadeiras)</label>
                <input 
                  type="number" min="1" required value={novaSalaCapacidade} onChange={(e)=>setNovaSalaCapacidade(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 text-sm font-bold font-mono"
                />
              </div>
              <button type="submit" disabled={savingSala} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-xl transition-all active:scale-95 flex justify-center items-center gap-2 mt-2">
                {savingSala ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} GRAVAR SALA
              </button>
            </form>
          </section>

          {/* LISTA DE SALAS */}
          <section className="space-y-3">
             <h2 className="text-xs font-black uppercase text-slate-500 tracking-widest mb-4 ml-2">Salas Ativas</h2>
             {salas.length === 0 ? (
               <div className="text-center p-8 border-2 border-dashed border-slate-800 rounded-3xl text-slate-600 text-xs font-bold uppercase tracking-widest">Nenhuma sala registada.</div>
             ) : (
               salas.map(sala => (
                 <div key={sala.id} className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center justify-between shadow-lg group">
                   <div>
                     <p className="font-black text-white text-lg">{sala.nome}</p>
                     <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-1 flex items-center gap-1">
                       <Users size={12} /> Máx: {sala.capacidade}
                     </p>
                   </div>
                   <div className="flex items-center gap-2">
                     <button 
                       onClick={() => handleEliminarSala(sala.id)}
                       className="p-2.5 bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl hover:bg-red-500 hover:text-white transition-all"
                       title="Eliminar Sala"
                     >
                       <Trash2 size={18} />
                     </button>
                     <div className="bg-blue-500/10 text-blue-500 p-2.5 rounded-xl border border-blue-500/20">
                       <MapPin size={18} />
                     </div>
                   </div>
                 </div>
               ))
             )}
          </section>
        </div>

        {/* COLUNA DIREITA: MAPEAR DISCIPLINAS */}
        <div className="md:col-span-2">
          <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-xl h-full">
            <div className="flex items-center justify-between mb-8 pb-6 border-b border-slate-800/50">
              <h2 className="text-sm font-black uppercase text-slate-400 tracking-widest flex items-center gap-2">
                <BookOpen size={18} className="text-emerald-500" /> Roteamento de Disciplinas
              </h2>
              <span className="text-[10px] bg-slate-800 text-slate-400 px-3 py-1 rounded-full font-black uppercase tracking-widest border border-slate-700">
                {disciplinas.length} Registadas
              </span>
            </div>

            <div className="space-y-3">
              {disciplinas.map(disc => (
                <div key={disc.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-950 border border-slate-800 rounded-2xl hover:border-slate-700 transition-colors shadow-inner">
                  <div>
                    <p className="font-black text-white text-base">{disc.name}</p>
                    <p className={`text-[10px] font-black uppercase tracking-widest mt-1 ${disc.sala_id ? 'text-emerald-500' : 'text-slate-600'}`}>
                      {disc.sala_id ? 'Alocada à Sala' : 'Sem Sala Definida'}
                    </p>
                  </div>
                  
                  <select 
                    value={disc.sala_id || ""}
                    onChange={(e) => handleMapearDisciplina(disc.id, e.target.value)}
                    className={`p-3 rounded-xl border text-xs font-black outline-none cursor-pointer transition-colors w-full sm:w-auto uppercase tracking-wider ${
                      disc.sala_id 
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' 
                        : 'bg-slate-900 border-slate-700 text-slate-400'
                    }`}
                  >
                    <option value="">Não Atribuir Sala</option>
                    {salas.map(s => (
                      <option key={s.id} value={s.id}>{s.nome} (Máx: {s.capacidade})</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            
            {disciplinas.length === 0 && (
              <div className="text-center p-12 border-2 border-dashed border-slate-800 rounded-3xl text-slate-600 text-sm font-bold">
                Ainda não tens disciplinas. Cria-as primeiro na Gestão de Disciplinas.
              </div>
            )}
          </section>
        </div>

      </div>
    </main>
  );
}