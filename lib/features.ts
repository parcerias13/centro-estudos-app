// Único interruptor do módulo LabAI. Reativar é só mudar esta linha para
// true — mas só depois de resolver tudo o que está em LABAI_PENDENTE.md na
// raiz do repositório (segurança da rota, SSRF, rate limit, Storage).
export const LAB_AI_ATIVO = false;

// Aviso por email (curto, sem dados do aluno) de que há um novo relatório
// mensal na Área dos Encarregados. A rota /api/admin/relatorio-mensal/avisar
// já está implementada e funcional — fica só à espera de 1) o domínio do
// Resend estar verificado para o centro e 2) NEXT_PUBLIC_APP_URL estar
// definido em produção. Com isto a false, a página nem mostra a opção.
export const EMAIL_RELATORIO_ATIVO = false;

// Recuperação de password por email ("Esqueci-me da password" no login,
// /recuperar). O serviço de email do Supabase do projeto (sem SMTP próprio)
// só entrega a membros da equipa do projeto e está limitado a 2
// mensagens/hora — nunca chega a alunos nem a encarregados, mas
// resetPasswordForEmail não dava erro nenhum (falha silenciosa: a página
// dizia "Email Enviado!" e nada chegava). Enquanto isto estiver a false,
// nem se pede o email nem se chama o Supabase Auth — só se diz para pedir
// ao centro. Ligar só depois de haver SMTP próprio configurado no projeto.
export const RECUPERAR_POR_EMAIL_ATIVO = false;
