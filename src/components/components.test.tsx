import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionDialog } from "./ConnectionDialog";
import { TabStrip } from "./TabStrip";
import { Toolbar } from "./Toolbar";
import { ViewportStatus } from "./ViewportStatus";

afterEach(cleanup);

describe("ConnectionDialog", () => {
  it("only renders while open and submits a trimmed in-memory endpoint", () => {
    const onConnect = vi.fn();
    const { rerender } = render(
      <ConnectionDialog
        open={false}
        endpoint=""
        onEndpointChange={vi.fn()}
        onConnect={onConnect}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <ConnectionDialog
        open
        endpoint="  http://127.0.0.1:3000/mcp  "
        onEndpointChange={vi.fn()}
        onConnect={onConnect}
      />,
    );

    fireEvent.submit(screen.getByRole("button", { name: "连接浏览器" }).closest("form")!);
    expect(onConnect).toHaveBeenCalledWith("http://127.0.0.1:3000/mcp");
  });

  it("reports connection errors accessibly", () => {
    render(
      <ConnectionDialog
        open
        endpoint="http://localhost:3000/mcp"
        error="服务不可用"
        onEndpointChange={vi.fn()}
        onConnect={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("服务不可用");
    expect(screen.getByLabelText("MCP 地址").getAttribute("aria-invalid")).toBe("true");
  });

  it("lets keyboard users dismiss the reconnect dialog", () => {
    const onCancel = vi.fn();
    render(
      <ConnectionDialog
        open
        mode="reconnect"
        endpoint="http://localhost:3000/mcp"
        onEndpointChange={vi.fn()}
        onConnect={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("switches between the BrowserOS MCP and CDP connection options", () => {
    const onTransportChange = vi.fn();
    const { rerender } = render(
      <ConnectionDialog
        open
        transport="browseros"
        endpoint=""
        onTransportChange={onTransportChange}
        onEndpointChange={vi.fn()}
        onConnect={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "连接 BrowserOS" })).not.toBeNull();
    expect(screen.getByRole("radio", { name: "BrowserOS MCP" })).toBeChecked();
    expect(screen.getByLabelText("MCP 地址").getAttribute("placeholder")).toBe(
      "http://127.0.0.1:9000/mcp",
    );

    fireEvent.click(screen.getByRole("radio", { name: "CDP" }));
    expect(onTransportChange).toHaveBeenCalledWith("cdp");

    rerender(
      <ConnectionDialog
        open
        transport="cdp"
        endpoint=""
        onTransportChange={onTransportChange}
        onEndpointChange={vi.fn()}
        onConnect={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "连接 CDP" })).not.toBeNull();
    expect(screen.getByRole("radio", { name: "CDP" })).toBeChecked();
    expect(screen.getByLabelText("CDP 地址").getAttribute("placeholder")).toContain(
      "ws://127.0.0.1:9222",
    );
    expect(
      screen.getByRole("button", { name: "连接浏览器" }).closest("form")
        ?.querySelector("input")?.getAttribute("name"),
    ).toBe("cdp-endpoint");
  });
});

describe("TabStrip", () => {
  const tabs = [
    { id: "one", title: "第一页", url: "https://one.example" },
    { id: "two", title: "第二页", url: "https://two.example" },
  ] as const;

  it("supports selection, closing, creation and arrow-key navigation", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const onNew = vi.fn();

    render(
      <TabStrip
        tabs={tabs}
        activeTabId="one"
        onSelect={onSelect}
        onClose={onClose}
        onNew={onNew}
      />,
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: /第一页/ }), {
      key: "ArrowRight",
    });
    expect(onSelect).toHaveBeenCalledWith("two");

    fireEvent.click(screen.getByRole("button", { name: "关闭标签页：第二页" }));
    expect(onClose).toHaveBeenCalledWith("two");

    fireEvent.click(screen.getByRole("button", { name: "新建标签页" }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("keeps creation independent from background syncing and shows progress", () => {
    const onNew = vi.fn();
    const { container, rerender } = render(
      <TabStrip
        tabs={tabs}
        activeTabId="one"
        busy
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={onNew}
      />,
    );

    const newButton = screen.getByRole("button", { name: "新建标签页" });
    expect(newButton).toBeEnabled();
    expect(newButton.closest(".rb-tab-strip__track")).not.toBeNull();
    expect(
      newButton.previousElementSibling?.getAttribute("role"),
    ).toBe("tablist");

    rerender(
      <TabStrip
        tabs={tabs}
        activeTabId="one"
        creating
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={onNew}
      />,
    );

    expect(newButton).toBeDisabled();
    expect(newButton).toHaveAttribute("aria-busy", "true");
    expect(newButton.querySelector(".rb-spinner--small")).not.toBeNull();
    expect(container.querySelector(".rb-tab-strip__new svg")).toBeNull();
    fireEvent.click(newButton);
    expect(onNew).not.toHaveBeenCalled();
  });
});

describe("Toolbar", () => {
  it("submits addresses while honoring navigation availability", () => {
    const onNavigate = vi.fn();
    const onBack = vi.fn();

    render(
      <Toolbar
        address=" example.com "
        connectionStatus="connected"
        canGoBack={false}
        canGoForward
        onAddressChange={vi.fn()}
        onNavigate={onNavigate}
        onBack={onBack}
        onForward={vi.fn()}
        onRefresh={vi.fn()}
        onConnectionClick={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "后退" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("search"));
    expect(onNavigate).toHaveBeenCalledWith("example.com");
  });

  it("keeps an accessible connection label separate from its compact icon", () => {
    render(
      <Toolbar
        address=""
        connectionStatus="connected"
        onAddressChange={vi.fn()}
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        onForward={vi.fn()}
        onRefresh={vi.fn()}
        onConnectionClick={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "切换连接" });
    expect(button.querySelector(".rb-browser-toolbar__connection-label"))
      .toHaveTextContent("切换连接");
    expect(button.querySelector(".rb-browser-toolbar__connection-menu"))
      .toHaveAttribute("aria-hidden", "true");
  });
});

describe("ViewportStatus", () => {
  it("keeps a stale frame non-blocking and offers retry", () => {
    const onRetry = vi.fn();
    const { container } = render(
      <ViewportStatus state="stale" hasFrame detail="最后一帧仍可操作" onRetry={onRetry} />,
    );

    expect(container.querySelector(".rb-viewport-status--notice")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
