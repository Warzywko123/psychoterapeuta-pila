// Panel rezerwacji DARD — logowanie, kalendarz tygodnia, blokady, odwołania,
// godziny przyjęć, powiadomienia push.
(function () {
  'use strict';

  var DAY_NAMES = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
  var DAY_SHORT = ['nd', 'pn', 'wt', 'śr', 'czw', 'pt', 'sob'];
  var MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

  var $ = function (id) { return document.getElementById(id); };
  var loginView = $('login-view');
  var appView = $('app-view');
  var loginError = $('login-error');

  var state = { monday: startOfWeek(new Date()), data: null };

  function startOfWeek(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function fmtISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseISO(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function digitsOnly(p) { return String(p == null ? '' : p).replace(/\D/g, ''); }
  function prettyPhone(p) { return digitsOnly(p).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3'); }
  function isPast(dateStr, min) { var d = parseISO(dateStr); d.setHours(0, min, 0, 0); return d <= new Date(); }
  // 700 -> "11:40"
  function hhmm(min) {
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  }

  function api(path, opts) {
    return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, status: r.status, body: b }; }); });
  }

  // ---------- Logowanie ----------
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    loginError.textContent = '';
    api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('login-password').value, totp: $('login-totp').value }) })
      .then(function (res) {
        if (!res.ok) { loginError.textContent = res.body.error || 'Błąd logowania'; return; }
        $('login-password').value = '';
        $('login-totp').value = '';
        showApp();
      });
  });

  $('logout-btn').addEventListener('click', function () {
    api('/api/admin/logout', { method: 'POST' }).then(function () {
      appView.style.display = 'none';
      loginView.style.display = 'block';
    });
  });

  function showApp() {
    loginView.style.display = 'none';
    appView.style.display = 'block';
    load();
    initPushUI();
  }

  // ---------- Dane tygodnia ----------
  function load() {
    var mon = state.monday;
    var end = new Date(mon); end.setDate(end.getDate() + 5);
    $('week-label').textContent = mon.getDate() + ' ' + MONTHS[mon.getMonth()] + ' – ' + end.getDate() + ' ' + MONTHS[end.getMonth()];
    $('admin-grid').innerHTML = '<p class="admin-loading">Ładowanie…</p>';
    api('/api/admin/data?start=' + fmtISO(mon)).then(function (res) {
      if (res.status === 401) { appView.style.display = 'none'; loginView.style.display = 'block'; return; }
      if (!res.ok) { $('admin-grid').innerHTML = '<p class="admin-loading">Błąd: ' + (res.body.error || res.status) + '</p>'; return; }
      state.data = res.body;
      render();
    });
  }

  function render() {
    var d = state.data;
    var bookings = {}, blocks = {};
    d.bookings.forEach(function (b) { bookings[b.slot_date + '|' + b.slot_min] = b; });
    d.blocks.forEach(function (b) { blocks[b.slot_date + '|' + b.slot_min] = true; });

    var grid = $('admin-grid');
    grid.innerHTML = '';

    for (var i = 0; i < 7; i++) {
      var day = new Date(state.monday); day.setDate(day.getDate() + i);
      var dateStr = fmtISO(day);
      var starts = d.schedule[day.getDay()] || [];

      var card = document.createElement('div');
      card.className = 'admin-day';
      var head = document.createElement('div');
      head.className = 'admin-day__head';
      head.innerHTML = '<strong>' + DAY_NAMES[day.getDay()] + '</strong><span>' + day.getDate() + ' ' + MONTHS[day.getMonth()] + '</span>';
      card.appendChild(head);

      // Sloty spoza cotygodniowego grafiku na ten konkretny dzień — jednorazowe
      // wyjątki dodane przez "Wizyta o niestandardowej godzinie".
      var slots = starts.map(function (m) { return { min: m, extra: false }; });
      d.bookings.concat(d.blocks).forEach(function (b) {
        if (b.slot_date !== dateStr || starts.indexOf(b.slot_min) !== -1) return;
        if (slots.some(function (s) { return s.min === b.slot_min; })) return;
        slots.push({ min: b.slot_min, extra: true });
      });
      slots.sort(function (a, b) { return a.min - b.min; });

      if (!slots.length) {
        var off = document.createElement('div');
        off.className = 'admin-day__off';
        off.textContent = 'Nieczynne';
        card.appendChild(off);
        grid.appendChild(card);
        continue;
      }

      var freeLeft = 0;
      var wrap = document.createElement('div');
      wrap.className = 'admin-day__slots';
      slots.forEach(function (s) {
        var m = s.min;
        var key = dateStr + '|' + m;
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'admin-slot';
        var hh = hhmm(m) + (s.extra ? ' · wyjątek' : '');

        if (bookings[key]) {
          chip.classList.add('admin-slot--booked');
          chip.textContent = hh + ' · ' + bookings[key].name.split(' ')[0];
          chip.addEventListener('click', openModal.bind(null, bookings[key]));
        } else if (blocks[key]) {
          chip.classList.add('admin-slot--blocked');
          chip.textContent = hh + ' · blokada';
          if (!isPast(dateStr, m)) chip.addEventListener('click', doBlock.bind(null, dateStr, m, 'unblock'));
          else chip.disabled = true;
        } else if (isPast(dateStr, m)) {
          chip.classList.add('admin-slot--past');
          chip.textContent = hh;
          chip.disabled = true;
        } else {
          chip.classList.add('admin-slot--free');
          chip.textContent = hh + ' · wolne';
          chip.addEventListener('click', openSlotModal.bind(null, dateStr, m));
          if (!s.extra) freeLeft++;
        }
        wrap.appendChild(chip);
      });
      card.appendChild(wrap);

      if (starts.length && !isPast(dateStr, starts[starts.length - 1])) {
        var dayBtn = document.createElement('button');
        dayBtn.type = 'button';
        dayBtn.className = 'admin-day__toggle';
        if (freeLeft > 0) {
          dayBtn.textContent = '🚫 Zablokuj dzień';
          dayBtn.addEventListener('click', doDayAction.bind(null, dateStr, 'block-day'));
        } else {
          dayBtn.textContent = '↺ Odblokuj dzień';
          dayBtn.addEventListener('click', doDayAction.bind(null, dateStr, 'unblock-day'));
        }
        card.appendChild(dayBtn);
      }
      grid.appendChild(card);
    }

    // Najbliższe wizyty
    var list = $('upcoming-list');
    list.innerHTML = '';
    if (!d.upcoming.length) {
      list.innerHTML = '<li class="upcoming__empty">Brak nadchodzących rezerwacji online.</li>';
    } else {
      d.upcoming.forEach(function (b) {
        var day2 = parseISO(b.slot_date);
        var li = document.createElement('li');
        li.className = 'upcoming__item';
        var p1 = digitsOnly(b.phone), p2 = digitsOnly(b.phone2);
        li.innerHTML = (b.patient_confirmed ? '✅ ' : '') +
          '<strong>' + DAY_SHORT[day2.getDay()] + ' ' + String(day2.getDate()).padStart(2, '0') + '.' + String(day2.getMonth() + 1).padStart(2, '0') +
          ', ' + hhmm(b.slot_min) + '</strong> — ' + escapeHTML(b.name) +
          ' · <a href="tel:+48' + p1 + '">📞 ' + prettyPhone(p1) + '</a>' +
          (p2 ? ' · <a href="tel:+48' + p2 + '">📞 ' + prettyPhone(p2) + '</a>' : '');
        li.addEventListener('click', function (e) { if (e.target.tagName !== 'A') openModal(b); });
        list.appendChild(li);
      });
    }

    renderHoursEditor(d.schedule);
  }

  function escapeHTML(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function doBlock(date, min, action) {
    api('/api/admin/block', { method: 'POST', body: JSON.stringify({ date: date, min: min, action: action }) })
      .then(function (res) {
        if (!res.ok) alert(res.body.error || 'Błąd');
        load();
      });
  }

  // ---------- Wolny slot: wybór akcji (wpisz pacjenta telefonicznego / blokada) ----------
  var slotModal = $('slot-modal');
  var pendingSlot = null;

  function openSlotModal(date, min) {
    pendingSlot = { date: date, min: min };
    var day = parseISO(date);
    $('slot-modal-title').textContent = DAY_NAMES[day.getDay()] + ', ' + day.getDate() + ' ' + MONTHS[day.getMonth()] + ', godz. ' + hhmm(min);
    $('slot-choice').style.display = 'block';
    $('slot-form').style.display = 'none';
    $('sf-error').textContent = '';
    $('sf-name').value = '';
    $('sf-phone').value = '';
    slotModal.style.display = 'flex';
  }
  function closeSlotModal() { slotModal.style.display = 'none'; pendingSlot = null; }

  $('slot-close').addEventListener('click', closeSlotModal);
  slotModal.addEventListener('click', function (e) { if (e.target === slotModal) closeSlotModal(); });

  $('slot-block').addEventListener('click', function () {
    if (!pendingSlot) return;
    var s = pendingSlot;
    closeSlotModal();
    doBlock(s.date, s.min, 'block');
  });

  $('slot-add-patient').addEventListener('click', function () {
    $('slot-choice').style.display = 'none';
    $('slot-form').style.display = 'block';
    $('sf-name').focus();
  });

  // Filtry wpisywania jak w formularzu pacjenta
  $('sf-name').addEventListener('input', function () {
    this.value = this.value.replace(/[^a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s]/g, '');
  });
  $('sf-phone').addEventListener('input', function () {
    var digits = this.value.replace(/\D/g, '');
    if (digits.length > 9 && digits.indexOf('48') === 0) digits = digits.slice(2);
    this.value = digits.slice(0, 9);
  });

  $('sf-save').addEventListener('click', function () {
    if (!pendingSlot) return;
    var name = $('sf-name').value.trim();
    if (name.length < 2) { $('sf-error').textContent = 'Podaj imię i nazwisko pacjenta.'; return; }
    var btn = $('sf-save');
    btn.disabled = true;
    api('/api/admin/book', {
      method: 'POST',
      body: JSON.stringify({
        date: pendingSlot.date,
        min: pendingSlot.min,
        name: name,
        phone: $('sf-phone').value,
      }),
    }).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { $('sf-error').textContent = res.body.error || 'Błąd zapisu'; return; }
      closeSlotModal();
      load();
    });
  });

  function doDayAction(date, action) {
    api('/api/admin/block', { method: 'POST', body: JSON.stringify({ date: date, action: action }) })
      .then(function () { load(); });
  }

  // ---------- Wizyta o niestandardowej godzinie (jednorazowy wyjątek, poza grafikiem) ----------
  var customModal = $('custom-modal');

  function openCustomModal() {
    $('cf-date').value = '';
    $('cf-time').value = '';
    $('cf-name').value = '';
    $('cf-phone').value = '';
    $('cf-error').textContent = '';
    customModal.style.display = 'flex';
  }
  function closeCustomModal() { customModal.style.display = 'none'; }

  $('custom-open').addEventListener('click', openCustomModal);
  $('cf-cancel').addEventListener('click', closeCustomModal);
  customModal.addEventListener('click', function (e) { if (e.target === customModal) closeCustomModal(); });

  $('cf-name').addEventListener('input', function () {
    this.value = this.value.replace(/[^a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s]/g, '');
  });
  $('cf-phone').addEventListener('input', function () {
    var digits = this.value.replace(/\D/g, '');
    if (digits.length > 9 && digits.indexOf('48') === 0) digits = digits.slice(2);
    this.value = digits.slice(0, 9);
  });

  $('cf-save').addEventListener('click', function () {
    var date = $('cf-date').value;
    var time = $('cf-time').value;
    var name = $('cf-name').value.trim();
    if (!date) { $('cf-error').textContent = 'Wybierz datę.'; return; }
    if (!time) { $('cf-error').textContent = 'Wybierz godzinę.'; return; }
    if (name.length < 2) { $('cf-error').textContent = 'Podaj imię i nazwisko pacjenta.'; return; }
    var parts = time.split(':');
    var min = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    var btn = $('cf-save');
    btn.disabled = true;
    api('/api/admin/book', {
      method: 'POST',
      body: JSON.stringify({ date: date, min: min, name: name, phone: $('cf-phone').value, custom: true }),
    }).then(function (res) {
      btn.disabled = false;
      if (!res.ok) { $('cf-error').textContent = res.body.error || 'Błąd zapisu'; return; }
      closeCustomModal();
      load();
    });
  });

  // Treść SMS z prośbą o potwierdzenie (data/godzina z rezerwacji, reszta stała).
  function smsBody(b) {
    var day = parseISO(b.slot_date);
    var dataStr = DAY_SHORT[day.getDay()] + ' ' + String(day.getDate()).padStart(2, '0') + '.' + String(day.getMonth() + 1).padStart(2, '0');
    return 'Proszę o potwierdzenie lub odwołanie wizyty (' + dataStr + ', godz. ' + hhmm(b.slot_min) +
      ') w Gabinet Psychoterapii DARD, Al. Wojska Polskiego 49b, pok. 124, Piła. Odpowiedz SMS-em TAK lub NIE. J. Grochowska';
  }

  // ---------- Modal szczegółów ----------
  var modal = $('booking-modal');
  function openModal(b) {
    var day = parseISO(b.slot_date);
    $('modal-title').textContent = DAY_NAMES[day.getDay()] + ', ' + day.getDate() + ' ' + MONTHS[day.getMonth()] + ', godz. ' + hhmm(b.slot_min);
    $('modal-name').textContent = b.name;
    var p1 = digitsOnly(b.phone), p2 = digitsOnly(b.phone2);
    var tel = $('modal-phone');
    tel.textContent = '📞 ' + prettyPhone(p1);
    tel.href = 'tel:+48' + p1;
    var tel2wrap = $('modal-phone2-wrap');
    var tel2 = $('modal-phone2');
    if (p2) {
      tel2.textContent = '📞 ' + prettyPhone(p2) + ' (dodatkowy)';
      tel2.href = 'tel:+48' + p2;
      tel2wrap.style.display = '';
    } else {
      tel2wrap.style.display = 'none';
    }

    // Status potwierdzenia przez pacjenta
    $('modal-confirm-status').textContent = b.patient_confirmed
      ? '✅ Potwierdzona przez pacjenta'
      : '⏳ Oczekuje na potwierdzenie';
    $('modal-confirm-status').style.color = b.patient_confirmed ? '#1e7a3d' : 'var(--color-text-light)';

    // Przycisk „Wyślij SMS" — otwiera apkę SMS z gotową treścią (tylko gdy jest numer)
    var smsBtn = $('modal-sms');
    if (p1) {
      smsBtn.href = 'sms:+48' + p1 + '?body=' + encodeURIComponent(smsBody(b));
      smsBtn.style.display = '';
    } else {
      smsBtn.style.display = 'none';
    }

    // Przycisk „Oznacz jako potwierdzoną" / „Cofnij potwierdzenie" (przełącznik)
    var confBtn = $('modal-confirm');
    confBtn.textContent = b.patient_confirmed ? '↺ Cofnij potwierdzenie' : '✅ Oznacz jako potwierdzoną';
    confBtn.onclick = function () {
      confBtn.disabled = true;
      api('/api/admin/confirm', { method: 'POST', body: JSON.stringify({ id: b.id, confirmed: !b.patient_confirmed }) })
        .then(function (res) {
          confBtn.disabled = false;
          if (!res.ok) { alert(res.body.error || 'Błąd'); return; }
          closeModal();
          load();
        });
    };

    $('modal-cancel').onclick = function () {
      if (confirm('Odwołać tę wizytę?\n\nPAMIĘTAJ: zadzwoń do pacjenta ' + prettyPhone(b.phone) + ' i poinformuj o odwołaniu.')) {
        api('/api/admin/cancel', { method: 'POST', body: JSON.stringify({ id: b.id }) })
          .then(function (res) {
            closeModal();
            if (!res.ok) alert(res.body.error || 'Błąd');
            load();
          });
      }
    };
    modal.style.display = 'flex';
  }
  function closeModal() { modal.style.display = 'none'; }
  $('modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

  // ---------- Nawigacja tygodni ----------
  $('week-prev').addEventListener('click', function () { state.monday.setDate(state.monday.getDate() - 7); load(); });
  $('week-next').addEventListener('click', function () { state.monday.setDate(state.monday.getDate() + 7); load(); });

  // ---------- Grafik przyjęć ----------
  // Każdy dzień to lista godzin ROZPOCZĘCIA wizyt (sesja trwa 50 min),
  // wpisywana po przecinku, np. "11:40, 12:50, 13:40".
  function renderHoursEditor(schedule) {
    var order = [1, 2, 3, 4, 5, 6, 0];
    var box = $('hours-editor');
    box.innerHTML = '';
    order.forEach(function (dow) {
      var v = schedule[dow];
      var closed = !v || !v.length;
      var row = document.createElement('div');
      row.className = 'hours-row';
      row.innerHTML = '<span class="hours-row__day">' + DAY_NAMES[dow] + '</span>' +
        '<label class="hours-row__closed"><input type="checkbox" data-dow="' + dow + '" data-kind="closed"' + (closed ? ' checked' : '') + '> nieczynne</label>' +
        '<input type="text" class="hours-row__times" data-dow="' + dow + '" data-kind="times"' +
        ' placeholder="np. 11:40, 12:50, 13:40" value="' + (closed ? '' : v.map(hhmm).join(', ')) + '"' +
        (closed ? ' disabled' : '') + '>';
      box.appendChild(row);
    });

    box.querySelectorAll('input[data-kind="closed"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var input = box.querySelector('input[data-dow="' + cb.dataset.dow + '"][data-kind="times"]');
        input.disabled = cb.checked;
      });
    });
  }

  $('hours-save').addEventListener('click', function () {
    var box = $('hours-editor');
    var schedule = {};
    for (var dow = 0; dow <= 6; dow++) {
      var closed = box.querySelector('input[data-dow="' + dow + '"][data-kind="closed"]').checked;
      var raw = closed ? '' : box.querySelector('input[data-dow="' + dow + '"][data-kind="times"]').value;
      var parts = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!parts.length) { schedule[dow] = null; continue; }
      var mins = [];
      for (var i = 0; i < parts.length; i++) {
        var m = parts[i].match(/^(\d{1,2})[:.](\d{2})$/);
        if (!m || +m[2] > 59) {
          alert(DAY_NAMES[dow] + ': nie rozumiem godziny „' + parts[i] + '" — użyj formatu 11:40, oddzielaj przecinkami.');
          return;
        }
        mins.push(+m[1] * 60 + +m[2]);
      }
      mins.sort(function (a, b) { return a - b; });
      schedule[dow] = mins;
    }
    api('/api/admin/hours', { method: 'POST', body: JSON.stringify({ schedule: schedule }) })
      .then(function (res) {
        if (!res.ok) { alert(res.body.error || 'Błąd zapisu'); return; }
        $('hours-status').textContent = '✅ Zapisano';
        setTimeout(function () { $('hours-status').textContent = ''; }, 3000);
        load();
      });
  });

  // ---------- Powiadomienia push ----------
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function initPushUI() {
    var statusEl = $('push-status');
    var btn = $('push-enable');
    var hint = $('push-ios-hint');

    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      if (isIOS && !standalone) {
        hint.style.display = 'block';
        statusEl.textContent = '';
        btn.style.display = 'none';
      } else {
        statusEl.textContent = 'Ta przeglądarka nie obsługuje powiadomień push.';
        btn.style.display = 'none';
      }
      return;
    }

    if (isIOS && !standalone) hint.style.display = 'block';

    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      if (sub) {
        statusEl.textContent = '✅ Powiadomienia są włączone na tym urządzeniu.';
        btn.style.display = 'none';
      }
    }).catch(function () { /* ignore */ });

    btn.addEventListener('click', function () {
      statusEl.textContent = 'Konfiguruję…';
      navigator.serviceWorker.register('/sw.js')
        .then(function (reg) {
          return Notification.requestPermission().then(function (perm) {
            if (perm !== 'granted') throw new Error('Nie wyrażono zgody na powiadomienia.');
            return reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(state.data.vapidPublicKey),
            });
          });
        })
        .then(function (sub) {
          var label = prompt('Nazwa tego urządzenia (np. „iPhone mamy”):', 'Telefon') || 'Telefon';
          return api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), label: label }) });
        })
        .then(function (res) {
          if (!res.ok) throw new Error(res.body.error || 'Błąd zapisu subskrypcji');
          statusEl.textContent = '✅ Powiadomienia włączone! Przy każdej nowej rezerwacji przyjdzie powiadomienie.';
          btn.style.display = 'none';
        })
        .catch(function (err) {
          statusEl.textContent = '❌ ' + err.message;
        });
    });
  }

  // ---------- Start: próba wejścia (sesja może już istnieć) ----------
  api('/api/admin/data?start=' + fmtISO(state.monday)).then(function (res) {
    if (res.ok) { state.data = res.body; showApp(); render(); }
    else { loginView.style.display = 'block'; }
  });
})();
