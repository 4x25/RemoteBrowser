export type ViewportState =
  | "empty"
  | "loading"
  | "ready"
  | "stale"
  | "error"
  | "disconnected";

export interface ViewportStatusProps {
  state: ViewportState;
  hasFrame?: boolean;
  message?: string;
  detail?: string;
  onRetry?: () => void;
}

const DEFAULT_MESSAGES: Record<ViewportState, string> = {
  empty: "选择或新建一个标签页",
  loading: "正在获取远程画面",
  ready: "远程画面已同步",
  stale: "画面可能不是最新状态",
  error: "无法获取远程画面",
  disconnected: "连接 BrowserOS 后开始浏览",
};

export function ViewportStatus({
  state,
  hasFrame = false,
  message = DEFAULT_MESSAGES[state],
  detail,
  onRetry,
}: ViewportStatusProps) {
  if (state === "ready") {
    return (
      <span className="rb-viewport-status rb-viewport-status--ready rb-sr-only" role="status">
        {message}
      </span>
    );
  }

  const blocking = !hasFrame && state !== "stale";
  const classes = [
    "rb-viewport-status",
    `rb-viewport-status--${state}`,
    blocking ? "rb-viewport-status--blocking" : "rb-viewport-status--notice",
  ].join(" ");

  return (
    <div
      className={classes}
      role={state === "error" ? "alert" : "status"}
      aria-live={state === "error" ? "assertive" : "polite"}
    >
      {state === "loading" ? (
        <span className="rb-spinner rb-viewport-status__spinner" aria-hidden="true" />
      ) : (
        <span className="rb-viewport-status__icon" aria-hidden="true">
          <StatusIcon state={state} />
        </span>
      )}
      <div className="rb-viewport-status__content">
        <p className="rb-viewport-status__message">{message}</p>
        {detail ? <p className="rb-viewport-status__detail">{detail}</p> : null}
      </div>
      {onRetry && (state === "error" || state === "stale") ? (
        <button className="rb-button rb-button--secondary" type="button" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

function StatusIcon({ state }: { state: Exclude<ViewportState, "ready" | "loading"> }) {
  if (state === "empty") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3 9h18" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }

  if (state === "disconnected") {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M8.5 15.5 6 18m9.5-9.5L18 6M8 8l8 8M6.5 5.5l12 13" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M12 3.5 21 20H3l9-16.5Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="M12 9v5m0 2.5v.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}
