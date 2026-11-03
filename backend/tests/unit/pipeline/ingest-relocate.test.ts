import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { relocateDownloadDirectory } from "../../../src/pipeline/ingest/downloaded";

describe("relocateDownloadDirectory", () => {
  let root = "";

  afterEach(() => {
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("renames the download directory when the title folder does not exist yet", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-relocate-"));
    const source = path.join(root, "job-id");
    const target = path.join(root, "My Title");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "video.mp4"), "video");
    fs.writeFileSync(path.join(source, "video.mp4.info.json"), "{}");

    relocateDownloadDirectory(source, target);

    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(path.join(target, "video.mp4"), "utf-8")).toBe("video");
  });

  it("moves files into a title folder that already exists", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-relocate-"));
    const source = path.join(root, "job-id");
    const target = path.join(root, "My Title");
    fs.mkdirSync(source);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(source, "video.mp4"), "video");
    fs.writeFileSync(path.join(target, "notes.txt"), "keep");

    relocateDownloadDirectory(source, target);

    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(path.join(target, "video.mp4"), "utf-8")).toBe("video");
    expect(fs.readFileSync(path.join(target, "notes.txt"), "utf-8")).toBe("keep");
  });
});
