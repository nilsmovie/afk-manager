# Änderungen

## Fenster und Menüs im Inventar (November 2026)

- **Offene Fenster im Dashboard**: Öffnet ein Account im Spiel ein Fenster – eine Kiste, einen
  Ofen oder ein Menü eines Plugins nach einem Befehl –, zeigt das Inventar-Widget dieses Fenster
  wie im Spiel: oben der Inhalt (passendes Raster für Kisten, Trichter, Werkbank, Ofen, Amboss …),
  darunter das eigene Inventar, dazu das Item, das gerade „an der Maus“ hängt.
- Fenstertitel, Item-Namen und **Beschreibungen (Lore)** in den Farben aus dem Spiel; Zeichen
  eigener Menü-Grafiken aus Ressourcenpaketen werden ausgeblendet.
- **Klicken**: mit der Maus direkt Links- und Rechtsklick; am Handy Item antippen und dann
  „Linksklick“, „Rechtsklick“ oder „Abbrechen“. Klick außerhalb („Wegwerfen“) mit Nachfrage.
- **Schließen** mit dem Knopf oder der Esc-Taste. Klicks und Schließen stehen im Protokoll;
  es darf, wer den Account steuern darf.

## Inventar: Verzauberungen, leere Hand, Essen (November 2026)

- **Verzauberungen** werden in allen Minecraft-Versionen erkannt (ab 1.20.5 standen sie nicht
  mehr da, wo sie vorher waren) – auch auf verzauberten Büchern; Anzeige wie im Spiel
  („Schärfe V“, „Reparatur“), beim Drüberfahren und in den Details, Flüche in Rot.
- **Leere Hand**: Klick auf einen leeren Platz der Schnellleiste nimmt ihn in die Hand;
  die Plätze sind nummeriert.
- **Essen und Trinken**: Knopf „Essen“/„Trinken“ bei essbaren Items (legt es in die Hand und
  isst es auf) und als Schnellknopf, wenn Essen in der Hand ist. Satt → verständliche Meldung
  (goldene Äpfel, Tränke, Milch gehen immer).
- **Rechtsklick gedrückt halten** benutzt das Item wie im Spiel (Essen, Trinken, Bogen spannen,
  Schild heben), Loslassen beendet es.

## Inventar und Bewegung (November 2026)

- **Steuerung in zwei Widgets**: „Bewegung“ und „Inventar“, beide immer für denselben Account.
- **Boot fahren**: Sitzt der Account im Boot, fährt W/S und lenkt A/D. Die Bootsfahrt wird wie
  im Spiel nachgerechnet (Wasser, Eis, Land; Halt an Blöcken; Korrekturen vom Server werden
  übernommen). Server mit strengem Anti-Cheat können das als Schummeln werten.
- **Inventar**: Rüstung, Zweithand, Inventar, Schnellleiste und Handwerksfeld mit Anzahl,
  Haltbarkeit, Verzauberung und eigenem Namen; verschieben (Klick oder Ziehen), stapeln,
  „In die Hand“, 1/alle droppen (mit Nachfrage bei Stapeln und besonderen Items), Rezeptliste
  zum Craften (3x3 mit Werkbank in Reichweite). Droppen und Craften stehen im Protokoll.
- **Echte Item-Bilder und deutsche Namen** optional mit `npm run bilder` (lädt sie mit
  EULA-Bestätigung direkt von Mojang nach `item-icons/`, bleibt lokal); sonst eigene Symbole.
- Behoben: „Drop“ in der alten Steuerung hat nie geantwortet (mineflayer arbeitet mit Promises).

## Chat in Farben, Statusleiste pro Server (November 2026)

- **Chat im Dashboard in den Farben wie in Minecraft**: Ränge, Namen und farbige Nachrichten
  (auch Hex-Farben und §-Codes von Plugins), fett/kursiv/unterstrichen. Sehr dunkle bzw. sehr
  helle Farben werden nur so weit angepasst, dass sie auf dem Chat-Hintergrund lesbar bleiben
  (auch im hellen Farbschema). Suche, Export, Discord-Chat und Erweiterungen bekommen weiter
  reinen Text.
- **Kopf des Dashboards**: „Hauptserver“ statt „Zielserver“; bei mehreren Servern eine Anzeige
  „online / gesamt“ pro Server und die Zahl der Accounts insgesamt.

## Mehrere Server (November 2026)

Ein Account kann jetzt **optional** zusätzlich auf weiteren Servern online sein. Wer das nicht
nutzt, merkt fast nichts: Alle Accounts laufen nach dem Update unverändert auf dem
Standardserver weiter, ohne Neueinrichtung und ohne neuen Microsoft-Login.

### Neu

- **Verwaltung → Server**: weitere Server anlegen, ändern, löschen (Owner und Admin) – Name,
  Kürzel für Discord, Adresse, Java- und/oder Bedrock-Port, Auto-Chat-Vorlage. Der
  Standardserver kommt weiter aus der `.env`.
- **Dashboard**: „+ Server“ beim Account, eine Zeile pro weiterem Server (Status, Start/Stop,
  Online-Zeit, ★, 🔔, eigener Auto-Chat, ✕), Chat-Umschalter pro Server, Steuerung über
  weitere Server.
- **Discord**: `Name@kürzel` bzw. `Name@alle` bei `!start`, `!stop`, `!mc`, `!primary`;
  `!add Name@kürzel` schickt einen bestehenden Account zusätzlich auf einen Server; `!list`
  zeigt die weiteren Server; Meldungen und Knöpfe nennen den Server.
- **Pro Verbindung**: Status, „schon mal drin“ (kein Auto-Chat beim allerersten Join),
  Auto-Chat, Glocke, Online-Zeit, Reconnect. **Pro Server**: Chat und Chat-Quelle,
  Kick-Sammelmeldungen, „Alle offline/online“, Bedrock-Pause, NetherNet/RakNet-Erkennung.
- **Microsoft-Login pro Account**: Code-Zähler und Pause gelten für alle Verbindungen eines
  Accounts; solange ein Code offen ist, warten die anderen Verbindungen (nie zwei Logins für
  denselben Login-Cache gleichzeitig). Die Warteschlange bleibt eine für alle Server.
- **Schalter** in der `.env`: `MULTI_SERVER_JAVA` (Standard an), `MULTI_SERVER_BEDROCK`
  (Standard aus), `MULTI_SERVER_BEDROCK_MAX` (Standard 2).
- **Tageszusammenfassung** mit eigenem Abschnitt pro weiterem Server.
- **Protokoll**: Server und Verbindungen anlegen/ändern/entfernen, alle Aktionen mit dem
  Server im Ziel (z.B. `NilsMovie@lobby`).
- **Erweiterungen**: Schnittstelle unverändert; neu sind ein optionaler Server bei
  `sendChatMessage(name, text, server)` und `isAccountOnline(name, server)`, `getServers()`
  und das Feld `server` bei `onChat` (kommt weiterhin nur vom Standardserver).
- **Tests**: `npm test` (21 Szenarien, nachgebaute Bots, nichts wird nach außen verbunden).

### Behoben

- **Server mit eigenem Ressourcenpaket** (Java): Accounts flogen nach wenigen Sekunden mit
  „An internal error occurred in your connection.“ raus, weil mineflayer das Paket während der
  Anmeldung nicht beantwortet hat. mineflayer ist jetzt auf 4.39 aktualisiert (beantwortet es
  dort selbst und schickt in dieser Phase keine Bewegungspakete mehr); kommt ein Paket später im
  Spiel, nimmt der Manager es an. Heruntergeladen wird nichts – ein AFK-Bot braucht keine
  Texturen. Nach dem Update ist `npm install` nötig.

- **Gestoppt bleibt gestoppt**: Accounts (und Verbindungen zu weiteren Servern), die vorher
  gestoppt waren – per Stop, `!stop`, „Alle stoppen“, „anderswo eingeloggt“ oder neu angelegt
  und noch nicht gestartet –, startet ein Neustart des Managers nicht mehr. Sie bleiben aus, bis
  jemand auf Start drückt. Gespeichert als `"stopped": true` in `accounts.json` bzw.
  `verbindungen.json` (ältere Versionen ignorieren das). Beim ersten Neustart nach dem Update
  starten noch alle, weil es den Merker vorher nicht gab.

- **Tageszusammenfassung übersteht Neustarts**: Die Online-Zeiten von heute stehen jede Minute
  in `statistik.json`; nach einem Neustart am selben Tag zählen sie weiter (die Zeit, in der der
  Manager aus war, zählt nicht). War der Manager um Mitternacht aus, wird die Zusammenfassung
  des Vortags beim Start nachgeholt. Ein Neustart kurz nach Mitternacht schickt sie auch nicht
  mehr doppelt.

### Behoben (schon vor dieser Version)

- Ein im Dashboard oder per `!stop` gestoppter Account zählte in der Online-Zeit weiter, bis er
  wieder gestartet wurde – die Tageszusammenfassung war für gestoppte Accounts zu hoch.

### Geändert

- **„Alle Accounts wieder online“ ist ruhiger**: Die Meldung kommt nur nach einem echten
  Ausfall (nach „Alle offline“, einem Massen-Kick, dem Start des Managers oder wenn ein
  Account länger als `DISCORD_ALL_ONLINE_AFTER_MIN` Minuten weg war, Standard 10). Ein
  einzelner Account, der kurz rausfliegt, löst keine Meldung mehr aus.
- **Kein fest eingebauter Server mehr**: Ohne `MC_SERVER_HOST` in der `.env` startet kein
  Account (Meldung in Log, Dashboard und Discord). In der `.env.example` steht weiter
  `clashsmp.de`.
- „Alle starten/stoppen“ und `!start all`/`!stop all` gelten für alle Server.
- Umbenennen geht nur, wenn der Account auf allen Servern gestoppt ist.
- `!list` markiert jetzt die tatsächliche Chat-Quelle (vorher immer den ersten Account).
- Die Seite „Benutzerverwaltung“ heißt jetzt „Verwaltung“.

### Dateien

- Neu (bleiben lokal, nie im Repository): `servers.json`, `verbindungen.json` (jeweils mit
  `.backup.json`) und einmalig `accounts.vor-mehrserver.json` – eine unveränderte Kopie der
  `accounts.json` vom ersten Start dieser Version.
- `accounts.json` behält ihr Format. Ältere Versionen ignorieren die neuen Dateien.

### Update

```bash
cd ~/afk-manager
grep MC_SERVER_HOST .env     # muss eine Adresse zeigen, z.B. MC_SERVER_HOST=clashsmp.de
git pull
npm install                  # nötig: neue mineflayer-Version
sudo systemctl restart afk-manager
```

Die Warnungen „EBADENGINE … required: { node: '>=24' }“ bei `npm install` (bedrock-protocol,
nethernet …) gab es schon vorher, sie sind harmlos.

### Zurück zur Version davor

```bash
cd ~/afk-manager
git log --oneline            # die Version vor "Mehrere Server" heraussuchen
git checkout <nummer>
npm install                  # passende Paketversionen dieser Version
sudo systemctl restart afk-manager
```

Die Accounts laufen dann wieder nur auf dem Standardserver, ohne neuen Login.
`servers.json` und `verbindungen.json` bleiben liegen und werden beim nächsten Update wieder
benutzt.
