'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import { ArrowLeft, Search, FileText, Youtube, Link as LinkIcon, ExternalLink, Library, Loader2, BookOpen } from 'lucide-react';

export default function StudentLibrary() {
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('Todos');
  const [subjectsList, setSubjectsList] = useState<string[]>([]);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const fetchResources = async () => {
      const { data } = await supabase
        .from('resources')
        .select('*, subjects(name)')
        .order('created_at', { ascending: false });

      if (data) {
        setResources(data);
        // Extrair lista única de disciplinas para os filtros
        const subs = Array.from(new Set(data.map((r: any) => r.subjects?.name).filter(Boolean)));
        setSubjectsList(['Todos', ...subs] as string[]);
      }
      setLoading(false);
    };

    fetchResources();
  }, [supabase]);

  // Ícone baseada no tipo
  const getIcon = (t: string) => {
    if (t === 'pdf') return <FileText size={28} className="text-red-400" />;
    if (t === 'video') return <Youtube size={28} className="text-red-600" />;
    return <LinkIcon size={28} className="text-blue-400" />;
  };

  const getBadgeColor = (t: string) => {
    if (t === 'pdf') return 'bg-red-500/10 text-red-400 border-red-500/20';
    if (t === 'video') return 'bg-red-600/10 text-red-500 border-red-600/20';
    return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
  };

  // Filtragem
  const filteredResources = resources.filter(res => {
    const matchesSearch = res.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSubject = selectedSubject === 'Todos' || res.subjects?.name === selectedSubject;
    return matchesSearch && matchesSubject;
  });

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-orange-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] text-white p-6 pb-20 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* CABEÇALHO CONSISTENTE COM A AGENDA */}
        <header className="flex items-center justify-between">
            <Link href="/" className="p-3 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-colors group">
              <ArrowLeft size={20} className="text-slate-400 group-hover:text-white transition-colors" />
            </Link>
            <div className="text-right">
                <h1 className="text-2xl font-black italic tracking-tighter text-white">BIBLIOTECA</h1>
                <p className="text-[10px] font-black uppercase text-orange-500 tracking-widest">Fichas e Resumos</p>
            </div>
        </header>

        {/* MÓDULO DE PESQUISA E FILTROS */}
        <section className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-6">
                <div className="bg-orange-500/10 text-orange-500 p-3 rounded-xl">
                    <Library size={24} />
                </div>
                <div>
                    <h2 className="text-lg font-black text-white">Acervo de Estudo</h2>
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Encontra o teu material</p>
                </div>
            </div>

            {/* BARRA DE PESQUISA */}
            <div className="relative mb-6">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                <input 
                    type="text" 
                    placeholder="Pesquisar por tema, capítulo, vídeo..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-white pl-12 pr-4 py-4 rounded-2xl outline-none focus:border-orange-500 transition-all shadow-lg placeholder:text-slate-600 font-medium"
                />
            </div>

            {/* FILTROS (Chips Mobile-Friendly) */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-2 px-2">
                {subjectsList.map((subject) => (
                    <button
                        key={subject}
                        onClick={() => setSelectedSubject(subject)}
                        className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${
                            selectedSubject === subject 
                            ? 'bg-orange-500 text-slate-950 border-orange-500 shadow-lg shadow-orange-500/20' 
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-600'
                        }`}
                    >
                        {subject}
                    </button>
                ))}
            </div>
        </section>

        {/* GRID DE RECURSOS PREMIUM */}
        <section className="space-y-4 pt-2">
            <div className="flex items-center justify-between mb-4">
               <h2 className="text-xs font-black uppercase text-slate-500 tracking-widest">Documentos & Links</h2>
               <span className="text-[10px] bg-slate-900 border border-slate-800 px-3 py-1 rounded-full font-bold text-slate-400">
                 {filteredResources.length} resultados
               </span>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
                {filteredResources.length === 0 ? (
                    <div className="col-span-full text-center py-16 bg-slate-900/40 rounded-[2.5rem] border border-slate-800 border-dashed">
                        <BookOpen size={48} className="mx-auto mb-4 text-slate-700" />
                        <p className="text-slate-500 font-bold text-sm">Nenhum material encontrado.</p>
                        <p className="text-slate-600 text-xs mt-1">Tenta procurar por outro termo ou disciplina.</p>
                    </div>
                ) : (
                    filteredResources.map((res) => (
                        <a 
                            key={res.id} 
                            href={res.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="bg-slate-900 border border-slate-800 p-6 rounded-4xl flex flex-col gap-4 hover:border-orange-500/50 hover:bg-slate-800/80 transition-all group relative overflow-hidden shadow-xl"
                        >
                            {/* Efeito Glow no Hover */}
                            <div className="absolute inset-0 bg-linear-to-br from-orange-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            
                            <div className="flex items-start justify-between relative z-10">
                                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 group-hover:border-orange-500/30 transition-colors shadow-inner">
                                    {getIcon(res.type)}
                                </div>
                                <span className={`border px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${getBadgeColor(res.type)}`}>
                                    {res.type}
                                </span>
                            </div>
                            
                            <div className="relative z-10 mt-2">
                                <p className="text-[10px] text-orange-500 font-black mb-1 uppercase tracking-widest">
                                    {res.subjects?.name || 'Geral'}
                                </p>
                                <h3 className="font-black text-lg text-white group-hover:text-orange-300 transition-colors line-clamp-2 leading-tight">
                                    {res.title}
                                </h3>
                                
                                <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-800/50">
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                        Adicionado a {new Date(res.created_at).toLocaleDateString('pt-PT')}
                                    </p>
                                    <div className="bg-orange-500/10 text-orange-500 p-2 rounded-lg group-hover:bg-orange-500 group-hover:text-white transition-colors">
                                        <ExternalLink size={14} />
                                    </div>
                                </div>
                            </div>
                        </a>
                    ))
                )}
            </div>
        </section>

      </div>
    </main>
  );
}