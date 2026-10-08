"""Offline probe fidelity checks; no real booking or windows opened."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
source=Path('extension/navigation-probe.js').read_text(encoding='utf-8').replace('export function','function')
def run(page,mode):
    return page.evaluate('(mode)=>{'+source+';return navigationProbe({mode});}',mode)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chrome',headless=True)
    page=browser.new_page()
    page.route('**/*',lambda r:r.fulfill(body='<form><button>Submit</button></form>',content_type='text/html'))
    page.goto('https://www.korail.com/ticket/search/list')
    page.evaluate("""()=>{window.calls=0;window.originalOpen=function(...args){window.calls++;window.lastArgs=args;return null;};window.open=window.originalOpen;}""")
    assert run(page,'start')['ok'] and page.evaluate('window.calls')==0
    assert page.evaluate("window.open('/private?token=SECRET','test')") is None
    assert page.evaluate('window.calls')==1
    assert page.evaluate('window.lastArgs')[0]=='/private?token=SECRET'
    page.evaluate("document.querySelector('form').addEventListener('submit',e=>e.preventDefault())")
    page.locator('button').click()
    page.wait_for_function("JSON.parse(sessionStorage.getItem('korail-navigation-probe-v1')).events.length>=3")
    data=run(page,'read')
    assert 'SECRET' not in json.dumps(data)
    assert data['events'][1]['event']=='window_open' and data['events'][1]['outcome']=='null_return'
    assert data['events'][2]['event']=='form_submit' and data['events'][2]['prevented']
    run(page,'stop')
    assert page.evaluate('window.open===window.originalOpen')
    page.evaluate("()=>{window.open=()=>{throw Error('PRIVATE_ERROR')};}")
    run(page,'start')
    assert page.evaluate("()=>{try{window.open();}catch(e){return e.message;}}")=='PRIVATE_ERROR'
    assert 'PRIVATE_ERROR' not in json.dumps(run(page,'read'))
    run(page,'stop');browser.close()
print('Offline navigation probe passed: passive startup, native args/results/errors preserved, sanitized logs, restoration.')
