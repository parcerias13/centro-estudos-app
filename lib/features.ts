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
