/**
 * Gemini API Tool Definitions
 *
 * Tools for accessing Gemini models and the Deep Research agent
 * via the Interactions API.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Deep Research tool - comprehensive research using Gemini's Deep Research agent
 */
const deepResearchTool: Tool = {
  name: "deep_research",
  description: `Perform deep research using Gemini's Deep Research agent.

This runs in the background and can take 1-5 minutes to complete.

## When to Use
- You need comprehensive research on a topic
- No specific NotebookLM notebook is relevant
- You want web-grounded answers with citations

## Requirements
- GEMINI_API_KEY environment variable must be set

## Notes
- Deep Research is a premium feature that may incur costs
- Results are grounded in web sources with citations
- For notebook-specific queries, use ask_question instead`,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The research question or topic to investigate",
      },
      wait_for_completion: {
        type: "boolean",
        default: true,
        description: "Wait for research to complete (polls every 10s). Set to false to run in background.",
      },
      max_wait_seconds: {
        type: "number",
        default: 300,
        description: "Maximum wait time in seconds (default 5 min, max 10 min)",
      },
    },
    required: ["query"],
  },
};

/**
 * Gemini Query tool - quick queries with optional grounding tools
 */
const geminiQueryTool: Tool = {
  name: "gemini_query",
  description: `Quick query to Gemini model with optional grounding tools.

Faster than deep_research for simpler questions. Supports:
- Google Search grounding for current information
- Code execution for calculations
- URL analysis for web content

## Requirements
- GEMINI_API_KEY environment variable must be set

## When to Use
- Quick factual questions
- Current events (with google_search tool)
- Code calculations (with code_execution tool)
- Web page analysis (with url_context tool)`,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The question or prompt",
      },
      model: {
        type: "string",
        enum: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview"],
        default: "gemini-2.5-flash",
        description: "Model to use (flash is faster, pro is more capable)",
      },
      tools: {
        type: "array",
        items: {
          type: "string",
          enum: ["google_search", "code_execution", "url_context"],
        },
        description: "Built-in tools to enable for grounding",
      },
      urls: {
        type: "array",
        items: { type: "string" },
        description: "URLs to analyze (automatically enables url_context)",
      },
      previous_interaction_id: {
        type: "string",
        description: "Continue a previous conversation (for multi-turn)",
      },
    },
    required: ["query"],
  },
};

/**
 * Get Research Status tool - check background task progress
 */
const getResearchStatusTool: Tool = {
  name: "get_research_status",
  description: `Check the status of a background deep research task.

Use this when you started deep_research with wait_for_completion=false.

## Returns
- status: pending | running | completed | failed
- answer: The research result (if completed)
- error: Error message (if failed)`,
  inputSchema: {
    type: "object",
    properties: {
      interaction_id: {
        type: "string",
        description: "The interaction ID returned from deep_research",
      },
    },
    required: ["interaction_id"],
  },
};

/**
 * All Gemini tools
 */
export const geminiTools: Tool[] = [
  deepResearchTool,
  geminiQueryTool,
  getResearchStatusTool,
];
