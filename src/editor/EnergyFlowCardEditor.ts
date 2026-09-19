import { CardConfig, ResolvedConfig, normalizeConfig } from '../config/CardConfig';
import { hassLanguage, t } from '../helpers/i18n';
import type { ConnectionConfig } from '../models/Connection';
import { NodeConfig, advancedFieldsFor, fieldLabelKey, generateId } from '../models/Node';
import { html } from '../renderer/dom';
import type { Hass } from '../types/hass';
import { NODE_TYPES, NodeType, normalizeType, roleOf } from '../types/NodeType';

const SELECTABLE_TYPES = NODE_TYPES.filter((type) => type !== 'home');
const POWER_FIELDS = new Set(['power_entity', 'charge_power_entity', 'discharge_power_entity', 'production_entity']);

const editorStyles = `
:host { display: block; color: var(--primary-text-color); }
.wizard { display: flex; flex-direction: column; gap: 16px; }
.tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--divider-color, #e0e0e0); }
.tab {
  flex: 1; padding: 10px 6px; border: 0; background: none; cursor: pointer; font: inherit; color: var(--secondary-text-color);
  border-bottom: 3px solid transparent; margin-bottom: -1px;
}
.tab[aria-selected="true"] { color: var(--primary-text-color); border-bottom-color: var(--primary-color, #03a9f4); font-weight: 600; }
.tab .n { display: inline-block; width: 20px; height: 20px; line-height: 20px; border-radius: 50%; margin-right: 6px;
  font-size: 12px; background: var(--secondary-background-color, #eee); }
.tab[aria-selected="true"] .n { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
.hint { margin: 0; font-size: 14px; color: var(--secondary-text-color); line-height: 1.4; }
.error { padding: 10px 12px; border-radius: 8px; font-size: 14px; background: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent); }
.device { border: 1px solid var(--divider-color, #e0e0e0); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
label.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--secondary-text-color); flex: 1; min-width: 130px; }
input[type="text"], select {
  font: inherit; font-size: 14px; padding: 9px 10px; border-radius: 8px; box-sizing: border-box; width: 100%;
  border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color, #fff); color: var(--primary-text-color);
}
ha-entity-picker { width: 100%; }
input:focus-visible, select:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 1px; }
button.btn {
  font: inherit; font-size: 14px; padding: 9px 14px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--divider-color, #ccc); background: transparent; color: var(--primary-text-color);
}
button.btn.primary { background: var(--primary-color, #03a9f4); border-color: transparent; color: var(--text-primary-color, #fff); }
button.btn.danger { color: var(--error-color, #db4437); }
details > summary { cursor: pointer; font-size: 13px; color: var(--secondary-text-color); padding: 2px 0; }
details[open] > summary { margin-bottom: 8px; }
.stack { display: flex; flex-direction: column; gap: 8px; }
.check { display: flex; align-items: center; gap: 10px; font-size: 14px; padding: 6px 0; }
.check input { width: 18px; height: 18px; }
h3 { margin: 0; font-size: 14px; font-weight: 600; }
.nav { display: flex; justify-content: space-between; gap: 8px; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.list li { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 14px; }
`;

type Step = 1 | 2 | 3;

/** JSON met gesorteerde sleutels: twee configuraties met dezelfde inhoud zijn dan altijd gelijk, ook bij een andere sleutelvolgorde. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/**
 * Wizard in drie stappen: 1 Apparaten, 2 Verbindingen, 3 Voorbeeld.
 * De wizard schrijft gewone kaart-YAML (inclusief gegenereerde ids en connections);
 * wie liever direct YAML schrijft, kan de wizard gewoon overslaan.
 */
export class EnergyFlowCardEditor extends HTMLElement {
  private config: CardConfig = { type: 'custom:energy-flow-card', nodes: [] };
  private step: Step = 1;
  private _hass?: Hass;
  private lastEmitted = '';
  /** Welke uitklapsecties ("Geavanceerd") openstaan; overleeft het opnieuw tekenen van de editor. */
  private openSections = new Set<string>();
  private preview?: HTMLElement & { hass?: Hass };

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  setConfig(config: CardConfig): void {
    const incoming = stable(config);
    // Echo van onze eigen wijziging: niet opnieuw tekenen (focus en open keuzelijsten blijven behouden).
    if (incoming === this.lastEmitted || incoming === stable(this.config)) return;
    this.config = structuredClone(config);
    if (!Array.isArray(this.config.nodes)) this.config.nodes = [];
    this.ensureIds();
    this.render();
  }

  set hass(hass: Hass) {
    this._hass = hass;
    this.applyHassToPickers();
    if (this.preview) this.preview.hass = hass;
  }

  private get uiLang(): string | undefined {
    return hassLanguage(this._hass);
  }

  // ----- Config bijwerken ---------------------------------------------------------------------

  private get nodes(): NodeConfig[] {
    if (!Array.isArray(this.config.nodes)) this.config.nodes = [];
    return this.config.nodes;
  }

  private ensureIds(): void {
    const taken = new Set<string>(['home']);
    for (const n of this.nodes) if (typeof n.id === 'string' && n.id.trim()) taken.add(n.id.trim());
    for (const n of this.nodes) {
      if (normalizeType(n.type) === 'home' || (typeof n.id === 'string' && n.id.trim())) continue;
      n.id = generateId(n.name || String(n.type), taken);
      taken.add(n.id);
    }
  }

  private commit(): void {
    this.ensureIds();
    this.lastEmitted = stable(this.config);
    // Een kopie, geen verwijzing naar ons eigen (steeds aangepaste) object: Home Assistant herkent een wijziging
    // alleen aan een nieuw object. Anders komen na de eerste wijziging voorbeeld en opslaan niet meer mee.
    this.dispatchEvent(
      new CustomEvent('config-changed', { detail: { config: structuredClone(this.config) }, bubbles: true, composed: true }),
    );
  }

  private resolve(): ResolvedConfig | string {
    try {
      return normalizeConfig(this.config);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  // ----- Opbouw -------------------------------------------------------------------------------

  private render(): void {
    const wizard = html('div', { class: 'wizard' }, this.renderTabs());
    if (this.step === 1) wizard.append(this.renderDevices());
    else if (this.step === 2) wizard.append(this.renderConnections());
    else wizard.append(this.renderPreview());
    wizard.append(this.renderNav());

    this.shadowRoot!.replaceChildren(html('style', {}, editorStyles), wizard);
    this.applyHassToPickers();
  }

  /** Geeft alle Home Assistant entity-pickers het actuele hass-object zonder de editor opnieuw te tekenen. */
  private applyHassToPickers(): void {
    if (!this._hass) return;
    this.shadowRoot?.querySelectorAll('ha-entity-picker').forEach((el) => {
      (el as HTMLElement & { hass?: Hass }).hass = this._hass;
    });
  }

  private renderTabs(): HTMLElement {
    const labels = [t('ed_step_devices', this.uiLang), t('ed_step_connections', this.uiLang), t('ed_step_preview', this.uiLang)];
    const tabs = html('div', { class: 'tabs', role: 'tablist' });
    labels.forEach((label, i) => {
      const step = (i + 1) as Step;
      const tab = html('button', { class: 'tab', role: 'tab', 'aria-selected': String(this.step === step), type: 'button' }, html('span', { class: 'n' }, String(step)), label);
      tab.addEventListener('click', () => this.goTo(step));
      tabs.append(tab);
    });
    return tabs;
  }

  private renderNav(): HTMLElement {
    const nav = html('div', { class: 'nav' });
    const back = html('button', { class: 'btn', type: 'button' }, t('ed_back', this.uiLang));
    back.addEventListener('click', () => this.goTo((this.step - 1) as Step));
    const next = html('button', { class: 'btn primary', type: 'button' }, t('ed_next', this.uiLang));
    next.addEventListener('click', () => this.goTo((this.step + 1) as Step));
    nav.append(this.step > 1 ? back : html('span'), this.step < 3 ? next : html('span'));
    return nav;
  }

  private goTo(step: Step): void {
    if (step < 1 || step > 3) return;
    this.step = step;
    this.render();
  }

  private entityInput(value: string | undefined, powerOnly: boolean, onChange: (v: string) => void): HTMLElement {
    // Gebruik de native Home Assistant entity-picker. Die blijft open tijdens zoeken/selecteren en
    // gedraagt zich hetzelfde als selectors in automatiseringen en andere HA-editors.
    const picker = document.createElement('ha-entity-picker') as HTMLElement & {
      hass?: Hass;
      value?: string;
      includeDomains?: string[];
      allowCustomEntity?: boolean;
    };
    picker.value = value ?? '';
    picker.includeDomains = powerOnly ? ['sensor', 'number', 'input_number'] : ['sensor', 'number', 'input_number'];
    picker.allowCustomEntity = true;
    if (this._hass) picker.hass = this._hass;
    picker.addEventListener('value-changed', (ev: Event) => {
      const detail = (ev as CustomEvent<{ value?: string }>).detail;
      onChange((detail?.value ?? '').trim());
    });
    return picker;
  }

  /** Een uitklapsectie die open blijft als de editor opnieuw getekend wordt (bijvoorbeeld na een typewijziging). */
  private section(key: string, summary: string, ...content: HTMLElement[]): HTMLElement {
    const details = html('details', {}, html('summary', {}, summary), ...content);
    details.open = this.openSections.has(key);
    details.addEventListener('toggle', () => {
      if (details.open) this.openSections.add(key);
      else this.openSections.delete(key);
    });
    return details;
  }

  private field(label: string, control: HTMLElement): HTMLElement {
    return html('label', { class: 'field' }, label, control);
  }

  private setOrDelete(node: NodeConfig, key: keyof NodeConfig, value: string): void {
    if (value) (node as unknown as Record<string, unknown>)[key] = value;
    else delete node[key];
    this.commit();
  }

  // ----- Stap 1: Apparaten --------------------------------------------------------------------

  private renderDevices(): HTMLElement {
    const lang = this.uiLang;
    const wrap = html('div', { class: 'stack' }, html('p', { class: 'hint' }, t('ed_home_auto', lang)));

    const homePower = this.entityInput(this.config.home_power_entity, true, (v) => {
      if (v) this.config.home_power_entity = v;
      else delete this.config.home_power_entity;
      this.commit();
    });
    wrap.append(this.field(t('ed_home_entity', lang), homePower));

    this.nodes.forEach((node) => {
      if (normalizeType(node.type) === 'home') return;
      wrap.append(this.renderDevice(node));
    });

    const add = html('button', { class: 'btn primary', type: 'button' }, `+ ${t('ed_add_device', lang)}`);
    add.addEventListener('click', () => this.addDevice());
    wrap.append(add);

    return wrap;
  }

  private renderDevice(node: NodeConfig): HTMLElement {
    const lang = this.uiLang;
    const type = normalizeType(node.type) ?? 'consumer';

    const name = html('input', { type: 'text', autocomplete: 'off' });
    name.value = node.name ?? '';
    name.addEventListener('input', () => {
      node.name = name.value;
    });
    // Config pas doorgeven als het veld klaar is. Zo kan Home Assistant de editor niet na de eerste letter vervangen.
    name.addEventListener('change', () => {
      node.name = name.value.trim();
      this.commit();
      if (type === 'backup') this.render();
    });

    const select = html('select');
    for (const option of SELECTABLE_TYPES) {
      const el = html('option', { value: option }, t(`type_${option}`, lang));
      if (option === type) el.selected = true;
      select.append(el);
    }
    select.addEventListener('change', () => this.changeType(node, select.value as NodeType));

    const remove = html('button', { class: 'btn danger', type: 'button', 'aria-label': t('ed_remove', lang) }, t('ed_remove', lang));
    remove.addEventListener('click', () => this.removeDevice(node));

    const power = this.entityInput(node.power_entity, true, (v) => this.setOrDelete(node, 'power_entity', v));

    const advanced = html('div', { class: 'stack' });
    for (const key of advancedFieldsFor(type)) {
      const input = this.entityInput(node[key] as string | undefined, POWER_FIELDS.has(key), (v) => this.setOrDelete(node, key, v));
      advanced.append(this.field(t(fieldLabelKey(key, type), lang), input));
    }
    const icon = html('input', { type: 'text', placeholder: 'mdi:…', autocomplete: 'off', spellcheck: 'false' });
    icon.value = node.icon ?? '';
    icon.addEventListener('input', () => {
      if (icon.value.trim()) node.icon = icon.value.trim();
      else delete node.icon;
    });
    icon.addEventListener('change', () => this.setOrDelete(node, 'icon', icon.value.trim()));
    advanced.append(this.field(t('ed_icon', lang), icon));

    const invert = html('input', { type: 'checkbox' });
    invert.checked = node.invert === true;
    invert.addEventListener('change', () => {
      if (invert.checked) node.invert = true;
      else delete node.invert;
      this.commit();
    });
    advanced.append(html('label', { class: 'check' }, invert, t('ed_invert', lang)));

    // Achter een backup kunnen bepaalde verbruikers hangen: dan lopen die via de backup in plaats van direct via Home.
    const backups = this.nodes.filter((n) => normalizeType(n.type) === 'backup' && n !== node);
    let parent: HTMLElement | undefined;
    if (backups.length > 0 && roleOf(type) === 'consumer' && type !== 'backup') {
      const parentSelect = html('select');
      parentSelect.append(html('option', { value: 'home' }, t('home', lang)));
      for (const b of backups) parentSelect.append(html('option', { value: b.id ?? '' }, b.name || b.id || ''));
      parentSelect.value = backups.some((b) => b.id === node.connected_to) ? (node.connected_to as string) : 'home';
      parentSelect.addEventListener('change', () => this.setParent(node, parentSelect.value));
      parent = this.field(t('ed_connected_to', lang), parentSelect);
    }

    return html(
      'div',
      { class: 'device' },
      html('div', { class: 'row' }, this.field(t('ed_name', lang), name), this.field(t('ed_type', lang), select)),
      ...(parent ? [html('div', { class: 'row' }, parent)] : []),
      html('div', { class: 'row' }, this.field(t('ed_power_entity', lang), power), remove),
      this.section(`advanced:${node.id ?? ''}`, t('ed_advanced', lang), advanced),
    );
  }

  private addDevice(): void {
    const lang = this.uiLang;
    const taken = new Set<string>(['home', ...this.nodes.map((n) => n.id ?? '')]);
    const name = t('type_consumer', lang);
    const node: NodeConfig = { id: generateId(name, taken), name, type: 'consumer' };
    this.nodes.push(node);
    // Bestaat er al een handmatige lijst met verbindingen, dan sluit een nieuw apparaat automatisch aan op Home.
    if (this.config.connections) this.config.connections.push(this.homeConnection(node.id!, 'consumer'));
    this.commit();
    this.render();
    this.focusLastDevice();
  }

  /** Na "apparaat toevoegen": scrol naar het nieuwe apparaat en zet de cursor in het naamveld. */
  private focusLastDevice(): void {
    const devices = this.shadowRoot?.querySelectorAll('.device');
    const last = devices?.[devices.length - 1];
    const name = last?.querySelector<HTMLInputElement>('input[type="text"]');
    if (!last || !name) return;
    name.focus();
    name.select();
    last.scrollIntoView({ block: 'nearest' });
  }

  /** Hang een apparaat aan Home of aan een backup, ook in een handmatige lijst met verbindingen. */
  private setParent(node: NodeConfig, parentId: string): void {
    if (parentId === 'home') delete node.connected_to;
    else node.connected_to = parentId;

    if (this.config.connections) {
      const resolved = this.resolve();
      if (typeof resolved !== 'string') {
        const me = resolved.nodes.find((n) => n.config === node);
        const home = resolved.nodes.find((n) => n.role === 'home');
        const parent = parentId === 'home' ? home : resolved.nodes.find((n) => n.id === parentId);
        if (me && parent) {
          const keep: ConnectionConfig[] = [];
          resolved.connections.forEach((c, i) => {
            const raw = this.config.connections![i];
            if (!raw) return;
            const otherId = c.from === me.id ? c.to : c.to === me.id ? c.from : null;
            const other = otherId ? resolved.nodes.find((n) => n.id === otherId) : undefined;
            const isParentLink = other && (other.role === 'home' || other.type === 'backup');
            if (!isParentLink) keep.push(raw);
          });
          keep.push({ from: parent.id, to: me.id });
          this.config.connections = keep;
        }
      }
    }
    this.commit();
    this.render();
  }

  private removeDevice(node: NodeConfig): void {
    const index = this.nodes.indexOf(node);
    if (index < 0) return;
    // Apparaten die achter deze backup hingen, hangen daarna weer aan Home.
    for (const other of this.nodes) {
      if (other !== node && other.connected_to && (other.connected_to === node.id || other.connected_to === node.name)) {
        delete other.connected_to;
      }
    }
    const resolved = this.resolve();
    if (typeof resolved !== 'string' && this.config.connections) {
      const id = resolved.nodes.find((n) => n.config === node)?.id;
      if (id) {
        const keep: ConnectionConfig[] = [];
        resolved.connections.forEach((c, i) => {
          if (c.from !== id && c.to !== id && this.config.connections![i]) keep.push(this.config.connections![i]!);
        });
        this.config.connections = keep;
      }
    }
    this.nodes.splice(index, 1);
    this.commit();
    this.render();
  }

  private changeType(node: NodeConfig, type: NodeType): void {
    const previousRole = roleOf(normalizeType(node.type) ?? 'consumer');
    node.type = type;
    // Alleen gewone apparaten kunnen achter een backup hangen.
    if (roleOf(type) !== 'consumer' || type === 'backup') delete node.connected_to;
    // Verbruikers ontvangen van Home, bronnen sturen naar Home: draai bestaande Home-verbindingen indien nodig om.
    const resolved = this.resolve();
    if (previousRole !== roleOf(type) && typeof resolved !== 'string' && this.config.connections) {
      const me = resolved.nodes.find((n) => n.config === node);
      const home = resolved.nodes.find((n) => n.role === 'home');
      if (me && home) {
        resolved.connections.forEach((c, i) => {
          const raw = this.config.connections![i];
          if (!raw || !((c.from === me.id && c.to === home.id) || (c.from === home.id && c.to === me.id))) return;
          Object.assign(raw, this.homeConnection(me.id, type));
        });
      }
    }
    this.commit();
    this.render();
    // Het opnieuw tekenen haalt de focus weg; zet die terug op het keuzemenu van dit apparaat.
    const devices = [...(this.shadowRoot?.querySelectorAll('.device') ?? [])];
    const index = this.nodes.filter((n) => normalizeType(n.type) !== 'home').indexOf(node);
    devices[index]?.querySelector('select')?.focus();
  }

  /** Verbinding tussen een node en Home in de natuurlijke richting voor dat type. */
  private homeConnection(nodeId: string, type: NodeType): ConnectionConfig {
    return roleOf(type) === 'consumer' ? { from: 'home', to: nodeId } : { from: nodeId, to: 'home' };
  }

  // ----- Stap 2: Verbindingen -----------------------------------------------------------------

  private renderConnections(): HTMLElement {
    const lang = this.uiLang;
    const resolved = this.resolve();
    if (typeof resolved === 'string') return this.errorBox(resolved);
    const devices = resolved.nodes.filter((n) => n.role !== 'home');
    if (devices.length === 0) return html('p', { class: 'hint' }, t('ed_add_first', lang));
    const home = resolved.nodes.find((n) => n.role === 'home')!;
    const nameOf = (id: string) => resolved.nodes.find((n) => n.id === id)?.name ?? (id === home.id ? t('home', lang) : id);
    const linked = (a: string, b: string) => resolved.connections.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));

    const wrap = html('div', { class: 'stack' }, html('h3', {}, t('ed_connected_home', lang)));
    for (const device of devices) {
      const box = html('input', { type: 'checkbox' });
      box.checked = linked(device.id, home.id);
      box.addEventListener('change', () => this.toggleHomeLink(device.id, box.checked));
      wrap.append(html('label', { class: 'check' }, box, nameOf(device.id)));
    }

    wrap.append(html('h3', {}, t('ed_other_connections', lang)));
    const list = html('ul', { class: 'list' });
    resolved.connections.forEach((c, index) => {
      if (c.from === home.id || c.to === home.id) return;
      const rm = html('button', { class: 'btn danger', type: 'button' }, t('ed_remove', lang));
      rm.addEventListener('click', () => this.removeConnection(index));
      list.append(html('li', {}, `${nameOf(c.from)} → ${nameOf(c.to)}`, rm));
    });
    wrap.append(list.children.length ? list : html('p', { class: 'hint' }, t('ed_none_yet', lang)));

    const options = (select: HTMLSelectElement) => {
      for (const d of devices) select.append(html('option', { value: d.id }, nameOf(d.id)));
      return select;
    };
    const from = options(html('select'));
    const to = options(html('select'));
    if (devices.length > 1) to.selectedIndex = 1;
    const add = html('button', { class: 'btn', type: 'button' }, t('ed_add_connection', lang));
    add.addEventListener('click', () => this.addConnection(from.value, to.value));
    wrap.append(html('div', { class: 'row' }, this.field(t('ed_from', lang), from), this.field(t('ed_to', lang), to), add));
    return wrap;
  }

  /** Zet de handmatige lijst met verbindingen klaar (afgeleid van de standaardverbindingen als hij nog niet bestaat). */
  private explicitConnections(resolved: ResolvedConfig): ConnectionConfig[] {
    if (!this.config.connections) this.config.connections = resolved.connections.map((c) => ({ from: c.from, to: c.to }));
    return this.config.connections;
  }

  private toggleHomeLink(nodeId: string, on: boolean): void {
    const resolved = this.resolve();
    if (typeof resolved === 'string') return;
    const home = resolved.nodes.find((n) => n.role === 'home')!;
    const node = resolved.nodes.find((n) => n.id === nodeId)!;
    const list = this.explicitConnections(resolved);
    const isPair = (c: { from: string; to: string }) => (c.from === nodeId && c.to === home.id) || (c.from === home.id && c.to === nodeId);
    if (on) {
      if (!resolved.connections.some(isPair)) list.push(this.homeConnection(nodeId, node.type));
    } else {
      for (let i = resolved.connections.length - 1; i >= 0; i--) if (isPair(resolved.connections[i]!)) list.splice(i, 1);
    }
    this.commit();
    this.render();
  }

  private addConnection(from: string, to: string): void {
    const resolved = this.resolve();
    if (typeof resolved === 'string' || from === to) return;
    if (resolved.connections.some((c) => (c.from === from && c.to === to) || (c.from === to && c.to === from))) return;
    this.explicitConnections(resolved).push({ from, to });
    this.commit();
    this.render();
  }

  private removeConnection(index: number): void {
    const resolved = this.resolve();
    if (typeof resolved === 'string') return;
    this.explicitConnections(resolved).splice(index, 1);
    this.commit();
    this.render();
  }

  // ----- Stap 3: Voorbeeld --------------------------------------------------------------------

  private renderPreview(): HTMLElement {
    const lang = this.uiLang;
    const resolved = this.resolve();
    if (typeof resolved === 'string') return this.errorBox(resolved);
    if (resolved.nodes.length <= 1 && !resolved.demo) return html('p', { class: 'hint' }, t('ed_add_first', lang));

    const demo = html('input', { type: 'checkbox' });
    demo.checked = this.config.demo === true;
    demo.addEventListener('change', () => {
      if (demo.checked) this.config.demo = true;
      else delete this.config.demo;
      this.commit();
      this.render();
    });

    const layoutSelect = html('select');
    for (const [value, key] of [
      ['flow', 'ed_layout_flow'],
      ['circle', 'ed_layout_circle'],
      ['straight', 'ed_layout_straight'],
    ] as const) {
      const option = html('option', { value }, t(key, lang));
      const current = this.config.layout?.mode === 'circle' ? 'circle' : this.config.layout?.mode === 'straight' ? 'straight' : 'flow';
      if (current === value) option.selected = true;
      layoutSelect.append(option);
    }
    layoutSelect.addEventListener('change', () => {
      const layout = { ...(this.config.layout ?? {}) };
      if (layoutSelect.value === 'circle') layout.mode = 'circle';
      else if (layoutSelect.value === 'straight') layout.mode = 'straight';
      else layout.mode = 'flow';
      if (Object.keys(layout).length > 0) this.config.layout = layout;
      else delete this.config.layout;
      this.commit();
      this.render();
    });

    const card = document.createElement('energy-flow-card') as HTMLElement & { hass?: Hass; setConfig(c: unknown): void };
    try {
      card.setConfig(this.config);
    } catch (err) {
      return this.errorBox(err instanceof Error ? err.message : String(err));
    }
    if (this._hass) card.hass = this._hass;
    this.preview = card;

    return html(
      'div',
      { class: 'stack' },
      html('p', { class: 'hint' }, t('ed_preview_hint', lang)),
      this.field(t('ed_layout', lang), layoutSelect),
      card,
      html('label', { class: 'check' }, demo, t('ed_demo', lang)),
    );
  }

  private errorBox(message: string): HTMLElement {
    return html('div', { class: 'error' }, `${t('ed_fix_first', this.uiLang)} ${message}`);
  }
}
