# AFK-Manager

Web-Dashboard, das Minecraft-Accounts (Java und Bedrock) rund um die Uhr auf einem Server hält –
mit Discord-Bot, Live-Chat, Steuerung im Spiel und Benutzerverwaltung.

Gebaut für **clashsmp.de**. Die Grundfunktionen laufen auf jedem Server, einige Teile sind auf
clashsmp.de zugeschnitten (siehe [unten](#auf-clashsmpde-zugeschnitten)).

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

- Linux-Rechner, der dauerhaft läuft (z. B. Debian-Server oder Raspberry Pi)
- [Node.js](https://nodejs.org) 22 oder neuer
- git (`sudo apt install git`)
- Microsoft-Konten mit Minecraft für die Bots

## Installation

```bash
git clone https://github.com/<DEIN-NAME>/afk-manager.git
cd afk-manager
npm install
cp .env.example .env
nano .env          # mindestens DASHBOARD_PASSWORD und MC_SERVER_HOST eintragen
node server.js     # Testlauf, beenden mit Strg+C
```

Dann im Browser `http://<IP-des-Rechners>:3000` öffnen und mit dem Benutzer **nils** und dem
`DASHBOARD_PASSWORD` anmelden. Danach unter **Verwaltung** ein eigenes Passwort setzen.

### Dauerhaft laufen lassen (systemd)

`/etc/systemd/system/afk-manager.service`:

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

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now afk-manager
sudo journalctl -u afk-manager -f      # Log ansehen
```

## Updates

```bash
cd ~/afk-manager
git pull
npm install
sudo systemctl restart afk-manager
```

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

Eigene Ergänzungen, die nur bei dir laufen sollen, kannst du als `.js`-Datei in den Ordner
`erweiterungen/` legen – er wird beim Start geladen und bleibt ebenfalls lokal.

## Auf clashsmp.de zugeschnitten

- Format der Chat-Spiegelung in Discord (Rang-Tags, Shop- und Tipp-Nachrichten)
- Seitentitel und Standard-Server `clashsmp.de`
- Owner-Benutzer heißt fest `nils`

Ausführliche Anleitung: [ANLEITUNG.txt](ANLEITUNG.txt)
