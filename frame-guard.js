// GitHub Pages cannot send a frame-ancestors response header. This is a
// best-effort visual guard, not a replacement for that HTTP protection.
if (window.top !== window.self) {
  document.documentElement.style.display = "none";
}
