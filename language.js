// A language-specific URL wins over the saved preference, including on deep links.
(() => {
  const url = new URL(location.href);
  const admin = /\/admin(?:-en)?(?:\.html)?\/?$/.test(url.pathname);
  const englishPage = document.documentElement.lang === 'en';
  const requested = url.searchParams.get('lang');
  let saved;
  try { saved = localStorage.getItem('growth-language'); } catch {}
  const language = ['en', 'zh'].includes(requested) ? requested :
    (englishPage ? 'en' : saved === 'en' ? 'en' : 'zh');

  function address(lang, base = new URL(location.href)) {
    base.pathname = admin ? (lang === 'en' ? '/admin-en' : '/admin') : (lang === 'en' ? '/en' : '/');
    base.searchParams.set('lang', lang);
    return base;
  }
  if (location.hostname === 'mengxianying.github.io') {
    const target = new URL('https://growth-studio-atlas.pages.dev/');
    target.search = url.search;
    target.hash = url.hash;
    location.replace(address(language, target));
    return;
  }
  if ((language === 'en') !== englishPage) {
    location.replace(address(language));
    return;
  }
  try { localStorage.setItem('growth-language', language); } catch {}
  function updateLinks() {
    const alternate = language === 'en' ? 'zh' : 'en';
    for (const link of document.querySelectorAll('[data-language-switch]')) {
      link.href = address(alternate);
      link.lang = link.hreflang = alternate === 'en' ? 'en' : 'zh-CN';
      link.textContent = alternate === 'en' ? 'English' : '中文';
    }
  }
  document.addEventListener('DOMContentLoaded', updateLinks);
  addEventListener('hashchange', updateLinks);
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-language-switch]');
    if (link) link.href = address(language === 'en' ? 'zh' : 'en');
  });
})();
