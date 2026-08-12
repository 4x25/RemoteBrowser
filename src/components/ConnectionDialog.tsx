import { useId, type FormEvent } from "react";

export interface ConnectionDialogProps {
  open: boolean;
  endpoint: string;
  connecting?: boolean;
  error?: string | null;
  mode?: "initial" | "reconnect";
  onEndpointChange: (endpoint: string) => void;
  onConnect: (endpoint: string) => void;
  onCancel?: () => void;
}

export function ConnectionDialog({
  open,
  endpoint,
  connecting = false,
  error,
  mode = "initial",
  onEndpointChange,
  onConnect,
  onCancel,
}: ConnectionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();

  if (!open) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onConnect(endpoint.trim());
  };

  const describedBy = error
    ? `${descriptionId} ${errorId}`
    : descriptionId;

  return (
    <div className="rb-connection-dialog-backdrop">
      <section
        className="rb-connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            mode === "reconnect" &&
            onCancel &&
            !connecting
          ) {
            event.preventDefault();
            onCancel();
          }
        }}
      >
        <div className="rb-connection-dialog__mark" aria-hidden="true">
          <BrowserMark />
        </div>
        <div className="rb-connection-dialog__heading">
          <p className="rb-connection-dialog__eyebrow">Remote Browser</p>
          <h1 id={titleId}>
            {mode === "initial" ? "连接 BrowserOS" : "切换 BrowserOS 连接"}
          </h1>
          <p id={descriptionId} className="rb-connection-dialog__description">
            输入完整的 MCP HTTP 地址。地址只会保存在当前页面内存中，刷新后需要重新输入。
          </p>
        </div>

        <form className="rb-connection-dialog__form" onSubmit={handleSubmit}>
          <label htmlFor={`${titleId}-endpoint`}>MCP 地址</label>
          <input
            id={`${titleId}-endpoint`}
            className="rb-connection-dialog__input"
            type="url"
            inputMode="url"
            name="browseros-mcp-endpoint"
            value={endpoint}
            placeholder="http://127.0.0.1:9000/mcp"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
            disabled={connecting}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            onChange={(event) => onEndpointChange(event.currentTarget.value)}
          />

          {error ? (
            <p id={errorId} className="rb-connection-dialog__error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="rb-connection-dialog__actions">
            {mode === "reconnect" && onCancel ? (
              <button
                className="rb-button rb-button--secondary"
                type="button"
                disabled={connecting}
                onClick={onCancel}
              >
                取消
              </button>
            ) : null}
            <button
              className="rb-button rb-button--primary"
              type="submit"
              disabled={connecting || endpoint.trim().length === 0}
            >
              {connecting ? (
                <>
                  <Spinner />
                  正在连接
                </>
              ) : mode === "initial" ? (
                "连接浏览器"
              ) : (
                "重新连接"
              )}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function BrowserMark() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 9h18" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="6.5" cy="6.5" r=".8" fill="currentColor" />
      <circle cx="9.5" cy="6.5" r=".8" fill="currentColor" />
      <path d="m10 15 2 2 3.5-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function Spinner() {
  return <span className="rb-spinner" aria-hidden="true" />;
}
