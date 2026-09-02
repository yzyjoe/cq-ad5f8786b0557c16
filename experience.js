(function(){
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var lastRouteKey = routeKey();
  var enhancementTimer = null;

  function routeKey(){
    return Array.prototype.filter.call(document.body.classList,function(name){
      return name === "home-mode" || name === "app-mode" || name.indexOf("route-") === 0;
    }).sort().join(" ");
  }

  function animateRoute(){
    if (reduceMotion) return;
    document.body.classList.remove("route-transition-in");
    void document.body.offsetWidth;
    document.body.classList.add("route-transition-in");
    window.setTimeout(function(){ document.body.classList.remove("route-transition-in"); },320);
  }

  function installRouteObserver(){
    new MutationObserver(function(){
      var nextRouteKey = routeKey();
      if (nextRouteKey === lastRouteKey) return;
      lastRouteKey = nextRouteKey;
      animateRoute();
      scheduleEnhancements();
    }).observe(document.body,{attributes:true,attributeFilter:["class"]});
  }

  function addSpotlight(element){
    if (!element || element.dataset.spotlightReady === "true") return;
    element.dataset.spotlightReady = "true";
    var light = document.createElement("span");
    light.className = "interaction-spotlight";
    light.setAttribute("aria-hidden","true");
    element.appendChild(light);

    element.addEventListener("pointermove",function(event){
      if (reduceMotion || event.pointerType === "touch") return;
      var rect = element.getBoundingClientRect();
      element.style.setProperty("--spot-x",event.clientX - rect.left + "px");
      element.style.setProperty("--spot-y",event.clientY - rect.top + "px");
      element.classList.add("spotlight-active");
    });
    element.addEventListener("pointerleave",function(){ element.classList.remove("spotlight-active"); });
    element.addEventListener("pointerdown",function(event){
      if (event.pointerType !== "touch") return;
      element.classList.add("spotlight-tap");
      window.setTimeout(function(){ element.classList.remove("spotlight-tap"); },360);
    });
  }

  function installSpotlights(root){
    (root || document).querySelectorAll(".home-card,.account-desktop-card,.account-order-card,.tracking-history-item").forEach(addSpotlight);
  }

  function statusKeyFromText(text){
    var value = String(text || "").toLowerCase();
    if (value.indexOf("cancel") >= 0 || value.indexOf("arquiv") >= 0) return "cancelled";
    if (value.indexOf("entreg") >= 0) return "delivered";
    if (value.indexOf("enviado") >= 0) return "shipped";
    if (value.indexOf("inspe") >= 0 || value.indexOf("armaz") >= 0 || value.indexOf("qc") >= 0) return "warehouse";
    if (value.indexOf("transporte") >= 0 || value.indexOf("transportadora") >= 0) return "logistics";
    if (value.indexOf("compr") >= 0) return "purchased";
    if (value.indexOf("agente") >= 0 || value.indexOf("atendimento") >= 0) return "accepted";
    return "submitted";
  }

  function parseBrazilianDate(text){
    var match = String(text || "").match(/(\d{2})\/(\d{2})\/(\d{4})[^\d]+(\d{2}):(\d{2})/);
    if (!match) return null;
    var date = new Date(Number(match[3]),Number(match[2]) - 1,Number(match[1]),Number(match[4]),Number(match[5]));
    return isNaN(date.getTime()) ? null : date;
  }

  function isRecent(value){
    var date = value ? new Date(value) : null;
    if (!date || isNaN(date.getTime())) return false;
    var difference = Date.now() - date.getTime();
    return difference >= -86400000 && difference <= 172800000;
  }

  function addRecentIndicator(card){
    var current = card.querySelector(".tracking-current");
    if (!current || current.querySelector(".recent-update-indicator")) return;
    var date = card.dataset.updatedAt ? new Date(card.dataset.updatedAt) : parseBrazilianDate((current.querySelector(".tracking-time") || {}).textContent);
    if (!date || !isRecent(date.toISOString())) return;
    var indicator = document.createElement("span");
    indicator.className = "recent-update-indicator";
    indicator.innerHTML = "<i aria-hidden=\"true\"></i> Atualizado recentemente";
    current.appendChild(indicator);
  }

  function centerTimeline(timeline){
    if (window.innerWidth > 700) return;
    var current = timeline.querySelector(".tracking-step.current");
    if (!current) return;
    var left = Math.max(0,current.offsetLeft - (timeline.clientWidth - current.offsetWidth) / 2);
    timeline.scrollTo({left:left,behavior:reduceMotion ? "auto" : "smooth"});
  }

  function prepareTimeline(timeline){
    if (timeline.dataset.motionReady === "true") return;
    timeline.dataset.motionReady = "true";
    timeline.classList.add("tracking-animate");
    timeline.querySelectorAll(".tracking-step").forEach(function(step,index){
      step.style.setProperty("--step-delay",index * 75 + "ms");
    });
    window.setTimeout(function(){ centerTimeline(timeline); },100);
  }

  function celebrationKey(card,status){
    if (status !== "delivered") return "";
    var accountCard = card.closest("[data-order-id]");
    var code = card.querySelector(".tracking-code");
    return "kicknity-delivery-celebrated-" + (accountCard ? accountCard.dataset.orderId : (code ? code.textContent.trim() : "order"));
  }

  function celebrateDelivery(key){
    if (!key || reduceMotion) return;
    try{ if (localStorage.getItem(key)) return; localStorage.setItem(key,"1"); }
    catch(error){}
    var layer = document.createElement("div");
    layer.className = "delivery-celebration";
    layer.setAttribute("aria-hidden","true");
    for (var index=0;index<18;index++){
      var particle = document.createElement("i");
      particle.style.setProperty("--particle-x",(Math.random() * 100).toFixed(2) + "vw");
      particle.style.setProperty("--particle-delay",(Math.random() * 260).toFixed(0) + "ms");
      particle.style.setProperty("--particle-rotate",(Math.random() * 260 - 130).toFixed(0) + "deg");
      layer.appendChild(particle);
    }
    document.body.appendChild(layer);
    window.setTimeout(function(){ layer.remove(); },2100);
  }

  function decorateTracking(card){
    if (!card) return;
    var badge = card.querySelector(".tracking-badge");
    var status = card.dataset.status || statusKeyFromText(badge && badge.textContent);
    ["submitted","accepted","purchased","logistics","warehouse","shipped","delivered","cancelled"].forEach(function(key){
      card.classList.toggle("status-" + key,key === status);
    });
    addRecentIndicator(card);
    celebrateDelivery(celebrationKey(card,status));
  }

  function ensureProductDialog(){
    var dialog = document.getElementById("productPreviewDialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "productPreviewDialog";
    dialog.className = "product-preview-dialog";
    dialog.innerHTML = "<button type=\"button\" class=\"product-preview-close\" aria-label=\"Fechar imagem\">×</button><figure><img alt=\"\"><figcaption></figcaption></figure>";
    document.body.appendChild(dialog);
    dialog.querySelector("button").addEventListener("click",function(){ dialog.close(); });
    dialog.addEventListener("click",function(event){ if (event.target === dialog) dialog.close(); });
    return dialog;
  }

  function openProductPreview(image){
    var dialog = ensureProductDialog();
    dialog.querySelector("img").src = image.currentSrc || image.src;
    dialog.querySelector("img").alt = image.alt || "Imagem do produto";
    dialog.querySelector("figcaption").textContent = image.alt || "Imagem do produto";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open","");
  }

  function prepareProductImage(image){
    if (!image || image.dataset.previewReady === "true") return;
    image.dataset.previewReady = "true";
    var frame = image.closest(".tracking-photo");
    if (!frame) return;
    frame.classList.add("product-preview-trigger");
    frame.setAttribute("role","button");
    frame.setAttribute("tabindex","0");
    frame.setAttribute("aria-label","Ampliar " + (image.alt || "imagem do produto"));
    frame.addEventListener("click",function(){ openProductPreview(image); });
    frame.addEventListener("keydown",function(event){
      if (event.key === "Enter" || event.key === " "){ event.preventDefault(); openProductPreview(image); }
    });
    frame.addEventListener("pointermove",function(event){
      if (reduceMotion || event.pointerType === "touch" || window.innerWidth <= 700) return;
      var rect = frame.getBoundingClientRect();
      var x = ((event.clientX - rect.left) / rect.width - 0.5) * 8;
      var y = ((event.clientY - rect.top) / rect.height - 0.5) * 8;
      image.style.transform = "scale(1.06) translate(" + x.toFixed(2) + "px," + y.toFixed(2) + "px)";
    });
    frame.addEventListener("pointerleave",function(){ image.style.transform = ""; });
  }

  function enhanceTracking(){
    document.querySelectorAll(".tracking-timeline").forEach(prepareTimeline);
    document.querySelectorAll(".account-tracking-card").forEach(decorateTracking);
    var publicResult = document.getElementById("trackingResult");
    if (publicResult && !publicResult.hidden) decorateTracking(publicResult);
    document.querySelectorAll(".tracking-photo img").forEach(prepareProductImage);
  }

  function runEnhancements(){
    installSpotlights(document);
    enhanceTracking();
  }

  function scheduleEnhancements(){
    window.clearTimeout(enhancementTimer);
    enhancementTimer = window.setTimeout(runEnhancements,30);
  }

  function installContentObserver(){
    new MutationObserver(scheduleEnhancements).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["hidden"]});
  }

  function init(){
    installRouteObserver();
    installContentObserver();
    runEnhancements();
    window.addEventListener("resize",scheduleEnhancements,{passive:true});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();
