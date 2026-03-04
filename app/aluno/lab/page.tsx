'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { 
  UploadCloud, Sparkles, BrainCircuit, Loader2, FileText, 
  ListChecks, Network, ChevronRight, BookOpen, Fingerprint 
} from 'lucide-react';

export default function LabAI() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'resumo' | 'exercicios' | 'mapa'>('resumo');
  const [resultado, setResultado] = useState<{ resumo: string, exercicios: string, mapa: string } | null>(null);
  const [studentData, setStudentData] = useState<{ creditos: number, ano_escolar: number } | null>(null);

  // Integração com a série 3 conforme o teu AI Studio
  const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY!);

  useEffect(() => {
    fetchStudentContext();
  }, []);

  async function fetchStudentContext() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // Ajustado para a tua coluna 'ano_escolar' [cite: 2026-03-05]
      const { data } = await supabase
        .from('alunos')
        .select('creditos_ia, ano_escolar')
        .eq('id', user.id)
        .single();
      
      setStudentData({ 
        creditos: data?.creditos_ia || 0, 
        ano_escolar: data?.ano_escolar || 10 
      });
    }
  }

  const processarMaterial = async () => {
    if (!file || !studentData || studentData.creditos <= 0) return alert("Saldo insuficiente ou ficheiro em falta.");
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
      
      const reader = new FileReader();
      const filePart = await new Promise((resolve) => {
        reader.onloadend = () => resolve({ inlineData: { data: (reader.result as string).split(',')[1], mimeType: file.type } });
        reader.readAsDataURL(file);
      });

      // LÓGICA DE PERSONA ADAPTATIVA [cite: 2026-03-05]
      let personaInstruction = "";
      const ano = studentData.ano_escolar;

      if (ano <= 4) {
        personaInstruction = "Usa um tom de professor primário: simples, lúdico, com analogias fáceis e emojis. Explica como se fosse uma história.";
      } else if (ano <= 9) {
        personaInstruction = "Usa um tom educativo avançado: focado em conceitos-chave, organização de estudo e clareza, sem ser infantil.";
      } else {
        personaInstruction = "Usa linguagem adulta, técnica e rigorosa. Foco total em profundidade académica, termos correntes do secundário e preparação para exames.";
      }

      const prompt = `Age como um especialista em pedagogia. ${personaInstruction}
      Analisa o material PDF e gera 3 blocos separados pela tag ###NEXT_SECTION###.
      
      Bloco 1 (Resumo): Um resumo profundo e estruturado do conteúdo.
      [###NEXT_SECTION###]
      
      Bloco 2 (Exercícios): 5 questões de revisão variadas com soluções justificadas no final.
      [###NEXT_SECTION###]
      
      Bloco 3 (Estrutura): Uma hierarquia lógica de conceitos para visualização mental.
      
      Formatação: Markdown limpo, sem lixo de sistema.`;

      const result = await model.generateContent([prompt, filePart as any]);
      const sections = result.response.text().split('###NEXT_SECTION###');

      setResultado({
        resumo: sections[0]?.trim() || "Conteúdo não processado.",
        exercicios: sections[1]?.trim() || "Exercícios não gerados.",
        mapa: sections[2]?.trim() || "Estrutura não disponível."
      });

      // Atualização de Saldo [cite: 2026-03-05]
      await supabase.from('alunos').update({ creditos_ia: studentData.creditos - 1 }).eq('id', user?.id);
      setStudentData(prev => prev ? { ...prev, creditos: prev.creditos - 1 } : null);

    } catch (err) {
      alert("Erro no processamento. Tenta um PDF mais leve.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#020617] text-slate-300 font-sans selection:bg-orange-500/10">
      <div className="max-w-5xl mx-auto p-8 space-y-10">
        
        {/* HEADER SÉRIO & PROFISSIONAL [cite: 2026-03-05] */}
        <header className="flex justify-between items-center border-b border-slate-800 pb-10">
          <div className="flex items-center gap-4">
            <div className="bg-slate-900 p-3 rounded-2xl border border-slate-800">
              <BrainCircuit size={28} className="text-orange-500" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-[0.2em] uppercase italic text-white">
                Personal <span className="text-orange-500">Lab</span>
              </h1>
              <div className="flex items-center gap-2 text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                <Fingerprint size={10} /> Sistema Adaptado: {studentData?.ano_escolar}º Ano
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Créditos de Análise</p>
            <div className="bg-slate-900 px-5 py-2 rounded-xl border border-slate-800 inline-block shadow-inner">
              <span className="text-white font-black text-xl">{studentData?.creditos}</span>
            </div>
          </div>
        </header>

        {!resultado ? (
          <section className="py-24 max-w-2xl mx-auto text-center animate-in fade-in duration-1000">
            <div className="bg-slate-900/40 border border-slate-800 rounded-[3rem] p-16 space-y-8 relative group">
              <div className="w-20 h-20 bg-slate-950 rounded-3xl flex items-center justify-center mx-auto border border-slate-800 shadow-2xl">
                <UploadCloud size={32} className="text-slate-600" />
              </div>
              <input 
                type="file" 
                className="absolute inset-0 opacity-0 cursor-pointer" 
                accept=".pdf" 
                onChange={(e) => setFile(e.target.files?.[0] || null)} 
              />
              <div>
                <h2 className="text-xl font-bold text-white mb-2">{file ? file.name : "Submeter Documento PDF"}</h2>
                <p className="text-slate-600 text-[10px] font-bold uppercase tracking-[0.3em]">Limite Técnico: 10MB por arquivo</p>
              </div>
            </div>

            <button 
              onClick={processarMaterial} 
              disabled={loading || !file || (studentData?.creditos ?? 0) <= 0} 
              className="mt-12 w-full bg-orange-600 hover:bg-orange-500 disabled:bg-slate-900 disabled:text-slate-700 text-white py-6 rounded-2xl font-black uppercase tracking-widest transition-all active:scale-95 shadow-xl shadow-orange-900/10"
            >
              {loading ? <Loader2 className="animate-spin mx-auto" /> : "Iniciar Processamento de Conteúdo"}
            </button>
          </section>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 animate-in slide-in-from-bottom-12 duration-700">
            {/* SIDEBAR DE NAVEGAÇÃO [cite: 2026-03-05] */}
            <nav className="space-y-2">
              <button 
                onClick={() => setActiveTab('resumo')} 
                className={`w-full flex items-center justify-between p-5 rounded-2xl transition-all font-black uppercase text-[9px] tracking-[0.2em] border ${activeTab === 'resumo' ? 'bg-orange-600 border-orange-500 text-white shadow-xl shadow-orange-900/20' : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-white'}`}
              >
                <div className="flex items-center gap-3"><FileText size={18} /> Resumo</div>
              </button>
              <button 
                onClick={() => setActiveTab('exercicios')} 
                className={`w-full flex items-center justify-between p-5 rounded-2xl transition-all font-black uppercase text-[9px] tracking-[0.2em] border ${activeTab === 'exercicios' ? 'bg-orange-600 border-orange-500 text-white shadow-xl shadow-orange-900/20' : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-white'}`}
              >
                <div className="flex items-center gap-3"><ListChecks size={18} /> Exercícios</div>
              </button>
              <button 
                onClick={() => setActiveTab('mapa')} 
                className={`w-full flex items-center justify-between p-5 rounded-2xl transition-all font-black uppercase text-[9px] tracking-[0.2em] border ${activeTab === 'mapa' ? 'bg-orange-600 border-orange-500 text-white shadow-xl shadow-orange-900/20' : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-white'}`}
              >
                <div className="flex items-center gap-3"><Network size={18} /> Estrutura</div>
              </button>
              
              <button onClick={() => setResultado(null)} className="w-full mt-12 p-4 text-slate-600 text-[8px] font-black uppercase tracking-[0.4em] hover:text-orange-500 transition-colors border-t border-slate-800 pt-8">Nova Submissão</button>
            </nav>

            {/* VIEWER DE ALTA DEFINIÇÃO [cite: 2026-03-05] */}
            <div className="lg:col-span-3 bg-white text-slate-900 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col h-187.5 border border-slate-200">
              <div className="bg-slate-50 border-b border-slate-200 p-6 flex justify-between items-center">
                <div className="flex items-center gap-2 text-slate-400 font-bold text-[9px] uppercase tracking-[0.3em]">
                  <BookOpen size={14} /> Repositório Digital • Versão {studentData?.ano_escolar}º Ano
                </div>
                <div className="text-[9px] font-black text-orange-500 uppercase tracking-widest border border-orange-200 px-3 py-1 rounded-full bg-orange-50">Ativo</div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-12 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent">
                <article className="prose prose-slate max-w-none">
                  <div className="text-slate-800 leading-relaxed whitespace-pre-wrap font-medium text-lg">
                    {activeTab === 'resumo' && resultado.resumo}
                    {activeTab === 'exercicios' && resultado.exercicios}
                    {activeTab === 'mapa' && (
                      <div className="bg-slate-100 p-10 rounded-4xl border-2 border-slate-200 text-slate-800 font-mono text-xs shadow-inner">
                        {resultado.mapa}
                      </div>
                    )}
                  </div>
                </article>
              </div>

              <div className="bg-slate-50 border-t border-slate-200 p-6 text-center text-[9px] font-bold text-slate-400 uppercase tracking-[0.5em]">
                Gerado via My Personal Lab • {new Date().toLocaleDateString('pt-PT')}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}