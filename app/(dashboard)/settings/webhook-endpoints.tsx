"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import type { PersonCategory, PersonState } from "@prisma/client";
import { COMPANY_FIELDS, CONTACT_FIELDS, customTarget, newCustomTarget, parseTarget } from "@/lib/import/fields";
import {
  CONTACT_SOURCES,
  PERSON_CATEGORIES,
  PERSON_CATEGORY_DEFAULT_STATES,
  PERSON_CATEGORY_LABELS,
  PERSON_CATEGORY_STATE_KEYS,
  PERSON_STATE_LABELS,
} from "@/lib/labels";
import {
  DEFAULT_MEETMAGNET_MAPPING,
  MEETMAGNET_FIELDS,
  type WebhookMapping,
} from "@/lib/webhooks/meetmagnet-fields";

type Option = { id: string; label: string };
type Column = { key: string; label: string };

export type EndpointView = {
  id: string;
  name: string;
  url: string;
  sourceLabel: string;
  defaultCategory: PersonCategory;
  defaultState: PersonState;
  defaultOwnerId: string | null;
  createTask: boolean;
  mapping: WebhookMapping;
  customized: boolean;
};

type Props = {
  endpoints: EndpointView[];
  users: Option[];
  customColumns: { contact: Column[]; company: Column[] };
};

const GROUPS = Array.from(new Set(MEETMAGNET_FIELDS.map((f) => f.group)));
// Champs non ciblables depuis MeetMagnet (valeurs gérées par les réglages ou sans équivalent).
const HIDDEN_TARGETS = new Set(["contact.category", "contact.state", "contact.fullName"]);

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function TargetSelect({
  value,
  label,
  customColumns,
  onChange,
}: {
  value: string;
  label: string;
  customColumns: Props["customColumns"];
  onChange: (value: string) => void;
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Ne pas importer —</option>
      {[CONTACT_FIELDS, COMPANY_FIELDS].map((fields) => (
        <optgroup key={fields[0].entity} label={fields[0].entity === "contact" ? "Contact" : "Entreprise"}>
          {fields
            .filter((f) => !HIDDEN_TARGETS.has(f.target))
            .map((f) => (
              <option key={f.target} value={f.target}>
                {f.label}
              </option>
            ))}
        </optgroup>
      ))}
      {(["contact", "company"] as const).map((entity) =>
        customColumns[entity].length ? (
          <optgroup key={entity} label={`Colonnes personnalisées ${entity === "contact" ? "contact" : "entreprise"}`}>
            {customColumns[entity].map((c) => (
              <option key={c.key} value={customTarget(entity, c.key)}>
                {c.label}
              </option>
            ))}
          </optgroup>
        ) : null,
      )}
      <optgroup label="Créer une colonne personnalisée">
        <option value={newCustomTarget("contact")}>+ Nouvelle colonne contact « {label} »</option>
        <option value={newCustomTarget("company")}>+ Nouvelle colonne entreprise « {label} »</option>
      </optgroup>
    </select>
  );
}

function EndpointCard({ endpoint, users, customColumns, startOpen }: { endpoint: EndpointView; startOpen: boolean } & Omit<Props, "endpoints">) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(endpoint.name);
  const [sourceLabel, setSourceLabel] = useState(endpoint.sourceLabel);
  const [ownerId, setOwnerId] = useState(endpoint.defaultOwnerId ?? "");
  const [category, setCategory] = useState(endpoint.defaultCategory);
  const [state, setState] = useState(endpoint.defaultState);
  const [createTask, setCreateTask] = useState(endpoint.createTask);
  const [mapping, setMapping] = useState<WebhookMapping>(endpoint.mapping);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const fieldLabel = (path: string) => MEETMAGNET_FIELDS.find((f) => f.path === path)?.label ?? path;
  const mappedCount = Object.values(mapping).filter(Boolean).length;

  async function save() {
    setSaving(true);
    setError("");
    try {
      // Colonnes personnalisées à créer d'abord.
      const finalMapping: WebhookMapping = { ...mapping };
      for (const [path, target] of Object.entries(mapping)) {
        const parsed = parseTarget(target);
        if (parsed?.kind !== "new") continue;
        const res = await fetch("/api/custom-columns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: parsed.entity, label: fieldLabel(path), type: "text" }),
        });
        const data = (await res.json()) as { key?: string; error?: string };
        if (!res.ok || !data.key) throw new Error(data.error ?? `Création de la colonne « ${fieldLabel(path)} » impossible`);
        finalMapping[path] = customTarget(parsed.entity, data.key);
      }
      const res = await fetch(`/api/integrations/webhooks/${endpoint.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sourceLabel,
          defaultOwnerId: ownerId || null,
          defaultCategory: category,
          defaultState: state,
          createTask,
          mapping: finalMapping,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Enregistrement impossible");
      setMapping(finalMapping);
      setStatus("Enregistré ✓");
      window.setTimeout(() => setStatus(""), 2500);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    if (!window.confirm("Générer une nouvelle URL ? L’ancienne cessera de fonctionner : il faudra coller la nouvelle dans MeetMagnet.")) return;
    await fetch(`/api/integrations/webhooks/${endpoint.id}`, { method: "POST" });
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Supprimer le webhook « ${endpoint.name} » ? Son URL cessera de fonctionner. Les contacts déjà reçus sont conservés.`)) return;
    await fetch(`/api/integrations/webhooks/${endpoint.id}`, { method: "DELETE" });
    router.refresh();
  }

  function resetMapping() {
    const next: WebhookMapping = {};
    for (const f of MEETMAGNET_FIELDS) next[f.path] = DEFAULT_MEETMAGNET_MAPPING[f.path] ?? "";
    setMapping(next);
  }

  return (
    <article className="endpoint-card">
      <header className="endpoint-head">
        <div>
          <strong>{endpoint.name}</strong>
          <span className="muted">
            {" "}
            · source « {endpoint.sourceLabel || "—"} » · {mappedCount} champs associés
            {endpoint.customized ? "" : " (automatique)"}
          </span>
        </div>
        <button className="btn secondary small" type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Fermer" : "Modifier"}
        </button>
      </header>
      <div className="copy-row">
        <input className="input" readOnly value={endpoint.url} onFocus={(e) => e.currentTarget.select()} />
        <button
          className="btn"
          type="button"
          onClick={async () => {
            if (await copyText(endpoint.url)) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2500);
            }
          }}
        >
          {copied ? "Copié ✓" : "Copier l’URL"}
        </button>
      </div>

      {open ? (
        <div className="endpoint-editor">
          <div className="import-options" style={{ marginTop: 16 }}>
            <label>
              Nom du webhook
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Source des contacts
              <select className="input" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)}>
                <option value="">— Aucune —</option>
                {CONTACT_SOURCES.map((src) => (
                  <option key={src} value={src}>
                    {src}
                  </option>
                ))}
                {sourceLabel && !(CONTACT_SOURCES as readonly string[]).includes(sourceLabel) ? (
                  <option value={sourceLabel}>{sourceLabel}</option>
                ) : null}
              </select>
              <span className="hint">Inscrite dans le champ « Source » de chaque contact reçu.</span>
            </label>
            <label>
              Responsable des contacts et relances
              <select className="input" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">Non attribué</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
              <span className="hint">Un contact déjà suivi garde son responsable.</span>
            </label>
            <label>
              Catégorie des nouveaux contacts
              <select
                className="input"
                value={category}
                onChange={(e) => {
                  const next = e.target.value as PersonCategory;
                  setCategory(next);
                  setState(PERSON_CATEGORY_DEFAULT_STATES[next]);
                }}
              >
                {PERSON_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {PERSON_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              État
              <select className="input" value={state} onChange={(e) => setState(e.target.value as PersonState)}>
                {PERSON_CATEGORY_STATE_KEYS[category].map((s) => (
                  <option key={s} value={s}>
                    {PERSON_STATE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <span>
                <input type="checkbox" checked={createTask} onChange={(e) => setCreateTask(e.target.checked)} /> Créer
                une action « Répondre » à chaque réponse
              </span>
              <span className="hint">Les contacts déjà présents gardent leur catégorie et leur état.</span>
            </label>
          </div>

          <h3 className="endpoint-subtitle">Correspondance des champs</h3>
          <p className="hint" style={{ margin: "0 0 8px" }}>
            Pour chaque donnée envoyée par MeetMagnet, choisissez le champ du CRM qui la reçoit. Les champs déjà remplis
            dans le CRM ne sont pas écrasés.
          </p>
          <div className="table-wrap mapping-table" style={{ border: "1px solid var(--line)", borderRadius: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Donnée MeetMagnet</th>
                  <th>Exemple</th>
                  <th>Champ du CRM</th>
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((group) => (
                  <Fragment key={group}>
                    <tr className="mapping-group">
                      <td colSpan={3}>{group}</td>
                    </tr>
                    {MEETMAGNET_FIELDS.filter((f) => f.group === group).map((f) => (
                      <tr key={f.path} className={mapping[f.path] ? "mapped" : ""}>
                        <td>
                          <strong>{f.label}</strong>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {f.path}
                          </div>
                          <div className="sample-inline muted">{f.example || "—"}</div>
                        </td>
                        <td className="muted sample">{f.example || "—"}</td>
                        <td>
                          <div className="mapping-select">
                            <TargetSelect
                              value={mapping[f.path] ?? ""}
                              label={f.label}
                              customColumns={customColumns}
                              onChange={(value) => setMapping((m) => ({ ...m, [f.path]: value }))}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {error ? <p className="error">{error}</p> : null}
          <div className="import-actions" style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn ghost small" type="button" onClick={resetMapping}>
                Rétablir la correspondance par défaut
              </button>
              <button className="btn ghost small" type="button" onClick={() => void regenerate()}>
                Générer une nouvelle URL
              </button>
              <button className="btn ghost small danger-text" type="button" onClick={() => void remove()}>
                Supprimer
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="hint">{status}</span>
              <button className="btn" type="button" disabled={saving || !name.trim()} onClick={() => void save()}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function WebhookEndpoints({ endpoints, users, customColumns }: Props) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [lastCreated, setLastCreated] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    const res = await fetch("/api/integrations/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    setCreating(false);
    if (res.ok) {
      setLastCreated(((await res.json()) as { id: string }).id);
      setNewName("");
      router.refresh();
    }
  }

  return (
    <div className="endpoint-list">
      {endpoints.map((endpoint) => (
        <EndpointCard
          key={`${endpoint.id}-${endpoint.url}`}
          endpoint={endpoint}
          users={users}
          customColumns={customColumns}
          startOpen={endpoint.id === lastCreated}
        />
      ))}
      <div className="inline-row" style={{ maxWidth: 560 }}>
        <input
          className="input"
          value={newName}
          placeholder="Nom du nouveau webhook (ex. Campagne agro – réponses)"
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="btn secondary" type="button" disabled={creating} onClick={() => void create()}>
          + Ajouter un webhook
        </button>
      </div>
      <ol className="steps">
        <li>
          Copiez l’URL du webhook, puis dans MeetMagnet → <strong>Webhooks</strong>, choisissez l’événement{" "}
          <strong>« À la réponse »</strong>, collez l’URL et cliquez sur <strong>Ajouter un webhook</strong>.
        </li>
        <li>
          Cliquez sur <strong>Tester l’envoi</strong> : la ligne « Test » apparaît dans le journal ci-dessous (aucun
          contact créé).
        </li>
      </ol>
    </div>
  );
}
