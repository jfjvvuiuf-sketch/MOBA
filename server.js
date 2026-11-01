

const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({
  port: PORT,
  host: "0.0.0.0"
});

const rooms = new Map();
const cooldowns = new Map();

const HERO_STATS = {
  rizal:       { hp: 1050, damage: 115, speed: 1.0 },
  bonifacio:   { hp: 1250, damage: 125, speed: 0.9 },
  lapulapu:    { hp: 1400, damage: 140, speed: 0.9 },
  gabriela:    { hp: 1100, damage: 120, speed: 1.0 },
  sora:        { hp: 1000, damage: 130, speed: 1.1 },
  mabini:      { hp: 1000, damage: 100, speed: 1.0 },
  diego:       { hp: 1150, damage: 125, speed: 1.0 },
  kudarat:     { hp: 1350, damage: 135, speed: 0.9 },
  gregoria:    { hp: 1100, damage: 115, speed: 1.0 },
  juanluna:    { hp: 1000, damage: 145, speed: 1.0 },
  antonio:     { hp: 1200, damage: 125, speed: 0.9 },
  teresa:      { hp: 1100, damage: 120, speed: 1.0 },
  jacinto:     { hp: 1050, damage: 130, speed: 1.1 },
  aguinaldo:   { hp: 1200, damage: 120, speed: 1.0 },
  urdaneta:    { hp: 1100, damage: 115, speed: 1.0 },
  quezon:      { hp: 1200, damage: 110, speed: 0.9 },
  osmena:      { hp: 1100, damage: 110, speed: 1.0 },
  delpilar:    { hp: 1200, damage: 130, speed: 0.9 },
  aguinaldo2:  { hp: 1200, damage: 120, speed: 1.0 },
  luna2:       { hp: 1100, damage: 140, speed: 1.0 },
  urduja:      { hp: 1300, damage: 135, speed: 0.9 },
  lamang:      { hp: 1200, damage: 140, speed: 1.0 },
  makiling:    { hp: 1100, damage: 115, speed: 1.0 },
  carpio:      { hp: 1250, damage: 125, speed: 0.9 },
  sarimanok:   { hp: 1000, damage: 135, speed: 1.1 },
  bakunawa:    { hp: 1400, damage: 140, speed: 0.8 },
  kapre:       { hp: 1500, damage: 130, speed: 0.8 },
  tikbalang:   { hp: 1200, damage: 135, speed: 1.1 },
  manananggal: { hp: 1000, damage: 150, speed: 1.0 },
  diwata:      { hp: 1050, damage: 120, speed: 1.1 }
};

const VALID_SPELLS = [
  "flicker",
  "heal",
  "sprint",
  "flameshot"
];

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  for (const player of room.players.values()) {
    send(player.ws, data);
  }
}

function getState(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    team: p.team,
    hero: p.hero,
    heroName: p.heroName,
    heroRole: p.heroRole,
    spell: p.spell,
    x: p.x,
    z: p.z,
    hp: p.hp,
    maxHp: p.maxHp,
    gold: p.gold,
    level: p.level,
    items: p.items,
    speedUntil: p.speedUntil || 0
  }));
}

function push(room) {
  broadcast(room, {
    type: "state",
    players: getState(room)
  });
}

function enemies(room, player) {
  return [...room.players.values()].filter(
    p => p.team !== player.team && p.hp > 0
  );
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function itemBonus(player, key) {
  return player.items.reduce(
    (sum, item) => sum + (Number(item[key]) || 0), 0
  );
}

function damage(room, attacker, target, amount) {
  if (!target || target.hp <= 0) return;

  const defense = itemBonus(target, "defense");
  const actualDamage = Math.max(10, amount - defense * 0.5);

  target.hp = Math.max(0, target.hp - actualDamage);

  if (target.hp === 0) {
    attacker.gold += 300;
    attacker.level += 1;

    broadcast(room, {
      type: "elimination",
      attacker: attacker.id,
      target: target.id
    });

    setTimeout(() => {
      if (!room.players.has(target.id)) return;

      target.hp = target.maxHp;
      target.x = target.team === "blue" ? -42 : 42;
      target.z = 0;

      push(room);
    }, 5000);
  }

  push(room);
}

function canUse(player, action, cooldownMs) {
  const key = player.id + ":" + action;
  const now = Date.now();
  const last = cooldowns.get(key) || 0;

  if (now - last < cooldownMs) return false;

  cooldowns.set(key, now);
  return true;
}

wss.on("connection", ws => {
  let me = null;
  let room = null;

  ws.on("message", raw => {
    let m;

    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }

    if (m.type === "join") {
      if (me) return;

      const code = String(m.room || "VYRA1")
        .toUpperCase()
        .slice(0, 16);

      if (!rooms.has(code)) {
        rooms.set(code, { players: new Map() });
      }

      room = rooms.get(code);

      if (room.players.size >= 10) {
        return send(ws, {
          type: "error",
          message: "Room full!"
        });
      }

      const blue = [...room.players.values()]
        .filter(p => p.team === "blue").length;

      const red = room.players.size - blue;
      const team = blue <= red ? "blue" : "red";

      const hero = String(m.hero || "rizal").toLowerCase();
      const stats = HERO_STATS[hero] || HERO_STATS.rizal;

      const spell = VALID_SPELLS.includes(
        String(m.spell || "").toLowerCase()
      ) ? String(m.spell).toLowerCase() : "heal";

      me = {
        id: Math.random().toString(36).slice(2),
        name: String(m.name || "Player").slice(0, 16),
        team,

        hero,
        heroName: String(m.heroName || hero).slice(0, 30),
        heroRole: String(m.heroRole || "Fighter").slice(0, 20),
        spell,

        x: team === "blue" ? -42 : 42,
        z: 0,

        hp: stats.hp,
        maxHp: stats.hp,
        baseDamage: stats.damage,
        baseSpeed: stats.speed,

        gold: 1000,
        level: 1,
        items: [],
        speedUntil: 0,

        ws
      };

      room.players.set(me.id, me);

      send(ws, {
        type: "joined",
        id: me.id,
        team,
        room: code,
        hero,
        spell
      });

      push(room);
      return;
    }

    if (!me || !room) return;

    if (m.type === "move") {
      const x = Number(m.x);
      const z = Number(m.z);

      if (!Number.isFinite(x) || !Number.isFinite(z)) return;

      const maxStep = 4;
      const dx = x - me.x;
      const dz = z - me.z;
      const step = Math.hypot(dx, dz);

      if (step > maxStep) {
        me.x += dx / step * maxStep;
        me.z += dz / step * maxStep;
      } else {
        me.x = x;
        me.z = z;
      }

      me.x = Math.max(-55, Math.min(55, me.x));
      me.z = Math.max(-35, Math.min(35, me.z));

      push(room);
    }

    if (m.type === "buy") {
      const price = Number(m.price);

      if (!Number.isFinite(price) || price <= 0) return;
      if (me.gold < price || me.items.length >= 6) return;

      const item = {
        id: String(m.id || "item").slice(0, 30),
        name: String(m.name || "Item").slice(0, 30),
        price,
        damage: Math.max(0, Number(m.damage) || 0),
        defense: Math.max(0, Number(m.defense) || 0),
        speed: Math.max(0, Number(m.speed) || 0),
        power: Math.max(0, Number(m.power) || 0)
      };

      me.gold -= price;
      me.items.push(item);

      me.maxHp += item.defense * 4;
      me.hp = Math.min(me.maxHp, me.hp + item.defense * 4);

      push(room);
    }

    if (m.type === "sell") {
      const index = Number(m.index);

      if (!Number.isInteger(index)) return;
      if (index < 0 || index >= me.items.length) return;

      const item = me.items.splice(index, 1)[0];

      me.gold += Math.floor(item.price * 0.7);
      me.maxHp = Math.max(
        HERO_STATS[me.hero]?.hp || 1000,
        me.maxHp - item.defense * 4
      );
      me.hp = Math.min(me.hp, me.maxHp);

      push(room);
    }

    if (m.type === "attack") {
      if (!canUse(me, "attack", 650)) return;

      const target = room.players.get(String(m.target));

      if (!target || target.team === me.team) return;
      if (distance(me, target) > 7) return;

      const bonus =
        itemBonus(me, "damage") +
        itemBonus(me, "power");

      damage(
        room,
        me,
        target,
        me.baseDamage + bonus
      );
    }

    if (m.type === "skill") {
      const skill = Number(m.skill);

      if (![1, 2, 3].includes(skill)) return;

      const cooldownsMs = {
        1: 3500,
        2: 6000,
        3: 15000
      };

      if (!canUse(me, "skill" + skill, cooldownsMs[skill])) {
        return send(ws, {
          type: "notice",
          message: "Skill is on cooldown!"
        });
      }

      const ranges = {
        1: 9,
        2: 12,
        3: 14
      };

      const powers = {
        1: 180,
        2: 130,
        3: 300
      };

      const target = enemies(room, me)
        .filter(p => distance(p, me) <= ranges[skill])
        .sort((a, b) => distance(a, me) - distance(b, me))[0];

      if (!target) {
        cooldowns.delete(me.id + ":skill" + skill);

        return send(ws, {
          type: "notice",
          message: "No enemy in skill range!"
        });
      }

      const bonus = itemBonus(me, "power");

      damage(room, me, target, powers[skill] + bonus);

      broadcast(room, {
        type: "skill",
        player: me.id,
        skill
      });
    }

    if (m.type === "spell") {
      const spell = String(m.spell || me.spell).toLowerCase();

      if (!VALID_SPELLS.includes(spell)) return;

      const cooldownsMs = {
        flicker: 15000,
        heal: 25000,
        sprint: 20000,
        flameshot: 18000
      };

      if (!canUse(me, "spell", cooldownsMs[spell])) {
        return send(ws, {
          type: "notice",
          message: "Spell is on cooldown!"
        });
      }

      if (spell === "flicker") {
        const x = Number(m.x);
        const z = Number(m.z);

        if (!Number.isFinite(x) || !Number.isFinite(z)) {
          cooldowns.delete(me.id + ":spell");
          return;
        }

        const dx = x - me.x;
        const dz = z - me.z;
        const len = Math.hypot(dx, dz) || 1;
        const range = Math.min(len, 9);

        me.x += dx / len * range;
        me.z += dz / len * range;

        me.x = Math.max(-55, Math.min(55, me.x));
        me.z = Math.max(-35, Math.min(35, me.z));
      }

      if (spell === "heal") {
        me.hp = Math.min(
          me.maxHp,
          me.hp + Math.floor(me.maxHp * 0.22)
        );
      }

      if (spell === "sprint") {
        me.speedUntil = Date.now() + 5000;
      }

      if (spell === "flameshot") {
        const target = enemies(room, me)
          .filter(p => distance(p, me) <= 22)
          .sort((a, b) => distance(a, me) - distance(b, me))[0];

        if (!target) {
          cooldowns.delete(me.id + ":spell");

          return send(ws, {
            type: "notice",
            message: "No enemy in Flameshot range!"
          });
        }

        damage(room, me, target, 350 + itemBonus(me, "power"));
      }

      broadcast(room, {
        type: "spell",
        player: me.id,
        spell
      });

      push(room);
    }
  });

  ws.on("close", () => {
    if (!me || !room) return;

    room.players.delete(me.id);

    for (const key of cooldowns.keys()) {
      if (key.startsWith(me.id + ":")) {
        cooldowns.delete(key);
      }
    }

    push(room);

    if (room.players.size === 0) {
      for (const [code, value] of rooms) {
        if (value === room) rooms.delete(code);
      }
    }
  });
});

console.log("VYRA server running on port " + PORT);
