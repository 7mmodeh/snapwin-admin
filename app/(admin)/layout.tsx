// app/(admin)/layout.tsx
"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { COLORS } from "@/lib/colors";

type AdminUser = {
  id: string;
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !user.email) {
        document.cookie = "snapwin-admin=; Path=/; Max-Age=0;";
        router.replace("/login");
        return;
      }

      const { data: adminRecord, error: adminError } = await supabase
        .from("admin_users")
        .select("id")
        .eq("email", user.email)
        .maybeSingle<AdminUser>();

      if (adminError || !adminRecord) {
        console.error("Admin check failed:", adminError);
        await supabase.auth.signOut();
        document.cookie = "snapwin-admin=; Path=/; Max-Age=0;";
        router.replace("/login");
        return;
      }

      // User is admin → ensure cookie for middleware
      document.cookie = "snapwin-admin=1; Path=/; Max-Age=604800; SameSite=Lax";
      setChecking(false);
    };

    checkAuth();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    document.cookie = "snapwin-admin=; Path=/; Max-Age=0;";
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
      {/* Sidebar */}
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
          <a
            href="/dashboard"
            className="hover:underline"
            style={{ color: COLORS.textPrimary }}
          >
            Dashboard
          </a>
          <a
            href="/raffles"
            className="hover:underline"
            style={{ color: COLORS.textPrimary }}
          >
            Raffles
          </a>
          <a
            href="/customers"
            className="hover:underline"
            style={{ color: COLORS.textPrimary }}
          >
            Customers
          </a>
          <a
            href="/payments"
            className="hover:underline"
            style={{ color: COLORS.textPrimary }}
          >
            Payments
          </a>
          <a
            href="/support"
            className="hover:underline"
            style={{ color: COLORS.textPrimary }}
          >
            Support
          </a>
          <a
            href="/notifications"
            className="hover:underline"
            style={{ color: COLORS.textPrimary }}
          >
            Notifications
          </a>
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

      {/* Main content */}
      <main className="flex-1 p-6 overflow-y-auto">{children}</main>
    </div>
  );
}
