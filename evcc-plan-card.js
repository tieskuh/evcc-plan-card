/**
 * EVCC Plan Card
 * A minimal, Home Assistant-native card to set an EVCC departure charge plan.
 * Companion card for the marq24/ha-evcc integration (evcc_intg).
 *
 * https://github.com/tieskuh/evcc-plan-card
 */

const CARD_VERSION = "1.0.0";

const LANGS = {
  en: {
    title: "Charge plan",
    no_plan: "No active charge plan",
    departure: "Departure",
    target: "Charge target",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete plan",
    today: "today",
    tomorrow: "tomorrow",
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    status_today: "Today",
    status_tomorrow: "Tomorrow",
  },
  nl: {
    title: "Laadplan",
    no_plan: "Geen actief laadplan",
    departure: "Vertrektijd",
    target: "Laaddoel",
    save: "Opslaan",
    cancel: "Annuleren",
    delete: "Plan wissen",
    today: "vandaag",
    tomorrow: "morgen",
    months: ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"],
    weekdays: ["ma", "di", "wo", "do", "vr", "za", "zo"],
    status_today: "Vandaag",
    status_tomorrow: "Morgen",
  },
};

const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtFull = (d) => `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

class EvccPlanCard extends HTMLElement {
  setConfig(config) {
    const cfg = config || {};
    const lp = cfg.loadpoint || "carport";
    this._cfg = Object.assign({
      loadpoint: lp,
      vehicle_select: `select.evcc_${lp}_vehicle_name`,
      plan_active: `binary_sensor.evcc_${lp}_plan_active`,
      plan_time: `sensor.evcc_${lp}_effective_plan_time`,
      plan_soc: `sensor.evcc_${lp}_effective_plan_soc`,
      soc_options: [50, 60, 70, 80, 90, 100],
      minute_step: 15,
      default_hour: 8,
      default_day_offset: 1,
      default_soc: 80,
      max_days: 6,
      language: null,
      title: null,
    }, cfg);
    this._ready = false;
  }

  static getStubConfig() {
    return { loadpoint: "carport" };
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._ready) { this._build(); this._ready = true; }
    if (first) this._prefill();
    this._refresh();
  }

  getCardSize() { return 4; }

  _lang() {
    const raw = (this._cfg.language || this._hass?.locale?.language || this._hass?.language || "en").toLowerCase();
    if (LANGS[raw]) return raw;
    const short = raw.split("-")[0];
    return LANGS[short] ? short : "en";
  }
  _t(key) { return LANGS[this._lang()][key]; }

  _vehicleId() {
    const v = this._hass?.states[this._cfg.vehicle_select]?.attributes?.vehicle;
    return v && v.evccName ? v.evccName : null;
  }
  _planActive() { return this._hass?.states[this._cfg.plan_active]?.state === "on"; }

  _planDate() {
    const pt = this._hass?.states[this._cfg.plan_time]?.state;
    if (!pt || ["unknown", "unavailable", ""].includes(pt)) return null;
    const d = new Date(pt);
    return isNaN(d.getTime()) ? null : d;
  }

  _dayOptions() {
    const t = LANGS[this._lang()];
    const today = midnight(new Date());
    const out = [];
    for (let n = 0; n <= this._cfg.max_days; n++) {
      const d = new Date(today); d.setDate(today.getDate() + n);
      const suf = n === 0 ? t.today : n === 1 ? t.tomorrow : t.weekdays[(d.getDay() + 6) % 7];
      out.push({ value: fmtDate(d), label: `${d.getDate()} ${t.months[d.getMonth()]} (${suf})` });
    }
    return out;
  }

  _statusText() {
    if (!this._planActive()) return this._t("no_plan");
    const d = this._planDate();
    if (!d) return this._t("no_plan");
    const t = LANGS[this._lang()];
    const soc = parseInt(this._hass.states[this._cfg.plan_soc]?.state);
    const off = Math.round((midnight(d) - midnight(new Date())) / 86400000);
    const day = off === 0 ? t.status_today : off === 1 ? t.status_tomorrow : t.weekdays[(d.getDay() + 6) % 7];
    const socTxt = isNaN(soc) ? "" : ` → ${soc}%`;
    return `${day} ${d.getHours()}:${pad(d.getMinutes())}${socTxt}`;
  }

  _prefill() {
    const pd = this._planDate();
    let d;
    if (this._planActive() && pd) {
      d = pd;
      this._soc = parseInt(this._hass.states[this._cfg.plan_soc]?.state) || this._cfg.default_soc;
    } else {
      d = new Date();
      d.setDate(d.getDate() + this._cfg.default_day_offset);
      d.setHours(this._cfg.default_hour, 0, 0, 0);
      this._soc = this._cfg.default_soc;
    }
    const step = this._cfg.minute_step;
    d.setMinutes(Math.round(d.getMinutes() / step) * step % 60);
    this._date = d;
    this._fillInputs();
  }

  _dayShift(delta) {
    const today = midnight(new Date());
    let off = Math.round((midnight(this._date) - today) / 86400000) + delta;
    off = Math.max(0, Math.min(this._cfg.max_days, off));
    const nd = new Date(today); nd.setDate(today.getDate() + off);
    this._date.setFullYear(nd.getFullYear(), nd.getMonth(), nd.getDate());
    this._fillInputs();
  }

  _build() {
    this.attachShadow({ mode: "open" });
    this._days = this._dayOptions();
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --ctrl: color-mix(in srgb, var(--disabled-color) 20%, transparent);
          --ctrl-hover: color-mix(in srgb, var(--disabled-color) 30%, transparent);
          --ctrl-sel: color-mix(in srgb, var(--primary-text-color) 15%, transparent);
          --r: var(--ha-border-radius-md, 12px);
          --h: 46px;
          display: block;
        }
        * { box-sizing: border-box; }
        .card { display: flex; flex-direction: column; gap: 6px; padding: 8px; }

        .header { display: flex; align-items: center; gap: 12px; padding: 2px 2px 8px; }
        .ti { --tc: var(--state-inactive-color); width: 36px; height: 36px; flex: none; position: relative;
              border-radius: var(--ha-border-radius-pill, 18px);
              display: flex; align-items: center; justify-content: center; }
        .ti::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: var(--tc); opacity: .2; }
        .ti ha-icon { --mdc-icon-size: 24px; color: var(--tc); position: relative; }
        .header.active .ti { --tc: var(--state-binary_sensor-running-color, var(--amber-color, #ffa600)); }
        .info { display: flex; flex-direction: column; min-width: 0; }
        .primary { font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500);
                   line-height: 1.4; color: var(--primary-text-color); }
        .secondary { font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color);
                     line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .subhead { font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color);
                   font-weight: var(--ha-font-weight-medium, 500); padding: 6px 4px 2px; }

        .row { display: flex; gap: 8px; }
        .ctrl { display: flex; align-items: center; background: var(--ctrl); border-radius: var(--r);
                min-height: var(--h); }
        .stepper { flex: 1.7; padding: 0 2px; }
        .step { width: 42px; height: 42px; flex: none; border: none; background: transparent; cursor: pointer;
                color: var(--primary-text-color); display: flex; align-items: center; justify-content: center;
                border-radius: 10px; transition: background .15s ease; }
        .step:hover { background: var(--ctrl-hover); }
        .step:disabled { opacity: .3; cursor: default; }
        .step:disabled:hover { background: transparent; }
        .step ha-icon { --mdc-icon-size: 22px; }
        .stepval { flex: 1; text-align: center; color: var(--primary-text-color);
                   font-size: var(--ha-font-size-m, 14px); }
        .time { flex: 1; padding: 0 14px; }
        input[type=time] { background: transparent; border: none; outline: none; width: 100%; text-align: left;
                           color: var(--primary-text-color); font: inherit; font-size: var(--ha-font-size-m, 14px);
                           color-scheme: dark; padding: 0; margin: 0; }

        .pills { display: flex; gap: 6px; }
        .pill { flex: 1; min-height: var(--h); border: none; border-radius: var(--r); cursor: pointer;
                background: var(--ctrl); color: var(--primary-text-color); font: inherit;
                font-size: var(--ha-font-size-m, 14px); transition: background .15s ease; }
        .pill:hover { background: var(--ctrl-hover); }
        .pill.active { background: var(--ctrl-sel); font-weight: var(--ha-font-weight-medium, 500); }

        .actions { display: flex; gap: 8px; margin-top: 6px; }
        .btn { flex: 1; min-height: var(--h); border: none; border-radius: var(--r); cursor: pointer; font: inherit;
               font-size: var(--ha-font-size-m, 14px); font-weight: var(--ha-font-weight-medium, 500);
               background: var(--ctrl); color: var(--primary-text-color); transition: background .15s ease; }
        .btn:hover { background: var(--ctrl-hover); }
        .btn.danger { color: var(--error-color); background: color-mix(in srgb, var(--error-color) 12%, transparent); margin-top: 4px; }
        .btn.danger:hover { background: color-mix(in srgb, var(--error-color) 20%, transparent); }
        .btn[hidden] { display: none; }
      </style>
      <div class="card">
        <div class="header">
          <div class="ti"><ha-icon icon="mdi:battery-clock-outline"></ha-icon></div>
          <div class="info"><span class="primary">${this._cfg.title || this._t("title")}</span><span class="secondary" id="st"></span></div>
        </div>

        <div class="subhead">${this._t("departure")}</div>
        <div class="row">
          <div class="ctrl stepper">
            <button class="step" id="dayprev"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
            <span class="stepval" id="dayval"></span>
            <button class="step" id="daynext"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
          </div>
          <label class="ctrl time"><input id="time" type="time" step="${this._cfg.minute_step * 60}"></label>
        </div>

        <div class="subhead">${this._t("target")}</div>
        <div class="pills" id="soc"></div>

        <div class="actions">
          <button class="btn" id="save">${this._t("save")}</button>
          <button class="btn" id="cancel">${this._t("cancel")}</button>
        </div>
        <button class="btn danger" id="del" hidden>${this._t("delete")}</button>
      </div>`;

    const soc = this.shadowRoot.getElementById("soc");
    this._cfg.soc_options.forEach((s) => {
      const b = document.createElement("button");
      b.className = "pill"; b.dataset.soc = s; b.textContent = s + "%";
      b.addEventListener("click", () => { this._soc = s; this._refresh(); });
      soc.appendChild(b);
    });
    this.shadowRoot.getElementById("dayprev").addEventListener("click", () => this._dayShift(-1));
    this.shadowRoot.getElementById("daynext").addEventListener("click", () => this._dayShift(1));
    this.shadowRoot.getElementById("time").addEventListener("change", (e) => {
      const [h, mi] = e.target.value.split(":").map(Number);
      this._date.setHours(h, mi, 0, 0);
    });
    this.shadowRoot.getElementById("save").addEventListener("click", () => this._save());
    this.shadowRoot.getElementById("cancel").addEventListener("click", () => this._close());
    this.shadowRoot.getElementById("del").addEventListener("click", () => this._delete());
  }

  _fillInputs() {
    const cur = fmtDate(this._date);
    const opt = this._days.find((o) => o.value === cur);
    this.shadowRoot.getElementById("dayval").textContent = opt ? opt.label : cur;
    this.shadowRoot.getElementById("time").value = `${pad(this._date.getHours())}:${pad(this._date.getMinutes())}`;
    const off = Math.round((midnight(this._date) - midnight(new Date())) / 86400000);
    this.shadowRoot.getElementById("dayprev").disabled = off <= 0;
    this.shadowRoot.getElementById("daynext").disabled = off >= this._cfg.max_days;
  }

  _refresh() {
    if (!this._hass || !this._ready) return;
    const active = this._planActive();
    this.shadowRoot.querySelector(".header").classList.toggle("active", active);
    this.shadowRoot.getElementById("st").textContent = this._statusText();
    this.shadowRoot.querySelectorAll(".pill").forEach((b) =>
      b.classList.toggle("active", Number(b.dataset.soc) === this._soc));
    this.shadowRoot.getElementById("del").hidden = !active;
  }

  _close() {
    const ev = new Event("ll-custom", { bubbles: true, composed: true });
    ev.detail = { browser_mod: { service: "browser_mod.close_popup" } };
    this.dispatchEvent(ev);
  }
  _save() {
    const veh = this._vehicleId();
    if (!veh) return;
    this._hass.callService("evcc_intg", "set_vehicle_plan",
      { vehicle: veh, soc: this._soc, startdate: fmtFull(this._date) });
    this._close();
  }
  _delete() {
    const veh = this._vehicleId();
    if (veh) this._hass.callService("evcc_intg", "del_vehicle_plan", { vehicle: veh });
    this._close();
  }
}

customElements.define("evcc-plan-card", EvccPlanCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "evcc-plan-card",
  name: "EVCC Plan Card",
  description: "Set an EVCC departure charge plan (time + target SoC) via the ha-evcc integration.",
});

console.info(
  `%c EVCC-PLAN-CARD %c v${CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;"
);
