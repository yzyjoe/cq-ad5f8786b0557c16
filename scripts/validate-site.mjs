import fs from "node:fs";

const source = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const inlineScripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .filter((script) => script.trim());

inlineScripts.forEach((script) => new Function(script));

const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

if (duplicates.length) {
  throw new Error(`IDs duplicados: ${duplicates.join(", ")}`);
}

for (const required of ["accountArea", "authDialog", "homeAccountButton", "navAccountButton"]) {
  if (!ids.includes(required)) throw new Error(`Elemento obrigatório ausente: ${required}`);
}

console.log(`Site válido: ${inlineScripts.length} script inline e ${ids.length} IDs únicos.`);
