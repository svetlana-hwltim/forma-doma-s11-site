const nav = document.querySelector('#main-nav');
const menu = document.querySelector('.menu-toggle');

function toggleMenu(open) {
  menu.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('open', open);
}

menu.addEventListener('click', () => toggleMenu(!nav.classList.contains('open')));
nav.addEventListener('click', (event) => {
  if (event.target.closest('a')) toggleMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && nav.classList.contains('open')) {
    toggleMenu(false);
    menu.focus();
  }
});

const calculator = document.querySelector('#calculator-form');
const form = document.querySelector('#request-form');
const staticMode = form.hasAttribute('data-static-site');
const configuredApi = staticMode && typeof staticApiUrl === 'string' ? staticApiUrl : '';
const siteKey = typeof staticTurnstileSiteKey === 'string' ? staticTurnstileSiteKey : '';
const apiUrl = siteKey && configuredApi === 'https://forma-doma-telegram.olga-form.workers.dev/api/application'
  ? configuredApi
  : '';
let challengeScript;
const estimateBox = document.querySelector('#estimate');
const attachedBox = document.querySelector('#attached');
const calcStatus = document.querySelector('#calculator-status');
const requestStatus = document.querySelector('#request-status');
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
let estimate = null;
let attached = null;
let submission = null;
if (apiUrl) form.querySelector('button[type=submit]').disabled = false;
if (staticMode && !apiUrl) status(requestStatus, 'Отправка заявок пока не подключена.');

function submissionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function status(node, message = '', error = false) {
  node.textContent = message;
  node.dataset.error = String(error);
}

async function getFormProof() {
  const response = await fetch(apiUrl, {
    credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!response.ok || typeof body.csrf !== 'string') {
    throw new Error('Не удалось открыть форму. Попробуйте позже.');
  }
  return body.csrf;
}

function loadChallenge() {
  if (challengeScript) return challengeScript;
  const isAvailable = api => typeof api?.render === 'function' &&
    typeof api.execute === 'function' && typeof api.remove === 'function';
  if (isAvailable(window.turnstile)) return Promise.resolve(window.turnstile);

  challengeScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const finish = () => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
    };
    const fail = () => {
      finish();
      script.remove();
      reject(new Error('Проверка формы временно недоступна.'));
    };
    const timer = setTimeout(fail, 10000);
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onerror = fail;
    script.onload = () => {
      const api = window.turnstile;
      if (!isAvailable(api)) return fail();
      finish();
      resolve(api);
    };
    try {
      document.head.append(script);
    } catch {
      fail();
    }
  }).catch(error => {
    challengeScript = undefined;
    throw error;
  });
  return challengeScript;
}

async function getChallengeToken() {
  const turnstile = await loadChallenge();
  const container = document.createElement('div');
  form.append(container);
  let widget, timer;
  try {
    return await new Promise((resolve, reject) => {
      const fail = () => reject(new Error('Не удалось пройти проверку формы. Попробуйте снова.'));
      timer = setTimeout(fail, 20000);
      widget = turnstile.render(container, {
        sitekey: siteKey, action: 'application', execution: 'execute', appearance: 'interaction-only', retry: 'never',
        'response-field': false, callback: resolve, 'error-callback': fail,
        'expired-callback': fail, 'timeout-callback': fail,
      });
      turnstile.execute(widget);
    });
  } finally {
    clearTimeout(timer);
    if (widget !== undefined) turnstile.remove(widget);
    container.remove();
  }
}

async function post(url, data) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: apiUrl ? 'omit' : 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(apiUrl ? 30000 : 15000),
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || 'Сервис временно недоступен.'), { code: body.code });
  return body;
}

function clearEstimate() {
  estimate = null;
  estimateBox.hidden = true;
  status(calcStatus);
}

function clearAttached() {
  attached = null;
  attachedBox.hidden = true;
}

calculator.addEventListener('input', clearEstimate);
form.addEventListener('input', () => {
  status(requestStatus);
});
form.elements.category.addEventListener('change', clearAttached);
document.querySelector('#remove-estimate').addEventListener('click', clearAttached);
document.querySelectorAll('[data-category]').forEach((card) => {
  card.addEventListener('click', () => {
    calculator.elements.category.value = card.dataset.category;
    clearEstimate();
  });
});

calculator.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = calculator.querySelector('button[type=submit]');
  if (button.disabled) return;
  clearEstimate();
  const fields = calculator.elements;
  function readEstimate() {
    return {
      category: fields.category.value,
      width: fields.width.value.trim(),
      height: fields.height.value.trim(),
      material: fields.material.value,
      installation: fields.installation.checked,
    };
  }
  const data = readEstimate();
  if (![data.width, data.height].every((value) => {
    const decimal = value.replace(',', '.');
    return /^\d{1,3}(\.\d{1,8})?$/.test(decimal) && Number(decimal) >= 30 && Number(decimal) <= 600;
  })) {
    status(calcStatus, 'Введите размеры от 30 до 600 см, до 8 знаков после запятой.', true);
    return;
  }
  button.disabled = true;
  status(calcStatus, 'Выполняется расчёт…');
  try {
    const result = staticMode
      ? { amount: calculateStaticEstimate(data) }
      : await post('/api/calculate', data);
    if (JSON.stringify(readEstimate()) !== JSON.stringify(data)) return;
    estimate = data;
    document.querySelector('#amount').textContent = money.format(result.amount);
    estimateBox.hidden = false;
    status(calcStatus, `Предварительная стоимость · ${money.format(result.amount)}`);
  } catch (error) {
    status(calcStatus, error.name === 'Error' ? error.message : 'Не удалось выполнить расчёт. Попробуйте ещё раз.', true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#use-estimate').addEventListener('click', () => {
  if (!estimate) return;
  attached = estimate;
  status(requestStatus);
  form.elements.category.value = attached.category;
  const material = calculator.elements.material.selectedOptions[0].textContent;
  document.querySelector('#attached-details').textContent =
    `${attached.width} × ${attached.height} см · ${material} · установка ${attached.installation ? 'включена' : 'не включена'}`;
  attachedBox.hidden = false;
  form.elements.name.focus({ preventScroll: true });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type=submit]');
  if (button.disabled || (staticMode && !apiUrl)) return;
  const fields = form.elements;
  const name = fields.name.value.trim();
  const phone = fields.phone.value.trim();
  if (!name) {
    status(requestStatus, 'Укажите имя.', true);
    fields.name.focus();
    return;
  }
  const digits = phone.replace(/\D/g, '');
  if (!/^\+?[0-9 ()-]{7,24}$/.test(phone) || digits.length < 10 || digits.length > 15) {
    status(requestStatus, 'Укажите телефон из 10–15 цифр.', true);
    fields.phone.focus();
    return;
  }
  submission ||= submissionId();
  const data = {
    name, phone, comment: fields.comment.value,
    category: fields.category.value, consent: fields.consent.checked,
    estimate: attached, submission,
  };
  for (const control of fields) control.disabled = true;
  status(requestStatus, 'Отправляем заявку…');
  try {
    if (apiUrl) {
      data.csrf = await getFormProof();
      data.turnstileToken = await getChallengeToken();
    }
    const result = await post(apiUrl || '/api/request', data);
    if (result.ok !== true) throw new Error('Доставка заявки не подтверждена.');
    form.reset();
    submission = null;
    clearAttached();
    status(requestStatus, 'Заявка доставлена.');
  } catch (error) {
    if (error.code === 'telegram_rejected') submission = null;
    status(requestStatus, error.name === 'Error' ? error.message : 'Доставка заявки не подтверждена. Попробуйте позже.', true);
  } finally {
    for (const control of fields) control.disabled = false;
  }
});
