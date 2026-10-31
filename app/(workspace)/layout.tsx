import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { parseAssignees } from "@/lib/kanban";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import type { BoardSummary } from "@/lib/types";

// 工作台布局：服务端读取会话与共享看板列表
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [boards, activeCards] = await Promise.all([
    prisma.board.findMany({
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        description: true,
        accent: true,
        updatedAt: true,
        _count: { select: { lists: true } },
        lists: {
          select: {
            _count: { select: { cards: { where: { archived: false } } } },
          },
        },
      },
    }),
    prisma.boardCard.findMany({
      where: { archived: false },
      select: { assignees: true },
    }),
  ]);

  const myTaskCount = activeCards.filter((card) =>
    parseAssignees(card.assignees).includes(session.username)
  ).length;

  const summaries: BoardSummary[] = boards.map((board) => ({
    id: board.id,
    title: board.title,
    description: board.description,
    accent: board.accent,
    listsCount: board._count.lists,
    cardsCount: board.lists.reduce((total, list) => total + list._count.cards, 0),
    updatedAt: board.updatedAt.toISOString(),
  }));

  return (
    <WorkspaceShell user={session} boards={summaries} myTaskCount={myTaskCount}>
      {children}
    </WorkspaceShell>
  );
}
