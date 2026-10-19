import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const LOGO = join(ROOT, "public", "logo-transparent.png");
const CREAM = { r: 248, g: 243, b: 237, alpha: 1 };

async function squarePng(size: number, padRatio: number): Promise<Buffer> {
  const pad = Math.round(size * padRatio);
  const inner = Math.max(size - pad * 2, 1);
  const logo = await sharp(LOGO)
    .resize(inner, inner, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: CREAM,
    },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toBuffer();
}

function pngToIco(images: Array<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const entries: Buffer[] = [];
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

async function write(path: string, data: Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  process.stdout.write(`wrote ${path} (${data.length} bytes)\n`);
}

async function main() {
  const icon192 = await squarePng(192, 0.14);
  const icon512 = await squarePng(512, 0.14);
  const apple = await squarePng(180, 0.14);
  const maskable = await squarePng(512, 0.22);
  const fav32 = await squarePng(32, 0.12);
  const fav48 = await squarePng(48, 0.12);
  const ico = pngToIco([
    { size: 32, png: fav32 },
    { size: 48, png: fav48 },
  ]);

  await write(join(ROOT, "public", "icons", "icon-192.png"), icon192);
  await write(join(ROOT, "public", "icons", "icon-512.png"), icon512);
  await write(join(ROOT, "public", "icons", "icon-maskable-512.png"), maskable);
  await write(join(ROOT, "public", "icons", "apple-touch-icon.png"), apple);
  await write(join(ROOT, "public", "icon-192.png"), icon192);
  await write(join(ROOT, "public", "icon-512.png"), icon512);
  await write(join(ROOT, "public", "apple-touch-icon.png"), apple);
  await write(join(ROOT, "public", "favicon.ico"), ico);
  await write(join(ROOT, "src", "app", "favicon.ico"), ico);
  await write(join(ROOT, "src", "app", "icon.png"), icon512);
  await write(join(ROOT, "src", "app", "apple-icon.png"), apple);

  const og = await sharp(join(ROOT, "public", "meskahphoto.png"))
    .resize(1200, 630, { fit: "cover", position: "centre" })
    .jpeg({ quality: 86 })
    .toBuffer();
  await write(join(ROOT, "public", "og-image.jpg"), og);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
