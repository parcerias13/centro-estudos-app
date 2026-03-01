'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { BookOpen, Plus, Trash2, ArrowLeft, Loader2, Library, CheckCircle2, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function AdminDisciplinas() {
  const [disciplinas, setDisciplinas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [nome, setNome] = useState('');

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    fetchDisciplinas();
  }, []);

  const fetchDisciplinas = async () => {
    // Mantém a tua lógica de busca e ordenação exata
    const { data } = await supabase.from('subjects').select('*').order('name');
    if (data) setDisciplinas(data);
    setLoading(false);
  };

  const handleCriar = async (e: React.FormEvent) => {
    e.preventDefault();
    const nomeLimpo = nome.trim(); // Mantém a tua validação de trim()
    if (!nomeLimpo) return;
    setCreating(true);

    // Inserção na tabela correta 'subjects'
    const { error } = await supabase.from('subjects').insert({ name: nomeLimpo });

    if (error) {
      alert(`ERRO: ${error.message}\n(Verifica se correste o SQL para desativar o RLS)`);
    } else {
      setNome('');
      fetchDisciplinas();
    }
    setCreating(false);
  };

  const handleEliminar = async (id: string, name: string) => {
    // Mantém o teu aviso de confirmação importante
    if (!confirm(`Tens a certeza que queres apagar "${name}"?\nIsto não apaga o histórico, mas os alunos deixarão de a ver.`)) return;
    
    const { error } = await supabase.from('subjects').delete().eq('id', id);
    if (!error) fetchDisciplinas();
    else alert("Erro ao eliminar: " + error.message);
  };

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] p-8 text-white font-sans">
      <div className="max-w-4xl mx-auto">
        
        {/* CABEÇALHO PREMIUM */}
        <header className="mb-12">
          <div className="flex items-center gap-4 mb-4">
            <Link href="/admin" className="p-3 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-colors group">
              <ArrowLeft size={20} className="text-slate-400 group-hover:text-white" />
            </Link>
            <div className="bg-orange-500/10 text-orange-400 p-3 rounded-2xl border border-orange-500/20">
              <Library size={24} />
            </div>
          </div>
          <h1 className="text-4xl font-black italic tracking-tighter uppercase text-white">Oferta Formativa</h1>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-2">Configura as disciplinas disponíveis para estudo</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* FORMULÁRIO (COLUNA ESQUERDA) */}
          <section className="md:col-span-1">
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-4xl shadow-2xl sticky top-8">
              <h2 className="text-lg font-black mb-6 flex items-center gap-2 text-white">
                <Plus className="text-orange-500" size={20} /> Nova Disciplina
              </h2>
              <form onSubmit={handleCriar} className="space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500 ml-1">Nome da Cadeira</label>
                  <input 
                    type="text" 
                    required 
                    value={nome} 
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Ex: Biologia"
                    autoFocus // Mantém o teu foco automático
                    className="w-full bg-slate-950 border border-slate-800 p-4 rounded-2xl outline-none focus:border-orange-500 transition-all text-white placeholder:text-slate-700 font-bold"
                  />
                </div>
                <button 
                  disabled={creating || !nome.trim()}
                  className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-black py-4 rounded-2xl transition-all active:scale-95 shadow-lg shadow-orange-900/20 flex items-center justify-center gap-2"
                >
                  {creating ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
                  {creating ? 'A PROCESSAR...' : 'ADICIONAR'}
                </button>
              </form>
            </div>
          </section>

          {/* LISTA (COLUNA DIREITA) */}
          <section className="md:col-span-2">
            <div className="flex items-center justify-between mb-6 px-2">
              <h3 className="text-xs font-black uppercase text-slate-500 tracking-widest">Disciplinas Ativas ({disciplinas.length})</h3>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {disciplinas.length === 0 ? (
                <div className="bg-slate-900/40 border-2 border-dashed border-slate-800 p-12 rounded-4xl text-center">
                  <AlertCircle size={32} className="mx-auto mb-3 text-slate-700" />
                  <p className="text-slate-600 font-bold italic">Nenhuma disciplina registada.</p>
                </div>
              ) : (
                disciplinas.map((disc) => (
                  <div key={disc.id} className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center justify-between group hover:border-slate-600 transition-all shadow-lg">
                    <div className="flex items-center gap-4">
                      <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 group-hover:border-orange-500/30 transition-colors">
                        <BookOpen size={20} className="text-slate-400 group-hover:text-orange-500" />
                      </div>
                      <span className="font-black text-lg text-slate-200">{disc.name}</span>
                    </div>
                    <button 
                      onClick={() => handleEliminar(disc.id, disc.name)}
                      className="p-3 text-slate-600 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                      title="Eliminar Disciplina"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

        </div>
      </div>
    </main>
  );
}