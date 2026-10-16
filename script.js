/* CET-ESERVE frontend. No secrets live here: only the public Web App URL. */
(function () {
  'use strict';

  // ====== CONFIGURATION ======
  // Paste your deployed Apps Script Web App URL (ends in /exec).
  var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbziQyXE2cZ0jzyfmlt18Ez7h35n4_f7rjGhiOgapSMtpv22Xf9TccadwwKbl9-gs_WA/exec';
  var TIMEOUT_MS = 25000;
  // ===========================

  var LIMITS = { subject: 120, message: 2000, fullName: 100, program: 100, typeOther: 60, categoryOther: 60, programOther: 100, email: 120, phone: 20 };
  var MIN_MESSAGE = 5;

  var $ = function (id) { return document.getElementById(id); };
  var form = $('eserveForm');
  var submitBtn = $('submitBtn');
  var alertBox = $('formAlert');
  var contactBlock = $('contactBlock');
  var formLoadedAt = Date.now();
  var inFlight = false;
  var attemptId = newAttemptId(); // same id on retries lets the backend ignore duplicates

  function newAttemptId() {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function clean(v) { return String(v || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim(); }
  function val(id) { return clean($(id).value); }
  function identity() { return form.elements.identity.value; }

  // Identity toggle
  function syncIdentity() {
    var identified = identity() === 'identified';
    contactBlock.hidden = !identified;
    if (!identified) {
      ['fullName', 'program', 'yearLevel', 'email', 'phone'].forEach(function (id) {
        $(id).value = '';
        setError(id, '');
      });
      syncOther();
    }
  }
  Array.prototype.forEach.call(form.elements.identity, function (r) { r.addEventListener('change', syncIdentity); });

  // "Other" lets the student type their own type/category (optional)
  function syncOther() {
    [['type', 'typeOther'], ['category', 'categoryOther'], ['program', 'programOther']].forEach(function (p) {
      var isOther = $(p[0]).value === 'Other';
      $(p[1] + 'Wrap').hidden = !isOther;
      if (!isOther) { $(p[1]).value = ''; setError(p[1], ''); }
    });
  }
  $('type').addEventListener('change', syncOther);
  $('category').addEventListener('change', syncOther);

  // Character counter
  $('message').addEventListener('input', function () {
    $('message-count').textContent = this.value.length + ' / ' + LIMITS.message;
  });

  function setError(id, msg) {
    var span = $(id + '-err');
    var field = $(id).closest('.field');
    if (span) span.textContent = msg || '';
    if (field) field.classList.toggle('invalid', !!msg);
    $(id).setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function validate() {
    var errors = {};
    if (!val('type')) errors.type = 'Choose a submission type.';
    if (!val('category')) errors.category = 'Choose a category.';
    var s = val('subject');
    if (!s) errors.subject = 'Enter a subject.';
    else if (s.length > LIMITS.subject) errors.subject = 'Keep the subject within ' + LIMITS.subject + ' characters.';
    var m = val('message');
    if (!m) errors.message = 'Describe your request, suggestion, or concern.';
    else if (m.length < MIN_MESSAGE) errors.message = 'Please write at least ' + MIN_MESSAGE + ' characters.';
    else if (m.length > LIMITS.message) errors.message = 'Keep the message within ' + LIMITS.message + ' characters.';
    if (val('type') === 'Other' && val('typeOther').length > LIMITS.typeOther) errors.typeOther = 'Keep this within ' + LIMITS.typeOther + ' characters.';
    if (val('category') === 'Other' && val('categoryOther').length > LIMITS.categoryOther) errors.categoryOther = 'Keep this within ' + LIMITS.categoryOther + ' characters.';
    if (identity() === 'identified' && val('program') === 'Other' && val('programOther').length > LIMITS.programOther) errors.programOther = 'Keep this within ' + LIMITS.programOther + ' characters.';
    if (!$('privacy').checked) errors.privacy = 'Confirm that you understand how your submission is used.';

    if (identity() === 'identified') {
      var em = val('email');
      if (em && (em.length > LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em))) errors.email = 'Enter a valid email address, or leave it blank.';
      var ph = val('phone');
      if (ph && !/^[0-9+()\-\s]{7,20}$/.test(ph)) errors.phone = 'Use digits, spaces, + or - (7 to 20 characters), or leave it blank.';
      if (val('fullName').length > LIMITS.fullName) errors.fullName = 'Keep the name within ' + LIMITS.fullName + ' characters.';
      if (val('program').length > LIMITS.program) errors.program = 'Keep this within ' + LIMITS.program + ' characters.';
    }
    return errors;
  }

  var FIELD_IDS = ['type', 'typeOther', 'category', 'categoryOther', 'subject', 'message', 'privacy', 'fullName', 'program', 'programOther', 'email', 'phone'];

  function showAlert(msg) {
    alertBox.textContent = msg;
    alertBox.hidden = !msg;
    if (msg) alertBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function setLoading(on) {
    inFlight = on;
    submitBtn.disabled = on;
    submitBtn.classList.toggle('loading', on);
    submitBtn.setAttribute('aria-busy', on ? 'true' : 'false');
    submitBtn.querySelector('.btn-label').textContent = on ? 'Sending...' : 'Send submission';
  }

  function buildPayload() {
    var anon = identity() !== 'identified';
    var p = {
      attemptId: attemptId,
      type: val('type'),
      subject: val('subject'),
      category: val('category'),
      message: val('message'),
      typeOther: val('type') === 'Other' ? val('typeOther') : '',
      categoryOther: val('category') === 'Other' ? val('categoryOther') : '',
      anonymous: anon,
      urgency: form.elements.urgency.value,
      privacyAck: $('privacy').checked,
      website: $('website').value,            // honeypot
      elapsedMs: Date.now() - formLoadedAt    // basic bot signal
    };
    if (!anon) {
      p.fullName = val('fullName'); p.program = val('program'); p.programOther = val('program') === 'Other' ? val('programOther') : ''; p.yearLevel = val('yearLevel');
      p.email = val('email'); p.phone = val('phone');
    }
    return p;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (inFlight) return; // blocks double clicks / Enter key repeats
    showAlert('');

    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_') === 0) {
      showAlert('This site is not connected to its backend yet. Please tell the CET Student Council.');
      return;
    }

    var errors = validate();
    FIELD_IDS.forEach(function (id) { setError(id, errors[id] || ''); });
    var first = FIELD_IDS.filter(function (id) { return errors[id]; })[0];
    if (first) { $(first).focus(); return; }

    setLoading(true);
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);

    // text/plain keeps this a "simple" CORS request: no preflight, which Apps Script cannot answer.
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(buildPayload()),
      redirect: 'follow',
      signal: ctrl.signal
    })
      .then(function (res) {
        if (!res.ok) throw new Error('http');
        return res.json();
      })
      .then(function (data) {
        if (data && data.ok === true && data.ref) { showSuccess(data); return; }
        if (data && data.fieldErrors) {
          Object.keys(data.fieldErrors).forEach(function (k) { if ($(k)) setError(k, data.fieldErrors[k]); });
        }
        showAlert((data && data.message) || 'Your submission could not be saved. Please try again.');
      })
      .catch(function (err) {
        showAlert(err && err.name === 'AbortError'
          ? 'The request took too long, so we cannot confirm it was saved. Your entries are kept. Press Send submission to try again.'
          : 'We could not reach the server, so your submission was not confirmed. Your entries are kept. Check your connection and press Send submission to try again.');
      })
      .then(function () { clearTimeout(timer); setLoading(false); });
  });

  function showSuccess(data) {
    $('refNo').textContent = data.ref;
    $('refTime').textContent = data.timestamp || new Date().toLocaleString('en-PH');
    $('formCard').hidden = true;
    var card = $('successCard');
    card.hidden = false;
    card.focus();
    window.scrollTo(0, 0);
  }

  $('againBtn').addEventListener('click', function () {
    form.reset();
    syncIdentity();
    syncOther();
    syncTips();
    updateProgress();
    $('message-count').textContent = '0 / ' + LIMITS.message;
    FIELD_IDS.forEach(function (id) { setError(id, ''); });
    showAlert('');
    attemptId = newAttemptId();
    formLoadedAt = Date.now();
    $('successCard').hidden = true;
    $('formCard').hidden = false;
    $('type').focus();
  });


  // ===== Friendlier form behavior =====
  var TIPS = {
    'Service Request': { subject: 'e.g. Request for laboratory equipment access', tip: 'State the service you need, where it is needed, and by when.' },
    'Suggestion': { subject: 'e.g. Extend library hours during exams', tip: 'Describe your idea and how it would help students.' },
    'Feedback': { subject: 'e.g. Feedback on the enrollment process', tip: 'Share what worked well and what could be improved.' },
    'Concern or Complaint': { subject: 'e.g. Faulty ventilation in a classroom', tip: 'Include what happened, where, when, and who is affected. Please do not include passwords or sensitive details.' }
  };
  var DEFAULT_TIP = { subject: 'A short title for your submission', tip: 'Be specific: what happened or what you need, where, and when. Please do not include passwords or unrelated personal data.' };
  function syncTips() {
    var t = TIPS[$('type').value] || DEFAULT_TIP;
    $('subject').placeholder = t.subject;
    $('messageTip').textContent = t.tip;
  }
  $('type').addEventListener('change', syncTips);

  // Progress of required items
  function updateProgress() {
    var done = [
      !!val('type'), !!val('category'), !!val('subject'),
      val('message').length >= MIN_MESSAGE, $('privacy').checked
    ].filter(Boolean).length;
    $('progressText').textContent = done === 5 ? 'All required items completed. You can send your submission.' : done + ' of 5 required items completed';
    $('progressFill').style.width = (done * 20) + '%';
    $('progressBar').setAttribute('aria-valuenow', done);
    $('progressBar').classList.toggle('complete', done === 5);
    $('message-count').classList.toggle('warn', $('message').value.length > 1800);
  }
  form.addEventListener('input', updateProgress);
  form.addEventListener('change', updateProgress);

  // Check a field when the student leaves it; clear its message as soon as it is fixed
  form.addEventListener('focusout', function (e) {
    var id = e.target.id;
    if (FIELD_IDS.indexOf(id) < 0 || id === 'privacy') return;
    setError(id, validate()[id] || '');
  });
  form.addEventListener('input', function (e) {
    var id = e.target.id;
    if (FIELD_IDS.indexOf(id) >= 0 && $(id + '-err') && $(id + '-err').textContent) setError(id, validate()[id] || '');
  });
  form.addEventListener('change', function (e) {
    if (e.target.id === 'privacy' && $('privacy').checked) setError('privacy', '');
    if (e.target.id === 'type' || e.target.id === 'category') setError(e.target.id, validate()[e.target.id] || '');
  });

  // Ctrl/Cmd + Enter sends from the message box
  $('message').addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }
  });
  // Move to the name field when the student chooses to identify themselves
  Array.prototype.forEach.call(form.elements.identity, function (r) {
    r.addEventListener('change', function () { if (r.value === 'identified' && r.checked) $('fullName').focus(); });
  });

  // Copy reference number (works on phones; falls back to a hint if blocked)
  $('copyRef').addEventListener('click', function () {
    var btn = this, ref = $('refNo').textContent;
    function done(msg) { btn.textContent = msg; setTimeout(function () { btn.textContent = 'Copy reference number'; }, 2000); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ref).then(function () { done('Copied'); }, function () { done('Press and hold the number to copy'); });
    } else { done('Press and hold the number to copy'); }
  });

  // ===== Page views (landing <-> form) in one HTML file, driven by the URL hash =====
  var viewHome = $('view-home'), viewForm = $('view-form');
  function route() {
    var onForm = location.hash === '#form';
    viewHome.hidden = onForm;
    viewForm.hidden = !onForm;
    document.body.setAttribute('data-view', onForm ? 'form' : 'home');
    window.scrollTo(0, 0);
    if (onForm) { var t = $('formCard').hidden ? $('successCard') : $('form-title'); t.focus({ preventScroll: true }); }
    else { $('main').focus({ preventScroll: true }); }
  }
  window.addEventListener('hashchange', route);
  route();

  syncIdentity();
  syncOther();
  syncTips();
  updateProgress();
})();