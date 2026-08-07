export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ASSETS: Fetcher;
  EMAIL_FROM: string;
  RESEND_API_KEY?: string;
}

export const NATURE_VALUES = ["complaint", "suggestions", "praise"] as const;
export type NatureOfRequest = (typeof NATURE_VALUES)[number];

export const TICKET_STATUSES = ["Pending", "Under Review", "Resolved"] as const;
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
