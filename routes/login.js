/*!
 * login-page-10 - Colorlib. No jQuery, no framework.
 * Behaviours: own-script
 */
/* The page's own script, unchanged: it never needed jQuery. */
(() => {
  'use strict';

  const root = document.querySelector('.cl-login10');
  if (!root) return;
  const tablist = root.querySelector('[data-tablist]');
  const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  const live = root.querySelector('[data-live]');
  const done = root.querySelector('[data-success]');
  if (tabs.length !== 2 || panels.some((p) => !p) || !done) return;

  
  const select = (i, focus) => {
    const from = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    tabs.forEach((t, k) => {
      const on = k === i;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
      panels[k].classList.remove('is-from-right', 'is-from-left');
    });
    if (from !== i && from !== -1) panels[i].classList.add(i > from ? 'is-from-right' : 'is-from-left');
    tablist.classList.toggle('is-second', i === 1);
    done.hidden = true;
    if (focus) tabs[i].focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i, false));
    tab.addEventListener('keydown', (e) => {
      const map = { ArrowRight: (i + 1) % 2, ArrowLeft: (i + 1) % 2, Home: 0, End: 1 };
      if (!(e.key in map)) return;
      e.preventDefault();
      select(map[e.key], true);
    });
  });
  root.querySelectorAll('[data-go]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = btn.dataset.go === 'signup' ? 1 : 0;
      select(i, false);
      panels[i].querySelector('input').focus();
    });
  });

  
  const messageFor = (el) => {
    if (el.type === 'checkbox') return el.checked ? '' : el.dataset.msg;
    const val = el.value.trim();
    if (el.required && !val) return el.dataset.msg || 'This field is required.';
    if (el.validity.typeMismatch) return 'Enter an email like name@example.com.';
    if (el.minLength > 0 && el.value.length < el.minLength) return el.name === 'name' ? 'That looks a little short.' : `Use at least ${el.minLength} characters.`;
    if (el.validity.patternMismatch) return el.dataset.pattern || 'Check the format.';
    return '';
  };
  const check = (field) => {
    const el = field.querySelector('input');
    const msg = messageFor(el);
    field.querySelector('[data-error]').textContent = msg;
    field.classList.toggle('is-error', !!msg);
    if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
    return !msg;
  };
  const forms = Array.from(root.querySelectorAll('[data-form]'));
  forms.forEach((form) => {
    const fields = Array.from(form.querySelectorAll('[data-field]'));
    fields.forEach((field) => {
      field.addEventListener('focusout', (e) => {
        const el = field.querySelector('input');
        if (field.contains(e.relatedTarget) || (e.relatedTarget && e.relatedTarget.matches('button')) || el.type === 'checkbox' || !el.value) return;
        field.dataset.touched = '1';
        check(field);
      });
      field.addEventListener('input', () => { if (field.dataset.touched) check(field); });
      field.addEventListener('change', () => { if (field.dataset.touched) check(field); });
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      fields.forEach((f) => { f.dataset.touched = '1'; });
      const bad = fields.filter((f) => !check(f));
      if (bad.length) {
        live.textContent = bad.length === 1 ? 'One field needs attention.' : `${bad.length} fields need attention.`;
        bad[0].querySelector('input').focus();
        return;
      }
      const signup = form.dataset.form === 'signup';
      const name = signup ? form.elements.name.value.trim().split(/\s+/)[0] : '';
      root.querySelector('[data-done-title]').textContent = signup ? `Welcome to Loop, ${name}` : 'Welcome back';
      root.querySelector('[data-done-text]').textContent = signup
        ? `We sent a confirmation to ${form.elements.email.value.trim()}. Pick your first habit next.`
        : 'You are on a 5-day streak. Keep it going today.';
      live.textContent = '';
      panels.forEach((p) => { p.hidden = true; });
      done.hidden = false;
      done.focus();
    });
  });

  root.querySelectorAll('[data-pw-toggle]').forEach((btn) => {
    const input = document.getElementById(btn.getAttribute('aria-controls'));
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
    });
  });

  root.querySelector('[data-reset]').addEventListener('click', () => {
    forms.forEach((f) => f.reset());
    root.querySelectorAll('[data-field]').forEach((f) => {
      delete f.dataset.touched;
      f.classList.remove('is-error');
      f.querySelector('[data-error]').textContent = '';
      f.querySelector('input').removeAttribute('aria-invalid');
    });
    select(0, true);
  });
})();