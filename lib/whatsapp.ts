import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Mesmo URL/mensagem que app/admin/page.tsx sempre construiu para o WhatsApp
 * (Msg In / Msg Out) — extraído para aqui para a Lista do Dia poder usar a
 * mesma mensagem ao abrir o separador de forma síncrona (ver marcarMensagemEnviada).
 */
export function urlWhatsApp(telefone: string, nome: string, tipo: 'entrada' | 'saida'): string {
  const numApenasNumeros = telefone.replace(/\D/g, '');
  const numFinal = numApenasNumeros.startsWith('351') ? numApenasNumeros : `351${numApenasNumeros}`;
  const msg =
    tipo === 'entrada'
      ? `Olá! Informamos que o(a) aluno(a) ${nome} deu entrada no Centro de Estudos! 📚`
      : `Olá! Informamos que o(a) aluno(a) ${nome} concluiu a sua sessão de estudo!`;
  return `https://wa.me/${numFinal}?text=${encodeURIComponent(msg)}`;
}

/** Marca msg_in_enviada/msg_out_enviada em diario_bordo. Devolve a mensagem de erro, ou null em sucesso. */
export async function marcarMensagemEnviada(
  supabase: SupabaseClient,
  presencaId: string,
  tipo: 'entrada' | 'saida'
): Promise<string | null> {
  const updateData = tipo === 'entrada' ? { msg_in_enviada: true } : { msg_out_enviada: true };
  const { error } = await supabase.from('diario_bordo').update(updateData).eq('id', presencaId);
  return error ? error.message : null;
}
