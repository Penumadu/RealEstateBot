import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, "../../forms/templates");

const PDFTOPPM = "/nix/store/inqkj79vydizl6ja0d8af99qlxbmyr84-replit-runtime-path/bin/pdftoppm";

export type RenderedPage = {
  pngBytes: Buffer;
  width: number;  // in PDF points (at 72dpi, 1px = 1pt)
  height: number;
};

/**
 * Renders all pages of a template PDF to PNG images at 72 DPI
 * (so 1 pixel = 1 PDF point, allowing direct coordinate mapping).
 */
export async function renderTemplatePages(formFilename: string): Promise<RenderedPage[]> {
  const inputPath = path.join(TEMPLATES_DIR, formFilename);
  if (!fs.existsSync(inputPath)) return [];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orea-"));
  const outPrefix = path.join(tmpDir, "page");

  try {
    await execFileAsync(PDFTOPPM, [
      "-r", "72",   // 72 DPI = 1px per point
      "-png",
      inputPath,
      outPrefix,
    ]);

    const files = fs.readdirSync(tmpDir)
      .filter(f => f.endsWith(".png"))
      .sort();

    const pages: RenderedPage[] = [];
    for (const file of files) {
      const pngBytes = fs.readFileSync(path.join(tmpDir, file));
      // Parse PNG dimensions from header (bytes 16-24)
      const width = pngBytes.readUInt32BE(16);
      const height = pngBytes.readUInt32BE(20);
      pages.push({ pngBytes, width, height });
    }
    return pages;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
