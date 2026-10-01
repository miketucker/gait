# Biped simulator

Generates the humanoid bodies the viewer merges in at load time (`src/js/bodies.js`): the test
biped; its variants, a thin kid, an overweight ogre and a lanky giant; and five comic bipeds with
exaggerated proportions and motion (`characters.js`), one body pack each in `src/data/`. Plain ES
modules, no dependencies.

```sh
npm run sim:biped                                    # every character, full search, a few minutes each, deterministic
node sim/build-biped.mjs --body ogre                 # one character (--body may repeat)
node sim/build-biped.mjs --quick --body kid --out /tmp/k.json   # small budgets, checks the pipeline end to end
node sim/build-biped.mjs --from src/data/ogre.json   # re-export a saved stride without searching
npm test                                             # simulator + data-contract tests
```

`parade.html` (`src/js/parade.js`) walks every humanoid together, each playing back its own stride,
drawn as cel-shaded primitives around its outline.

## Pipeline

| Step | File | What it does |
| --- | --- | --- |
| Body | `body.js`, `humanoid.js` | Tree of rigid segments with 1–3 axis joints and a floating pelvis. The test character is a 30 kg, 1.32 m humanoid: de Leva segment proportions, 19 segments, 42 DOF, 82 Hill muscles on via-point paths. Shape options reshape it (below). |
| Stride | `gait.js` | 14 parameters (16 with trunk sway and hunch, which only a character's style opens) → a periodic stride. Vertical ground force per foot from Alexander & Jayes's shape family (scaled to body weight). COM path integrated from the forces; horizontal forces aim from each foot's rolling pivot (heel → sole → ball) at a virtual pivot point near the COM, and the periodic solution sets where the feet land. Legs by analytic 6-DOF IK, toes flat on the ground, head level. |
| Dynamics | `dynamics.js` | Newton–Euler inverse dynamics. Each foot's centre of pressure and free moment are chosen inside its sole to minimise the unexplained moment on the pelvis (the residual). |
| Muscles | `muscles.js` | Static optimization per frame (least active muscle volume plus a small quadratic term), compliant tendons iterated to quasi-static equilibrium, De Groote 2016 curves. |
| Energy | `metabolics.js` | Umberger et al. (2003) heat and work rates; basal rate added only to `cot_with_basal`. |
| Search | `simulate.js`, `optimize.js` | Nelder–Mead over the parameters for walk, run and two-footed hop; cost = COT + penalties (reach, ground, limb overlap, friction, residual, reserves as a share of joint torque, joint limits). The cheapest family is polished and exported. Length and frequency bounds scale with leg length (equal Froude number). |
| Export | `export.js` | Viewer schema: model, 50-frame solution, mode card (SVG thumbnail), comparison column. |

## Characters

| | Mass, height | Speed | Shape (relative to adult proportions) |
| --- | --- | --- | --- |
| Biped | 30 kg, 1.32 m | 1.0 m/s | reference proportions |
| Kid | 16 kg, 1.10 m | 1.0 m/s | head ×1.4, legs ×0.92, arms ×0.95, neck ×0.85, breadth ×0.88, muscle per kg ×0.85 |
| Ogre | 280 kg, 2.20 m | 0.7 m/s | legs ×0.88, arms ×1.1, trunk ×1.08, head ×0.85, neck ×0.6, breadth ×1.1, muscle per kg ×1.4; fat: belly ×2, hips ×1.6, chest ×1.3, legs ×1.3, arms ×1.15; thighs kept apart; arms held out 12° |
| Giant | 200 kg, 2.90 m | 1.0 m/s | legs ×1.12, arms ×1.15, trunk ×0.95, head ×0.85, neck ×1.15, breadth ×0.8 |
| Bobblehead | 20 kg, 1.05 m | 1.0 m/s | head ×1.7 (two-fifths of the mass), tiny trunk, stick limbs with strong leg muscles |
| Hood | 40 kg, 1.30 m | 0.6 m/s | flexible spine, neck base low and forward, shoulders up and forward, short legs |
| Stilts | 65 kg, 2.50 m | 1.0 m/s | legs ×1.4, neck ×2, head ×0.75, big feet, droopy narrow shoulders, thin |
| Pear | 110 kg, 1.70 m | 0.8 m/s | narrow sloping shoulders, huge hips and thighs, stubby legs, short arms, big feet |
| Brute | 150 kg, 1.85 m | 1.0 m/s | shoulders ×1.35 wide and raised, thick heavy arms, barrel chest, head sunk between the shoulders, short legs |

The comic bipeds' styles span arm swing from barely moving (the hood, 3–8° each way) to
windmilling (stilts, 42–55°, trailing the legs and flapping outward), and postures from a deep
hunch with a craned neck and downward gaze (hood) to leaning back (stilts), a waddle (pear) and a
shoulder-rolling swagger (brute).

Each variant also has a movement **style**: ranges the stride search must stay inside (the kid's
big arm swing and toddle; the ogre's heavy-load waddle, with the trunk rocking over each foot, wide
steps, bent knees and stomping; the giant's hunched upper back, bent knees, rolling pelvis and long
arm swings that trail the legs) and constants: swing-foot lift, arm-swing lag and, for some, arms
swinging outward, elbow bend, a craned neck and a downward gaze. Left alone,
the search moves as little as it can; with a style it finds the cheapest stride that moves that way,
at a higher cost of transport. The biped has no style.

Shape options of `buildHumanoid()`: segment lengths per region (`legs`, `arms`, `trunk`, `neck`,
`head`, `feet`), `width` (breadth and depth of trunk and limbs: hip and shoulder width, moment arms,
flesh) and `girth` per region (hips, waist, chest, neck, arms, legs), where the `shoulders` and the
`neckBase` sit on the ribcage (the clavicles, the top of the thoracic spine and the muscle
attachments move with them), `spineRange` and `neckRange` (joint ranges), `fat` per region (extra mass as a multiple of lean mass; belly fat is a ball in front of the
abdomen that moves the trunk's centre of mass forward), `muscle` (muscle volume per kg of lean mass),
`armAbduction` and extra `softPairs`. The overall scale makes the standing height `height`; segment
masses follow the de Leva fractions weighted by each segment's volume change and fat, normalized to
`mass`; each muscle's strength is its region's lean mass over its fibre length, times `muscle`
(one number, or per region: spine, neck, arms, legs). With every option at
its default the body is exactly the reference, so the biped is unchanged. Each body also carries a
drawn outline (skin and fat as capsules) that the viewer shows around the skeleton.

To add a character, add an entry to `characters.js` and run `node sim/build-biped.mjs --body <key>`;
the viewer loads every pack the list names, in its order. For a
different body plan, write a builder like `buildHumanoid()` that returns a `Body` whose spec has
`segments` (joints with world-aligned reference frames), `feet` (sole points and the hip–knee–ankle
chain used by the IK), `contacts`, `muscles`, `outline`, `legScale`, and the names of the `arms`,
`spine`, `neck`, `head` and `thorax` joints/segments.

## Limits

- Not a trajectory optimization: kinematics come from the stride parameters, so the model has
  no activation dynamics and no forward re-simulation. The exported walks leave a small unexplained
  pelvis moment (0.7–2.6 % of weight × leg length for the biped, kid, ogre, giant, bobblehead and
  hood) and muscles supply all but 0.1–1.6 % of joint torque. The tests hold the biped, kid, ogre and giant
  to 3 % and 2 %, and the comic bipeds to 5 % and 3 %.
- The comic styles are imposed on the search, and the stride model's ground forces cannot fully
  produce the angular momentum of heavy swinging arms, rocking hips or windmilling: the stilts,
  pear and brute leave 3.4–4.9 % unexplained and need 0.8–2.8 % reserve torque.
- Gaits with a flight phase are not made to conserve angular momentum in the air, so run and hop
  carry large residuals; their costs are shown only as indicative comparisons.
- Held by construction rather than optimized: head level and facing forward (pitched down by a style's
  gaze), wrists straight,
  toes following the ground (their load is carried by the foot).
