(() => {
  if (window.__storePixelsLoaded) return;
  window.__storePixelsLoaded = true;

  let configPromise;

  const config = () =>
    (configPromise ||= fetch("/api/settings")
      .then(async (response) => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Pixel settings unavailable");
        }

        return data;
      })
      .catch((error) => {
        configPromise = null;
        throw error;
      }));

  function init(pixelIds) {
    if (!pixelIds.length) return;

    if (!window.fbq) {
      const queue = (window.fbq = function (...args) {
        if (queue.callMethod) {
          queue.callMethod.apply(queue, args);
        } else {
          queue.queue.push(args);
        }
      });

      if (!window._fbq) {
        window._fbq = queue;
      }

      queue.push = queue;
      queue.loaded = true;
      queue.version = "2.0";
      queue.queue = [];

      const script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      document.head.appendChild(script);
    }

    pixelIds.forEach((pixelId) => {
      window.fbq("init", pixelId);
      window.fbq("set", "autoConfig", false, pixelId);
    });
  }

  const ready = config().then(({ pixels = [] }) => {
    const uniquePixelIds = [...new Set(pixels.map(String))];

    init(uniquePixelIds);

    return uniquePixelIds;
  });

  ready.catch(() => {});

  let lastPagePath = "";
  let pageViewRequestId = 0;

  function getCurrentPagePath() {
    return (
      location.pathname
        .replace(/\/+$/, "")
        .toLowerCase() || "/"
    );
  }

  async function sendPageView() {
    const currentPath = getCurrentPagePath();

    if (currentPath === lastPagePath) {
      return;
    }

    lastPagePath = currentPath;

    const requestId = ++pageViewRequestId;


    try {
      const pixelIds = await ready;

      if (
        requestId !== pageViewRequestId ||
        currentPath !== getCurrentPagePath() ||
        !pixelIds.length
      ) {
        return;
      }

      pixelIds.forEach(id => window.fbq("trackSingle", id, "PageView"));
    } catch {}
  }

  ["pushState", "replaceState"].forEach((method) => {
    const originalMethod = history[method];

    history[method] = function (...args) {
      const result = originalMethod.apply(this, args);

      sendPageView();

      return result;
    };
  });

  window.addEventListener("popstate", sendPageView);

  sendPageView();

  window.fireStorePixelEvent = async (
    eventName,
    eventParameters = {},
    dedupeKey = "",
  ) => {
    try {
      const pixelIds = await ready;

      if (!pixelIds.length) {
        return;
      }

      const storageKey = dedupeKey
        ? `pixel:${eventName}:${dedupeKey}`
        : "";

      if (storageKey) {
        try {
          if (localStorage.getItem(storageKey)) {
            return;
          }
        } catch {}
      }

      pixelIds.forEach(id => window.fbq(
        "trackSingle", id, eventName, eventParameters,
        dedupeKey ? { eventID: `${eventName}:${dedupeKey}` } : {},
      ));

      if (storageKey) {
        try {
          localStorage.setItem(storageKey, "1");
        } catch {}
      }
    } catch {}
  };

})();

