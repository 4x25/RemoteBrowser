import { useRef, type KeyboardEvent } from "react";

export type TabId = string | number;

export interface TabStripItem {
  id: TabId;
  title: string;
  url?: string;
  loading?: boolean;
  closing?: boolean;
}

export interface TabStripProps {
  tabs: readonly TabStripItem[];
  activeTabId: TabId | null;
  viewportId?: string;
  busy?: boolean;
  disabled?: boolean;
  onSelect: (tabId: TabId) => void;
  onClose: (tabId: TabId) => void;
  onNew: () => void;
}

export function TabStrip({
  tabs,
  activeTabId,
  viewportId = "remote-browser-viewport",
  busy = false,
  disabled = false,
  onSelect,
  onClose,
  onNew,
}: TabStripProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasSelectedTab = tabs.some((tab) => tab.id === activeTabId);

  const selectFromKeyboard = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    tabRefs.current[index]?.focus();
    onSelect(tab.id);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let targetIndex: number | undefined;

    switch (event.key) {
      case "ArrowLeft":
        targetIndex = (index - 1 + tabs.length) % tabs.length;
        break;
      case "ArrowRight":
        targetIndex = (index + 1) % tabs.length;
        break;
      case "Home":
        targetIndex = 0;
        break;
      case "End":
        targetIndex = tabs.length - 1;
        break;
      case "Delete":
        if (!disabled && tabs[index]) {
          event.preventDefault();
          onClose(tabs[index].id);
        }
        return;
      default:
        return;
    }

    event.preventDefault();
    selectFromKeyboard(targetIndex);
  };

  return (
    <div className="rb-tab-strip" aria-busy={busy || undefined}>
      <div className="rb-tab-strip__scroll">
        <div className="rb-tab-strip__list" role="tablist" aria-label="浏览器标签页">
          {tabs.map((tab, index) => {
            const selected = tab.id === activeTabId;
            const title = tab.title.trim() || "新标签页";

            return (
              <div
                className={`rb-tab-strip__item${selected ? " rb-tab-strip__item--active" : ""}`}
                key={`${typeof tab.id}-${String(tab.id)}`}
              >
                <button
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  className="rb-tab-strip__tab"
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={viewportId}
                  tabIndex={selected || (!hasSelectedTab && index === 0) ? 0 : -1}
                  title={tab.url || title}
                  disabled={disabled || tab.closing}
                  onClick={() => onSelect(tab.id)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                >
                  {tab.loading ? (
                    <span className="rb-spinner rb-spinner--small" aria-label="页面加载中" />
                  ) : (
                    <span className="rb-tab-strip__favicon" aria-hidden="true">
                      <PageIcon />
                    </span>
                  )}
                  <span className="rb-tab-strip__title">{title}</span>
                </button>
                <button
                  className="rb-tab-strip__close"
                  type="button"
                  aria-label={`关闭标签页：${title}`}
                  title="关闭标签页"
                  disabled={disabled || tab.closing}
                  onClick={() => onClose(tab.id)}
                >
                  {tab.closing ? (
                    <span className="rb-spinner rb-spinner--small" aria-hidden="true" />
                  ) : (
                    <CloseIcon />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <button
        className="rb-tab-strip__new"
        type="button"
        aria-label="新建标签页"
        title="新建标签页"
        disabled={disabled || busy}
        onClick={onNew}
      >
        <PlusIcon />
      </button>
      {busy ? <span className="rb-tab-strip__busy rb-sr-only">正在同步标签页</span> : null}
    </div>
  );
}

function PageIcon() {
  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" />
      <path d="M3 6h10M6.5 3v3" fill="none" stroke="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
      <path d="m4.5 4.5 7 7m0-7-7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
      <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}
