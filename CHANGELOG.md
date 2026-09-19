# Changelog

## v0.7.2

- Kaart iets ruimer gemaakt: grotere standaard rasterhoogte, meer interne ruimte en een grotere maximale flowbreedte.
- Detailpopup staat nu als viewport-overlay boven Home Assistant in plaats van opgesloten in de kaart. Daardoor blijft hij volledig zichtbaar wanneer veel geavanceerde meetwaarden zijn ingesteld.
- Popup is responsief op desktop en mobiel en krijgt een eigen maximale hoogte met scrollen wanneer nodig.
- Taal volgt nu expliciet de actieve Home Assistant frontendtaal per gebruiker/persoon. `hass.locale.language` wordt gebruikt met `hass.language` als fallback.
- Nederlandse en Engelse teksten gelden voor kaart, editor, statussen, popup, grafiek en veldnamen.
- HACS-ready repositorystructuur toegevoegd met README, LICENSE, `hacs.json` en GitHub Actions releaseworkflow.
- Versienummer bijgewerkt naar **0.7.2**.

## v0.7.1

- De standaard energiestroomweergave heet voortaan **Flow**; merk-/productvergelijkingen zijn uit de interface en documentatie verwijderd.
- Bestaande v0.7.0-configuraties met de oude layoutwaarde blijven automatisch werken en worden intern als **Flow** behandeld.
- Verbruikers tonen onder **Geavanceerd** nu relevante meetwaarden: spanning, stroom, vandaag verbruikt en totaal verbruikt.
- Dezelfde verbruiksvelden zijn beschikbaar voor laadpaal, warmtepomp, boiler, airco en backup.
- Extra meetwaarden blijven uit de hoofdweergave en verschijnen alleen in de detailpopup wanneer je op een node klikt.
- Productievelden voor zonnepanelen/producenten blijven als productie gelabeld.
- Versienummer bijgewerkt naar **0.7.1**.

## v0.7.0

- Nieuwe **Flow** energiestroom-layout als standaardweergave: productie boven, net links, opslag rechts en verbruikers onder de woning.
- Home Assistant `ha-entity-picker` voor vermogens- en sensorsvelden; dropdowns blijven open tijdens zoeken/selecteren.
- Naamvelden worden pas naar Home Assistant gecommit na afronden van de invoer, zodat volledige namen behouden blijven.
- Optionele eigen vermogenssensor voor **Woning** (`home_power_entity`); zonder sensor blijft de woning automatisch berekend.
- Onbekende losse bron/apparaatsensoren maken de volledige berekende woningwaarde niet meer automatisch ongeldig zolang er bruikbare energiestromen overblijven.
- Compactere nodes en duidelijkere flowlijnen in de Flow weergave.
- Bestaande `circle` en `straight` layouts blijven beschikbaar.
- Versienummer bijgewerkt naar **0.7.0**.
