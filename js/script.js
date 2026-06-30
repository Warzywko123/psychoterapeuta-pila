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

  // ----- Banner urlopowy -----
  // Pokazuje pasek tylko w okresie 11.06.2026 - 21.06.2026
  // Po tej dacie automatycznie się nie wyświetla
  (function vacationBanner() {
    const banner = document.querySelector('.vacation-banner');
    if (!banner) return;

    // Okres urlopu (start: 11.06, koniec: 21.06 do końca dnia)
    const vacationStart = new Date('2026-06-11T00:00:00');
    const vacationEnd = new Date('2026-06-21T23:59:59');
    const now = new Date();

    // Pokazuj tylko jeśli jesteśmy w okresie urlopu
    if (now < vacationStart || now > vacationEnd) return;

    // Sprawdź czy user już zamknął banner (sessionStorage = znika po zamknięciu zakładki)
    const closed = sessionStorage.getItem('vacationBannerClosed');
    if (!closed) {
      banner.classList.add('is-visible');
    }

    const closeBtn = banner.querySelector('.vacation-banner__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        banner.classList.remove('is-visible');
        sessionStorage.setItem('vacationBannerClosed', '1');
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
