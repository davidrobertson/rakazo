import type { MessageBlock } from "@rakazo/contracts";

type PresentableMessage = {
  runId?: string;
  /** When set to `bot_message`, treat the run as peer even without a receipt in-window. */
  runTrigger?: string;
  blocks: readonly MessageBlock[];
};

export type UserVisibleMessagesOptions = {
  /**
   * Keep `bot_message_sent` / `bot_message_received` rows (mobile compact cards).
   * Web hides them because PeerMessagesOverlay covers that history.
   */
  includePeerReceipts?: boolean;
  /**
   * Extra peer-run ids (e.g. from `run.trigger === "bot_message"`) when the
   * receipt may fall outside the loaded message window.
   */
  knownPeerRunIds?: ReadonlySet<string> | readonly string[];
};

function isPeerReceipt(blocks: readonly MessageBlock[]): boolean {
  return blocks.some(
    (block) => block.kind === "bot_message_sent" || block.kind === "bot_message_received",
  );
}

function peerRunIdsOf(
  messages: readonly PresentableMessage[],
  knownPeerRunIds?: ReadonlySet<string> | readonly string[],
): Set<string> {
  const peerRunIds = new Set(
    messages.flatMap((message) => {
      if (!message.runId) return [];
      if (message.runTrigger === "bot_message") return [message.runId];
      if (message.blocks.some((block) => block.kind === "bot_message_received")) {
        return [message.runId];
      }
      return [];
    }),
  );
  if (!knownPeerRunIds) return peerRunIds;
  for (const runId of knownPeerRunIds) peerRunIds.add(runId);
  return peerRunIds;
}

/** Drop peer-run activity/replies; optionally keep sent/received receipt rows. */
export function userVisibleMessages<T extends PresentableMessage>(
  messages: readonly T[],
  options: UserVisibleMessagesOptions = {},
): T[] {
  const peerRunIds = peerRunIdsOf(messages, options.knownPeerRunIds);
  const includePeerReceipts = options.includePeerReceipts === true;

  return messages.filter((message) => {
    if (isPeerReceipt(message.blocks)) return includePeerReceipts;
    return !message.runId || !peerRunIds.has(message.runId);
  });
}

/**
 * Newest-first scan for the first user-visible message (sidebar preview).
 * Prefer passing knownPeerRunIds when the receipt may sit outside the window.
 */
export function latestUserVisibleMessage<T extends PresentableMessage>(
  messagesNewestFirst: readonly T[],
  options: UserVisibleMessagesOptions = {},
): T | undefined {
  return userVisibleMessages(messagesNewestFirst, options)[0];
}
