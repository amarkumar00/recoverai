import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "RecoverAI — Bounded Payment Recovery",
    template: "%s · RecoverAI",
  },
  description:
    "Credential-free RecoverAI prototype using static synthetic data. No real payments or merchant revenue.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
