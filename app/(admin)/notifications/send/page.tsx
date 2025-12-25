// app/(admin)/notifications/send/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type Mode =
  | "all_users"
  | "raffle_users"
  | "selected_customers"
  | "attempt_status"
  | "multi_raffle_union";

type CustomerPick = {
  id: string;
  name: string;
  email: string;
  expo_push_token: string | null;
};

function escapeIlike(input: string) {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function uniqStrings(xs: string[]) {
  return Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));
}

export default function AdminSendNotificationPage() {
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Campaign targeting
  const [mode, setMode] = useState<Mode>("all_users");

  // raffle targeting
  const [raffleId, setRaffleId] = useState("");
  const [raffleIdsMulti, setRaffleIdsMulti] = useState(""); // textarea, one per line or comma
  const [onlyCompletedTickets, setOnlyCompletedTickets] = useState(true);

  // attempts targeting
  const [attemptPassed, setAttemptPassed] = useState<"passed" | "failed">(
    "passed"
  );

  // selected customers targeting (lookup + manual list)
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerQueryDebounced, setCustomerQueryDebounced] = useState("");
  const tRef = useRef<number | null>(null);

  const [customers, setCustomers] = useState<CustomerPick[]>([]);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [manualCustomerIds, setManualCustomerIds] = useState(""); // textarea

  // Message
  const [title, setTitle] = useState("SnapWin");
  const [body, setBody] = useState("");
  const [dataJson, setDataJson] = useState(`{"source":"admin"}`);

  useEffect(() => {
    if (tRef.current) window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(
      () => setCustomerQueryDebounced(customerQuery.trim()),
      250
    );
    return () => {
      if (tRef.current) window.clearTimeout(tRef.current);
    };
  }, [customerQuery]);

  const loadCustomers = useCallback(async () => {
    setErrorMsg(null);

    const q = customerQueryDebounced.trim();
    if (!q) {
      setCustomers([]);
      return;
    }

    try {
      const s = escapeIlike(q);
      const { data, error } = await supabase
        .from("customers")
        .select("id,name,email,expo_push_token")
        .or([`name.ilike.%${s}%`, `email.ilike.%${s}%`].join(","))
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;

      const list = Array.isArray(data) ? (data as CustomerPick[]) : [];
      setCustomers(list);
    } catch (e: unknown) {
      setCustomers([]);
      setErrorMsg(e instanceof Error ? e.message : "Failed to load customers.");
    }
  }, [customerQueryDebounced]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const toggleSelectedCustomer = useCallback((id: string) => {
    setSelectedCustomerIds((prev) => {
      const set = new Set(prev);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return Array.from(set);
    });
  }, []);

  const parsedManualCustomerIds = useMemo(() => {
    const raw = manualCustomerIds
      .split(/[\n,]+/g)
      .map((x) => x.trim())
      .filter(Boolean);
    return uniqStrings(raw);
  }, [manualCustomerIds]);

  const effectiveSelectedCustomerIds = useMemo(() => {
    return uniqStrings([...selectedCustomerIds, ...parsedManualCustomerIds]);
  }, [selectedCustomerIds, parsedManualCustomerIds]);

  const parsedMultiRaffleIds = useMemo(() => {
    const raw = raffleIdsMulti
      .split(/[\n,]+/g)
      .map((x) => x.trim())
      .filter(Boolean);
    return uniqStrings(raw);
  }, [raffleIdsMulti]);

  const canSend = useMemo(() => {
    if (!body.trim()) return false;

    if (mode === "raffle_users") return !!raffleId.trim();
    if (mode === "attempt_status") return true; // raffle_id optional
    if (mode === "multi_raffle_union") return parsedMultiRaffleIds.length >= 2;
    if (mode === "selected_customers")
      return effectiveSelectedCustomerIds.length > 0;

    return true; // all_users
  }, [
    body,
    mode,
    raffleId,
    parsedMultiRaffleIds.length,
    effectiveSelectedCustomerIds.length,
  ]);

  const sendCampaign = useCallback(async () => {
    setStatusMsg(null);
    setErrorMsg(null);

    if (!canSend) {
      setErrorMsg("Missing required inputs for the selected targeting mode.");
      return;
    }

    let parsedData: Record<string, unknown> = {};
    try {
      parsedData = dataJson.trim() ? JSON.parse(dataJson) : {};
    } catch {
      setErrorMsg("data JSON is invalid.");
      return;
    }

    setLoading(true);
    try {
      // Build payload to match the Edge Function contract
      // IMPORTANT: selected_customers must send:
      //   mode: "selected_customers"
      //   customer_ids: [cid, ...]
      const payload: Record<string, unknown> = {
        mode,
        title: title.trim() || "SnapWin",
        body: body.trim(),
        data: parsedData,
        only_completed_tickets: onlyCompletedTickets,
      };

      if (mode === "raffle_users") {
        payload.raffle_id = raffleId.trim();
      }

      if (mode === "attempt_status") {
        // raffle_id optional: blank = all raffles
        const rid = raffleId.trim();
        if (rid) payload.raffle_id = rid;
        payload.attempt_passed = attemptPassed === "passed";
      }

      if (mode === "multi_raffle_union") {
        payload.raffle_ids = parsedMultiRaffleIds;
      }

      if (mode === "selected_customers") {
        payload.customer_ids = effectiveSelectedCustomerIds;
        // Optional: if your Edge Function supports it, you can also pass:
        // payload.send_mode = "selected_customers";
        // But "mode" already communicates that.
      }

      const { data, error } = await supabase.functions.invoke(
        "admin-send-notification",
        {
          body: payload,
        }
      );

      if (error) throw error;

      setStatusMsg(
        `Campaign sent. Recipients: ${
          data?.recipient_count ?? "—"
        }. Campaign ID: ${data?.campaign_id ?? "—"}`
      );

      setBody("");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to send campaign.");
    } finally {
      setLoading(false);
    }
  }, [
    canSend,
    mode,
    title,
    body,
    dataJson,
    onlyCompletedTickets,
    raffleId,
    attemptPassed,
    parsedMultiRaffleIds,
    effectiveSelectedCustomerIds,
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-3xl font-bold tracking-tight mb-1"
          style={{ color: COLORS.primary }}
        >
          Send Notification Campaign
        </h1>
        <p className="text-sm" style={{ color: COLORS.textSecondary }}>
          Target customers by audience rules, with full audit trail and export.
        </p>
      </div>

      <div
        className="rounded-2xl p-5 border space-y-5"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
          boxShadow: `0 18px 40px ${COLORS.cardShadow}`,
        }}
      >
        {/* Mode */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Targeting mode
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
            >
              <option value="all_users">Send to all app users</option>
              <option value="raffle_users">
                Send to all users in raffle X
              </option>
              <option value="selected_customers">
                Send to selected customers
              </option>
              <option value="attempt_status">
                Send to users with attempts passed/failed
              </option>
              <option value="multi_raffle_union">
                Send to users from 2+ raffles combined (union)
              </option>
            </select>

            <label
              className="flex items-center gap-2 text-sm mt-2"
              style={{ color: COLORS.textSecondary }}
            >
              <input
                type="checkbox"
                checked={onlyCompletedTickets}
                onChange={(e) => setOnlyCompletedTickets(e.target.checked)}
              />
              For raffle-based targeting, include only completed tickets
            </label>

            <div className="text-xs" style={{ color: COLORS.textMuted }}>
              Every send creates a campaign + per-recipient delivery log for
              audit/export.
            </div>
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Raffle ID (used by raffle / attempts modes)
            </label>
            <input
              value={raffleId}
              onChange={(e) => setRaffleId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder="uuid"
            />

            {mode === "attempt_status" ? (
              <div className="flex gap-2 mt-2">
                <select
                  value={attemptPassed}
                  onChange={(e) =>
                    setAttemptPassed(e.target.value as "passed" | "failed")
                  }
                  className="border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                  }}
                >
                  <option value="passed">Attempts passed</option>
                  <option value="failed">Attempts failed</option>
                </select>
                <div
                  className="text-xs self-center"
                  style={{ color: COLORS.textMuted }}
                >
                  Raffle ID optional here (blank = across all raffles)
                </div>
              </div>
            ) : null}

            {mode === "multi_raffle_union" ? (
              <div className="space-y-2 mt-2">
                <label
                  className="text-sm font-medium"
                  style={{ color: COLORS.textSecondary }}
                >
                  Raffle IDs (2+), comma or new line
                </label>
                <textarea
                  value={raffleIdsMulti}
                  onChange={(e) => setRaffleIdsMulti(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{
                    borderColor: COLORS.inputBorder,
                    backgroundColor: COLORS.inputBg,
                    color: COLORS.textPrimary,
                    minHeight: 90,
                  }}
                  placeholder="uuid1&#10;uuid2&#10;uuid3"
                />
                <div className="text-xs" style={{ color: COLORS.textMuted }}>
                  Parsed: {parsedMultiRaffleIds.length} raffle IDs
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Selected customers */}
        {mode === "selected_customers" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Find customers (name or email)
              </label>
              <input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                }}
                placeholder="e.g. Mohammad or gmail.com"
              />

              <div
                className="rounded-xl border mt-2 overflow-hidden"
                style={{ borderColor: COLORS.cardBorder }}
              >
                {customers.length === 0 ? (
                  <div
                    className="px-3 py-3 text-sm"
                    style={{ color: COLORS.textMuted }}
                  >
                    Type to search customers…
                  </div>
                ) : (
                  <div
                    className="divide-y"
                    style={{ borderColor: COLORS.cardBorder }}
                  >
                    {customers.map((c) => {
                      const checked = selectedCustomerIds.includes(c.id);
                      return (
                        <label
                          key={c.id}
                          className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer"
                          style={{ color: COLORS.textPrimary }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelectedCustomer(c.id)}
                          />
                          <div className="flex-1">
                            <div className="font-medium">
                              {c.name}{" "}
                              <span style={{ color: COLORS.textMuted }}>
                                ({c.email})
                              </span>
                            </div>
                            <div
                              className="text-xs"
                              style={{ color: COLORS.textMuted }}
                            >
                              Push token: {c.expo_push_token ? "Yes" : "No"}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="text-xs" style={{ color: COLORS.textMuted }}>
                Selected: {selectedCustomerIds.length}
              </div>
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                style={{ color: COLORS.textSecondary }}
              >
                Add customer IDs manually (comma or new line)
              </label>
              <textarea
                value={manualCustomerIds}
                onChange={(e) => setManualCustomerIds(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                style={{
                  borderColor: COLORS.inputBorder,
                  backgroundColor: COLORS.inputBg,
                  color: COLORS.textPrimary,
                  minHeight: 140,
                }}
                placeholder="uuid1&#10;uuid2&#10;uuid3"
              />
              <div className="text-xs" style={{ color: COLORS.textMuted }}>
                Total recipients (selected + manual):{" "}
                {effectiveSelectedCustomerIds.length}
              </div>
            </div>
          </div>
        ) : null}

        {/* Message */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
              }}
              placeholder="SnapWin"
            />

            <label
              className="text-sm font-medium mt-2 block"
              style={{ color: COLORS.textSecondary }}
            >
              Body
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
                minHeight: 120,
              }}
              placeholder="Type your message..."
            />
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: COLORS.textSecondary }}
            >
              data (JSON)
            </label>
            <textarea
              value={dataJson}
              onChange={(e) => setDataJson(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
                color: COLORS.textPrimary,
                minHeight: 120,
              }}
              placeholder='{"source":"admin"}'
            />
            <div className="text-xs" style={{ color: COLORS.textMuted }}>
              Included in both in-app notification record and Expo push payload.
            </div>
          </div>
        </div>

        {(errorMsg || statusMsg) && (
          <div
            className="rounded-2xl px-4 py-3 text-sm border"
            style={{
              backgroundColor: errorMsg ? "#FEF2F2" : "#ECFDF5",
              borderColor: errorMsg ? "#FCA5A5" : "#6EE7B7",
              color: errorMsg ? COLORS.error : "#065F46",
            }}
          >
            {errorMsg ?? statusMsg}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={sendCampaign}
            disabled={loading || !canSend}
            className="px-5 py-2.5 rounded-full text-sm font-medium"
            style={{
              backgroundColor: COLORS.primaryButtonBg,
              color: COLORS.primaryButtonText,
              opacity: loading || !canSend ? 0.6 : 1,
            }}
          >
            {loading ? "Sending..." : "Send Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}
