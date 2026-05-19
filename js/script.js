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

})();
