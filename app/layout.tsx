// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { COLORS } from "@/lib/colors";

export const metadata: Metadata = {
  title: "SnapWin • Play Smart. Win Big.",
  description:
    "SnapWin is a modern, transparent raffle experience built for fairness, security and responsible play. Includes a powerful admin dashboard for managing raffles, tickets, customers and more.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          backgroundColor: COLORS.screenBg,
          color: COLORS.textPrimary,
          margin: 0,
          padding: 0,
          minHeight: "100vh",
        }}
      >
        {children}
      </body>
    </html>
  );
}
