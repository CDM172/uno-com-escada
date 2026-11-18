// ?scene=arch: the architecture kit's demo street (35_wsm_arch.js) instead of a circuit. The circuit's scenery (31, 32)
// and the vegetation stay out of it, as in the ?scene=test viewer: for the files that only know the viewer scenes the
// query reads as ?scene=test from here on (GAME.mode, read before this file, stays 'arch'). Nothing changes otherwise.
if (Q.get('scene') === 'arch') { Q.set('scene', 'test'); Q.set('noveg', '1'); }
