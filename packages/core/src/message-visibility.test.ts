import type { ThreadMessage } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { latestUserVisibleMessage, userVisibleMessages } from "./message-visibility.js";

function message(id: string, runId: string, blocks: ThreadMessage["blocks"]): ThreadMessage {
  return {
    id,
    threadId: "thread-1",
    seq: 1,
    role: "bot",
    blocks,
    runId,
    createdAt: "2026-08-30T22:00:00.000Z",
  };
}

const peerExchange = [
  message("user", "run-user", [{ kind: "text", text: "Please ask Coder." }]),
  message("sent", "run-user", [
    { kind: "bot_message_sent", toBotId: "coder", toBotName: "Coder", text: "Check this." },
  ]),
  message("received", "run-peer", [
    {
      kind: "bot_message_received",
      fromBotId: "coder",
      fromBotName: "Coder",
      text: "Done.",
    },
  ]),
  message("activity", "run-peer", [{ kind: "steps", steps: [{ label: "Message bot", count: 1 }] }]),
  message("reply", "run-peer", [{ kind: "text", text: "Sent Coder the endpoints." }]),
  message("answer", "run-user", [{ kind: "text", text: "Coder is checking it." }]),
];

describe("user-visible messages", () => {
  it("keeps bot-to-bot exchanges out of the user transcript", () => {
    expect(userVisibleMessages(peerExchange).map((item) => item.id)).toEqual(["user", "answer"]);
  });

  it("keeps compact peer receipts when includePeerReceipts is set", () => {
    expect(
      userVisibleMessages(peerExchange, { includePeerReceipts: true }).map((item) => item.id),
    ).toEqual(["user", "sent", "received", "answer"]);
  });

  it("keeps a user-run answer that never received a peer message", () => {
    const messages = [
      message("user", "run-user", [{ kind: "text", text: "Summarize the doc." }]),
      message("answer", "run-user", [{ kind: "text", text: "Here is the summary." }]),
    ];
    expect(userVisibleMessages(messages).map((item) => item.id)).toEqual(["user", "answer"]);
  });

  it("picks the newest visible message from a newest-first preview window", () => {
    const newestFirst = [
      message("reply", "run-peer", [{ kind: "text", text: "Echoed peer reply" }]),
      message("received", "run-peer", [
        {
          kind: "bot_message_received",
          fromBotId: "coder",
          fromBotName: "Coder",
          text: "Done.",
        },
      ]),
      message("answer", "run-user", [{ kind: "text", text: "Visible answer" }]),
    ];
    expect(latestUserVisibleMessage(newestFirst)?.id).toBe("answer");
  });

  it("hides peer-run tails when knownPeerRunIds supplies the run without a receipt", () => {
    const newestFirst = [
      message("reply", "run-peer", [{ kind: "text", text: "Echoed peer reply" }]),
      message("activity", "run-peer", [
        { kind: "steps", steps: [{ label: "Message bot", count: 1 }] },
      ]),
      message("answer", "run-user", [{ kind: "text", text: "Visible answer" }]),
    ];
    expect(latestUserVisibleMessage(newestFirst, { knownPeerRunIds: ["run-peer"] })?.id).toBe(
      "answer",
    );
    expect(latestUserVisibleMessage(newestFirst)?.id).toBe("reply");
  });
});
