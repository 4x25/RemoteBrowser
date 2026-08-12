export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface StatusBadgeProps {
  status: ConnectionStatus;
  label?: string;
  className?: string;
}

const DEFAULT_LABELS: Record<ConnectionStatus, string> = {
  disconnected: "未连接",
  connecting: "连接中",
  connected: "已连接",
  error: "连接异常",
};

export function StatusBadge({
  status,
  label = DEFAULT_LABELS[status],
  className = "",
}: StatusBadgeProps) {
  const classes = ["rb-status-badge", `rb-status-badge--${status}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} role="status" aria-live="polite">
      <span className="rb-status-badge__dot" aria-hidden="true" />
      <span className="rb-status-badge__label">{label}</span>
    </span>
  );
}
