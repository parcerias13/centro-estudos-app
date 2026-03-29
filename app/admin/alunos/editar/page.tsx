'use client';

import { useState, useEffect, Suspense } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, UserCheck, ShieldAlert, ToggleLeft, ToggleRight, Calendar, Camera, BrainCircuit, Baby, Smartphone } from 'lucide-react';

function EditarAlunoContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentId = searchParams.get('id');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [erro, setErro] = useState('');

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [anoEscolar, setAnoEscolar] = useState('10');
  const [limiteSemanal, setLimiteSemanal] = useState('3');
  const [saidaAutorizada, setSaidaAutorizada] = useState(false);
  const [consentimentoIa, setConsentimentoIa] = useState(false);
  const [usaApp, setUsaApp] = useState(true); // Controle de Autonomia Digital
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  
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
    if (studentId) carregarDados();
  }, [studentId]);

  const eMaiorDe13 = () => {
    if (!dataNascimento) return false;
    const hoje = new Date();
    const nascimento = new Date(dataNascimento);
    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const m = hoje.getMonth() - nascimento.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nascimento.getDate())) idade--;
    return idade >= 13;
  };

  const carregarDados = async () => {
    const { data: aluno, error: errAluno } = await supabase
      .from('alunos')
      .select('*')
      .eq('id', studentId)
      .single();

    if (errAluno) {
      setErro('Não foi possível carregar os dados.');
    } else if (aluno) {
      setNome(aluno.nome || '');
      setTelefone(aluno.telefone_encarregado || '');
      setDataNascimento(aluno.data_nascimento || '');
      setAnoEscolar(aluno.ano_escolar?.toString() || '10');
      setLimiteSemanal(aluno.limite_semanal?.toString() || '3');
      setSaidaAutorizada(aluno.saida_autorizada || false);
      setConsentimentoIa(aluno.consentimento_ia || false);
      setUsaApp(aluno.usa_app ?? true);
      setAvatarUrl(aluno.avatar_url || null);
    }

    const { data: horarios } = await supabase
      .from('aluno_horarios')
      .select('dia_semana')
      .eq('aluno_id', studentId);

    if (horarios) setDiasSelecionados(horarios.map(h => h.dia_semana));
    setLoading(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true);
      if (!e.target.files || e.target.files.length === 0) return;
      const file = e.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${studentId}-${Math.random()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('avatares').upload(fileName, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('avatares').getPublicUrl(fileName);
      setAvatarUrl(data.publicUrl);
    } catch (error: any) {
      setErro('Erro no upload: ' + error.message);
    } finally { setUploading(false); }
  };

  const toggleDia = (id: number) => {
    const limite = parseInt(limiteSemanal);
    setDiasSelecionados(prev => {
      if (prev.includes(id)) return prev.filter(d => d !== id);
      if (limite !== 99 && prev.length >= limite) {
        alert(`Limite semanal: ${limite} dia(s).`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { error: errUpdate } = await supabase
        .from('alunos')
        .update({
          nome,
          telefone_encarregado: telefone,
          data_nascimento: dataNascimento,
          ano_escolar: parseInt(anoEscolar),
          limite_semanal: parseInt(limiteSemanal),
          saida_autorizada: saidaAutorizada,
          consentimento_ia: eMaiorDe13() ? consentimentoIa : false,
          usa_app: usaApp,
          avatar_url: avatarUrl,
        })
        .eq('id', studentId);

      if (errUpdate) throw errUpdate;

      await supabase.from('aluno_horarios').delete().eq('aluno_id', studentId);
      const novosHorarios = diasSelecionados.map(dia => ({ aluno_id: studentId, dia_semana: dia }));
      await supabase.from('aluno_horarios').insert(novosHorarios);

      router.push('/admin/alunos');
      router.refresh();
    } catch (err: any) {
      setErro(`Falha: ${err.message}`);
      setSaving(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 max-w-3xl mx-auto pb-20">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin/alunos" className="bg-slate-900 p-3 rounded-xl hover:bg-slate-800 transition-colors border border-slate-800">
          <ArrowLeft size={20} className="text-slate-400" />
        </Link>
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <UserCheck className="text-blue-500" /> Editar Aluno
          </h1>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Perfil e Conformidade Digital</p>
        </div>
      </div>

      <form onSubmit={handleUpdate} className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-xl space-y-8">
        
        {erro && (
          <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex items-start gap-3 text-red-500">
            <ShieldAlert size={20} />
            <p className="text-sm font-bold">{erro}</p>
          </div>
        )}

        {/* FOTO */}
        <section className="flex flex-col items-center gap-4 py-4 border-b border-slate-800/50">
          <div className="relative">
            <div className="w-24 h-24 rounded-3xl border border-slate-800 overflow-hidden bg-slate-950 flex items-center justify-center">
              {avatarUrl ? <img src={avatarUrl} className="w-full h-full object-cover" /> : <Camera size={30} className="text-slate-800" />}
              {uploading && <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>}
            </div>
            <label className="absolute -bottom-2 -right-2 bg-blue-600 p-2 rounded-xl cursor-pointer hover:bg-blue-500 shadow-xl transition-all">
              <Camera size={16} />
              <input type="file" accept="image/*" onChange={handleUpload} className="hidden" disabled={uploading} />
            </label>
          </div>
        </section>

        {/* DADOS BASE */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Nome Completo</label>
            <input type="text" required value={nome} onChange={(e) => setNome(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 transition-all" />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Data de Nascimento</label>
            <input type="date" required value={dataNascimento} onChange={(e) => setDataNascimento(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500 transition-all" />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Telemóvel Encarregado</label>
            <input type="text" required value={telefone} onChange={(e) => setTelefone(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500" />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Limite Semanal</label>
            <select value={limiteSemanal} onChange={(e) => setLimiteSemanal(e.target.value)} className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl outline-none focus:border-blue-500">
              {[1,2,3,4,5,99].map(n => <option key={n} value={n}>{n === 99 ? 'Ilimitado' : `${n} sessoes/semana`}</option>)}
            </select>
          </div>
        </div>

        {/* DIAS DE ESTUDO */}
        <div className="space-y-3">
          <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest flex items-center gap-2"><Calendar size={14} /> Dias Autorizados</label>
          <div className="flex flex-wrap gap-2">
            {diasSemana.map(d => (
              <button key={d.id} type="button" onClick={() => toggleDia(d.id)} className={`flex-1 min-w-27.5 p-3 rounded-xl border text-[10px] font-black transition-all ${diasSelecionados.includes(d.id) ? 'bg-blue-600 border-blue-500 shadow-lg shadow-blue-500/20' : 'bg-slate-950 border-slate-800 text-slate-600'}`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* TOGGLES DE PERMISSÃO */}
        <div className="space-y-4">
          
          {/* AUTONOMIA DIGITAL (FIXED ICON) */}
          <div className={`bg-slate-950 p-5 rounded-2xl border flex items-center justify-between transition-all ${usaApp ? 'border-blue-500/30 shadow-lg shadow-blue-500/5' : 'border-slate-800 opacity-70'}`}>
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${usaApp ? 'bg-blue-500/10 text-blue-500' : 'bg-slate-800 text-slate-600'}`}>
                <Smartphone size={20} className={usaApp ? '' : 'opacity-40'} />
              </div>
              <div>
                <h4 className="font-bold text-sm">Autonomia Digital</h4>
                <p className="text-[10px] text-slate-500 uppercase font-black">{usaApp ? 'Aluno utiliza telemóvel para check-in' : 'Check-in manual via Dashboard Admin'}</p>
              </div>
            </div>
            <button type="button" onClick={() => setUsaApp(!usaApp)} className={`transition-colors ${usaApp ? 'text-blue-500' : 'text-slate-700'}`}>
              {usaApp ? <ToggleRight size={40} /> : <ToggleLeft size={40} />}
            </button>
          </div>

          <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 flex items-center justify-between">
            <div>
              <h4 className="font-bold text-sm">Saída Autorizada</h4>
              <p className="text-[10px] text-slate-500 uppercase font-black">Pode sair do centro sem acompanhante</p>
            </div>
            <button type="button" onClick={() => setSaidaAutorizada(!saidaAutorizada)} className={`transition-colors ${saidaAutorizada ? 'text-emerald-500' : 'text-slate-700'}`}>
              {saidaAutorizada ? <ToggleRight size={40} /> : <ToggleLeft size={40} />}
            </button>
          </div>

          <div className={`p-5 rounded-2xl border transition-all flex items-center justify-between ${!eMaiorDe13() ? 'bg-slate-900/50 border-slate-800 opacity-60' : 'bg-slate-950 border-orange-500/20 shadow-lg shadow-orange-500/5'}`}>
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${!eMaiorDe13() ? 'bg-slate-800' : 'bg-orange-500/10'}`}>
                <BrainCircuit size={20} className={!eMaiorDe13() ? 'text-slate-600' : 'text-orange-500'} />
              </div>
              <div>
                <h4 className="font-bold text-sm flex items-center gap-2">LabAI { !eMaiorDe13() && <span className="bg-red-500/10 text-red-500 text-[8px] px-2 py-0.5 rounded-md">Bloqueado</span> }</h4>
                <p className="text-[10px] text-slate-500 uppercase font-black">Consentimento Parental para IA</p>
              </div>
            </div>
            {eMaiorDe13() ? (
              <button type="button" onClick={() => setConsentimentoIa(!consentimentoIa)} className={`transition-colors ${consentimentoIa ? 'text-orange-500' : 'text-slate-700'}`}>
                {consentimentoIa ? <ToggleRight size={40} /> : <ToggleLeft size={40} />}
              </button>
            ) : ( <div className="text-slate-700"><ShieldAlert size={32} /></div> )}
          </div>
        </div>

        <button type="submit" disabled={saving || uploading} className="w-full bg-blue-600 hover:bg-blue-500 text-white p-5 rounded-2xl font-black flex items-center justify-center gap-3 transition-all active:scale-[0.98] disabled:opacity-50 shadow-xl shadow-blue-500/10">
          {saving ? <Loader2 className="animate-spin" /> : <Save size={20} />}
          {saving ? 'A ATUALIZAR...' : 'GRAVAR ALTERAÇÕES'}
        </button>
      </form>
    </main>
  );
}

export default function EditarAluno() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>}>
      <EditarAlunoContent />
    </Suspense>
  );
}