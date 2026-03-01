export interface Student {
  id: string;
  name: string;
  email?: string;
  photo_url?: string;
  school_year: number;
  allergies?: string;
  parent_name?: string;
  parent_contact?: string;
  parent_email?: string;
  can_leave_alone?: boolean;
  created_at: string;
}

export interface Subject {
  id: number;
  name: string;
  default_room?: string;
}

export interface Checkin {
  id: number;
  student_id: string;
  subject_id: number;
  status: 'present' | 'verified' | 'checkout';
  assigned_room?: string;
  verified_at?: string;
  created_at: string;
  subjects?: Subject; // Para o TypeScript perceber as relações
}