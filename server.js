
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({
  port: PORT,
  host: "0.0.0.0"
});

const rooms = new Map();
const cooldowns = new Map();

const send = (ws, data) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
};

function broadcast(room, data) {
  room.players.forEach(p => send(p.ws, data));
}

function getState(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    team: p.team,
    x: p.x,
    z: p.z,
    hp: p.hp,
    maxHp: p.maxHp,
    gold: p.gold,
    level: p.level,
    items: p.items
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

function damage(room, attacker, target, amount) {
  if (!target || target.hp <= 0) return;

  const defense = target.items.reduce(
    (sum, item) => sum + item.defense, 0
  );

  const actualDamage = Math.max(10, amount - defense * 0.5);
  target.hp = Math.max(0, target.hp - actualDamage);

  if (target.hp === 0) {
    attacker.gold += 300;
    attacker.level++;

    setTimeout(() => {
      if (!room.players.has(target.id)) return;

      target.hp = target.maxHp;
      target.x = target.team === "blue" ? -42 : 42;
      target.z = 0;
      push(room);
    }, 3000);
  }

  push(room);
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

      me = {
        id: Math.random().toString(36).slice(2),
        name: String(m.name || "Player").slice(0, 16),
        team,
        x: team === "blue" ? -42 : 42,
        z: 0,
        hp: 1000,
        maxHp: 1000,
        gold: 1000,
        level: 1,
        items: [],
        ws
      };

      room.players.set(me.id, me);

      send(ws, {
        type: "joined",
        id: me.id,
        team,
        room: code
      });

      push(room);
      return;
    }

    if (!me || !room) return;

    if (m.type === "move") {
      const x = Number(m.x);
      const z = Number(m.z);

      if (!Number.isFinite(x) || !Number.isFinite(z)) return;

      me.x = Math.max(-55, Math.min(55, x));
      me.z = Math.max(-35, Math.min(35, z));

      push(room);
    }

    if (m.type === "buy") {
      const price = Number(m.price);

      if (!Number.isFinite(price) || price <= 0) return;
      if (me.gold < price || me.items.length >= 6) return;

      const item = {
        id: String(m.id),
        name: String(m.name).slice(0, 30),
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
      me.maxHp = Math.max(1000, me.maxHp - item.defense * 4);
      me.hp = Math.min(me.hp, me.maxHp);

      push(room);
    }

    if (m.type === "attack") {
      const target = room.players.get(String(m.target));

      if (!target || target.team === me.team) return;

      const distance = Math.hypot(
        target.x - me.x,
        target.z - me.z
      );

      if (distance > 7) return;

      const bonus = me.items.reduce(
        (sum, item) => sum + item.damage + item.power, 0
      );

      damage(room, me, target, 100 + bonus);
    }

    if (m.type === "skill") {
      const skill = Number(m.skill);

      if (![1, 2, 3].includes(skill)) return;

      const cooldownKey = me.id + ":" + skill;
      const now = Date.now();

      const cooldownsMs = {
        1: 3000,
        2: 5000,
        3: 12000
      };

      if (now - (cooldowns.get(cooldownKey) || 0) <
          cooldownsMs[skill]) {
        return;
      }

      const ranges = { 1: 9, 2: 12, 3: 14 };
      const powers = { 1: 180, 2: 130, 3: 300 };

      const target = enemies(room, me)
        .filter(p => Math.hypot(p.x - me.x, p.z - me.z) <= ranges[skill])
        .sort((a, b) =>
          Math.hypot(a.x - me.x, a.z - me.z) -
          Math.hypot(b.x - me.x, b.z - me.z)
        )[0];

      if (!target) return;

      cooldowns.set(cooldownKey, now);

      const bonus = me.items.reduce(
        (sum, item) => sum + item.power, 0
      );

      damage(room, me, target, powers[skill] + bonus);

      broadcast(room, {
        type: "skill",
        player: me.id,
        skill
      });
    }
  });

  ws.on("close", () => {
    if (!me || !room) return;

    room.players.delete(me.id);

    for (const key of cooldowns.keys()) {
      if (key.startsWith(me.id + ":")) cooldowns.delete(key);
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
