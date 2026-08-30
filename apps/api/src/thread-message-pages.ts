import type { ThreadMessage, ThreadMessagePage } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";

type MessageDb = PrismaClient | Prisma.TransactionClient;

type MessageRow = {
  id: string;
  threadId: string;
  seq: number;
  role: string;
  blocks: Prisma.JsonValue;
  botId: string | null;
  replyToMessageId: string | null;
  runId: string | null;
  createdAt: Date;
};

export async function loadMessagePage(
  prisma: MessageDb,
  threadId: string,
  before: number | undefined,
  pageSize: number,
  around?: { messageId?: string; seq?: number },
): Promise<ThreadMessagePage> {
  if (around) {
    let targetSeq = around.seq;
    if (targetSeq === undefined && around.messageId) {
      const row = await prisma.message.findFirst({
        where: { id: around.messageId, threadId },
        select: { seq: true },
      });
      targetSeq = row?.seq;
    }
    if (targetSeq !== undefined) {
      const half = Math.floor(pageSize / 2);
      const minSeq = Math.max(0, targetSeq - half);
      const maxSeq = targetSeq + half;
      const rows = await prisma.message.findMany({
        where: { threadId, seq: { gte: minSeq, lte: maxSeq } },
        orderBy: { seq: "asc" },
        take: pageSize,
      });
      const first = rows[0];
      const hasOlder = first
        ? (await prisma.message.count({ where: { threadId, seq: { lt: first.seq } } })) > 0
        : false;
      return {
        threadId,
        messages: await toThreadMessages(prisma, rows),
        olderCursor: hasOlder ? (first?.seq ?? null) : null,
      };
    }
  }

  const rows = await prisma.message.findMany({
    where: {
      threadId,
      ...(before === undefined ? {} : { seq: { lt: before } }),
    },
    orderBy: { seq: "desc" },
    take: pageSize + 1,
  });
  const hasOlder = rows.length > pageSize;
  const messages = await toThreadMessages(prisma, rows.slice(0, pageSize).reverse());
  return {
    threadId,
    messages,
    olderCursor: hasOlder ? (messages[0]?.seq ?? null) : null,
  };
}

export async function loadAllMessages(
  prisma: PrismaClient,
  threadId: string,
  pageSize: number,
): Promise<ThreadMessage[]> {
  const pages: ThreadMessage[][] = [];
  let before: number | undefined;
  do {
    const page = await loadMessagePage(prisma, threadId, before, pageSize);
    pages.push(page.messages);
    before = page.olderCursor ?? undefined;
  } while (before !== undefined);
  return pages.reverse().flat();
}

async function toThreadMessages(prisma: MessageDb, rows: MessageRow[]): Promise<ThreadMessage[]> {
  const runIds = [
    ...new Set(rows.map((row) => row.runId).filter((runId): runId is string => Boolean(runId))),
  ];
  const triggers = new Map(
    runIds.length === 0
      ? []
      : (
          await prisma.run.findMany({
            where: { id: { in: runIds } },
            select: { id: true, trigger: true },
          })
        ).map((run) => [run.id, run.trigger] as const),
  );
  return rows.map((row) => toThreadMessage(row, row.runId ? triggers.get(row.runId) : undefined));
}

function toThreadMessage(row: MessageRow, runTrigger?: string): ThreadMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    seq: row.seq,
    role: row.role as ThreadMessage["role"],
    blocks: row.blocks as ThreadMessage["blocks"],
    botId: row.botId ?? undefined,
    replyToMessageId: row.replyToMessageId ?? undefined,
    runId: row.runId ?? undefined,
    runTrigger,
    createdAt: row.createdAt.toISOString(),
  };
}
