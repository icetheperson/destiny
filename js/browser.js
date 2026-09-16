document.addEventListener("DOMContentLoaded", async () => {
  const addressBar = document.getElementById("addressBar");
  const framesContainer = document.getElementById("framesContainer");
  const tabBar = document.getElementById("tabBar");
  const buttonAddTab = document.getElementById("buttonAddTab");
  
  let tabs = [];
  let activeTabId = null;
  let tabIdCounter = 0;
  let scramjetInstance = null;
  let globalHistory = JSON.parse(localStorage.getItem("destinyHistory") || "[]");
  
  const searchString = typeof window.__HAZE_SEARCH__ !== "undefined" ? window.__HAZE_SEARCH__ : window.location.search;
  const urlParams = new URLSearchParams(searchString);
  const initialUrl = parseQueryToUrl(urlParams.get("url") || "https://duckduckgo.com");
  
  if (window.location.search.includes("url=")) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
  
  function parseQueryToUrl(query) {
    if (!query) return "https://duckduckgo.com/";
    let trimmed = String(query).trim();
    if (/^https?:\/\//i.test(trimmed)) {
      if (trimmed.endsWith("/undefined")) trimmed = trimmed.replace(/\/undefined$/i, "");
      if (trimmed.endsWith("/null")) trimmed = trimmed.replace(/\/null$/i, "");
      return trimmed;
    }
    if (trimmed === "undefined" || trimmed === "null" || !trimmed) {
      return "https://duckduckgo.com/";
    }
    if (/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(trimmed) || /^localhost(:\d+)?/i.test(trimmed)) {
      return "https://" + trimmed;
    }
    return "https://duckduckgo.com/?q=" + encodeURIComponent(trimmed);
  }
  
  function getDomainLetter(url) {
    if (!url || url === "about:blank") return "N";
    try { return new URL(url).hostname.replace('www.', '').charAt(0).toUpperCase(); } 
    catch(e) { return "U"; }
  }
  
  function formatTime(date) {
    return date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  }
  
  function saveHistory(url, title) {
    if (url === "about:blank" || !url.startsWith("http")) return;
    const entry = { url, title: title || url, time: Date.now() };
    globalHistory.unshift(entry);
    if (globalHistory.length > 100) globalHistory.pop();
    localStorage.setItem("destinyHistory", JSON.stringify(globalHistory));
    renderHistory();
  }
  
  function createTab(url = "https://duckduckgo.com") {
    if (tabs.length >= 8) return;
    
    const id = `tab-${tabIdCounter++}`;
    
    const iframe = document.createElement("iframe");
    framesContainer.appendChild(iframe);
    
    let frameObj = null;
    if (scramjetInstance) {
      frameObj = scramjetInstance.createFrame(iframe);
      frameObj.go(url);
    }
    
    const tabEl = document.createElement("div");
    tabEl.className = "browserTab";
    tabEl.id = id;
    tabEl.innerHTML = `
      <div class="tabLeft">
        <div class="tabFavicon"><div class="spinner"></div></div>
        <div class="tabTitle">Loading...</div>
      </div>
      <button class="tabClose">✕</button>
    `;
    
    tabEl.addEventListener("click", (e) => {
      if (e.target.closest(".tabClose")) { closeTab(id); return; }
      switchTab(id);
    });
    
    tabBar.insertBefore(tabEl, buttonAddTab);
    
    const newTab = { id, url, title: "Loading...", iframe, frameObj, el: tabEl, historyStack: [], historyIndex: -1, isLoading: true };
    tabs.push(newTab);
    switchTab(id);
  }
  
  function decodeScramjetUrl(rawUrl) {
    if (!rawUrl || rawUrl === "about:blank") return rawUrl;
    try {
      if (typeof $scramjet !== "undefined" && $scramjet.defaultConfig && $scramjet.defaultConfig.codec) {
        const urlObj = new URL(rawUrl);
        const decoded = $scramjet.defaultConfig.codec.decode(urlObj.pathname + urlObj.search);
        if (decoded && !decoded.includes(window.location.host)) return decoded;
      }
    } catch (e) {}
    try {
      const match = rawUrl.match(/\/~\/sj\/[^\/]+\/[^\/]+\/(.+)/);
      if (match) {
        let extracted = decodeURIComponent(match[1]);
        extracted = extracted.replace(/[\?&]\$rfp=.*$/, "");
        return extracted;
      }
    } catch (e) {}
    return rawUrl;
  }
  
  function cleanUrlParameters(rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.hostname.includes("youtube.com")) {
        url.searchParams.delete("$io");
        url.searchParams.delete("$rfs");
        let query = url.searchParams.get("search_query");
        if (query && query.includes("?$io=")) {
          url.searchParams.set("search_query", query.split("?$io=")[0]);
        }
      } else if (url.hostname.includes("duckduckgo.com")) {
        url.searchParams.delete("origin");
        url.searchParams.delete("t");
      } else if (url.hostname.includes("tiktok.com")) {
        url.searchParams.delete("$io");
        if (query && query.includes("?$io=")) {
          url.searchParams.set("search_query", query.split("?$io=")[0]);
        }
      }
      return url.toString();
    } catch (e) {
      return rawUrl;
    }
  }
  
  setInterval(() => {
    tabs.forEach(tab => {
      try {
        if (!tab.iframe || !tab.iframe.contentWindow) return;
        
        const currentHref = tab.iframe.contentWindow.location.href;
        const currentTitle = tab.iframe.contentDocument ? tab.iframe.contentDocument.title : tab.url;
        
        if (!currentHref || currentHref === "about:blank" || currentHref.includes("undefined") || currentHref.includes("null")) {
          return; 
        }
        
        let cleanUrl = decodeScramjetUrl(currentHref);
        cleanUrl = cleanUrlParameters(cleanUrl);
        
        if (!cleanUrl || cleanUrl === "undefined" || cleanUrl === "null") return;
        if (cleanUrl.startsWith(window.location.origin)) return;
        
        let domainTitle = cleanUrl;
        try {
          domainTitle = new URL(cleanUrl).hostname;
        } catch(e) {}
        
        if (tab.url !== cleanUrl) {
          tab.url = cleanUrl;
          tab.title = domainTitle;
          tab.historyStack.push(cleanUrl);
          tab.historyIndex++;
          tab.isLoading = true; 
          saveHistory(cleanUrl, tab.title);
        } else if (tab.iframe.contentDocument && tab.iframe.contentDocument.readyState === 'complete') {
          tab.isLoading = false;
          tab.title = domainTitle;
        }
        updateTabUI(tab);
        
      } catch (e) { }
    });
  }, 200);
  
  
  function switchTab(id) {
    activeTabId = id;
    tabs.forEach(t => {
      t.el.classList.toggle("active", t.id === id);
      t.iframe.classList.toggle("active", t.id === id);
      if (t.id === id) addressBar.value = t.url;
    });
  }
  
  function closeTab(id) {
    const index = tabs.findIndex(t => t.id === id);
    if (index === -1) return;
    
    tabs[index].iframe.remove();
    tabs[index].el.remove();
    tabs.splice(index, 1);
    
    if (tabs.length === 0) {
      createTab("https://duckduckgo.com");
    } else if (activeTabId === id) {
      switchTab(tabs[Math.max(0, index - 1)].id);
    }
  }
  
  function updateTabUI(tab) {
    const titleEl = tab.el.querySelector(".tabTitle");
    const iconEl = tab.el.querySelector(".tabFavicon");
    
    if (titleEl.textContent !== tab.title) {
      titleEl.textContent = tab.title;
    }
    
    if (tab.isLoading) {
      if (!iconEl.querySelector(".spinner")) {
        iconEl.innerHTML = `<div class="spinner"></div>`;
      }
    } else {
      const letter = getDomainLetter(tab.url);
      if (iconEl.textContent !== letter) {
        iconEl.innerHTML = letter;
      }
    }
    
    if (tab.id === activeTabId && document.activeElement !== addressBar) {
      addressBar.value = tab.url;
    }
  }
  
  
  try {
    const { Controller } = $scramjetController;
    const { defaultConfig } = $scramjet;
    const EpoxyTransport = self.EpoxyTransport.default;
    
    await navigator.serviceWorker.register("service.js");
    const serviceworker = navigator.serviceWorker.controller ?? (await navigator.serviceWorker.ready).active;
    
    const transport = new EpoxyTransport({ wisp: "wss://arctic.lat/_q/" });
    await transport.init();
    
    scramjetInstance = new Controller({ serviceworker, transport, scramjetConfig: defaultConfig });
    await scramjetInstance.wait();
    
    createTab(initialUrl);
    
    
  } catch (err) {
    console.error("Failed to init Scramjet:", err);
    createTab(initialUrl); 
  }
  
  buttonAddTab.addEventListener("click", () => createTab());
  
  document.getElementById("buttonDuplicate").addEventListener("click", () => {
    const active = tabs.find(t => t.id === activeTabId);
    if (active) createTab(active.url);
  });
  
  addressBar.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const targetUrl = parseQueryToUrl(addressBar.value);
      const active = tabs.find(t => t.id === activeTabId);
      if (active && active.frameObj) {
        active.isLoading = true;
        updateTabUI(active);
        active.frameObj.go(targetUrl);
      }
    }
  });
  
  document.getElementById("historySearch").addEventListener("input", () => {
    renderHistory();
  });
  
  document.getElementById("buttonBack").addEventListener("click", () => {
    const active = tabs.find(t => t.id === activeTabId);
    if (active && active.historyIndex > 0) {
      active.historyIndex--;
      active.isLoading = true;
      active.frameObj.go(active.historyStack[active.historyIndex]);
    }
  });
  
  document.getElementById("buttonForward").addEventListener("click", () => {
    const active = tabs.find(t => t.id === activeTabId);
    if (active && active.historyIndex < active.historyStack.length - 1) {
      active.historyIndex++;
      active.isLoading = true;
      active.frameObj.go(active.historyStack[active.historyIndex]);
    }
  });
  
  document.getElementById("buttonReload").addEventListener("click", () => {
    const active = tabs.find(t => t.id === activeTabId);
    if (active && active.frameObj) {
      active.isLoading = true;
      active.frameObj.go(active.url);
    }
  });
  
  const historyPanel = document.getElementById("historyPanel");
  document.getElementById("buttonHistory").addEventListener("click", () => {
    document.getElementById("historySearch").value = "";
    renderHistory();
    historyPanel.classList.add("open");
  });
  document.getElementById("closeHistory").addEventListener("click", () => historyPanel.classList.remove("open"));
  document.getElementById("buttonClearHistory").addEventListener("click", () => {
    globalHistory = [];
    localStorage.removeItem("destinyHistory");
    renderHistory();
  });
  document.getElementById("historySearch").addEventListener("input", () => {
    renderHistory();
  });
  
  function renderHistory() {
    const list = document.getElementById("historyList");
    const searchQuery = document.getElementById("historySearch").value.toLowerCase();
    
    const filteredHistory = globalHistory.filter(item => {
      const matchTitle = (item.title || "").toLowerCase().includes(searchQuery);
      const matchUrl = (item.url || "").toLowerCase().includes(searchQuery);
      return matchTitle || matchUrl;
    });
    
    if (filteredHistory.length === 0) {
      list.innerHTML = `<div style="padding: 20px 0; color: var(--textMuted); text-align: center;">No history found.</div>`;
      return;
    }
    
    let html = "";
    let currentGroup = "";
    
    filteredHistory.forEach(item => {
      let domain = "unknown";
      try { domain = new URL(item.url).hostname; } catch(e){}
      
      const itemDate = new Date(item.time);
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      let itemGroup = "";
      if (itemDate.toDateString() === today.toDateString()) {
        itemGroup = "TODAY";
      } else if (itemDate.toDateString() === yesterday.toDateString()) {
        itemGroup = "YESTERDAY";
      } else {
        itemGroup = itemDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
      }
      
      if (itemGroup !== currentGroup) {
        html += `<div class="historyGroup">${itemGroup}</div>`;
        currentGroup = itemGroup;
      }
      
      html += `
        <div class="historyItem" onclick="document.getElementById('addressBar').value='${item.url}'; document.getElementById('addressBar').dispatchEvent(new KeyboardEvent('keydown', {'key': 'Enter'})); document.getElementById('closeHistory').click();">
          <div class="historyItemFavicon">${getDomainLetter(item.url)}</div>
          <div class="historyItemDetails">
            <div class="historyItemTitle">${item.title}</div>
            <div class="historyItemUrl">${domain}</div>
          </div>
          <div class="historyItemTime">${formatTime(new Date(item.time))}</div>
        </div>
      `;
    });
    
    list.innerHTML = html;
  }
});