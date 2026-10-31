"use client";

// 单张卡片：整体可拖拽，点击打开详情抽屉
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlignLeft, CalendarDays, Paperclip } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { labelStyle } from "@/lib/kanban";
import { cn, formatDate, isOverdue } from "@/lib/utils";
import type { CardDTO, MemberDTO } from "@/lib/types";

type CardItemProps = {
  card: CardDTO;
  listId: string;
  members: MemberDTO[];
  onOpen: () => void;
  disabled?: boolean;
};

export function CardItem({ card, listId, members, onOpen, disabled = false }: CardItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card", listId },
    disabled,
  });

  const overdue = isOverdue(card.dueDate);
  const hasDescription = card.descriptionMd.trim().length > 0;
  const assigneeMembers = card.assignees
    .map((username) => members.find((member) => member.username === username))
    .filter((member): member is MemberDTO => Boolean(member));

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={cn(
        "group cursor-grab select-none rounded-xl border border-line bg-surface p-2.5 text-left shadow-card transition",
        "hover:border-brand/30 hover:shadow-panel active:cursor-grabbing",
        isDragging && "opacity-40"
      )}
    >
      {card.labels.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {card.labels.slice(0, 3).map((label) => (
            <span
              key={label.name}
              style={labelStyle(label.color)}
              className="chip border px-1.5 py-0 text-[10.5px]"
            >
              {label.name}
            </span>
          ))}
          {card.labels.length > 3 ? (
            <span className="chip bg-surface-2 text-[10.5px] text-faint">
              +{card.labels.length - 3}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <p className="break-words text-[13px] font-medium leading-5 text-ink">{card.title}</p>
        {assigneeMembers.length > 0 ? (
          <div className="flex shrink-0 items-center pt-0.5 -space-x-1.5">
            {assigneeMembers.slice(0, 3).map((member) => (
              <Avatar
                key={member.username}
                name={member.displayName}
                color={member.color}
                size={20}
                ring
              />
            ))}
            {assigneeMembers.length > 3 ? (
              <span className="flex h-5 items-center rounded-full border border-line bg-surface-2 px-1.5 text-[9.5px] font-medium text-muted">
                +{assigneeMembers.length - 3}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {overdue || hasDescription || card.attachments.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-faint">
          {card.dueDate ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
                overdue ? "bg-danger/10 text-danger" : "bg-surface-2 text-muted"
              )}
            >
              <CalendarDays className="h-3 w-3" />
              {formatDate(card.dueDate)}
            </span>
          ) : null}
          {hasDescription ? (
            <span className="inline-flex items-center gap-0.5" title="包含描述">
              <AlignLeft className="h-3 w-3" />
            </span>
          ) : null}
          {card.attachments.length > 0 ? (
            <span className="inline-flex items-center gap-0.5" title="包含附件">
              <Paperclip className="h-3 w-3" />
              {card.attachments.length}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
