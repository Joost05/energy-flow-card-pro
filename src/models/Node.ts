import type { NodeRole, NodeType } from '../types/NodeType';
import { roleOf } from '../types/NodeType';

/** Extra entiteiten die alleen in de detailweergave getoond worden. */
export interface ExtraEntity {
  entity: string;
  name?: string;
}

/** Geavanceerde, type-specifieke opties (nooit nodig voor de basiskaart). */
export type AdvancedField =
  | 'production_entity'
  | 'soc_entity'
  | 'charge_power_entity'
  | 'discharge_power_entity'
  | 'voltage_entity'
  | 'current_entity'
  | 'temperature_entity'
  | 'inverter_temperature_entity'
  | 'energy_today_entity'
  | 'energy_total_entity'
  | 'energy_import_entity'
  | 'energy_export_entity'
  | 'phase_l1_power_entity'
  | 'phase_l2_power_entity'
  | 'phase_l3_power_entity'
  | 'phase_l1_voltage_entity'
  | 'phase_l2_voltage_entity'
  | 'phase_l3_voltage_entity'
  | 'phase_l1_current_entity'
  | 'phase_l2_current_entity'
  | 'phase_l3_current_entity'
  | 'energy_charged_entity'
  | 'energy_discharged_entity';

/** Een node zoals de gebruiker die in YAML schrijft. Voor een gewone node zijn alleen naam, type en power_entity nodig. */
export interface NodeConfig extends Partial<Record<AdvancedField, string>> {
  /** Optioneel: de kaart genereert zelf een uniek id. */
  id?: string;
  name?: string;
  type: string;
  icon?: string;
  power_entity?: string;
  /** Draait het teken van de vermogenssensor om. */
  invert?: boolean;
  /** Alleen voor verbruikers: hangt dit apparaat achter een backup (naam of id)? Zonder deze optie hangt het aan Home. */
  connected_to?: string;
  entities?: ExtraEntity[];
  /** Interne markering voor een virtuele groep-node. */
  group_members?: string[];
}


/** Een gevalideerde node met een uniek id: "wat is het?" */
export interface EnergyNode {
  id: string;
  name?: string;
  type: NodeType;
  role: NodeRole;
  icon?: string;
  invert: boolean;
  config: NodeConfig;
  /** Virtuele groep-node; bevat ids van de onderliggende apparaten. */
  groupMembers?: string[];
}


export function createNode(config: NodeConfig, type: NodeType, id: string): EnergyNode {
  return {
    id,
    name: config.name?.trim() || undefined,
    type,
    role: roleOf(type),
    icon: config.icon?.trim() || undefined,
    invert: config.invert === true,
    config,
    groupMembers: Array.isArray(config.group_members) ? [...config.group_members] : undefined,
  };
}

/** Maakt uit een naam een uniek id ("Laadpaal" → "laadpaal", daarna "laadpaal_2"). */
export function generateId(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'node';
  if (!taken.has(base)) return base;
  let counter = 2;
  while (taken.has(`${base}_${counter}`)) counter++;
  return `${base}_${counter}`;
}

/** Welke geavanceerde opties bij welk node-type horen. */
export function advancedFieldsFor(type: NodeType): AdvancedField[] {
  switch (type) {
    case 'battery':
      return [
        'soc_entity',
        'charge_power_entity',
        'discharge_power_entity',
        'voltage_entity',
        'current_entity',
        'temperature_entity',
        'energy_charged_entity',
        'energy_discharged_entity',
      ];
    case 'solar':
    case 'producer':
      return ['production_entity', 'energy_today_entity', 'energy_total_entity', 'inverter_temperature_entity'];
    case 'grid':
      return [
        'energy_import_entity',
        'energy_export_entity',
        'phase_l1_power_entity',
        'phase_l2_power_entity',
        'phase_l3_power_entity',
        'phase_l1_voltage_entity',
        'phase_l2_voltage_entity',
        'phase_l3_voltage_entity',
        'phase_l1_current_entity',
        'phase_l2_current_entity',
        'phase_l3_current_entity',
      ];
    case 'consumer':
    case 'ev_charger':
    case 'heat_pump':
    case 'boiler':
    case 'airco':
      return ['voltage_entity', 'current_entity', 'energy_today_entity', 'energy_total_entity'];
    case 'backup':
      return ['voltage_entity', 'current_entity', 'energy_today_entity', 'energy_total_entity'];
    case 'home':
      return [];
    default:
      return ['energy_today_entity', 'energy_total_entity'];
  }
}

/** De vertaalsleutel voor het label van een geavanceerd veld, rekening houdend met het apparaattype. */
export function fieldLabelKey(field: AdvancedField, type?: NodeType): string {
  const consumptionType =
    type === 'consumer' ||
    type === 'ev_charger' ||
    type === 'heat_pump' ||
    type === 'boiler' ||
    type === 'airco' ||
    type === 'backup';
  if (consumptionType && field === 'energy_today_entity') return 'energy_consumed_today';
  if (consumptionType && field === 'energy_total_entity') return 'energy_consumed_total';
  return field.replace(/_entity$/, '');
}
