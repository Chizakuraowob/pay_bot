// 簡易 SPA — 純 vanilla JS，無 build step
const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
};

const api = {
  async req(path, opts = {}) {
    const r = await fetch(path, { credentials: 'include', headers: { 'content-type': 'application/json' }, ...opts });
    if (r.status === 401) {
      state.user = null;
      render();
      throw new Error('unauthorized');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error?.message || data.error || `HTTP ${r.status}`);
    return data;
  },
  get(p) { return this.req(p); },
  post(p, body) { return this.req(p, { method: 'POST', body: JSON.stringify(body) }); },
  patch(p, body) { return this.req(p, { method: 'PATCH', body: JSON.stringify(body) }); },
  del(p) { return this.req(p, { method: 'DELETE' }); },
};

const state = {
  user: null,
  page: 'dashboard',
  loginError: '',
};

function nav(page) {
  state.page = page;
  history.replaceState(null, '', `#${page}`);
  render();
}

function fmt(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleString('zh-TW', { hour12: false });
}

function statusBadge(s) {
  return h('span', { class: `badge ${s}` }, s);
}

// ===== Pages =====

function loginView() {
  const onSubmit = async (e) => {
    e.preventDefault();
    state.loginError = '';
    const fd = new FormData(e.target);
    try {
      const r = await api.post('/api/admin/login', {
        username: fd.get('username'),
        password: fd.get('password'),
      });
      state.user = { username: r.username };
      render();
    } catch (err) {
      state.loginError = err.message;
      render();
    }
  };
  return h('div', { class: 'login' },
    h('div', { class: 'card' },
      h('h1', {}, 'Pay Bot Admin'),
      h('form', { onsubmit: onSubmit },
        h('div', { class: 'form-row' },
          h('label', {}, '帳號'),
          h('input', { type: 'text', name: 'username', required: true, autofocus: true }),
        ),
        h('div', { class: 'form-row' },
          h('label', {}, '密碼'),
          h('input', { type: 'password', name: 'password', required: true }),
        ),
        h('button', { class: 'btn', type: 'submit', style: 'width:100%' }, '登入'),
        state.loginError && h('div', { class: 'error' }, state.loginError),
      ),
    ),
  );
}

async function dashboardPage(root) {
  root.appendChild(h('div', { class: 'muted' }, '載入中…'));
  try {
    const stats = await api.get('/api/admin/stats');
    root.innerHTML = '';
    root.appendChild(
      h('div', { class: 'stats' },
        statCard('總訂單', stats.orders.total),
        statCard('待付款', stats.orders.pending, 'yellow'),
        statCard('已付款', stats.orders.paid, 'green'),
        statCard('失敗', stats.orders.failed, 'red'),
        statCard('過期', stats.orders.expired),
        statCard('累計營收', `NT$ ${(stats.revenue || 0).toLocaleString()}`),
      ),
    );
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'error' }, e.message));
  }
}

function statCard(label, value, color) {
  return h('div', { class: 'stat' },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value', style: color ? `color:var(--${color})` : '' }, String(value)),
  );
}

async function gatewaysPage(root) {
  root.appendChild(h('div', { class: 'muted' }, '載入中…'));
  try {
    const [providers, gateways] = await Promise.all([
      api.get('/api/admin/providers'),
      api.get('/api/admin/gateways'),
    ]);
    root.innerHTML = '';
    root.appendChild(
      h('div', { class: 'flex between', style: 'margin-bottom:16px' },
        h('div', { class: 'muted' }, `已設定 ${gateways.length} 個金流`),
        h('button', { class: 'btn', onclick: () => openGatewayModal(providers, null) }, '+ 新增金流'),
      ),
    );
    const card = h('div', { class: 'card' });
    if (!gateways.length) {
      card.appendChild(h('div', { class: 'muted' }, '尚未設定任何金流。點右上「新增金流」開始。'));
    } else {
      const tbl = h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '名稱'),
          h('th', {}, 'Provider'),
          h('th', {}, '狀態'),
          h('th', {}, '環境'),
          h('th', {}, '更新時間'),
          h('th', {}, ''),
        )),
        h('tbody', {}, ...gateways.map((g) =>
          h('tr', {},
            h('td', {}, g.displayName),
            h('td', {}, h('code', {}, g.provider)),
            h('td', {}, h('span', { class: `badge ${g.enabled ? 'on' : 'off'}` }, g.enabled ? '啟用' : '停用')),
            h('td', {}, g.sandbox ? h('span', { class: 'badge sandbox' }, '測試') : h('span', { class: 'badge on' }, '正式')),
            h('td', {}, fmt(g.updatedAt)),
            h('td', {},
              h('button', { class: 'btn small secondary', onclick: () => openGatewayModal(providers, g) }, '編輯'),
              ' ',
              h('button', { class: 'btn small danger', onclick: async () => {
                if (!confirm(`確定刪除 ${g.displayName}？`)) return;
                await api.del(`/api/admin/gateways/${g.id}`);
                gatewaysPage(root);
              } }, '刪除'),
            ),
          ),
        )),
      );
      card.appendChild(tbl);
    }
    root.appendChild(card);
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'error' }, e.message));
  }
}

function openGatewayModal(providers, existing) {
  const modal = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === modal) modal.remove(); } });
  const inner = h('div', { class: 'modal' });
  modal.appendChild(inner);
  document.body.appendChild(modal);

  const provider = existing?.provider || providers[0]?.provider;
  const providerObj = providers.find((p) => p.provider === provider);
  let fields = providerObj?.credentialFields || [];

  function renderForm(currentProvider) {
    const cur = providers.find((p) => p.provider === currentProvider) || providers[0];
    fields = cur?.credentialFields || [];
    inner.innerHTML = '';
    inner.appendChild(h('h2', {}, existing ? '編輯金流' : '新增金流'));

    const form = h('form', {});
    form.appendChild(formRow('Provider', h('select', { name: 'provider', disabled: !!existing, onchange: (e) => renderForm(e.target.value) },
      ...providers.map((p) => h('option', { value: p.provider, selected: p.provider === currentProvider }, p.displayName)),
    )));
    form.appendChild(formRow('顯示名稱', h('input', { type: 'text', name: 'displayName', required: true, value: existing?.displayName || cur?.displayName || '' })));
    form.appendChild(h('div', { class: 'form-row' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'enabled', checked: existing ? !!existing.enabled : false }),
        ' 啟用',
      ),
    ));
    form.appendChild(h('div', { class: 'form-row' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', name: 'sandbox', checked: existing ? !!existing.sandbox : true }),
        ' 測試環境 (Sandbox)',
      ),
    ));
    form.appendChild(h('div', { class: 'muted', style: 'margin:16px 0 8px' }, '憑證'));
    if (existing) {
      form.appendChild(h('div', { class: 'muted', style: 'margin-bottom:8px' }, '欄位顯示為遮罩值；只有填入的欄位會被更新，留空保留原值。'));
    }
    for (const f of fields) {
      const placeholder = existing ? (existing.credentials[f.key] || '') : '';
      form.appendChild(formRow(
        `${f.label}${f.required ? ' *' : ''}`,
        h('input', {
          type: f.secret ? 'password' : 'text',
          name: `cred_${f.key}`,
          placeholder,
          required: !existing && f.required,
          autocomplete: 'off',
        }),
      ));
    }
    const errBox = h('div', { class: 'error' });
    form.appendChild(errBox);
    form.appendChild(h('div', { class: 'flex', style: 'margin-top:16px' },
      h('div', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn secondary', onclick: () => modal.remove() }, '取消'),
      h('button', { type: 'submit', class: 'btn' }, existing ? '更新' : '建立'),
    ));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const credentials = {};
      for (const f of fields) {
        const v = fd.get(`cred_${f.key}`);
        if (v) credentials[f.key] = v;
      }
      const payload = {
        provider: existing ? existing.provider : fd.get('provider'),
        displayName: fd.get('displayName'),
        enabled: fd.get('enabled') === 'on',
        sandbox: fd.get('sandbox') === 'on',
        credentials,
      };
      try {
        if (existing) {
          // PATCH 只更新有填的 credential 欄位
          await api.patch(`/api/admin/gateways/${existing.id}`, {
            displayName: payload.displayName,
            enabled: payload.enabled,
            sandbox: payload.sandbox,
            credentials: Object.keys(credentials).length ? credentials : undefined,
          });
        } else {
          await api.post('/api/admin/gateways', payload);
        }
        modal.remove();
        gatewaysPage($('#page'));
      } catch (err) {
        errBox.textContent = err.message;
      }
    };
    inner.appendChild(form);
  }
  renderForm(provider);
}

function formRow(label, input) {
  return h('div', { class: 'form-row' }, h('label', {}, label), input);
}

async function ordersPage(root) {
  root.appendChild(h('div', { class: 'muted' }, '載入中…'));
  try {
    const { rows, total } = await api.get('/api/admin/orders?take=100');
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'flex between', style: 'margin-bottom:16px' },
      h('div', { class: 'muted' }, `共 ${total} 筆`),
      h('button', { class: 'btn small secondary', onclick: () => ordersPage(root) }, '🔄 重新整理'),
    ));
    const card = h('div', { class: 'card' });
    if (!rows.length) {
      card.appendChild(h('div', { class: 'muted' }, '無訂單。'));
    } else {
      card.appendChild(h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '時間'),
          h('th', {}, '訂單號'),
          h('th', {}, '品項'),
          h('th', {}, '金額'),
          h('th', {}, 'Provider'),
          h('th', {}, '狀態'),
          h('th', {}, ''),
        )),
        h('tbody', {}, ...rows.map((o) =>
          h('tr', {},
            h('td', {}, fmt(o.createdAt)),
            h('td', {}, h('code', {}, o.tradeNo)),
            h('td', {}, o.itemName),
            h('td', {}, `NT$ ${o.amount.toLocaleString()}`),
            h('td', {}, o.provider),
            h('td', {}, statusBadge(o.status)),
            h('td', {}, h('button', { class: 'btn small secondary', onclick: () => openOrderModal(o.id) }, '詳情')),
          ),
        )),
      ));
    }
    root.appendChild(card);
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'error' }, e.message));
  }
}

async function openOrderModal(id) {
  const modal = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === modal) modal.remove(); } });
  const inner = h('div', { class: 'modal' }, h('div', { class: 'muted' }, '載入中…'));
  modal.appendChild(inner);
  document.body.appendChild(modal);
  try {
    const o = await api.get(`/api/admin/orders/${id}`);
    inner.innerHTML = '';
    inner.appendChild(h('h2', {}, `訂單 ${o.tradeNo}`));
    inner.appendChild(h('div', { class: 'flex', style: 'gap:24px;flex-wrap:wrap;margin-bottom:16px' },
      kv('狀態', statusBadge(o.status)),
      kv('金額', `NT$ ${o.amount.toLocaleString()}`),
      kv('Provider', o.provider),
      kv('開立', fmt(o.createdAt)),
      kv('過期', fmt(o.expiresAt)),
      o.paidAt && kv('付款於', fmt(o.paidAt)),
    ));
    inner.appendChild(h('div', { class: 'muted', style: 'margin-bottom:6px' }, '品項'));
    inner.appendChild(h('div', { style: 'margin-bottom:16px' }, o.itemName));
    if (o.gatewayPayload) {
      inner.appendChild(h('div', { class: 'muted', style: 'margin-bottom:6px' }, '金流回傳資料'));
      inner.appendChild(h('pre', {}, prettyJson(o.gatewayPayload)));
    }
    inner.appendChild(h('div', { class: 'muted', style: 'margin:16px 0 6px' }, `Logs (${o.logs.length})`));
    if (o.logs.length) {
      const ul = h('div', {});
      for (const l of o.logs) {
        ul.appendChild(h('div', { style: 'padding:8px;border-bottom:1px solid var(--border);font-size:13px' },
          h('span', { class: `badge ${l.level === 'error' ? 'failed' : l.level === 'warn' ? 'pending' : 'paid'}` }, l.level),
          ' ',
          h('code', {}, l.event),
          ' — ', l.message || '',
          h('div', { class: 'muted', style: 'margin-top:4px' }, fmt(l.createdAt)),
        ));
      }
      inner.appendChild(ul);
    }
    inner.appendChild(h('div', { class: 'flex', style: 'margin-top:16px' },
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn secondary', onclick: () => modal.remove() }, '關閉'),
    ));
  } catch (e) {
    inner.innerHTML = '';
    inner.appendChild(h('div', { class: 'error' }, e.message));
  }
}

function kv(label, value) {
  return h('div', {},
    h('div', { class: 'muted', style: 'font-size:12px' }, label),
    h('div', { style: 'margin-top:2px' }, typeof value === 'string' ? value : value),
  );
}

function prettyJson(s) {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

async function logsPage(root) {
  root.appendChild(h('div', { class: 'muted' }, '載入中…'));
  try {
    const rows = await api.get('/api/admin/logs?take=200');
    root.innerHTML = '';
    const card = h('div', { class: 'card' });
    if (!rows.length) {
      card.appendChild(h('div', { class: 'muted' }, '無日誌。'));
    } else {
      card.appendChild(h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '時間'),
          h('th', {}, '層級'),
          h('th', {}, '事件'),
          h('th', {}, 'Provider'),
          h('th', {}, '訊息'),
          h('th', {}, '訂單'),
        )),
        h('tbody', {}, ...rows.map((l) =>
          h('tr', {},
            h('td', {}, fmt(l.createdAt)),
            h('td', {}, h('span', { class: `badge ${l.level === 'error' ? 'failed' : l.level === 'warn' ? 'pending' : 'paid'}` }, l.level)),
            h('td', {}, h('code', {}, l.event)),
            h('td', {}, l.provider || '-'),
            h('td', {}, l.message || ''),
            h('td', {}, l.orderId ? h('button', { class: 'btn small secondary', onclick: () => openOrderModal(l.orderId) }, '查看') : '-'),
          ),
        )),
      ));
    }
    root.appendChild(card);
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'error' }, e.message));
  }
}

// ===== shell =====
function shellView() {
  const PAGES = [
    ['dashboard', '儀表板'],
    ['gateways', '金流設定'],
    ['orders', '訂單'],
    ['logs', '日誌'],
  ];
  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'brand' }, '💰 Pay Bot'),
    h('nav', { class: 'nav' },
      ...PAGES.map(([id, label]) =>
        h('a', { href: `#${id}`, class: state.page === id ? 'active' : '', onclick: (e) => { e.preventDefault(); nav(id); } }, label),
      ),
    ),
  );
  const titleMap = Object.fromEntries(PAGES);
  const main = h('main', { class: 'main' },
    h('div', { class: 'topbar' },
      h('h1', {}, titleMap[state.page] || ''),
      h('div', { class: 'user-info' },
        state.user?.username,
        h('button', { class: 'btn small secondary', onclick: async () => {
          await api.post('/api/admin/logout', {});
          state.user = null;
          render();
        } }, '登出'),
      ),
    ),
    h('div', { id: 'page' }),
  );
  setTimeout(() => {
    const root = $('#page');
    if (!root) return;
    root.innerHTML = '';
    if (state.page === 'dashboard') dashboardPage(root);
    else if (state.page === 'gateways') gatewaysPage(root);
    else if (state.page === 'orders') ordersPage(root);
    else if (state.page === 'logs') logsPage(root);
  }, 0);
  return h('div', { class: 'shell' }, sidebar, main);
}

function render() {
  const app = $('#app');
  app.innerHTML = '';
  app.appendChild(state.user ? shellView() : loginView());
}

// init
(async () => {
  state.page = location.hash.slice(1) || 'dashboard';
  try {
    const me = await api.get('/api/admin/me');
    state.user = { username: me.username };
  } catch {
    state.user = null;
  }
  render();
})();
