'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { UploadCloud, Sparkles, BrainCircuit, Loader2, CheckCircle2, AlertTriangle, FileText } from 'lucide-react';

export default function LabAI() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [resumo, setResumo] = useState("");
  const [debug, setDebug] = useState<string | null>(null);

  // Inicialização da IA - Usa a chave que configuraste na Vercel
  const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY!);

  // Função para converter o PDF em dados que a IA consegue ler
  async function fileToGenerativePart(file: File) {
    const base64EncodedDataPromise = new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(file);
    });
    return {
      inlineData: { data: await base64EncodedDataPromise as string, mimeType: file.type },
    };
  }

  // --- BOTÃO DE DIAGNÓSTICO (O que tens de clicar primeiro!) ---
  const testarConexao = async () => {
    setLoading(true);
    setDebug("A testar ligação com Google AI...");
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent("Olá! Responde apenas 'LIGAÇÃO OK'.");
      const response = await result.response;
      setDebug(`Sucesso: ${response.text()}`);
    } catch (err: any) {
      setDebug(`FALHA NA API: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const processarMaterial = async () => {
    if (!file) return;
    setLoading(true);
    setResumo("");
    setDebug("A iniciar processamento...");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada. Faz login.");

      // 1. Limpeza de Nome (Resolve o erro 'Invalid Key')
      const cleanName = file.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") 
        .replace(/[^a-zA-Z0-9.]/g, "_");
      
      const filePath = `${user.id}/${Date.now()}_${cleanName}`;

      // 2. Upload para o Storage
      const { error: upError } = await supabase.storage
        .from('lab_privado')
        .upload(filePath, file);

      if (upError) throw new Error(`Erro Storage: ${upError.message}`);

      // 3. Processamento IA (Modelo Estável)
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const filePart = await fileToGenerativePart(file);
      
      const prompt = `Analisa este material escolar e:
      1. Faz um resumo executivo.
      2. Cria 3 perguntas de revisão para o aluno.`;

      const result = await model.generateContent([prompt, filePart]);
      const response = await result.response;
      const text = response.text();
      setResumo(text);
      setDebug("Material processado com sucesso!");

      // 4. Salvar na DB (Garante que a tabela lab_ai está corrigida!)
      await supabase.from('lab_ai').insert({
        aluno_id: user.id,
        titulo: file.name,
        url_original: filePath,
        resumo_ia: text
      });

    } catch (err: any) {
      setDebug(`ERRO: ${err.message}`);
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#020617] p-6 text-white font-sans">
      <div className="max-w-2xl mx-auto space-y-8">
        
        <header className="text-center pt-6">
          <BrainCircuit className="text-orange-500 mx-auto mb-4" size={48} />
          <h1 className="text-4xl font-black uppercase italic tracking-tighter">My Personal Lab</h1>
          <p className="text-slate-500 font-bold text-[10px] uppercase tracking-widest mt-2 italic">Dubai AI Automation Edition</p>
        </header>

        {/* STATUS / DIAGNÓSTICO */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${debug?.includes('Sucesso') ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-orange-500 animate-pulse'}`} />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status: {debug || "Pronto para teste"}</span>
          </div>
          <button 
            onClick={testarConexao}
            className="text-[10px] bg-white/5 hover:bg-orange-500 hover:text-white px-4 py-2 rounded-xl font-black transition-all border border-white/10"
          >
            TESTAR API
          </button>
        </div>

        <section className="bg-slate-900/50 border border-slate-800 p-10 rounded-[3rem] shadow-2xl backdrop-blur-md">
          <div className="relative border-2 border-dashed border-slate-800 rounded-4xl p-12 text-center group hover:border-orange-500/50 transition-all">
            <input 
              type="file" 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
              accept=".pdf" 
              onChange={(e) => setFile(e.target.files?.[0] || null)} 
            />
            <UploadCloud size={60} className="mx-auto mb-4 text-slate-700 group-hover:text-orange-500 transition-colors" />
            <p className="text-lg font-bold">{file ? file.name : "Carrega o teu PDF de estudo"}</p>
          </div>

          <button 
            onClick={processarMaterial}
            disabled={loading || !file}
            className="w-full mt-8 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-800 text-white font-black py-5 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95"
          >
            {loading ? <Loader2 className="animate-spin" /> : <><Sparkles size={20} /> GERAR RESUMO IA</>}
          </button>
        </section>

        {resumo && (
          <section className="bg-slate-900 border border-orange-500/30 p-8 rounded-[2.5rem] animate-in fade-in slide-in-from-bottom-6">
             <div className="flex items-center gap-2 text-orange-500 mb-6 font-black uppercase text-xs tracking-widest">
                <CheckCircle2 size={18} /> Resumo Pronto
             </div>
             <div className="text-slate-300 whitespace-pre-wrap leading-relaxed border-t border-slate-800 pt-6">
               {resumo}
             </div>
          </section>
        )}

      </div>
    </main>
  );
}