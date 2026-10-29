import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 生成符合 Excalidraw 数据结构要求的元素
function baseElement(overrides) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    customData: undefined,
    ...overrides,
  };
}

function textElement({ x, y, width, height, text, fontSize = 18, containerId = null, align = "left", color = "#1e1e1e" }) {
  return baseElement({
    type: "text",
    x,
    y,
    width,
    height,
    text,
    originalText: text,
    fontSize,
    fontFamily: 2,
    textAlign: align,
    verticalAlign: "middle",
    containerId,
    lineHeight: 1.25,
    autoResize: containerId === null,
    strokeColor: color,
    backgroundColor: "transparent",
    roughness: 1,
  });
}

function rectElement({ x, y, width, height, color = "#d0bfff", textId = null, text = "", fontSize = 16 }) {
  const rect = baseElement({
    type: "rectangle",
    x,
    y,
    width,
    height,
    backgroundColor: color,
    fillStyle: "solid",
    roundness: { type: 3 },
    boundElements: textId ? [{ type: "text", id: textId }] : null,
  });
  return rect;
}

function arrowElement({ x, y, points, strokeColor = "#495057" }) {
  return baseElement({
    type: "arrow",
    x,
    y,
    width: Math.abs(points[points.length - 1][0]),
    height: Math.abs(points[points.length - 1][1]),
    points,
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    strokeColor,
    roundness: { type: 2 },
  });
}

// 一张演示画布：三节点流程 + 便签说明
function buildDemoScene() {
  const elements = [];

  const nodes = [
    { x: 0, y: 0, w: 200, h: 88, title: "收集需求", color: "#d0bfff" },
    { x: 320, y: 0, w: 200, h: 88, title: "拆解任务", color: "#a5d8ff" },
    { x: 640, y: 0, w: 200, h: 88, title: "迭代交付", color: "#b2f2bb" },
  ];

  const nodeElements = nodes.map((node) => {
    const textId = crypto.randomUUID();
    const text = textElement({
      x: node.x + 10,
      y: node.y + (node.h - 26) / 2,
      width: node.w - 20,
      height: 26,
      text: node.title,
      fontSize: 20,
      containerId: null,
      align: "center",
      color: "#1e1e1e",
    });
    text.id = textId;
    const rect = rectElement({
      x: node.x,
      y: node.y,
      width: node.w,
      height: node.h,
      color: node.color,
      textId,
    });
    // 文字绑定到矩形，双击可直接编辑
    text.containerId = rect.id;
    text.autoResize = false;
    rect.boundElements = [{ type: "text", id: text.id }];
    return { rect, text };
  });

  for (const node of nodeElements) {
    elements.push(node.rect, node.text);
  }

  // 节点之间的连接线
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const from = nodeElements[i].rect;
    const to = nodeElements[i + 1].rect;
    const arrow = arrowElement({
      x: from.x + from.width,
      y: from.y + from.height / 2,
      points: [
        [0, 0],
        [to.x - (from.x + from.width), 0],
      ],
    });
    arrow.startBinding = { elementId: from.id, focus: 0, gap: 4 };
    arrow.endBinding = { elementId: to.id, focus: 0, gap: 4 };
    from.boundElements = [...(from.boundElements || []), { type: "arrow", id: arrow.id }];
    to.boundElements = [...(to.boundElements || []), { type: "arrow", id: arrow.id }];
    elements.push(arrow);
  }

  // 顶部标题
  elements.push(
    textElement({
      x: 0,
      y: -110,
      width: 460,
      height: 44,
      text: "MBoard 无限画布",
      fontSize: 34,
      color: "#1e1e1e",
    })
  );

  elements.push(
    textElement({
      x: 0,
      y: -60,
      width: 560,
      height: 26,
      text: "拖拽元素移动，双击编辑文字，从侧栏插入便签、文档、图片与视频",
      fontSize: 15,
      color: "#868e96",
    })
  );

  // 底部便签
  const note = rectElement({
    x: 0,
    y: 160,
    width: 260,
    height: 120,
    color: "#ffec99",
    textId: null,
  });
  const noteTextId = crypto.randomUUID();
  const noteText = textElement({
    x: 16,
    y: 176,
    width: 228,
    height: 88,
    text: "提示：所有改动会自动保存\n并且实时同步给在线成员",
    fontSize: 15,
    align: "left",
    color: "#5f3dc4",
  });
  noteText.id = noteTextId;
  noteText.containerId = note.id;
  noteText.autoResize = false;
  note.boundElements = [{ type: "text", id: noteText.id }];
  elements.push(note, noteText);

  return { elements, appState: { viewBackgroundColor: "#ffffff", gridSize: null } };
}

const USAGE_DOC = `# MBoard 使用指南

MBoard 是一个共享协作工作台，包含两块内容：**看板**与**无限画布**。

## 看板
- 拖拽列表调整顺序，拖拽卡片在列表间移动
- 点击卡片打开详情，支持 Markdown 描述、标签、截止时间与附件
- 所有成员共享同一份数据

## 画布
- 无限延展，滚轮缩放，空格或中键拖动画布
- 连接线会自动吸附到图形锚点
- 侧栏可以插入便签、Markdown 文档、图片与视频
- 多人同时编辑时，改动实时同步，右上角可以看到在线成员

## 快捷键
| 操作 | 快捷键 |
| --- | --- |
| 选择 | V |
| 矩形 | R |
| 箭头 | A |
| 文本 | T |
| 撤销 / 重做 | Ctrl+Z / Ctrl+Shift+Z |
| 复制选中 | Ctrl+D |
`;

async function main() {
  const boardCount = await prisma.board.count();
  if (boardCount === 0) {
    const productBoard = await prisma.board.create({
      data: {
        title: "产品需求池",
        description: "收集与排期本周要推进的需求",
        accent: "#6353f5",
        sort: 0,
        lists: {
          create: [
            {
              title: "待办",
              sort: 0,
              cards: {
                create: [
                  {
                    title: "画布支持导入 Markdown 文档",
                    descriptionMd:
                      "支持上传 `.md` 文件，在画布中生成文档卡片，点击可预览渲染结果。\n\n- 支持 GFM 表格\n- 支持代码块",
                    labels: JSON.stringify([{ name: "功能", color: "#6353f5" }]),
                    assignees: JSON.stringify(["maxy"]),
                    sort: 0,
                  },
                  {
                    title: "看板卡片支持附件上传",
                    descriptionMd: "图片、PDF、Markdown 都可以作为卡片附件。",
                    labels: JSON.stringify([{ name: "增强", color: "#0ea5e9" }]),
                    assignees: JSON.stringify(["tannami", "tomato"]),
                    sort: 1,
                  },
                ],
              },
            },
            {
              title: "进行中",
              sort: 1,
              cards: {
                create: [
                  {
                    title: "多人实时协作光标",
                    descriptionMd: "基于 Yjs + WebSocket，展示在线成员与实时光标。",
                    labels: JSON.stringify([{ name: "核心", color: "#f59e0b" }]),
                    assignees: JSON.stringify(["maxy", "fashi"]),
                    sort: 0,
                  },
                ],
              },
            },
            {
              title: "已完成",
              sort: 2,
              cards: {
                create: [
                  {
                    title: "配置文件账号登录",
                    descriptionMd: "账号写在 `config/accounts.yml`，登录后共享所有数据。",
                    labels: JSON.stringify([{ name: "基础", color: "#10b981" }]),
                    assignees: JSON.stringify(["maxy"]),
                    sort: 0,
                  },
                ],
              },
            },
          ],
        },
      },
    });

    await prisma.board.create({
      data: {
        title: "课程项目排期",
        description: "软件工程课程的过程记录",
        accent: "#0ea5e9",
        sort: 1,
        lists: {
          create: [
            {
              title: "本周",
              sort: 0,
              cards: {
                create: [
                  {
                    title: "完成需求梳理",
                    sort: 0,
                    assignees: JSON.stringify(["tannami"]),
                  },
                  {
                    title: "画系统架构图",
                    sort: 1,
                    assignees: JSON.stringify(["fashi"]),
                  },
                ],
              },
            },
            {
              title: "下周",
              sort: 1,
              cards: {
                create: [
                  {
                    title: "联调实时协作",
                    sort: 0,
                    assignees: JSON.stringify(["tomato"]),
                  },
                ],
              },
            },
          ],
        },
      },
    });

    console.log(`已创建应用看板: ${productBoard.title}`);
  }

  const canvasCount = await prisma.canvas.count();
  if (canvasCount === 0) {
    const scene = buildDemoScene();
    await prisma.canvas.create({
      data: {
        title: "故事线白板",
        description: "演示用的流程图，可直接编辑",
        sceneJson: JSON.stringify(scene),
      },
    });

    await prisma.canvas.create({
      data: {
        title: "空白画板",
        description: "从零开始的新画布",
        sceneJson: JSON.stringify({ elements: [], appState: { viewBackgroundColor: "#ffffff" } }),
      },
    });

    console.log("已创建演示画板");
  }

  const documentCount = await prisma.document.count();
  if (documentCount === 0) {
    await prisma.document.create({
      data: { title: "MBoard 使用指南.md", contentMd: USAGE_DOC },
    });
    console.log("已创建示例文档");
  }

  console.log("种子数据完成");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
