'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, UserPlus, ShieldAlert, Calendar, Camera, BrainCircuit, Baby, ToggleLeft, ToggleRight, Smartphone, Phone, GraduationCap, Mail } from 'lucide-react';

export default function NovoAluno() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false); // Substitui o loading simples
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState('');
  const [pacotes, setPacotes] = useState<any[]>([]);

  // 1. DADOS PESSOAIS
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('123456');
  const [telefone, setTelefone] = useState(''); 
  const [emailEncarregado, setEmailEncarregado] = useState(''); 
  const [telemovelAluno, setTelemovelAluno] = useState(''); 
  const [dataNascimento, setDataNascimento] = useState('');
  const [anoEscolar, setAnoEscolar] = useState('1');
  const [saidaAutorizada, setSaidaAutorizada] = useState(false);
  const [consentimentoIa, setConsentimentoIa] = useState(false);
  const [usaApp, setUsaApp] = useState(true); 
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // 2. LÓGICA DE NEGÓCIO
  const [pacoteId, setPacoteId] = useState('');
  const [diasSelecionados, setDiasSelecionados] = useState<number[]>([]);

  const diasSemana = [
    { id: 1, label: 'Segunda' }, { id: 2, label: 'Terça' }, { id: 3, label: 'Quarta' },
    { id: 4, label: 'Quinta' }, { id: 5, label: 'Sexta' }, { id: 6, label: 'Sábado' }
  ];

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // --- SISTEMA DE CONTROLO DE FLUXO (ANTI-DOUBLE CLICK) ---
  const safeAction = async (actionFn: () => Promise<void>) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await actionFn();
    } catch (error) {
      console.error("Erro na operação:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const fetchPacotes = async () => {
      const { data } = await supabase.from('pacotes').select('*').order('sessoes_semanais');
      if (data) setPacotes(data);
    };
    fetchPacotes();
  }, [supabase]);

  const eMaiorDe13 = () => {
    if (!dataNascimento) return false;
    const hoje = new Date();
    const nascimento = new Date(dataNascimento);
    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const m = hoje.getMonth() - nascimento.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nascimento.getDate())) idade--;
    return idade >= 13;
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true);
      setErro('');
      if (!e.target.files || e.target.files.length === 0) return;
      const file = e.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('avatares').upload(fileName, file);
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('avatares').getPublicUrl(fileName);
      setAvatarUrl(data.publicUrl);
    } catch (error: any) {
      setErro('Erro no upload: ' + error.message);
    } finally { setUploading(false); }
  };

  const toggleDia = (id: number) => {
    if (!pacoteId) {
      setErro('Seleciona um pacote primeiro.');
      return;
    }
    const pacoteSelecionado = pacotes.find(p => p.id === pacoteId);
    const limiteSessoes = pacoteSelecionado ? pacoteSelecionado.sessoes_semanais : 99;
    setDiasSelecionados(prev => {
      if (prev.includes(id)) return prev.filter(d => d !== id);
      if (prev.length >= limiteSessoes) {
        alert(`Limite de ${limiteSessoes} dia(s) para este pacote.`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleGuardar = async () => {
    const pacoteSelecionado = pacotes.find(p => p.id === pacoteId);
    
    if (pacoteSelecionado && diasSelecionados.length !== pacoteSelecionado.sessoes_semanais && pacoteSelecionado.sessoes_semanais !== 99) {
       setErro(`Seleciona exatamente ${pacoteSelecionado.sessoes_semanais} dia(s).`);
       return;
    }

    if (!dataNascimento) {
      setErro('A data de nascimento é obrigatória.');
      return;
    }

    setErro('');

    try {
      const adminAuthClient = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } }
      );

      const { data: authData, error: authError } = await adminAuthClient.auth.signUp({ email, password });
      if (authError) throw new Error(`Erro Auth: ${authError.message}`);
      const novoId = authData.user!.id;

      const { error: dbError } = await supabase.from('alunos').insert({
        id: novoId,
        nome,
        email,
        data_nascimento: dataNascimento,
        telefone_encarregado: telefone,
        email_encarregado: emailEncarregado,
        telemovel_aluno: telemovelAluno, 
        ano_escolar: parseInt(anoEscolar),
        pacote_id: pacoteId,
        saida_autorizada: saidaAutorizada,
        consentimento_ia: eMaiorDe13() ? consentimentoIa : false,
        usa_app: usaApp,
        avatar_url: avatarUrl,
      });
      if (dbError) throw new Error(`Erro DB: ${dbError.message}`);

      const horarios = diasSelecionados.map(dia => ({ aluno_id: novoId, dia_semana: dia }));
      await supabase.from('aluno_horarios').insert(horarios);

      router.push('/admin/alunos');
      router.refresh();
    } catch (err: any) {
      setErro(err.message);
      throw err; // Lança para o safeAction capturar
    }
  };

  return (
    <main className={`min-h-screen bg-slate-950 text-white p-6 max-w-4xl mx-auto pb-20 transition-all ${isSubmitting ? 'pointer-events-none opacity-60' : ''}`}>
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin/alunos" className="bg-slate-900 p-3 rounded-xl hover:bg-slate-800 transition-colors border border-slate-800">
          <ArrowLeft size={20} className="text-slate-400" />
        </Link>
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <UserPlus className="text-blue-500" /> Nova Matrícula
          </h1>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Configuração de Perfil e Conformidade</p>
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); safeAction(handleGuardar); }} className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-10">
        
        {erro && (
          <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex items-start gap-3 text-red-500">
            <ShieldAlert className="shrink-0" size={20} />
            <p className="text-sm font-bold">{erro}</p>
          </div>
        )}

        {/* 1. IDENTIFICAÇÃO */}
        <div className="space-y-6">
          <h2 className="text-[10px] font-black uppercase text-blue-500 tracking-[0.2em]">1. Identificação e Perfil</h2>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="relative group">
              <div className={`w-24 h-24 rounded-3xl border border-slate-800 overflow-hidden shadow-2xl flex items-center justify-center transition-all ${!avatarUrl ? 'bg-slate-950' : ''}`}>
                {avatarUrl ? <img src={avatarUrl} className="w-full h-full object-cover" /> : <Camera size={30} className="text-slate-800" />}
                {uploading && <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>}
              </div>
              <label className="absolute -bottom-2 -right-2 bg-blue-600 p-2.5 rounded-xl cursor-pointer hover:bg-blue-500 shadow-xl transition-all">
                <Camera size={16} />
                <input type="file" accept="image/*" onChange={handleUpload} className="hidden" disabled={uploading} />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Nome Completo</label>
              <input type="text" required value={nome} onChange={(e) => setNome(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 transition-all" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Data de Nascimento</label>
              <input type="date" required value={dataNascimento} onChange={(e) => setDataNascimento(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 transition-all text-white" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Email de Acesso (Aluno)</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 transition-all" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Password</label>
              <input type="text" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 transition-all" />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <GraduationCap size={12} /> Ano Escolar
              </label>
              <select 
                value={anoEscolar} 
                onChange={(e) => setAnoEscolar(e.target.value)} 
                className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 transition-all text-white appearance-none cursor-pointer"
              >
                {[...Array(12)].map((_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}º Ano</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Smartphone size={12}/> Telemóvel do Aluno</label>
              <input type="text" value={telemovelAluno} onChange={(e) => setTelemovelAluno(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 transition-all" placeholder="Ex: 912345678" />
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Phone size={12}/> Telemóvel Encarregado (WhatsApp)</label>
              <input type="text" required value={telefone} onChange={(e) => setTelefone(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 transition-all" placeholder="Ex: 912345678" />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Mail size={12}/> Email do Encarregado (Relatórios)
              </label>
              <input 
                type="email" 
                required 
                value={emailEncarregado} 
                onChange={(e) => setEmailEncarregado(e.target.value)} 
                className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 transition-all" 
                placeholder="email@exemplo.com" 
              />
            </div>
          </div>
        </div>

        <hr className="border-slate-800" />

        {/* 2. PLANO */}
        <div className="space-y-6">
          <h2 className="text-[10px] font-black uppercase text-blue-500 tracking-[0.2em]">2. Plano de Frequência</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {pacotes.map(p => (
              <button key={p.id} type="button" onClick={() => { setPacoteId(p.id); setDiasSelecionados([]); }} className={`p-4 rounded-2xl border text-left transition-all ${pacoteId === p.id ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-950 opacity-60 hover:opacity-100'}`}>
                <p className="font-bold text-sm text-white">{p.nome}</p>
                <p className="text-[9px] text-slate-500 uppercase font-black">{p.sessoes_semanais}x por semana</p>
              </button>
            ))}
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Calendar size={14} /> Dias Autorizados</label>
            <div className="flex flex-wrap gap-2">
              {diasSemana.map(d => (
                <button key={d.id} type="button" onClick={() => toggleDia(d.id)} className={`flex-1 min-w-27.5 p-3 rounded-xl border text-[10px] font-black transition-all ${diasSelecionados.includes(d.id) ? 'bg-blue-600 border-blue-500 shadow-lg shadow-blue-500/20' : 'bg-slate-950 border-slate-800 text-slate-600'}`}>
                  {d.label}
                </button>
              ))} 
            </div>
          </div>
        </div>

        <hr className="border-slate-800" />

        {/* 3. PERMISSÕES E COMPLIANCE */}
        <div className="space-y-6">
          <h2 className="text-[10px] font-black uppercase text-blue-500 tracking-[0.2em]">3. Permissões e Compliance</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`p-5 rounded-2xl border transition-all flex items-center justify-between ${usaApp ? 'bg-slate-950 border-blue-500/30' : 'bg-slate-900/50 border-slate-800 opacity-70'}`}>
              <div className="flex items-center gap-3">
                <Smartphone size={20} className={usaApp ? 'text-blue-500' : 'text-slate-600'} />
                <div>
                  <p className="font-bold text-sm">Usa Telemóvel?</p>
                  <p className="text-[9px] text-slate-500 uppercase font-black">{usaApp ? 'Faz check-in pela app' : 'Check-in feito pelo Admin'}</p>
                </div>
              </div>
              <button type="button" onClick={() => setUsaApp(!usaApp)} className={`transition-colors ${usaApp ? 'text-blue-500' : 'text-slate-700'}`}>
                {usaApp ? <ToggleRight size={40} /> : <ToggleLeft size={40} />}
              </button>
            </div>

            <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 flex items-center justify-between">
              <div>
                <p className="font-bold text-sm">Saída Autorizada</p>
                <p className="text-[9px] text-slate-500 uppercase font-black">Pode sair sem acompanhante</p>
              </div>
              <button type="button" onClick={() => setSaidaAutorizada(!saidaAutorizada)} className={`transition-colors ${saidaAutorizada ? 'text-emerald-500' : 'text-slate-700'}`}>
                {saidaAutorizada ? <ToggleRight size={40} /> : <ToggleLeft size={40} />}
              </button>
            </div>

            <div className={`p-5 rounded-2xl border transition-all flex items-center justify-between ${!eMaiorDe13() ? 'bg-slate-900/50 border-slate-800 opacity-60' : 'bg-slate-950 border-orange-500/20 shadow-lg shadow-orange-500/5'}`}>
              <div className="flex items-center gap-3">
                <BrainCircuit size={20} className={!eMaiorDe13() ? 'text-slate-700' : 'text-orange-500'} />
                <div>
                  <p className="font-bold text-sm">Acesso LabAI</p>
                  <p className="text-[9px] text-slate-500 uppercase font-black">{eMaiorDe13() ? 'Consentimento Parental' : 'Bloqueado < 13 anos'}</p>
                </div>
              </div>
              {eMaiorDe13() ? (
                <button type="button" onClick={() => setConsentimentoIa(!consentimentoIa)} className={`transition-colors ${consentimentoIa ? 'text-orange-500' : 'text-slate-700'}`}>
                  {consentimentoIa ? <ToggleRight size={40} /> : <ToggleLeft size={40} />}
                </button>
              ) : (
                <ShieldAlert size={24} className="text-slate-700" />
              )}
            </div>
          </div>
          
          {!eMaiorDe13() && dataNascimento && (
            <p className="text-[10px] text-red-400 font-bold bg-red-500/5 p-3 rounded-lg flex items-center gap-2">
              <Baby size={14} /> Nota: Menores de 13 anos não podem aceder a ferramentas de IA.
            </p>
          )}
        </div>

        <button 
          type="submit" 
          disabled={isSubmitting || uploading} 
          className="w-full bg-blue-600 hover:bg-blue-500 text-white p-5 rounded-2xl font-black flex items-center justify-center gap-3 transition-all active:scale-[0.98] disabled:opacity-50 shadow-xl shadow-blue-500/20"
        >
          {isSubmitting ? <Loader2 className="animate-spin" /> : <Save size={20} />}
          {isSubmitting ? 'A CRIAR ACESSOS...' : 'FINALIZAR MATRÍCULA'}
        </button>
      </form>
    </main>
  );
}