'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { UploadCloud, Sparkles, BrainCircuit, Loader2, FileText, CheckCircle2 } from 'lucide-react';

export default function LabAI() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [resumo, setResumo] = useState("");

  // Inicializa a IA com a chave de ambiente (Garante que está na Vercel!)
  const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GEMINI_API_KEY!);

  // Converte o ficheiro para Base64 para a IA ler o conteúdo real
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
    setResumo("");

    try {
      // 1. Validar utilizador para segurança RLS [cite: 2025-12-04]
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada. Faz login novamente.");

      // 2. SUPER SANITIZAÇÃO (Dubai Style): Remove acentos, espaços e "ª"
      const cleanName = file.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") 
        .replace(/[^a-zA-Z0-9.]/g, "_");
      
      const filePath = `${user.id}/${Date.now()}_${cleanName}`;

      // 3. Upload para o Bucket Privado [cite: 2025-12-04]
      const { error: upError } = await supabase.storage
        .from('lab_privado')
        .upload(filePath, file);

      if (upError) throw new Error(`Erro no Storage: ${upError.message}`);

      // 4. Ativar o Cérebro IA (Modelo estável para evitar 404)
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const filePart = await fileToGenerativePart(file);
      
      const prompt = `Age como um tutor académico de elite. Analisa este material e:
      1. Cria um resumo executivo por pontos.
      2. Identifica os 3 conceitos fundamentais.
      3. Gera 3 perguntas de revisão de nível difícil para teste.`;

      const result = await model.generateContent([prompt, filePart]);
      const response = await result.response;
      const text = response.text();
      setResumo(text);

      // 5. Guardar na tabela lab_ai (Compatível com BIGINT)
      await supabase.from('lab_ai').insert({
        aluno_id: user.id,
        titulo: file.name,
        url_original: filePath,
        resumo_ia: text
      });

    } catch (err: any) {
      console.error("Erro no Lab:", err);
      alert(err.message || "Erro desconhecido ao processar IA.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#020617] p-6 text-white font-sans">
      <div className="max-w-2xl mx-auto space-y-10">
        
        <header className="text-center pt-10">
          <div className="inline-block p-4 bg-orange-500/10 rounded-3xl border border-orange-500/20 mb-6">
            <BrainCircuit className="text-orange-500" size={40} />
          </div>
          <h1 className="text-4xl font-black uppercase italic tracking-tighter leading-none">
            My Personal <span className="text-orange-500">Lab</span>
          </h1>
          <p className="text-slate-500 font-bold text-[10px] uppercase tracking-[0.3em] mt-2">
            Inteligência Artificial de Alta Performance
          </p>
        </header>

        <section className="bg-slate-900/50 border border-slate-800 p-8 rounded-[3rem] shadow-2xl backdrop-blur-sm">
          <div className="relative border-2 border-dashed border-slate-800 rounded-4xl p-12 text-center hover:border-orange-500/40 transition-all group">
            <input 
              type="file" 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
              accept=".pdf" 
              onChange={(e) => setFile(e.target.files?.[0] || null)} 
            />
            <UploadCloud size={50} className="mx-auto mb-4 text-slate-600 group-hover:text-orange-500 transition-colors" />
            <p className="text-lg font-bold text-slate-200">
              {file ? file.name : "Solta o teu material aqui"}
            </p>
            <p className="text-slate-500 text-xs mt-2 italic">Apenas ficheiros PDF escolares</p>
          </div>

          <button 
            onClick={processarMaterial}
            disabled={loading || !file}
            className="w-full mt-8 bg-orange-600 hover:bg-orange-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-black py-5 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-orange-900/20"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                <span>A PROCESSAR CONHECIMENTO...</span>
              </>
            ) : (
              <>
                <Sparkles size={20} />
                <span>ATIVAR INTELIGÊNCIA</span>
              </>
            )}
          </button>
        </section>

        {resumo && (
          <section className="bg-slate-900 border border-orange-500/30 p-8 rounded-[2.5rem] animate-in fade-in slide-in-from-bottom-6 duration-500 shadow-2xl">
             <div className="flex items-center justify-between mb-6">
                <h2 className="text-orange-500 font-black text-xs uppercase tracking-widest flex items-center gap-2">
                  <CheckCircle2 size={16} /> Relatório Gerado
                </h2>
                <span className="text-[10px] bg-orange-500/10 text-orange-500 px-3 py-1 rounded-full font-bold">AI FLASH 1.5</span>
             </div>
             <div className="text-slate-300 whitespace-pre-wrap leading-relaxed max-w-none text-sm border-t border-slate-800 pt-6">
               {resumo}
             </div>
          </section>
        )}

      </div>
    </main>
  );
}