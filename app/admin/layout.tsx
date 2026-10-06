'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { subscreverMensagensLidas } from '@/lib/eventoMensagensAdmin'
import { LayoutDashboard, Users, Calendar, Utensils, History, BookOpen, BarChart3, Wallet, GraduationCap, Shield, Settings, X, Menu, LogOut, MessageCircle } from 'lucide-react'

const ROLE_ALLOWED_MENU: Record<string, string[]> = {
  professor: ['Dashboard', 'Alunos', 'Agenda', 'Disciplinas e Materiais', 'Explicações'],
  secretaria: ['Dashboard', 'Alunos', 'Agenda', 'Refeitório', 'Histórico', 'Mensagens'],
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [centroId, setCentroId] = useState<string | null>(null)
  const [pendentesNotas, setPendentesNotas] = useState(0)
  const [mensagensNaoLidas, setMensagensNaoLidas] = useState(0)
  const pathname = usePathname()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setRole(user?.app_metadata?.role?.toLowerCase() ?? null)
      setCentroId(user?.app_metadata?.centro_id ?? null)
    })
  }, [])

  // Badge "Mensagens" na sidebar — só conta mensagens da família ainda não
  // lidas pelo centro, do próprio centro do utilizador (nunca de outro).
  // Atualiza-se ao ganhar foco, a cada 30s enquanto o separador está
  // visível, e imediatamente quando a página de Mensagens marca conversas
  // como lidas (evento partilhado, sem acoplar as duas páginas).
  const carregarBadgeMensagens = useCallback(async (centro_id: string) => {
    const { count } = await supabase
      .from('mensagens')
      .select('id', { count: 'exact', head: true })
      .eq('centro_id', centro_id)
      .eq('autor', 'familia')
      .is('lida_pelo_centro_em', null)
    setMensagensNaoLidas(count || 0)
  }, [])

  useEffect(() => {
    if ((role !== 'admin' && role !== 'secretaria') || !centroId) return

    carregarBadgeMensagens(centroId)

    const aoFocar = () => carregarBadgeMensagens(centroId)
    window.addEventListener('focus', aoFocar)

    let intervalo: ReturnType<typeof setInterval> | null = null
    const geriIntervalo = () => {
      if (document.visibilityState === 'visible') {
        if (!intervalo) intervalo = setInterval(() => carregarBadgeMensagens(centroId), 30000)
      } else if (intervalo) {
        clearInterval(intervalo)
        intervalo = null
      }
    }
    geriIntervalo()
    document.addEventListener('visibilitychange', geriIntervalo)

    const cancelarEvento = subscreverMensagensLidas(() => carregarBadgeMensagens(centroId))

    return () => {
      window.removeEventListener('focus', aoFocar)
      document.removeEventListener('visibilitychange', geriIntervalo)
      if (intervalo) clearInterval(intervalo)
      cancelarEvento()
    }
  }, [role, centroId, carregarBadgeMensagens])

  // Aviso "N por confirmar" junto a Alunos — só quem pode confirmar (admin,
  // professor) precisa de ver isto. Fica fora da Agenda por decisão: notas
  // vivem só na Ficha do Aluno.
  useEffect(() => {
    if (role !== 'admin' && role !== 'professor') return
    let cancelado = false
    ;(async () => {
      const [{ count: examsCount }, { count: periodoCount }] = await Promise.all([
        supabase.from('exams').select('id', { count: 'exact', head: true }).eq('nota_confirmada', false).not('nota_valor', 'is', null),
        supabase.from('notas_periodo').select('id', { count: 'exact', head: true }).eq('nota_confirmada', false),
      ])
      if (!cancelado) setPendentesNotas((examsCount || 0) + (periodoCount || 0))
    })()
    return () => { cancelado = true }
  }, [role])

  // Lista de items atualizada com Refeitório
  const menuItems = [
    { name: 'Dashboard', href: '/admin', icon: LayoutDashboard },
    { name: 'Alunos', href: '/admin/alunos', icon: Users },
    { name: 'Agenda', href: '/admin/agenda', icon: Calendar },
    { name: 'Refeitório', href: '/admin/refeitorio', icon: Utensils }, // Novo item
    { name: 'Histórico', href: '/admin/historico', icon: History },
    { name: 'Mensagens', href: '/admin/mensagens', icon: MessageCircle },
    { name: 'Disciplinas e Materiais', href: '/admin/disciplinas', icon: BookOpen },
    { name: 'Explicações', href: '/admin/explicacoes', icon: GraduationCap },
    { name: 'Performance', href: '/admin/performance', icon: BarChart3 },
    { name: 'Pagamentos', href: '/admin/pagamentos', icon: Wallet },
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
        md:flex w-64 bg-sidebar-bg border-r border-white/10 flex-col fixed h-full shadow-2xl z-50 transition-all duration-300
      `}>
        <div className="p-6 border-b border-white/10 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-sidebar-text tracking-tighter italic">
              Cogni<span className="text-sidebar-accent">Lab</span>
            </h2>
          </div>
          <button onClick={() => setIsMenuOpen(false)} className="md:hidden text-sidebar-text"><X size={24} /></button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar">
          {visibleMenuItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/admin' && pathname?.startsWith(item.href + '/'))
            const badge = item.name === 'Alunos' && pendentesNotas > 0
              ? pendentesNotas
              : item.name === 'Mensagens' && mensagensNaoLidas > 0
                ? mensagensNaoLidas
                : null
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsMenuOpen(false)}
                title={badge !== null ? (item.name === 'Mensagens' ? `${badge} mensagem(ns) por ler` : `${badge} nota(s) por confirmar`) : undefined}
                className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group ${
                  isActive ? 'bg-white/10 text-sidebar-text' : 'text-sidebar-text-secondary hover:text-sidebar-text hover:bg-white/5'
                }`}
              >
                <item.icon size={18} className="shrink-0 group-hover:scale-110 transition-transform" />
                <span className="text-sm font-medium flex-1">{item.name}</span>
                {badge !== null && (
                  <span className="bg-danger text-on-danger text-[10px] font-black min-w-5 h-5 px-1.5 rounded-full shrink-0 flex items-center justify-center">
                    {badge}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-white/10">
          <Link href="/login" className="flex items-center gap-2 text-xs text-sidebar-text-secondary hover:text-danger transition font-bold uppercase tracking-tighter">
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