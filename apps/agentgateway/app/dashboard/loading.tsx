const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_YEAR = 2026;
const loadingCellSize = "12px";
const loadingGapSize = "4px";
const loadingToday = new Date();
loadingToday.setHours(0, 0, 0, 0);
const loadingYearStart = new Date(ACTIVITY_YEAR, 0, 1);
const loadingYearEnd = new Date(ACTIVITY_YEAR, 11, 31);
const loadingChartEnd = loadingToday.getFullYear() === ACTIVITY_YEAR
  ? loadingToday
  : loadingToday.getFullYear() > ACTIVITY_YEAR
    ? loadingYearEnd
    : loadingYearStart;
const loadingGridStart = new Date(loadingYearStart);
loadingGridStart.setDate(loadingYearStart.getDate() - loadingYearStart.getDay());
const loadingCellCount = Math.floor((loadingChartEnd.getTime() - loadingGridStart.getTime()) / DAY_MS) + 1;
const loadingWeeks = Math.max(1, Math.ceil(loadingCellCount / 7));
const heatmapCells = Array.from({ length: loadingCellCount }, (_, index) => {
  const date = new Date(loadingGridStart);
  date.setDate(loadingGridStart.getDate() + index);
  return { index, isCurrentYear: date.getFullYear() === ACTIVITY_YEAR && date <= loadingChartEnd };
});
const loadingMonths = Array.from({ length: loadingChartEnd.getMonth() + 1 }, (_, monthOffset) => {
  const date = new Date(ACTIVITY_YEAR, monthOffset, 1);
  return {
    label: new Intl.DateTimeFormat("en", { month: "short" }).format(date),
    column: Math.floor((date.getTime() - loadingGridStart.getTime()) / (DAY_MS * 7)) + 1,
  };
});
const toolCards = Array.from({ length: 8 }, (_, index) => index);
const metricCards = Array.from({ length: 4 }, (_, index) => index);

function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-neutral-200/80 ${className}`} />;
}

function ToolSkeleton({ index }: { index: number }) {
  return (
    <div className="flex min-h-[92px] items-center justify-between rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex min-w-0 items-center gap-4">
        <SkeletonBar className={`h-10 w-10 shrink-0 rounded-lg ${index % 3 === 0 ? "bg-orange-100" : index % 3 === 1 ? "bg-blue-100" : "bg-emerald-100"}`} />
        <div className="min-w-0 space-y-2">
          <SkeletonBar className="h-4 w-28" />
          <SkeletonBar className="h-3 w-20" />
        </div>
      </div>
      <SkeletonBar className="h-4 w-12" />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl space-y-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading dashboard</span>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <SkeletonBar className="h-4 w-36" />
          <SkeletonBar className="mt-3 h-8 w-full max-w-[360px]" />
          <SkeletonBar className="mt-3 h-4 w-full max-w-2xl" />
          <SkeletonBar className="mt-2 h-4 w-2/3 max-w-xl" />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <SkeletonBar className="h-11 w-36 rounded-lg bg-white" />
          <SkeletonBar className="h-11 w-40 rounded-lg bg-orange-200" />
        </div>
      </div>

      <section className="console-card p-5 sm:p-6">
        <div className="overflow-x-auto pb-1">
          <div className="min-w-max">
            <div
              className="mb-3 grid pl-9 font-mono text-[11px] leading-none text-neutral-300"
              style={{
                gap: loadingGapSize,
                gridTemplateColumns: `repeat(${loadingWeeks}, ${loadingCellSize})`,
              }}
            >
              {loadingMonths.map((month) => (
                <span key={month.label} style={{ gridColumn: `${month.column} / span 4` }}>
                  {month.label}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-[28px_1fr] gap-2">
              <div
                className="grid font-mono text-[11px] leading-none text-neutral-300"
                style={{
                  gap: loadingGapSize,
                  gridTemplateRows: `repeat(7, ${loadingCellSize})`,
                }}
              >
                <span />
                <span className="flex items-center">Mon</span>
                <span />
                <span className="flex items-center">Wed</span>
                <span />
                <span className="flex items-center">Fri</span>
                <span />
              </div>
              <div
                className="grid grid-flow-col grid-rows-7"
                style={{
                  gap: loadingGapSize,
                  gridTemplateColumns: `repeat(${loadingWeeks}, ${loadingCellSize})`,
                  gridTemplateRows: `repeat(7, ${loadingCellSize})`,
                }}
              >
                {heatmapCells.map((cell) => (
                  <span
                    key={cell.index}
                    className={`w-full rounded-[4px] ${!cell.isCurrentYear ? "bg-transparent" : cell.index % 47 === 0 ? "bg-orange-600" : cell.index % 19 === 0 ? "bg-orange-200" : "bg-neutral-100"} animate-pulse`}
                    style={{ height: loadingCellSize, width: loadingCellSize }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-5 border-t border-neutral-100 pt-5 sm:grid-cols-4">
          {metricCards.map((index) => (
            <div key={index} className="space-y-2">
              <SkeletonBar className="h-4 w-28" />
              <SkeletonBar className="h-7 w-16" />
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <SkeletonBar className="h-6 w-64" />
          <SkeletonBar className="hidden h-4 w-24 sm:block" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {toolCards.map((index) => (
            <ToolSkeleton key={index} index={index} />
          ))}
        </div>
      </section>

      <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="console-card p-6">
          <SkeletonBar className="h-6 w-72 max-w-full" />
          <SkeletonBar className="mt-4 h-4 w-full max-w-xl" />
          <SkeletonBar className="mt-2 h-4 w-2/3 max-w-lg" />
          <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex items-center gap-4">
              <SkeletonBar className="h-10 w-10 rounded-lg bg-emerald-100" />
              <div className="flex-1 space-y-2">
                <SkeletonBar className="h-4 w-40" />
                <SkeletonBar className="h-3 w-56 max-w-full" />
              </div>
              <SkeletonBar className="hidden h-10 w-20 rounded-lg sm:block" />
            </div>
          </div>
        </div>

        <div className="console-card p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <SkeletonBar className="h-5 w-72 max-w-full" />
              <SkeletonBar className="h-3 w-56 max-w-full" />
            </div>
            <SkeletonBar className="h-5 w-5 rounded-full" />
          </div>
          <div className="mt-5 rounded-lg border border-orange-100 bg-[#f4f4ff] p-4">
            <SkeletonBar className="h-4 w-full bg-orange-100" />
            <SkeletonBar className="mt-3 h-4 w-4/5 bg-orange-100" />
            <SkeletonBar className="mt-3 h-4 w-2/3 bg-orange-100" />
          </div>
          <div className="mt-5 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <SkeletonBar className="h-3 w-28" />
            <SkeletonBar className="mt-4 h-3 w-full" />
            <SkeletonBar className="mt-3 h-3 w-5/6" />
            <SkeletonBar className="mt-3 h-3 w-3/5" />
          </div>
        </div>
      </section>
    </div>
  );
}
