import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const ROLE_ALLOWED_PATHS: Record<string, string[]> = {
  professor: ['/admin/notas', '/admin/agenda', '/admin/disciplinas', '/admin/explicacoes'],
  secretaria: ['/admin/alunos', '/admin/notas', '/admin/agenda', '/admin/refeitorio', '/admin/historico', '/admin/relatorio', '/admin/mensagens'],
}

// Caminhos que um papel só pode ver exatamente (nunca subcaminhos) — para o
// professor não arrastar /admin/alunos/editar, /extrato ou /novo só por
// partilharem o prefixo de /admin/alunos. Mensalidade, preços e contactos do
// encarregado vivem todos fora destes três.
const ROLE_ALLOWED_EXACT_PATHS: Record<string, string[]> = {
  professor: ['/admin/alunos', '/admin/alunos/ficha', '/admin/relatorio'],
}

function isPathAllowed(pathname: string, allowedPaths: string[], allowedExactPaths: string[] = []) {
  // "/admin" (raiz, dashboard) é sempre permitido a qualquer role reconhecido
  if (pathname === '/admin') return true
  if (allowedExactPaths.includes(pathname)) return true
  return allowedPaths.some(
    (allowed) => pathname === allowed || pathname.startsWith(allowed + '/')
  )
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: any) {
          request.cookies.set({ name, value, ...options })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: any) {
          request.cookies.set({ name, value: '', ...options })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  // Recupera o utilizador atual para validar a sessão
  const { data: { user } } = await supabase.auth.getUser()

  // LÓGICA DE REDIRECIONAMENTO
  // Se não houver utilizador e não estiver na página de login ou na de recuperar password, força o redirecionamento
  if (!user && !request.nextUrl.pathname.startsWith('/login') && !request.nextUrl.pathname.startsWith('/recuperar')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // LabAI desativado (lib/features.ts) — /aluno/lab e subcaminhos nunca
  // carregam, para nenhum papel. Ver LABAI_PENDENTE.md antes de reativar.
  if (request.nextUrl.pathname === '/aluno/lab' || request.nextUrl.pathname.startsWith('/aluno/lab/')) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Verificação de role para /admin/* via JWT (app_metadata) — sem query à base de dados
  if (user && request.nextUrl.pathname.startsWith('/admin')) {
    const role = user.app_metadata?.role?.toLowerCase()

    if (role === 'admin') {
      // acesso total
    } else if (role === 'professor' || role === 'secretaria') {
      if (!isPathAllowed(request.nextUrl.pathname, ROLE_ALLOWED_PATHS[role], ROLE_ALLOWED_EXACT_PATHS[role])) {
        // Um subcaminho bloqueado de /admin/alunos (editar, extrato, novo)
        // volta para a lista, não para o dashboard — é de lá que se chegou.
        const destino = request.nextUrl.pathname.startsWith('/admin/alunos/') ? '/admin/alunos' : '/admin'
        return NextResponse.redirect(new URL(destino, request.url))
      }
    } else {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Aplica-se a todas as rotas exceto:
     * - api routes
     * - _next/static (ficheiros estáticos)
     * - _next/image (otimização de imagem)
     * - favicon.ico e imagens (svg, png, etc.)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}