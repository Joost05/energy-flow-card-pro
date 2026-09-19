import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMobileFocusGraph, hasFocusableChildren } from '../src/helpers/mobileFocusHelper';
import type { EnergyNode } from '../src/models/Node';
import type { Connection } from '../src/models/Connection';

const nodes: EnergyNode[] = [
  { id:'home', type:'home', role:'home', invert:false, config:{type:'home'} },
  { id:'grid', type:'grid', role:'bidirectional', invert:false, config:{type:'grid'} },
  { id:'desk', type:'consumer', role:'consumer', invert:false, config:{type:'consumer'} },
  { id:'pc', type:'consumer', role:'consumer', invert:false, config:{type:'consumer'} },
  { id:'tv', type:'consumer', role:'consumer', invert:false, config:{type:'consumer'} },
];
const c = (id:string, from:string, to:string): Connection => ({ id, from, to, bidirectional:false, visible:true, animated:true, speed:1, width:3, invert:false });
const connections = [c('g','grid','home'), c('d','home','desk'), c('p','desk','pc'), c('t','desk','tv')];

test('mobile root only shows direct Home neighbours', () => {
  const graph = buildMobileFocusGraph(nodes, connections);
  assert.deepEqual(graph.nodes.map(n=>n.id), ['home','grid','desk']);
  assert.deepEqual(graph.connections.map(x=>x.id), ['g','d']);
});

test('mobile focus shows direct children without parent', () => {
  const graph = buildMobileFocusGraph(nodes, connections, 'desk');
  assert.deepEqual(graph.nodes.map(n=>n.id), ['desk','pc','tv']);
  assert.deepEqual(graph.connections.map(x=>x.id), ['p','t']);
  assert.equal(graph.parentId, 'home');
});

test('leaf cannot become focus root', () => {
  assert.equal(hasFocusableChildren('pc', nodes, connections), false);
  assert.equal(buildMobileFocusGraph(nodes, connections, 'pc').focusId, 'home');
});
