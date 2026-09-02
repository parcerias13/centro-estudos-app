'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Shield, Plus, Trash2, Loader2, Save, Mail, User, Lock } from 'lucide-react';

export default function AdminTeam() {
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Formulário
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Explicador');
  const [password, setPassword] = useState(''); // ESTADO MOVIDO PARA DENTRO

  const fetchTeam = async () => {
    const { data } = await supabase.from('staff').select('*').order('name');
    if (data) setTeam(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchTeam();
  }, []);

  const getAdminContext = async (): Promise<{ centro_id: string } | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    const role_meta = user?.app_metadata?.role;
    const centro_id = user?.app_metadata?.centro_id;

    if (role_meta?.toLowerCase() !== 'admin') {
      setFormError('Sem permissões de administrador para esta ação.');
      return null;
    }
    if (!centro_id) {
      setFormError('Não foi possível obter o centro. Recarrega a página.');
      return null;
    }
    return { centro_id };
  };

  const handleAdd = async (e: any) => {
    e.preventDefault();
    if (!email || !name || !password) return;
    setFormError(null);
    setSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    const centro_id = user?.app_metadata?.centro_id;

    const res = await fetch('/api/admin/criar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.toLowerCase().trim(),
        password,
        name,
        role,
        centro_id,
      }),
    });

    const result = await res.json();

    if (!res.ok) {
      setFormError(result.error || 'Erro ao criar membro da equipa.');
    } else {
      setName('');
      setEmail('');
      setPassword('');
      fetchTeam();
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este membro da equipa? Ele deixará de ter acesso ao Admin.')) return;
    setFormError(null);

    const ctx = await getAdminContext();
    if (!ctx) return;

    await supabase.from('staff').delete().eq('id', id);
    fetchTeam();
  };

  if (loading) return <div className="min-h-screen bg-page flex items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>;

  return (
    <main className="min-h-screen bg-page text-primary p-6 max-w-5xl mx-auto">
      
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="bg-surface p-3 rounded-xl hover:bg-raised transition-colors border border-border">
          <ArrowLeft size={20} className="text-secondary" />
        </Link>
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Shield className="text-indigo-500" />
            Gestão de Equipa
          </h1>
          <p className="text-muted text-xs">Quem tem a chave do centro?</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        
        <div className="md:col-span-1 bg-surface border border-border p-6 rounded-2xl h-fit">
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2 text-primary">
            <Plus size={20} className="text-green-500" /> Novo Membro
          </h2>
          
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Nome</label>
              <div className="relative">
                <User className="absolute left-3 top-3.5 text-muted" size={16} />
                <input 
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Maria Santos"
                    className="w-full bg-page border border-border text-primary pl-10 pr-3 py-3 rounded-xl outline-none focus:border-indigo-500"
                    required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Email de Acesso</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3.5 text-muted" size={16} />
                <input 
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@gmail.com"
                    className="w-full bg-page border border-border text-primary pl-10 pr-3 py-3 rounded-xl outline-none focus:border-indigo-500"
                    required
                />
              </div>
            </div>

            {/* CAMPO DA PASSWORD ADICIONADO NO LOCAL CORRETO */}
            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Password Provisória</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3.5 text-muted" size={16} />
                <input 
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full bg-page border border-border text-primary pl-10 pr-3 py-3 rounded-xl outline-none focus:border-indigo-500"
                    required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-muted uppercase ml-1">Cargo</label>
              <select 
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-page border border-border text-primary p-3 rounded-xl outline-none focus:border-indigo-500"
              >
                <option value="Explicador">Explicador</option>
                <option value="Secretaria">Secretaria</option>
                <option value="Gerente">Gerente</option>
                <option value="Admin">Admin</option>
              </select>
            </div>

            {formError && (
              <p className="text-danger text-[11px] font-bold px-1">{formError}</p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-primary font-bold py-3 rounded-xl transition-all active:scale-95 shadow-lg shadow-indigo-900/20 flex items-center justify-center gap-2 mt-4"
            >
              {submitting ? <Loader2 className="animate-spin" /> : <><Save size={18} /> Dar Acesso</>}
            </button>
          </form>
        </div>

        <div className="md:col-span-2 space-y-3">
          <h3 className="text-muted font-bold uppercase text-xs tracking-wider mb-2">Equipa Ativa ({team.length})</h3>
          
          {team.map((member) => (
            <div key={member.id} className="bg-surface border border-border p-4 rounded-xl flex justify-between items-center group hover:border-border transition-all">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-primary ${
                    member.role === 'Admin' || member.role === 'CEO' ? 'bg-indigo-600' : 'bg-border'
                }`}>
                  {member.name.charAt(0)}
                </div>
                <div>
                  <h4 className="font-bold text-primary">{member.name}</h4>
                  <div className="flex items-center gap-2 text-xs text-secondary">
                      <span>{member.email}</span>
                      <span className="w-1 h-1 rounded-full bg-border"></span>
                      <span className="text-indigo-400 font-bold uppercase">{member.role}</span>
                  </div>
                </div>
              </div>
              
              <button 
                onClick={() => handleDelete(member.id)}
                className="p-2 text-muted hover:text-danger hover:bg-danger-bg rounded-lg transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}