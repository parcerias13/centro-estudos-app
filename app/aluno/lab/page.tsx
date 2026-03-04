'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { UploadCloud, Sparkles, BrainCircuit, Loader2, FileText, ListChecks, Network, ChevronRight, BookOpen } from 'lucide-react';

export default function LabAI() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'resumo' | 'exercicios' | 'mapa'>('resumo');
  const [resultado, setResultado] = useState<{ resumo: string, exercicios: string, mapa: string } | null>(null);
  const [creditos, setCreditos] = useState<number>(0);

  const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY!);

  useEffect(() => {
    buscarCreditos();
  }, []);

  async function buscarCreditos() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.from('alunos').select('creditos_ia').eq('id', user.id).single();
      setCreditos(data?.creditos_ia || 0);
    }
  }

  const processarMaterial = async () => {
    if (!file || creditos <= 0) return alert("Verifica créditos ou ficheiro!");
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
      
      const reader = new FileReader();
      const filePart = await new Promise((resolve) => {
        reader.onloadend = () => resolve({ inlineData: { data: (reader.result as string).split(',')[1], mimeType: file.type } });
        reader.readAsDataURL(file);
      });
      
      // PROMPT BLINDADO [cite: 2025-12-04]
      const prompt = `Age como um especialista em pedagogia. Analisa o PDF e gera 3 blocos. 
      Usa obrigatoriamente a tag de separação ###NEXT_SECTION### entre eles.
      Bloco 1: Resumo em Bullet Points com títulos em Negrito.
      Bloco 2: 5 Questões de Exame com as soluções no fim.
      Bloco 3: Mapa Mental estruturado por indentação (ex: Central -> Tópico -> Detalhe).
      NÃO uses caracteres especiais como # ou * fora do padrão Markdown.`;

      const result = await model.generateContent([prompt, filePart as any]);
      const sections = result.response.text().split('###NEXT_SECTION###');

      setResultado({
        resumo: sections[0]?.trim() || "Erro no resumo",
        exercicios: sections[1]?.trim() || "Erro nos exercícios",
        mapa: sections[2]?.trim() || "Erro no mapa"
      });

      await supabase.from('alunos').update({ creditos_ia: creditos - 1 }).eq('id', user?.id);
      setCreditos(prev => prev - 1);
    } catch (err) {
      alert("Erro na análise. Tenta um ficheiro mais pequeno.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#020617] text-slate-200 font-sans selection:bg-orange-500/30">
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        
        {/* HEADER PRESTIGIO [cite: 2026-03-05] */}
        <header className="flex justify-between items-end border-b border-slate-800 pb-8 pt-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-orange-500 p-2 rounded-lg shadow-lg shadow-orange-900/40">
                <BrainCircuit size={24} className="text-white" />
              </div>
              <h1 className="text-3xl font-black tracking-tighter italic uppercase">Personal <span className="text-orange-500">Lab</span></h1>
            </div>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-[0.3em]">Sistemas de Automação AI v3.5</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 px-4 py-2 rounded-2xl flex items-center gap-4">
            <span className="text-[10px] font-black text-slate-500 uppercase">Plafond</span>
            <span className="text-orange-500 font-black text-xl">{creditos}</span>
          </div>
        </header>

        {!resultado ? (
          <section className="py-20 text-center space-y-8 animate-in fade-in zoom-in duration-500">
            <div className="max-w-md mx-auto relative group">
              <div className="absolute -inset-1 bg-linear-to-r from-orange-600 to-amber-600 rounded-[2.5rem] blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
              <div className="relative bg-slate-900 border border-slate-800 rounded-[2.5rem] p-12 space-y-6">
                <div className="bg-slate-950 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto border border-slate-800">
                  <UploadCloud size={32} className="text-orange-500" />
                </div>
                <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                <h2 className="text-xl font-bold">{file ? file.name : "Solta o PDF de estudo"}</h2>
                <p className="text-slate-500 text-xs uppercase tracking-widest font-bold">Máximo 10MB • PDF</p>
              </div>
            </div>

            <button onClick={processarMaterial} disabled={loading || !file || creditos <= 0} className="bg-orange-600 hover:bg-orange-500 disabled:bg-slate-800 text-white px-12 py-5 rounded-2xl font-black uppercase italic tracking-tighter flex items-center gap-3 mx-auto transition-all active:scale-95 shadow-2xl shadow-orange-900/20">
              {loading ? <Loader2 className="animate-spin" /> : <><Sparkles size={20} /> Ativar Inteligência</>}
            </button>
          </section>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 animate-in slide-in-from-bottom-10 duration-700">
            {/* SIDEBAR TABS [cite: 2026-03-05] */}
            <nav className="space-y-2">
              <button onClick={() => setActiveTab('resumo')} className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all font-bold uppercase text-[10px] tracking-widest ${activeTab === 'resumo' ? 'bg-orange-600 text-white shadow-xl shadow-orange-900/20' : 'bg-slate-900 text-slate-500 hover:bg-slate-800 border border-slate-800'}`}>
                <div className="flex items-center gap-3"><FileText size={18} /> Resumo</div>
                <ChevronRight size={14} />
              </button>
              <button onClick={() => setActiveTab('exercicios')} className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all font-bold uppercase text-[10px] tracking-widest ${activeTab === 'exercicios' ? 'bg-orange-600 text-white shadow-xl shadow-orange-900/20' : 'bg-slate-900 text-slate-500 hover:bg-slate-800 border border-slate-800'}`}>
                <div className="flex items-center gap-3"><ListChecks size={18} /> Exercícios</div>
                <ChevronRight size={14} />
              </button>
              <button onClick={() => setActiveTab('mapa')} className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all font-bold uppercase text-[10px] tracking-widest ${activeTab === 'mapa' ? 'bg-orange-600 text-white shadow-xl shadow-orange-900/20' : 'bg-slate-900 text-slate-500 hover:bg-slate-800 border border-slate-800'}`}>
                <div className="flex items-center gap-3"><Network size={18} /> Mapa Mental</div>
                <ChevronRight size={14} />
              </button>
              <button onClick={() => setResultado(null)} className="w-full mt-10 p-4 text-slate-600 text-[9px] font-black uppercase tracking-[0.3em] hover:text-orange-500 transition-colors">Novo Material</button>
            </nav>

            {/* CONTENT VIEWER (Estética de Página) [cite: 2026-03-05] */}
            <div className="md:col-span-3 bg-white text-slate-900 rounded-4xl shadow-2xl overflow-hidden flex flex-col h-175">
              <div className="bg-slate-50 border-b p-6 flex justify-between items-center">
                <div className="flex items-center gap-2 text-slate-400 font-bold text-[9px] uppercase tracking-widest">
                  <BookOpen size={14} /> Modo de Leitura
                </div>
                <div className="text-[10px] font-black text-orange-500 uppercase tracking-widest">IA Flash 3.0</div>
              </div> 
              
              <div className="flex-1 overflow-y-auto p-12 scrollbar-thin scrollbar-thumb-slate-200">
                <div className="prose prose-slate max-w-none">
                  <h3 className="text-2xl font-black uppercase italic tracking-tighter mb-8 border-b-4 border-orange-500 w-fit pb-1">
                    {activeTab === 'resumo' && "Resumo Executivo"}
                    {activeTab === 'exercicios' && "Simulador de Exame"}
                    {activeTab === 'mapa' && "Estrutura Cognitiva"}
                  </h3>
                  
                  <div className="text-slate-700 leading-relaxed whitespace-pre-wrap font-medium">
                    {activeTab === 'resumo' && resultado.resumo}
                    {activeTab === 'exercicios' && resultado.exercicios}
                    {activeTab === 'mapa' && (
                      <div className="bg-slate-50 p-6 rounded-2xl border-2 border-dashed border-slate-200 font-mono text-xs">
                        {resultado.mapa}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* RODAPÉ DE PAGINAÇÃO [cite: 2026-03-05] */}
              <div className="bg-slate-50 border-t p-4 text-center text-[9px] font-bold text-slate-400 uppercase tracking-[0.5em]">
                Página 1 de 1 • My Personal Lab
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}