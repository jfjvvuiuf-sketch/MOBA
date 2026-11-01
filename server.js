
const WebSocket = require("ws");
const http = require("http");

const PORT = process.env.PORT || 10000;
const server = http.createServer();
const wss = new WebSocket.Server({ server });

const rooms = new Map();

const LANES = {
  EXP: [
    { x: -38, z: -24 },
    { x: -20, z: -24 },
    { x: 0, z: -24 },
    { x: 20, z: -24 },
    { x: 38, z: -24 }
  ],
  MID: [
    { x: -38, z: 0 },
    { x: -20, z: 0 },
    { x: 0, z: 0 },
    { x: 20, z: 0 },
    { x: 38, z: 0 }
  ],
  GOLD: [
    { x: -38, z: 24 },
    { x: -20, z: 24 },
    { x: 0, z: 24 },
    { x: 20, z: 24 },
    { x: 38, z: 24 }
  ]
};

const HERO_STATS = {
  rizal:       { hp: 3000, damage: 220, speed: 7 },
  bonifacio:   { hp: 3600, damage: 190, speed: 6 },
  lapulapu:    { hp: 3900, damage: 210, speed: 6 },
  gabriela:    { hp: 3200, damage: 240, speed: 7 },
  sora:        { hp: 3100, damage: 250, speed: 7 },
  mabini:      { hp: 2900, damage: 270, speed: 7 },
  diego:       { hp: 3500, damage: 210, speed: 6 },
  kudarat:     { hp: 3800, damage: 200, speed: 6 },
  gregoria:    { hp: 3300, damage: 230, speed: 7 },
  juanluna:    { hp: 3000, damage: 260, speed: 7 },
  antonio:     { hp: 3400, damage: 220, speed: 6 },
  teresa:      { hp: 3300, damage: 230, speed: 7 },
  jacinto:     { hp: 3100, damage: 250, speed: 7 },
  aguinaldo:   { hp: 3500, damage: 210, speed: 6 },
  urdaneta:    { hp: 3200, damage: 230, speed: 7 },
  quezon:      { hp: 3600, damage: 200, speed: 6 },
  osmena:      { hp: 3400, damage: 210, speed: 6 },
  delpilar:    { hp: 3500, damage: 220, speed: 6 },
  aguinaldo2:  { hp: 3500, damage: 210, speed: 6 },
  luna2:       { hp: 3300, damage: 250, speed: 7 },
  urduja:      { hp: 3800, damage: 230, speed: 6 },
  lamang:      { hp: 3700, damage: 240, speed: 6 },
  makiling:    { hp: 3200, damage: 260, speed: 7 },
  carpio:      { hp: 3500, damage: 230, speed: 6 },
  sarimanok:   { hp: 3100, damage: 270, speed: 8 },
  bakunawa:    { hp: 4000, damage: 260, speed: 5 },
  kapre:       { hp: 4500, damage: 220, speed: 5 },
  tikbalang:   { hp: 3400, damage: 250, speed: 8 },
  manananggal:{ hp: 3000, damage: 280, speed: 7 },
  diwata:      { hp: 3100, damage: 270, speed: 7 }
};

const SPELLS = ["flicker", "heal", "sprint", "flameshot"];

const ITEMS = {
  blade:    { price: 500, damage: 100 },
  armor:    { price: 450, defense: 100 },
  boots:    { price: 400, speed: 1.5 },
  crystal:  { price: 700, power: 180 },
  guardian: { price: 900, defense: 250, hp: 500 },
  greatsword:{ price: 1200, damage: 250 }
};

const distance = (a, b) =>
  Math.hypot(a.x - b.x, a.z - b.z);

function makeTower(id, team, lane, x, z) {
  return {
    id, team, lane, x, z,
    hp: 5000,
    maxHp: 5000,
    range: 13,
    damage: 250,
    lastAttack: 0,
    alive: true
  };
}

function createWorld() {
  const towers = [];

  for (const lane of Object.keys(LANES)) {
    const path = LANES[lane];

    towers.push(
      makeTower(`blue-${lane}-outer`, "blue", lane, -20, path[1].z),
      makeTower(`blue-${lane}-inner`, "blue", lane, -32, path[0].z),
      makeTower(`red-${lane}-outer`, "red", lane, 20, path[3].z),
      makeTower(`red-${lane}-inner`, "red", lane, 32, path[4].z)
    );
  }

  return {
    towers,
    minions: [],
    boss: {
      id: "ancient-bakununawa",
      name: "Ancient Bakunawa",
      x: 0,
      z: 12,
      hp: 12000,
      maxHp: 12000,
      alive: true,
      lastAttack: 0,
      respawnAt: 0
    },
    nextWave: Date.now() + 5000,
    wave: 0
  };
}

function createRoom(name) {
  return {
    name,
    players: new Map(),
    world: createWorld(),
    lastTick: Date.now()
  };
}

function getPlayerStats(player) {
  const base = HERO_STATS[player.hero] || {
    hp: 3200, damage: 220, speed: 6
  };

  let damage = base.damage;
  let defense = 0;
  let speed = base.speed;
  let bonusHp = 0;
  let power = 0;

  for (const itemId of player.items) {
    const item = ITEMS[itemId];
    if (!item) continue;
    damage += item.damage || 0;
    defense += item.defense || 0;
    speed += item.speed || 0;
    bonusHp += item.hp || 0;
    power += item.power || 0;
  }

  return {
    maxHp: base.hp + bonusHp,
    damage: damage + power,
    defense,
    speed
  };
}

function playerState(p) {
  const stats = getPlayerStats(p);

  return {
    id: p.id,
    name: p.name,
    hero: p.hero,
    heroName: p.heroName,
    heroRole: p.heroRole,
    spell: p.spell,
    team: p.team,
    x: p.x,
    z: p.z,
    hp: p.hp,
    maxHp: stats.maxHp,
    gold: p.gold,
    level: p.level,
    items: p.items,
    alive: p.alive,
    speed: stats.speed,
    bushHidden: p.bushHidden || false
  };
}

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

function findPlayer(room, id) {
  return room.players.get(id);
}

function damagePlayer(target, amount, attacker) {
  if (!target || !target.alive) return;

  const stats = getPlayerStats(target);
  const finalDamage = Math.max(1, amount - stats.defense * 0.25);

  target.hp -= finalDamage;
  target.bushHidden = false;

  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.respawnAt = Date.now() + 5000;

    if (attacker && attacker.team !== target.team) {
      attacker.gold += 300;
      attacker.level += 1;
    }
  }
}

function damageMinion(minion, amount, attacker) {
  if (!minion || !minion.alive) return;

  minion.hp -= amount;

  if (minion.hp <= 0) {
    minion.hp = 0;
    minion.alive = false;

    if (attacker && attacker.team !== minion.team) {
      attacker.gold += 35;
    }
  }
}

function damageTower(tower, amount, attacker) {
  if (!tower || !tower.alive) return;

  tower.hp -= amount;

  if (tower.hp <= 0) {
    tower.hp = 0;
    tower.alive = false;

    if (attacker) attacker.gold += 150;
  }
}

function spawnWave(room) {
  const world = room.world;
  world.wave++;

  for (const lane of Object.keys(LANES)) {
    for (const team of ["blue", "red"]) {
      for (let i = 0; i < 3; i++) {
        const blue = team === "blue";

        world.minions.push({
          id: `minion-${world.wave}-${lane}-${team}-${i}-${Date.now()}`,
          team,
          lane,
          type: i === 2 ? "ranged" : "melee",
          x: blue ? -39 : 39,
          z: LANES[lane][0].z,
          hp: i === 2 ? 550 : 800,
          maxHp: i === 2 ? 550 : 800,
          damage: i === 2 ? 100 : 140,
          range: i === 2 ? 7 : 2.5,
          speed: 3,
          alive: true,
          targetIndex: 1
        });
      }
    }
  }
}

function closestEnemyPlayer(room, team, source, range) {
  let best = null;
  let bestDistance = range;

  for (const p of room.players.values()) {
    if (!p.alive || p.team === team) continue;

    const d = distance(source, p);
    if (d < bestDistance) {
      best = p;
      bestDistance = d;
    }
  }

  return best;
}

function closestEnemyMinion(room, team, source, range) {
  let best = null;
  let bestDistance = range;

  for (const m of room.world.minions) {
    if (!m.alive || m.team === team) continue;

    const d = distance(source, m);
    if (d < bestDistance) {
      best = m;
      bestDistance = d;
    }
  }

  return best;
}

function tickRoom(room) {
  const now = Date.now();
  const world = room.world;

  // Player respawns
  for (const p of room.players.values()) {
    if (!p.alive && now >= p.respawnAt) {
      p.alive = true;
      p.hp = getPlayerStats(p).maxHp;
      p.x = p.team === "blue" ? -38 : 38;
      p.z = 0;
    }
  }

  // Spawn minion waves
  if (now >= world.nextWave) {
    spawnWave(room);
    world.nextWave = now + 25000;
  }

  // Move and fight minions
  for (const m of world.minions) {
    if (!m.alive) continue;

    const enemyMinion = closestEnemyMinion(room, m.team, m, 5);
    const enemyPlayer = closestEnemyPlayer(room, m.team, m, 4);

    if (enemyMinion) {
      if (now - (m.lastAttack || 0) > 1200) {
        damageMinion(enemyMinion, m.damage, null);
        m.lastAttack = now;
      }
      continue;
    }

    if (enemyPlayer) {
      if (now - (m.lastAttack || 0) > 1200) {
        damagePlayer(enemyPlayer, m.damage, null);
        m.lastAttack = now;
      }
      continue;
    }

    const path = LANES[m.lane];
    const target = path[m.targetIndex] ||
      path[path.length - 1];

    const dx = target.x - m.x;
    const dz = target.z - m.z;
    const len = Math.hypot(dx, dz) || 1;
    const step = m.speed * 0.1;

    m.x += (dx / len) * step;
    m.z += (dz / len) * step;

    if (distance(m, target) < 1.5 && m.targetIndex < path.length - 1) {
      m.targetIndex++;
    }

    const enemyTower = world.towers.find(t =>
      t.alive &&
      t.team !== m.team &&
      t.lane === m.lane &&
      distance(t, m) < 3
    );

    if (enemyTower && now - (m.lastAttack || 0) > 1200) {
      damageTower(enemyTower, m.damage, null);
      m.lastAttack = now;
    }
  }

  // Tower attacks
  for (const tower of world.towers) {
    if (!tower.alive || now - tower.lastAttack < 1000) continue;

    let target = null;
    let targetDistance = tower.range;

    for (const m of world.minions) {
      if (!m.alive || m.team === tower.team) continue;
      const d = distance(tower, m);
      if (d < targetDistance) {
        target = m;
        targetDistance = d;
      }
    }

    if (target) {
      damageMinion(target, tower.damage, null);
      tower.lastAttack = now;
      continue;
    }

    const player = closestEnemyPlayer(room, tower.team, tower, tower.range);

    if (player) {
      damagePlayer(player, tower.damage, null);
      tower.lastAttack = now;
    }
  }

  // Jungle boss respawn and attacks
  const boss = world.boss;

  if (!boss.alive && now >= boss.respawnAt) {
    boss.alive = true;
    boss.hp = boss.maxHp;
  }

  if (boss.alive) {
    const nearby = [...room.players.values()]
      .filter(p => p.alive && distance(p, boss) < 5);

    if (nearby.length && now - boss.lastAttack > 1800) {
      const target = nearby[0];
      damagePlayer(target, 300, null);
      boss.lastAttack = now;
    }
  }

  // Remove dead minions after a short time
  world.minions = world.minions.filter(m =>
    m.alive || now - (m.deadAt || now) < 3000
  );

  // Remove old dead minions immediately
  world.minions = world.minions.filter(m => m.alive);

  broadcast(room, {
    type: "state",
    players: [...room.players.values()].map(playerState),
    minions: world.minions,
    towers: world.towers,
    boss: world.boss,
    wave: world.wave
  });
}

function useSpell(room, p, data) {
  const now = Date.now();
  if (!p.alive || now - (p.lastSpell || 0) < 30000) return;

  // A player may only use the spell selected when joining.
  if (data.spell !== p.spell) return;

  const stats = getPlayerStats(p);

  if (p.spell === "heal") {
    p.hp = Math.min(stats.maxHp, p.hp + stats.maxHp * 0.25);
  }

  if (p.spell === "sprint") {
    p.speedUntil = now + 5000;
  }

  if (p.spell === "flicker") {
    const dx = Number(data.x) - p.x;
    const dz = Number(data.z) - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const amount = Math.min(9, len);

    p.x += (dx / len) * amount;
    p.z += (dz / len) * amount;
  }

  if (p.spell === "flameshot") {
    const enemy = closestEnemyPlayer(room, p.team, p, 22);
    if (enemy) damagePlayer(enemy, 350 + stats.damage * 0.3, p);
  }

  p.lastSpell = now;
}

function handleAction(room, p, data) {
  const now = Date.now();
  const world = room.world;

  if (!p.alive) return;

  if (data.type === "move") {
    const x = Number(data.x);
    const z = Number(data.z);

    if (!Number.isFinite(x) || !Number.isFinite(z)) return;

    const dx = x - p.x;
    const dz = z - p.z;
    const len = Math.hypot(dx, dz);

    // Limit movement per update to reduce teleporting.
    const stats = getPlayerStats(p);
    const sprinting = now < (p.speedUntil || 0);
    const maxStep = (sprinting ? stats.speed * 2 : stats.speed) * 0.15;

    if (len > maxStep) {
      p.x += (dx / len) * maxStep;
      p.z += (dz / len) * maxStep;
    } else {
      p.x = x;
      p.z = z;
    }

    p.x = Math.max(-45, Math.min(45, p.x));
    p.z = Math.max(-32, Math.min(32, p.z));

    // Bush zones
    p.bushHidden = (
      (Math.abs(p.x - 8) < 4 && Math.abs(p.z - 10) < 4) ||
      (Math.abs(p.x + 8) < 4 && Math.abs(p.z + 10) < 4)
    );
  }

  if (data.type === "attack") {
    if (now - (p.lastAttack || 0) < 650) return;

    const targetPlayer = findPlayer(room, data.target);

    if (targetPlayer && targetPlayer.team !== p.team &&
        targetPlayer.alive && distance(p, targetPlayer) <= 7) {
      damagePlayer(targetPlayer, getPlayerStats(p).damage, p);
      p.lastAttack = now;
      return;
    }

    const targetMinion = world.minions.find(m => m.id === data.target);

    if (targetMinion && targetMinion.team !== p.team &&
        targetMinion.alive && distance(p, targetMinion) <= 7) {
      damageMinion(targetMinion, getPlayerStats(p).damage, p);
      p.lastAttack = now;
      return;
    }

    const targetTower = world.towers.find(t => t.id === data.target);

    if (targetTower && targetTower.team !== p.team &&
        targetTower.alive && distance(p, targetTower) <= 7) {
      damageTower(targetTower, getPlayerStats(p).damage, p);
      p.lastAttack = now;
      return;
    }

    if (data.target === world.boss.id && world.boss.alive &&
        distance(p, world.boss) <= 7) {
      world.boss.hp -= getPlayerStats(p).damage;

      if (world.boss.hp <= 0) {
        world.boss.hp = 0;
        world.boss.alive = false;
        world.boss.respawnAt = now + 60000;
        p.gold += 500;
      }

      p.lastAttack = now;
    }
  }

  if (data.type === "skill") {
    const skill = Number(data.skill);
    const cooldowns = [0, 3500, 6000, 15000];

    if (![1, 2, 3].includes(skill)) return;
    if (now - (p.skillTimes?.[skill] || 0) < cooldowns[skill]) return;

    const stats = getPlayerStats(p);
    const ranges = { 1: 9, 2: 12, 3: 14 };
    const powers = { 1: 1.5, 2: 1.1, 3: 2.3 };

    const enemy = closestEnemyPlayer(room, p.team, p, ranges[skill]);

    if (enemy) {
      damagePlayer(enemy, stats.damage * powers[skill], p);
    }

    const minion = closestEnemyMinion(room, p.team, p, ranges[skill]);

    if (minion) {
      damageMinion(minion, stats.damage * powers[skill], p);
    }

    p.skillTimes[skill] = now;
  }

  if (data.type === "spell") {
    useSpell(room, p, data);
  }

  if (data.type === "buy") {
    const item = ITEMS[data.id];

    if (!item || p.gold < item.price || p.items.length >= 6) return;

    p.gold -= item.price;
    p.items.push(data.id);
    p.hp = Math.min(getPlayerStats(p).maxHp, p.hp + (item.hp || 0));
  }

  if (data.type === "sell") {
    const index = Number(data.index);

    if (!Number.isInteger(index) || index < 0 || index >= p.items.length) return;

    const [itemId] = p.items.splice(index, 1);
    p.gold += Math.floor(ITEMS[itemId].price * 0.5);
    p.hp = Math.min(p.hp, getPlayerStats(p).maxHp);
  }
}

wss.on("connection", ws => {
  ws.on("message", raw => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === "join") {
      const roomName = String(data.room || "VYRA-1").slice(0, 24);
      const name = String(data.name || "Player").slice(0, 20);
      const hero = HERO_STATS[data.hero] ? data.hero : "rizal";
      const spell = SPELLS.includes(data.spell) ? data.spell : "heal";

      let room = rooms.get(roomName);

      if (!room) {
        room = createRoom(roomName);
        rooms.set(roomName, room);
      }

      if (room.players.size >= 10) {
        send(ws, { type: "error", message: "Room is full!" });
        return;
      }

      const blueCount = [...room.players.values()]
        .filter(p => p.team === "blue").length;

      const redCount = [...room.players.values()]
        .filter(p => p.team === "red").length;

      const team = blueCount <= redCount ? "blue" : "red";
      const id = Math.random().toString(36).slice(2, 11);

      const player = {
        id,
        ws,
        name,
        hero,
        heroName: String(data.heroName || hero).slice(0, 30),
        heroRole: String(data.heroRole || "Fighter").slice(0, 20),
        spell,
        team,
        x: team === "blue" ? -38 : 38,
        z: 0,
        hp: (HERO_STATS[hero] || { hp: 3200 }).hp,
        gold: 1000,
        level: 1,
        items: [],
        alive: true,
        respawnAt: 0,
        lastAttack: 0,
        lastSpell: 0,
        speedUntil: 0,
        skillTimes: {}
      };

      room.players.set(id, player);
      ws.roomName = roomName;
      ws.playerId = id;

      send(ws, {
        type: "joined",
        id,
        team,
        player: playerState(player)
      });

      broadcast(room, {
        type: "notice",
        message: `${name} joined ${team.toUpperCase()} team!`
      });

      return;
    }

    const room = rooms.get(ws.roomName);
    const p = room && findPlayer(room, ws.playerId);

    if (!room || !p) return;

    handleAction(room, p, data);
  });

  ws.on("close", () => {
    const room = rooms.get(ws.roomName);
    if (!room) return;

    room.players.delete(ws.playerId);

    if (room.players.size === 0) {
      rooms.delete(room.name);
    }
  });
});

// Server simulation: 10 updates per second.
setInterval(() => {
  for (const room of rooms.values()) {
    tickRoom(room);
  }
}, 100);
 
server.listen(PORT, () => {
  console.log(`VYRA server running on port ${PORT}`);
});
