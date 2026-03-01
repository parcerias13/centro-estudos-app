import { createBrowserClient } from '@supabase/ssr'

// Criação do cliente que sabe lidar com Cookies
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
