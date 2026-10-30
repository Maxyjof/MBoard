"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Boxes,
  Circle,
  Diamond,
  Download,
  FileText,
  FileUp,
  Image as ImageIcon,
  Loader2,
  Plus,
  RectangleHorizontal,
  Search,
  SquarePen,
  StickyNote,
  Table2,
  Trash2,
  Type,
  Ungroup,
  Video,
  X,
} from "lucide-react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MarkdownView } from "@/components/canvas/markdown-view";
import { cn, relativeTime } from "@/lib/utils";
import type { DocumentDTO } from "@/lib/types";

// CodeMirror 编辑器体积较大，只在打开文档时按需加载
const DocumentEditorDialog = dynamic(
  () =>
    import("@/components/canvas/document-editor-dialog").then(
      (module) => module.DocumentEditorDialog
    ),
  { ssr: false }
);
import {
  activateTool,
  groupSelectedElements,
  insertDocCard,
  insertFileCard,
  insertImage,
  insertShape,
  insertSticky,
  insertText,
  insertVideoCard,
  ungroupSelectedElements,
} from "./insert";
import { blobToDataURL, uploadAsset } from "./scene-assets";

type DocListItem = Omit<DocumentDTO, "contentMd">;

export type CanvasSelection = {
  docId?: string;
  docTitle?: string;
  videoAssetId?: string;
  videoName?: string;
  fileAssetId?: string;
  fileName?: string;
  fileMime?: string;
};

export type OpenElementRequest = {
  kind: "doc" | "video" | "file";
  id: string;
  seq: number;
  name?: string;
  mime?: string;
};

type AssetPanelProps = {
  canvasId: string;
  apiRef: React.RefObject<ExcalidrawImperativeAPI | null>;
  selection: CanvasSelection | null;
  openRequest?: OpenElementRequest | null;
  onClose: () => void;
};

const TABLE_TEMPLATE = `| 项目 | 负责人 | 状态 |
| --- | --- | --- |
| 需求梳理 |  | 待开始 |
| 原型设计 |  | 进行中 |
| 联调验收 |  | 待开始 |
`;

// 右侧面板：插入组件 + 文档库 + 选中元素预览
export function AssetPanel({
  canvasId,
  apiRef,
  selection,
  openRequest,
  onClose,
}: AssetPanelProps) {
  const [tab, setTab] = useState<"insert" | "docs">("insert");
  const [docs, setDocs] = useState<DocListItem[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // 文档编辑弹窗
  const [activeDoc, setActiveDoc] = useState<DocumentDTO | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // 选中画布文档卡片时的内联预览
  const [previewDoc, setPreviewDoc] = useState<DocumentDTO | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewDocIdRef = useRef<string | null>(null);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<DocListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 选中元素的视频播放
  const [videoOpen, setVideoOpen] = useState<string | null>(null);
  // 文件资源预览（PDF / Office 等）
  const [filePreview, setFilePreview] = useState<{
    id: string;
    name: string;
    mime: string;
  } | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const markdownInputRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async (keyword = "") => {
    setLoadingDocs(true);
    try {
      const response = await fetch(`/api/documents?q=${encodeURIComponent(keyword)}`);
      const data = (await response.json()) as { documents?: DocListItem[]; error?: string };
      if (!response.ok) {
        toast.error(data.error || "加载文档失败");
        return;
      }
      setDocs(data.documents ?? []);
    } catch {
      toast.error("网络异常，文档加载失败");
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => void loadDocs(query.trim()), 260);
    return () => clearTimeout(timer);
  }, [query, loadDocs]);

  const withApi = (action: (api: ExcalidrawImperativeAPI) => void | Promise<void>) => {
    const api = apiRef.current;
    if (!api) {
      toast.error("画布还没准备好，请稍候");
      return;
    }
    Promise.resolve(action(api)).catch(() => toast.error("操作失败，请重试"));
  };

  // 双击画布卡片时由画布父组件触发
  useEffect(() => {
    if (!openRequest) return;
    setTab("docs");
    if (openRequest.kind === "doc") {
      void openDoc(openRequest.id);
    } else if (openRequest.kind === "video") {
      setVideoOpen(openRequest.id);
    } else {
      setFilePreview({
        id: openRequest.id,
        name: openRequest.name || "文件",
        mime: openRequest.mime || "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.seq]);

  // 选中文档卡片：自动在右侧渲染内容，免点“预览”
  useEffect(() => {
    const docId = selection?.docId;
    if (!docId) {
      previewDocIdRef.current = null;
      setPreviewDoc(null);
      setPreviewLoading(false);
      return;
    }
    if (previewDocIdRef.current === docId) return;
    previewDocIdRef.current = docId;

    let cancelled = false;
    setPreviewLoading(true);
    // 选中文档时顺带预热编辑器分包，双击打开更快
    void import("@/components/canvas/document-editor-dialog");

    fetch(`/api/documents/${docId}`)
      .then(async (response) => {
        const data = (await response.json()) as { document?: DocumentDTO; error?: string };
        if (!response.ok || !data.document) throw new Error(data.error || "文档不存在");
        if (!cancelled) setPreviewDoc(data.document);
      })
      .catch(() => {
        if (!cancelled) setPreviewDoc(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selection?.docId]);

  async function handleImageFile(file: File) {
    setBusy("image");
    try {
      const asset = await uploadAsset(file, "image");
      const dataURL = await blobToDataURL(file);
      withApi((api) => void insertImage(api, asset, dataURL));
      toast.success("图片已插入画布");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片上传失败");
    } finally {
      setBusy(null);
    }
  }

  async function handleVideoFile(file: File) {
    setBusy("video");
    try {
      const asset = await uploadAsset(file, "video");
      withApi((api) => insertVideoCard(api, asset));
      toast.success("视频卡片已插入，选中后可播放");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "视频上传失败");
    } finally {
      setBusy(null);
    }
  }

  async function handleImportFile(file: File) {
    setBusy("file");
    const lower = file.name.toLowerCase();
    const isTextDoc =
      /\.(md|markdown|txt|csv)$/i.test(lower) ||
      file.type === "text/markdown" ||
      file.type === "text/plain" ||
      file.type === "text/csv";

    try {
      if (isTextDoc) {
        const contentMd = await file.text();
        const response = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: file.name,
            contentMd,
            kind: "markdown",
          }),
        });
        const data = (await response.json()) as { document?: DocumentDTO; error?: string };
        if (!response.ok || !data.document) {
          toast.error(data.error || "导入文档失败");
          return;
        }
        toast.success(`已导入「${data.document.title}」`);
        setTab("docs");
        await loadDocs(query.trim());
        setActiveDoc(data.document);
        setDialogOpen(true);
        return;
      }

      // PDF / Office / 压缩包等：上传成资源并插入文件卡片
      const asset = await uploadAsset(file, "file");
      withApi((api) => insertFileCard(api, asset));
      toast.success(`「${file.name}」已作为文件卡片插入`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入文件失败");
    } finally {
      setBusy(null);
    }
  }

  async function createTableDoc() {
    setBusy("table");
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "新建表格", contentMd: TABLE_TEMPLATE, kind: "table" }),
      });
      const data = (await response.json()) as { document?: DocumentDTO; error?: string };
      if (!response.ok || !data.document) {
        toast.error(data.error || "创建表格失败");
        return;
      }
      withApi((api) => insertDocCard(api, data.document!));
      toast.success("表格已插入，可直接在弹窗里编辑单元格");
      setTab("docs");
      await loadDocs(query.trim());
      setActiveDoc(data.document);
      setDialogOpen(true);
    } catch {
      toast.error("创建表格失败");
    } finally {
      setBusy(null);
    }
  }

  async function openDoc(id: string) {
    try {
      const response = await fetch(`/api/documents/${id}`);
      const data = (await response.json()) as { document?: DocumentDTO; error?: string };
      if (!response.ok || !data.document) {
        toast.error(data.error || "文档不存在");
        return;
      }
      setActiveDoc(data.document);
      setDialogOpen(true);
    } catch {
      toast.error("打开文档失败");
    }
  }

  async function deleteDoc() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/documents/${deleteTarget.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        toast.error(data.error || "删除失败");
        return;
      }
      toast.success("文档已删除");
      setDeleteTarget(null);
      await loadDocs(query.trim());
    } catch {
      toast.error("删除文档失败");
    } finally {
      setDeleting(false);
    }
  }

  async function createBlankDoc() {
    setBusy("newdoc");
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "未命名文档",
          contentMd: "# 未命名文档\n\n开始写作吧。",
          kind: "markdown",
        }),
      });
      const data = (await response.json()) as { document?: DocumentDTO; error?: string };
      if (!response.ok || !data.document) {
        toast.error(data.error || "创建文档失败");
        return;
      }
      setTab("docs");
      await loadDocs(query.trim());
      setActiveDoc(data.document);
      setDialogOpen(true);
    } catch {
      toast.error("创建文档失败");
    } finally {
      setBusy(null);
    }
  }

  function insertExistingDoc(doc: DocListItem) {
    withApi((api) => {
      insertDocCard(api, doc);
      toast.success("文档卡片已插入");
    });
  }

  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex w-[336px] max-w-[92vw] flex-col border-l border-line bg-surface shadow-float md:static md:shadow-none">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">资料面板</span>
          <span className="chip bg-brand/10 text-brand">共享</span>
        </div>
        <button type="button" onClick={onClose} className="icon-btn" aria-label="关闭面板">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="shrink-0 px-3 pt-3">
        <div className="flex rounded-lg bg-surface-2 p-0.5">
          {(["insert", "docs"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition",
                tab === item ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              )}
            >
              {item === "insert" ? "插入组件" : "文档库"}
            </button>
          ))}
        </div>
      </div>

      {selection?.docId ? (
        <div className="mx-3 mt-3 overflow-hidden rounded-xl border border-brand/25 bg-brand/5">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-wide text-brand">
                已选中文档
              </p>
              <p className="mt-0.5 truncate text-[12.5px] font-medium text-ink">
                {previewDoc?.title || selection.docTitle || "文档"}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                size="sm"
                variant="subtle"
                onClick={() => void openDoc(selection.docId!)}
              >
                打开编辑
              </Button>
            </div>
          </div>
          <div className="max-h-[210px] overflow-y-auto border-t border-brand/15 bg-surface px-3 py-2">
            {previewLoading ? (
              <div className="flex items-center justify-center gap-2 py-4 text-[11.5px] text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                加载文档内容
              </div>
            ) : previewDoc ? (
              <MarkdownView content={previewDoc.contentMd} />
            ) : (
              <p className="py-3 text-center text-[11.5px] text-faint">文档内容加载失败</p>
            )}
          </div>
        </div>
      ) : selection?.fileAssetId ? (
        <div className="mx-3 mt-3 rounded-xl border border-brand/25 bg-brand/5 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-brand">已选中文件</p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[12.5px] text-ink">
              📎 {selection.fileName || "文件"}
            </p>
            <Button
              size="sm"
              variant="subtle"
              onClick={() =>
                setFilePreview({
                  id: selection.fileAssetId!,
                  name: selection.fileName || "文件",
                  mime: selection.fileMime || "",
                })
              }
            >
              打开
            </Button>
          </div>
        </div>
      ) : selection?.videoAssetId ? (
        <div className="mx-3 mt-3 rounded-xl border border-brand/25 bg-brand/5 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-brand">已选中画布元素</p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[12.5px] text-ink">
              ▶ {selection.videoName || "视频"}
            </p>
            <Button size="sm" variant="subtle" onClick={() => setVideoOpen(selection.videoAssetId!)}>
              播放
            </Button>
          </div>
        </div>
      ) : null}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "insert" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <InsertTile label="便签" icon={<StickyNote />} onClick={() => withApi((api) => insertSticky(api))} />
              <InsertTile label="文本" icon={<Type />} onClick={() => withApi((api) => insertText(api))} />
              <InsertTile
                label="矩形"
                icon={<RectangleHorizontal />}
                onClick={() => withApi((api) => insertShape(api, "rectangle"))}
              />
              <InsertTile
                label="圆形"
                icon={<Circle />}
                onClick={() => withApi((api) => insertShape(api, "ellipse"))}
              />
              <InsertTile
                label="菱形"
                icon={<Diamond />}
                onClick={() => withApi((api) => insertShape(api, "diamond"))}
              />
              <InsertTile
                label="箭头"
                icon={<ArrowUpRight />}
                onClick={() =>
                  withApi((api) => {
                    activateTool(api, "arrow");
                    toast.info("在画布上拖拽即可绘制箭头");
                  })
                }
              />
              <InsertTile
                label="图片"
                icon={busy === "image" ? <Loader2 className="animate-spin" /> : <ImageIcon />}
                onClick={() => imageInputRef.current?.click()}
              />
              <InsertTile
                label="视频"
                icon={busy === "video" ? <Loader2 className="animate-spin" /> : <Video />}
                onClick={() => videoInputRef.current?.click()}
              />
              <InsertTile
                label="表格"
                icon={busy === "table" ? <Loader2 className="animate-spin" /> : <Table2 />}
                onClick={() => void createTableDoc()}
              />
              <InsertTile
                label="组合"
                icon={<Boxes />}
                onClick={() =>
                  withApi(async (api) => {
                    const grouped = await groupSelectedElements(api);
                    if (grouped) {
                      toast.success("已组合，拖动任意成员即可整体移动");
                    } else {
                      toast.info("请先选中要组合的元素");
                    }
                  })
                }
              />
              <InsertTile
                label="取消组合"
                icon={<Ungroup />}
                onClick={() =>
                  withApi((api) => {
                    const ungrouped = ungroupSelectedElements(api);
                    if (ungrouped) toast.success("已取消组合");
                    else toast.info("选中的元素没有分组");
                  })
                }
              />
            </div>

            <div className="rounded-xl border border-line bg-surface-2/50 p-3">
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                <FileUp className="h-3.5 w-3.5 text-brand" />
                文档与文件
              </div>
              <p className="mt-1 text-[11.5px] leading-5 text-muted">
                支持 Markdown / TXT / PDF / Office，也可以直接把文件拖进画布；文档可在线编辑，文件可下载。
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => markdownInputRef.current?.click()}
                  loading={busy === "file"}
                >
                  导入文件
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setTab("docs")}>
                  打开文档库
                </Button>
              </div>
            </div>

            <p className="px-1 text-[11px] leading-5 text-faint">
              提示：文档/文件卡片单击即可打开；选中多个元素后点「组合」可以整体拖动。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-faint" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索文档"
                  className="h-9 pl-8 text-[12.5px]"
                />
              </div>
              <Button
                size="icon"
                variant="outline"
                onClick={() => void createBlankDoc()}
                loading={busy === "newdoc"}
                aria-label="新建文档"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {loadingDocs ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                加载文档
              </div>
            ) : docs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
                <FileText className="mx-auto h-5 w-5 text-faint" />
                <p className="mt-2 text-[12.5px] text-muted">还没有文档</p>
                <p className="mt-1 text-[11.5px] text-faint">上传 Markdown 或新建一个</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {docs.map((doc) => (
                  <li key={doc.id} className="group">
                    <div className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-surface-2">
                      {doc.kind === "table" ? (
                        <Table2 className="h-4 w-4 shrink-0 text-brand" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-brand" />
                      )}
                      <button
                        type="button"
                        onClick={() => void openDoc(doc.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate text-[12.5px] text-ink">{doc.title}</span>
                        <span className="block text-[10.5px] text-faint">
                          {doc.kind === "table" ? "表格 · " : ""}
                          {relativeTime(doc.updatedAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => insertExistingDoc(doc)}
                        className="icon-btn h-7 w-7 opacity-0 transition group-hover:opacity-100"
                        aria-label="插入到画布"
                      >
                        <SquarePen className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(doc)}
                        className="icon-btn h-7 w-7 opacity-0 transition hover:text-danger group-hover:opacity-100"
                        aria-label="删除文档"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 隐藏的文件选择器 */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleImageFile(file);
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleVideoFile(file);
        }}
      />
      <input
        ref={markdownInputRef}
        type="file"
        accept=".md,.markdown,.txt,.csv,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,text/markdown,text/plain,text/csv,application/pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleImportFile(file);
        }}
      />

      <DocumentEditorDialog
        open={dialogOpen}
        document={activeDoc}
        onOpenChange={setDialogOpen}
        onSaved={(doc) => {
          setActiveDoc(doc);
          setPreviewDoc((previous) => (previous?.id === doc.id ? doc : previous));
          void loadDocs(query.trim());
        }}
        onInsert={(doc) => {
          withApi((api) => insertDocCard(api, doc));
          toast.success("文档卡片已插入画布");
        }}
      />

      {/* 文件预览与下载 */}
      <Modal
        open={Boolean(filePreview)}
        onOpenChange={(open) => !open && setFilePreview(null)}
        size="xl"
        title={filePreview?.name}
        description="文件资源 · 支持下载"
        footer={
          filePreview ? (
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-[11px] text-faint">PDF 可在线预览，Office 等格式请下载查看</span>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/assets/${filePreview.id}`}
                  download={filePreview.name}
                  className="inline-flex h-9 items-center gap-2 rounded-xl bg-brand px-3.5 text-[13px] font-medium text-white transition hover:bg-brand/90"
                >
                  <Download className="h-3.5 w-3.5" />
                  下载文件
                </a>
                <Button variant="secondary" onClick={() => setFilePreview(null)}>
                  关闭
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        {filePreview ? (
          filePreview.mime === "application/pdf" || /\.pdf$/i.test(filePreview.name) ? (
            <iframe
              key={filePreview.id}
              src={`/api/assets/${filePreview.id}`}
              title={filePreview.name}
              className="h-[62vh] w-full rounded-xl border border-line bg-white"
            />
          ) : (
            <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface-2/50 text-center">
              <FileText className="h-8 w-8 text-faint" />
              <p className="text-[13px] font-medium text-ink">{filePreview.name}</p>
              <p className="text-[11.5px] text-muted">
                该文件类型暂不支持在线预览，下载后查看
              </p>
            </div>
          )
        ) : null}
      </Modal>

      {/* 视频播放 */}
      <Modal
        open={Boolean(videoOpen)}
        onOpenChange={(open) => !open && setVideoOpen(null)}
        size="xl"
        title="视频预览"
      >
        {videoOpen ? (
          <video
            key={videoOpen}
            src={`/api/assets/${videoOpen}`}
            controls
            autoPlay
            className="max-h-[65vh] w-full rounded-xl bg-black"
          />
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="删除文档"
        description={`确定删除「${deleteTarget?.title ?? ""}」？画布上已插入的卡片将无法再打开。`}
        confirmText="删除"
        danger
        loading={deleting}
        onConfirm={deleteDoc}
      />
    </aside>
  );
}

function InsertTile({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5 rounded-xl border border-line bg-surface px-2 py-3 text-[11.5px] text-muted transition hover:-translate-y-0.5 hover:border-brand/40 hover:text-brand hover:shadow-card"
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {label}
    </button>
  );
}
