'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { UploadCloud, Sparkles, BrainCircuit, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function LabAI() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [resumo, setResumo] = useState("");
  const [debug, setDebug] = useState<string | null>(null);

  // Inicialização Robusta
  const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY!);

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

  // TESTE DE SAÚDE DA IA (Apenas Texto)
  const testarConexao = async () => {
    setLoading(true);
    setDebug("A testar ligação com Google AI...");
    try {
      // Forçamos o modelo estável v1
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent("Olá! Se estás a ler isto, a ligação está ativa. Responde apenas 'OK'.");
      setDebug(`Sucesso: ${result.response.text()}`);
    } catch (err: any) {
      setDebug(`FALHA NA LIGAÇÃO: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const processarMaterial = async () => {
    if (!file) return;
    setLoading(true);
    setResumo("");
    setDebug("A iniciar processamento multimodal...");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada.");

      // 1. Super Sanitização (Prevenção de Erros de Key)
      const cleanName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9.]/g, "_");
      const filePath = `${user.id}/${Date.now()}_${cleanName}`;

      // 2. Upload para Storage
      const { error: upError } = await supabase.storage.from('lab_privado').upload(filePath, file);
      if (upError) throw new Error(`Storage: ${upError.message}`);

      // 3. IA com Parâmetros de Segurança
      // Tentamos o modelo gemini-1.5-flash (padrão estável)
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const filePart = await fileToGenerativePart(file);
      
      const result = await model.generateContent([
        "Resume este material escolar por pontos e gera 3 perguntas de estudo.",
        filePart
      ]);

      const text = result.response.text();
      setResumo(text);
      setDebug("Processamento concluído com sucesso.");

      // 4. Salvar na BD
      await supabase.from('lab_ai').insert({
        aluno_id: user.id,
        titulo: file.name,
        url_original: filePath,
        resumo_ia: text
      });

    } catch (err: any) {
      console.error(err);
      setDebug(`ERRO CRÍTICO: ${err.message}`);
      alert(`Falha no Lab: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#020617] p-6 text-white font-sans">
      <div className="max-w-2xl mx-auto space-y-6">
        
        <header className="text-center pt-6">
          <BrainCircuit className="text-orange-500 mx-auto mb-4" size={40} />
          <h1 className="text-4xl font-black uppercase italic tracking-tighter">My Personal Lab</h1>
        </header>

        {/* PAINEL DE DIAGNÓSTICO */}
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${debug?.includes('Sucesso') ? 'bg-green-500' : 'bg-orange-500 animate-pulse'}`} />
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Status: {debug || "A aguardar teste"}</span>
          </div>
          <button 
            onClick={testarConexao}
            className="text-[10px] bg-white/5 hover:bg-white/10 px-3 py-1 rounded-lg transition-all"
          >
            TESTAR API
          </button>
        </div>

        <section className="bg-slate-900/50 border border-slate-800 p-8 rounded-[3rem] shadow-2xl">
          <div className="relative border-2 border-dashed border-slate-800 rounded-4xl p-12 text-center group">
            <input type="file" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <UploadCloud size={50} className="mx-auto mb-4 text-slate-600 group-hover:text-orange-500" />
            <p className="font-bold">{file ? file.name : "Solta o PDF aqui"}</p>
          </div>

          <button 
            onClick={processarMaterial}
            disabled={loading || !file}
            className="w-full mt-8 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-800 py-5 rounded-2xl font-black flex items-center justify-center gap-3 transition-all"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <><Sparkles size={20} /> ATIVAR IA</>}
          </button>
        </section>

        {resumo && (
          <section className="bg-slate-900 border border-orange-500/30 p-8 rounded-[2.5rem] animate-in fade-in slide-in-from-bottom-6">
             <div className="text-slate-300 whitespace-pre-wrap leading-relaxed text-sm">
               {resumo}
             </div>
          </section>
        )}
      </div>
    </main>
  );
}