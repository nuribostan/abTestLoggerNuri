/**
 * ABGuard Pro - Enterprise A/B Test Error Tracking Library
 * @version 2.1.0
 * @author Senin Panelin
 * @description A/B testleri için hata yakalama, DOM izleme ve performans takibi.
 */
(function (window) {
  "use strict";

  /* ==================== CONFIGURATION ==================== */
  const CONFIG = {
    // Hataların gönderileceği sunucu adresi
    API_ENDPOINT: 'https://ab-test-logger.netlify.app/.netlify/functions/ab-logger',

    // Network trafiğini boğmamak için hataları bu sayıda biriktirip atar
    BATCH_SIZE: 5,

    // Batch dolmazsa en geç bu sürede (ms) gönderir
    BATCH_INTERVAL: 4000,

    // Bir kullanıcının oturum süresi (30 dk)
    SESSION_DURATION: 30 * 60 * 1000,

    // Infinite loop koruması: Bir oturumda max gönderilecek hata
    MAX_ERRORS_PER_SESSION: 20,

    // Trafik örnekleme: 1.0 = %100, 0.1 = %10 (Maliyet optimizasyonu için)
    SAMPLE_RATE: 1.0,

    // Konsola renkli log basar
    DEBUG_MODE: true,
  };

  /* ==================== UTILS ==================== */
  const Utils = {
    // Benzersiz ID oluşturucu
    uuid: () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,

    // Hatanın oluştuğu stack trace'i temizler ve anlamlı kısmı alır
    getStack: () => {
      try {
        throw new Error();
      } catch (e) {
        // İlk satırlar kütüphanenin kendisi olduğu için onları temizliyoruz
        return e.stack
          ? e.stack.split("\n").slice(3).join("\n")
          : "Stack trace unavailable";
      }
    },

    // Kullanıcı ortam bilgileri
    getContext: () => ({
      url: window.location.href,
      path: window.location.pathname,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      language: navigator.language,
      connection: navigator.connection
        ? navigator.connection.effectiveType
        : "unknown",
    }),
  };

  /* ==================== SESSION MANAGER ==================== */
  class SessionManager {
    constructor() {
      this.storageKey = "abguard_sess_v2";
      this.data = this._load();
      this.errorCount = 0;

      // Session başında bu kullanıcının izlenip izlenmeyeceğine karar ver (Sampling)
      if (typeof this.data.sampled === "undefined") {
        this.data.sampled = Math.random() <= CONFIG.SAMPLE_RATE;
        this._save();
      }
    }

    _load() {
      try {
        const stored = JSON.parse(localStorage.getItem(this.storageKey));
        if (stored && Date.now() - stored.ts < CONFIG.SESSION_DURATION) {
          stored.ts = Date.now(); // Süreyi uzat
          localStorage.setItem(this.storageKey, JSON.stringify(stored));
          return stored;
        }
      } catch (_) {}
      return { id: Utils.uuid(), ts: Date.now(), sampled: undefined };
    }

    _save() {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.data));
      } catch (_) {}
    }

    get sessionId() {
      return this.data.id;
    }
    get isSampled() {
      return this.data.sampled;
    }

    canLog() {
      if (!this.isSampled) return false;
      if (this.errorCount >= CONFIG.MAX_ERRORS_PER_SESSION) return false;
      this.errorCount++;
      return true;
    }
  }

  /* ==================== ERROR BATCHER ==================== */
  class ErrorBatcher {
    constructor() {
      this.queue = [];
      this.timer = null;

      // Sayfa kapanırken kalanları göndermeyi dene
      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.flush();
      });
    }

    add(errorPayload) {
      this.queue.push(errorPayload);
      if (this.queue.length >= CONFIG.BATCH_SIZE) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), CONFIG.BATCH_INTERVAL);
      }
    }

    flush() {
      if (this.queue.length === 0) return;

      const payload = JSON.stringify({ errors: this.queue });
      const dataToSend = this.queue; // Referans kopyala
      this.queue = []; // Kuyruğu boşalt
      clearTimeout(this.timer);
      this.timer = null;

      if (navigator.sendBeacon) {
        // Beacon API daha güvenilirdir (sayfa kapansa bile gider)
        const blob = new Blob([JSON.stringify({ errors: dataToSend })], {
          type: "application/json",
        });
        navigator.sendBeacon(CONFIG.API_ENDPOINT, blob);
      } else {
        fetch(CONFIG.API_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ errors: dataToSend }),
          keepalive: true,
        }).catch(() => {
          /* Silent fail */
        });
      }
    }
  }

  /* ==================== ABGUARD MAIN CLASS ==================== */
  class ABGuard {
    constructor(testId, variation, version) {
      this.testId = testId;
      this.variation = variation;
      this.version = version;

      // Singleton yapıları kullan
      this.session = window._abGuardSession =
        window._abGuardSession || new SessionManager();
      this.batcher = window._abGuardBatcher =
        window._abGuardBatcher || new ErrorBatcher();

      this.sentHashes = new Set(); // Aynı hatayı tekrar tekrar göndermemek için
    }

    /**
     * Hata nesnesi oluşturur ve kuyruğa ekler
     */
    log(type, message, meta = {}, severity = "error", customStack = null) {
      if (!this.session.canLog()) return;

      // Dedup (Aynı mesajı tekrar gönderme)
      const errorHash = `${this.testId}:${type}:${message}`;
      if (this.sentHashes.has(errorHash)) return;
      this.sentHashes.add(errorHash);

      const payload = {
        test_id: this.testId,
        variation: this.variation,
        test_version: this.version,
        session_id: this.session.sessionId,
        timestamp: Date.now(),
        type: type,
        severity: severity,
        message: message,
        stack_trace: customStack || Utils.getStack(),
        meta: meta,
        context: Utils.getContext(),
      };

      if (CONFIG.DEBUG_MODE) {
        const style =
          severity === "critical"
            ? "background: #ff0000; color: #fff"
            : "background: #fff000; color: #000";
        console.log(`%c ABGuard [${type}] `, style, message, payload);
      }

      this.batcher.add(payload);
    }

    /* ---------- DOM YARDIMCILARI ---------- */

    /**
     * Elementi senkron olarak seçer. Bulamazsa hata kaydeder.
     * @param {string} selector - CSS seçicisi
     * @param {object} options - { fatal: boolean, name: string }
     */
    getElement(selector, { fatal = false, name = "Unknown Element" } = {}) {
      const el = document.querySelector(selector);

      if (!el) {
        const stack = Utils.getStack(); // Hatayı burada yakala ki doğru satır görünsün
        this.log(
          "ELEMENT_MISSING",
          `Element bulunamadı: ${selector} (${name})`,
          { selector, name },
          fatal ? "critical" : "error",
          stack,
        );

        if (fatal)
          throw new Error(`[ABGuard Fatal] Missing element: ${selector}`);
        return null;
      }
      return el;
    }

    /**
     * Asenkron element bekleyici (SPA/React/Vue için kritik).
     * MutationObserver kullanır.
     */
    waitForElement(
      selector,
      { timeout = 5000, fatal = false, name = "Async Element" } = {},
    ) {
      return new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);

        let observer;
        const timer = setTimeout(() => {
          if (observer) observer.disconnect();

          const stack = Utils.getStack();
          this.log(
            "ELEMENT_TIMEOUT",
            `Element süre aşımında gelmedi: ${selector}`,
            { selector, timeout, name },
            fatal ? "critical" : "warning",
            stack,
          );

          if (fatal) reject(new Error(`Timeout waiting for: ${selector}`));
          else resolve(null);
        }, timeout);

        observer = new MutationObserver(() => {
          const found = document.querySelector(selector);
          if (found) {
            clearTimeout(timer);
            observer.disconnect();
            resolve(found);
          }
        });

        observer.observe(document.body, { childList: true, subtree: true });
      });
    }

    /**
     * Mantıksal kontroller için (Örn: Sepet tutarı 0 olamaz)
     */
    assert(condition, message, meta = {}) {
      if (!condition) {
        this.log("ASSERTION_FAILED", message, meta, "error", Utils.getStack());
      }
    }
  }

  /* ==================== GLOBAL API ==================== */

  /**
   * Test kodunu bu fonksiyon içine yazıyoruz.
   * Otomatik try-catch bloğuna alır.
   */
  window.runABTest = async function (config, callback) {
    const { testId, variation, version = "1.0.0" } = config;
    const guard = new ABGuard(testId, variation, version);

    try {
      await callback(guard);
    } catch (e) {
      // Callback içinde beklenmedik bir JS hatası olursa (Syntax, Reference vs)
      guard.log(
        "RUNTIME_EXCEPTION",
        e.message || "Bilinmeyen Hata",
        { original_stack: e.stack },
        "critical",
      );
      console.error(e); // Developer görsün diye konsola da bas
    }
  };

  // Config güncelleme metodu
  window.ABGuardConfig = (options) => Object.assign(CONFIG, options);
})(window);
