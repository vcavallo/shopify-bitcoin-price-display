// Shopify Bitcoin Price Display Plugin
(function () {
  "use strict";

  class BitcoinPriceConverter {
    constructor(options = {}) {
      this.apiUrl =
        "https://bitcoin-rss.cloud.vinney.xyz/bitcoin_price_feed.xml";
      this.updateInterval = options.updateInterval || 25; // minutes // minutes
      this.cacheKey = "btc_price_cache";
      this.lastUpdate = 0;
      this.currentBtcPrice = null;
      this.displayInSats = true;
      this.isEnabled = true;

      console.log("Bitcoin Price Converter initializing...");
      this.init();
    }

    async init() {
      try {
        await this.loadCachedPrice();
        this.startPriceUpdates();
        this.initToggle();
        this.convertAllPrices();
        this.observeNewContent();
        console.log("Bitcoin Price Converter initialized successfully");
      } catch (error) {
        console.error("Failed to initialize Bitcoin Price Converter:", error);
      }
    }

    async loadCachedPrice() {
      try {
        const cached = localStorage.getItem(this.cacheKey);
        if (cached) {
          const data = JSON.parse(cached);
          const now = Date.now();
          if (now - data.timestamp < this.updateInterval * 60 * 1000) {
            this.currentBtcPrice = data.price;
            this.lastUpdate = data.timestamp;
            console.log("Loaded cached BTC price:", this.currentBtcPrice);
            return;
          }
        }
      } catch (error) {
        console.warn("Failed to load cached BTC price:", error);
      }
      await this.fetchBtcPrice();
    }

    async fetchBtcPrice() {
      const lockKey = "btc_fetch_lock";
      const lockTimeout = 30000;

      try {
        const existingLock = localStorage.getItem(lockKey);
        if (existingLock) {
          const lockTime = parseInt(existingLock);
          if (Date.now() - lockTime < lockTimeout) {
            console.log("Another instance is fetching BTC price, waiting...");
            setTimeout(() => this.loadCachedPrice(), 2000);
            return;
          }
        }

        localStorage.setItem(lockKey, Date.now().toString());

        const response = await fetch(this.apiUrl);
        const xmlText = await response.text();

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");

        const titleElement = xmlDoc.querySelector("item title");
        if (titleElement) {
          const titleText = titleElement.textContent;
          const priceMatch = titleText.match(/\$([0-9,]+\.?[0-9]*)/);

          if (priceMatch) {
            const priceString = priceMatch[1].replace(/,/g, "");
            const price = parseFloat(priceString);

            if (!isNaN(price)) {
              this.currentBtcPrice = price;
              this.lastUpdate = Date.now();

              const cacheData = {
                price: this.currentBtcPrice,
                timestamp: this.lastUpdate,
                version: 1,
              };

              localStorage.setItem(this.cacheKey, JSON.stringify(cacheData));
              localStorage.setItem(
                "btc_price_update",
                JSON.stringify({
                  price: this.currentBtcPrice,
                  timestamp: this.lastUpdate,
                })
              );

              console.log("Updated BTC price from RSS:", this.currentBtcPrice);

              if (this.isEnabled) {
                this.convertAllPrices();
              }
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch BTC price from RSS:", error);
        await this.fetchFallbackPrice();
      } finally {
        localStorage.removeItem(lockKey);
      }
    }

    async fetchFallbackPrice() {
      try {
        const response = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
        );
        const data = await response.json();

        if (data.bitcoin && data.bitcoin.usd) {
          this.currentBtcPrice = data.bitcoin.usd;
          console.log("Used fallback CoinGecko price:", this.currentBtcPrice);
          return true;
        }
      } catch (error) {
        console.error("Fallback price fetch failed:", error);
      }
      return false;
    }

    startPriceUpdates() {
      setInterval(() => this.fetchBtcPrice(), this.updateInterval * 60 * 1000);
    }

    convertToBtc(usdPrice) {
      const cleanPrice = parseFloat(usdPrice.toString().replace(/[$,]/g, ""));
      if (isNaN(cleanPrice) || !this.currentBtcPrice) return null;
      return cleanPrice / this.currentBtcPrice;
    }

    formatBtcPrice(btcAmount) {
      if (!btcAmount) return "";
      if (this.displayInSats) {
        const sats = Math.round(btcAmount * 100_000_000);
        return `ƀ${sats.toLocaleString()} (sats)`;
      }
      if (btcAmount >= 1) return "₿" + btcAmount.toFixed(4);
      if (btcAmount >= 0.001) return "₿" + btcAmount.toFixed(6);
      return "₿" + btcAmount.toFixed(8);
    }

    isCheckoutPage() {
      return (
        window.location.pathname.includes("/checkout") ||
        document.body.classList.contains("template-cart")
      );
    }

    isElementInCheckout(element) {
      const selectors = [
        ".checkout",
        ".cart",
        "[data-cart-drawer]",
        ".order-summary",
        ".payment-summary",
      ];
      return selectors.some((sel) => element.closest(sel));
    }

    convertAllPrices() {
      if (!this.currentBtcPrice || this.isCheckoutPage()) return;
      const selectors = [
        ".price",
        ".product-price",
        ".money",
        "[data-price]",
        ".price-item",
        ".product__price",
        ".h2.price",
      ];
      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => {
          if (!this.isElementInCheckout(el)) this.convertPriceElement(el);
        });
      });
    }

    convertPriceElement(element) {
      if (!this.isEnabled) {
        if (element.dataset.originalHtml) {
          element.innerHTML = element.dataset.originalHtml;
          element.dataset.btcProcessed = "true";
        }
        return;
      }

      if (!element.dataset.originalHtml) {
        element.dataset.originalHtml = element.innerHTML;
      }

      const parser = new DOMParser();
      const originalDoc = parser.parseFromString(
        `<div>${element.dataset.originalHtml}</div>`,
        "text/html"
      );
      const cleanHTML = originalDoc.body.firstChild.innerHTML;
      element.innerHTML = cleanHTML;

      const moneyElements = element.querySelectorAll(".money");
      moneyElements.forEach((span) => {
        const original = span.textContent;
        const match = original.match(/\$[\d,.]+/);
        if (!match) return;

        const usdPrice = match[0];
        const btcAmount = this.convertToBtc(usdPrice);
        if (!btcAmount) return;

        const btcFormatted = this.formatBtcPrice(btcAmount);
        const btcHTML = `<span class="btc-price-display"><span class="btc-amount">${btcFormatted}</span></span>`;
        // <span class="usd-amount"> (${usdPrice})</span>`;
        span.innerHTML = btcHTML;
      });

      element.dataset.btcProcessed = "true";
    }

    initToggle() {
      if (this.isCheckoutPage()) return;
      const toggle = document.createElement("button");
      toggle.id = "btc-price-toggle";
      toggle.innerHTML = this.getToggleLabel();
      Object.assign(toggle.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: "9999",
        background: "#f7931a",
        color: "white",
        border: "none",
        padding: "8px 12px",
        borderRadius: "4px",
        fontSize: "12px",
        fontWeight: "bold",
        cursor: "pointer",
        boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
        transition: "background 0.2s",
      });
      toggle.addEventListener("click", () => {
        this.displayInSats = !this.displayInSats;
        toggle.innerHTML = this.getToggleLabel();
        this.convertAllPrices();
      });
      toggle.addEventListener(
        "mouseenter",
        () => (toggle.style.background = "#e8861b")
      );
      toggle.addEventListener(
        "mouseleave",
        () => (toggle.style.background = "#f7931a")
      );
      document.body.appendChild(toggle);
    }

    getToggleLabel() {
      return this.displayInSats ? "Display: ƀ Satoshis" : "Display: ₿ BTC";
    }

    toggleDisplay() {
      this.isEnabled = !this.isEnabled;
      const toggle = document.getElementById("btc-price-toggle");
      if (toggle) toggle.innerHTML = this.getToggleLabel();
      document
        .querySelectorAll('[data-btc-processed="true"]')
        .forEach((el) => delete el.dataset.btcProcessed);
      this.convertAllPrices();
    }

    observeNewContent() {
      const observer = new MutationObserver(() =>
        setTimeout(() => this.convertAllPrices(), 100)
      );
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  class ShopifyBitcoinApp {
    constructor() {
      this.converter = null;
      this.settings = { updateInterval: 5 };
    }

    async init() {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => this.start());
      } else {
        this.start();
      }
    }

    start() {
      console.log("Starting Shopify Bitcoin Price Display...");
      this.converter = new BitcoinPriceConverter({
        updateInterval: this.settings.updateInterval,
      });
      this.handleShopifyEvents();
    }

    handleShopifyEvents() {
      document.addEventListener("shopify:section:load", () =>
        setTimeout(() => this.converter?.convertAllPrices(), 200)
      );
      document.addEventListener("change", (event) => {
        if (
          event.target.matches(
            '[data-product-form] select, [data-product-form] input[type="radio"]'
          )
        ) {
          setTimeout(() => this.converter?.convertAllPrices(), 100);
        }
      });
    }

    configure(newSettings) {
      this.settings = Object.assign(this.settings, newSettings);
      if (this.converter) {
        this.converter.updateInterval = this.settings.updateInterval;
      }
    }
  }

  const style = document.createElement("style");
  style.textContent = `
    .btc-price-display { display: inline-block; }
    .btc-amount { font-weight: bold; color: #f7931a; }
    .usd-amount { font-size: 0.8em !important; color: #666 !important; opacity: 0.8; margin-left: 5px; }
   `;
  // @media (max-width: 768px) {
  //   #btc-price-toggle { top: 10px !important; right: 10px !important; padding: 6px 10px !important; font-size: 11px !important; }
  // }
  //`;

  document.head.appendChild(style);

  const shopifyBitcoinApp = new ShopifyBitcoinApp();
  shopifyBitcoinApp.init();
  window.configureBitcoinDisplay = (settings) =>
    shopifyBitcoinApp.configure(settings);
})();
