import Link from "next/link";
import { headers } from "next/headers";
import { listCustomColumns } from "@/lib/custom-columns";
import { formatDateTime } from "@/lib/labels";
import { MCP_TOOLS } from "@/lib/mcp/registry";
import { listConnections, mcpResourceUrl } from "@/lib/oauth";
import { ImportWizard } from "./import-wizard";
import { ClaudeConnect, RevokeButton } from "./settings-client";

export const dynamic = "force-dynamic";

const KIND_LABELS = {
  read: { label: "Lecture", badge: "badge-blue" },
  write: { label: "Écriture", badge: "badge-green" },
  delete: { label: "Suppression", badge: "badge-red" },
} as const;

const TABS = [
  { id: "connexions", label: "Connexions MCP" },
  { id: "import", label: "Import & enrichissement" },
] as const;

type SearchParams = Promise<{ tab?: string }>;

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const tab = (await searchParams).tab === "import" ? "import" : "connexions";

  return (
    <div className="page">
      <div className="page-toolbar">
        <div>
          <h1>Paramètres</h1>
        </div>
      </div>
      <nav className="settings-tabs">
        {TABS.map((t) => (
          <Link key={t.id} href={`/settings?tab=${t.id}`} className={tab === t.id ? "active" : ""}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "import" ? <ImportSettings /> : <McpSettings />}
    </div>
  );
}

async function ImportSettings() {
  const [contact, company] = await Promise.all([listCustomColumns("contact"), listCustomColumns("company")]);
  const pick = (list: typeof contact) => list.map(({ key, label, type }) => ({ key, label, type }));
  return (
    <section className="settings-section wide">
      <h2>Importer des contacts ou des entreprises</h2>
      <p>
        Ajoutez un fichier (CSV, Excel, Google Sheets…) : les colonnes sont associées automatiquement aux champs du CRM,
        vous ajustez si besoin. Les fiches déjà présentes sont complétées plutôt que dupliquées.
      </p>
      <ImportWizard customColumns={{ contact: pick(contact), company: pick(company) }} />
    </section>
  );
}

async function McpSettings() {
  const mcpUrl = mcpResourceUrl(await headers());
  const connections = await listConnections();

  return (
    <>
      <section className="settings-section">
        <h2>Connecteur Claude</h2>
        <p>
          Donnez à Claude l’accès à ce CRM : il pourra rechercher, créer et modifier vos contacts, entreprises et
          actions, et lire les statistiques.
        </p>
        <ClaudeConnect mcpUrl={mcpUrl} />
      </section>

      <section className="settings-section">
        <h2>Applications connectées</h2>
        <p>Applications autorisées à accéder au CRM. Déconnecter une application lui retire l’accès immédiatement.</p>
        {connections.length === 0 ? (
          <p className="muted">Aucune application connectée pour le moment.</p>
        ) : (
          <div className="table-wrap" style={{ border: "1px solid var(--line)", borderRadius: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Autorisée par</th>
                  <th>Connectée le</th>
                  <th>Dernière utilisation</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => (
                  <tr key={c.id}>
                    <td>{c.client.name}</td>
                    <td className="muted">{c.user.email}</td>
                    <td className="muted">{formatDateTime(c.createdAt)}</td>
                    <td className="muted">{formatDateTime(c.lastUsedAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      <RevokeButton id={c.id} name={c.client.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="settings-section">
        <h2>Outils disponibles ({MCP_TOOLS.length})</h2>
        <p>Ce que Claude peut faire dans le CRM. Claude vous demande confirmation avant les actions d’écriture.</p>
        <div className="table-wrap" style={{ border: "1px solid var(--line)", borderRadius: 8 }}>
          <table>
            <thead>
              <tr>
                <th>Outil</th>
                <th>Type</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {MCP_TOOLS.map((tool) => (
                <tr key={tool.name}>
                  <td>
                    <strong>{tool.title}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {tool.name}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${KIND_LABELS[tool.kind].badge}`}>{KIND_LABELS[tool.kind].label}</span>
                  </td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {tool.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="settings-section">
        <h2>Autres outils (Claude Code, Cursor…)</h2>
        <p>Ils se connectent avec la même adresse et la même page d’autorisation.</p>
        <span className="muted" style={{ fontSize: 13 }}>
          Claude Code :
        </span>
        <code className="code-line">claude mcp add --transport http crm {mcpUrl}</code>
        <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
          Pour un script sans connexion interactive, envoyez l’en-tête{" "}
          <code>Authorization: Bearer &lt;MCP_TOKEN&gt;</code> (variable définie dans Railway).
        </p>
      </section>
    </>
  );
}
