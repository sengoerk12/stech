// Bilgisayar türleri ve salon yerleşimi. PanCafe terminal adı tür adını ve sıra numarasını
// içermelidir (ör. "Beginner 5", "BEGINNER-05", "Player Zone 3", "Master 2 - 4").
// Yeni bir türün haritasını eklemek için ilgili kayda `layout` tanımlamak yeterlidir.
(() => {
  const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Yerleşim birimi bir masa genişliğidir; bakış, salonun (+x,+y) köşesinden orijine doğrudur.
  // `wall: 'left'` masayı y ekseni boyunca, `wall: 'back'` x ekseni boyunca dizer. `at` eksen
  // üzerindeki konum, `offset` masanın dayandığı duvarın yeri, `flip` sandalyenin ters tarafta
  // (masa bakışa yakın duvarda) olduğunu belirtir.
  const DEPTH = 1.75, AISLE = 1.3;
  const row = (numbers, wall, at, extra = {}) => numbers.map((number, i) => ({ number, wall, at: at + i, ...extra }));

  const beginnerLayout = (() => {
    const stations = [], pillars = [];
    let at = 0.3;
    for (const group of [[13, 12, 11, 10], [9, 8, 7], [6, 5, 4], [3, 2, 1]]) {
      stations.push(...row(group, 'left', at)); at += group.length;
      pillars.push({ wall: 'left', at, size: 0.6 }); at += 0.6;
    }
    pillars.pop();
    stations.push(...row([14, 15, 16, 17], 'back', 3.4));
    pillars.push({ wall: 'back', at: 7.4, size: 0.6 });
    const L = at - 0.3, B = 8.3, F = DEPTH + AISLE;
    return { stations, pillars, hint: 'Kasa / giriş',
      walls: [{ plane: 'x', at: 0, from: 0, to: L }, { plane: 'y', at: 0, from: 0, to: B }],
      floor: [[0, 0], [B, 0], [B, F], [F, F], [F, L], [0, L]] };
  })();

  // Ortadaki bloğun kuzey ve batı yüzüne dizili; köşe bakışa dönüktür.
  const playerLayout = (() => {
    const S = 5.8, F = DEPTH + AISLE;
    return { pillars: [],
      stations: [...row([1, 2, 3, 4, 5], 'back', -5.5), ...row([10, 9, 8, 7, 6], 'left', -5.5)],
      blocks: [{ x0: -S, y0: -S, x1: 0, y1: 0 }],
      walls: [{ plane: 'x', at: 0, from: -S, to: 0 }, { plane: 'y', at: 0, from: -S, to: 0 }],
      floor: [[-S, 0], [0, 0], [0, -S], [F, -S], [F, F], [-S, F]] };
  })();

  // Karşılıklı iki sıra: 1–5 batı duvarında, 6–10 doğu duvarında (8 ile 9 arasında kolon).
  const gamerLayout = (() => {
    const W = DEPTH * 2 + 1.7, L = 6.5, east = { offset: W, flip: true };
    return { stations: [...row([1, 2, 3, 4, 5], 'left', 1.2), ...row([6, 7, 8], 'left', 0.3, east), ...row([9, 10], 'left', 4, east)],
      pillars: [{ wall: 'left', at: 3.3, size: 0.7, ...east }],
      walls: [{ plane: 'x', at: 0, from: 0, to: L }, { plane: 'y', at: 0, from: 0, to: W }],
      floor: [[0, 0], [W, 0], [W, L], [0, L]] };
  })();

  const masterLayout = (() => {
    const W = DEPTH * 2 + 1.5, L = 3.9, east = { offset: W, flip: true };
    return { stations: [...row([1, 2], 'left', 0.6), ...row([3, 4, 5], 'left', 0.6, east)], pillars: [],
      walls: [{ plane: 'x', at: 0, from: 0, to: L }, { plane: 'y', at: 0, from: 0, to: W }],
      floor: [[0, 0], [W, 0], [W, L], [0, L]] };
  })();

  // Doğu duvarı görünümün sol duvarıdır: 4–5 içeri taşan bölmede, 1–3 duvar boyunca.
  const master2Layout = (() => {
    const W = DEPTH + 2.6, L = 6.2, step = 1.1;
    return { stations: [...row([5, 4], 'left', 0.3, { offset: step }), ...row([3, 2, 1], 'left', 2.8)], pillars: [],
      blocks: [{ x0: 0, y0: 0, x1: step, y1: 2.5 }],
      walls: [{ plane: 'x', at: 0, from: 2.5, to: L }, { plane: 'x', at: step, from: 0, to: 2.5 }, { plane: 'y', at: 0, from: step, to: W }],
      floor: [[0, 0], [W, 0], [W, L], [0, L]] };
  })();

  const zones = [
    { id: 'beginner', name: 'Beginner', description: 'Günlük oyun ve internet', match: /beginner|begginer|^b[\s\-_]*\d+$/, layout: beginnerLayout },
    { id: 'player', name: 'Player Zone', description: 'Rekabetçi oyunlar için', match: /player/, layout: playerLayout },
    { id: 'gamer', name: 'Gamer Zone', description: 'Yüksek performans', match: /gamer/, layout: gamerLayout },
    { id: 'master2', name: 'Master 2 Zone', description: 'Özel oda', match: /master[\s\-_]*2[\s\-_]*(zone)?[\s\-_]+\d+$|master2/, layout: master2Layout },
    { id: 'master', name: 'Master Zone', description: 'Özel oda', match: /master/, layout: masterLayout },
  ];
  const other = { id: 'other', name: 'Diğer bilgisayarlar', description: 'Türü belirtilmemiş bilgisayarlar' };

  function classify(name) {
    const text = String(name ?? '').trim().toLocaleLowerCase('en');
    const zone = zones.find(z => z.match.test(text));
    const digits = text.match(/(\d+)\D*$/);
    return { zoneId: zone ? zone.id : other.id, number: zone && digits ? Number(digits[1]) : undefined };
  }

  // Tür kartları için özet. Haritası olan tür, eşleşen terminal olmasa da listelenir.
  function summarize(computers) {
    const groups = new Map([...zones, other].map(z => [z.id, { zone: z, computers: [], total: 0, available: 0 }]));
    for (const pc of computers || []) {
      const info = classify(pc.name), group = groups.get(info.zoneId);
      group.computers.push({ ...pc, number: info.number });
      group.total++; if (pc.available) group.available++;
    }
    for (const group of groups.values()) group.computers.sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || String(a.name).localeCompare(String(b.name), 'tr', { numeric: true }));
    const order = ['beginner', 'player', 'gamer', 'master', 'master2', 'other'];
    return order.map(id => groups.get(id)).filter(g => g.total > 0 || g.zone.layout);
  }

  // ---- İzometrik çizim ----
  const U = 60, COS = 0.866, SIN = 0.5, WALL = 1.55;
  const point = (x, y, z = 0) => [((x - y) * COS * U), ((x + y) * SIN * U - z * U)];
  const poly = (points, cls, extra = '') => `<polygon class="${cls}" points="${points.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}" ${extra}/>`;
  // Görünen üç yüz: üst, +x (sağ) ve +y (sol).
  function box(xa, ya, xb, yb, z0, z1, cls) {
    const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), y0 = Math.min(ya, yb), y1 = Math.max(ya, yb);
    return poly([point(x0, y1, z0), point(x1, y1, z0), point(x1, y1, z1), point(x0, y1, z1)], `${cls} face-left`)
      + poly([point(x1, y0, z0), point(x1, y1, z0), point(x1, y1, z1), point(x1, y0, z1)], `${cls} face-right`)
      + poly([point(x0, y0, z1), point(x1, y0, z1), point(x1, y1, z1), point(x0, y1, z1)], `${cls} face-top`);
  }
  // Duvar koordinatını (duvar boyunca a, duvardan içeri d) salon koordinatına çevirir.
  const place = spot => {
    const depth = d => (spot.offset || 0) + (spot.flip ? -d : d);
    return (a0, d0, a1, d1) => spot.wall === 'left' ? [depth(d0), a0, depth(d1), a1] : [a0, depth(d0), a1, depth(d1)];
  };
  const centre = r => (r[0] + r[2] + r[1] + r[3]) / 2;
  const corners = r => { const x0 = Math.min(r[0], r[2]), x1 = Math.max(r[0], r[2]), y0 = Math.min(r[1], r[3]), y1 = Math.max(r[1], r[3]); return [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)]; };

  function station(zone, spot, pc, selectedId, selectable) {
    const rect = place(spot), a = spot.at;
    const state = !pc ? 'missing' : pc.available ? 'free' : pc.status === 'occupied' ? 'busy' : 'off';
    const selected = pc && pc.id === selectedId;
    const label = !pc ? 'sistemde tanımlı değil' : state === 'free' ? 'boş' : state === 'busy' ? 'dolu' : 'kullanıma hazır değil';
    const tile = rect(a + 0.04, 0, a + 0.96, DEPTH), tilePoints = corners(tile);
    const parts = [
      box(...rect(a + 0.08, 0.1, a + 0.92, 0.72), 0, 0.42, 'iso-desk'),
      box(...rect(a + 0.2, 0.22, a + 0.8, 0.3), 0.42, 0.92, 'iso-screen'),
      box(...rect(a + 0.3, 1.02, a + 0.7, 1.4), 0, 0.3, 'iso-chair'),
      box(...rect(a + 0.3, 1.34, a + 0.7, 1.42), 0.3, 0.74, 'iso-chair'),
    ];
    if (spot.flip) parts.reverse();
    const at = rect(a + 0.5, DEPTH + 0.32, a + 0.5, DEPTH + 0.32), [lx, ly] = point(at[0], at[1]);
    const text = `<text class="iso-number" x="${lx.toFixed(1)}" y="${(ly + 7).toFixed(1)}" text-anchor="middle">${spot.number}</text>`;
    const action = pc && (state === 'free') ? `data-action="computer-select:${esc(pc.id)}" tabindex="0" role="button"` : '';
    return { depth: centre(tile), html: `<g class="iso-station iso-${state}${selected ? ' iso-selected' : ''}${action && selectable ? ' iso-pickable' : ''}" ${action} aria-label="${esc(zone.name)} ${spot.number}, ${label}${selected ? ', seçili' : ''}">${poly(tilePoints, 'iso-tile')}${parts.join('')}</g>`, text: `<g class="iso-label iso-${state}${selected ? ' iso-selected' : ''}" aria-hidden="true">${text}</g>`, ring: selected ? poly(tilePoints, 'iso-ring') : '' };
  }

  function wall(w) {
    const p = (t, z, inset = 0) => w.plane === 'x' ? point(w.at + inset, t, z) : point(t, w.at + inset, z);
    return poly([p(w.from, 0), p(w.to, 0), p(w.to, WALL), p(w.from, WALL)], `iso-wall iso-wall-${w.plane === 'x' ? 'left' : 'back'}`)
      + poly([p(w.from + 0.15, WALL - 0.22, 0.02), p(w.to - 0.15, WALL - 0.22, 0.02), p(w.to - 0.15, WALL - 0.1, 0.02), p(w.from + 0.15, WALL - 0.1, 0.02)], 'iso-light');
  }

  function isoMap(zone, computers, selectedId, selectable) {
    const layout = zone.layout, byNumber = new Map();
    for (const pc of computers) if (pc.number !== undefined && !byNumber.has(pc.number)) byNumber.set(pc.number, pc);
    const outline = layout.floor.flatMap(([x, y]) => [point(x, y), point(x, y, WALL)]);
    const xs = outline.map(p => p[0]), ys = outline.map(p => p[1]);
    const minX = Math.min(...xs) - 30, maxX = Math.max(...xs) + 30, minY = Math.min(...ys) - 16, maxY = Math.max(...ys) + 30;
    const items = [
      ...layout.pillars.map(p => { const r = place(p)(p.at + 0.05, 0, p.at + p.size - 0.05, 0.85); return { depth: centre(r), html: box(...r, 0, p.flip ? 0.5 : WALL, 'iso-pillar') }; }),
      ...layout.stations.map(s => station(zone, s, byNumber.get(s.number), selectedId, selectable)),
    ].sort((a, b) => a.depth - b.depth);
    return `<svg class="iso-map" viewBox="${minX.toFixed(0)} ${minY.toFixed(0)} ${(maxX - minX).toFixed(0)} ${(maxY - minY).toFixed(0)}" role="group" aria-label="${esc(zone.name)} salon yerleşimi">${poly(layout.floor.map(([x, y]) => point(x, y)), 'iso-floor')}${(layout.blocks || []).map(b => box(b.x0, b.y0, b.x1, b.y1, 0, WALL, 'iso-pillar')).join('')}${layout.walls.map(wall).join('')}${items.map(i => i.html).join('')}${items.map(i => i.ring || '').join('')}${items.map(i => i.text || '').join('')}</svg>`;
  }

  window.ComputerZones = { zones, classify, summarize, isoMap };
  if (typeof module !== 'undefined') module.exports = window.ComputerZones;
})();
