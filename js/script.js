// =====================================================
// Gabinet Psychoterapii — JavaScript
// Minimalny skrypt: menu mobilne + drobne ulepszenia UX
// =====================================================

(function() {
  'use strict';

  // ----- Menu mobilne (hamburger) -----
  const navToggle = document.querySelector('.nav__toggle');
  const navMenu = document.querySelector('.nav__menu');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', function() {
      const isOpen = navMenu.classList.toggle('active');
      navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      navToggle.textContent = isOpen ? '×' : '☰';
    });

    // Zamknij menu po kliknięciu w link (na mobile)
    document.querySelectorAll('.nav__link').forEach(link => {
      link.addEventListener('click', () => {
        if (navMenu.classList.contains('active')) {
          navMenu.classList.remove('active');
          navToggle.setAttribute('aria-expanded', 'false');
          navToggle.textContent = '☰';
        }
      });
    });
  }

  // ----- Płynne przewijanie do kotwic (anchor links) -----
  // CSS już to robi przez scroll-behavior: smooth, ale dla starszych przeglądarek:
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;

      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ----- Śledzenie kliknięć w numer telefonu (GA4) -----
  // Wysyła event "phone_click" do Google Analytics gdy ktoś kliknie "Zadzwoń"
  document.querySelectorAll('a[href^="tel:"]').forEach(link => {
    link.addEventListener('click', function() {
      if (typeof gtag === 'function') {
        gtag('event', 'phone_click', {
          phone_number: this.getAttribute('href').replace('tel:', ''),
          link_text: this.textContent.trim(),
          page_location: window.location.pathname
        });
      }
    });
  });

  // ----- Śledzenie kliknięć w rezerwację online (GA4) -----
  // Wysyła event "reservation_click" gdy ktoś przechodzi do rezerwacji.
  // Pomijamy kliknięcia wykonane już na samej stronie rezerwacji (link w menu
  // prowadzi wtedy do tej samej strony), żeby nie zawyżać konwersji.
  if (!/rezerwacja\.html$/.test(window.location.pathname)) {
    document.querySelectorAll('a[href*="rezerwacja.html"]').forEach(link => {
      link.addEventListener('click', function() {
        if (typeof gtag !== 'function') return;

        let linkLocation = 'inne';
        if (this.closest('.announce-banner')) linkLocation = 'baner';
        else if (this.closest('.nav')) linkLocation = 'menu';
        else if (this.closest('.hero')) linkLocation = 'hero';
        else if (this.closest('footer')) linkLocation = 'stopka';

        gtag('event', 'reservation_click', {
          link_text: this.textContent.trim(),
          link_location: linkLocation,
          page_location: window.location.pathname
        });
      });
    });
  }

  // ----- Banner o rezerwacji online -----
  // Widoczny dopóki ktoś go nie zamknie (zapamiętane trwale, nie znika co sesję).
  (function announceBanner() {
    const banner = document.querySelector('.announce-banner');
    if (!banner) return;

    const closed = localStorage.getItem('announceBannerClosed');
    if (!closed) {
      banner.classList.add('is-visible');
    }

    const closeBtn = banner.querySelector('.announce-banner__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        banner.classList.remove('is-visible');
        localStorage.setItem('announceBannerClosed', '1');
      });
    }
  })();

  // ----- Banner urlopowy -----
  // ==========================================================================
  // KOLEJNY URLOP = ZMIANA CZTERECH DAT W OBIEKCIE `URLOP` PONIŻEJ.
  // Nic więcej: treść paska (zakres dni, dzień powrotu, odmiana czasownika)
  // liczy się z tych dat, a w HTML stoi pusty <span class="vacation-banner__text">.
  // Wcześniej daty były w dwóch miejscach — tutaj i wklepane w tekst na
  // kilkunastu podstronach — więc każda zmiana wymagała edycji 17 plików.
  // Po edycji podbić ?v= przy js/script.js (plik ma roczny immutable-cache).
  // ==========================================================================
  (function vacationBanner() {
    const banner = document.querySelector('.vacation-banner');
    if (!banner) return;

    const URLOP = {
      od: new Date('2026-08-11T00:00:00'),       // pierwszy dzień wolnego
      do: new Date('2026-08-18T23:59:59'),       // ostatni dzień wolnego (do końca doby)
      pokazOd: new Date('2026-08-03T00:00:00'),  // od kiedy zapowiadać (zwykle przed urlopem)
      powrot: new Date('2026-08-19T00:00:00'),   // pierwszy dzień przyjęć po urlopie
    };

    const now = new Date();
    // Pasek wisi od zapowiedzi aż do końca ostatniego dnia wolnego.
    if (now < URLOP.pokazOd || now > URLOP.do) return;

    const MIESIACE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
      'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
    const DNI = ['niedzieli', 'poniedziałku', 'wtorku', 'środy', 'czwartku', 'piątku', 'soboty'];

    // „11–18 sierpnia" gdy jeden miesiąc, „30 lipca – 5 sierpnia" gdy urlop go przekracza.
    const zakres = URLOP.od.getMonth() === URLOP.do.getMonth()
      ? URLOP.od.getDate() + '–' + URLOP.do.getDate() + ' ' + MIESIACE[URLOP.do.getMonth()]
      : URLOP.od.getDate() + ' ' + MIESIACE[URLOP.od.getMonth()] + ' – ' +
        URLOP.do.getDate() + ' ' + MIESIACE[URLOP.do.getMonth()];

    const powrot = DNI[URLOP.powrot.getDay()] + ' ' + URLOP.powrot.getDate() + ' ' +
      MIESIACE[URLOP.powrot.getMonth()];

    // Przed urlopem to zapowiedź („będzie zamknięty"), w trakcie stan faktyczny.
    const czasownik = now < URLOP.od ? 'będzie zamknięty' : 'jest zamknięty';

    const tekst = banner.querySelector('.vacation-banner__text');
    if (tekst) {
      const mocny = document.createElement('span');
      mocny.className = 'vacation-banner__strong';
      mocny.textContent = zakres;
      tekst.textContent = '';
      tekst.append(
        document.createTextNode('Gabinet ' + czasownik + ': '),
        mocny,
        document.createTextNode('. Wznowienie wizyt od ' + powrot + '.')
      );
    }

    // Zamknięcie pamiętane na czas sesji karty. Klucz zawiera datę urlopu, więc
    // zamknięcie poprzedniego komunikatu nie ukrywa następnego. Data składana
    // z pól lokalnych, nie przez toISOString() — ten przeliczyłby północ czasu
    // polskiego na UTC i klucz nosiłby dzień wcześniejszy niż początek urlopu.
    const kluczZamkniecia = 'vacationBannerClosed-' + URLOP.od.getFullYear() + '-' +
      String(URLOP.od.getMonth() + 1).padStart(2, '0') + '-' +
      String(URLOP.od.getDate()).padStart(2, '0');
    let zamkniety = false;
    try { zamkniety = !!sessionStorage.getItem(kluczZamkniecia); } catch (e) { /* tryb prywatny */ }
    if (!zamkniety) banner.classList.add('is-visible');

    const closeBtn = banner.querySelector('.vacation-banner__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        banner.classList.remove('is-visible');
        try { sessionStorage.setItem(kluczZamkniecia, '1'); } catch (e) { /* tryb prywatny */ }
      });
    }
  })();

  // ----- Fade-in scroll animations (Intersection Observer) -----
  (function fadeInSections() {
    const targets = document.querySelectorAll('.fade-in-section');
    if (!targets.length) return;
    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach(el => el.classList.add('is-visible'));
      return;
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      targets.forEach(el => el.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.01, rootMargin: '0px 0px 80px 0px' });
    targets.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        el.classList.add('is-visible');
      } else {
        observer.observe(el);
      }
    });
  })();

  // ----- Animated counters (data-counter) -----
  (function animatedCounters() {
    const counters = document.querySelectorAll('[data-counter]');
    if (!counters.length || typeof IntersectionObserver === 'undefined') return;

    const formatNumber = (val, decimals) => {
      if (decimals > 0) return val.toFixed(decimals).replace('.', ',');
      return Math.round(val).toString();
    };

    const animateCounter = (el) => {
      const target = parseFloat(el.dataset.target);
      const decimals = parseInt(el.dataset.decimals || '0', 10);
      const suffix = el.dataset.suffix || '';
      const duration = 1600;
      const startTime = performance.now();

      const step = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = target * eased;
        el.textContent = formatNumber(current, decimals) + suffix;
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    counters.forEach(el => observer.observe(el));
  })();

  // ----- Sticky CTA — pokazuje się po przewinięciu (mobile) -----
  (function stickyCTA() {
    const cta = document.querySelector('.sticky-cta');
    if (!cta) return;
    const threshold = 400;
    let lastVisible = false;
    const onScroll = () => {
      const shouldShow = window.scrollY > threshold;
      if (shouldShow !== lastVisible) {
        cta.classList.toggle('is-visible', shouldShow);
        lastVisible = shouldShow;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  })();

})();

// =====================================================
// Baner cookies + Google Consent Mode v2 (RODO)
// GA4 rusza dopiero po kliknięciu "Akceptuję".
// =====================================================

(function () {
  'use strict';

  const COOKIE_KEY = 'cookies-consent-v2';
  const banner = document.querySelector('.cookie-banner');
  const acceptBtn = document.querySelector('[data-cookie-action="accept"]');
  const rejectBtn = document.querySelector('[data-cookie-action="reject"]');

  // 'granted' = GA4 zbiera anonimowe statystyki, 'denied' = nie zbiera nic.
  function updateGoogleConsent(granted) {
    if (typeof gtag === 'function') {
      gtag('consent', 'update', {
        'analytics_storage': granted ? 'granted' : 'denied',
        // ad_* zawsze denied — strona nie używa reklam Google
        'ad_storage': 'denied',
        'ad_user_data': 'denied',
        'ad_personalization': 'denied'
      });
    }

    // Skrypt Google pobieramy DOPIERO tutaj — bez zgody przeglądarka
    // nie nawiązuje żadnego połączenia z serwerami Google.
    if (granted && typeof window.wczytajGoogleAnalytics === 'function') {
      window.wczytajGoogleAnalytics();
    }
  }

  if (!banner) return;

  const consent = localStorage.getItem(COOKIE_KEY);

  if (consent === 'accepted') {
    // Wcześniej zaakceptowano — włącz GA4 od razu, bez pokazywania banera
    updateGoogleConsent(true);
  } else if (consent !== 'rejected') {
    // Brak decyzji — pokaż baner po chwili.
    // Klasa na <body> chowa pływające CTA „Zadzwoń", które inaczej leży nad
    // banerem i przykrywa przycisk odmowy (patrz .sticky-cta w styles.css).
    setTimeout(function () {
      banner.classList.add('is-visible');
      document.body.classList.add('cookie-banner-open');
    }, 800);
  }

  function decide(value) {
    localStorage.setItem(COOKIE_KEY, value);
    updateGoogleConsent(value === 'accepted');
    banner.classList.remove('is-visible');
    document.body.classList.remove('cookie-banner-open');
    // Mapa Google nasłuchuje tego zdarzenia i wczytuje się bez przeładowania strony
    document.dispatchEvent(new CustomEvent('cookies-decision', { detail: value }));
  }

  if (acceptBtn) acceptBtn.addEventListener('click', function () { decide('accepted'); });
  if (rejectBtn) rejectBtn.addEventListener('click', function () { decide('rejected'); });
})();

// =====================================================
// Mapa Google dopiero za zgodą (RODO)
// Bez zgody iframe ma tylko data-src, więc przeglądarka nie łączy się
// z Google. Adres IP odwiedzającego trafia tam dopiero po kliknięciu
// "Akceptuję" w banerze albo "Pokaż mapę" na samej zaślepce.
// =====================================================

(function () {
  'use strict';

  const COOKIE_KEY = 'cookies-consent-v2';
  const kontenery = document.querySelectorAll('[data-map-consent]');
  if (!kontenery.length) return;

  function pokazMape(kontener) {
    const ramka = kontener.querySelector('iframe[data-src]');
    if (!ramka) return;
    ramka.src = ramka.getAttribute('data-src');
    ramka.removeAttribute('data-src');
    kontener.classList.add('is-map-loaded');
  }

  const zgoda = localStorage.getItem(COOKIE_KEY) === 'accepted';

  kontenery.forEach(function (kontener) {
    if (zgoda) {
      pokazMape(kontener);
      return;
    }
    const przycisk = kontener.querySelector('[data-map-action="load"]');
    if (przycisk) {
      przycisk.addEventListener('click', function () { pokazMape(kontener); });
    }
  });

  // Ktoś kliknął "Akceptuję" już po wejściu na stronę — dociągamy mapę od razu
  document.addEventListener('cookies-decision', function (e) {
    if (e.detail === 'accepted') kontenery.forEach(pokazMape);
  });
})();
