/**
 * Gemini Interactions API Client
 *
 * Provides access to Gemini models and the Deep Research agent
 * via the Interactions API for stable, API-based research capabilities.
 */

import { GoogleGenAI } from "@google/genai";
import { log } from "../utils/logger.js";
import { CONFIG } from "../config.js";
import type { ProgressCallback } from "../types.js";
import type {
  GeminiQueryOptions,
  GeminiInteraction,
  DeepResearchOptions,
  GeminiOutput,
  InteractionStatus,
} from "./types.js";

// Re-export the agent constant
export { DEEP_RESEARCH_AGENT } from "./types.js";

/**
 * Client for Gemini Interactions API
 */
export class GeminiClient {
  private client: GoogleGenAI | null = null;

  constructor(apiKey?: string) {
    const key = apiKey || CONFIG.geminiApiKey;
    if (key) {
      this.client = new GoogleGenAI({ apiKey: key });
      log.info("Gemini client initialized");
    } else {
      log.info("Gemini client not initialized (no API key)");
    }
  }

  /**
   * Check if the client is available (API key configured)
   */
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Perform a quick query to Gemini
   */
  async query(options: GeminiQueryOptions): Promise<GeminiInteraction> {
    if (!this.client) {
      throw new Error("Gemini API key not configured. Set GEMINI_API_KEY environment variable.");
    }

    const model = options.model || CONFIG.geminiDefaultModel || "gemini-2.5-flash";
    log.info(`Gemini query to ${model}: ${options.query.substring(0, 50)}...`);

    try {
      // Build tools array - use 'as any' to bypass strict SDK typing
      const tools: unknown[] = [];
      if (options.tools) {
        for (const tool of options.tools) {
          tools.push({ type: tool });
        }
      }

      // Build input - just use string for simplicity
      let input: string = options.query;

      // If URLs are provided, append them to the query
      if (options.urls && options.urls.length > 0) {
        input = `${options.query}\n\nPlease analyze these URLs:\n${options.urls.join("\n")}`;
      }

      // Create interaction - use 'as any' to handle SDK type strictness
      const response = await (this.client.interactions as any).create({
        model,
        input,
        tools: tools.length > 0 ? tools : undefined,
        previousInteractionId: options.previousInteractionId,
        store: true,
        generationConfig: options.generationConfig ? {
          temperature: options.generationConfig.temperature,
          maxOutputTokens: options.generationConfig.maxOutputTokens,
          thinkingLevel: options.generationConfig.thinkingLevel,
        } : undefined,
      });

      return this.mapInteraction(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`Gemini query failed: ${msg}`);
      throw error;
    }
  }

  /**
   * Start deep research using the Deep Research agent
   */
  async deepResearch(options: DeepResearchOptions): Promise<GeminiInteraction> {
    if (!this.client) {
      throw new Error("Gemini API key not configured. Set GEMINI_API_KEY environment variable.");
    }

    if (!CONFIG.geminiDeepResearchEnabled) {
      throw new Error("Deep Research is disabled. Set GEMINI_DEEP_RESEARCH_ENABLED=true to enable.");
    }

    log.info(`Starting deep research: ${options.query.substring(0, 50)}...`);

    try {
      // Start research in background - use 'as any' to handle SDK type strictness
      const response = await (this.client.interactions as any).create({
        input: options.query,
        agent: "deep-research-pro-preview-12-2025",
        background: options.background !== false,
        store: true,
      });

      const interaction = this.mapInteraction(response);
      log.info(`Deep research started: ${interaction.id}`);

      // If waiting for completion, poll
      if (options.waitForCompletion !== false) {
        return this.pollForCompletion(
          interaction.id,
          options.maxWaitMs || 300000, // 5 minutes default
          options.progressCallback
        );
      }

      return interaction;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`Deep research failed: ${msg}`);
      throw error;
    }
  }

  /**
   * Get an existing interaction by ID
   */
  async getInteraction(interactionId: string): Promise<GeminiInteraction> {
    if (!this.client) {
      throw new Error("Gemini API key not configured.");
    }

    try {
      const response = await (this.client.interactions as any).get(interactionId);
      return this.mapInteraction(response);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`Failed to get interaction ${interactionId}: ${msg}`);
      throw error;
    }
  }

  /**
   * Poll for interaction completion
   */
  async pollForCompletion(
    interactionId: string,
    maxWaitMs: number,
    progressCallback?: ProgressCallback
  ): Promise<GeminiInteraction> {
    const startTime = Date.now();
    const pollInterval = 10000; // 10 seconds
    let lastStatus: InteractionStatus | null = null;

    log.info(`Polling for completion: ${interactionId} (max ${maxWaitMs / 1000}s)`);

    while (Date.now() - startTime < maxWaitMs) {
      const interaction = await this.getInteraction(interactionId);
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Report progress - ProgressCallback signature is (message, progress?, total?)
      if (progressCallback && interaction.status !== lastStatus) {
        const progress = Math.min(90, Math.round((elapsed / (maxWaitMs / 1000)) * 100));
        await progressCallback(
          `Research ${interaction.status}... (${elapsed}s elapsed)`,
          progress,
          100
        );
        lastStatus = interaction.status;
      }

      // Check if done
      if (interaction.status === "completed") {
        if (progressCallback) {
          await progressCallback("Research complete", 100, 100);
        }
        log.success(`Research completed in ${elapsed}s`);
        return interaction;
      }

      if (interaction.status === "failed") {
        if (progressCallback) {
          await progressCallback("Research failed", 100, 100);
        }
        log.error(`Research failed: ${interaction.error || "Unknown error"}`);
        return interaction;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    throw new Error(`Research timed out after ${elapsed} seconds`);
  }

  /**
   * Delete a stored interaction
   */
  async deleteInteraction(interactionId: string): Promise<void> {
    if (!this.client) {
      throw new Error("Gemini API key not configured.");
    }

    try {
      await (this.client.interactions as any).delete(interactionId);
      log.info(`Deleted interaction: ${interactionId}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`Failed to delete interaction: ${msg}`);
      throw error;
    }
  }

  /**
   * Map SDK response to our interface
   */
  private mapInteraction(response: unknown): GeminiInteraction {
    // The SDK returns an object with id, model, status, outputs, usage
    const r = response as {
      id?: string;
      model?: string;
      status?: string;
      outputs?: Array<{
        type?: string;
        text?: string;
        name?: string;
        arguments?: Record<string, unknown>;
        id?: string;
      }>;
      usage?: {
        totalTokens?: number;
        total_tokens?: number;
        promptTokens?: number;
        prompt_tokens?: number;
        completionTokens?: number;
        completion_tokens?: number;
      };
      error?: string;
    };

    const outputs: GeminiOutput[] = (r.outputs || []).map(o => ({
      type: (o.type as "text" | "function_call" | "image") || "text",
      text: o.text,
      name: o.name,
      arguments: o.arguments,
      id: o.id,
    }));

    return {
      id: r.id || "",
      model: r.model,
      status: (r.status as InteractionStatus) || "pending",
      outputs,
      usage: r.usage ? {
        totalTokens: r.usage.totalTokens || r.usage.total_tokens || 0,
        promptTokens: r.usage.promptTokens || r.usage.prompt_tokens,
        completionTokens: r.usage.completionTokens || r.usage.completion_tokens,
      } : undefined,
      error: r.error,
    };
  }
}
