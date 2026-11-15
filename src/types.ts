export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ASSETS: Fetcher;
  R2: R2Bucket;
  EMAIL_FROM: string;
  BREVO_API_KEY?: string;
  ADMIN_USER?: string;
  ADMIN_PASSWORD?: string;
}

export const NATURE_VALUES = ["complaint", "suggestions", "praise", "inquiry", "request"] as const;
export type NatureOfRequest = (typeof NATURE_VALUES)[number];

export const ADMIN_ROLES = ["superadmin", "division", "district"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const TICKET_STATUSES = ["Pending", "Validated", "Under Review", "Resolved"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export interface Ticket {
  id: number;
  arta_reference_no: string;
  full_name: string | null;
  cellphone_number: string | null;
  email_address: string;
  district: string | null;
  school_name: string;
  nature_of_request: NatureOfRequest;
  description: string;
  privacy_consent: number;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
}
