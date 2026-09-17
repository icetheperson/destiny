let favorites = JSON.parse(localStorage.getItem("destiny_favorites") || "[]");
let showFavoritesOnly = false;

function hideAppLoader() {
  const overlay = document.getElementById("appLoadingOverlay");
  if (overlay && !overlay.classList.contains("fade-out")) {
    overlay.classList.add("fade-out");
  }
}

function updateAppLoaderProgress(loaded, total) {
  const overlay = document.getElementById("appLoadingOverlay");
  if (!overlay) return;
  
  let textEl = overlay.querySelector(".loadingProgressText");
  if (!textEl) {
    textEl = document.createElement("div");
    textEl.className = "loadingProgressText";
    overlay.appendChild(textEl);
  }
  
  textEl.textContent = `${loaded} / ${total} Loaded.`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const statusBadge = document.getElementById("luminsdk-status");
  if (statusBadge) {
    async function checkPing(url) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        await fetch(url, { 
          mode: "no-cors", 
          cache: "no-store",
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        return true;
      } catch (err) {
        return false;
      }
    }
    
    async function checkCdn(url) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(url, { 
          cache: "no-store",
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) return false;
        const text = await res.text();
        return text.trim().length > 0;
      } catch (err) {
        return false;
      }
    }
    
    const [aStatus, kestenStatus, fontsStatus, luminStatus] = await Promise.all([
      checkPing("https://a.luminsdk.com/"),
      checkPing("https://drkesten.com/"),
      checkCdn("https://cdn.jsdelivr.net/gh/luminsdk/script@latest/fonts.min.js"),
      checkCdn("https://cdn.jsdelivr.net/gh/luminsdk/script@latest/lumin.min.js")
    ]);
    
    const statuses = [aStatus, kestenStatus, fontsStatus, luminStatus];
    const onlineCount = statuses.filter(Boolean).length;
    
    let statusText = "";
    let badgeClass = "badge ";
    let rubyText = "";
    
    switch (onlineCount) {
      case 4:
      statusText = "Online";
      badgeClass += "badge-online";
      break;
      case 3:
      statusText = "3 out of 4 Services Available";
      badgeClass += "badge-yellow";
      rubyText = "Minor service disruption";
      break;
      case 2:
      statusText = "2 out of 4 Services Available";
      badgeClass += "badge-orange";
      rubyText = "Multiple services affected";
      break;
      case 1:
      statusText = "1 out of 4 Services Available";
      badgeClass += "badge-red";
      rubyText = "Severe service disruption";
      break;
      case 0:
      default:
      statusText = "Offline";
      badgeClass += "badge-offline";
      break;
    }
    
    statusBadge.className = badgeClass;
    if (rubyText) {
      statusBadge.innerHTML = `<ruby>${statusText}<rt>${rubyText}</rt></ruby>`;
    } else {
      statusBadge.textContent = statusText;
    }
  }
  
  const supabaseBadge = document.getElementById("supabase-status");
  const supabasePing = document.getElementById("supabase-ping");
  if (supabaseBadge) {
    const SUPABASE_URL = "https://cgbsuudnsjegwsvferbe.supabase.co";
    const SUPABASE_ANON = "sb_publishable_U-vwBs44tiha3_w-gi6sQg_6qwxH8XS";
    const startTime = performance.now();
    
    fetch(`${SUPABASE_URL}/auth/v1/health`, {
      method: "GET",
      headers: { apikey: SUPABASE_ANON },
      cache: "no-store"
    })
    .then((res) => {
      if (res.ok) {
        if (supabasePing) supabasePing.textContent = `${Math.round(performance.now() - startTime)}ms`;
        supabaseBadge.textContent = "Online";
        supabaseBadge.className = "badge badge-online";
      } else {
        if (supabasePing) supabasePing.textContent = "-";
        supabaseBadge.textContent = "Offline";
        supabaseBadge.className = "badge badge-offline";
      }
    })
    .catch(() => {
      if (supabasePing) supabasePing.textContent = "-";
      supabaseBadge.textContent = "Offline";
      supabaseBadge.className = "badge badge-offline";
    });
  }
  
  const scramjetBadge = document.getElementById("scramjet-status");
  const scramjetPing = document.getElementById("scramjet-ping");
  if (scramjetBadge) {
    const wispUrl = localStorage.getItem("destiny_wispUrl") || "wss://arctic.lat/_q/";
    try {
      const startTime = performance.now();
      const ws = new WebSocket(wispUrl);
      
      const timeout = setTimeout(() => {
        ws.close();
        if (scramjetPing) scramjetPing.textContent = "-";
        scramjetBadge.textContent = "Offline";
        scramjetBadge.className = "badge badge-offline";
      }, 5000);
      
      ws.onopen = () => {
        if (scramjetPing) scramjetPing.textContent = `${Math.round(performance.now() - startTime)}ms`;
        clearTimeout(timeout);
        ws.close();
        scramjetBadge.textContent = "Online";
        scramjetBadge.className = "badge badge-online";
      };
      
      ws.onerror = () => {
        if (scramjetPing) scramjetPing.textContent = "-";
        clearTimeout(timeout);
        scramjetBadge.textContent = "Offline";
        scramjetBadge.className = "badge badge-offline";
      };
    } catch (err) {
      if (scramjetPing) scramjetPing.textContent = "-";
      scramjetBadge.textContent = "Offline";
      scramjetBadge.className = "badge badge-offline";
    }
  }
  
  const grid = document.querySelector(".arcadeGrid");
  const paginationContainer = document.getElementById("pagination");
  if (!grid) return;
  
  const searchInput =
  document.querySelector(".searchWrap input") ||
  document.querySelector("input[type='text']");
  const searchGlass = document.getElementById("searchGlassIcon");
  
  if (searchInput && searchGlass) {
    searchInput.addEventListener("focus", () => {
      searchGlass.style.color = "var(--accentPurple)";
    });
    searchInput.addEventListener("blur", () => {
      searchGlass.style.color = "";
    });
  }
  
  let currentQuery = "";
  let allArcade = [];
  let masterArcadeList = [];
  let favorites = JSON.parse(localStorage.getItem("destiny_favorites") || "[]");
  let showFavoritesOnly = false;
  
  (async () => {
    await Lumin.init({ headless: true });
    await fetchAndCacheAllArcade();
    hideAppLoader();
  })();
  
  function applyFilterAndRender() {
    let filtered = [...masterArcadeList];
    
    if (currentQuery) {
      const q = currentQuery.toLowerCase();
      filtered = filtered.filter(game => game.name.toLowerCase().includes(q));
    }
    
    if (showFavoritesOnly) {
      filtered = filtered.filter(game => favorites.includes(game.id));
    }
    
    allArcade = filtered;
    
    if (allArcade.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--textMuted); font-family: var(--fontMono); padding: 40px 0;">No Experiences Found.</div>`;
      return;
    }
    
    renderPage();
  }
  
  async function fetchAndCacheAllArcade() {
    grid.innerHTML = "";
    
    let result;
    try {
      result = await Lumin.getGames({
        page: 1,
        limit: 9999
      });
    } catch (e) {
      result = null; 
    }
    
    if (!result || !result.games) {
      masterArcadeList = [];
      allArcade = [];
      totalPages = 0;
      grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--textMuted); font-family: var(--fontMono); padding: 40px 0;">Loading Failed. Try again later.</div>';
      return;
    }
    
    masterArcadeList = result.games.sort((a, b) => a.name.localeCompare(b.name));
    
    const imgUrls = await Promise.all(
      masterArcadeList.map((g) => Lumin.getImageUrl(g.image_token))
    );
    
    let loadedCount = 0;
    const totalCount = imgUrls.length;
    updateAppLoaderProgress(0, totalCount);
    
    await Promise.all(
      imgUrls.map((url, index) => {
        masterArcadeList[index].loadedImgUrl = url;
        return new Promise((resolve) => {
          if (!url) {
            loadedCount++;
            updateAppLoaderProgress(loadedCount, totalCount);
            return resolve();
          }
          const img = new Image();
          img.onload = img.onerror = () => {
            loadedCount++;
            updateAppLoaderProgress(loadedCount, totalCount);
            resolve();
          };
          img.src = url;
        });
      })
    );
    
    applyFilterAndRender();
  }
  
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      currentQuery = e.target.value.trim();
      applyFilterAndRender();
    });
    
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        currentQuery = e.target.value.trim();
        applyFilterAndRender();
      }
    });
  }
  
  const favFilterButton = document.getElementById("favoritesFilterButton");
  const favGameButton = document.getElementById("favoriteGameButton");
  
  favFilterButton?.addEventListener("click", () => {
    showFavoritesOnly = !showFavoritesOnly;
    
    if (showFavoritesOnly) {
      favFilterButton.classList.add("active");
    } else {
      favFilterButton.classList.remove("active");
    }
    
    favFilterButton.style.color = "";
    const svg = favFilterButton.querySelector("svg");
    if (svg) svg.style.color = "";
    
    applyFilterAndRender();
  });
  
  favGameButton?.addEventListener("click", () => {
    if (!currentGame) return;
    const isFav = favorites.includes(currentGame.id);
    
    if (isFav) {
      favorites = favorites.filter(id => id !== currentGame.id);
      favGameButton.classList.remove("active");
      favGameButton.style.color = "";
    } else {
      favorites.push(currentGame.id);
      favGameButton.classList.add("active");
      favGameButton.style.color = "";
    }
    
    localStorage.setItem("destiny_favorites", JSON.stringify(favorites));
    
    if (showFavoritesOnly) applyFilterAndRender();
  });
  
  function renderPage() {
    grid.innerHTML = "";
    
    grid.classList.remove("animatePage");
    void grid.offsetWidth; 
    grid.classList.add("animatePage");
    
    allArcade.forEach((game) => {
      const card = document.createElement("a");
      card.className = "arcadeCard";
      card.href = "#";
      card.innerHTML = `
        <img src="${game.loadedImgUrl}" alt="${game.name}" loading="lazy" />
        <h3>${game.name}</h3>
      `;
      card.addEventListener("click", (e) => {
        e.preventDefault();
        openArcadeView(game);
      });
      grid.appendChild(card);
    });
  }
  
  const arcadeView = document.getElementById("arcadeView");
  const arcadeViewTitle = document.getElementById("arcadeViewTitle");
  const arcadeFrame = document.getElementById("arcadeFrame");
  const arcadeLoading = document.getElementById("arcadeLoading");
  const refreshArcadeButton = document.getElementById("refreshArcadeButton");
  const fullscreenArcadeButton = document.getElementById("fullscreenArcadeButton");
  const closeArcadeButton = document.getElementById("closeArcadeButton");
  
  let currentGame = null;
  let hideLoadingTimeout = null;
  
  function showArcadeLoading() {
    clearTimeout(hideLoadingTimeout);
    if (!arcadeLoading) return;
    arcadeLoading.innerHTML = '<span class="spinner spinner-lg"></span>';
    arcadeLoading.style.display = "flex";
    void arcadeLoading.offsetWidth;
    arcadeLoading.classList.remove("fadeOut");
  }
  
  function hideArcadeLoading() {
    if (!arcadeLoading) return;
    arcadeLoading.classList.add("fadeOut");
    hideLoadingTimeout = setTimeout(() => {
      arcadeLoading.style.display = "none";
    }, 200);
  }
  
  function showArcadeLoadError() {
    clearTimeout(hideLoadingTimeout);
    if (!arcadeLoading) return;
    arcadeLoading.classList.remove("fadeOut");
    arcadeLoading.style.display = "flex";
    arcadeLoading.innerHTML =
    '<span style="font-family: var(--fontMono); font-size: 0.85rem; color: var(--textMuted);">Failed to load game.</span>';
  }
  
  async function loadIntoArcadeFrame(game) {
    showArcadeLoading();
    if (!arcadeFrame) return;
    arcadeFrame.removeAttribute("src");
    try {
      const { url } = await Lumin.getGameUrl(game.id);
      arcadeFrame.src = url;
      arcadeFrame.onload = () => hideArcadeLoading();
    } catch (err) {
      showArcadeLoadError();
      console.error("LuminSDK Error:", err);
    }
  }
  
  async function openArcadeView(game) {
    if (!arcadeView) return;
    currentGame = game;
    if (arcadeViewTitle) arcadeViewTitle.textContent = game.name;
    
    const favGameButton = document.getElementById("favoriteGameButton");
    if (favGameButton) {
      favGameButton.style.color = "";
      if (favorites.includes(game.id)) {
        favGameButton.classList.add("active");
      } else {
        favGameButton.classList.remove("active");
      }
    }
    
    arcadeView.classList.add("active");
    document.body.style.overflow = "hidden";
    await loadIntoArcadeFrame(game);
  }
  
  function closeArcadeView() {
    if (!arcadeView) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    arcadeView.classList.remove("active");
    document.body.style.overflow = "";
    if (arcadeFrame) arcadeFrame.src = "about:blank";
    currentGame = null;
  }
  
  function refreshArcade() {
    if (!currentGame) return;
    loadIntoArcadeFrame(currentGame);
  }
  
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      arcadeFrame?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  }
  
  closeArcadeButton?.addEventListener("click", closeArcadeView);
  refreshArcadeButton?.addEventListener("click", refreshArcade);
  fullscreenArcadeButton?.addEventListener("click", toggleFullscreen);
  
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && arcadeView?.classList.contains("active")) {
      closeArcadeView();
    }
  });
});

const cloakButton = document.getElementById("cloakButton");
const cloakSelect = document.getElementById("cloakSelect");

if (cloakButton && cloakSelect) {
  cloakButton.addEventListener("click", () => {
    const method = cloakSelect.value;
    const currentUrl = window.location.href;
    
    const currentTitle = document.title;
    const currentFavicon = document.querySelector("link[rel='icon']")?.href || "";
    let win;
    
    if (method === "about:blank") {
      win = window.open("about:blank", "_blank");
      if (win) {
        win.document.title = currentTitle;
        if (currentFavicon) {
          const link = win.document.createElement("link");
          link.rel = "icon";
          link.href = currentFavicon;
          win.document.head.appendChild(link);
        }
        
        win.document.body.style.margin = "0";
        win.document.body.style.padding = "0";
        const iframe = win.document.createElement("iframe");
        iframe.src = currentUrl;
        iframe.style.width = "100vw";
        iframe.style.height = "100vh";
        iframe.style.border = "none";
        win.document.body.appendChild(iframe);
      }
    } else if (method === "blob:") {
      const blob = new Blob([
        `<html>
          <head>
            <title>${currentTitle}</title>
            ${currentFavicon ? `<link rel="icon" href="${currentFavicon}">` : ""}
          </head>
          <body style="margin:0;padding:0;overflow:hidden;">
            <iframe src="${currentUrl}" style="width:100vw;height:100vh;border:none;"></iframe>
          </body>
        </html>`
      ], { type: "text/html" });
      win = window.open(URL.createObjectURL(blob), "_blank");
    }
    
    if (win) {
      window.location.replace("https://canvas.instructure.com/");
    }
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  if (!document.querySelector(".arcadeGrid")) {
    const images = Array.from(document.images);
    const total = images.length || 1;
    let loaded = 0;
    
    updateAppLoaderProgress(0, total);
    
    const safetyTimer = setTimeout(hideAppLoader, 3000);
    
    if (images.length === 0) {
      window.addEventListener("load", () => {
        clearTimeout(safetyTimer);
        updateAppLoaderProgress(1, 1);
        setTimeout(hideAppLoader, 150);
      });
    } else {
      images.forEach((img) => {
        const onComplete = () => {
          loaded++;
          updateAppLoaderProgress(loaded, total);
          if (loaded >= total) {
            clearTimeout(safetyTimer);
            setTimeout(hideAppLoader, 150);
          }
        };
        
        if (img.complete) {
          onComplete();
        } else {
          img.addEventListener("load", onComplete, { once: true });
          img.addEventListener("error", onComplete, { once: true });
        }
      });
    }
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const autoCloakToggle = document.getElementById("autoCloakToggle");
  const privacyOverlayToggle = document.getElementById("privacyOverlayToggle");
  const privacyOverlay = document.getElementById("privacyOverlay");
  const leaveConfirmToggle = document.getElementById("leaveConfirmToggle");
  const cloakSelectEl = document.getElementById("cloakSelect"); 
  
  const savedCloakMethod = localStorage.getItem("destiny_cloakMethod") || "about:blank";
  
  if (cloakSelectEl) {
    cloakSelectEl.value = savedCloakMethod;
    cloakSelectEl.addEventListener("change", (e) => {
      localStorage.setItem("destiny_cloakMethod", e.target.value);
    });
  }
  
  const isAutoCloakEnabled = localStorage.getItem("destiny_autoCloak") === "true";
  const isPrivacyOverlayEnabled = localStorage.getItem("destiny_privacyOverlay") === "true";
  const isLeaveConfirmEnabled = localStorage.getItem("destiny_leaveConfirm") === "true";
  
  if (autoCloakToggle) autoCloakToggle.checked = isAutoCloakEnabled;
  if (privacyOverlayToggle) privacyOverlayToggle.checked = isPrivacyOverlayEnabled;
  if (leaveConfirmToggle) leaveConfirmToggle.checked = isLeaveConfirmEnabled;
  
  const isIframe = window !== window.parent;
  
  if (isAutoCloakEnabled && !isIframe) {
    const method = savedCloakMethod;
    const currentUrl = window.location.href;
    
    const currentTitle = document.title;
    const currentFavicon = document.querySelector("link[rel='icon']")?.href || "";
    let win;
    
    if (method === "about:blank") {
      win = window.open("about:blank", "_blank");
      if (win) {
        win.document.title = currentTitle;
        if (currentFavicon) {
          const link = win.document.createElement("link");
          link.rel = "icon";
          link.href = currentFavicon;
          win.document.head.appendChild(link);
        }
        
        win.document.body.style.margin = "0";
        win.document.body.style.padding = "0";
        const iframe = win.document.createElement("iframe");
        iframe.src = currentUrl;
        iframe.style.width = "100vw";
        iframe.style.height = "100vh";
        iframe.style.border = "none";
        win.document.body.appendChild(iframe);
      }
    } else if (method === "blob:") {
      const blob = new Blob([
        `<html>
          <head>
            <title>${currentTitle}</title>
            ${currentFavicon ? `<link rel="icon" href="${currentFavicon}">` : ""}
          </head>
          <body style="margin:0;padding:0;overflow:hidden;">
            <iframe src="${currentUrl}" style="width:100vw;height:100vh;border:none;"></iframe>
          </body>
        </html>`
      ], { type: "text/html" });
      win = window.open(URL.createObjectURL(blob), "_blank");
    }
    
    if (win) {
      window.location.replace("https://canvas.instructure.com/");
    }
  }
  
  if (autoCloakToggle) {
    autoCloakToggle.addEventListener("change", (e) => {
      localStorage.setItem("destiny_autoCloak", e.target.checked);
    });
  }
  
  if (privacyOverlayToggle) {
    privacyOverlayToggle.addEventListener("change", (e) => {
      localStorage.setItem("destiny_privacyOverlay", e.target.checked);
    });
  }
  
  function handleBeforeUnload(e) {
    e.preventDefault();
    e.returnValue = '';
  }
  
  if (isLeaveConfirmEnabled) {
    window.addEventListener('beforeunload', handleBeforeUnload);
  }
  
  if (leaveConfirmToggle) {
    leaveConfirmToggle.addEventListener("change", (e) => {
      const isEnabled = e.target.checked;
      localStorage.setItem("destiny_leaveConfirm", isEnabled);
      
      if (isEnabled) {
        window.addEventListener('beforeunload', handleBeforeUnload);
      } else {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
    });
  }
  
  const wispUrlInput = document.getElementById("wispUrlInput");
  const saveWispButton = document.getElementById("saveWispButton");
  
  if (wispUrlInput) {
    wispUrlInput.value = localStorage.getItem("destiny_wispUrl") || "wss://arctic.lat/_q/";
  }
  
  if (saveWispButton && wispUrlInput) {
    saveWispButton.addEventListener("click", () => {
      const newUrl = wispUrlInput.value.trim() || "wss://arctic.lat/_q/";
      localStorage.setItem("destiny_wispUrl", newUrl);
      window.location.reload();
    });
  }
  
  let originalTitle = document.title;
  let originalFavicon = document.querySelector("link[rel='icon']")?.href || "";
  let isPrivacyActive = false;
  
  function enablePrivacyScreen() {
    if (isPrivacyActive) return;
    isPrivacyActive = true;
    
    originalTitle = document.title;
    const link = document.querySelector("link[rel='icon']");
    if (link) originalFavicon = link.href;
    
    document.title = "Canvas LMS"; 
    
    if (link) {
      link.href = "assets/favicon.png"; 
    } else {
      const newLink = document.createElement("link");
      newLink.rel = "icon";
      newLink.href = "assets/favicon.png"; 
      document.head.appendChild(newLink);
    }
    
    if (localStorage.getItem("destiny_privacyOverlay") === "true") {
      if (privacyOverlay) privacyOverlay.style.display = "block";
    }
  }
  
  function disablePrivacyScreen() {
    if (!isPrivacyActive) return;
    isPrivacyActive = false;
    
    document.title = originalTitle;
    const link = document.querySelector("link[rel='icon']");
    if (link) link.href = originalFavicon;
    
    if (privacyOverlay) privacyOverlay.style.display = "none";
  }
  
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      enablePrivacyScreen();
    } else {
      disablePrivacyScreen();
    }
  });
  
  window.addEventListener("blur", () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (active && (active.tagName === "IFRAME" || active.id === "arcadeFrame")) {
        return;
      }
      enablePrivacyScreen();
    }, 50);
  });
  
  window.addEventListener("focus", () => {
    disablePrivacyScreen();
  });
  
  window.addEventListener("focus", () => {
    if (localStorage.getItem("destiny_privacyOverlay") === "true") {
      if (privacyOverlay) privacyOverlay.style.display = "none";
      
      document.title = originalTitle;
      const link = document.querySelector("link[rel='icon']");
      if (link) link.href = originalFavicon;
    }
  });
});

document.addEventListener("DOMContentLoaded", () => {
  const searchContainer = document.querySelector('.searchWrapper');
  if (!searchContainer) return; 
  
  const mainSearchInput = document.querySelector('.searchWrap input');
  
  function navigateToBrowser(query) {
    if (!query.trim()) return;
    window.location.href = `browser.html?url=${encodeURIComponent(query)}`;
  }
  
  if (mainSearchInput) {
    mainSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        navigateToBrowser(e.target.value);
      }
    });
  }
  
  const quickLinks = document.querySelectorAll('.quickLinks button');
  quickLinks.forEach(button => {
    button.addEventListener('click', () => {
      const platform = button.textContent.trim();
      let url = '';
      
      switch(platform) {
        case 'YouTube': url = 'https://youtube.com'; break;
        case 'TikTok': url = 'https://tiktok.com/foryou'; break;
        case 'Instagram': url = 'https://instagram.com'; break;
        case 'Discord': url = 'https://discord.com'; break;
        case 'X-Twitter': url = 'https://twitter.com'; break;
        case 'GeForce NOW': url = 'https://play.geforcenow.com'; break;
        case 'Github': url = 'https://github.com'; break;
      }
      
      if (url) navigateToBrowser(url);
    });
  });
});