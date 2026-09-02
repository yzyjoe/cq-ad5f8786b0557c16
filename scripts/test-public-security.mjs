const url = "https://lgcvaxjsgymwueacqkec.supabase.co";
const publishableKey = "sb_publishable_Ksi21eNIkJQ6olvOSMAIPQ_4V2jBNWl";

const response = await fetch(`${url}/rest/v1/profiles?select=id`, {
  headers: { apikey: publishableKey }
});

if (response.ok) {
  throw new Error("Visitantes anônimos conseguiram consultar perfis.");
}

if (![401, 403].includes(response.status)) {
  throw new Error(`Resposta inesperada da proteção pública: HTTP ${response.status}`);
}

console.log(`Proteção pública confirmada: HTTP ${response.status}.`);
