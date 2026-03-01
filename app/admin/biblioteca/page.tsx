'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import { ArrowLeft, Library, Plus, Trash2, Link as LinkIcon, FileText, Youtube, Loader2, Save, ExternalLink, UploadCloud } from 'lucide-react';

export default function AdminLibrary() {
  const [resources, setResources] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Formulário
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState('link'); 
  const [subjectId, setSubjectId] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    fetchData();
  }, [supabase]);

  const fetchData = async () => {
    const { data: subjs } = await supabase.from('subjects').select('*').order('name');
    if (subjs) setSubjects(subjs);

    const { data: res } = await supabase
      .from('resources')
      .select('*, subjects(name)')
      .order('created_at', { ascending: false });
    
    if (res) setResources(res);
    setLoading(false);
  };

  const handleAdd = async (e: any) => {
    e.preventDefault();
    if (!title || !subjectId) return;
    setSubmitting(true);

    let finalUrl = url;

    // LÓGICA DE UPLOAD (Se houver ficheiro selecionado)
    if (type === 'pdf' && file) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `uploads/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('materiais')
        .upload(filePath, file);

      if (uploadError) {
        alert('Erro no upload: ' + uploadError.message);
        setSubmitting(false);
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('materiais')
        .getPublicUrl(filePath);
      
      finalUrl = publicUrl;
    }

    const { error } = await supabase.from('resources').insert({
      title,
      url: finalUrl,
      type,
      subject_id: subjectId
    });

    if (error) {
      alert('Erro ao guardar: ' + error.message);
    } else {
      setTitle('');
      setUrl('');
      setFile(null);
      fetchData();
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string, storageUrl: string) => {
    if (!confirm('Apagar este recurso permanentemente?')) return;
    
    // Se for PDF alojado no nosso bucket, tentamos apagar o ficheiro físico também
    if (storageUrl.includes('materiais')) {
       const path = storageUrl.split('materiais/').pop();
       if (path) await supabase.storage.from('materiais').remove([path]);
    }

    await supabase.from('resources').delete().eq('id', id);
    fetchData();
  };

  const getIcon = (t: string) => {
    if (t === 'pdf') return <FileText size={20} className="text-red-400" />;
    if (t === 'video') return <Youtube size={20} className="text-red-600" />;
    return <LinkIcon size={20} className="text-blue-400" />;
  };

  if (loading) return <div className="min-h-screen bg-[#0f172a] flex items-center justify-center"><Loader2 className="animate-spin text-orange-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-[#0f172a] p-8 text-white font-sans">
      <div className="max-w-6xl mx-auto">
        
        {/* CABEÇALHO CONSISTENTE */}
        <header className="mb-12 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="p-3 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-colors group">
              <ArrowLeft size={20} className="text-slate-400 group-hover:text-white" />
            </Link>
            <div>
               <h1 className="text-3xl font-black italic tracking-tighter uppercase">Biblioteca Admin</h1>
               <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Gestão de Recursos Educativos</p>
            </div>
          </div>
          <div className="bg-orange-500/10 text-orange-500 p-4 rounded-3xl border border-orange-500/20">
             <Library size={28} />
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* FORMULÁRIO DE PUBLICAÇÃO */}
          <section className="lg:col-span-1">
            <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] shadow-2xl sticky top-8">
              <h2 className="text-xl font-black mb-6 flex items-center gap-2">
                <Plus className="text-emerald-500" size={24} /> Publicar Material
              </h2>
              
              <form onSubmit={handleAdd} className="space-y-5">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest ml-1">Disciplina Alvo</label>
                  <select 
                    value={subjectId}
                    onChange={(e) => setSubjectId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-2xl outline-none focus:border-orange-500 appearance-none font-bold mt-1"
                    required
                  >
                    <option value="">Escolher...</option>
                    {subjects.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest ml-1">Título do Recurso</label>
                  <input 
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex: Resumo de Geometria"
                    className="w-full bg-slate-950 border border-slate-800 text-white p-4 rounded-2xl outline-none focus:border-orange-500 font-bold mt-1"
                    required
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest ml-1">Tipo de Conteúdo</label>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                      {['link', 'pdf', 'video'].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => { setType(t); setFile(null); setUrl(''); }}
                          className={`py-3 rounded-xl text-[9px] font-black uppercase border transition-all ${type === t ? 'bg-orange-600 border-orange-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-500'}`}
                        >
                          {t}
                        </button>
                      ))}
                  </div>
                </div>

                {/* CAMPO DINÂMICO: UPLOAD OU LINK */}
                <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl">
                    {type === 'pdf' ? (
                        <div className="text-center">
                            <label className="cursor-pointer group">
                                <UploadCloud size={32} className={`mx-auto mb-2 transition-colors ${file ? 'text-emerald-500' : 'text-slate-600 group-hover:text-orange-500'}`} />
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-white">
                                    {file ? file.name : 'Selecionar PDF'}
                                </span>
                                <input type="file" accept="application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                            </label>
                        </div>
                    ) : (
                        <input 
                            type="url"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder={type === 'video' ? "Link do YouTube..." : "https://..."}
                            className="w-full bg-transparent text-white outline-none font-bold text-sm"
                            required
                        />
                    )}
                </div>

                <button 
                  type="submit" 
                  disabled={submitting}
                  className="w-full bg-orange-600 hover:bg-orange-500 text-white font-black py-4 rounded-2xl transition-all active:scale-95 shadow-lg shadow-orange-900/20 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="animate-spin" /> : <><Save size={20} /> PUBLICAR AGORA</>}
                </button>
              </form>
            </div>
          </section>

          {/* LISTA DE RECURSOS (COLUNA 2) */}
          <section className="lg:col-span-2 space-y-4">
            <h3 className="text-xs font-black uppercase text-slate-500 tracking-widest mb-4 px-2">Repositório Ativo ({resources.length})</h3>
            
            <div className="grid grid-cols-1 gap-4">
              {resources.length === 0 ? (
                <div className="bg-slate-900/40 border-2 border-dashed border-slate-800 p-20 rounded-[3rem] text-center">
                   <p className="text-slate-600 font-black uppercase text-xs tracking-widest italic opacity-50">Biblioteca vazia...</p>
                </div>
              ) : (
                resources.map((res) => (
                  <div key={res.id} className="bg-slate-900 border border-slate-800 p-6 rounded-3xl flex justify-between items-center group hover:border-orange-500/50 transition-all shadow-xl">
                    <div className="flex items-center gap-5 overflow-hidden">
                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 group-hover:border-orange-500/30 transition-colors">
                        {getIcon(res.type)}
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-black text-white text-lg truncate group-hover:text-orange-300 transition-colors">{res.title}</h4>
                        <div className="flex items-center gap-3 mt-1">
                            <span className="bg-orange-500/10 text-orange-500 text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-widest border border-orange-500/20">
                                {res.subjects?.name}
                            </span>
                            <a href={res.url} target="_blank" className="text-slate-500 hover:text-blue-400 text-[10px] font-bold flex items-center gap-1 transition-colors">
                                Ver Recurso <ExternalLink size={10} />
                            </a>
                        </div>
                      </div>
                    </div>
                    
                    <button 
                      onClick={() => handleDelete(res.id, res.url)}
                      className="p-4 text-slate-700 hover:text-red-500 hover:bg-red-500/10 rounded-2xl transition-all active:scale-95"
                    >
                      <Trash2 size={20} />
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