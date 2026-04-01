// ╔══════════════════════════════════════════════════════════════╗
// ║           WINGO ORACLE — TELEGRAM BOT by GAINEO             ║
// ║      Replace BOT_TOKEN below with your new token            ║
// ╚══════════════════════════════════════════════════════════════╝

const TelegramBot = require('node-telegram-bot-api');
const admin       = require('firebase-admin');
const fetch       = require('node-fetch');

// ─── CONFIG ────────────────────────────────────────────────────
const BOT_TOKEN   = process.env.BOT_TOKEN || '8320559806:AAGSPQm52m4KLE6Ok5bqV0asEB4IA_w5Nus';
const ADMIN_IDS   = (process.env.ADMIN_IDS || '').split(',').map(Number).filter(Boolean);
// Firebase service account JSON — set as env var FIREBASE_CRED (stringified JSON)
// OR put your serviceAccountKey.json path here:
let firebaseApp;
try {
  const cred = process.env.FIREBASE_CRED
    ? JSON.parse(process.env.FIREBASE_CRED)
    : require('./serviceAccountKey.json');
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(cred),
    databaseURL: 'https://gaineo-default-rtdb.firebaseio.com/'
  });
} catch(e) {
  console.error('⚠️  Firebase init failed:', e.message);
  console.error('Set FIREBASE_CRED env var or add serviceAccountKey.json');
}
const db = admin.database();

// ─── WINGO APIs ────────────────────────────────────────────────
const APIS = {
  '30s': {
    h: 'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json',
    c: 'https://draw.ar-lottery01.com/WinGo/WinGo_30S.json'
  },
  '1m': {
    h: 'https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json',
    c: 'https://draw.ar-lottery01.com/WinGo/WinGo_1M.json'
  }
};

// ─── BOT INIT ──────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// In-memory session store per chat
const sessions = {};
function getSession(chatId) {
  if (!sessions[chatId]) {
    sessions[chatId] = { mode: '1m', server: 3, history: [] };
  }
  return sessions[chatId];
}

// ─── HELPERS ───────────────────────────────────────────────────
function sz(n)  { return n >= 5 ? 'Big' : 'Small'; }
function nxP(p) {
  if (!p) return 'Next';
  const m = String(p).match(/(\d+)$/);
  if (m) {
    const n = parseInt(m[1]) + 1;
    return String(p).slice(0, -m[1].length) + String(n).padStart(m[1].length, '0');
  }
  return 'Next';
}

// ─── FETCH GAME DATA ───────────────────────────────────────────
async function fetchGames(mode) {
  const urls = APIS[mode];
  for (const url of [urls.h, urls.c]) {
    try {
      const res = await fetch(url, { timeout: 8000 });
      const txt = await res.text();
      let d;
      try { d = JSON.parse(txt); } catch(e) { continue; }
      let arr = [];
      if (Array.isArray(d)) arr = d;
      else {
        const paths = [
          x => x?.data?.gameslist, x => x?.data?.list,
          x => x?.data, x => x?.gameslist, x => x?.list, x => x?.result
        ];
        for (const p of paths) {
          try { const r = p(d); if (Array.isArray(r) && r.length) { arr = r; break; } } catch(e) {}
        }
        if (!arr.length) {
          for (const k of Object.keys(d)) {
            if (Array.isArray(d[k]) && d[k].length && typeof d[k][0] === 'object') {
              arr = d[k]; break;
            }
          }
        }
      }
      const out = [];
      for (const g of arr) {
        if (!g || typeof g !== 'object') continue;
        const per = g.issueNumber || g.period || g.issue || g.id || '';
        let num = null;
        for (const f of ['number','result','num','openResult','winNumber','drawNumber']) {
          if (g[f] != null) { const n = parseInt(g[f]); if (!isNaN(n) && n >= 0 && n <= 9) { num = n; break; } }
        }
        if (num !== null) out.push({ p: String(per), n: num });
      }
      if (out.length > 0) return out;
    } catch(e) { continue; }
  }
  return [];
}

// ════════════════════════════════════════════════════════════════
//   28-MODEL PREDICTION ENGINE (ported from HTML)
// ════════════════════════════════════════════════════════════════
function engine(nums, server = 3, preds = []) {
  if (nums.length < 4) return { num: 5, sz: 'Big', cf: 50, skip: false, note: '', agr: 14, total: 28 };
  const szs = nums.map(sz);
  const N = nums.length;
  const mp = {}, mc = {};

  // 1. MARKOV (2nd-order with 1st-order fallback)
  {
    const t1 = { Big: { Big: 0, Small: 0 }, Small: { Big: 0, Small: 0 } };
    const t2 = {};
    for (let i = 0; i < N - 1; i++) t1[szs[i]][szs[i+1]] = (t1[szs[i]][szs[i+1]] || 0) + 1;
    for (let i = 0; i < N - 2; i++) { const c = szs[i+2]+','+szs[i+1]; if (!t2[szs[i]]) t2[szs[i]] = {}; t2[szs[i]][c] = (t2[szs[i]][c] || 0) + 1; }
    let mkv = 'Big', mkvC = 0;
    if (N >= 2) { const ctx2 = szs[1]+','+szs[0]; const bC = (t2.Big&&t2.Big[ctx2])||0, sC = (t2.Small&&t2.Small[ctx2])||0, tt2 = bC+sC; if (tt2 >= 4) { const pb = bC/tt2; mkv = pb>.5?'Big':'Small'; mkvC = Math.abs(pb-.5)*2; } }
    if (mkvC < 0.1) { const L = szs[0], tt = (t1.Big[L]||0)+(t1.Small[L]||0); if (tt > 0) { const pb = (t1.Big[L]||0)/tt; mkv = pb>.5?'Big':'Small'; mkvC = Math.abs(pb-.5)*2; } }
    mp.Markov = mkv; mc.Markov = Math.min(mkvC, 1);
  }

  // 2. FREQUENCY (exp-decay dual window)
  {
    const fw30 = szs.slice(0,30).reduce((a,s,i)=>{const w=Math.exp(-i*.05);a.t+=w;a.b+=(s==='Big'?1:0)*w;return a},{b:0,t:0});
    const fw10 = szs.slice(0,10).reduce((a,s,i)=>{const w=Math.exp(-i*.12);a.t+=w;a.b+=(s==='Big'?1:0)*w;return a},{b:0,t:0});
    const r = fw30.b/fw30.t*.5 + fw10.b/fw10.t*.5;
    mp.Frequency = r>.55?'Small':r<.45?'Big':szs[0]==='Big'?'Small':'Big';
    mc.Frequency = Math.min(Math.abs(r-.5)*4, 1);
  }

  // 3. STREAK + ALTERNATING
  {
    let sk = 1; for (let i = 1; i < N; i++) { if (szs[i] === szs[0]) sk++; else break; }
    let alt = 0; for (let i = 0; i < Math.min(N-1,12); i++) { if (szs[i] !== szs[i+1]) alt++; }
    const isAlt = alt >= 10;
    if (isAlt)     { mp.Streak = szs[0]==='Big'?'Small':'Big'; mc.Streak = .82; }
    else if (sk>=5){ mp.Streak = szs[0]==='Big'?'Small':'Big'; mc.Streak = Math.min(.9, sk*.12); }
    else if (sk>=3){ mp.Streak = szs[0]==='Big'?'Small':'Big'; mc.Streak = .55; }
    else if (sk===2){ mp.Streak = szs[0]; mc.Streak = .28; }
    else           { mp.Streak = szs[0]==='Big'?'Small':'Big'; mc.Streak = .22; }
  }

  // 4. TREND (multi-window)
  {
    const avg = l => nums.slice(0,l).reduce((a,b)=>a+b,0)/Math.min(N,l);
    const [a3,a6,a12,a20,a40] = [avg(3),avg(6),avg(12),avg(20),avg(40)];
    const s1 = (a3-a6)*.4+(a6-a12)*.3+(a12-a20)*.2+(a20-a40)*.1;
    mp.Trend = s1>0.22?'Big':s1<-0.22?'Small':szs[0]==='Big'?'Small':'Big';
    mc.Trend = Math.min(Math.abs(s1)/2.2, 1);
  }

  // 5. MOMENTUM (EMA crossover)
  {
    let vel=0,wt=0; for(let i=0;i<Math.min(N-1,16);i++){const w=Math.exp(-i*.15);vel+=(nums[i]-nums[i+1])*w;wt+=w;}
    const v = wt>0?vel/wt:0;
    const ema = l => { let e=nums[Math.min(N-1,l-1)]; const a=2/(l+1); for(let i=Math.min(N-2,l-2);i>=0;i--)e=nums[i]*a+e*(1-a); return e; };
    const cross = ema(3)-ema(8);
    const mom = v*.45+cross*.55;
    mp.Momentum = mom>0.15?'Big':mom<-0.15?'Small':szs[0]==='Big'?'Small':'Big';
    mc.Momentum = Math.min(Math.abs(mom)/1.5, 1);
  }

  // 6. MEAN REVERSION (Bollinger)
  {
    const win=Math.min(N,20),sl=nums.slice(0,win),mean=sl.reduce((a,b)=>a+b,0)/win;
    const std=Math.sqrt(sl.reduce((a,b)=>a+Math.pow(b-mean,2),0)/win)||1;
    const z=(nums[0]-mean)/std;
    const longMean=nums.slice(0,Math.min(N,50)).reduce((a,b)=>a+b,0)/Math.min(N,50);
    const revScore=-z*.6-(nums[0]-longMean)*.08;
    mp.MeanRev = revScore>0.28?'Big':revScore<-0.28?'Small':szs[0]==='Big'?'Small':'Big';
    mc.MeanRev = Math.min(Math.abs(revScore)/2.5, 1);
  }

  // 7. HOT/COLD
  {
    const freq=Array(10).fill(0); nums.slice(0,60).forEach((n,i)=>{freq[n]+=Math.exp(-i*.04);});
    const bH=freq.slice(5).reduce((a,b)=>a+b,0),sH=freq.slice(0,5).reduce((a,b)=>a+b,0);
    const r=bH/(bH+sH||1);
    mp.HotCold = r>.56?'Small':r<.44?'Big':szs[0]==='Big'?'Small':'Big';
    mc.HotCold = Math.min(Math.abs(r-.5)*4, 1);
  }

  // 8. GAP THEORY
  {
    let gB=0,gS=0,fB=false,fS=false;
    for(let i=0;i<Math.min(N,80);i++){if(!fB){if(szs[i]==='Big')fB=true;else gB++;}if(!fS){if(szs[i]==='Small')fS=true;else gS++;}}
    if(gB>=3&&gB>gS){mp.GapTheory='Big';mc.GapTheory=Math.min(gB/8,.9);}
    else if(gS>=3&&gS>gB){mp.GapTheory='Small';mc.GapTheory=Math.min(gS/8,.9);}
    else{mp.GapTheory=gS>gB?'Small':'Big';mc.GapTheory=Math.min(Math.abs(gS-gB)/6,.5);}
  }

  // 9. PATTERN DNA (depth 2-6)
  {
    const pts={};
    for(let len=2;len<=6;len++)for(let i=0;i<N-len;i++){const k=szs.slice(i+1,i+1+len).join('|');if(!pts[k])pts[k]={B:0,S:0};szs[i]==='Big'?pts[k].B++:pts[k].S++;}
    let best=null,bSc=0;
    for(let len=6;len>=2;len--){const k=szs.slice(0,len).join('|');if(pts[k]){const t=pts[k].B+pts[k].S,e=t*.5,chi2=t>0?Math.pow(pts[k].B-e,2)/e+Math.pow(pts[k].S-e,2)/e:0,sc=chi2*(1+len*.18);if(sc>bSc){bSc=sc;best=pts[k];}}}
    if(best&&bSc>2){mp.PatternDNA=best.B>best.S?'Big':'Small';mc.PatternDNA=Math.min(Math.abs(best.B-best.S)/(best.B+best.S+.5),1);}
    else{mp.PatternDNA=szs[0]==='Big'?'Small':'Big';mc.PatternDNA=.14;}
  }

  // 10. CYCLE SCAN (k=2-10)
  {
    let cyV=szs[0]==='Big'?'Small':'Big',cyC=0;
    for(let k=2;k<=10;k++){if(N<k*3)continue;let mB=0,tot=0;for(let i=k;i<Math.min(N,k*10);i++){if(szs[i]===szs[i-k])mB++;tot++;}if(tot>=8){const sc=Math.abs(mB/tot-.5)*2;if(sc>cyC){cyC=sc;cyV=mB/tot>.5?szs[0]:szs[0]==='Big'?'Small':'Big';}}}
    mp.CycleScan=cyV;mc.CycleScan=Math.min(cyC,1);
  }

  // 11. RSI
  {
    const period=Math.min(N-1,14);let gains=0,losses=0,cnt=0;
    for(let i=0;i<period;i++){const d=nums[i]-nums[i+1];if(d>0)gains+=d;else losses+=Math.abs(d);cnt++;}
    const ag=gains/(cnt||1),al=losses/(cnt||1),rs=al>.0001?ag/al:99,rsi=100-100/(1+rs);
    mp.Oscillator=rsi>68?'Small':rsi<32?'Big':rsi>55?'Small':rsi<45?'Big':szs[0]==='Big'?'Small':'Big';
    mc.Oscillator=Math.min(Math.abs(rsi-50)/50*1.5,1);
  }

  // 12. TRAP DETECTOR
  {
    const w5=szs.slice(0,5),bP5=w5.filter(s=>s==='Big').length/5;
    const longStreak=szs.slice(0,6).every(s=>s===szs[0]);
    if(bP5===1||bP5===0||longStreak){mp.TrapDetect=szs[0]==='Big'?'Small':'Big';mc.TrapDetect=longStreak?.82:.88;}
    else{mp.TrapDetect=szs[0]==='Big'?'Small':'Big';mc.TrapDetect=.18;}
  }

  // 13. DEEP NET (simplified 12→4→1)
  {
    const inp=nums.slice(0,12).map(n=>(n-4.5)/4.5);
    const W1=[[.38,-.24,.52,-.18,.44,-.36,.58,-.28,.41,-.15,.49,-.34],[-.33,.54,-.29,.61,-.22,.47,-.27,.58,-.37,.24,-.51,.42],[.45,-.37,.28,-.55,.36,-.46,.22,-.49,.41,-.27,.35,-.46],[-.29,.58,-.42,.36,-.51,.31,-.23,.46,-.35,.54,-.20,.57]];
    const h1=W1.map((row,j)=>{let s=0;row.forEach((w,i)=>{s+=i<inp.length?w*inp[i]:0;});return Math.tanh(s);});
    const nO=1/(1+Math.exp(-(h1[0]*.68-h1[1]*.52+h1[2]*.44-h1[3]*.38)));
    mp.DeepNet=nO>.5?'Big':'Small';mc.DeepNet=Math.abs(nO-.5)*2;
  }

  // 14. LSTM
  {
    let cs=0,hs=0;
    for(let i=Math.min(N-1,24);i>=0;i--){const x=nums[i]/9;const fg=1/(1+Math.exp(-(hs*.62+x*.36+.06))),ig=1/(1+Math.exp(-(hs*.46-x*.54+.09))),cc=Math.tanh(hs*.38+x*.62);cs=fg*cs+ig*cc;const og=1/(1+Math.exp(-(hs*.56+x*.26+cs*.12)));hs=og*Math.tanh(cs);}
    const lo=1/(1+Math.exp(-hs*1.9));mp.LSTM=lo>.5?'Big':'Small';mc.LSTM=Math.abs(lo-.5)*2;
  }

  // 15. TRANSFORMER (3 heads)
  {
    const heads=[5,10,20],agg=heads.reduce((acc,hs2,hi)=>{const sq=nums.slice(0,Math.min(N,hs2)).map(n=>n/9);if(sq.length<2)return acc;let at=0,tw=0;for(let i=0;i<sq.length;i++){const w=Math.exp(-i*(.08+hi*.03))*(1-Math.abs(sq[i]-sq[0]));at+=sq[i]*w;tw+=w;}const hv=tw>0?at/tw:.5,hw=[1.8,1,.6][hi];acc.v+=hv*hw;acc.w+=hw;return acc;},{v:0,w:0});
    const tv=agg.w>0?agg.v/agg.w:.5;mp.Transformer=tv>.52?'Big':tv<.48?'Small':szs[0]==='Big'?'Small':'Big';mc.Transformer=Math.abs(tv-.5)*2.5;
  }

  // 16. BAYESIAN
  {
    let pr=.5;szs.slice(0,35).forEach((s,i)=>{const r=Math.exp(-i*.06),lhd=.5+.12*r;if(s==='Big')pr=pr*lhd/(pr*lhd+(1-pr)*(1-lhd));else pr=pr*(1-lhd)/(pr*(1-lhd)+(1-pr)*lhd);pr=Math.max(.04,Math.min(.96,pr));});
    mp.Bayesian=pr>.5?'Big':'Small';mc.Bayesian=Math.abs(pr-.5)*2.2;
  }

  // 17. ENTROPY
  {
    const win=szs.slice(0,20),bC=win.filter(s=>s==='Big').length,sC=win.length-bC;
    const pB=bC/win.length,pS=sC/win.length,H=-(pB>0?pB*Math.log2(pB):0)-(pS>0?pS*Math.log2(pS):0);
    if(H<0.65){mp.Entropy=bC>sC?'Big':'Small';mc.Entropy=Math.min((1-H)*1.4,.95);}
    else{const rb=szs.slice(0,5).filter(s=>s==='Big').length/5;mp.Entropy=rb>.5?'Big':'Small';mc.Entropy=Math.abs(rb-.5)*2;}
  }

  // 18. Z-SCORE
  {
    const win=nums.slice(0,Math.min(N,25)),mean=win.reduce((a,b)=>a+b,0)/win.length,std=Math.sqrt(win.reduce((a,b)=>a+Math.pow(b-mean,2),0)/win.length)||1,z=(nums[0]-mean)/std;
    if(Math.abs(z)>1.8){mp.ZScore=z>0?'Small':'Big';mc.ZScore=Math.min((Math.abs(z)-1.8)/1.5,.9);}
    else if(Math.abs(z)>0.8){mp.ZScore=nums[0]>mean?'Big':'Small';mc.ZScore=Math.abs(z)/3;}
    else{mp.ZScore=szs[0]==='Big'?'Small':'Big';mc.ZScore=.2;}
  }

  // 19. HUMAN LOGIC
  {
    const l5=szs.slice(0,5),bR=l5.filter(s=>s==='Big').length;
    if(bR>=4){mp.HumanLogic='Small';mc.HumanLogic=.72;}
    else if(5-bR>=4){mp.HumanLogic='Big';mc.HumanLogic=.72;}
    else if(l5[0]!==l5[1]&&l5[1]!==l5[2]&&l5[2]!==l5[3]){mp.HumanLogic=szs[0]==='Big'?'Small':'Big';mc.HumanLogic=.58;}
    else if(bR===3){mp.HumanLogic='Big';mc.HumanLogic=.44;}
    else if(5-bR===3){mp.HumanLogic='Small';mc.HumanLogic=.44;}
    else{mp.HumanLogic=szs[0];mc.HumanLogic=.28;}
  }

  // 20. OPPOSITE MOVE
  {
    const prev2Loss=preds.length>1&&!preds[0].win&&!preds[1].win;
    const heavy6Big=szs.slice(0,6).filter(s=>s==='Big').length>=5;
    const heavy6Sml=szs.slice(0,6).filter(s=>s==='Small').length>=5;
    if(prev2Loss&&preds.length>0){const lp=preds[0].pred;mp.OppMove=lp==='Big'?'Small':'Big';mc.OppMove=.75;}
    else if(heavy6Big){mp.OppMove='Small';mc.OppMove=.68;}
    else if(heavy6Sml){mp.OppMove='Big';mc.OppMove=.68;}
    else{mp.OppMove=szs[0]==='Big'?'Small':'Big';mc.OppMove=.22;}
  }

  // 21. MACD
  {
    const ema=l=>{let e=nums[Math.min(N-1,l-1)];const a=2/(l+1);for(let i=Math.min(N-2,l-2);i>=0;i--)e=nums[i]*a+e*(1-a);return e;};
    const macd=ema(3)-ema(8);
    mp.MACD=macd>0.08?'Big':macd<-0.08?'Small':szs[0]==='Big'?'Small':'Big';
    mc.MACD=Math.min(Math.abs(macd)/1.2,.92);
  }

  // 22. STOCHASTIC
  {
    const period=Math.min(N,14),sl=nums.slice(0,period),H=Math.max(...sl),L=Math.min(...sl),range=H-L||1;
    const k=((nums[0]-L)/range)*100;
    if(k>82){mp.Stochastic='Small';mc.Stochastic=Math.min((k-80)/22,.92);}
    else if(k<18){mp.Stochastic='Big';mc.Stochastic=Math.min((20-k)/22,.92);}
    else{mp.Stochastic=k>55?'Small':k<45?'Big':szs[0]==='Big'?'Small':'Big';mc.Stochastic=Math.abs(k-50)/60;}
  }

  // 23. FIBONACCI
  {
    const win=Math.min(N,20),sl=nums.slice(0,win),H=Math.max(...sl),L=Math.min(...sl),range=H-L||1;
    const fibPos=(nums[0]-L)/range;
    if(fibPos>0.56&&fibPos<0.68||fibPos>0.74&&fibPos<0.82){mp.Fibonacci='Small';mc.Fibonacci=.72;}
    else if(fibPos>0.18&&fibPos<0.30||fibPos>0.36&&fibPos<0.44){mp.Fibonacci='Big';mc.Fibonacci=.72;}
    else if(fibPos>0.618){mp.Fibonacci='Big';mc.Fibonacci=Math.min((fibPos-.5)/.5,.65);}
    else if(fibPos<0.382){mp.Fibonacci='Small';mc.Fibonacci=Math.min((.5-fibPos)/.5,.65);}
    else{mp.Fibonacci=szs[0]==='Big'?'Small':'Big';mc.Fibonacci=.22;}
  }

  // 24. SUPPORT/RESISTANCE
  {
    const freq2=Array(10).fill(0);nums.slice(0,50).forEach((n,i)=>{freq2[n]+=Math.exp(-i*.05);});
    const sorted=[...freq2.map((v,i)=>({v,i}))].sort((a,b)=>b.v-a.v);
    const z1=sorted[0].i,z2=sorted[1].i,atZone=Math.abs(nums[0]-z1)<=1||Math.abs(nums[0]-z2)<=1;
    if(atZone){mp.SupportRes=nums[0]<nums[1]?'Big':'Small';mc.SupportRes=.68;}
    else{mp.SupportRes=nums[0]>Math.max(z1,z2)?'Big':'Small';mc.SupportRes=.38;}
  }

  // 25. PREDICTOR THEORY
  {
    let ptB=0,ptS=0;
    const r30=szs.slice(0,30).filter(s=>s==='Big').length/30;
    if(r30>.7)ptS+=2;else if(r30<.3)ptB+=2;else if(r30>.6)ptS+=.8;else if(r30<.4)ptB+=.8;
    let sk2=1;for(let i=1;i<Math.min(N,10);i++){if(szs[i]===szs[0])sk2++;else break;}
    if(sk2>=5)szs[0]==='Big'?ptB+=1.2:ptS+=1.2;else if(sk2>=3)szs[0]==='Big'?ptS+=1:ptB+=1;
    const rMean=nums.slice(0,8).reduce((a,b)=>a+b,0)/Math.min(N,8);
    if(rMean>6.2)ptS+=1.5;else if(rMean<2.8)ptB+=1.5;
    const allBig=Object.values(mp).filter(v=>v==='Big').length,allT=Object.keys(mp).length||1,cPct=allBig/allT;
    if(cPct>=.80)ptB+=1.8;else if(cPct<=.20)ptS+=1.8;else if(cPct>=.68)ptB+=.8;else if(cPct<=.32)ptS+=.8;
    mp.PredTheory=ptB>ptS?'Big':'Small';mc.PredTheory=Math.min(Math.abs(ptB-ptS)/(ptB+ptS+.5),.94);
  }

  // ── BASE SOFTMAX FUSION ──
  const mList = Object.keys(mp);
  const mListLen = mList.length;
  const agrBig = mList.filter(n=>mp[n]==='Big').length;
  const agrSmall = mListLen - agrBig;
  const rawConf = mListLen > 0 ? Math.abs(agrBig - agrSmall) / mListLen : 0;
  let bsBase=0, ssBase=0;
  mList.forEach(n => { const w = Math.max(mc[n]||.3,.15); mp[n]==='Big'?bsBase+=w:ssBase+=w; });

  // Accuracy weights (uniform since no tracked accuracy yet)
  const normW = mList.map(() => 1/mListLen);

  // ── 4 SERVERS ──
  let fSz, cf, skip = false, note = '';

  if (server === 1) {
    // AGGRESSIVE — win-first, always fires
    const boost = {Momentum:2.2,MACD:2.1,Stochastic:2.0,Streak:1.9,PatternDNA:1.85,LSTM:1.75,DeepNet:1.7,MACD:2.1,PredTheory:1.25,TrapDetect:.22,GapTheory:.28,MeanRev:.38};
    let bsA=0,ssA=0;
    mList.forEach((n,i)=>{const w=normW[i]*Math.max(mc[n]||.3,.18)*(boost[n]||1.0);mp[n]==='Big'?bsA+=w:ssA+=w;});
    const lossRun=preds.slice(0,3).filter(p=>!p.win).length;
    if(lossRun>=2&&mp.OppMove){mp.OppMove==='Big'?bsA+=2.2:ssA+=2.2;}
    fSz=bsA>ssA?'Big':'Small';
    cf=Math.round(Math.max(62,Math.min(96,rawConf*84+60)));
    note='⚔️ Aggressive';
  }
  else if (server === 2) {
    // SAFE — skip when uncertain
    const agr = bsBase>ssBase ? agrBig : agrSmall;
    const agrPct = agr/mListLen;
    fSz = bsBase>ssBase?'Big':'Small';
    const trapFires=mp.TrapDetect!==fSz&&mc.TrapDetect>.50;
    const consecLoss=preds.length>=2&&!preds[0].win&&!preds[1].win;
    if(consecLoss){skip=true;cf=0;note='🛡️ Safe — 2 losses. SKIP.';}
    else if(agrPct<.72){skip=true;cf=0;note='🛡️ Safe — Only '+agr+'/'+mListLen+' agree. SKIP.';}
    else if(trapFires){cf=Math.round(Math.max(60,Math.min(88,rawConf*72+56)));note='🛡️ Safe — Trap active. Low bet.';}
    else{cf=Math.round(Math.max(66,Math.min(94,rawConf*78+64)));note='🛡️ Safe — Clean signal. ('+agr+'/'+mListLen+')';}
  }
  else if (server === 3) {
    // BALANCED — context-switching
    const recent5=preds.slice(0,5);const wr=recent5.length>0?recent5.filter(p=>p.win).length/recent5.length:.5;
    const boost3=wr>=.6?{Momentum:1.65,MACD:1.6,PatternDNA:1.55,LSTM:1.45,DeepNet:1.4,TrapDetect:.52}
                 :wr<=.4?{TrapDetect:1.9,GapTheory:1.75,Bayesian:1.68,Entropy:1.6,MeanRev:1.5,Momentum:.68}
                 :{LSTM:1.45,Transformer:1.42,Bayesian:1.4,DeepNet:1.38,Markov:1.35,PatternDNA:1.32,TrapDetect:.72};
    let bsB=0,ssB=0;mList.forEach((n,i)=>{const w=normW[i]*Math.max(mc[n]||.3,.18)*(boost3[n]||1.0);mp[n]==='Big'?bsB+=w:ssB+=w;});
    fSz=bsB>ssB?'Big':'Small';
    const agr3=(fSz==='Big'?agrBig:agrSmall),agrPct3=agr3/mListLen;
    if(agrPct3<.60){skip=true;cf=0;note='⚖️ Balanced — Signals mixed. SKIP.';}
    else{cf=Math.round(Math.max(58,Math.min(93,rawConf*80+56)));if(preds.length>0&&!preds[0].win)cf=Math.max(55,cf-5);note='⚖️ Balanced ('+agr3+'/'+mListLen+')';}
  }
  else {
    // OMEGA — all models
    const omW={PredTheory:2.1,PatternDNA:2.0,LSTM:1.95,MACD:1.9,Transformer:1.88,DeepNet:1.85,Bayesian:1.82,Stochastic:1.78,Markov:1.72,CycleScan:1.68,Fibonacci:1.58,SupportRes:1.55,Momentum:1.52,Entropy:1.48,ZScore:1.45,Trend:1.38,Frequency:1.32,HotCold:1.28,HumanLogic:1.18,GapTheory:.95,OppMove:.88,TrapDetect:.72};
    let bsO=0,ssO=0;mList.forEach((n,i)=>{const w=normW[i]*Math.max(mc[n]||.3,.18)*(omW[n]||1.0);mp[n]==='Big'?bsO+=w:ssO+=w;});
    if(mp.Momentum===mp.Trend&&mc.Momentum>.55){mp.Momentum==='Big'?bsO+=2.8:ssO+=2.8;}
    const lossRunO=preds.slice(0,4).filter(p=>!p.win).length;
    if(lossRunO>=3){mp.OppMove==='Big'?bsO+=3.5:ssO+=3.5;}
    if(lossRunO>=4){bsO=0;ssO=0;mp.OppMove==='Big'?bsO+=5:ssO+=5;}
    fSz=bsO>ssO?'Big':'Small';
    cf=Math.round(Math.max(58,Math.min(96,rawConf*86+55)));
    note='🌐 Omega';
  }

  // Smart number
  const rNums=nums.slice(0,40).filter(n=>fSz==='Big'?n>=5:n<=4);
  let pN=fSz==='Big'?7:2;
  if(rNums.length>=4){const hist=Array(10).fill(0);rNums.forEach((n,i)=>{hist[n]+=Math.exp(-i*.08);});const range=fSz==='Big'?[5,6,7,8,9]:[0,1,2,3,4];pN=range.reduce((a,b)=>hist[b]>hist[a]?b:a);}
  pN=Math.max(fSz==='Big'?5:0,Math.min(fSz==='Big'?9:4,pN));

  const agr = (fSz==='Big'?agrBig:agrSmall);
  return { num: pN, sz: fSz, cf: skip?0:cf, skip, note, agr, total: mListLen };
}

// ─── KEYBOARDS ─────────────────────────────────────────────────
const modeKb = {
  inline_keyboard: [
    [
      { text: '⚡ 30 Seconds', callback_data: 'mode_30s' },
      { text: '🕐 1 Minute',   callback_data: 'mode_1m'  }
    ]
  ]
};

function serverKb(mode) {
  return {
    inline_keyboard: [
      [
        { text: '⚔️ Server 1 — Aggressive', callback_data: `srv_1_${mode}` }
      ],
      [
        { text: '🛡️ Server 2 — Safe',        callback_data: `srv_2_${mode}` }
      ],
      [
        { text: '⚖️ Server 3 — Balanced',    callback_data: `srv_3_${mode}` }
      ],
      [
        { text: '🌐 Server 4 — Omega All',   callback_data: `srv_4_${mode}` }
      ]
    ]
  };
}

function mainKb() {
  return {
    keyboard: [
      ['🎯 Predict', '📋 History'],
      ['⚙️ Mode', '⚙️ Server'],
      ['ℹ️ Help']
    ],
    resize_keyboard: true
  };
}

// ─── FIREBASE USER HELPERS ─────────────────────────────────────
async function registerUser(chatId, user) {
  try {
    const ref = db.ref(`bot_users/${chatId}`);
    const snap = await ref.once('value');
    const existing = snap.val() || {};
    await ref.set({
      ...existing,
      chatId,
      firstName: user.first_name || '',
      username:  user.username  || '',
      lastActive: Date.now(),
      online: true,
      joinedAt: existing.joinedAt || Date.now()
    });
  } catch(e) { console.error('registerUser error:', e.message); }
}

async function setOffline(chatId) {
  try { await db.ref(`bot_users/${chatId}`).update({ online: false, lastActive: Date.now() }); } catch(e) {}
}

async function isInMaintenance() {
  try {
    const snap = await db.ref('bot_maintenance').once('value');
    const d = snap.val();
    return d && d.active ? d : false;
  } catch(e) { return false; }
}

async function savePrediction(chatId, pred) {
  try {
    await db.ref(`bot_predictions/${chatId}`).transaction(current => {
      const arr = current || [];
      arr.unshift({ ...pred, ts: Date.now() });
      return arr.slice(0, 50);
    });
  } catch(e) {}
}

async function getUserPredictions(chatId) {
  try {
    const snap = await db.ref(`bot_predictions/${chatId}`).once('value');
    return snap.val() || [];
  } catch(e) { return []; }
}

// ─── HANDLERS ──────────────────────────────────────────────────
const SRV_DESC = {
  1: '⚔️ Aggressive — Win-first. Max momentum. Always fires.',
  2: '🛡️ Safe — Loss-avoidance. Skips weak signals. Needs 72%+ consensus.',
  3: '⚖️ Balanced — Context-switching. Adapts to your recent performance.',
  4: '🌐 Omega — All 25 models fused. Triple confirmation. Emergency reversal.'
};

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await registerUser(chatId, msg.from);
  const m = await isInMaintenance();
  if (m) { return bot.sendMessage(chatId, `🔧 *Maintenance*\n\n${m.message || 'Back soon!'}`, { parse_mode: 'Markdown' }); }
  const welcome = `🔮 *Wingo Oracle Ultra*\n*28-Model AI Prediction Engine*\n\n👋 Welcome, ${msg.from.first_name || 'Player'}!\n\n📌 *Commands:*\n🎯 /predict — Get a prediction\n📋 /history — Your history\n⚙️ /mode — Switch 30s / 1min\n⚙️ /server — Switch server\nℹ️ /help — Help\n\n_Made by GAINEO_`;
  bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown', reply_markup: mainKb() });
});

bot.onText(/\/help|ℹ️ Help/i, async (msg) => {
  const chatId = msg.chat.id;
  const m = await isInMaintenance();
  if (m) return bot.sendMessage(chatId, `🔧 ${m.message || 'Maintenance mode'}`, { parse_mode: 'Markdown' });
  bot.sendMessage(chatId,
    `ℹ️ *Wingo Oracle Help*\n\n🎯 /predict — AI prediction (choose mode + server)\n📋 /history — Last 10 results\n⚙️ /mode — Switch 30s or 1min\n⚙️ /server — Switch server strategy\n\n🖥️ *Servers:*\n⚔️ S1 Aggressive — Always fires, max wins\n🛡️ S2 Safe — Skips unsafe signals\n⚖️ S3 Balanced — Self-adjusting\n🌐 S4 Omega — All 28 models fused\n\n_Made by GAINEO_`,
    { parse_mode: 'Markdown' });
});

bot.onText(/\/mode|⚙️ Mode/i, async (msg) => {
  const chatId = msg.chat.id;
  const m = await isInMaintenance();
  if (m) return bot.sendMessage(chatId, `🔧 ${m.message||'Maintenance'}`, { parse_mode: 'Markdown' });
  bot.sendMessage(chatId, '⚡ *Select Game Mode:*', { parse_mode: 'Markdown', reply_markup: modeKb });
});

bot.onText(/\/server|⚙️ Server/i, async (msg) => {
  const chatId = msg.chat.id;
  const m = await isInMaintenance();
  if (m) return bot.sendMessage(chatId, `🔧 ${m.message||'Maintenance'}`, { parse_mode: 'Markdown' });
  const sess = getSession(chatId);
  bot.sendMessage(chatId, `🖥️ *Select Server Strategy:*\n_Current: Server ${sess.server}_`,
    { parse_mode: 'Markdown', reply_markup: serverKb(sess.mode) });
});

bot.onText(/\/predict|🎯 Predict/i, async (msg) => {
  const chatId = msg.chat.id;
  await registerUser(chatId, msg.from);
  const m = await isInMaintenance();
  if (m) return bot.sendMessage(chatId, `🔧 *Maintenance in progress*\n\n${m.message||'Bot will be back soon!'}`, { parse_mode: 'Markdown' });
  const sess = getSession(chatId);
  bot.sendMessage(chatId,
    `🎯 *Predict — Choose Mode:*\n_Current: ${sess.mode === '30s' ? '⚡ 30 Seconds' : '🕐 1 Minute'}_`,
    { parse_mode: 'Markdown', reply_markup: modeKb });
});

bot.onText(/\/history|📋 History/i, async (msg) => {
  const chatId = msg.chat.id;
  const m = await isInMaintenance();
  if (m) return bot.sendMessage(chatId, `🔧 ${m.message||'Maintenance'}`, { parse_mode: 'Markdown' });
  const preds = await getUserPredictions(chatId);
  if (!preds.length) return bot.sendMessage(chatId, '📋 No history yet. Use /predict first!');
  const wins = preds.filter(p=>p.win).length;
  const rate = Math.round(wins/preds.length*100);
  let txt = `📋 *Your Prediction History*\n\n`;
  txt += `📊 ${preds.length} total · ${wins} wins · ${rate}% accuracy\n`;
  txt += `─────────────────────\n`;
  preds.slice(0,15).forEach((p,i)=>{
    const icon = p.win === true ? '✅' : p.win === false ? '❌' : '⏳';
    const srv = p.server ? `S${p.server}` : '';
    txt += `${icon} #${i+1} · ${p.per||'—'} · *${p.pred}* → ${p.actual||'?'} ${srv}\n`;
  });
  bot.sendMessage(chatId, txt, { parse_mode: 'Markdown' });
});

// ─── CALLBACK QUERIES ──────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data   = query.data;
  bot.answerCallbackQuery(query.id);

  const m = await isInMaintenance();
  if (m) return bot.sendMessage(chatId, `🔧 ${m.message||'Maintenance mode active'}`, { parse_mode: 'Markdown' });

  const sess = getSession(chatId);

  if (data.startsWith('mode_')) {
    const mode = data.replace('mode_', '');
    sess.mode = mode;
    const modeLabel = mode === '30s' ? '⚡ 30 Seconds' : '🕐 1 Minute';
    bot.editMessageText(
      `${modeLabel} selected!\n\n🖥️ *Now choose your server:*`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: serverKb(mode) }
    );
    return;
  }

  if (data.startsWith('srv_')) {
    const parts   = data.split('_');
    const srvNum  = parseInt(parts[1]);
    const mode    = parts[2];
    sess.server = srvNum;
    sess.mode   = mode;

    // Show analyzing animation
    const analyzeMsg = await bot.editMessageText(
      `🔄 *Analyzing...*\n\n⚡ Mode: ${mode === '30s' ? '30 Seconds' : '1 Minute'}\n🖥️ Server: ${srvNum} — ${['','Aggressive','Safe','Balanced','Omega'][srvNum]}\n\n⏳ Running 28 AI models...`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
    );

    // Fetch data
    const games = await fetchGames(mode);
    if (!games || games.length < 5) {
      bot.editMessageText('❌ *Failed to fetch game data.*\nPlease try again in a moment.',
        { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
      return;
    }

    const nums   = games.map(g => g.n);
    const latP   = games[0]?.p || '';
    const nxtP   = nxP(nxP(latP));
    const preds  = await getUserPredictions(chatId);

    // Simulate 3-second analysis
    await new Promise(r => setTimeout(r, 3000));

    const pred = engine(nums, srvNum, preds);

    // Build response
    const sizeEmoji = pred.sz === 'Big' ? '🟢' : '🔴';
    const sizeBar   = pred.sz === 'Big' ? '▰'.repeat(Math.round(pred.cf/10)) + '▱'.repeat(10-Math.round(pred.cf/10)) : '▱'.repeat(10-Math.round(pred.cf/10)) + '▰'.repeat(Math.round(pred.cf/10));
    const lastChips = games.slice(0,10).map(g=>g.n>=5?'🟢'+g.n:'🔴'+g.n).join(' ');
    const agrBar    = `${'█'.repeat(Math.round(pred.agr/pred.total*10))}${'░'.repeat(10-Math.round(pred.agr/pred.total*10))}`;

    let txt;
    if (pred.skip) {
      txt = `🛡️ *SKIP — Low Confidence*\n\n${pred.note}\n\n📌 *Period:* \`${nxtP}\`\n⚡ *Mode:* ${mode === '30s' ? '30s' : '1min'}\n🖥️ *Server:* ${srvNum}\n\n⚠️ Signals too mixed. Skip this round to protect your balance.\n\n📊 Last 10: ${lastChips}`;
    } else {
      txt = `🔮 *AI PREDICTION RESULT*\n`
          + `${'─'.repeat(24)}\n`
          + `${sizeEmoji} *${pred.sz.toUpperCase()}*   —   Number: *${pred.num}*\n`
          + `${'─'.repeat(24)}\n`
          + `\n📌 *Period:* \`${nxtP}\`\n`
          + `⚡ *Mode:* ${mode === '30s' ? '30 Seconds' : '1 Minute'}\n`
          + `🖥️ *Server:* ${srvNum} — ${['','Aggressive','Safe','Balanced','Omega'][srvNum]}\n`
          + `\n📊 *Signal Strength:* ${pred.cf}%\n`
          + `\`${sizeBar}\`\n`
          + `\n🤝 *Consensus:* ${pred.agr}/${pred.total} models\n`
          + `\`${agrBar}\`\n`
          + `\n${pred.note}\n`
          + `\n🎲 *Last 10 Results:*\n${lastChips}\n`
          + `\n_Made by GAINEO_`;
    }

    bot.editMessageText(txt, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🔄 Predict Again', callback_data: `srv_${srvNum}_${mode}` },
          { text: '📋 History',        callback_data: 'history'                }
        ]]
      }
    });

    // Save to Firebase
    await savePrediction(chatId, { per: nxtP, pred: pred.sz, num: pred.num, cf: pred.cf, mode, server: srvNum, win: null });
    await db.ref(`bot_users/${chatId}`).update({ lastActive: Date.now(), lastMode: mode, lastServer: srvNum });
    return;
  }

  if (data === 'history') {
    const preds = await getUserPredictions(chatId);
    if (!preds.length) return bot.sendMessage(chatId, '📋 No history yet.');
    const wins = preds.filter(p=>p.win===true).length;
    const tried = preds.filter(p=>p.win!==null).length;
    const rate = tried ? Math.round(wins/tried*100) : 0;
    let txt = `📋 *History* · ${tried > 0 ? rate+'% accuracy' : 'No results yet'}\n\n`;
    preds.slice(0,12).forEach((p,i)=>{
      const icon = p.win===true?'✅':p.win===false?'❌':'⏳';
      txt += `${icon} \`${p.per||'—'}\` *${p.pred}*(${p.num}) S${p.server||'?'}\n`;
    });
    bot.sendMessage(chatId, txt, { parse_mode: 'Markdown' });
  }
});

// ─── POLLING ERROR HANDLER ─────────────────────────────────────
bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

// ─── ADMIN BROADCAST (via Firebase trigger) ───────────────────
// Admin sets /bot_broadcast/{ts}: {message, active:true}
// Bot picks it up and sends to all users
db.ref('bot_broadcast').on('child_added', async snap => {
  const d = snap.val();
  if (!d || !d.message || !d.active) return;
  // Mark as processed
  await db.ref(`bot_broadcast/${snap.key}`).update({ active: false, sentAt: Date.now() });
  // Get all users
  try {
    const usersSnap = await db.ref('bot_users').once('value');
    const users = usersSnap.val() || {};
    let sent = 0, failed = 0;
    for (const [chatId] of Object.entries(users)) {
      try {
        await bot.sendMessage(Number(chatId), `📢 *Announcement*\n\n${d.message}`, { parse_mode: 'Markdown' });
        sent++;
        await new Promise(r => setTimeout(r, 50)); // rate limit
      } catch(e) { failed++; }
    }
    console.log(`Broadcast: ${sent} sent, ${failed} failed`);
  } catch(e) { console.error('Broadcast error:', e.message); }
});

// ─── MAINTENANCE MODE LISTENER ────────────────────────────────
db.ref('bot_maintenance').on('value', snap => {
  const d = snap.val();
  if (d && d.active) {
    console.log(`🔧 Maintenance mode ON: ${d.message}`);
  } else {
    console.log('✅ Maintenance mode OFF');
  }
});

console.log('🔮 Wingo Oracle Bot started!');
console.log('📡 Listening for messages...');
