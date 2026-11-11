// Run against Vite: BASE=http://127.0.0.1:5178 node e2e/ui-review/run.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.BASE || 'http://127.0.0.1:5178';
const browser = await chromium.launch({headless:true});
try {
 const context = await browser.newContext({viewport:{width:390,height:844}});
 const p = await context.newPage();
 p.on("pageerror", e=>console.error(e.message));
 p.setDefaultTimeout(10000);
 await p.route('**/api/me',r=>r.fulfill({status:401,json:{}}));
 await p.route('**/api/setup',r=>r.fulfill({json:{needed:false}}));
 let fail=true;
 await p.route('**/api/auth/login',r=>fail?r.abort('failed'):r.fulfill({status:401,json:{error:'Incorrect credentials'}}));
 await p.goto(base);
 await p.getByLabel('Username or email',{exact:true}).fill('review');
 await p.getByLabel('Password',{exact:true}).fill('review');
 await p.getByRole('button',{name:'Sign in',exact:true}).click();
 await p.getByRole('alert').filter({hasText:'Could not connect'}).waitFor();
 assert.equal(await p.getByRole('button',{name:'Sign in',exact:true}).isEnabled(),true);
 fail=false;
 await p.getByRole('button',{name:'Sign in',exact:true}).click();
 await p.getByRole('alert').filter({hasText:'Incorrect credentials'}).waitFor();
 console.log('PASS sign-in network recovery and retry');
 await p.route('**/__drawer-test',r=>r.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">
 import React from '/node_modules/.vite/deps/react.js';
 import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; const {createRoot}=ReactDOM;
 import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
 const {SideDrawer}=await import('/src/components/ui/SideDrawer.tsx');
 function Test(){const [open,setOpen]=React.useState(false);return React.createElement(React.Fragment,null,React.createElement('button',{onClick:()=>setOpen(true)},'Open'),React.createElement(SideDrawer,{open,onOpenChange:setOpen,title:'Navigation',side:'left'},React.createElement('button',null,'First'),React.createElement('button',null,'Last')))}
 createRoot(document.getElementById('root')).render(React.createElement(Test));</script>`}));
 await p.goto(base+'/__drawer-test');
 await p.getByRole('button',{name:'Open',exact:true}).click();
 await p.getByRole('dialog',{name:'Navigation'}).waitFor();
 await p.getByRole('button',{name:'Last',exact:true}).focus();
 await p.keyboard.press('Tab');
 assert.equal(await p.evaluate(()=>document.activeElement.textContent),'First');
 await p.keyboard.press('Escape');
 await p.getByRole('dialog').waitFor({state:'hidden'});
 await p.waitForFunction(()=>document.activeElement?.textContent === 'Open');
 console.log('PASS drawer focus trap, Escape and focus restoration');
} finally { await browser.close(); }
