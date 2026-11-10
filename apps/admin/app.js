/* Admin tokens are kept in memory only. Every operation is authorized again by the API. */
const root = document.querySelector("#app"),
  modal = document.querySelector("#modal");
let token = "",
  admin = null,
  page = "overview",
  cache = {},
  pendingAdjustment = null;
const titles = {
  overview: "Genel bakış",
  members: "Üyeler ve bakiye",
  promotions: "Kampanya ve bonus",
  payments: "Ödemeler",
  adjustments: "Bakiye kayıtları",
  announcements: "Duyurular",
  "notification-plans": "Bildirim planları",
  "membership-levels": "Üyelik seviyeleri",
  "refund-requests": "İade talepleri",
  audit: "Yönetim kayıtları",
  settings: "Sistem ayarları",
  accounts: "Yöneticiler",
};
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
};
const badge = (s) =>
  `<span class="badge ${s === "completed" ? "ok" : "warn"}">${esc(statusLabel[s] ?? s)}</span>`;
const canWrite = () => admin && admin.role !== "viewer";
async function api(path, body, method = body ? "POST" : "GET", extra = {}) {
  const r = await fetch("/api/v1/admin/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
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
  return `<button ${primary ? 'class="primary"' : ""} data-action="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
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
  root.innerHTML = `<div class="shell"><aside><div class="brand">S TECH<small>YÖNETİM MERKEZİ</small></div><nav>${Object.entries(
    titles,
  )
    .filter(
      ([k]) => !["accounts", "settings"].includes(k) || admin.role === "owner",
    )
    .map(
      ([k, v]) =>
        `<button data-page="${k}" class="${page === k ? "active" : ""}">${v}</button>`,
    )
    .join(
      "",
    )}</nav><footer><div>${esc(admin.username)} · ${esc({ owner: "Kurucu", operator: "Operatör", viewer: "İzleyici" }[admin.role])}</div>${button("Şifremi değiştir", "password")}${button("Güvenli çıkış", "logout")}</footer></aside><main class="workspace"><header><div><p class="eyebrow">S TECH / İŞLETME YÖNETİMİ</p><h1>${titles[page]}</h1><span class="muted">Kontrol sende. Her değişiklik kayıt altında.</span></div>${button("Yenile", "refresh")}</header><div id="content"><div class="loading">Kayıtlar yükleniyor…</div></div></main></div>`;
  try {
    await renderPage();
  } catch (error) {
    document.querySelector("#content").innerHTML =
      `<div class="card error">${esc(error.message)}</div>`;
  }
}
async function renderPage() {
  const c = document.querySelector("#content");
  if (page === "overview") {
    const d = await api("overview"),
      s = d.summary;
    cache.overview = d;
    c.innerHTML = `<div class="cards">${[
      ["Tamamlanan yükleme", money(s.amount)],
      ["Verilen yükleme bonusu", money(s.bonus)],
      ["Tamamlanan ödeme", s.completed],
      ["Kontrol bekleyen", s.waiting],
    ]
      .map(
        ([t, v]) =>
          `<div class="card"><small>${t}</small><div class="metric">${v}</div></div>`,
      )
      .join(
        "",
      )}</div><div class="split"><div class="card"><h2>Bağlantılar</h2><p class="status-line"><span class="dot ${d.connected ? "" : "off"}"></span>PanCafe · ${d.connected ? "Bağlı" : "Kontrol gerekli"}</p><p>Ödeme: <span class="badge warn">Deneme ödemesi</span></p><p>Bakiye yönetimi: ${d.balanceAdjustment ? "Açık" : "Bağlantı aracında izin gerekli"}</p><p class="muted">Tutarlar mobil yüklemelere aittir. Kasa cirosu veya toplam işletme geliri değildir.</p></div><div class="card"><h2>Hızlı işlemler</h2><div class="toolbar">${button("Üye ve bakiye", "goto-members", "", true)}${button("Bonus ayarla", "goto-promotions")}</div><p class="muted">Bakiye değişiklikleri PanCafe hesabına uygulanır. Bonus kampanyaları yeni ödeme işlemlerinde kullanılır.</p></div></div><div class="notice">Gerçek kart tahsilatı, banka iadesi ve telefona push gönderimi henüz bağlı değil. Bu alanların hazırlıkları panelden yönetilebilir; gönderilmiş veya iade edilmiş olarak gösterilmez.</div>`;
    return;
  }
  if (page === "members") {
    c.innerHTML = `<form id="search" class="toolbar"><input name="search" aria-label="Kullanıcı adı" placeholder="PanCafe kullanıcı adıyla ara" value="${esc(cache.search ?? "")}"><button class="primary">Ara</button></form><div id="members-table"></div>`;
    document.querySelector("#search").onsubmit = async (e) => {
      e.preventDefault();
      cache.search = new FormData(e.currentTarget).get("search");
      cache.after = "0";
      await loadMembers();
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
    const status = cache.paymentStatus ?? "";
    cache.payments = await api(
      "payments?status=" +
        status +
        (cache.paymentBefore
          ? "&before=" + encodeURIComponent(cache.paymentBefore)
          : ""),
    );
    c.innerHTML = `<div class="toolbar">${select("Durum", "paymentStatus", [["", "Tümü"], ...Object.entries(statusLabel).filter(([k]) => ["pending", "transferring", "completed", "failed"].includes(k))], status)}</div>${table(
      ["Üye / işlem", "Yükleme", "Bonus", "Durum", "Aktarım", "Tarih", ""],
      cache.payments.map((p) => [
        `${esc(p.username ?? p.user_id)}<small>${esc(p.id)}</small>`,
        money(p.amount),
        money(p.bonus),
        badge(p.status),
        badge(p.transfer_status ?? "—"),
        date(p.created_at),
        canWrite() && ["retry", "reconciliation"].includes(p.transfer_status)
          ? button("Aktarımı yeniden dene", "payment-retry", p.id)
          : "",
      ]),
    )}<div class="toolbar">${cache.payments.length === 100 ? button("Daha eski ödemeler", "payments-more") : ""}${cache.paymentBefore ? button("En yeni ödemeler", "payments-first") : ""}</div>`;
    c.querySelector("select").onchange = (e) => {
      cache.paymentStatus = e.target.value;
      cache.paymentBefore = "";
      void render();
    };
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
          { owner: "Kurucu", operator: "Operatör", viewer: "İzleyici" }[a.role],
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
  const d = await api(
    "members?search=" +
      encodeURIComponent(cache.search ?? "") +
      "&after=" +
      (cache.after ?? "0"),
  );
  cache.members = d;
  document.querySelector("#members-table").innerHTML =
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
  modal.innerHTML = `<h2>${esc(data.member.username)} · Üye no ${m.id}</h2><div class="cards"><div class="card"><small>Toplam bakiye</small><div class="metric">${money(data.member.balance)}</div></div><div class="card"><small>Bakiyenin içindeki bonus</small><div class="metric">${money(data.member.bonus)}</div></div></div><p class="muted">${esc(data.member.name)} · ${esc(data.member.phone || "Telefon yok")} · ${esc(data.member.email || "E-posta yok")}</p><div class="toolbar">${canWrite() && data.member.active ? button("Bakiye / bonus düzenle", "adjust-new", "", true) : ""}${button("Kapat", "close")}</div><h2>PanCafe işlem geçmişi</h2>${table(
    ["Tarih", "Tutar", "Kalan", "Açıklama"],
    data.history
      .slice(0, 100)
      .map((h) => [
        esc(h.OCCURRED_DATE + " " + h.OCCURRED_TIME),
        esc(h.RAW_AMOUNT_TL + " TL"),
        esc(h.BALANCE_TL + " TL"),
        esc(h.NOTE),
      ]),
  )}`;
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
      cache.paymentBefore = cache.payments.at(-1).created_at;
      return void render();
    }
    if (a === "payments-first") {
      cache.paymentBefore = "";
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
