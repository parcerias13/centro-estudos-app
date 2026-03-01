import Link from 'next/link'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
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
      {/* Sidebar - Menu Lateral Fixo */}
      <aside className="w-64 bg-[#1e293b] border-r border-slate-800 flex flex-col fixed h-full shadow-2xl">
        <div className="p-6 border-b border-slate-800/50">
          <h2 className="text-xl font-black text-white tracking-tighter italic">
            CENTRO<span className="text-blue-500">AI</span>
          </h2>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Gestão de Performance</p>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar">
          {menuItems.map((item) => (
            <Link 
              key={item.href}
              href={item.href} 
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

      {/* Área de Conteúdo Principal */}
      <main className="flex-1 ml-64 min-h-screen">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  )
}