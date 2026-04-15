import { afterEach, describe, expect, it, vi } from "vitest";

const { existsSyncMock, statSyncMock, spawnMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: existsSyncMock,
  statSync: statSyncMock,
}));

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

import { openFolderInExplorerForFile } from "../../../src/utils/openFolder";

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", {
    value: platform,
  });
}

afterEach(() => {
  setPlatform(originalPlatform);
  vi.clearAllMocks();
});

describe("openFolderInExplorerForFile", () => {
  it("returns invalid path for empty input", () => {
    const result = openFolderInExplorerForFile("");
    expect(result).toEqual({ ok: false, detail: "Invalid path" });
  });

  it("returns file not found when path does not exist", () => {
    existsSyncMock.mockReturnValue(false);

    const result = openFolderInExplorerForFile("C:/tmp/video.mp4");

    expect(result).toEqual({ ok: false, detail: "File not found" });
  });

  it("returns not a file when stat is directory", () => {
    existsSyncMock.mockReturnValue(true);
    statSyncMock.mockReturnValue({ isFile: () => false });

    const result = openFolderInExplorerForFile("C:/tmp/video.mp4");

    expect(result).toEqual({ ok: false, detail: "Path is not a file" });
  });

  it("returns path not allowed when outside allowed roots", () => {
    existsSyncMock.mockReturnValue(true);
    statSyncMock.mockReturnValue({ isFile: () => true });

    const result = openFolderInExplorerForFile("C:/outside/video.mp4", ["C:/allowed"]);

    expect(result).toEqual({ ok: false, detail: "Path not allowed" });
  });

  it("opens explorer on win32 for allowed file", () => {
    setPlatform("win32");
    existsSyncMock.mockReturnValue(true);
    statSyncMock.mockReturnValue({ isFile: () => true });

    const unrefMock = vi.fn();
    spawnMock.mockReturnValue({ unref: unrefMock });

    const result = openFolderInExplorerForFile("C:/allowed/video.mp4", ["C:/allowed"]);

    expect(result).toEqual({ ok: true });
    expect(spawnMock).toHaveBeenCalledWith(
      "explorer.exe",
      ["/select,", expect.stringContaining("video.mp4")],
      expect.objectContaining({ detached: true }),
    );
    expect(unrefMock).toHaveBeenCalledTimes(1);
  });

  it("returns unsupported message on non-windows", () => {
    setPlatform("linux");
    existsSyncMock.mockReturnValue(true);
    statSyncMock.mockReturnValue({ isFile: () => true });

    const result = openFolderInExplorerForFile("/tmp/video.mp4", ["/tmp"]);

    expect(result).toEqual({ ok: false, detail: "Open Folder is only supported on Windows" });
  });
});
