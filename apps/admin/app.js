/* Admin tokens are kept in memory only. Every operation is authorized again by the API. */
const root = document.querySelector("#app"),
  modal = document.querySelector("#modal");
const hostedAdmin = document.querySelector('meta[name="stech-hosted-admin"]') !== null;
const cloudAdmin = document.querySelector('meta[name="stech-cloud-admin"]') !== null;
let token = "",
  admin = null,
  page = "overview",
  cache = {},
  pendingAdjustment = null;
const titles = {
  overview: "Genel bakış",
  payments: "Ödemeler",
  members: "Üyeler ve bakiye",
  adjustments: "Bakiye kayıtları",
  "payment-report": "Gün sonu raporu",
  promotions: "Kampanya ve bonus",
  "kiosk-design": "Kiosk tasarım merkezi",
  announcements: "Duyurular",
  audit: "Yönetim kayıtları",
  settings: "Sistem ayarları",
  accounts: "Yöneticiler",
  "notification-plans": "Bildirim planları",
  "membership-levels": "Üyelik seviyeleri",
  "refund-requests": "İade talepleri",
};
const secondaryPages = ["notification-plans", "membership-levels", "refund-requests"];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(
    Number(n) / 100,
  );
const date = (s) =>
  s
    ? new Date(s).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })
    : "—";
const uid = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const statusLabel = {
  completed: "Tamamlandı",
  pending: "Bekliyor",
  transferring: "Aktarılıyor",
  failed: "Başarısız",
  rejected: "Reddedildi",
  retry: "Yeniden denenecek",
  reconciliation: "Kontrol gerekli",
  processing: "İşleniyor",
  draft: "Taslak",
  pending_provider: "Sağlayıcı bekliyor",
  queued: "Sırada",
};
const badge = (s) =>
  `<span class="badge ${s === "completed" ? "ok" : "warn"}">${esc(statusLabel[s] ?? s)}</span>`;
const cashier = () => admin?.role === "cashier";
const canWrite = () => admin && !cashier() && admin.role !== "viewer";
async function api(path, body, method = body ? "POST" : "GET", extra = {}) {
  let url = "/api/v1/admin/" + path;
  if (hostedAdmin) {
    const [route, query] = path.split("?", 2);
    const params = new URLSearchParams(query);
    params.set("route", route);
    url = "./api.php?" + params;
  }
  const r = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? hostedAdmin ? { "X-STech-Admin-Session": token } : { Authorization: "Bearer " + token } : {}),
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) {
    if (r.status === 401 && token) {
      token = "";
      admin = null;
      void loginScreen();
    }
    throw new Error(data.message || "İşlem gerçekleştirilemedi.");
  }
  return data;
}
function toast(message) {
  const t = document.querySelector("#toast");
  t.textContent = message;
  t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 4500);
}
function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((x) => `<tr>${x.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" class="empty">Henüz kayıt yok.</td></tr>`}</tbody></table></div>`;
}
function button(label, action, id = "", primary = false) {
  return `<button type="button" ${primary ? 'class="primary"' : ""} data-action="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
}
function field(label, name, value = "", type = "text", attrs = "") {
  return `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
}
function area(label, name, value = "") {
  return `<label class="full">${esc(label)}<textarea name="${name}" required>${esc(value)}</textarea></label>`;
}
function select(label, name, options, value) {
  return `<label>${esc(label)}<select name="${name}">${options.map(([v, t]) => `<option value="${v}" ${String(v) === String(value) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
}
function formDialog(title, body, submit) {
  modal.innerHTML = `<h2>${esc(title)}</h2><form><div class="grid">${body}</div><p class="error" role="alert"></p><div class="actions"><button type="button" data-action="close">Vazgeç</button><button class="primary">Kaydet</button></div></form>`;
  modal.showModal();
  modal.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget,
      btn = form.querySelector("button.primary");
    btn.disabled = true;
    form.querySelector(".error").textContent = "";
    try {
      await submit(Object.fromEntries(new FormData(form)));
      modal.close();
      toast("İşlem kaydedildi.");
      await render();
    } catch (error) {
      form.querySelector(".error").textContent = error.message;
    } finally {
      btn.disabled = false;
    }
  };
}
async function loginScreen() {
  const state = await api("auth/status");
  const setup = state.setupRequired;
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (setup && hostedAdmin) {
    root.innerHTML = '<section class="login card"><h1>Yerel kurulum gerekli</h1><p>İlk yönetici hesabını A bilgisayarında S TECH Başlat menüsünden oluştur. Sonra bu sayfayı yenile.</p></section>';
    return;
  }
  const setupKey = fragment.get("setup") ?? "";
  history.replaceState(null, "", location.pathname);
  root.innerHTML = `<section class="login card"><div class="brand">S TECH<small>YÖNETİM MERKEZİ</small></div><h1>${setup ? "Yönetici hesabını oluştur" : "Yönetici girişi"}</h1><p class="muted">${setup ? "Bu bilgisayar için kurucu hesabını tanımla. En az 12 karakterli bir şifre kullan." : "İşletmenin hesaplarını, kampanyalarını ve bakiyelerini yönet."}</p><form>${setup ? field("Kurulum anahtarı", "setup", setupKey, "password", 'required autocomplete="off"') : ""}${field("Yönetici kullanıcı adı", "username", "", "text", 'required autocomplete="username"')}${field("Şifre", "password", "", "password", `required minlength="${setup ? 12 : 1}" autocomplete="${setup ? "new-password" : "current-password"}"`)}<p class="error" role="alert"></p><button class="primary">${setup ? "Hesabı oluştur" : "Giriş yap"}</button></form><p class="muted"><small>Üye hesaplarından ayrı yönetici yetkilendirmesi.</small></p></section>`;
  root.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.currentTarget,
      d = Object.fromEntries(new FormData(f));
    f.querySelector("button").disabled = true;
    try {
      if (setup)
        await api(
          "auth/setup",
          { username: d.username, password: d.password },
          "POST",
          { "X-Setup-Token": d.setup },
        );
      const result = await api("auth/login", {
        username: d.username,
        password: d.password,
      });
      token = result.token;
      admin = result.admin;
      page = cashier() ? "payments" : "overview";
      cache = {};
      await render();
    } catch (error) {
      f.querySelector(".error").textContent = error.message;
    } finally {
      f.querySelector("button").disabled = false;
    }
  };
}
async function render() {
  if (!admin) return loginScreen();
  if (cashier()) page = "payments";
  root.innerHTML = `<div class="shell"><aside><div class="brand">S TECH<small>YÖNETİM MERKEZİ</small></div><nav>${Object.entries(
    titles,
  )
    .filter(
      ([k]) => cloudAdmin ? ["overview", "payments", "payment-report"].includes(k) :
        cashier() ? k === "payments" : !["accounts", "settings"].includes(k) || admin.role === "owner",
    )
    .map(
      ([k, v]) =>
        `${k === secondaryPages[0] ? '<div class="nav-group">Taslaklar ve talepler</div>' : ""}<button data-page="${k}" class="${page === k ? "active" : ""}" ${page === k ? 'aria-current="page"' : ""}>${v}</button>`,
    )
    .join(
      "",
    )}</nav><footer><div>${esc(admin.username)} · ${esc({ owner: "Kurucu", operator: "Operatör", viewer: "İzleyici", cashier: "Kasa" }[admin.role])}</div>${cashier() || cloudAdmin ? "" : button("Şifremi değiştir", "password")}${button("Güvenli çıkış", "logout")}</footer></aside><main class="workspace"><header><div><p class="eyebrow">S TECH / İŞLETME YÖNETİMİ</p><h1>${titles[page]}</h1></div>${button("Yenile", "refresh")}</header><div id="content"><div class="loading">Kayıtlar yükleniyor…</div></div></main></div>`;
  const content = document.querySelector("#content");
  try {
    await renderPage();
  } catch (error) {
    if (content.isConnected) content.innerHTML = `<div class="card error">${esc(error.message)}</div>`;
  }
}
const reportDay = (offset = 0) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" })
  .format(new Date(Date.now() + offset * 86400000));
const reportMetrics = [
  ["Tahsil edilen", "captured"],
  ["Aktarılan ana tutar", "transferred"],
  ["Aktarılan bonus", "bonus"],
  ["Aktarım bekleyen ana tutar", "waiting"],
];
function exportReport(report) {
  const values = reportMetrics.map(([, key]) => (Number(report.summary[key]) / 100).toFixed(2).replace(".", ","));
  const csv = [
    ["Başlangıç", "Bitiş", "Kaynak", ...reportMetrics.map(([label]) => label + " (TL)"), "Tahsilat adedi", "Bekleyen adet"],
    [report.from, report.to, report.live ? "Canlı Ödeal" : "Deneme", ...values, report.summary.captured_count, report.summary.waiting_count],
  ].map(row => row.join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `stech-gun-sonu-${report.from}-${report.to}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function renderPage() {
  const c = document.querySelector("#content");
  if (page === "kiosk-design") return kioskEditor.open(c);
  if (page === "overview") {
    const d = await api("overview"),
      s = d.summary;
    if (!c.isConnected) return;
    const connection = d.connections ?? {};
    const kioskOnline = connection.kioskLastSeenAt && Date.now() - Date.parse(connection.kioskLastSeenAt) <= 90000;
    const wallet = connection.walletSync;
    const paymentMode = { live: "Ödeal canlı mod", stage: "Ödeal test modu", simulation: "Deneme ödemesi", disabled: "Ödeme kapalı" };
    c.innerHTML = `${cloudAdmin ? `<p class="notice">${d.lastSnapshotAt ? `A’dan alınan son veri ${date(d.lastSnapshotAt)}` : 'A bilgisayarından henüz veri alınmadı.'}</p>` : ''}<div class="split"><section class="card"><h2>Aktarım bekleyen ödemeler</h2><div class="metric">${esc(s.waiting)}</div><p class="muted">Onayı alınan ve bakiye aktarımı tamamlanmamış ödemeler.</p>${button("Bekleyen ödemeleri aç", "payment-queue", "", true)}</section><section class="card"><h2>Günlük işlemler</h2><div class="toolbar">${cloudAdmin ? "" : button("Üye ve bakiye", "goto-members")}${button("Gün sonu raporu", "goto-payment-report")}</div></section></div>
      <section class="card"><h2>Bağlantılar</h2><dl class="connection-list">
        <div><dt>Ödeme</dt><dd>${esc(paymentMode[connection.paymentMode] ?? "Durum alınamadı")} · ${d.topupEnabled && connection.paymentMode !== "disabled" ? "Yeni yükleme açık" : "Yeni yükleme kapalı"}</dd></div>
        <div><dt>PanCafe</dt><dd>${d.connected ? "Bağlı" : d.cafe === "Mock" ? "Deneme modu" : "Bağlantı kontrolü gerekli"}</dd></div>
        <div><dt>Bakiye düzenleme</dt><dd>${d.balanceAdjustment ? "Açık" : "Köprüde izin gerekli"}</dd></div>
        <div><dt>Kiosk</dt><dd>${!connection.kioskConfigured ? "Yapılandırılmadı" : kioskOnline ? "Çevrimiçi" : "Bağlantı alınamıyor"}${connection.kioskLastSeenAt ? `<small>Son bağlantı ${date(connection.kioskLastSeenAt)}</small>` : ""}</dd></div>
        <div><dt>Cüzdan eşitlemesi</dt><dd>${wallet ? esc({ synced: "Eşitlendi", pending: "Bekliyor", error: "Eşitleme hatası" }[wallet.status]) : "Kapalı"}${wallet?.lastSuccessfulSyncAt ? `<small>Son başarılı eşitleme ${date(wallet.lastSuccessfulSyncAt)}</small>` : ""}</dd></div>
      </dl></section>`;
    return;
  }
  if (page === "payment-report") {
    const range = cache.reportRange ?? { from: reportDay(), to: reportDay() };
    c.innerHTML = `<form id="report-range" class="toolbar">${field("Başlangıç", "from", range.from, "date", "required")}${field("Bitiş", "to", range.to, "date", "required")}<button class="primary">Raporu getir</button>${button("Bugün", "report-today")}${button("Dün", "report-yesterday")}</form><div id="report-results" aria-live="polite">Rapor yükleniyor…</div>`;
    const form = c.querySelector("form");
    form.onsubmit = (event) => {
      event.preventDefault();
      cache.reportRange = Object.fromEntries(new FormData(form));
      void render();
    };
    const result = c.querySelector("#report-results");
    try {
      const report = await api("payment-report?" + new URLSearchParams(range));
      if (!c.isConnected) return;
      cache.report = report;
      result.innerHTML = `<div class="cards">${reportMetrics.map(([label, key]) => `<div class="card"><small>${label}</small><div class="metric">${money(report.summary[key])}</div></div>`).join("")}</div>
        <div class="card"><p>${report.live ? "Canlı Ödeal işlemleri" : "Deneme işlemleri"} · ${report.summary.captured_count} tahsilat · ${report.summary.waiting_count} bekleyen</p>
        <p class="muted">Türkiye saatine göre tahsilat ve aktarım kendi işlem tarihinde sayılır. Bekleyen tutar, seçili tarihlerde tahsil edilip henüz aktarılmamış ödemeleri gösterir.</p>${button("CSV indir", "report-csv")}</div>`;
    } catch (error) {
      result.innerHTML = `<p class="error" role="alert">${esc(error.message)}</p>`;
    }
    return;
  }
  if (page === "members") {
    c.innerHTML = `<form id="search" class="toolbar">${select("Arama türü", "field", [["username", "Kullanıcı adı"], ["number", "Üye no"], ["name", "Ad soyad"], ["phone", "Telefon"]], cache.memberField ?? "username")}${field("Aranacak değer", "search", cache.search ?? "", "search", 'maxlength="65"')}<button class="primary">Ara</button></form><div id="members-table" aria-live="polite"></div>`;
    document.querySelector("#search").onsubmit = async (e) => {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      cache.search = form.get("search").trim();
      cache.memberField = cache.search ? form.get("field") : "username";
      cache.after = "0";
      const results = c.querySelector("#members-table");
      try { await loadMembers(); }
      catch (error) { results.innerHTML = `<p class="error" role="alert">${esc(error.message)}</p>`; }
    };
    await loadMembers();
    return;
  }
  if (page === "promotions") {
    cache.promotions = await api("promotions");
    c.innerHTML = `<div class="notice">Birden çok kampanya uygunsa en yüksek bonus uygulanır. Yeni ayarlar mevcut ödemelerin bonusunu değiştirmez.</div><div class="toolbar">${canWrite() ? button("Yeni kampanya", "promotion-new", "", true) : ""}</div>${table(
      [
        "Kampanya",
        "Minimum yükleme",
        "Bonus",
        "Üst sınır",
        "Tarih aralığı",
        "Durum",
        "Firestore",
        "",
      ],
      cache.promotions.map((p) => [
        esc(p.title),
        money(p.minimumAmount),
        "%" + p.bonusPercent,
        money(p.maxBonus),
        `${date(p.startsAt)}<small>${date(p.endsAt)}</small>`,
        badge(p.active ? "Yayında" : "Kapalı"),
        `<span data-campaign-sync="${esc(p.id)}">${badge(p.cloudSync === "synced" ? "Eşitlendi" : p.cloudSync === "pending" ? "Gönderim bekliyor" : "Bağlantı kapalı")}</span>`,
        canWrite() ? button("Düzenle", "promotion-edit", p.id) : "",
      ]),
    )}`;
    return;
  }
  if (page === "payments") {
    const status = cashier() ? "transferring" : cache.paymentStatus ?? "";
    const params = new URLSearchParams({ status, search: cache.paymentSearch ?? "", ...(cache.paymentBefore ?? {}) });
    const payments = await api("payments?" + params);
    if (!c.isConnected) return;
    cache.payments = payments;
    c.innerHTML = `<div class="toolbar">${cashier() ? "" : button("Aktarım bekleyenler", "payment-queue", "", status === "transferring")}</div>
      <form class="toolbar" id="payment-filter">${cashier() ? badge(status) : select("Durum", "paymentStatus", [["", "Tümü"], ["pending", "POS onayı bekliyor"], ["transferring", "Bakiye aktarımı bekliyor"], ["completed", "Tamamlandı"], ["failed", "Başarısız"]], status)}${field("Kullanıcı adı veya işlem numarası", "search", params.get("search"), "search", 'maxlength="36"')}<button class="primary">Ara</button>${button("Filtreleri temizle", "payment-clear")}</form>${table(
      ["Üye / işlem", "Yükleme", "Bonus", "Durum", "Aktarım", "Tarih", ""],
      cache.payments.map((p) => [
        `${esc(p.username ?? p.user_id)}<small>${esc(p.id)}</small><small>${p.payment_provider === "odeal" ? p.transfer_target === "pancafe" ? "Ödeal canlı" : "Ödeal test" : "Deneme"}</small>`,
        money(p.amount),
        money(p.bonus),
        badge(p.pos_cancelled_at && p.status === "failed" ? "İptal edildi" : p.status),
        badge(p.completed_manually ? "Manuel olarak aktarıldı" : p.transfer_status ?? "—"),
        date(p.created_at),
        [
          button("Ayrıntı", "payment-detail", p.id),
          canWrite() && !p.pos_cancelled_at && p.status === "transferring" && ["retry", "reconciliation"].includes(p.transfer_status)
            ? button("Aktarımı yeniden dene", "payment-retry", p.id) : "",
          (canWrite() || cashier()) && p.can_complete_manually ? button("Manuel olarak aktarıldı", "payment-manual", p.id) : "",
        ].filter(Boolean).join(" "),
      ]),
    )}<div class="toolbar">${cache.payments.length === 100 ? button("Daha eski ödemeler", "payments-more") : ""}${cache.paymentBefore ? button("En yeni ödemeler", "payments-first") : ""}</div>`;
    const form = c.querySelector("form");
    form.onsubmit = (event) => {
      event.preventDefault();
      const filters = new FormData(form);
      cache.paymentStatus = filters.get("paymentStatus") ?? "";
      cache.paymentSearch = filters.get("search").trim();
      cache.paymentBefore = undefined;
      void render();
    };
    form.querySelector("select")?.addEventListener("change", () => form.requestSubmit());
    return;
  }
  if (page === "adjustments") {
    cache.adjustments = await api("adjustments");
    c.innerHTML = `<p class="muted">Son 100 yönetici bakiye işlemi. Bekleyen işlemler aynı kimlikle yeniden kontrol edilir.</p>${table(
      [
        "Üye",
        "Değişiklik",
        "Bonus değişikliği",
        "Son bakiye",
        "Durum",
        "Neden / yönetici",
        "",
      ],
      cache.adjustments.map((a) => [
        esc(a.username),
        money(a.delta),
        money(a.bonus_delta),
        a.balance_after === null ? "—" : money(a.balance_after),
        badge(a.status),
        `${esc(a.reason)}<small>${esc(a.administrator)} · ${date(a.created_at)}</small>`,
        a.status === "pending" && a.admin_id === admin.id
          ? button("Sonucu kontrol et", "adjust-retry", a.id)
          : "",
      ]),
    )}`;
    return;
  }
  if (page === "audit") {
    cache.audit = await api(
      "audit" +
        (cache.auditBefore
          ? "?before=" + encodeURIComponent(cache.auditBefore)
          : ""),
    );
    c.innerHTML =
      table(
        ["Tarih", "İşlem", "Kaynak", "Ayrıntı"],
        cache.audit.map((a) => [
          date(a.created_at),
          esc(a.event),
          esc(a.resource_id),
          `<details><summary>${esc(a.metadata.username ?? "Sistem")}</summary><pre>${esc(JSON.stringify(a.metadata, null, 2))}</pre></details>`,
        ]),
      ) +
      `<div class="toolbar">${cache.audit.length === 100 ? button("Daha eski kayıtlar", "audit-more") : ""}${cache.auditBefore ? button("En yeni kayıtlar", "audit-first") : ""}</div>`;
    return;
  }
  if (page === "accounts") {
    cache.accounts = await api("accounts");
    c.innerHTML = `<div class="toolbar">${button("Yönetici ekle", "account-new", "", true)}</div>${table(
      ["Kullanıcı", "Rol", "Durum", ""],
      cache.accounts.map((a) => [
        esc(a.username),
        esc(
          { owner: "Kurucu", operator: "Operatör", viewer: "İzleyici", cashier: "Kasa" }[a.role],
        ),
        badge(a.active ? "Aktif" : "Kapalı"),
        a.role === "owner"
          ? "Kurucu"
          : button(
              a.active ? "Erişimi kapat" : "Etkinleştir",
              "account-toggle",
              a.id,
            ),
      ]),
    )}<p class="muted">Operatör kampanya ve bakiye yönetebilir. İzleyici yalnızca kayıtları görüntüler.</p>`;
    return;
  }
  cache.content = await api("content/" + page);
  const notices = {
    announcements:
      "Yayınlanan duyurular tarih aralığında mobil ana sayfada görünür.",
    "notification-plans":
      "Bildirim metni ve saati kaydedilir. Push sağlayıcısı bağlı olmadığı için planlar taslaktır; telefona gönderim yapılmaz.",
    "membership-levels":
      "Seviye ve avantaj taslakları kaydedilir. PanCafe fiyatlarını veya üyelerin seviyesini henüz değiştirmez.",
    "refund-requests":
      "İade talepleri inceleme için kaydedilir. Bankaya iade gönderilmez ve bakiye otomatik düşürülmez.",
    settings:
      "Yüklemeyi durdurmak yeni ödeme başlatmayı engeller. Önceden alınmış ödemelerin aktarımı devam eder.",
  };
  c.innerHTML = `<div class="notice">${notices[page] ?? ""}</div><div class="toolbar">${canWrite() ? button(page === "settings" ? "Ayarları düzenle" : "Yeni kayıt", "content-new", "", true) : ""}</div>${table(
    ["Başlık", "Açıklama / değer", "Durum", ""],
    cache.content.map((item) => [
      esc(item.title ?? item.name ?? item.paymentId ?? "Genel ayarlar"),
      esc(
        item.body ??
          item.benefits ??
          item.reason ??
          (item.topupEnabled ? "Bakiye yükleme açık" : "Bakiye yükleme kapalı"),
      ) +
        (item.time
          ? `<small>Her gün ${esc(item.time)} · Türkiye saati</small>`
          : ""),
      badge(
        item.status ??
          (item.active
            ? "Yayında"
            : page === "settings"
              ? "Kaydedildi"
              : "Kapalı"),
      ),
      canWrite() && page !== "refund-requests"
        ? button("Düzenle", "content-edit", item.id)
        : "",
    ]),
  )}`;
}
async function loadMembers() {
  const target = document.querySelector("#members-table");
  const d = await api(
    "members?search=" +
      encodeURIComponent(cache.search ?? "") +
      "&after=" +
      (cache.after ?? "0") + "&field=" + encodeURIComponent(cache.memberField ?? "username"),
  );
  if (!target?.isConnected) return;
  cache.members = d;
  target.innerHTML =
    table(
      ["Üye", "Ad soyad", "Toplam bakiye", "İçindeki bonus", "Durum", ""],
      d.items.map((m) => [
        `${esc(m.username)}<small>Üye no ${m.id}</small>`,
        esc(m.name),
        money(m.balance),
        money(m.bonus),
        badge(m.active ? "Aktif" : "Kapalı"),
        button("Hesabı aç", "member", String(m.id)),
      ]),
    ) +
    `<div class="toolbar">${d.nextCursor ? button("Sonraki üyeler", "members-more") : ""}${cache.after && cache.after !== "0" ? button("Başa dön", "members-first") : ""}</div>`;
}
function promotionForm(
  p = {
    id: uid(),
    revision: 0,
    title: "",
    description: "",
    terms: "",
    minimumAmount: 20000,
    bonusPercent: 10,
    maxBonus: 100000,
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    accent: "orange",
    active: true,
  },
) {
  formDialog(
    p.revision ? "Kampanyayı düzenle" : "Yeni kampanya",
    field("Başlık", "title", p.title, "text", 'required maxlength="100"') +
      select(
        "Durum",
        "active",
        [
          [true, "Yayında"],
          [false, "Kapalı"],
        ],
        p.active,
      ) +
      area("Açıklama", "description", p.description) +
      field(
        "Minimum yükleme (TL)",
        "minimum",
        p.minimumAmount / 100,
        "number",
        'required min="50" max="10000" step="0.01"',
      ) +
      field(
        "Bonus (%)",
        "percent",
        p.bonusPercent,
        "number",
        'required min="0" max="100" step="1"',
      ) +
      field(
        "En fazla bonus (TL)",
        "maximum",
        p.maxBonus / 100,
        "number",
        'required min="0" max="1000" step="0.01"',
      ) +
      select(
        "Vurgu rengi",
        "accent",
        [
          ["orange", "Turuncu"],
          ["blue", "Mavi"],
        ],
        p.accent,
      ) +
      field(
        "Başlangıç (Türkiye saati)",
        "startsAt",
        localTime(p.startsAt),
        "datetime-local",
        "required",
      ) +
      field(
        "Bitiş (Türkiye saati)",
        "endsAt",
        localTime(p.endsAt),
        "datetime-local",
        "required",
      ) +
      area("Koşullar", "terms", p.terms),
    (d) =>
      api(
        "promotions",
        {
          id: p.id,
          revision: p.revision,
          title: d.title,
          description: d.description,
          terms: d.terms,
          minimumAmount: kurus(d.minimum),
          bonusPercent: Number(d.percent),
          maxBonus: kurus(d.maximum),
          startsAt: istanbul(d.startsAt),
          endsAt: istanbul(d.endsAt),
          accent: d.accent,
          active: d.active === "true",
        },
        "PUT",
      ),
  );
}
function kurus(value) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(String(value)))
    throw new Error("Tutarı en fazla iki ondalık basamakla gir.");
  const [whole, frac = ""] = String(value).replace(",", ".").split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
function localTime(value) {
  return new Date(Date.parse(value) + 3 * 3600000).toISOString().slice(0, 16);
}
function istanbul(value) {
  return new Date(value + ":00+03:00").toISOString();
}
async function memberDialog(id) {
  const m = cache.members.items.find((x) => x.id === Number(id));
  const data = await api(
    `members/${m.id}?username=${encodeURIComponent(m.username)}`,
  );
  cache.selected = data.member;
  modal.innerHTML = `<h2>${esc(data.member.username)} · Üye no ${m.id}</h2><div class="cards"><div class="card"><small>Toplam bakiye</small><div class="metric">${money(data.member.balance)}</div></div><div class="card"><small>Bakiyenin içindeki bonus</small><div class="metric">${money(data.member.bonus)}</div></div></div><p class="muted">${esc(data.member.name)} · ${esc(data.member.phone || "Telefon yok")} · ${esc(data.member.email || "E-posta yok")}</p><div class="toolbar">${canWrite() && data.member.active ? button("Bakiye / bonus düzenle", "adjust-new", "", true) : ""}${button("Kapat", "close")}</div><h2>Son hesap hareketleri</h2>${table(
    ["Tarih", "Kaynak", "İşlem", "Tutar", "Kalan"],
    (data.activity ?? []).map(item => [date(item.createdAt), esc(item.source),
      `${esc(item.title)}${item.description ? `<small>${esc(item.description)}</small>` : ""}${item.status ? badge(item.status) : ""}`,
      money(item.amount), item.balanceAfter == null ? "—" : money(item.balanceAfter)]),
  )}<details class="native-history"><summary>PanCafe kaynak kayıtları</summary>${table(
    ["Tarih", "Tutar", "Kalan", "Açıklama"],
    data.history
      .slice(0, 100)
      .map((h) => [
        esc(h.OCCURRED_DATE + " " + h.OCCURRED_TIME),
        esc(h.RAW_AMOUNT_TL + " TL"),
        esc(h.BALANCE_TL + " TL"),
        esc(h.NOTE),
      ]),
  )}</details>`;
  modal.showModal();
}
async function paymentDialog(id) {
  const { payment: p, timeline } = await api("payments/" + encodeURIComponent(id));
  if (page !== "payments") return;
  const failure = { active_session: "Üyenin açık PanCafe oturumu var", manual_review: "PanCafe aktarımının kontrol edilmesi gerekiyor", transfer_unavailable: "PanCafe aktarımı tamamlanamadı" };
  const pos = p.payment_provider === "odeal";
  const confirmation = timeline.find(entry => entry.status === "transferring");
  const decision = confirmation ? `Onaylandı · ${date(confirmation.created_at)}` :
    p.pos_cancelled_at ? "İptal edildi" : p.status === "failed" ? "Başarısız" : "Onay bekleniyor";
  modal.innerHTML = `<h2>Ödeme ayrıntısı</h2><p>${esc(p.username ?? p.user_id)} · ${money(p.amount)}${p.bonus ? ` + ${money(p.bonus)} bonus` : ""} <small>${esc(p.id)}</small></p>
    <dl class="connection-list"><div><dt>${pos ? "Ödeal POS" : "Deneme ödemesi"}</dt><dd>${decision}</dd></div>
    <div><dt>Bakiye aktarımı</dt><dd>${badge(p.completed_manually ? "Elle aktarıldı" : p.transfer_status ?? "Başlamadı")}${p.attempts != null ? `<small>${p.attempts} kayıtlı deneme</small>` : ""}</dd></div>
    <div><dt>Son aktarım sorunu</dt><dd>${esc(failure[p.last_failure_code] ?? "Kayıt yok")}${p.last_failure_at ? `<small>${date(p.last_failure_at)}</small>` : ""}</dd></div></dl>
    <h3>İşlem geçmişi</h3>${table(["Tarih", "İşlem", "Yönetici"], timeline.map(entry => [date(entry.created_at),
      esc(entry.event === "admin.payment.retry" ? "Aktarımı yeniden denedi" : entry.event === "admin.payment.manual_transfer" ? "Elle aktarıldığını işaretledi" : statusLabel[entry.status] ?? entry.status),
      esc(entry.administrator ?? "Sistem")]))}<div class="actions">${button("Kapat", "close")}</div>`;
  modal.showModal();
}
function adjustmentForm() {
  modal.close();
  const m = cache.selected;
  pendingAdjustment = null;
  const operationId = uid();
  formDialog(
    `${m.username} · Bakiye düzenle`,
    `<p class="notice full">Toplam ${money(m.balance)} · İçindeki bonus ${money(m.bonus)}. Bu işlem PanCafe bakiyesini değiştirir.</p>` +
      select(
        "İşlem",
        "mode",
        [
          ["add", "Para ekle"],
          ["subtract", "Para çıkar"],
          ["set", "Toplam bakiyeyi belirle"],
          ["bonus-add", "Bonus ekle"],
          ["bonus-subtract", "Bonus çıkar"],
        ],
        "add",
      ) +
      field(
        "Tutar (TL)",
        "amount",
        "",
        "number",
        'required min="0.01" max="10000" step="0.01"',
      ) +
      area("İşlem nedeni (zorunlu)", "reason"),
    async (d) => {
      if (!pendingAdjustment) {
        const value = kurus(d.amount);
        const delta =
          d.mode === "set"
            ? value - m.balance
            : ["subtract", "bonus-subtract"].includes(d.mode)
              ? -value
              : value;
        const bonusDelta = d.mode.startsWith("bonus-") ? delta : 0;
        if (
          !confirm(
            `${m.username}\nDeğişiklik: ${money(delta)}\nYeni toplam bakiye: ${money(m.balance + delta)}\nNeden: ${d.reason}\n\nPanCafe'ye uygula?`,
          )
        )
          throw new Error("İşlem uygulanmadı.");
        pendingAdjustment = {
          memberId: m.id,
          username: m.username,
          delta,
          bonusDelta,
          expectedBalance: m.balance,
          expectedBonus: m.bonus,
          reason: d.reason,
          operationId,
        };
        modal
          .querySelectorAll("input,select,textarea")
          .forEach((field) => (field.disabled = true));
      }
      await api("adjustments", pendingAdjustment);
      pendingAdjustment = null;
    },
  );
}
function contentForm(item = {}) {
  const id = item.id ?? uid();
  let fields = "";
  if (page === "announcements") {
    fields =
      field("Başlık", "title", item.title ?? "", "text", "required") +
      select(
        "Durum",
        "active",
        [
          [true, "Yayında"],
          [false, "Kapalı"],
        ],
        item.active ?? true,
      ) +
      area("Duyuru", "body", item.body ?? "") +
      field(
        "Başlangıç (Türkiye)",
        "startsAt",
        localTime(item.startsAt ?? new Date().toISOString()),
        "datetime-local",
        "required",
      ) +
      field(
        "Bitiş (Türkiye)",
        "endsAt",
        localTime(
          item.endsAt ?? new Date(Date.now() + 7 * 86400000).toISOString(),
        ),
        "datetime-local",
        "required",
      );
  } else if (page === "notification-plans") {
    fields =
      field(
        "Başlık",
        "title",
        item.title ?? "Bu akşam S TECH’te buluşalım",
        "text",
        "required",
      ) +
      field(
        "Her gün (Türkiye saati)",
        "time",
        item.time ?? "16:00",
        "time",
        "required",
      ) +
      area(
        "Bildirim metni",
        "body",
        item.body ??
          "Ekibini topla, oyun keyfine kaldığın yerden devam et. Seni bekliyoruz!",
      );
  } else if (page === "membership-levels") {
    fields =
      field("Seviye adı", "name", item.name ?? "", "text", "required") +
      area("Avantajlar", "benefits", item.benefits ?? "");
  } else if (page === "settings") {
    fields =
      select(
        "Yeni bakiye yüklemeleri",
        "topupEnabled",
        [
          [true, "Açık"],
          [false, "Kapalı"],
        ],
        item.topupEnabled ?? true,
      ) +
      area(
        "Destek metni",
        "supportText",
        item.supportText ??
          "Hesap işlemleri için S TECH yetkilisiyle görüşebilirsin.",
      );
  } else {
    fields =
      field("Tamamlanmış ödeme kimliği", "paymentId", "", "text", "required") +
      area("İade talebinin nedeni", "reason");
  }
  formDialog(titles[page], fields, (d) =>
    api(
      "content/" + page,
      {
        ...d,
        id,
        ...(page === "announcements"
          ? {
              active: d.active === "true",
              startsAt: istanbul(d.startsAt),
              endsAt: istanbul(d.endsAt),
            }
          : {}),
        ...(page === "settings"
          ? { topupEnabled: d.topupEnabled === "true" }
          : {}),
      },
      "PUT",
    ),
  );
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("button");
  if (!el) return;
  if (el.dataset.page) {
    page = el.dataset.page;
    return void render();
  }
  const a = el.dataset.action,
    id = el.dataset.id;
  if (!a) return;
  try {
    if (a === "close") {
      modal.close();
      return;
    }
    if (a === "logout") {
      await api("auth/logout", {});
      token = "";
      admin = null;
      return void loginScreen();
    }
    if (a === "password")
      return formDialog(
        "Yönetici şifreni değiştir",
        field("Mevcut şifre", "currentPassword", "", "password", "required") +
          field(
            "Yeni şifre",
            "password",
            "",
            "password",
            'required minlength="12"',
          ),
        async (d) => {
          await api("auth/password", d);
          token = "";
          admin = null;
        },
      );
    if (a === "refresh") return void render();
    if (a === "report-csv") return exportReport(cache.report);
    if (a === "report-today" || a === "report-yesterday") {
      const day = reportDay(a === "report-yesterday" ? -1 : 0);
      cache.reportRange = { from: day, to: day };
      return void render();
    }
    if (a === "payment-queue" || a === "payment-clear") {
      cache.paymentStatus = a === "payment-queue" ? "transferring" : "";
      cache.paymentSearch = "";
      cache.paymentBefore = undefined;
      page = "payments";
      return void render();
    }
    if (a === "payment-detail") return await paymentDialog(id);
    if (a.startsWith("goto-")) {
      page = a.slice(5);
      return void render();
    }
    if (a === "member") return await memberDialog(id);
    if (a === "adjust-new") return adjustmentForm();
    if (a === "promotion-new") return promotionForm();
    if (a === "promotion-edit")
      return promotionForm(cache.promotions.find((p) => p.id === id));
    if (a === "content-new")
      return contentForm(page === "settings" ? cache.content[0] : undefined);
    if (a === "content-edit")
      return contentForm(cache.content.find((p) => p.id === id));
    if (a === "members-more") {
      cache.after = cache.members.nextCursor;
      return await loadMembers();
    }
    if (a === "members-first") {
      cache.after = "0";
      return await loadMembers();
    }
    if (a === "payments-more") {
      const last = cache.payments.at(-1);
      cache.paymentBefore = { before: last.cursor_date, beforeId: last.id };
      return void render();
    }
    if (a === "payments-first") {
      cache.paymentBefore = undefined;
      return void render();
    }
    if (a === "audit-more") {
      cache.auditBefore = cache.audit.at(-1).created_at;
      return void render();
    }
    if (a === "audit-first") {
      cache.auditBefore = "";
      return void render();
    }
    if (a === "payment-retry") {
      el.disabled = true;
      await api("payments/" + id + "/retry", {});
      toast("Aktarım yeniden kontrol edildi.");
      return void render();
    }
    if (a === "payment-manual") {
      const payment = cache.payments.find((p) => p.id === id);
      if (!payment?.can_complete_manually) return;
      const bonus = payment.bonus ? ` ve ${money(payment.bonus)} bonus` : "";
      if (!confirm(`${payment.username ?? payment.user_id} için ${money(payment.amount)}${bonus} PanCafe’ye elle aktarıldı mı? Ödeme tamamlandı olarak kaydedilecek.`)) return;
      el.disabled = true;
      await api("payments/" + id + "/manual-transfer", {});
      toast("Ödeme manuel olarak aktarıldı.");
      return void render();
    }
    if (a === "adjust-retry") {
      const x = cache.adjustments.find((x) => x.id === id);
      el.disabled = true;
      await api("adjustments", {
        operationId: x.id,
        memberId: x.member_id,
        username: x.username,
        delta: Number(x.delta),
        bonusDelta: Number(x.bonus_delta),
        expectedBalance: Number(x.expected_balance),
        expectedBonus: Number(x.expected_bonus),
        reason: x.reason,
      });
      toast("İşlem doğrulandı.");
      return void render();
    }
    if (a === "account-new") {
      return formDialog(
        "Yönetici ekle",
        field("Kullanıcı adı", "username", "", "text", "required") +
          field(
            "Şifre (en az 12 karakter)",
            "password",
            "",
            "password",
            'required minlength="12"',
          ) +
          select(
            "Yetki",
            "role",
            [
              ["operator", "Operatör"],
              ["viewer", "İzleyici"],
              ["cashier", "Kasa"],
            ],
            "viewer",
          ),
        (d) => api("accounts", d),
      );
    }
    if (a === "account-toggle") {
      const x = cache.accounts.find((x) => x.id === id);
      if (confirm(`${x.username} için erişim durumunu değiştir?`)) {
        await api("accounts/" + id, { active: !x.active }, "PUT");
        return void render();
      }
    }
  } catch (error) {
    toast(error.message);
  } finally {
    el.disabled = false;
  }
});
loginScreen().catch((error) => {
  root.innerHTML = `<section class="login card error">${esc(error.message)}</section>`;
});
let checkingCampaigns = false;
setInterval(async () => {
  if (checkingCampaigns || !token || page !== "promotions" || document.hidden) return;
  checkingCampaigns = true;
  try {
    const campaigns = await api("promotions");
    if (page !== "promotions") return;
    for (const element of document.querySelectorAll('[data-campaign-sync]')) {
      const p = campaigns.find(p => p.id === element.dataset.campaignSync);
      if (p) element.innerHTML = badge(p.cloudSync === "synced" ? "Eşitlendi" : p.cloudSync === "pending" ? "Gönderim bekliyor" : "Bağlantı kapalı");
    }
  } catch { /* A failed check must not discard an open campaign form. */ }
  finally { checkingCampaigns = false; }
}, 5000);
