/**
 * Event Emitter for NotebookLM MCP
 *
 * Central event bus for system-wide events.
 * Events can trigger webhook notifications, logging, or other actions.
 */

import { log } from "../utils/logger.js";
import type { SystemEvent, EventType } from "./event-types.js";

export type EventHandler = (event: SystemEvent) => void | Promise<void>;

class EventEmitter {
  private handlers: Map<EventType | "*", EventHandler[]> = new Map();
  private eventHistory: SystemEvent[] = [];
  private maxHistorySize = 100;

  /**
   * Subscribe to an event type
   */
  on(eventType: EventType | "*", handler: EventHandler): () => void {
    const handlers = this.handlers.get(eventType) || [];
    handlers.push(handler);
    this.handlers.set(eventType, handlers);

    // Return unsubscribe function
    return () => {
      const currentHandlers = this.handlers.get(eventType) || [];
      const index = currentHandlers.indexOf(handler);
      if (index > -1) {
        currentHandlers.splice(index, 1);
        this.handlers.set(eventType, currentHandlers);
      }
    };
  }

  /**
   * Subscribe to an event type (one-time only)
   */
  once(eventType: EventType | "*", handler: EventHandler): () => void {
    const wrappedHandler: EventHandler = (event) => {
      unsubscribe();
      return handler(event);
    };

    const unsubscribe = this.on(eventType, wrappedHandler);
    return unsubscribe;
  }

  /**
   * Emit an event
   */
  async emit(event: SystemEvent): Promise<void> {
    log.dim(`📢 Event: ${event.type}`);

    // Add to history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Get specific handlers
    const specificHandlers = this.handlers.get(event.type) || [];
    // Get wildcard handlers
    const wildcardHandlers = this.handlers.get("*") || [];

    const allHandlers = [...specificHandlers, ...wildcardHandlers];

    // Execute all handlers
    for (const handler of allHandlers) {
      try {
        await handler(event);
      } catch (error) {
        log.error(`Event handler error for ${event.type}: ${error}`);
      }
    }
  }

  /**
   * Get recent events
   */
  getHistory(limit?: number): SystemEvent[] {
    const count = limit || this.maxHistorySize;
    return this.eventHistory.slice(-count);
  }

  /**
   * Get events by type
   */
  getEventsByType(eventType: EventType, limit?: number): SystemEvent[] {
    const filtered = this.eventHistory.filter((e) => e.type === eventType);
    return limit ? filtered.slice(-limit) : filtered;
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Get handler count for debugging
   */
  getHandlerCount(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [type, handlers] of this.handlers) {
      counts[type] = handlers.length;
    }
    return counts;
  }
}

// Singleton instance
const eventEmitter = new EventEmitter();

export { eventEmitter };
export default eventEmitter;
