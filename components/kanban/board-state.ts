// 看板本地状态工具：拖拽过程中的不可变更新，集中放这里便于复用与测试
import type { CardDTO, ListDTO } from "@/lib/types";

// 找到卡片所在列表与索引
export function locateCard(
  lists: ListDTO[],
  cardId: string
): { list: ListDTO; index: number; card: CardDTO } | null {
  for (const list of lists) {
    const index = list.cards.findIndex((card) => card.id === cardId);
    if (index >= 0) return { list, index, card: list.cards[index] };
  }
  return null;
}

// 跨列表移动卡片：从原位置移除后插入目标索引
export function moveCard(
  lists: ListDTO[],
  cardId: string,
  targetListId: string,
  targetIndex: number
): ListDTO[] {
  const located = locateCard(lists, cardId);
  if (!located) return lists;

  const sourceListId = located.list.id;
  const withoutCard = lists.map((list) =>
    list.id === sourceListId
      ? { ...list, cards: list.cards.filter((card) => card.id !== cardId) }
      : list
  );

  return withoutCard.map((list) => {
    if (list.id !== targetListId) return list;
    const cards = [...list.cards];
    const index = Math.max(0, Math.min(targetIndex, cards.length));
    cards.splice(index, 0, located.card);
    return { ...list, cards };
  });
}

// 更新任意列表中的卡片数据，卡片可能被归档移除
export function replaceCard(lists: ListDTO[], card: CardDTO): ListDTO[] {
  if (card.archived) return removeCard(lists, card.id);
  return lists.map((list) => ({
    ...list,
    cards: list.cards.map((item) => (item.id === card.id ? card : item)),
  }));
}

export function removeCard(lists: ListDTO[], cardId: string): ListDTO[] {
  return lists.map((list) => ({
    ...list,
    cards: list.cards.filter((card) => card.id !== cardId),
  }));
}

export function appendCard(lists: ListDTO[], listId: string, card: CardDTO): ListDTO[] {
  return lists.map((list) =>
    list.id === listId ? { ...list, cards: [...list.cards, card] } : list
  );
}

export function appendList(lists: ListDTO[], list: ListDTO): ListDTO[] {
  return [...lists, list];
}

export function removeList(lists: ListDTO[], listId: string): ListDTO[] {
  return lists.filter((list) => list.id !== listId);
}

export function replaceList(lists: ListDTO[], listId: string, title: string): ListDTO[] {
  return lists.map((list) => (list.id === listId ? { ...list, title } : list));
}
