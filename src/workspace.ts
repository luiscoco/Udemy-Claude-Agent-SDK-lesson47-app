import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { resolve, join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { FILES } from "./settings.js";
export const FIXTURES = [
  "Catalog: Public items can be listed. Classroom policy code CATALOG-47.",
  "Orders: Only authenticated customers may create an order. Classroom policy code ORDERS-47. CLASSROOM-CONTENT-47: This is a fictional teaching note.",
  "Billing: Invoice access requires its owner. Classroom policy code BILLING-47.",
];
export async function prepareWorkspace() {
  const parent = resolve(realpathSync.native(tmpdir()), "claude-sdk47"),
    root = resolve(parent, randomUUID());
  const safe = () => {
    const r = relative(parent, root);
    if (!r || r.startsWith("..") || isAbsolute(r))
      throw new Error("Invalid classroom workspace.");
  };
  safe();
  const cwd = join(root, "project"),
    home = join(root, "home"),
    sdkHome = join(root, "sdk");
  for (const p of [join(cwd, "notes"), home, sdkHome])
    await mkdir(p, { recursive: true });
  for (const [i, file] of FILES.entries())
    await writeFile(join(cwd, file), FIXTURES[i]);
  return {
    cwd,
    home,
    sdkHome,
    async snapshot() {
      const files = await Promise.all(
        FILES.map(async (file) => ({
          file,
          text: await readFile(join(cwd, file), "utf8"),
        })),
      );
      return {
        files,
        hash: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
      };
    },
    async cleanup() {
      safe();
      await rm(root, { recursive: true, force: true });
    },
  };
}
