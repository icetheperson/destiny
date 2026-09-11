document.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("vantaBg");
  if (!el || typeof VANTA === "undefined") return;

  VANTA.FOG({
    el,
    mouseControls: true,
    touchControls: true,
    gyroControls: false,
    minHeight: 200.0,
    minWidth: 200.0,
    highlightColor: 0xa758ca,
    midtoneColor: 0x8575d4,
    lowlightColor: 0x120072,
    baseColor: 0x0,
    blurFactor: 0.55,
    speed: 1.5,
    zoom: 1.4,
  });
});