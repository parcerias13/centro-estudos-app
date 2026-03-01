'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Shield, Plus, Trash2, Loader2, Save, Mail, User } from 'lucide-react';

export default function AdminTeam() {
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Formulário
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Explicador');

  useEffect(() => {
    fetchTeam();
  }, []);

  const fetchTeam = async () => {
    const { data } = await supabase.from('staff').select('*').order('name');
    if (data) setTeam(data);
    setLoading(false);
  };

  const handleAdd = async (e: any) => {
    e.preventDefault();
    if (!email || !name) return;
    setSubmitting(true);

    const { error } = await supabase.from('staff').insert({
      email: email.toLowerCase().trim(),
      name,
      role
    });

    if (error) {
      alert('Erro: ' + error.message);
    } else {
      setName('');
      setEmail('');
      fetchTeam();
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este membro da equipa? Ele deixará de ter acesso ao Admin.')) return;
    await supabase.from('staff').delete().eq('id', id);
    fetchTeam();
  };

  if (loading) return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6 max-w-5xl mx-auto">
      
      {/* CABEÇALHO */}
      <div className="flex items-center gap-4 mb-8">
        <Link href="/admin" className="bg-slate-900 p-3 rounded-xl hover:bg-slate-800 transition-colors border border-slate-800">
          <ArrowLeft size={20} className="text-slate-400" />
        </Link>
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Shield className="text-indigo-500" />
            Gestão de Equipa
          </h1>
          <p className="text-slate-500 text-xs">Quem tem a chave do centro?</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        
        {/* COLUNA 1: ADICIONAR STAFF */}
        <div className="md:col-span-1 bg-slate-900 border border-slate-800 p-6 rounded-2xl h-fit">
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2 text-white">
            <Plus size={20} className="text-green-500" /> Novo Membro
          </h2>
          
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase ml-1">Nome</label>
              <div className="relative">
                <User className="absolute left-3 top-3.5 text-slate-500" size={16} />
                <input 
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Maria Santos"
                    className="w-full bg-slate-950 border border-slate-800 text-white pl-10 pr-3 py-3 rounded-xl outline-none focus:border-indigo-500"
                    required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase ml-1">Email de Acesso</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3.5 text-slate-500" size={16} />
                <input 
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@gmail.com"
                    className="w-full bg-slate-950 border border-slate-800 text-white pl-10 pr-3 py-3 rounded-xl outline-none focus:border-indigo-500"
                    required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase ml-1">Cargo</label>
              <select 
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-white p-3 rounded-xl outline-none focus:border-indigo-500"
              >
                <option value="Explicador">Explicador</option>
                <option value="Secretaria">Secretaria</option>
                <option value="Gerente">Gerente</option>
                <option value="Admin">Admin</option>
              </select>
            </div>

            <button 
              type="submit" 
              disabled={submitting}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition-all active:scale-95 shadow-lg shadow-indigo-900/20 flex items-center justify-center gap-2 mt-4"
            >
              {submitting ? <Loader2 className="animate-spin" /> : <><Save size={18} /> Dar Acesso</>}
            </button>
          </form>
        </div>

        {/* COLUNA 2: LISTA DE EQUIPA */}
        <div className="md:col-span-2 space-y-3">
          <h3 className="text-slate-500 font-bold uppercase text-xs tracking-wider mb-2">Equipa Ativa ({team.length})</h3>
          
          {team.map((member) => (
            <div key={member.id} className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex justify-between items-center group hover:border-slate-700 transition-all">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${
                    member.role === 'Admin' || member.role === 'CEO' ? 'bg-indigo-600' : 'bg-slate-700'
                }`}>
                  {member.name.charAt(0)}
                </div>
                <div>
                  <h4 className="font-bold text-white">{member.name}</h4>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>{member.email}</span>
                      <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                      <span className="text-indigo-400 font-bold uppercase">{member.role}</span>
                  </div>
                </div>
              </div>
              
              <button 
                onClick={() => handleDelete(member.id)}
                className="p-2 text-slate-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                title="Remover acesso"
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