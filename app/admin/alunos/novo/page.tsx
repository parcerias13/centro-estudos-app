'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, UserPlus, ShieldAlert, Calendar, Camera } from 'lucide-react';

export default function NovoAluno() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState('');
  const [pacotes, setPacotes] = useState<any[]>([]);

  // 1. DADOS PESSOAIS
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('123456');
  const [telefone, setTelefone] = useState('');
  const [anoEscolar, setAnoEscolar] = useState('1'); // Começa no 1º por padrão
  const [saidaAutorizada, setSaidaAutorizada] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null); // NOVO: Estado da Foto

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

  useEffect(() => {
    const fetchPacotes = async () => {
      const { data } = await supabase.from('pacotes').select('*').order('sessoes_semanais');
      if (data) setPacotes(data);
    };
    fetchPacotes();
  }, []);

  // LÓGICA DE UPLOAD DE FOTO
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true);
      setErro('');
      if (!e.target.files || e.target.files.length === 0) return;

      const file = e.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatares')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatares').getPublicUrl(filePath);
      setAvatarUrl(data.publicUrl);

    } catch (error: any) {
      setErro('Erro no upload da foto: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const toggleDia = (id: number) => {
    if (!pacoteId) {
      setErro('Seleciona um pacote primeiro para definir o limite de dias.');
      return;
    }

    const pacoteSelecionado = pacotes.find(p => p.id === pacoteId);
    const limiteSessoes = pacoteSelecionado ? pacoteSelecionado.sessoes_semanais : 99;

    setDiasSelecionados(prev => {
      if (prev.includes(id)) {
        return prev.filter(d => d !== id);
      }
      
      if (prev.length >= limiteSessoes) {
        alert(`O pacote selecionado permite um máximo de ${limiteSessoes} dia(s) por semana.`);
        return prev;
      }
      
      return [...prev, id];
    });
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const pacoteSelecionado = pacotes.find(p => p.id === pacoteId);
    if (pacoteSelecionado && diasSelecionados.length !== pacoteSelecionado.sessoes_semanais && pacoteSelecionado.sessoes_semanais !== 99) {
       setErro(`Deves selecionar exatamente ${pacoteSelecionado.sessoes_semanais} dia(s) para este pacote.`);
       return;
    }

    if (!pacoteId || diasSelecionados.length === 0) {
      setErro('Define o pacote e os dias autorizados. Sem regras, não há controlo.');
      return;
    }

    setLoading(true);
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
        telefone_encarregado: telefone,
        ano_escolar: parseInt(anoEscolar),
        pacote_id: pacoteId,
        saida_autorizada: saidaAutorizada,
        avatar_url: avatarUrl, // GRAVA A FOTO NO PERFIL
      });
      if (dbError) throw new Error(`Erro DB: ${dbError.message}`);

      const horarios = diasSelecionados.map(dia => ({
        aluno_id: novoId,
        dia_semana: dia
      }));
      const { error: hError } = await supabase.from('aluno_horarios').insert(horarios);
      if (hError) throw new Error(`Erro Horários: ${hError.message}`);

      router.push('/admin/alunos');
      router.refresh();

    } catch (err: any) {
      setErro(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 max-w-4xl mx-auto">
      
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin/alunos" className="bg-slate-900 p-3 rounded-xl hover:bg-slate-800 transition-colors border border-slate-800">
          <ArrowLeft size={20} className="text-slate-400" />
        </Link>
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <UserPlus className="text-blue-500" /> Nova Matrícula
          </h1>
          <p className="text-slate-500 text-xs">Espectro total: do 1º ao 12º ano.</p>
        </div>
      </div>

      <form onSubmit={handleGuardar} className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-10">
        
        {erro && (
          <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex items-start gap-3 text-red-500">
            <ShieldAlert className="shrink-0" size={20} />
            <p className="text-sm font-bold">{erro}</p>
          </div>
        )}

        <div className="space-y-6">
          <h2 className="text-xs font-black uppercase text-blue-500 tracking-widest">1. Identificação do Aluno</h2>
          
          {/* UPLOAD DE FOTO ADICIONADO AQUI */}
          <div className="flex flex-col items-center gap-4 py-4 mb-4">
            <div className="relative group">
              <div className={`w-32 h-32 rounded-3xl border border-slate-800 overflow-hidden shadow-2xl flex items-center justify-center transition-all ${!avatarUrl ? 'bg-slate-950' : ''}`}>
                {avatarUrl ? (
                  <img src={avatarUrl} className="w-full h-full object-cover" alt="Preview" />
                ) : (
                  <Camera size={40} className="text-slate-800" />
                )}
                {uploading && <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>}
              </div>
              <label className="absolute -bottom-2 -right-2 bg-blue-600 p-3 rounded-2xl cursor-pointer hover:bg-blue-500 transition-all shadow-xl">
                <Camera size={20} />
                <input type="file" accept="image/*" onChange={handleUpload} className="hidden" disabled={uploading} />
              </label>
            </div>
            <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Foto de Perfil</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nome Completo *</label>
              <input type="text" required value={nome} onChange={(e) => setNome(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500" placeholder="Ex: Tomás Silva" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ano Escolar *</label>
              <select value={anoEscolar} onChange={(e) => setAnoEscolar(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 appearance-none">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(ano => (
                  <option key={ano} value={ano}>{ano}º Ano</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Email (Login) *</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500" placeholder="aluno@centro.pt" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Password Provisória *</label>
              <input type="text" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500" placeholder="Ex: 123456" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Telemóvel Encarregado *</label>
              <input type="text" required value={telefone} onChange={(e) => setTelefone(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500" placeholder="Ex: 351912345678" />
            </div>
          </div>
        </div>

        <hr className="border-slate-800" />

        <div className="space-y-6">
          <h2 className="text-xs font-black uppercase text-blue-500 tracking-widest">2. Plano e Frequência</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {pacotes.map(p => (
              <button 
                key={p.id} type="button"
                onClick={() => {
                  setPacoteId(p.id);
                  setDiasSelecionados([]); 
                  setErro('');
                }}
                className={`p-4 rounded-2xl border text-left transition-all ${pacoteId === p.id ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`}
              >
                <p className="font-bold text-sm text-white">{p.nome}</p>
                <p className="text-[10px] text-slate-500 uppercase font-black">{p.sessoes_semanais}x / Semana</p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Calendar size={14} /> Dias de Estudo Autorizados *
          </label>
          <div className="flex flex-wrap gap-2 mb-6">
            {diasSemana.map(d => (
              <button
                key={d.id} type="button"
                onClick={() => toggleDia(d.id)}
                className={`flex-1 min-w-20 p-3 rounded-xl border text-xs font-black transition-all ${diasSelecionados.includes(d.id) ? 'bg-blue-600 border-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.3)]' : 'bg-slate-950 border-slate-800 text-slate-500 hover:bg-slate-900'}`}
              >
                {d.label}
              </button>
            ))}
          </div>

          <button 
            type="button"
            onClick={() => setSaidaAutorizada(!saidaAutorizada)}
            className="w-full flex items-center justify-between p-4 bg-slate-950 border border-slate-800 rounded-2xl cursor-pointer hover:border-slate-700 transition-colors mt-8"
          >
            <div className="text-left">
              <p className="font-bold text-sm text-white">Saída Autorizada</p>
              <p className="text-xs text-slate-500">O aluno pode sair sem acompanhante?</p>
            </div>
            <div className={`w-12 h-6 rounded-full p-1 flex items-center transition-colors ${saidaAutorizada ? 'bg-emerald-500' : 'bg-slate-800'}`}>
              <div className={`w-4 h-4 bg-white rounded-full transition-transform ${saidaAutorizada ? 'translate-x-6' : 'translate-x-0'}`} />
            </div>
          </button>
        </div>

        <button 
          type="submit" disabled={loading || uploading}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white p-5 rounded-2xl font-black flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 mt-8"
        >
          {loading ? <Loader2 className="animate-spin" /> : <Save size={20} />}
          {loading ? 'A REGISTAR MATRÍCULA...' : 'FINALIZAR E CRIAR ACESSOS'}
        </button>

      </form>
    </main>
  );
}