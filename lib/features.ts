// Único interruptor do módulo LabAI. Reativar é só mudar esta linha para
// true — mas só depois de resolver tudo o que está em LABAI_PENDENTE.md na
// raiz do repositório (segurança da rota, SSRF, rate limit, Storage).
export const LAB_AI_ATIVO = false;

// Recuperação de password por email ("Esqueci-me da password" no login,
// /recuperar). O serviço de email do Supabase do projeto (sem SMTP próprio)
// só entrega a membros da equipa do projeto e está limitado a 2
// mensagens/hora — nunca chega a alunos nem a encarregados, mas
// resetPasswordForEmail não dava erro nenhum (falha silenciosa: a página
// dizia "Email Enviado!" e nada chegava). Enquanto isto estiver a false,
// nem se pede o email nem se chama o Supabase Auth — só se diz para pedir
// ao centro. Ligar só depois de haver SMTP próprio configurado no projeto.
export const RECUPERAR_POR_EMAIL_ATIVO = false;
