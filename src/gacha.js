const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');
const cheerio = require('cheerio');

const sessions = new Map();
const imageCache = new Map();
const BANNER = { name: 'Trainee Gacha', rateUp: ['Tamamo Cross', 'Inari One'] };

const TRAINEES = [
  ['Special Week',1],['Silence Suzuka',1],['Tokai Teio',1],['Maruzensky',1],['Fuji Kiseki',1],['Oguri Cap',1],['Gold Ship',1],['Vodka',1],['Daiwa Scarlet',1],['Taiki Shuttle',1],['Grass Wonder',1],['Hishi Amazon',1],['Mejiro McQueen',1],['El Condor Pasa',1],['T.M. Opera O',1],['Symboli Rudolf',1],['Air Groove',1],['Agnes Digital',1],['Seiun Sky',1],['Tamamo Cross',1],['Inari One',1],['Winning Ticket',1],['Haru Urara',1],['Matikanefukukitaru',1],
  ['Nice Nature',2],['Mejiro Ryan',2],['King Halo',2],['Mayano Top Gun',2],['Mihono Bourbon',2],['Biwa Hayahide',2],['Narita Brian',2],['Rice Shower',2],['Aston Machan',2],['Sakura Bakushin O',2],['Smart Falcon',2],['Fine Motion',2],['Kitasan Black',2],['Satono Diamond',2],['Twin Turbo',2],['Ikuno Dictus',2],
  ['Kitasan Black (Festival)',3],['Satono Diamond (Festival)',3],['Daiwa Scarlet (Wedding)',3],['Grass Wonder (Fantasy)',3],['Mejiro McQueen (End of the Line)',3],['Tamamo Cross',3],['Inari One',3],['Tokai Teio (Anime)',3],['Oguri Cap (Cookout)',3],['Special Week (Summer)',3]
];

function rollRarity(forceMin2 = false) { const r = Math.random(); if (r < .03) return 3; if (r < .21 || forceMin2) return 2; return 1; }
function pull(count) { const out=[]; for(let i=0;i<count;i++){const r=rollRarity(count===10&&i===9&&!out.some(x=>x.rarity>=2)); const p=TRAINEES.filter(x=>x[1]===r); const name=p[Math.floor(Math.random()*p.length)][0]; out.push({name,rarity:r,rateUp:r===3&&BANNER.rateUp.includes(name)});} return out; }
function rarityStars(r) { return '★'.repeat(r); }
function resultLine(r) { return `${rarityStars(r.rarity)} **${r.name}**${r.rateUp?' ✨ RATE UP':''}`; }
function norm(s) { return s.replace(/\(Original\)$/i,'').replace(/\s+/g,' ').trim().toLowerCase(); }
function slug(s) { return s.replace(/\s*\([^)]*\)/g,'').replace(/\./g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase(); }

async function fetchImageUrl(name) {
  if (imageCache.has(name)) return imageCache.get(name);
  const p=(async()=>{try{
    // Resolve the exact GameTora character/version instead of stripping variants.
    const list=await fetch('https://gametora.com/umamusume/characters',{signal:AbortSignal.timeout(5000),headers:{'User-Agent':'Fanservice-Gacha/1.0'}});
    if(list.ok){
      const $=cheerio.load(await list.text()); let href=null; const wanted=norm(name);
      $('a[href*="/umamusume/characters/"]').each((_,el)=>{if(!href&&norm($(el).text())===wanted) href=$(el).attr('href');});
      if(href){const page=await fetch(new URL(href,'https://gametora.com').href,{signal:AbortSignal.timeout(5000),headers:{'User-Agent':'Fanservice-Gacha/1.0'}}); if(page.ok){const html=await page.text(); const m=html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)||html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i); if(m)return m[1].replace(/&amp;/g,'&');}}
    }
    const page=await fetch(`https://gametora.com/umamusume/characters/${slug(name)}`,{signal:AbortSignal.timeout(5000),headers:{'User-Agent':'Fanservice-Gacha/1.0'}}); if(!page.ok)return null; const html=await page.text(); const m=html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)||html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i); return m?m[1].replace(/&amp;/g,'&'):null;
  }catch(_){return null;}})(); imageCache.set(name,p); return p;
}
async function fetchImage(name){const u=await fetchImageUrl(name); if(!u)return null; try{const r=await fetch(u,{signal:AbortSignal.timeout(5000),headers:{'User-Agent':'Fanservice-Gacha/1.0'}}); return r.ok?Buffer.from(await r.arrayBuffer()):null;}catch(_){return null;}}

function star(cx,cy,r){const pts=[];for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*.46:r;pts.push(`${cx+Math.cos(a)*rr},${cy+Math.sin(a)*rr}`);}return `<polygon points="${pts.join(' ')}" fill="#ffd43b" stroke="#a66b00" stroke-width="1.5"/>`;}
function stars(r,cx,cy){const size=17,gap=28,start=cx-(r-1)*gap/2;let s='';for(let i=0;i<r;i++)s+=star(start+i*gap,cy,size);return s;}

function card(result,image,x,y,w){const iw=w-24,ch=iw+62,clip=`c${x}${y}`,border=result.rarity===3?'#f3cf5b':'#cfd7e2';const img=image?`<image href="data:image/png;base64,${image.toString('base64')}" x="${x+12}" y="${y+12}" width="${iw}" height="${iw}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>`:`<rect x="${x+12}" y="${y+12}" width="${iw}" height="${iw}" rx="18" fill="#dbeafa"/>`;return `<defs><clipPath id="${clip}"><rect x="${x+12}" y="${y+12}" width="${iw}" height="${iw}" rx="18"/></clipPath></defs><rect x="${x}" y="${y}" width="${w}" height="${ch}" rx="22" fill="#f8fafc" stroke="${border}" stroke-width="4"/>${img}${stars(result.rarity,x+w/2,y+ch+22)}${result.rateUp?`<rect x="${x+5}" y="${y+5}" width="105" height="29" rx="7" fill="#ff5068"/><text x="${x+57}" y="${y+25}" text-anchor="middle" font-family="Arial" font-size="16" font-weight="800" fill="#fff">RATE UP</text>`:''}`;}

async function render(results,total){const imgs=await Promise.all(results.map(r=>fetchImage(r.name)));const W=1000,C=245,G=32,RG=92,rows=results.length===10?[3,2,3,2]:[results.length];let y=185,i=0,cards='';for(const n of rows){const rw=n*C+(n-1)*G,sx=(W-rw)/2;for(let j=0;j<n&&i<results.length;j++,i++)cards+=card(results[i],imgs[i],sx+j*(C+G),y,C);y+=365+RG;}const H=y+150;const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#57c8fa"/><stop offset="1" stop-color="#d9f5ff"/></linearGradient><linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ed44d"/><stop offset="1" stop-color="#4f9d37"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#sky)"/><path d="M0 ${H-420}Q500 ${H-500} 1000 ${H-400}V${H}H0Z" fill="url(#grass)"/><path d="M0 105H1000L970 155H30Z" fill="#fff" stroke="#7bd32c" stroke-width="8"/><text x="500" y="139" text-anchor="middle" font-family="Arial" font-size="36" font-weight="800" fill="#70401f">Scout Results</text>${cards}<rect x="260" y="${H-105}" width="480" height="52" rx="8" fill="#fff"/><text x="500" y="${H-71}" text-anchor="middle" font-family="Arial" font-size="24" font-weight="700" fill="#70401f">Trainee Exchange Pts: ${total}</text></svg>`;return sharp(Buffer.from(svg)).png().toBuffer();}

function session(id){if(!sessions.has(id))sessions.set(id,{pulls:0,last:[]});return sessions.get(id);}
function panel(id,notice=''){const s=session(id);const e=new EmbedBuilder().setTitle('🎴 UMA MUSUME — TRAINEE GACHA').setDescription(`**Banner:** ${BANNER.name}\n**Rate Up:** ${BANNER.rateUp.join(' / ')}\n\n**Rates**\n★★★ 3%\n★★☆ 18%\n★☆☆ 79%\n\n**Pulls:** ${s.pulls}\n${notice||'Choose a pull below. This is a free simulator — no Carrats are spent.'}`).setFooter({text:'10-pull guarantees at least ★★ • Fanservice Gacha Simulator'});const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gacha_1').setLabel('1 Pull').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('gacha_10').setLabel('10 Pulls').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId('gacha_last').setLabel('Last Results').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId('gacha_reset').setLabel('Reset').setStyle(ButtonStyle.Danger));return{embeds:[e],components:[row]};}
async function send(interaction,results,total){const png=await render(results,total);const file=new AttachmentBuilder(png,{name:'gacha-results.png'});const p=panel(interaction.user.id,`**${results.length===10?'10-PULL RESULTS':'PULL RESULT'}**\n${results.map(resultLine).join('\n')}\n\n🎯 Total simulated pulls: **${total}**`);p.embeds[0].setImage('attachment://gacha-results.png');return{embeds:[p.embeds[0]],files:[file],components:p.components};}
function handleCommand(interaction){if(interaction.commandName!=='uma-gacha')return false;return interaction.reply(panel(interaction.user.id));}
async function handleButton(interaction){if(!interaction.isButton()||!interaction.customId.startsWith('gacha_'))return false;const s=session(interaction.user.id);if(interaction.customId==='gacha_reset'){s.pulls=0;s.last=[];return interaction.update(panel(interaction.user.id,'♻️ Simulator reset.'));}if(interaction.customId==='gacha_last'){if(!s.last.length)return interaction.reply({content:'No pulls yet. Hit **1 Pull** or **10 Pulls** first.',ephemeral:true});await interaction.deferReply({ephemeral:true});return interaction.editReply(await send(interaction,s.last,s.pulls));}const n=interaction.customId==='gacha_10'?10:1,r=pull(n);s.pulls+=n;s.last=r;await interaction.deferUpdate();return interaction.editReply(await send(interaction,r,s.pulls));}
module.exports={handleCommand,handleButton};
