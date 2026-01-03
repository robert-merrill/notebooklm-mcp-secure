/**
 * Chat History Tool Definition
 *
 * Allows users to extract conversation history from NotebookLM notebooks
 * using browser automation to scrape the chat UI.
 */

import type { Tool } from "../../types.js";

export const getNotebookChatHistoryTool: Tool = {
  name: "get_notebook_chat_history",
  description: `Extract conversation history from a NotebookLM notebook's chat interface.

This tool uses browser automation to navigate to a notebook and extract all Q&A pairs
from the chat UI. This is useful for:
- Recovering previous research conversations
- Auditing what queries were made in a notebook
- Understanding quota usage from direct NotebookLM browser usage
- Resuming context from previous sessions

Returns an array of messages with role (user/assistant), content, and position.

## When to Use
- When you need to see past conversations in a notebook
- When the local query log doesn't have entries (queries made directly in browser)
- To understand the context of a notebook's research session

## Example
\`\`\`json
{ "notebook_id": "my-research" }
\`\`\`

Or with direct URL:
\`\`\`json
{ "notebook_url": "https://notebooklm.google.com/notebook/xxx" }
\`\`\``,
  inputSchema: {
    type: "object",
    properties: {
      notebook_id: {
        type: "string",
        description: "Library notebook ID. Use list_notebooks to see available notebooks.",
      },
      notebook_url: {
        type: "string",
        description: "Direct notebook URL (overrides notebook_id). Use for notebooks not in your library.",
      },
      limit: {
        type: "number",
        description: "Maximum number of message pairs to return (default: 50, max: 200). Returns most recent first.",
      },
      show_browser: {
        type: "boolean",
        description: "Show browser window for debugging (default: false)",
      },
    },
  },
};

export const chatHistoryTools = [getNotebookChatHistoryTool];
