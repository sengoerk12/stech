const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
const zones = require('../ui/computer-zones.js');

test('terminal names map to a zone and seat number', () => {
  assert.deepEqual(zones.classify('Beginner 5'), { zoneId: 'beginner', number: 5 });
  assert.deepEqual(zones.classify('BEGINNER-05'), { zoneId: 'beginner', number: 5 });
  assert.deepEqual(zones.classify('Player Zone 10'), { zoneId: 'player', number: 10 });
  assert.deepEqual(zones.classify('Master 2'), { zoneId: 'master', number: 2 });
  assert.deepEqual(zones.classify('Master 2 - 4'), { zoneId: 'master2', number: 4 });
  assert.deepEqual(zones.classify('PC-1'), { zoneId: 'other', number: undefined });
});

test('zone summary counts free computers and the map marks each seat state', () => {
  const computers = [
    { id: '1', name: 'Beginner 1', available: true, virtual: true, status: 'available' },
    { id: '2', name: 'Beginner 2', available: false, virtual: true, status: 'occupied' },
    { id: '9', name: 'PC-1', available: true, virtual: true, status: 'available' },
  ];
  const groups = zones.summarize(computers);
  assert.deepEqual(groups.map(g => [g.zone.id, g.available, g.total]), [['beginner', 1, 2], ['player', 0, 0], ['gamer', 0, 0], ['master', 0, 0], ['master2', 0, 0], ['other', 1, 1]]);
  assert.deepEqual(groups.slice(0, 5).map(g => (zones.isoMap(g.zone, [], undefined, true).match(/class="iso-station/g) || []).length), [17, 10, 10, 5, 5]);
  const svg = zones.isoMap(groups[0].zone, groups[0].computers, '1', true);
  assert.equal((svg.match(/class="iso-station/g) || []).length, 17);
  assert.match(svg, /iso-free iso-selected iso-pickable" data-action="computer-select:1"/);
  assert.equal((svg.match(/data-action=/g) || []).length, 1);
  assert.equal((svg.match(/class="iso-ring"/g) || []).length, 1);
  assert.match(svg, /iso-station iso-busy"/);
  assert.equal((svg.match(/iso-station iso-missing/g) || []).length, 15);
});
