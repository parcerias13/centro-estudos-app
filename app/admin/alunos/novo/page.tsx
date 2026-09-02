'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, UserPlus, ShieldAlert, Calendar, Camera, BrainCircuit, Baby, ToggleLeft, ToggleRight, Smartphone, Phone, GraduationCap, Mail, DollarSign, Eye, EyeOff, RefreshCw, FileText, MapPin } from 'lucide-react';

export default function NovoAluno() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState('');

  // 1. DADOS PESSOAIS
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [telefone, setTelefone] = useState(''); 
  const [emailEncarregado, setEmailEncarregado] = useState('');
  const [nifEncarregado, setNifEncarregado] = useState('');
  const [moradaEncarregado, setMoradaEncarregado] = useState('');
  const [telemovelAluno, setTelemovelAluno] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [anoEscolar, setAnoEscolar] = useState('1');
  const [saidaAutorizada, setSaidaAutorizada] = useState(false);
  const [consentimentoIa, setConsentimentoIa] = useState(false);
  const [usaApp, setUsaApp] = useState(true); 
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // 2. LÓGICA DE NEGÓCIO (CONTRATO FIXO)
  const [mensalidadeBase, setMensalidadeBase] = useState(''); 
  const [diasSelecionados, setDiasSelecionados] = useState<number[]>([]);

  const diasSemana = [
    { id: 1, label: 'Segunda' }, { id: 2, label: 'Terça' }, { id: 3, label: 'Quarta' },
    { id: 4, label: 'Quinta' }, { id: 5, label: 'Sexta' }, { id: 6, label: 'Sábado' }
  ];

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

  const gerarPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const pwd = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    setPassword(pwd);
    setShowPassword(true);
  };

  const toggleDia = (id: number) => {
    setDiasSelecionados(prev => {
      if (prev.includes(id)) return prev.filter(d => d !== id);
      return [...prev, id];
    });
  };

  const handleGuardar = async () => {
    if (!dataNascimento) {
      setErro('A data de nascimento é obrigatória.');
      return;
    }

    if (!mensalidadeBase) {
      setErro('Define o valor da mensalidade base.');
      return;
    }

    setErro('');

    try {
      const { data: { user: adminUser } } = await supabase.auth.getUser();
      const centro_id = adminUser?.app_metadata?.centro_id;
      if (!centro_id) {
        setErro('Não foi possível obter o centro. Recarrega a página.');
        return;
      }

      const res = await fetch('/api/admin/criar-aluno', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          nome,
          data_nascimento: dataNascimento,
          telefone_encarregado: telefone,
          email_encarregado: emailEncarregado,
          nif_encarregado: nifEncarregado,
          morada_encarregado: moradaEncarregado,
          telemovel_aluno: telemovelAluno,
          ano_escolar: parseInt(anoEscolar),
          mensalidade_base: parseFloat(mensalidadeBase),
          saida_autorizada: saidaAutorizada,
          consentimento_ia: eMaiorDe13() ? consentimentoIa : false,
          usa_app: usaApp,
          avatar_url: avatarUrl,
          centro_id,
          dias_selecionados: diasSelecionados,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Erro (${res.status})`);

      router.push('/admin/alunos');
      router.refresh();
    } catch (err: any) {
      setErro(err.message);
      throw err;
    }
  };

  return (
    <main className={`min-h-screen bg-page text-primary p-6 max-w-4xl mx-auto pb-20 transition-all ${isSubmitting ? 'pointer-events-none opacity-60' : ''}`}>
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin/alunos" className="bg-surface p-3 rounded-xl hover:bg-raised transition-colors border border-border">
          <ArrowLeft size={20} className="text-secondary" />
        </Link>
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <UserPlus className="text-accent" /> Nova Matrícula
          </h1>
          <p className="text-muted text-xs font-bold uppercase tracking-widest mt-1">Contrato de Mensalidade Fixa</p>
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); safeAction(handleGuardar); }} className="bg-surface border border-border rounded-3xl p-8 shadow-2xl space-y-10">
        
        {erro && (
          <div className="bg-danger-bg border border-danger/30 p-4 rounded-xl flex items-start gap-3 text-danger">
            <ShieldAlert className="shrink-0" size={20} />
            <p className="text-sm font-bold">{erro}</p>
          </div>
        )}

        {/* 1. IDENTIFICAÇÃO */}
        <div className="space-y-6">
          <h2 className="text-[10px] font-black uppercase text-accent tracking-[0.2em]">1. Identificação e Perfil</h2>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="relative group">
              <div className={`w-24 h-24 rounded-3xl border border-border overflow-hidden shadow-2xl flex items-center justify-center transition-all ${!avatarUrl ? 'bg-page' : ''}`}>
                {avatarUrl ? <img src={avatarUrl} className="w-full h-full object-cover" /> : <Camera size={30} className="text-slate-800" />}
                {uploading && <div className="absolute inset-0 bg-page/80 flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>}
              </div>
              <label className="absolute -bottom-2 -right-2 bg-accent hover:bg-accent-hover text-on-accent p-2.5 rounded-xl cursor-pointer shadow-xl transition-all">
                <Camera size={16} />
                <input type="file" accept="image/*" onChange={handleUpload} className="hidden" disabled={uploading} />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest">Nome Completo</label>
              <input type="text" required value={nome} onChange={(e) => setNome(e.target.value)} className="w-full bg-page border border-border p-4 rounded-xl outline-none focus:border-accent transition-all" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest">Data de Nascimento</label>
              <input type="date" required value={dataNascimento} onChange={(e) => setDataNascimento(e.target.value)} className="w-full bg-page border border-border p-4 rounded-xl outline-none focus:border-accent transition-all text-primary" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest">Email de Acesso (Aluno)</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-page border border-border p-4 rounded-xl outline-none focus:border-accent transition-all" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest">Password Provisória</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full bg-page border border-border p-4 pr-12 rounded-xl outline-none focus:border-accent transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={gerarPassword}
                  title="Gerar password aleatória"
                  className="px-4 bg-raised hover:bg-border border border-border rounded-xl transition-all active:scale-95 text-secondary hover:text-primary shrink-0"
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest flex items-center gap-2">
                <GraduationCap size={12} /> Ano Escolar
              </label>
              <select 
                value={anoEscolar} 
                onChange={(e) => setAnoEscolar(e.target.value)} 
                className="w-full bg-page border border-border p-4 rounded-xl outline-none focus:border-accent transition-all text-primary appearance-none cursor-pointer"
              >
                {[...Array(12)].map((_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}º Ano</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest flex items-center gap-2"><Smartphone size={12}/> Telemóvel do Aluno</label>
              <input type="text" value={telemovelAluno} onChange={(e) => setTelemovelAluno(e.target.value)} className="w-full bg-page border border-border p-4 rounded-xl outline-none focus:border-accent transition-all" placeholder="Ex: 912345678" />
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest flex items-center gap-2"><Phone size={12}/> Telemóvel Encarregado (WhatsApp)</label>
              <input type="text" required value={telefone} onChange={(e) => setTelefone(e.target.value)} className="w-full bg-page border border-border p-4 rounded-xl outline-none focus:border-accent transition-all" placeholder="Ex: 912345678" />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest flex items-center gap-2">
                <Mail size={12}/> Email do Encarregado (Relatórios)
              </label>
              <input 
                type="email" 
                required 
                value={emailEncarregado} 
                onChange={(e) => setEmailEncarregado(e.target.value)} 
                className="w-full bg-page border border-border p-4 rounded-xl outline-none focus:border-accent transition-all" 
                placeholder="email@exemplo.com"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest flex items-center gap-2">
                <FileText size={12}/> NIF do Encarregado
              </label>
              <input
                type="text"
                value={nifEncarregado}
                onChange={(e) => setNifEncarregado(e.target.value)}
                className="w-full bg-page border border-border p-4 rounded-xl outline-none focus:border-accent transition-all"
                placeholder="Ex: 123456789"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest flex items-center gap-2">
                <MapPin size={12}/> Morada do Encarregado
              </label>
              <input
                type="text"
                value={moradaEncarregado}
                onChange={(e) => setMoradaEncarregado(e.target.value)}
                className="w-full bg-page border border-border p-4 rounded-xl outline-none focus:border-accent transition-all"
                placeholder="Rua Exemplo, 123, Porto"
              />
            </div>
          </div>
        </div>

        <hr className="border-border" />

        {/* 2. PLANO FINANCEIRO E FREQUÊNCIA */}
        <div className="space-y-6">
          <h2 className="text-[10px] font-black uppercase text-accent tracking-[0.2em]">2. Plano Financeiro e Frequência</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-success uppercase tracking-widest flex items-center gap-2">
                <DollarSign size={12} /> Mensalidade Base (€)
              </label>
              <input 
                type="number" 
                required 
                value={mensalidadeBase} 
                onChange={(e) => setMensalidadeBase(e.target.value)} 
                placeholder="0.00"
                className="w-full bg-page border border-success/30 p-4 rounded-xl outline-none focus:border-success transition-all text-success font-bold" 
              />
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black text-muted uppercase tracking-widest flex items-center gap-2"><Calendar size={14} /> Dias Previstos de Frequência</label>
            <div className="flex flex-wrap gap-2">
              {diasSemana.map(d => (
                <button key={d.id} type="button" onClick={() => toggleDia(d.id)} className={`flex-1 min-w-27.5 p-3 rounded-xl border text-[10px] font-black transition-all ${diasSelecionados.includes(d.id) ? 'bg-accent border-accent shadow-lg shadow-accent/20' : 'bg-page border-border text-muted'}`}>
                  {d.label}
                </button>
              ))} 
            </div>
          </div>
        </div>

        <hr className="border-border" />

        {/* 3. PERMISSÕES E COMPLIANCE */}
        <div className="space-y-6">
          <h2 className="text-[10px] font-black uppercase text-accent tracking-[0.2em]">3. Permissões e Compliance</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`p-5 rounded-2xl border transition-all flex items-center justify-between ${usaApp ? 'bg-page border-accent/30' : 'bg-surface/50 border-border opacity-70'}`}>
              <div className="flex items-center gap-3">
                <Smartphone size={20} className={usaApp ? 'text-accent' : 'text-muted'} />
                <div>
                  <p className="font-bold text-sm">Usa Telemóvel?</p>
                  <p className="text-[9px] text-muted uppercase font-black">{usaApp ? 'Faz check-in pela app' : 'Check-in feito pelo Admin'}</p>
                </div>
              </div>
              <button type="button" onClick={() => setUsaApp(!usaApp)} className={`transition-colors ${usaApp ? 'text-accent' : 'text-muted'}`}>
                {usaApp ? <ToggleRight size={40} /> : <ToggleLeft size={40} />}
              </button>
            </div>

            <div className="bg-page p-5 rounded-2xl border border-border flex items-center justify-between">
              <div>
                <p className="font-bold text-sm">Saída Autorizada</p>
                <p className="text-[9px] text-muted uppercase font-black">Pode sair sem acompanhante</p>
              </div>
              <button type="button" onClick={() => setSaidaAutorizada(!saidaAutorizada)} className={`transition-colors ${saidaAutorizada ? 'text-success' : 'text-muted'}`}>
                {saidaAutorizada ? <ToggleRight size={40} /> : <ToggleLeft size={40} />}
              </button>
            </div>

            <div className={`p-5 rounded-2xl border transition-all flex items-center justify-between ${!eMaiorDe13() ? 'bg-surface/50 border-border opacity-60' : 'bg-page border-orange-500/20 shadow-lg shadow-orange-500/5'}`}>
              <div className="flex items-center gap-3">
                <BrainCircuit size={20} className={!eMaiorDe13() ? 'text-muted' : 'text-orange-500'} />
                <div>
                  <p className="font-bold text-sm">Acesso LabAI</p>
                  <p className="text-[9px] text-muted uppercase font-black">{eMaiorDe13() ? 'Consentimento Parental' : 'Bloqueado < 13 anos'}</p>
                </div>
              </div>
              {eMaiorDe13() ? (
                <button type="button" onClick={() => setConsentimentoIa(!consentimentoIa)} className={`transition-colors ${consentimentoIa ? 'text-orange-500' : 'text-muted'}`}>
                  {consentimentoIa ? <ToggleRight size={40} /> : <ToggleLeft size={40} />}
                </button>
              ) : (
                <ShieldAlert size={24} className="text-muted" />
              )}
            </div>
          </div>
          
          {!eMaiorDe13() && dataNascimento && (
            <p className="text-[10px] text-danger font-bold bg-danger-bg p-3 rounded-lg flex items-center gap-2">
              <Baby size={14} /> Nota: Menores de 13 anos não podem aceder a ferramentas de IA.
            </p>
          )}
        </div>

        <button 
          type="submit" 
          disabled={isSubmitting || uploading} 
          className="w-full bg-accent hover:bg-accent-hover text-on-accent p-5 rounded-2xl font-black flex items-center justify-center gap-3 transition-all active:scale-[0.98] disabled:opacity-50 shadow-xl shadow-accent/20"
        >
          {isSubmitting ? <Loader2 className="animate-spin" /> : <Save size={20} />}
          {isSubmitting ? 'A CRIAR ACESSOS...' : 'FINALIZAR MATRÍCULA'}
        </button>
      </form>
    </main>
  );
}