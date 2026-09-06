type SkeletonVariant = "table" | "cards" | "inline" | "page";

export function WorkspaceLoadingSkeleton({ variant = "table", rows = 5 }: { variant?: SkeletonVariant; rows?: number }) {
  if (variant === "cards") {
    return <div className="workspace-skeleton workspace-skeleton-cards" role="status" aria-label="Өгөгдөл ачаалж байна">
      {Array.from({ length: 9 }, (_, index) => <div className="workspace-skeleton-card" key={index}><i /><b /><small /></div>)}
      <span className="workspace-skeleton-announcement">Өгөгдөл ачаалж байна</span>
    </div>;
  }
  if (variant === "inline") return <span className="workspace-skeleton workspace-skeleton-inline" role="status" aria-label="Өгөгдөл ачаалж байна"><i /><span className="workspace-skeleton-announcement">Өгөгдөл ачаалж байна</span></span>;
  if (variant === "page") return <div className="workspace-skeleton workspace-skeleton-page" role="status" aria-label="Өгөгдөл ачаалж байна"><i /><i /><i /><span className="workspace-skeleton-announcement">Өгөгдөл ачаалж байна</span></div>;
  return <div className="workspace-skeleton workspace-skeleton-table" role="status" aria-label="Өгөгдөл ачаалж байна">
    {Array.from({ length: rows }, (_, row) => <div className="workspace-skeleton-row" key={row}>{Array.from({ length: 6 }, (_, column) => <i key={column} />)}</div>)}
    <span className="workspace-skeleton-announcement">Өгөгдөл ачаалж байна</span>
  </div>;
}
