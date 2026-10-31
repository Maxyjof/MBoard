import { prisma } from "@/lib/prisma";
import { BoardsLibrary } from "@/components/kanban/boards-library";

export const metadata = { title: "看板" };
export default async function BoardsPage() {
  const boards = await prisma.board.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true, title: true, description: true, accent: true } });
  return <BoardsLibrary boards={boards} />;
}
