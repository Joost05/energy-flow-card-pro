/** Het deel van de Home Assistant-frontend-API dat deze kaart gebruikt. */
export interface HassEntity {
  state: string;
  attributes: {
    unit_of_measurement?: string;
    friendly_name?: string;
    [key: string]: unknown;
  };
  last_changed?: string;
  last_updated?: string;
}

export interface Hass {
  states: Record<string, HassEntity>;
  language?: string;
  locale?: { language?: string; [key: string]: unknown };
  callApi?<T = unknown>(method: string, path: string, parameters?: Record<string, unknown>): Promise<T>;
}
