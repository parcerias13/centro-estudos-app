'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { UploadCloud, Sparkles, BrainCircuit, Loader2, CheckCircle2, FileText, LayoutDashboard, ListChecks, Network } from 'lucide-react';

export default function LabAI() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'resumo' | 'exercicios' | 'mapa'>('resumo');
  const [resultado, setResultado] = useState<{ resumo: string, exercicios: string, mapa: string } | null>(null);
  const [creditos, setCreditos] = useState<number>(0);
  const [debug, setDebug] = useState<string | null>(null);

  // Inicialização com Gemini Flash (Geração 3)
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

  // --- BOTÃO DE DIAGNÓSTICO (Atualizado para Gemini 3) ---
  const testarConexao = async () => {
    setLoading(true);
    setDebug("A testar ligação...");
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
      const result = await model.generateContent("Olá! Responde apenas 'LIGAÇÃO OK'.");
      const response = await result.response;
      setDebug(`Sucesso: ${response.text()}`);
    } catch (err: any) {
      setDebug(`FALHA NA API: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  async function fileToGenerativePart(file: File) {
    const base64EncodedDataPromise = new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(file);
    });
    return { inlineData: { data: await base64EncodedDataPromise as string, mimeType: file.type } };
  }

  const processarMaterial = async () => {
    if (!file || creditos <= 0) return alert("Sem créditos ou ficheiro selecionado!");
    
    // Sustentabilidade: Limite de 10MB
    if (file.size > 10 * 1024 * 1024) return alert("Ficheiro muito grande! Máximo 10MB para manter a performance.");

    setLoading(true);
    setDebug("A processar material...");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada.");

      // 1. Sanitização de Nome (Resolve o erro 'Invalid Key')
      const cleanName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9.]/g, "_");
      const filePath = `${user.id}/${Date.now()}_${cleanName}`;

      // 2. Upload para Storage
      const { error: upError } = await supabase.storage.from('lab_privado').upload(filePath, file);
      if (upError) throw upError;

      // 3. IA Multimodal (Prompt All-in-One para economia de tokens)
      const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
      const filePart = await fileToGenerativePart(file);
      
      const prompt = `Age como um tutor de elite. Analisa este material e gera três secções separadas pela tag [DIVIDER]:
      1. RESUMO: Um resumo executivo por pontos.
      [DIVIDER]
      2. EXERCICIOS: 5 perguntas de exame (escolha múltipla e desenvolvimento) com soluções.
      [DIVIDER]
      3. MAPA MENTAL: Uma estrutura hierárquica dos conceitos.`;

      const result = await model.generateContent([prompt, filePart]);
      const sections = result.response.text().split('[DIVIDER]');

      const dataFinal = {
        resumo: sections[0]?.trim() || "Erro no resumo",
        exercicios: sections[1]?.trim() || "Erro nos exercícios",
        mapa: sections[2]?.trim() || "Erro no mapa"
      };

      setResultado(dataFinal);

      // 4. Gestão Financeira: Descontar crédito
      await supabase.from('alunos').update({ creditos_ia: creditos - 1 }).eq('id', user.id);
      
      // 5. Guardar Resumo (Usando JSON para facilitar o histórico futuro)
      await supabase.from('lab_ai').insert({
        aluno_id: user.id,
        titulo: file.name,
        url_original: filePath,
        resumo_ia: JSON.stringify(dataFinal)
      });
      
      setCreditos(prev => prev - 1);
      setDebug("Sucesso!");

    } catch (err: any) {
      setDebug(`Erro: ${err.message}`);
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#020617] p-6 text-white font-sans">
      <div className="max-w-3xl mx-auto space-y-8">
        
        <header className="flex justify-between items-center bg-slate-900/50 p-6 rounded-3xl border border-slate-800 shadow-xl">
          <div>
            <h1 className="text-3xl font-black italic uppercase tracking-tighter leading-none">
              My Personal <span className="text-orange-500">Lab</span>
            </h1>
            <div className="flex items-center gap-2 mt-2">
               <span className="text-[10px] bg-orange-500/10 text-orange-500 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest border border-orange-500/20">
                 {creditos} Créditos Restantes
               </span>
            </div>
          </div>
          <BrainCircuit className="text-orange-500" size={40} />
        </header>

        {/* DIAGNÓSTICO */}
        <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-2xl flex items-center justify-between">
          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 ml-2">Status: {debug || "Sistema Pronto"}</span>
          <button onClick={testarConexao} className="text-[9px] bg-white/5 hover:bg-orange-500 px-3 py-1.5 rounded-lg font-black transition-all border border-white/5 uppercase">Testar API</button>
        </div>

        {!resultado ? (
          <section className="bg-slate-900/30 border border-slate-800 p-10 rounded-[3rem] shadow-2xl backdrop-blur-sm">
            <div className="relative border-2 border-dashed border-slate-800 rounded-[2rem] p-12 text-center group hover:border-orange-500/30 transition-all">
              <input type="file" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <UploadCloud size={60} className="mx-auto mb-4 text-slate-700 group-hover:text-orange-500 transition-colors" />
              <p className="text-lg font-bold">{file ? file.name : "Solta o teu material aqui"}</p>
              <p className="text-[10px] text-slate-500 mt-2 uppercase tracking-widest italic">Apenas PDFs até 10MB</p>
            </div>

            <button 
              onClick={processarMaterial}
              disabled={loading || !file || creditos <= 0}
              className="w-full mt-8 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-800 text-white font-black py-5 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-orange-900/20"
            >
              {loading ? <Loader2 className="animate-spin" /> : <><Sparkles size={20} /> ATIVAR INTELIGÊNCIA</>}
            </button>
          </section>
        ) : (
          <section className="space-y-4 animate-in fade-in duration-700">
            {/* TABS DE NAVEGAÇÃO */}
            <div className="flex gap-2 bg-slate-900 p-2 rounded-2xl border border-slate-800 sticky top-4 z-20">
              <button onClick={() => setActiveTab('resumo')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'resumo' ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/40' : 'text-slate-500 hover:bg-slate-800'}`}>
                <FileText size={16} /> Resumo
              </button>
              <button onClick={() => setActiveTab('exercicios')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'exercicios' ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/40' : 'text-slate-500 hover:bg-slate-800'}`}>
                <ListChecks size={16} /> Exercícios
              </button>
              <button onClick={() => setActiveTab('mapa')} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${activeTab === 'mapa' ? 'bg-orange-600 text-white shadow-lg shadow-orange-900/40' : 'text-slate-500 hover:bg-slate-800'}`}>
                <Network size={16} /> Mapa Mental
              </button>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] min-h-[500px] shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 blur-3xl rounded-full -mr-16 -mt-16"></div>
               <div className="text-slate-300 whitespace-pre-wrap leading-relaxed text-sm font-medium">
                  {activeTab === 'resumo' && resultado.resumo}
                  {activeTab === 'exercicios' && resultado.exercicios}
                  {activeTab === 'mapa' && resultado.mapa}
               </div>
            </div>
            
            <button onClick={() => setResultado(null)} className="w-full py-4 text-slate-500 text-[10px] font-black uppercase tracking-[0.3em] hover:text-white transition-colors border border-dashed border-slate-800 rounded-2xl">
               Analisar Novo Conteúdo
            </button>
          </section>
        )}
      </div>
    </main>
  );
}