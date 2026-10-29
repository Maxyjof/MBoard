"use client";

import { Check } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { MemberDTO } from "@/lib/types";

type AssigneePickerProps = {
  members: MemberDTO[];
  selected: string[];
  onChange: (assignees: string[]) => void;
  disabled?: boolean;
};

// 负责人选择：点击成员切换，可多选
export function AssigneePicker({ members, selected, onChange, disabled }: AssigneePickerProps) {
  const selectedSet = new Set(selected);

  if (members.length === 0) {
    return <p className="text-[12px] text-faint">暂无可用成员</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {members.map((member) => {
        const active = selectedSet.has(member.username);
        return (
          <button
            key={member.username}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (active) {
                onChange(selected.filter((username) => username !== member.username));
              } else {
                onChange([...selected, member.username]);
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? "border-brand/40 bg-brand/10 font-medium text-brand"
                : "border-line bg-surface text-muted hover:border-brand/30 hover:text-ink"
            )}
            aria-pressed={active}
          >
            <Avatar name={member.displayName} color={member.color} size={20} />
            <span className="max-w-[120px] truncate">{member.displayName}</span>
            {active ? <Check className="h-3 w-3 shrink-0" /> : null}
          </button>
        );
      })}
    </div>
  );
}
