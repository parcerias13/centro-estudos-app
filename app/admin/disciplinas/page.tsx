'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  BookOpen, Plus, Trash2, Loader2, Library, ChevronDown, ChevronRight,
  FileText, Youtube, Link as LinkIcon, Download, Upload, X, AlertCircle,
} from 'lucide-react';

type Resource = {
  id: string;
  title: string;
  url: string;
  type: string;
  subject_id: string;
  ano_escolar: number;
  centro_id: string;
  created_at: string;
};

type Subject = {
  id: string;
  name: string;
  centro_id: string;
};

export default function DisciplinasEMateriais() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Modal "Adicionar Disciplina"
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [subjectError, setSubjectError] = useState<string | null>(null);

  // Form inline "Adicionar Material" (por disciplina)
  const [addingMaterialFor, setAddingMaterialFor] = useState<string | null>(null);
  const [matTitle, setMatTitle] = useState('');
  const [matType, setMatType] = useState('pdf');
  const [matUrl, setMatUrl] = useState('');
  const [matAno, setMatAno] = useState('10');
  const [matFile, setMatFile] = useState<File | null>(null);
  const [uploadingMat, setUploadingMat] = useState(false);
  const [matError, setMatError] = useState<string | null>(null);

  const fetchAll = async () => {
    const [{ data: subjs }, { data: res }] = await Promise.all([
      supabase.from('subjects').select('*').order('name'),
      supabase.from('resources').select('*').order('created_at', { ascending: false }),
    ]);
    if (subjs) setSubjects(subjs);
    if (res) setResources(res);
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const getSubjectResources = (subjectId: string) =>
    resources.filter((r) => r.subject_id === subjectId);

  const getSubjectYears = (subjectId: string) => {
    const years = [
      ...new Set(getSubjectResources(subjectId).map((r) => r.ano_escolar)),
    ].sort((a, b) => a - b);
    return years.length > 0 ? years.map((y) => `${y}º`).join(', ') : null;
  };

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newSubjectName.trim();
    if (!name) return;
    setSubjectError(null);
    setCreatingSubject(true);

    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;
    if (!centro_id) {
      setSubjectError('Não foi possível obter o centro. Recarrega a página.');
      setCreatingSubject(false);
      return;
    }

    const { error } = await supabase.from('subjects').insert({ name, centro_id });
    if (error) {
      setSubjectError(error.message);
    } else {
      setNewSubjectName('');
      setShowAddSubject(false);
      fetchAll();
    }
    setCreatingSubject(false);
  };

  const handleDeleteSubject = async (id: string, name: string) => {
    if (!confirm(`Tens a certeza que queres apagar "${name}"?\nIsto não apaga o histórico, mas os alunos deixarão de a ver.`)) return;
    const { error } = await supabase.from('subjects').delete().eq('id', id);
    if (!error) fetchAll();
    else alert('Erro ao eliminar: ' + error.message);
  };

  const handleAddMaterial = async (e: React.FormEvent, subjectId: string) => {
    e.preventDefault();
    if (!matTitle || !matAno) return;
    setMatError(null);
    setUploadingMat(true);

    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;
    if (!centro_id) {
      setMatError('Não foi possível obter o centro.');
      setUploadingMat(false);
      return;
    }

    let finalUrl = matUrl;

    if (matType === 'pdf' && matFile) {
      const fileExt = matFile.name.split('.').pop();
      const filePath = `uploads/${Math.random()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('materiais')
        .upload(filePath, matFile);
      if (uploadError) {
        setMatError('Erro no upload: ' + uploadError.message);
        setUploadingMat(false);
        return;
      }
      finalUrl = supabase.storage.from('materiais').getPublicUrl(filePath).data.publicUrl;
    }

    const { error } = await supabase.from('resources').insert({
      title: matTitle,
      url: finalUrl,
      type: matType,
      subject_id: subjectId,
      ano_escolar: parseInt(matAno),
      centro_id,
    });

    if (error) {
      setMatError('Erro ao guardar: ' + error.message);
    } else {
      setMatTitle('');
      setMatUrl('');
      setMatFile(null);
      setMatAno('10');
      setAddingMaterialFor(null);
      fetchAll();
    }
    setUploadingMat(false);
  };

  const handleDeleteMaterial = async (id: string, url: string) => {
    if (!confirm('Apagar este material permanentemente?')) return;
    if (url.includes('materiais')) {
      const path = url.split('materiais/').pop();
      if (path) await supabase.storage.from('materiais').remove([path]);
    }
    await supabase.from('resources').delete().eq('id', id);
    fetchAll();
  };

  const openAddMaterial = (subjectId: string) => {
    setAddingMaterialFor(subjectId);
    setMatTitle('');
    setMatUrl('');
    setMatFile(null);
    setMatType('pdf');
    setMatAno('10');
    setMatError(null);
  };

  const getTypeIcon = (type: string) => {
    if (type === 'pdf') return <FileText size={16} className="text-danger" />;
    if (type === 'video') return <Youtube size={16} className="text-danger" />;
    return <LinkIcon size={16} className="text-accent" />;
  };

  if (loading) return (
    <div className="min-h-screen bg-page flex items-center justify-center">
      <Loader2 className="animate-spin text-accent" size={32} />
    </div>
  );

  return (
    <main className="min-h-screen bg-page p-8 text-primary font-sans">
      <div className="max-w-4xl mx-auto">

        {/* CABEÇALHO */}
        <header className="mb-10 flex items-start justify-between gap-4">
          <div>
            <div className="bg-accent-soft text-accent p-3 rounded-2xl border border-accent/20 inline-flex mb-4">
              <Library size={24} />
            </div>
            <h1 className="text-4xl font-black italic tracking-tighter uppercase text-primary">
              Disciplinas e Materiais
            </h1>
            <p className="text-muted text-xs font-bold uppercase tracking-widest mt-2">
              Gere as disciplinas e os materiais de estudo
            </p>
          </div>
          <button
            onClick={() => { setShowAddSubject(true); setNewSubjectName(''); setSubjectError(null); }}
            className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-on-accent font-black py-3 px-5 rounded-2xl transition-all active:scale-95 shadow-lg shadow-accent/20 text-sm shrink-0 mt-2"
          >
            <Plus size={18} /> Adicionar Disciplina
          </button>
        </header>

        {/* LISTA DE DISCIPLINAS */}
        <div className="space-y-3">
          {subjects.length === 0 ? (
            <div className="bg-surface/40 border-2 border-dashed border-border p-12 rounded-3xl text-center">
              <AlertCircle size={32} className="mx-auto mb-3 text-muted" />
              <p className="text-muted font-bold italic">Nenhuma disciplina registada.</p>
            </div>
          ) : (
            subjects.map((subj) => {
              const subjResources = getSubjectResources(subj.id);
              const years = getSubjectYears(subj.id);
              const isExpanded = expandedId === subj.id;

              return (
                <div key={subj.id} className="bg-surface border border-border rounded-2xl overflow-hidden">

                  {/* ROW CLICÁVEL */}
                  <div
                    className="flex items-center justify-between p-5 cursor-pointer hover:bg-raised/50 transition-colors group"
                    onClick={() => setExpandedId(isExpanded ? null : subj.id)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="bg-page p-2.5 rounded-xl border border-border group-hover:border-accent/30 transition-colors">
                        <BookOpen size={18} className="text-secondary group-hover:text-accent transition-colors" />
                      </div>
                      <div>
                        <span className="font-black text-lg text-primary">{subj.name}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          {years && (
                            <>
                              <span className="text-[10px] font-bold text-muted">{years}</span>
                              <span className="text-muted text-xs">·</span>
                            </>
                          )}
                          <span className="text-[10px] font-bold text-muted">
                            {subjResources.length}{' '}
                            {subjResources.length === 1 ? 'material' : 'materiais'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteSubject(subj.id, subj.name); }}
                        className="p-2 text-muted hover:text-danger hover:bg-danger-bg rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        title="Eliminar disciplina"
                      >
                        <Trash2 size={16} />
                      </button>
                      {isExpanded
                        ? <ChevronDown size={18} className="text-secondary" />
                        : <ChevronRight size={18} className="text-muted" />
                      }
                    </div>
                  </div>

                  {/* PAINEL EXPANDIDO */}
                  {isExpanded && (
                    <div className="border-t border-border px-5 pb-5 pt-4">

                      {/* LISTA DE MATERIAIS */}
                      {subjResources.length === 0 ? (
                        <p className="text-muted text-sm font-bold italic py-3 text-center">
                          Sem materiais publicados nesta disciplina.
                        </p>
                      ) : (
                        <div className="space-y-2 mb-4">
                          {subjResources.map((res) => (
                            <div
                              key={res.id}
                              className="flex items-center justify-between bg-page border border-border p-4 rounded-xl group/res"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                {getTypeIcon(res.type)}
                                <div className="min-w-0">
                                  <p className="font-bold text-sm text-primary truncate">{res.title}</p>
                                  <p className="text-[10px] text-muted font-bold">
                                    {res.ano_escolar}º ano · {new Date(res.created_at).toLocaleDateString('pt-PT')}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 ml-4 shrink-0">
                                <a
                                  href={res.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-2 text-muted hover:text-accent hover:bg-accent-soft rounded-xl transition-all"
                                  title="Download / Abrir"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Download size={15} />
                                </a>
                                <button
                                  onClick={() => handleDeleteMaterial(res.id, res.url)}
                                  className="p-2 text-muted hover:text-danger hover:bg-danger-bg rounded-xl transition-all opacity-0 group-hover/res:opacity-100"
                                  title="Remover material"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* FORM INLINE ADICIONAR MATERIAL */}
                      {addingMaterialFor === subj.id ? (
                        <form
                          onSubmit={(e) => handleAddMaterial(e, subj.id)}
                          className="bg-page border border-border p-5 rounded-xl space-y-4 mt-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black uppercase text-secondary tracking-widest">
                              Novo Material
                            </span>
                            <button
                              type="button"
                              onClick={() => setAddingMaterialFor(null)}
                              className="text-muted hover:text-secondary transition-colors"
                            >
                              <X size={16} />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[9px] font-black uppercase text-muted tracking-widest">
                                Título
                              </label>
                              <input
                                type="text"
                                required
                                autoFocus
                                value={matTitle}
                                onChange={(e) => setMatTitle(e.target.value)}
                                placeholder="Ex: Resumo Cap. 1"
                                className="w-full bg-surface border border-border p-3 rounded-xl outline-none focus:border-accent text-primary text-sm font-bold mt-1 placeholder:text-muted"
                              />
                            </div>
                            <div>
                              <label className="text-[9px] font-black uppercase text-muted tracking-widest">
                                Ano Escolar
                              </label>
                              <select
                                value={matAno}
                                onChange={(e) => setMatAno(e.target.value)}
                                className="w-full bg-surface border border-border text-primary p-3 rounded-xl outline-none focus:border-accent font-bold mt-1 text-sm appearance-none"
                              >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((ano) => (
                                  <option key={ano} value={ano}>{ano}º Ano</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="text-[9px] font-black uppercase text-muted tracking-widest">
                              Tipo
                            </label>
                            <div className="flex gap-2 mt-1">
                              {['pdf', 'link', 'video'].map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  onClick={() => { setMatType(t); setMatFile(null); setMatUrl(''); }}
                                  className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase border transition-all ${
                                    matType === t
                                      ? 'bg-accent border-accent text-on-accent'
                                      : 'bg-surface border-border text-muted hover:border-border'
                                  }`}
                                >
                                  {t}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="bg-surface border border-border p-3 rounded-xl">
                            {matType === 'pdf' ? (
                              <label className="cursor-pointer flex items-center gap-3">
                                <Upload size={18} className={matFile ? 'text-success' : 'text-muted'} />
                                <span className="text-sm font-bold text-secondary">
                                  {matFile ? matFile.name : 'Selecionar PDF'}
                                </span>
                                <input
                                  type="file"
                                  accept="application/pdf"
                                  className="hidden"
                                  onChange={(e) => setMatFile(e.target.files?.[0] || null)}
                                />
                              </label>
                            ) : (
                              <input
                                type="url"
                                required
                                value={matUrl}
                                onChange={(e) => setMatUrl(e.target.value)}
                                placeholder={matType === 'video' ? 'Link do YouTube...' : 'https://...'}
                                className="w-full bg-transparent text-primary outline-none font-bold text-sm placeholder:text-muted"
                              />
                            )}
                          </div>

                          {matError && (
                            <p className="text-danger text-[11px] font-bold">{matError}</p>
                          )}

                          <button
                            type="submit"
                            disabled={uploadingMat}
                            className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-on-accent font-black py-3 rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2 text-sm"
                          >
                            {uploadingMat
                              ? <><Loader2 className="animate-spin" size={16} /> A publicar...</>
                              : <><Plus size={16} /> Publicar Material</>
                            }
                          </button>
                        </form>
                      ) : (
                        <button
                          onClick={() => openAddMaterial(subj.id)}
                          className="flex items-center gap-2 text-sm font-black text-muted hover:text-accent transition-colors py-2 mt-1"
                        >
                          <Plus size={16} /> Adicionar material
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* MODAL: ADICIONAR DISCIPLINA */}
      {showAddSubject && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl p-8 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black text-primary">Nova Disciplina</h2>
              <button
                onClick={() => { setShowAddSubject(false); setNewSubjectName(''); setSubjectError(null); }}
                className="text-muted hover:text-primary transition-colors"
              >
                <X size={22} />
              </button>
            </div>
            <form onSubmit={handleAddSubject} className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-muted tracking-widest">
                  Nome da Disciplina
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="Ex: Biologia"
                  className="w-full bg-page border border-border p-4 rounded-2xl outline-none focus:border-accent text-primary font-bold mt-2 placeholder:text-muted"
                />
              </div>
              {subjectError && (
                <p className="text-danger text-[11px] font-bold">{subjectError}</p>
              )}
              <button
                disabled={creatingSubject || !newSubjectName.trim()}
                className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-on-accent font-black py-4 rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {creatingSubject
                  ? <><Loader2 className="animate-spin" size={18} /> A criar...</>
                  : <><Plus size={18} /> Criar Disciplina</>
                }
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
