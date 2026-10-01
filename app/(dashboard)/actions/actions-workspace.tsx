"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionChannel, ActionStatut, PersonCategory } from "@prisma/client";
import {
  ACTION_CHANNELS,
  ACTION_CHANNEL_LABELS,
  ACTION_STATUTS,
  ACTION_STATUT_LABELS,
  PERSON_CATEGORIES,
  PERSON_CATEGORY_LABELS,
  contactDisplayName,
  formatDateTime,
} from "@/lib/labels";
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
import { CustomColumnModal } from "@/app/components/custom-column-modal";
import { UserFilterOptions, userLabel, useUsers, type CrmUser } from "@/app/components/use-users";

type ActionRow = {
  id: string;
  channel: ActionChannel;
  titre: string;
  contenu: string;
  statut: ActionStatut;
  datePrevue: string | Date | null;
  customFields?: string | Record<string, unknown>;
  user: CrmUser | null;
  contact: {
    id: string;
    prenom: string;
    nom: string;
    category: PersonCategory;
    company: { nom: string } | null;
  };
};

type SavedView = { id: string; name: string; viewType: string; filters: Record<string, unknown> };

const STORAGE_KEY = "crm-actions-default-layout";
const BASE_COLUMN_DEFS: ColumnDef[] = [
  { key: "titre", label: "Titre" },
  { key: "contact", label: "Contact" },
  { key: "channel", label: "Canal" },
  { key: "statut", label: "Statut" },
  { key: "datePrevue", label: "Date prévue" },
  { key: "assignee", label: "Responsable" },
];

const DUE_LABELS: Record<string, string> = {
  today: "Aujourd’hui (retards inclus)",
  overdue: "En retard",
  week: "Cette semaine",
};

const DEFAULT_LAYOUT: ListLayoutState = {
  visibleColumnKeys: ["titre", "contact", "channel", "statut", "datePrevue", "assignee"],
  columnOrder: BASE_COLUMN_DEFS.map((c) => c.key),
  viewMode: "list",
  filterRows: [{ id: "f-me", field: "assignee", op: "eq", value: "me" }],
  sortRows: [{ id: "s1", field: "datePrevue", direction: "asc" }],
  kanbanGroupBy: "statut",
  pageSize: 25,
};

export function ActionsWorkspace() {
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [hydrated, setHydrated] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState<ActionRow[]>([]);
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
  const [bulkAssignee, setBulkAssignee] = useState("");
  const { users, currentUserId } = useUsers();

  const filterValue = (field: string) => layout.filterRows.find((r) => r.field === field)?.value ?? "";

  /** Filtre rapide : remplace (ou retire si value vide) la ligne de filtre du champ. */
  function setQuickFilter(field: string, value: string) {
    setLayout((prev) => ({
      ...prev,
      filterRows: [
        ...prev.filterRows.filter((r) => r.field !== field),
        ...(value ? [{ id: uid("f"), field, op: "eq" as const, value }] : []),
      ],
    }));
    setPage(1);
  }

  useEffect(() => {
    setLayout(loadLayout(STORAGE_KEY, DEFAULT_LAYOUT));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || selectedViewId) return;
    saveLayout(STORAGE_KEY, layout);
  }, [layout, hydrated, selectedViewId]);

  const loadViews = useCallback(async () => {
    const res = await fetch("/api/saved-views?entity=actions");
    if (!res.ok) return;
    const data = await res.json();
    setSavedViews(data.data ?? []);
  }, []);

  const loadCustomColumns = useCallback(async () => {
    const res = await fetch("/api/custom-columns?entityType=action");
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

  const fetchActions = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(layout.viewMode === "kanban" ? 1 : page),
      pageSize: String(layout.viewMode === "kanban" ? 1000 : layout.pageSize),
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
    const res = await fetch(`/api/actions?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setActions(data.data ?? []);
      setTotal(data.total ?? 0);
    }
    setLoading(false);
  }, [layout.filterRows, layout.pageSize, layout.sortRows, layout.viewMode, page, q]);

  useEffect(() => {
    if (!hydrated) return;
    void fetchActions();
  }, [hydrated, fetchActions]);

  const visibleCols = useMemo(
    () => orderedVisibleColumns(allColumnDefs, layout.columnOrder, layout.visibleColumnKeys),
    [allColumnDefs, layout.columnOrder, layout.visibleColumnKeys],
  );

  const pageIds = actions.map((a) => a.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const totalPages = Math.max(1, Math.ceil(total / layout.pageSize));

  async function setActionStatut(id: string, statut: ActionStatut) {
    await fetch(`/api/actions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statut }),
    });
    await fetchActions();
  }

  async function bulkDelete() {
    if (!selectedIds.length) return;
    if (!confirm(`Supprimer ${selectedIds.length} action(s) ?`)) return;
    await fetch("/api/actions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", ids: selectedIds }),
    });
    setSelectedIds([]);
    await fetchActions();
  }

  async function bulkAssign(assigneeId: string) {
    if (!assigneeId) return;
    await fetch("/api/actions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign", ids: selectedIds, assigneeId: assigneeId === "none" ? null : assigneeId }),
    });
    setBulkAssignee("");
    setSelectedIds([]);
    await fetchActions();
  }

  async function bulkComplete() {
    await fetch("/api/actions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "updateStatut", ids: selectedIds, statut: "termine" }),
    });
    setSelectedIds([]);
    await fetchActions();
  }

  function applySavedView(viewId: string) {
    setSelectedViewId(viewId);
    if (!viewId) return;
    const view = savedViews.find((v) => v.id === viewId);
    if (!view) return;
    const f = view.filters || {};
    setLayout((prev) => ({
      ...prev,
      viewMode: (view.viewType as "list" | "kanban") || prev.viewMode,
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
        body: JSON.stringify({ name, viewType: layout.viewMode, filters }),
      });
    } else {
      const res = await fetch("/api/saved-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, entity: "actions", viewType: layout.viewMode, filters }),
      });
      if (res.ok) setSelectedViewId((await res.json()).id);
    }
    setSaveViewOpen(false);
    setSaveViewName("");
    await loadViews();
  }

  function cellValue(action: ActionRow, key: string) {
    const custom = customColumns.find((c) => c.key === key);
    if (custom) {
      const fields =
        typeof action.customFields === "string"
          ? parseCustomFields(action.customFields)
          : (action.customFields ?? {});
      return formatCustomFieldValue(fields[key], custom.type);
    }
    switch (key) {
      case "titre":
        return action.titre;
      case "contact":
        return (
          <>
            {contactDisplayName(action.contact)}
            <div className="muted">{action.contact.company?.nom ?? ""}</div>
          </>
        );
      case "channel":
        return ACTION_CHANNEL_LABELS[action.channel];
      case "statut":
        return <span className="badge badge-gray">{ACTION_STATUT_LABELS[action.statut]}</span>;
      case "datePrevue":
        return <span className="muted">{formatDateTime(action.datePrevue)}</span>;
      case "assignee":
        return action.user ? userLabel(action.user) : <span className="muted">Non attribuée</span>;
      default:
        return "—";
    }
  }

  return (
    <div className="page">
      <div className="page-toolbar">
        <h1>Actions</h1>
        <input
          className="input toolbar-input"
          placeholder="Rechercher (titre, contact…)"
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
        <div className="segmented">
          <button type="button" className={layout.viewMode === "list" ? "active" : ""} onClick={() => setLayout((p) => ({ ...p, viewMode: "list" }))}>
            Liste
          </button>
          <button type="button" className={layout.viewMode === "kanban" ? "active" : ""} onClick={() => setLayout((p) => ({ ...p, viewMode: "kanban" }))}>
            Kanban
          </button>
        </div>
        {selectedIds.length > 0 ? (
          <>
            <button className="btn small" type="button" onClick={() => void bulkComplete()}>
              Terminer ({selectedIds.length})
            </button>
            <select
              className="select"
              style={{ width: 170 }}
              value={bulkAssignee}
              onChange={(e) => void bulkAssign(e.target.value)}
              aria-label="Attribuer les actions sélectionnées"
            >
              <option value="">Attribuer à…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {userLabel(u)}
                  {u.id === currentUserId ? " (moi)" : ""}
                </option>
              ))}
              <option value="none">Non attribuée</option>
            </select>
            <button className="btn danger small" type="button" onClick={() => void bulkDelete()}>
              Supprimer ({selectedIds.length})
            </button>
          </>
        ) : null}
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
          <span>
            {layout.viewMode === "kanban" ? `${actions.length} / ${total} actions` : pageLabel(total, page, layout.pageSize)}
          </span>
          {layout.viewMode === "list" ? (
            <>
              <button className="btn secondary small" type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Préc.
              </button>
              <button className="btn secondary small" type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Suiv.
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="quick-filters">
        <div className="segmented" role="group" aria-label="Responsable">
          <button
            type="button"
            className={filterValue("assignee") === "me" ? "active" : ""}
            onClick={() => setQuickFilter("assignee", "me")}
          >
            Mes relances
          </button>
          <button
            type="button"
            className={!filterValue("assignee") ? "active" : ""}
            onClick={() => setQuickFilter("assignee", "")}
          >
            Toute l’équipe
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Échéance">
          {[
            ["", "Toutes dates"],
            ["today", "Aujourd’hui"],
            ["overdue", "En retard"],
            ["week", "Cette semaine"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filterValue("due") === value ? "active" : ""}
              onClick={() => setQuickFilter("due", value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {showFilters ? (
        <div className="panel-soft">
          {layout.filterRows.map((row) => (
            <div className="panel-soft-row" key={row.id}>
              <select
                className="select"
                style={{ width: 160 }}
                value={row.field}
                onChange={(e) =>
                  setLayout((prev) => ({
                    ...prev,
                    filterRows: prev.filterRows.map((r) => (r.id === row.id ? { ...r, field: e.target.value, value: "" } : r)),
                  }))
                }
              >
                <option value="channel">Canal</option>
                <option value="statut">Statut</option>
                <option value="contactCategory">Catégorie contact</option>
                <option value="titre">Titre</option>
                <option value="assignee">Responsable</option>
                <option value="due">Échéance</option>
              </select>
              {row.field === "assignee" ? (
                <select className="select" style={{ width: 180 }} value={row.value} onChange={(e) => { setLayout((prev) => ({ ...prev, filterRows: prev.filterRows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)) })); setPage(1); }}>
                  <UserFilterOptions users={users} currentUserId={currentUserId} />
                </select>
              ) : row.field === "due" ? (
                <select className="select" style={{ width: 200 }} value={row.value} onChange={(e) => { setLayout((prev) => ({ ...prev, filterRows: prev.filterRows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)) })); setPage(1); }}>
                  <option value="">—</option>
                  {Object.entries(DUE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              ) : row.field === "channel" ? (
                <select className="select" style={{ width: 160 }} value={row.value} onChange={(e) => { setLayout((prev) => ({ ...prev, filterRows: prev.filterRows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)) })); setPage(1); }}>
                  <option value="">—</option>
                  {ACTION_CHANNELS.map((c) => (
                    <option key={c} value={c}>{ACTION_CHANNEL_LABELS[c]}</option>
                  ))}
                </select>
              ) : row.field === "statut" ? (
                <select className="select" style={{ width: 160 }} value={row.value} onChange={(e) => { setLayout((prev) => ({ ...prev, filterRows: prev.filterRows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)) })); setPage(1); }}>
                  <option value="">—</option>
                  {ACTION_STATUTS.map((s) => (
                    <option key={s} value={s}>{ACTION_STATUT_LABELS[s]}</option>
                  ))}
                </select>
              ) : row.field === "contactCategory" ? (
                <select className="select" style={{ width: 160 }} value={row.value} onChange={(e) => { setLayout((prev) => ({ ...prev, filterRows: prev.filterRows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)) })); setPage(1); }}>
                  <option value="">—</option>
                  {PERSON_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{PERSON_CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              ) : (
                <input className="input" style={{ width: 200 }} value={row.value} onChange={(e) => { setLayout((prev) => ({ ...prev, filterRows: prev.filterRows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)) })); setPage(1); }} />
              )}
              <button className="btn ghost small" type="button" onClick={() => setLayout((prev) => ({ ...prev, filterRows: prev.filterRows.filter((r) => r.id !== row.id) }))}>×</button>
            </div>
          ))}
          <button className="btn dashed small" type="button" onClick={() => setLayout((prev) => ({ ...prev, filterRows: [...prev.filterRows, { id: uid("f"), field: "statut", op: "eq", value: "" }] }))}>
            + Filtre
          </button>
        </div>
      ) : null}

      {showSorts ? (
        <div className="panel-soft">
          {layout.sortRows.map((row) => (
            <div className="panel-soft-row" key={row.id}>
              <select className="select" style={{ width: 180 }} value={row.field} onChange={(e) => setLayout((prev) => ({ ...prev, sortRows: prev.sortRows.map((r) => (r.id === row.id ? { ...r, field: e.target.value } : r)) }))}>
                <option value="datePrevue">Date prévue</option>
                <option value="titre">Titre</option>
                <option value="statut">Statut</option>
                <option value="channel">Canal</option>
                <option value="createdAt">Création</option>
                <option value="contact">Contact</option>
              </select>
              <select className="select" style={{ width: 140 }} value={row.direction} onChange={(e) => setLayout((prev) => ({ ...prev, sortRows: prev.sortRows.map((r) => (r.id === row.id ? { ...r, direction: e.target.value as "asc" | "desc" } : r)) }))}>
                <option value="asc">Croissant</option>
                <option value="desc">Décroissant</option>
              </select>
              <button className="btn ghost small" type="button" onClick={() => setLayout((prev) => ({ ...prev, sortRows: prev.sortRows.filter((r) => r.id !== row.id) }))}>×</button>
            </div>
          ))}
          <button className="btn dashed small" type="button" onClick={() => setLayout((prev) => ({ ...prev, sortRows: [...prev.sortRows, { id: uid("s"), field: "datePrevue", direction: "asc" }] }))}>
            + Tri
          </button>
        </div>
      ) : null}

      <div className="page-body">
        {loading ? (
          <p className="empty">Chargement…</p>
        ) : layout.viewMode === "list" ? (
          actions.length === 0 ? (
            <p className="empty">Aucune action.</p>
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
                  {actions.map((action) => (
                    <tr
                      className={`row-link ${selectedIds.includes(action.id) ? "selected" : ""}`}
                      key={action.id}
                      onClick={() => {
                        window.location.href = `/contacts?contact=${action.contact.id}`;
                      }}
                    >
                      <td className="col-check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(action.id)}
                          onChange={() =>
                            setSelectedIds((prev) =>
                              prev.includes(action.id) ? prev.filter((x) => x !== action.id) : [...prev, action.id],
                            )
                          }
                        />
                      </td>
                      {visibleCols.map((col) => (
                        <td key={col.key}>{cellValue(action, col.key)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="pipeline">
            {ACTION_STATUTS.map((col) => {
              const items = actions.filter((a) => a.statut === col);
              return (
                <section
                  className="column"
                  key={col}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    if (id) void setActionStatut(id, col);
                  }}
                >
                  <h2>
                    <span>{ACTION_STATUT_LABELS[col]}</span>
                    <span className="muted">{items.length}</span>
                  </h2>
                  {items.map((action) => (
                    <article
                      className="kanban-card"
                      draggable
                      key={action.id}
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", action.id)}
                      onClick={() => {
                        window.location.href = `/contacts?contact=${action.contact.id}`;
                      }}
                    >
                      <h3>{action.titre}</h3>
                      <p className="muted" style={{ margin: 0 }}>
                        {contactDisplayName(action.contact)} · {ACTION_CHANNEL_LABELS[action.channel]}
                        {action.user ? ` · ${userLabel(action.user)}` : ""}
                      </p>
                    </article>
                  ))}
                </section>
              );
            })}
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

      <CustomColumnModal
        open={columnModalOpen}
        entityType="action"
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
