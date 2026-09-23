"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PersonCategory, PersonState } from "@prisma/client";
import {
  PERSON_CATEGORIES,
  PERSON_CATEGORY_DEFAULT_STATES,
  PERSON_CATEGORY_LABELS,
  PERSON_CATEGORY_STATE_KEYS,
  PERSON_STATE_LABELS,
} from "@/lib/labels";

const CLAUDE_CONNECTORS_URL = "https://claude.ai/settings/connectors";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ClaudeConnect({ mcpUrl }: { mcpUrl: string }) {
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    if (await copy(mcpUrl)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    }
  }

  async function connect() {
    await copyUrl();
    window.open(CLAUDE_CONNECTORS_URL, "_blank", "noopener,noreferrer");
  }

  return (
    <div>
      <div className="copy-row">
        <input className="input" readOnly value={mcpUrl} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn secondary" type="button" onClick={() => void copyUrl()}>
          {copied ? "Copié ✓" : "Copier"}
        </button>
        <button className="btn" type="button" onClick={() => void connect()}>
          Connecter à Claude
        </button>
      </div>
      <ol className="steps">
        <li>
          Cliquez sur <strong>Connecter à Claude</strong> : l’adresse est copiée et les connecteurs Claude s’ouvrent.
        </li>
        <li>
          Choisissez <strong>Ajouter un connecteur personnalisé</strong>, nommez-le « CRM » et collez l’adresse.
        </li>
        <li>
          Cliquez sur <strong>Se connecter</strong>, puis sur <strong>Autoriser</strong> dans la page du CRM qui
          s’ouvre.
        </li>
      </ol>
      <p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>
        À faire une seule fois : le connecteur est ensuite disponible dans Claude sur le web, l’application de bureau et
        mobile.
      </p>
    </div>
  );
}

export function MeetMagnetSettings(props: {
  url: string;
  defaultCategory: PersonCategory;
  defaultState: PersonState;
  createTask: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [category, setCategory] = useState<PersonCategory>(props.defaultCategory);
  const [state, setState] = useState<PersonState>(props.defaultState);
  const [createTask, setCreateTask] = useState(props.createTask);
  const [status, setStatus] = useState("");

  async function save(patch: Record<string, unknown>) {
    setStatus("Enregistrement…");
    const res = await fetch("/api/integrations/meetmagnet", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setStatus(res.ok ? "Enregistré ✓" : "Enregistrement impossible");
    window.setTimeout(() => setStatus(""), 2500);
  }

  function changeCategory(next: PersonCategory) {
    const nextState = PERSON_CATEGORY_DEFAULT_STATES[next];
    setCategory(next);
    setState(nextState);
    void save({ defaultCategory: next, defaultState: nextState });
  }

  async function regenerate() {
    if (!window.confirm("Générer une nouvelle URL ? L’ancienne cessera de fonctionner : il faudra coller la nouvelle dans MeetMagnet.")) {
      return;
    }
    await fetch("/api/integrations/meetmagnet", { method: "POST" });
    router.refresh();
  }

  return (
    <div>
      <div className="copy-row">
        <input className="input" readOnly value={props.url} onFocus={(e) => e.currentTarget.select()} />
        <button
          className="btn"
          type="button"
          onClick={async () => {
            if (await copy(props.url)) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2500);
            }
          }}
        >
          {copied ? "Copié ✓" : "Copier l’URL"}
        </button>
      </div>
      <ol className="steps">
        <li>
          Dans MeetMagnet, ouvrez <strong>Webhooks</strong> et choisissez l’événement <strong>« À la réponse »</strong>.
        </li>
        <li>
          Collez l’URL ci-dessus dans <strong>URL du webhook</strong>, puis <strong>Ajouter un webhook</strong>.
        </li>
        <li>
          Cliquez sur <strong>Tester l’envoi</strong> : le test apparaît ci-dessous (sans créer de contact).
        </li>
      </ol>
      <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>
        Vous pouvez ajouter la même URL sur « Nouveau prospect créé » pour recevoir aussi les nouveaux prospects. Gardez
        cette URL secrète : elle suffit pour écrire dans le CRM.
      </p>

      <div className="import-options">
        <label>
          Catégorie des nouveaux contacts
          <select className="input" value={category} onChange={(e) => changeCategory(e.target.value as PersonCategory)}>
            {PERSON_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {PERSON_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          État
          <select
            className="input"
            value={state}
            onChange={(e) => {
              setState(e.target.value as PersonState);
              void save({ defaultState: e.target.value });
            }}
          >
            {PERSON_CATEGORY_STATE_KEYS[category].map((s) => (
              <option key={s} value={s}>
                {PERSON_STATE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <span>
            <input
              type="checkbox"
              checked={createTask}
              onChange={(e) => {
                setCreateTask(e.target.checked);
                void save({ createTask: e.target.checked });
              }}
            />{" "}
            Créer une action « Répondre » à chaque réponse
          </span>
          <span className="hint">Les contacts déjà présents gardent leur catégorie et leur état.</span>
        </label>
      </div>
      <div className="import-actions" style={{ justifyContent: "space-between" }}>
        <span className="hint">{status}</span>
        <button className="btn ghost small" type="button" onClick={() => void regenerate()}>
          Générer une nouvelle URL
        </button>
      </div>
    </div>
  );
}

export function ChangePasswordForm() {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const newPassword = String(form.get("newPassword") ?? "");
    setSuccess(false);
    if (newPassword !== String(form.get("confirm") ?? "")) {
      setError("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }
    setError("");
    setPending(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: String(form.get("currentPassword") ?? ""), newPassword }),
    });
    setPending(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Modification impossible");
      return;
    }
    formEl.reset();
    setSuccess(true);
  }

  return (
    <form className="form-grid password-form" onSubmit={onSubmit}>
      <label>
        Mot de passe actuel
        <input className="input" name="currentPassword" type="password" required autoComplete="current-password" />
      </label>
      <label>
        Nouveau mot de passe (8 caractères minimum)
        <input className="input" name="newPassword" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      <label>
        Confirmer le nouveau mot de passe
        <input className="input" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="success">Mot de passe modifié.</p> : null}
      <div>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Changer le mot de passe"}
        </button>
      </div>
    </form>
  );
}

export function RevokeButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function revoke() {
    if (!window.confirm(`Déconnecter ${name} ? L’application perdra immédiatement l’accès au CRM.`)) return;
    setPending(true);
    await fetch(`/api/connections/${id}`, { method: "DELETE" });
    router.refresh();
    setPending(false);
  }

  return (
    <button className="btn secondary small" type="button" disabled={pending} onClick={() => void revoke()}>
      {pending ? "…" : "Déconnecter"}
    </button>
  );
}
