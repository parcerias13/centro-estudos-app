'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { UserPlus, Search, FileBarChart, Edit, Trash2, ShieldCheck, ShieldAlert, Loader2, ArrowLeft, Users } from 'lucide-react';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ListaAlunos() {
  const [alunos, setAlunos] = useState<any[]>([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchAlunos(); }, []);

  const fetchAlunos = async () => {
    const { data, error } = await supabase
      .from('alunos')
      .select('*')
      .order('nome', { ascending: true });
    
    if (error) console.error('Erro ao buscar alunos:', error.message);
    if (data) setAlunos(data);
    setLoading(false);
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

  const alunosFiltrados = alunos.filter(a => 
    a.nome?.toLowerCase().includes(busca.toLowerCase())
  );

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  return (
    <div className="min-h-screen bg-[#0f172a] p-6 text-white">
      
      <header className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="bg-slate-900 p-3 rounded-xl hover:bg-slate-800 transition-colors border border-slate-800">
            <ArrowLeft size={20} className="text-slate-400" />
          </Link>
          <div>
            <h1 className="text-3xl font-black tracking-tight flex items-center gap-2">
                <Users className="text-blue-500" size={28} /> Gerir Alunos
            </h1>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">{alunos.length} Matrículas Ativas</p>
          </div>
        </div>
        
        <Link href="/admin/alunos/novo" className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-2xl font-black flex items-center gap-2 shadow-lg shadow-blue-900/20 transition-all active:scale-95">
          <UserPlus size={20} /> NOVA MATRÍCULA
        </Link>
      </header>

      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
        <input 
          type="text" 
          placeholder="Pesquisar por nome do aluno..." 
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full bg-slate-900/50 border border-slate-800 p-5 pl-14 rounded-2xl outline-none focus:border-blue-500 transition-all text-lg font-medium placeholder:text-slate-600"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {alunosFiltrados.length === 0 ? (
          <div className="col-span-full text-center py-20 bg-slate-900/20 border-2 border-dashed border-slate-800 rounded-3xl">
            <p className="text-slate-500 font-medium">Nenhum aluno encontrado.</p>
          </div>
        ) : (
          alunosFiltrados.map((aluno) => (
            <div key={aluno.id} className="bg-slate-900/40 border border-slate-800/60 p-5 rounded-3xl flex items-center justify-between group hover:border-slate-700 transition-all shadow-sm">
              <div className="flex items-center gap-5">
                
                {/* MAGIA DO AVATAR AQUI */}
                <div className="w-14 h-14 shrink-0 bg-slate-800 rounded-2xl flex items-center justify-center text-xl font-black text-slate-500 group-hover:bg-blue-600 group-hover:text-white transition-all overflow-hidden border border-slate-700/50 shadow-inner">
                  {aluno.avatar_url ? (
                    <img src={aluno.avatar_url} alt={aluno.nome} className="w-full h-full object-cover" />
                  ) : (
                    <span>{aluno.nome?.charAt(0)}</span>
                  )}
                </div>
                {/* FIM DA MAGIA DO AVATAR */}

                <div>
                  <h3 className="text-lg font-bold text-white leading-tight">{aluno.nome}</h3>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 bg-slate-800 text-slate-400 rounded-md border border-slate-700">
                      {aluno.ano_escolar}º ANO
                    </span>
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md flex items-center gap-1 ${aluno.saida_autorizada ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                      {aluno.saida_autorizada ? <ShieldCheck size={10} /> : <ShieldAlert size={10} />}
                      {aluno.saida_autorizada ? 'Autónomo' : 'Restrito'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-600 font-mono mt-1">{aluno.telefone_encarregado || 'Sem contacto'}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Link 
                  href={`/admin/relatorio?id=${aluno.id}`} 
                  className="p-3 bg-slate-800 text-slate-400 hover:bg-white hover:text-black rounded-xl transition-all border border-slate-700 hover:border-white"
                  title="Ver Relatório"
                >
                  <FileBarChart size={20} />
                </Link>
                <Link 
                  href={`/admin/alunos/editar?id=${aluno.id}`} 
                  className="p-3 bg-slate-800 text-slate-400 hover:bg-blue-600 hover:text-white rounded-xl transition-all border border-slate-700 hover:border-blue-600"
                  title="Editar"
                >
                  <Edit size={20} />
                </Link>
                <button 
                  onClick={() => handleDelete(aluno.id)}
                  className="p-3 bg-slate-800 text-slate-400 hover:bg-red-600 hover:text-white rounded-xl transition-all border border-slate-700 hover:border-red-600"
                  title="Apagar"
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