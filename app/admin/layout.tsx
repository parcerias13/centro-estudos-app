'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { LayoutDashboard, Users, Calendar, Utensils, History, BookOpen, BarChart3, Shield, Settings, X, Menu, LogOut } from 'lucide-react'

const ROLE_ALLOWED_MENU: Record<string, string[]> = {
  professor: ['Dashboard', 'Alunos', 'Agenda', 'Disciplinas e Materiais'],
  secretaria: ['Dashboard', 'Alunos', 'Agenda', 'Refeitório', 'Histórico'],
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setRole(user?.app_metadata?.role?.toLowerCase() ?? null)
    })
  }, [])

  // Lista de items atualizada com Refeitório
  const menuItems = [
    { name: 'Dashboard', href: '/admin', icon: LayoutDashboard },
    { name: 'Alunos', href: '/admin/alunos', icon: Users },
    { name: 'Agenda', href: '/admin/agenda', icon: Calendar },
    { name: 'Refeitório', href: '/admin/refeitorio', icon: Utensils }, // Novo item
    { name: 'Histórico', href: '/admin/historico', icon: History },
    { name: 'Disciplinas e Materiais', href: '/admin/disciplinas', icon: BookOpen },
    { name: 'Performance', href: '/admin/performance', icon: BarChart3 },
    { name: 'Equipa', href: '/admin/equipa', icon: Shield },
    { name: 'Gestão', href: '/admin/gestao', icon: Settings },
  ]

  const visibleMenuItems =
    role === 'admin'
      ? menuItems
      : role && ROLE_ALLOWED_MENU[role]
        ? menuItems.filter((item) => ROLE_ALLOWED_MENU[role].includes(item.name))
        : []

  return (
    <div className="flex min-h-screen bg-page">
      
      {/* Overlay Mobile */}
      {isMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setIsMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        ${isMenuOpen ? 'flex' : 'hidden'} 
        md:flex w-64 bg-raised border-r border-border flex-col fixed h-full shadow-2xl z-50 transition-all duration-300
      `}>
        <div className="p-6 border-b border-border/50 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-primary tracking-tighter italic">
              Cogni<span className="text-accent">Lab</span>
            </h2>
            <p className="text-[10px] text-muted font-bold uppercase tracking-widest mt-1">Gestão de Performance</p>
          </div>
          <button onClick={() => setIsMenuOpen(false)} className="md:hidden text-primary"><X size={24} /></button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar">
          {visibleMenuItems.map((item) => (
            <Link 
              key={item.href}
              href={item.href} 
              onClick={() => setIsMenuOpen(false)}
              className="flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group text-secondary hover:text-primary hover:bg-raised"
            >
              <item.icon size={18} className="shrink-0 group-hover:scale-110 transition-transform" />
              <span className="text-sm font-medium">{item.name}</span>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-border bg-raised/50">
          <Link href="/login" className="flex items-center gap-2 text-xs text-muted hover:text-danger transition font-bold uppercase tracking-tighter">
            <LogOut size={14} /> Terminar Sessão
          </Link>
        </div>
      </aside>

      {/* Conteúdo Principal */}
      <main className="flex-1 md:ml-64 min-h-screen w-full">
        {/* Header Mobile */}
        <header className="md:hidden bg-raised p-4 border-b border-border flex justify-between items-center sticky top-0 z-30">
          <h2 className="text-lg font-black text-primary italic">
            Cogni<span className="text-accent">Lab</span>
          </h2>
          <button
            onClick={() => setIsMenuOpen(true)}
            className="text-primary p-2 hover:bg-raised rounded-lg transition"
          >
            <Menu size={24} />
          </button>
        </header>

        <div className="p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}