# Änderungen

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
