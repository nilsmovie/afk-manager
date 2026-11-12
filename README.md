# AFK-Manager

Web-Dashboard, das Minecraft-Accounts (Java und Bedrock) rund um die Uhr auf einem Server hält –
mit Discord-Bot, Live-Chat, Steuerung im Spiel und Benutzerverwaltung.

Gebaut für **clashsmp.de**, läuft aber mit jedem Minecraft-Server (Adresse in der `.env`).

## Was er kann

- **Java- und Bedrock-Accounts** (Bedrock seit 26.60 über NetherNet, jeder Account in einem
  eigenen Thread), Anmeldung per Microsoft-Code direkt aus dem Dashboard oder Discord
- **Verbindet von selbst neu** – einer nach dem anderen, mit Pausen bei Dauerfehlern, damit der
  Server die eigene IP nicht sperrt
- **Dashboard**: Accounts starten/stoppen, Live-Chat, Befehle senden, Steuerung (Laufen, Klicken,
  Hotbar), Auto-Chat nach dem Einloggen, Uptime pro Tag
- **Benutzer mit Rollen**: Owner, Admin, User (User sehen nur die ihnen zugewiesenen Accounts)
- **Discord-Bot**: `!start`, `!stop`, `!add`, `!list`, `!mc Account Nachricht`, Login-Codes als
  Link, Meldungen bei Kick/„anderswo eingeloggt“, Tageszusammenfassung
- **Protokoll** (nur Owner): wer hat wann was gemacht – Webseite mit IP und Gerät, Discord mit
  Name und ID; aktive Anmeldungen ansehen und abmelden

## Voraussetzungen

- Ein Rechner, der dauerhaft läuft – am besten Linux (Debian/Ubuntu-Server, Raspberry Pi).
  Windows und Mac gehen auch, die Befehle unten sind für Linux.
- [Node.js](https://nodejs.org) 22 oder neuer (`node -v` zeigt die Version)
- git (`sudo apt install git`)
- Microsoft-Konten mit Minecraft für die Bots (am besten mit Zwei-Faktor-Anmeldung)

## Installation

```bash
git clone https://github.com/nilsmovie/afk-manager.git
cd afk-manager
npm install
cp .env.example .env
nano .env          # mindestens DASHBOARD_PASSWORD und MC_SERVER_HOST eintragen
node server.js     # Testlauf, beenden mit Strg+C
```

In `nano` speicherst du mit **Strg+O**, Enter, und schließt mit **Strg+X**.

Dann im Browser `http://<IP-des-Rechners>:3000` öffnen und anmelden:

- **Benutzer:** `admin` (oder was du in der `.env` bei `DASHBOARD_OWNER` eingetragen hast)
- **Passwort:** dein `DASHBOARD_PASSWORD`

Der Owner wird nur beim allerersten Start angelegt. Sein Passwort änderst du danach in
der **Verwaltung** unter „Mein Passwort ändern“. `DASHBOARD_PASSWORD` muss trotzdem in der
`.env` stehen bleiben – ist es leer, schaltet sich der Login ab.

### Dauerhaft laufen lassen (systemd)

Erst nachsehen, wo Node liegt: `which node` (z. B. `/usr/bin/node`). Dann
`sudo nano /etc/systemd/system/afk-manager.service`:

```ini
[Unit]
Description=AFK-Manager
After=network-online.target
Wants=network-online.target

[Service]
User=<dein-linux-benutzer>
WorkingDirectory=/home/<dein-linux-benutzer>/afk-manager
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

`<dein-linux-benutzer>` ersetzen (zeigt `whoami`) und bei `ExecStart` den Pfad von `which node`
eintragen. Danach:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now afk-manager
sudo journalctl -u afk-manager -f      # Log ansehen, beenden mit Strg+C
```

## Updates

```bash
cd ~/afk-manager
git pull
npm install
sudo systemctl restart afk-manager
```

Ändere die Programmdateien (`server.js`, `admin.html` …) nicht selbst – sonst kann `git pull`
nicht aktualisieren. Einstellungen gehören in die `.env`.

Zurück auf eine ältere Version, falls ein Update Probleme macht:

```bash
git log --oneline          # Versionen ansehen, z.B. "a1b2c3d Protokoll eingebaut"
git checkout a1b2c3d       # diese Version nehmen
sudo systemctl restart afk-manager
git checkout main          # später wieder auf den neuesten Stand
```

## Was nur auf deinem Rechner bleibt

Diese Dateien entstehen im laufenden Betrieb und kommen **nie** ins Repository (siehe
`.gitignore`): `.env`, `accounts.json`, `users.json`, `audit.log`, `audit-known-ips.json` und
deren Sicherungskopien. Die Microsoft-Logins liegen unter `~/.minecraft/nmp-cache`.
Gib diese Dateien nie weiter – darin stehen Passwort-Hashes, Discord-Token und die Logins deiner
Accounts.

Eigene Ergänzungen, die nur bei dir laufen sollen, kannst du als `.js`-Datei in den Ordner
`erweiterungen/` legen – er wird beim Start geladen und bleibt ebenfalls lokal.

## Auf clashsmp.de zugeschnitten

- Format der Chat-Spiegelung in Discord (Rang-Tags, Shop- und Tipp-Nachrichten). Auf anderen
  Servern kommt der Chat trotzdem an, nur evtl. weniger schön formatiert.
- In der `.env.example` ist `clashsmp.de` als Standardserver eingetragen. Ohne `MC_SERVER_HOST`
  in der `.env` startet kein Account (der Manager sagt dann im Log und im Dashboard Bescheid).

Ausführliche Anleitung: [ANLEITUNG.txt](ANLEITUNG.txt)
