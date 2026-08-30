import type { MessageBlock } from "@rakazo/contracts";

type PresentableMessage = {
  runId?: string;
  blocks: readonly MessageBlock[];
};

export type UserVisibleMessagesOptions = {
  /**
   * Keep `bot_message_sent` / `bot_message_received` rows (mobile compact cards).
   * Web hides them because PeerMessagesOverlay covers that history.
   */
  includePeerReceipts?: boolean;
};

function isPeerReceipt(blocks: readonly MessageBlock[]): boolean {
  return blocks.some(
    (block) => block.kind === "bot_message_sent" || block.kind === "bot_message_received",
  );
}

function peerRunIdsOf(messages: readonly PresentableMessage[]): Set<string> {
  return new Set(
    messages
      .filter((message) => message.blocks.some((block) => block.kind === "bot_message_received"))
      .flatMap((message) => (message.runId ? [message.runId] : [])),
  );
}

/** Drop peer-run activity/replies; optionally keep sent/received receipt rows. */
export function userVisibleMessages<T extends PresentableMessage>(
  messages: readonly T[],
  options: UserVisibleMessagesOptions = {},
): T[] {
  const peerRunIds = peerRunIdsOf(messages);
  const includePeerReceipts = options.includePeerReceipts === true;

  return messages.filter((message) => {
    if (isPeerReceipt(message.blocks)) return includePeerReceipts;
    return !message.runId || !peerRunIds.has(message.runId);
  });
}

/**
 * Newest-first scan for the first user-visible message (sidebar preview).
 * Callers should pass a short newest-desc window; peer classification is limited to that window.
 */
export function latestUserVisibleMessage<T extends PresentableMessage>(
  messagesNewestFirst: readonly T[],
  options: UserVisibleMessagesOptions = {},
): T | undefined {
  return userVisibleMessages(messagesNewestFirst, options)[0];
}
