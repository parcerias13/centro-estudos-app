'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { UploadCloud, Sparkles, BrainCircuit, Loader2, FileText } from 'lucide-react';

export default function LabAI() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [resumo, setResumo] = useState("");

  // Inicializa a IA com a chave das variáveis de ambiente
  const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY!);

  // Função auxiliar para converter o ficheiro para o formato da Google
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

  const processarMaterial = async () => {
    if (!file) return;
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Login necessário");

      // 1. Upload Seguro para o Bucket Privado
      const filePath = `${user.id}/${Date.now()}_${file.name}`;
      const { error: upError } = await supabase.storage.from('lab_privado').upload(filePath, file);
      if (upError) throw upError;

      // 2. Preparar os dados para a IA (O "Pulo do Gato")
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Nome exato do modelo
      const filePart = await fileToGenerativePart(file);
      
      const prompt = `Analisa este material de estudo e cria um resumo estruturado por pontos chave. No final, gera 3 perguntas de revisão para testar o conhecimento do aluno.`;

      // 3. Chamada Multimodal (Texto + Ficheiro)
      const result = await model.generateContent([prompt, filePart]);
      const response = await result.response;
      const text = response.text();
      setResumo(text);

      // 4. Guardar na Tabela lab_ai para consulta futura
      await supabase.from('lab_ai').insert({
        aluno_id: user.id,
        titulo: file.name,
        url_original: filePath,
        resumo_ia: text
      });

    } catch (err: any) {
      console.error(err);
      alert("Erro no Lab: " + (err.message || "Falha ao processar IA"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#020617] p-8 text-white">
      <div className="max-w-2xl mx-auto space-y-8">
        <header className="text-center">
          <BrainCircuit className="mx-auto text-orange-500 mb-4" size={48} />
          <h1 className="text-4xl font-black uppercase italic tracking-tighter">My Personal Lab</h1>
          <p className="text-slate-500 font-bold text-xs uppercase tracking-[0.2em]">Tecnologia de Estudo Dubai</p>
        </header>

        <div className="bg-slate-900 border border-slate-800 p-10 rounded-[3rem] shadow-2xl text-center">
          <label className="cursor-pointer group">
            <UploadCloud size={64} className="mx-auto mb-4 text-slate-700 group-hover:text-orange-500 transition-colors" />
            <p className="text-lg font-bold">{file ? file.name : "Carregar Material (.pdf)"}</p>
            <input type="file" className="hidden" accept=".pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>

          <button 
            onClick={processarMaterial}
            disabled={loading || !file}
            className="w-full mt-8 bg-orange-600 hover:bg-orange-500 disabled:opacity-30 text-white font-black py-5 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-[0_0_20px_rgba(234,88,12,0.3)]"
          >
            {loading ? <Loader2 className="animate-spin" /> : <><Sparkles size={20} /> ATIVAR INTELIGÊNCIA</>}
          </button>
        </div>

        {resumo && (
          <div className="bg-slate-900 border border-orange-500/30 p-8 rounded-[2.5rem] animate-in fade-in slide-in-from-bottom-4 shadow-2xl">
             <h2 className="text-orange-500 font-black text-xs uppercase mb-4 tracking-widest flex items-center gap-2">
               <FileText size={14} /> Relatório de Estudo IA
             </h2>
             <div className="text-slate-300 whitespace-pre-wrap leading-relaxed prose prose-invert max-w-none">
               {resumo}
             </div>
          </div>
        )}
      </div>
    </main>
  );
}