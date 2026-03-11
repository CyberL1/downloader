import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { pipeline } from "stream";
import { promisify } from "util";

const streamPipeline = promisify(pipeline);

async function downloadFile(url: string, filePath: string) {
  if (existsSync(filePath)) {
    console.warn(filePath, "already exists, skipping");
    return;
  }

  if (!existsSync(dirname(filePath))) {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Failed to download ${url}: ${response.statusText}`);
    return;
  }

  const fileStream = createWriteStream(filePath);
  await streamPipeline(response.body!, fileStream);

  console.log("Downloaded:", url);
}

const guildedMainPage = await (await fetch("https://www.guilded.gg")).text();
const bundleMatch = /<script[^>]*src="(.+?\/bundle\.js)"/.exec(guildedMainPage);

if (!bundleMatch) {
  throw new Error("Could not find bundle script");
}

const BUNDLE_SCRIPT_URL = bundleMatch[1];

const bundleText = await (
  await fetch(`https://www.guilded.gg${BUNDLE_SCRIPT_URL}`)
).text();

const BUNDLE_ID = BUNDLE_SCRIPT_URL.replace("/bundle.js", "");

if (!existsSync("CURRENT_BUNDLE_ID.txt")) {
  writeFileSync("CURRENT_BUNDLE_ID.txt", "");
}

const CURRENT_BUNDLE_ID = readFileSync("CURRENT_BUNDLE_ID.txt").toString();

if (BUNDLE_ID === CURRENT_BUNDLE_ID) {
  console.error("BUNDLE_ID is identical to CURRENT_BUNDLE_ID, exiting");
  process.exit(1);
}

const clientDir = join("client", BUNDLE_ID);
mkdirSync(clientDir, { recursive: true });

await downloadFile(
  `https://www.guilded.gg/index.html`,
  join(clientDir, "index.html"),
);

await downloadFile(
  `https://www.guilded.gg/bundle.js`,
  join(clientDir, "bundle.js"),
);

await downloadFile(
  `https://www.guilded.gg${BUNDLE_ID}/bundle.js`,
  join(clientDir, BUNDLE_ID, "bundle.js"),
);

const scriptsBlock = bundleText.match(/\{return o.p\+""\+\(\{.+?\}/)?.[0];

if (!scriptsBlock) {
  throw new Error("Could not locate scripts block");
}

const scriptAssets = scriptsBlock.matchAll(/\b(?<key>\d+):"(?<asset>[^"]+)"/g);

for (const match of scriptAssets) {
  if (!match.groups) {
    throw new Error("no math groups for some reason");
  }

  const asset = match.groups.asset;

  await downloadFile(
    `https://www.guilded.gg${BUNDLE_ID}/${asset}.js`,
    join(clientDir, BUNDLE_ID, asset + ".js"),
  );
}

const allScripts = readdirSync(join(clientDir, BUNDLE_ID));
const allScriptsContents: string[] = [];

for (const script of allScripts) {
  const content = readFileSync(join(clientDir, BUNDLE_ID, script), "utf8");
  allScriptsContents.push(content);
}

const otherAssets = allScriptsContents
  .flatMap((c) => {
    const matches = c.match(/"\/asset\/[^"?]+/g) || [];

    // Break multi-DPI srcsets into separate entries
    return matches.flatMap((m) =>
      [...m.matchAll(/"?(\/asset\/[^ ,]+)/g)].map((x) => x[1]),
    );
  })
  .filter((v, i, a) => a.indexOf(v) === i);

for (const asset of otherAssets) {
  const assetPath = join(clientDir, asset);

  if (!asset.endsWith("/")) {
    await downloadFile(`https://www.guilded.gg${asset}`, assetPath);
  }
}

const fonts = allScriptsContents
  .flatMap((c) => {
    const matches = c.match(/\/fonts\/[^)]+/g) || [];

    // Break multi-DPI srcsets into separate entries
    return matches.flatMap((m) =>
      [...m.matchAll(/"?(\/fonts\/[^ )]+)/g)].map((x) => x[1]),
    );
  })
  .filter((v, i, a) => a.indexOf(v) === i);

for (const asset of fonts) {
  const assetPath = join(clientDir, asset);

  if (!asset.endsWith("/")) {
    await downloadFile(`https://www.guilded.gg${asset}`, assetPath);
  }
}

writeFileSync("CURRENT_BUNDLE_ID.txt", BUNDLE_ID);
