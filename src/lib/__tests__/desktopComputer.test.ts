import { cleanDesktopArgs } from "@/lib/desktopComputer";

describe("the graphical Linux desktop RPC contract", () => {
  test("accepts only supported actions and validates keyboard events", () => {
    expect(cleanDesktopArgs({ action: "status" })).toEqual({ action: "status" });
    expect(cleanDesktopArgs({ action: "start" })).toEqual({ action: "start" });
    expect(cleanDesktopArgs({ action: "key", key: "alt+Tab" })).toEqual({ action: "key", key: "alt+Tab" });
    expect(cleanDesktopArgs({ action: "key", key: "Return;touch /tmp/x" })).toBeNull();
    expect(cleanDesktopArgs({ action: "rm -rf" })).toBeNull();
  });

  test("clamps mouse coordinates and validates buttons", () => {
    expect(cleanDesktopArgs({ action: "click", x: 99999, y: -12, button: "right" }))
      .toEqual({ action: "click", x: 1599, y: 0, button: "right" });
    expect(cleanDesktopArgs({ action: "move", x: 20.8, y: 40.2 }))
      .toEqual({ action: "move", x: 20, y: 40 });
    expect(cleanDesktopArgs({ action: "click", x: 1, y: 1, button: "shell" })).toBeNull();
    expect(cleanDesktopArgs({ action: "click", x: "not-a-number", y: 1 })).toBeNull();
  });

  test("bounds text, scrolling, browser launch and file/terminal launch", () => {
    const typed = cleanDesktopArgs({ action: "type", text: "x".repeat(5000) });
    expect(String(typed?.text).length).toBe(1200);
    expect(cleanDesktopArgs({ action: "scroll", direction: "up", amount: 99 }))
      .toEqual({ action: "scroll", direction: "up", amount: 8 });
    expect(cleanDesktopArgs({ action: "scroll", direction: "diagonal", amount: 2 })).toBeNull();
    expect(cleanDesktopArgs({ action: "launch", app: "browser", url: "https://example.com" }))
      .toEqual({ action: "launch", app: "browser", url: "https://example.com" });
    expect(cleanDesktopArgs({ action: "launch", app: "terminal" }))
      .toEqual({ action: "launch", app: "terminal" });
    expect(cleanDesktopArgs({ action: "launch", app: "notepad" as any })).toBeNull();
  });
});
