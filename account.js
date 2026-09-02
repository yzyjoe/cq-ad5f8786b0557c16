(function(){
  "use strict";

  var SUPABASE_URL = "https://lgcvaxjsgymwueacqkec.supabase.co";
  var SUPABASE_KEY = "sb_publishable_Ksi21eNIkJQ6olvOSMAIPQ_4V2jBNWl";
  var client = null;
  var currentSession = null;
  var currentProfile = null;
  var currentOrders = [];
  var authReady = false;

  function byId(id){ return document.getElementById(id); }
  function all(selector){ return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function clean(value){ return String(value == null ? "" : value).trim(); }
  function escapeHtml(value){
    return String(value == null ? "" : value).replace(/[&<>'"]/g,function(char){
      return {"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char];
    });
  }
  function formatDate(value){
    if (!value) return "—";
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
    delivered:"Entregue", cancelled:"Cancelado"
  };

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
  function friendlyError(error){
    var message = clean(error && error.message).toLowerCase();
    if (message.indexOf("invalid login") >= 0) return "E-mail ou senha incorretos.";
    if (message.indexOf("email not confirmed") >= 0) return "Confirme seu e-mail antes de entrar.";
    if (message.indexOf("already registered") >= 0 || message.indexOf("already been registered") >= 0) return "Este e-mail já possui uma conta.";
    if (message.indexOf("password") >= 0 && message.indexOf("characters") >= 0) return "A senha precisa ter pelo menos 6 caracteres.";
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
    ["homeAccountButton","navAccountButton"].forEach(function(id){ if (byId(id)) byId(id).textContent = label; });
    if (byId("mobileAccountButton")) byId("mobileAccountButton").textContent = signedIn ? "Conta" : "Entrar";
    if (byId("desktopAccountRoute")) byId("desktopAccountRoute").hidden = !signedIn;
    if (byId("accountLogout")) byId("accountLogout").hidden = !signedIn;
  }

  function goToAccount(){
    if (!currentSession){ showAuth("login"); return; }
    if (location.hash === "#conta") window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = "conta";
  }

  function sortedEvents(order){
    return (order.order_events || []).slice().sort(function(a,b){ return new Date(b.occurred_at) - new Date(a.occurred_at); });
  }
  function orderCard(order,admin){
    var events = sortedEvents(order);
    var latest = events[0];
    var customer = admin && order.profiles ? "<span class=\"admin-client\">Cliente: " + escapeHtml(order.profiles.full_name || order.profiles.email) + " · " + escapeHtml(order.profiles.email) + "</span>" : "";
    var editor = admin ? (
      "<div class=\"admin-order-editor\">" +
        "<select data-admin-field=\"status\" aria-label=\"Status do pedido\">" + Object.keys(STATUS_LABELS).map(function(status){ return "<option value=\"" + status + "\"" + (order.status === status ? " selected" : "") + ">" + STATUS_LABELS[status] + "</option>"; }).join("") + "</select>" +
        "<input data-admin-field=\"tracking\" value=\"" + escapeHtml(order.tracking_code || "") + "\" placeholder=\"Código de rastreio\" aria-label=\"Código de rastreio\">" +
        "<button type=\"button\" data-admin-update=\"" + order.id + "\">Salvar</button>" +
      "</div>"
    ) : "";
    return "<article class=\"account-order-card\" data-order-id=\"" + order.id + "\">" +
      "<div class=\"account-order-top\"><div><span class=\"account-order-code\">" + escapeHtml(order.order_code) + "</span><h4>" + escapeHtml(order.product_name) + "</h4></div><span class=\"account-status\">" + escapeHtml(STATUS_LABELS[order.status] || order.status) + "</span></div>" +
      customer +
      "<div class=\"account-order-meta\"><span>Modelo: " + escapeHtml(order.model_code || "—") + "</span><span>Qtd.: " + escapeHtml(order.quantity) + "</span><span>" + escapeHtml(formatMoney(order.total_amount,order.currency)) + "</span>" + (order.tracking_code ? "<span>Rastreio: " + escapeHtml(order.tracking_code) + "</span>" : "") + "</div>" +
      (latest ? "<div class=\"account-order-event\">" + escapeHtml(latest.description) + "<time>" + escapeHtml(formatDate(latest.occurred_at)) + "</time></div>" : "") + editor +
    "</article>";
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
    byId("accountOrderList").innerHTML = total ? currentOrders.map(function(order){ return orderCard(order,false); }).join("") : "<div class=\"account-empty\">Seus pedidos aparecerão aqui quando forem vinculados pelo atendimento.</div>";
  }

  async function loadProfile(){
    if (!client || !currentSession) return null;
    var response = await client.from("profiles").select("id,email,full_name,role,created_at").eq("id",currentSession.user.id).single();
    if (response.error) throw response.error;
    currentProfile = response.data;
    byId("accountIdentity").textContent = (currentProfile.full_name || "Cliente") + " · " + currentProfile.email;
    var isAdmin = currentProfile.role === "admin";
    byId("adminTabButton").hidden = !isAdmin;
    return currentProfile;
  }

  async function loadOrders(){
    if (!client || !currentSession) return;
    var response = await client.from("orders").select("*,order_events(*)").eq("user_id",currentSession.user.id).order("updated_at",{ascending:false});
    if (response.error) throw response.error;
    currentOrders = response.data || [];
    renderCustomerOrders();
  }

  async function loadAdmin(){
    if (!client || !currentProfile || currentProfile.role !== "admin") return;
    var results = await Promise.all([
      client.from("profiles").select("id,email,full_name,role").order("created_at",{ascending:false}),
      client.from("orders").select("*,profiles(email,full_name),order_events(*)").order("updated_at",{ascending:false})
    ]);
    if (results[0].error) throw results[0].error;
    if (results[1].error) throw results[1].error;
    var customers = results[0].data || [];
    byId("adminCustomer").innerHTML = "<option value=\"\">Selecione</option>" + customers.map(function(profile){ return "<option value=\"" + profile.id + "\">" + escapeHtml(profile.full_name || profile.email) + " · " + escapeHtml(profile.email) + "</option>"; }).join("");
    var orders = results[1].data || [];
    byId("adminOrderList").innerHTML = orders.length ? orders.map(function(order){ return orderCard(order,true); }).join("") : "<div class=\"account-empty\">Nenhum pedido cadastrado.</div>";
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

  function selectAccountTab(tab){
    if (tab === "admin" && (!currentProfile || currentProfile.role !== "admin")) tab = "overview";
    all("[data-account-tab]").forEach(function(button){ button.classList.toggle("active",button.getAttribute("data-account-tab") === tab); });
    all("[data-account-view]").forEach(function(view){ view.hidden = view.getAttribute("data-account-view") !== tab; });
    if (tab === "admin") loadAdmin().catch(function(error){ adminMessage(friendlyError(error),"error"); });
  }

  async function handleSession(session,event){
    currentSession = session || null;
    authReady = true;
    if (!currentSession){ currentProfile = null; currentOrders = []; }
    updateAuthUi();
    if (event === "PASSWORD_RECOVERY"){
      setAuthMode("recovery"); authMessage("Defina sua nova senha.");
      var dialog = byId("authDialog"); if (dialog && !dialog.open) dialog.showModal();
      return;
    }
    if (currentSession){
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
    var payload = {
      user_id:byId("adminCustomer").value,
      order_code:clean(byId("adminOrderCode").value).toUpperCase(),
      product_name:clean(byId("adminProductName").value),
      model_code:clean(byId("adminModelCode").value) || null,
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

  function wire(){
    ["homeAccountButton","navAccountButton"].forEach(function(id){ byId(id).addEventListener("click",goToAccount); });
    byId("authClose").addEventListener("click",closeAuth);
    byId("authDialog").addEventListener("click",function(event){ if (event.target === byId("authDialog")) closeAuth(); });
    all("[data-auth-mode]").forEach(function(button){ button.addEventListener("click",function(){ setAuthMode(button.getAttribute("data-auth-mode")); authMessage(""); }); });
    byId("loginForm").addEventListener("submit",submitLogin);
    byId("signupForm").addEventListener("submit",submitSignup);
    byId("recoveryForm").addEventListener("submit",submitRecovery);
    byId("forgotPassword").addEventListener("click",sendRecovery);
    byId("accountLogout").addEventListener("click",async function(){ await client.auth.signOut(); location.hash = ""; });
    all("[data-account-tab]").forEach(function(button){ button.addEventListener("click",function(){ selectAccountTab(button.getAttribute("data-account-tab")); }); });
    all("[data-open-account-orders]").forEach(function(button){ button.addEventListener("click",function(){ selectAccountTab("orders"); }); });
    byId("refreshAccountOrders").addEventListener("click",function(){ loadOrders().catch(console.error); });
    byId("refreshAdminOrders").addEventListener("click",function(){ loadAdmin().catch(function(error){ adminMessage(friendlyError(error),"error"); }); });
    byId("adminOrderForm").addEventListener("submit",createOrder);
    byId("adminOrderList").addEventListener("click",function(event){ var button = event.target.closest("[data-admin-update]"); if (button) updateAdminOrder(button); });
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
    open:function(){ if (currentSession) loadAccount(); },
    isReady:function(){ return authReady; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();
