import { MCP_TOOLS } from "@/lib/mcp/registry";
import { CRM_RULES } from "@/lib/mcp/tools/meta";
import { ToolError, toJson, toolAnnotations, type ToolArgs, type ToolContext } from "@/lib/mcp/types";

const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = [
  "Serveur MCP du CRM : contacts, entreprises, actions et statistiques.",
  "Appelez get_crm_schema pour connaître les catégories, états, canaux et colonnes personnalisées valides.",
  ...CRM_RULES,
].join("\n");

type JsonRpcId = string | number | null;

function ok(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function listToolDefinitions() {
  return MCP_TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: toolAnnotations(tool),
  }));
}

async function callTool(id: JsonRpcId, params: Record<string, unknown>, ctx: ToolContext) {
  const name = String(params.name ?? "");
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) return rpcError(id, -32602, `Outil inconnu : ${name}`);

  const rawArgs = params.arguments;
  const args: ToolArgs = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? (rawArgs as ToolArgs) : {};

  try {
    const data = await tool.handler(args, ctx);
    return ok(id, { content: [{ type: "text", text: toJson(data) }] });
  } catch (error) {
    if (!(error instanceof ToolError)) console.error(`[mcp] ${name}`, error);
    const message = error instanceof Error ? error.message : "Erreur inattendue";
    return ok(id, { content: [{ type: "text", text: message }], isError: true });
  }
}

/** Traite un message JSON-RPC ; renvoie null pour les notifications (pas de réponse). */
export async function handleMcpMessage(message: unknown, ctx: ToolContext) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return rpcError(null, -32600, "Requête JSON-RPC invalide");
  }
  const msg = message as { id?: JsonRpcId; method?: unknown; params?: unknown };
  if (typeof msg.method !== "string") {
    if ("result" in msg || "error" in msg) return null;
    return rpcError(msg.id ?? null, -32600, "Requête JSON-RPC invalide");
  }
  if (msg.id === undefined) return null;

  const id = msg.id;
  const params =
    msg.params && typeof msg.params === "object" && !Array.isArray(msg.params)
      ? (msg.params as Record<string, unknown>)
      : {};

  switch (msg.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "crm", title: "CRM", version: "2.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: listToolDefinitions() });
    case "tools/call":
      return callTool(id, params, ctx);
    default:
      return rpcError(id, -32601, `Méthode inconnue : ${msg.method}`);
  }
}
