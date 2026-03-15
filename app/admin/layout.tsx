'use client' // Necessário se estiveres a usar Next.js App Router

import Link from 'next/link'
import { useState } from 'react'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // 1. O "Cérebro": Estado para saber se o menu está aberto
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const menuItems = [
    { name: 'Dashboard', href: '/admin', icon: '📈' },
    { name: 'Check-in Diário', href: '/admin/checkin', icon: '📍', highlight: true },
    { name: 'Agenda', href: '/admin/agenda', icon: '📅' },
    { name: 'Alunos', href: '/admin/alunos', icon: '👥' },
    { name: 'Histórico', href: '/admin/historico', icon: '📜' },
    { name: 'Disciplinas', href: '/admin/disciplinas', icon: '📚' },
    { name: 'Estatísticas', href: '/admin/estatisticas', icon: '📊' },
    { name: 'Biblioteca', href: '/admin/biblioteca', icon: '📖' },
    { name: 'Equipa', href: '/admin/equipa', icon: '🛡️' },
  ]

  return (
    <div className="flex min-h-screen bg-[#0f172a]">
      
      {/* 2. Overlay (Fundo escuro) - Só aparece no telemóvel quando o menu abre */}
      {isMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setIsMenuOpen(false)}
        />
      )}

      {/* 3. Sidebar - Agora controlado pelo estado isMenuOpen */}
      <aside className={`
        ${isMenuOpen ? 'flex' : 'hidden'} 
        md:flex w-64 bg-[#1e293b] border-r border-slate-800 flex-col fixed h-full shadow-2xl z-50 transition-all duration-300
      `}>
        <div className="p-6 border-b border-slate-800/50 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-white tracking-tighter italic">
              CENTRO<span className="text-blue-500">AI</span>
            </h2>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Gestão de Performance</p>
          </div>
          {/* Botão para fechar no telemóvel */}
          <button onClick={() => setIsMenuOpen(false)} className="md:hidden text-white text-2xl">✕</button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar">
          {menuItems.map((item) => (
            <Link 
              key={item.href}
              href={item.href} 
              onClick={() => setIsMenuOpen(false)} // Fecha o menu ao clicar num link
              className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group
                ${item.highlight 
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20 hover:bg-blue-600/20' 
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              <span className="text-lg group-hover:scale-120 transition-transform">{item.icon}</span>
              <span className={`text-sm ${item.highlight ? 'font-bold' : 'font-medium'}`}>{item.name}</span>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800 bg-[#1e293b]/50">
          <Link href="/login" className="flex items-center gap-2 text-xs text-slate-500 hover:text-red-400 transition font-bold uppercase tracking-tighter">
            <span>🚪</span> Terminar Sessão
          </Link>
        </div>
      </aside>

      {/* 4. Conteúdo Principal */}
      <main className="flex-1 md:ml-64 min-h-screen w-full">
        {/* Header Mobile com o botão que FUNCIONA agora */}
        <header className="md:hidden bg-[#1e293b] p-4 border-b border-slate-800 flex justify-between items-center sticky top-0 z-30">
          <h2 className="text-lg font-black text-white italic">
            CENTRO<span className="text-blue-500">AI</span>
          </h2>
          <button 
            onClick={() => setIsMenuOpen(true)} // Liga o menu
            className="text-2xl text-white p-2 hover:bg-slate-800 rounded-lg transition"
          >
            ☰
          </button> 
        </header>

        <div className="p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}