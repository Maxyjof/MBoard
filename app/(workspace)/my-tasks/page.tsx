import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock, Inbox, LayoutGrid, ListTodo } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listMembers } from "@/lib/members";
import { labelStyle, parseAssignees, parseLabels } from "@/lib/kanban";
import { cn, formatDate, relativeTime } from "@/lib/utils";
import type { MemberDTO } from "@/lib/types";

export const metadata: Metadata = {
  title: "我的任务",
};

type TaskCard = {
  id: string;
  title: string;
  labels: string;
  assignees: string;
  dueDate: Date | null;
  updatedAt: Date;
  listTitle: string;
  boardId: string;
  boardTitle: string;
  boardAccent: string;
};

// 我的任务：汇总所有看板里分配给我的卡片
export default async function MyTasksPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [rawCards, members] = await Promise.all([
    prisma.boardCard.findMany({
      where: { archived: false },
      select: {
        id: true,
        title: true,
        labels: true,
        assignees: true,
        dueDate: true,
        updatedAt: true,
        list: {
          select: {
            title: true,
            board: { select: { id: true, title: true, accent: true } },
          },
        },
      },
    }),
    listMembers(),
  ]);

  const memberMap = new Map<string, MemberDTO>(members.map((member) => [member.username, member]));

  const cards: TaskCard[] = rawCards
    .filter((card) => parseAssignees(card.assignees).includes(session.username))
    .map((card) => ({
      id: card.id,
      title: card.title,
      labels: card.labels,
      assignees: card.assignees,
      dueDate: card.dueDate,
      updatedAt: card.updatedAt,
      listTitle: card.list.title,
      boardId: card.list.board.id,
      boardTitle: card.list.board.title,
      boardAccent: card.list.board.accent,
    }))
    .sort((left, right) => {
      // 有截止日期的排前面，其余按最近更新
      if (left.dueDate && right.dueDate) {
        return left.dueDate.getTime() - right.dueDate.getTime();
      }
      if (left.dueDate) return -1;
      if (right.dueDate) return 1;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });

  const overdueCount = cards.filter(
    (card) => card.dueDate && card.dueDate.getTime() < Date.now()
  ).length;

  const groups = new Map<
    string,
    { id: string; title: string; accent: string; cards: TaskCard[] }
  >();
  for (const card of cards) {
    const group = groups.get(card.boardId);
    if (group) {
      group.cards.push(card);
    } else {
      groups.set(card.boardId, {
        id: card.boardId,
        title: card.boardTitle,
        accent: card.boardAccent,
        cards: [card],
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-line bg-surface px-5">
        <div>
          <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
            <ListTodo className="h-4 w-4 text-brand" />
            我的任务
          </h1>
          <p className="mt-0.5 text-[11.5px] text-muted">
            所有看板里分配给你的卡片，点击可直接打开详情
          </p>
        </div>
        <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-muted">
          共 {cards.length} 个
        </span>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-5 py-6">
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              icon={<CheckCircle2 className="h-4 w-4 text-brand" />}
              label="分配给我"
              value={cards.length}
            />
            <StatCard
              icon={<Clock className={cn("h-4 w-4", overdueCount > 0 ? "text-danger" : "text-muted")} />}
              label="已逾期"
              value={overdueCount}
              danger={overdueCount > 0}
            />
            <StatCard
              icon={<LayoutGrid className="h-4 w-4 text-muted" />}
              label="涉及看板"
              value={groups.size}
            />
          </div>

          {cards.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<Inbox />}
                title="还没有分配给你的任务"
                description="在看板卡片详情里选择负责人后，任务会自动出现在这里。"
                action={
                  <Link
                    href="/boards"
                    className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white transition hover:bg-brand/90"
                  >
                    去看板看看
                  </Link>
                }
              />
            </div>
          ) : (
            Array.from(groups.values()).map((group) => (
              <section key={group.id} className="card overflow-hidden">
                <header className="flex items-center gap-2 border-b border-line px-4 py-3">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: group.accent }}
                  />
                  <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                    {group.title}
                  </h2>
                  <span className="text-[11px] text-faint">{group.cards.length} 个任务</span>
                  <Link
                    href={`/boards/${group.id}`}
                    className="rounded-md px-1.5 py-0.5 text-[11px] text-brand transition hover:bg-brand/10"
                  >
                    打开看板
                  </Link>
                </header>

                <ul className="divide-y divide-line">
                  {group.cards.map((card) => {
                    const labels = parseLabels(card.labels).slice(0, 3);
                    const assignees = parseAssignees(card.assignees)
                      .map((username) => memberMap.get(username))
                      .filter((member): member is MemberDTO => Boolean(member));
                    const overdue = Boolean(card.dueDate && card.dueDate.getTime() < Date.now());

                    return (
                      <li key={card.id}>
                        <Link
                          href={`/boards/${group.id}?card=${card.id}`}
                          className="group flex items-start gap-3 px-4 py-3 transition hover:bg-surface-2/70"
                        >
                          <span
                            className={cn(
                              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                              overdue ? "bg-danger" : "bg-brand/50"
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-ink group-hover:text-brand">
                              {card.title}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-faint">
                              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-muted">
                                {card.listTitle}
                              </span>
                              {labels.map((label) => (
                                <span
                                  key={label.name}
                                  style={labelStyle(label.color)}
                                  className="chip border px-1.5 py-0 text-[10.5px]"
                                >
                                  {label.name}
                                </span>
                              ))}
                              {card.dueDate ? (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1",
                                    overdue ? "text-danger" : "text-muted"
                                  )}
                                >
                                  <Clock className="h-3 w-3" />
                                  {formatDate(card.dueDate)}
                                  {overdue ? " · 已逾期" : ""}
                                </span>
                              ) : null}
                              <span className="text-faint">更新于 {relativeTime(card.updatedAt)}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center -space-x-1.5 pt-0.5">
                            {assignees.slice(0, 3).map((member) => (
                              <Avatar
                                key={member.username}
                                name={member.displayName}
                                color={member.color}
                                size={22}
                                ring
                              />
                            ))}
                            {assignees.length > 3 ? (
                              <span className="flex h-[22px] items-center rounded-full border border-line bg-surface px-1.5 text-[9.5px] text-muted">
                                +{assignees.length - 3}
                              </span>
                            ) : null}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="card flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2">
        {icon}
      </span>
      <div>
        <p
          className={cn(
            "text-[18px] font-semibold leading-6 tabular-nums",
            danger ? "text-danger" : "text-ink"
          )}
        >
          {value}
        </p>
        <p className="text-[11px] text-faint">{label}</p>
      </div>
    </div>
  );
}
