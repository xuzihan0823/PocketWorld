import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYBOARD_KEYS, KeyboardPressState, bindKeyboardFeedback, subscribePhysicalKeyboard } from './keyboard-input.ts';
test('a unique full typing layout includes game controls and fits its case',()=>{
  assert.equal(new Set(KEYBOARD_KEYS.map(k=>k.code)).size,KEYBOARD_KEYS.length);
  for(const code of ['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','KeyR','KeyP','Digit1','Digit2','Digit3','Escape','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','ShiftLeft','ShiftRight','ControlLeft','F12'])assert.ok(KEYBOARD_KEYS.some(k=>k.code===code),code);
  assert.ok(KEYBOARD_KEYS.every(k=>Math.abs(k.x)+k.width/2<=.37&&Math.abs(k.z)+k.depth/2<=.17));
});
test('held chords, repeats and independent releases never toggle another key',()=>{
  const s=new KeyboardPressState();s.press('KeyW','w',0);s.press('KeyD','d',0);s.press('Space',' ',0);s.press('KeyW','w',1);
  assert.ok(s.active('KeyW',500)&&s.active('KeyD',500)&&s.active('Space',500));
  s.release('KeyW','w');assert.equal(s.active('KeyW',500),false);assert.ok(s.active('KeyD',500)&&s.active('Space',500));
  s.release('KeyD');s.release('Space');assert.equal(s.active('Space',500),false);
});
test('a fast tap is visible briefly; aliases stay held until every physical source releases',()=>{
  const s=new KeyboardPressState();s.press('KeyQ','q',0);s.release('KeyQ');assert.ok(s.active('KeyQ',60));assert.equal(s.active('KeyQ',81),false);
  s.press('Enter','Enter',0);s.press('NumpadEnter','Enter',0);s.release('Enter');assert.ok(s.active('Enter',500));s.release('NumpadEnter');assert.equal(s.active('Enter',500),false);
  s.press('','W',0);assert.ok(s.active('KeyW',500));s.release('','w');assert.equal(s.active('KeyW',500),false);
});
test('capture input is visual-only and clears on blur, hide, page exit and unsubscribe',()=>{
  const target=new EventTarget(),visibility=new EventTarget();visibility.hidden=false;
  const s=new KeyboardPressState(),unbind=bindKeyboardFeedback(s,target,visibility);
  const down=()=>{const e=new Event('keydown',{cancelable:true});Object.assign(e,{code:'KeyW',key:'w'});target.dispatchEvent(e);assert.equal(e.defaultPrevented,false);};
  down();assert.ok(s.active('KeyW'));target.dispatchEvent(new Event('blur'));assert.equal(s.active('KeyW'),false);
  down();visibility.hidden=true;visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(s.active('KeyW'),false);
  visibility.hidden=false;down();target.dispatchEvent(new Event('pagehide'));assert.equal(s.active('KeyW'),false);
  down();unbind();assert.equal(s.active('KeyW'),false);down();assert.equal(s.active('KeyW'),false);
});
test('a system Meta shortcut clears keys whose keyup the browser may swallow',()=>{
  const s=new KeyboardPressState();s.press('MetaLeft','Meta',0);s.press('KeyC','c',0);s.release('MetaLeft','Meta');
  assert.equal(s.active('MetaLeft',200),false);assert.equal(s.active('KeyC',200),false);
});
test('two scene keyboards share input until the final subscriber is disposed',()=>{
  const oldWindow=globalThis.window,oldDocument=globalThis.document;
  const target=new EventTarget(),visibility=new EventTarget();visibility.hidden=false;
  globalThis.window=target;globalThis.document=visibility;
  const a=subscribePhysicalKeyboard(),b=subscribePhysicalKeyboard();
  try {
    assert.equal(a.state,b.state);a.dispose();a.dispose();
    const down=()=>{const e=new Event('keydown');Object.assign(e,{code:'KeyD',key:'d'});target.dispatchEvent(e);};
    down();assert.ok(b.state.active('KeyD'));b.dispose();assert.equal(b.state.active('KeyD'),false);
    down();assert.equal(b.state.active('KeyD'),false);
  } finally {a.dispose();b.dispose();if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
});
