import { notFound } from "next/navigation";
import { STUDIO_TOOL_LABELS } from "@/lib/studioTools";
import { isOwnerServer } from "@/lib/isOwner";
import StudioGate, { type StudioToolProps } from "./StudioGate";
import AudioVisualizerStudio from "@/components/studio/AudioVisualizerStudio";

const STUDIO_COMPONENTS: Record<string, React.ComponentType<StudioToolProps>> = {
  "audio-visualizer": AudioVisualizerStudio,
};

export default function ToolPage({
  params,
  searchParams,
}: {
  params: { tool: string };
  searchParams: { order?: string };
}) {
  const isOwner = isOwnerServer();
  const studioLabel = STUDIO_TOOL_LABELS[params.tool];
  if (!studioLabel) notFound();

  const StudioComponent = STUDIO_COMPONENTS[params.tool];
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="mb-2 text-xl font-extrabold text-slate-900">{studioLabel.title}</h1>
      {isOwner ? (
        <p className="mb-6 inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          🔑 وضع المالك — وصول كامل بلا رمز طلب
        </p>
      ) : (
        <p className="mb-6 text-sm text-slate-500">
          جرّب الأداة فوراً مجاناً بلا تسجيل — لا حاجة لأي رمز إلا عند الرغبة بوصول غير محدود.
        </p>
      )}
      <StudioGate
        tool={params.tool}
        serviceHref={`/service/${params.tool}`}
        freeUses={studioLabel.freeUses}
        initialOrderCode={searchParams.order || ""}
        isOwner={isOwner}
      >
        {(studioProps) => <StudioComponent {...studioProps} />}
      </StudioGate>
    </div>
  );
}
