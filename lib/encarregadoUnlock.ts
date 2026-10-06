import { supabase } from '@/lib/supabase';

/**
 * Estado do desbloqueio da Área dos Encarregados — SÓ em memória do browser,
 * nunca localStorage/sessionStorage (decisão de segurança: o bloqueio é no
 * ecrã, mas não deve sobreviver a um reload nem a uma troca de aba/utilizador).
 *
 * Ligado ao id do utilizador (unlockedForUserId), não só a um booleano: se um
 * irmão entrar no mesmo separador sem recarregar, isUnlocked() com o id do
 * novo utilizador já dá false sozinho, porque o id guardado é o do anterior.
 *
 * Só deve ser lido/escrito dentro de efeitos ou handlers em componentes
 * 'use client' — nunca durante render do servidor (este módulo é partilhado
 * por todos os pedidos no servidor, por isso teria o mesmo estado para
 * utilizadores diferentes se fosse lido aí).
 *
 * O bloqueio automático tem 3 camadas, porque nenhuma delas sozinha chega:
 * 1. setTimeout (rede de segurança) — dispara ao fim de INATIVIDADE_MS desde
 *    o último touch(), mas atrasa-se em separadores em segundo plano (o
 *    browser trava/atrasa timers nesse estado).
 *  2. Listeners passivos de atividade (pointerdown/keydown/touchstart/scroll)
 *     enquanto desbloqueado — chamam touch() com throttle de 5s, para o
 *     setTimeout nunca disparar enquanto a família está mesmo a usar o ecrã.
 *  3. visibilitychange/focus — ao voltar a um separador em segundo plano ou
 *     à janela, confere lastActivityAt contra o relógio real; se já passou
 *     INATIVIDADE_MS, bloqueia mesmo que o setTimeout atrasado ainda não
 *     tenha disparado.
 *
 * subscribe(cb) existe porque lock() por si só não re-renderiza nada — é só
 * uma variável de módulo. As páginas subscrevem para saber IMEDIATAMENTE
 * quando bloquear o que têm no estado React.
 */

const INATIVIDADE_MS_PADRAO = 10 * 60 * 1000; // 10 minutos

export const INATIVIDADE_MS = (() => {
  if (process.env.NODE_ENV === 'production') return INATIVIDADE_MS_PADRAO;
  // Só fora de produção — para testar o bloqueio sem esperar 10 minutos.
  const override = Number(process.env.NEXT_PUBLIC_ENCARREGADO_IDLE_MS);
  return Number.isFinite(override) && override > 0 ? override : INATIVIDADE_MS_PADRAO;
})();

const THROTTLE_ATIVIDADE_MS = 5000;

type Subscritor = () => void;

let unlockedForUserId: string | null = null;
let lastActivityAt = 0;
let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
let lastThrottledTouchAt = 0;
let listenerLogoutRegistado = false;
let listenersAtividadeAtivos = false;
const subscritores = new Set<Subscritor>();

function limparTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
}

function notificarSubscritores() {
  subscritores.forEach((cb) => cb());
}

// Handler dos eventos passivos — throttle próprio, para não chamar touch()
// (e recriar o setTimeout) em cada pixel de scroll ou tecla.
function handleAtividade() {
  const agora = Date.now();
  if (agora - lastThrottledTouchAt < THROTTLE_ATIVIDADE_MS) return;
  lastThrottledTouchAt = agora;
  touch();
}

// visibilitychange/focus: corrige o atraso de timers em separadores em
// segundo plano, comparando o relógio real em vez de confiar só no setTimeout.
function handleVerificarInatividadeReal() {
  if (!unlockedForUserId) return;
  if (Date.now() - lastActivityAt > INATIVIDADE_MS) lock();
}

function registarListenersAtividade() {
  if (listenersAtividadeAtivos || typeof window === 'undefined') return;
  listenersAtividadeAtivos = true;
  window.addEventListener('pointerdown', handleAtividade, { passive: true });
  window.addEventListener('keydown', handleAtividade, { passive: true });
  window.addEventListener('touchstart', handleAtividade, { passive: true });
  window.addEventListener('scroll', handleAtividade, { passive: true });
  document.addEventListener('visibilitychange', handleVerificarInatividadeReal);
  window.addEventListener('focus', handleVerificarInatividadeReal);
}

function removerListenersAtividade() {
  if (!listenersAtividadeAtivos || typeof window === 'undefined') return;
  listenersAtividadeAtivos = false;
  window.removeEventListener('pointerdown', handleAtividade);
  window.removeEventListener('keydown', handleAtividade);
  window.removeEventListener('touchstart', handleAtividade);
  window.removeEventListener('scroll', handleAtividade);
  document.removeEventListener('visibilitychange', handleVerificarInatividadeReal);
  window.removeEventListener('focus', handleVerificarInatividadeReal);
}

// Registado só na primeira vez que alguém desbloqueia (nunca à importação do
// módulo, que pode acontecer no servidor) — limpa o desbloqueio no logout,
// mesmo que seja o mesmo utilizador a entrar de novo a seguir.
function garantirListenerLogout() {
  if (listenerLogoutRegistado) return;
  listenerLogoutRegistado = true;
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') lock();
  });
}

export function isUnlocked(userId: string | null | undefined): boolean {
  return !!userId && unlockedForUserId === userId;
}

export function unlock(userId: string): void {
  garantirListenerLogout();
  unlockedForUserId = userId;
  registarListenersAtividade();
  touch();
}

export function lock(notificar: boolean = true): void {
  unlockedForUserId = null;
  limparTimer();
  removerListenersAtividade();
  if (notificar) notificarSubscritores();
}

/** Reinicia a janela de inatividade — chamar a cada ação dentro da área já desbloqueada. */
export function touch(): void {
  if (!unlockedForUserId) return;
  lastActivityAt = Date.now();
  limparTimer();
  inactivityTimer = setTimeout(() => { lock(); }, INATIVIDADE_MS);
}

/** Avisa quando lock() acontece (por inatividade, logout, ou botão Bloquear). Devolve a função para cancelar a subscrição. */
export function subscribe(cb: Subscritor): () => void {
  subscritores.add(cb);
  return () => { subscritores.delete(cb); };
}
