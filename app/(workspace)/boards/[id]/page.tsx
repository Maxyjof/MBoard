// 看板详情页：服务端读取完整数据后交给客户端看板渲染
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { toBoardDetail, toListDTO } from "@/lib/kanban";

type BoardPageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: BoardPageProps): Promise<Metadata> {
  const { id } = await params;
  const board = await prisma.board.findUnique({ where: { id }, select: { title: true } });
  return { title: board?.title ?? "看板" };
}

export default async function BoardDetailPage({ params }: BoardPageProps) {
  const { id } = await params;

  const board = await prisma.board.findUnique({
    where: { id },
    include: {
      lists: {
        orderBy: { sort: "asc" },
        include: {
          cards: {
            where: { archived: false },
            orderBy: { sort: "asc" },
            include: {
              attachments: {
                orderBy: { createdAt: "asc" },
                include: { asset: true },
              },
            },
          },
        },
      },
    },
  });

  if (!board) notFound();

  return <KanbanBoard initialBoard={toBoardDetail(board)} initialLists={board.lists.map(toListDTO)} />;
}
