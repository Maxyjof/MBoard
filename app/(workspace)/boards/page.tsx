// 看板入口：有看板时跳到第一个，否则展示创建引导
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BoardsEmpty } from "@/components/kanban/boards-empty";

export const metadata = { title: "看板" };

export default async function BoardsPage() {
  const firstBoard = await prisma.board.findFirst({
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  if (firstBoard) redirect(`/boards/${firstBoard.id}`);

  return <BoardsEmpty />;
}
