(function(){
  "use strict";

  var SUPABASE_URL = "https://lgcvaxjsgymwueacqkec.supabase.co";
  var SUPABASE_KEY = "sb_publishable_Ksi21eNIkJQ6olvOSMAIPQ_4V2jBNWl";
  var client = null;
  var currentSession = null;
  var currentProfile = null;
  var currentOrders = [];
  var authReady = false;
  var accountChannel = null;
  var realtimeRefreshTimer = null;
  var currentMfaEnrollment = null;
  var currentQcPhotos = [];
  var currentQcIndex = 0;
  var qcTouchStart = null;
  var LAST_ACCOUNT_TAB_KEY = "kicknity-last-account-tab";

  function byId(id){ return document.getElementById(id); }
  function all(selector){ return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function clean(value){ return String(value == null ? "" : value).trim(); }
  function readLastAccountTab(){
    try{ return sessionStorage.getItem(LAST_ACCOUNT_TAB_KEY) || "overview"; }
    catch(error){ return "overview"; }
  }
  function rememberAccountTab(tab){
    try{ sessionStorage.setItem(LAST_ACCOUNT_TAB_KEY,tab); }
    catch(error){}
  }
  function forgetAccountTab(){
    try{ sessionStorage.removeItem(LAST_ACCOUNT_TAB_KEY); }
    catch(error){}
  }
  function escapeHtml(value){
    return String(value == null ? "" : value).replace(/[&<>'"]/g,function(char){
      return {"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char];
    });
  }
  function formatDate(value){
    if (!value) return "—";
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))){
      var parts = String(value).split("-");
      return parts[2] + "/" + parts[1] + "/" + parts[0];
    }
    var date = new Date(value);
    if (isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(date);
  }
  function formatMoney(value,currency){
    if (value == null || value === "") return "Valor a confirmar";
    return new Intl.NumberFormat("pt-BR",{style:"currency",currency:currency || "BRL"}).format(Number(value));
  }

  var STATUS_LABELS = {
    submitted:"Recebido", accepted:"Em atendimento", purchased:"Comprado",
    logistics:"Em transporte", warehouse:"Armazém / QC", shipped:"Enviado",
    delivered:"Entregue", cancelled:"Cancelado", parcel_submitted:"Pacote registrado",
    parcel_paid:"Pagamento confirmado", parcel_packaged:"Pacote embalado",
    tracking_registered:"Rastreio gerado", carrier_pending:"Aguardando transportadora"
  };
  var STATUS_DESCRIPTIONS = {
    submitted:"Pedido recebido. Aguardando atendimento.",
    accepted:"O agente assumiu o pedido e está falando com o vendedor.",
    purchased:"O produto foi comprado.",
    logistics:"A transportadora e o código de rastreio foram identificados.",
    warehouse:"O produto chegou ao armazém e está em inspeção de qualidade.",
    shipped:"O pedido foi enviado para o destino.",
    delivered:"Pedido entregue.",
    cancelled:"Pedido cancelado."
  };
  var ACCOUNT_TRACKING_STEPS = [
    {key:"submitted",label:"Recebido"},
    {key:"accepted",label:"Atendimento"},
    {key:"purchased",label:"Comprado"},
    {key:"logistics",label:"Transporte"},
    {key:"warehouse",label:"Armazém / QC"},
    {key:"shipped",label:"Enviado"},
    {key:"delivered",label:"Entregue"}
  ];

  function authMessage(message,type){
    var target = byId("authFeedback");
    if (!target) return;
    target.textContent = message || "";
    target.className = "auth-feedback" + (type ? " " + type : "");
  }
  function adminMessage(message,type){
    var target = byId("adminCreateFeedback");
    if (!target) return;
    target.textContent = message || "";
    target.className = "account-feedback" + (type ? " " + type : "");
  }
  function mfaMessage(message,type){
    var target = byId("adminMfaFeedback");
    if (!target) return;
    target.textContent = message || "";
    target.className = "account-feedback" + (type ? " " + type : "");
  }
  function friendlyError(error){
    var message = clean(error && error.message).toLowerCase();
    if (message.indexOf("invalid login") >= 0) return "E-mail ou senha incorretos.";
    if (message.indexOf("email not confirmed") >= 0) return "Confirme seu e-mail antes de entrar.";
    if (message.indexOf("already registered") >= 0 || message.indexOf("already been registered") >= 0) return "Este e-mail já possui uma conta.";
    if (message.indexOf("row-level security") >= 0 || message.indexOf("aal2") >= 0) return "Confirme o código do autenticador para liberar esta ação administrativa.";
    if (message.indexOf("password") >= 0 && message.indexOf("characters") >= 0) return "A senha precisa ter pelo menos 10 caracteres.";
    if (message.indexOf("rate limit") >= 0) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    return clean(error && error.message) || "Não foi possível concluir agora. Tente novamente.";
  }

  function showAuth(mode){
    setAuthMode(mode || "login");
    authMessage("");
    var dialog = byId("authDialog");
    if (dialog && !dialog.open) dialog.showModal();
  }
  function closeAuth(){
    var dialog = byId("authDialog");
    if (dialog && dialog.open) dialog.close();
  }
  function setAuthMode(mode){
    var login = mode === "login", signup = mode === "signup", recovery = mode === "recovery";
    byId("loginForm").hidden = !login;
    byId("signupForm").hidden = !signup;
    byId("recoveryForm").hidden = !recovery;
    byId("authTabs").hidden = recovery;
    all("[data-auth-mode]").forEach(function(button){ button.classList.toggle("active",button.getAttribute("data-auth-mode") === mode); });
  }

  function updateAuthUi(){
    var signedIn = !!currentSession;
    var label = signedIn ? "Minha conta" : "Entrar";
    if (byId("homeAccountButton")) byId("homeAccountButton").textContent = label;
    var navAccountLabel = byId("navAccountButton") && byId("navAccountButton").querySelector("span:first-child");
    if (navAccountLabel) navAccountLabel.textContent = label.toUpperCase();
    if (byId("mobileAccountButton")) byId("mobileAccountButton").innerHTML = "<span aria-hidden=\"true\">○</span>" + (signedIn ? "Conta" : "Entrar");
    if (byId("accountLogout")) byId("accountLogout").hidden = !signedIn;
    if (byId("homeAccountCard")) byId("homeAccountCard").hidden = !signedIn;
    if (byId("homeTrackingCard")) byId("homeTrackingCard").hidden = signedIn;
    if (byId("homeFaqCard")) byId("homeFaqCard").hidden = false;
    if (byId("homeTrackingSecondary")) byId("homeTrackingSecondary").hidden = !signedIn;
  }

  function goToAccount(){
    if (!currentSession){ showAuth("login"); return; }
    if (location.hash === "#conta") window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = "conta";
  }

  function isYagoPreviewAccount(){
    return clean(currentProfile && currentProfile.email).toLowerCase() === "lucaseumesmo007@gmail.com";
  }

  function isKicknityAdminAccount(){
    return clean(currentProfile && currentProfile.email).toLowerCase() === "kicknity@gmail.com";
  }

  function knownYagoParcel(order){
    if (clean(order && order.order_code).toUpperCase() !== "O260901502091") return null;
    return {
      id:"P260907637637",
      submitted_at:"2026-09-06",
      shipping:"BJ-EUB · 0–2 KG",
      shipping_price:"¥ 148,10",
      total_price:"¥ 167,39",
      insured_amount:"¥ 278,17",
      declaration:"Tênis unissex · branco · tamanho 45 · borracha · US$ 7,00",
      tracking_code:"LZ458955736CN",
      tracking_note:"O código foi gerado, mas ainda não consta nos registros dos Correios. Em breve ele entrará na base de dados."
    };
  }

  function yagoPreviewOrder(){
    return {
      id:"kicknity-yago-preview",
      user_id:currentSession && currentSession.user ? currentSession.user.id : null,
      order_code:"O260901502091",
      product_name:"Yeezy 350 V2 Bone",
      model_code:"HQ6316",
      image_url:"qc/orders/o260901502091/qc-01.webp",
      quantity:1,
      status:"shipped",
      carrier:"BJ-EUB",
      tracking_code:"LZ458955736CN",
      total_amount:null,
      currency:"BRL",
      ordered_at:"2026-09-01T06:06:15+00:00",
      updated_at:"2026-09-06",
      deleted_at:null,
      order_events:[
        {
          status:"submitted",
          description:"Pedido enviado. Aguardando o agente assumir o atendimento.",
          occurred_at:"2026-09-01T06:06:15+00:00"
        },
        {
          status:"accepted",
          description:"O agente assumiu o pedido e está se comunicando com o vendedor.",
          occurred_at:"2026-09-01T06:06:16+00:00"
        },
        {
          status:"purchased",
          description:"Seu produto foi comprado. Número da transação: 854836543275865.",
          occurred_at:"2026-09-01T06:06:18+00:00"
        },
        {
          status:"logistics",
          description:"Transportadora identificada: ZTO Express. Código de rastreio: 79029858827389.",
          occurred_at:"2026-09-03T06:06:15+00:00"
        },
        {
          status:"warehouse",
          description:"Seu produto chegou ao armazém da CSSBuy e está passando pela inspeção de qualidade.",
          occurred_at:"2026-09-04T13:19:33+00:00"
        },
        {
          status:"warehouse",
          description:"Pacote P260907637637 criado para envio internacional via BJ-EUB (0–2 kg).",
          occurred_at:"2026-09-06"
        },
        {
          status:"parcel_submitted",
          description:"Pacote enviado para processamento.",
          occurred_at:"2026-09-07T07:04:16-03:00"
        },
        {
          status:"parcel_paid",
          description:"Pagamento do pacote confirmado.",
          occurred_at:"2026-09-07T07:04:32-03:00"
        },
        {
          status:"parcel_packaged",
          description:"Pacote embalado e preparado para envio.",
          occurred_at:"2026-09-07T11:57:14-03:00"
        },
        {
          status:"tracking_registered",
          description:"As informações eletrônicas da remessa foram recebidas.",
          occurred_at:"2026-09-07T11:57:17-03:00"
        },
        {
          status:"shipped",
          description:"O pacote saiu do armazém da CSSBuy.",
          occurred_at:"2026-09-07T17:55:26-03:00"
        },
        {
          status:"carrier_pending",
          description:"Este é o seu código de rastreio: LZ458955736CN. As informações serão atualizadas quando o pacote chegar à transportadora, o que normalmente leva de 3 a 5 dias. Agradecemos a sua paciência.",
          occurred_at:"2026-09-09"
        }
      ]
    };
  }

  function sortedEvents(order){
    var events = (order.order_events || []).slice();
    var parcel = knownYagoParcel(order);
    if (parcel){
      if (!events.some(function(event){ return event.status === "warehouse"; })){
        events.push({
          status:"warehouse",
          description:"Seu produto chegou ao armazém da CSSBuy e está passando pela inspeção de qualidade.",
          occurred_at:"2026-09-04T13:19:33+00:00"
        });
      }
      if (!events.some(function(event){ return clean(event.description).indexOf(parcel.id) >= 0; })){
        events.push({
          status:"warehouse",
          description:"Pacote " + parcel.id + " criado para envio internacional via BJ-EUB (0–2 kg).",
          occurred_at:parcel.submitted_at
        });
      }
      [
        {status:"parcel_submitted",description:"Pacote enviado para processamento.",occurred_at:"2026-09-07T07:04:16-03:00"},
        {status:"parcel_paid",description:"Pagamento do pacote confirmado.",occurred_at:"2026-09-07T07:04:32-03:00"},
        {status:"parcel_packaged",description:"Pacote embalado e preparado para envio.",occurred_at:"2026-09-07T11:57:14-03:00"},
        {status:"tracking_registered",description:"As informações eletrônicas da remessa foram recebidas.",occurred_at:"2026-09-07T11:57:17-03:00"},
        {status:"shipped",description:"O pacote saiu do armazém da CSSBuy.",occurred_at:"2026-09-07T17:55:26-03:00"},
        {status:"carrier_pending",description:"Este é o seu código de rastreio: LZ458955736CN. As informações serão atualizadas quando o pacote chegar à transportadora, o que normalmente leva de 3 a 5 dias. Agradecemos a sua paciência.",occurred_at:"2026-09-09"}
      ].forEach(function(shipmentEvent){
        if (!events.some(function(event){ return event.occurred_at === shipmentEvent.occurred_at; })) events.push(shipmentEvent);
      });
    }
    return events.sort(function(a,b){ return new Date(b.occurred_at) - new Date(a.occurred_at); });
  }
  function effectiveStatus(order){
    return clean(order && order.order_code).toUpperCase() === "O260901502091" ? "carrier_pending" : order.status;
  }
  function trackingStepIndex(status){
    var index = ACCOUNT_TRACKING_STEPS.findIndex(function(step){ return step.key === status; });
    return index < 0 ? 0 : index;
  }
  function accountTimeline(order){
    var status = effectiveStatus(order);
    var current = trackingStepIndex(status);
    return ACCOUNT_TRACKING_STEPS.map(function(step,index){
      var state = status === "cancelled" ? "" : (index < current ? " done" : (index === current ? " current" : ""));
      return "<span class=\"tracking-step" + state + "\">" + escapeHtml(step.label) + "</span>";
    }).join("");
  }
  function accountHistory(order){
    var events = sortedEvents(order);
    if (!events.length){
      events = [{status:order.status,description:STATUS_DESCRIPTIONS[order.status] || "Atualização do pedido registrada.",occurred_at:order.updated_at || order.ordered_at}];
    }
    function renderItem(item,index){
      var description = item.status === "carrier_pending"
        ? "Atualização prevista em aproximadamente 3–5 dias."
        : (item.description || STATUS_DESCRIPTIONS[item.status] || "Atualização do pedido registrada.");
      return "<article class=\"tracking-history-item" + (index === 0 ? " current" : "") + "\">" +
        "<div class=\"tracking-history-top\"><span class=\"tracking-history-state\">" + escapeHtml(STATUS_LABELS[item.status] || item.status) + "</span><time>" + escapeHtml(formatDate(item.occurred_at)) + "</time></div>" +
        "<p>" + escapeHtml(description) + "</p>" +
      "</article>";
    }
    var recent = events.slice(0,3).map(renderItem).join("");
    var older = events.slice(3).map(function(item,index){ return renderItem(item,index + 3); }).join("");
    return recent + (older ? "<details class=\"tracking-history-more\"><summary>VER HISTÓRICO COMPLETO <span>+</span></summary><div>" + older + "</div></details>" : "");
  }
  function productPhoto(model){
    var normalized = clean(model).toUpperCase();
    var available = ["GW3773","GW3774","HQ6316","F36980","FW5190","HQ4540"];
    return available.indexOf(normalized) >= 0 ? "img/qc/" + normalized.toLowerCase() + "-1.webp" : "";
  }
  function orderQcPhotos(order){
    if (clean(order && order.order_code).toUpperCase() !== "O260901502091") return [];
    return Array.from({length:9},function(_,index){
      return "qc/orders/o260901502091/qc-" + String(index + 1).padStart(2,"0") + ".webp";
    });
  }
  function orderProductPhoto(order){
    var photos = orderQcPhotos(order);
    return photos[0] || clean(order && order.image_url) || productPhoto(order && order.model_code);
  }
  function orderQcGallery(order){
    var photos = orderQcPhotos(order);
    if (!photos.length) return "";
    return "<section class=\"account-order-qc\"><div class=\"account-order-qc-head\"><div><span>FOTOS REAIS DO PRODUTO</span><strong>INSPEÇÃO DE QUALIDADE</strong></div><small>" + photos.length + " FOTOS DISPONÍVEIS</small></div><div class=\"account-order-qc-grid\">" +
      photos.map(function(photo,index){
        return "<button type=\"button\" data-order-qc=\"" + escapeHtml(order.id) + "\" data-qc-index=\"" + index + "\" aria-label=\"Ampliar foto real " + (index + 1) + "\"><img src=\"" + escapeHtml(photo) + "\" alt=\"Foto real " + (index + 1) + " de " + escapeHtml(order.product_name) + "\" loading=\"lazy\"></button>";
      }).join("") + "</div><p class=\"account-order-qc-note\">Clique em uma foto para ampliar e conferir os detalhes do produto.</p></section>";
  }
  function orderParcelDetails(order){
    var parcel = knownYagoParcel(order);
    if (!parcel) return "";
    return "<div class=\"tracking-code-block\"><span class=\"tracking-code-label\">CÓDIGO DE RASTREIO</span>" +
      "<button type=\"button\" class=\"tracking-copy-button\" data-copy-tracking=\"" + escapeHtml(parcel.tracking_code) + "\" aria-label=\"Copiar código de rastreio " + escapeHtml(parcel.tracking_code) + "\"><strong>" + escapeHtml(parcel.tracking_code) + "</strong><span class=\"copy-glyph\" aria-hidden=\"true\"></span></button></div>" +
      "<details class=\"account-parcel tracking-shipping-details\"><summary>DETALHES DO ENVIO <span>+</span></summary><div class=\"account-parcel-content\">" +
      "<div class=\"account-parcel-grid\">" +
        "<div><span>Pacote</span><strong>" + escapeHtml(parcel.id) + "</strong></div>" +
        "<div><span>Modalidade</span><strong>" + escapeHtml(parcel.shipping) + "</strong></div>" +
        "<div><span>Frete</span><strong>" + escapeHtml(parcel.shipping_price) + "</strong></div>" +
        "<div><span>Total</span><strong>" + escapeHtml(parcel.total_price) + "</strong></div>" +
        "<div><span>Seguro declarado</span><strong>" + escapeHtml(parcel.insured_amount) + "</strong></div>" +
      "</div>" +
      "<p class=\"tracking-postal-note\">" + escapeHtml(parcel.tracking_note) + "</p>" +
      "<div class=\"account-declaration\"><span>DECLARAÇÃO ADUANEIRA</span><strong>" + escapeHtml(parcel.declaration) + "</strong></div>" +
      "</div></details>";
  }
  function orderTrackingCard(order){
    var events = sortedEvents(order);
    var status = effectiveStatus(order);
    var latest = events[0] || {description:STATUS_DESCRIPTIONS[status],occurred_at:order.updated_at || order.ordered_at};
    var image = orderProductPhoto(order);
    var productVisual = image
      ? "<div class=\"tracking-photo\"><img src=\"" + escapeHtml(image) + "\" alt=\"Foto de " + escapeHtml(order.product_name) + "\"></div>"
      : "<div class=\"tracking-photo account-tracking-placeholder\" aria-hidden=\"true\"><span>K</span></div>";
    return "<article class=\"account-tracking-card tracking-animate" + (status === "cancelled" ? " cancelled" : "") + "\" data-order-id=\"" + order.id + "\" data-status=\"" + escapeHtml(status) + "\" data-updated-at=\"" + escapeHtml(latest.occurred_at || "") + "\">" +
      "<div class=\"account-tracking-label\"><span>ACOMPANHAMENTO AUTOMÁTICO</span><small>Atualiza sem pesquisar o código</small></div>" +
      "<div class=\"tracking-result account-tracking-result\">" +
        "<div class=\"tracking-product\">" + productVisual + "<div><h3>" + escapeHtml(order.product_name) + "</h3><p class=\"tracking-model\">Modelo " + escapeHtml(order.model_code || "não informado") + "</p></div></div>" +
        "<div class=\"tracking-order\">" +
          "<div class=\"tracking-order-head\"><div><span class=\"tracking-code-label\">Código do pedido</span><strong class=\"tracking-code\">" + escapeHtml(order.order_code) + "</strong></div><span class=\"tracking-badge\">" + escapeHtml(STATUS_LABELS[status] || status) + "</span></div>" +
          orderParcelDetails(order) +
          "<section class=\"tracking-current\"><span class=\"tracking-current-kicker\">ETAPA ATUAL</span><div><h4>" + escapeHtml(STATUS_LABELS[status] || status) + "</h4><time class=\"tracking-time\">" + escapeHtml(formatDate(latest.occurred_at)) + "</time></div><p>" + escapeHtml(status === "carrier_pending" ? "Atualização prevista em aproximadamente 3–5 dias." : (latest.description || STATUS_DESCRIPTIONS[status] || "Atualização registrada.")) + "</p>" + (!knownYagoParcel(order) && order.tracking_code ? "<span class=\"account-tracking-code\">Rastreio: " + escapeHtml(order.tracking_code) + "</span>" : "") + "</section>" +
          "<section class=\"tracking-history-wrap\"><h5>Histórico do pedido</h5><div class=\"tracking-history\">" + accountHistory(order) + "</div></section>" +
          orderQcGallery(order) +
        "</div>" +
      "</div>" +
    "</article>";
  }
  function orderCard(order,admin){
    var events = sortedEvents(order);
    var latest = events[0];
    var status = effectiveStatus(order);
    var archived = !!order.deleted_at;
    var customer = admin && order.profiles ? "<span class=\"admin-client\">Cliente: " + escapeHtml(order.profiles.full_name || order.profiles.email) + " · " + escapeHtml(order.profiles.email) + "</span>" : "";
    var editor = admin && !archived ? (
      "<div class=\"admin-order-editor\">" +
        "<select data-admin-field=\"status\" aria-label=\"Status do pedido\">" + Object.keys(STATUS_LABELS).map(function(status){ return "<option value=\"" + status + "\"" + (order.status === status ? " selected" : "") + ">" + STATUS_LABELS[status] + "</option>"; }).join("") + "</select>" +
        "<input data-admin-field=\"tracking\" value=\"" + escapeHtml(order.tracking_code || "") + "\" placeholder=\"Código de rastreio\" aria-label=\"Código de rastreio\">" +
        "<button type=\"button\" data-admin-update=\"" + order.id + "\">Salvar</button>" +
        "<button class=\"admin-delete-order\" type=\"button\" data-admin-delete=\"" + order.id + "\">Arquivar</button>" +
      "</div>"
    ) : (admin && archived ? "<div class=\"admin-order-editor\"><button class=\"admin-restore-order\" type=\"button\" data-admin-restore=\"" + order.id + "\">Restaurar pedido</button></div>" : "");
    return "<article class=\"account-order-card" + (archived ? " archived" : "") + "\" data-order-id=\"" + order.id + "\">" +
      "<div class=\"account-order-top\"><div><span class=\"account-order-code\">" + escapeHtml(order.order_code) + "</span><h4>" + escapeHtml(order.product_name) + "</h4></div><span class=\"account-status\">" + escapeHtml(archived ? "Arquivado" : (STATUS_LABELS[status] || status)) + "</span></div>" +
      customer +
      "<div class=\"account-order-meta\"><span>Modelo: " + escapeHtml(order.model_code || "—") + "</span><span>Qtd.: " + escapeHtml(order.quantity) + "</span><span>" + escapeHtml(formatMoney(order.total_amount,order.currency)) + "</span>" + (!knownYagoParcel(order) && order.tracking_code ? "<span>Rastreio: " + escapeHtml(order.tracking_code) + "</span>" : "") + "</div>" +
      (latest ? "<div class=\"account-order-event\">" + escapeHtml(latest.description) + "<time>" + escapeHtml(formatDate(latest.occurred_at)) + "</time></div>" : "") + editor +
    "</article>";
  }

  function compactDate(value){
    if (!value) return "—";
    var date = new Date(value);
    if (isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"2-digit"}).format(date);
  }

  function desktopRecentOrder(order){
    var events = sortedEvents(order);
    var latest = events[0];
    var updated = latest ? latest.occurred_at : (order.updated_at || order.ordered_at);
    var image = orderProductPhoto(order);
    var thumb = image ? "<img src=\"" + escapeHtml(image) + "\" alt=\"\">" : escapeHtml(order.model_code || "K");
    var status = effectiveStatus(order);
    return "<article class=\"account-desktop-order\">" +
      "<span class=\"account-desktop-order-thumb\">" + thumb + "</span>" +
      "<span class=\"account-desktop-order-copy\"><strong>" + escapeHtml(order.product_name) + "</strong><small>" + escapeHtml(order.order_code) + " · " + escapeHtml(order.quantity) + " produto" + (Number(order.quantity) === 1 ? "" : "s") + "</small></span>" +
      "<span class=\"account-desktop-order-state\"><b>" + escapeHtml(STATUS_LABELS[status] || status) + "</b><small>" + escapeHtml(formatDate(updated)) + "</small></span>" +
    "</article>";
  }

  function renderDesktopOverview(total,active,delivered){
    byId("accountDesktopOrdersCount").textContent = String(total).padStart(2,"0");
    byId("accountDesktopActiveCount").textContent = String(active).padStart(2,"0");
    byId("accountDesktopDeliveredCount").textContent = String(delivered).padStart(2,"0");

    var recent = currentOrders.slice(0,2);
    byId("accountDesktopRecentOrders").innerHTML = recent.length
      ? recent.map(desktopRecentOrder).join("")
      : "<div class=\"account-empty\">Nenhum pedido vinculado ainda.</div>";

    var activities = [];
    currentOrders.forEach(function(order){
      var events = sortedEvents(order);
      if (!events.length) events = [{status:order.status,description:STATUS_DESCRIPTIONS[order.status],occurred_at:order.updated_at || order.ordered_at}];
      events.forEach(function(event){ activities.push({event:event,order:order}); });
    });
    activities.sort(function(a,b){ return new Date(b.event.occurred_at) - new Date(a.event.occurred_at); });
    activities = activities.slice(0,3);

    var newest = activities[0];
    byId("accountDesktopLastUpdate").textContent = newest ? compactDate(newest.event.occurred_at) : "—";
    byId("accountDesktopLastUpdateLabel").textContent = newest
      ? (newest.event.description || STATUS_LABELS[newest.event.status] || "Atualização registrada")
      : "Nenhuma atualização";
    byId("accountDesktopActivity").innerHTML = activities.length
      ? activities.map(function(item){
          return "<article class=\"account-desktop-activity-item\"><strong>" + escapeHtml(STATUS_LABELS[item.event.status] || item.event.status) + "</strong><small>" + escapeHtml(item.event.description || item.order.order_code) + "</small></article>";
        }).join("")
      : "<div class=\"account-empty\">Nenhuma atualização registrada.</div>";
  }

  function renderCustomerOrders(){
    var total = currentOrders.length;
    var active = currentOrders.filter(function(order){ return order.status !== "delivered" && order.status !== "cancelled"; }).length;
    var delivered = currentOrders.filter(function(order){ return order.status === "delivered"; }).length;
    byId("accountOrdersCount").textContent = total;
    byId("accountActiveCount").textContent = active;
    byId("accountDeliveredCount").textContent = delivered;
    byId("accountLatestOrder").innerHTML = total ? orderCard(currentOrders[0],false) : "Nenhum pedido vinculado ainda.";
    byId("accountLatestOrder").classList.toggle("account-empty",!total);
    byId("accountOrderList").innerHTML = total ? currentOrders.map(orderTrackingCard).join("") : "<div class=\"account-empty\">Seus pedidos aparecerão aqui quando forem vinculados pelo atendimento.</div>";
    renderDesktopOverview(total,active,delivered);
  }

  function skeletonCards(count){
    return Array.from({length:count},function(){
      return "<div class=\"account-skeleton\" aria-hidden=\"true\"><span></span><span></span><span></span></div>";
    }).join("");
  }

  function showOrdersSkeleton(){
    if (currentOrders.length) return;
    byId("accountOrderList").innerHTML = skeletonCards(2);
    byId("accountDesktopRecentOrders").innerHTML = skeletonCards(2);
    byId("accountLatestOrder").innerHTML = skeletonCards(1);
    byId("accountLatestOrder").classList.remove("account-empty");
  }

  async function loadProfile(){
    if (!client || !currentSession) return null;
    var response = await client.from("profiles").select("id,email,full_name,role,created_at").eq("id",currentSession.user.id).single();
    if (response.error) throw response.error;
    currentProfile = response.data;
    var yagoPreview = isYagoPreviewAccount();
    byId("accountIdentity").textContent = yagoPreview ? "Yago Moraes · Cliente verificado" : (currentProfile.full_name || "Cliente") + " · " + currentProfile.email;
    var isAdmin = currentProfile.role === "admin";
    var fullName = yagoPreview ? "Yago Moraes" : (clean(currentProfile.full_name) || "Cliente KICKNITY");
    var displayEmail = yagoPreview ? "Cliente · E-mail verificado" : currentProfile.email;
    var nameParts = fullName.split(/\s+/).filter(Boolean);
    var firstName = nameParts[0] || "Cliente";
    var initials = ((nameParts[0] || "K").charAt(0) + (nameParts.length > 1 ? nameParts[nameParts.length - 1].charAt(0) : "")).toUpperCase();
    byId("accountDesktopName").textContent = fullName;
    byId("accountDesktopEmail").textContent = displayEmail;
    byId("accountDesktopAvatar").textContent = initials;
    byId("accountDesktopGreeting").textContent = "Olá, " + firstName + ".";
    var verified = !!(currentSession.user && currentSession.user.email_confirmed_at);
    byId("accountVerifiedBadge").textContent = verified ? "E-MAIL VERIFICADO" : "E-MAIL PENDENTE";
    byId("accountVerifiedBadge").classList.toggle("pending",!verified);
    all("[data-admin-account-tab]").forEach(function(button){ button.hidden = !isAdmin; });
    byId("adminTabButton").hidden = !isAdmin;
    return currentProfile;
  }

  async function loadOrders(){
    if (!client || !currentSession) return;
    showOrdersSkeleton();
    var response = await client.from("orders").select("*,order_events(*)").eq("user_id",currentSession.user.id).is("deleted_at",null).order("updated_at",{ascending:false});
    if (response.error) throw response.error;
    var savedOrders = response.data || [];
    if (isYagoPreviewAccount()){
      currentOrders = [yagoPreviewOrder()];
    }else if (isKicknityAdminAccount()){
      currentOrders = savedOrders.some(function(order){ return clean(order.order_code).toUpperCase() === "O260901502091"; })
        ? savedOrders
        : [yagoPreviewOrder()].concat(savedOrders);
    }else{
      currentOrders = savedOrders;
    }
    renderCustomerOrders();
  }

  function scheduleRealtimeRefresh(){
    clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = setTimeout(function(){
      loadOrders().catch(console.error);
      if (currentProfile && currentProfile.role === "admin") loadAdmin().catch(console.error);
    },180);
  }

  function subscribeToAccountOrders(){
    if (!client || !currentSession) return;
    if (accountChannel){ client.removeChannel(accountChannel); accountChannel = null; }
    accountChannel = client.channel("kicknity-orders-" + currentSession.user.id)
      .on("postgres_changes",{event:"*",schema:"public",table:"orders",filter:"user_id=eq." + currentSession.user.id},scheduleRealtimeRefresh)
      .on("postgres_changes",{event:"*",schema:"public",table:"order_events"},scheduleRealtimeRefresh)
      .subscribe();
  }

  function setMfaState(label,state,description){
    var badge = byId("adminMfaBadge");
    badge.textContent = label;
    badge.className = "admin-security-badge" + (state ? " " + state : "");
    byId("adminMfaDescription").textContent = description;
  }

  async function loadMfaSecurity(){
    if (!client || !currentProfile || currentProfile.role !== "admin") return;
    byId("adminMfaStart").hidden = true;
    byId("adminMfaSetup").hidden = true;
    byId("adminMfaEnrollForm").hidden = true;
    byId("adminMfaChallengeForm").hidden = true;
    mfaMessage("");

    var results = await Promise.all([
      client.auth.mfa.listFactors(),
      client.auth.mfa.getAuthenticatorAssuranceLevel()
    ]);
    if (results[0].error) throw results[0].error;
    if (results[1].error) throw results[1].error;

    var verified = (results[0].data.totp || []).filter(function(factor){ return factor.status === "verified"; });
    var assurance = results[1].data || {};
    if (!verified.length){
      setMfaState("Recomendado","warning","Ative um aplicativo autenticador. Depois disso, criar, alterar, arquivar ou restaurar pedidos exigirá o código de segurança.");
      byId("adminMfaStart").hidden = false;
      return;
    }
    if (assurance.currentLevel === "aal2"){
      setMfaState("Protegido","secure","Autenticação em duas etapas confirmada nesta sessão. As ações administrativas estão liberadas.");
      return;
    }
    setMfaState("Código necessário","warning","Sua conta já possui autenticação em duas etapas. Confirme o código para liberar as ações administrativas desta sessão.");
    byId("adminMfaChallengeForm").hidden = false;
  }

  async function beginMfaEnrollment(){
    var button = byId("adminMfaStart");
    button.disabled = true;
    mfaMessage("Gerando proteção…");
    try{
      var factors = await client.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      var pending = (factors.data.totp || []).filter(function(factor){ return factor.status !== "verified"; });
      await Promise.all(pending.map(function(factor){ return client.auth.mfa.unenroll({factorId:factor.id}); }));
      var response = await client.auth.mfa.enroll({factorType:"totp",friendlyName:"KICKNITY Admin"});
      if (response.error) throw response.error;
      currentMfaEnrollment = response.data;
      var qrCode = clean(response.data && response.data.totp && response.data.totp.qr_code);
      if (qrCode.indexOf("data:image/svg+xml") !== 0) throw new Error("QR Code de segurança inválido.");
      byId("adminMfaQr").src = qrCode;
      byId("adminMfaSecret").textContent = clean(response.data.totp.secret);
      byId("adminMfaSetup").hidden = false;
      byId("adminMfaEnrollForm").hidden = false;
      button.hidden = true;
      mfaMessage("Escaneie o QR Code e digite o código de 6 dígitos.","success");
      byId("adminMfaEnrollCode").focus();
    }catch(error){ mfaMessage(friendlyError(error),"error"); }
    finally{ button.disabled = false; }
  }

  async function verifyMfaFactor(factorId,code){
    var challenge = await client.auth.mfa.challenge({factorId:factorId});
    if (challenge.error) throw challenge.error;
    var verification = await client.auth.mfa.verify({factorId:factorId,challengeId:challenge.data.id,code:code});
    if (verification.error) throw verification.error;
  }

  async function submitMfaEnrollment(event){
    event.preventDefault();
    var button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    mfaMessage("Confirmando código…");
    try{
      if (!currentMfaEnrollment || !currentMfaEnrollment.id) throw new Error("Inicie novamente a configuração do autenticador.");
      await verifyMfaFactor(currentMfaEnrollment.id,clean(byId("adminMfaEnrollCode").value));
      currentMfaEnrollment = null;
      byId("adminMfaEnrollCode").value = "";
      mfaMessage("Autenticação em duas etapas ativada.","success");
      await loadMfaSecurity();
      await loadAdmin();
    }catch(error){ mfaMessage(friendlyError(error),"error"); }
    finally{ button.disabled = false; }
  }

  async function submitMfaChallenge(event){
    event.preventDefault();
    var button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    mfaMessage("Verificando código…");
    try{
      var factors = await client.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      var factor = (factors.data.totp || []).find(function(item){ return item.status === "verified"; });
      if (!factor) throw new Error("Nenhum autenticador ativo foi encontrado.");
      await verifyMfaFactor(factor.id,clean(byId("adminMfaChallengeCode").value));
      byId("adminMfaChallengeCode").value = "";
      mfaMessage("Administração liberada nesta sessão.","success");
      await loadMfaSecurity();
      await loadAdmin();
    }catch(error){ mfaMessage(friendlyError(error),"error"); }
    finally{ button.disabled = false; }
  }

  async function loadAdmin(){
    if (!client || !currentProfile || currentProfile.role !== "admin") return;
    var results = await Promise.all([
      client.from("profiles").select("id,email,full_name,role").order("created_at",{ascending:false}),
      client.from("orders").select("*,profiles:profiles!orders_user_id_fkey(email,full_name),order_events(*)").order("updated_at",{ascending:false})
    ]);
    if (results[0].error) throw results[0].error;
    if (results[1].error) throw results[1].error;
    var customers = results[0].data || [];
    byId("adminCustomer").innerHTML = "<option value=\"\">Selecione</option>" + customers.map(function(profile){ return "<option value=\"" + profile.id + "\">" + escapeHtml(profile.full_name || profile.email) + " · " + escapeHtml(profile.email) + "</option>"; }).join("");
    var orders = results[1].data || [];
    byId("adminOrderList").innerHTML = orders.length ? orders.map(function(order){ return orderCard(order,true); }).join("") : "<div class=\"account-empty\">Nenhum pedido cadastrado.</div>";
    await loadMfaSecurity();
  }

  async function loadAccount(){
    if (!currentSession || !client) return;
    byId("accountIdentity").textContent = "Carregando seus dados…";
    try{
      await loadProfile();
      await loadOrders();
      if (currentProfile.role === "admin") await loadAdmin();
    }catch(error){
      byId("accountIdentity").textContent = "Não foi possível carregar a conta agora.";
      console.error("Kicknity account load:",error);
    }
  }

  function updateAccountIndicator(tab){
    requestAnimationFrame(function(){
      var nav = document.querySelector(".account-desktop-nav");
      var active = nav && nav.querySelector('[data-account-tab="' + tab + '"]:not([hidden])');
      if (!nav || !active) return;
      nav.style.setProperty("--active-y",active.offsetTop + "px");
      nav.classList.add("indicator-ready");
    });
  }

  function selectAccountTab(tab,skipLoad){
    if (tab === "admin" && (!currentProfile || currentProfile.role !== "admin")) tab = "overview";
    if (["overview","orders","admin"].indexOf(tab) < 0) tab = "overview";
    rememberAccountTab(tab);
    all("[data-account-tab]").forEach(function(button){ button.classList.toggle("active",button.getAttribute("data-account-tab") === tab); });
    all("[data-account-view]").forEach(function(view){
      var selected = view.getAttribute("data-account-view") === tab;
      view.hidden = !selected;
      if (selected){
        view.classList.remove("account-view-enter");
        requestAnimationFrame(function(){ view.classList.add("account-view-enter"); });
      }
    });
    updateAccountIndicator(tab);
    if (!skipLoad && tab === "orders") loadOrders().catch(console.error);
    if (!skipLoad && tab === "admin") loadAdmin().catch(function(error){ adminMessage(friendlyError(error),"error"); });
  }

  async function handleSession(session,event){
    currentSession = session || null;
    authReady = true;
    if (!currentSession){
      currentProfile = null; currentOrders = [];
      forgetAccountTab();
      if (accountChannel && client){ client.removeChannel(accountChannel); accountChannel = null; }
    }
    updateAuthUi();
    if (event === "PASSWORD_RECOVERY"){
      setAuthMode("recovery"); authMessage("Defina sua nova senha.");
      var dialog = byId("authDialog"); if (dialog && !dialog.open) dialog.showModal();
      return;
    }
    if (currentSession){
      subscribeToAccountOrders();
      closeAuth();
      if (location.hash === "#conta"){
        await loadAccount();
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    }else if (document.body.classList.contains("route-conta")){
      location.hash = "";
    }
  }

  async function submitLogin(event){
    event.preventDefault(); authMessage("Entrando…");
    var button = event.currentTarget.querySelector("button[type=submit]"); button.disabled = true;
    try{
      var response = await client.auth.signInWithPassword({email:clean(byId("loginEmail").value),password:byId("loginPassword").value});
      if (response.error) throw response.error;
      authMessage("Acesso confirmado.","success");
      setTimeout(goToAccount,80);
    }catch(error){ authMessage(friendlyError(error),"error"); }
    finally{ button.disabled = false; }
  }

  async function submitSignup(event){
    event.preventDefault(); authMessage("Criando sua conta…");
    var button = event.currentTarget.querySelector("button[type=submit]"); button.disabled = true;
    try{
      var redirect = location.origin + location.pathname;
      var response = await client.auth.signUp({
        email:clean(byId("signupEmail").value), password:byId("signupPassword").value,
        options:{emailRedirectTo:redirect,data:{full_name:clean(byId("signupName").value)}}
      });
      if (response.error) throw response.error;
      if (response.data.session){ authMessage("Conta criada e conectada.","success"); setTimeout(goToAccount,80); }
      else authMessage("Conta criada. Confira seu e-mail para confirmar o acesso.","success");
    }catch(error){ authMessage(friendlyError(error),"error"); }
    finally{ button.disabled = false; }
  }

  async function sendRecovery(){
    var email = clean(byId("loginEmail").value);
    if (!email){ authMessage("Digite seu e-mail primeiro.","error"); byId("loginEmail").focus(); return; }
    authMessage("Enviando instruções…");
    try{
      var response = await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin + location.pathname});
      if (response.error) throw response.error;
      authMessage("Se o e-mail estiver cadastrado, você receberá o link para trocar a senha.","success");
    }catch(error){ authMessage(friendlyError(error),"error"); }
  }

  async function submitRecovery(event){
    event.preventDefault(); authMessage("Salvando…");
    var button = event.currentTarget.querySelector("button[type=submit]"); button.disabled = true;
    try{
      var response = await client.auth.updateUser({password:byId("recoveryPassword").value});
      if (response.error) throw response.error;
      authMessage("Senha atualizada com sucesso.","success");
      setTimeout(function(){ closeAuth(); goToAccount(); },650);
    }catch(error){ authMessage(friendlyError(error),"error"); }
    finally{ button.disabled = false; }
  }

  async function createOrder(event){
    event.preventDefault(); adminMessage("Criando pedido…");
    var form = event.currentTarget;
    var button = form.querySelector("button[type=submit]"); button.disabled = true;
    var amount = clean(byId("adminTotalAmount").value);
    var modelCode = clean(byId("adminModelCode").value).toUpperCase();
    var payload = {
      user_id:byId("adminCustomer").value,
      order_code:clean(byId("adminOrderCode").value).toUpperCase(),
      product_name:clean(byId("adminProductName").value),
      model_code:modelCode || null,
      image_url:productPhoto(modelCode) || null,
      public_tracking_enabled:true,
      quantity:Number(byId("adminQuantity").value) || 1,
      status:byId("adminStatus").value,
      carrier:clean(byId("adminCarrier").value) || null,
      tracking_code:clean(byId("adminTrackingCode").value) || null,
      total_amount:amount ? Number(amount) : null,
      notes:clean(byId("adminNotes").value) || null
    };
    try{
      var response = await client.from("orders").insert(payload).select().single();
      if (response.error) throw response.error;
      form.reset(); byId("adminQuantity").value = "1";
      adminMessage("Pedido criado e vinculado ao cliente.","success");
      await Promise.all([loadAdmin(),loadOrders()]);
    }catch(error){ adminMessage(friendlyError(error),"error"); }
    finally{ button.disabled = false; }
  }

  async function updateAdminOrder(button){
    var card = button.closest("[data-order-id]");
    if (!card) return;
    button.disabled = true; button.textContent = "Salvando";
    var status = card.querySelector('[data-admin-field="status"]').value;
    var tracking = clean(card.querySelector('[data-admin-field="tracking"]').value) || null;
    try{
      var response = await client.from("orders").update({status:status,tracking_code:tracking}).eq("id",Number(card.getAttribute("data-order-id"))).select().single();
      if (response.error) throw response.error;
      button.textContent = "Salvo ✓";
      await Promise.all([loadAdmin(),loadOrders()]);
    }catch(error){ button.textContent = "Erro"; adminMessage(friendlyError(error),"error"); }
    finally{ button.disabled = false; }
  }

  async function deleteAdminOrder(button){
    var card = button.closest("[data-order-id]");
    if (!card) return;
    var orderId = Number(card.getAttribute("data-order-id"));
    var orderCode = clean(card.querySelector(".account-order-code") && card.querySelector(".account-order-code").textContent) || String(orderId);
    if (!window.confirm("Arquivar o pedido " + orderCode + "? Ele sairá da conta do cliente, mas poderá ser restaurado.")) return;
    button.disabled = true; button.textContent = "Arquivando";
    try{
      var response = await client.from("orders").update({
        deleted_at:new Date().toISOString(),
        deleted_by:currentSession.user.id,
        deleted_reason:"Arquivado pelo painel administrativo"
      }).eq("id",orderId).select().single();
      if (response.error) throw response.error;
      adminMessage("Pedido " + orderCode + " arquivado. Ele pode ser restaurado.","success");
      await Promise.all([loadAdmin(),loadOrders()]);
    }catch(error){
      button.disabled = false; button.textContent = "Arquivar";
      adminMessage(friendlyError(error),"error");
    }
  }

  async function restoreAdminOrder(button){
    var card = button.closest("[data-order-id]");
    if (!card) return;
    var orderId = Number(card.getAttribute("data-order-id"));
    button.disabled = true; button.textContent = "Restaurando";
    try{
      var response = await client.from("orders").update({deleted_at:null,deleted_by:null,deleted_reason:null}).eq("id",orderId).select().single();
      if (response.error) throw response.error;
      adminMessage("Pedido restaurado e novamente visível para o cliente.","success");
      await Promise.all([loadAdmin(),loadOrders()]);
    }catch(error){
      button.disabled = false; button.textContent = "Restaurar pedido";
      adminMessage(friendlyError(error),"error");
    }
  }

  function showOrderQc(index){
    if (!currentQcPhotos.length) return;
    currentQcIndex = (index + currentQcPhotos.length) % currentQcPhotos.length;
    byId("accountQcImage").src = currentQcPhotos[currentQcIndex];
    byId("accountQcCount").textContent = (currentQcIndex + 1) + " / " + currentQcPhotos.length;
    byId("accountQcLightbox").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function openOrderQc(orderId,index){
    var order = currentOrders.find(function(item){ return String(item.id) === String(orderId); });
    if (!order) return;
    currentQcPhotos = orderQcPhotos(order);
    if (!currentQcPhotos.length) return;
    byId("accountQcLabel").textContent = clean(order.product_name).toUpperCase() + " · FOTO REAL DE QC";
    showOrderQc(Number(index) || 0);
  }

  function closeOrderQc(){
    byId("accountQcLightbox").hidden = true;
    byId("accountQcImage").removeAttribute("src");
    currentQcPhotos = [];
    document.body.style.overflow = "";
  }

  async function copyTrackingCode(button){
    var code = clean(button.getAttribute("data-copy-tracking"));
    if (!code) return;
    try{
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(code);
      else{
        var helper = document.createElement("textarea");
        helper.value = code;
        helper.setAttribute("readonly","");
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        document.execCommand("copy");
        helper.remove();
      }
      button.classList.add("copied");
      button.setAttribute("aria-label","Código copiado");
      setTimeout(function(){
        button.classList.remove("copied");
        button.setAttribute("aria-label","Copiar código de rastreio " + code);
      },1800);
    }catch(error){
      button.setAttribute("aria-label","Não foi possível copiar o código");
    }
  }

  function stepOrderQc(direction){
    if (currentQcPhotos.length) showOrderQc(currentQcIndex + direction);
  }

  function wire(){
    ["homeAccountButton","navAccountButton"].forEach(function(id){ byId(id).addEventListener("click",goToAccount); });
    byId("authClose").addEventListener("click",closeAuth);
    byId("authDialog").addEventListener("click",function(event){ if (event.target === byId("authDialog")) closeAuth(); });
    all("[data-auth-mode]").forEach(function(button){ button.addEventListener("click",function(){ setAuthMode(button.getAttribute("data-auth-mode")); authMessage(""); }); });
    byId("loginForm").addEventListener("submit",submitLogin);
    byId("signupForm").addEventListener("submit",submitSignup);
    byId("recoveryForm").addEventListener("submit",submitRecovery);
    byId("forgotPassword").addEventListener("click",sendRecovery);
    ["accountLogout","accountDesktopLogout"].forEach(function(id){ byId(id).addEventListener("click",async function(){ forgetAccountTab(); await client.auth.signOut(); location.hash = ""; }); });
    all("[data-account-tab]").forEach(function(button){ button.addEventListener("click",function(){ selectAccountTab(button.getAttribute("data-account-tab")); }); });
    all("[data-open-account-orders]").forEach(function(button){ button.addEventListener("click",function(){ selectAccountTab("orders"); }); });
    byId("accountOrderList").addEventListener("click",function(event){
      var copyButton = event.target.closest("[data-copy-tracking]");
      if (copyButton){ copyTrackingCode(copyButton); return; }
      var button = event.target.closest("[data-order-qc]");
      if (button) openOrderQc(button.getAttribute("data-order-qc"),button.getAttribute("data-qc-index"));
    });
    byId("accountQcClose").addEventListener("click",closeOrderQc);
    byId("accountQcPrev").addEventListener("click",function(){ stepOrderQc(-1); });
    byId("accountQcNext").addEventListener("click",function(){ stepOrderQc(1); });
    byId("accountQcLightbox").addEventListener("click",function(event){ if (event.target === byId("accountQcLightbox")) closeOrderQc(); });
    byId("accountQcLightbox").addEventListener("touchstart",function(event){ qcTouchStart = event.changedTouches[0].clientX; },{passive:true});
    byId("accountQcLightbox").addEventListener("touchend",function(event){
      if (qcTouchStart == null) return;
      var delta = event.changedTouches[0].clientX - qcTouchStart;
      qcTouchStart = null;
      if (Math.abs(delta) > 45) stepOrderQc(delta > 0 ? -1 : 1);
    },{passive:true});
    window.addEventListener("keydown",function(event){
      if (byId("accountQcLightbox").hidden) return;
      if (event.key === "Escape") closeOrderQc();
      else if (event.key === "ArrowLeft") stepOrderQc(-1);
      else if (event.key === "ArrowRight") stepOrderQc(1);
    });
    byId("refreshAccountOrders").addEventListener("click",function(){ loadOrders().catch(console.error); });
    byId("refreshAdminOrders").addEventListener("click",function(){ loadAdmin().catch(function(error){ adminMessage(friendlyError(error),"error"); }); });
    byId("adminOrderForm").addEventListener("submit",createOrder);
    byId("adminMfaStart").addEventListener("click",beginMfaEnrollment);
    byId("adminMfaEnrollForm").addEventListener("submit",submitMfaEnrollment);
    byId("adminMfaChallengeForm").addEventListener("submit",submitMfaChallenge);
    byId("adminOrderList").addEventListener("click",function(event){
      var updateButton = event.target.closest("[data-admin-update]");
      if (updateButton){ updateAdminOrder(updateButton); return; }
      var deleteButton = event.target.closest("[data-admin-delete]");
      if (deleteButton){ deleteAdminOrder(deleteButton); return; }
      var restoreButton = event.target.closest("[data-admin-restore]");
      if (restoreButton) restoreAdminOrder(restoreButton);
    });
  }

  function init(){
    wire(); updateAuthUi();
    if (!window.supabase || typeof window.supabase.createClient !== "function"){
      console.error("Supabase library unavailable");
      ["homeAccountButton","navAccountButton","mobileAccountButton"].forEach(function(id){ if (byId(id)) byId(id).disabled = true; });
      return;
    }
    client = window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    client.auth.onAuthStateChange(function(event,session){ setTimeout(function(){ handleSession(session,event).catch(console.error); },0); });
    client.auth.getSession().then(function(response){
      if (response.error) throw response.error;
      return handleSession(response.data.session,"INITIAL_SESSION");
    }).catch(function(error){ authReady = true; console.error("Kicknity auth:",error); updateAuthUi(); });
  }

  window.KicknityAccount = {
    canOpen:function(){ return !!currentSession; },
    requireLogin:function(){ showAuth("login"); },
    open:function(tab){ if (currentSession){ selectAccountTab(tab || readLastAccountTab(),true); loadAccount(); } },
    isReady:function(){ return authReady; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();
