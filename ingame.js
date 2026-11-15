// Ingame-Steuerung fuer Java-Accounts: Boot fahren und Inventar (ansehen, verschieben, droppen,
// craften). Wird von server.js benutzt; alles hier arbeitet mit einem mineflayer-Bot.

const fs = require('fs');
const path = require('path');
const { Vec3 } = require('vec3');

// ---------- Boot fahren ----------
// Minecraft rechnet die Bootsfahrt beim Spieler (Client) aus und schickt dem Server nur die neue
// Position. Damit ein Bot fahren kann, wird hier die Boots-Physik aus dem Spiel nachgebaut
// (Beschleunigung, Lenken, Reibung auf Wasser/Eis/Land). Stoesst das Boot an einen Block, bleibt
// es stehen; korrigiert der Server die Position, wird sie uebernommen.

function isBoatEntity(e) {
  return !!(e && typeof e.name === 'string' && /boat|raft/i.test(e.name));
}

// mineflayer speichert den Blickwinkel im Bogenmass mit eigener Richtung, das Spiel in Grad
const toNotchianYaw = (rad) => 180 - (rad * 180) / Math.PI;
const fromNotchianYaw = (deg) => {
  const r = Math.PI - (deg * Math.PI) / 180;
  const full = 2 * Math.PI;
  return ((r % full) + full) % full;
};

function createBoatDriver(bot, log = () => {}) {
  const input = { forward: false, back: false, left: false, right: false };
  let timer = null;
  let sim = null;

  const blockAt = (x, y, z) => {
    try {
      return bot.blockAt(new Vec3(x, y, z));
    } catch (e) {
      return null;
    }
  };
  const solid = (b) => !!(b && b.boundingBox === 'block');

  // Reibung wie im Spiel: Wasser 0.9, Eis 0.98, Blaueis 0.989, sonst (Land) 0.6
  function frictionAt(x, y, z) {
    const here = blockAt(x, y + 0.1, z);
    const below = blockAt(x, y - 0.1, z);
    const isWater = (b) => !!(b && /water/.test(b.name));
    if (isWater(here) || isWater(below)) return 0.9;
    if (below) {
      if (below.name === 'blue_ice') return 0.989;
      if (/ice/.test(below.name)) return 0.98;
      if (below.name === 'slime_block') return 0.8;
    }
    return 0.6;
  }

  // Stoesst das Boot an der neuen Stelle (Mitte oder vordere Kante) an einen festen Block?
  function blocked(x, y, z, dx, dz) {
    const len = Math.hypot(dx, dz) || 1;
    const fx = x + (dx / len) * 0.7;
    const fz = z + (dz / len) * 0.7;
    return solid(blockAt(x, y + 0.2, z)) || solid(blockAt(fx, y + 0.2, fz)) || solid(blockAt(fx, y + 0.6, fz));
  }

  function send(name, params) {
    try {
      bot._client.write(name, params);
    } catch (e) {
      log(`Boot: ${name} konnte nicht gesendet werden: ${e.message}`);
    }
  }

  function sendInputs() {
    // Dem Server die gedrueckten Tasten melden (ab 1.21.2 player_input, davor steer_vehicle)
    const left = input.left === input.right ? 0 : input.left ? 1 : -1;
    const forward = input.forward === input.back ? 0 : input.forward ? 1 : -1;
    try {
      if (typeof bot.moveVehicle === 'function') bot.moveVehicle(left, forward);
    } catch (e) {
      // aeltere/fremde Versionen: kein Problem, die Position zaehlt
    }
  }

  function inBoat() {
    return isBoatEntity(bot.vehicle);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    sim = null;
  }

  function tick() {
    const v = bot.vehicle;
    if (!isBoatEntity(v)) return stop();
    if (!sim || sim.id !== v.id) {
      sim = { id: v.id, x: v.position.x, y: v.position.y, z: v.position.z, yaw: toNotchianYaw(v.yaw || 0), vx: 0, vz: 0, rot: 0 };
    } else if (Math.hypot(v.position.x - sim.x, v.position.z - sim.z) > 2) {
      // Der Server hat das Boot woanders hingesetzt -> von dort weiter
      sim.x = v.position.x; sim.y = v.position.y; sim.z = v.position.z;
      sim.vx = 0; sim.vz = 0;
    }
    const inv = frictionAt(sim.x, sim.y, sim.z);
    sim.vx *= inv;
    sim.vz *= inv;
    sim.rot *= inv;
    let f = 0;
    if (input.left) sim.rot -= 1;
    if (input.right) sim.rot += 1;
    if (input.right !== input.left && !input.forward && !input.back) f += 0.005;
    sim.yaw += sim.rot;
    if (input.forward) f += 0.04;
    if (input.back) f -= 0.005;
    const rad = (sim.yaw * Math.PI) / 180;
    sim.vx += Math.sin(-rad) * f;
    sim.vz += Math.cos(rad) * f;
    const nx = sim.x + sim.vx;
    const nz = sim.z + sim.vz;
    if ((sim.vx || sim.vz) && blocked(nx, sim.y, nz, sim.vx, sim.vz)) {
      sim.vx = 0;
      sim.vz = 0;
    } else {
      sim.x = nx;
      sim.z = nz;
    }
    send('vehicle_move', { x: sim.x, y: sim.y, z: sim.z, yaw: sim.yaw, pitch: 0, onGround: false });
    send('steer_boat', {
      leftPaddle: (input.right && !input.left) || input.forward,
      rightPaddle: (input.left && !input.right) || input.forward,
    });
    // Eigene Sicht auf das Boot mitziehen (sonst haelt der naechste Takt es fuer "vom Server versetzt")
    try {
      v.position.x = sim.x; v.position.y = sim.y; v.position.z = sim.z;
      v.yaw = fromNotchianYaw(sim.yaw);
    } catch (e) {
      // egal
    }
    const anyInput = input.forward || input.back || input.left || input.right;
    if (!anyInput && Math.hypot(sim.vx, sim.vz) < 0.003 && Math.abs(sim.rot) < 0.05) stop();
  }

  // Korrektur vom Server uebernehmen
  const onServerMove = (packet) => {
    if (!packet || typeof packet.x !== 'number') return;
    const v = bot.vehicle;
    if (isBoatEntity(v)) {
      try {
        v.position.x = packet.x; v.position.y = packet.y; v.position.z = packet.z;
        if (typeof packet.yaw === 'number') v.yaw = fromNotchianYaw(packet.yaw);
      } catch (e) {
        // egal
      }
    }
    if (!sim) return;
    sim.x = packet.x; sim.y = packet.y; sim.z = packet.z;
    if (typeof packet.yaw === 'number') sim.yaw = packet.yaw;
    sim.vx = 0; sim.vz = 0;
  };
  try {
    bot._client.on('vehicle_move', onServerMove);
  } catch (e) {
    // kein Client (Test) - egal
  }

  return {
    inBoat,
    // Taste gedrueckt/losgelassen: forward/back/left/right
    setInput(direction, pressed) {
      if (!(direction in input)) return false;
      input[direction] = !!pressed;
      sendInputs();
      if (!timer && inBoat()) timer = setInterval(tick, 50);
      return true;
    },
    release() {
      for (const k of Object.keys(input)) input[k] = false;
      sendInputs();
    },
    stop,
    _state: () => sim, // fuer Tests
  };
}

// ---------- Namen und Bilder ----------
// Deutsche Namen und echte Bilder gibt es nur, wenn sie mit "npm run bilder" aus dem Spiel
// geholt wurden (Ordner item-icons/, bleibt nur lokal - die Bilder gehoeren Mojang).
const ICONS_DIR = path.join(__dirname, 'item-icons');
let langCache = { at: 0, data: null };
function germanNames() {
  if (Date.now() - langCache.at < 10 * 60 * 1000) return langCache.data;
  langCache = { at: Date.now(), data: null };
  try {
    const file = path.join(ICONS_DIR, 'de_de.json');
    if (fs.existsSync(file)) langCache.data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    langCache.data = null;
  }
  return langCache.data;
}
function germanName(itemName) {
  const lang = germanNames();
  if (!lang) return null;
  return lang[`item.minecraft.${itemName}`] || lang[`block.minecraft.${itemName}`] || null;
}

// Zuordnung Item -> Bild aus den Modellen des Spiels (npm run bilder schreibt item-icons/icons.json):
// Stufen, Zäune, Truhen, Betten ... haben kein eigenes Bild mit ihrem Namen.
const ICON_REL_RE = /^(item|block|made)\/[a-z0-9_]{1,64}\.png$/;
let iconMap = { checked: 0, version: 0, data: null };
function iconState() {
  if (Date.now() - iconMap.checked < 30 * 1000) return iconMap;
  let version = 0;
  let data = null;
  try {
    const file = path.join(ICONS_DIR, 'icons.json');
    const st = fs.statSync(file);
    version = Math.floor(st.mtimeMs / 1000);
    data = version === iconMap.version && iconMap.data ? iconMap.data : JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    try { version = Math.floor(fs.statSync(path.join(ICONS_DIR, 'item')).mtimeMs / 1000); } catch (e2) { version = 0; }
    data = null;
  }
  if (version !== iconMap.version) iconCache.clear(); // neue Bilder -> neu suchen
  iconMap = { checked: Date.now(), version, data: data && typeof data === 'object' && data.items && typeof data.items === 'object' ? data.items : null };
  return iconMap;
}
// Ändert sich, wenn "npm run bilder" neu lief (damit der Browser neue Bilder lädt)
function iconsVersion() {
  if (!iconsAvailable()) return 0;
  return iconState().version || 1;
}

// Erstes passendes Bild zu einem Item-Namen (oder null)
const iconCache = new Map();
const ICON_NAME_RE = /^[a-z0-9_]{1,64}$/;
const ICON_ALIAS = { enchanted_golden_apple: 'golden_apple', debug_stick: 'stick' };
function iconFile(name) {
  if (!ICON_NAME_RE.test(name)) return null;
  const state = iconState();
  if (iconCache.has(name)) return iconCache.get(name);
  const mapped = state.data && typeof state.data[name] === 'string' && ICON_REL_RE.test(state.data[name]) ? state.data[name] : null;
  const tries = [
    `item/${name}.png`,
    ...(mapped ? [mapped] : []),
    `block/${name}.png`, `item/${name}_00.png`,
    `block/${name}_front.png`, `block/${name}_side.png`, `block/${name}_top.png`,
    // Holz/Pflanzen u.ae.: "oak_log" -> "oak_log.png" gibt es; "oak_wood" -> "oak_log.png"
    `block/${name.replace(/_wood$/, '_log')}.png`, `block/${name.replace(/^stripped_(.*)_wood$/, 'stripped_$1_log')}.png`,
    ...(ICON_ALIAS[name] ? [`item/${ICON_ALIAS[name]}.png`] : []),
    `block/${name.replace(/^infested_/, '')}.png`,
  ];
  let found = null;
  for (const rel of tries) {
    const p = path.join(ICONS_DIR, rel);
    if (fs.existsSync(p)) { found = p; break; }
  }
  if (iconCache.size > 5000) iconCache.clear();
  // "Kein Bild" nur merken, wenn es den Ordner schon gibt (sonst wirkt "npm run bilder" erst nach einem Neustart)
  if (found || iconsAvailable()) iconCache.set(name, found);
  return found;
}
function iconsAvailable() {
  return fs.existsSync(path.join(ICONS_DIR, 'item'));
}
function clearIconCache() {
  iconCache.clear();
  iconMap = { checked: 0, version: 0, data: null };
  langCache = { at: 0, data: null };
}

// Eigener Name (Amboss) als reiner Text
// NBT-Form ({ type, value }, ab 1.20.3 fuer Namen/Titel) in normales JSON umwandeln
function unNbt(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 12) return v;
  if (typeof v.type === 'string' && 'value' in v) {
    if (v.type === 'compound') {
      const out = {};
      for (const k of Object.keys(v.value || {})) out[k] = unNbt(v.value[k], depth + 1);
      return out;
    }
    if (v.type === 'list') {
      const inner = v.value || {};
      return (Array.isArray(inner.value) ? inner.value : []).map((x) => unNbt(inner.type === 'compound' ? { type: 'compound', value: x } : x, depth + 1));
    }
    return v.value;
  }
  return v;
}

function plainChat(v, depth = 0) {
  if (v === null || v === undefined || depth > 8) return '';
  if (depth === 0 && typeof v === 'object' && typeof v.type === 'string' && 'value' in v) v = unNbt(v);
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    const s = v.trim();
    if ((s.startsWith('{') || s.startsWith('[') || s.startsWith('"')) && depth === 0) {
      try { return plainChat(JSON.parse(s), depth + 1); } catch (e) { /* kein JSON */ }
    }
    return v.replace(/§./g, '');
  }
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map((x) => plainChat(x, depth + 1)).join('');
  if (typeof v === 'object') {
    let out = '';
    if (typeof v.text === 'string' || typeof v.text === 'number') out += v.text;
    else if (typeof v[''] === 'string') out += v[''];
    if (Array.isArray(v.extra)) out += v.extra.map((x) => plainChat(x, depth + 1)).join('');
    if (v.value !== undefined && !out) out += plainChat(v.value, depth + 1); // NBT-Form
    return out.replace(/§./g, '');
  }
  return '';
}

// ---------- Inventar ----------
// Fensterplaetze des Spieler-Inventars (wie im Spiel):
//  0 Ergebnis Handwerk, 1-4 Handwerk 2x2, 5-8 Ruestung (Kopf, Brust, Beine, Fuesse),
//  9-35 Inventar, 36-44 Schnellleiste, 45 Zweithand
const SLOT_COUNT = 46;

// Verzauberungen in jeder Minecraft-Version lesen. Ab 1.20.5 stehen sie als "Komponente" am Item
// ({ enchantments: [{ id, level }] }), davor im NBT ([{ name, lvl }]); Buecher haben eigene
// ("gespeicherte") Verzauberungen.
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
function readEnchants(item, registry) {
  const fromComponent = (type) => {
    try {
      return item.componentMap && item.componentMap.has(type) ? item.componentMap.get(type).data : null;
    } catch (e) {
      return null;
    }
  };
  let raw = fromComponent('stored_enchantments') || null;
  if (!raw || (Array.isArray(raw.enchantments) && raw.enchantments.length === 0)) {
    try { raw = item.enchants; } catch (e) { raw = fromComponent('enchantments'); }
  }
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.enchantments) ? raw.enchantments : [];
  return list.slice(0, 16).map((e) => {
    const lvl = Number(e.lvl !== undefined ? e.lvl : e.level) || 0;
    let name = typeof e.name === 'string' ? e.name : null;
    if (!name && typeof e.id === 'number' && registry && registry.enchantments && registry.enchantments[e.id]) name = registry.enchantments[e.id].name;
    if (!name && typeof e.id === 'string') name = e.id.replace(/^minecraft:/, '');
    name = String(name || 'unbekannt');
    const lang = germanNames();
    let label = lang && lang[`enchantment.minecraft.${name}`];
    if (!label && registry && registry.enchantmentsByName && registry.enchantmentsByName[name]) label = registry.enchantmentsByName[name].displayName;
    if (!label) label = name.replace(/_/g, ' ');
    // Stufe nur zeigen, wenn es mehr als eine gibt (wie im Spiel: "Reparatur" statt "Reparatur I")
    const max = registry && registry.enchantmentsByName && registry.enchantmentsByName[name] ? registry.enchantmentsByName[name].maxLevel : 0;
    const levelText = max === 1 && lvl === 1 ? '' : (ROMAN[lvl] || String(lvl));
    return { name, lvl, label: levelText ? `${label} ${levelText}` : label };
  });
}

// Essen/Trinken: was laesst sich "benutzen", bis es aufgebraucht ist?
const ALWAYS_EDIBLE = ['potion', 'milk_bucket', 'honey_bottle', 'golden_apple', 'enchanted_golden_apple', 'chorus_fruit', 'suspicious_stew'];
function isConsumable(name, registry) {
  if (!name) return false;
  if (ALWAYS_EDIBLE.includes(name)) return true;
  return !!(registry && registry.foodsByName && registry.foodsByName[name]);
}

// Eine Zeile Chat-Text (Name, Beschreibung) als { text, segs? } - mit Farben, wenn fmt da ist
function chatLine(raw, fmt, max) {
  let r = null;
  try { r = fmt ? fmt(raw) : null; } catch (e) { r = null; }
  if (!r || typeof r.text !== 'string') r = { text: plainChat(raw) };
  r.text = r.text.replace(/\u00a7./g, '').slice(0, max);
  return r;
}

const MAX_LORE_LINES = 12;
function readLore(item, fmt) {
  let lore = null;
  try { lore = item.customLore; } catch (e) { lore = null; }
  if (!Array.isArray(lore) || !lore.length) return undefined;
  const out = [];
  for (const line of lore.slice(0, MAX_LORE_LINES)) out.push(chatLine(line, fmt, 100));
  return out;
}

// Items, die im Spiel immer glitzern (ohne Verzauberung) - oder per Komponente glitzern sollen
const GLINT_ITEMS = new Set(['enchanted_golden_apple', 'enchanted_book', 'experience_bottle', 'nether_star', 'end_crystal', 'debug_stick']);
function hasGlint(item) {
  try {
    const c = item.componentMap && item.componentMap.get && item.componentMap.get('enchantment_glint_override');
    if (c && typeof c.data === 'boolean') return c.data;
  } catch (e) {
    // egal
  }
  return GLINT_ITEMS.has(String(item.name || ''));
}

function itemInfo(item, slot, registry, fmt) {
  if (!item) return null;
  let custom = '';
  let customLine = null;
  if (item.customName !== null && item.customName !== undefined) {
    customLine = chatLine(item.customName, fmt, 64);
    custom = customLine.text;
  }
  let enchants = [];
  try {
    enchants = readEnchants(item, registry);
  } catch (e) {
    enchants = [];
  }
  const info = {
    slot,
    name: String(item.name || ''),
    label: germanName(item.name) || String(item.displayName || item.name || ''),
    custom: custom || undefined,
    customSegs: custom && customLine && customLine.segs ? customLine.segs : undefined,
    lore: readLore(item, fmt),
    count: Number(item.count) || 0,
    stackSize: Number(item.stackSize) || 64,
    enchants,
    edible: isConsumable(item.name, registry) || undefined,
    glint: hasGlint(item) || undefined,
  };
  try {
    if (item.maxDurability) {
      const used = Number(item.durabilityUsed) || 0;
      info.durability = { left: Math.max(0, item.maxDurability - used), max: item.maxDurability };
    }
  } catch (e) {
    // ohne Haltbarkeit
  }
  return info;
}

// Offenes Fenster (Kiste, Menue eines Plugins, Ofen ...) wie im Spiel: oben der Inhalt des
// Fensters, darunter das eigene Inventar - alles mit den Platznummern DIESES Fensters.
// formatTitle(raw) macht aus dem Titel { text, segs } (Farben wie im Chat).
const MAX_WINDOW_SLOTS = 120;
function windowSnapshot(bot, formatTitle) {
  const win = bot.currentWindow;
  if (!win || !Array.isArray(win.slots)) return null;
  const slots = [];
  const n = Math.min(win.slots.length, MAX_WINDOW_SLOTS);
  for (let i = 0; i < n; i++) slots.push(itemInfo(win.slots[i], i, bot.registry, formatTitle));
  const title = chatLine(win.title, formatTitle, 120);
  return {
    id: win.id,
    type: String(win.type || ''),
    title,
    inventoryStart: Number(win.inventoryStart) || 0,
    inventoryEnd: Number(win.inventoryEnd) || n,
    slots,
    cursor: itemInfo(win.selectedItem, -1, bot.registry, formatTitle),
  };
}

function inventorySnapshot(bot, opts = {}) {
  const slots = [];
  const src = (bot.inventory && bot.inventory.slots) || [];
  for (let i = 0; i < SLOT_COUNT; i++) slots.push(itemInfo(src[i], i, bot.registry, opts.formatTitle));
  const v = bot.vehicle;
  return {
    slots,
    quickBar: typeof bot.quickBarSlot === 'number' ? bot.quickBarSlot : 0,
    windowOpen: !!bot.currentWindow,
    window: windowSnapshot(bot, opts.formatTitle),
    vehicle: v && v.name ? String(v.name) : null,
    inBoat: isBoatEntity(v),
    health: typeof bot.health === 'number' ? Math.round(bot.health * 10) / 10 : null,
    food: typeof bot.food === 'number' ? bot.food : null,
    icons: iconsVersion(),
  };
}

// Aktionen pro Bot nacheinander ausfuehren (zwei gleichzeitige Klicks wuerden sich sonst
// gegenseitig durcheinanderbringen), mit Zeitlimit
const queues = new WeakMap();
function runExclusive(bot, fn, timeoutMs = 15000) {
  const prev = queues.get(bot) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Zeitüberschreitung')), timeoutMs);
    Promise.resolve().then(fn).then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  }));
  queues.set(bot, next);
  return next;
}

// Offenes Fenster (Kiste o.ae.) zuerst schliessen - sonst gelten andere Platznummern
async function ensureInventoryWindow(bot) {
  if (bot.currentWindow && typeof bot.closeWindow === 'function') {
    try { bot.closeWindow(bot.currentWindow); } catch (e) { /* egal */ }
  }
}

function validSlot(n, { allowResult = false } = {}) {
  return Number.isInteger(n) && n >= (allowResult ? 0 : 1) && n < SLOT_COUNT;
}

async function moveItem(bot, from, to) {
  return runExclusive(bot, async () => {
    await ensureInventoryWindow(bot);
    const item = bot.inventory.slots[from];
    if (!item) throw new Error('Auf diesem Platz liegt nichts');
    await bot.moveSlotItem(from, to);
    return { ok: true };
  });
}

// Drop-Klick wie die Q-Taste: ein Item oder der ganze Stapel aus genau diesem Platz
async function dropItem(bot, slot, all) {
  return runExclusive(bot, async () => {
    await ensureInventoryWindow(bot);
    const item = bot.inventory.slots[slot];
    if (!item) throw new Error('Auf diesem Platz liegt nichts');
    const info = itemInfo(item, slot, bot.registry);
    const count = all ? item.count : 1;
    await bot.clickWindow(slot, all ? 1 : 0, 4);
    return { ok: true, item: info, count };
  });
}

function holdHotbar(bot, slot) {
  bot.setQuickBarSlot(slot - 36);
  return { ok: true };
}

// Essen/Trinken: Item aus dem Platz in die Hand nehmen (Schnellleiste: dorthin wechseln, sonst in
// den aktuellen Handplatz legen) und benutzen, bis es aufgegessen ist (wie Rechtsklick halten)
async function eatItem(bot, slot) {
  return runExclusive(bot, async () => {
    await ensureInventoryWindow(bot);
    const item = bot.inventory.slots[slot];
    if (!item) throw new Error('Auf diesem Platz liegt nichts');
    if (!isConsumable(item.name, bot.registry)) throw new Error('Das kann man nicht essen oder trinken');
    if (!ALWAYS_EDIBLE.includes(item.name) && typeof bot.food === 'number' && bot.food >= 20) {
      throw new Error('Der Account ist satt – essen geht erst wieder mit Hunger');
    }
    if (slot === 45) throw new Error('Aus der Zweithand geht das hier nicht – erst in die Schnellleiste legen');
    if (slot >= 36 && slot <= 44) {
      if (bot.quickBarSlot !== slot - 36) bot.setQuickBarSlot(slot - 36);
    } else {
      await bot.moveSlotItem(slot, 36 + (bot.quickBarSlot || 0));
    }
    const label = germanName(item.name) || item.displayName || item.name;
    await bot.consume();
    return { ok: true, label };
  }, 15000);
}

// ---------- Craften ----------
function findCraftingTable(bot) {
  try {
    const table = bot.registry && bot.registry.blocksByName && bot.registry.blocksByName.crafting_table;
    if (!table || typeof bot.findBlock !== 'function') return null;
    return bot.findBlock({ matching: table.id, maxDistance: 4 }) || null;
  } catch (e) {
    return null;
  }
}

// Wie oft laesst sich das Rezept mit dem Inventar hoechstens ausfuehren?
function maxCraftTimes(bot, recipe) {
  let times = Infinity;
  for (const d of recipe.delta || []) {
    if (d.count >= 0) continue;
    const have = bot.inventory.count(d.id, d.metadata === undefined ? null : d.metadata);
    times = Math.min(times, Math.floor(have / -d.count));
  }
  return Number.isFinite(times) ? Math.max(0, Math.min(times, 64)) : 0;
}

// Alles, was sich gerade craften laesst (mit Werkbank in Reichweite auch 3x3)
function craftableList(bot) {
  const table = findCraftingTable(bot);
  const items = (bot.registry && bot.registry.itemsArray) || [];
  const out = [];
  for (const it of items) {
    let recipes = [];
    try {
      recipes = bot.recipesFor(it.id, null, 1, table || null) || [];
    } catch (e) {
      recipes = [];
    }
    if (!recipes.length) continue;
    const r = recipes[0];
    const times = maxCraftTimes(bot, r);
    if (times < 1) continue;
    out.push({
      id: it.id,
      name: it.name,
      label: germanName(it.name) || it.displayName || it.name,
      perCraft: (r.result && r.result.count) || 1,
      maxTimes: times,
      needsTable: !!r.requiresTable,
    });
    if (out.length >= 200) break;
  }
  out.sort((a, b) => a.label.localeCompare(b.label, 'de'));
  return { table: !!table, items: out };
}

// Klick in einem offenen Fenster (button 0 = links, 1 = rechts; slot -999 = ausserhalb)
async function windowClick(bot, windowId, slot, button, fmt) {
  return runExclusive(bot, async () => {
    const win = bot.currentWindow;
    if (!win) throw new Error('Es ist kein Fenster mehr offen');
    if (win.id !== windowId) throw new Error('Das Fenster hat sich inzwischen geändert – bitte nochmal');
    const end = Math.min(win.slots.length, Number(win.inventoryEnd) || win.slots.length);
    if (slot !== -999 && !(slot >= 0 && slot < end)) throw new Error('Ungültiger Platz');
    if (slot === -999 && !win.selectedItem) throw new Error('Du hast gerade nichts auf der Maus');
    const before = itemInfo(slot === -999 ? win.selectedItem : win.slots[slot], slot, bot.registry, fmt);
    try {
      await bot.clickWindow(slot, button, 0);
    } catch (e) {
      // Fehler aus mineflayer (englisch) verstaendlich machen
      throw new Error(`Der Klick ging nicht durch (${String(e && e.message ? e.message : e).slice(0, 80)})`);
    }
    return { ok: true, item: before };
  }, 8000);
}

function windowClose(bot) {
  if (!bot.currentWindow) return { ok: true, wasOpen: false };
  bot.closeWindow(bot.currentWindow);
  return { ok: true, wasOpen: true };
}

async function craftItem(bot, itemId, times) {
  return runExclusive(bot, async () => {
    await ensureInventoryWindow(bot);
    const table = findCraftingTable(bot);
    const recipes = bot.recipesFor(itemId, null, 1, table || null) || [];
    if (!recipes.length) throw new Error('Dafür fehlen die Zutaten (oder eine Werkbank in der Nähe)');
    const recipe = recipes[0];
    const n = Math.max(1, Math.min(times, maxCraftTimes(bot, recipe)));
    await bot.craft(recipe, n, recipe.requiresTable ? table : null);
    const it = bot.registry.items[itemId];
    return { ok: true, times: n, name: it ? (germanName(it.name) || it.displayName) : String(itemId), count: n * ((recipe.result && recipe.result.count) || 1) };
  }, 30000);
}

module.exports = {
  isBoatEntity,
  createBoatDriver,
  inventorySnapshot,
  moveItem,
  dropItem,
  holdHotbar,
  eatItem,
  windowClick,
  windowClose,
  readEnchants,
  craftableList,
  craftItem,
  validSlot,
  iconFile,
  iconsAvailable,
  clearIconCache,
  germanName,
  plainChat,
  ICONS_DIR,
};
