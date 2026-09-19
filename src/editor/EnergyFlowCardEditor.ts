import { CardConfig, ColorConfig, DeviceGroupConfig, PricingConfig, ResolvedConfig, normalizeConfig } from '../config/CardConfig';
import { hassLanguage, t } from '../helpers/i18n';
import type { ConnectionConfig } from '../models/Connection';
import { NodeConfig, advancedFieldsFor, fieldLabelKey, generateId } from '../models/Node';
import { html } from '../renderer/dom';
import type { Hass } from '../types/hass';
import { NODE_TYPES, NodeType, normalizeType, roleOf } from '../types/NodeType';

const SELECTABLE_TYPES = NODE_TYPES.filter((type) => type !== 'home');
const POWER_FIELDS = new Set(['power_entity', 'charge_power_entity', 'discharge_power_entity', 'production_entity', 'phase_l1_power_entity', 'phase_l2_power_entity', 'phase_l3_power_entity']);
const ICON_PRESETS: Array<{ value: string; key: string }> = [
  { value: '', key: 'icon_auto' },
  { value: 'mdi:solar-power', key: 'icon_solar' },
  { value: 'mdi:battery', key: 'icon_battery' },
  { value: 'mdi:heat-pump', key: 'icon_heat_pump' },
  { value: 'mdi:air-conditioner', key: 'icon_airco' },
  { value: 'mdi:ev-station', key: 'icon_ev' },
  { value: 'mdi:washing-machine', key: 'icon_washing_machine' },
  { value: 'mdi:dishwasher', key: 'icon_dishwasher' },
  { value: 'mdi:desktop-tower', key: 'icon_pc' },
  { value: 'mdi:server', key: 'icon_server' },
  { value: 'mdi:lightbulb', key: 'icon_light' },
  { value: 'mdi:pump', key: 'icon_pump' },
  { value: 'mdi:power-socket-eu', key: 'icon_socket' },
  { value: 'mdi:generator-portable', key: 'icon_backup' },
  { value: 'mdi:home-battery', key: 'icon_home_battery' },
  { value: 'mdi:water-boiler', key: 'icon_boiler' },
  { value: 'mdi:radiator', key: 'icon_radiator' },
  { value: 'mdi:fan', key: 'icon_fan' },
];
const CUSTOM_ICON = '__custom__';


const editorStyles = `
:host { display: block; color: var(--primary-text-color); }
.wizard { display: flex; flex-direction: column; gap: 16px; }
.tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--divider-color, #e0e0e0); }
.tab {
  flex: 1; min-width: 0; padding: 10px 6px; border: 0; background: none; cursor: pointer; font: inherit; color: var(--secondary-text-color);
  border-bottom: 3px solid transparent; margin-bottom: -1px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; line-height: 20px;
}
.tab[aria-selected="true"] { color: var(--primary-text-color); border-bottom-color: var(--primary-color, #03a9f4); font-weight: 600; }
.tab .n { display: inline-flex; flex: 0 0 20px; align-items: center; justify-content: center; width: 20px; height: 20px; line-height: 1; border-radius: 50%;
  font-size: 12px; background: var(--secondary-background-color, #eee); }
.tab[aria-selected="true"] .n { background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
.hint { margin: 0; font-size: 14px; color: var(--secondary-text-color); line-height: 1.4; }
.error { padding: 10px 12px; border-radius: 8px; font-size: 14px; background: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent); }
.device { border: 1px solid var(--divider-color, #e0e0e0); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; }
label.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--secondary-text-color); flex: 1; min-width: 130px; }
input[type="text"], input[type="number"], select {
  font: inherit; font-size: 14px; padding: 9px 10px; border-radius: 8px; box-sizing: border-box; width: 100%;
  border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color, #fff); color: var(--primary-text-color);
}
.color-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 8px; }
.color-field { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 9px; border: 1px solid var(--divider-color, #ddd); border-radius: 8px; font-size: 12px; }
.color-choice { display: flex; align-items: center; gap: 7px; min-width: 0; }
.color-swatch { width: 18px; height: 18px; border-radius: 50%; border: 1px solid color-mix(in srgb, var(--primary-text-color) 25%, transparent); flex: 0 0 auto; }
.color-field select { width: auto; min-width: 112px; padding: 6px 28px 6px 8px; font-size: 12px; }
.color-actions { display: flex; justify-content: flex-end; margin-top: 8px; }
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

type Step = 1 | 2 | 3 | 4;

/** JSON met gesorteerde sleutels: twee configuraties met dezelfde inhoud zijn dan altijd gelijk, ook bij een andere sleutelvolgorde. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/**
 * Wizard in vier stappen: 1 Apparaten, 2 Verbindingen, 3 Prijzen, 4 Voorbeeld.
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

  private get groups(): DeviceGroupConfig[] {
    if (!Array.isArray(this.config.groups)) this.config.groups = [];
    return this.config.groups;
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
    else if (this.step === 3) wizard.append(this.renderPricing());
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
    const labels = [t('ed_step_devices', this.uiLang), t('ed_step_connections', this.uiLang), t('ed_step_pricing', this.uiLang), t('ed_step_preview', this.uiLang)];
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
    nav.append(this.step > 1 ? back : html('span'), this.step < 4 ? next : html('span'));
    return nav;
  }

  private goTo(step: Step): void {
    if (step < 1 || step > 4) return;
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

    wrap.append(this.renderGroups());
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
      if (type === 'grid' && key === 'phase_l1_power_entity') advanced.append(html('p', { class: 'hint phase-hint' }, t('phase_l1_auto_hint', lang)));
    }
    advanced.append(this.iconPicker(node.icon, (value) => {
      if (value) node.icon = value;
      else delete node.icon;
      this.commit();
      this.render();
    }));

    const invert = html('input', { type: 'checkbox' });
    invert.checked = node.invert === true;
    invert.addEventListener('change', () => {
      if (invert.checked) node.invert = true;
      else delete node.invert;
      this.commit();
    });
    advanced.append(html('label', { class: 'check' }, invert, t('ed_invert', lang)));

    // Verbruikers kunnen direct aan Home, achter een backup of achter een andere verbruiker hangen.
    // Kandidaten die een lus zouden maken worden niet aangeboden.
    const parentCandidates = this.nodes.filter((candidate) => {
      if (candidate === node) return false;
      const candidateType = normalizeType(candidate.type);
      if (candidateType !== 'backup' && roleOf(candidateType ?? 'consumer') !== 'consumer') return false;
      return !this.wouldCreateParentLoop(node, candidate);
    });
    let parent: HTMLElement | undefined;
    if (roleOf(type) === 'consumer' && type !== 'backup') {
      const parentSelect = html('select');
      parentSelect.append(html('option', { value: 'home' }, t('home', lang)));
      for (const candidate of parentCandidates) {
        parentSelect.append(html('option', { value: candidate.id ?? '' }, candidate.name || candidate.id || ''));
      }
      const current = parentCandidates.find((candidate) =>
        !!node.connected_to && (candidate.id === node.connected_to || candidate.name?.toLowerCase() === node.connected_to.toLowerCase()),
      );
      parentSelect.value = current?.id ?? 'home';
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

  private iconPicker(current: string | undefined, onChange: (value: string) => void): HTMLElement {
    const lang = this.uiLang;
    const wrap = html('div', { class: 'stack' });
    const select = html('select');
    const presetValues = new Set(ICON_PRESETS.map((p) => p.value));
    for (const preset of ICON_PRESETS) {
      const option = html('option', { value: preset.value }, t(preset.key, lang));
      if ((current ?? '') === preset.value) option.selected = true;
      select.append(option);
    }
    const customOption = html('option', { value: CUSTOM_ICON }, t('icon_custom', lang));
    if (current && !presetValues.has(current)) customOption.selected = true;
    select.append(customOption);
    wrap.append(this.field(t('ed_icon', lang), select));

    if (current && !presetValues.has(current)) {
      const custom = html('input', { type: 'text', placeholder: 'mdi:…', autocomplete: 'off', spellcheck: 'false' });
      custom.value = current;
      custom.addEventListener('change', () => onChange(custom.value.trim()));
      wrap.append(this.field(t('ed_custom_icon', lang), custom));
    }

    select.addEventListener('change', () => {
      if (select.value === CUSTOM_ICON) {
        // Eerst alleen opnieuw tekenen; de gebruiker krijgt daarna het vrije mdi:-veld.
        if (!current || presetValues.has(current)) onChange('mdi:');
        return;
      }
      onChange(select.value);
    });
    return wrap;
  }

  private renderGroups(): HTMLElement {
    const lang = this.uiLang;
    const box = html('div', { class: 'stack' }, html('h3', {}, t('ed_groups', lang)), html('p', { class: 'hint' }, t('ed_groups_hint', lang)));
    this.groups.forEach((group, index) => box.append(this.renderGroup(group, index)));
    const add = html('button', { class: 'btn', type: 'button' }, `+ ${t('ed_add_group', lang)}`);
    add.addEventListener('click', () => {
      const name = `${t('ed_group', lang)} ${this.groups.length + 1}`;
      this.groups.push({ id: generateId(name, new Set(this.groups.map((g) => g.id ?? ''))), name, display: 'grouped', members: [] });
      this.commit();
      this.render();
    });
    box.append(add);
    return this.section('groups', t('ed_groups', lang), box);
  }

  private renderGroup(group: DeviceGroupConfig, index: number): HTMLElement {
    const lang = this.uiLang;
    const name = html('input', { type: 'text', autocomplete: 'off' });
    name.value = group.name ?? '';
    name.addEventListener('input', () => { group.name = name.value; });
    name.addEventListener('change', () => { group.name = name.value.trim(); this.commit(); });

    const display = html('select');
    display.append(
      html('option', { value: 'grouped' }, t('ed_grouped', lang)),
      html('option', { value: 'individual' }, t('ed_individual', lang)),
    );
    display.value = group.display === 'individual' ? 'individual' : 'grouped';
    display.addEventListener('change', () => { group.display = display.value as 'grouped' | 'individual'; this.commit(); this.render(); });

    const remove = html('button', { class: 'btn danger', type: 'button' }, t('ed_remove', lang));
    remove.addEventListener('click', () => { this.groups.splice(index, 1); if (!this.groups.length) delete this.config.groups; this.commit(); this.render(); });

    const members = html('div', { class: 'stack' });
    const selected = new Set(group.members ?? []);
    const candidates = this.nodes.filter((n) => normalizeType(n.type) !== 'home' && normalizeType(n.type) !== 'backup');
    for (const node of candidates) {
      const id = node.id ?? '';
      const cb = html('input', { type: 'checkbox' });
      cb.checked = selected.has(id) || (!!node.name && selected.has(node.name));
      cb.addEventListener('change', () => {
        const set = new Set((group.members ?? []).map(String));
        if (cb.checked) set.add(id); else { set.delete(id); if (node.name) set.delete(node.name); }
        group.members = [...set].filter(Boolean);
        this.commit();
      });
      members.append(html('label', { class: 'check' }, cb, node.name || id));
    }

    const icon = this.iconPicker(group.icon, (value) => { group.icon = value || undefined; this.commit(); this.render(); });
    return html(
      'div', { class: 'device' },
      html('div', { class: 'row' }, this.field(t('ed_group_name', lang), name), this.field(t('ed_group_display', lang), display)),
      this.field(t('ed_group_members', lang), members),
      icon,
      remove,
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

  /** Zou `node` onder `candidate` hangen een lus maken? */
  private wouldCreateParentLoop(node: NodeConfig, candidate: NodeConfig): boolean {
    const nodeId = node.id ?? '';
    const nodeName = node.name?.toLowerCase();
    const byRef = (ref: string): NodeConfig | undefined => {
      const lower = ref.toLowerCase();
      return this.nodes.find((n) => n.id === ref) ?? this.nodes.find((n) => n.name?.toLowerCase() === lower);
    };
    const seen = new Set<NodeConfig>();
    let current: NodeConfig | undefined = candidate;
    while (current && !seen.has(current)) {
      if (current === node || (!!nodeId && current.id === nodeId) || (!!nodeName && current.name?.toLowerCase() === nodeName)) return true;
      seen.add(current);
      current = current.connected_to ? byRef(current.connected_to) : undefined;
    }
    return false;
  }

  /** Hang een apparaat aan Home, een backup of een andere verbruiker, ook bij handmatige verbindingen. */
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
            const from = resolved.nodes.find((n) => n.id === c.from);
            const isIncomingParentLink = c.to === me.id && from && (from.role === 'home' || from.type === 'backup' || from.role === 'consumer');
            if (!isIncomingParentLink) keep.push(raw);
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
    const childIds: string[] = [];
    // Apparaten die achter deze node hingen, hangen daarna weer aan Home.
    for (const other of this.nodes) {
      if (other !== node && other.connected_to && (other.connected_to === node.id || other.connected_to === node.name)) {
        delete other.connected_to;
        if (other.id) childIds.push(other.id);
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
        for (const childId of childIds) keep.push({ from: 'home', to: childId });
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
    // Alleen gewone verbruikers kunnen een parent kiezen.
    if (roleOf(type) !== 'consumer' || type === 'backup') delete node.connected_to;
    // Als deze node geen verbruiker/backup meer is, mogen bestaande kinderen er niet achter blijven hangen.
    if (roleOf(type) !== 'consumer') {
      const childIds: string[] = [];
      for (const other of this.nodes) {
        if (other !== node && other.connected_to && (other.connected_to === node.id || other.connected_to === node.name)) {
          delete other.connected_to;
          if (other.id) childIds.push(other.id);
        }
      }
      if (this.config.connections && node.id && childIds.length) {
        this.config.connections = this.config.connections.filter((c) => !(c.from === node.id && childIds.includes(c.to)));
        for (const childId of childIds) this.config.connections.push({ from: 'home', to: childId });
      }
    }
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

  private pricingConfig(): PricingConfig {
    if (!this.config.pricing) {
      this.config.pricing = this.config.demo
        ? { mode: 'fixed', currency: 'EUR', import_price: 0.31, export_price: 0.09 }
        : { mode: 'none', currency: 'EUR' };
    }
    return this.config.pricing;
  }

  private renderPricing(): HTMLElement {
    const lang = this.uiLang;
    const pricing = this.pricingConfig();
    const wrap = html('div', { class: 'device' },
      html('h3', {}, t('ed_pricing', lang)),
      html('p', { class: 'hint' }, t('ed_pricing_hint', lang)),
    );

    const mode = html('select');
    for (const [value, key] of [
      ['none', 'pricing_none'], ['fixed', 'pricing_fixed'], ['entities', 'pricing_entities'],
    ] as const) {
      const option = html('option', { value }, t(key, lang));
      if ((pricing.mode ?? 'none') === value) option.selected = true;
      mode.append(option);
    }
    mode.addEventListener('change', () => {
      pricing.mode = mode.value as PricingConfig['mode'];
      this.commit();
      this.render();
    });
    wrap.append(this.field(t('pricing_mode', lang), mode));

    if ((pricing.mode ?? 'none') === 'none') return wrap;

    const currency = html('select');
    for (const value of ['EUR', 'GBP', 'USD']) {
      const option = html('option', { value }, value);
      if ((pricing.currency ?? 'EUR') === value) option.selected = true;
      currency.append(option);
    }
    currency.addEventListener('change', () => { pricing.currency = currency.value; this.commit(); });
    wrap.append(this.field(t('pricing_currency', lang), currency));

    if (pricing.mode === 'fixed') {
      const fixedField = (key: 'import_price' | 'export_price', label: string) => {
        const input = html('input', { type: 'number', min: '0', step: '0.0001', inputmode: 'decimal' });
        const current = pricing[key];
        if (typeof current === 'number') input.value = String(current);
        input.addEventListener('change', () => {
          const parsed = Number(input.value.replace(',', '.'));
          if (input.value.trim() && Number.isFinite(parsed) && parsed >= 0) pricing[key] = parsed;
          else delete pricing[key];
          this.commit();
        });
        return this.field(`${label} / kWh`, input);
      };
      wrap.append(html('div', { class: 'row' }, fixedField('import_price', t('pricing_import', lang)), fixedField('export_price', t('pricing_export', lang))));
      return wrap;
    }

    const importEntity = this.entityInput(pricing.import_price_entity, false, (v) => {
      if (v) pricing.import_price_entity = v; else delete pricing.import_price_entity; this.commit();
    });
    const exportEntity = this.entityInput(pricing.export_price_entity, false, (v) => {
      if (v) pricing.export_price_entity = v; else delete pricing.export_price_entity; this.commit();
    });
    wrap.append(this.field(t('pricing_import_entity', lang), importEntity), this.field(t('pricing_export_entity', lang), exportEntity));
    return wrap;
  }

  // ----- Stap 4: Voorbeeld --------------------------------------------------------------------

  private renderColors(): HTMLElement {
    const lang = this.uiLang;
    const defaults: Record<keyof ColorConfig, string> = {
      solar: '#f0a202', grid: '#5a78d1', battery: '#33b07a', home: '#727272', consumer: '#2fa4b8',
      ev: '#9a6fd6', backup: '#c95a8a', generator: '#cf6a4e', producer: '#b5a220',
    };
    const labels: Array<[keyof ColorConfig, string]> = [
      ['solar', 'color_solar'], ['grid', 'color_grid'], ['battery', 'color_battery'], ['home', 'color_home'],
      ['consumer', 'color_consumer'], ['ev', 'color_ev'], ['backup', 'color_backup'], ['generator', 'color_generator'], ['producer', 'color_producer'],
    ];
    const isNl = lang === 'nl';
    const presets = [
      ['#ef5350', isNl ? 'Rood' : 'Red'],
      ['#ec407a', isNl ? 'Roze' : 'Pink'],
      ['#ab47bc', isNl ? 'Paars' : 'Purple'],
      ['#7e57c2', isNl ? 'Violet' : 'Violet'],
      ['#5c6bc0', isNl ? 'Indigo' : 'Indigo'],
      ['#42a5f5', isNl ? 'Blauw' : 'Blue'],
      ['#29b6f6', isNl ? 'Lichtblauw' : 'Light blue'],
      ['#26c6da', isNl ? 'Cyaan' : 'Cyan'],
      ['#26a69a', isNl ? 'Turkoois' : 'Teal'],
      ['#66bb6a', isNl ? 'Groen' : 'Green'],
      ['#9ccc65', isNl ? 'Lichtgroen' : 'Light green'],
      ['#d4e157', isNl ? 'Limoen' : 'Lime'],
      ['#ffca28', isNl ? 'Geel' : 'Yellow'],
      ['#ffa726', isNl ? 'Oranje' : 'Orange'],
      ['#8d6e63', isNl ? 'Bruin' : 'Brown'],
      ['#78909c', isNl ? 'Blauwgrijs' : 'Blue grey'],
      ['#9e9e9e', isNl ? 'Grijs' : 'Grey'],
    ] as const;
    const grid = html('div', { class: 'color-grid' });
    for (const [key, labelKey] of labels) {
      const current = this.config.colors?.[key];
      const selected = !current || current.toLowerCase() === defaults[key].toLowerCase() ? '__default__' : current;
      const select = html('select', { 'aria-label': t(labelKey, lang) }) as HTMLSelectElement;
      select.append(html('option', { value: '__default__' }, isNl ? 'Standaard' : 'Default'));
      for (const [value, name] of presets) select.append(html('option', { value }, name));
      if (current && current !== defaults[key] && !presets.some(([value]) => value.toLowerCase() === current.toLowerCase())) {
        select.append(html('option', { value: current }, isNl ? 'Bestaande aangepaste kleur' : 'Existing custom color'));
      }
      select.value = selected;
      const swatch = html('span', { class: 'color-swatch', style: `background:${current ?? defaults[key]}` });
      const updateSwatch = () => {
        const value = select.value === '__default__' ? defaults[key] : select.value;
        swatch.setAttribute('style', `background:${value}`);
      };
      select.addEventListener('change', () => {
        if (select.value === '__default__') {
          if (this.config.colors) {
            delete this.config.colors[key];
            if (Object.keys(this.config.colors).length === 0) delete this.config.colors;
          }
        } else {
          if (!this.config.colors) this.config.colors = {};
          this.config.colors[key] = select.value;
        }
        updateSwatch();
        this.commit();
      });
      grid.append(html('label', { class: 'color-field' },
        html('span', {}, t(labelKey, lang)),
        html('span', { class: 'color-choice' }, swatch, select),
      ));
    }
    const reset = html('button', { class: 'btn', type: 'button' }, t('colors_reset', lang));
    reset.addEventListener('click', () => { delete this.config.colors; this.commit(); this.render(); });
    return html('details', {},
      html('summary', {}, t('ed_colors', lang)),
      html('p', { class: 'hint' }, t('ed_colors_hint', lang)),
      grid,
      html('div', { class: 'color-actions' }, reset),
    );
  }

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
      this.renderColors(),
      card,
      html('label', { class: 'check' }, demo, t('ed_demo', lang)),
    );
  }

  private errorBox(message: string): HTMLElement {
    return html('div', { class: 'error' }, `${t('ed_fix_first', this.uiLang)} ${message}`);
  }
}
