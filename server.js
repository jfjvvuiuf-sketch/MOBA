const WebSocket=require("ws");
const PORT=process.env.PORT||3000;
const wss=new WebSocket.Server({port:PORT});
const rooms=new Map();
const send=(ws,d)=>ws.readyState===1&&ws.send(JSON.stringify(d));
const broadcast=(r,d)=>r.players.forEach(p=>send(p.ws,d));
function state(r){return [...r.players.values()].map(p=>({id:p.id,name:p.name,team:p.team,x:p.x,z:p.z,hp:p.hp,maxHp:p.maxHp,gold:p.gold,level:p.level,items:p.items}))}
function push(r){broadcast(r,{type:"state",players:state(r)})}
wss.on("connection",ws=>{
 let me=null,r=null;
 ws.on("message",raw=>{
  let m;try{m=JSON.parse(raw)}catch{return}
  if(m.type==="join"){
   const code=String(m.room||"VYRA1").toUpperCase();
   if(!rooms.has(code))rooms.set(code,{players:new Map()});
   r=rooms.get(code);if(r.players.size>=10)return send(ws,{type:"error",message:"Room full"});
   const b=[...r.players.values()].filter(p=>p.team==="blue").length;
   const team=b<=r.players.size-b?"blue":"red";
   me={id:Math.random().toString(36).slice(2),name:String(m.name||"Player").slice(0,16),team,x:team==="blue"?-42:42,z:0,hp:1000,maxHp:1000,gold:1000,level:1,items:[],ws};
   r.players.set(me.id,me);send(ws,{type:"joined",id:me.id,team,room:code});push(r);return;
  }
  if(!me||!r)return;
  if(m.type==="move"){if(Number.isFinite(+m.x)&&Number.isFinite(+m.z)){me.x=Math.max(-55,Math.min(55,+m.x));me.z=Math.max(-35,Math.min(35,+m.z));push(r)}}
  if(m.type==="buy"){const price=+m.price;if(!Number.isFinite(price)||price<0||me.gold<price)return;me.gold-=price;me.items.push({id:String(m.id),name:String(m.name),price,damage:+(m.damage||0),defense:+(m.defense||0),speed:+(m.speed||0),power:+(m.power||0)});me.maxHp+=+(m.defense||0)*4;me.hp=Math.min(me.maxHp,me.hp+(m.defense||0)*4);push(r)}
  if(m.type==="sell"){let i=+m.index;if(Number.isInteger(i)&&i>=0&&i<me.items.length){let it=me.items.splice(i,1)[0];me.gold+=Math.floor(it.price*.7);push(r)}}
  if(m.type==="attack"){let t=r.players.get(String(m.target));if(!t||t.team===me.team)return;let d=Math.hypot(t.x-me.x,t.z-me.z);if(d<=7){let dmg=100+me.items.reduce((a,i)=>a+i.damage+i.power,0);t.hp-=dmg;if(t.hp<=0){t.hp=0;me.gold+=300;me.level++;setTimeout(()=>{if(r&&r.players.has(t.id)){t.hp=t.maxHp;t.x=t.team==="blue"?-42:42;t.z=0;push(r)}},3000)}push(r)}}
  if(m.type==="skill"){broadcast(r,{type:"skill",player:me.id,skill:m.skill})}
 });
 ws.on("close",()=>{if(me&&r){r.players.delete(me.id);push(r);if(!r.players.size)rooms.delete([...rooms.entries()].find(([k,v])=>v===r)?.[0])}});
});
console.log("VYRA server listening on "+PORT);