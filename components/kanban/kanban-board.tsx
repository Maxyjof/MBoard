"use client";

// 看板主体：持有列表状态，负责拖拽跨列移动与乐观更新回滚
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { LayoutGrid, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { LabelManager, type BoardLabel } from "@/components/kanban/label-manager";
import { BoardHeader } from "@/components/kanban/board-header";
import { BoardSettingsDialog } from "@/components/kanban/board-settings-dialog";
import { CardDetailDrawer } from "@/components/kanban/card-detail-drawer";
import { KanbanColumn } from "@/components/kanban/kanban-column";
import { createList, errorMessage, reorderBoard } from "@/components/kanban/kanban-api";
import {
  appendCard,
  appendList,
  locateCard,
  moveCard,
  removeCard,
  removeList,
  replaceCard,
  replaceList,
} from "@/components/kanban/board-state";
import { buildReorderPayload, labelStyle, type ReorderPayload } from "@/lib/kanban";
import { cn } from "@/lib/utils";
import type { BoardDetail, CardDTO, ListDTO, MemberDTO } from "@/lib/types";

type KanbanBoardProps = {
  initialBoard: BoardDetail;
  initialLists: ListDTO[];
  members: MemberDTO[];
  initialCardId?: string | null;
};

type DragTarget = { type: "list" | "card"; id: string };

export function KanbanBoard({
  initialBoard,
  initialLists,
  members,
  initialCardId = null,
}: KanbanBoardProps) {
  const [board, setBoard] = useState(initialBoard);
  const [lists, setLists] = useState(initialLists);
  const [activeDrag, setActiveDrag] = useState<DragTarget | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(initialCardId);
  const [savingOrder, setSavingOrder] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [boardLabels, setBoardLabels] = useState<BoardLabel[]>([]);

  // 标签表按看板独立维护，进入看板时加载一次
  const loadBoardLabels = useCallback(async () => {
    try {
      const response = await fetch(`/api/boards/${initialBoard.id}/labels`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载标签失败");
      setBoardLabels(data.labels);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, [initialBoard.id]);

  useEffect(() => {
    void loadBoardLabels();
  }, [loadBoardLabels]);

  // 撤销/重做后重新拉取看板数据，比整页刷新更平滑
  const reloadBoard = useCallback(async () => {
    try {
      const response = await fetch(`/api/boards/${initialBoard.id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "刷新看板失败");
      setBoard(data.board);
      setLists(data.lists);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, [initialBoard.id]);

  useEffect(() => {
    const handler = () => void reloadBoard();
    window.addEventListener("mboard:history-changed", handler);
    return () => window.removeEventListener("mboard:history-changed", handler);
  }, [reloadBoard]);

  async function labelRequest(method: string, body: object) {
    const response = await fetch(`/api/boards/${initialBoard.id}/labels`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "标签操作失败");
    return data;
  }

  async function createBoardLabel(name: string, color: string): Promise<BoardLabel> {
    const { label } = await labelRequest("POST", { name, color });
    setBoardLabels((previous) => [...previous, label]);
    return label;
  }

  // 标签改名/删除后同步更新看板里所有卡片的标签快照
  function syncCardLabels(update: (labels: CardDTO["labels"]) => CardDTO["labels"]) {
    setLists((previous) =>
      previous.map((list) => ({
        ...list,
        cards: list.cards.map((card) => ({ ...card, labels: update(card.labels) })),
      }))
    );
  }

  async function editBoardLabel(previousLabel: BoardLabel, name: string, color: string) {
    await labelRequest("PATCH", { id: previousLabel.id, name, color });
    setBoardLabels((previous) =>
      previous.map((label) => (label.id === previousLabel.id ? { ...label, name, color } : label))
    );
    syncCardLabels((labels) =>
      labels.map((label) => (label.name === previousLabel.name ? { name, color } : label))
    );
  }

  async function deleteBoardLabel(previousLabel: BoardLabel) {
    await labelRequest("DELETE", { id: previousLabel.id });
    setBoardLabels((previous) => previous.filter((label) => label.id !== previousLabel.id));
    syncCardLabels((labels) => labels.filter((label) => label.name !== previousLabel.name));
  }

  // 拖拽排序后按后端返回的顺序重排本地标签表
  async function reorderBoardLabels(ids: string[]) {
    const response = await fetch(`/api/boards/${initialBoard.id}/labels/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "标签排序失败");
    setBoardLabels((previous) => {
      const byId = new Map(previous.map((label) => [label.id, label]));
      return ids
        .map((id) => byId.get(id))
        .filter((label): label is BoardLabel => label !== undefined);
    });
  }


  const [addListOpen, setAddListOpen] = useState(false);
  const [listTitle, setListTitle] = useState("");
  const [creatingList, setCreatingList] = useState(false);

  const snapshotRef = useRef<ListDTO[]>(initialLists);
  const justDraggedRef = useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: {
        start: [KeyboardCode.Space],
        cancel: [KeyboardCode.Esc],
        end: [KeyboardCode.Space, KeyboardCode.Enter],
      },
    })
  );

  const closeDrawer = useCallback(() => setOpenCardId(null), []);

  // 根据 over 数据推导目标列表 id
  function resolveListId(over: { id: string | number; data: { current?: Record<string, unknown> } }): string | null {
    const data = over.data.current;
    if (data && typeof data.listId === "string") return data.listId;
    const candidate = String(over.id);
    return lists.some((list) => list.id === candidate) ? candidate : null;
  }

  function handleDragStart(event: DragStartEvent) {
    const type = event.active.data.current?.type;
    snapshotRef.current = lists;
    justDraggedRef.current = true;
    setActiveDrag({
      type: type === "list" ? "list" : "card",
      id: String(event.active.id),
    });
  }

  // 卡片跨列表时即时换列，落点仍在 onDragEnd 最终确认
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || active.data.current?.type !== "card") return;

    const cardId = String(active.id);

    setLists((previous) => {
      const located = locateCard(previous, cardId);
      if (!located) return previous;

      const overData = over.data.current;
      let targetListId: string | null = null;
      let targetIndex = 0;

      if (overData?.type === "card") {
        targetListId = typeof overData.listId === "string" ? overData.listId : null;
        const target = previous.find((list) => list.id === targetListId);
        if (target) {
          const index = target.cards.findIndex((card) => card.id === over.id);
          targetIndex = index >= 0 ? index : target.cards.length;
        }
      } else if (overData?.type === "zone" || overData?.type === "list") {
        targetListId = typeof overData.listId === "string" ? overData.listId : null;
        const target = previous.find((list) => list.id === targetListId);
        targetIndex = target ? target.cards.length : 0;
      }

      if (!targetListId || targetListId === located.list.id) return previous;
      return moveCard(previous, cardId, targetListId, targetIndex);
    });
  }

  async function persistOrder(payload: ReorderPayload) {
    setSavingOrder(true);
    try {
      await reorderBoard(board.id, payload);
    } catch (error) {
      // 失败回滚到拖拽前的快照
      setLists(snapshotRef.current);
      toast.error(`排序保存失败：${errorMessage(error)}`);
    } finally {
      setSavingOrder(false);
    }
  }

  function finishDrag() {
    setActiveDrag(null);
    window.setTimeout(() => {
      justDraggedRef.current = false;
    }, 160);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const activeType = active.data.current?.type;
    const activeId = String(active.id);

    if (!over) {
      setLists(snapshotRef.current);
      finishDrag();
      return;
    }

    let next = lists;

    if (activeType === "list") {
      const targetListId = resolveListId(over);
      if (targetListId && targetListId !== activeId) {
        const from = lists.findIndex((list) => list.id === activeId);
        const to = lists.findIndex((list) => list.id === targetListId);
        if (from >= 0 && to >= 0 && from !== to) {
          next = [...lists];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
        }
      }
    } else {
      const overData = over.data.current;
      let targetListId: string | null = null;
      let targetIndex = 0;

      if (overData?.type === "card") {
        targetListId = typeof overData.listId === "string" ? overData.listId : null;
        const target = lists.find((list) => list.id === targetListId);
        if (target) {
          const index = target.cards.findIndex((card) => card.id === over.id);
          targetIndex = index >= 0 ? index : target.cards.length;
        }
      } else if (overData?.type === "zone" || overData?.type === "list") {
        targetListId = typeof overData.listId === "string" ? overData.listId : null;
        const target = lists.find((list) => list.id === targetListId);
        targetIndex = target ? target.cards.length : 0;
      } else {
        targetListId = resolveListId(over);
        const target = lists.find((list) => list.id === targetListId);
        targetIndex = target ? target.cards.length : 0;
      }

      if (targetListId) next = moveCard(lists, activeId, targetListId, targetIndex);
    }

    setLists(next);
    const payload = buildReorderPayload(snapshotRef.current, next);
    if (payload) void persistOrder(payload);
    finishDrag();
  }

  function handleDragCancel() {
    setLists(snapshotRef.current);
    finishDrag();
  }

  function handleOpenCard(card: CardDTO) {
    if (justDraggedRef.current) return;
    setOpenCardId(card.id);
  }

  function handleCardUpdated(card: CardDTO) {
    setLists((previous) => replaceCard(previous, card));
  }

  function handleCardRemoved(cardId: string) {
    setLists((previous) => removeCard(previous, cardId));
    setOpenCardId(null);
  }

  async function handleCreateList() {
    const title = listTitle.trim();
    if (!title || creatingList) return;

    setCreatingList(true);
    try {
      const list = await createList(board.id, title);
      setLists((previous) => appendList(previous, list));
      setListTitle("");
      setAddListOpen(false);
      toast.success("列表已创建");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCreatingList(false);
    }
  }

  const openCard = openCardId ? locateCard(lists, openCardId)?.card ?? null : null;
  const activeCard =
    activeDrag?.type === "card" ? locateCard(lists, activeDrag.id)?.card ?? null : null;
  const activeList =
    activeDrag?.type === "list" ? lists.find((list) => list.id === activeDrag.id) ?? null : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <BoardHeader
        board={board}
        onCreateList={() => setAddListOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenLabels={() => setLabelsOpen(true)}
      />

      <DndContext
        id="kanban-board"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="scroll-thin min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-3 py-3 sm:px-4">
          {lists.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={<LayoutGrid />}
                title="还没有列表"
                description="先创建一个列表，比如「待办」「进行中」「已完成」，再把卡片拖进去。"
                action={
                  <Button variant="primary" size="sm" onClick={() => setAddListOpen(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    新建列表
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="flex h-full items-stretch gap-3">
              <SortableContext
                items={lists.map((list) => list.id)}
                strategy={horizontalListSortingStrategy}
              >
                {lists.map((list) => (
                  <KanbanColumn
                    key={list.id}
                    list={list}
                    members={members}
                    disabled={savingOrder}
                    onOpenCard={handleOpenCard}
                    onCardCreated={(card) => {
                      setLists((previous) => appendCard(previous, list.id, card));
                      // 新建后直接打开详情，省掉再点一次
                      setOpenCardId(card.id);
                    }}
                    onListRenamed={(listId, title) =>
                      setLists((previous) => replaceList(previous, listId, title))
                    }
                    onListRemoved={(listId) => setLists((previous) => removeList(previous, listId))}
                  />
                ))}
              </SortableContext>

              <button
                type="button"
                onClick={() => setAddListOpen(true)}
                className="flex h-fit w-[220px] shrink-0 items-center gap-2 rounded-2xl border border-dashed border-line px-3 py-3 text-left text-[12.5px] text-muted transition hover:border-brand/40 hover:text-brand"
              >
                <Plus className="h-3.5 w-3.5" />
                添加另一个列表
              </button>
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <div className="w-[280px] rotate-1 rounded-xl border border-brand/40 bg-surface p-2.5 shadow-float">
              {activeCard.labels.length > 0 ? (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {activeCard.labels.slice(0, 3).map((label) => (
                    <span
                      key={label.name}
                      style={labelStyle(label.color)}
                      className="chip border px-1.5 py-0 text-[10.5px]"
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="break-words text-[13px] font-medium leading-5 text-ink">
                {activeCard.title}
              </p>
            </div>
          ) : activeList ? (
            <div
              className={cn(
                "w-[280px] rounded-2xl border border-brand/40 bg-surface p-3 text-[13px] font-semibold text-ink shadow-float"
              )}
            >
              {activeList.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <CardDetailDrawer
        key={openCard?.id ?? "closed"}
        card={openCard}
        members={members}
        availableLabels={boardLabels}
        onCreateLabel={createBoardLabel}
        onClose={closeDrawer}
        onUpdated={handleCardUpdated}
        onRemoved={handleCardRemoved}
      />

      <LabelManager
        open={labelsOpen}
        onOpenChange={setLabelsOpen}
        labels={boardLabels}
        onCreate={async (name, color) => {
          await createBoardLabel(name, color);
        }}
        onEdit={editBoardLabel}
        onDelete={deleteBoardLabel}
        onReorder={reorderBoardLabels}
      />

      <BoardSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        board={board}
        onUpdated={setBoard}
      />

      <Modal
        open={addListOpen}
        onOpenChange={setAddListOpen}
        title="新建列表"
        description="列表用于对卡片分组，可拖拽调整顺序"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddListOpen(false)} disabled={creatingList}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={creatingList}
              disabled={!listTitle.trim()}
              onClick={() => void handleCreateList()}
            >
              创建
            </Button>
          </>
        }
      >
        <Input
          value={listTitle}
          onChange={(event) => setListTitle(event.target.value)}
          placeholder="例如：待办"
          maxLength={40}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleCreateList();
            }
          }}
        />
      </Modal>
    </div>
  );
}
