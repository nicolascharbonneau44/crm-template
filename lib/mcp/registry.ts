import type { McpTool } from "@/lib/mcp/types";
import { metaTools } from "@/lib/mcp/tools/meta";
import { contactTools } from "@/lib/mcp/tools/contacts";
import { companyTools } from "@/lib/mcp/tools/companies";
import { actionTools } from "@/lib/mcp/tools/actions";
import { userTools } from "@/lib/mcp/tools/users";

// Pour exposer une nouvelle fonctionnalité à Claude : créer un McpTool dans lib/mcp/tools/ et l'ajouter ici.
export const MCP_TOOLS: McpTool[] = [...metaTools, ...userTools, ...contactTools, ...companyTools, ...actionTools];
