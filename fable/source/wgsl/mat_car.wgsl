// Materiais do carro (Fiat Uno Mille EP): pintura metálica com verniz, plásticos, borracha, pneus, calotas, lentes, alumínio...
// id (mat.x): 1 pintura | 2 plástico preto | 3 borracha | 4 pneu | 5 calota | 6 aço | 7 cromado | 8 interior | 9 lente opaca
//             10 alumínio | 11 cinta | 12 decalque do atlas | 13 fundo | 14 refletor do farol | 15 espelho | 16 palhetas da grade
//             17 pintura lisa brilhante (capacete; a=1 preto vítreo)
// O.p0 da carroceria: x = luz de freio, y = luz de ré, z = faróis. O.p0.x das rodas = |velocidade angular|.
#include mesh_vert
@group(3) @binding(0) var tAtlas: texture_2d<f32>;
#ifdef BCAR
// The Aston Martins (the cars modelled in Blender) use this family with the BCAR define and their own (DB5, V8): ids 20 to 28
// are their materials and ids 6, 7 and 12 have variants for them; ids 2, 3 and 13 are shared as they are. The paint colour
// is PAINT_ALB / PAINT_MET (30_car_e_db5.js, 30_car_f_v8.js). Without BCAR the source that reaches the GPU is the Uno's, to the letter.
//   20 paint (a=1 unpainted edges) | 21 tyre | 22 lamp lenses (a: 0 headlamp, 1 stop/tail, 2 indicator, 3 reflector,
//   4 reversing lamp) | 23 headlamp bowl | 24 leather (a=0 pleated) | 25 cloth and figure | 26 dashboard (a=1 wood)
//   27 blur disc of the wire wheels | 28 muzzle flash
//   O.p0 of the DB5 body: x brake, y reverse, z headlamps, w = x where the tail lamps begin; O.p1 = radar screen in the atlas
//   (centre, radii); O.p2, O.p3 = needles of the speedometer and rev counter in the atlas (pivot, tip).
//   O.p0 of its wheels: x |angular speed|, y outer radius of the tyre. O.p0 of the guns: x, y flash of the left/right gun, z seed.
fn segDist(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0); return length(pa - ba * h); }
#endif
const PAINT_COL = vec3f(0.168, 0.275, 0.425);   // azul-claro metálico de estúdio: mais escuro e acinzentado (o sol do jogo é forte)
fn carBulgeW(x: f32) -> f32 { return 0.055 * smoothstep(-0.15, 0.25, x) - 0.036 * smoothstep(-1.15, -1.42, x); }
fn surf(in: V2F, ff: bool) -> Surface {
  var s = surfDefault(normalize(in.nrm));
  let id = matId(in.mat); let pa = matA(in.mat) * 255.0;
  let lp = in.ext.xyz;
  s.albedo = in.col.rgb;
  switch (id) {
    case 1u: {   // pintura azul-claro metálica com verniz
      // flocos metálicos: ruído 3D no espaço do carro (sem estrias em nenhum painel)
      // (ruído 2D com mips, projetado pelos três eixos do carro: com a distância ou em ângulo rasante os mips levam à média
      //  e o floco some sozinho — o ruído 3D sem mips virava uma trama diagonal no capô)
      let nO = normalize((vec4f(s.normal, 0.0) * O.model).xyz); let wt = abs(nO) / (abs(nO.x) + abs(nO.y) + abs(nO.z));
      let fl = textureSample(tNoise, sLin, lp.zy * 23.0).a * wt.x + textureSample(tNoise, sLin, lp.xz * 23.0).a * wt.y + textureSample(tNoise, sLin, lp.xy * 23.0).a * wt.z - 0.5;
      s.albedo = PAINT_COL * (1.0 + 0.08 * fl); s.metal = 0.58; s.rough = 0.3 + 0.04 * fl; s.coat = 1.0;
      // abas dos recortes junto ao chão (base das caixas de roda): escuras, para não sobrar lasca clara pendurada
      { let under = (1.0 - smoothstep(0.31, 0.345, lp.y)) * smoothstep(1.4, 1.5, abs(lp.x)); s.albedo = mix(s.albedo, vec3f(0.01), under); s.coat *= 1.0 - under; s.metal *= 1.0 - under; s.rough = mix(s.rough, 0.95, under); }
      if (pa > 0.5) { let low = max(1.0 - smoothstep(0.2, 0.26, lp.y), (1.0 - smoothstep(0.54, 0.6, lp.y)) * smoothstep(1.2, 1.3, abs(lp.x))); s.albedo = mix(s.albedo, vec3f(0.012), low); s.coat *= 1.0 - low; s.metal *= 1.0 - low; s.rough = mix(s.rough, 0.9, low); }
      if (pa < 0.5) {
        var d = abs(in.uv.x);
        // tampa de combustível (lado esquerdo)
        if (lp.z < -0.5) { d = min(d, abs(length(vec2f(lp.x + 1.04, lp.y - 0.715)) - 0.062)); }
        // vão entre painéis: núcleo escuro de ~4 mm + sombra suave em volta (lê como fresta, não como traço);
        // quando fica menor que o pixel, some por cobertura em vez de engrossar
        let w = max(fwidth(d), 1e-5); let hw = 0.002;
        let line = sat((hw - d) / w + 0.5) * min(1.0, 2.0 * hw / w);
        let halo = (1.0 - smoothstep(hw, hw + 0.007, d)) * sat(0.0035 / w);
        s.albedo *= 1.0 - 0.22 * halo; s.ao = min(s.ao, 1.0 - 0.4 * halo);
        // faixa lateral mais escura entre os dois vincos + friso fino escuro na borda de cima + soleira sombreada
        let side = step(in.uv.y, 0.4);
        // (nas fotos de estúdio tudo abaixo do friso é um tom mais escuro)
        let band = smoothstep(0.215, 0.25, lp.y) * (1.0 - smoothstep(0.575, 0.59, lp.y)) * side;
        s.albedo *= 1.0 - 0.3 * band; s.rough += 0.03 * band;
        let wy = max(fwidth(lp.y), 1e-5);
        // friso lateral: faixa larga de borracha preta (~5 cm) na altura do topo dos para-choques, entre as caixas de roda
        let sx = smoothstep(-0.83, -0.80, lp.x) * (1.0 - smoothstep(0.80, 0.83, lp.x));
        let sdy = lp.y - 0.607; let strip = sat((0.025 - abs(sdy)) / wy + 0.5) * min(1.0, 0.05 / wy) * side * sx;
        { let upS = normalize((O.model * vec4f(0.0, 1.0, 0.0, 0.0)).xyz); let eb = smoothstep(0.014, 0.024, abs(sdy)) * strip; s.normal = normalize(s.normal + upS * sign(sdy) * eb * 0.8); }
        // soleira: faixa preta fosca sob a porta, entre as caixas de roda
        let sill = (1.0 - smoothstep(0.222, 0.234, lp.y)) * side;
        s.albedo = mix(s.albedo, vec3f(0.014), sill * 0.92); s.coat *= 1.0 - sill; s.metal *= 1.0 - sill; s.rough = mix(s.rough, 0.85, sill); s.ao = min(s.ao, 1.0 - 0.3 * sill);
        // vinco horizontal da tampa traseira (na altura do topo das lanternas): dobra a normal numa faixa estreita
        if (lp.x < -1.5 && in.uv.y > 0.66) {
          let t = (lp.y - 0.836) / 0.007; let upW = normalize((O.model * vec4f(0.0, 1.0, 0.0, 0.0)).xyz);
          s.normal = normalize(s.normal + upW * (t * exp(-t * t) * 0.55) * (1.0 - smoothstep(0.44, 0.48, abs(lp.z))));
          // rebaixo da placa: degrau sombreado em volta da placa (retângulo arredondado) e fundo levemente mais escuro
          let q = abs(vec2f(lp.z, lp.y - 0.717)) - vec2f(0.203, 0.064); let pr = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - 0.014;
          let stepb = 1.0 - smoothstep(0.0, 0.007, abs(pr));
          s.albedo *= 1.0 - 0.3 * stepb - 0.07 * (1.0 - smoothstep(-0.004, 0.0, pr)); s.ao = min(s.ao, 1.0 - 0.5 * stepb);
        }
        var black = max(line, strip); var lvShade = 1.0;
        if (in.uv.y > 0.66) {
          let zz = lp.z / 0.72; let xe = lp.x - carBulgeW(lp.x) * (1.0 - zz * zz);
          // grade plástica na base do para-brisa
          let cowl = smoothstep(0.6, 0.61, xe) * (1.0 - smoothstep(0.741, 0.745, xe));
          black = max(black, cowl);
          // grelha de ventilação do capô: fileira de aletas ~10 cm à frente da borda traseira, centrada (como na foto)
          let lz = lp.z / 0.021; let cz = fract(lz) - 0.5; let slot = smoothstep(0.3, 0.42, abs(cz) * 2.0);
          let lin = smoothstep(0.843, 0.846, xe) * (1.0 - smoothstep(0.876, 0.879, xe)) * (1.0 - smoothstep(0.218, 0.222, abs(lp.z)));
          let lv = (1.0 - slot) * lin;
          // rebaixo: a borda de cada aleta dobra a normal (pega brilho de um lado, sombra do outro) e o fundo tem degradê
          let rightW = normalize((O.model * vec4f(0.0, 0.0, 1.0, 0.0)).xyz); let fwdW = normalize((O.model * vec4f(1.0, 0.0, 0.0, 0.0)).xyz);
          let bev = smoothstep(0.22, 0.36, abs(cz) * 2.0) * (1.0 - smoothstep(0.44, 0.58, abs(cz) * 2.0)) * lin;
          let endb = (smoothstep(0.836, 0.845, xe) * (1.0 - smoothstep(0.845, 0.851, xe)) - smoothstep(0.871, 0.877, xe) * (1.0 - smoothstep(0.877, 0.886, xe))) * (1.0 - slot) * (1.0 - smoothstep(0.218, 0.222, abs(lp.z)));
          s.normal = normalize(s.normal - rightW * sign(cz) * bev * 0.7 + fwdW * endb * 0.6);
          s.ao = min(s.ao, 1.0 - 0.35 * bev); s.ao = min(s.ao, 1.0 - 0.7 * lv);   // o fundo da fenda não devolve céu nem sol
          lvShade = mix(1.0, mix(0.3, 1.1, sat(cz * 2.6 + 0.5)) * mix(0.5, 1.0, sat((xe - 0.846) / 0.03)), lin);   // só dentro das aletas (a base do para-brisa fica lisa)
          // pé dos dois vincos longitudinais: linha de sombra fina que acompanha o ressalto
          let zc = 0.515 - 0.145 * sat((xe - 0.72) / 1.03);
          let hx = smoothstep(0.78, 0.9, xe) * (1.0 - smoothstep(1.68, 1.76, xe));
          // aresta viva do ressalto: a normal dobra para fora numa faixa estreita (a face do degrau pega o céu de um lado e
          // sombra do outro), com uma linha de sombra fina no pé — o vinco lê de qualquer ângulo, inclusive da câmera de capô
          let dz = abs(lp.z) - zc; let wz = max(fwidth(lp.z), 1e-5);
          let face = (1.0 - smoothstep(0.004, 0.0085, abs(dz))) * hx;
          let foot = (1.0 - smoothstep(0.003, 0.02 + 2.0 * wz, abs(dz - 0.013))) * hx;   // faixa de sombra larga e suave (lê a 1 m em ângulo rasante, sem tracejar)
          let crest = (1.0 - smoothstep(0.003, 0.016 + 2.0 * wz, abs(dz + 0.012))) * hx;
          s.normal = normalize(s.normal + rightW * sign(lp.z) * (face * 1.0 + foot * 0.3));
          s.albedo *= (1.0 - 0.5 * foot) * (1.0 + 0.2 * crest); s.ao = min(s.ao, 1.0 - 0.6 * foot);
          s.coat *= 1.0 - 0.8 * foot; s.rough = mix(s.rough, 0.7, foot);   // no pé do degrau o verniz não devolve o céu: a linha de sombra aparece também em ângulo rasante
          black = max(black, lv);
        }
        s.albedo = mix(s.albedo, vec3f(0.016) * lvShade, black); s.coat *= 1.0 - black; s.rough = mix(s.rough, 0.95, black); s.metal *= 1.0 - black; s.ao = min(s.ao, 1.0 - line * 0.6);
      }
    }
    case 2u: {   // plástico preto: granulado finíssimo (quase liso a 3 m), arestas vivas, um pouco de difuso para ler na sombra
      let g = textureSample(tNoise, sLin, lp.xz * 57.0 + lp.yy * 43.0).b;
      let g2 = textureSample(tNoise, sLin, lp.zy * 131.0 + lp.xx * 97.0).a;
      s.albedo = in.col.rgb * vec3f(0.96, 1.0, 1.05) * (0.2 + 0.13 * g + 0.09 * g2); s.rough = select(0.94 + 0.05 * g2, 0.4, pa > 0.5); s.ao = 0.38 + 0.2 * g2; s.metal = select(0.0, 0.55, pa > 0.5);
    }
    case 3u: { s.albedo = in.col.rgb * vec3f(0.96, 1.0, 1.05) * 1.0; s.rough = 0.84; s.ao = 0.6; s.metal = 0.5; }
    case 4u: {   // pneu de passeio
      let r = length(lp.xy); let ang = atan2(lp.y, lp.x);
      let blur = sat(O.p0.x / 25.0);
      if (pa < 0.5) {
        // banda: lamelas finas e discretas, só entre os ombros (os sulcos longitudinais são geometria)
        let lane = floor((lp.z + 0.055) / 0.022);
        let k = fract(ang / 6.2831853 * 118.0 + lane * 0.5);
        let sipe = (1.0 - smoothstep(0.05, 0.1, abs(k - 0.5))) * (1.0 - blur) * (1.0 - smoothstep(0.03, 0.038, abs(lp.z)));
        s.albedo = in.col.rgb * vec3f(0.96, 1.0, 1.05) * 0.5 * (1.0 - 0.5 * sipe); s.ao = 0.45 - 0.2 * sipe; s.rough = 0.95; s.metal = 0.0;
      } else {
        // flanco liso: dois frisos concêntricos e poucas inscrições pequenas em relevo suave
        let ring = (1.0 - smoothstep(0.0006, 0.0014, abs(r - 0.243))) + (1.0 - smoothstep(0.0006, 0.0014, abs(r - 0.196)));
        let tb = smoothstep(0.2075, 0.209, r) * (1.0 - smoothstep(0.2185, 0.22, r));
        let win = step(0.55, textureSampleLevel(tNoise, sLin, vec2f(ang * 0.33, 0.61), 0.0).r);
        let st = smoothstep(0.3, 0.45, abs(fract(ang * 58.0) - 0.5)) * step(0.35, textureSampleLevel(tNoise, sLin, vec2f(ang * 9.3, 0.37), 0.0).a);
        let letters = tb * win * st * (1.0 - blur);
        // friso largo junto ao ombro e nervuras radiais finas no flanco (pneu de verdade, não massa lisa)
        let ribs = (0.5 + 0.5 * sin(ang * 150.0)) * smoothstep(0.222, 0.226, r) * (1.0 - smoothstep(0.238, 0.242, r)) * (1.0 - blur) * sat(1.0 - fwidth(ang) * 150.0 * 0.4);
        let band2 = smoothstep(0.247, 0.249, r) * (1.0 - smoothstep(0.256, 0.258, r));
        s.albedo = in.col.rgb * vec3f(0.96, 1.0, 1.05) * 0.5 * (1.0 + 1.8 * letters + 0.8 * ring * (1.0 - blur) + 0.35 * ribs + 0.3 * band2); s.rough = 0.9 - 0.2 * letters; s.ao = 0.5 - 0.15 * ribs + 0.25 * letters; s.metal = 0.0;
      }
    }
    case 5u: {   // calota prateada
      let r = length(lp.xy);
      s.albedo = in.col.rgb; s.metal = 0.75; s.rough = 0.36; s.coat = 0.25;
      if (pa > 0.5) {
        // disco de borrão: cobre os rasgos por pontilhado conforme a roda gira (média radial: anel dos rasgos mais escuro)
        let cov = smoothstep(9.0, 34.0, O.p0.x);
        if (ign(in.pos.xy, F.misc.y) >= cov) { discard; }
        let ringd = 1.0 - smoothstep(0.016, 0.03, abs(r - 0.123));
        let rim = 1.0 - smoothstep(0.001, 0.003, abs(r - 0.156)); let hub = 1.0 - smoothstep(0.016, 0.024, r); let bolts = 1.0 - smoothstep(0.005, 0.01, abs(r - 0.058));
        let streak = 0.5 + 0.5 * sin(atan2(lp.y, lp.x) * 16.0);   // resto dos 16 rasgos, quase apagado pelo giro
        s.albedo = in.col.rgb * (1.0 - 0.5 * ringd * (0.85 + 0.15 * streak) - 0.35 * rim - 0.4 * hub - 0.22 * bolts); s.rough = 0.42; s.coat = 0.15; s.ao = 1.0 - 0.35 * ringd;
        return s;
      }
      let far = smoothstep(0.004, 0.011, fwidth(r)) * (1.0 - smoothstep(0.019, 0.026, abs(r - 0.123)));
      s.albedo *= 1.0 - 0.3 * far;
      let c = 1.0 - smoothstep(0.0012, 0.0024, abs(r - 0.031));
      // emblema central: cinco barras inclinadas em baixo-relevo
      let q = lp.x + lp.y * 0.3;
      let bars = (1.0 - smoothstep(0.2, 0.3, abs(fract(q / 0.0078 + 0.5) - 0.5))) * step(abs(lp.y), 0.0155) * step(abs(q), 0.0195) * (1.0 - sat(O.p0.x / 20.0));
      s.albedo *= 1.0 - 0.5 * bars; s.rough += 0.1 * bars;
      // friso na borda e sombra suave para dentro dos rasgos
      s.albedo *= 1.0 - 0.3 * (1.0 - smoothstep(0.001, 0.0025, abs(r - 0.156)));
      // cinco rebaixos de parafuso em volta do centro
      let a5 = atan2(lp.y, lp.x) / 6.2831853 * 5.0; let da = (a5 - round(a5)) / 5.0 * 6.2831853 * r;
      let dimple = 1.0 - smoothstep(0.006, 0.008, length(vec2f(da, r - 0.058)));
      s.albedo *= 1.0 - 0.5 * c - 0.6 * dimple; s.ao = 1.0 - 0.5 * dimple;
    }
#ifdef BCAR
    case 6u: {   // steel: a = 0 armour plate (rolled, dull), a = 1 gun-metal (blued, smoother)
      let n = textureSample(tNoise, sLin, lp.zy * 5.0 + lp.xx * 3.0).r;
      s.metal = 0.85; s.rough = select(0.5 + 0.12 * n, 0.36, pa > 0.5); s.albedo = in.col.rgb * select(0.85 + 0.3 * n, 1.0, pa > 0.5);
    }
    case 7u: {   // chrome: a = 0 mirror-bright, a = 1 satin / alloy, a = 2 wire spokes (thin and bright; they melt into the blur disc at speed)
      s.metal = 1.0; s.rough = select(0.06, 0.25, pa > 0.5);
      if (pa > 1.5) { s.rough = 0.18; s.albedo = in.col.rgb * (1.0 - 0.3 * sat(O.p0.x / 25.0)); }
    }
#else
    case 6u: { s.metal = 0.5; s.rough = select(0.45, 0.6, pa > 0.5); }
    case 7u: { s.metal = 1.0; s.rough = select(0.07, 0.26, pa > 0.5); if (pa > 1.5) { s.metal = 0.72; s.rough = 0.3; } }   // a=2: cromado claro acetinado (emblema)
#endif
    case 8u: {   // interior
      s.rough = 0.92;
      // forro interno atrás dos para-choques (a pele externa é cortada ali): escuro, para não aparecer por baixo do carro
      { let under = (1.0 - smoothstep(0.56, 0.62, lp.y)) * smoothstep(1.2, 1.3, abs(lp.x)); s.albedo = mix(s.albedo, vec3f(0.006), under); }
      if ((pa > 1.5 && pa < 2.5) || pa > 3.5) { let w = sin(lp.z * 900.0) * sin(lp.x * 900.0 + lp.y * 900.0); s.albedo = in.col.rgb * (1.0 + 0.1 * w); }
      if (pa > 3.5) {
        // bancos: gomos horizontais com costura (sulco escuro) a cada ~8 cm
        let k = (fract(lp.y / 0.082 + 0.3 * lp.x) - 0.5) * 0.082; let seam = 1.0 - smoothstep(0.0025, 0.008, abs(k));
        s.albedo *= (1.0 - 0.5 * seam) * (0.86 + 0.14 * cos(k / 0.082 * 6.2831853)); s.ao = 1.0 - 0.4 * seam;
      }
      if (pa > 2.5 && pa < 3.5) { s.rough = 0.55; }
    }
    case 9u: {   // lentes (lanterna traseira, piscas): prismas finos sobre refletor, cores profundas mesmo ao sol
      s.rough = 0.38; s.coat = 0.0;
      let rib = 0.86 + 0.14 * sin(lp.y * 6.2831853 / 0.0042);
      if (pa < 1.5) {
        // lanterna traseira: faixa superior âmbar-escuro (pisca), vermelho-rubi (posição/freio) no meio, ré clara embaixo
        let v = in.uv.y; let u = in.uv.x; let br = sat(O.p0.x);
        // o albedo fica sempre escuro (ao sol não lava para rosa); o freio aceso vem só do emissivo, em vermelho puro
        var c = mix(vec3f(0.17, 0.003, 0.002), vec3f(0.2, 0.004, 0.002), br); var e = mix(0.03, 0.66, br);
        if (v > 0.66) { c = vec3f(0.19, 0.05, 0.002); e = 0.006; }
        else if (v < 0.2 && u < 0.36) { c = mix(vec3f(0.1, 0.1, 0.098), vec3f(1.0, 1.0, 0.95), sat(O.p0.y)); e = 0.004 + sat(O.p0.y) * 0.5; }   // ré: pequeno retângulo interno
        // divisórias em relevo entre as seções (horizontais) e uma vertical a 1/3 da largura: barras escuras com chanfro
        let fy = max(fwidth(v), 1e-4); let fu = max(fwidth(u), 1e-4);
        let dh = min(abs(v - 0.66), select(9.0, abs(v - 0.2), u < 0.36)); let dvv = select(9.0, abs(u - 0.36), v < 0.2);
        // moldura escura fina em volta da lente (bordas de cima, de baixo e interna)
        let vh = (0.5 - abs(v - 0.5)) ; let edge = max(sat(1.0 - (vh - 0.0) / max(0.028, fy)), sat(1.0 - u / max(0.03, fu)));
        let k = sat(max(max(sat(1.0 - dh / max(0.02, fy)), sat(1.0 - dvv / max(0.014, fu))), edge));
        // prismas: pirâmides de ~4,5 mm que dobram a normal (brilhos pontuais do sol) e dão claro/escuro por célula
        let cell = vec2f(lp.z, lp.y) / 0.0045; var pc = fract(cell) - 0.5; pc.x = 0.0;   // lente frisada: nervuras horizontais finas
        let fade = sat(1.0 - fwidth(cell.y) * 1.4);   // some antes de virar serrilhado
        let rightW = normalize((O.model * vec4f(0.0, 0.0, 1.0, 0.0)).xyz); let upW = normalize((O.model * vec4f(0.0, 1.0, 0.0, 0.0)).xyz);
        s.normal = normalize(s.normal + (rightW * pc.x + upW * pc.y) * 0.45 * fade * (1.0 - k));
        let prism = mix(1.0, 0.62 + 0.76 * (1.0 - 2.0 * max(abs(pc.x), abs(pc.y))), fade);
        let depth = 0.8 + 0.2 * sin(u * 7.0 + v * 2.5);   // degradê do refletor atrás da lente
        s.albedo = mix(c * prism * depth, vec3f(0.006), k); s.emissive = e * (1.0 - k) * mix(1.0, 0.8 + 0.4 * (1.0 - 2.0 * max(abs(pc.x), abs(pc.y))), fade);
        s.rough = mix(0.62, 0.8, k);   // lente pouco especular: ao sol continua vermelha/âmbar, sem lavar para rosa
      } else {
        // piscas: lente âmbar translúcida (mais escura e saturada) com o brilho do refletor por trás e verniz
// (uv.x = x + z: coordenada ao longo da frente/lateral) — frisos verticais finos e um degradê de refletor por trás
        let fl2 = 0.5 + 0.5 * sin(in.uv.x * 6.2831853 / 0.0075); let fadeP = sat(1.0 - fwidth(in.uv.x) / 0.0075 * 2.0);
        let gy = 1.0 - 0.45 * abs((lp.y - 0.693) / 0.062);
        s.albedo = in.col.rgb * vec3f(0.9, 0.62, 0.3) * mix(1.0, 0.74 + 0.4 * fl2, fadeP) * gy * (0.9 + 0.1 * rib); s.rough = 0.3; s.coat = 0.7; s.emissive = 0.03;   // lente lisa translúcida, só com frisos horizontais finos
      }
    }
    case 10u: {  // alumínio da escada
      let n = textureSample(tNoise, sLin, vec2f(lp.x * 0.7, (lp.y + lp.z) * 30.0)).r;
      s.albedo = in.col.rgb * (0.94 + 0.08 * n); s.metal = 0.55; s.rough = 0.5 + 0.1 * n;
      if (pa > 0.5) { let k = sin(lp.z * 900.0); s.rough = 0.55; s.albedo *= 0.9 + 0.1 * k; }
      else if (abs(abs(lp.z) - 0.205) > 0.0105 && lp.x > -1.97 && lp.x < 1.21) {
        // extremidade rebitada de cada degrau, visível nas faces laterais das longarinas
        let kx = (fract((lp.x + 1.78) / 0.28 + 0.5) - 0.5) * 0.28; let d = length(vec2f(kx, lp.y - 1.515));
        let ring = smoothstep(0.0215, 0.0195, d) * smoothstep(0.0135, 0.0155, d); let core = 1.0 - smoothstep(0.012, 0.014, d);
        s.albedo *= 1.0 - 0.55 * ring - 0.2 * core; s.ao = 1.0 - 0.5 * ring;
      }
    }
    case 11u: {  // cinta de poliéster
      let w = sin((lp.z + lp.y) * 1800.0) * sin(lp.x * 1800.0);
      s.albedo = in.col.rgb * (0.9 + 0.12 * w); s.rough = 0.8;
    }
#ifdef BCAR
    case 12u: {  // decals of the DB5 atlas: a = 0 number plates, 1 badges (cut out), 2 instruments, 3 radar screen, 4 switch panel
      let t = textureSample(tAtlas, sLin, in.uv);
      if (pa < 0.5) { s.albedo = t.rgb * 0.8; s.rough = 0.42; s.coat = 0.3; }
      else if (pa < 1.5) { if (t.a < 0.5) { discard; } s.albedo = t.rgb; s.metal = 0.9; s.rough = 0.2; s.coat = 0.3; }
      else if (pa < 2.5) {
        // dials, radio, clock: lit from behind. The needles of the speedometer and rev counter are drawn here, from the
        // pivot and tip the game gives in atlas coordinates (O.p2, O.p3).
        let nd = min(segDist(in.uv, O.p2.xy, O.p2.zw), segDist(in.uv, O.p3.xy, O.p3.zw));
        let w = max(fwidth(in.uv.y), 1e-6);
        let needle = sat((0.0026 - nd) / w + 0.5);
        let hub = sat((0.012 - min(distance(in.uv, O.p2.xy), distance(in.uv, O.p3.xy))) / w + 0.5);
        s.albedo = mix(mix(t.rgb, vec3f(1.0, 0.3, 0.04), needle), vec3f(0.03), hub); s.rough = 0.3; s.coat = 0.6;
        s.emissive = 0.03 + 0.03 * needle * (1.0 - hub);
      } else if (pa < 3.5) {
        // radar: green phosphor, with a beam going round (O.p1 = centre and radii of the screen in the atlas)
        let d = (in.uv - O.p1.xy) / max(O.p1.zw, vec2f(1e-5)); let on = step(length(d), 1.0);
        let beam = exp(-fract(atan2(d.y, d.x) / 6.2831853 - F.camPos.w * 0.3) * 5.0) * on;
        s.albedo = t.rgb * (0.7 + 1.5 * beam) + vec3f(0.02, 0.3, 0.07) * beam; s.rough = 0.2; s.coat = 0.6;
        s.emissive = (0.06 + 0.2 * beam) * on;
      } else { s.albedo = t.rgb * 0.85; s.rough = 0.5; }
    }
#else
    case 12u: {  // decalque (placa / emblemas)
      let t = textureSample(tAtlas, sLin, in.uv);
      if (pa > 0.5 && t.a < 0.5) { discard; }
      s.albedo = t.rgb * select(0.7, 1.0, pa > 0.5); s.rough = select(0.62, 0.28, pa > 0.5); s.metal = select(0.0, 0.4, pa > 0.5); s.coat = select(0.0, 0.6, pa > 0.5);
    }
#endif
    case 13u: { s.rough = 1.0; s.ao = 0.3; s.metal = 0.9; }
    case 14u: {  // refletor do farol: cuba prateada com aparência própria (pouco dependente do céu) / bulbo
      let u = in.uv.x; let v = in.uv.y;
      // gradação: mais claro no centro (em volta do bulbo), escurecendo para as bordas e para baixo; facetas verticais em colunas
      let rightW = normalize((O.model * vec4f(0.0, 0.0, 1.0, 0.0)).xyz);
      let fz = sin(lp.z * 6.2831853 / 0.013); let ffade = sat(1.0 - fwidth(lp.z) / 0.013 * 2.5);
      s.normal = normalize(s.normal + rightW * fz * 0.12 * ffade);
      let rr = length(vec2f(u * 0.85, v));
      let grad = mix(1.0, 0.36, smoothstep(0.1, 1.05, rr)) * mix(0.72, 1.0, smoothstep(-1.0, 0.3, v));
      let facet = mix(1.0, 0.86 + 0.14 * fz, ffade);
      s.albedo = vec3f(0.74, 0.75, 0.77) * grad * facet; s.metal = 0.25; s.rough = 0.32; s.ao = 1.0;
      s.emissive = 0.105 * grad;   // a cuba fica na sombra da moldura: luz própria proporcional ao desenho (prateado, não azul do céu)
      if (pa > 0.5) {
        // bulbo claro (a > 0,5) e sua capa prateada na ponta (a > 1,5): discretos, sem ponto preto
        s.normal = normalize(in.nrm);
        if (pa > 1.5) { s.metal = 0.3; s.albedo = vec3f(0.5, 0.5, 0.51); s.rough = 0.35; s.emissive = 0.06; }
        else { s.metal = 0.2; s.albedo = vec3f(0.8, 0.79, 0.74); s.rough = 0.25; s.emissive = 0.09 + O.p0.z * 0.1; }
      }
    }
    case 15u: {   // espelho retrovisor: reflexo FIXO (céu / horizonte de mata / chão), escurecido — não depende do cubemap
      let g = sat((lp.y - 0.965) / 0.082);
      let ground = vec3f(0.03, 0.03, 0.032); let trees = vec3f(0.018, 0.03, 0.014); let sky = mix(vec3f(0.2, 0.25, 0.3), vec3f(0.1, 0.16, 0.26), sat((g - 0.52) / 0.48));
      var c = mix(ground, trees, smoothstep(0.36, 0.42, g)); c = mix(c, sky, smoothstep(0.5, 0.56, g));
      s.albedo = c; s.metal = 0.0; s.rough = 0.5; s.coat = 0.25; s.emissive = 0.045;
    }
    case 16u: {  // palhetas no fundo das fendas: quase pretas
      let k = fract(lp.y / select(0.0105, 0.0175, pa > 0.5));
      s.albedo = in.col.rgb * mix(0.1, 1.0, smoothstep(0.25, 0.5, k)); s.rough = 0.92; s.metal = 0.3; s.ao = mix(0.2, 0.7, smoothstep(0.25, 0.5, k));
    }
    case 17u: { s.rough = select(0.42, 0.3, pa > 0.5); s.coat = select(0.3, 0.35, pa > 0.5); }   // capacete (pintura) / viseira escura lisa, sem espelhar zebras
#ifdef BCAR
    // ================= Aston Martin DB5 =================
    case 20u: {   // paint: Silver Birch, metallic under a clear coat. uv.x = signed distance (m) to the nearest panel gap
      if (pa > 0.5) { s.albedo = vec3f(0.012); s.rough = 0.9; s.ao = 0.5; }   // edges and inner lips of the panels: bare, dark, matt
      else {
        // metal flake: the same mip-mapped noise, projected along the three axes of the car, as the Uno's paint
        let nO = normalize((vec4f(s.normal, 0.0) * O.model).xyz); let wt = abs(nO) / (abs(nO.x) + abs(nO.y) + abs(nO.z));
        let fl = textureSample(tNoise, sLin, lp.zy * 23.0).a * wt.x + textureSample(tNoise, sLin, lp.xz * 23.0).a * wt.y + textureSample(tNoise, sLin, lp.xy * 23.0).a * wt.z - 0.5;
        s.albedo = PAINT_ALB * (1.0 + 0.1 * fl); s.metal = PAINT_MET; s.rough = 0.27 + 0.05 * fl; s.coat = 1.0;
        // shut line: dark core about 4 mm wide with a soft shadow round it; thinner than a pixel, it fades by coverage
        let d = abs(in.uv.x);
        let w = max(fwidth(d), 1e-5); let hw = 0.002;
        let line = sat((hw - d) / w + 0.5) * min(1.0, 2.0 * hw / w);
        let halo = (1.0 - smoothstep(hw, hw + 0.007, d)) * sat(0.0035 / w);
        s.albedo *= 1.0 - 0.22 * halo; s.ao = min(s.ao, 1.0 - 0.4 * halo);
        s.albedo = mix(s.albedo, vec3f(0.016), line); s.coat *= 1.0 - line; s.rough = mix(s.rough, 0.95, line); s.metal *= 1.0 - line; s.ao = min(s.ao, 1.0 - line * 0.6);
      }
    }
    case 21u: {   // cross-ply tyre, in the wheel frame (axle along Z). O.p0 = (|angular speed|, outer radius)
      let R = max(O.p0.y, 0.1); let r = length(lp.xy); let rn = r / R; let ang = atan2(lp.y, lp.x);
      let blur = sat(O.p0.x / 25.0);
      let base = in.col.rgb * vec3f(0.96, 1.0, 1.05) * 0.5;
      if (rn > 0.962) {
#ifdef V8
        // tread of the V8's 255/60 VR15 radials: two circumferential grooves and angled sipes across the ribs, slots in the shoulders
        let u = ang / 6.2831853 * 76.0; let fade = sat(1.0 - fwidth(u) * 1.3) * (1.0 - blur); let zz = lp.z / 0.12;
        let sipe = (1.0 - smoothstep(0.05, 0.11, abs(fract(u + abs(zz) * 0.7) - 0.5))) * (1.0 - smoothstep(0.82, 0.92, abs(zz)));
        let groove = 1.0 - smoothstep(0.02, 0.045, abs(abs(zz) - 0.38));
        let slot = (1.0 - smoothstep(0.12, 0.22, abs(fract(u * 0.5) - 0.5))) * smoothstep(0.8, 0.9, abs(zz));
        let cut = max(max(sipe * 0.75, groove), slot) * fade;
        s.albedo = base * (1.0 - 0.6 * cut); s.ao = 0.45 - 0.25 * cut; s.rough = 0.93; s.metal = 0.0;
#else
        // tread: a zig-zag sipe down the middle of each rib (the straight grooves between the ribs are geometry) and
        // slanted slots in the shoulders — the pattern of a 1960s touring tyre
        let u = ang / 6.2831853 * 88.0; let tri = abs(fract(u) - 0.5) * 2.0; let fade = sat(1.0 - fwidth(u) * 1.3) * (1.0 - blur);
        let dz = abs(fract(lp.z / 0.027 + (tri - 0.5) * 0.26) - 0.5) * 0.027;
        let sipe = (1.0 - smoothstep(0.0009, 0.0022, dz)) * (1.0 - smoothstep(0.044, 0.048, abs(lp.z)));
        let slot = (1.0 - smoothstep(0.1, 0.2, abs(fract(u * 0.5 + lp.z * 9.0) - 0.5))) * smoothstep(0.046, 0.05, abs(lp.z));
        let cut = max(sipe, slot) * fade;
        s.albedo = base * (1.0 - 0.55 * cut); s.ao = 0.45 - 0.2 * cut; s.rough = 0.95; s.metal = 0.0;
#endif
      } else {
        // sidewall: plain, with two raised rings and faint moulded lettering
        let ring = (1.0 - smoothstep(0.003, 0.007, abs(rn - 0.905))) + (1.0 - smoothstep(0.003, 0.007, abs(rn - 0.655)));
        let tb = smoothstep(0.755, 0.762, rn) * (1.0 - smoothstep(0.828, 0.835, rn));
        let win = step(0.55, textureSampleLevel(tNoise, sLin, vec2f(ang * 0.33, 0.61), 0.0).r);
        let st = smoothstep(0.3, 0.45, abs(fract(ang * 46.0) - 0.5)) * step(0.35, textureSampleLevel(tNoise, sLin, vec2f(ang * 7.3, 0.37), 0.0).a);
        let letters = tb * win * st * (1.0 - blur);
        s.albedo = base * (1.0 + 1.3 * letters + 0.7 * ring * (1.0 - blur)); s.rough = 0.9 - 0.2 * letters; s.ao = 0.5 + 0.2 * letters; s.metal = 0.0;
      }
    }
    case 22u: {   // lamp lenses
      let upW = normalize((O.model * vec4f(0.0, 1.0, 0.0, 0.0)).xyz); let rightW = normalize((O.model * vec4f(0.0, 0.0, 1.0, 0.0)).xyz);
      let rib = 0.82 + 0.18 * sin(lp.y * 6.2831853 / 0.005) * sat(1.0 - fwidth(lp.y) / 0.005 * 2.0);   // fine horizontal prisms
      let tail = step(lp.x, O.p0.w);   // 1 on the lamps at the tail (the same red plastic is also a button in the cabin)
      if (pa < 0.5) {
        // headlamp: clear glass with vertical flutes over the silvered bowl; it glows when the lamps are on
        let k = sin(lp.z * 6.2831853 / 0.009); let kf = sat(1.0 - fwidth(lp.z) / 0.009 * 2.5); let on = sat(O.p0.z);
        s.normal = normalize(s.normal + rightW * k * 0.3 * kf);
        s.albedo = mix(vec3f(0.52, 0.53, 0.54) * mix(1.0, 0.82 + 0.18 * k, kf), vec3f(1.0, 0.93, 0.78), on); s.metal = 0.7 * (1.0 - on); s.rough = 0.14; s.coat = 1.0;
        s.emissive = 0.01 + on * 0.8;
      } else if (pa < 1.5) {
        // stop and tail lamp: deep red that never washes out in the sun; a dim glow always, bright with the brakes
        let br = sat(O.p0.x) * tail;
        s.albedo = mix(vec3f(0.17, 0.003, 0.002), vec3f(0.2, 0.004, 0.002), br) * rib; s.emissive = mix(0.03, 0.66, br); s.rough = 0.45; s.coat = 0.6;
      } else if (pa < 2.5) {
        s.albedo = in.col.rgb * vec3f(0.8, 0.6, 0.5) * rib; s.rough = 0.3; s.coat = 0.7; s.emissive = 0.03;   // amber indicator
      } else if (pa < 3.5) {
        // reflector: little corner prisms that catch the light
        let cell = vec2f(lp.z, lp.y) / 0.004; let pc = fract(cell) - 0.5; let fade = sat(1.0 - fwidth(cell.y) * 1.4);
        s.normal = normalize(s.normal + (rightW * pc.x + upW * pc.y) * 0.5 * fade);
        s.albedo = vec3f(0.24, 0.005, 0.003) * mix(1.0, 0.6 + 0.8 * (1.0 - 2.0 * max(abs(pc.x), abs(pc.y))), fade); s.rough = 0.25; s.coat = 0.9; s.emissive = 0.02;
      } else {
        let rv = sat(O.p0.y) * tail;   // reversing lamp
        s.albedo = mix(in.col.rgb * 0.55, vec3f(1.0, 1.0, 0.95), rv) * rib; s.emissive = 0.004 + rv * 0.5; s.rough = 0.3; s.coat = 0.7;
      }
    }
    case 23u: { s.albedo = vec3f(0.9, 0.9, 0.92); s.metal = 1.0; s.rough = 0.09; s.emissive = sat(O.p0.z) * 0.3; }   // headlamp bowl: bright chrome
    case 24u: {   // leather: a = 0 black hide in pleats about 5 cm wide, a = 1 smooth leather / vinyl with a fine grain
      let g = textureSample(tNoise, sLin, lp.xz * 31.0 + lp.yy * 27.0).b; let g2 = textureSample(tNoise, sLin, lp.zy * 9.0 + lp.xx * 7.0).r;
      s.albedo = in.col.rgb * (0.8 + 0.6 * g) * (0.9 + 0.2 * g2); s.rough = 0.5 + 0.12 * g; s.ao = 0.9;
      if (pa < 0.5) {
        // the pleats run fore and aft on the seats and up and down on the door panels: each swells between two grooves
        let nO = normalize((vec4f(s.normal, 0.0) * O.model).xyz); let side = step(0.75, abs(nO.z));
        let c = mix(lp.z, lp.x, side); let k = fract(c / 0.05) - 0.5; let fade = sat(1.0 - fwidth(c) / 0.05 * 2.0);
        let groove = smoothstep(0.36, 0.5, abs(k)) * fade;
        let axW = normalize((O.model * vec4f(side, 0.0, 1.0 - side, 0.0)).xyz);
        s.normal = normalize(s.normal + axW * k * 1.2 * fade);
        s.albedo *= 1.0 - 0.6 * groove; s.ao = min(s.ao, 1.0 - 0.55 * groove); s.rough = 0.42 + 0.1 * g;
      }
    }
    case 25u: {   // cloth and the figure, matt: a = 0 carpet, 1 headlining, 2 suit, 3 shirt, 4 skin, 5 hair
      s.rough = 0.95;
      if (pa < 1.5) { let w = textureSample(tNoise, sLin, lp.xz * 61.0 + lp.yy * 37.0).a; s.albedo = in.col.rgb * (0.8 + 0.4 * w); }
      else if (pa < 2.5) { let w = sin(lp.z * 1500.0) * sin((lp.x + lp.y) * 1500.0); s.albedo = in.col.rgb * (1.0 + 0.1 * w); s.rough = 0.85; }
      else if (pa < 3.5) { s.rough = 0.8; }
      else if (pa < 4.5) { s.rough = 0.6; }
      else { let w = textureSample(tNoise, sLin, vec2f(lp.z * 40.0, lp.x * 6.0 + lp.y * 6.0)).r; s.albedo = in.col.rgb * (0.7 + 0.6 * w); s.rough = 0.55; }
    }
    case 26u: {   // dashboard: a = 0 black crackle finish, a = 1 varnished wood (rim of the steering wheel)
      if (pa < 0.5) {
        let c = textureSample(tNoise, sLin, lp.zy * 41.0 + lp.xx * 29.0).b; let c2 = textureSample(tNoise, sLin, lp.zy * 113.0 + lp.xx * 71.0).b;
        s.albedo = in.col.rgb * (0.45 + 2.2 * c * c2); s.rough = 0.5 + 0.35 * c; s.ao = 0.7 + 0.3 * c;
      } else {
        let gr = textureSample(tNoise, sLin, vec2f((lp.y + lp.z) * 1.9 + lp.x * 2.9, (lp.z - lp.y) * 44.0 + lp.x * 31.0)).r;
        let gr2 = textureSample(tNoise, sLin, vec2f((lp.y + lp.z) * 5.0 + lp.x * 3.0, (lp.z - lp.y) * 150.0)).g;
        s.albedo = in.col.rgb * (0.4 + 1.0 * gr + 0.35 * gr2); s.rough = 0.38; s.coat = 1.0;
      }
    }
    case 27u: {   // "spinning spokes": a disc in front of the wire spokes that covers them by dithering as the wheel turns faster
      let cov = smoothstep(7.0, 30.0, O.p0.x) * 0.85;
      if (ign(in.pos.xy, F.misc.y) >= cov) { discard; }
      let streak = 0.5 + 0.5 * sin(atan2(lp.y, lp.x) * 36.0);
      s.albedo = in.col.rgb * (0.72 + 0.18 * streak); s.metal = 0.85; s.rough = 0.36; s.coat = 0.0;
    }
    case 28u: {   // muzzle flash: only there while a gun fires (O.p0.x left, O.p0.y right), ragged, a new shape with every shot (O.p0.z)
      let k = select(O.p0.x, O.p0.y, lp.z > 0.0);
      let n = textureSampleLevel(tNoise, sLin, lp.yz * 7.0 + lp.xx * 3.0 + vec2f(O.p0.z * 13.0, O.p0.z * 7.0), 0.0).r;
      if (k <= 0.01 || n > 0.25 + 0.6 * k) { discard; }
      s.albedo = mix(vec3f(1.0, 0.4, 0.07), vec3f(1.0, 0.88, 0.62), sat(k * 1.4 - n)); s.emissive = sat(0.35 + 0.65 * k); s.rough = 1.0;
    }
#endif
    default: {}
  }
  return s;
}
