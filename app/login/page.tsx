// app/login/page.tsx
"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type AdminUser = {
  id: string;
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // If already logged in + exists in admin_users, go straight to dashboard
  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !user.email) return;

      const { data: adminRecord, error: adminError } = await supabase
        .from("admin_users")
        .select("id")
        .eq("email", user.email)
        .maybeSingle<AdminUser>();

      if (!adminError && adminRecord) {
        document.cookie =
          "snapwin-admin=1; Path=/; Max-Age=604800; SameSite=Lax"; // 7 days
        router.replace("/dashboard");
      }
    };

    checkSession();
  }, [router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // 1) Log in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    const user = data.user;
    if (!user || !user.email) {
      setError("Could not get user data.");
      setLoading(false);
      return;
    }

    // 2) Check admin_users table
    const { data: adminRecord, error: adminError } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", user.email)
      .maybeSingle<AdminUser>();

    if (adminError) {
      console.error("Error checking admin_users:", adminError);
      setError("Could not verify admin permissions.");
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    if (!adminRecord) {
      setError("You are not authorized to access the admin dashboard.");
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    // 3) Mark as admin via cookie for middleware UX
    document.cookie = "snapwin-admin=1; Path=/; Max-Age=604800; SameSite=Lax"; // 7 days

    setLoading(false);
    router.replace("/dashboard");
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: COLORS.background }}
    >
      <div
        className="w-full max-w-md rounded-lg shadow p-6"
        style={{
          backgroundColor: COLORS.cardBg,
          boxShadow: `0 10px 25px ${COLORS.cardShadow}`,
        }}
      >
        <h1
          className="text-2xl font-bold mb-4 text-center"
          style={{ color: COLORS.textPrimary }}
        >
          SnapWin Admin Login
        </h1>

        {error && (
          <div
            className="mb-4 rounded px-3 py-2 text-sm"
            style={{ backgroundColor: "#FEE2E2", color: COLORS.error }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: COLORS.textSecondary }}
            >
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
              }}
              placeholder="info@snapwin.eu"
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: COLORS.textSecondary }}
            >
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring"
              style={{
                borderColor: COLORS.inputBorder,
                backgroundColor: COLORS.inputBg,
              }}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded py-2 font-medium disabled:opacity-60"
            style={{
              backgroundColor: COLORS.primaryButtonBg,
              color: COLORS.primaryButtonText,
            }}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
