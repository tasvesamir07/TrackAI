export const setupRoutePrefetching = () => {
  if (!window.IntersectionObserver) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const link = entry.target as HTMLAnchorElement;
        const href = link.getAttribute('href');
        if (href) {
          // Find matching link element in the DOM to get the preload tag if exists,
          // or we can prefetch dynamically. Since Vite uses module preload, we can create a link tag.
          // Better: we can dynamically import if we know the route mapping, but since we don't 
          // have a centralized map here, we can create a <link rel="prefetch" href="..."> for the href 
          // to hint the browser.
          
          const existingPrefetch = document.querySelector(`link[rel="prefetch"][href="${href}"]`);
          if (!existingPrefetch) {
            // This is a naive prefetch. A better way for React Router is to prefetch the module.
            // Assuming Vite, we can try to fetch the path to let service worker cache it.
            fetch(href, { priority: 'low' }).catch(() => {});
          }
          observer.unobserve(link);
        }
      }
    });
  }, { rootMargin: '50px' });

  const observeLinks = () => {
    const links = document.querySelectorAll('a[href^="/"]');
    links.forEach((link) => observer.observe(link));
  };

  observeLinks();

  // Re-observe when DOM changes (e.g., React renders new links)
  const mutationObserver = new MutationObserver(() => {
    observeLinks();
  });

  mutationObserver.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    mutationObserver.disconnect();
  };
};
