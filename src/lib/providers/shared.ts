/* Shared runtime-loop constants for all providers. */

/** What the model hears back for every tool call it makes. Nothing executes:
 *  this acknowledgement lets the model finish its turn (remaining tool calls
 *  + final reply) while the real execution waits for human approval. */
export const PENDING_ACK =
  "Accepted: this action has been queued for human validation and will only be executed after " +
  "a human approves it. Continue with any remaining actions. Then write your final response " +
  "exactly as it should be delivered to the recipient - plain text, no markdown, no meta " +
  "commentary - assuming the queued actions will be applied.";

/** Hard cap on provider round-trips per run — cost guard on shared keys. */
export const MAX_AGENT_TURNS = 5;
