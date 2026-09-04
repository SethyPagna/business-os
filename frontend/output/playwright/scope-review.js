import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppContext} from '/src/app/AppContextCore.tsx';
import ShiftHistoryPanel from '/src/components/shifts/ShiftHistoryPanel.tsx';
import CurrentShiftSummary from '/src/components/shifts/CurrentShiftSummary.tsx';
import DateTimeRangePicker from '/src/components/shared/DateTimeRangePicker.tsx';
import '/src/styles/main.css';
import '/src/components/sales/reports/reports-surface.css';
import en from '/src/lang/en.json';
import km from '/src/lang/km.json';
const shift={id:71,shift_code:'S-20260905-0800-abc123',scope_mode:'per_account',user_id:7,user_name:'Cashier test',branch_id:2,branch_name:'Shop',business_date:'2026-09-05',opened_at:'2026-09-05T01:00:00.000Z',closed_at:null,opening_float_usd:10,opening_float_khr:10000,opening_note:null,closing_counted_usd:null,closing_counted_khr:null,closing_note:null,revision:0};
const originalFetch=window.fetch;
window.fetch=async (url,opts)=>{
const path=String(url);
if(path.includes('/api/shifts/current')) return new Response(JSON.stringify({shift,policy:{scope_mode:'per_account',admin_exempt:false},exempt:false,needs_registration:false,is_open:true,can_end:true}),{headers:{'Content-Type':'application/json'}});
if(path.includes('/api/shifts')) return new Response(JSON.stringify(path.includes('/history')?{shift,amendments:[]}:{shifts:[shift],scope:'all'}),{headers:{'Content-Type':'application/json'}});
if(path.includes('/health'))return new Response(JSON.stringify({status:'ok'}),{headers:{'Content-Type':'application/json'}});
return originalFetch(url,opts);
};
const h=React.createElement;
function App(){
 const [language,setLanguage]=useState('en');
 const [range,setRange]=useState({startDate:'2026-09-05',endDate:'2026-09-05',startTime:'00:00',endTime:'23:59'});
 const [notice,setNotice]=useState('');
 const pack=language==='km'?km:en; const t=React.useCallback(key=>pack[key]||key,[pack]);
 document.body.classList.toggle('lang-km',language==='km');
 return h(AppContext.Provider,{value:{t,settings:{language},language,user:{id:1},notify:setNotice}},h('main',{style:{padding:8}},
 h('button',{onClick:()=>setLanguage(language==='en'?'km':'en'),style:{minHeight:44}},'EN / KM'),
 h('div',{'data-reports-hub':true},h('div',{className:'reports-mobile-controls'},h(DateTimeRangePicker,{value:range,onChange:setRange,t,showTime:true,triggerClassName:'reports-mobile-range w-full min-w-0 items-center gap-2 rounded-md px-3 py-2'}))),
 new URLSearchParams(location.search).has('current')?h(CurrentShiftSummary):h(ShiftHistoryPanel,{canManage:true,notify:setNotice}),h('p',null,notice)));
}
createRoot(document.getElementById('root')).render(h(App));
