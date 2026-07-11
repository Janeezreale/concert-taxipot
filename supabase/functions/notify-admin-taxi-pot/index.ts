import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type NotificationJob = {
  id: string;
  taxi_pot_id: string;
  event_type: "min_people_reached";
  status: string;
  subject: string | null;
  message: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const getJobId = (payload: Record<string, unknown>) => {
  if (typeof payload.job_id === "string") return payload.job_id;

  const record = payload.record;
  if (
    record &&
    typeof record === "object" &&
    typeof (record as Record<string, unknown>).id === "string"
  ) {
    return (record as Record<string, string>).id;
  }

  return null;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const webhookSecret = Deno.env.get("ADMIN_NOTIFICATION_WEBHOOK_SECRET");
  if (
    !webhookSecret ||
    request.headers.get("x-webhook-secret") !== webhookSecret
  ) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("ADMIN_NOTIFICATION_FROM_EMAIL");

  if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !emailFrom) {
    return json({ error: "Required function secrets are missing" }, 500);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const jobId = getJobId(payload);
  if (!jobId) return json({ error: "notification job id is required" }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: claimedJob, error: claimError } = await supabase
    .from("notification_jobs")
    .update({ status: "processing", error_message: null })
    .eq("id", jobId)
    .eq("channel", "email")
    .eq("status", "pending")
    .eq("event_type", "min_people_reached")
    .select("id, taxi_pot_id, event_type, status, subject, message")
    .maybeSingle<NotificationJob>();

  if (claimError) return json({ error: claimError.message }, 500);
  if (!claimedJob) return json({ ok: true, skipped: "job already handled" });

  try {
    const [{ data: taxiPot, error: potError }, { data: admins, error: adminError }, { count, error: countError }] =
      await Promise.all([
        supabase
          .from("taxi_pots")
          .select("concert_title, origin, destination, date, time, min_people")
          .eq("id", claimedJob.taxi_pot_id)
          .single(),
        supabase
          .from("admin_notification_emails")
          .select("email")
          .eq("is_active", true),
        supabase
          .from("taxi_pot_saves")
          .select("id", { count: "exact", head: true })
          .eq("taxi_pot_id", claimedJob.taxi_pot_id),
      ]);

    if (potError) throw potError;
    if (adminError) throw adminError;
    if (countError) throw countError;

    const recipients = (admins ?? []).map(({ email }) => email).filter(Boolean);
    if (recipients.length === 0) throw new Error("활성화된 관리자 이메일이 없습니다.");

    const threshold = taxiPot.min_people;
    const thresholdLabel = "최소 인원";
    const subject = claimedJob.subject ||
      `[콘택시] ${taxiPot.concert_title} 택시팟 ${thresholdLabel} 도달`;
    const html = `
      <h2>${escapeHtml(subject)}</h2>
      <p>${escapeHtml(claimedJob.message)}</p>
      <table style="border-collapse:collapse">
        <tr><th style="text-align:left;padding:4px 12px 4px 0">공연</th><td>${escapeHtml(taxiPot.concert_title)}</td></tr>
        <tr><th style="text-align:left;padding:4px 12px 4px 0">경로</th><td>${escapeHtml(taxiPot.origin)} → ${escapeHtml(taxiPot.destination)}</td></tr>
        <tr><th style="text-align:left;padding:4px 12px 4px 0">일시</th><td>${escapeHtml(taxiPot.date)} ${escapeHtml(taxiPot.time)}</td></tr>
        <tr><th style="text-align:left;padding:4px 12px 4px 0">현재 찜 인원</th><td>${count ?? 0}명</td></tr>
        <tr><th style="text-align:left;padding:4px 12px 4px 0">알림 기준</th><td>${escapeHtml(thresholdLabel)} ${escapeHtml(threshold)}명</td></tr>
        <tr><th style="text-align:left;padding:4px 12px 4px 0">택시팟 ID</th><td>${escapeHtml(claimedJob.taxi_pot_id)}</td></tr>
      </table>
    `;

    const results = await Promise.all(recipients.map(async (recipient) => {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `${claimedJob.id}-${recipient}`.slice(0, 256),
        },
        body: JSON.stringify({ from: emailFrom, to: [recipient], subject, html }),
      });
      const responseBody = await response.text();
      if (!response.ok) throw new Error(`Resend ${response.status}: ${responseBody}`);
      return responseBody;
    }));

    const { error: sentError } = await supabase
      .from("notification_jobs")
      .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null })
      .eq("id", claimedJob.id);
    if (sentError) throw sentError;

    return json({ ok: true, job_id: claimedJob.id, sent: results.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from("notification_jobs")
      .update({ status: "failed", error_message: message.slice(0, 2000) })
      .eq("id", claimedJob.id);
    return json({ error: message }, 500);
  }
});
