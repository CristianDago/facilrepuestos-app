/**
 * Widget Embebible FácilRepuestos.cl — Botón Flotante + Chatbot de Repuestos IA
 * Uso en WordPress / WooCommerce / cualquier sitio web:
 *   <script src="https://sistema.facilrepuestos.cl/widget-repuestin.js" defer></script>
 */
(function () {
  if (window.__FRP_CHAT_WIDGET_LOADED__) return;
  window.__FRP_CHAT_WIDGET_LOADED__ = true;

  var scriptEl = document.currentScript;
  var baseOrigin = 'https://sistema.facilrepuestos.cl';
  if (scriptEl && scriptEl.src) {
    try {
      baseOrigin = new URL(scriptEl.src).origin;
    } catch (e) {}
  }

  var iframeUrl = baseOrigin + '/widget-chat';
  var isOpen = false;

  var container = document.createElement('div');
  container.id = 'frp-chatbot-widget-root';
  container.style.cssText =
    'position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:system-ui,-apple-system,sans-serif;';

  var frameWrap = document.createElement('div');
  frameWrap.style.cssText =
    'display:none;position:fixed;right:20px;bottom:82px;width:390px;max-width:calc(100vw - 28px);height:590px;max-height:calc(100vh - 110px);border-radius:18px;overflow:hidden;box-shadow:0 22px 48px rgba(15,23,42,0.32);border:1px solid #cbd5e1;background:#ffffff;';

  var iframe = document.createElement('iframe');
  iframe.src = iframeUrl;
  iframe.title = 'Asistente de Repuestos FácilRepuestos.cl';
  iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
  frameWrap.appendChild(iframe);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.innerHTML =
    '<span style="font-size:20px;line-height:1;">💬</span><span>¿Buscas un repuesto? Cotiza aquí</span>';
  btn.style.cssText =
    'display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#1b4f8c 0%,#0f2d52 65%,#e85d04 140%);color:#fff;border:2px solid #fff;border-radius:999px;padding:13px 20px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 12px 28px rgba(15,45,82,0.35);';

  btn.onclick = function () {
    isOpen = !isOpen;
    frameWrap.style.display = isOpen ? 'block' : 'none';
    btn.innerHTML = isOpen
      ? '<span style="font-size:18px;line-height:1;">✕</span><span>Cerrar Chat</span>'
      : '<span style="font-size:20px;line-height:1;">💬</span><span>¿Buscas un repuesto? Cotiza aquí</span>';
  };

  container.appendChild(frameWrap);
  container.appendChild(btn);

  function mount() {
    if (document.body) {
      document.body.appendChild(container);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
