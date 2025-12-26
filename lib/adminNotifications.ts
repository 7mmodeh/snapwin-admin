// lib/adminNotifications.ts
import { supabase } from "@/lib/supabaseClient";

export type CampaignMode =
  | "all_users"
  | "selected_customers"
  | "raffle_users"
  | "multi_raffle_union"
  | "attempt_status";

export type AdminSendCampaignPayload = {
  mode: CampaignMode;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;

  raffle_id?: string | null;
  raffle_ids?: string[] | null;
  customer_ids?: string[] | null;

  attempt_passed?: boolean | null;
  only_completed_tickets?: boolean | null;
};

export type AdminSendCampaignResult = {
  ok: boolean;
  campaign_id: string | null;
  recipient_count: number;
};

function getFunctionsBaseUrl(): string {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  return `${url}/functions/v1`;
}

type ErrorResponse = {
  error?: string;
  message?: string;
  details?: string;
};

function isErrorResponse(v: unknown): v is ErrorResponse {
  if (typeof v !== "object" || v === null) return false;
  return (
    "error" in v ||
    "message" in v ||
    "details" in v
  );
}

export async function adminSendNotificationCampaign(
  payload: AdminSendCampaignPayload
): Promise<AdminSendCampaignResult> {
  const {
    data: { session },
    error: sessionErr,
  } = await supabase.auth.getSession();

  if (sessionErr) {
    throw new Error(`Failed to read admin session: ${sessionErr.message}`);
  }

  if (!session?.access_token) {
    throw new Error("Not signed in (missing access token).");
  }

  const res = await fetch(
    `${getFunctionsBaseUrl()}/admin-send-notification`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    }
  );

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // Non-JSON response (unexpected but handled)
  }

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;

    if (isErrorResponse(parsed)) {
      if (parsed.error) message = parsed.error;
      else if (parsed.message) message = parsed.message;

      if (parsed.details) {
        message += ` | ${parsed.details}`;
      }
    }

    throw new Error(message);
  }

  // Success path: validate shape defensively
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("ok" in parsed)
  ) {
    throw new Error("Malformed response from admin-send-notification.");
  }

  return parsed as AdminSendCampaignResult;
}
