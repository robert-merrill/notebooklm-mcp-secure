/**
 * Webhook Dispatcher
 *
 * Delivers events to configured webhook endpoints with retry logic.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { log } from "../utils/logger.js";
import { writeFileSecure, PERMISSION_MODES } from "../utils/file-permissions.js";
import { CONFIG } from "../config.js";
import { eventEmitter } from "../events/event-emitter.js";
import type { SystemEvent, EventType } from "../events/event-types.js";
import type {
  WebhookConfig,
  WebhookDelivery,
  WebhookStats,
  AddWebhookInput,
  UpdateWebhookInput,
} from "./types.js";

interface WebhooksStore {
  webhooks: WebhookConfig[];
  deliveries: WebhookDelivery[];
  version: string;
}

export class WebhookDispatcher {
  private storePath: string;
  private store: WebhooksStore;
  private unsubscribe: (() => void) | null = null;
  private deliveryHistory: WebhookDelivery[] = [];
  private maxDeliveryHistory = 100;

  constructor() {
    this.storePath = path.join(CONFIG.dataDir, "webhooks.json");
    this.store = this.loadStore();
    this.initializeFromEnv();
    this.subscribeToEvents();

    log.info("🔔 WebhookDispatcher initialized");
    log.info(`  Webhooks: ${this.store.webhooks.filter((w) => w.enabled).length} active`);
  }

  /**
   * Load webhooks from disk
   */
  private loadStore(): WebhooksStore {
    try {
      if (fs.existsSync(this.storePath)) {
        const data = fs.readFileSync(this.storePath, "utf-8");
        return JSON.parse(data);
      }
    } catch (error) {
      log.warning(`Failed to load webhooks: ${error}`);
    }

    return {
      webhooks: [],
      deliveries: [],
      version: "1.0.0",
    };
  }

  /**
   * Save webhooks to disk
   */
  private saveStore(): void {
    try {
      const data = JSON.stringify(this.store, null, 2);
      writeFileSecure(this.storePath, data, PERMISSION_MODES.OWNER_READ_WRITE);
    } catch (error) {
      log.error(`Failed to save webhooks: ${error}`);
    }
  }

  /**
   * Initialize webhooks from environment variables
   */
  private initializeFromEnv(): void {
    // Check for NLMCP_WEBHOOK_URL
    const webhookUrl = process.env.NLMCP_WEBHOOK_URL;
    if (webhookUrl && !this.store.webhooks.some((w) => w.url === webhookUrl)) {
      const events = process.env.NLMCP_WEBHOOK_EVENTS
        ? (process.env.NLMCP_WEBHOOK_EVENTS.split(",") as EventType[])
        : (["*"] as ["*"]);

      this.addWebhook({
        name: "Default Webhook",
        url: webhookUrl,
        events,
        secret: process.env.NLMCP_WEBHOOK_SECRET,
      });
      log.info(`  Added webhook from env: ${webhookUrl}`);
    }

    // Check for Slack webhook
    const slackUrl = process.env.NLMCP_SLACK_WEBHOOK_URL;
    if (slackUrl && !this.store.webhooks.some((w) => w.url === slackUrl)) {
      this.addWebhook({
        name: "Slack Notifications",
        url: slackUrl,
        events: ["*"],
        format: "slack",
      });
      log.info(`  Added Slack webhook from env`);
    }

    // Check for Discord webhook
    const discordUrl = process.env.NLMCP_DISCORD_WEBHOOK_URL;
    if (discordUrl && !this.store.webhooks.some((w) => w.url === discordUrl)) {
      this.addWebhook({
        name: "Discord Notifications",
        url: discordUrl,
        events: ["*"],
        format: "discord",
      });
      log.info(`  Added Discord webhook from env`);
    }
  }

  /**
   * Subscribe to all events
   */
  private subscribeToEvents(): void {
    this.unsubscribe = eventEmitter.on("*", async (event) => {
      await this.dispatch(event);
    });
  }

  /**
   * Dispatch an event to all matching webhooks
   */
  async dispatch(event: SystemEvent): Promise<void> {
    const enabledWebhooks = this.store.webhooks.filter((w) => w.enabled);

    for (const webhook of enabledWebhooks) {
      if (this.shouldSend(webhook, event.type)) {
        await this.sendWithRetry(webhook, event);
      }
    }
  }

  /**
   * Check if webhook should receive this event type
   */
  private shouldSend(webhook: WebhookConfig, eventType: EventType): boolean {
    if (webhook.events.includes("*")) return true;
    return webhook.events.includes(eventType);
  }

  /**
   * Send event with retry logic
   */
  private async sendWithRetry(
    webhook: WebhookConfig,
    event: SystemEvent
  ): Promise<boolean> {
    const maxAttempts = webhook.retryCount ?? 3;
    const baseDelay = webhook.retryDelayMs ?? 1000;
    const timeout = webhook.timeoutMs ?? 5000;

    const deliveryId = crypto.randomUUID();
    const startTime = Date.now();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const payload = this.formatPayload(event, webhook.format);
        const signature = webhook.secret
          ? this.sign(payload, webhook.secret)
          : undefined;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "notebooklm-mcp/1.7.0",
            ...(signature && { "X-Webhook-Signature": signature }),
            ...(webhook.headers || {}),
          },
          body: payload,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const delivery: WebhookDelivery = {
          id: deliveryId,
          webhookId: webhook.id,
          eventType: event.type,
          timestamp: new Date().toISOString(),
          success: response.ok,
          statusCode: response.status,
          attempts: attempt,
          durationMs: Date.now() - startTime,
        };

        this.recordDelivery(delivery);

        if (response.ok) {
          log.dim(`  ✅ Webhook delivered: ${webhook.name} (${event.type})`);
          return true;
        }

        log.warning(
          `  ⚠️ Webhook failed (attempt ${attempt}/${maxAttempts}): ${webhook.name} - ${response.status}`
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (attempt === maxAttempts) {
          const delivery: WebhookDelivery = {
            id: deliveryId,
            webhookId: webhook.id,
            eventType: event.type,
            timestamp: new Date().toISOString(),
            success: false,
            error: errorMessage,
            attempts: attempt,
            durationMs: Date.now() - startTime,
          };
          this.recordDelivery(delivery);
          log.error(`  ❌ Webhook failed permanently: ${webhook.name} - ${errorMessage}`);
          return false;
        }

        log.warning(
          `  ⚠️ Webhook error (attempt ${attempt}/${maxAttempts}): ${webhook.name} - ${errorMessage}`
        );
      }

      // Exponential backoff
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return false;
  }

  /**
   * Format event payload for different platforms
   */
  private formatPayload(
    event: SystemEvent,
    format: WebhookConfig["format"]
  ): string {
    switch (format) {
      case "slack":
        return JSON.stringify(this.formatSlack(event));
      case "discord":
        return JSON.stringify(this.formatDiscord(event));
      case "teams":
        return JSON.stringify(this.formatTeams(event));
      default:
        return JSON.stringify(event);
    }
  }

  /**
   * Format for Slack
   */
  private formatSlack(event: SystemEvent): object {
    const emoji = this.getEmoji(event.type);
    return {
      text: `${emoji} NotebookLM: ${this.getTitle(event)}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${emoji} ${this.getTitle(event)}*\n${this.getDescription(event)}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Event: \`${event.type}\` | Time: ${event.timestamp}`,
            },
          ],
        },
      ],
    };
  }

  /**
   * Format for Discord
   */
  private formatDiscord(event: SystemEvent): object {
    const color = this.getColor(event.type);
    return {
      embeds: [
        {
          title: `${this.getEmoji(event.type)} ${this.getTitle(event)}`,
          description: this.getDescription(event),
          color,
          timestamp: event.timestamp,
          footer: {
            text: `NotebookLM MCP | ${event.type}`,
          },
        },
      ],
    };
  }

  /**
   * Format for Microsoft Teams
   */
  private formatTeams(event: SystemEvent): object {
    return {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor: this.getColor(event.type).toString(16),
      summary: this.getTitle(event),
      sections: [
        {
          activityTitle: `${this.getEmoji(event.type)} ${this.getTitle(event)}`,
          activitySubtitle: event.timestamp,
          text: this.getDescription(event),
          facts: Object.entries(event.payload || {}).map(([key, value]) => ({
            name: key,
            value: String(value),
          })),
        },
      ],
    };
  }

  /**
   * Get emoji for event type
   */
  private getEmoji(type: EventType): string {
    const emojis: Record<EventType, string> = {
      question_answered: "💬",
      notebook_created: "📓",
      notebook_deleted: "🗑️",
      source_added: "➕",
      source_removed: "➖",
      session_created: "🌐",
      session_expired: "⏰",
      auth_required: "🔐",
      rate_limit_hit: "🚫",
      security_incident: "🛡️",
      quota_warning: "⚠️",
      audio_generated: "🎙️",
      batch_complete: "📦",
    };
    return emojis[type] || "📢";
  }

  /**
   * Get color for event type (Discord embed color)
   */
  private getColor(type: EventType): number {
    const colors: Record<EventType, number> = {
      question_answered: 0x00ff00, // Green
      notebook_created: 0x3498db, // Blue
      notebook_deleted: 0xff6b6b, // Red
      source_added: 0x00d4aa, // Teal
      source_removed: 0xffa500, // Orange
      session_created: 0x9b59b6, // Purple
      session_expired: 0x95a5a6, // Gray
      auth_required: 0xf39c12, // Yellow
      rate_limit_hit: 0xe74c3c, // Red
      security_incident: 0xe74c3c, // Red
      quota_warning: 0xf39c12, // Yellow
      audio_generated: 0x1abc9c, // Green
      batch_complete: 0x3498db, // Blue
    };
    return colors[type] || 0x7289da;
  }

  /**
   * Get title for event
   */
  private getTitle(event: SystemEvent): string {
    const titles: Record<EventType, string> = {
      question_answered: "Question Answered",
      notebook_created: "Notebook Created",
      notebook_deleted: "Notebook Deleted",
      source_added: "Source Added",
      source_removed: "Source Removed",
      session_created: "Session Started",
      session_expired: "Session Expired",
      auth_required: "Authentication Required",
      rate_limit_hit: "Rate Limit Reached",
      security_incident: "Security Alert",
      quota_warning: "Quota Warning",
      audio_generated: "Audio Overview Ready",
      batch_complete: "Batch Operation Complete",
    };
    return titles[event.type] || event.type;
  }

  /**
   * Get description for event
   */
  private getDescription(event: SystemEvent): string {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
      case "question_answered":
        return `Query answered in ${payload.duration_ms}ms (${payload.answer_length} chars)`;
      case "notebook_created":
        return `Created "${payload.name}" with ${payload.source_count} sources`;
      case "notebook_deleted":
        return `Deleted notebook "${payload.name}"`;
      case "source_added":
        return `Added ${payload.source_type} source to notebook`;
      case "rate_limit_hit":
        return `${payload.limit_type} limit reached: ${payload.current_count}/${payload.limit}`;
      case "security_incident":
        return `[${payload.severity}] ${payload.description}`;
      case "quota_warning":
        return `${payload.resource}: ${payload.percent}% used (${payload.used}/${payload.limit})`;
      case "batch_complete":
        return `${payload.operation}: ${payload.succeeded}/${payload.total} succeeded`;
      default:
        return JSON.stringify(payload);
    }
  }

  /**
   * Sign payload with HMAC-SHA256
   */
  private sign(payload: string, secret: string): string {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(payload);
    return `sha256=${hmac.digest("hex")}`;
  }

  /**
   * Record delivery for history
   */
  private recordDelivery(delivery: WebhookDelivery): void {
    this.deliveryHistory.push(delivery);
    if (this.deliveryHistory.length > this.maxDeliveryHistory) {
      this.deliveryHistory.shift();
    }
  }

  // === Public API ===

  /**
   * Add a new webhook
   */
  addWebhook(input: AddWebhookInput): WebhookConfig {
    const webhook: WebhookConfig = {
      id: crypto.randomUUID(),
      name: input.name,
      url: input.url,
      enabled: true,
      events: input.events || ["*"],
      format: input.format || "generic",
      secret: input.secret,
      headers: input.headers,
      retryCount: 3,
      retryDelayMs: 1000,
      timeoutMs: 5000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.store.webhooks.push(webhook);
    this.saveStore();

    log.success(`✅ Webhook added: ${webhook.name}`);
    return webhook;
  }

  /**
   * Update a webhook
   */
  updateWebhook(input: UpdateWebhookInput): WebhookConfig | null {
    const index = this.store.webhooks.findIndex((w) => w.id === input.id);
    if (index === -1) return null;

    const webhook = this.store.webhooks[index];
    const updated: WebhookConfig = {
      ...webhook,
      ...(input.name && { name: input.name }),
      ...(input.url && { url: input.url }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.events && { events: input.events }),
      ...(input.format && { format: input.format }),
      ...(input.secret !== undefined && { secret: input.secret }),
      ...(input.headers && { headers: input.headers }),
      updatedAt: new Date().toISOString(),
    };

    this.store.webhooks[index] = updated;
    this.saveStore();

    log.success(`✅ Webhook updated: ${updated.name}`);
    return updated;
  }

  /**
   * Remove a webhook
   */
  removeWebhook(id: string): boolean {
    const index = this.store.webhooks.findIndex((w) => w.id === id);
    if (index === -1) return false;

    const webhook = this.store.webhooks[index];
    this.store.webhooks.splice(index, 1);
    this.saveStore();

    log.success(`✅ Webhook removed: ${webhook.name}`);
    return true;
  }

  /**
   * List all webhooks
   */
  listWebhooks(): WebhookConfig[] {
    return this.store.webhooks;
  }

  /**
   * Get a specific webhook
   */
  getWebhook(id: string): WebhookConfig | null {
    return this.store.webhooks.find((w) => w.id === id) || null;
  }

  /**
   * Test a webhook
   */
  async testWebhook(id: string): Promise<{ success: boolean; error?: string }> {
    const webhook = this.getWebhook(id);
    if (!webhook) {
      return { success: false, error: "Webhook not found" };
    }

    const testEvent: SystemEvent = {
      type: "question_answered",
      timestamp: new Date().toISOString(),
      source: "notebooklm-mcp",
      version: "1.7.0",
      payload: {
        question_length: 50,
        answer_length: 200,
        session_id: "test-session",
        duration_ms: 1234,
      },
    };

    const success = await this.sendWithRetry(webhook, testEvent);
    return { success };
  }

  /**
   * Get webhook statistics
   */
  getStats(): WebhookStats {
    const deliveries = this.deliveryHistory;
    const successes = deliveries.filter((d) => d.success);
    const failures = deliveries.filter((d) => !d.success);

    return {
      totalDeliveries: deliveries.length,
      successCount: successes.length,
      failureCount: failures.length,
      lastDelivery: deliveries[deliveries.length - 1]?.timestamp,
      lastSuccess: successes[successes.length - 1]?.timestamp,
      lastFailure: failures[failures.length - 1]?.timestamp,
    };
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

// Singleton instance
let dispatcher: WebhookDispatcher | null = null;

export function getWebhookDispatcher(): WebhookDispatcher {
  if (!dispatcher) {
    dispatcher = new WebhookDispatcher();
  }
  return dispatcher;
}
