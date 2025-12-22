// app/(admin)/layout.tsx
"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type AdminUser = { id: string };

function isHttps() {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

function setAdminCookie() {
  document.cookie =
    `snapwin-admin=1; Path=/; Max-Age=604800; SameSite=Lax` +
    (isHttps() ? "; Secure" : "");
}

function clearAdminCookie() {
  document.cookie =
    `snapwin-admin=; Path=/; Max-Age=0; SameSite=Lax` +
    (isHttps() ? "; Secure" : "");
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const failToLogin = async () => {
      try {
        await supabase.auth.signOut();
      } catch {}
      clearAdminCookie();
      if (!cancelled) router.replace("/login");
    };

    const checkAuth = async () => {
      try {
        const res = await supabase.auth.getUser();
        const user = res?.data?.user;

        if (!user?.email) {
          await failToLogin();
          return;
        }

        const { data: adminRecord, error: adminError } = await supabase
          .from("admin_users")
          .select("id")
          .eq("email", user.email)
          .maybeSingle<AdminUser>();

        if (adminError || !adminRecord) {
          await failToLogin();
          return;
        }

        setAdminCookie();
        if (!cancelled) setChecking(false);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);

        // Your production error: "Invalid Refresh Token: Refresh Token Not Found"
        if (msg.toLowerCase().includes("refresh token")) {
          await failToLogin();
          return;
        }

        console.error("Admin auth check error:", err);
        await failToLogin();
      }
    };

    checkAuth();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    clearAdminCookie();
    router.push("/login");
  };

  if (checking) {
    return (
      <div
        className="flex items-center justify-center h-screen"
        style={{ backgroundColor: COLORS.background }}
      >
        <span style={{ color: COLORS.textSecondary }}>
          Checking admin access...
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-screen" style={{ backgroundColor: COLORS.screenBg }}>
      <aside
        className="w-64 border-r p-4 flex flex-col"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
        }}
      >
        <h2
          className="text-2xl font-bold mb-6"
          style={{ color: COLORS.primary }}
        >
          SnapWin Admin
        </h2>

        <nav className="flex flex-col space-y-3 flex-1">
          <Link
            href="/dashboard"
            className="hover:underline"
            style={{ color: COLORS.textPrimary }}
          >
            Dashboard
          </Link>
          <Link
            href="/raffles"
            className="hover:underline"
            style={{ color: COLORS.textPrimary }}
          >
            Raffles
          </Link>
          <Link
            href="/customers"
            className="hover:underline"
            style={{ color: COLORS.textPrimary }}
          >
            Customers
          </Link>
          <Link
            href="/payments"
            className="hover:underline"
            style={{ color: COLORS.textPrimary }}
          >
            Payments
          </Link>
          <Link
            href="/support"
            className="hover:underline"
            style={{ color: COLORS.textPrimary }}
          >
            Support
          </Link>
          <Link
            href="/notifications"
            className="hover:underline"
            style={{ color: COLORS.textPrimary }}
          >
            Notifications
          </Link>
        </nav>

        <button
          onClick={handleLogout}
          className="mt-4 w-full rounded py-2 text-sm"
          style={{
            borderWidth: 1,
            borderColor: COLORS.error,
            color: COLORS.error,
          }}
        >
          Logout
        </button>
      </aside>

      <main className="flex-1 p-6 overflow-y-auto">{children}</main>
    </div>
  );
}
