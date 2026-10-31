"use client";

import { useMemo, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ParsedTable = {
  headers: string[];
  rows: string[][];
};

// 把单张 Markdown 表格解析成网格；不是纯表格时返回 null
export function parseMarkdownTable(markdown: string): ParsedTable | null {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return null;

  const splitRow = (line: string): string[] => {
    let body = line;
    if (body.startsWith("|")) body = body.slice(1);
    if (body.endsWith("|")) body = body.slice(0, -1);
    return body.split("|").map((cell) => cell.trim());
  };

  const separator = splitRow(lines[1]);
  const isSeparator =
    lines[1].startsWith("|") &&
    separator.length > 0 &&
    separator.every((cell) => /^:?-{2,}:?$/.test(cell));
  if (!isSeparator) return null;

  const headers = splitRow(lines[0]);
  if (headers.length === 0) return null;

  const rows = lines.slice(2).map((line) => {
    const cells = splitRow(line);
    return headers.map((_, index) => cells[index] ?? "");
  });

  return { headers, rows };
}

export function isMarkdownTable(markdown: string): boolean {
  return parseMarkdownTable(markdown) !== null;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

export function serializeMarkdownTable(table: ParsedTable): string {
  const header = `| ${table.headers.map(escapeCell).join(" | ")} |`;
  const divider = `| ${table.headers.map(() => "---").join(" | ")} |`;
  const rows = table.rows.map(
    (row) => `| ${table.headers.map((_, index) => escapeCell(row[index] ?? "")).join(" | ")} |`
  );
  return [header, divider, ...rows].join("\n");
}

const EMPTY_TABLE: ParsedTable = {
  headers: ["列 1", "列 2", "列 3"],
  rows: [
    ["", "", ""],
    ["", "", ""],
  ],
};

type TableEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
  disabled?: boolean;
  className?: string;
};

// 可视化表格编辑：点格子直接改，自动序列化成 Markdown
export function TableEditor({ value, onChange, disabled = false, className }: TableEditorProps) {
  const initial = useMemo(
    () => parseMarkdownTable(value) ?? EMPTY_TABLE,
    // 由父组件用 key 控制文档切换，这里只在挂载时解析一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [table, setTable] = useState<ParsedTable>(initial);

  const apply = (next: ParsedTable) => {
    setTable(next);
    onChange(serializeMarkdownTable(next));
  };

  const setCell = (type: "header" | "row", rowIndex: number, colIndex: number, text: string) => {
    if (type === "header") {
      const headers = table.headers.map((cell, index) => (index === colIndex ? text : cell));
      apply({ ...table, headers });
      return;
    }
    const rows = table.rows.map((row, index) =>
      index === rowIndex ? row.map((cell, col) => (col === colIndex ? text : cell)) : row
    );
    apply({ ...table, rows });
  };

  const addColumn = () => {
    apply({
      headers: [...table.headers, `列 ${table.headers.length + 1}`],
      rows: table.rows.map((row) => [...row, ""]),
    });
  };

  const removeColumn = (colIndex: number) => {
    if (table.headers.length <= 1) return;
    apply({
      headers: table.headers.filter((_, index) => index !== colIndex),
      rows: table.rows.map((row) => row.filter((_, index) => index !== colIndex)),
    });
  };

  const addRow = () => {
    apply({ ...table, rows: [...table.rows, table.headers.map(() => "")] });
  };

  const removeRow = (rowIndex: number) => {
    apply({ ...table, rows: table.rows.filter((_, index) => index !== rowIndex) });
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="scroll-thin overflow-auto rounded-xl border border-line">
        <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className="w-9 border-b border-r border-line bg-surface-2 p-1 text-[10px] font-medium text-faint">
                #
              </th>
              {table.headers.map((header, colIndex) => (
                <th key={colIndex} className="border-b border-line bg-surface-2 p-1">
                  <div className="flex items-center gap-1">
                    <input
                      value={header}
                      disabled={disabled}
                      onChange={(event) =>
                        setCell("header", 0, colIndex, event.target.value)
                      }
                      placeholder={`列 ${colIndex + 1}`}
                      className="h-8 w-full min-w-[90px] rounded-md border border-transparent bg-transparent px-2 text-[12.5px] font-medium text-ink outline-none transition hover:border-line focus:border-brand/50 focus:bg-surface"
                    />
                    <button
                      type="button"
                      disabled={disabled || table.headers.length <= 1}
                      onClick={() => removeColumn(colIndex)}
                      className="icon-btn h-6 w-6 shrink-0 opacity-60 hover:opacity-100"
                      title="删除这一列"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="w-9 border-b border-l border-line bg-surface-2 p-1">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={addColumn}
                  className="icon-btn h-7 w-7"
                  title="添加一列"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="group">
                <td className="border-b border-r border-line bg-surface-2/50 p-1 text-center text-[10px] text-faint">
                  <span className="group-hover:hidden">{rowIndex + 1}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => removeRow(rowIndex)}
                    className="hidden text-muted hover:text-danger group-hover:inline-flex"
                    title="删除这一行"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </td>
                {table.headers.map((_, colIndex) => (
                  <td key={colIndex} className="border-b border-line p-1">
                    <input
                      value={row[colIndex] ?? ""}
                      disabled={disabled}
                      onChange={(event) =>
                        setCell("row", rowIndex, colIndex, event.target.value)
                      }
                      className="h-8 w-full min-w-[90px] rounded-md border border-transparent bg-transparent px-2 text-[12.5px] text-ink outline-none transition hover:border-line focus:border-brand/50 focus:bg-surface"
                    />
                  </td>
                ))}
                <td className="border-b border-l border-line" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={addRow}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12px] text-ink transition hover:bg-surface-2"
        >
          <Plus className="h-3 w-3" />
          添加行
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={addColumn}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12px] text-ink transition hover:bg-surface-2"
        >
          <Plus className="h-3 w-3" />
          添加列
        </button>
        <span className="text-[11px] text-faint">保存时会自动转成 Markdown 表格</span>
      </div>
    </div>
  );
}
