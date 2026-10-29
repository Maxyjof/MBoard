import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";
import { CanvasEditor } from "@/components/canvas/editor/canvas-editor";
import type { SceneData } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canvas = await prisma.canvas.findUnique({ where: { id }, select: { title: true } });
  return { title: canvas?.title || "画板" };
}

function parseScene(sceneJson: string): SceneData {
  try {
    const parsed = JSON.parse(sceneJson);
    return {
      elements: Array.isArray(parsed?.elements) ? parsed.elements : [],
      appState: parsed?.appState && typeof parsed.appState === "object" ? parsed.appState : {},
    };
  } catch {
    return { elements: [], appState: {} };
  }
}

export default async function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) notFound();

  const canvas = await prisma.canvas.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      sceneJson: true,
      updatedAt: true,
    },
  });

  if (!canvas) notFound();

  return (
    <CanvasEditor
      canvas={{
        id: canvas.id,
        title: canvas.title,
        description: canvas.description,
        updatedAt: canvas.updatedAt.toISOString(),
      }}
      initialScene={parseScene(canvas.sceneJson)}
      user={session}
    />
  );
}
