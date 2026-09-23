"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { PersonCategory, PersonState } from "@prisma/client";
import {
  COMPANY_FIELDS,
  CONTACT_FIELDS,
  MAX_ROWS_PER_REQUEST,
  autoMapHeaders,
  customTarget,
  newCustomTarget,
  normalizeHeader,
  parseTarget,
  type ExistingPolicy,
  type ImportEntity,
  type ImportMode,
} from "@/lib/import/fields";
import {
  ACCEPTED_FILES,
  columnSamples,
  guessColumnType,
  parseDelimitedText,
  readFile,
  type ParsedTable,
} from "@/lib/import/parse-client";
import {
  PERSON_CATEGORIES,
  PERSON_CATEGORY_DEFAULT_STATES,
  PERSON_CATEGORY_LABELS,
  PERSON_CATEGORY_STATE_KEYS,
  PERSON_STATE_LABELS,
} from "@/lib/labels";

type CustomColumn = { key: string; label: string; type: string };
type CustomColumns = Record<ImportEntity, CustomColumn[]>;

type ImportResult = {
  contacts: { created: number; updated: number; unchanged: number };
  companies: { createdIds: string[]; updatedIds: string[] };
  errors: { line: number; message: string }[];
  warnings: string[];
};

type Summary = {
  contacts: { created: number; updated: number; unchanged: number };
  companiesCreated: number;
  companiesUpdated: number;
  errors: { line: number; message: string }[];
  warnings: string[];
  mode: ImportMode;
};

const MEMORY_KEY = "crm-import-mapping";

function loadMemory(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(MEMORY_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/** Ne retient que les corrections manuelles (écart avec l'association automatique). */
function saveMemory(headers: string[], chosen: string[], finalTargets: string[], autoTargets: string[]) {
  try {
    const memory = loadMemory();
    headers.forEach((h, i) => {
      const key = normalizeHeader(h);
      if (chosen[i] === autoTargets[i]) delete memory[key];
      else memory[key] = finalTargets[i];
    });
    window.localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // stockage indisponible : la mémorisation est facultative
  }
}

function isValidTarget(target: string, custom: CustomColumns) {
  if (!target) return true;
  const parsed = parseTarget(target);
  if (!parsed) return false;
  if (parsed.kind === "custom") return custom[parsed.entity].some((c) => c.key === parsed.key);
  return true;
}

export function ImportWizard({ customColumns }: { customColumns: CustomColumns }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const lastFile = useRef<File | null>(null);

  const [table, setTable] = useState<ParsedTable | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [autoFlags, setAutoFlags] = useState<boolean[]>([]);
  const [autoTargets, setAutoTargets] = useState<string[]>([]);
  const [mode, setMode] = useState<ImportMode>("contacts");
  const [policy, setPolicy] = useState<ExistingPolicy>("fill");
  const [category, setCategory] = useState<PersonCategory>("lead");
  const [state, setState] = useState<PersonState>(PERSON_CATEGORY_DEFAULT_STATES.lead);
  const [source, setSource] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);

  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const samples = useMemo(() => (table ? columnSamples(table) : []), [table]);

  function loadTable(next: ParsedTable) {
    const colSamples = columnSamples(next);
    const auto = autoMapHeaders(next.headers, colSamples);
    const memory = loadMemory();
    const fitsMode = (target: string) =>
      auto.suggestedMode === "contacts" || !(target.startsWith("contact.") || target === "new.contact");
    const mapped = next.headers.map((h, i) => {
      const remembered = memory[normalizeHeader(h)];
      return remembered !== undefined &&
        isValidTarget(remembered, customColumns) &&
        fitsMode(remembered) &&
        colSamples[i].length
        ? remembered
        : auto.targets[i];
    });
    // un même champ ne peut être choisi que par une colonne
    const seen = new Set<string>();
    const unique = mapped.map((t) => {
      if (!t || t.startsWith("new.")) return t;
      if (seen.has(t)) return "";
      seen.add(t);
      return t;
    });
    setTable(next);
    setTargets(unique);
    setAutoTargets(auto.targets);
    setAutoFlags(unique.map((t, i) => Boolean(t) && t === auto.targets[i]));
    setMode(auto.suggestedMode);
    setSource(next.fileName.replace(/\.[^.]+$/, ""));
    setSummary(null);
    setError("");
  }

  async function handleFile(file: File, sheet?: string) {
    setLoading("Lecture du fichier…");
    setError("");
    try {
      lastFile.current = file;
      loadTable(await readFile(file, sheet));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fichier illisible");
    } finally {
      setLoading(null);
    }
  }

  async function handleSheetUrl() {
    setLoading("Lecture de la feuille Google Sheets…");
    setError("");
    try {
      const res = await fetch("/api/import/google-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sheetUrl }),
      });
      const data = (await res.json()) as { csv?: string; error?: string };
      if (!res.ok || !data.csv) throw new Error(data.error ?? "Feuille illisible");
      lastFile.current = null;
      loadTable(parseDelimitedText(data.csv, "Google Sheets"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Feuille illisible");
    } finally {
      setLoading(null);
    }
  }

  function handlePaste() {
    setError("");
    try {
      lastFile.current = null;
      loadTable(parseDelimitedText(pasted, "Données collées"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Texte illisible");
    }
  }

  function setTarget(index: number, target: string) {
    setTargets((current) =>
      current.map((t, i) => {
        if (i === index) return target;
        const unique = target && !target.startsWith("new.");
        return unique && t === target ? "" : t;
      }),
    );
    setAutoFlags((flags) => flags.map((f, i) => (i === index ? false : f)));
  }

  function changeMode(next: ImportMode) {
    setMode(next);
    if (next === "companies") setTargets((ts) => ts.map((t) => (t.startsWith("contact.") || t === "new.contact" ? "" : t)));
  }

  function changeCategory(next: PersonCategory) {
    setCategory(next);
    setState(PERSON_CATEGORY_DEFAULT_STATES[next]);
  }

  const mapped = targets.filter(Boolean);
  const has = (t: string) => targets.includes(t);
  const missing =
    mode === "contacts"
      ? !has("contact.prenom") && !has("contact.nom") && !has("contact.fullName")
        ? "Associez au moins une colonne Prénom, Nom ou Nom complet."
        : ""
      : !has("company.nom")
        ? "Associez une colonne au nom de l'entreprise."
        : "";

  const preview = useMemo(() => {
    if (!table) return [];
    const get = (row: string[], target: string) => {
      const i = targets.indexOf(target);
      return i >= 0 ? row[i] : "";
    };
    return table.rows.slice(0, 3).map((row) => {
      const full = get(row, "contact.fullName");
      const name = [get(row, "contact.prenom"), get(row, "contact.nom")].filter(Boolean).join(" ") || full;
      return {
        name,
        poste: get(row, "contact.poste"),
        email: get(row, "contact.email"),
        company: get(row, "company.nom"),
      };
    });
  }, [table, targets]);

  async function runImport() {
    if (!table || missing) return;
    setError("");
    setProgress({ done: 0, total: table.rows.length });

    try {
      // 1. colonnes personnalisées à créer
      const finalTargets = [...targets];
      for (const [i, target] of targets.entries()) {
        const parsed = parseTarget(target);
        if (parsed?.kind !== "new") continue;
        const label = table.headers[i];
        const existing = customColumns[parsed.entity].find((c) => normalizeHeader(c.label) === normalizeHeader(label));
        if (existing) {
          finalTargets[i] = customTarget(parsed.entity, existing.key);
          continue;
        }
        const res = await fetch("/api/custom-columns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType: parsed.entity, label, type: guessColumnType(samples[i]) }),
        });
        const data = (await res.json()) as { key?: string; error?: string };
        if (!res.ok || !data.key) throw new Error(data.error ?? `Création de la colonne « ${label} » impossible`);
        finalTargets[i] = customTarget(parsed.entity, data.key);
      }

      // 2. envoi par lots
      const total: Summary = {
        contacts: { created: 0, updated: 0, unchanged: 0 },
        companiesCreated: 0,
        companiesUpdated: 0,
        errors: [],
        warnings: [],
        mode,
      };
      const created = new Set<string>();
      const updated = new Set<string>();
      for (let start = 0; start < table.rows.length; start += MAX_ROWS_PER_REQUEST) {
        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            onExisting: policy,
            columns: finalTargets,
            rows: table.rows.slice(start, start + MAX_ROWS_PER_REQUEST),
            firstLine: start + 2,
            defaults: { category, state, source },
          }),
        });
        const data = (await res.json()) as ImportResult & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Import interrompu");
        total.contacts.created += data.contacts.created;
        total.contacts.updated += data.contacts.updated;
        total.contacts.unchanged += data.contacts.unchanged;
        data.companies.createdIds.forEach((id) => created.add(id));
        data.companies.updatedIds.forEach((id) => !created.has(id) && updated.add(id));
        total.errors.push(...data.errors);
        data.warnings.forEach((w) => !total.warnings.includes(w) && total.warnings.push(w));
        setProgress({ done: Math.min(start + MAX_ROWS_PER_REQUEST, table.rows.length), total: table.rows.length });
      }
      total.companiesCreated = created.size;
      total.companiesUpdated = updated.size;

      saveMemory(table.headers, targets, finalTargets, autoTargets);
      setSummary(total);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import interrompu");
    } finally {
      setProgress(null);
    }
  }

  function reset() {
    setTable(null);
    setSummary(null);
    setError("");
    setPasted("");
    lastFile.current = null;
    if (fileInput.current) fileInput.current.value = "";
  }

  // ——— Résultat ———
  if (summary) {
    return (
      <div className="import-result">
        <div className="stats-grid" style={{ padding: 0 }}>
          {summary.mode === "contacts" ? (
            <>
              <div className="stat-card">
                <span>Contacts créés</span>
                <strong>{summary.contacts.created}</strong>
              </div>
              <div className="stat-card">
                <span>Contacts enrichis</span>
                <strong>{summary.contacts.updated}</strong>
              </div>
              <div className="stat-card">
                <span>Déjà à jour</span>
                <strong>{summary.contacts.unchanged}</strong>
              </div>
            </>
          ) : null}
          <div className="stat-card">
            <span>Entreprises créées</span>
            <strong>{summary.companiesCreated}</strong>
          </div>
          <div className="stat-card">
            <span>Entreprises enrichies</span>
            <strong>{summary.companiesUpdated}</strong>
          </div>
        </div>
        {summary.errors.length ? (
          <div className="import-issues">
            <strong>
              {summary.errors.length} ligne{summary.errors.length > 1 ? "s" : ""} non importée
              {summary.errors.length > 1 ? "s" : ""}
            </strong>
            <ul>
              {summary.errors.slice(0, 50).map((e) => (
                <li key={e.line}>
                  Ligne {e.line} : {e.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {summary.warnings.length ? (
          <div className="import-issues warning">
            <ul>
              {summary.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="import-actions">
          <button className="btn secondary" type="button" onClick={reset}>
            Nouvel import
          </button>
          <Link className="btn" href={summary.mode === "contacts" ? "/contacts" : "/companies"}>
            Voir les {summary.mode === "contacts" ? "contacts" : "entreprises"}
          </Link>
        </div>
      </div>
    );
  }

  // ——— Choix de la source ———
  if (!table) {
    return (
      <div className="import-source">
        <div
          className={`dropzone ${dragging ? "dragging" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) void handleFile(file);
          }}
        >
          <strong>{loading ?? "Glissez un fichier ici ou cliquez pour le choisir"}</strong>
          <span className="muted">CSV, Excel (.xlsx, .xls), OpenDocument (.ods), TSV, JSON</span>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_FILES}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>

        <div className="import-alt">
          <label>
            Ou depuis Google Sheets
            <div className="copy-row">
              <input
                className="input"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
              />
              <button className="btn secondary" type="button" disabled={!sheetUrl || !!loading} onClick={() => void handleSheetUrl()}>
                Charger
              </button>
            </div>
            <span className="hint">La feuille doit être partagée « Tous les utilisateurs disposant du lien ».</span>
          </label>
          <label>
            Ou collez des cellules copiées depuis Excel / Google Sheets
            <textarea
              className="input"
              rows={3}
              placeholder="Copiez les cellules (en-têtes compris) puis collez-les ici"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <div>
              <button className="btn secondary" type="button" disabled={!pasted.trim()} onClick={handlePaste}>
                Utiliser ces données
              </button>
            </div>
          </label>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>
    );
  }

  // ——— Correspondance des colonnes ———
  const emptyCount = samples.filter((s) => s.length === 0).length;
  const visible = table.headers.map((_, i) => i).filter((i) => showEmpty || samples[i].length > 0);
  const standardFields = mode === "contacts" ? [CONTACT_FIELDS, COMPANY_FIELDS] : [COMPANY_FIELDS];

  return (
    <div className="import-mapping">
      <div className="import-file">
        <div>
          <strong>{table.fileName}</strong>
          <span className="muted">
            {" "}
            · {table.rows.length} ligne{table.rows.length > 1 ? "s" : ""} · {table.headers.length} colonnes
          </span>
        </div>
        <div className="copy-row" style={{ flex: "0 0 auto" }}>
          {table.sheets.length > 1 && lastFile.current ? (
            <select
              className="input"
              value={table.sheet ?? ""}
              onChange={(e) => lastFile.current && void handleFile(lastFile.current, e.target.value)}
            >
              {table.sheets.map((s) => (
                <option key={s} value={s}>
                  Onglet : {s}
                </option>
              ))}
            </select>
          ) : null}
          <button className="btn ghost small" type="button" onClick={reset}>
            Changer de fichier
          </button>
        </div>
      </div>

      <div className="segmented" role="radiogroup" aria-label="Type d'import">
        <button type="button" className={mode === "contacts" ? "active" : ""} onClick={() => changeMode("contacts")}>
          Contacts (et leur entreprise)
        </button>
        <button type="button" className={mode === "companies" ? "active" : ""} onClick={() => changeMode("companies")}>
          Entreprises uniquement
        </button>
      </div>

      <p className="muted" style={{ fontSize: 13, margin: "12px 0 8px" }}>
        {mapped.length} colonne{mapped.length > 1 ? "s" : ""} associée{mapped.length > 1 ? "s" : ""} automatiquement ou
        par vous. Vérifiez et ajustez si besoin : chaque colonne du fichier → un champ du CRM.
      </p>

      <div className="table-wrap mapping-table" style={{ border: "1px solid var(--line)", borderRadius: 8 }}>
        <table>
          <thead>
            <tr>
              <th>Colonne du fichier</th>
              <th>Exemple</th>
              <th>Champ du CRM</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((i) => {
              const target = targets[i] ?? "";
              return (
                <tr key={i} className={target ? "mapped" : ""}>
                  <td>
                    <strong>{table.headers[i]}</strong>
                    <div className="sample-inline muted">{samples[i][0] ?? "vide"}</div>
                  </td>
                  <td className="muted sample">{samples[i][0] ?? <em>vide</em>}</td>
                  <td>
                    <div className="mapping-select">
                      <select className="input" value={target} onChange={(e) => setTarget(i, e.target.value)}>
                        <option value="">— Ne pas importer —</option>
                        {standardFields.map((fields) => (
                          <optgroup key={fields[0].entity} label={fields[0].entity === "contact" ? "Contact" : "Entreprise"}>
                            {fields.map((f) => (
                              <option key={f.target} value={f.target}>
                                {f.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                        {(mode === "contacts" ? (["contact", "company"] as const) : (["company"] as const)).map((entity) =>
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
                          {mode === "contacts" ? (
                            <option value={newCustomTarget("contact")}>+ Nouvelle colonne contact « {table.headers[i]} »</option>
                          ) : null}
                          <option value={newCustomTarget("company")}>+ Nouvelle colonne entreprise « {table.headers[i]} »</option>
                        </optgroup>
                      </select>
                      {autoFlags[i] && target ? <span className="badge badge-green">auto</span> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {emptyCount ? (
        <button className="btn ghost small" type="button" style={{ marginTop: 8 }} onClick={() => setShowEmpty((v) => !v)}>
          {showEmpty ? "Masquer" : "Afficher"} les {emptyCount} colonne{emptyCount > 1 ? "s" : ""} vide{emptyCount > 1 ? "s" : ""}
        </button>
      ) : null}

      <div className="import-options">
        <label>
          Si la fiche existe déjà
          <select className="input" value={policy} onChange={(e) => setPolicy(e.target.value as ExistingPolicy)}>
            <option value="fill">Compléter les champs vides (recommandé)</option>
            <option value="overwrite">Remplacer par les valeurs du fichier</option>
            <option value="skip">Ne pas modifier</option>
          </select>
          <span className="hint">
            {mode === "contacts"
              ? "Contacts reconnus par email, LinkedIn ou nom + entreprise ; entreprises par SIRET ou nom."
              : "Entreprises reconnues par SIRET ou par nom."}
          </span>
        </label>
        {mode === "contacts" && !has("contact.category") && !has("contact.state") ? (
          <>
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
              <select className="input" value={state} onChange={(e) => setState(e.target.value as PersonState)}>
                {PERSON_CATEGORY_STATE_KEYS[category].map((s) => (
                  <option key={s} value={s}>
                    {PERSON_STATE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        {mode === "contacts" && !has("contact.source") ? (
          <label>
            Source
            <input className="input" value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
        ) : null}
      </div>

      {mode === "contacts" && preview.some((p) => p.name) ? (
        <div className="import-preview">
          <span className="hint">Aperçu</span>
          {preview.map((p, i) => (
            <div key={i} className="preview-row">
              <strong>{p.name || "—"}</strong>
              {p.poste ? <span> · {p.poste}</span> : null}
              {p.company ? <span> · {p.company}</span> : null}
              {p.email ? <span className="muted"> · {p.email}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {missing ? <p className="error">{missing}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="import-actions">
        {progress ? (
          <div className="progress" aria-label="Progression de l'import">
            <div style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            <span>
              {progress.done} / {progress.total}
            </span>
          </div>
        ) : null}
        <button className="btn" type="button" disabled={!!missing || !!progress} onClick={() => void runImport()}>
          {progress ? "Import en cours…" : `Importer ${table.rows.length} ligne${table.rows.length > 1 ? "s" : ""}`}
        </button>
      </div>
    </div>
  );
}
