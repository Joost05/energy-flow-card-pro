# Migration and upgrades

## From v0.17.0 or newer

No rename migration is required. The current technical identifiers are:

```text
Resource: energy-flow-card-pro.js
Card type: custom:energy-flow-card-pro
```

Normal HACS updates should preserve the existing card configuration.

## From v0.16.x or older

Version **0.17.0** introduced a one-time technical rename so the project no longer collides with similarly named cards.

### Old identifiers

```text
energy-flow-card.js
custom:energy-flow-card
```

### Current identifiers

```text
energy-flow-card-pro.js
custom:energy-flow-card-pro
```

If you previously installed the card manually:

1. save your existing card configuration;
2. remove or disable the old `energy-flow-card.js` dashboard resource;
3. remove the old manually copied `/config/www/energy-flow-card/` files if they are no longer used;
4. install Energy Flow Card Pro through HACS;
5. change only the card type:

   ```yaml
   type: custom:energy-flow-card-pro
   ```

Your node, pricing, layout, group and sensor configuration can otherwise remain the same.

## Moving from manual installation to HACS

To make sure you are testing the HACS copy rather than an old manual resource:

1. save the card configuration;
2. remove the manually configured dashboard resource;
3. rename or remove the old card folder in `/config/www`;
4. install the repository through HACS;
5. verify that HACS has registered the frontend resource;
6. reload the Home Assistant/browser frontend;
7. reuse the existing configuration with `custom:energy-flow-card-pro`.

Do not keep two active resources that both register Energy Flow Card Pro.

## HACS custom repository installation

Until the project is included in the default HACS repository list, add it as a custom repository:

```text
https://github.com/Joost05/energy-flow-card-pro
```

Category: **Dashboard**.

After installation, HACS handles the frontend resource and future updates.

## Configuration compatibility

Configuration migrations have intentionally stayed conservative. Existing settings from recent pre-1.0 versions are retained where possible.

Notable compatibility behavior:

- legacy `pricing.mode: dynamic` is interpreted as entity pricing;
- older layout aliases are normalized to the current Flow layout;
- L1 phase power can be omitted when total, L2 and L3 allow it to be calculated;
- user-entered names remain user content and are not translated when the Home Assistant frontend language changes.

## Before a major upgrade

For important dashboards, keep a copy of the card YAML/configuration before upgrading. That makes rollback straightforward if a future major version ever changes configuration semantics.
