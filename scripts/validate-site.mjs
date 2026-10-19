import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const htmlPath = path.join(root, "dist", "site.html");
if (!fs.existsSync(htmlPath)) throw new Error("Execute npm run build antes da validação.");
const html = fs.readFileSync(htmlPath, "utf8");
const source = fs.readFileSync(path.join(root, "site.html"), "utf8");
const publishedHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (publishedHtml !== html) throw new Error("index.html publicado não corresponde ao build atual.");

const csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
const sourceCsp = source.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
if (!csp || csp !== sourceCsp) throw new Error("CSP ausente ou diferente da fonte.");
for (const directive of ["default-src 'self'", "script-src 'self'", "script-src-attr 'none'", "object-src 'none'", "form-action 'self'", "frame-src 'none'"]) {
  if (!csp.split(";").some((part) => part.trim() === directive)) throw new Error(`Diretiva CSP ausente: ${directive}`);
}
if (/script-src[^;]*'unsafe-(?:inline|eval)'/.test(csp)) throw new Error("Scripts inline ou eval liberados pela CSP.");
if (/frame-ancestors|report-uri|sandbox/.test(csp)) throw new Error("Diretiva CSP incompatível com meta tag.");
if (/<script\b[^>]*>(?!\s*<\/script>)[\s\S]*?<\/script>/i.test(html)) throw new Error("Script inline encontrado no HTML publicado.");
if (/\son[a-z]+\s*=/i.test(html)) throw new Error("Event handler inline encontrado no HTML publicado.");
if (!/<meta name="referrer" content="no-referrer"/.test(html)) throw new Error("Referrer Policy ausente.");

const assetPaths = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+)"/g)].map((match) => match[1]);
if (!assetPaths.length) throw new Error("Build sem assets referenciados.");
for (const asset of assetPaths) {
  if (!fs.existsSync(path.join(root, "dist", asset))) throw new Error(`Asset ausente: ${asset}`);
  if (!fs.existsSync(path.join(root, asset))) throw new Error(`Asset publicado ausente: ${asset}`);
}
for (const required of ["account.js", "experience.js", "vendor/supabase-2.112.4.min.js", "vendor/qrcode.min.js"]) {
  if (!fs.existsSync(path.join(root, "dist", required))) throw new Error(`Arquivo necessário ausente: ${required}`);
}
const accountSource = fs.readFileSync(path.join(root, "account.js"), "utf8");
if (accountSource !== fs.readFileSync(path.join(root, "public", "account.js"), "utf8") ||
    accountSource !== fs.readFileSync(path.join(root, "dist", "account.js"), "utf8")) {
  throw new Error("Cópias de account.js divergentes; o deploy publicaria código antigo.");
}
const accountCss = fs.readFileSync(path.join(root, "account.css"), "utf8");
if (accountCss !== fs.readFileSync(path.join(root, "public", "account.css"), "utf8") ||
    accountCss !== fs.readFileSync(path.join(root, "dist", "account.css"), "utf8")) {
  throw new Error("Cópias de account.css divergentes; o deploy publicaria estilo antigo.");
}
console.log(`Build válido: CSP, Referrer Policy e ${assetPaths.length} assets verificados.`);
