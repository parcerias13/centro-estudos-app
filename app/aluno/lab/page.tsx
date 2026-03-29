'use client';

import { useState, useRef, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Send, Aperture, User, Loader2, Paperclip, X, FileText } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

type MessagePart = { text: string };
type ChatMessage = { role: 'user' | 'model'; parts: MessagePart[] };

type UploadState = {
  file?: File;
  base64?: string;
  mimeType: string;
  url: string;
  isPdf: boolean;
};

const formatMath = (text: string) => {
  if (!text) return '';
  return text.replace(/\\\[/g, () => '$$').replace(/\\\]/g, () => '$$').replace(/\\\(/g, () => '$').replace(/\\\)/g, () => '$');
};

export default function LabAI() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [percentUso, setPercentUso] = useState(0); 
  const [alunoData, setAlunoData] = useState({ id: '', nome: 'Aluno', ano_escolar: 10 });
  const [fileToUpload, setFileToUpload] = useState<UploadState | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const fetchAluno = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data } = await supabase.from('alunos').select('nome, ano_escolar, creditos_usados').eq('id', session.user.id).single();
        if (data) {
          setAlunoData({ id: session.user.id, nome: data.nome, ano_escolar: data.ano_escolar });
          const limite = 0.40;
          const usados = Number(data.creditos_usados) || 0;
          setPercentUso(Math.min((usados / limite) * 100, 100));
        }
      }
    };
    fetchAluno();
  }, [supabase]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, fileToUpload]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === 'application/pdf') {
      if (file.size > 15 * 1024 * 1024) { 
        alert('O PDF é muito grande. O limite é de 15MB.');
        return;
      }
      setFileToUpload({ file, mimeType: file.type, url: 'PDF Selecionado', isPdf: true });
      e.target.value = '';
      return;
    }

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const MAX_DIMENSION = 1200;
          let width = img.width;
          let height = img.height;
          if (width > height && width > MAX_DIMENSION) { height *= MAX_DIMENSION / width; width = MAX_DIMENSION; } 
          else if (height > MAX_DIMENSION) { width *= MAX_DIMENSION / height; height = MAX_DIMENSION; }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.8);
            const base64String = compressedDataUrl.split(',')[1];
            setFileToUpload({ base64: base64String, mimeType: 'image/jpeg', url: URL.createObjectURL(file), isPdf: false });
          }
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    } else {
      alert('Formato não suportado. Por favor anexa uma imagem ou um PDF.');
    }
    e.target.value = '';
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !fileToUpload) || loading || percentUso >= 100) return;

    const currentInput = input;
    const currentFile = fileToUpload;
    const userText = currentInput || (currentFile?.isPdf ? "A anexar documento PDF..." : "A analisar imagem...");
    
    setMessages(prev => [...prev, { role: 'user', parts: [{ text: userText }] }]);
    setInput('');
    setFileToUpload(null);
    setLoading(true);

    let finalFileUrl = null;

    try {
      if (currentFile?.isPdf && currentFile.file) {
        const safeName = currentFile.file.name.replace(/[^a-zA-Z0-9.]/g, '_');
        const filePath = `${Date.now()}_${safeName}`;
        const { error: uploadError } = await supabase.storage.from('lab_pdfs').upload(filePath, currentFile.file);
        if (uploadError) throw new Error("Erro a gravar PDF: " + uploadError.message);
        const { data: publicData } = supabase.storage.from('lab_pdfs').getPublicUrl(filePath);
        finalFileUrl = publicData.publicUrl;
      }

      const response = await fetch('/api/lab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: currentInput,
          history: messages,
          anoEscolar: alunoData.ano_escolar,
          nomeAluno: alunoData.nome,
          fileBase64: currentFile?.base64,
          fileUrl: finalFileUrl,
          mimeType: currentFile?.mimeType,
          alunoId: alunoData.id 
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro na comunicação');
      }

      // --- INÍCIO DA LÓGICA DE STREAMING ---
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = "";

      // Adicionamos a mensagem vazia do modelo para ir preenchendo
      setMessages(prev => [...prev, { role: 'model', parts: [{ text: '' }] }]);
      setLoading(false); // Tiramos o loader assim que o primeiro chunk chega

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          accumulatedText += chunk;

          setMessages(prev => {
            const newMsgs = [...prev];
            newMsgs[newMsgs.length - 1].parts[0].text = accumulatedText;
            return newMsgs;
          });
        }
      }
      // --- FIM DA LÓGICA DE STREAMING ---

      // Nota: Como o custo é atualizado no banco de dados via RPC no final do stream do lado do servidor,
      // podes querer fazer um fetch rápido aqui para atualizar o percentUso na UI,
      // ou apenas estimar. Para manter simples e fiel ao teu pedido de "não mudar nada":
      const { data: updateData } = await supabase.from('alunos').select('creditos_usados').eq('id', alunoData.id).single();
      if (updateData) {
        setPercentUso(Math.min((Number(updateData.creditos_usados) / 0.40) * 100, 100));
      }

    } catch (error: any) {
      alert("Falha do Sistema: " + error.message);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0f172a] text-slate-200 flex flex-col font-sans">
      <header className="bg-slate-950 border-b border-slate-800 p-4 md:px-8 flex items-center justify-between shadow-xl z-10 sticky top-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-900 border border-slate-700 rounded-lg flex items-center justify-center shadow-inner">
            <Aperture size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-white">Lab AI</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Ambiente de Estudo Analítico</p>
          </div>
        </div>

        <div className="flex flex-col items-end min-w-30">
          <div className="flex justify-between w-full mb-1">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Capacidade Restante</span>
            <span className={`text-[10px] font-black ${percentUso > 90 ? 'text-red-500' : 'text-slate-300'}`}>
              {100 - Math.round(percentUso)}% 
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
            <div 
              className={`h-full transition-all duration-700 ${percentUso > 90 ? 'bg-red-500' : percentUso > 75 ? 'bg-amber-500' : 'bg-blue-500'}`}
              style={{ width: `${percentUso}%` }}
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-40 text-center max-w-md mx-auto mt-20">
            <Aperture size={56} className="text-slate-500 mb-6" />
            <h2 className="text-xl font-bold mb-2 tracking-tight">Análise e Resolução</h2>
            <p className="text-xs text-slate-400 font-medium leading-relaxed">
              Insere o tema de estudo ou anexa o teu manual/ficha em formato PDF ou Imagem.
            </p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isAI = msg.role === 'model';
            return (
              <div key={index} className={`flex gap-4 max-w-4xl mx-auto ${isAI ? 'flex-row' : 'flex-row-reverse'}`}>
                <div className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center mt-1 shadow-sm ${isAI ? 'bg-slate-800 border border-slate-700 text-white' : 'bg-blue-600 text-white'}`}>
                  {isAI ? <Aperture size={16} /> : <User size={16} />}
                </div>
                <div className={`p-5 rounded-2xl text-[15px] shadow-sm max-w-[85%] ${isAI ? 'bg-slate-900/80 border border-slate-800/60 rounded-tl-none text-slate-300 leading-relaxed font-medium tracking-wide [&>p]:mb-4 last:[&>p]:mb-0 [&_code]:bg-slate-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded overflow-x-auto' : 'bg-blue-600 text-white rounded-tr-none leading-snug whitespace-pre-wrap'}`}>
                  {isAI ? <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{formatMath(msg.parts[0].text)}</ReactMarkdown> : msg.parts[0].text}
                </div>
              </div>
            );
          })
        )}
        
        {loading && (
          <div className="flex gap-4 max-w-4xl mx-auto">
            <div className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center mt-1 bg-slate-800 border border-slate-700 text-white animate-pulse">
              <Aperture size={16} />
            </div>
            <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800 rounded-tl-none flex items-center gap-3">
              <Loader2 size={16} className="animate-spin text-slate-500" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="bg-slate-950 p-4 md:p-6 border-t border-slate-800/80 sticky bottom-0 z-20">
        <form onSubmit={handleSend} className="max-w-4xl mx-auto relative flex flex-col gap-3">
          {fileToUpload && (
            <div className="relative w-max px-4 h-12 ml-2 rounded-lg border border-slate-700 overflow-hidden shadow-lg bg-slate-900 flex items-center gap-3 group">
              {fileToUpload.isPdf ? <FileText size={20} className="text-blue-500" /> : <img src={fileToUpload.url} alt="Preview" className="w-8 h-8 object-cover rounded shadow" />}
              <span className="text-xs font-bold text-slate-300 pr-4">{fileToUpload.isPdf ? fileToUpload.file?.name : 'Imagem Anexada'}</span>
              <button type="button" onClick={() => setFileToUpload(null)} className="absolute right-0 top-0 bottom-0 px-2 bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center transition-all"><X size={16} /></button>
            </div>
          )}

          <div className="relative flex items-center">
            <label className={`absolute left-2 w-10 h-10 flex items-center justify-center rounded-full transition-colors cursor-pointer ${fileToUpload ? 'text-blue-500' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}`}>
              <Paperclip size={18} />
              <input type="file" accept="image/*, application/pdf" onChange={handleFileChange} className="hidden" disabled={loading || percentUso >= 100} />
            </label>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading || percentUso >= 100}
              placeholder={percentUso < 100 ? "Escreve, anexa uma foto ou um PDF..." : "Plafond bloqueado. Contacta o administrador."}
              className="w-full bg-slate-900 border border-slate-700 p-4 pl-14 pr-16 rounded-2xl outline-none focus:border-blue-500 focus:bg-slate-900 transition-all text-sm disabled:opacity-50 text-white placeholder:text-slate-600 shadow-inner"
            />

            <button type="submit" disabled={(!input.trim() && !fileToUpload) || loading || percentUso >= 100} className="absolute right-2 w-10 h-10 bg-white hover:bg-slate-200 disabled:bg-slate-800 disabled:text-slate-600 text-slate-900 rounded-xl flex items-center justify-center transition-all active:scale-95 shadow-md">
              <Send size={16} className="ml-0.5" />
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}