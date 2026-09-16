import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true}); const results=[];
for(const width of [1440,768,375]){
 const context=await browser.newContext({viewport:{width,height:1000}}); const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5275'); await page.getByRole('button',{name:/Abrir demonstração sintética/i}).click(); await page.getByRole('heading',{name:'Bom dia, Ricardo.'}).waitFor();
 for(const [route,button] of [['overview',null],['agenda','Agenda'],['patients','Pacientes'],['clinical','Atendimento'],['stock','Farmácia'],['finance','Financeiro'],['copilot','Copiloto'],['admin','Administração']]){
  if(button){const menu=page.getByRole('button',{name:'Abrir menu'});if(await menu.isVisible())await menu.click(); await page.getByRole('button',{name:button==='Agenda'?/^Agenda/:button,exact:button!=='Agenda'}).click();} await page.waitForTimeout(300);
  await page.screenshot({path:`/tmp/cvg-visual-audit-r9ggagm2/${width}-${route}.png`,fullPage:true});
  const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  results.push({width,route,dimensions,violations:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})),text:width===1440?await page.locator('main').innerText():undefined});
 }
 results.push({width,errors});await context.close();
}
fs.writeFileSync('/tmp/cvg-visual-audit-r9ggagm2/results.json',JSON.stringify(results,null,2)); await browser.close();
