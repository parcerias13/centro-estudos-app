'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { UploadCloud, Sparkles, BrainCircuit, Loader2, FileText, ListChecks, Network, ChevronRight, Rocket, Star, Trophy } from 'lucide-react';

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
    if (!file || creditos <= 0) return alert("Ops! Precisas de créditos ou de escolher um ficheiro.");
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
      
      const reader = new FileReader();
      const filePart = await new Promise((resolve) => {
        reader.onloadend = () => resolve({ inlineData: { data: (reader.result as string).split(',')[1], mimeType: file.type } });
        reader.readAsDataURL(file);
      });
      
      // PROMPT EDUCATIVO PARA CRIANÇAS
      const prompt = `Age como um Professor super divertido e paciente que ensina crianças. 
      Analisa o PDF e cria um guia de estudo incrível. 
      Usa obrigatoriamente a tag ###NEXT_SECTION### para separar os blocos.
      
      Bloco 1 (Resumo): Usa o título "🌟 O QUE VAIS APRENDER NESTA AVENTURA?". Explica os conceitos como se estivesses a contar uma história. Usa analogias simples. Divide em tópicos com emojis.
      [###NEXT_SECTION###]
      
      Bloco 2 (Exercícios): Usa o título "🚀 DESAFIO DOS SUPER-HERÓIS". Cria 5 perguntas divertidas. No fim, coloca uma secção chamada "🔑 CHAVE MÁGICA (Soluções)" para eles conferirem.
      [###NEXT_SECTION###]
      
      Bloco 3 (Mapa): Usa o título "🗺️ O TEU MAPA DO TESOURO". Cria uma lista hierárquica bem espaçada para ser fácil de ler.
      
      IMPORTANTE: Usa uma linguagem simples, carinhosa e motivadora. Explica palavras difíceis se aparecerem.`;

      const result = await model.generateContent([prompt, filePart as any]);
      const sections = result.response.text().split('###NEXT_SECTION###');

      setResultado({
        resumo: sections[0]?.trim() || "Ainda estamos a preparar a tua aventura...",
        exercicios: sections[1]?.trim() || "Os desafios estão a caminho!",
        mapa: sections[2]?.trim() || "O teu mapa está a ser desenhado..."
      });

      await supabase.from('alunos').update({ creditos_ia: creditos - 1 }).eq('id', user?.id);
      setCreditos(prev => prev - 1);
    } catch (err) {
      alert("Houve um pequeno problema no laboratório. Tenta de novo!");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#020617] text-slate-200 font-sans">
      <div className="max-w-5xl mx-auto p-6 space-y-8">
        
        <header className="flex justify-between items-center border-b border-slate-800 pb-8 pt-4">
          <div className="flex items-center gap-4">
            <div className="bg-orange-500 p-3 rounded-2xl shadow-lg shadow-orange-500/20">
              <Rocket size={28} className="text-white animate-bounce" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tighter italic uppercase">My <span className="text-orange-500">Lab</span></h1>
              <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">A tua zona de estudo inteligente</p>
            </div>
          </div>
          <div className="bg-orange-500/10 border border-orange-500/20 px-6 py-3 rounded-3xl flex items-center gap-3">
            <Star className="text-orange-500" size={18} />
            <span className="text-orange-500 font-black text-xl">{creditos} <span className="text-[10px] uppercase">Energias</span></span>
          </div>
        </header>

        {!resultado ? (
          <section className="py-20 text-center animate-in fade-in duration-500">
            <div className="max-w-md mx-auto bg-slate-900/50 border-2 border-dashed border-slate-800 rounded-[3rem] p-16 space-y-6 hover:border-orange-500/40 transition-all group relative">
               <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
               <UploadCloud size={64} className="mx-auto text-slate-700 group-hover:text-orange-500 transition-colors" />
               <h2 className="text-xl font-bold">{file ? file.name : "Escolhe o teu PDF aqui"}</h2>
               <p className="text-slate-500 text-xs font-medium uppercase tracking-widest">PDF • ATÉ 10MB</p>
            </div>
            <button onClick={processarMaterial} disabled={loading || !file || creditos <= 0} className="mt-10 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-800 text-white px-16 py-6 rounded-3xl font-black uppercase italic tracking-tighter flex items-center gap-3 mx-auto transition-all active:scale-95 shadow-2xl shadow-orange-900/30 text-lg">
              {loading ? <Loader2 className="animate-spin" /> : <><Sparkles size={24} /> Começar Aventura</>}
            </button>
          </section>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 animate-in slide-in-from-bottom-10 duration-700">
            {/* MENU DE NAVEGAÇÃO DIVERTIDO */}
            <nav className="space-y-3">
              <button onClick={() => setActiveTab('resumo')} className={`w-full flex items-center justify-between p-5 rounded-3xl transition-all font-black uppercase text-[10px] tracking-widest border-2 ${activeTab === 'resumo' ? 'bg-orange-600 border-orange-500 text-white shadow-xl shadow-orange-900/30' : 'bg-slate-900 border-slate-800 text-slate-500 hover:bg-slate-800'}`}>
                <div className="flex items-center gap-3"><FileText size={20} /> O que aprendi</div>
                <ChevronRight size={14} />
              </button>
              <button onClick={() => setActiveTab('exercicios')} className={`w-full flex items-center justify-between p-5 rounded-3xl transition-all font-black uppercase text-[10px] tracking-widest border-2 ${activeTab === 'exercicios' ? 'bg-orange-600 border-orange-500 text-white shadow-xl shadow-orange-900/30' : 'bg-slate-900 border-slate-800 text-slate-500 hover:bg-slate-800'}`}>
                <div className="flex items-center gap-3"><Trophy size={20} /> Desafios</div>
                <ChevronRight size={14} />
              </button>
              <button onClick={() => setActiveTab('mapa')} className={`w-full flex items-center justify-between p-5 rounded-3xl transition-all font-black uppercase text-[10px] tracking-widest border-2 ${activeTab === 'mapa' ? 'bg-orange-600 border-orange-500 text-white shadow-xl shadow-orange-900/30' : 'bg-slate-900 border-slate-800 text-slate-500 hover:bg-slate-800'}`}>
                <div className="flex items-center gap-3"><Network size={20} /> Meu Mapa</div>
                <ChevronRight size={14} />
              </button>
              <button onClick={() => setResultado(null)} className="w-full mt-10 p-4 text-slate-600 text-[9px] font-black uppercase tracking-[0.4em] hover:text-white transition-colors">Novo Material</button>
            </nav>

            {/* LIVRO DE ESTUDO (Estética de Alta Resolução) */}
            <div className="lg:col-span-3 bg-white text-slate-800 rounded-[3rem] shadow-2xl overflow-hidden flex flex-col h-187.5 border-8 border-slate-900">
              <div className="bg-slate-50 border-b p-8 flex justify-between items-center">
                <div className="flex items-center gap-3 text-slate-400 font-black text-[10px] uppercase tracking-widest">
                  <Star size={16} className="text-orange-500" /> Material do Aluno
                </div>
                <span className="text-[10px] bg-slate-200 px-3 py-1 rounded-full font-bold text-slate-500">KIDS MODE ON</span>
              </div>
              
              <div className="flex-1 overflow-y-auto p-12 scrollbar-thin scrollbar-thumb-orange-200 scrollbar-track-transparent">
                <div className="prose prose-orange max-w-none">
                  <div className="text-slate-800 leading-relaxed whitespace-pre-wrap font-medium text-lg">
                    {activeTab === 'resumo' && resultado.resumo}
                    {activeTab === 'exercicios' && resultado.exercicios}
                    {activeTab === 'mapa' && (
                      <div className="bg-orange-50 p-8 rounded-4xl border-4 border-dashed border-orange-100 text-orange-900">
                        {resultado.mapa}
                      </div>
                    )}
                  </div>
                </div>
              </div> 

              <div className="bg-slate-50 border-t p-6 text-center text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">
                Bons estudos! Estás a ir muito bem! ✨
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}