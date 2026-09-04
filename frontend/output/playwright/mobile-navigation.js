// Local-only fixture: real provider, Sidebar, section hook and switcher;
// synthetic user, API and bodies. Never a production auth/business-flow test.
import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppProvider, useApp} from '/src/AppContext.tsx';
import Sidebar from '/src/components/navigation/Sidebar.tsx';
import HubSectionNav from '/src/components/shared/HubSectionNav.tsx';
import {getHubDestinations, useHubSection} from '/src/components/shared/hubNavigation.ts';
import {registerDirtyWork} from '/src/utils/dirtyWork.ts';
import {writeMobileSectionNavMode} from '/src/utils/sectionNavPreference.ts';
import '/src/styles/main.css';
const h=React.createElement;
const fixtureUser={id:999999,name:'Navigation fixture',role_name:'Admin',permissions:{all:true}};
const fixtureSettings={business_name:'Navigation fixture',language:'en',theme:'light',ui_mobile_pinned:JSON.stringify(['dashboard','sales','branches'])};
window.api={getAppBootstrap:async()=>({user:fixtureUser,settings:fixtureSettings}),getSettings:async()=>fixtureSettings};
const originalFetch=window.fetch;
window.fetch=async (url,opts)=>{
 const path=String(url);
 if(path.includes('/api/')||path.includes('/health'))return new Response(JSON.stringify({success:true,status:'ok',data:[]}),{headers:{'Content-Type':'application/json'}});
 return originalFetch(url,opts);
};
if(location.pathname.includes('/output/'))history.replaceState({},'', '/sales#hub:sales:sales');
function Host({pageId}){
 const app=useApp();
 const destinations=getHubDestinations(pageId,app);
 const [active,choose]=useHubSection(pageId,destinations[0]?.id||'',destinations.map(d=>d.id),app.navigateTo);
 const [text,setText]=useState('');
 useEffect(()=>registerDirtyWork({key:`fixture-${pageId}`,pageId,label:'Unsaved fixture text',isDirty:()=>text!=='',discard:()=>setText(''),save:()=>{setText('');return true}}),[text,pageId]);
 const sections=destinations.map(d=>({id:d.id,label:app.t(d.key)}));
 return h('section',{hidden:app.page!==pageId,'data-fixture-host':pageId},h(HubSectionNav,{pageId,sections,active,onChange:choose,storageKey:`fixture:hub:${pageId}`},
 h('h1',{'data-fixture-section':`${pageId}:${active}`,style:{fontSize:20,overflowWrap:'anywhere'}},`${pageId}: ${active}`),
 h('label',null,'Unsaved test field',h('input',{'aria-label':`${pageId} unsaved test field`,value:text,onChange:e=>setText(e.target.value),style:{width:'100%',minHeight:44,border:'1px solid #999'}})),
 h('p',null,'Synthetic body; navigation and dirty guard are the real application code.')));
}
function Fixture(){
 const app=useApp();
 return h(React.Fragment,null,
 h(Sidebar,{showQuickPreferences:true,notificationSlot:h('button',{'aria-label':'Fixture notifications',style:{width:40,height:40}},'🔔')}),
 h('main',{style:{padding:'90px 12px 130px',maxWidth:'100%',minWidth:0}},
 h('div',{style:{display:'flex',gap:6,flexWrap:'wrap'}},h('button',{onClick:()=>writeMobileSectionNavMode('pages'),style:{minHeight:44}},'Fixture: inline mode'),h('button',{onClick:()=>writeMobileSectionNavMode('sections'),style:{minHeight:44}},'Fixture: old tabs')),
 ['sales','branches','settings','contacts','promotions','review'].map(pageId=>h(Host,{key:pageId,pageId})),
 !['sales','branches','settings','contacts','promotions','review'].includes(app.page)?h('h1',null,app.page):null,
 app.navGuard?h('div',{role:'dialog','aria-label':'Fixture navigation guard',style:{position:'fixed',inset:'30% 10px auto',background:'white',padding:16,border:'2px solid black',zIndex:1000}},
 h('p',null,'Unsaved work: choose before leaving'),['stay','discard','save'].map(action=>h('button',{key:action,onClick:()=>app.resolveNavGuard(action),style:{minHeight:44,padding:8}},action))):null));
}
createRoot(document.getElementById('root')).render(h(AppProvider,null,h(Fixture)));
