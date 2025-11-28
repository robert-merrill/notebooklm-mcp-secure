/**
 * Tool Validation Middleware (before_tool_callback pattern)
 *
 * Implements the before_tool_callback pattern from "Agentic Design Patterns"
 * Chapter 18 - Guardrails/Safety Patterns
 *
 * This module provides pre-execution validation for tool calls,
 * ensuring the Principle of Least Privilege is enforced.
 */

import { log } from "./logger.js";
import { audit } from "./audit-logger.js";
import crypto from "crypto";

/**
 * Session context for validation
 */
export interface SessionContext {
  sessionId: string;
  userId?: string;
  clientId?: string;
  permissions: Set<string>;
  createdAt: Date;
  lastActivity: Date;
  requestCount: number;
}

/**
 * Tool call parameters for validation
 */
export interface ToolCallParams {
  toolName: string;
  args: Record<string, unknown>;
  sessionContext: SessionContext;
}

/**
 * Validation result from before_tool_callback
 */
export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  sanitizedArgs?: Record<string, unknown>;
}

/**
 * Tool permission definitions
 */
const TOOL_PERMISSIONS: Record<string, string[]> = {
  // Read-only tools - minimal permissions
  ask_question: ["read"],
  list_notebooks: ["read"],
  get_notebook: ["read"],
  search_notebooks: ["read"],
  get_library_stats: ["read"],
  list_sessions: ["read"],
  get_health: ["read"],

  // Write tools - require write permission
  add_notebook: ["read", "write"],
  update_notebook: ["read", "write"],
  select_notebook: ["read", "write"],

  // Destructive tools - require admin permission
  remove_notebook: ["read", "write", "admin"],
  close_session: ["read", "write", "admin"],
  reset_session: ["read", "write", "admin"],
  cleanup_data: ["read", "write", "admin"],

  // Auth tools - special permissions
  setup_auth: ["auth"],
  re_auth: ["auth"],
};

/**
 * Sensitive parameter patterns that require extra validation
 */
const SENSITIVE_PARAMS = [
  "user_id",
  "session_id",
  "notebook_id",
  "auth_token",
  "password",
  "secret",
  "key",
  "credential",
];

/**
 * Session context store (in-memory, per-process)
 */
const sessionContexts = new Map<string, SessionContext>();

/**
 * Create or get session context
 */
export function getOrCreateSessionContext(
  sessionId: string,
  userId?: string,
  clientId?: string
): SessionContext {
  let context = sessionContexts.get(sessionId);

  if (!context) {
    context = {
      sessionId,
      userId,
      clientId,
      permissions: new Set(["read"]), // Default: read-only
      createdAt: new Date(),
      lastActivity: new Date(),
      requestCount: 0,
    };
    sessionContexts.set(sessionId, context);
    log.info(`📋 Created session context: ${sessionId}`);
  }

  // Update activity
  context.lastActivity = new Date();
  context.requestCount++;

  return context;
}

/**
 * Grant permissions to a session
 */
export function grantPermissions(
  sessionId: string,
  permissions: string[]
): void {
  const context = sessionContexts.get(sessionId);
  if (context) {
    permissions.forEach((p) => context.permissions.add(p));
    log.info(`🔑 Granted permissions to ${sessionId}: ${permissions.join(", ")}`);
  }
}

/**
 * Revoke permissions from a session
 */
export function revokePermissions(
  sessionId: string,
  permissions: string[]
): void {
  const context = sessionContexts.get(sessionId);
  if (context) {
    permissions.forEach((p) => context.permissions.delete(p));
    log.info(`🔒 Revoked permissions from ${sessionId}: ${permissions.join(", ")}`);
  }
}

/**
 * Clear session context
 */
export function clearSessionContext(sessionId: string): void {
  sessionContexts.delete(sessionId);
  log.info(`🗑️ Cleared session context: ${sessionId}`);
}

/**
 * before_tool_callback - Validate tool call before execution
 *
 * This implements the pattern from Chapter 18:
 * - Validates tool permissions
 * - Checks session state matches parameters
 * - Sanitizes sensitive arguments
 * - Logs security events
 *
 * @returns ValidationResult - { allowed: true } to proceed, { allowed: false, reason } to block
 */
export async function beforeToolCallback(
  params: ToolCallParams
): Promise<ValidationResult> {
  const { toolName, args, sessionContext } = params;

  // 1. Check tool exists in permission map
  const requiredPermissions = TOOL_PERMISSIONS[toolName];
  if (!requiredPermissions) {
    log.warning(`⚠️ Unknown tool: ${toolName}`);
    await audit.security("unknown_tool_call", "warning", {
      tool: toolName,
      session_id: sessionContext.sessionId,
    });
    // Allow unknown tools but log them (fail-open for extensibility)
    return { allowed: true };
  }

  // 2. Check session has required permissions
  const missingPermissions = requiredPermissions.filter(
    (p) => !sessionContext.permissions.has(p)
  );

  if (missingPermissions.length > 0) {
    const reason = `Missing permissions: ${missingPermissions.join(", ")}`;
    log.error(`🚫 [SECURITY] Tool blocked: ${toolName} - ${reason}`);
    await audit.security("permission_denied", "error", {
      tool: toolName,
      session_id: sessionContext.sessionId,
      missing_permissions: missingPermissions,
    });
    return { allowed: false, reason };
  }

  // 3. Validate sensitive parameters match session context
  const sanitizedArgs = { ...args };

  for (const param of SENSITIVE_PARAMS) {
    if (param in args) {
      const argValue = args[param];

      // Session ID validation - must match current session or be undefined
      if (param === "session_id" && argValue !== undefined) {
        if (argValue !== sessionContext.sessionId) {
          // Check if it's a valid session the user owns
          const targetContext = sessionContexts.get(argValue as string);
          if (!targetContext || targetContext.userId !== sessionContext.userId) {
            const reason = `Session ID mismatch: cannot access session ${argValue}`;
            log.error(`🚫 [SECURITY] ${reason}`);
            await audit.security("session_hijack_attempt", "critical", {
              tool: toolName,
              session_id: sessionContext.sessionId,
              target_session: argValue,
            });
            return { allowed: false, reason };
          }
        }
      }

      // User ID validation - must match session user
      if (param === "user_id" && argValue !== undefined) {
        if (sessionContext.userId && argValue !== sessionContext.userId) {
          const reason = `User ID mismatch: ${argValue} vs session user ${sessionContext.userId}`;
          log.error(`🚫 [SECURITY] ${reason}`);
          await audit.security("user_id_mismatch", "critical", {
            tool: toolName,
            session_id: sessionContext.sessionId,
            provided_user: argValue,
            session_user: sessionContext.userId,
          });
          return { allowed: false, reason };
        }
      }

      // Mask sensitive values in sanitized args for logging
      if (["password", "secret", "key", "credential", "auth_token"].includes(param)) {
        sanitizedArgs[param] = "[REDACTED]";
      }
    }
  }

  // 4. Log successful validation
  log.info(`✅ Tool validated: ${toolName}`);
  await audit.tool(toolName, sanitizedArgs, true, 0, "pre_validation_passed");

  return { allowed: true, sanitizedArgs };
}

/**
 * Generate a secure session token
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Validate MCP request headers for authentication
 */
export interface HeaderAuthResult {
  authenticated: boolean;
  userId?: string;
  clientId?: string;
  permissions?: string[];
  error?: string;
}

export function validateAuthHeaders(
  headers: Record<string, string | undefined>
): HeaderAuthResult {
  const authHeader = headers["authorization"] || headers["x-mcp-auth"];
  const clientId = headers["x-client-id"];

  if (!authHeader) {
    return { authenticated: false, error: "No authorization header" };
  }

  // Support Bearer token format
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    const token = bearerMatch[1];
    // In production, validate token against stored tokens
    // For now, we accept any valid-looking token
    if (token.length >= 32) {
      return {
        authenticated: true,
        userId: `user_${crypto.createHash("sha256").update(token).digest("hex").slice(0, 8)}`,
        clientId: clientId as string | undefined,
        permissions: ["read", "write"], // Authenticated users get read/write
      };
    }
  }

  // Support API key format
  const apiKeyMatch = authHeader.match(/^ApiKey\s+(.+)$/i);
  if (apiKeyMatch) {
    const apiKey = apiKeyMatch[1];
    if (apiKey.length >= 32) {
      return {
        authenticated: true,
        userId: `api_${crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 8)}`,
        clientId: clientId as string | undefined,
        permissions: ["read", "write", "admin"], // API keys get full access
      };
    }
  }

  return { authenticated: false, error: "Invalid authorization format" };
}

/**
 * Middleware to wrap tool handlers with before_tool_callback
 */
export function withToolValidation<T extends (...args: unknown[]) => Promise<unknown>>(
  toolName: string,
  handler: T,
  getSessionContext: () => SessionContext
): T {
  return (async (...args: unknown[]) => {
    const sessionContext = getSessionContext();

    // Extract args object (usually first parameter)
    const toolArgs = (args[0] as Record<string, unknown>) || {};

    // Run before_tool_callback
    const validation = await beforeToolCallback({
      toolName,
      args: toolArgs,
      sessionContext,
    });

    if (!validation.allowed) {
      return {
        success: false,
        error: `Security validation failed: ${validation.reason}`,
      };
    }

    // Execute the actual handler
    return handler(...args);
  }) as T;
}

/**
 * Get all active session contexts (for admin/debugging)
 */
export function getActiveSessionContexts(): SessionContext[] {
  return Array.from(sessionContexts.values());
}

/**
 * Clean up expired session contexts
 */
export function cleanupExpiredContexts(maxAgeMs: number = 8 * 60 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, context] of sessionContexts.entries()) {
    if (now - context.lastActivity.getTime() > maxAgeMs) {
      sessionContexts.delete(sessionId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    log.info(`🧹 Cleaned up ${cleaned} expired session contexts`);
  }

  return cleaned;
}
