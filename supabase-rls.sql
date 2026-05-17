[
  {
    "tablename": "aluno_horarios",
    "policyname": "aluno_horarios_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "alunos",
    "policyname": "alunos_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "alunos",
    "policyname": "Permitir_Tudo_Alunos",
    "cmd": "ALL",
    "qual": "true"
  },
  {
    "tablename": "atividades_estudo",
    "policyname": "atividades_estudo_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "config_centro",
    "policyname": "Allow update for authenticated users",
    "cmd": "UPDATE",
    "qual": "true"
  },
  {
    "tablename": "config_centro",
    "policyname": "Allow select for authenticated users",
    "cmd": "SELECT",
    "qual": "true"
  },
  {
    "tablename": "consumos_diarios",
    "policyname": "consumos_diarios_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "diario_bordo",
    "policyname": "Permitir_Tudo_Diario_Bordo",
    "cmd": "ALL",
    "qual": "true"
  },
  {
    "tablename": "diario_bordo",
    "policyname": "diario_bordo_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "exams",
    "policyname": "Admin vê todos os exames",
    "cmd": "SELECT",
    "qual": "true"
  },
  {
    "tablename": "exams",
    "policyname": "Demo: Permitir tudo",
    "cmd": "ALL",
    "qual": "true"
  },
  {
    "tablename": "exams",
    "policyname": "Permitir tudo temporariamente",
    "cmd": "ALL",
    "qual": "true"
  },
  {
    "tablename": "exams",
    "policyname": "exams_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "ia_logs",
    "policyname": "ia_logs_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "pacote_escaloes",
    "policyname": "pacote_escaloes_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "pacotes",
    "policyname": "pacotes_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "resources",
    "policyname": "resources_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "resources",
    "policyname": "Acesso Total para Autenticados",
    "cmd": "ALL",
    "qual": "true"
  },
  {
    "tablename": "salas",
    "policyname": "salas_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "servicos",
    "policyname": "servicos_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "staff",
    "policyname": "Allow select for staff",
    "cmd": "SELECT",
    "qual": "true"
  },
  {
    "tablename": "staff",
    "policyname": "Staff can read own data",
    "cmd": "SELECT",
    "qual": "(auth.uid() = id)"
  },
  {
    "tablename": "staff",
    "policyname": "Gestão de Staff",
    "cmd": "ALL",
    "qual": "true"
  },
  {
    "tablename": "staff",
    "policyname": "Leitura de Staff",
    "cmd": "SELECT",
    "qual": "true"
  },
  {
    "tablename": "staff",
    "policyname": "staff_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "subjects",
    "policyname": "subjects_centro",
    "cmd": "ALL",
    "qual": "(centro_id = get_centro_id())"
  },
  {
    "tablename": "subjects",
    "policyname": "Ver disciplinas",
    "cmd": "SELECT",
    "qual": "(auth.role() = 'authenticated'::text)"
  }
]