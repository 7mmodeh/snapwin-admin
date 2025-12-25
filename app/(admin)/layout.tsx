// app/(admin)/layout.tsx
"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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

function NavItem({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active =
    pathname === href || (href !== "/" && pathname?.startsWith(href + "/"));

  return (
    <Link
      href={href}
      className="rounded px-3 py-2 transition"
      style={{
        color: active ? COLORS.primary : COLORS.textPrimary,
        backgroundColor: active ? COLORS.highlightCardBg : "transparent",
        border: active
          ? `1px solid ${COLORS.cardBorder}`
          : "1px solid transparent",
      }}
    >
      {label}
    </Link>
  );
}

function NavGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div
        className="text-[0.7rem] uppercase tracking-wide font-semibold px-1"
        style={{ color: COLORS.textMuted }}
      >
        {title}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
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

        // Production error: "Invalid Refresh Token: Refresh Token Not Found"
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
        style={{ backgroundColor: COLORS.screenBg }}
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
        className="w-72 border-r p-4 flex flex-col gap-6"
        style={{
          backgroundColor: COLORS.cardBg,
          borderColor: COLORS.cardBorder,
        }}
      >
        <div>
          <h2 className="text-2xl font-bold" style={{ color: COLORS.primary }}>
            SnapWin Admin
          </h2>
          <div className="text-xs mt-1" style={{ color: COLORS.textMuted }}>
            Admin dashboard
          </div>
        </div>

        <nav className="flex flex-col gap-5 flex-1">
          <NavGroup title="Core">
            <NavItem href="/dashboard" label="Dashboard" />
            <NavItem href="/raffles" label="Raffles" />
            <NavItem href="/tickets" label="Tickets" />
            <NavItem href="/customers" label="Customers" />
            <NavItem href="/payments" label="Payments" />
            <NavItem href="/support" label="Support" />
          </NavGroup>

          <NavGroup title="Notifications">
            {/* Existing list */}
            <NavItem href="/notifications" label="Notifications (Inbox)" />

            {/* ✅ NEW: Notification campaigns */}
            <NavItem href="/notifications/campaigns" label="Campaigns" />

            {/* ✅ NEW: Send notifications */}
            <NavItem href="/notifications/send" label="Send" />

            {/* ✅ NEW: Reports */}
            <NavItem href="/notifications/reports" label="Reports" />
          </NavGroup>
        </nav>

        <button
          onClick={handleLogout}
          className="mt-2 w-full rounded py-2 text-sm"
          style={{
            borderWidth: 1,
            borderColor: COLORS.error,
            color: COLORS.error,
            backgroundColor: "transparent",
          }}
        >
          Logout
        </button>
      </aside>

      <main className="flex-1 p-6 overflow-y-auto">{children}</main>
    </div>
  );
}
