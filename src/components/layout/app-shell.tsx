import { CircleDotDashed, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Badge } from "@/components/ui/badge";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <aside className="sidebar">
        <div className="brand-lockup">
          <div aria-hidden="true" className="brand-mark">
            <ShieldCheck size={21} strokeWidth={2.2} />
          </div>
          <div>
            <p className="brand-name">RecoverAI</p>
            <p className="brand-subtitle">Revenue recovery control plane</p>
          </div>
        </div>

        <div className="mode-panel">
          <div className="mode-line">
            <CircleDotDashed aria-hidden="true" size={16} />
            <span>Credential-free preview</span>
          </div>
          <Badge tone="demo">Demo Mode · Synthetic Data</Badge>
          <p>Prototype only. No real merchant payments or revenue.</p>
        </div>

        <SidebarNav />

        <div className="sidebar-footer">
          <span>Track 03</span>
          <strong>AI Revenue Recovery</strong>
        </div>
      </aside>

      <div className="content-shell">
        <header className="mobile-header">
          <div className="mobile-brand">
            <div aria-hidden="true" className="brand-mark brand-mark-small">
              <ShieldCheck size={18} />
            </div>
            <strong>RecoverAI</strong>
          </div>
          <Badge tone="demo">Demo · Synthetic</Badge>
        </header>
        <div className="mobile-nav-wrap">
          <SidebarNav />
        </div>
        <main id="main-content">{children}</main>
      </div>
    </div>
  );
}
