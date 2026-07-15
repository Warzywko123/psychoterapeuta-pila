// Rezerwacja online — kalendarz slotów + formularz.
(function () {
  'use strict';

  var DAY_NAMES = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
  var MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  var MAX_WEEKS_AHEAD = 4;

  var grid = document.getElementById('booking-grid');
  var status = document.getElementById('booking-status');
  var weekLabel = document.getElementById('week-label');
  var btnPrev = document.getElementById('week-prev');
  var btnNext = document.getElementById('week-next');
  var formCard = document.getElementById('booking-form-card');
  var formSlotLabel = document.getElementById('form-slot-label');
  var form = document.getElementById('booking-form');
  var formError = document.getElementById('booking-error');
  var successCard = document.getElementById('booking-success');
  var successSlot = document.getElementById('success-slot');
  if (!grid || !form) return;

  function startOfWeek(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function fmtISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseISO(s) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function humanDate(s) {
    var d = parseISO(s);
    return DAY_NAMES[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  var currentMonday = startOfWeek(new Date());
  var monday = new Date(currentMonday);
  var selected = null;

  function weeksFromNow(m) {
    return Math.round((m - currentMonday) / (7 * 86400e3));
  }

  function setStatus(msg) {
    status.textContent = msg || '';
    status.style.display = msg ? '' : 'none';
  }

  function updateNav() {
    var d2 = new Date(monday);
    d2.setDate(d2.getDate() + 5);
    weekLabel.textContent = monday.getDate() + ' ' + MONTHS[monday.getMonth()] + ' – ' + d2.getDate() + ' ' + MONTHS[d2.getMonth()];
    btnPrev.disabled = weeksFromNow(monday) <= 0;
    btnNext.disabled = weeksFromNow(monday) >= MAX_WEEKS_AHEAD;
  }

  function load() {
    updateNav();
    grid.innerHTML = '';
    setStatus('Ładowanie terminów…');
    fetch('/api/slots?start=' + fmtISO(monday))
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (data) {
        setStatus('');
        render(data.days);
      })
      .catch(function () {
        setStatus('Nie udało się pobrać terminów. Odśwież stronę albo zadzwoń: 501 393 887.');
      });
  }

  function render(days) {
    grid.innerHTML = '';
    var anyAvailable = false;
    days.forEach(function (day) {
      var d = parseISO(day.date);
      if (d.getDay() === 0) return; // niedziela — gabinet nieczynny

      var card = document.createElement('div');
      card.className = 'booking-day';
      var name = document.createElement('div');
      name.className = 'booking-day__name';
      name.textContent = DAY_NAMES[d.getDay()];
      var date = document.createElement('div');
      date.className = 'booking-day__date';
      date.textContent = d.getDate() + ' ' + MONTHS[d.getMonth()];
      card.appendChild(name);
      card.appendChild(date);

      var wrap = document.createElement('div');
      wrap.className = 'booking-day__slots';
      var avail = day.slots.filter(function (s) { return s.available; });
      if (!avail.length) {
        var empty = document.createElement('div');
        empty.className = 'booking-day--empty';
        empty.textContent = 'Brak wolnych terminów';
        wrap.appendChild(empty);
      } else {
        anyAvailable = true;
        avail.forEach(function (s) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'booking-slot';
          btn.textContent = s.time;
          btn.addEventListener('click', function () { select(day.date, s, btn); });
          wrap.appendChild(btn);
        });
      }
      card.appendChild(wrap);
      grid.appendChild(card);
    });
    if (!anyAvailable) {
      setStatus('Brak wolnych terminów w tym tygodniu — sprawdź kolejny tydzień (strzałka wyżej) albo zadzwoń: 501 393 887.');
    }
  }

  function select(date, slot, btn) {
    selected = { date: date, min: slot.min, time: slot.time };
    grid.querySelectorAll('.booking-slot.is-selected').forEach(function (b) { b.classList.remove('is-selected'); });
    btn.classList.add('is-selected');
    formSlotLabel.textContent = humanDate(date) + ', godz. ' + slot.time;
    formCard.style.display = 'block';
    successCard.style.display = 'none';
    hideError();
    formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (typeof gtag === 'function') gtag('event', 'booking_slot_selected');
  }

  function showError(msg) {
    formError.textContent = msg;
    formError.classList.add('is-visible');
  }
  function hideError() {
    formError.classList.remove('is-visible');
  }

  // Filtry wpisywania: telefon = tylko cyfry (max 9), imię i nazwisko = tylko litery
  var phoneInput = document.getElementById('f-phone');
  phoneInput.addEventListener('input', function () {
    var digits = this.value.replace(/\D/g, '');
    if (digits.length > 9 && digits.indexOf('48') === 0) digits = digits.slice(2); // wklejone +48
    this.value = digits.slice(0, 9);
  });

  var phone2Input = document.getElementById('f-phone2');
  phone2Input.addEventListener('input', function () {
    var digits = this.value.replace(/\D/g, '');
    if (digits.length > 9 && digits.indexOf('48') === 0) digits = digits.slice(2); // wklejone +48
    this.value = digits.slice(0, 9);
  });

  var phone2Toggle = document.getElementById('f-phone2-toggle');
  var phone2Field = document.getElementById('f-phone2-field');
  phone2Toggle.addEventListener('change', function () {
    phone2Field.hidden = !this.checked;
    if (!this.checked) phone2Input.value = '';
  });

  var nameInput = document.getElementById('f-name');
  nameInput.addEventListener('input', function () {
    this.value = this.value.replace(/[^a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s]/g, '');
  });

  document.getElementById('form-change-slot').addEventListener('click', function () {
    formCard.style.display = 'none';
    selected = null;
    grid.querySelectorAll('.booking-slot.is-selected').forEach(function (b) { b.classList.remove('is-selected'); });
    document.getElementById('booking-calendar').scrollIntoView({ behavior: 'smooth' });
  });

  btnPrev.addEventListener('click', function () { monday.setDate(monday.getDate() - 7); load(); });
  btnNext.addEventListener('click', function () { monday.setDate(monday.getDate() + 7); load(); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideError();
    if (!selected) { showError('Najpierw wybierz termin z kalendarza powyżej.'); return; }
    var rodo = document.getElementById('f-rodo');
    if (!rodo.checked) { showError('Zaznacz zgodę na przetwarzanie danych.'); return; }

    var payload = {
      date: selected.date,
      min: selected.min,
      name: document.getElementById('f-name').value,
      phone: document.getElementById('f-phone').value,
      phone2: document.getElementById('f-phone2').value,
      rodo: true,
      website: document.getElementById('f-website').value,
    };

    var submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Rezerwuję…';

    fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Rezerwuję termin';
        if (!res.ok) {
          showError(res.body.error || 'Coś poszło nie tak. Spróbuj ponownie.');
          if (String(res.body.error || '').indexOf('zajęty') !== -1) load();
          return;
        }
        successSlot.textContent = humanDate(selected.date) + ', godz. ' + selected.time;
        formCard.style.display = 'none';
        successCard.style.display = 'block';
        form.reset();
        selected = null;
        successCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof gtag === 'function') gtag('event', 'booking_complete');
        load();
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Rezerwuję termin';
        showError('Błąd połączenia. Spróbuj ponownie albo zadzwoń: 501 393 887.');
      });
  });

  load();
})();
