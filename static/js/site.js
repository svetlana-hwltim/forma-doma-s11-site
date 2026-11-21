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
let challengeLoadAttempt = 0;
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

function applicationDiagnostic(stage) {
  return { stage, phase: 'setup', kind: 'client_error', httpStatus: null, workerCode: null };
}

const applicationFailureKinds = new Map([
  ['invalid_request', 'validation'],
  ['invalid_model', 'validation'],
  ['invalid_csrf', 'csrf_rejected'],
  ['challenge_failed', 'turnstile_rejected'],
  ['challenge_unavailable', 'turnstile_unavailable'],
  ['origin_denied', 'origin_rejected'],
  ['submission_conflict', 'submission_conflict'],
  ['rate_limited', 'rate_limited'],
  ['telegram_rejected', 'telegram_rejected'],
  ['pending', 'delivery_unconfirmed'],
  ['uncertain', 'delivery_unconfirmed'],
]);

const applicationStageLabels = {
  validation: 'Проверка полей',
  csrf: 'Открытие формы',
  turnstile: 'Проверка Turnstile',
  application: 'Отправка заявки',
};

const applicationFailureLabels = {
  client_error: 'ошибка в браузере',
  validation: 'проверьте данные',
  network_or_cors: 'сбой соединения или доступа к серверу',
  timeout: 'время ожидания истекло',
  aborted: 'запрос отменён',
  invalid_json: 'ответ сервера не удалось разобрать',
  response_read_error: 'ответ сервера получен не полностью',
  http_error: 'ошибка сервера',
  unexpected_response: 'неожиданный ответ сервера',
  csrf_rejected: 'подтверждение формы отклонено',
  widget_load_failed: 'виджет не загрузился',
  widget_load_timeout: 'виджет не загрузился вовремя',
  widget_error: 'ошибка виджета',
  widget_expired: 'срок проверки истёк',
  widget_timeout: 'время на проверку истекло',
  turnstile_rejected: 'проверка отклонена',
  turnstile_unavailable: 'проверка временно недоступна',
  origin_rejected: 'источник запроса отклонён',
  submission_conflict: 'данные заявки изменились',
  rate_limited: 'слишком много попыток',
  telegram_rejected: 'доставка отклонена',
  delivery_unconfirmed: 'доставка не подтверждена',
};

function recordApplicationError(diagnostic) {
  const { stage, phase, kind, httpStatus, workerCode } = diagnostic;
  const time = new Date().toISOString();
  console.warn('forma_doma_application', {
    stage, phase, kind, httpStatus, workerCode, time, clientVersion: 'mobile-diagnostic-2',
  });
  const http = httpStatus === null ? '' : ` (HTTP ${httpStatus})`;
  return `${applicationStageLabels[stage]} — ${applicationFailureLabels[kind]}${http} · ${time.slice(11, 19)} UTC.`;
}

async function fetchJson(url, options, timeout, diagnostic) {
  const controller = typeof AbortSignal.timeout === 'function' ? null : new AbortController();
  const signal = controller ? controller.signal : AbortSignal.timeout(timeout);
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : undefined;
  try {
    if (diagnostic) diagnostic.phase = 'fetch';
    const response = await fetch(url, { ...options, signal });
    if (diagnostic) {
      diagnostic.phase = 'json';
      diagnostic.httpStatus = response.status;
    }
    return { response, body: await response.json() };
  } catch (error) {
    if (diagnostic) {
      if (signal.aborted || error?.name === 'TimeoutError') diagnostic.kind = 'timeout';
      else if (error?.name === 'AbortError') diagnostic.kind = 'aborted';
      else if (diagnostic.phase === 'json') {
        diagnostic.kind = error?.name === 'SyntaxError' ? 'invalid_json' : 'response_read_error';
      } else diagnostic.kind = 'network_or_cors';
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function getFormProof(diagnostic) {
  const { response, body } = await fetchJson(apiUrl, {
    credentials: 'omit', cache: 'no-store',
  }, 10000, diagnostic);
  if (!response.ok || typeof body?.csrf !== 'string') {
    if (diagnostic) {
      diagnostic.phase = 'response';
      diagnostic.kind = response.ok ? 'unexpected_response' : 'http_error';
    }
    throw new Error('Не удалось открыть форму. Попробуйте позже.');
  }
  return body.csrf;
}

function loadChallenge(diagnostic) {
  if (challengeScript) return challengeScript;
  const isAvailable = api => typeof api?.render === 'function' &&
    typeof api.execute === 'function' && typeof api.remove === 'function';
  if (isAvailable(window.turnstile)) return Promise.resolve(window.turnstile);

  challengeScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const callbackName = `formaDomaTurnstileLoaded${++challengeLoadAttempt}`;
    const finish = () => {
      clearTimeout(timer);
      delete window[callbackName];
      script.onerror = null;
    };
    const fail = (message, kind = 'widget_load_failed') => {
      if (diagnostic) diagnostic.kind = kind;
      finish();
      script.remove();
      reject(new Error(message));
    };
    const unavailable = 'Не удалось загрузить Cloudflare Turnstile. Проверьте соединение и попробуйте снова.';
    const timer = setTimeout(() => fail(unavailable, 'widget_load_timeout'), 15000);
    window[callbackName] = () => {
      const api = window.turnstile;
      if (!isAvailable(api)) return fail(unavailable);
      finish();
      resolve(api);
    };
    script.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${callbackName}`;
    script.onerror = () => fail(unavailable);
    try {
      document.head.append(script);
    } catch {
      fail(unavailable);
    }
  }).catch(error => {
    challengeScript = undefined;
    throw error;
  });
  return challengeScript;
}

async function getChallengeToken(diagnostic) {
  if (diagnostic) diagnostic.phase = 'load';
  const turnstile = await loadChallenge(diagnostic);
  if (diagnostic) diagnostic.phase = 'widget';
  const container = document.createElement('div');
  form.append(container);
  let widget, timer;
  try {
    return await new Promise((resolve, reject) => {
      const fail = (kind, message = 'Не удалось пройти проверку формы. Попробуйте снова.') => {
        if (diagnostic) diagnostic.kind = kind;
        reject(new Error(message));
      };
      const challengeError = code => {
        const codeText = String(code);
        const message = {
          '110100': 'Ключ Turnstile недействителен (110100).',
          '110110': 'Ключ Turnstile не найден (110110).',
          '110200': 'Домен сайта не разрешён в настройках Turnstile (110200).',
          '200500': 'Не удалось загрузить окно проверки Turnstile (200500).',
        }[codeText];
        fail('widget_error', message);
        return true;
      };
      timer = setTimeout(() => fail('widget_timeout'), 20000);
      widget = turnstile.render(container, {
        sitekey: siteKey, action: 'application', execution: 'execute', appearance: 'interaction-only', retry: 'never',
        'response-field': false, callback: resolve, 'error-callback': challengeError,
        'expired-callback': () => fail('widget_expired'),
        'timeout-callback': () => fail('widget_timeout'),
      });
      turnstile.execute(widget);
    });
  } finally {
    clearTimeout(timer);
    if (widget !== undefined) turnstile.remove(widget);
    container.remove();
  }
}

async function post(url, data, diagnostic) {
  const { response, body } = await fetchJson(url, {
    method: 'POST',
    credentials: apiUrl ? 'omit' : 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }, apiUrl ? 30000 : 15000, diagnostic);
  if (diagnostic) {
    diagnostic.phase = 'response';
    if (!response.ok) {
      diagnostic.kind = applicationFailureKinds.get(body?.code) || 'http_error';
      if (applicationFailureKinds.has(body?.code)) diagnostic.workerCode = body.code;
    }
  }
  if (!response.ok && body?.code === 'challenge_unavailable') {
    throw new Error('Сервер временно не смог проверить Turnstile. Попробуйте позже.');
  }
  if (!response.ok) throw Object.assign(new Error(body?.error || 'Сервис временно недоступен.'), { code: body?.code });
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
    const code = recordApplicationError({ ...applicationDiagnostic('validation'), kind: 'validation' });
    status(requestStatus, `Укажите имя. ${code}`, true);
    fields.name.focus();
    return;
  }
  const digits = phone.replace(/\D/g, '');
  if (!/^\+?[0-9 ()-]{7,24}$/.test(phone) || digits.length < 10 || digits.length > 15) {
    const code = recordApplicationError({ ...applicationDiagnostic('validation'), kind: 'validation' });
    status(requestStatus, `Укажите телефон из 10–15 цифр. ${code}`, true);
    fields.phone.focus();
    return;
  }
  submission ||= submissionId();
  const data = {
    name, phone, comment: fields.comment.value,
    category: fields.category.value, consent: fields.consent.checked,
    estimate: attached, submission,
  };
  if (apiUrl && typeof staticCatalogModelEnabled !== 'undefined' && staticCatalogModelEnabled === true &&
      typeof getSelectedCatalogModel === 'function') {
    const model = getSelectedCatalogModel(data.category);
    if (model) data.model = model;
  }
  for (const control of fields) control.disabled = true;
  status(requestStatus, 'Отправляем заявку…');
  let confirmed = false;
  let diagnostic = applicationDiagnostic('csrf');
  try {
    if (apiUrl) {
      data.csrf = await getFormProof(diagnostic);
      diagnostic = applicationDiagnostic('turnstile');
      data.turnstileToken = await getChallengeToken(diagnostic);
    }
    diagnostic = applicationDiagnostic('application');
    const result = await post(apiUrl || '/api/request', data, diagnostic);
    if (result?.ok !== true) {
      diagnostic.kind = 'unexpected_response';
      throw new Error('Сервер не подтвердил доставку заявки.');
    }
    confirmed = true;
    submission = null;
    status(requestStatus, 'Заявка доставлена.');
    form.reset();
    clearAttached();
  } catch (error) {
    if (confirmed) return;
    if (error?.code === 'telegram_rejected') submission = null;
    const code = recordApplicationError(diagnostic);
    const unconfirmed = diagnostic.stage === 'application' &&
      (diagnostic.phase === 'fetch' || diagnostic.phase === 'json' || diagnostic.kind === 'unexpected_response' ||
        diagnostic.kind === 'delivery_unconfirmed' || (diagnostic.kind === 'http_error' && diagnostic.httpStatus >= 500));
    let message = 'Не удалось завершить отправку заявки.';
    if (diagnostic.stage === 'csrf') message = 'Не удалось открыть форму. Попробуйте позже.';
    if (diagnostic.stage === 'turnstile') {
      message = diagnostic.kind.startsWith('widget_') && error?.name === 'Error'
        ? error.message
        : 'Не удалось пройти проверку формы. Попробуйте снова.';
    }
    if (diagnostic.workerCode && error?.name === 'Error') message = error.message;
    if (unconfirmed && diagnostic.kind !== 'delivery_unconfirmed') {
      message = 'Сайт не получил подтверждение доставки. Проверьте получение перед повторной отправкой.';
    }
    status(requestStatus, `${message} ${code}`, true);
  } finally {
    for (const control of fields) control.disabled = false;
  }
});
