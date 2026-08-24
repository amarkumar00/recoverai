"use client";

import {
  Activity,
  ChartNoAxesCombined,
  FileClock,
  Gauge,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Overview", icon: Gauge, available: true },
  {
    href: "/events",
    label: "Live Event Stream",
    icon: Activity,
    available: false,
  },
  { href: "/cases", label: "Cases", icon: ListChecks, available: false },
  {
    href: "/policy",
    label: "Policy Firewall",
    icon: ShieldCheck,
    available: false,
  },
  {
    href: "/audit",
    label: "Audit Trail",
    icon: FileClock,
    available: false,
  },
  {
    href: "/evaluation",
    label: "Digital Twin Evaluation",
    icon: ChartNoAxesCombined,
    available: false,
  },
] as const;

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="RecoverAI sections" className="sidebar-nav">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className="nav-item"
            data-active={isActive}
            href={item.href}
            key={item.href}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>{item.label}</span>
            {!item.available && <span className="nav-later">Later</span>}
          </Link>
        );
      })}
    </nav>
  );
}
