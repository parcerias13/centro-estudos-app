'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Zap, Bot, User, Loader2, Sparkles, BrainCircuit } from 'lucide-react';

// O formato que o Gemini exige para o histórico
type MessagePart = { text: string };
type ChatMessage = { role: 'user' | 'model'; parts: MessagePart[] };

export default function LabAI() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sparks, setSparks] = useState(1000); // Saldo inicial simulado
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Faz scroll automático para a última mensagem
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading || sparks <= 0) return;

    // Custo por mensagem
    const COST_PER_MSG = 1;
    setSparks(prev => prev - COST_PER_MSG);

    const userMsg: ChatMessage = { role: 'user', parts: [{ text: input }] };
    const newMessages = [...messages, userMsg];
    
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/lab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Enviamos a nova mensagem e o histórico (excluindo a nova para não duplicar)
        body: JSON.stringify({ 
          message: input,
          history: messages 
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const aiMsg: ChatMessage = { role: 'model', parts: [{ text: data.response }] };
        setMessages(prev => [...prev, aiMsg]);
      } else {
        throw new Error(data.error || 'Erro no servidor AI');
      }
    } catch (error: any) {
      alert("Falha de comunicação: " + error.message);
      // Devolve o Spark se a chamada falhouf
      setSparks(prev => prev + COST_PER_MSG);
    } finally {
      setLoading(false);
    }
  };

  const percentSparks = (sparks / 1000) * 100;

  return (
    <main className="min-h-screen bg-[#0f172a] text-white flex flex-col font-sans">
      
      {/* HEADER DO LAB AI */}
      <header className="bg-slate-900 border-b border-slate-800 p-4 md:px-8 flex items-center justify-between shadow-md z-10 sticky top-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <BrainCircuit size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black italic tracking-tighter">Lab AI</h1>
            <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">O teu Tutor de Elite</p>
          </div>
        </div>

        {/* SISTEMA DE SPARKS (GAMIFICAÇÃO) */}
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className={sparks > 200 ? 'text-amber-400' : 'text-red-500 animate-pulse'} />
            <span className="text-xs font-black font-mono">{sparks} SPARKS</span>
          </div>
          <div className="w-32 h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
            <div 
              className={`h-full transition-all duration-500 ${sparks > 200 ? 'bg-linear-to-r from-amber-500 to-yellow-300' : 'bg-red-500'}`}
              style={{ width: `${percentSparks}%` }}
            />
          </div>
        </div>
      </header>

      {/* ÁREA DE CHAT */} 
      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-50 text-center max-w-md mx-auto mt-20">
            <Sparkles size={64} className="text-blue-500 mb-6" />
            <h2 className="text-2xl font-black mb-2">Preparado para treinar?</h2>
            <p className="text-sm text-slate-400">
              Escreve o que estás a estudar. Pede-me para explicar um conceito difícil ou pede um "Quiz de 5 perguntas" para testar o teu conhecimento. Não te vou dar a resposta de mão beijada, vou fazer-te pensar.
            </p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isAI = msg.role === 'model';
            return (
              <div key={index} className={`flex gap-4 max-w-4xl mx-auto ${isAI ? 'flex-row' : 'flex-row-reverse'}`}>
                <div className={`w-10 h-10 shrink-0 rounded-2xl flex items-center justify-center shadow-lg ${isAI ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                  {isAI ? <Bot size={20} /> : <User size={20} />}
                </div>
                <div className={`p-5 rounded-3xl text-sm leading-relaxed whitespace-pre-wrap shadow-sm ${isAI ? 'bg-slate-900 border border-slate-800 rounded-tl-none' : 'bg-blue-600 text-white rounded-tr-none'}`}>
                  {msg.parts[0].text}
                </div>
              </div>
            );
          })
        )}
        
        {loading && (
          <div className="flex gap-4 max-w-4xl mx-auto">
            <div className="w-10 h-10 shrink-0 rounded-2xl flex items-center justify-center shadow-lg bg-blue-600 text-white animate-pulse">
              <Bot size={20} />
            </div>
            <div className="p-5 rounded-3xl bg-slate-900 border border-slate-800 rounded-tl-none flex items-center gap-3">
              <Loader2 size={16} className="animate-spin text-blue-500" />
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">A analisar o contexto...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* BARRA DE INPUT */}
      <div className="bg-[#0f172a] p-4 md:p-6 border-t border-slate-800/50 sticky bottom-0">
        <form onSubmit={handleSend} className="max-w-4xl mx-auto relative group">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading || sparks <= 0}
            placeholder={sparks > 0 ? "O que vamos estudar hoje?" : "Sem Sparks suficientes. Fala com a receção."}
            className="w-full bg-slate-900 border-2 border-slate-800 p-5 pr-16 rounded-4xl outline-none focus:border-blue-500 transition-all text-sm disabled:opacity-50"
          />
          <button 
            type="submit"
            disabled={!input.trim() || loading || sparks <= 0}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-full flex items-center justify-center transition-all active:scale-95 shadow-lg"
          >
            <Send size={18} className="ml-0.5" />
          </button>
        </form>
        <p className="text-center text-[10px] text-slate-600 uppercase font-black tracking-widest mt-4">
          O Lab AI pode cometer erros. Revê as tuas respostas finais.
        </p>
      </div>
    </main>
  );
}