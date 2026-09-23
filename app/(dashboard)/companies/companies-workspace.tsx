"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SidePeek } from "@/app/components/side-peek";
import { contactDisplayName } from "@/lib/labels";
import {
  PAGE_SIZE_OPTIONS,
  loadLayout,
  moveColumn,
  orderedVisibleColumns,
  pageLabel,
  saveLayout,
  uid,
  type ColumnDef,
  type FilterRow,
  type ListLayoutState,
  type SortRow,
} from "@/lib/list-layout";
import {
  formatCustomFieldValue,
  parseCustomFields,
  type CustomColumnRecord,
} from "@/lib/custom-columns";
import { CustomColumnModal, CustomFieldInputs } from "@/app/components/custom-column-modal";

type CompanyRow = {
  id: string;
  nom: string;
  email: string | null;
  telephone: string | null;
  adresse: string | null;
  siteWeb: string | null;
  siret: string | null;
  codeNaf: string | null;
  effectif: number | null;
  linkedinUrl: string | null;
  description: string | null;
  notes: string | null;
  customFields?: string | Record<string, unknown>;
  _count?: { contacts: number };
  contacts?: Array<{ id: string; prenom: string; nom: string; email: string | null }>;
};

type SavedView = { id: string; name: string; viewType: string; filters: Record<string, unknown> };

const STORAGE_KEY = "crm-companies-default-layout";
const BASE_COLUMN_DEFS: ColumnDef[] = [
  { key: "nom", label: "Nom" },
  { key: "siteWeb", label: "Site" },
  { key: "email", label: "E-mail" },
  { key: "telephone", label: "Téléphone" },
  { key: "siret", label: "SIRET" },
  { key: "codeNaf", label: "Code NAF" },
  { key: "effectif", label: "Effectif" },
  { key: "contactsCount", label: "Contacts" },
];

const DEFAULT_LAYOUT: ListLayoutState = {
  visibleColumnKeys: ["nom", "siteWeb", "email", "codeNaf", "effectif", "contactsCount"],
  columnOrder: BASE_COLUMN_DEFS.map((c) => c.key),
  viewMode: "list",
  filterRows: [],
  sortRows: [{ id: "s1", field: "nom", direction: "asc" }],
  kanbanGroupBy: "",
  pageSize: 25,
};

function getCustomFields(company: CompanyRow) {
  return typeof company.customFields === "string"
    ? parseCustomFields(company.customFields)
    : (company.customFields ?? {});
}

export function CompaniesWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [hydrated, setHydrated] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [showSorts, setShowSorts] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState("");
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const [customColumns, setCustomColumns] = useState<CustomColumnRecord[]>([]);
  const [columnModalOpen, setColumnModalOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<CustomColumnRecord | null>(null);
  const [customFieldDraft, setCustomFieldDraft] = useState<Record<string, unknown>>({});
  const [selected, setSelected] = useState<CompanyRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"info" | "notes" | "contacts">("info");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLayout(loadLayout(STORAGE_KEY, DEFAULT_LAYOUT));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || selectedViewId) return;
    saveLayout(STORAGE_KEY, layout);
  }, [layout, hydrated, selectedViewId]);

  const loadViews = useCallback(async () => {
    const res = await fetch("/api/saved-views?entity=companies");
    if (!res.ok) return;
    const data = await res.json();
    setSavedViews(data.data ?? []);
  }, []);

  const loadCustomColumns = useCallback(async () => {
    const res = await fetch("/api/custom-columns?entityType=company");
    if (!res.ok) return;
    const data = await res.json();
    setCustomColumns(data.data ?? []);
  }, []);

  useEffect(() => {
    void loadViews();
    void loadCustomColumns();
  }, [loadViews, loadCustomColumns]);

  const allColumnDefs = useMemo<ColumnDef[]>(
    () => [
      ...BASE_COLUMN_DEFS,
      ...customColumns.map((c) => ({
        key: c.key,
        label: c.label,
        isCustom: true,
        customType: c.type,
        customId: c.id,
      })),
    ],
    [customColumns],
  );

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(layout.pageSize),
    });
    if (q.trim()) params.set("q", q.trim());
    for (const row of layout.filterRows) {
      if (row.value) params.set(row.field, row.value);
    }
    if (layout.sortRows.length) {
      params.set(
        "sorts",
        JSON.stringify(layout.sortRows.map((s) => ({ field: s.field, direction: s.direction }))),
      );
    }
    const res = await fetch(`/api/companies?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setCompanies(data.data ?? []);
      setTotal(data.total ?? 0);
    }
    setLoading(false);
  }, [layout.filterRows, layout.pageSize, layout.sortRows, page, q]);

  useEffect(() => {
    if (!hydrated) return;
    void fetchCompanies();
  }, [hydrated, fetchCompanies]);

  useEffect(() => {
    const id = searchParams.get("company");
    if (id) void openCompany(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleCols = useMemo(
    () => orderedVisibleColumns(allColumnDefs, layout.columnOrder, layout.visibleColumnKeys),
    [allColumnDefs, layout.columnOrder, layout.visibleColumnKeys],
  );

  const pageIds = companies.map((c) => c.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));

  async function openCompany(id: string) {
    const res = await fetch(`/api/companies/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setSelected(data);
    setCustomFieldDraft(getCustomFields(data));
    setCreating(false);
    setTab("info");
    const params = new URLSearchParams(searchParams.toString());
    params.set("company", id);
    router.replace(`/companies?${params.toString()}`);
  }

  function closePeek() {
    setSelected(null);
    setCreating(false);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("company");
    const qs = params.toString();
    router.replace(qs ? `/companies?${qs}` : "/companies");
  }

  function openCreate() {
    setCreating(true);
    setSelected({
      id: "",
      nom: "",
      email: "",
      telephone: "",
      adresse: "",
      siteWeb: "",
      siret: "",
      codeNaf: "",
      effectif: null,
      linkedinUrl: "",
      description: "",
      notes: "",
      customFields: {},
      contacts: [],
    });
    setCustomFieldDraft({});
    setTab("info");
  }

  async function saveCompany(form: FormData) {
    if (!selected) return;
    setSaving(true);
    setError("");
    const payload = Object.fromEntries(
      ["nom", "email", "telephone", "adresse", "siteWeb", "siret", "codeNaf", "effectif", "linkedinUrl", "description", "notes"].map(
        (k) => [k, String(form.get(k) ?? "") || null],
      ),
    );
    payload.nom = String(form.get("nom") ?? "");
    (payload as Record<string, unknown>).customFields = customFieldDraft;
    const url = creating || !selected.id ? "/api/companies" : `/api/companies/${selected.id}`;
    const res = await fetch(url, {
      method: creating || !selected.id ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Enregistrement impossible");
      return;
    }
    const saved = await res.json();
    setSelected(saved);
    setCustomFieldDraft(getCustomFields(saved));
    setCreating(false);
    await fetchCompanies();
  }

  async function deleteCompany() {
    if (!selected?.id || creating) return;
    if (!confirm(`Supprimer ${selected.nom} ?`)) return;
    await fetch(`/api/companies/${selected.id}`, { method: "DELETE" });
    closePeek();
    await fetchCompanies();
  }

  async function bulkDelete() {
    if (!selectedIds.length) return;
    if (!confirm(`Supprimer ${selectedIds.length} entreprise(s) ?`)) return;
    await fetch("/api/companies/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", ids: selectedIds }),
    });
    setSelectedIds([]);
    await fetchCompanies();
  }

  function applySavedView(viewId: string) {
    setSelectedViewId(viewId);
    if (!viewId) return;
    const view = savedViews.find((v) => v.id === viewId);
    if (!view) return;
    const f = view.filters || {};
    setLayout((prev) => ({
      ...prev,
      filterRows: (f.filterRows as FilterRow[]) || [],
      sortRows: (f.sortRows as SortRow[]) || prev.sortRows,
      visibleColumnKeys: (f.visibleColumnKeys as string[]) || prev.visibleColumnKeys,
      columnOrder: (f.columnOrder as string[]) || prev.columnOrder,
      pageSize: (f.pageSize as number) || prev.pageSize,
    }));
    setPage(1);
  }

  async function saveCurrentView() {
    const name = saveViewName.trim();
    if (!name) return;
    const filters = {
      filterRows: layout.filterRows,
      sortRows: layout.sortRows,
      visibleColumnKeys: layout.visibleColumnKeys,
      columnOrder: layout.columnOrder,
      pageSize: layout.pageSize,
    };
    if (selectedViewId) {
      await fetch(`/api/saved-views/${selectedViewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, viewType: "list", filters }),
      });
    } else {
      const res = await fetch("/api/saved-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, entity: "companies", viewType: "list", filters }),
      });
      if (res.ok) setSelectedViewId((await res.json()).id);
    }
    setSaveViewOpen(false);
    setSaveViewName("");
    await loadViews();
  }

  const totalPages = Math.max(1, Math.ceil(total / layout.pageSize));

  function cellValue(company: CompanyRow, key: string) {
    const custom = customColumns.find((c) => c.key === key);
    if (custom) return formatCustomFieldValue(getCustomFields(company)[key], custom.type);
    if (key === "contactsCount") return company._count?.contacts ?? company.contacts?.length ?? 0;
    if (key === "effectif") return company.effectif == null ? "—" : company.effectif.toLocaleString("fr-FR");
    const value = (company as unknown as Record<string, unknown>)[key];
    return value ? String(value) : "—";
  }

  return (
    <div className="page">
      <div className="page-toolbar">
        <h1>Entreprises</h1>
        <input
          className="input toolbar-input"
          placeholder="Rechercher (nom, site…)"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select className="select" style={{ width: 180 }} value={selectedViewId} onChange={(e) => applySavedView(e.target.value)}>
          <option value="">— Aucune vue sauvegardée —</option>
          {savedViews.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <button
          className="btn soft small"
          type="button"
          onClick={() => {
            setSaveViewName(savedViews.find((v) => v.id === selectedViewId)?.name ?? "");
            setSaveViewOpen(true);
          }}
        >
          {selectedViewId ? "Gérer la vue" : "Sauvegarder la vue"}
        </button>
        <button className={`icon-btn ${showFilters ? "active" : ""}`} type="button" title="Filtres" onClick={() => setShowFilters((v) => !v)}>
          ⚙
        </button>
        <button className={`icon-btn ${showSorts ? "active" : ""}`} type="button" title="Tris" onClick={() => setShowSorts((v) => !v)}>
          ↕
        </button>
        <div className="dropdown">
          <button className={`icon-btn ${showColumns ? "active" : ""}`} type="button" title="Colonnes" onClick={() => setShowColumns((v) => !v)}>
            👁
          </button>
          {showColumns ? (
            <div className="dropdown-menu">
              <div className="dropdown-title">Colonnes visibles</div>
              {allColumnDefs.map((col) => (
                <label key={col.key}>
                  <input
                    type="checkbox"
                    checked={layout.visibleColumnKeys.includes(col.key)}
                    onChange={(e) =>
                      setLayout((prev) => ({
                        ...prev,
                        visibleColumnKeys: e.target.checked
                          ? [...prev.visibleColumnKeys, col.key]
                          : prev.visibleColumnKeys.filter((k) => k !== col.key),
                        columnOrder: e.target.checked
                          ? prev.columnOrder.includes(col.key)
                            ? prev.columnOrder
                            : [...prev.columnOrder, col.key]
                          : prev.columnOrder,
                      }))
                    }
                  />
                  <span style={{ flex: 1 }}>{col.label}</span>
                  {col.isCustom ? (
                    <span style={{ display: "inline-flex", gap: 4 }} onClick={(e) => e.preventDefault()}>
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => {
                          const full = customColumns.find((c) => c.id === col.customId);
                          if (!full) return;
                          setEditingColumn(full);
                          setColumnModalOpen(true);
                          setShowColumns(false);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => {
                          if (!col.customId || !confirm(`Supprimer la colonne « ${col.label} » ?`)) return;
                          void fetch(`/api/custom-columns/${col.customId}`, { method: "DELETE" }).then(() => {
                            setLayout((prev) => ({
                              ...prev,
                              visibleColumnKeys: prev.visibleColumnKeys.filter((k) => k !== col.key),
                              columnOrder: prev.columnOrder.filter((k) => k !== col.key),
                            }));
                            void loadCustomColumns();
                          });
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ) : null}
                </label>
              ))}
              <div style={{ borderTop: "1px solid var(--line)", marginTop: 8, padding: "8px 12px" }}>
                <button
                  className="btn soft small"
                  type="button"
                  style={{ width: "100%" }}
                  onClick={() => {
                    setEditingColumn(null);
                    setColumnModalOpen(true);
                    setShowColumns(false);
                  }}
                >
                  + Ajouter une colonne
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {selectedIds.length > 0 ? (
          <button className="btn danger small" type="button" onClick={() => void bulkDelete()}>
            Supprimer ({selectedIds.length})
          </button>
        ) : null}
        <button className="btn" type="button" onClick={openCreate}>
          Nouvelle entreprise
        </button>
        <div className="pagination-bar">
          <select
            className="select"
            style={{ width: 90 }}
            value={layout.pageSize}
            onChange={(e) => {
              setLayout((p) => ({ ...p, pageSize: Number(e.target.value) }));
              setPage(1);
            }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}/page
              </option>
            ))}
          </select>
          <span>{pageLabel(total, page, layout.pageSize)}</span>
          <button className="btn secondary small" type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Préc.
          </button>
          <button className="btn secondary small" type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Suiv.
          </button>
        </div>
      </div>

      {showFilters ? (
        <div className="panel-soft">
          {layout.filterRows.map((row) => (
            <div className="panel-soft-row" key={row.id}>
              <select
                className="select"
                style={{ width: 140 }}
                value={row.field}
                onChange={(e) =>
                  setLayout((prev) => ({
                    ...prev,
                    filterRows: prev.filterRows.map((r) => (r.id === row.id ? { ...r, field: e.target.value, value: "" } : r)),
                  }))
                }
              >
                <option value="email">E-mail</option>
                <option value="siteWeb">Site</option>
                <option value="siret">SIRET</option>
                <option value="codeNaf">Code NAF</option>
              </select>
              <input
                className="input"
                style={{ width: 200 }}
                value={row.value}
                onChange={(e) => {
                  setLayout((prev) => ({
                    ...prev,
                    filterRows: prev.filterRows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)),
                  }));
                  setPage(1);
                }}
              />
              <button
                className="btn ghost small"
                type="button"
                onClick={() => setLayout((prev) => ({ ...prev, filterRows: prev.filterRows.filter((r) => r.id !== row.id) }))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="btn dashed small"
            type="button"
            onClick={() =>
              setLayout((prev) => ({
                ...prev,
                filterRows: [...prev.filterRows, { id: uid("f"), field: "email", op: "contains", value: "" }],
              }))
            }
          >
            + Filtre
          </button>
        </div>
      ) : null}

      {showSorts ? (
        <div className="panel-soft">
          {layout.sortRows.map((row) => (
            <div className="panel-soft-row" key={row.id}>
              <select
                className="select"
                style={{ width: 180 }}
                value={row.field}
                onChange={(e) =>
                  setLayout((prev) => ({
                    ...prev,
                    sortRows: prev.sortRows.map((r) => (r.id === row.id ? { ...r, field: e.target.value } : r)),
                  }))
                }
              >
                <option value="nom">Nom</option>
                <option value="email">E-mail</option>
                <option value="siteWeb">Site</option>
                <option value="updatedAt">MAJ</option>
                <option value="effectif">Effectif</option>
                <option value="codeNaf">Code NAF</option>
                <option value="contactsCount">Contacts</option>
              </select>
              <select
                className="select"
                style={{ width: 140 }}
                value={row.direction}
                onChange={(e) =>
                  setLayout((prev) => ({
                    ...prev,
                    sortRows: prev.sortRows.map((r) =>
                      r.id === row.id ? { ...r, direction: e.target.value as "asc" | "desc" } : r,
                    ),
                  }))
                }
              >
                <option value="asc">Croissant</option>
                <option value="desc">Décroissant</option>
              </select>
              <button
                className="btn ghost small"
                type="button"
                onClick={() => setLayout((prev) => ({ ...prev, sortRows: prev.sortRows.filter((r) => r.id !== row.id) }))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="btn dashed small"
            type="button"
            onClick={() =>
              setLayout((prev) => ({
                ...prev,
                sortRows: [...prev.sortRows, { id: uid("s"), field: "nom", direction: "asc" }],
              }))
            }
          >
            + Tri
          </button>
        </div>
      ) : null}

      <div className="page-body">
        {loading ? (
          <p className="empty">Chargement…</p>
        ) : companies.length === 0 ? (
          <p className="empty">Aucune entreprise.</p>
        ) : (
          <div className="table-wrap">
            <table className="list-table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={() =>
                        setSelectedIds((prev) =>
                          allPageSelected ? prev.filter((id) => !pageIds.includes(id)) : Array.from(new Set([...prev, ...pageIds])),
                        )
                      }
                    />
                  </th>
                  {visibleCols.map((col) => (
                    <th
                      key={col.key}
                      draggable
                      className={`${dragCol === col.key ? "dragging" : ""} ${dropCol === col.key ? "drop-before" : ""}`}
                      onDragStart={() => setDragCol(col.key)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDropCol(col.key);
                      }}
                      onDrop={() => {
                        if (dragCol && dropCol && dragCol !== dropCol) {
                          setLayout((prev) => ({ ...prev, columnOrder: moveColumn(prev.columnOrder, dragCol, dropCol) }));
                        }
                        setDragCol(null);
                        setDropCol(null);
                      }}
                      onDragEnd={() => {
                        setDragCol(null);
                        setDropCol(null);
                      }}
                    >
                      <span className="col-handle">⠿</span>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr
                    className={`row-link ${selectedIds.includes(company.id) ? "selected" : ""}`}
                    key={company.id}
                    onClick={() => void openCompany(company.id)}
                  >
                    <td className="col-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(company.id)}
                        onChange={() =>
                          setSelectedIds((prev) =>
                            prev.includes(company.id) ? prev.filter((x) => x !== company.id) : [...prev, company.id],
                          )
                        }
                      />
                    </td>
                    {visibleCols.map((col) => (
                      <td key={col.key}>{cellValue(company, col.key)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {saveViewOpen ? (
        <div className="modal-backdrop" onClick={() => setSaveViewOpen(false)}>
          <div className="modal-card form-grid" onClick={(e) => e.stopPropagation()}>
            <h3>Sauvegarder la vue</h3>
            <label>
              Nom
              <input className="input" value={saveViewName} onChange={(e) => setSaveViewName(e.target.value)} />
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn secondary small" type="button" onClick={() => setSaveViewOpen(false)}>
                Annuler
              </button>
              <button className="btn small" type="button" onClick={() => void saveCurrentView()}>
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <SidePeek
        open={!!selected}
        title={creating || !selected?.id ? "Nouvelle entreprise" : selected.nom || "Sans nom"}
        onClose={closePeek}
        actions={
          selected?.id && !creating ? (
            <button className="btn danger small" type="button" onClick={() => void deleteCompany()}>
              Supprimer
            </button>
          ) : null
        }
      >
        {selected ? (
          <>
            <div className="tabs">
              <button type="button" className={tab === "info" ? "active" : ""} onClick={() => setTab("info")}>
                Informations
              </button>
              <button type="button" className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>
                Notes
              </button>
              <button
                type="button"
                className={tab === "contacts" ? "active" : ""}
                onClick={() => setTab("contacts")}
                disabled={creating || !selected.id}
              >
                Contacts
              </button>
            </div>
            {error ? <p className="error">{error}</p> : null}
            {tab === "contacts" ? (
              <div className="actions-list">
                {(selected.contacts ?? []).length === 0 ? (
                  <p className="muted">Aucun contact rattaché.</p>
                ) : (
                  (selected.contacts ?? []).map((c) => (
                    <a key={c.id} className="action-item" href={`/contacts?contact=${c.id}`}>
                      <strong>{contactDisplayName(c)}</strong>
                      <div className="muted">{c.email ?? "—"}</div>
                    </a>
                  ))
                )}
              </div>
            ) : (
              <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveCompany(new FormData(e.currentTarget));
                }}
              >
                {tab === "info" ? (
                  <>
                    <label>
                      Nom
                      <input className="input" name="nom" required defaultValue={selected.nom} />
                    </label>
                    <div className="form-row">
                      <label>
                        E-mail
                        <input className="input" name="email" type="email" defaultValue={selected.email ?? ""} />
                      </label>
                      <label>
                        Téléphone
                        <input className="input" name="telephone" defaultValue={selected.telephone ?? ""} />
                      </label>
                    </div>
                    <label>
                      Site web
                      <input className="input" name="siteWeb" defaultValue={selected.siteWeb ?? ""} />
                    </label>
                    <div className="form-row">
                      <label>
                        SIRET
                        <input className="input" name="siret" defaultValue={selected.siret ?? ""} />
                      </label>
                      <label>
                        Code NAF
                        <input className="input" name="codeNaf" placeholder="ex. 10.12Z" defaultValue={selected.codeNaf ?? ""} />
                      </label>
                    </div>
                    <label>
                      Effectif (nombre approximatif de salariés)
                      <input
                        className="input"
                        name="effectif"
                        type="number"
                        min={0}
                        step={1}
                        placeholder="ex. 50"
                        defaultValue={selected.effectif ?? ""}
                      />
                    </label>
                    <label>
                      LinkedIn
                      <input className="input" name="linkedinUrl" defaultValue={selected.linkedinUrl ?? ""} />
                    </label>
                    <label>
                      Adresse
                      <input className="input" name="adresse" defaultValue={selected.adresse ?? ""} />
                    </label>
                    <label>
                      Description
                      <textarea className="textarea" name="description" defaultValue={selected.description ?? ""} />
                    </label>
                    <CustomFieldInputs
                      columns={customColumns}
                      values={customFieldDraft}
                      onChange={(key, value) => setCustomFieldDraft((prev) => ({ ...prev, [key]: value }))}
                    />
                    <input type="hidden" name="notes" defaultValue={selected.notes ?? ""} />
                  </>
                ) : (
                  <>
                    <input type="hidden" name="nom" defaultValue={selected.nom} />
                    <input type="hidden" name="email" defaultValue={selected.email ?? ""} />
                    <input type="hidden" name="telephone" defaultValue={selected.telephone ?? ""} />
                    <input type="hidden" name="siteWeb" defaultValue={selected.siteWeb ?? ""} />
                    <input type="hidden" name="siret" defaultValue={selected.siret ?? ""} />
                    <input type="hidden" name="codeNaf" defaultValue={selected.codeNaf ?? ""} />
                    <input type="hidden" name="effectif" defaultValue={selected.effectif ?? ""} />
                    <input type="hidden" name="linkedinUrl" defaultValue={selected.linkedinUrl ?? ""} />
                    <input type="hidden" name="adresse" defaultValue={selected.adresse ?? ""} />
                    <input type="hidden" name="description" defaultValue={selected.description ?? ""} />
                    <label>
                      Notes
                      <textarea className="textarea" name="notes" defaultValue={selected.notes ?? ""} />
                    </label>
                  </>
                )}
                <button className="btn" disabled={saving} type="submit">
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </form>
            )}
          </>
        ) : null}
      </SidePeek>

      <CustomColumnModal
        open={columnModalOpen}
        entityType="company"
        column={
          editingColumn
            ? {
                id: editingColumn.id,
                label: editingColumn.label,
                type: editingColumn.type as "text" | "number" | "date" | "boolean",
                key: editingColumn.key,
              }
            : null
        }
        onClose={() => {
          setColumnModalOpen(false);
          setEditingColumn(null);
        }}
        onSaved={() => void loadCustomColumns()}
      />
    </div>
  );
}
