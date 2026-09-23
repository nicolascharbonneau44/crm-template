"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const links = [
  { href: "/contacts", label: "Contacts" },
  { href: "/companies", label: "Entreprises" },
  { href: "/actions", label: "Actions" },
  { href: "/stats", label: "Statistiques" },
];

export function AppShell({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  userEmail?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="shell">
      <div className={`mobile-backdrop ${open ? "open" : ""}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">CRM Client</div>
        <nav className="nav">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link key={link.href} href={link.href} className={active ? "active" : ""} onClick={() => setOpen(false)}>
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <Link
            href="/settings"
            className={`nav-settings ${pathname.startsWith("/settings") ? "active" : ""}`}
            onClick={() => setOpen(false)}
          >
            Paramètres
          </Link>
          {userEmail ? <div className="nav-user">{userEmail}</div> : null}
          <button className="nav-logout" type="button" onClick={() => void logout()}>
            Déconnexion
          </button>
        </div>
      </aside>
      <div className="main">
        <button className="btn secondary small menu-toggle" type="button" onClick={() => setOpen((v) => !v)}>
          Menu
        </button>
        {children}
      </div>
    </div>
  );
}
