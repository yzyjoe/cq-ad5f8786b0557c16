import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString("utf8").split("\0").filter(Boolean);
const sensitivePaths = /(^|\/)(?:\.env(?:\..*)?|id_(?:rsa|ed25519)|[^/]+\.(?:pem|p12|pfx|key|sqlite|db))$/i;
const secretPatterns = [
  /sb_secret_[A-Za-z0-9_-]{12,}/,
  /(?:sk_live|rk_live|pk_live)_[A-Za-z0-9]{12,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const personalFixturePatterns = [
  /LZ\d{9}CN/,
  /P\d{12}/,
  /O\d{12}/,
];
const textExtensions = new Set([".html", ".js", ".mjs", ".ts", ".tsx", ".json", ".sql", ".yml", ".yaml", ".css", ".md"]);
const failures = [];
const published = [];
const distRoot = path.join(root, "dist");
if (fs.existsSync(distRoot)) {
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else published.push(path.relative(root, absolute));
    }
  };
  walk(distRoot);
}
for (const relative of [...new Set([...tracked, ...published])]) {
  const normalized = relative.replaceAll("\\", "/");
  if (sensitivePaths.test(normalized)) failures.push(`${normalized}: arquivo sensível versionado`);
  if (!textExtensions.has(path.extname(normalized).toLowerCase())) continue;
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) continue;
  const content = fs.readFileSync(absolute, "utf8");
  if (secretPatterns.some((pattern) => pattern.test(content))) failures.push(`${normalized}: possível segredo privado`);
  if (personalFixturePatterns.some((pattern) => pattern.test(content))) failures.push(`${normalized}: dados reais de pedido embutidos`);
}
if (failures.length) throw new Error(`Publicação bloqueada:\n${failures.join("\n")}`);
console.log(`Varredura local aprovada em ${tracked.length} arquivos versionados e ${published.length} arquivos de build.`);
