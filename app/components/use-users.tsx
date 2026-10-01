"use client";

import { useEffect, useState } from "react";

export type CrmUser = { id: string; email: string; fullName: string | null };

export function userLabel(user: { fullName?: string | null; email: string } | null | undefined) {
  if (!user) return "—";
  return user.fullName?.trim() || user.email;
}

/** Utilisateurs du CRM + id de l'utilisateur connecté. */
export function useUsers() {
  const [users, setUsers] = useState<CrmUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/users")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { data?: CrmUser[]; currentUserId?: string } | null) => {
        if (cancelled || !data) return;
        setUsers(data.data ?? []);
        setCurrentUserId(data.currentUserId ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { users, currentUserId };
}

/** Options « Moi / chaque utilisateur / Non attribué » pour un filtre. */
export function UserFilterOptions({ users, currentUserId }: { users: CrmUser[]; currentUserId: string | null }) {
  return (
    <>
      <option value="">—</option>
      <option value="me">Moi</option>
      {users
        .filter((u) => u.id !== currentUserId)
        .map((u) => (
          <option key={u.id} value={u.id}>
            {userLabel(u)}
          </option>
        ))}
      <option value="none">Non attribué</option>
    </>
  );
}
