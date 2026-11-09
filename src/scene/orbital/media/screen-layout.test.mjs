import test from 'node:test';
import assert from 'node:assert/strict';
import { fitComputerDisplay, fitExpandedDisplay } from './screen-layout.ts';
const point=(x,y,z=.5)=>({x,y,z});
test('a tilted monitor fits an integer 4:3 rectangle inside its bezel',()=>{
  const rect=fitComputerDisplay([point(100.3,90.6),point(570.7,90.6),point(105.8,450.2),point(566.1,450.2)],{width:800,height:600});
  assert.ok(rect);assert.equal(rect.width*3,rect.height*4);assert.ok(Object.values(rect).every(Number.isInteger));
  assert.ok(rect.left>=106&&rect.left+rect.width<=566&&rect.top>=91&&rect.top+rect.height<=450);
});
test('resizing a partially offscreen monitor keeps the display inside the viewport',()=>{
  const rect=fitComputerDisplay([point(-60,-20),point(440,-20),point(-60,355),point(440,355)],{width:360,height:280});
  assert.ok(rect);assert.ok(rect.left>=0&&rect.top>=0&&rect.left+rect.width<=360&&rect.top+rect.height<=280);
});
test('invalid, behind-camera, reversed and tiny projections stay hidden',()=>{
  const viewport={width:800,height:600};
  assert.equal(fitComputerDisplay([],viewport),null);
  for(const z of [NaN,2,-2])assert.equal(fitComputerDisplay([point(0,0,z),point(800,0),point(0,600),point(800,600)],viewport),null);
  assert.equal(fitComputerDisplay([point(100,0),point(10,0),point(100,100),point(10,100)],viewport),null);
  assert.equal(fitComputerDisplay([point(0,0),point(50,0),point(0,40),point(50,40)],viewport),null);
});
for (const [width,height] of [[320,568],[390,844],[844,390],[1280,720]]) {
  test(`enlarged display fits ${width}×${height}, toolbar and safe insets without distortion`,()=>{
    const bounds={left:12,top:84,width:width-24,height:height-108};
    const rect=fitExpandedDisplay(bounds);assert.ok(rect);assert.equal(rect.width*3,rect.height*4);
    assert.ok(rect.left>=bounds.left&&rect.top>=bounds.top);
    assert.ok(rect.left+rect.width<=bounds.left+bounds.width&&rect.top+rect.height<=bounds.top+bounds.height);
    assert.ok(rect.width>=Math.min(width-28,(height-112)*4/3));
  });
}
