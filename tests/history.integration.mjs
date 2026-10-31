import { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import { snapshot, record, reverse } from "../lib/history/engine.mjs";

// 历史引擎集成测试：全部在同一个事务里执行，最后回滚，不污染真实数据
const db = new PrismaClient();
const rollback = new Error("test rollback");
const ACTOR = "__history_test_a";
const OTHER = "__history_test_b";

async function latestOperation(tx) {
  return tx.workOperation.findFirstOrThrow({
    where: { actor: ACTOR },
    orderBy: { createdAt: "desc" },
  });
}

try {
  await db.$transaction(
    async (tx) => {
      // 1. 创建、撤销、重做，以及非本人撤销
      const beforeCreate = await snapshot(tx);
      const board = await tx.board.create({ data: { title: "history integration test" } });
      await record(tx, ACTOR, "创建看板", beforeCreate);
      const createOp = await latestOperation(tx);

      await assert.rejects(reverse(tx, OTHER, createOp.id, false), /不能撤销或重做/);
      await reverse(tx, ACTOR, createOp.id, false);
      assert.equal(await tx.board.findUnique({ where: { id: board.id } }), null);
      await reverse(tx, ACTOR, createOp.id, true);
      assert.equal((await tx.board.findUniqueOrThrow({ where: { id: board.id } })).title, board.title);

      // 2. 字段级撤销：修改标题后又改了描述，撤销标题不能覆盖描述
      const beforeTitle = await snapshot(tx);
      await tx.board.update({ where: { id: board.id }, data: { title: "改名后" } });
      await record(tx, ACTOR, "修改看板", beforeTitle);
      const titleOp = await latestOperation(tx);

      await tx.board.update({ where: { id: board.id }, data: { description: "后续描述" } });
      await reverse(tx, ACTOR, titleOp.id, false);
      const afterUndo = await tx.board.findUniqueOrThrow({ where: { id: board.id } });
      assert.equal(afterUndo.title, board.title);
      assert.equal(afterUndo.description, "后续描述");

      // 目标字段被再次修改时，重做应被拒绝
      await tx.board.update({ where: { id: board.id }, data: { title: "被别人改了" } });
      await assert.rejects(reverse(tx, ACTOR, titleOp.id, true), /后续修改/);
      await tx.board.update({ where: { id: board.id }, data: { title: board.title } });

      // 3. 画板改名后有人继续绘制，撤销改名不能把场景写回旧版本
      const canvas = await tx.canvas.create({
        data: { title: "画板 A", sceneJson: '{"elements":[]}' },
      });
      const beforeCanvas = await snapshot(tx);
      await tx.canvas.update({
        where: { id: canvas.id },
        data: { title: "画板 B", lastEditor: ACTOR },
      });
      await record(tx, ACTOR, "修改画板", beforeCanvas);
      const canvasOp = await latestOperation(tx);

      await tx.canvas.update({
        where: { id: canvas.id },
        data: { sceneJson: '{"elements":[{"id":"drawn"}]}', lastEditor: OTHER },
      });
      await reverse(tx, ACTOR, canvasOp.id, false);
      const canvasAfter = await tx.canvas.findUniqueOrThrow({ where: { id: canvas.id } });
      assert.equal(canvasAfter.title, "画板 A");
      assert.match(canvasAfter.sceneJson, /drawn/);

      // 4. 级联删除后撤销：看板、列表、卡片、标签都要按外键顺序恢复
      const list = await tx.boardList.create({ data: { boardId: board.id, title: "待办" } });
      const card = await tx.boardCard.create({ data: { listId: list.id, title: "卡片" } });
      const label = await tx.boardLabel.create({
        data: { boardId: board.id, name: "标签", color: "#123456" },
      });

      const beforeDelete = await snapshot(tx);
      await tx.board.delete({ where: { id: board.id } });
      await record(tx, ACTOR, "删除看板", beforeDelete);
      const deleteOp = await latestOperation(tx);

      await reverse(tx, ACTOR, deleteOp.id, false);
      assert.ok(await tx.board.findUnique({ where: { id: board.id } }));
      assert.ok(await tx.boardList.findUnique({ where: { id: list.id } }));
      assert.ok(await tx.boardCard.findUnique({ where: { id: card.id } }));
      assert.ok(await tx.boardLabel.findUnique({ where: { id: label.id } }));

      console.log(
        "PASS: create undo/redo, actor isolation, field-level update, canvas metadata undo, cascade delete restore"
      );
      throw rollback;
    },
    { timeout: 30000 }
  );
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await db.$disconnect();
}
