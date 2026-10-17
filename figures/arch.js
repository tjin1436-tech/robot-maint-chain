const { chromium } = require('playwright');
const fs=require('fs');
const F="font-family:'Liberation Sans',Arial,sans-serif";
const marker=`<defs>
<marker id="ab" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2E75B6"/></marker>
<marker id="abig" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="22" markerHeight="22" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1F5C99"/></marker>
<marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#C00000"/></marker>
<marker id="ag" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="16" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#555"/></marker>
</defs>`;
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function T(x,y,s,o={}){return `<text x="${x}" y="${y}" font-size="${o.size||16}" fill="${o.fill||'#222'}" font-weight="${o.bold?'bold':'normal'}" font-style="${o.it?'italic':'normal'}" text-anchor="${o.anchor||'middle'}">${esc(s)}</text>`}
function box(x,y,w,h,stroke,fill,r=6,sw=2){return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`}

// ---------- Figure 1 ----------
function fig1(){
 const W=1400,H=962;let s='';
 s+=T(700,44,'Overall Architecture of Trusted Robot Maintenance System',{size:28,bold:true});
 const layer=(y,h,title,c,fill)=>box(58,y,1284,h,c,fill,10,3)+T(82,y+30,title,{size:19,bold:true,fill:c,anchor:'start'});
 const sub=(x,y,w,h,t1,t2,t3)=>box(x,y,w,h,'#B7C7DD','#fff',4,1.5)+T(x+w/2,y+(t2?38:46),t1,{size:t2?18:18,bold:!!t2&&!!t3})+(t2?T(x+w/2,y+68,t2,{size:15,fill:'#666'}):'')+(t3?T(x+w/2,y+96,t3,{size:15,fill:'#888'}):'');
 s+=layer(80,138,'Application Layer','#4472C4','#E8EFFB');
 [['Maintenance Unit',82,270],['Manufacturer',375,240],['Supervisor',639,240],['Robot Device Party',903,408]].forEach(([t,x,w])=>{s+=box(x,120,w,80,'#B7C7DD','#fff',4,1.5)+T(x+w/2,166,t,{size:18})});
 s+=layer(255,182,'Smart Contract Layer','#ED7D31','#FDE9D9');
 [['Access Control','RobotAccessControl','RBAC role management',82,270],['Fault Diagnosis','FaultDiagnosis','Signature · commitment · consistency',375,270],['Work Order Mgmt','MaintenanceWorkOrder','Prerequisite · uniqueness · rework',668,284],['Acceptance & Archive','Acceptance','Attested data · dual sign-off',976,335]].forEach(([a,b,c,x,w])=>{s+=box(x,295,w,118,'#F4B183','#fff',4,1.5)+T(x+w/2,340,a,{size:19,bold:true})+T(x+w/2,370,b,{size:15,fill:'#666'})+T(x+w/2,398,c,{size:15,fill:'#888'})});
 s+=layer(482,138,'Blockchain Layer','#70AD47','#E2EFDA');
 [['Ethereum Distributed Ledger','Immutable · transaction hash · timestamp',82,554],['Data Provenance & Traceability','Fault / work order / acceptance records with data commitments',671,642]].forEach(([a,b,x,w])=>{s+=box(x,521,w,80,'#A9D18E','#fff',4,1.5)+T(x+w/2,556,a,{size:18})+T(x+w/2,586,b,{size:15,fill:'#666'})});
 s+=layer(664,138,'Edge Layer','#7F7F7F','#F2F2F2');
 [['Data Collection','Bearing vibration (CWRU) · simulated temperature / vibration / current',82,554],['Edge Diagnosis & Attestation','Features · severity model · raw-data hash · device-key signature',671,642]].forEach(([a,b,x,w])=>{s+=box(x,703,w,80,'#BFBFBF','#fff',4,1.5)+T(x+w/2,738,a,{size:18})+T(x+w/2,768,b,{size:15,fill:'#666'})});
 // bidirectional arrows between layers
 [[218,255],[437,482],[620,664]].forEach(([a,b])=>{s+=`<line x1="700" y1="${a+4}" x2="700" y2="${b-4}" stroke="#555" stroke-width="3" marker-start="url(#ag)" marker-end="url(#ag)"/>`});
 return [W,H,s];
}
// ---------- Figure 2 ----------
function fig2(){
 const W=1500,H=1000;let s='';
 s+=T(750,40,'Three-Layer Write-Time Verification Across Contracts',{size:28,bold:true});
 // edge device
 s+=box(30,170,210,150,'#7F7F7F','#F2F2F2',8,2.5)+T(135,212,'Edge Device',{size:20,bold:true})+T(135,240,'robot signing key',{size:15,fill:'#555'})+T(135,266,'severity model',{size:15,fill:'#555'})+T(135,292,'raw-data hash',{size:15,fill:'#555'});
 const cbox=(x,y,w,h,a,b,lines)=>{let t=box(x,y,w,h,'#70AD47','#E2EFDA',8,3)+T(x+w/2,y+38,a,{size:22,bold:true})+T(x+w/2,y+66,b,{size:16,fill:'#555'});
   lines.forEach(([tag,txt,col],i)=>{t+=`<rect x="${x+14}" y="${y+84+i*30}" width="${w-28}" height="25" rx="4" fill="#fff" stroke="${col}" stroke-width="1.2"/>`+T(x+24,y+102+i*30,tag,{size:13,bold:true,fill:col,anchor:'start'})+T(x+w-22,y+102+i*30,txt,{size:13,fill:'#333',anchor:'end'})});return t;};
 const SRC='#7030A0', CON='#C55A11', LIF='#2F7D32';
 s+=cbox(300,150,350,190,'Fault Diagnosis','FaultDiagnosis.sol',[['SOURCE','device signature · sequence',SRC],['CONSISTENCY','severity = attested',CON],['','write-once records','#888']]);
 s+=cbox(720,150,340,190,'Work Order Mgmt','MaintenanceWorkOrder.sol',[['LIFECYCLE','one active order per fault',LIF],['LIFECYCLE','role re-check · rework ≤ 2',LIF],['','PENDING→IN_PROGRESS→COMPLETED','#888']]);
 s+=cbox(1130,150,340,190,'Acceptance','Acceptance.sol',[['SOURCE','signed post-repair data',SRC],['LIFECYCLE','dual sign-off',LIF],['','threshold rule → archive','#888']]);
 // edge -> FD
 s+=`<line x1="244" y1="245" x2="294" y2="245" stroke="#555" stroke-width="3" marker-end="url(#ag)"/>`;
 // edge -> acceptance (post-repair data) along top
 s+=`<path d="M135,166 V75 H1300 V144" fill="none" stroke="#555" stroke-width="2.2" stroke-dasharray="3,4" marker-end="url(#ag)"/>`+T(720,68,'device-signed post-repair measurements',{size:14,fill:'#555',it:true});
 s+=T(135,350,'signed payload +',{size:13,fill:'#555',it:true})+T(135,367,'raw-data commitment',{size:13,fill:'#555',it:true});
 // prerequisite arrows
 s+=`<line x1="716" y1="200" x2="656" y2="200" stroke="#1F5C99" stroke-width="5" marker-end="url(#abig)"/>`;
 s+=`<line x1="1126" y1="200" x2="1066" y2="200" stroke="#1F5C99" stroke-width="5" marker-end="url(#abig)"/>`;
 const pbox=(x,t2)=>box(x,385,330,58,'#2E75B6','#EAF2FB',4,1.5)+T(x+165,408,'PREREQUISITE (cross-contract)',{size:14,bold:true,fill:'#1F5C99'})+T(x+165,430,t2,{size:14,fill:'#1F5C99'});
 s+=pbox(560,'diagnosed & severity ≥ threshold');
 s+=pbox(990,'order status = COMPLETED');
 s+=`<line x1="725" y1="385" x2="690" y2="208" stroke="#2E75B6" stroke-width="1.2" stroke-dasharray="4,4"/>`;
 s+=`<line x1="1155" y1="385" x2="1100" y2="208" stroke="#2E75B6" stroke-width="1.2" stroke-dasharray="4,4"/>`;
 // access control
 s+=box(542,800,416,130,'#ED7D31','#FDE9D9',8,3)+T(750,848,'Access Control Contract',{size:23,bold:true})+T(750,880,'RobotAccessControl.sol',{size:17,fill:'#555'})+T(750,906,'RBAC role & authorization check',{size:16,fill:'#888'});
 s+=`<path d="M475,343 C475,560 560,720 620,796" fill="none" stroke="#C00000" stroke-width="2.5" stroke-dasharray="9,6" marker-end="url(#ar)"/>`;
 s+=`<line x1="910" y1="343" x2="830" y2="794" stroke="#C00000" stroke-width="2.5" stroke-dasharray="9,6" marker-end="url(#ar)"/>`;
 s+=`<path d="M1300,343 C1300,560 1000,720 900,796" fill="none" stroke="#C00000" stroke-width="2.5" stroke-dasharray="9,6" marker-end="url(#ar)"/>`;
 s+=T(470,600,'role check',{size:15,fill:'#C00000',anchor:'end'})+T(885,600,'role check',{size:15,fill:'#C00000',anchor:'start'})+T(1180,600,'role check',{size:15,fill:'#C00000',anchor:'start'});
 // failure + legend
 s+=box(30,800,440,130,'#C00000','#FFF5F5',6,2)+T(250,835,'On any failed check',{size:18,bold:true,fill:'#C00000'})+T(250,868,'Transaction reverts · state rolls back',{size:16})+T(250,896,'No record is written to the ledger',{size:16});
 s+=box(1030,780,440,170,'#CCC','#FAFAFA',6,1.5);
 const lg=(y,html,label)=>html+T(1130,y+5,label,{size:14,anchor:'start'});
 s+=lg(808,`<line x1="1050" y1="808" x2="1110" y2="808" stroke="#1F5C99" stroke-width="5" marker-end="url(#abig)"/>`,'cross-contract prerequisite check');
 s+=lg(840,`<line x1="1050" y1="840" x2="1110" y2="840" stroke="#C00000" stroke-width="2.5" stroke-dasharray="9,6" marker-end="url(#ar)"/>`,'RBAC role & authorization check');
 s+=lg(872,`<rect x="1050" y="862" width="60" height="20" rx="4" fill="#fff" stroke="${SRC}"/>`,'SOURCE: data attested by device key');
 s+=lg(902,`<rect x="1050" y="892" width="60" height="20" rx="4" fill="#fff" stroke="${CON}"/>`,'CONSISTENCY: diagnosis = attestation');
 s+=lg(932,`<rect x="1050" y="922" width="60" height="20" rx="4" fill="#fff" stroke="${LIF}"/>`,'LIFECYCLE: uniqueness, rework, sign-off');
 return [W,H,s];
}
// ---------- Figure 3 ----------
function fig3(){
 const W=1400,H=1160;let s='';
 s+=T(700,40,'Robot Maintenance End-to-End Sequence',{size:28,bold:true});
 const lanes=[['Robot / Edge','(device key)',220,'#7F7F7F','#F2F2F2'],['Maintenance Unit','/ Manufacturer',380,'#7F7F7F','#F2F2F2'],['Supervisor','',540,'#7F7F7F','#F2F2F2'],['Access Control','Contract',720,'#ED7D31','#FDE9D9'],['Fault Diagnosis','Contract',900,'#70AD47','#E2EFDA'],['Work Order','Contract',1080,'#70AD47','#E2EFDA'],['Acceptance','Contract',1260,'#70AD47','#E2EFDA']];
 const X={};
 lanes.forEach(([a,b,x,c,f],i)=>{X[i]=x;s+=box(x-75,62,150,62,c,f,5,2)+T(x,b?88:99,a,{size:16,bold:true})+(b?T(x,110,b,{size:14,fill:i>2?'#777':'#222',bold:i<=2&&i>0}):'');});
 const phase=(y1,y2,t1,t2,c)=>{s+=`<rect x="14" y="${y1}" width="1372" height="${y2-y1}" fill="${c}" opacity="0.18" rx="4"/>`+T(24,y1+24,t1,{size:16,bold:true,fill:'#333',anchor:'start'})+(t2?T(24,y1+44,t2,{size:16,bold:true,fill:'#333',anchor:'start'}):'')};
 phase(140,420,'Data &','Diagnosis','#ED7D31');
 phase(428,620,'Order','Creation','#70AD47');
 phase(628,770,'Repair','Execution','#4472C4');
 phase(778,1110,'Acceptance','& Archive','#7F7F7F');
 lanes.forEach((l,i)=>{s+=`<line x1="${X[i]}" y1="124" x2="${X[i]}" y2="1115" stroke="#AAA" stroke-width="1.5" stroke-dasharray="5,5"/>`});
 let n=0;
 const msg=(y,a,b,label,kind)=>{n++;const col=kind==='pre'?'#1F5C99':kind==='role'?'#C00000':'#2E75B6';const sw=kind==='pre'?4:2.5;const dash=kind==='role'?'stroke-dasharray="9,6"':kind==='ret'?'stroke-dasharray="4,4"':'';const mk=kind==='pre'?'abig':kind==='role'?'ar':'ab';
  const x1=X[a],x2=X[b];const dir=x2>x1?1:-1;
  s+=`<line x1="${x1}" y1="${y}" x2="${x2-dir*4}" y2="${y}" stroke="${kind==='ret'?'#2E75B6':col}" stroke-width="${sw}" ${dash} marker-end="url(#${mk})"/>`;
  const lx=Math.min(x1,x2)+12;s+=T(lx,y-9,`${n}. ${label}`,{size:14,anchor:'start',fill:kind==='pre'?'#1F5C99':kind==='role'?'#A00000':'#222',bold:kind==='pre'})};
 const self=(y,i,label,col)=>{s+=`<path d="M${X[i]},${y} h40 v22 h-36" fill="none" stroke="${col||'#2E75B6'}" stroke-width="2" marker-end="url(#ab)"/>`+T(X[i]-8,y+16,label,{size:13.5,anchor:'end',fill:col||'#444',it:true,bold:!!col})};
 const SRC='#7030A0', CON='#C55A11', LIF='#2F7D32';
 msg(175,0,4,'uploadData(indicators, raw hash, edge severity, seq, signature)','call');
 msg(215,4,3,'verify gateway & device ROBOT_DEVICE role','role');
 self(225,4,'SOURCE: signature & sequence',SRC);
 msg(300,1,4,'submitDiagnosis(severity)','call');
 msg(335,4,3,'verify MAINTENANCE / MANUFACTURER role','role');
 self(345,4,'CONSISTENCY: severity = attested',CON);
 self(385,4,'emit trigger if severity ≥ 3');
 msg(465,2,5,'createOrder(faultId, maintainer)','call');
 msg(505,5,3,'verify SUPERVISOR; assignee is MAINTENANCE','role');
 msg(550,5,4,'prerequisite: diagnosed & severity ≥ threshold','pre');
 self(560,5,'LIFECYCLE: no other active order',LIF);
 msg(665,1,5,'checkIn() / submitReport() by assigned maintainer','call');
 msg(705,5,3,'LIFECYCLE: re-check maintainer role','role');
 self(715,5,'→ IN_PROGRESS → COMPLETED');
 msg(815,1,6,'submitVerification(orderId, post-repair data, signature)  [Manufacturer]','call');
 msg(855,6,3,'verify MANUFACTURER / SUPERVISOR role','role');
 msg(900,6,5,'prerequisite: status = COMPLETED','pre');
 self(910,6,'SOURCE: post-repair data signed by robot',SRC);
 msg(990,2,6,'countersign(recordId)  [Supervisor, other role]','call');
 self(1000,6,'LIFECYCLE: dual sign-off → finalize',LIF);
 msg(1075,6,5,'closeOrder → ACCEPTED / REWORK','call');
 // legend
 const ly=1140;
 s+=`<line x1="40" y1="${ly}" x2="80" y2="${ly}" stroke="#2E75B6" stroke-width="2.5" marker-end="url(#ab)"/>`+T(88,ly+5,'function call',{size:13,anchor:'start'});
 s+=`<line x1="200" y1="${ly}" x2="240" y2="${ly}" stroke="#C00000" stroke-width="2.5" stroke-dasharray="9,6" marker-end="url(#ar)"/>`+T(248,ly+5,'RBAC role check',{size:13,anchor:'start'});
 s+=`<line x1="380" y1="${ly}" x2="420" y2="${ly}" stroke="#1F5C99" stroke-width="4" marker-end="url(#abig)"/>`+T(428,ly+5,'cross-contract prerequisite check',{size:13,anchor:'start'});
 s+=T(660,ly+5,'SOURCE',{size:13,anchor:'start',bold:true,fill:SRC})+T(722,ly+5,'CONSISTENCY',{size:13,anchor:'start',bold:true,fill:CON})+T(822,ly+5,'LIFECYCLE',{size:13,anchor:'start',bold:true,fill:LIF})+T(905,ly+5,'in-contract checks · any failed check reverts the transaction',{size:13,anchor:'start'});
 return [W,H,s];
}
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'}).catch(()=>chromium.launch());
 for(const [name,f] of [['fig1',fig1],['fig2',fig2],['fig3',fig3]]){
  const [W,H,s]=f();
  const html=`<html><body style="margin:0;background:#fff"><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="${F};display:block;background:#fff">${marker}${s}</svg></body></html>`;
  const p=await b.newPage({viewport:{width:W,height:H}});await p.setContent(html);await p.screenshot({path:`${__dirname}/${name}.png`});await p.close();
 }
 await b.close();
})();
