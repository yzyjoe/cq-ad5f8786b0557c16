"use client";

import { useEffect, useRef, useState } from "react";
import { calculateQuote, EXCHANGE_RATE, MAX_CART_WEIGHT_GRAMS } from "./pricing";
import { createPaymentReference, createPixPayload, paymentLinkHash, readPaymentLink, type PaymentLinkData } from "./pix";

type Route = "home" | "shop" | "how" | "tracking" | "account";

type Product = {
  id: string;
  name: string;
  sku: string;
  price: number;
  cny: number;
  image: string;
  tone: string;
  qc: string[];
  category: "apparel" | "sneakers";
  weightGrams: number;
  description: string;
  editorial?: string[];
};

type PurchaseStep = "select" | "review" | "payment";

type TrackingEvent = {
  statusKey: string;
  statusPt: string;
  statusAt: string;
};

type TrackingOrder = {
  code: string;
  product: string;
  model: string;
  image: string | null;
  shippingCode?: string;
  trackingNote?: string;
  statusKey: string;
  statusPt: string;
  statusAt: string;
  history: TrackingEvent[];
  shippingDetails?: {
    parcel: string;
    method: string;
    shippingPrice: string;
    totalPrice: string;
    insuredAmount: string;
    declaration: string;
  };
};

const UNIT_CNY = 143;
const UNIT_BRL = UNIT_CNY / EXCHANGE_RATE;

const qcPhotos = (sku: string, count: number) => Array.from({ length: count }, (_, index) => `./qc/${sku.toLowerCase()}-${index + 1}.webp`);

const products: Product[] = [
  { id: "tech-jacket", name: "Nike Tech Fleece 2025 · Jaqueta Windrunner Color-Block", sku: "IF1325-010", price: 255 / EXCHANGE_RATE, cny: 255, image: "./catalog/nike-tech-jacket-front-enhanced.png", tone: "PRETO / ANTRACITE", qc: [], category: "apparel", weightGrams: 650, description: "Jaqueta com zíper completo em preto e antracite. Informe o tamanho antes de gerar o Pix.", editorial: ["./catalog/nike-tech-jacket-front.jpg", "./catalog/nike-tech-jacket-back.jpg", "./catalog/nike-tech-jacket-angle.jpg", "./catalog/nike-tech-look-motion.jpg"] },
  { id: "tech-pants", name: "Nike Tech Fleece 2025 · Calça Open-Hem Color-Block", sku: "IF1323-010", price: 245 / EXCHANGE_RATE, cny: 245, image: "./catalog/nike-tech-pants-detail-enhanced.png", tone: "PRETO / ANTRACITE", qc: [], category: "apparel", weightGrams: 550, description: "Calça de bainha aberta com ajuste na barra. Informe o tamanho antes de gerar o Pix.", editorial: ["./catalog/nike-tech-pants-detail.jpg", "./catalog/nike-tech-look-front.jpg", "./catalog/nike-tech-look-motion.jpg"] },
  { id: "bone", name: "Yeezy Boost 350 V2 Bone", sku: "HQ6316", price: UNIT_BRL, cny: UNIT_CNY, image: "./catalog/hq6316-bone.png", tone: "CREAM", qc: qcPhotos("HQ6316", 6), category: "sneakers", weightGrams: 704, description: "Seleção de tênis com fotos de QC disponíveis na galeria." },
  { id: "mx-oat", name: "Yeezy Boost 350 V2 MX Oat", sku: "GW3773", price: UNIT_BRL, cny: UNIT_CNY, image: "./catalog/gw3773-mx-oat.png", tone: "MULTI", qc: qcPhotos("GW3773", 6), category: "sneakers", weightGrams: 704, description: "Seleção de tênis com fotos de QC disponíveis na galeria." },
  { id: "butter", name: "Yeezy Boost 350 V2 Butter", sku: "F36980", price: UNIT_BRL, cny: UNIT_CNY, image: "./catalog/f36980-butter.png", tone: "YELLOW", qc: qcPhotos("F36980", 6), category: "sneakers", weightGrams: 704, description: "Seleção de tênis com fotos de QC disponíveis na galeria." },
  { id: "onyx", name: "Yeezy Boost 350 V2 Onyx", sku: "HQ4540", price: UNIT_BRL, cny: UNIT_CNY, image: "./catalog/hq4540-onyx.png", tone: "ONYX", qc: qcPhotos("HQ4540", 6), category: "sneakers", weightGrams: 704, description: "Seleção de tênis com fotos de QC disponíveis na galeria." },
  { id: "mx-rock", name: "Yeezy Boost 350 V2 MX Rock", sku: "GW3774", price: UNIT_BRL, cny: UNIT_CNY, image: "./catalog/gw3774-mx-rock.png", tone: "DARK", qc: qcPhotos("GW3774", 6), category: "sneakers", weightGrams: 704, description: "Seleção de tênis com fotos de QC disponíveis na galeria." },
  { id: "yecheil", name: "Yeezy Boost 350 V2 Yecheil", sku: "FW5190", price: UNIT_BRL, cny: UNIT_CNY, image: "./catalog/fw5190-yecheil.png", tone: "MULTI", qc: qcPhotos("FW5190", 7), category: "sneakers", weightGrams: 704, description: "Seleção de tênis com fotos de QC disponíveis na galeria." },
];

const routeLabels: Record<Route, string> = {
  home: "Início",
  shop: "Comprar",
  how: "Como funciona",
  tracking: "Rastrear",
  account: "Minha conta",
};

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.readOnly = true;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  }
}

function PixQr({ payload }: { payload: string }) {
  const target = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    if (!target.current || !payload) return;
    const QrCode = (window as typeof window & { QRCode?: new (element: HTMLElement, options: { text: string; width: number; height: number; colorDark: string; colorLight: string }) => unknown }).QRCode;
    target.current.replaceChildren();
    if (!QrCode) { setAvailable(false); return; }
    new QrCode(target.current, { text: payload, width: 226, height: 226, colorDark: "#071011", colorLight: "#ffffff" });
    setAvailable(true);
  }, [payload]);
  return <div className="pix-qr-shell"><div className="pix-qr" ref={target} aria-label="QR Code Pix para pagar no aplicativo bancário" />{!available && <p>QR Code indisponível. Use o Pix Copia e Cola ao lado.</p>}</div>;
}

function Brand() {
  return (
    <button className="brand" data-route="home" aria-label="Ir para o início">
      <img src="./favicon.png" alt="" />
      <span>KICKNITY</span>
    </button>
  );
}

const trackingStatusLabels: Record<string, string> = {
  submitted: "Pedido recebido",
  accepted: "Em atendimento",
  purchased: "Produto comprado",
  logistics: "Transportadora identificada",
  warehouse: "Produto no armazém",
  shipped: "Pedido enviado",
  delivered: "Pedido entregue",
  cancelled: "Pedido cancelado",
  parcel_submitted: "Pacote registrado",
  parcel_paid: "Pagamento confirmado",
  parcel_packaged: "Pacote embalado",
  tracking_registered: "Rastreio gerado",
  carrier_pending: "Aguardando transportadora",
  cpf_linked: "CPF vinculado",
  china_post_received: "Recebido pela China Post",
  posted_correios: "Objeto postado",
};

function shortTrackingDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [, month, day] = value.split("-");
    return `${day}/${month}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
        .format(date)
        .replace(",", "");
}

function fullTrackingDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function applyKnownTrackingUpdate(order: TrackingOrder): TrackingOrder {
  if (order.code.toUpperCase() !== "O260901502091") return order;
  const warehouseEvent: TrackingEvent = {
    statusKey: "warehouse",
    statusPt: "Seu produto chegou ao armazém da CSSBuy e está passando pela inspeção de qualidade.",
    statusAt: "2026-09-04T13:19:33+00:00",
  };
  const parcelEvent: TrackingEvent = {
    statusKey: "warehouse",
    statusPt: "Pacote P260907637637 criado para envio internacional via BJ-EUB (0–2 kg).",
    statusAt: "2026-09-06T12:00:00-03:00",
  };
  const shippingEvents: TrackingEvent[] = [
    { statusKey: "parcel_submitted", statusPt: "Pacote enviado para processamento.", statusAt: "2026-09-07T07:04:16-03:00" },
    { statusKey: "parcel_paid", statusPt: "Pagamento do pacote confirmado.", statusAt: "2026-09-07T07:04:32-03:00" },
    { statusKey: "parcel_packaged", statusPt: "Pacote embalado e preparado para envio.", statusAt: "2026-09-07T11:57:14-03:00" },
    { statusKey: "tracking_registered", statusPt: "As informações eletrônicas da remessa foram recebidas.", statusAt: "2026-09-07T11:57:17-03:00" },
    { statusKey: "shipped", statusPt: "O pacote saiu do armazém da CSSBuy.", statusAt: "2026-09-07T17:55:26-03:00" },
    { statusKey: "carrier_pending", statusPt: "Este é o seu código de rastreio: LZ458955736CN. As informações serão atualizadas quando o pacote chegar à transportadora, o que normalmente leva de 3 a 5 dias. Agradecemos a sua paciência.", statusAt: "2026-09-09" },
    { statusKey: "posted_correios", statusPt: "O objeto foi postado e já aparece no aplicativo dos Correios.", statusAt: "2026-09-11" },
    { statusKey: "china_post_received", statusPt: "Pequim, China — a China Post recebeu o objeto.", statusAt: "2026-09-11" },
    { statusKey: "cpf_linked", statusPt: "O CPF do destinatário foi vinculado ao pacote com sucesso.", statusAt: "2026-09-11" },
  ];
  let history = order.history || [];
  if (!history.some((event) => event.statusKey === "warehouse")) history = [...history, warehouseEvent];
  if (!history.some((event) => event.statusPt.includes("P260907637637"))) history = [...history, parcelEvent];
  shippingEvents.forEach((shipmentEvent) => {
    if (!history.some((event) => event.statusKey === shipmentEvent.statusKey)) history = [...history, shipmentEvent];
  });
  const latest = shippingEvents.find((event) => event.statusKey === "posted_correios")!;
  return {
    ...order,
    shippingCode: "LZ458955736CN",
    trackingNote: "O código está ativo no aplicativo dos Correios e o CPF do destinatário foi vinculado ao pacote com sucesso.",
    statusKey: latest.statusKey,
    statusPt: latest.statusPt,
    statusAt: latest.statusAt,
    history,
    shippingDetails: {
      parcel: "P260907637637",
      method: "BJ-EUB (0–2 kg)",
      shippingPrice: "¥148,10",
      totalPrice: "¥167,39",
      insuredAmount: "¥278,17",
      declaration: "Tênis unissex branco, tamanho 45, material: borracha — US$ 7,00",
    },
  };
}

function CopyTrackingCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = code;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="tracking-code-block">
      <span className="tracking-code-label">CÓDIGO DE RASTREIO</span>
      <button type="button" className={`tracking-copy-button${copied ? " copied" : ""}`} onClick={copy} aria-label={copied ? "Código copiado" : `Copiar código de rastreio ${code}`}>
        <strong>{code}</strong><span className="copy-glyph" aria-hidden="true" />
      </button>
      <span className="sr-only" aria-live="polite">{copied ? "Código copiado" : ""}</span>
    </div>
  );
}

function OrderTimeline({ history }: { history: TrackingEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const ordered = [...history].sort((a, b) => new Date(b.statusAt).getTime() - new Date(a.statusAt).getTime());
  const visible = expanded ? ordered : ordered.slice(0, 3);
  return (
    <section className="tracking-history-panel">
      <h3>HISTÓRICO DO PEDIDO</h3>
      <div className="timeline">
        {visible.map((event, index) => (
          <div className={`timeline-row ${index === 0 ? "current" : ""}`} key={`${event.statusKey}-${event.statusAt}`}>
            <span className="timeline-dot"/><div><div className="timeline-heading"><h4>{trackingStatusLabels[event.statusKey] || "Atualização"}</h4><time>{shortTrackingDate(event.statusAt)}</time></div><p>{event.statusKey === "carrier_pending" ? "Atualização prevista em aproximadamente 3–5 dias." : event.statusPt}</p></div>
          </div>
        ))}
      </div>
      {ordered.length > 3 && <button type="button" className="tracking-history-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "MOSTRAR MENOS" : "VER HISTÓRICO COMPLETO"}<span aria-hidden="true">{expanded ? "−" : "+"}</span></button>}
    </section>
  );
}

function ShippingDetails({ order }: { order: TrackingOrder }) {
  if (!order.shippingDetails && !order.trackingNote) return null;
  return (
    <details className="tracking-shipping-details">
      <summary>DETALHES DO ENVIO <span aria-hidden="true">+</span></summary>
      <div className="tracking-detail-grid">
        {order.shippingDetails && <>
          <div><span>Pacote</span><strong>{order.shippingDetails.parcel}</strong></div>
          <div><span>Modalidade</span><strong>{order.shippingDetails.method}</strong></div>
          <div><span>Frete</span><strong>{order.shippingDetails.shippingPrice}</strong></div>
          <div><span>Total</span><strong>{order.shippingDetails.totalPrice}</strong></div>
          <div><span>Seguro declarado</span><strong>{order.shippingDetails.insuredAmount}</strong></div>
          <div className="wide"><span>Declaração aduaneira</span><strong>{order.shippingDetails.declaration}</strong></div>
        </>}
        {order.trackingNote && <p className="tracking-detail-note">{order.trackingNote}</p>}
      </div>
    </details>
  );
}

declare global {
  interface Window {
    KicknityAccount?: {
      canOpen: () => boolean;
      requireLogin: () => void;
      open: (tab?: string) => void;
      isReady: () => boolean;
    };
  }
}

function AccountExperience({ active }: { active: boolean }) {
  return (
    <>
      <main className="production-account-route" hidden={!active}>
        <section className="account-area" id="accountArea" aria-labelledby="accountTitle">
          <aside className="account-desktop-sidebar" aria-label="Navegação da conta">
            <div className="account-desktop-user">
              <span className="account-desktop-avatar" id="accountDesktopAvatar">K</span>
              <span><strong id="accountDesktopName">Cliente KICKNITY</strong><small id="accountDesktopEmail">Carregando…</small></span>
            </div>
            <nav className="account-desktop-nav">
              <button className="active" type="button" data-account-tab="overview"><span className="account-nav-icon icon-overview" aria-hidden="true"><i /></span><b>Visão geral</b></button>
              <button type="button" data-account-tab="orders"><span className="account-nav-icon icon-orders" aria-hidden="true"><i /></span><b>Meus pedidos</b></button>
              <button type="button" data-route="how"><span className="account-nav-icon icon-support" aria-hidden="true"><i /></span><b>Suporte</b></button>
              <button type="button" data-account-tab="admin" data-admin-account-tab hidden><span className="account-nav-icon icon-admin" aria-hidden="true"><i /></span><b>Administração</b></button>
            </nav>
            <button className="account-desktop-new-order" type="button" data-route="shop">+ Novo pedido</button>
            <button className="account-desktop-logout" id="accountDesktopLogout" type="button">Sair da conta</button>
          </aside>

          <div className="account-desktop-main">
            <header className="account-hero">
              <div><span className="account-kicker">MINHA CONTA</span><h2 className="account-mobile-title" id="accountTitle">Minha conta</h2><h2 className="account-desktop-title" id="accountDesktopGreeting">Olá.</h2><p id="accountIdentity">Carregando seus dados…</p></div>
              <span className="account-verified-badge" id="accountVerifiedBadge">E-MAIL VERIFICADO</span>
              <button className="account-logout" id="accountLogout" type="button">Sair</button>
            </header>
            <nav className="account-tabs" aria-label="Seções da conta">
              <button className="active" type="button" data-account-tab="overview">Visão geral</button>
              <button type="button" data-account-tab="orders">Meus pedidos</button>
              <button type="button" data-account-tab="admin" id="adminTabButton" hidden>Administração</button>
            </nav>
            <button className="account-mobile-new-order" type="button" data-route="shop">+ Montar novo pedido</button>

            <div className="account-view" data-account-view="overview">
              <div className="account-desktop-overview">
                <div className="account-desktop-metrics">
                  <article className="highlight"><span>Pedidos ativos</span><strong id="accountDesktopActiveCount">0</strong><small>Em acompanhamento</small></article>
                  <article><span>Total de pedidos</span><strong id="accountDesktopOrdersCount">0</strong><small>Vinculados à sua conta</small></article>
                  <article><span>Pedidos concluídos</span><strong id="accountDesktopDeliveredCount">0</strong><small>Entregues com sucesso</small></article>
                  <article><span>Última atualização</span><strong id="accountDesktopLastUpdate">—</strong><small id="accountDesktopLastUpdateLabel">Nenhuma atualização</small></article>
                </div>
                <div className="account-desktop-content-grid">
                  <section className="account-desktop-card"><div className="account-desktop-card-head"><h3>Pedidos recentes</h3><button type="button" data-open-account-orders>Ver todos</button></div><div className="account-desktop-recent" id="accountDesktopRecentOrders"><div className="account-empty">Nenhum pedido vinculado ainda.</div></div></section>
                  <section className="account-desktop-card"><div className="account-desktop-card-head"><h3>Histórico recente</h3></div><div className="account-desktop-activity" id="accountDesktopActivity"><div className="account-empty">Nenhuma atualização registrada.</div></div></section>
                </div>
              </div>
              <div className="account-mobile-overview account-metrics">
                <article><span>Pedidos</span><strong id="accountOrdersCount">0</strong><small>vinculados à sua conta</small></article>
                <article><span>Em andamento</span><strong id="accountActiveCount">0</strong><small>com atualização disponível</small></article>
                <article><span>Entregues</span><strong id="accountDeliveredCount">0</strong><small>pedidos concluídos</small></article>
              </div>
              <section className="account-mobile-overview account-panel"><div className="account-panel-head"><div><span>ÚLTIMA ATUALIZAÇÃO</span><h3>Pedido mais recente</h3></div><button type="button" data-open-account-orders>Ver todos</button></div><div id="accountLatestOrder" className="account-empty">Nenhum pedido vinculado ainda.</div></section>
            </div>

            <div className="account-view" data-account-view="orders" hidden>
              <section className="account-panel"><div className="account-panel-head"><div><span>HISTÓRICO PESSOAL</span><h3>Meus pedidos</h3></div><button type="button" id="refreshAccountOrders">Atualizar</button></div><div className="account-order-list" id="accountOrderList" /></section>
            </div>

            <div className="account-view" data-account-view="admin" hidden>
              <section className="account-panel admin-security" aria-labelledby="adminSecurityTitle">
                <div className="account-panel-head"><div><span>PROTEÇÃO DA CONTA</span><h3 id="adminSecurityTitle">Autenticação em duas etapas</h3></div><span className="admin-security-badge" id="adminMfaBadge">Verificando</span></div>
                <div className="admin-security-body">
                  <p id="adminMfaDescription">Verificando a proteção da conta administrativa…</p>
                  <button className="account-primary admin-mfa-start" id="adminMfaStart" type="button" hidden>Ativar aplicativo autenticador</button>
                  <div className="admin-mfa-setup" id="adminMfaSetup" hidden><img id="adminMfaQr" alt="QR Code para configurar autenticação em duas etapas"/><div><strong>Escaneie no seu aplicativo autenticador.</strong><small>Se não conseguir escanear, use esta chave:</small><code id="adminMfaSecret" /></div></div>
                  <form className="admin-mfa-form" id="adminMfaEnrollForm" hidden><label>Código de 6 dígitos<input id="adminMfaEnrollCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label><button className="account-primary" type="submit">Confirmar e ativar</button></form>
                  <form className="admin-mfa-form" id="adminMfaChallengeForm" hidden><label>Código do autenticador<input id="adminMfaChallengeCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label><button className="account-primary" type="submit">Liberar administração</button></form>
                  <p className="account-feedback" id="adminMfaFeedback" aria-live="polite" />
                </div>
              </section>
              <div className="admin-grid">
                <section className="account-panel admin-create"><div className="account-panel-head"><div><span>ADMINISTRAÇÃO</span><h3>Novo pedido</h3></div></div>
                  <form id="adminOrderForm" className="account-form">
                    <label>Cliente<select id="adminCustomer" required><option value="">Selecione</option></select></label>
                    <div className="account-form-row"><label>Código do pedido<input id="adminOrderCode" required maxLength={40} placeholder="O260..." /></label><label>Quantidade<input id="adminQuantity" type="number" min="1" max="99" defaultValue="1" required /></label></div>
                    <label>Produto<input id="adminProductName" required maxLength={160} placeholder="Yeezy 350 V2 Bone" /></label>
                    <div className="account-form-row"><label>Modelo<input id="adminModelCode" maxLength={60} placeholder="HQ6316" /></label><label>Valor total (R$)<input id="adminTotalAmount" type="number" min="0" step="0.01" /></label></div>
                    <label>Status<select id="adminStatus" defaultValue="submitted"><option value="submitted">Recebido</option><option value="accepted">Em atendimento</option><option value="purchased">Comprado</option><option value="logistics">Em transporte</option><option value="warehouse">Armazém / QC</option><option value="shipped">Enviado</option><option value="delivered">Entregue</option><option value="cancelled">Cancelado</option></select></label>
                    <div className="account-form-row"><label>Transportadora<input id="adminCarrier" maxLength={100} /></label><label>Rastreio<input id="adminTrackingCode" maxLength={100} /></label></div>
                    <label>Observações<textarea id="adminNotes" rows={3} maxLength={800} /></label>
                    <p className="account-feedback" id="adminCreateFeedback" aria-live="polite" /><button className="account-primary" type="submit">Criar pedido</button>
                  </form>
                </section>
                <section className="account-panel admin-orders"><div className="account-panel-head"><div><span>GESTÃO</span><h3>Pedidos cadastrados</h3></div><button type="button" id="refreshAdminOrders">Atualizar</button></div><div className="admin-order-list" id="adminOrderList" /></section>
              </div>
            </div>
          </div>
        </section>
      </main>

      <dialog className="auth-dialog" id="authDialog" aria-labelledby="authTitle">
        <button className="auth-close" id="authClose" type="button" aria-label="Fechar">×</button>
        <div className="auth-brand"><img src="./favicon.png" alt=""/><div><strong>KICKNITY</strong><small>Conta opcional para acompanhar seus pedidos</small></div></div>
        <div className="auth-tabs" id="authTabs"><button className="active" type="button" data-auth-mode="login">Entrar</button><button type="button" data-auth-mode="signup">Criar conta</button></div>
        <form className="auth-form" id="loginForm"><h2 id="authTitle">Bem-vindo de volta</h2><p>Acesse seus pedidos e atualizações.</p><label>E-mail<input id="loginEmail" type="email" autoComplete="email" required /></label><label>Senha<input id="loginPassword" type="password" autoComplete="current-password" required /></label><button className="auth-primary" type="submit">Entrar</button><button className="auth-link" id="forgotPassword" type="button">Esqueci minha senha</button></form>
        <form className="auth-form" id="signupForm" hidden><h2>Criar sua conta</h2><p>O cadastro é gratuito e não é obrigatório para montar uma cotação.</p><label>Nome<input id="signupName" type="text" autoComplete="name" maxLength={100} required /></label><label>E-mail<input id="signupEmail" type="email" autoComplete="email" required /></label><label>Senha<input id="signupPassword" type="password" autoComplete="new-password" minLength={10} required aria-describedby="signupPasswordHelp" /></label><small className="auth-password-help" id="signupPasswordHelp">Use pelo menos 10 caracteres e não reutilize senhas.</small><button className="auth-primary" type="submit">Criar conta</button></form>
        <form className="auth-form" id="recoveryForm" hidden><h2>Definir nova senha</h2><p>Escolha uma senha com pelo menos 10 caracteres.</p><label>Nova senha<input id="recoveryPassword" type="password" autoComplete="new-password" minLength={10} required /></label><button className="auth-primary" type="submit">Salvar nova senha</button></form>
        <p className="auth-feedback" id="authFeedback" aria-live="polite" />
      </dialog>

      <div className="image-lightbox account-qc-lightbox" id="accountQcLightbox" role="dialog" aria-modal="true" aria-label="Foto real ampliada do pedido" hidden>
        <div className="lightbox-top"><span id="accountQcLabel">FOTO REAL DE QC</span><strong id="accountQcCount">1 / 9</strong><button id="accountQcClose" type="button">FECHAR ×</button></div>
        <button className="lightbox-arrow prev" id="accountQcPrev" type="button" aria-label="Foto anterior">‹</button>
        <img id="accountQcImage" alt="Foto real de QC do pedido" />
        <button className="lightbox-arrow next" id="accountQcNext" type="button" aria-label="Próxima foto">›</button>
        <p>Use as setas ou deslize para navegar</p>
      </div>
    </>
  );
}

export default function Home() {
  const [sharedPayment, setSharedPayment] = useState<PaymentLinkData | null>(() => readPaymentLink(window.location.hash, products.map((product) => product.id)));
  const [route, setRoute] = useState<Route>(() => window.location.hash.startsWith("#pay/") ? "shop" : "home");
  const [cart, setCart] = useState<Record<string, number>>(() => sharedPayment?.cart || {});
  const [trackingCode, setTrackingCode] = useState("");
  const [trackingVisible, setTrackingVisible] = useState(false);
  const [trackingOrder, setTrackingOrder] = useState<TrackingOrder | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [activeImage, setActiveImage] = useState("");
  const [zoomedImageIndex, setZoomedImageIndex] = useState<number | null>(null);
  const [purchaseStep, setPurchaseStep] = useState<PurchaseStep>(() => sharedPayment ? "payment" : "select");
  const [catalogFilter, setCatalogFilter] = useState<"all" | "apparel" | "sneakers">("all");
  const [sizeNotes, setSizeNotes] = useState<Record<string, string>>(() => sharedPayment?.sizes || {});
  const [cartWarning, setCartWarning] = useState("");
  const [paymentReference, setPaymentReference] = useState(() => sharedPayment?.reference || createPaymentReference());
  const [pixCopied, setPixCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [mobileCartProductId, setMobileCartProductId] = useState<string | null>(null);
  const [mobileCartDismissed, setMobileCartDismissed] = useState(false);

  const openProduct = (product: Product) => {
    setSelectedProduct(product);
    setActiveImage(product.image);
  };

  const openAccount = () => {
    if (!window.KicknityAccount) return;
    if (window.KicknityAccount.canOpen()) window.location.hash = "conta";
    else window.KicknityAccount.requireLogin();
  };

  const searchTracking = async () => {
    const code = trackingCode.trim().toUpperCase();
    setTrackingCode(code);
    setTrackingError("");
    setTrackingVisible(false);
    setTrackingOrder(null);
    if (!/^[A-Z0-9-]{6,32}$/.test(code)) {
      setTrackingError("Digite o código completo enviado pela Kicknity.");
      return;
    }
    setTrackingLoading(true);
    try {
      const response = await fetch("https://lgcvaxjsgymwueacqkec.supabase.co/functions/v1/public-tracking", {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível consultar agora.");
      setTrackingOrder(applyKnownTrackingUpdate(data.order as TrackingOrder));
      setTrackingVisible(true);
    } catch (error) {
      setTrackingError(error instanceof Error ? error.message : "Não foi possível consultar agora.");
    } finally {
      setTrackingLoading(false);
    }
  };

  useEffect(() => {
    document.body.style.overflow = selectedProduct ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [selectedProduct]);

  useEffect(() => {
    document.body.classList.add("site-redesign");
    document.body.classList.toggle("route-conta", route === "account");
    return () => {
      document.body.classList.remove("route-conta");
      document.body.classList.remove("site-redesign");
    };
  }, [route]);

  useEffect(() => {
    if (document.querySelector('script[data-kicknity-account="true"]')) return;
    const script = document.createElement("script");
    script.src = `./account.js?v=20260911-tracking1`;
    script.dataset.kicknityAccount = "true";
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    const readHash = () => {
      const hash = window.location.hash.replace("#", "");
      const [routeHash] = hash.split("/");
      if (routeHash === "pay") {
        const linked = readPaymentLink(window.location.hash, products.map((product) => product.id));
        setRoute("shop");
        if (linked) {
          setCart(linked.cart);
          setSizeNotes(linked.sizes);
          setPaymentReference(linked.reference);
          setSharedPayment(linked);
          setPurchaseStep("payment");
        } else {
          setCartWarning("Link de pagamento inválido. Monte seu pedido novamente.");
          setPurchaseStep("select");
        }
      } else if (routeHash === "conta") setRoute("account");
      else if (routeHash in routeLabels) setRoute(routeHash as Route);
      else if (!routeHash) setRoute("home");
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);

  useEffect(() => {
    const handleRoute = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-route]");
      const next = target?.dataset.route as Route | undefined;
      if (!next) return;
      window.location.hash = next;
      setRoute(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    document.addEventListener("click", handleRoute);
    return () => document.removeEventListener("click", handleRoute);
  }, []);

  const quote = calculateQuote(cart, products);
  const { itemCount: totalItems, weightGrams: weight } = quote;
  const subtotal = quote.productBrl;
  const shipping = quote.shippingBrl;
  const insurance = quote.insuranceBrl;
  const service = quote.serviceBrl;
  const total = quote.totalBrl;
  const missingSizes = products.filter((product) => cart[product.id] && !sizeNotes[product.id]?.trim());
  const validPayment = totalItems > 0 && !quote.overLimit && missingSizes.length === 0 && (!sharedPayment || sharedPayment.amountBrl === total);
  const pixPayload = validPayment ? createPixPayload(total, paymentReference) : "";
  const paymentUrl = `${window.location.origin}${window.location.pathname}${paymentLinkHash({ reference: paymentReference, amountBrl: total, cart, sizes: sizeNotes })}`;
  const visibleProducts = catalogFilter === "all" ? products : products.filter((product) => product.category === catalogFilter);
  const galleryImages = selectedProduct ? [selectedProduct.image, ...(selectedProduct.editorial || selectedProduct.qc)] : [];
  const mobileCartProduct = products.find((product) => product.id === mobileCartProductId && cart[product.id]) || products.find((product) => cart[product.id]);
  const showMobileCart = route === "shop" && purchaseStep === "select" && totalItems > 0 && !mobileCartDismissed && !selectedProduct;

  useEffect(() => {
    if (totalItems === 0 && purchaseStep !== "select") setPurchaseStep("select");
  }, [totalItems, purchaseStep]);

  const changeQuantity = (productId: string, change: number): boolean => {
    const product = products.find((entry) => entry.id === productId);
    if (!product) return false;
    if (change > 0 && weight + product.weightGrams > MAX_CART_WEIGHT_GRAMS) {
      setCartWarning("Limite de 6 kg por pedido. Remova um item para continuar.");
      return false;
    }
    setCartWarning("");
    setSharedPayment(null);
    if (change > 0) {
      setMobileCartProductId(productId);
      setMobileCartDismissed(false);
    }
    if (window.location.hash.startsWith("#pay/")) window.history.replaceState(null, "", "#shop");
    setCart((current) => {
      const next = Math.max(0, (current[productId] || 0) + change);
      const updated = { ...current, [productId]: next };
      if (!next) delete updated[productId];
      if (calculateQuote(updated, products).overLimit) return current;
      return updated;
    });
    return true;
  };

  const addTechSet = () => {
    const missingJacket = cart["tech-jacket"] ? 0 : 650;
    const missingPants = cart["tech-pants"] ? 0 : 550;
    if (weight + missingJacket + missingPants > MAX_CART_WEIGHT_GRAMS) {
      setCartWarning("Limite de 6 kg por pedido. Remova um item para continuar.");
      return;
    }
    setCartWarning("");
    setSharedPayment(null);
    setMobileCartProductId("tech-jacket");
    setMobileCartDismissed(false);
    setCart((current) => {
      const updated = { ...current, "tech-jacket": Math.max(1, current["tech-jacket"] || 0), "tech-pants": Math.max(1, current["tech-pants"] || 0) };
      return calculateQuote(updated, products).overLimit ? current : updated;
    });
    setCatalogFilter("apparel");
    setPurchaseStep("select");
    window.location.hash = "shop";
  };

  const orderEmailBody = [
    `Olá! Fiz ou pretendo fazer o Pix do pedido Kicknity ${paymentReference}:`,
    ...products.filter((product) => cart[product.id]).map((product) => `• ${cart[product.id]} × ${product.name} (${product.sku}) — tamanho: ${sizeNotes[product.id]?.trim() || "a confirmar"}`),
    `Peso estimado: ${weight} g · frete: ${quote.shippingMethod || "a confirmar"}`,
    `Produtos: R$ ${subtotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · frete: R$ ${shipping.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · seguro 6%: R$ ${insurance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    ...(quote.isConfirmedTechSetExample ? ["Conjunto: cotação de referência ¥761 / R$ 625, incluindo demais custos do pedido."] : []),
    `Serviço Kicknity: R$ ${service.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    `Total estimado: R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    "O Pix só será considerado pago após conferência da Kicknity no banco. Por favor, confirme meu pedido e a disponibilidade.",
  ].join("\n");

  const startPayment = () => {
    if (!validPayment || missingSizes.length) return;
    setPaymentReference(createPaymentReference());
    setSharedPayment(null);
    setPixCopied(false);
    setLinkCopied(false);
    if (window.location.hash.startsWith("#pay/")) window.history.replaceState(null, "", "#shop");
    setPurchaseStep("payment");
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (zoomedImageIndex !== null) setZoomedImageIndex(null);
        else if (selectedProduct) setSelectedProduct(null);
        return;
      }
      if (zoomedImageIndex === null || !galleryImages.length) return;
      if (event.key === "ArrowRight") setZoomedImageIndex((zoomedImageIndex + 1) % galleryImages.length);
      if (event.key === "ArrowLeft") setZoomedImageIndex((zoomedImageIndex - 1 + galleryImages.length) % galleryImages.length);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomedImageIndex, galleryImages, selectedProduct]);

  const routeContent = (() => {
    if (route === "shop") {
      return (
        <main className={`route-page shop-page${showMobileCart ? " shop-page--mobile-cart" : ""}`}>
          <section className="page-intro">
            <p className="eyebrow dark">KICKNITY / TÊNIS & VESTUÁRIO</p>
            <h1>Peças que fazem o look.</h1>
            <p>Escolha seus produtos. Frete por peso, seguro e serviço aparecem separadamente antes de gerar o Pix.</p>
          </section>
          <nav className="purchase-steps" aria-label="Etapas do pedido">
            <button className={purchaseStep === "select" ? "active" : ""} onClick={() => setPurchaseStep("select")}><span>01</span><strong>SELECIONAR</strong></button>
            <button className={purchaseStep === "review" ? "active" : ""} onClick={() => totalItems && setPurchaseStep("review")} disabled={!totalItems}><span>02</span><strong>REVISAR</strong></button>
            <button className={purchaseStep === "payment" ? "active" : ""} onClick={startPayment} disabled={!validPayment}><span>03</span><strong>PAGAR</strong></button>
          </nav>
          {purchaseStep === "select" && (
            <div className="shop-layout">
              <section>
                <div className="shop-set-feature">
                  <img src="./catalog/nike-tech-look-front-enhanced.png" alt="Conjunto Nike Tech Fleece preto e antracite vestido em modelo" />
                  <div><span>DROP 01 / TECH FLEECE 2025</span><h2>O conjunto completo.</h2><p>Jaqueta Windrunner + calça Open-Hem. Referência: R$ 625 em custos e R$ 35 de serviço. Confira o total e pague por Pix.</p><strong>R$ 660 no conjunto</strong><button type="button" onClick={addTechSet}>MONTAR CONJUNTO <Arrow /></button></div>
                </div>
                <div className="filter-row"><span className="catalog-label">CATÁLOGO / {visibleProducts.length} PEÇAS</span><div className="catalog-filters" role="group" aria-label="Filtrar catálogo">{([['all','Tudo'],['apparel','Roupas'],['sneakers','Tênis']] as const).map(([value,label]) => <button type="button" key={value} className={`filter ${catalogFilter === value ? 'active' : ''}`} onClick={() => setCatalogFilter(value)} aria-pressed={catalogFilter === value}>{label}</button>)}</div></div>
                <div className="catalog-grid">
                  {visibleProducts.map((product, index) => (
                    <article className={`product-card product-card--${product.category}`} key={product.id}>
                      <button className="product-image" onClick={() => openProduct(product)} aria-label={`Ver detalhes de ${product.name}`}>
                        <span className="product-index">{String(index + 1).padStart(2,'0')}</span><span className="product-tone">{product.category === 'apparel' ? 'VESTUÁRIO' : product.tone}</span><img src={product.image} alt={product.name} loading="lazy" decoding="async" />
                      </button>
                      <button className="product-copy" onClick={() => openProduct(product)}>
                        <div><p className="sku">{product.sku} · {product.category === 'apparel' ? 'NIKE TECH' : 'TÊNIS'}</p><h2>{product.name}</h2></div>
                        <p className="price">R$ {product.price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<small>¥ {product.cny}</small></p>
                      </button>
                      {cart[product.id] ? (
                        <div className="quantity-control" aria-label={`Quantidade de ${product.name}`}>
                          <button onClick={() => changeQuantity(product.id, -1)} aria-label="Diminuir quantidade">−</button>
                          <span><strong>{cart[product.id]}</strong><small>NO PEDIDO</small></span>
                          <button onClick={() => changeQuantity(product.id, 1)} aria-label="Aumentar quantidade" disabled={weight + product.weightGrams > MAX_CART_WEIGHT_GRAMS}>＋</button>
                        </div>
                      ) : <button className="add-button" onClick={() => changeQuantity(product.id, 1)} disabled={weight + product.weightGrams > MAX_CART_WEIGHT_GRAMS}>ADICIONAR AO PEDIDO <span>＋</span></button>}
                    </article>
                  ))}
                </div>
              </section>
              <aside className="order-summary" aria-live="polite">
                <div className="summary-head"><p className="eyebrow dark">RESUMO EM TEMPO REAL</p><span>{String(totalItems).padStart(2, "0")}</span></div>
                {totalItems === 0 ? <div className="empty-cart"><span>＋</span><p>Adicione uma peça para ver frete, seguro e total.</p></div> : (
                  <div className="summary-lines">
                    <div><span>Produtos</span><strong>R$ {subtotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div>
                    <div><span>Frete internacional</span><strong>R$ {shipping.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div>
                    <div><span>Seguro (6%)</span><strong>R$ {insurance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div>
                    {quote.additionalCny > 0 && <div><span>Demais custos da cotação</span><strong>R$ {quote.additionalBrl.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div>}
                    {quote.roundingBrl !== 0 && <div><span>Ajuste da cotação</span><strong>R$ {quote.roundingBrl.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div>}
                    <div className="service-line"><span>Serviço Kicknity</span><strong>R$ {service.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div>
                    <small>{quote.shippingMethod} · {weight.toLocaleString("pt-BR")} g de 6.000 g</small>
                    <div className="weight-track" role="meter" aria-label="Peso do pedido" aria-valuemin={0} aria-valuemax={6000} aria-valuenow={weight}><span style={{ width: `${Math.min(100, weight / 60)}%` }} /></div>
                  </div>
                )}
                {cartWarning && <p className="cart-warning" role="alert">{cartWarning}</p>}
                <div className="summary-total"><span>{quote.isConfirmedTechSetExample ? "Conjunto + serviço" : "Total estimado"}</span><strong>R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div>
                <button className="primary full" disabled={!totalItems || quote.overLimit} onClick={() => setPurchaseStep("review")}>REVISAR PEDIDO <Arrow /></button>
                <p className="summary-note">Cotação usada: ¥ 1,22 por R$ 1. O Pix será gerado pelo total exibido. Pesos estimados; eventuais diferenças e disponibilidade serão tratadas pelo atendimento. Tributos no Brasil não inclusos.</p>
              </aside>
            </div>
          )}
          {purchaseStep === "review" && (
            <section className="checkout-stage review-stage">
              <div className="checkout-title"><p className="eyebrow dark">02 / REVISÃO</p><h2>Confira antes de continuar.</h2></div>
              <div className="review-layout"><div className="review-products">
                {products.filter((product) => cart[product.id]).map((product) => <article key={product.id}>
                  <img src={product.image} alt="" />
                  <div className="review-product-info"><span>{product.sku}</span><strong>{product.name}</strong><small>{cart[product.id]} × R$ {product.price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</small><label>Tamanho desejado (obrigatório para o Pix)<input value={sizeNotes[product.id] || ""} onChange={(event) => { setSizeNotes((current) => ({ ...current, [product.id]: event.target.value })); setSharedPayment(null); }} placeholder={product.category === "apparel" ? "Ex.: M ou M, G" : "Ex.: 42 ou 42, 43"} maxLength={70} /></label></div>
                  <div className="review-qty"><button onClick={() => changeQuantity(product.id, -1)} aria-label={`Diminuir ${product.name}`}>−</button><strong>{cart[product.id]}</strong><button onClick={() => changeQuantity(product.id, 1)} disabled={weight + product.weightGrams > MAX_CART_WEIGHT_GRAMS} aria-label={`Aumentar ${product.name}`}>＋</button></div>
                </article>)}
              </div><aside className="review-total"><p><span>Produtos</span><strong>R$ {subtotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></p><p><span>Frete internacional</span><strong>R$ {shipping.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></p><p><span>Seguro (6%)</span><strong>R$ {insurance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></p>{quote.additionalCny > 0 && <p><span>Demais custos da cotação</span><strong>R$ {quote.additionalBrl.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></p>}{quote.isConfirmedTechSetExample && <p><span>Ajuste para R$ 625</span><strong>R$ {quote.roundingBrl.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></p>}<p><span>Serviço Kicknity</span><strong>R$ {service.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></p><div><span>TOTAL</span><strong>R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div><small>Frete {quote.shippingMethod} · {weight.toLocaleString("pt-BR")} g estimados</small>{missingSizes.length > 0 && <small className="review-required">Informe o tamanho de cada peça para gerar o Pix.</small>}<button className="primary full" disabled={missingSizes.length > 0 || quote.overLimit} onClick={startPayment}>GERAR PIX <Arrow /></button><button className="back-button" onClick={() => setPurchaseStep("select")}>← VOLTAR À SELEÇÃO</button></aside></div>
            </section>
          )}
          {purchaseStep === "payment" && (
            <section className="checkout-stage payment-stage pix-stage">
              <div className="pix-main">
                <p className="eyebrow dark">03 / PAGAMENTO PIX</p>
                <h2>Pronto para pagar.</h2>
                <p>Copie o código Pix e cole na opção “Pix Copia e Cola” do aplicativo do seu banco, ou escaneie o QR Code ao lado. Confira o destinatário e o valor antes de confirmar no banco.</p>
                {validPayment ? <>
                  <div className="pix-receiver"><span>REFERÊNCIA DO PEDIDO</span><strong>{paymentReference}</strong><small>{totalItems} {totalItems === 1 ? "peça" : "peças"} · guarde este número para a conferência</small></div>
                  <span className="pix-code-label">PIX COPIA E COLA</span>
                  <div className="pix-code" aria-label="Código Pix ocultado visualmente; use o botão Copiar Pix">{pixPayload.slice(0, 8)} ································ {pixPayload.slice(-4)}</div>
                  <div className="pix-actions">
                    <button type="button" className="primary" onClick={async () => setPixCopied(await copyToClipboard(pixPayload))}>{pixCopied ? "CÓDIGO COPIADO ✓" : "COPIAR PIX"} <Arrow /></button>
                    <button type="button" className="secondary" onClick={async () => setLinkCopied(await copyToClipboard(paymentUrl))}>{linkCopied ? "LINK COPIADO ✓" : "COPIAR LINK DE PAGAMENTO"}</button>
                  </div>
                  <p className="pix-guidance">O link abre esta página de cobrança; o pagamento é concluído no aplicativo do banco. O site não recebe confirmação automática do Pix. Após pagar, envie o comprovante com o número do pedido.</p>
                  <a className="pix-receipt-link" href={`mailto:kicknity@gmail.com?subject=${encodeURIComponent(`Comprovante Pix Kicknity ${paymentReference}`)}&body=${encodeURIComponent(orderEmailBody)}`}>AVISAR QUE PAGUEI <Arrow /></a>
                </> : <p className="pix-error" role="alert">Este link não corresponde ao valor atual, faltam tamanhos ou o pedido excede 6 kg. Volte e revise o carrinho antes de gerar outro Pix.</p>}
                <button className="back-button" onClick={() => setPurchaseStep("review")}>← VOLTAR E REVISAR</button>
              </div>
              <aside className="pix-aside">
                <span>VALOR DA COBRANÇA</span><strong>R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
                {validPayment && <PixQr payload={pixPayload} />}
                <small>Pix com valor e identificador deste pedido. Peso estimado: {weight.toLocaleString("pt-BR")} g.</small>
                <div className="pix-pending">AGUARDANDO CONFERÊNCIA DO PAGAMENTO</div>
              </aside>
            </section>
          )}
        </main>
      );
    }

    if (route === "how") {
      return (
        <main className="route-page how-page">
          <section className="page-intro split-intro">
            <div><p className="eyebrow dark">DA ESCOLHA À ENTREGA</p><h1>Importar com clareza.</h1></div>
            <p>Tênis e roupas em um pedido acompanhado: seleção, estimativa de custos, fotos de QC no armazém e rastreio em português.</p>
          </section>
          <section className="steps-grid">
            {[
              ["01", "ESCOLHA", "Selecione tênis e roupas. Informe o tamanho desejado na revisão."],
              ["02", "CONFIRA", "Veja o peso estimado, frete, seguro de 6% e serviço em linhas separadas."],
              ["03", "PAGUE E ACOMPANHE", "Pague por Pix no aplicativo do banco. Após a conferência do pagamento, acompanhe o pedido e receba fotos de QC."],
            ].map(([number, title, copy]) => (
              <article className="step-card" key={number}><span>{number}</span><h2>{title}</h2><p>{copy}</p></article>
            ))}
          </section>
          <section className="service-panel">
            <div><p className="eyebrow">SERVIÇO ASSISTIDO</p><h2>Você escolhe as peças.<br/>A gente acompanha o caminho.</h2></div>
            <div className="service-list">
              <p><span>01</span> Cotação separada por produto, frete, seguro e serviço</p>
              <p><span>02</span> Fotos de QC após a chegada ao armazém</p>
              <p><span>03</span> BJ EUB até 2 kg; SH SAL acima disso, até 6 kg</p>
              <p><span>04</span> Histórico de rastreio em português</p>
            </div>
          </section>
          <section className="faq-preview">
            <p className="eyebrow dark">DÚVIDAS FREQUENTES</p><h2>Antes de fechar o pedido.</h2>
            <details><summary>O valor do card já é o total do Pix?</summary><p>Não. O card mostra apenas o produto. Na revisão, o carrinho soma frete internacional, seguro e serviço; o Pix é gerado pelo total exibido nessa etapa.</p></details>
            <details><summary>Como o frete é calculado?</summary><p>Por peso estimado: BJ EUB até 2 kg e SH SAL acima de 2 kg, até o limite de 6 kg por pedido. Peso e valor final podem mudar após conferência no armazém.</p></details>
            <details><summary>O que são as fotos de QC?</summary><p>São fotos tiradas após o produto chegar ao armazém. As imagens de catálogo mostram o modelo; algumas foram aprimoradas digitalmente e os originais continuam na galeria. Nenhuma delas é QC do seu pedido.</p></details>
            <details><summary>Como escolho o tamanho?</summary><p>Informe o tamanho desejado ao revisar o pedido, antes de gerar o Pix. A disponibilidade será verificada pela Kicknity após o pagamento.</p></details>
            <details><summary>O Pix confirma o pedido automaticamente?</summary><p>Não. Confira o nome do destinatário e o valor no aplicativo do banco, pague e envie o comprovante com a referência do pedido. A Kicknity confere o recebimento antes de marcar o pedido como pago.</p></details>
            <details><summary>Onde acompanho o pedido?</summary><p>Use a área Rastrear com o código fornecido pela Kicknity, ou entre em Minha conta para ver pedidos vinculados.</p></details>
          </section>
        </main>
      );
    }

    if (route === "tracking") {
      return (
        <main className="route-page tracking-page">
          <section className="tracking-hero">
            <p className="eyebrow">RASTREIO KICKNITY</p>
            <h1>Saiba exatamente onde está o seu pedido.</h1>
            <div className="tracking-search">
              <input value={trackingCode} onChange={(event) => setTrackingCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") searchTracking(); }} placeholder="Digite o código do pedido" aria-label="Código do pedido" />
              <button onClick={searchTracking} disabled={trackingLoading}>{trackingLoading ? "BUSCANDO…" : "RASTREAR"} <Arrow /></button>
            </div>
            <p className={`tracking-hint${trackingError ? " error" : ""}`}>{trackingError || "Digite o código exatamente como foi enviado pela Kicknity."}</p>
          </section>
          {trackingVisible && trackingOrder && (
            <section className="tracking-result tracking-shell">
              <header className="tracking-product-summary">
                <img src={trackingOrder.image || products.find((product) => product.sku === trackingOrder.model)?.image || "./catalog/hq6316-bone.png"} alt={trackingOrder.product} />
                <div><p>PEDIDO {trackingOrder.code}</p><h2>{trackingOrder.product}</h2></div>
                <span className="status-pill">{trackingStatusLabels[trackingOrder.statusKey] || "ATUALIZAÇÃO"}</span>
              </header>
              {trackingOrder.shippingCode && <CopyTrackingCode code={trackingOrder.shippingCode} />}
              <section className="tracking-current-card">
                <span>ETAPA ATUAL</span>
                <div><h3>{trackingStatusLabels[trackingOrder.statusKey] || "Atualização"}</h3><time>{fullTrackingDate(trackingOrder.statusAt)}</time></div>
                <p>{trackingOrder.statusKey === "carrier_pending" ? "Atualização prevista em aproximadamente 3–5 dias." : trackingOrder.statusPt}</p>
              </section>
              <OrderTimeline history={trackingOrder.history?.length ? trackingOrder.history : [{ statusKey: trackingOrder.statusKey, statusPt: trackingOrder.statusPt, statusAt: trackingOrder.statusAt }]} />
              <ShippingDetails order={trackingOrder} />
            </section>
          )}
        </main>
      );
    }

    if (route === "account") {
      return null;
    }

    return (
      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">KICKNITY / TÊNIS & VESTUÁRIO</p>
            <h1>O próximo look<br/><em>começa aqui.</em></h1>
            <p className="hero-lead">Peças escolhidas com cuidado, custos claros e um pedido acompanhado do primeiro clique à entrega.</p>
            <div className="hero-actions">
              <button className="primary" data-route="shop">EXPLORAR A SELEÇÃO <Arrow /></button>
              <button className="secondary" data-route="how">COMO FUNCIONA</button>
            </div>
            <div className="hero-proof"><span>✓ FRETE POR PESO</span><span>✓ SERVIÇO CLARO</span><span>✓ RASTREIO</span></div>
          </div>
          <div className="hero-visual hero-visual--fashion">
            <div className="hero-number">01 / 25</div>
            <img src="./catalog/nike-tech-look-front-enhanced.png" alt="Look Nike Tech Fleece preto e antracite" fetchPriority="high" />
            <div className="hero-product"><span>NEW IN / APPAREL</span><strong>NIKE TECH FLEECE</strong><small>WINDRUNNER + OPEN-HEM PANTS</small></div>
            <div className="hero-side-note">KICKNITY EDIT / 2025</div>
          </div>
        </section>
        <div className="marquee" aria-label="Benefícios Kicknity"><div><span>ROUPAS & TÊNIS</span><b>✦</b><span>COTAÇÃO TRANSPARENTE</span><b>✦</b><span>FOTOS DE QC APÓS A COMPRA</span><b>✦</b><span>RASTREIO EM PORTUGUÊS</span></div></div>
        <section className="home-categories" aria-label="Categorias da loja">
          <button type="button" className="category-tile category-tile--apparel" onClick={() => { setCatalogFilter('apparel'); window.location.hash = 'shop'; }}><img src="./catalog/nike-tech-jacket-angle.jpg" alt="Jaqueta Nike Tech Fleece preta" loading="lazy" /><span>01 / VESTUÁRIO</span><strong>Roupas para o look inteiro.</strong><em>EXPLORAR ROUPAS ↗</em></button>
          <button type="button" className="category-tile category-tile--sneakers" onClick={() => { setCatalogFilter('sneakers'); window.location.hash = 'shop'; }}><img src="./catalog/hq6316-bone.png" alt="Tênis Yeezy Boost 350 V2 Bone" loading="lazy" /><span>02 / FOOTWEAR</span><strong>O par que fecha tudo.</strong><em>EXPLORAR TÊNIS ↗</em></button>
        </section>
        <section className="home-section featured">
          <div className="section-head large"><div><p className="eyebrow dark">CURADORIA KICKNITY</p><h2>Agora na seleção.</h2></div><button data-route="shop">VER CATÁLOGO <Arrow /></button></div>
          <div className="featured-grid">
            {products.slice(0, 3).map((product, index) => (
              <button className="feature-card" onClick={() => openProduct(product)} key={product.id}>
                <div className={`feature-image feature-image--${product.category}`}><span>0{index + 1}</span><img src={product.image} alt={product.name} loading="lazy"/></div>
                <div><span>{product.sku} · {product.category === 'apparel' ? 'VESTUÁRIO' : 'TÊNIS'}</span><strong>{product.name}</strong><p>R$ {product.price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <small>+ frete e serviço</small></p></div>
              </button>
            ))}
          </div>
        </section>
        <section className="home-process">
          <div><p className="eyebrow">COMO FUNCIONA</p><h2>Três passos.<br/>Um pedido claro.</h2><button className="text-link" data-route="how">CONHECER O PROCESSO <Arrow /></button></div>
          <div className="process-list">
            <article><span>01</span><div><h3>Escolha suas peças</h3><p>Combine roupas e tênis no mesmo pedido.</p></div></article>
            <article><span>02</span><div><h3>Veja a conta inteira</h3><p>Produto, frete, seguro e serviço em detalhes.</p></div></article>
            <article><span>03</span><div><h3>Acompanhe cada etapa</h3><p>QC no armazém e rastreio em português.</p></div></article>
          </div>
        </section>
        <section className="home-section tracking-banner">
          <div><p className="eyebrow">SEU PEDIDO, SEM MISTÉRIO</p><h2>Da compra ao transporte, cada atualização no lugar certo.</h2></div>
          <button className="primary light" data-route="tracking">RASTREAR AGORA <Arrow /></button>
        </section>
      </main>
    );
  })();

  return (
    <div className="site-shell">
      <div className="announcement"><span>IMPORTAÇÃO ASSISTIDA · COTAÇÃO TRANSPARENTE</span><a href="mailto:kicknity@gmail.com">SUPORTE KICKNITY</a></div>
      <header className="site-header">
        <Brand />
        <nav className="desktop-nav" aria-label="Navegação principal">
          {(["home", "shop", "how", "tracking"] as Route[]).map((item) => <button key={item} className={route === item ? "active" : ""} data-route={item}>{routeLabels[item]}</button>)}
        </nav>
        <button id="navAccountButton" className={`account-link ${route === "account" ? "active" : ""}`}><span>MINHA CONTA</span><span className="account-circle">→</span></button>
      </header>
      {routeContent}
      {showMobileCart && mobileCartProduct && (
        <aside className="mobile-cart-bar" aria-label="Carrinho rápido">
          <div className="mobile-cart-bar__product">
            <img src={mobileCartProduct.image} alt="" />
            <div className="mobile-cart-bar__name"><span>NO CARRINHO · {totalItems} {totalItems === 1 ? "ITEM" : "ITENS"}</span><strong>{mobileCartProduct.name}</strong></div>
            <button type="button" className="mobile-cart-bar__close" onClick={() => setMobileCartDismissed(true)} aria-label="Fechar barra do carrinho">×</button>
          </div>
          <div className="mobile-cart-bar__bottom">
            <div className="mobile-cart-bar__quantity" role="group" aria-label={`Quantidade de ${mobileCartProduct.name}`}>
              <button type="button" onClick={() => changeQuantity(mobileCartProduct.id, -1)} aria-label={`Diminuir ${mobileCartProduct.name}`}>−</button>
              <strong aria-live="polite">{cart[mobileCartProduct.id]}</strong>
              <button type="button" onClick={() => changeQuantity(mobileCartProduct.id, 1)} disabled={weight + mobileCartProduct.weightGrams > MAX_CART_WEIGHT_GRAMS} aria-label={`Aumentar ${mobileCartProduct.name}`}>+</button>
            </div>
            <div className="mobile-cart-bar__total"><span>TOTAL ESTIMADO</span><strong>R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div>
            <button type="button" className="mobile-cart-bar__checkout" onClick={() => { setPurchaseStep("review"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>REVISAR E PAGAR <Arrow /></button>
          </div>
        </aside>
      )}
      <AccountExperience active={route === "account"} />
      <button id="homeAccountButton" type="button" hidden>Entrar</button>
      <footer className="site-footer">
        <div className="footer-top"><Brand/><p>Curadoria de tênis e roupas, cotação clara e acompanhamento em cada etapa.</p></div>
        <div className="footer-links"><div><strong>NAVEGAR</strong><button data-route="shop">Comprar</button><button data-route="tracking">Rastrear</button><button data-route="how">Como funciona</button></div><div><strong>ATENDIMENTO</strong><a href="mailto:kicknity@gmail.com">kicknity@gmail.com</a><span>Segunda a sexta</span><span>09h às 18h</span></div><div><strong>INFORMAÇÕES</strong><button data-route="how">Sobre nós</button><button data-route="how">FAQ</button><span>Privacidade</span></div></div>
        <div className="footer-bottom"><span>© 2026 KICKNITY</span><span>VALORES APROXIMADOS · CONFIRMAÇÃO PELO ATENDIMENTO</span></div>
      </footer>
      {selectedProduct && (
        <div className="product-modal" role="dialog" aria-modal="true" aria-label={`Detalhes de ${selectedProduct.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProduct(null); }}>
          <div className="product-detail">
            <button className="modal-close" onClick={() => setSelectedProduct(null)} aria-label="Fechar detalhes" autoFocus>FECHAR ×</button>
            <div className="detail-gallery">
              <button className="detail-main-image" onClick={() => setZoomedImageIndex(Math.max(0, galleryImages.indexOf(activeImage)))} aria-label="Expandir imagem atual"><img src={activeImage} alt={selectedProduct.name} /><span>EXPANDIR ↗</span></button>
              <div className="detail-thumbs" aria-label="Galeria do produto">
                {galleryImages.map((image, index) => (
                  <button key={image} className={activeImage === image ? "active" : ""} onClick={() => setActiveImage(image)} aria-label={index === 0 ? "Ver imagem principal aprimorada" : `Ver ${selectedProduct.category === 'apparel' ? 'foto original de catálogo' : 'foto de QC'} ${index}`}>
                    <img src={image} alt="" />
                    <span>{selectedProduct.category === "apparel" && index === 0 ? "APRIMORADA" : selectedProduct.category === "apparel" && index === 1 ? "ORIGINAL" : index === 0 ? "CAPA" : `${selectedProduct.category === 'apparel' ? 'LOOK' : 'QC'} ${String(index).padStart(2, "0")}`}</span>
                  </button>
                ))}
              </div>
            </div>
            <aside className="detail-info">
              <p className="eyebrow">KICKNITY SELECTION / {selectedProduct.sku}</p>
              <h2>{selectedProduct.name}</h2>
              <p className="detail-price">R$ {selectedProduct.price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<small>produto unitário · frete calculado no pedido</small></p>
              <div className="detail-divider" />
              <p className="detail-description">{selectedProduct.description} {selectedProduct.category === 'apparel' ? 'Foto principal aprimorada digitalmente a partir da imagem de catálogo; foto original disponível na galeria. As fotos de QC do seu pedido serão enviadas após a chegada ao armazém.' : 'As fotos marcadas como QC são registros de inspeção no armazém.'}</p>
              <div className="detail-flags"><span>✓ {selectedProduct.weightGrams} G ESTIMADOS</span><span>✓ CUSTO TRANSPARENTE</span><span>✓ TAMANHO A CONFIRMAR</span></div>
              <button className="primary full" disabled={weight + selectedProduct.weightGrams > MAX_CART_WEIGHT_GRAMS} onClick={() => { if (changeQuantity(selectedProduct.id, 1)) { setSelectedProduct(null); setRoute("shop"); window.location.hash = "shop"; } }}>ADICIONAR AO PEDIDO <Arrow /></button>
              {weight + selectedProduct.weightGrams > MAX_CART_WEIGHT_GRAMS && <p className="cart-warning">Este item ultrapassa o limite de 6 kg do pedido.</p>}
            </aside>
          </div>
        </div>
      )}
      {selectedProduct && zoomedImageIndex !== null && (
        <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="Imagem ampliada do produto">
          <div className="lightbox-top"><span>{selectedProduct.category === 'apparel' ? zoomedImageIndex === 0 ? 'CATÁLOGO · IMAGEM APRIMORADA' : 'IMAGEM ORIGINAL DE CATÁLOGO' : zoomedImageIndex === 0 ? 'IMAGEM DE CATÁLOGO' : `FOTO DE QC ${String(zoomedImageIndex).padStart(2, '0')}`}</span><strong>{zoomedImageIndex + 1} / {galleryImages.length}</strong><button onClick={() => setZoomedImageIndex(null)}>FECHAR ×</button></div>
          <button className="lightbox-arrow prev" onClick={() => setZoomedImageIndex((zoomedImageIndex - 1 + galleryImages.length) % galleryImages.length)} aria-label="Imagem anterior">‹</button>
          <img src={galleryImages[zoomedImageIndex]} alt={`${selectedProduct.name} — imagem ${zoomedImageIndex + 1}`} />
          <button className="lightbox-arrow next" onClick={() => setZoomedImageIndex((zoomedImageIndex + 1) % galleryImages.length)} aria-label="Próxima imagem">›</button>
          <p>Use as setas para navegar</p>
        </div>
      )}
      <nav className="mobile-nav" aria-label="Navegação móvel">
        {(["home", "shop", "tracking"] as Route[]).map((item) => <button key={item} className={route === item ? "active" : ""} data-route={item}><span>{item === "home" ? "⌂" : item === "shop" ? "＋" : "⌖"}</span>{routeLabels[item]}</button>)}
        <button id="mobileAccountButton" className={route === "account" ? "active" : ""} onClick={openAccount}><span>○</span>Conta</button>
      </nav>
    </div>
  );
}
