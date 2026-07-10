/* Shared runtime-loop constants for the providers. */

/** What the model hears back for every tool call. Nothing executes; this
 *  acknowledgement lets the model finish its turn while real execution waits
 *  for human approval. */
export const PENDING_ACK =
  "Accepted: this action has been queued for human validation and will only be executed after " +
  "a human approves it. Continue with any remaining actions. Then write your final response " +
  "exactly as it should be delivered to the recipient - plain text, no markdown, no meta " +
  "commentary - assuming the queued actions will be applied.";

/** Cap on provider round-trips per run; cost guard on shared keys. */
export const MAX_AGENT_TURNS = 5;
